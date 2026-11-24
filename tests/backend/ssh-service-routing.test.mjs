import __node_test, {describe as __describe} from 'node:test';
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {sshEndpoint} from "../../backend/main/compute/ssh-endpoint.mjs";
import {existingProfile, existingConnections} from "../../backend/main/compute/existing-ssh.mjs";
import {EventEmitter} from "node:events";
import ts from "typescript";
import {connectionServiceFixture as _imp_0_fixture} from "../helpers/ssh-connection-service-fixture.mjs";
import {createSshServiceRegistration} from "../../backend/main/compute/ssh-service-registration.mjs";
import {Catalog} from "../../backend/main/workspace/catalog.mjs";

await __describe("ssh-endpoint", async () => {
const test = __node_test;
test('SSH users are explicit, editable, and never inherit the Windows user',()=>{
 assert.deepEqual(sshEndpoint({target:'remote@example.test'}),{host:'example.test',username:'remote',target:'remote@example.test'});
 assert.equal(sshEndpoint({target:'old@example.test',host:'example.test',username:'edited'}).username,'edited');
 for(const value of [{host:'example.test'},{host:'example.test',username:''},{host:'-oBad',username:'remote'},{host:'example.test',username:'remote;bad'}])assert.throws(()=>sshEndpoint(value));
});
test('Existing imports split user@host without exposing connection details in the list',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-ssh-import-')),directory=path.join(root,'.codex'),file=path.join(directory,'.codex-global-state.json');
 try{
  fs.mkdirSync(directory);fs.writeFileSync(file,JSON.stringify({'codex-managed-remote-connections':[{hostId:'fixture-id',hostname:'remote@example.test',sshPort:22,identity:null}]}));
  const list=existingConnections(root);assert.deepEqual(list,[{ref:'fixture-id',label:'已有连接 1'}]);
  const imported=existingProfile(root,'fixture-id');assert.equal(imported.host,'example.test');assert.equal(imported.username,'remote');
 }finally{fs.unlinkSync(file);fs.rmdirSync(directory);fs.rmdirSync(root);}
});
});

