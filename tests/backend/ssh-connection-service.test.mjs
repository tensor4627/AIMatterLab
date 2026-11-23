import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {prepareSshServiceResources} from '../../backend/main/compute/ssh-service-resources.mjs';
import {connectionServiceFixture as fixture} from '../helpers/ssh-connection-service-fixture.mjs';

test('new service setup verifies an authenticated connection, never borrows shell ownership, and grants nothing implicitly',async t=>{
 const f=fixture(t),s=await f.connect();assert.equal(s.schemaVersion,2);assert.equal(s.connectionId,'A');assert.equal(s.workflowReady,true);assert.equal(s.operator,'human');assert.equal(s.sessionId,undefined);assert.equal(s.terminalAccess,undefined);assert.equal(f.calls[0].open.ownerEpoch,undefined);assert.equal(f.worker.identity.version,3);assert.equal(f.worker.connection.transport,'ssh-connection');assert.equal(f.grant().operator,'agent');assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'configured');
});

test('normal same-connection health check keeps the measured READY manifest when worker health omits that optional field',async t=>{
 const f=fixture(t),sha='a'.repeat(64),open=f.connections.openService;f.connections.openService=async(...args)=>{const value=await open(...args);value.service.runtimeManifestSha256=sha;return value;};
 const connected=await f.connect(),request={profileId:'profile-A',profileVersion:1};assert.equal(f.registration.read(request).registration.runtimeManifestSha256,sha);
 const checked=await f.service.check({connectionId:'A',attemptId:connected.attemptId});assert.equal(checked.status,'connected');assert.equal(f.registration.read(request).registration.runtimeManifestSha256,sha);assert.equal(f.registration.read(request).registration.revision,2);
 assert.equal(f.calls.filter(call=>call.open).length,1);assert.equal(f.calls.filter(call=>call.close).length,0);
});

test('a control verification timeout fails one read without detaching an already verified service',async t=>{
 const f=fixture(t),connected=await f.connect();
 const send=f.connections.serviceRequest;
 let requested=0;
 f.connections.serviceRequest=async packet=>{
  if(packet.method==='GET'&&packet.target==='/api/clusters'&&++requested===1)throw Error('ssh_control_timeout');
  return send(packet);
 };
 await assert.rejects(f.worker.request('GET','/api/clusters'),/ssh_control_timeout/);
 assert.equal(f.service.peek().attemptId,connected.attemptId);
 assert.equal(f.service.peek().workflowReady,true);
 assert.equal(requested,1);
 assert.deepEqual(await f.worker.request('GET','/api/clusters'),[]);
 assert.equal(requested,2);
 assert.equal(f.calls.filter(c=>c.open).length,1);
 assert.equal(f.calls.filter(c=>c.close).length,0);
});

test('a control timeout during an explicit service check does not report a new successful check or detach the prior service',async t=>{
 const f=fixture(t),connected=await f.connect(),available=f.connections.state;
 const ref={connectionId:'A',attemptId:connected.attemptId};
 f.connections.state=async()=>{throw Error('ssh_control_timeout');};
 await assert.rejects(f.service.check(ref),/ssh_control_timeout/);
 assert.equal(f.service.peek().workflowReady,true);
 f.connections.state=available;
 const recovered=await f.service.check(ref);
 assert.equal(recovered.workflowReady,true);
 assert.equal(recovered.serviceId,connected.serviceId);
 assert.equal(f.calls.filter(c=>c.open).length,1);
});

test('legacy terminal selection and unauthenticated or mismatched bases cannot create a service channel',async t=>{
 const f=fixture(t);f.legacy();await assert.rejects(f.connect(),/selection_changed/);assert.equal(f.calls.length,0);
 await f.switch('A');f.bases.get('A').authentication='not_observed';assert.equal((await f.connect()).workflowReady,false);assert.equal(f.calls.length,0);
});

