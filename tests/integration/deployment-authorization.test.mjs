import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentProjectIssue,deploymentProjectId} from "../../contracts/compute/deployment-authorization.mjs";

import {TaskRecords} from "../../agent/sessions/task-records.mjs";
import {saveDeployment,prepareDeployment} from "../../backend/main/workspace/task-deployment.mjs";

const config={target:'local',projectId:'compute',targetId:'gpu-env',gpu:0,maxSeconds:300,inputSource:'local',directoryName:'short',resources:{cpus:1,gpus:1,memory_mb:4096,queue:'',account:''}};
const project={id:'compute',name:'Compute',policy:{engines:['gpumd.md','pygas.build'],environments:['gpu-env'],clusters:['cluster'],gpus:[0],max_seconds:3600,max_concurrent:1,input_roots:['/inputs']}};
function fixture(){
 const data=new Map(),catalog={get:(kind,id)=>structuredClone(data.get(kind+id)),put:(kind,id,value)=>{data.set(kind+id,structuredClone(value));return value;},list:()=>[]},records=new TaskRecords(catalog,()=>{});
 const task=records.create({workflowVersion:2,planningMode:true,provider:'codex',threadId:'thread',request:'Short MD',projectId:'draft'});
 task.authoring={projectId:'draft',environmentId:'authoring',inputRoot:'/inputs'};
 task.parameters={engine:'gpumd.md',files:['/inputs/run.in','/inputs/model.xyz']};task.review={status:'ready',parameterRevision:task.parameterRevision};records.save(task);saveDeployment(records,{taskId:task.id,value:config});
 return {records,task};
}

test('Draft workspaces are never compute projects, even with permissive legacy fields',()=>{
 assert.equal(deploymentProjectIssue({...project,authoring_only:true},config,'gpumd.md').code,'compute-project-required');
 assert.equal(deploymentProjectIssue(project,config,'gpumd.md'),null);
 assert.equal(deploymentProjectIssue(project,{...config,target:'cluster',targetId:'cluster'},'gpumd.md'),null);
});
for(const [label,change,code] of [
 ['missing',()=>null,'compute-project-required'],['draft',p=>({...p,authoring_only:true}),'compute-project-required'],
 ['engine',p=>({...p,policy:{...p.policy,engines:[]}}),'engine'],['environment',p=>({...p,policy:{...p.policy,environments:[]}}),'target'],
 ['GPU',p=>({...p,policy:{...p.policy,gpus:[1]}}),'gpu'],['duration',p=>({...p,policy:{...p.policy,max_seconds:20}}),'duration'],
])test('Prepare rejects '+label+' before saving an idempotency request, adopting inputs or creating a run',async()=>{
 const {records,task}=fixture(),before=records.read(task.id),candidate=change(structuredClone(project)),calls=[];
 const worker={request:async(method,route)=>{calls.push([method,route]);assert.equal(route,'/api/projects');return candidate?[candidate]:[];}};
 assert.equal(deploymentProjectIssue(candidate,config,'gpumd.md').code,code);
 await assert.rejects(prepareDeployment(records,worker,{taskId:task.id}),new RegExp(deploymentProjectIssue(candidate,config,'gpumd.md').message));
 assert.deepEqual(records.read(task.id),before);assert.deepEqual(calls,[['GET','/api/projects']]);
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
