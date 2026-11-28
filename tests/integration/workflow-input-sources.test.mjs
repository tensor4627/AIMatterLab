import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {copyProjectInputs} from '../../backend/main/workspace/copy-project-inputs.mjs';
import {createWorkflowInputSources} from '../../backend/main/workspace/workflow-input-sources.mjs';
import {importTaskAsset} from '../../backend/main/workspace/task-asset-import.mjs';
import {TaskRecords} from '../../backend/main/workspace/task-records.mjs';
import {readTaskInput} from '../../backend/main/workspace/task-input-preview.mjs';
import {prepareDeployment, saveDeployment} from '../../backend/main/workspace/task-deployment.mjs';
import {createPrivateCvAccess} from '../../agent/tools/private-cv-access.mjs';
import {assertRendererWorkerRoute, linuxPath} from '../../contracts/transport-policy.mjs';
import {scientificSpec} from '../../contracts/compute/deployment.mjs';
import {probeWslAccess} from '../../desktop/platform/wsl-access.mjs';

const windows=process.platform==='win32';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const uploadRoute='/api/studio-workspace/upload-input';
const runInput='potential nep.txt\ntime_step 1\nensemble nvt_mttk temp 310 310 tperiod 100\nrun 200\n';
const modelBytes=Buffer.from('1\nFixture structure\nH 0 0 0\n');

async function startWorker(t){
 const script=fileURLToPath(new URL('../fixtures/workflow-input-worker.py',import.meta.url));
 const child=spawn(windows?'wsl.exe':'python3',windows?['-d',process.env.STUDIO_WSL_DISTRO||'Ubuntu','--','python3','-B',linuxPath(script)]:['-B',script],{windowsHide:true,stdio:['pipe','pipe','inherit']});
 t.after(()=>{child.stdin.end();});
 const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
 const read=async()=>{const row=await lines.next();if(row.done)throw Error('Fixture worker stopped');return JSON.parse(row.value);};
 const facts=await read();
 return {...facts,async request(method,route,data,admin){child.stdin.write(JSON.stringify({method,route,data,admin})+'\n');const reply=await read();if(reply.error)throw Error(reply.error);return reply.result;}};
}

function workflow(service, request, ssh=false){
 const identity=ssh?{kind:'ssh',version:2,profileId:'fixture',profileVersion:1,hostIdentity:{hostname:'fixture',uid:1000,machineId:'fixture'},root:service.root,runtime:'/fixture/runtime',runtimeId:'a'.repeat(20)}:{distribution:'fixture',root:service.root};
 const worker={connection:{health:{root:service.root,...ssh?{ssh_service:true,hostIdentity:identity.hostIdentity,runtime:identity.runtime}:{}}},identity,connectionTarget:{port:8767},connectionEpoch:1,request:service.request};
 const rows=new Map(),catalog={list:kind=>[...rows].filter(([key])=>key.startsWith(kind+':')).map(([,row])=>structuredClone(row)),get:(kind,id)=>structuredClone(rows.get(kind+':'+id)),put:(kind,id,row)=>rows.set(kind+':'+id,structuredClone(row))};
 const activeTasks=new Map(), records=new TaskRecords(catalog,()=>{});
 const task=records.create({provider:'codex',threadId:'fixture-chat',planningMode:true,workflowVersion:2,request}), projectId=service.project.id;
 task.authoring={projectId,environmentId:service.environment,inputRoot:service.inputRoot,workerBinding:ssh?identity:{...identity,port:8767}};
 task.projectId=projectId;
 records.save(task);
 records.prepareTurnState('codex',{threadId:task.threadId,input:[{type:'text',text:request}],planningMode:true});
 activeTasks.set('codex',task.id);
 const scope={taskId:task.id,provider:task.provider,threadId:task.threadId,projectId,inputRoot:service.inputRoot,checkCurrent:()=>true};
 const current=()=>records.read(task.id),access=createPrivateCvAccess({records,worker,activeTasks});
 const call=async(name,args,handler)=>{
  const token=await access.before(name,args,scope.provider,scope),result=await handler(name,args,scope);
  await access.after(token,result);
  return result;
 };
 return {records,task,worker,scope,projectId,current,call};
}