test('closing the visible shell leaves the exact service instance, local MCP and service grant intact',async t=>{
 const f=fixture(t);await f.connect();f.grant();const before=f.worker.connection;f.service.terminalClosed('any-shell');assert.equal(f.service.peek().status,'connected');assert.equal(f.service.hasCurrentGrant('codex',f.current()),true);assert.equal(f.worker.connection,before);assert(!f.calls.some(v=>v.close));
});

test('human service reclaim during a reply revokes only service use and does not close shell, master or remote channel',async t=>{
 const f=fixture(t);await f.connect();f.grant();f.busy(true);const result=f.service.owner({connectionId:'A',attemptId:'attempt-A',owner:'human'});assert.equal(result.workflowReady,true);assert.equal(f.service.hasCurrentGrant('codex'),false);assert(!f.calls.some(v=>v.close));assert.equal(f.bases.get('A').status,'authenticated');assert.throws(f.grant,/busy/);
});

test('service disconnect closes only its service channel and keeps registration and authenticated base',async t=>{
 const f=fixture(t);await f.connect();f.grant();const result=await f.service.disconnect({connectionId:'A',attemptId:'attempt-A'});assert.equal(result.status,'disconnected');assert.equal(f.bases.get('A').status,'authenticated');assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'configured');assert.equal(f.calls.filter(v=>v.close).length,1);assert.equal(f.worker.connection,null);
});

test('multiple pipelines preserve background service channels and switching back only verifies and reattaches the same instance',async t=>{
 const f=fixture(t);await f.connect('A');f.grant();await f.switch('B');assert.equal(f.channels.get('A').status,'connected');assert.equal(f.service.peek({connectionId:'A'}).workflowReady,false);await f.connect('B');f.grant();assert.equal(f.channels.size,2);await f.switch('A');const result=await f.connect('A','reuse','new-local-attach');assert.equal(result.workflowReady,true);assert.equal(result.attemptId,'attempt-A');assert.equal(result.operator,'human');assert.equal(f.calls.filter(v=>v.open).length,2);assert.equal(f.calls.filter(v=>v.close).length,0);assert.equal(f.preparations.length,2);assert.equal(f.channels.get('B').status,'connected');
});

test('foreground workflow reuses the exact hosted connection attempt without preparing or opening another worker',async t=>{
 const f=fixture(t),stored={...f.health('A'),runtimeManifestSha256:'a'.repeat(64)};
 const transport=f.connections.serviceRequest;
 let capabilities={roadmap_execution_schema:1,resource_tool_schema:1,other_worker_schema:3};
 f.connections.serviceRequest=async packet=>{const result=await transport(packet);return packet.target==='/api/health'?{...result,data:{...result.data,...capabilities}}:result;};
 f.registration.remember(f.profile('A'),stored,{status:'ready',count:1});
 f.channels.set('A',{connectionId:'A',profileId:'profile-A',profileVersion:1,status:'connected',serviceActive:true,
  serviceId:'hosted-private-service',attemptId:'hosted-attempt',channelKind:'private',service:stored});
 const value=await f.connect('A','reuse','use-for-workflow');
 assert.equal(value.workflowReady,true);
 assert.equal(value.attemptId,'hosted-attempt');
 assert.equal(value.serviceId,'hosted-private-service');
 assert.equal(value.operator,'human');
 assert.equal(f.worker.identity.root,stored.root);
 assert.equal(value.health.roadmap_execution_schema,1);
 assert.equal(value.health.resource_tool_schema,1);
 assert.equal(f.worker.connection.health.roadmap_execution_schema,1);
 assert.equal(f.worker.connection.health.other_worker_schema,3);
 assert.equal(f.preparations.length,0);
 assert(f.calls.every(call=>!call.open&&!call.close&&call.request?.serviceId==='hosted-private-service'));
 capabilities={roadmap_execution_schema:2};
 const checked=await f.service.check({connectionId:'A',attemptId:'hosted-attempt'});
 assert.equal(checked.workflowReady,true);
 assert.equal(checked.health.roadmap_execution_schema,2);
 assert.equal(f.worker.connection.health.resource_tool_schema,undefined);
 await f.switch('B');await f.switch('A');
 capabilities={roadmap_execution_schema:1};
 const reattached=await f.connect('A','reuse','local-reattach');
 assert.equal(reattached.health.roadmap_execution_schema,1);
 assert.equal(f.worker.connection.health.roadmap_execution_schema,1);
 assert.equal(f.preparations.length,0);
});

