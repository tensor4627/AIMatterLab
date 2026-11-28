import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentProjectIssue,deploymentProjectId} from "../../contracts/compute/deployment-authorization.mjs";
import {validDeployment} from "../../contracts/compute/deployment.mjs";

import {TaskRecords} from "../../agent/sessions/task-records.mjs";
import {saveDeployment,prepareDeployment} from "../../backend/main/workspace/task-deployment.mjs";
import {executeTask} from '../../backend/main/workspace/task-execution.mjs';

const config={target:'local',projectId:'compute',targetId:'gpu-env',gpu:0,maxSeconds:300,inputSource:'local',directoryName:'short',resources:{cpus:1,gpus:1,memory_mb:4096,queue:'',account:''}};
const project={id:'compute',name:'Compute',policy:{engines:['gpumd.md','pygas.build'],environments:['gpu-env'],clusters:['cluster'],gpus:[0],max_seconds:3600,max_concurrent:1,input_roots:['/inputs']}};
function fixture(){
 const data=new Map(),catalog={get:(kind,id)=>structuredClone(data.get(kind+id)),put:(kind,id,value)=>{data.set(kind+id,structuredClone(value));return value;},list:()=>[]},records=new TaskRecords(catalog,()=>{});
 const task=records.create({workflowVersion:2,planningMode:true,provider:'codex',threadId:'thread',request:'Short MD',projectId:'draft'});
 task.authoring={projectId:'draft',environmentId:'authoring',inputRoot:'/inputs'};
 task.parameters={engine:'gpumd.md',files:['/inputs/run.in','/inputs/model.xyz']};task.review={status:'ready',parameterRevision:task.parameterRevision};records.save(task);saveDeployment(records,{taskId:task.id,value:config});
 return {records,task};
}

test('A workflow with no compute project prepares and executes on its selected resource in its own scope',async()=>{
 const {records,task}=fixture(),requests=[];
 const next=records.read(task.id);next.parameters.files.push('/other/trajectory.xyz');records.save(next);
 let project,run;
 const worker={connection:{health:{root:'/worker'}},identity:{distribution:'fixture',root:'/worker'},request:async(method,route,data)=>{
  requests.push([method,route]);
  if(route==='/api/environments')return [{id:'gpu-env'}];
  if(route==='/api/projects'){assert.equal(method,'POST');project=data;return project;}
  if(route==='/api/authoring/adopt'){assert.equal(data.target_project_id,project.id);return {paths:{}};}
  if(route==='/api/runs/prepare'){assert.equal(data.spec.project_id,project.id);run={id:'new-run',project_id:project.id,status:'draft',engine:'gpumd.md',snapshots:[]};return run;}
  if(route==='/api/run/status')return run;
  if(route==='/api/run/submit')return {...run,status:'running'};
  throw Error(route);
 }};
 saveDeployment(records,{taskId:task.id,value:{...config,projectId:''}},null,worker);
 assert.deepEqual(requests,[]);
 const prepared=await prepareDeployment(records,worker,{taskId:task.id});
 const saved=records.read(task.id);
 assert.equal(saved.deployment.config.projectId,'');
 assert.equal(saved.authoring.projectId,'draft');
 assert.equal(saved.deployment.prepared.projectId,project.id);
 assert.deepEqual(project.policy.environments,['gpu-env']);
 assert.deepEqual(project.policy.engines,['gpumd.md']);
 assert(project.policy.input_roots.includes('/other/trajectory.xyz'));
 assert.equal(project.conversation_scope.workflow,task.id);
 const sibling=records.create({workflowVersion:2,planningMode:true,provider:'codex',threadId:'other-thread',request:'Other conversation'});
 assert.throws(()=>records.linkRun(sibling.id,prepared),/does not match/);
 const result=await executeTask(records,worker,{taskId:task.id,artifactId:prepared.id,inputReceipt:saved.deployment.prepared.inputIdentity});
 assert.equal(result.status,'running');
 assert.equal(records.read(task.id).execution.status,'running');
});

