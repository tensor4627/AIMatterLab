import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionServiceFixture as fixture} from '../helpers/ssh-connection-service-fixture.mjs';

const A='a'.repeat(20),B='b'.repeat(20),HASH='b'.repeat(64);
const request={connectionId:'A',profileId:'profile-A',profileVersion:1,requestId:'daily',mode:'reuse'};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const inactive=(data,extra={})=>({...data,attemptId:data.requestId,status:'failed',serviceActive:false,error:{code:'worker_health_invalid',phase:'checking_health'},...extra});
function owned(t){
 const f=fixture(t,{prepareResources:async(_source,options)=>({source:'inert',payload:{expected_runtime_id:options.verifiedCacheOnly?B:options.expectedRuntimeId||A,...options.verifiedCacheOnly?{files:[],runtime_manifest_sha256:HASH}:{}},transport:{source:'inert',sha256:'a'.repeat(64)}})});
 const old={...f.health('A'),runtimeManifestSha256:'a'.repeat(64)},next={...old,runtime:old.root+'/runtimes/'+B,runtimeId:B,runtimeManifestSha256:HASH,runtimeSourceScope:'verified-cached-manifest'};
 f.registration.remember(f.profile('A'),old,{status:'ready',count:1});
 const calls=[],open=f.connections.openService;
 f.connections.openService=async(data,bootstrap,context)=>{calls.push({data,bootstrap,context});if(bootstrap.payload.expected_runtime_id===A)return inactive(data);const v=await open(data,bootstrap);v.service=structuredClone(next);f.channels.set('A',structuredClone(v));return v;};
 const request=f.connections.serviceRequest;f.connections.serviceRequest=packet=>packet.target==='/api/health'?Promise.resolve({status:200,data:structuredClone(f.channels.get('A')?.service||old)}):request(packet);
 return {...f,old,next,opens:calls};
}

test('a healthy registered older runtime stays pinned without reconciliation or implicit upgrade',async t=>{
 const f=owned(t);f.connections.openService=async(data,bootstrap)=>{f.calls.push({open:data,bootstrap});const value={...data,attemptId:data.requestId,serviceId:'old-service',status:'connected',serviceActive:true,service:f.old};f.channels.set('A',value);return value;};
 const value=await f.service.connectForAgent(request,{sessionId:'original-shell'});assert.equal(value.workflowReady,true);assert.equal(value.health.runtimeId,A);assert.equal(f.preparations.length,1);assert.equal(f.preparations[0].expectedRuntimeId,A);assert.equal(f.calls.find(v=>v.open).bootstrap.startCached,true);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).registration.runtimeId,A);
});

test('only an inactive exact health mismatch may reconcile the already running shipped runtime with no start or transfer',async t=>{
 const f=owned(t),value=await f.service.connectForAgent(request,{sessionId:'original-shell'});
 assert.equal(value.workflowReady,true);assert.equal(value.operator,'human');assert.equal(value.health.runtimeId,B);assert.equal(f.opens.length,2);assert.notEqual(value.attemptId,'daily');assert.equal(value.attemptId,f.opens[1].data.requestId);
 const candidate=f.opens[1];assert.equal(candidate.context.sessionId,'original-shell');assert.equal(candidate.bootstrap.reuseOnly,true);assert.equal(candidate.bootstrap.startCached,false);assert.deepEqual(candidate.bootstrap.payload.files,[]);assert.equal(candidate.bootstrap.payload.runtime_manifest_sha256,HASH);assert.equal(f.preparations[1].verifiedCacheOnly,true);assert.equal(f.preparations[1].port,f.old.port);
 const saved=f.registration.read({profileId:'profile-A',profileVersion:1});assert.equal(saved.status,'configured');assert.equal(saved.registration.runtimeId,B);assert.equal(saved.registration.runtimeManifestSha256,HASH);assert.equal(f.service.hasCurrentGrant('codex'),false);
});

test('the same-profile persisted health mismatch probes the registered runtime before the running current-runtime cache',async t=>{
 const f=owned(t);f.registration.markMaintenance(f.profile('A'),'worker_health_invalid');const value=await f.service.connectForAgent(request,{sessionId:'original-shell'});
 assert.equal(value.workflowReady,true);assert.equal(f.opens.length,2);assert.equal(f.opens[0].bootstrap.startCached,false);assert.equal(f.opens[0].bootstrap.payload.expected_runtime_id,A);assert.equal(f.preparations[0].verifiedCacheOnly,undefined);assert.equal(f.opens[1].bootstrap.startCached,false);assert.equal(f.preparations[1].verifiedCacheOnly,true);
});