test('using a hosted resource for a workflow cannot start a missing private service',async t=>{
 const f=fixture(t),registered=f.health('A');
 f.registration.remember(f.profile('A'),registered,{status:'ready',count:1});
 const value=await f.service.useHosted({connectionId:'A',profileId:'profile-A',profileVersion:1,requestId:'choose-workflow',mode:'reuse'});
 assert.equal(value.workflowReady,false);
 assert.equal(value.serviceActive,false);
 assert.equal(f.preparations.length,0);
 assert.equal(f.calls.length,0);
});

test('first setup registers the already running private worker after checking its shipped identity and live health',async t=>{
 const source=path.resolve('backend/worker'),options={profileId:'profile-A',port:25000,transportSource:path.resolve('desktop/platform/terminal-service/python')};
 const f=fixture(t,{prepareResources:async()=>prepareSshServiceResources(source,options)});
 const {expected_runtime_id:runtimeId,runtime_manifest_sha256:digest}=prepareSshServiceResources(source,{...options,reuseOnly:true,verifiedCacheOnly:true}).payload;
 const health={...f.health('A'),runtimeId,runtime:'/owned/A/runtimes/'+runtimeId,runtimeManifestSha256:digest};
 const request=f.connections.serviceRequest;
 f.connections.serviceRequest=async packet=>{
  const reply=await request(packet);
  return packet.target==='/api/health'?{...reply,data:health}:reply;
 };
 f.channels.set('A',{connectionId:'A',profileId:'profile-A',profileVersion:1,attemptId:'hosted',serviceId:'hosted-service',
  status:'connected',serviceActive:true,channelKind:'private',service:health});
 const result=await f.connect();
 assert.equal(result.workflowReady,true);
 assert.equal(result.attemptId,'hosted');
 assert.equal(result.operator,'human');
 assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'configured');
 assert.equal(f.calls.filter(call=>call.open||call.close).length,0);
 assert.ok(f.calls.some(call=>call.request?.target==='/api/health'));
 assert.ok(f.calls.some(call=>call.request?.data?.method==='tools/list'));
});

test('an explicit hosted attachment retires only a superseded, unbound foreground startup',async t=>{
 const f=fixture(t);
 f.connections.openService=async()=>{throw Error('terminal_service_unknown');};
 const previous=await f.connect('A','setup','old-start');
 assert.equal(previous.status,'unknown');
 const live={connectionId:'A',profileId:'profile-A',profileVersion:1,attemptId:'hosted',serviceId:'hosted-service',
  status:'connected',serviceActive:true,channelKind:'private',service:f.health('A')};
 f.channels.set('A',live);
 f.registration.remember(f.profile('A'),live.service,{status:'ready',count:1});
 const cancels=[];
 f.connections.cancelServiceStart=async data=>{cancels.push(data);return {...live,cancelled:true,cancelledAttemptId:data.requestId};};
 const result=await f.service.useHosted({connectionId:'A',profileId:'profile-A',profileVersion:1,requestId:'select-hosted',mode:'reuse'});
 assert.deepEqual(cancels,[{connectionId:'A',requestId:'old-start',supersededBy:'hosted'}]);
 assert.equal(result.workflowReady,true);
 assert.equal(result.attemptId,live.attemptId);
 assert.equal(result.serviceId,live.serviceId);
 assert.equal(result.operator,'human');
 assert.ok(!f.calls.some(call=>call.open||call.close));
});

