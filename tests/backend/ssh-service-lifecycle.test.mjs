import __node_test, {describe as __describe} from 'node:test';
import assert from "node:assert/strict";
import {connectionServiceFixture as _imp_0_fixture} from "../helpers/ssh-connection-service-fixture.mjs";
import {normalizeSshServiceHealth} from "../../backend/main/compute/ssh-service.mjs";
import {safeSshServiceError, safeSshServiceProgress} from "../../backend/main/compute/ssh-service-state.mjs";
import fs from "node:fs";
import ts from "typescript";
import {McpProviderScopes} from "../../agent/tools/provider-scope.mjs";
import {updateDraftWorker} from "../../backend/main/workspace/update-draft-worker.mjs";
import {stableSshWorkerBinding, assertTaskWorker} from "../../contracts/compute/task-worker-binding.mjs";

await __describe("ssh-service-lifecycle", async () => {
const test = __node_test;
const fixture = _imp_0_fixture;
const release=f=>{const state=f.service.peek();return f.service.disconnect({connectionId:state.connectionId,attemptId:state.attemptId});};
test('verified setup persists connection service evidence but never persists live use authority',async t=>{const f=fixture(t);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'unconfigured');const state=await f.connect();assert.equal(state.operator,'human');assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'configured');assert.equal(f.grant().operator,'agent');const stored=JSON.stringify(f.registration.read({profileId:'profile-A',profileVersion:1}).registration);assert(!stored.includes('attempt-A'));assert(!stored.includes('service-A'));assert(!stored.includes('thread'));});
test('confirmed service disconnect preserves registration and reuse retains exact pinned runtime and port',async t=>{const f=fixture(t);await f.connect();f.grant();await release(f);const result=await f.connect('A','reuse','daily');assert.equal(result.operator,'human');assert.equal(result.attemptId,'daily');assert.equal(f.calls.filter(v=>v.open).at(-1).bootstrap.reuseOnly,true);assert.equal(f.preparations.at(-1).expectedRuntimeId,f.health('A').runtimeId);assert.equal(f.preparations.at(-1).port,f.health('A').port);});
test('unconfirmed service stop does not affect the independent base or silently allow another service attempt',async t=>{const f=fixture(t);await f.connect();f.connections.closeService=async()=>({...f.channels.get('A'),status:'unknown',serviceActive:true});const result=await release(f);assert.equal(result.status,'unknown');assert.equal(f.bases.get('A').status,'authenticated');f.service.terminalClosed('shell');assert.equal(f.service.peek().status,'unknown');await assert.rejects(f.connect('A','reuse','unsafe'),/channel_in_use/);});
test('unconfigured reuse stops before preparing sources or launching a channel',async t=>{const f=fixture(t),result=await f.connect('A','reuse');assert.equal(result.status,'failed');assert.equal(result.error.code,'registration_required');assert.equal(f.calls.length,0);assert.equal(f.preparations.length,0);});
test('missing registered runtime requires maintenance and cannot fall back to setup',async t=>{const f=fixture(t);await f.connect();await release(f);let opens=0;f.connections.openService=async(data,bootstrap)=>{opens++;assert.equal(bootstrap.reuseOnly,true);return {...f.channels.get('A'),attemptId:data.requestId,status:'failed',serviceActive:false,error:{code:'maintenance_required',phase:'checking_cache'}};};const result=await f.connect('A','reuse','missing');assert.equal(result.error.code,'maintenance_required');assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'maintenance_required');assert.equal(opens,1);});
test('only explicit update chooses shipped worker source and a later reuse stays pinned',async t=>{const f=fixture(t);await f.connect();await release(f);await f.connect('A','update','updated');assert.equal(f.preparations.at(-1).expectedRuntimeId,undefined);assert.equal(f.calls.filter(v=>v.open).at(-1).bootstrap.reuseOnly,undefined);await release(f);await f.connect('A','reuse','daily');assert.equal(f.preparations.at(-1).expectedRuntimeId,'a'.repeat(20));});
test('a changed host cannot refresh saved evidence, grant use or silently replace the worker source',async t=>{const f=fixture(t);await f.connect();await release(f);const before=f.registration.read({profileId:'profile-A',profileVersion:1}).registration,open=f.connections.openService;f.connections.openService=async(...args)=>{const v=await open(...args);v.service.hostIdentity.machineId='other';return v;};const result=await f.connect('A','reuse','wrong-host');assert.equal(result.workflowReady,false);assert.equal(result.error.code,'identity_unconfirmed');const after=f.registration.read({profileId:'profile-A',profileVersion:1});assert.equal(after.status,'maintenance_required');assert.deepEqual(after.registration.hostIdentity,before.hostIdentity);assert.equal(after.registration.checkedAt,before.checkedAt);});
test('an incomplete tool inventory is a warning while the verified service registration remains reusable',async t=>{const f=fixture(t);f.worker.probeTools=async()=>({status:'blocked',count:0});const value=await f.connect();assert.equal(value.workflowReady,true);assert(value.warnings.includes('tools_unavailable'));assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'configured');});
test('explicit health and tool check retains an unchanged grant without reopening a channel',async t=>{const f=fixture(t);await f.connect();f.grant();const before=f.registration.read({profileId:'profile-A',profileVersion:1}).registration;const result=await f.service.check({connectionId:'A',attemptId:'attempt-A'});assert.equal(result.operator,'agent');assert.equal(f.calls.filter(v=>v.open).length,1);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).registration.revision,before.revision+1);});
test('a stale check is rejected and an actual service identity change revokes only service usage',async t=>{const f=fixture(t);await f.connect();f.grant();await assert.rejects(f.service.check({connectionId:'A',attemptId:'stale'}),/context_changed/);const request=f.connections.serviceRequest;f.connections.serviceRequest=packet=>packet.target==='/api/health'?Promise.resolve({status:200,data:{...f.health('A'),port:25001}}):request(packet);const result=await f.service.check({connectionId:'A',attemptId:'attempt-A'});assert.equal(result.status,'unknown');assert.equal(result.error.code,'identity_unconfirmed');assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.bases.get('A').authentication,'verified');});
test('service activation is copied only from the selected saved connection recipe',async t=>{const f=fixture(t),read=f.profiles.read,environment={python:'/owned/python',activation:'source /owned/conda.sh\nconda activate fixture'};f.profiles.read=value=>({...read(value),serviceEnvironment:environment});await f.connect();const bootstrap=f.calls.find(v=>v.open).bootstrap;assert.deepEqual(bootstrap.serviceEnvironment,environment);assert.notEqual(bootstrap.serviceEnvironment,environment);assert(!JSON.stringify(f.service.peek()).includes(environment.activation));});
test('active service cannot claim a new setup or update succeeded without explicit channel maintenance',async t=>{const f=fixture(t);await f.connect();await assert.rejects(f.connect('A','update','new-update'),/channel_in_use/);await assert.rejects(f.connect('A','setup','new-setup'),/channel_in_use/);assert.equal(f.calls.filter(v=>v.open).length,1);const checks=f.calls.filter(v=>v.request?.target==='/api/health').length;await f.connect('A','reuse','explicit-check');assert(f.calls.filter(v=>v.request?.target==='/api/health').length>checks);});
});

