import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagedComputeTools} from '../../agent/tools/managed-compute-tools.mjs';

function fixture({runIntent,protectedTask=false}={}){
 let current=true,delegation='original-delegation';
 const scope={provider:'codex',threadId:'thread-a',taskId:'task-a',projectId:'project-a',inputRoot:'/worker/inputs',checkCurrent:()=>current};
 const owner={provider:scope.provider,threadId:scope.threadId,taskId:scope.taskId,projectId:scope.projectId,runId:'run-b'};
 const task={id:scope.taskId,parameters:{files:['/worker/inputs/model.xyz']},...protectedTask?{composition:{mode:'graph'}}:{}};
 const serviceCalls=[],mutations=[],observed=[];
 const resources={
  owns:()=>false,tools:()=>[],
  resolveService:async(_scope,id)=>({sourceId:id==='ssh:target-b'?'source-b':'source-a',environmentIds:['env'],clusterIds:['cluster']}),
  serviceRequest:async(_scope,request)=>{
   request.checkCurrent();serviceCalls.push(request);
   const {id,params}=request.data;
   const result={id:params.arguments.run_id||'new-draft',project_id:'project-a',status:'running'};
   if(params.name.startsWith('prepare'))result.status='draft';
   if(params.name.startsWith('validate'))Object.assign(result,{status:'ready',validation:{status:'passed',paths:['/unrelated']}});
   if(params.name.startsWith('submit'))Object.assign(result,{status:'queued',job_id:'90017'});
   if(params.name.startsWith('cancel'))Object.assign(result,{cancel_requested:true,cancellation:{status:'requested'}});
   return {status:200,data:{id,result:{isError:false,content:[{type:'text',text:JSON.stringify(result)}]}}};
  }
 };
 const original={id:'schedule-b',kind:'poll',sourceId:'source-b',revision:3,scope:owner,key:'poll',delegationId:delegation};
 const schedules={snapshot:()=>({sources:[{id:'source-b',schedules:[original,{...original,id:'other-owner',scope:{...owner,threadId:'thread-foreign'}}]}]}),upsert:async(value,options)=>{options.assertCurrent();mutations.push(value);return value;}};
 const assertWorkflow=value=>{if(value!==scope||!current)throw Error('workflow changed');return task;};
 const tools=createManagedComputeTools({resources,schedules,assertWorkflow,assertScheduleIntent:()=>delegation,assertRunIntent:runIntent,
  assertRunSource:({runId,sourceId})=>runId==='run-b'&&sourceId==='source-b'?'cluster-run':null,
  onRunObserved:entry=>observed.push(entry)});
 return {tools,scope,serviceCalls,mutations,observed,resources,schedules,assertWorkflow,revoke:()=>{current=false;},delegate:value=>{delegation=value;}};
}

test('explicit service run observations preserve both task authority and original target',async()=>{
 const f=fixture();
 const result=await f.tools.call('read_compute_run_status',{resource_id:'ssh:target-b',run_id:'run-b'},f.scope);
 assert.deepEqual(result,{id:'run-b',kind:'cluster-run',status:'running',job_id:null});
 assert.equal(f.serviceCalls[0].target,'/mcp');
 assert.equal(f.serviceCalls[0].data.params.name,'cluster_run_status');
 await assert.rejects(f.tools.call('read_compute_run_status',{resource_id:'ssh:target-a',run_id:'run-b'},f.scope),/original service/);
 await assert.rejects(f.tools.call('read_compute_run_status',{resource_id:'ssh:target-b',run_id:'run-foreign'},f.scope),/original service/);
 await assert.rejects(f.tools.call('read_compute_run_status',{resource_id:'ssh:target-b',run_id:'run-b',project_id:'forged'},f.scope),/Invalid/);
 assert.equal(f.serviceCalls.length,1);
});