test('first setup leaves a private service with a different build untouched',async t=>{
 const f=fixture(t,{prepareResources:async()=>({payload:{expected_runtime_id:'b'.repeat(20),runtime_manifest_sha256:'b'.repeat(64),port:25000}})});
 f.channels.set('A',{connectionId:'A',profileId:'profile-A',profileVersion:1,attemptId:'hosted',serviceId:'original',
  status:'connected',serviceActive:true,channelKind:'private',service:{...f.health('A'),runtimeManifestSha256:'a'.repeat(64)}});
 const result=await f.connect();
 assert.equal(result.workflowReady,false);
 assert.equal(result.error.code,'identity_unconfirmed');
 assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'unconfigured');
 assert.equal(f.channels.get('A').serviceId,'original');
 assert.equal(f.calls.length,0);
});

test('an incomplete cancellation receipt never binds another live private generation',async t=>{
 const f=fixture(t);
 f.connections.openService=async()=>{throw Error('terminal_service_unknown');};
 await f.service.connect({connectionId:'A',profileId:'profile-A',profileVersion:1,requestId:'old-start'});
 const live={connectionId:'A',profileId:'profile-A',profileVersion:1,attemptId:'hosted',serviceId:'live-service',
  status:'connected',serviceActive:true,channelKind:'private',service:f.health('A')};
 f.channels.set('A',live);
 f.registration.remember(f.profile('A'),live.service,{status:'ready',count:1});
 f.connections.cancelServiceStart=async()=>({...live,cancelled:true,cancelledAttemptId:'unrelated-start'});
 await assert.rejects(f.service.useHosted({connectionId:'A',profileId:'profile-A',profileVersion:1,requestId:'select',mode:'reuse'}),/context_changed/);
 assert.equal(f.service.peek().attemptId,'old-start');
 assert.equal(f.service.peek().workflowReady,false);
 assert.ok(!f.worker.connection);assert.equal(f.calls.length,0);
});

test('stopping an abandoned startup confirms the exact request and leaves the current private service online',async t=>{
 const f=fixture(t),attemptId='abandoned';
 f.connections.openService=async()=>{throw Error('terminal_service_unknown');};
 assert.equal((await f.connect('A','setup',attemptId)).status,'unknown');
 const live={connectionId:'A',profileId:'profile-A',profileVersion:1,attemptId:'hosted',serviceId:'active-service',
  status:'connected',serviceActive:true,channelKind:'private',service:f.health('A')};
 f.channels.set('A',live);
 f.connections.cancelServiceStart=async data=>{
  assert.deepEqual(data,{connectionId:'A',requestId:attemptId});
  return {...live,cancelled:true,cancelledAttemptId:attemptId};
 };
 const result=await f.service.disconnect({connectionId:'A',attemptId});
 assert.equal(result.status,'disconnected');
 assert.equal(f.channels.get('A').serviceActive,true);
 assert.equal(f.bases.get('A').status,'authenticated');
 assert.equal(f.calls.length,0);
});

test('closing one base removes only its service and never disturbs a different selected pipeline',async t=>{
 const f=fixture(t);await f.connect('A');await f.switch('B');await f.connect('B');f.grant();const worker=f.worker.connection;f.service.connectionClosed('A');assert.equal(f.service.peek({connectionId:'A'}).status,'disconnected');assert.equal(f.service.peek().connectionId,'B');assert.equal(f.worker.connection,worker);assert.equal(f.service.hasCurrentGrant('codex'),true);
});