test('a desktop listing approval does not grant reading the listed file or survive a worker change',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'workflow-approval-'));
 const file=path.join(directory,'model.xyz');await fs.writeFile(file,modelBytes);
 t.after(async()=>{await fs.unlink(file);await fs.rmdir(directory);});
 const approvals=[],connection={health:{root:'/fixture/worker'}};
 const task={id:'task',request:'Find the input',authoring:{projectId:'project',inputRoot:'/fixture/inputs'}};
 const worker={connection,connectionEpoch:1,request(){assert.fail('No transfer can start until the source is approved');}};
 let allow=true,changeWorker=false;
 const tools=createWorkflowInputSources({worker,current:()=>task,userRequest:()=>task.request,requestApproval(_scope,operation,details){
  approvals.push({operation,details});if(changeWorker)worker.connectionEpoch++;return allow;
 }});
 const list=()=>tools('find_local_input_files',{project_id:'project',directory},{});
 assert.deepEqual((await list()).entries,[{name:'model.xyz',relative_file:'model.xyz'}]);
 allow=false;
 await assert.rejects(tools('import_workflow_input',{project_id:'project',local_file:file},{}),/operation_declined_by_user/);
 assert.deepEqual(approvals,[{operation:'list',details:{directory}},{operation:'import',details:{source:file,destination:'/fixture/inputs',name:'model.xyz'}}]);
 allow=true;changeWorker=true;
 await assert.rejects(list(),/Restore the original workflow authoring service/);
 task.request=`不要读取 "${file}"。`;
 await assert.rejects(tools('import_workflow_input',{project_id:'project',local_file:file},{}),/desktop_input_excluded_by_user/);
 assert.equal(approvals.length,3);
});