await __describe("ssh-service-client", async () => {
const test = __node_test;
const fixture = _imp_0_fixture;
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
});

await __describe("ssh-service-progress", async () => {
const test = __node_test;
const connectionServiceFixture = _imp_0_fixture;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
test('an older failed observation cannot revoke a newer healthy service and Agent token',async t=>{const f=connectionServiceFixture(t);await f.connect();f.grant();const old=deferred();let count=0;f.connections.serviceState=()=>++count===1?old.promise:Promise.resolve(structuredClone(f.channels.get('A')));const pending=f.service.status();assert.equal((await f.service.status()).workflowReady,true);old.reject(Error('terminal_service_unknown'));assert.equal((await pending).status,'connected');assert.equal(f.service.hasCurrentGrant('codex'),true);});
test('a status transport failure during an active verified request does not invalidate its MCP credential',async t=>{const f=connectionServiceFixture(t);await f.connect();f.grant();const entered=deferred(),finish=deferred(),original=f.connections.serviceRequest;f.connections.serviceRequest=async p=>{if(p.target==='/api/clusters'){entered.resolve();await finish.promise;}return original(p);};const request=f.worker.request('GET','/api/clusters');await entered.promise;f.connections.serviceState=async()=>{throw Error('terminal_service_unknown');};assert.equal((await f.service.status()).status,'connected');assert.equal(f.service.hasCurrentGrant('codex'),true);finish.resolve();assert.deepEqual(await request,[]);assert.equal(f.service.peek().workflowReady,true);});
test('a confirmed identity failure still revokes service use even with another request pending',async t=>{const f=connectionServiceFixture(t);await f.connect();f.grant();const entered=deferred(),finish=deferred(),original=f.connections.serviceRequest;f.connections.serviceRequest=async p=>{if(p.target==='/api/clusters'){entered.resolve();await finish.promise;}return original(p);};const request=f.worker.request('GET','/api/clusters');await entered.promise;f.connections.serviceState=async()=>{throw Error('ssh_master_identity_changed');};assert.equal((await f.service.status()).status,'unknown');assert.equal(f.service.hasCurrentGrant('codex'),false);finish.resolve();await request;});
function fixture(t){
 const f=connectionServiceFixture(t),start=deferred(),entered=deferred(),originalOpen=f.connections.openService,calls=[];
 let view={connectionId:'A',profileId:'profile-A',profileVersion:1,attemptId:'attempt-A',status:'connecting',serviceId:'service-A',serviceActive:true,phase:'waiting_python'};
 f.connections.openService=async()=>{entered.resolve();return start.promise;};f.connections.serviceState=async()=>structuredClone(view);
 f.connections.cancelServiceStart=async data=>{calls.push(data);view={...view,status:'disconnected',serviceActive:false};return {...view,cancelled:true,cancelledAttemptId:data.requestId};};
 return {...f,start,entered:entered.promise,cancelCalls:calls,originalOpen,setView:v=>{view={...view,...v};},view:()=>structuredClone(view),ready:()=>{view={...view,status:'connected',serviceActive:true,phase:'ready',service:f.health('A')};f.channels.set('A',view);start.resolve(view);}};
}
test('observed service phases and ACK progress are separate from shell state and do not expose raw diagnostics',async t=>{const f=fixture(t),pending=f.connect();await f.entered;f.setView({phase:'transferring_worker',progress:{kind:'transfer',completedBytes:2048,totalBytes:8000},error:{code:'permission_denied',phase:'preparing_runtime',errno:13,secret:'PRIVATE'}});const state=await f.service.status();assert.equal(state.phase,'transferring_worker');assert.deepEqual(state.progress,{kind:'transfer',completedBytes:2048,totalBytes:8000});assert.equal(state.terminalAccess,undefined);assert(!JSON.stringify(state).includes('PRIVATE'));f.ready();assert.equal((await pending).workflowReady,true);});
test('known service startup rejection permits explicit retry while the authenticated base stays available',async t=>{const f=fixture(t),pending=f.connect();await f.entered;f.start.resolve({...f.view(),status:'failed',serviceActive:false,error:{code:'python_unsupported',phase:'waiting_python',python:[3,8,1],traceback:'PRIVATE'}});const state=await pending;assert.equal(state.status,'failed');assert.equal(state.serviceActive,false);assert.equal(state.error.code,'python_unsupported');assert.equal(state.terminalAccess,undefined);assert(!JSON.stringify(state).includes('PRIVATE'));assert.equal(f.bases.get('A').status,'authenticated');f.connections.openService=f.originalOpen;assert.equal((await f.connect('A','setup','new-attempt')).workflowReady,true);});
test('unknown startup never opens a second service channel and does not lock the independent shell',async t=>{const f=fixture(t),pending=f.connect();await f.entered;f.start.resolve({...f.view(),status:'failed',serviceActive:true,error:{code:'service_start_unknown',phase:'checking_cache'}});const state=await pending;assert.equal(state.status,'unknown');assert.equal(state.error.code,'startup_timeout');assert.equal(state.error.phase,'checking_cache');assert.equal(state.terminalAccess,undefined);await assert.rejects(f.connect('A','setup','unsafe-repeat'),/channel_in_use/);assert.equal(f.cancelCalls.length,0);});
test('late service observations cannot rewind a newer phase or completed tools handshake',async t=>{const f=fixture(t),pending=f.connect();await f.entered;const a=deferred(),b=deferred();let count=0;f.connections.serviceState=()=>++count===1?a.promise:b.promise;const old=f.service.status(),next=f.service.status();b.resolve({...f.view(),phase:'starting_worker'});assert.equal((await next).phase,'starting_worker');a.resolve({...f.view(),phase:'waiting_python'});assert.equal((await old).phase,'starting_worker');const late=deferred();f.connections.serviceState=()=>late.promise;const stale=f.service.status();f.ready();assert.equal((await pending).status,'connected');late.resolve({...f.view(),phase:'checking_cache'});assert.equal((await stale).phase,'ready');});
test('cancellation fences the exact connection attempt and cannot revive after a late bootstrap result',async t=>{const f=fixture(t),pending=f.connect();pending.catch(()=>{});await f.entered;await assert.rejects(f.service.disconnect({connectionId:'A',attemptId:'other'}),/context_changed/);assert.equal(f.cancelCalls.length,0);const stopped=await f.service.disconnect({connectionId:'A',attemptId:'attempt-A'});assert.equal(stopped.status,'disconnected');assert.equal(stopped.connectionId,'A');assert.equal(stopped.attemptId,'attempt-A');f.ready();await assert.rejects(pending,/context_changed/);assert.equal(f.service.peek().status,'disconnected');});
test('unconfirmed cancellation marks only service unknown and never manufactures a user-closed connection',async t=>{const f=fixture(t),pending=f.connect();pending.catch(()=>{});await f.entered;f.connections.cancelServiceStart=async()=>{throw Error('service_stop_unknown');};const result=await f.service.disconnect({connectionId:'A',attemptId:'attempt-A'});assert.equal(result.status,'unknown');assert.equal(result.error.code,'stop_timeout');assert.equal(result.terminalAccess,undefined);assert.equal(f.bases.get('A').status,'authenticated');f.start.reject(Error('original attempt stopped'));await assert.rejects(pending);assert.equal(f.service.peek().status,'unknown');});
test('a channel validation failure retains its bounded reason without changing the base channel',async t=>{const f=fixture(t),pending=f.connect();await f.entered;f.start.reject(Error('terminal_service_failed'));const state=await pending;assert.equal(state.error.code,'protocol_failed');assert.equal(state.status,'unknown');assert.equal(f.bases.get('A').authentication,'verified');});
test('read-only refreshes of the same failure do not fabricate a new revision or finish time',async t=>{const f=fixture(t),pending=f.connect();await f.entered;f.setView({status:'failed',error:{code:'service_start_unknown',phase:'waiting_python'}});f.start.resolve(f.view());await pending;const a=await f.service.status(),b=await f.service.status();assert.equal(a.revision,b.revision);assert.equal(a.updatedAt,b.updatedAt);});
test('safe diagnostics and progress reject raw secrets and invented percentages',()=>{assert.deepEqual(safeSshServiceError({code:'private /path',phase:'fake',python:[3,9,25],sqlite:[3,45,2],token:'PRIVATE'},'starting_worker'),{code:'connection_unconfirmed',phase:'starting_worker',python:[3,9,25],sqlite:[3,45,2]});assert.equal(safeSshServiceProgress({kind:'transfer',completedBytes:9,totalBytes:8}),undefined);assert.equal(safeSshServiceProgress({kind:'overall',completedBytes:1,totalBytes:2}),undefined);for(const code of ['PRIVATE /auth','terminal_owner_changed PRIVATE','terminal_invalid_request: /private','constructor','toString','__proto__'])assert.equal(safeSshServiceError(code,'waiting_python').code,'connection_unconfirmed');});
});

