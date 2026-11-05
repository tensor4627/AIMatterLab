import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {registerWorkspaceTaskRoutes} from "../../backend/main/workspace/routes.mjs";
import {TaskRecords} from "../../agent/sessions/task-records.mjs";
import {snapshotIdentity} from "../../contracts/compute/deployment.mjs";


function mainRoutes({records,catalog,worker,workflowContext={current:()=>({})},agents={},dialog={showOpenDialog:async()=>({canceled:true})}}){
  const handlers=new Map(),source=fs.readFileSync(new URL("../../desktop/main.mjs",import.meta.url),'utf8');
  const parsed=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const declarations=parsed.statements.filter(node=>ts.isFunctionDeclaration(node)&&['trusted','handle'].includes(node.name?.text)).map(node=>node.getText(parsed));
  const registrations=[];
  function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(parsed)==='registerWorkspaceTaskRoutes')registrations.push(node.getText(parsed));ts.forEachChild(node,visit);}
  visit(parsed);assert.equal(declarations.length,2);assert.equal(registrations.length,1);
  const nativeWindow=id=>({isDestroyed:()=>false,webContents:{id,isDestroyed:()=>false,getURL:()=> 'file:///studio/index.html'}});
  const context={
    registerWorkspaceTaskRoutes,taskRecords:records,catalog,worker,workflowContext,agents,dialog,
    ipcMain:{handle:(name,handler)=>{assert(!handlers.has(name),'Duplicate route '+name);handlers.set(name,handler);}},
    window:nativeWindow(7),shuttingDown:false,settings:{distribution:'Global',workerRoot:'/global',workerPort:9999},
    localReview:undefined,assertIdleAgent:()=>{},emit:()=>{},
  };
  // Execute the production composition call, including its live dependency closures.
  vm.runInNewContext(declarations.join('\n')+'\n'+registrations[0],context);
  return {context,handlers,nativeWindow,bridge:{shutdown:()=>{context.shuttingDown=true;}},invoke:(name,value,changed={})=>{
    const event={sender:{id:context.window.webContents.id,isDestroyed:()=>false},senderFrame:{parent:null,url:context.window.webContents.getURL()}};
    return handlers.get('studio:'+name)({...event,...changed},value);
  }};
}

function fixture({workspaceIdentity={distribution:'Original',root:'/original'},taskVersion=2}={}){
  const calls=[],saved=[],identity={distribution:'Original',root:'/original'};
  const records={
    create:value=>({id:'flow',workflowVersion:taskVersion,projectId:value.projectId}),
    save:value=>{saved.push(structuredClone(value));return value;},
    read:id=>({id,name:'Existing workflow'}),edit:value=>{calls.push(['edit',value]);return value;},
    linkRun:(taskId,run,expected)=>{calls.push(['link',taskId,run,expected]);return {taskId,run};},
  };
  const catalog={list:kind=>kind==='workspace-index'?[{id:'project',root:'/inputs',workerBinding:workspaceIdentity}]:[{id:'existing'}],put:()=>{throw Error('Unexpected catalog write');}};
  const worker={identity,request:async(method,target,data)=>{calls.push(['request',method,target,data]);return {id:data.run_id,status:'unknown'};}};
  return {calls,saved,...mainRoutes({records,catalog,worker})};
}

function workflowFixture(){
  const data=new Map(),calls=[],events=[];
  const catalog={get:(kind,id)=>structuredClone(data.get(kind+':'+id)),put:(kind,id,value)=>{data.set(kind+':'+id,structuredClone(value));return value;},list:kind=>[...data.entries()].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>structuredClone(value))};
  const records=new TaskRecords(catalog,event=>events.push(event));
  const task=records.create({provider:'codex',threadId:'thread',planningMode:true,workflowVersion:2,request:'Synthetic route fixture'});
  const binding={distribution:'Original',root:'/original',port:8888};
  task.workspaceChoice='workspace';task.workspace={id:'workspace',root:'/original/inputs',workerBinding:binding,assets:[]};task.parameters={engine:'pygas.build',files:[]};records.save(task);
  const worker={connection:{health:{root:binding.root}},identity:{distribution:binding.distribution,root:binding.root},connectionTarget:{port:binding.port},connectionEpoch:1,request:async(method,target,value)=>{calls.push({method,target,value});throw Error('Unexpected worker request '+target);}};
  const owner={serial:1,provider:task.provider,threadId:task.threadId,taskId:task.id};
  const workflowContext={current:()=>owner,revision:()=>owner.serial,begin:()=>owner,assert:()=>{},synchronize:async(_ticket,select)=>select(task.provider,{})};
  const harness=mainRoutes({records,catalog,worker,workflowContext,agents:{active:'codex',selectContext:async()=>{}}});
  return {...harness,records,task,worker,calls,events};
}

