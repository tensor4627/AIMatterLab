import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProjectSkills} from '../../agent/skills/project-skills.mjs';
import {createManagedComputeAliases,resourceFingerprint} from '../../backend/main/compute/managed-compute-aliases.mjs';
import {createManagedComputeResources} from '../../backend/main/compute/managed-compute-resources.mjs';
import {createManagedComputeServices,managedWorkerProject} from '../../backend/main/compute/managed-compute-services.mjs';
import {taskForRecordIndex} from '../../backend/main/compute/worker-service-version.mjs';
import {assertRendererWorkerRoute} from '../../contracts/transport-policy.mjs';

const profile=(id,name)=>({id,kind:'ssh',version:1,name,host:'private-'+id+'.invalid',username:'private-user',port:22,
 ssh_client:'/usr/bin/ssh',distribution:'Private WSL',mode:'interactive',identity_file:'/secret/key',proxy_jump:[],via:[]});
const verified=(connectionId,profile)=>({connectionId,profileId:profile.id,profileVersion:profile.version,status:'authenticated',authentication:'verified',capabilities:{multiplex:true}});
const fixtureScope=(provider,threadId,projectId='project')=>({provider,threadId,projectId,taskId:'task-'+threadId,checkCurrent:()=>true});

test('an unreadable project catalog is distinct from an observed absence of authority',async()=>{
 const check=response=>managedWorkerProject({projectId:'p'},{kind:'wsl'},{forward:async()=>response},()=>{});
 assert.equal(await check({status:403}),null);
 assert.equal(await check({status:200,data:[]}),null);
 for(const response of [{status:500},{status:200,data:{}}]){
  await assert.rejects(check(response),/managed_compute_worker_request_failed/);
 }
});
function deferred(){let resolve;const promise=new Promise(ack=>resolve=ack);return {promise,resolve};}

function fixture(t,options={}){
 const stored=new Map([['A',profile('A','材料中心')],['B',profile('B','图形中心')]]),states=new Map(),shells=new Map(),calls=[],acquisitions=[];
 for(const item of stored.values())states.set('conn-'+item.id,verified('conn-'+item.id,item));
 const profiles={read:({id})=>structuredClone(stored.get(id))};
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'managed-aliases-'));
 const owner=fixtureScope('codex','chat');
 const projectSkills=new ProjectSkills({root:directory,current:()=>owner});
 const aliases=createManagedComputeAliases({projectSkills});
 let now=30000,serial=0,openGate;
 const connections={state:async({connectionId})=>structuredClone(states.get(connectionId)),async managedShell(op,ref){
  calls.push({op,ref});
  if(op==='open'){
   const result={sessionId:'pty-'+(++serial),ownerEpoch:2,alive:true,expiresAt:now+3600000};
   shells.set(ref.leaseId,result);
   if(openGate){const gate=openGate;openGate=null;await gate.promise;}
   return result;
  }
  if(op==='close'){shells.delete(ref.leaseId);return {closed:true};}
  const value=shells.get(ref.leaseId);
  if(!value)throw Error('terminal_session_exited');
  if(op==='state')return value;
  if(op==='input')return {accepted:true,requestId:ref.requestId};
  return {output:value.sessionId,cursor:0,dropped:false};
 }};
 const make=(more={})=>createManagedComputeResources({terminal:{connections},profiles,aliases,authorizeTerminal:scope=>scope.projectId==='project',
  onAcquired:(scope,resource)=>acquisitions.push([scope.threadId,resource.resourceId]),now:()=>now,...options,...more});
 const manager=make();
 const publish=async(id,connectionId='conn-'+id,target=manager)=>{
  const current=states.get(connectionId);
  return target.publish({connectionId,profileId:id,profileVersion:current.profileVersion});
 };
 function turn(scope,text,turnId='turn-'+(++serial),target=manager){target.recordUserTurn({...scope,text,turnId});}
 t.after(async()=>{await manager.stop();fs.rmSync(directory,{recursive:true,force:true});});
 return {manager,make,owner,stored,states,profiles,connections,projectSkills,aliases,calls,shells,acquisitions,publish,turn,
  pauseOpen(){openGate=deferred();return openGate;},time:value=>{now=value;}};
}