test('idle status during channel dispatch cannot invalidate the later verified conversation service',async t=>{
 const f=fixture(t),open=f.connections.openService,observe=f.connections.serviceState;
 let release,notify;const gate=new Promise(r=>release=r),started=new Promise(r=>notify=r);
 f.connections.openService=async(...args)=>{notify();await gate;return open(...args);};
 f.connections.serviceState=async data=>f.channels.has(data.connectionId)?observe(data):{connectionId:data.connectionId,status:'idle',serviceActive:false};
 const pending=f.service.connectForConversations({connectionId:'A',profileId:'profile-A',profileVersion:1,requestId:'one',mode:'setup'});
 await started;assert.equal((await f.service.status()).status,'connecting');f.setCurrent({...f.current(),threadId:'different'});release();
 const result=await pending;assert.equal(result.workflowReady,true);assert.equal(result.status,'connected');assert.equal(f.service.hasCurrentGrant('codex'),false);
});
test('unknown service state revokes its grant, preserves the base, and cannot auto-attach or bootstrap',async t=>{
 const f=fixture(t);await f.connect();f.grant();f.channels.get('A').status='unknown';await f.service.status();assert.equal(f.service.peek().status,'unknown');assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.bases.get('A').status,'authenticated');await assert.rejects(f.connect('A','reuse','retry'),/channel_in_use/);assert.equal(f.calls.filter(v=>v.open).length,1);
});

test('explicit workflow attachment rechecks an uncertain original private channel in place',async t=>{
 const f=fixture(t),original=await f.connect();f.grant();
 const channel=f.channels.get('A');channel.channelKind='private';channel.status='unknown';
 assert.equal((await f.service.status()).status,'unknown');
 const use=()=>f.service.useHosted({connectionId:'A',profileId:'profile-A',profileVersion:1,requestId:'use-same-channel',mode:'reuse'});
 assert.equal((await use()).workflowReady,false);
 channel.status='connected';channel.channelKind='borrowed';
 assert.equal((await use()).workflowReady,false);
 channel.channelKind='private';
 const recovered=await use();
 assert.equal(recovered.workflowReady,true);assert.equal(recovered.attemptId,original.attemptId);assert.equal(recovered.serviceId,original.serviceId);
 assert.equal(recovered.operator,'human');assert.equal(f.service.hasCurrentGrant('codex'),false);
 assert.equal(f.calls.filter(call=>call.open).length,1);assert.equal(f.calls.filter(call=>call.close||call.cancel).length,0);
});

test('exact attempt and full caller context fence service grants independently of any terminal owner epoch',async t=>{
 const f=fixture(t);await f.connect();const current={provider:'codex',threadId:'thread',taskId:'task',projectId:'project',environmentId:'env',inputRoot:'/owned/input'};f.setCurrent(current);f.grant();assert.equal(f.service.hasCurrentGrant('codex',current),true);for(const key of ['threadId','taskId','projectId','environmentId','inputRoot'])assert.equal(f.service.hasCurrentGrant('codex',{...current,[key]:'changed'}),false);assert.throws(()=>f.service.owner({connectionId:'A',attemptId:'old',owner:'human'}));assert.throws(()=>f.service.owner({sessionId:'legacy',attemptId:'attempt-A',owner:'human'}));
});

test('late check after base closure cannot revive the old service or refresh registration',async t=>{
 const f=fixture(t);await f.connect();f.grant();const gate=f.delayHealth(),pending=f.service.check({connectionId:'A',attemptId:'attempt-A'});await gate.started;f.service.connectionClosed('A');gate.release();await pending;assert.equal(f.service.peek().status,'disconnected');assert.equal(f.worker.connection,null);assert.equal(f.service.hasCurrentGrant('codex'),false);
});

test('first authoring context enrichment transfers only the same conversation service grant and expires old provider tokens',async t=>{
 const f=fixture(t);await f.connect();f.grant();const before=f.worker.providerConnection('codex'),ticket=f.service.prepareAuthoringGrant(null);assert(ticket);const task={id:'task',provider:'codex',threadId:'thread',authoring:{projectId:'project',environmentId:'env',inputRoot:'/owned/input'}};f.setCurrent({...f.current(),taskId:'task',projectId:'project',environmentId:'env',inputRoot:'/owned/input'});assert.equal(f.service.completeAuthoringGrant(ticket,task),true);assert.equal(f.service.hasCurrentGrant('codex',f.current()),true);assert.notEqual(f.worker.providerConnection('codex').tokens.mcp,before.tokens.mcp);
});

