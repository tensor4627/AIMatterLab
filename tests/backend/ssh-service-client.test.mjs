import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSshServiceHealth} from '../../backend/main/compute/ssh-service.mjs';
import {connectionServiceFixture as fixture} from '../helpers/ssh-connection-service-fixture.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('verified service uses a real loopback provider proxy and the exact independent service channel',async t=>{
 const f=fixture(t),result=await f.connect();assert.equal(result.workflowReady,true);assert.equal(result.tools.status,'ready');assert.equal(f.worker.connectionTarget.connectionId,'A');assert.equal(f.worker.connectionTarget.serviceId,'service-A');
 const endpoint=f.worker.providerConnection('codex');assert.match(endpoint.url,/^http:\/\/127\.0\.0\.1:\d+\/providers\/codex$/);assert.equal(endpoint.tokens.admin,undefined);assert(!JSON.stringify(result).includes('tokens'));
 assert(f.calls.filter(v=>v.request).every(v=>v.request.connectionId==='A'&&v.request.serviceId==='service-A'&&v.request.sessionId===undefined));
 await f.service.disconnect({connectionId:'A',attemptId:'attempt-A'});assert.equal(f.worker.connection,null);assert.equal(f.bases.get('A').authentication,'verified');
});

test('a delayed open cannot attach to a changed conversation or manufacture service registration',async t=>{
 const f=fixture(t),gate=deferred(),entered=deferred(),open=f.connections.openService;f.connections.openService=async(...args)=>{entered.resolve();await gate.promise;return open(...args);};const pending=f.connect();await entered.promise;f.setCurrent({...f.current(),threadId:'other'});gate.resolve();const result=await pending;assert.equal(result.status,'unknown');assert.equal(result.workflowReady,false);assert.equal(f.worker.connection??null,null);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'unconfigured');
});

test('a service command error is unknown and is never replayed through another channel',async t=>{
 const f=fixture(t);await f.connect();let attempts=0;const request=f.connections.serviceRequest;f.connections.serviceRequest=async packet=>{if(packet.target==='/api/cluster/submit'){attempts++;throw Error('ssh_service_response_unknown');}return request(packet);};await assert.rejects(f.worker.request('POST','/api/cluster/submit',{fixture:'never a real job'}),/response_unknown/);assert.equal(attempts,1);assert.equal(f.service.peek().status,'unknown');assert.equal(f.service.peek().workflowReady,false);assert.equal(f.bases.get('A').status,'authenticated');
});

test('health projection excludes credentials and rejects invalid host identity',()=>{const raw={name:'gpu-sampling-studio',root:'/owned',runtime:'/owned/runtime',runtimeId:'a'.repeat(20),port:23456,execution_policy:'desktop-review-v1',hostIdentity:{hostname:'owned',uid:1000,machineId:'owned'}};assert(!JSON.stringify(normalizeSshServiceHealth({...raw,tokens:{admin:'PRIVATE'},secret:'PRIVATE'})).includes('PRIVATE'));assert.throws(()=>normalizeSshServiceHealth({...raw,hostIdentity:{...raw.hostIdentity,uid:-1}}),/identity_unavailable/);});

test('closing background A does not prevent B attachment or tear down B when the late close completes',async t=>{
 const f=fixture(t);await f.connect('A');const gate=deferred(),entered=deferred(),close=f.connections.closeService;f.connections.closeService=async data=>{entered.resolve();await gate.promise;return close(data);};const pending=f.service.disconnect({connectionId:'A',attemptId:'attempt-A'});await entered.promise;await f.switch('B');assert.equal((await f.connect('B')).workflowReady,true);const active=f.worker.connection;gate.resolve();await pending;assert.equal(f.service.peek().connectionId,'B');assert.equal(f.worker.connection,active);assert.equal(f.service.peek({connectionId:'A'}).status,'disconnected');
});

for(const [label,patch] of [['hostname',{hostIdentity:{hostname:'other',uid:1000,machineId:'owned-A'}}],['uid',{hostIdentity:{hostname:'owned-A',uid:1001,machineId:'owned-A'}}],['machineId',{hostIdentity:{hostname:'owned-A',uid:1000,machineId:'other'}}],['runtimeId',{runtimeId:'b'.repeat(20)}],['runtime',{runtime:'/other/runtime'}],['root',{root:'/other/root'}],['port',{port:25001}],['name',{name:'other'}],['execution_policy',{execution_policy:'other'}]])test('actual health readback rejects changed '+label+' before tool exposure or registration',async t=>{
 const f=fixture(t),request=f.connections.serviceRequest;f.connections.serviceRequest=packet=>packet.target==='/api/health'?Promise.resolve({status:200,data:{...f.health('A'),...patch}}):request(packet);const result=await f.connect();assert.equal(result.status,'unknown');assert.equal(result.workflowReady,false);assert.equal(f.worker.connection??null,null,'No local client is attached');assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'unconfigured');assert(!f.calls.some(v=>v.request?.target==='/mcp'));
});
