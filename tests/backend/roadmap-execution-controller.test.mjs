import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRoadmapController} from '../../backend/main/workspace/roadmap-execution.mjs';
import {assertRendererWorkerRoute,assertWorkerRoute} from '../../contracts/transport-policy.mjs';

function fixture(){
 const hash='a'.repeat(64),workerBinding={distribution:'Fixture',root:'/worker',port:8999};
 const health={root:'/worker',name:'gpu-sampling-studio',roadmap_execution_schema:1};
 const owner={provider:'codex',threadId:'thread',taskId:'task',serial:1};
 const task={id:'task',provider:'codex',threadId:'thread',workflowVersion:2,workspaceChoice:'draft',
  request:'Deliver the original trajectory',name:'Workflow',parameterRevision:2,parameters:{files:['D:/input/run.in']},
  roadmap:{resources:[{id:'control',field:'files'}],steps:[{id:'md'}]},deployment:{workerBinding,revision:3,
   config:{target:'local',projectId:'project',targetId:'env',gpu:1,maxSeconds:120}}};
 const state={id:createHash('sha256').update(JSON.stringify([task.id,hash])).digest('hex'),task_id:task.id,snapshot_sha256:hash,confirmed_at:1,status:'running',goals:[]};
 const worker={identity:{distribution:'Fixture',root:'/worker'},connectionTarget:{port:8999},connectionEpoch:1,connection:{health}};
 const calls=[],index=new Map(),hooks={confirm:()=>true,states:()=>[state],preview:()=>hash};
 worker.request=async(method,route,body)=>{
  calls.push({method,route,body:structuredClone(body)});
  if(route==='/api/health')return health;
  if(route.endsWith('/preview')||route.endsWith('/snapshot'))return {snapshot_sha256:hooks.preview(),snapshot:{task_id:task.id}};
  if(route.endsWith('/list'))return hooks.states();
  if(route.endsWith('/confirm'))return structuredClone(state);
  assert.fail(route);
 };
 const controller=createRoadmapController({worker,current:()=>owner,getTask:id=>id===task.id?task:null,
  getSettings:()=>({distribution:'Fixture',workerRoot:'/worker',workerPort:8999}),assertIdle:()=>{},
  catalog:{put:(_kind,id,data)=>index.set(id,data)},confirm:(...args)=>hooks.confirm(...args)});
 const request={taskId:'task',environments:{md:'per-node'}};
 return {controller,worker,owner,task,request,approval:{...request,snapshotSha256:hash},state,hooks,calls,index};
}

test('one native confirmation binds original intent, current files, revision, scoped override and a receipt',async()=>{
 const f=fixture();const review=await f.controller.preview(f.request);
 const post=f.calls.at(-1);assert.equal(post.body.original_request,f.task.request);
 assert.deepEqual(post.body.parameters.files,['/mnt/d/input/run.in']);assert.deepEqual(post.body.node_environments,{md:'per-node'});
 assert.deepEqual(post.body.revision,{parameters:2,deployment:3});assert.deepEqual(post.body.target,{project_id:'project',environment_id:'env',gpu:1,max_seconds:120});
 const event={};let confirmed=0;f.hooks.confirm=(snapshot,sender)=>{assert.equal(sender,event);assert.deepEqual(snapshot,review);confirmed++;return true;};
 assert.deepEqual(await f.controller.confirm(f.approval,event),f.state);assert.equal(confirmed,1);
 assert.equal(f.index.get(f.state.id).observation.status,'running');
 assert.deepEqual(f.calls.at(-1).body,{plan:post.body,snapshot_sha256:review.snapshot_sha256});
});
for(const [label,change] of Object.entries({
 'parameter edit':f=>{f.task.parameters.files=['/input/new'];},'draft revision':f=>f.task.parameterRevision++,
 'registration change':f=>f.task.deployment.config.targetId='different','conversation switch':f=>f.owner.threadId='elsewhere',
 'worker restart':f=>f.worker.connectionEpoch++,'replacement of original worker':f=>f.worker.identity.root='/elsewhere',
 'workspace replacement':f=>{f.task.workspace={id:'new',root:'/other'};},'changed original request':f=>f.task.request='another request'
}))test('a '+label+' while the native dialog is open prevents execution',async()=>{
 const f=fixture();f.hooks.confirm=()=>{change(f);return true;};
 await assert.rejects(f.controller.confirm(f.approval,{}));assert(!f.calls.some(c=>c.route.endsWith('/confirm')));assert.equal(f.index.size,0);
});
test('cancel, a different worker review and an invalid per-invocation selection cannot release work',async()=>{
 const f=fixture();f.hooks.confirm=()=>false;assert.equal(await f.controller.confirm(f.approval,{}),null);
 f.hooks.preview=()=>'b'.repeat(64);f.hooks.confirm=()=>assert.fail('stale confirmation');
 await assert.rejects(f.controller.confirm(f.approval,{}));await assert.rejects(f.controller.preview({...f.request,environments:{other:'env'}}));
 assert(!f.calls.some(c=>c.route.endsWith('/confirm')));assert.equal(f.index.size,0);
});
test('readback is scoped to the owner and the renderer has no generic graph authority',async()=>{
 const f=fixture();f.hooks.states=()=>[{...f.state,task_id:'other'}];
 await assert.rejects(f.controller.list({taskId:'task'}));assert.equal(f.index.size,0);
 assert.equal((await f.controller.snapshot({taskId:'task',executionId:f.state.id})).snapshot_sha256,f.state.snapshot_sha256);
 await assert.rejects(f.controller.snapshot({taskId:'task',executionId:'b'.repeat(64)}));
 for(const action of ['preview','confirm','status','list','snapshot']){
  const route='/api/workflow/roadmap/'+action;assertWorkerRoute('POST',route);
  assert.throws(()=>assertRendererWorkerRoute('POST',route));
 }
 await assert.rejects(f.controller.confirm({...f.approval,command:['python']},{}));
});