test('a healthy recovered registered runtime clears only its stale health maintenance and continues the older worker',async t=>{
 const f=owned(t);f.registration.markMaintenance(f.profile('A'),'worker_health_invalid');f.connections.openService=async(data,bootstrap,context)=>{f.opens.push({data,bootstrap,context});const v={...data,attemptId:data.requestId,serviceId:'recovered-A',status:'connected',serviceActive:true,service:f.old};f.channels.set('A',v);return v;};
 const value=await f.service.connectForAgent(request,{sessionId:'original-shell'});assert.equal(value.workflowReady,true);assert.equal(value.health.runtimeId,A);assert.equal(f.opens.length,1);assert.equal(f.opens[0].bootstrap.startCached,false);assert.equal(f.preparations.length,1);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'configured');
});

test('an actually missing registered cache under stale health maintenance can only inspect the already running shipped cache',async t=>{
 const f=owned(t);f.registration.markMaintenance(f.profile('A'),'worker_health_invalid');const open=f.connections.openService;f.connections.openService=(data,bootstrap,context)=>bootstrap.payload.expected_runtime_id===A?(f.opens.push({data,bootstrap,context}),Promise.resolve(inactive(data,{error:{code:'maintenance_required',phase:'checking_cache'}}))):open(data,bootstrap,context);
 const value=await f.service.connectForAgent(request,{sessionId:'original-shell'});assert.equal(value.workflowReady,true);assert.equal(value.health.runtimeId,B);assert.equal(f.opens.length,2);for(const entry of f.opens)assert.equal(entry.bootstrap.startCached,false);assert.deepEqual(f.opens[1].bootstrap.payload.files,[]);
});

test('a permanent health failure never repeats the same registered and shipped runtime probe',async t=>{
 const f=fixture(t,{prepareResources:async(_source,options)=>({source:'inert',payload:{expected_runtime_id:A,files:[],runtime_manifest_sha256:'a'.repeat(64)},transport:{source:'inert',sha256:'a'.repeat(64)}})});f.registration.remember(f.profile('A'),{...f.health('A'),runtimeManifestSha256:'a'.repeat(64)},{status:'ready',count:1});f.registration.markMaintenance(f.profile('A'),'worker_health_invalid');let count=0;f.connections.openService=async data=>{count++;return inactive(data);};
 const value=await f.service.connectForAgent(request,{sessionId:'original-shell'});assert.equal(value.workflowReady,false);assert.equal(value.error.code,'worker_health_invalid');assert.equal(value.status,'failed');assert.equal(count,1);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).registration.runtimeId,A);
});

for(const [name,change] of Object.entries({root:{root:'/other'},port:{port:25001},host:{hostIdentity:{hostname:'owned-A',uid:1000,machineId:'other'}},canonical:{runtime:'/owned/A/runtimes/../runtimes/'+B},runtime:{runtimeId:'c'.repeat(20)},hash:{runtimeManifestSha256:B+'c'.repeat(44)},missingHash:{runtimeManifestSha256:undefined},scope:{runtimeSourceScope:'observed-legacy-cache'}}))test('reconciliation rejects mismatched '+name+' without rewriting the old registration',async t=>{
 const f=owned(t);Object.assign(f.next,change);const before=f.registration.read({profileId:'profile-A',profileVersion:1}).registration;const value=await f.service.connect(request);assert.equal(value.workflowReady,false);const after=f.registration.read({profileId:'profile-A',profileVersion:1}).registration;assert.equal(after.runtimeId,A);assert.equal(after.checkedAt,before.checkedAt);assert.deepEqual(after.hostIdentity,before.hostIdentity);assert.equal(f.opens.length,2);
});

for(const [name,extra] of Object.entries({unknown:{status:'unknown',serviceActive:true},active:{serviceActive:true},wrongPhase:{error:{code:'worker_health_invalid',phase:'checking_cache'}},wrongError:{error:{code:'worker_cache_invalid',phase:'checking_health'}},wrongAttempt:{attemptId:'foreign'},wrongConnection:{connectionId:'B'}}))test('reconciliation never retries '+name+' failure',async t=>{
 const f=owned(t);f.connections.openService=async(data,bootstrap)=>{f.opens.push({data,bootstrap});return inactive(data,extra);};const value=await f.service.connectForAgent(request,{sessionId:'original-shell'});assert.equal(value.workflowReady,false);assert.equal(f.opens.length,1);assert.equal(f.preparations.length,1);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).registration.runtimeId,A);
});

test('a missing current cache cannot install, start or fall back after an inactive old-runtime mismatch',async t=>{
 const f=owned(t),open=f.connections.openService;f.connections.openService=async(data,bootstrap,context)=>bootstrap.payload.expected_runtime_id===B?(f.opens.push({data,bootstrap}),inactive(data,{error:{code:'maintenance_required',phase:'checking_cache'}})):open(data,bootstrap,context);
 const value=await f.service.connectForAgent(request,{sessionId:'original-shell'});assert.equal(value.workflowReady,false);assert.equal(value.error.code,'maintenance_required');assert.equal(f.opens.length,2);assert.equal(f.opens[1].bootstrap.startCached,false);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).registration.runtimeId,A);
});