test('publication retains independent hosts and grants exactly one distinct PTY per provider, conversation and resource',async t=>{
 const f=fixture(t),{manager,owner}=f;
 f.states.get('conn-A').authentication='pending';
 await assert.rejects(f.publish('A'),/authentication_required/);
 f.states.get('conn-A').authentication='verified';
 await Promise.all([f.publish('A'),f.publish('B')]);
 const foreign=fixtureScope('codex','chat-2','other-project');
 const inventory=await manager.list(foreign);
 assert.deepEqual(inventory.resources.map(row=>[row.kind,row.canAcquire]),[['ssh',false],['ssh',false]]);
 assert.doesNotMatch(JSON.stringify(inventory),/private|conn-A|secret|targetFingerprint/);
 f.turn(foreign,'用材料中心');
 await assert.rejects(manager.acquire(foreign,{resourceId:'ssh:A'}),/project_grant_required/);
 f.turn(owner,'用材料中心和图形中心分别跑');
 const [a,b]=await Promise.all([manager.acquire(owner,{resourceId:'ssh:A'}),manager.acquire(owner,{resourceId:'ssh:B'})]);
 assert.notEqual(a.terminal.sessionId,b.terminal.sessionId);
 const other=fixtureScope('deepseek','chat');
 f.turn(other,'用材料中心');
 const otherA=await manager.acquire(other,{resourceId:'ssh:A'});
 assert.notEqual(otherA.terminal.sessionId,a.terminal.sessionId);
 await assert.rejects(manager.callTerminalTool('write_compute_terminal',{session_id:a.terminal.sessionId,request_id:'other',data:'fixture'},other),/lease_required/);
 f.turn(owner,'继续');
 assert.deepEqual((await manager.acquire(owner,{resourceId:'ssh:A'})).terminal,a.terminal);
 assert.equal(f.calls.filter(row=>row.op==='open').length,3);
 assert.deepEqual((await manager.callTerminalTool('list_compute_terminals',{},owner)).sessions.map(s=>s.resourceId),['ssh:A','ssh:B']);
 const released=await manager.release(owner,{resourceId:'ssh:A'});
 assert.equal(released.terminalClosed,true);
 assert.deepEqual((await manager.callTerminalTool('list_compute_terminals',{},owner)).sessions.map(s=>s.resourceId),['ssh:B']);
 assert.equal((await manager.callTerminalTool('list_compute_terminals',{},other)).sessions.length,1);
});

test('a user-selected alias uses the stable profile after rename and requires confirmation after the target changes',async t=>{
 const f=fixture(t),{manager,owner,aliases}=f;
 await f.publish('A');await f.publish('B');
 f.turn(owner,'用学校集群');
 const selection=await manager.acquire(owner,{alias:'学校集群'});
 assert.equal(selection.status,'choice_required');
 assert.equal(selection.candidates.length,2);
 assert.equal(aliases.read('学校集群',()=>true),null);
 await assert.rejects(manager.acquire(owner,{resourceId:'ssh:B'}),/instruction_required/);
 f.turn(owner,'材料中心');
 const chosen=await manager.acquire(owner,{alias:'学校集群'});
 assert.equal(chosen.resource.profileId,'A');
 assert.deepEqual(aliases.read('学校集群',()=>true),{alias:'学校集群',profileId:'A',targetFingerprint:resourceFingerprint(f.stored.get('A'))});
 const doc=f.projectSkills.call('read_project_skill',{scope:'user',name:'compute-resource-aliases'},owner);
 assert.doesNotMatch(doc.body,/private-|secret\/key|conn-A/);
 assert.throws(()=>f.projectSkills.call('write_project_skill',{scope:'user',name:'compute-resource-aliases',expected_sha256:doc.sha256,body:doc.body},owner),/human resource choice/);

 await manager.revokeConnection({connectionId:'conn-A'});
 const renamed={...f.stored.get('A'),version:2,name:'材料科学中心'};
 f.stored.set('A',renamed);f.states.set('conn-A2',verified('conn-A2',renamed));
 await f.publish('A','conn-A2');
 const another=fixtureScope('kimi','chat-2');
 f.turn(another,'用学校集群');
 assert.equal((await manager.acquire(another,{alias:'学校集群'})).resource.name,'材料科学中心');
 await manager.revokeConnection({connectionId:'conn-A2'});
 const moved={...renamed,version:3,host:'changed.invalid'};
 f.stored.set('A',moved);f.states.set('conn-A3',verified('conn-A3',moved));
 await f.publish('A','conn-A3');
 f.turn(another,'用学校集群');
 assert.equal((await manager.acquire(another,{alias:'学校集群'})).status,'choice_required');
 await assert.rejects(manager.acquire(another,{resourceId:'ssh:A'}),/instruction_required/);
 f.turn(another,'材料科学中心');
 assert.equal((await manager.acquire(another,{alias:'学校集群'})).resource.profileId,'A');
 assert.equal(aliases.read('学校集群',()=>true).targetFingerprint,resourceFingerprint(moved));
});