await __describe("ssh-service-selection", async () => {
const test = __node_test;
const fixture = _imp_0_fixture;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test('selecting B preserves A authenticated base and service channel while detaching only A local proxy',async t=>{const f=fixture(t);await f.connect('A');f.grant();await f.switch('B');assert.equal(f.channels.get('A').status,'connected');assert.equal(f.bases.get('A').status,'authenticated');assert.equal(f.worker.connection,null);assert.equal((await f.connect('B')).workflowReady,true);assert.equal(f.calls.filter(v=>v.open).length,2);assert.equal(f.calls.filter(v=>v.close).length,0);});
test('a local proxy close preserves the verified independent channel for explicit same-instance reuse',async t=>{const f=fixture(t);await f.connect();f.worker.close();assert.equal(f.service.peek().status,'connected');assert.equal(f.service.peek().workflowReady,false);assert.equal((await f.connect('A','reuse','local-reattach')).workflowReady,true);assert.equal(f.calls.filter(v=>v.open).length,1);assert.equal(f.preparations.length,1);});
test('closing the visible shell during service startup does not invalidate that independent startup',async t=>{const f=fixture(t),gate=deferred(),entered=deferred(),open=f.connections.openService;f.connections.openService=async(...args)=>{entered.resolve();await gate.promise;return open(...args);};const pending=f.connect();await entered.promise;f.service.terminalClosed('visible-shell');gate.resolve();assert.equal((await pending).workflowReady,true);assert.equal(f.service.peek().status,'connected');});
test('closing the whole connection during startup fences its late acknowledgement without changing another pipeline',async t=>{const f=fixture(t),gate=deferred(),entered=deferred(),open=f.connections.openService;f.connections.openService=async(...args)=>{entered.resolve();await gate.promise;return open(...args);};const pending=f.connect();await entered.promise;f.service.connectionClosed('A');gate.resolve();await assert.rejects(pending,/context_changed/);assert.equal(f.service.peek().status,'disconnected');assert.equal(f.worker.connection??null,null);});

function resourceHandler(method,calls){
 const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8'),tree=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let callback,idleGuard,changeResource,publishResource;
 function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='assertLegacyWorkerIdle')idleGuard=node.getText(tree);if(ts.isFunctionDeclaration(node)&&node.name?.text==='changeComputeResource')changeResource=node.getText(tree);if(ts.isFunctionDeclaration(node)&&node.name?.text==='publishComputeResourceChange')publishResource=node.getText(tree);if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='handle'){const route=node.arguments[0];if(route&&ts.isBinaryExpression(route)&&ts.isStringLiteral(route.left)&&route.left.text==='compute.resource.'&&ts.isIdentifier(route.right)&&route.right.text==='method')callback=node.arguments[1].getText(tree);}ts.forEachChild(node,visit);}visit(tree);assert(callback);assert(idleGuard);assert(changeResource);assert(publishResource);
 let revision=0,selection={schemaVersion:2,kind:'ssh-connection',connectionId:'A',profileId:'profile-A',profileVersion:1};
 const computeResource={capture:()=>({revision,selection}),activate:async v=>{calls.push(['activate',v]);selection=v;revision++;return v;},clear:async v=>{calls.push(['clear',v]);selection=null;revision++;return v;}},sshService={resourceChanged:async()=>calls.push(['detach-local-only']),disconnect:()=>assert.fail('Resource selection cannot disconnect remote service')};
 const ports={method,agents:{turnStates:()=>[],active:'codex'},sshService,computeResource,
  conversationTerminals:{detachConnection:id=>calls.push(['detach-legacy-shells',id])},worker:{revokeProvider:p=>calls.push(['revoke-service',p])},
  terminalMcp:{revokeProvider:p=>calls.push(['revoke-shell-scope',p])},emit:()=>{},scientificTools:async()=>({})};
 return new Function(...Object.keys(ports),idleGuard+'\n'+publishResource+'\n'+changeResource+'\nreturn ('+callback+');')(...Object.values(ports));
}
for(const method of ['activate','clear'])test('actual main '+method+' revokes only local usage without a remote stop prerequisite',async()=>{const calls=[];await resourceHandler(method,calls)(method==='activate'?{schemaVersion:2,kind:'ssh-connection',connectionId:'B',profileId:'profile-B',profileVersion:1}:{selectionId:'selection'});assert.equal(calls[0][0],method);assert.deepEqual(calls.filter(v=>v[0]==='detach-legacy-shells'),[['detach-legacy-shells','A']]);assert.equal(calls.filter(v=>v[0]==='detach-local-only').length,1);assert.equal(calls.filter(v=>v[0]==='revoke-service').length,5);});
});

