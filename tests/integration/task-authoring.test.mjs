import test from 'node:test';import assert from 'node:assert/strict';import {ensureTaskAuthoring,explicitStructures,selectedInputs} from "../../backend/main/workspace/task-authoring.mjs";import {TaskRecords} from "../../agent/sessions/task-records.mjs";
function fixture(provider='codex'){const data=new Map(),catalog={get:(k,id)=>structuredClone(data.get(k+id)),put:(k,id,v)=>{data.set(k+id,structuredClone(v));return v;},list:k=>[...data.entries()].filter(([key])=>key.startsWith(k)).map(([,v])=>structuredClone(v))};const records=new TaskRecords(catalog,()=>{}),task=records.create({workflowVersion:2,provider,threadId:'thread',planningMode:true,request:'CV'});const calls=[],worker={connection:{health:{root:'/fixture/service'}},identity:{distribution:'Fixture Ubuntu',root:'/fixture/service'},connectionTarget:{port:8767},connectionEpoch:1,request:async(method,target,value)=>{calls.push({method,target,value});return {project:{id:value.project_id||'draft-'+task.id,authoring_only:true},input_root:'/fixture/inputs',environment_id:'authoring',imports:[]};}};return {records,task,worker,calls};}
for(const provider of ['codex','kimi','qwen','deepseek'])test(provider+' repairs an unbound workflow before inference and keeps one project on continuation',async()=>{const {records,task,worker,calls}=fixture(provider);const first=await ensureTaskAuthoring(records,worker,{provider,threadId:'thread',taskId:task.id,text:'Use /home/user/model.xyz'});const saved=records.read(task.id);assert.equal(saved.projectId,'draft-'+task.id);assert.equal(records.conversation(provider,'thread').projectId,saved.projectId);assert.match(first.text,/read-only shell sandbox/);assert.deepEqual(calls[0].value.structure_paths,['/home/user/model.xyz']);await ensureTaskAuthoring(records,worker,{provider,threadId:'thread',text:'continue'});assert.equal(calls[1].value.project_id,saved.projectId);assert.equal(records.tasks().length,1);assert.equal(saved.authoring.environmentId,'authoring');});
test('Plain chat creates no project, wrong thread and disconnected authoring fail before model RPC',async()=>{const {records,task,worker,calls}=fixture();assert.equal(await ensureTaskAuthoring(records,worker,{provider:'codex',threadId:'new-chat'}),null);assert.equal(calls.length,0);await assert.rejects(()=>ensureTaskAuthoring(records,worker,{provider:'kimi',threadId:'thread',taskId:task.id}),/Invalid authoring/);worker.connection=null;await assert.rejects(()=>ensureTaskAuthoring(records,worker,{provider:'codex',threadId:'thread'}),/作业服务/);assert.equal(calls.length,0);});
test('Explicit user structure imports are bounded paths, never broad filesystem roots',()=>{assert.deepEqual(explicitStructures('use "D:\\data\\my file.xyz" and /home/user/a.extxyz'),['/mnt/d/data/my file.xyz','/home/user/a.extxyz']);assert.deepEqual(explicitStructures('use /home/user/POSCAR'),['/home/user/POSCAR']);assert.deepEqual(explicitStructures('credentials.json ~/.ssh/id_rsa http://example.test/a.xyz'),[]);});