test('confirmed alias storage honors the 0.1.12 built-in skill boundary',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'managed-builtin-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const projectSkills=new ProjectSkills({root:directory,bundledRoot:directory,current:()=>null});
 const aliases=createManagedComputeAliases({projectSkills});
 assert.throws(()=>aliases.read('fixture',()=>true),/separate from the built-in/);
 assert.deepEqual(fs.readdirSync(directory),[]);
});

test('generic user choice is temporary and old clarification replies cannot authorize a fresh or unrelated turn',async t=>{
 const f=fixture(t),{manager,owner}=f;
 await f.publish('A');
 f.turn(owner,'用集群');
 assert.equal((await manager.acquire(owner,{alias:'集群'})).resource.profileId,'A');
 assert.equal(f.aliases.read('集群',()=>true),null);
 await manager.release(owner,{resourceId:'ssh:A'});
 await f.publish('B');
 f.turn(owner,'用学校集群','question');
 const pending=await manager.acquire(owner,{alias:'学校集群'});
 assert.equal(pending.status,'choice_required');
 f.turn(owner,'材料中心','first-answer');
 f.turn(owner,'这不是资源选择','latest');
 f.turn(owner,'材料中心','first-answer');
 await assert.rejects(manager.acquire(owner,{alias:'学校集群'}),/instruction_required/);
 assert.equal(f.aliases.read('学校集群',()=>true),null);
 f.turn(owner,'如何使用材料中心');
 await assert.rejects(manager.acquire(owner,{resourceId:'ssh:A'}),/instruction_required/);
});

test('release during pending acquisition fences the late shell and never releases another conversation',async t=>{
 const f=fixture(t),{manager,owner}=f;
 await f.publish('A');
 const other=fixtureScope('codex','chat-2');f.turn(other,'用材料中心');
 await manager.acquire(other,{resourceId:'ssh:A'});
 f.turn(owner,'用材料中心');
 const paused=f.pauseOpen(),pending=manager.acquire(owner,{resourceId:'ssh:A'});
 await new Promise(resolve=>setImmediate(resolve));
 const duplicate=manager.acquire(owner,{resourceId:'ssh:A'});
 await new Promise(resolve=>setImmediate(resolve));
 const rejected=Promise.allSettled([pending,duplicate]);
 assert.equal((await manager.release(owner,{resourceId:'ssh:A'})).terminalClosed,true);
 paused.resolve();
 assert.deepEqual((await rejected).map(result=>result.status),['rejected','rejected']);
 assert.equal(f.calls.filter(row=>row.op==='open').length,2);
 assert.equal((await manager.callTerminalTool('list_compute_terminals',{},other)).sessions.length,1);
 assert.equal(f.shells.size,1);
});

test('capacity and connection loss are isolated per host and idle retirement leaves authenticated resources visible',async t=>{
 const f=fixture(t),{manager}=f;
 await f.publish('A');await f.publish('B');
 const owners=Array.from({length:5},(_,index)=>fixtureScope('compatible','scope-'+index));
 for(const scope of owners)f.turn(scope,'用材料中心和图形中心');
 await Promise.all(owners.slice(0,4).map(scope=>manager.acquire(scope,{resourceId:'ssh:A'})));
 await assert.rejects(manager.acquire(owners[4],{resourceId:'ssh:A'}),/session_limit/);
 await manager.acquire(owners[4],{resourceId:'ssh:B'});
 f.states.get('conn-A').status='unavailable';f.states.get('conn-A').authentication='lost';
 await manager.sweep({idleMs:60000});
 assert.deepEqual(manager.snapshot().map(row=>row.resourceId),['ssh:B']);
 assert.equal(f.shells.size,1);
 f.time(100000);await manager.sweep({idleMs:60000});
 assert.equal(manager.snapshot()[0].terminalAvailable,4);
 assert.equal(f.shells.size,0);
});