await __describe("ssh-service-local-rejection", async () => {
const test = __node_test;
const fixture = _imp_0_fixture;
test('a proven predispatch rejection retires only the empty service attempt without sending STOP',async t=>{const f=fixture(t);f.connections.openService=async()=>{throw Object.assign(Error('terminal_owner_changed'),{serviceNotStarted:true});};f.connections.cancelServiceStart=()=>assert.fail('No service start was dispatched');const result=await f.connect();assert.equal(result.status,'failed');assert.equal(result.serviceActive,false);assert.equal(result.phase,'preparing_local');assert.equal(result.error.code,'context_changed');assert.equal((await f.service.disconnect({connectionId:'A',attemptId:'attempt-A'})).status,'disconnected');assert.equal(f.bases.get('A').authentication,'verified');});
test('the same rejection without trusted predispatch proof remains an unknown service capability',async t=>{const f=fixture(t);f.connections.openService=async()=>{throw Error('terminal_owner_changed');};const result=await f.connect();assert.equal(result.status,'unknown');assert.equal(result.serviceActive,true);assert.equal(result.terminalAccess,undefined);assert.equal(f.bases.get('A').status,'authenticated');});
test('an unauthenticated base is rejected before preparing or launching any service',async t=>{const f=fixture(t);f.bases.get('A').authentication='not_observed';const result=await f.connect();assert.equal(result.status,'failed');assert.equal(result.serviceActive,false);assert.equal(f.preparations.length,0);assert.equal(f.calls.length,0);});
});