test('A replaced resource catalog cannot create a deployment scope for a stale conversation',async()=>{
 const {records,task}=fixture(),calls=[];
 const worker={connection:{},identity:{distribution:'fixture',root:'/worker'},request:async(method,route)=>{
  calls.push([method,route]);
  const next=records.read(task.id);next.threadId='other-thread';records.save(next);
  return [{id:'gpu-env'}];
 }};
 saveDeployment(records,{taskId:task.id,value:{...config,projectId:''}},null,worker);
 await assert.rejects(prepareDeployment(records,worker,{taskId:task.id}),/部署已修改/);
 assert.deepEqual(calls,[['GET','/api/environments']]);
});

test('Draft workspaces are never compute projects, even with permissive legacy fields',()=>{
 assert.equal(deploymentProjectIssue({...project,authoring_only:true},config,'gpumd.md').code,'compute-project-required');
 assert.equal(deploymentProjectIssue(project,config,'gpumd.md'),null);
 assert.equal(deploymentProjectIssue(project,{...config,target:'cluster',targetId:'cluster'},'gpumd.md'),null);
});
for(const [label,change,code] of [
 ['missing',()=>null,'compute-project-required'],['draft',p=>({...p,authoring_only:true}),'compute-project-required'],
 ['engine',p=>({...p,policy:{...p.policy,engines:[]}}),'engine'],['environment',p=>({...p,policy:{...p.policy,environments:[]}}),'target'],
 ['GPU',p=>({...p,policy:{...p.policy,gpus:[1]}}),'gpu'],['zero local GPUs',p=>({...p,policy:{...p.policy,gpus:[]}}),'gpu'],
 ['duration',p=>({...p,policy:{...p.policy,max_seconds:20}}),'duration'],
])test('Prepare rejects '+label+' before saving an idempotency request, adopting inputs or creating a run',async()=>{
 const {records,task}=fixture(),before=records.read(task.id),candidate=change(structuredClone(project)),calls=[];
 const worker={request:async(method,route)=>{calls.push([method,route]);assert.equal(route,'/api/projects');return candidate?[candidate]:[];}};
 assert.equal(deploymentProjectIssue(candidate,config,'gpumd.md').code,code);
 await assert.rejects(prepareDeployment(records,worker,{taskId:task.id}),new RegExp(deploymentProjectIssue(candidate,config,'gpumd.md').message));
 assert.deepEqual(records.read(task.id),before);assert.deepEqual(calls,[['GET','/api/projects']]);
});
test('Local GPU authorization uses only explicit GPU IDs and honors the two fixed CPU routes',()=>{
 const engines=['installation.check','trajectory.density','gpumd.md'];
 const withGpus=gpus=>({...project,policy:{...project.policy,engines,gpus}});
 for(const gpus of [[2],[]]){
  for(const engine of engines.slice(0,2))assert.equal(deploymentProjectIssue(withGpus(gpus),{...config,gpu:7},engine),null);
  assert.equal(deploymentProjectIssue(withGpus(gpus),config,'gpumd.md').code,'gpu');
 }
 assert.equal(deploymentProjectIssue(withGpus([2]),{...config,gpu:2},'gpumd.md'),null);
 assert.equal(deploymentProjectIssue(withGpus([]),{...config,target:'cluster',targetId:'cluster'},'gpumd.md'),null);
 for(const gpus of ['0',['0'],[false],[0,1.5],[-1],[2**53],Array(1)]){
  for(const engine of engines)assert.equal(deploymentProjectIssue(withGpus(gpus),config,engine).code,'gpu');
 }
 for(const gpu of ['0',[],null,false,-1,2**53]){
  for(const engine of engines)assert.equal(deploymentProjectIssue(withGpus([0]),{...config,gpu},engine).code,'gpu');
  assert.throws(()=>validDeployment({...config,gpu}),/gpu/);
 }
 assert.equal(validDeployment({...config,gpu:undefined}).gpu,0);
});
test('The deployment entry point prepares a fixed trajectory analysis for a project with zero local GPUs',async()=>{
 const {records,task}=fixture(),calls=[],engine='trajectory.density';
 const cpuProject={...project,policy:{...project.policy,engines:[engine],gpus:[]}};
 const next=records.read(task.id);
 next.parameters={engine,files:['/inputs/trajectory.xyz']};
 records.save(next);
 saveDeployment(records,{taskId:task.id,value:{...config,gpu:7}});
 const worker={request:async(_method,route,data)=>{
  calls.push(route);
  if(route==='/api/projects')return [cpuProject];
  if(route==='/api/authoring/adopt')return {paths:{}};
  assert.equal(route,'/api/runs/prepare');
  assert.deepEqual(data.spec.inputs,{'trajectory.xyz':'/inputs/trajectory.xyz'});
  assert.equal(data.spec.engine,engine);
  assert.equal(data.spec.gpu,7);
  assert.equal(data.spec.project_id,cpuProject.id);
  return {id:'prepared-analysis',status:'draft',engine,project_id:cpuProject.id,snapshots:[]};
 }};
 const result=await prepareDeployment(records,worker,{taskId:task.id});
 assert.equal(result.status,'draft');
 assert.deepEqual(calls,['/api/projects','/api/authoring/adopt','/api/runs/prepare']);
});
test('An unavailable project catalog fails closed without input copying or record writes',async()=>{
 for(const response of [null,{},'offline']){
  const {records,task}=fixture(),before=records.read(task.id);
  await assert.rejects(prepareDeployment(records,{request:async()=>response},{taskId:task.id}),/无法读取计算项目/);
  assert.deepEqual(records.read(task.id),before);
 }
});
test('A late catalog response cannot prepare the old deployment after a user edit',async()=>{
 const {records,task}=fixture(),calls=[],worker={request:async(method,route)=>{calls.push(route);const changed=records.read(task.id);changed.deployment.revision++;changed.deployment.config.targetId='different';records.save(changed);return [project];}};
 await assert.rejects(prepareDeployment(records,worker,{taskId:task.id}),/部署已修改/);
 assert.deepEqual(calls,['/api/projects']);assert.equal(records.read(task.id).deployment.request,undefined);
});
test('A changed advisory review during catalog read leaves actual project permission and preparation independent',async()=>{
 const {records,task}=fixture(),calls=[],localReview={authority:t=>t.review?.status==='ready'?{kind:'ai',parameterRevision:t.parameterRevision}:null},worker={request:async(method,route)=>{calls.push(route);if(route==='/api/projects'){const next=records.read(task.id);next.review.status='needs-information';records.save(next);return [project];}if(route==='/api/authoring/adopt')return {paths:{}};return {id:'prepared',project_id:'compute',engine:'gpumd.md',status:'draft',snapshots:[]};}};
 const run=await prepareDeployment(records,worker,{taskId:task.id},localReview);assert.equal(run.status,'draft');assert.equal(records.read(task.id).review.status,'needs-information');assert.deepEqual(calls,['/api/projects','/api/authoring/adopt','/api/runs/prepare']);
});

