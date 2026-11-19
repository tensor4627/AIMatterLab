import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createManagedComputeResources} from '../../backend/main/compute/managed-compute-resources.mjs';
import {managedProjectAccess} from '../../backend/main/compute/managed-project-access.mjs';
import {resourceFingerprint} from '../../backend/main/compute/managed-compute-aliases.mjs';
import {createManagedComputeTools} from '../../agent/tools/managed-compute-tools.mjs';
import {toolFailure,toolValueResult} from '../../agent/tools/tool-failure.mjs';

function fixture(t,{serviceReady=true,selectionCatalog}={}) {
 const profiles=new Map(),states=new Map(),shells=new Map(),store=new Map(),calls=[],shellRequests=[],cancelled=new Set(),control={};
 let generation=0;
 const access=managedProjectAccess({catalog:{get:(k,id)=>store.get(id),put:(k,id,row)=>store.set(id,row),list:()=>[...store.values()]}});
 const jobService=async resource=>{
  if(!serviceReady)throw Error('ssh_service_registration_required');
  const serviceGeneration='fixture-service-'+(++generation),cluster={id:'scheduler-'+resource.profileId,version:1,transport_kind:'ssh-service-local'};
  const binding={root:'/fixture/worker',hostIdentity:{hostname:'fixture.invalid',uid:1000,machineId:'fixture'}};
  return {id:'source-'+resource.profileId,generation:serviceGeneration,binding,health:{},schedulerInspection:true,
   async verify(){await control.verify?.(serviceGeneration);},
   async forward(method,target,body,mcp,timeout,check){
    check?.();calls.push(target);
    const workerProject=control.workerProjects?.[resource.profileId];
    if(target==='/api/projects')return {status:200,data:workerProject?[{id:workerProject,policy:{clusters:[cluster.id]}}]:[]};
    if(target==='/api/clusters')return {status:200,data:[cluster]};
    if(target==='/api/cluster/profile')return {status:200,data:{...cluster,service_binding:{root:binding.root,...binding.hostIdentity}}};
    assert.deepEqual([method,target,body,mcp,timeout],['POST','/api/ssh-service/inspect-scheduler',{},false,15000]);
    return {status:200,data:{status:'observed',observed_at:100,automatic_retry:false,observations:[
     {scheduler:'slurm',status:'observed',queues:[{name:'fixture-only',default:true,availability:'up',node_count:1,node_state:'idle',gres:'gpu:1'}]},
     {scheduler:'lsf',status:'not_found',queues:[]}
    ]}};
   }};
 };
 const manager=createManagedComputeResources({selectionCatalog,
  terminal:{connections:{state:async({connectionId})=>states.get(connectionId),async managedShell(op,ref) {
   calls.push(op);shellRequests.push({op,ref});
   await control.shell?.(op,ref);
   if(op==='open'){
    if(cancelled.has(ref.leaseId))throw Error('ssh_connection_changed');
    shells.set(ref.leaseId,{sessionId:randomUUID(),alive:true,ownerEpoch:1,expiresAt:Date.now()+60000});
   }
   if(op==='close'){cancelled.add(ref.leaseId);shells.delete(ref.leaseId);return {closed:true};}
   return shells.get(ref.leaseId);
  }}},
  profiles:{read:({id})=>profiles.get(id)},authorizeTerminal:access.terminalDecision,
  services:{ssh:jobService,wsl:jobService}
 });
 t.after(()=>manager.stop());
 const scope={provider:'deepseek',threadId:'chat',taskId:null,projectId:null,checkCurrent:()=>true};
 const gateway=createManagedComputeTools({resources:manager,assertWorkflow:()=>assert.fail('A chat attempted to create or require a workflow')});
 const speak=(text,owner=scope)=>manager.recordUserTurn({...owner,text,turnId:randomUUID()});
 async function host(id,name,hostname='fixture.invalid') {
  const profile={id,name,version:1,kind:'ssh',host:hostname,port:22,username:'fixture',ssh_client:'ssh'};
  const ref={connectionId:'connection-'+id,profileId:id,profileVersion:1};
  profiles.set(id,profile);states.set(ref.connectionId,{...ref,status:'authenticated',authentication:'verified',capabilities:{multiplex:true}});
  await manager.publish(ref);await manager.refreshService(ref);return 'ssh:'+id;
 }
 async function local(id,name){
  const receipt={profileId:id,profileVersion:1,distribution:'Fixture Linux',root:'/fixture/local',runtime:'/fixture/runtime',port:8767};
  profiles.set(id,{id,name,version:1,kind:'wsl',distribution:receipt.distribution,root:receipt.root,port:receipt.port});
  await manager.publishWsl(receipt);return 'wsl:'+id;
 }
 const setAllowed=(project,id,allowed)=>access.set(project,{kind:'ssh',profileId:id,targetFingerprint:resourceFingerprint(profiles.get(id))},allowed);
 return {manager,gateway,scope,speak,host,local,calls,setAllowed,shellRequests,shells,control};
}