await __describe("ssh-service-main-switch", async () => {
const test = __node_test;
const connectionServiceFixture = _imp_0_fixture;
const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8'),tree=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function callback(route){let found;function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(tree)==='handle'&&node.arguments[0]?.text===route)found=node.arguments[1].getText(tree);ts.forEachChild(node,visit);}visit(tree);assert(found,'actual main handler '+route);return found;}
function resourceRegistrations(){let found;function visit(node){if(ts.isForOfStatement(node)&&node.getText(tree).includes("handle('compute.resource.'+method"))found=node.getText(tree);ts.forEachChild(node,visit);}visit(tree);assert(found,'actual main resource switch registration');return found;}
function findIdleGuard(node){
 if(ts.isFunctionDeclaration(node)&&node.name?.text==='assertLegacyWorkerIdle')return node;
 return ts.forEachChild(node,findIdleGuard);
}
function findFunction(node,name){
 if(ts.isFunctionDeclaration(node)&&node.name?.text===name)return node;
 return ts.forEachChild(node,child=>findFunction(child,name));
}
const idleGuard=findIdleGuard(tree);assert(idleGuard,'actual workbench worker idle guard');
const publishResourceFn=findFunction(tree,'publishComputeResourceChange');assert(publishResourceFn,'actual compute resource change publisher');
const changeResourceFn=findFunction(tree,'changeComputeResource');assert(changeResourceFn,'actual compute resource switch function');
function mount(route,{selected,resourceStatus,service,worker,serviceStatus='connected',usesLegacyWorker=false}={}){
 const calls=[],handlers=new Map();let selection=selected,revision=1;
 const peer={provider:'kimi',threadId:'parallel-chat',busy:true,sessionId:'peer-session'};
 const scopes=new McpProviderScopes(),gateway={url:'http://127.0.0.1:43210',tokens:{mcp:'synthetic-gateway'},transport:'desktop-terminal'};
 scopes.bind(gateway);scopes.bindContext(peer.provider,{threadId:peer.threadId},{sessionId:peer.sessionId});
 const lease=scopes.connection(peer.provider,gateway,peer.sessionId);
 const peerScope=()=>scopes.authenticate({pathname:new URL(lease.url).pathname+'/mcp',host:new URL(lease.url).host,authorization:'Bearer '+lease.tokens.mcp});
 const computeResource={peek:()=>selection,...resourceStatus?{status:async()=>resourceStatus}:{},capture:()=>({revision,selection:structuredClone(selection)}),clear:({selectionId})=>{assert.equal(selectionId,selection.selectionId);calls.push('explicit-clear');selection=null;revision++;return {status:'none'};}};
 const ports={
  computeResource,
  sshService:service||{peek:()=>({status:serviceStatus}),resourceChanged:async()=>calls.push('resource-changed'),disconnect:()=>assert.fail('Resource selection cannot stop SSH')},
  computeConnection:{connect:async()=>{calls.push('connect-profile');return 'profile';}},
  agents:{active:'codex',turnStates:()=>{calls.push('idle');return [peer];},sessionIdentity:(provider,threadId)=>{
   assert.equal(provider,peer.provider);assert.equal(threadId,peer.threadId);return {id:peer.sessionId};
  },assertContextIdle:()=>assert.fail('An unrelated active reply cannot block a worker switch'),close:()=>assert.fail('An unrelated active reply must survive a worker switch')},
  resourceRouting:{usesForegroundWorker:id=>{assert.equal(id,peer.sessionId);return usesLegacyWorker;}},
  conversationTerminals:{detachConnection:connectionId=>calls.push(['detach',connectionId])},
  terminalMcp:{revokeProvider:(provider,sessionId)=>scopes.revoke(provider,sessionId)},scientificTools:async()=>({status:'blocked'}),
  settings:{distribution:'owned'},worker:worker||{revokeProvider:()=>{},connect:async()=>{calls.push('connect-worker');return 'worker';}},
  workerSource:'/owned',explicitWorkerReceipt:()=>({}),bindSources:async()=>calls.push('bind-sources'),rememberExplicitWorker:async()=>calls.push('remember'),
  catalog:{},discoverCompute:()=>calls.push('discover'),managedWorkbench:{publishLocal:async active=>{assert.equal(active,ports.worker);calls.push('publish-local');}},
  emit:()=>calls.push('emit'),handle:(name,handler)=>handlers.set(name,handler)
 };
 if(worker){worker.connect=async()=>{calls.push('connect-worker');return 'worker';};}
 const run=new Function(...Object.keys(ports),idleGuard.getText(tree)+'\n'+publishResourceFn.getText(tree)+'\n'+changeResourceFn.getText(tree)+'\n'+resourceRegistrations()+'\nreturn ('+callback(route)+');')(...Object.values(ports));
 return {calls,run,peerScope,selection:()=>selection,clear:()=>handlers.get('compute.resource.clear')({selectionId:selection.selectionId})};
}
for(const route of ['compute.connection.connect','worker.connect'])for(const state of ['connected','unknown','legacy'])test('actual '+route+' requires explicit resource clear for selected '+state+' SSH and never stops it',async()=>{
 const selected=state==='legacy'?{schemaVersion:1,kind:'ssh-terminal',sessionId:'legacy',selectionId:'selected'}:{schemaVersion:2,kind:'ssh-connection',connectionId:'owned',selectionId:'selected'},f=mount(route,{selected,serviceStatus:state});await assert.rejects(f.run({}),/明确选择本地计算资源.*后台 SSH 通道会保留/);assert.deepEqual(f.calls,['idle']);assert.equal(f.selection(),selected);
});
for(const route of ['compute.connection.connect','worker.connect'])test('actual '+route+' after actual explicit clear revokes only the local SSH proxy and retains remote channels and registration',async t=>{
 const remote=connectionServiceFixture(t);await remote.connect();remote.grant();const background=remote.channels.get('A'),before=structuredClone(background),proxy=remote.worker.connection,resourceChanged=remote.service.resourceChanged.bind(remote.service),calls=[];remote.service.resourceChanged=async()=>{calls.push('resource-changed');return resourceChanged();};const selected={schemaVersion:2,kind:'ssh-connection',connectionId:'A',profileId:'profile-A',profileVersion:1,selectionId:'selected'},f=mount(route,{selected,service:remote.service,worker:remote.worker});remote.resource.peek=()=>f.selection();
 const peer=f.peerScope();assert(peer);
 await f.clear();assert.equal(f.selection(),null);assert.equal(remote.worker.connection,null);assert(proxy);assert.equal(remote.service.hasCurrentGrant('codex'),false);assert.equal(remote.service.peek({connectionId:'A'}).status,'connected');assert.equal(remote.service.peek({connectionId:'A'}).workflowReady,false);assert.equal(remote.channels.get('A'),background);assert.deepEqual(background,before);assert.equal(remote.bases.get('A').status,'authenticated');assert.equal(remote.registration.read({profileId:'profile-A',profileVersion:1}).status,'configured');assert.equal(remote.calls.filter(v=>v.close).length,0);
 assert.deepEqual(f.calls.filter(Array.isArray),[['detach','A']]);
 assert.equal(await f.run({}),route==='worker.connect'?'worker':'profile');assert.equal(calls.length,2);assert(f.calls.includes(route==='worker.connect'?'connect-worker':'connect-profile'));assert.equal(remote.calls.filter(v=>v.open).length,1);assert.equal(remote.calls.filter(v=>v.close).length,0);assert.equal(remote.channels.get('A').status,'connected');
 assert.equal(peer.checkCurrent(),true);assert.equal(f.peerScope().sessionId,peer.sessionId);
});

for(const route of ['compute.connection.connect','worker.connect'])test('actual '+route+' clears a dead/unavailable SSH selection and connects local WSL cleanly',async()=>{
 const selected={schemaVersion:2,kind:'ssh-connection',connectionId:'dead-conn',selectionId:'dead-ssh',profileId:'profile',profileVersion:1};
 const resourceStatus={...selected,status:'unavailable',alive:false,authentication:'lost'};
 const f=mount(route,{selected,resourceStatus});
 const result=await f.run({});
 assert.equal(result,route==='worker.connect'?'worker':'profile');
 assert.equal(f.selection(),null);
 assert(f.calls.includes('explicit-clear'));
 assert(f.calls.includes('emit'));
});

test('the actual switch guard refuses to detach a worker while its pinned conversation is busy',async()=>{
 const selected={schemaVersion:2,kind:'ssh-connection',connectionId:'owned',selectionId:'selected'};
 const f=mount('worker.connect',{selected,usesLegacyWorker:true});
 await assert.rejects(f.clear(),/active conversation.*workbench worker/);
 await assert.rejects(f.run({}),/active conversation.*workbench worker/);
 assert.equal(f.selection(),selected);assert.deepEqual(f.calls,['idle','idle']);
});
});