test('private services verify exact registration, authorize the selected worker projects and preserve original run provenance',async t=>{
 const f=fixture(t),channels=new Map(),packets=[],starts=[];
 const health=id=>({name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',root:'/owned/'+id,port:21000+id.charCodeAt(0),
  runtime:'/owned/'+id+'/runtimes/'+'a'.repeat(20),runtimeId:'a'.repeat(20),hostIdentity:{hostname:'remote-'+id,uid:1001,machineId:'machine-'+id},managed_schedule_schema:1});
 const saved=id=>({...health(id),runtimeManifestSha256:'a'.repeat(64)});
 const registration={validateReuse(profile,observed){if(observed){assert.equal(observed.root,health(profile.id).root);assert.equal(observed.runtimeManifestSha256,'a'.repeat(64));}return saved(profile.id);}};
 Object.assign(f.connections,{
  serviceState:async({connectionId})=>channels.get(connectionId)??{connectionId,profileId:connectionId.at(-1),profileVersion:1,status:'idle',serviceActive:false},
  async openService(ref,data,context){
   starts.push({ref,data,context});
   channels.set(ref.connectionId,{...ref,serviceId:'service-'+ref.profileId,status:'connected',serviceActive:true,channelKind:'private',service:saved(ref.profileId)});
  },
  async privateServiceRequest(packet){
   packets.push(packet);
   const id=packet.connectionId.at(-1),actual=health(id);
   assert.equal(packet.serviceId,'service-'+id);
   const cluster={id:'scheduler-'+id,version:2,transport_kind:'ssh-service-local'};
   let data={fixture:id};
   if(packet.target==='/api/health')data=actual;
   if(packet.target==='/api/projects')data=[{id:'project',policy:{clusters:[cluster.id]}}];
   if(packet.target==='/api/clusters')data=[cluster];
   if(packet.target==='/api/cluster/profile')data={...cluster,service_binding:{...actual.hostIdentity,root:actual.root}};
   return {status:200,data};
  }
 });
 const services=createManagedComputeServices({connections:f.connections,registration,source:'fixture',transportSource:'fixture',
  prepareResources:async(_source,value)=>value});
 const manager=f.make({services,authorizeTerminal:()=>false,authorizeRun:(_scope,run)=>run.resourceId==='ssh:A'&&run.runId==='run-on-A'});
 t.after(()=>manager.stop());
 await f.publish('A','conn-A',manager);await f.publish('B','conn-B',manager);
 await Promise.all(['conn-A','conn-B'].map(connectionId=>manager.refreshService({connectionId})));
 assert.deepEqual(starts.map(start=>start.data.port).sort(),[21065,21066]);
 assert(starts.every(start=>start.data.reuseOnly&&start.context.conversationChannel));
 const original=manager.listSources({scheduleReady:true});
 assert.equal(original.length,2);
 for(const source of original){
  const binding={kind:'ssh',version:2,profileId:source.profileId,profileVersion:1,...health(source.profileId)};
  assert.equal(source.id,taskForRecordIndex({authoring:{workerBinding:binding}}).workerSourceId);
  assert.equal(source.generation,'service-'+source.profileId);
 }
 f.turn(f.owner,'用材料中心和图形中心','both',manager);
 await manager.acquire(f.owner,{resourceId:'ssh:A'});await manager.acquire(f.owner,{resourceId:'ssh:B'});
 assert.deepEqual((await manager.resolveService(f.owner,'ssh:B')).clusterIds,['scheduler-B']);
 const prepare={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'prepare_cluster_run',arguments:{spec:{project_id:'project',cluster_id:'scheduler-B'}}}};
 const selected=await manager.serviceRequest(f.owner,{resourceId:'ssh:B',method:'POST',target:'/mcp',data:prepare,mcp:true});
 assert.equal(selected.data.fixture,'B');
 await assert.rejects(manager.serviceRequest(f.owner,{resourceId:'ssh:A',method:'POST',target:'/mcp',data:prepare,mcp:true}),/project_grant_required/);
 const read={jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'cluster_run_status',arguments:{run_id:'run-on-A'}}};
 await assert.rejects(manager.serviceRequest(f.owner,{resourceId:'ssh:B',method:'POST',target:'/mcp',data:read,mcp:true}),/run_source_changed/);
 assert.equal((await manager.serviceRequest(f.owner,{resourceId:'ssh:A',method:'POST',target:'/mcp',data:read,mcp:true})).data.fixture,'A');
 const sourceA=original.find(source=>source.profileId==='A'),sourceB=original.find(source=>source.profileId==='B');
 const observeRoute='/api/managed-schedules/observe-once',observe={sourceId:sourceB.id,scheduleId:'fixture-schedule',requestId:'manual-check'};
 assert.throws(()=>assertRendererWorkerRoute('POST',observeRoute));
 await assert.rejects(manager.serviceRequest(f.owner,{resourceId:'ssh:B',method:'POST',target:observeRoute,data:observe}),/invalid_request/);
 await assert.rejects(sourceA.request('POST',observeRoute,observe),/invalid_request/);
 assert.equal((await sourceB.request('POST',observeRoute,observe)).fixture,'B');
 assert.deepEqual(packets.filter(packet=>packet.target===observeRoute).map(({connectionId,data,mcp})=>({connectionId,data,mcp})),
  [{connectionId:'conn-B',data:observe,mcp:false}]);
 await manager.revokeConnection({connectionId:'conn-A'});
 await assert.rejects(sourceA.request('GET','/api/health'),/resource_unavailable/);
 assert.equal((await sourceB.request('GET','/api/health')).hostIdentity.hostname,'remote-B');
 assert.equal(packets.filter(packet=>packet.target==='/mcp').length,2);
});