function deferred(){
 let resolve;const promise=new Promise(complete=>{resolve=complete;});return {promise,resolve};
}

test('DeepSeek can inspect queues on the only hosted SSH target in an ordinary chat, even with no worker project',async t=>{
 const f=fixture(t),resource_id=await f.host('a','示例甲');
 for(const projectId of [null,'desktop-project']){
  const scope={...f.scope,threadId:'chat-'+(projectId||'none'),projectId};
  f.speak('读取我的个人skill，看看集群有哪些自有队列空着',scope);
  const inventory=await f.gateway.call('list_compute_resources',{},scope);
  assert.equal(inventory.resources[0].canAcquire,true);
  const lease=await f.gateway.call('acquire_compute_resource',{resource_id},scope);
  assert.equal(lease.status,'acquired');assert(lease.terminal.sessionId);
  const probe=await f.gateway.call('inspect_compute_service',{resource_id,probe_scheduler:true},scope);
  assert.equal(probe.terminal_available,true);
  assert.equal(probe.project_access,projectId?'not_granted':'no_project');
  assert.equal(probe.scheduler.observations[0].queues[0].node_state,'idle');
  assert.deepEqual(probe.cluster_ids,[]);
  assert.equal((await f.gateway.call('acquire_compute_resource',{resource_id,alias:'示例甲'},scope)).reused,true);
  await assert.rejects(f.gateway.call('acquire_compute_resource',{profile_id:'b',alias:'示例甲'},scope),/invalid_request/);
 }
 assert.equal(f.calls.filter(call=>call==='open').length,2);
 assert.equal(f.calls.filter(call=>call==='/api/ssh-service/inspect-scheduler').length,2);
});

test('normal conversational affirmation resolves the exact previous resource choice without lending its terminal to another chat',async t=>{
 const f=fixture(t),resource_id=await f.host('a','示例甲');await f.host('b','示例乙');
 f.speak('帮我看看集群有哪些空闲队列');
 const choice=await f.gateway.call('acquire_compute_resource',{resource_id},f.scope);
 assert.equal(choice.status,'choice_required');assert.equal(choice.candidates.length,2);assert(!f.calls.includes('open'));
 f.speak('是示例甲');
 const acquired=await f.gateway.call('acquire_compute_resource',{alias:'示例甲'},f.scope);
 assert.equal(acquired.resource.resourceId,resource_id);
 const other={...f.scope,threadId:'unrelated'};
 await assert.rejects(f.gateway.call('inspect_compute_service',{resource_id,probe_scheduler:true},other),error=>{
  const reply=JSON.parse(toolFailure(error,{dispatched:true}).content[0].text);
  return reply.code==='resource_lease_required'&&reply.operation_state==='not_started';
 });
 f.speak('不要查看示例乙的队列',other);
 await assert.rejects(f.gateway.call('acquire_compute_resource',{alias:'示例乙'},other),/instruction_required/);
 assert.equal(f.calls.filter(call=>call==='open').length,1);
});

test('a uniquely named hosted service can be acquired on the first human turn with any public selector',async t=>{
 const f=fixture(t),resource_id=await f.host('a','甲');await f.host('b','乙');
 for(const [phrase,selector] of [['就是甲',{resource_id}],['甲',{profile_id:'a'}],['我指的是「甲」，查一下它的队列',{alias:'甲'}],['用甲查队列',{resource_id}]]){
  const scope={...f.scope,threadId:randomUUID()};
  f.speak(phrase,scope);
  const result=await f.gateway.call('acquire_compute_resource',{...selector,access:'service'},scope);
  assert.equal(result.status,'acquired');assert.equal(result.resource.resourceId,resource_id);
  assert.equal(result.terminal,undefined);
  const probe=await f.gateway.call('inspect_compute_service',{resource_id,probe_scheduler:true},scope);
  assert.equal(probe.scheduler.observations[0].queues[0].name,'fixture-only');
 }
 assert.equal(f.shellRequests.length,0);
});