test('desktop and public files, selected SSH files and supplied scientific values reach prepared inputs', {timeout:45000}, async t=>{
 if(windows&&probeWslAccess().status!=='allowed'){t.skip('Run from a Windows account with WSL access');return;}
 const service=await startWorker(t);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'workflow sources '));
 const local=path.join(directory,'initial.xyz'), binary=path.join(directory,'reference.pt');
 await fs.writeFile(local,modelBytes);await fs.writeFile(binary,Buffer.alloc(1024*1024+23,0xe7));
 t.after(async()=>{await fs.unlink(local);await fs.unlink(binary);await fs.rmdir(directory);});
 const f=workflow(service,`从 "${directory}" 查找结构，另有精确文件 "${binary}"。`,true);
 const sourceTools=createWorkflowInputSources({worker:f.worker,current:f.current,userRequest:scope=>f.records.currentInputRequest(scope),open:async url=>{
  assert.equal(url.href,'https://example.org/case/run.in');
  const response=Readable.from([Buffer.from(runInput.slice(0,30)),Buffer.from(runInput.slice(30))]);
  response.headers={'content-type':'application/octet-stream'};
  return {url:url.href,response};
 }});
 const tool=(name,args)=>f.call(name,{project_id:f.projectId,...args},sourceTools);
 assert.throws(()=>assertRendererWorkerRoute('POST',uploadRoute),/typed/);
 await assert.rejects(service.request('POST',uploadRoute,{action:'status'},false),/Only the desktop/);
 await assert.rejects(tool('find_local_input_files',{directory:path.dirname(directory)}),/explicitly named/);
 const found=await tool('find_local_input_files',{directory,name_contains:'.xyz'});
 assert.deepEqual(found.entries,[{name:'initial.xyz',relative_file:'initial.xyz'}]);
 const [model]=(await tool('import_workflow_input',{local_file:local,name:'model.xyz'})).files;
 assert.equal(model.sha256,sha(modelBytes));
 const selected=await importTaskAsset({records:f.records,worker:f.worker,getProvider:()=>f.task.provider,chooseFile:async()=>binary},{taskId:f.task.id});
 assert.equal(selected.asset.sha256,sha(await fs.readFile(binary)));
 assert.equal((await service.request('POST','/api/workspace/read',{project_id:f.projectId,name:selected.asset.path})).binary,true);
 const [potential]=(await f.call('copy_project_inputs',{project_id:f.projectId,sources:[service.remote],names:['nep.txt']},(_name,args,scope)=>copyProjectInputs({worker:f.worker,current:f.current},args,scope))).files;
 const [config]=(await tool('import_workflow_input',{url:'https://example.org/case/run.in',sha256:sha(runInput)})).files;
 assert.equal(config.sha256,sha(runInput));
 assert.equal(f.current().authoring.imports.length,4);

 const fields=[{key:'structure_file',label:'Structure',type:'file',required:true},{key:'potential_file',label:'Potential',type:'file',required:true},
  {key:'control_file',label:'Control',type:'file',required:true},{key:'time_step_fs',label:'Time step',type:'number',required:true,unit:'fs'},
  {key:'temperature',label:'Temperature',type:'number',required:true,unit:'K'},{key:'steps',label:'Steps',type:'integer',required:true}];
 const proposal={task_id:f.task.id,name:'File and parameter sources',steps:[{id:'md',title:'MD Inputs',fields,description:'Time step from fixture manual. Temperature from fixture literature.'}],
  parameters:{engine:'gpumd.md',structure_file:model.path,potential_file:potential.path,control_file:config.path,time_step_fs:1,temperature:310,steps:null},missing_fields:['steps']};
 f.records.presentDraft(f.task.provider,f.task.threadId,proposal);
 const planned=f.current();
 assert.deepEqual(planned.parameters.files,[model.path,potential.path,config.path]);
 assert.equal(planned.parameters.structure_file,model.path);
 assert.equal(planned.parameters.potential_file,potential.path);
 assert.equal(planned.parameters.time_step_fs,1);
 assert.equal(planned.parameters.temperature,310);
 assert.deepEqual(planned.missingFields,['steps']);
 assert.equal((await readTaskInput(f.records,f.worker,{taskId:f.task.id,path:model.path})).text,modelBytes.toString());
 f.records.edit({id:f.task.id,changes:{steps:500}});
 assert.deepEqual(f.current().missingFields,[]);
 const active=f.current().parameters;
 const deploy={target:'local',targetId:service.environment,directoryName:'source-test',maxSeconds:60,gpu:0,resources:{cpus:1,gpus:1,memory_mb:1024}};
 saveDeployment(f.records,{taskId:f.task.id,value:deploy},null,f.worker);
 await assert.rejects(prepareDeployment(f.records,f.worker,{taskId:f.task.id}),/Declared scientific parameter differs from run.in: steps/);
 const actual=runInput.replace('run 200','run '+active.steps);
 await f.worker.request('POST','/api/workspace/write',{project_id:f.projectId,name:config.path.slice(service.inputRoot.length+1),content:actual,expected_sha256:config.sha256});
 const prepared=await prepareDeployment(f.records,f.worker,{taskId:f.task.id});
 assert.equal(prepared.status,'draft');
 assert.match(prepared.project_id,/^workflow-scope-/);
 assert.equal(f.current().deployment.prepared.projectId,prepared.project_id);
 assert(!(await f.worker.request('GET','/api/projects')).some(project=>project.id===prepared.project_id));
 assert.deepEqual(prepared.snapshots.map(row=>[row.name,row.sha256]),[['model.xyz',model.sha256],['nep.txt',potential.sha256],['run.in',sha(actual)]]);
 assert.deepEqual(prepared.input_contract,{status:'passed',checked_fields:['steps','time_step_fs','temperature'],scope:'declared simple GPUMD input controls only'});
 await assert.rejects(tool('import_workflow_input',{url:'https://example.org/case/run.in',sha256:sha(runInput)}),/SHA-256 differs/);
 assert.equal((await readTaskInput(f.records,f.worker,{taskId:f.task.id,path:config.path})).text,actual);
 assert.equal(f.current().parameters.steps,500);
 assert.equal(f.current().execution,undefined);

 await t.test('a control file generated from the workflow parameters reaches a new prepared snapshot',async()=>{
  const generated=workflow(service,'Generate GPUMD control input for the selected model at 325 K, 0.5 fs and 750 steps.');
  const taskId=generated.task.id;
  const draft={...proposal,task_id:taskId,name:'Generate run.in',missing_fields:['control_file'],parameters:{
   engine:'gpumd.md',structure_file:model.path,potential_file:potential.path,control_file:null,time_step_fs:0.5,temperature:325,steps:750}};
  const present=value=>generated.records.presentDraft(generated.task.provider,generated.task.threadId,value);
  present(draft);
  assert.deepEqual(generated.current().missingFields,['control_file']);
  const described=await generated.worker.request('POST','/api/engine/describe',{engine:'gpumd.md'});
  assert(described.required_inputs.includes('run.in'));
  const {time_step_fs,temperature,steps,potential_file}=generated.current().parameters;
  const body=`potential ${path.posix.basename(potential_file)}\ntime_step ${time_step_fs}\nensemble nvt_mttk temp ${temperature} ${temperature} tperiod 100\nrun ${steps}\n`;
  const saved=await generated.call('write_project_input',{project_id:generated.projectId,name:'generated-control/run.in',content:body},
   (_name,args)=>generated.worker.request('POST','/api/workspace/write',args,false));
  assert.equal(saved.previous_sha256,null);
  const checked=await generated.call('read_project_input',{project_id:generated.projectId,name:saved.path},
   (_name,args)=>generated.worker.request('POST','/api/workspace/read',args,false));
  assert.equal(checked.text,body);
  assert.equal(checked.sha256,sha(body));
  present({...draft,parameters:{...draft.parameters,control_file:checked.path},missing_fields:[]});
  assert.deepEqual(generated.current().missingFields,[]);
  assert.equal(generated.current().parameters.control_file,checked.path);
  assert(generated.current().parameters.files.includes(checked.path));
  saveDeployment(generated.records,{taskId,value:deploy},null,generated.worker);
  const run=await prepareDeployment(generated.records,generated.worker,{taskId});
  assert.equal(run.input_contract.status,'passed');
  assert.equal(run.snapshots.find(input=>input.name==='run.in').sha256,checked.sha256);
 });
});

