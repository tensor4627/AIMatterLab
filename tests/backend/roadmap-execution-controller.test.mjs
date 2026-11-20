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
 const calls=[],index=new Map(),hooks={confirm:()=>true,states:()=>[state],preview:()=>hash,sources:()=>[]};
 worker.request=async(method,route,body)=>{
  calls.push({method,route,body:structuredClone(body)});
  if(route==='/api/health')return worker.connection.health;
  if(route.endsWith('/preview')||route.endsWith('/snapshot'))return {snapshot_sha256:hooks.preview(),snapshot:{task_id:task.id}};
  if(route.endsWith('/list'))return hooks.states();
  if(route.endsWith('/confirm'))return structuredClone(state);
  assert.fail(route);
 };
 const controller=createRoadmapController({worker,current:()=>owner,getTask:id=>id===task.id?task:null,
  getSettings:()=>({distribution:'Fixture',workerRoot:'/worker',workerPort:8999}),assertIdle:()=>{},
  catalog:{get:(_kind,id)=>index.get(id),put:(_kind,id,data)=>index.set(id,structuredClone(data))},
  sources:()=>hooks.sources(),allocateWorkspace:async()=>({workspace_id:'workspace'}),confirm:(...args)=>hooks.confirm(...args)});
 const request={taskId:'task',environments:{md:'per-node'}};
 return {controller,worker,owner,task,request,approval:{...request,snapshotSha256:hash},state,hooks,calls,index};
}

function sshFixture(){
 const f=fixture(),hostIdentity={hostname:'fixture',uid:1001,machineId:'fixture-machine'};
 const original={kind:'ssh',version:2,profileId:'saved-profile',profileVersion:3,root:'/worker',hostIdentity,runtime:'/worker/runtimes/previous',runtimeId:'previous'};
 const upgraded={...original,runtime:'/worker/runtimes/updated',runtimeId:'updated'};
 const health=binding=>({name:'gpu-sampling-studio',ssh_service:true,roadmap_execution_schema:1,execution_policy:'desktop-review-v1',
  ...Object.fromEntries(['root','hostIdentity','runtime','runtimeId'].map(key=>[key,binding[key]]))});
 const connect=binding=>{
  const identity={...structuredClone(binding),version:3,connectionId:'authenticated-master'};
  Object.assign(f.worker,{identity,connectionTarget:{...identity,port:8999},connection:{transport:'ssh-connection',health:health(binding)},connectionEpoch:f.worker.connectionEpoch+1});
 };
 f.task.deployment.workerBinding=structuredClone(original);
 f.task.deployment.config={...f.task.deployment.config,target:'cluster',resources:{},targetId:'slurm'};
 connect(original);
 return {...f,original,upgraded,connect,health};
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

test('updating the foreground SSH runtime preserves confirmed graph and snapshot observation in its original chat',async()=>{
 const f=sshFixture(),ref={taskId:'task',executionId:f.state.id};
 await f.controller.confirm(f.approval,{});
 const stored=f.index.get(f.state.id);
 f.connect(f.upgraded);f.calls.length=0;f.state.status='passed';
 assert.deepEqual(await f.controller.list({taskId:'task'}),[f.state]);
 assert.equal((await f.controller.snapshot(ref)).snapshot_sha256,f.state.snapshot_sha256);
 assert.deepEqual(f.index.get(f.state.id),{...stored,observation:{...stored.observation,status:'passed',observed_at:f.index.get(f.state.id).observation.observed_at}});
 assert.deepEqual(f.task.deployment.workerBinding,f.original);
 await assert.rejects(f.controller.preview(f.request),/来源不同/);
 await assert.rejects(f.controller.confirm(f.approval,{}),/来源不同/);
 assert.deepEqual(f.calls.map(({route})=>route),['/api/health','/api/workflow/roadmap/list','/api/health','/api/workflow/roadmap/snapshot']);
});

test('a hosted replacement observes only the original SSH storage, even without a foreground connection',async()=>{
 const f=sshFixture(),ref={taskId:'task',executionId:f.state.id};
 await f.controller.confirm(f.approval,{});
 f.worker.connection=null;f.calls.length=0;
 const calls=[],source={kind:'ssh',binding:f.upgraded,health:f.health(f.upgraded),async request(method,route,body,{beforeDispatch}){
  beforeDispatch(this.health);calls.push({method,route,body});
  return route.endsWith('/list')?[f.state]:{snapshot_sha256:f.state.snapshot_sha256,snapshot:{task_id:f.task.id}};
 }};
 f.hooks.sources=()=>[{...source,binding:{...f.upgraded,profileVersion:f.upgraded.profileVersion+1},request:()=>assert.fail('changed saved profile')},source];
 assert.deepEqual(await f.controller.list({taskId:'task'}),[f.state]);
 assert.equal((await f.controller.snapshot(ref)).snapshot_sha256,f.state.snapshot_sha256);
 assert.deepEqual(f.index.get(f.state.id).worker_binding,f.original);
 assert.equal(f.index.get(f.state.id).confirmed_at,1);
 assert.deepEqual(calls,[{method:'POST',route:'/api/workflow/roadmap/list',body:{task_id:'task'}},
  {method:'POST',route:'/api/workflow/roadmap/snapshot',body:{task_id:'task',execution_id:f.state.id}}]);
 assert.deepEqual(f.calls,[]);
 f.hooks.sources=()=>[{...source,health:{...source.health,hostIdentity:{...source.health.hostIdentity,uid:9}}}];
 await assert.rejects(f.controller.list({taskId:'task'}),/来源尚未核对/);
 assert.equal(calls.length,2);
});

test('original graph readback checks original profile, host, UID and data root separately',async()=>{
 const f=sshFixture();
 const changes=[{profileId:'other-profile'},{profileVersion:4},{root:'/other'},
  ...Object.entries({hostname:'other',uid:1002,machineId:'other-machine'}).map(([key,value])=>({hostIdentity:{...f.original.hostIdentity,[key]:value}}))];
 for(const change of changes){
  f.connect({...f.upgraded,...change});
  await assert.rejects(f.controller.list({taskId:'task'}),/来源不同/);
  await assert.rejects(f.controller.snapshot({taskId:'task',executionId:f.state.id}),/来源不同/);
 }
 assert.deepEqual(f.calls,[]);
 assert.equal(f.index.size,0);
});

test('a selection change before hosted dispatch or during readback prevents the old response from reaching another chat',async()=>{
 const f=sshFixture(),health=f.health(f.upgraded);f.worker.connection=null;
 let dispatched=0,changeStage='before';
 f.hooks.sources=()=>[{kind:'ssh',binding:f.upgraded,health,async request(method,route,body,{beforeDispatch}){
  if(changeStage==='before')f.owner.serial++;
  beforeDispatch(health);dispatched++;
  if(changeStage==='after')f.owner.serial++;
  return [f.state];
 }}];
 await assert.rejects(f.controller.list({taskId:'task'}),/会话或作业服务来源已变化/);assert.equal(dispatched,0);
 changeStage='after';
 await assert.rejects(f.controller.list({taskId:'task'}),/会话或作业服务来源已变化/);assert.equal(dispatched,1);
 assert.equal(f.index.size,0);
});