test('a generic queue observation selects the only eligible SSH service and offers multiple eligible clusters in chat',async t=>{
 const f=fixture(t),one=await f.host('a','甲');
 f.speak('探测一下集群队列，我的自有队列哪些空卡？');
 assert.equal((await f.gateway.call('acquire_compute_resource',{resource_id:one,access:'service'},f.scope)).status,'acquired');
 const two=await f.host('b','乙'),other={...f.scope,threadId:'new'};
 f.speak('探测一下集群队列，我的自有队列哪些空卡？',other);
 const options=await f.gateway.call('acquire_compute_resource',{resource_id:one,access:'service'},other);
 assert.equal(options.status,'choice_required');assert.equal(options.candidates.length,2);
 f.speak('就是乙',other);const wrong=await f.gateway.call('acquire_compute_resource',{resource_id:one,access:'service'},other);
 assert.equal(wrong.status,'target_selected');assert.deepEqual(wrong.retry,{resource_id:two,access:'service'});
 assert.equal((await f.gateway.call('acquire_compute_resource',wrong.retry,other)).resource.resourceId,two);
});

test('duplicate names require a chat ID, and a longer registered name wins over its prefix',async t=>{
 const f=fixture(t),one=await f.host('a','甲'),two=await f.host('b','甲'),long=await f.host('c','甲集群');
 const call=(id,scope=f.scope)=>f.gateway.call('acquire_compute_resource',{resource_id:id,access:'service'},scope);
 f.speak('就是甲');const choice=await call(one);
 assert.equal(choice.status,'choice_required');assert.deepEqual(choice.candidates.map(x=>x.resourceId),[one,two]);
 f.speak(two);assert.equal((await call(two)).resource.resourceId,two);
 const scope={...f.scope,threadId:'long-target'};
 f.speak('请使用甲集群',scope);assert.deepEqual((await call(one,scope)).retry,{resource_id:long,access:'service'});
 assert.equal((await call(long,scope)).resource.resourceId,long);
});

test('a direct chat designation survives a follow-up and restart only for that conversation, project and exact hosted target',async t=>{
 const saved=new Map(),selectionCatalog={get:(_,k)=>saved.get(k),put:(_,k,v)=>saved.set(k,structuredClone(v)),remove:(_,k)=>saved.delete(k)};
 const first=fixture(t,{selectionCatalog}),id=await first.host('a','甲');await first.host('b','乙');
 first.speak('就是甲');assert.equal(saved.size,1);
 assert.doesNotMatch(JSON.stringify([...saved.values()]),/就是甲|fixture\.invalid|password/);
 const moved=fixture(t,{selectionCatalog});await moved.host('a','甲','replacement.invalid');
 moved.speak('继续查');
 await assert.rejects(moved.gateway.call('acquire_compute_resource',{resource_id:id,access:'service'},moved.scope),/choice_changed/);
 assert.equal(moved.shellRequests.length,0);
 const second=fixture(t,{selectionCatalog});await second.host('a','甲');await second.host('b','乙');
 const call=(scope)=>second.gateway.call('acquire_compute_resource',{resource_id:id,access:'service'},scope);
 for(const scope of [{...second.scope,projectId:'other'},{...second.scope,threadId:'other'},{...second.scope,provider:'codex'}]){
  second.speak('继续查',scope);await assert.rejects(call(scope),/instruction_required/);
 }
 second.speak('继续查');assert.equal((await call(second.scope)).status,'acquired');
 second.speak('不要再使用甲');await assert.rejects(call(second.scope),/instruction_required/);
 await second.gateway.call('release_compute_resource',{resource_id:id},second.scope);
 second.speak('继续查');await assert.rejects(call(second.scope),/instruction_required/);
});