test('a manually replaced file or scalar updates equal adapter aliases and keeps the input list usable',()=>{
 const root='/fixture/projects/source-fixture/inputs';
 const f=workflow({root:'/fixture',inputRoot:root,environment:'fixture-env',project:{id:'source-fixture'}},'Edit only the chosen scientific inputs');
 const original=root+'/old/bias.pt', replacement=root+'/selected/bias.pt', structure=root+'/model.xyz';
 f.records.presentDraft(f.task.provider,f.task.threadId,{task_id:f.task.id,name:'Alias fixture',steps:[{id:'inputs',title:'Inputs',fields:[
  {key:'bias.file',label:'Bias model',type:'file',required:true},{key:'cv.size',label:'CV count',type:'integer',required:true}]}],
  parameters:{engine:'bias.validate',files:[original,structure],bias_file:original,structure_file:structure,cv_size:1,cutoff:5,mode:'bias',bias:{file:original},cv:{size:1}},missing_fields:[]});
 const edited=f.records.edit({id:f.task.id,changes:{'bias.file':replacement,'cv.size':2}}), spec=scientificSpec(edited);
 assert.equal(edited.parameters.bias.file,replacement);
 assert.equal(edited.parameters.bias_file,replacement);
 assert.deepEqual(edited.parameters.files,[structure,replacement]);
 assert.equal(edited.parameters.cv_size,2);
 assert.equal(spec.inputs['bias.pt'],replacement);
 assert.equal(spec.parameters.cv_size,2);
});