test('Only exact human file receipts authorize selected imports; AI paths and type changes never inherit permission',()=>{
 const {records,task}=fixture();let current=records.read(task.id);current.parameters.files=['/private/agent.pt'];current.steps=[{id:'files',title:'Inputs',fields:[{key:'files',label:'Files',type:'files',required:true},{key:'cv.source',label:'Source',type:'text',required:false}]}];records.save(current);
 current=records.edit({id:task.id,changes:{files:['/private/agent.pt','/public/human.pt']}});assert.deepEqual(selectedInputs(current).map(item=>item.path),['/public/human.pt']);
 current.parameters.files=['/private/agent.pt','/private/replaced.pt'];records.save(current);assert.deepEqual(selectedInputs(current),[]);
 current=records.edit({id:task.id,changes:{'cv.source':'/private/cv.py'}});current.steps[0].fields[1].type='file';records.save(current);assert.deepEqual(selectedInputs(current),[]);
});
test('Partial human file-list entry preserves only prior approved elements and later path replacement is explicit',()=>{
 const {records,task}=fixture();records.edit({id:task.id,changes:{files:['/public/one.xyz']}});records.edit({id:task.id,changes:{files:['/public/one.xyz','']}});
 const current=records.edit({id:task.id,changes:{files:['/public/one.xyz','/public/two.pt']}});assert.deepEqual(selectedInputs(current).map(item=>item.path),['/public/one.xyz','/public/two.pt']);
});
test('Human-selected paths map to copied inputs before review without trusting adjacent Agent paths',async()=>{
 const {records,task,worker,calls}=fixture();let current=records.read(task.id);current.parameters.files=['/private/agent.pt'];records.save(current);records.edit({id:task.id,changes:{files:['/private/agent.pt','D:\\public\\model.xyz']}});
 const original=worker.request;worker.request=async(...args)=>{const result=await original(...args);result.imports=[{source:'/mnt/d/public/model.xyz',path:'/fixture/inputs/import/model.xyz',sha256:'a'.repeat(64),status:'passed'}];return result;};
 await ensureTaskAuthoring(records,worker,{provider:'codex',threadId:'thread'});assert.deepEqual(calls[0].value.selected_paths,['/mnt/d/public/model.xyz']);assert.deepEqual(records.read(task.id).parameters.files,['/private/agent.pt','/fixture/inputs/import/model.xyz']);assert.equal(records.read(task.id).authoring.imports[0].sha256,'a'.repeat(64));
});
test('A later manual path edit wins over delayed authoring import receipts',async()=>{
 const {records,task,worker}=fixture();records.edit({id:task.id,changes:{files:['/public/first.xyz']}});const original=worker.request;worker.request=async(...args)=>{const result=await original(...args);records.edit({id:task.id,changes:{files:['/public/latest.xyz']}});return {...result,imports:[{source:'/public/first.xyz',path:'/owned/first.xyz',sha256:'b'.repeat(64),status:'passed'}]};};
 await ensureTaskAuthoring(records,worker,{provider:'codex',threadId:'thread'});assert.deepEqual(records.read(task.id).parameters.files,['/public/latest.xyz']);
});

test('Review preserves selected files while permitting only generated owned-input additions',()=>{
 const {records,task}=fixture();let current=records.read(task.id);current.authoring={inputRoot:'/owned/inputs'};records.save(current);records.edit({id:task.id,changes:{files:['/public/human.xyz']}});records.prepareTurn('codex',{threadId:'thread',reviewMode:true});
 records.event({provider:'codex',method:'item/completed',params:{threadId:'thread',item:{tool:'present_task',result:{kind:'task-parameters',id:task.id,name:'Owned additions',steps:[],missing_fields:[],parameters:{engine:'pygas.build',files:['/owned/inputs/build_bias.py','/owned/inputs/../secret.py','/private/agent.pt']}}}}});
 current=records.read(task.id);assert.deepEqual(current.parameters.files,['/public/human.xyz','/owned/inputs/build_bias.py']);assert.deepEqual(current.manualInputs.files.approvedValues,['/public/human.xyz']);assert.deepEqual(selectedInputs(current),[]);
});

test('Windows POSCAR imports support bare and quoted spaces without treating URLs or UNC as Linux inputs',()=>{
 assert.deepEqual(explicitStructures(String.raw`D:\data\new\POSCAR`),['/mnt/d/data/new/POSCAR']);
 assert.deepEqual(explicitStructures(String.raw`"D:\data\my sample\POSCAR"`),['/mnt/d/data/my sample/POSCAR']);
 for(const text of [String.raw`\\server\share\POSCAR`,'https://home/user/POSCAR','"//server/share/POSCAR"'])assert.deepEqual(explicitStructures(text),[],text);
});


test('Delayed status cannot reorder artifacts or update execution after its prepared anchor changed',()=>{
 const {records,task}=fixture();let value=records.read(task.id);value.projectId='project';value.parameterRevision=3;value.artifacts=[{id:'old',kind:'run',preparedRevision:2}];value.deployment={revision:1,config:{projectId:'project'},prepared:{artifactId:'old',parameterRevision:2,deploymentRevision:1}};records.save(value);
 const expected=structuredClone(value.deployment.prepared),old={id:'old',project_id:'project',status:'succeeded',engine:'pydyn.md'};
 // The current anchor can describe a historical parameter revision; this is a read, not authorization to execute.
 assert.equal(records.linkRun(task.id,old,expected).artifacts.at(-1).id,'old');
 value=records.read(task.id);value.deployment={...value.deployment,revision:2,prepared:{artifactId:'new',parameterRevision:3,deploymentRevision:2}};value.artifacts.push({id:'new',kind:'run',preparedRevision:3});value.execution={phase:'unknown',artifactId:'new'};records.save(value);const before=records.read(task.id);
 assert.throws(()=>records.linkRun(task.id,old,expected),/Prepared run changed/);assert.deepEqual(records.read(task.id),before);
 for(const invalid of [null,{},[],{...expected,extra:true},{...expected,parameterRevision:-1},{...expected,deploymentRevision:1.5}])assert.throws(()=>records.linkRun(task.id,old,invalid),/Invalid prepared reference/);
 assert.deepEqual(records.read(task.id),before);
 assert.throws(()=>records.linkRun(task.id,old,value.deployment.prepared),/Prepared run changed/);
});