test('registered workspace/task operations keep the actual main sender and shutdown boundary',async()=>{
  const f=fixture();assert.equal(f.handlers.size,23);
  for(const changed of [
    {sender:{id:8,isDestroyed:()=>false}},
    {senderFrame:{parent:{},url:'file:///studio/index.html'}},
    {senderFrame:{parent:null,url:'https://foreign.invalid/'}},
  ])await assert.rejects(f.invoke('task.create',{projectId:'project'},changed),/Untrusted IPC sender/);
  assert.equal(f.saved.length,0);
  assert.equal(await f.invoke('task.create',{projectId:'project'},{sender:{id:7,isDestroyed:()=>true}}),null);
  f.bridge.shutdown();assert.equal(await f.invoke('task.create',{projectId:'project'}),null);
  assert.equal(f.saved.length,0);
});

test('task creation binds only a workspace registered for the actual original worker',async()=>{
  const same=fixture(),task=await same.invoke('task.create',{projectId:'project'});
  assert.equal(task.workspaceChoice,'workspace');assert.equal(task.workspace.root,'/inputs');assert.equal(same.saved.length,1);
  const other=fixture({workspaceIdentity:{distribution:'Other',root:'/other'}}),pending=await other.invoke('task.create',{projectId:'project'});
  assert.equal(pending.workspaceChoice,'pending');assert(!pending.workspace);
  const legacy=fixture({taskVersion:1});assert.equal((await legacy.invoke('task.create',{projectId:'project'})).workflowVersion,1);assert.equal(legacy.saved.length,0);
});

test('list/read/edit retain existing record behavior without dispatching worker or creating a run',async()=>{
  const f=fixture(),request={id:'flow',changes:{temperature:300}};
  assert.deepEqual(await f.invoke('task.list',{}),[{id:'existing'}]);
  assert.deepEqual(await f.invoke('task.read',{id:'flow'}),{id:'flow',name:'Existing workflow'});
  assert.equal(await f.invoke('task.edit',request),request);
  assert.deepEqual(f.calls,[['edit',request]]);assert.equal(f.saved.length,0);
});

test('run linking reads the selected run kind and forwards its actual unknown state and prepared identity',async()=>{
  for(const [kind,target]of [['run','/api/run/status'],['cluster-run','/api/cluster/status']]){
    const f=fixture(),expected={artifactId:'original',parameterRevision:3};
    const value=await f.invoke('task.linkRun',{taskId:'flow',runId:'original',kind,expectedPrepared:expected});
    assert.equal(value.run.status,'unknown');
    assert.deepEqual(f.calls,[['request','POST',target,{run_id:'original'}],['link','flow',{id:'original',status:'unknown'},expected]]);
    assert.equal(f.saved.length,0);
  }
  const f=fixture();await assert.rejects(f.invoke('task.linkRun',{taskId:'flow',runId:'original',kind:'invalid'}),/Invalid run reference/);assert.deepEqual(f.calls,[]);
});

const deploymentConfig={target:'local',projectId:'compute',targetId:'env',inputSource:'local',directoryName:'route-fixture',maxSeconds:30,gpu:0,resources:{cpus:1,gpus:0,memory_mb:128,queue:'',account:''}};

test('actual main registration reads the latest review authority for save, prepare and execute',async()=>{
  const f=workflowFixture(),seen=[];
  f.context.localReview={authority:(_task,target)=>{seen.push(['initial',target]);return {};}};
  await f.invoke('task.deployment.save',{taskId:f.task.id,value:deploymentConfig});
  f.context.localReview={authority:(_task,target)=>{seen.push(['replacement',target]);return null;}};
  const before=f.records.read(f.task.id);
  await assert.rejects(f.invoke('task.deployment.save',{taskId:f.task.id,value:deploymentConfig}),/复核/);
  await assert.rejects(f.invoke('task.deployment.prepare',{taskId:f.task.id}),/复核/);
  await assert.rejects(f.invoke('task.execute',{taskId:f.task.id,artifactId:'unprepared'}),/Review/);
  assert.deepEqual(seen,[['initial','local'],['replacement','local'],['replacement','local'],['replacement','local']]);
  assert.deepEqual(f.records.read(f.task.id),before);assert.deepEqual(f.calls,[]);
});

