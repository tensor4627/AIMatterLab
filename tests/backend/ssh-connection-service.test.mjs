import test from 'node:test';
import assert from 'node:assert/strict';
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

test('closing one base removes only its service and never disturbs a different selected pipeline',async t=>{
 const f=fixture(t);await f.connect('A');await f.switch('B');await f.connect('B');f.grant();const worker=f.worker.connection;f.service.connectionClosed('A');assert.equal(f.service.peek({connectionId:'A'}).status,'disconnected');assert.equal(f.service.peek().connectionId,'B');assert.equal(f.worker.connection,worker);assert.equal(f.service.hasCurrentGrant('codex'),true);
});

test('unknown service state revokes its grant, preserves the base, and cannot auto-attach or bootstrap',async t=>{
 const f=fixture(t);await f.connect();f.grant();f.channels.get('A').status='unknown';await f.service.status();assert.equal(f.service.peek().status,'unknown');assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.bases.get('A').status,'authenticated');await assert.rejects(f.connect('A','reuse','retry'),/channel_in_use/);assert.equal(f.calls.filter(v=>v.open).length,1);
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