await __describe("ssh-service-update", async () => {
const test = __node_test;
const fixture = _imp_0_fixture;
const request=(extra={})=>({connectionId:'A',profileId:'profile-A',profileVersion:1,requestId:'explicit-update',mode:'update',expectedAttemptId:'attempt-A',...extra});

test('explicit service update carries the same unsubmitted draft to its verified replacement runtime only',async t=>{
 const owner={provider:'codex',threadId:'thread',taskId:'flow',projectId:'draft-flow',inputRoot:'/owned/A/projects/draft-flow/inputs',serial:1};
 const oldId='a'.repeat(20),newId='b'.repeat(20);let task,updating=false,callback;
 const records={read:()=>structuredClone(task),save:value=>{task=structuredClone(value);}};
 const f=fixture(t,{current:()=>owner,prepareResources:async()=>({payload:{expected_runtime_id:updating?newId:oldId},transport:{}}),onRuntimeUpdated:async args=>{callback=args;await updateDraftWorker(records,f.worker,args);}});
 await f.connect();origin(f);
 task={id:'flow',provider:owner.provider,threadId:owner.threadId,workflowVersion:2,authoring:{projectId:owner.projectId,inputRoot:owner.inputRoot,authoringOnly:true,workerBinding:stableSshWorkerBinding(f.worker.identity)},artifacts:[]};
 const original=structuredClone(task),transport=f.connections.openService,requestService=f.connections.serviceRequest;
 const newHealth={...f.health('A'),runtimeId:newId,runtime:'/owned/A/runtimes/'+newId};
 f.connections.openService=async(...args)=>{const value=await transport(...args);f.channels.get('A').service=newHealth;return {...value,service:newHealth};};
 f.connections.serviceRequest=async packet=>{
  if(packet.target==='/api/health')return {status:200,data:newHealth};
  if(packet.target==='/api/projects')return {status:200,data:[{id:owner.projectId,authoring_only:true,authoring_task_id:'flow',policy:{input_roots:[owner.inputRoot]}}]};
  return requestService(packet);
 };
 updating=true;assert.equal((await f.service.connect(request())).workflowReady,true);
 assert.equal(task.authoring.workerBinding.runtimeId,newId);assert.doesNotThrow(()=>assertTaskWorker(task,f.worker));
 for(const changed of [{artifacts:[{kind:'run',id:'saved-run'}]},{deployment:{prepared:{artifactId:'saved-run'}}},
                       {authoring:{...original.authoring,inputRoot:'/somewhere/else'}},
                       {authoring:{...original.authoring,workerBinding:{...original.authoring.workerBinding,profileId:'different'}}}]){
  task={...structuredClone(original),...changed};const saved=structuredClone(task);
  await updateDraftWorker(records,f.worker,{...callback,assertCurrent(){}});assert.deepEqual(task,saved);
 }
});
test('confirmed disconnected maintenance update retains the original authenticated master and never acquires its raw shell',async t=>{const f=fixture(t);const old=await f.connect();f.grant();await f.service.disconnect({connectionId:'A',attemptId:old.attemptId});f.registration.markMaintenance(f.profile('A'),'worker_cache_invalid');let originCalls=0;f.connections.prepareServiceUpdate=async()=>{originCalls++;throw Error('Must not acquire original shell for disconnected maintenance');};const result=await f.connect('A','update','maintenance-update');assert.equal(result.workflowReady,true);assert.equal(result.operator,'human');assert.equal(f.bases.get('A').authentication,'verified');assert.equal(originCalls,0);assert.equal(f.preparations.at(-1).expectedRuntimeId,undefined);assert.equal(f.calls.filter(v=>v.close).length,1);assert.equal(f.calls.filter(v=>v.open).length,2);});
test('unknown service cannot use disconnected maintenance update to bypass active-attempt protection',async t=>{const f=fixture(t);await f.connect();f.channels.get('A').status='unknown';await f.service.status();const before=f.calls.filter(v=>v.open).length;await assert.rejects(f.connect('A','update','unknown-maintenance'),/channel_in_use/);await assert.rejects(f.service.connect(request()),/context_changed/);assert.equal(f.calls.filter(v=>v.open).length,before);});
function origin(f,{staleAfterClose=false}={}){let live=true;const close=f.connections.closeService;f.connections.prepareServiceUpdate=async value=>{assert.equal(value.connectionId,'A');assert.equal(value.serviceId,'service-A');return {sessionId:'original-shell',assertCurrent(){if(!live)throw Error('terminal_scope_denied');}};};f.connections.closeService=async value=>{const result=await close(value);if(staleAfterClose)live=false;return result;};return {revoke(){live=false;}};}
test('explicit update captures the original granted shell before close, uploads current source there and preserves only existing service scope',async t=>{const f=fixture(t);await f.connect();f.grant();origin(f);const open=f.connections.openService;f.connections.openService=async(data,bootstrap,context)=>{assert.equal(context.sessionId,'original-shell');return open(data,bootstrap);};const result=await f.service.connect(request());assert.equal(result.workflowReady,true);assert.equal(result.operator,'agent');assert.equal(f.calls.filter(v=>v.close).length,1);assert.equal(f.calls.filter(v=>v.open).length,2);assert.equal(f.preparations.at(-1).expectedRuntimeId,undefined);assert.equal(f.preparations.at(-1).reuseOnly,undefined);assert.equal(f.service.hasCurrentGrant('codex',f.current()),true);});
test('stale update attempt, human/foreign origin and active Agent refuse before any service close',async t=>{for(const scenario of ['stale','origin','busy']){const f=fixture(t);await f.connect();origin(f);if(scenario==='origin')f.connections.prepareServiceUpdate=async()=>{throw Error('terminal_scope_denied');};if(scenario==='busy')f.busy(true);await assert.rejects(f.service.connect(request(scenario==='stale'?{expectedAttemptId:'stale'}:{})));assert.equal(f.calls.filter(v=>v.close).length,0);assert.equal(f.calls.filter(v=>v.open).length,1);}});
test('revoked origin after confirmed close never starts another shell or uploads',async t=>{const f=fixture(t);await f.connect();origin(f,{staleAfterClose:true});await assert.rejects(f.service.connect(request()),/scope_denied/);assert.equal(f.calls.filter(v=>v.close).length,1);assert.equal(f.calls.filter(v=>v.open).length,1);assert.equal(f.service.hasCurrentGrant('codex'),false);});
test('lost update close remains unknown and repeating the same explicit request never replays close or bootstrap',async t=>{const f=fixture(t);await f.connect();origin(f);let closes=0;f.connections.closeService=async()=>{closes++;throw Error('terminal_service_unknown');};const first=await f.service.connect(request()),again=await f.service.connect(request());assert.equal(first.status,'unknown');assert.deepEqual(again,first);assert.equal(closes,1);assert.equal(f.calls.filter(v=>v.open).length,1);assert.equal(f.service.hasCurrentGrant('codex'),false);});
test('same explicit update ID is idempotent and cannot grant a previously human-only service',async t=>{const f=fixture(t);await f.connect();origin(f);const first=await f.service.connect(request()),again=await f.service.connect(request());assert.equal(first.operator,'human');assert.equal(again.attemptId,first.attemptId);assert.equal(again.status,first.status);assert.deepEqual(again.health,first.health);assert.equal(f.calls.filter(v=>v.close).length,1);assert.equal(f.calls.filter(v=>v.open).length,2);await assert.rejects(f.service.connect(request({profileVersion:2})));});
test('completed update receipts cannot cross a conversation scope or revive a reclaimed service grant',async t=>{const f=fixture(t);await f.connect();f.grant();origin(f);const updated=await f.service.connect(request());f.service.owner({connectionId:'A',attemptId:updated.attemptId,owner:'human'});assert.equal((await f.service.connect(request())).operator,'human');f.setCurrent({...f.current(),threadId:'other-thread'});await assert.rejects(f.service.connect(request()),/context_changed/);assert.equal(f.calls.filter(v=>v.close).length,1);assert.equal(f.calls.filter(v=>v.open).length,2);});
test('an existing read-only service observation drains before update without requiring another Agent approval',async t=>{const f=fixture(t);await f.connect();origin(f);const gate=f.delayHealth(),reading=f.worker.request('GET','/api/health');await gate.started;const close=f.connections.closeService;f.connections.closeService=async value=>{gate.release();await reading;return close(value);};assert.equal((await f.service.connect(request())).workflowReady,true);assert.equal(f.calls.filter(v=>v.close).length,1);});
test('human service reclaim during awaited original-shell preparation cannot be undone by successful update',async t=>{const f=fixture(t);await f.connect();f.grant();let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);f.connections.prepareServiceUpdate=async()=>{entered();await gate;return {sessionId:'original-shell',assertCurrent(){}};};const updating=f.service.connect(request());await started;f.service.owner({connectionId:'A',attemptId:'attempt-A',owner:'human'});release();assert.equal((await updating).operator,'human');assert.equal(f.service.hasCurrentGrant('codex'),false);});
for(const when of ['prepare','close'])test('authoring abort during update '+when+' cannot restore the revoked service grant',async t=>{const f=fixture(t);await f.connect();f.grant();const authoring=f.service.prepareAuthoringGrant(null);assert(authoring);let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);origin(f);if(when==='prepare')f.connections.prepareServiceUpdate=async()=>{entered();await gate;return {sessionId:'original-shell',assertCurrent(){}};};else{const close=f.connections.closeService;f.connections.closeService=async value=>{entered();await gate;return close(value);};}const updating=f.service.connect(request());await started;f.service.abortAuthoringGrant(authoring);release();assert.equal((await updating).operator,'human');assert.equal(f.service.hasCurrentGrant('codex'),false);});
});