test('actual main deployment registration reads current settings while retaining the original source and late-change guard',async()=>{
  const f=workflowFixture(),restored=[],emitted=[];
  f.context.settings={distribution:'New global',workerRoot:'/new-global',workerPort:9998,runtimeMarker:'current-settings'};
  f.context.emit=(...args)=>emitted.push(args);
  f.worker.restore=async(target,{current})=>{
    assert.equal(current(),true);restored.push(target);
    f.context.settings={...f.context.settings,workerPort:9997};
    assert.equal(current(),false);
    return {status:'connected'};
  };
  const result=await f.invoke('task.deployment.open',{taskId:f.task.id});
  assert.equal(result.task.id,f.task.id);assert.equal(restored.length,1);
  assert.deepEqual({distribution:restored[0].distribution,root:restored[0].workerRoot,port:restored[0].workerPort,marker:restored[0].runtimeMarker},{distribution:'Original',root:'/original',port:8888,marker:'current-settings'});
  assert.deepEqual(emitted,[]);assert.deepEqual(f.calls,[]);
});

test('actual main native picker and sender guard use a replacement window after registration',async()=>{
  const f=workflowFixture(),picked=[];
  f.context.dialog.showOpenDialog=async(window,options)=>{picked.push({window,properties:[...options.properties]});return {canceled:true};};
  const replacement=f.nativeWindow(9);f.context.window=replacement;
  const request={taskId:f.task.id,mode:'copy',role:'input',source:''};
  await assert.rejects(f.invoke('workspace.import',request,{sender:{id:7,isDestroyed:()=>false}}),/Untrusted IPC sender/);
  const before=f.records.read(f.task.id),result=await f.invoke('workspace.import',request);
  assert.equal(result.id,f.task.id);assert.deepEqual(picked,[{window:replacement,properties:['openFile']}]);
  assert.deepEqual(f.records.read(f.task.id),before);assert.deepEqual(f.calls,[]);
});

test('actual workspace handler joins identical in-flight imports, rejects conflicting work and releases its operation slot',async()=>{
  const f=workflowFixture();let entered,release;
  const reached=new Promise(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{release=resolve;});
  f.worker.request=async(method,target,value)=>{
    f.calls.push({method,target,value});assert.equal(method,'POST');assert.equal(target,'/api/studio-workspace/import');
    if(f.calls.length===1){entered();await pending;}
    return {id:'asset',path:'/original/inputs/input.in',name:'input.in',role:'input'};
  };
  const request={taskId:f.task.id,mode:'copy',role:'input',source:'/selected/input.in'},one=f.invoke('workspace.import',request);
  await reached;
  const same=f.invoke('workspace.import',{...request});
  await assert.rejects(f.invoke('workspace.import',{...request,role:'structure'}),/已有操作/);
  assert.equal(f.calls.length,1);assert.deepEqual(f.records.read(f.task.id).workspace.assets,[]);
  release();assert.deepEqual(await one,await same);assert.equal(f.calls.length,1);
  assert.deepEqual(f.records.read(f.task.id).workspace.assets.map(asset=>asset.id),['asset']);
  await f.invoke('workspace.import',{...request});assert.equal(f.calls.length,2);
});

test('actual execute handler keeps unknown runs read-only and rejects stale input receipts before worker access',async()=>{
  const f=workflowFixture(),run={id:'original',kind:'cluster-run',project_id:'compute',engine:'pygas.build',status:'unknown',snapshots:[{name:'input.in',sha256:'a'.repeat(64),size:12}]};
  const task=f.records.read(f.task.id);task.projectId='compute';
  task.artifacts=[{id:run.id,kind:run.kind,engine:run.engine,preparedRevision:task.parameterRevision}];
  task.review={status:'ready',parameterRevision:task.parameterRevision,artifactIds:[run.id]};
  task.deployment={revision:2,workerBinding:{...f.worker.identity,port:8888},config:{...deploymentConfig,target:'cluster',targetId:'cluster'},prepared:{artifactId:run.id,parameterRevision:task.parameterRevision,deploymentRevision:2}};
  task.deployment.prepared.inputIdentity=snapshotIdentity(task,run);
  task.execution={artifactId:run.id,phase:'unknown',status:'unknown'};f.records.save(task);
  f.worker.request=async(method,target,value)=>{f.calls.push({method,target,value});assert.equal(method,'POST');assert.equal(target,'/api/cluster/status');assert.deepEqual(value,{run_id:run.id});return structuredClone(run);};
  const request={taskId:task.id,artifactId:run.id,inputReceipt:task.deployment.prepared.inputIdentity};
  assert.equal((await f.invoke('task.execute',request)).status,'unknown');
  assert.equal(f.records.read(task.id).execution.phase,'unknown');assert.equal(f.calls.length,1);
  run.status='ready';const before=f.records.read(task.id);
  await assert.rejects(f.invoke('task.execute',request),/never resubmit unknown/);
  assert.deepEqual(f.records.read(task.id),before);assert.equal(f.calls.length,2);
  await assert.rejects(f.invoke('task.execute',{...request,inputReceipt:'stale'}),/actual input snapshots/);
  assert.deepEqual(f.records.read(task.id),before);assert.equal(f.calls.length,2);
});