test('explicit verified target prepares a draft with app-owned project and namespaced idempotency',async()=>{
 const f=fixture(),request={resource_id:'ssh:target-b',kind:'cluster-run',spec:{engine:'gpumd.sampling',cluster_id:'cluster',max_seconds:600,idempotency_key:'request-1',inputs:{'model.xyz':'model.xyz'},resources:{queue:'fixture',cpus:1,gpus:0,memory_mb:256}}};
 assert.deepEqual(await f.tools.call('prepare_compute_run',request,f.scope),{id:'new-draft',kind:'cluster-run',status:'draft'});
 const call=f.serviceCalls[0].data.params;
 assert.equal(call.name,'prepare_cluster_run');assert.equal(call.arguments.spec.project_id,'project-a');assert.match(call.arguments.spec.idempotency_key,/^[a-f0-9]{64}$/);
 assert.deepEqual(f.observed.map(({sourceId,runId,kind})=>[sourceId,runId,kind]),[['source-b','new-draft','cluster-run']]);
 await assert.rejects(f.tools.call('prepare_compute_run',{...request,spec:{...request.spec,inputs:{'model.xyz':'unselected.xyz'}}},f.scope),/this exact workflow/);
 await assert.rejects(f.tools.call('prepare_compute_run',{...request,spec:{...request.spec,cluster_id:'foreign'}},f.scope),/authorized environment or cluster/);
 assert.equal(f.serviceCalls.length,1);
});

test('schedule list and exact edit keep scope and the original human delegation identity',async()=>{
 const f=fixture(),target={resource_id:'ssh:target-b'};
 const listed=await f.tools.call('list_task_schedules',target,f.scope);
 assert.deepEqual(listed.schedules.map(row=>row.id),['schedule-b']);
 f.delegate('new-edit-turn');
 const edit={...target,kind:'poll',schedule_id:'schedule-b',expected_revision:3,mutation_id:'edit-1',interval_seconds:60};
 const result=await f.tools.call('attach_task_schedule',edit,f.scope);
 assert.equal(result.delegationId,'original-delegation');assert.equal(result.scope.runId,'run-b');
 await assert.rejects(f.tools.call('attach_task_schedule',{...edit,schedule_id:'other-owner'},f.scope),/exact ID and revision/);
 assert.equal(f.mutations.length,1);
});

test('a workflow revoked during service approval cannot dispatch',async()=>{
 const f=fixture(),tools=createManagedComputeTools({resources:f.resources,schedules:f.schedules,assertWorkflow:f.assertWorkflow,authorizeTask:async()=>f.revoke()});
 await assert.rejects(tools.call('inspect_compute_service',{resource_id:'ssh:target-b'},f.scope),/changed/);
 assert.equal(f.serviceCalls.length,0);
});

test('validate, submit and cancel dispatch the original authorized worker operation and retain the exact safe receipt',async()=>{
 const seen=[],f=fixture({runIntent:(scope,action,args)=>seen.push([scope.threadId,action,args.run_id])});
 const args={resource_id:'ssh:target-b',run_id:'run-b'};
 const v=await f.tools.call('validate_compute_run',args,f.scope);assert.deepEqual(v.validation,{status:'passed'});assert.equal(v.status,'ready');
 const s=await f.tools.call('submit_compute_run',args,f.scope);assert.equal(s.status,'queued');assert.equal(s.job_id,'90017');
 const c=await f.tools.call('cancel_compute_run',args,f.scope);assert.equal(c.status,'running');assert.deepEqual(c.cancellation,{status:'requested'});assert.equal(c.cancel_requested,true);
 assert.deepEqual(f.serviceCalls.map(x=>x.data.params),['validate','submit','cancel'].map(action=>({name:action+'_cluster_run',arguments:{run_id:'run-b'}})));
 assert.deepEqual(f.observed.map(entry=>[entry.runId,entry.operation,entry.observation.status]),[['run-b','validate','ready'],['run-b','submit','queued'],['run-b','cancel','running']]);
 assert(seen.every(([id,,run])=>id==='thread-a'&&run==='run-b'));
});

test('managed execution rejects missing human intent, wrong sources and runs with a separate graph review path',async()=>{
 const noIntent=fixture(),protectedValue=fixture({runIntent:()=>true,protectedTask:true});
 const exact={resource_id:'ssh:target-b',run_id:'run-b'};
 await assert.rejects(noIntent.tools.call('submit_compute_run',exact,noIntent.scope),/human run intent/);
 await assert.rejects(protectedValue.tools.call('validate_compute_run',exact,protectedValue.scope),/reviewed workflow/);
 await assert.rejects(protectedValue.tools.call('submit_compute_run',exact,protectedValue.scope),/reviewed workflow/);
 await assert.rejects(protectedValue.tools.call('cancel_compute_run',{...exact,resource_id:'ssh:target-a'},protectedValue.scope),/original service/);
 assert.equal(noIntent.serviceCalls.length,0);assert.equal(protectedValue.serviceCalls.length,0);
});