await __describe("ssh-login-http-budget", async () => {
const test = __node_test;
const source=fs.readFileSync(new URL('../../backend/main/compute/shared-terminal.mjs',import.meta.url),'utf8'),tree=ts.createSourceFile('shared-terminal.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),node=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='localRequest');assert(node);
function transport({timeout=false,abort=false}={}){
 const calls=[],http={request(url,options,onResponse){const req=new EventEmitter();req.write=()=>{};req.end=()=>queueMicrotask(()=>{if(timeout)return req.timer();const response=new EventEmitter();response.statusCode=200;response.destroy=()=>{};onResponse(response);if(abort)return response.emit('aborted');response.emit('data',Buffer.from('{"observed":true}'));response.emit('end');});req.destroy=()=>{req.destroyed=true;};req.setTimeout=(milliseconds,callback)=>{calls.push({url,method:options.method,milliseconds});req.timer=callback;};return req;}};
 const run=new Function('http','descriptorValid','brokerRefusals','return ('+node.getText(tree)+');')(http,()=>true,new Map());return {run,calls};
}
const descriptor={origin:'http://127.0.0.1:12345',controlToken:'inert'};
for(const operation of ['input','resize','owner','close'])test('queued shared-shell '+operation+' keeps the service-exchange budget and preserves its broker on an unknown result',async()=>{const route='/sessions/owned/'+operation,f=transport();assert.deepEqual(await f.run(descriptor,'POST',route,{}),{observed:true});assert.equal(f.calls[0].milliseconds,260000);for(const failure of ['timeout','abort']){const broken=transport({[failure]:true});await assert.rejects(broken.run(descriptor,'POST',route,{}),e=>e.message==='terminal_service_unknown'&&e.terminalRejected===true);assert.equal(broken.calls.length,1);}});
test('actual main HTTP transport budgets composite login at sixty seconds and admits only bounded fixed status paths',async()=>{
 const f=transport();assert.deepEqual(await f.run(descriptor,'POST','/connections/owned/login/complete',{requestId:'login'}),{observed:true});assert.equal(f.calls[0].milliseconds,60000);
 assert.deepEqual(await f.run(descriptor,'GET','/connections/owned/login/status/login'),{observed:true});assert.equal(f.calls[1].milliseconds,5000);
 await assert.rejects(f.run(descriptor,'GET','/connections/owned/login/status/../login'),/terminal_unavailable/);await assert.rejects(f.run(descriptor,'GET','/connections/owned/login/status/'+ 'a'.repeat(101)),/terminal_unavailable/);assert.equal(f.calls.length,2);
});
for(const failure of ['timeout','abort'])test('unknown login '+failure+' is explicit and keeps the descriptor available for pure observation',async()=>{
 const f=transport({[failure]:true});await assert.rejects(f.run(descriptor,'POST','/connections/owned/login/complete',{requestId:'login'}),error=>error.message==='terminal_login_unknown'&&error.terminalRejected===true);assert.equal(f.calls.length,1);assert.equal(f.calls[0].milliseconds,60000);
});
test('a control proof can outlast a normal status read and a missing proof does not discard its broker',async()=>{
 const route='/connections/owned/state',f=transport();
 assert.deepEqual(await f.run(descriptor,'GET',route),{observed:true});assert.equal(f.calls[0].milliseconds,15000);
 for(const [failure,code] of [['timeout','ssh_control_timeout'],['abort','ssh_control_unavailable']]){
  const unknown=transport({[failure]:true});
  await assert.rejects(unknown.run(descriptor,'GET',route),error=>error.message===code&&error.terminalRejected===true);
  assert.equal(unknown.calls.length,1);
 }
});
});

await __describe("ssh-service-reconciliation", async () => {
const test = __node_test;
const fixture = _imp_0_fixture;
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
});

await __describe("ssh-service-registration", async () => {
const test = __node_test;
const profile={id:'owned-profile',version:1,kind:'ssh',name:'Owned',host:'fixture.invalid',username:'owned',port:22,ssh_client:'/usr/bin/ssh',mode:'interactive'};
const health={name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',hostIdentity:{hostname:'owned-host',uid:1000,machineId:'owned-machine'},root:'/owned/service',runtime:'/owned/runtimes/'+'a'.repeat(20),runtimeId:'a'.repeat(20),port:25252};

test('runtime reconciliation commits only against the exact original registration revision and same complete identity',()=>{
 const f=fixture(),saved=f.registry.remember(profile,health,{status:'ready',count:2}).registration,next={...health,runtime:health.root+'/runtimes/'+'b'.repeat(20),runtimeId:'b'.repeat(20),runtimeManifestSha256:'b'.repeat(64),runtimeSourceScope:'verified-cached-manifest'};
 assert.deepEqual(f.registry.validateReconciliation(profile,saved),saved);
 for(const change of [{root:'/other'},{port:25253},{hostIdentity:{...health.hostIdentity,uid:1001}},{runtime:health.root+'/runtimes/../runtimes/'+'b'.repeat(20)},{runtimeManifestSha256:undefined},{runtimeSourceScope:'observed-legacy-cache'}])assert.throws(()=>f.registry.reconcileCurrent(profile,saved,{...next,...change},{status:'ready',count:2}),/registration_(?:identity_changed|invalid)/);
 f.registry.markMaintenance(profile,'worker_health_invalid');assert.throws(()=>f.registry.reconcileCurrent(profile,saved,next,{status:'ready',count:2}),/registration_changed/);
 const marked=f.registry.read(request).registration,result=f.registry.reconcileCurrent(profile,marked,next,{status:'ready',count:2});assert.equal(result.status,'configured');assert.equal(result.registration.runtimeId,next.runtimeId);assert.equal(result.registration.revision,marked.revision+1);
});

test('runtime reconciliation never revives a changed profile or another maintenance reason',()=>{
 const f=fixture();f.registry.remember(profile,health,{status:'ready',count:2});for(const reason of ['worker_cache_invalid','namespace_unsafe','worker_identity_unavailable']){f.registry.markMaintenance(profile,reason);const current=f.registry.read(request).registration;assert.throws(()=>f.registry.validateReconciliation(profile,current),/maintenance_required/);}
 f.registry.remember(profile,health,{status:'ready',count:2});const saved=f.registry.read(request).registration;f.setProfile({...profile,version:2,host:'changed.invalid'});assert.throws(()=>f.registry.validateReconciliation({...profile,version:2},saved),/maintenance_required/);
});

test('recovered registered-worker evidence clears maintenance only for the same identity and unchanged revision',()=>{
 const f=fixture();f.registry.remember(profile,health,{status:'ready',count:2});f.registry.markMaintenance(profile,'worker_health_invalid');const saved=f.registry.read(request).registration;assert.throws(()=>f.registry.rememberVerifiedReuse(profile,saved,{...health,port:25253},{status:'ready',count:2}),/identity_changed/);
 const result=f.registry.rememberVerifiedReuse(profile,saved,health,{status:'ready',count:2});assert.equal(result.status,'configured');assert.equal(result.registration.runtimeId,health.runtimeId);assert.throws(()=>f.registry.rememberVerifiedReuse(profile,saved,health,{status:'ready',count:2}),/registration_changed/);
});
test('new registrations preserve a measured full manifest identity and require it on reuse',()=>{const f=fixture(),sha='a'.repeat(64),saved=f.registry.remember(profile,{...health,runtime_manifest_sha256:sha},{status:'ready',count:2});assert.equal(saved.registration.runtimeManifestSha256,sha);assert.equal(f.registry.validateReuse(profile,{...health,runtimeManifestSha256:sha}).runtimeManifestSha256,sha);assert.throws(()=>f.registry.validateReuse(profile,health),/identity_changed/);assert.throws(()=>f.registry.validateReuse(profile,{...health,runtimeManifestSha256:'a'.repeat(20)+'b'.repeat(44)}),/identity_changed/);});
test('legacy registrations retain unknown full hash and never synthesize it from the short runtime ID',()=>{const f=fixture();f.registry.remember(profile,health,{status:'ready',count:2});const before=JSON.stringify([...f.values.values()]),observed=f.registry.validateReuse(profile,{...health,runtimeManifestSha256:'a'.repeat(64)});assert.equal(observed.runtimeManifestSha256,undefined);assert.equal(JSON.stringify([...f.values.values()]),before);for(const value of ['invalid','b'.repeat(64)])assert.throws(()=>f.registry.remember(profile,{...health,runtimeManifestSha256:value},{status:'ready',count:2}),/registration_invalid/);});

test('a hashless health refresh preserves the prior measured manifest only for the exact registered identity',()=>{
 const f=fixture(),sha='a'.repeat(64);f.registry.remember(profile,{...health,runtimeManifestSha256:sha},{status:'ready',count:2});
 const refreshed=f.registry.remember(profile,health,{status:'warning',count:0});assert.equal(refreshed.registration.runtimeManifestSha256,sha);assert.equal(refreshed.registration.revision,2);
 f.setProfile({...profile,version:2,name:'Harmless display rename'});const renamed=f.registry.remember({...profile,version:2,name:'Harmless display rename'},health,{status:'ready',count:2});assert.equal(renamed.registration.runtimeManifestSha256,sha);assert.equal(renamed.status,'configured');
 assert.throws(()=>f.registry.validateReuse({...profile,version:2},health),/identity_changed/,'Preserving evidence does not weaken the full-hash proof required for cache reuse');
});

test('a conflicting measured manifest for the same complete identity is refused without changing registration',()=>{
 const f=fixture();f.registry.remember(profile,{...health,runtimeManifestSha256:'a'.repeat(64)},{status:'ready',count:2});const before=JSON.stringify([...f.values.values()]);
 assert.throws(()=>f.registry.remember(profile,{...health,runtime_manifest_sha256:'a'.repeat(20)+'b'.repeat(44)},{status:'ready',count:2}),/identity_changed/);assert.equal(JSON.stringify([...f.values.values()]),before);
});

test('a hashless changed host, endpoint, runtime, profile identity or configuration never inherits a prior manifest',()=>{
 for(const patch of [{root:'/other/service'},{runtime:'/other/runtimes/'+'a'.repeat(20)},{runtimeId:'b'.repeat(20)},{port:25253},{hostIdentity:{...health.hostIdentity,hostname:'other'}},{hostIdentity:{...health.hostIdentity,uid:1001}},{hostIdentity:{...health.hostIdentity,machineId:'other'}}]){
  const f=fixture();f.registry.remember(profile,{...health,runtimeManifestSha256:'a'.repeat(64)},{status:'ready',count:2});assert.equal(f.registry.remember(profile,{...health,...patch},{status:'ready',count:2}).registration.runtimeManifestSha256,undefined);
 }
 for(const patch of [{host:'other.invalid'},{serviceEnvironment:{python:'python3.9',activation:'module load fixture'}}]){const f=fixture();f.registry.remember(profile,{...health,runtimeManifestSha256:'a'.repeat(64)},{status:'ready',count:2});const changed={...profile,...patch,version:2};f.setProfile(changed);assert.equal(f.registry.remember(changed,health,{status:'ready',count:2}).registration.runtimeManifestSha256,undefined);}
 const f=fixture();f.registry.remember(profile,{...health,runtimeManifestSha256:'a'.repeat(64)},{status:'ready',count:2});for(const value of f.values.values())value.profileId='foreign-profile';assert.equal(f.registry.remember(profile,health,{status:'ready',count:2}).registration.runtimeManifestSha256,undefined);
});
function fixture(){const values=new Map();let current=structuredClone(profile),legacy=null;const catalog={get:(kind,id)=>values.get(kind+':'+id),put:(kind,id,value)=>values.set(kind+':'+id,structuredClone(value))};const profiles={read:({id,version})=>{assert.equal(id,current.id);if(version!==undefined&&version!==current.version)throw Error('compute_profile_changed');return structuredClone(current);},list:()=>[structuredClone(current)]};return {values,registry:createSshServiceRegistration({catalog,profiles,legacyBinding:()=>legacy,now:()=>123456}),setProfile:value=>current=value,setLegacy:value=>legacy=value};}
const request={profileId:profile.id,profileVersion:1};
test('verified identity with no catalog is reusable setup evidence with a warning, never a claimed tool count',()=>{const f=fixture(),v=f.registry.remember(profile,health,{status:'warning',count:0});assert.equal(v.status,'configured');assert.deepEqual(v.registration.tools,{status:'legacy_not_recorded'});assert.deepEqual(v.registration.toolWarnings,['tools_unavailable']);assert.equal(f.registry.validateReuse(profile,health).runtimeId,health.runtimeId);f.registry.markMaintenance(profile,'tools_unavailable');assert.equal(f.registry.read(request).status,'configured');assert.throws(()=>f.registry.validateReuse(profile,{...health,root:'/unrelated'}),/identity_changed/);});
test('no setup evidence remains unconfigured and does not grant a channel',()=>{const f=fixture();assert.deepEqual(f.registry.read(request),{status:'unconfigured',...request});assert.equal(f.values.size,0);assert.throws(()=>f.registry.validateReuse(profile),/registration_required/);});
test('verified setup persists only bounded public evidence across controller recreation and never live state',()=>{const f=fixture(),view=f.registry.remember(profile,{...health,tokens:{admin:'PRIVATE'},sessionId:'PRIVATE-SESSION'},{status:'ready',count:4,tools:[{token:'PRIVATE'}]});assert.equal(view.status,'configured');const text=JSON.stringify([...f.values.values()]);for(const forbidden of ['PRIVATE','sessionId','ownerEpoch','serviceId','workflowReady','activation','fixture.invalid'])assert(!text.includes(forbidden),forbidden);assert.deepEqual(f.registry.validateReuse(profile),view.registration);assert.equal(f.registry.list()[0].status,'configured');});
test('display-name/version changes retain setup, route or environment changes require maintenance',()=>{const f=fixture();f.registry.remember(profile,health,{status:'ready',count:1});f.setProfile({...profile,version:2,name:'Renamed'});assert.equal(f.registry.read({...request,profileVersion:2}).status,'configured');for(const changed of [{host:'other.invalid'},{serviceEnvironment:{python:'python3.9',activation:'SECRET_RECIPE'}}]){const current={...profile,version:2,...changed};f.setProfile(current);const view=f.registry.read({...request,profileVersion:2});assert.equal(view.status,'maintenance_required');assert(!JSON.stringify(view).includes('SECRET_RECIPE'));assert.throws(()=>f.registry.validateReuse(current),/maintenance_required/);}});
test('reuse verifies original actual host, root and runtime without rewriting registration',()=>{const f=fixture();f.registry.remember(profile,health,{status:'ready',count:2});const before=JSON.stringify([...f.values.values()]);for(const changed of [{port:25253},{runtimeId:'b'.repeat(20)},{root:'/other'},{hostIdentity:{...health.hostIdentity,machineId:'other'}}])assert.throws(()=>f.registry.validateReuse(profile,{...health,...changed}),/identity_changed/);assert.equal(JSON.stringify([...f.values.values()]),before);});
test('only fully evidenced exact-version legacy setup migrates, never a guessed port or unrelated profile',()=>{for(const legacy of [{kind:'ssh',version:2,profileId:'other',profileVersion:1,checkedAt:1,...health},{kind:'ssh',version:2,profileId:profile.id,profileVersion:2,checkedAt:1,...health},{kind:'ssh',version:2,profileId:profile.id,profileVersion:1,checkedAt:1,...health,port:undefined}]){const f=fixture();f.setLegacy(legacy);assert.equal(f.registry.read(request).status,'unconfigured');assert.equal(f.values.size,0);}const f=fixture();f.setLegacy({kind:'ssh',version:2,profileId:profile.id,profileVersion:1,checkedAt:1,...health});const migrated=f.registry.read(request);assert.equal(migrated.status,'configured');assert.deepEqual(migrated.registration.tools,{status:'legacy_not_recorded'});});
test('bad tool proof, malformed identity and stale profile cannot publish configured setup',()=>{const f=fixture();assert.throws(()=>f.registry.remember(profile,health,{status:'blocked',count:3}),/invalid/);assert.throws(()=>f.registry.remember(profile,{...health,root:'/'},{status:'ready',count:1}),/invalid/);f.setProfile({...profile,version:2});assert.throws(()=>f.registry.remember(profile,health,{status:'ready',count:1}),/profile_changed/);assert.equal(f.values.size,0);});
test('confirmed cache or environment failure marks maintenance without destroying setup; verified success clears it',()=>{const f=fixture();const first=f.registry.remember(profile,health,{status:'ready',count:2});f.registry.markMaintenance(profile,'PRIVATE_REMOTE_ERROR');assert.equal(f.registry.read(request).status,'configured');const view=f.registry.markMaintenance(profile,'worker_cache_invalid');assert.equal(view.status,'maintenance_required');assert.equal(view.registration.root,first.registration.root);assert.equal(view.registration.checkedAt,first.registration.checkedAt);assert.deepEqual(view.registration.maintenance,{code:'worker_cache_invalid'});assert.throws(()=>f.registry.validateReuse(profile),/maintenance_required/);assert(!JSON.stringify([...f.values.values()]).includes('PRIVATE_REMOTE_ERROR'));const restored=f.registry.remember(profile,health,{status:'ready',count:2});assert.equal(restored.status,'configured');assert.equal(restored.registration.maintenance,undefined);});


test('observed common locations survive refresh, runtime update and controller reload without crossing host or configuration',()=>{
 const f=fixture(),locations={schemaVersion:1,scope:'remote-observed',loginDirectory:'/owned/home',observedAt:1000,workspaces:[{path:'/owned/project',projectId:'project-1',source:'worker-project'}],skills:[{path:'/owned/skill',source:'worker-cluster-skill'}]};
 const saved=f.registry.remember(profile,{...health,locations},{status:'ready',count:1});assert.equal(saved.registration.locations.workspaces[0].status,'observed');
 f.registry.remember(profile,health,{status:'ready',count:1});assert.deepEqual(f.registry.read(request).registration.locations,saved.registration.locations);
 const updated={...health,runtime:health.root+'/runtimes/'+'b'.repeat(20),runtimeId:'b'.repeat(20),locations:{...locations,observedAt:2000,workspaces:[],skills:[]}};
 const after=f.registry.remember(profile,updated,{status:'ready',count:1});assert.equal(after.registration.locations.workspaces[0].status,'previously-observed');assert.equal(after.registration.locations.workspaces[0].lastSeenAt,1000);assert.equal(after.registration.locations.skills[0].status,'previously-observed');
 assert.equal(f.registry.read(request).registration.locations.workspaces[0].path,'/owned/project');
 const other=f.registry.remember(profile,{...updated,locations:undefined,hostIdentity:{...health.hostIdentity,machineId:'changed-host'}},{status:'ready',count:1});assert.equal(other.registration.locations,undefined);
});
test('location records reject traversal and do not accept local skill paths as remote observations',()=>{
 const f=fixture();for(const locations of [{schemaVersion:1,scope:'remote-observed',loginDirectory:'/owned/../other',observedAt:1,workspaces:[],skills:[]},{schemaVersion:1,scope:'local-profile',loginDirectory:'/owned/home',observedAt:1,workspaces:[],skills:[]}])assert.throws(()=>f.registry.remember(profile,{...health,locations},{status:'ready',count:1}),/locations_invalid/);
});

test('common remote locations persist in the actual local catalog across close/reopen and application update',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-locations-owned-'));let catalog;
 const profiles={read:()=>structuredClone(profile),list:()=>[structuredClone(profile)]};
 try{catalog=new Catalog(root);let registry=createSshServiceRegistration({catalog,profiles});
  const locations={schemaVersion:1,scope:'remote-observed',loginDirectory:'/owned/home',observedAt:1000,workspaces:[{path:'/owned/project',projectId:'owned-project',source:'worker-project'}],skills:[]};
  registry.remember(profile,{...health,locations},{status:'ready',count:1});catalog.db.close();catalog=new Catalog(root);registry=createSshServiceRegistration({catalog,profiles});
  assert.equal(registry.read(request).registration.locations.workspaces[0].path,'/owned/project');
  registry.remember(profile,{...health,runtimeId:'c'.repeat(20),runtime:health.root+'/runtimes/'+'c'.repeat(20)},{status:'ready',count:1});
  assert.equal(registry.read(request).registration.locations.workspaces[0].path,'/owned/project');
 }finally{catalog?.db.close();fs.rmSync(root,{recursive:true,force:true});}
});
});