test('only the exact saved health-mismatch maintenance is eligible; all other maintenance remains refused',async t=>{
 for(const reason of ['worker_cache_invalid','namespace_unsafe','worker_identity_unavailable','python_unsupported']){const f=owned(t);f.registration.markMaintenance(f.profile('A'),reason);const value=await f.service.connectForAgent(request,{sessionId:'original-shell'});assert.equal(value.workflowReady,false,reason);assert.equal(f.opens.length,0,reason);assert.equal(f.preparations.length,0,reason);}
});

test('a late context change after candidate open prevents attachment, registration migration and service grants',async t=>{
 const f=owned(t),open=f.connections.openService;f.connections.openService=async(...args)=>{const v=await open(...args);if(args[1].payload.expected_runtime_id===B)f.setCurrent({...f.current(),serial:2});return v;};const value=await f.service.connect(request);assert.equal(value.workflowReady,false);assert.equal(value.status,'unknown');assert.equal(f.worker.connection,undefined);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).registration.runtimeId,A);await assert.rejects(f.service.connect({...request,requestId:'never-replay'}),/channel_in_use/);assert.equal(f.opens.length,2);
});

test('revoked base authentication prevents the candidate from dispatching',async t=>{
 const f=owned(t),open=f.connections.openService;f.connections.openService=async(...args)=>{const v=await open(...args);if(args[1].payload.expected_runtime_id===A)f.bases.get('A').authentication='lost';return v;};const value=await f.service.connect(request);assert.equal(value.workflowReady,false);assert.equal(f.opens.length,1);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).registration.runtimeId,A);
});

test('concurrent registration revisions cannot be overwritten by a stale successful observation',async t=>{
 const f=owned(t),open=f.connections.openService;f.connections.openService=async(...args)=>{const v=await open(...args);if(args[1].payload.expected_runtime_id===B)f.registration.markMaintenance(f.profile('A'),'namespace_unsafe');return v;};const value=await f.service.connect(request);assert.equal(value.workflowReady,false);const saved=f.registration.read({profileId:'profile-A',profileVersion:1});assert.equal(saved.registration.runtimeId,A);assert.equal(saved.reason,'namespace_unsafe');assert.equal(f.worker.connection,undefined);
});

test('a timeout keeps the original unknown attempt and never opens another cache probe',async t=>{
 const f=owned(t);f.connections.openService=async(data,bootstrap)=>{f.opens.push({data,bootstrap});throw Error('terminal_service_unknown');};const value=await f.service.connectForAgent(request,{sessionId:'original-shell'});assert.equal(value.status,'unknown');assert.equal(value.attemptId,'daily');assert.equal(f.opens.length,1);await assert.rejects(f.service.connect({...request,requestId:'no-replay'}),/channel_in_use/);assert.equal(f.opens.length,1);
});

test('a policy revision while checking candidate tools cannot be cleared by the successful bridge',async t=>{
 const f=owned(t),probe=f.worker.probeTools.bind(f.worker);f.worker.probeTools=async()=>{const result=await probe();f.registration.markMaintenance(f.profile('A'),'namespace_unsafe');return result;};const value=await f.service.connect(request);assert.equal(value.status,'unknown');assert.equal(value.workflowReady,false);const saved=f.registration.read({profileId:'profile-A',profileVersion:1});assert.equal(saved.reason,'namespace_unsafe');assert.equal(saved.registration.runtimeId,A);assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.opens.length,2);
});

test('late base authentication loss after a successful candidate tool check prevents registration migration',async t=>{
 const f=owned(t),probe=f.worker.probeTools.bind(f.worker);f.worker.probeTools=async()=>{const result=await probe();f.bases.get('A').authentication='lost';return result;};const value=await f.service.connect(request);assert.equal(value.status,'unknown');assert.equal(value.workflowReady,false);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).registration.runtimeId,A);assert.equal(f.service.hasCurrentGrant('codex'),false);
});

test('duplicate pending requests share one observation while a different request cannot bypass it',async t=>{
 const f=owned(t),held=deferred(),entered=deferred(),open=f.connections.openService;f.connections.openService=async(...args)=>{if(args[1].payload.expected_runtime_id===B){entered.resolve();await held.promise;}return open(...args);};const one=f.service.connect(request);await entered.promise;const two=f.service.connect(request);await assert.rejects(f.service.connect({...request,requestId:'different'}),/busy/);held.resolve();const [a,b]=await Promise.all([one,two]);assert.equal(a.workflowReady,true);assert.equal(b.attemptId,a.attemptId);assert.equal(f.opens.length,2);
});