test('Explicit compute selection preserves the authoring workflow; adoption and preparation stay separate from execution',async()=>{
 const {records,task}=fixture(),calls=[],before=structuredClone(project),run={id:'prepared',status:'draft',engine:'gpumd.md',project_id:'compute',snapshots:[]};
 const worker={request:async(method,route,data)=>{calls.push([method,route]);if(route==='/api/projects')return [structuredClone(project)];if(route==='/api/authoring/adopt'){assert.equal(data.source_project_id,'draft');assert.equal(data.target_project_id,'compute');return {paths:{}};}if(route==='/api/runs/prepare')return run;if(route==='/api/run/status')return run;throw Error(route);}};
 await prepareDeployment(records,worker,{taskId:task.id});await prepareDeployment(records,worker,{taskId:task.id});
 assert.equal(records.read(task.id).projectId,'draft');assert.equal(records.read(task.id).authoring.projectId,'draft');assert.equal(records.read(task.id).deployment.prepared.artifactId,'prepared');assert.deepEqual(project,before);
 assert.equal(calls.filter(([,route])=>route.endsWith('/prepare')).length,1);assert(!calls.some(([,route])=>/validate|submit/.test(route)));
});
test('Project suggestions only select a unique eligible compute project; explicit restricted selection is retained',()=>{
 const draft={...project,id:'draft',authoring_only:true},restricted={...project,id:'restricted',policy:{...project.policy,engines:[]}};
 assert.equal(deploymentProjectId([draft,project],'draft',config,'gpumd.md'),'compute');
 assert.equal(deploymentProjectId([draft,project,{...project,id:'another'}],'draft',config,'gpumd.md'),'');
 assert.equal(deploymentProjectId([restricted,project],'restricted',config,'gpumd.md'),'restricted');
});