test('WSL is published only after an independent original worker relay verifies its scope and runtime',async t=>{
 const f=fixture(t),runtime='/owned/wsl/runtimes/'+'b'.repeat(20),root='/owned/wsl',distribution='Test Linux',port=9042;
 f.stored.set('WSL',{id:'WSL',kind:'wsl',version:1,name:'Local',distribution,root,port});
 const observed=[],clients=[];
 function newWslClient(){
  const client={
   async restore(config,{current}){assert.equal(current(),true);observed.push(config);this.connection={};return {status:'connected'};},
   matchesTarget(config){return config.distribution===distribution&&config.workerRoot===root&&config.workerPort===port;},
   async forward(_method,target){
    const responses={'/api/health':{name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',root,runtime},
     '/api/projects':[{id:'project',policy:{environments:['env']}}],'/api/environments':[{id:'env',secret:'private local environment'}]};
    return {status:200,data:responses[target]};
   },
   close(){this.connection=null;}
  };
  clients.push(client);return client;
 }
 const manager=f.make({services:createManagedComputeServices({newWslClient})});
 t.after(()=>manager.stop());
 const receipt={profileId:'WSL',profileVersion:1,distribution,root,port,runtime};
 assert.deepEqual(manager.snapshot(),[]);
 await assert.rejects(manager.publishWsl({...receipt,runtime:'/different/runtime'}),/private_service_unavailable/);
 const wsl=await manager.publishWsl(receipt);
 assert.equal(wsl.kind,'wsl');assert.equal(wsl.serviceStatus,'ready');
 assert.deepEqual(observed,[{distribution,workerRoot:root,workerPort:port},{distribution,workerRoot:root,workerPort:port}]);
 assert.equal(clients[0].connection,null);
 f.turn(f.owner,'用本地','where',manager);
 const acquired=await manager.acquire(f.owner,{alias:'本地'});
 assert.equal(acquired.terminal,undefined);
 assert.deepEqual((await manager.resolveService(f.owner,acquired.resource.resourceId)).environmentIds,['env']);
 assert.equal(manager.listSources()[0].id,taskForRecordIndex({authoring:{workerBinding:{kind:'wsl',distribution,root,port}}}).workerSourceId);
 assert.equal(manager.listSources({scheduleReady:true}).length,0);
 assert.equal(f.calls.filter(call=>call.op==='open').length,0);
 await manager.stop();assert.equal(clients[1].connection,null);
});

test('human first-use setup opens one private service on its published host without occupying or borrowing a shell',async t=>{
 const f=fixture(t),calls=[],saved=new Map(),channels=new Map();
 const health={name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',root:'/fixture/data',port:34567,
  runtime:'/fixture/data/runtimes/'+'c'.repeat(20),runtimeId:'c'.repeat(20),hostIdentity:{hostname:'fixture',uid:1000,machineId:'fixture-id'}};
 const registration={
  validateReuse(profile){if(!saved.has(profile.id))throw Error('ssh_service_registration_required');return saved.get(profile.id);},
  read({profileId}){return saved.has(profileId)?{status:'configured',registration:saved.get(profileId)}:{status:'unconfigured'};},
  remember(profile,observed,tools){calls.push({registered:profile.id});assert.equal(observed.root,health.root);assert.equal(tools.count,1);saved.set(profile.id,observed);}
 };
 Object.assign(f.connections,{
  serviceState:async({connectionId})=>channels.get(connectionId)??{connectionId,profileId:connectionId.at(-1),profileVersion:1,status:'idle',serviceActive:false},
  async openService(ref,bootstrap,context){calls.push({ref,bootstrap,context});channels.set(ref.connectionId,{...ref,serviceId:'setup-'+ref.profileId,status:'connected',serviceActive:true,channelKind:'private',service:{...health,runtimeManifestSha256:'c'.repeat(64)}});},
  async privateServiceRequest(packet){return {status:200,data:packet.target==='/api/health'?health:{jsonrpc:'2.0',id:packet.data.id,result:{tools:[{name:'fixture'}]}}};}
 });
 const services=createManagedComputeServices({connections:f.connections,registration,prepareResources:async()=>({payload:{port:health.port,expected_runtime_id:health.runtimeId}})});
 const manager=f.make({services});t.after(()=>manager.stop());
 await f.publish('A','conn-A',manager);await f.publish('B','conn-B',manager);
 await manager.refreshService({connectionId:'conn-A'});
 assert.equal(manager.snapshot().find(row=>row.profileId==='A').serviceStatus,'configuration_required');
 f.turn(f.owner,'用材料中心','independent',manager);
 assert((await manager.acquire(f.owner,{resourceId:'ssh:A'})).terminal?.sessionId);
 await assert.rejects(manager.resolveService(f.owner,'ssh:A'),/ssh_service_registration_required/);
 assert.equal((await manager.callTerminalTool('list_compute_terminals',{},f.owner)).sessions.length,1);
 const ref={connectionId:'conn-A',profileId:'A',profileVersion:1};
 const views=await Promise.all([manager.configureService(ref),manager.configureService(ref)]);
 assert(views.every(row=>row.serviceStatus==='ready'));
 assert.equal(calls.filter(call=>call.ref).length,1);
 assert.equal(calls[0].ref.connectionId,'conn-A');assert.equal(calls[0].context.conversationChannel,true);
 assert.equal(calls[0].bootstrap.reuseOnly,undefined);
 assert.equal(calls[1].registered,'A');assert.equal(saved.size,1);
 assert.equal((await manager.callTerminalTool('list_compute_terminals',{},f.owner)).sessions.length,1);
 assert.equal(manager.owns('configureService'),false);
 await assert.rejects(manager.configureService({...ref,connectionId:'conn-B'}),/resource_unavailable/);
});

test('run mutations check exact source, active project grant, user intent and known canonical state before dispatch',async t=>{
 const dispatched=[],runStates=new Map(),f=fixture(t),held=deferred(),entered=deferred();
 let authorized=false,monitorAvailable=true;
 const workerBinding={kind:'ssh',root:'/fixture/worker',hostIdentity:{hostname:'fixture',uid:100,machineId:'fixture'}};
 const services={async ssh(resource){
  const id=resource.profileId,clusterId='cluster-'+id,cluster={id:clusterId,version:1,transport_kind:'ssh-service-local'};
  const health=id==='A'?{managed_run_action_schema:1,managed_submit_monitor_schema:1}:{};
  return {id:'worker-'+id,binding:workerBinding,health,async verify(){},
   async forward(method,target,data,mcp,_timeout,check){
    const observed=monitorAvailable?health:{...health,managed_submit_monitor_schema:undefined};
    check?.(observed);
    if(target==='/api/projects')return {status:200,data:[{id:'project',policy:{clusters:[clusterId]}}]};
    if(target==='/api/clusters')return {status:200,data:[cluster]};
    if(target==='/api/cluster/profile')return {status:200,data:{...cluster,service_binding:{root:workerBinding.root,...workerBinding.hostIdentity}}};
    if(target==='/api/cluster/observation')return {status:200,data:structuredClone(runStates.get(data.run_id))};
    if(target==='/api/cluster/submit'){
     assert.equal(method,'POST');assert.equal(mcp,false);
     dispatched.push({resource:id,name:'submit_cluster_run',arguments:data});
     if(data.run_id==='run-confirmed-A')return {status:200,data:{...runStates.get(data.run_id),status:'queued',job_id:'456'}};
     entered.resolve();await held.promise;return {status:502,data:{fixture:'lost acknowledgement'}};
    }
    if(target==='/mcp'){
     dispatched.push({resource:id,...data.params});
     assert.notEqual(data.params.name,'submit_cluster_run','Managed submissions must use the trusted worker endpoint');
     return {status:200,data:{fixture:true}};
    }
    assert.fail('Unexpected route '+target);
   }};
 }};
 const manager=f.make({services,authorizeRun:(_scope,ref)=>ref.runId.endsWith(ref.resourceId.at(-1)),authorizeRunAction:()=>authorized});
 t.after(()=>manager.stop());
 await Promise.all(['A','B'].map(id=>f.publish(id,'conn-'+id,manager)));
 await Promise.all(['A','B'].map(id=>manager.refreshService({connectionId:'conn-'+id})));
 f.turn(f.owner,'用材料中心和图形中心','use-both',manager);
 await Promise.all(['A','B'].map(id=>manager.acquire(f.owner,{resourceId:'ssh:'+id})));
 const mutation=(id,name,runId='run-'+id,extra)=>manager.serviceRequest(f.owner,{resourceId:'ssh:'+id,method:'POST',target:'/mcp',mcp:true,
  data:{jsonrpc:'2.0',id:'fixture',method:'tools/call',params:{name,arguments:{run_id:runId,...extra}}}});
 runStates.set('run-A',{id:'run-A',project_id:'project',cluster_id:'cluster-A',status:'draft'});
 await assert.rejects(mutation('A','submit_cluster_run'),/run_intent_required/);
 authorized=true;
 await assert.rejects(mutation('B','submit_cluster_run','run-A'),/run_source_changed/);
 await assert.rejects(mutation('B','submit_cluster_run'),/worker_update_required/);
 await assert.rejects(mutation('A','submit_cluster_run','run-A',{managed_monitor:{sourceId:'worker-B'}}),/invalid_request/);
 runStates.get('run-A').status='unknown';
 await assert.rejects(mutation('A','validate_cluster_run'),/state_unconfirmed/);
 await assert.rejects(mutation('A','cancel_cluster_run'),/state_unconfirmed/);
 await assert.rejects(mutation('B','cancel_cluster_run'),/worker_update_required/);
 runStates.get('run-A').status='draft';
 assert.equal((await mutation('A','validate_cluster_run')).status,200);
 monitorAvailable=false;
 await assert.rejects(mutation('A','submit_cluster_run'),/worker_update_required/);
 monitorAvailable=true;
 const first=mutation('A','submit_cluster_run');
 await Promise.race([first,entered.promise]);
 await assert.rejects(mutation('A','submit_cluster_run'),/run_busy/);
 held.resolve();assert.equal((await first).status,502);
 await assert.rejects(mutation('A','submit_cluster_run'),/action_unconfirmed/);
 runStates.get('run-A').status='running';runStates.get('run-A').job_id='123';
 assert.equal((await mutation('A','cancel_cluster_run')).status,200);
 runStates.set('run-confirmed-A',{id:'run-confirmed-A',project_id:'project',cluster_id:'cluster-A',status:'ready'});
 const confirmed=await mutation('A','submit_cluster_run','run-confirmed-A');
 assert.deepEqual(confirmed,{status:200,data:{jsonrpc:'2.0',id:'fixture',result:{isError:false,content:[{type:'text',text:JSON.stringify({...runStates.get('run-confirmed-A'),status:'queued',job_id:'456'})}]}}});
 assert.deepEqual(dispatched.filter(item=>item.name==='submit_cluster_run').map(item=>item.arguments),['run-A','run-confirmed-A'].map(runId=>({run_id:runId,
  managed_monitor:{schemaVersion:1,sourceId:'worker-A',scope:{provider:f.owner.provider,threadId:f.owner.threadId,taskId:f.owner.taskId,projectId:f.owner.projectId,runId}}})));
 assert.deepEqual(dispatched.map(({resource,name,arguments:args})=>[resource,name,args.require_known??false]),
  [['A','validate_cluster_run',false],['A','submit_cluster_run',false],['A','cancel_cluster_run',true],['A','submit_cluster_run',false]]);
});