test('a model clarification after discovery accepts the human reply only in the same project and conversation',async t=>{
 const f=fixture(t);await f.host('a','示例甲');await f.host('b','示例乙');
 f.speak('看看集群的队列');await f.gateway.call('list_compute_resources',{},f.scope);
 const different={...f.scope,projectId:'different'};
 f.speak('就是它',different);
 await assert.rejects(f.gateway.call('acquire_compute_resource',{alias:'示例乙'},different),/instruction_required/);
 f.speak('就是示例乙',different);
 assert.equal((await f.gateway.call('acquire_compute_resource',{alias:'示例乙'},different)).resource.resourceId,'ssh:b');
 await f.gateway.call('release_compute_resource',{resource_id:'ssh:b'},different);
 f.speak('看看集群的队列');await f.gateway.call('list_compute_resources',{},f.scope);
 f.speak('是示例乙');assert.equal((await f.gateway.call('acquire_compute_resource',{alias:'示例乙'},f.scope)).status,'acquired');
});

test('an explicit project refusal revokes ordinary terminal use without changing a different chat’s project access',async t=>{
 const f=fixture(t),resource_id=await f.host('a','示例甲');
 const own={...f.scope,projectId:'project-a'},other={...f.scope,threadId:'peer',projectId:'project-b'};
 const lease=async scope=>{f.speak('请使用示例甲',scope);return (await f.gateway.call('acquire_compute_resource',{resource_id},scope)).terminal;};
 const one=await lease(own),two=await lease(other);
 f.setAllowed(own.projectId,'a',false);
 await assert.rejects(f.gateway.call('read_compute_terminal',{session_id:one.sessionId},own),/project_grant_required/);
 assert.deepEqual((await f.gateway.call('list_compute_terminals',{},own)).sessions,[]);
 assert.equal((await f.gateway.call('list_compute_terminals',{},other)).sessions[0].sessionId,two.sessionId);
 f.setAllowed(own.projectId,'a',true);
 assert.equal((await f.gateway.call('list_compute_terminals',{},own)).sessions[0].sessionId,one.sessionId);
});

test('a confirmed PTY failure advertises the same verified service and still requires an exact service acquisition',async t=>{
 const f=fixture(t),resource_id=await f.host('a','示例甲');
 f.control.shell=op=>{if(op==='open')throw Error('ssh_shell_readiness_timeout');};
 f.speak('使用示例甲查看队列');
 const acquire=args=>f.gateway.call('acquire_compute_resource',args,f.scope);
 const failure=await acquire({resource_id});
 assert.deepEqual({status:failure.status,code:failure.code,leaseStatus:failure.leaseStatus,retry:failure.retry},
  {status:'terminal_unavailable',code:'ssh_shell_readiness_timeout',leaseStatus:'none',retry:{resource_id,access:'service'}});
 assert.deepEqual(JSON.parse(toolValueResult(failure).content[0].text),failure);
 assert.equal(toolValueResult(failure).isError,true);
 assert.deepEqual(f.shellRequests.map(row=>row.op),['open','close']);
 assert.deepEqual(f.shellRequests[0].ref,f.shellRequests[1].ref);
 assert.equal(f.manager.snapshot()[0].terminalAvailable,4);
 await assert.rejects(f.gateway.call('inspect_compute_service',{resource_id,probe_scheduler:true},f.scope),/resource_lease_required/);
 const service=await acquire(failure.retry);
 assert.equal(service.access,'service');assert.equal(Object.hasOwn(service,'terminal'),false);
 assert.deepEqual(f.shellRequests.map(row=>row.op),['open','close']);
 const probe=await f.gateway.call('inspect_compute_service',{resource_id,probe_scheduler:true},f.scope);
 assert.equal(probe.project_access,'no_project');assert.equal(probe.terminal_available,false);
 assert.equal(probe.scheduler.observations[0].queues[0].name,'fixture-only');
 assert.equal(f.calls.includes('/api/projects'),false);
 await assert.rejects(f.manager.resolveService(f.scope,resource_id),/project_grant_required/);
 const foreign={...f.scope,provider:'codex'};
 await assert.rejects(f.gateway.call('inspect_compute_service',{resource_id,probe_scheduler:true},foreign),/resource_lease_required/);
 await assert.rejects(acquire({access:'service'}),/invalid_request/);
 await assert.rejects(acquire({resource_id,access:'legacy-session'}),/invalid_request/);
 assert.doesNotMatch(JSON.stringify({failure,service}),/connection-a|fixture\.invalid|source-a|fixture-service-/);
});