test('trusted context synchronization permanently invalidates a switched-away service grant',async t=>{
 const f=fixture(t);await f.connect();f.grant();const original=f.current();f.setCurrent({...original,threadId:'other'});f.service.reconcileContext();f.setCurrent(original);assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.service.peek().operator,'human');
});

test('base loss reports unknown instead of user closure and never revives its old grant',async t=>{
 const f=fixture(t);await f.connect();f.grant();f.service.connectionLost('A');assert.equal(f.service.peek().status,'unknown');assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.worker.connection,null);assert.equal(f.channels.get('A').status,'connected','no close or cancellation was fabricated');await assert.rejects(f.connect('A','reuse','recovery'),/channel_in_use/);
});

test('after a recovered master, both explicit checks can reattach the original private service locally',async t=>{
 const f=fixture(t),original=await f.connect(),reference={connectionId:'A',attemptId:original.attemptId};
 f.channels.get('A').channelKind='private';
 for(const check of [()=>f.service.check(reference),()=>f.service.useHosted({connectionId:'A',profileId:'profile-A',profileVersion:1,requestId:'explicit-workflow',mode:'reuse'})]){
  f.grant();f.service.connectionLost('A');
  assert.equal((await f.service.status()).workflowReady,false);
  assert.equal(f.worker.connection,null);
  const checked=await check();
  assert.equal(checked.workflowReady,true);assert.equal(checked.attemptId,original.attemptId);assert.equal(checked.serviceId,original.serviceId);
  assert.equal(checked.operator,'human');assert.equal(f.service.hasCurrentGrant('codex'),false);
 }
 assert.equal(f.preparations.length,1);assert.equal(f.calls.filter(v=>v.open).length,1);assert.equal(f.calls.filter(v=>v.close||v.cancel).length,0);
});

test('a detached foreground check only restores the exact still-live private generation',async t=>{
 const f=fixture(t),original=await f.connect(),reference={connectionId:'A',attemptId:original.attemptId},channel=f.channels.get('A');
 f.service.connectionLost('A');
 for(const patch of [{channelKind:'borrowed'},{channelKind:'private',attemptId:'replacement'},{channelKind:'private',serviceActive:false}]){
  Object.assign(channel,{attemptId:original.attemptId,serviceActive:true},patch);
  const checked=await f.service.check(reference);assert.equal(checked.workflowReady,false);assert.equal(f.worker.connection,null);
 }
 Object.assign(channel,{channelKind:'private',attemptId:original.attemptId,serviceActive:true});
 const gate=f.delayHealth(),pending=f.service.check(reference);await gate.started;
 await f.switch('B');gate.release();await pending;
 assert.equal(f.worker.connection,null);assert.equal(f.service.hasCurrentGrant('codex'),false);
 assert.equal(f.calls.filter(v=>v.open).length,1);assert.equal(f.calls.filter(v=>v.close||v.cancel).length,0);
});

test('a registration changed during detached recovery retains its newer state',async t=>{
 const f=fixture(t),original=await f.connect(),ref={connectionId:'A',attemptId:original.attemptId};
 f.channels.get('A').channelKind='private';f.service.connectionLost('A');
 const tools=f.worker.probeTools.bind(f.worker);
 f.worker.probeTools=async()=>{const result=await tools();f.registration.markMaintenance(f.profile('A'),'namespace_unsafe');return result;};
 const checked=await f.service.check(ref);
 assert.equal(checked.workflowReady,false);assert.equal(f.worker.connection,null);
 assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).reason,'namespace_unsafe');
 assert.equal(f.calls.filter(c=>c.open).length,1);
});