test('a service lease stays usable during a failed upgrade and a deduplicated parallel terminal upgrade',async t=>{
 const f=fixture(t),resource_id=await f.host('a','示例甲');
 f.speak('使用示例甲查看队列');
 const acquire=access=>f.gateway.call('acquire_compute_resource',{resource_id,access},f.scope);
 const inspect=()=>f.gateway.call('inspect_compute_service',{resource_id,probe_scheduler:true},f.scope);
 assert.equal((await acquire('service')).access,'service');
 const assignment=f.manager.consoleEntries().channels[0];
 f.control.shell=op=>{if(op==='open')throw Error('ssh_shell_interaction_required');};
 const failed=await acquire('terminal');
 assert.equal(failed.code,'ssh_shell_interaction_required');assert.equal(failed.leaseStatus,'service_retained');
 assert.equal((await inspect()).terminal_available,false);
 assert.equal(f.manager.consoleEntries().channels[0].leaseId,assignment.leaseId);

 const entered=deferred(),opening=deferred();
 f.control.shell=async op=>{if(op==='open'){entered.resolve();await opening.promise;}};
 const upgrade=acquire('terminal');await entered.promise;
 const duplicate=acquire('terminal');
 assert.equal((await acquire('service')).reused,true);
 assert.equal((await inspect()).terminal_available,false);
 const preparing=f.manager.consoleEntries().channels[0];
 assert.equal(preparing.status,'assigned');assert.equal(preparing.terminalStatus,'preparing');assert.equal(preparing.sessionId,null);
 assert.equal(f.manager.snapshot()[0].terminalAvailable,3);
 opening.resolve();
 const [first,second]=await Promise.all([upgrade,duplicate]);
 assert.equal(first.access,'terminal');assert.equal(first.reused,false);assert.equal(second.reused,true);
 assert.deepEqual(first.terminal,second.terminal);
 assert.deepEqual(f.shellRequests.filter(row=>row.op==='open').map(row=>row.ref.leaseId).length,2);
 assert.notEqual(f.shellRequests[0].ref.leaseId,f.shellRequests[2].ref.leaseId);
 assert.equal(f.manager.consoleEntries().channels[0].leaseId,assignment.leaseId);
 assert.equal(f.manager.consoleEntries().channels[0].serviceContext,true);
 assert.equal((await inspect()).terminal_available,true);
 assert.deepEqual(await f.gateway.call('release_compute_resource',{resource_id},f.scope),{status:'released',resourceId:resource_id,terminalClosed:true});
 await assert.rejects(inspect(),/resource_lease_required/);
 assert.equal(f.shells.size,0);
});

test('unknown terminal close preserves its capacity reservation while the independently verified service is available',async t=>{
 const f=fixture(t),resource_id=await f.host('a','示例甲');
 f.speak('使用示例甲查看队列');
 f.control.shell=op=>{if(op==='open')throw Error('terminal_unavailable');if(op==='close')throw Error('terminal_unavailable');};
 const acquire=access=>f.gateway.call('acquire_compute_resource',{resource_id,access},f.scope);
 const failed=await acquire('terminal');
 assert.equal(failed.leaseStatus,'unknown');assert.deepEqual(failed.retry,{resource_id,access:'service'});
 assert.equal(f.manager.snapshot()[0].terminalAvailable,3);
 assert.equal((await acquire('service')).access,'service');
 assert.equal((await f.gateway.call('inspect_compute_service',{resource_id,probe_scheduler:true},f.scope)).scheduler.status,'observed');
 const channel=f.manager.consoleEntries().channels[0];
 assert.equal(channel.status,'assigned');assert.equal(channel.terminalStatus,'lost');assert.equal(channel.sessionId,null);
 assert.equal((await acquire('terminal')).leaseStatus,'unknown');
 assert.equal(f.shellRequests.filter(row=>row.op==='open').length,1);
 assert.deepEqual(await f.gateway.call('release_compute_resource',{resource_id},f.scope),{status:'unconfirmed',resourceId:resource_id,terminalClosed:false});
 await assert.rejects(f.gateway.call('inspect_compute_service',{resource_id,probe_scheduler:true},f.scope),/resource_lease_required/);
 assert.equal(f.manager.snapshot()[0].terminalAvailable,3);
 f.control.shell=undefined;await f.manager.sweep();
 assert.deepEqual(f.manager.consoleEntries().channels,[]);
 assert.equal(f.manager.snapshot()[0].terminalAvailable,4);
});

test('a confirmed SSH channel refusal does not announce a service recovery when no worker is ready',async t=>{
 const f=fixture(t,{serviceReady:false}),resource_id=await f.host('a','示例甲');
 f.speak('使用示例甲');f.control.shell=op=>{if(op==='open')throw Error('ssh_channel_refused');};
 const failure=await f.gateway.call('acquire_compute_resource',{resource_id},f.scope);
 assert.equal(failure.code,'ssh_channel_refused');assert.equal(failure.leaseStatus,'none');assert.equal(Object.hasOwn(failure,'retry'),false);
 assert.equal(f.manager.snapshot()[0].terminalAvailable,4);
 assert.equal(f.manager.consoleEntries().channels.length,0);
});

test('a project refusal prevents host-only service observation and release cancels a pending service verification',async t=>{
 const f=fixture(t),resource_id=await f.host('a','示例甲');
 const owner={...f.scope,projectId:'desktop-project'};
 f.speak('使用示例甲查看队列',owner);
 const acquire=()=>f.gateway.call('acquire_compute_resource',{resource_id,access:'service'},owner);
 const inspect=()=>f.gateway.call('inspect_compute_service',{resource_id,probe_scheduler:true},owner);
 f.setAllowed(owner.projectId,'a',false);
 await assert.rejects(acquire(),/project_grant_required/);
 assert.equal(f.calls.includes('/api/ssh-service/inspect-scheduler'),false);
 f.setAllowed(owner.projectId,'a',true);await acquire();
 f.setAllowed(owner.projectId,'a',false);
 await assert.rejects(inspect(),/project_grant_required/);
 await f.gateway.call('release_compute_resource',{resource_id},owner);
 f.setAllowed(owner.projectId,'a',true);
 const entered=deferred(),verify=deferred();
 f.control.verify=()=>{entered.resolve();return verify.promise;};
 const pending=acquire(),rejection=assert.rejects(pending,/resource_lease_changed/);
 await entered.promise;
 assert.equal((await f.gateway.call('release_compute_resource',{resource_id},owner)).status,'not_acquired');
 verify.resolve();await rejection;
 await assert.rejects(inspect(),/resource_lease_required/);
 assert.equal(f.shellRequests.length,0);
});

test('choice candidates follow the requested lane across SSH and WSL, including an independent worker project grant',async t=>{
 const f=fixture(t),allowed=await f.host('a','材料甲'),denied=await f.host('b','材料乙'),local=await f.local('c','仿真机');
 const scope={...f.scope,projectId:'desktop-project'};
 f.setAllowed(scope.projectId,'b',false);f.control.workerProjects={b:scope.projectId};
 const acquire=args=>f.gateway.call('acquire_compute_resource',args,scope);
 f.speak('使用计算机甲',scope);
 assert.deepEqual((await acquire({alias:'计算机甲',access:'service'})).candidates.map(row=>row.resourceId),[allowed,denied,local]);
 assert.deepEqual((await acquire({alias:'计算机甲',access:'terminal'})).candidates.map(row=>row.resourceId),[allowed]);
 f.speak('使用仿真机',scope);
 const unsupported=await acquire({resource_id:local,access:'terminal'});
 assert.equal(unsupported.code,'managed_compute_terminal_not_supported');assert.deepEqual(unsupported.retry,{resource_id:local,access:'service'});
 assert.equal((await acquire(unsupported.retry)).access,'service');
 f.speak('使用材料乙',scope);
 const deniedTerminal=await acquire({resource_id:denied,access:'terminal'});
 assert.equal(deniedTerminal.code,'managed_compute_project_grant_required');
 assert.equal((await acquire(deniedTerminal.retry)).access,'service');
 assert.deepEqual((await f.manager.resolveService(scope,denied)).clusterIds,['scheduler-b']);
 assert.equal(f.shellRequests.length,0);
});
