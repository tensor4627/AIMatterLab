import test from 'node:test';
import assert from 'node:assert/strict';
import {actualAuthoringWorker,isSshWorkerBinding,sameWorkerBinding,taskWorkerSettings,validTaskWorkerSource} from '../../contracts/compute/task-worker-binding.mjs';
import {readWorkerStatus} from '../../backend/main/compute/worker-status.mjs';
import {workerObservationEvidence} from '../../backend/main/compute/worker-service-version.mjs';
import {restoreTaskWorker} from '../../backend/main/compute/worker-restore.mjs';
import {rememberExplicitWorker,explicitWorkerReceipt,taskWorkerTarget,validExplicitBinding} from '../../backend/main/compute/explicit-worker-binding.mjs';
import {deploymentWorker} from '../../backend/main/workspace/deployment-state.mjs';

const identity={kind:'ssh',profileId:'saved-profile',profileVersion:3,hostIdentity:{hostname:'fixture.invalid',uid:1000,machineId:'inert-machine-id'},root:'/fixture/studio',runtime:'/fixture/studio/runtimes/01234567890123456789',runtimeId:'01234567890123456789'};
function fixture(){const settings={distribution:'Must Never Start WSL',workerRoot:'~/untouched',workerPort:8767},calls=[],health={name:'gpu-sampling-studio',root:identity.root,runtime:identity.runtime,ssh_service:true,hostIdentity:{...identity.hostIdentity},execution_policy:'desktop-review-v1'};
 const worker={identity:{...structuredClone(identity),sessionId:'ephemeral-A'},connection:{health:structuredClone(health)},connectionTarget:{kind:'ssh',sessionId:'ephemeral-A',port:40000},connectionEpoch:1,restore:async()=>{throw Error('No automatic WSL restore is allowed');},request:async(method,path)=>{calls.push([method,path]);if(path==='/api/health')return structuredClone(health);if(path==='/api/projects')return [{id:'project'}];throw Error('Unexpected source fixture API');}};
 const binding=actualAuthoringWorker(worker),task={id:'task',provider:'codex',threadId:'thread',projectId:'project',authoring:{workerBinding:binding}},owner={taskId:task.id,provider:task.provider,threadId:task.threadId},rows=new Map(),catalog={get:(kind,id)=>rows.get(kind+':'+id)||null,put:(kind,id,value)=>rows.set(kind+':'+id,structuredClone(value))};
 const context={worker,catalog,settings:()=>settings,selection:()=>owner,selectionEpoch:()=>1,records:{read:()=>structuredClone(task),conversation:()=>({taskId:task.id}),deleted:()=>false}};
 return {worker,health,binding,task,owner,context,catalog,calls,settings};}

test('SSH bindings are stable version2 provenance without terminal ids, dynamic ports or credentials',()=>{const f=fixture(),value=actualAuthoringWorker(f.worker);assert.equal(value.version,2);assert(isSshWorkerBinding(value));assert(!Object.hasOwn(value,'sessionId'));assert(!Object.hasOwn(value,'port'));assert.equal(value.distribution,undefined);f.worker.identity.sessionId='ephemeral-B';f.worker.connectionTarget.port=40100;assert.deepEqual(actualAuthoringWorker(f.worker),value);assert.deepEqual(deploymentWorker(f.worker),value);assert(sameWorkerBinding(value,f.worker));assert.deepEqual(taskWorkerSettings(f.task,f.settings),value);assert.deepEqual(taskWorkerTarget(f.task,f.settings,f.catalog),value);});

for(const field of ['profileId','profileVersion','root','runtime','runtimeId','hostname','uid','machineId'])test('saved SSH source refuses a changed '+field,()=>{const f=fixture();if(['hostname','uid','machineId'].includes(field))f.worker.identity.hostIdentity[field]=field==='uid'?2000:'changed';else f.worker.identity[field]=field==='profileVersion'?4:'changed';assert.equal(sameWorkerBinding(f.binding,f.worker),false);});

test('an SSH source cannot be confused with a WSL service sharing the same directory',()=>{const f=fixture();f.worker.identity={distribution:'Fixture WSL',root:identity.root};assert.equal(sameWorkerBinding(f.binding,f.worker),false);assert.equal(validTaskWorkerSource({source:'authoring',binding:{...identity,version:1}}),false);});

test('SSH health observation is real, readonly, bounded and returns only opaque safe provenance',async()=>{const f=fixture(),value=await readWorkerStatus(f.worker,()=>f.settings);assert.equal(value.status,'connected');assert.equal(value.sourceKind,'ssh');assert.match(value.sourceId,/^[a-f0-9]{64}$/);assert.deepEqual(f.calls,[['GET','/api/health']]);assert(!JSON.stringify(value).includes(identity.root));assert(!JSON.stringify(value).includes(identity.hostIdentity.machineId));});

function independentConnection(f,connectionId='owned-connection-A'){
 f.worker.identity={...f.worker.identity,version:3,connectionId};f.worker.connection.transport='ssh-connection';f.worker.connectionTarget={...f.worker.identity,serviceId:'owned-service',port:40000};return connectionId;
}

test('verified version3 SSH status exposes the exact connection separately from the stable worker source across relogin',async()=>{
 const f=fixture(),connectionId=independentConnection(f),first=await readWorkerStatus(f.worker,()=>f.settings);assert.equal(first.connectionId,connectionId);assert.equal(first.status,'connected');assert.equal(workerObservationEvidence(f.worker).connectionId,connectionId);
 independentConnection(f,'owned-connection-B');f.worker.connectionEpoch++;const second=await readWorkerStatus(f.worker,()=>f.settings);assert.equal(second.connectionId,'owned-connection-B');assert.equal(second.sourceId,first.sourceId);assert.equal(second.profileId,first.profileId);assert(!JSON.stringify(second).includes(identity.root));
});

test('legacy SSH provenance never fabricates a current connection id from an unrelated field',async()=>{
 const f=fixture();f.worker.identity.version=2;f.worker.identity.connectionId='legacy-unproved';f.worker.connection.transport='ssh-terminal';assert.equal(workerObservationEvidence(f.worker).connectionId,undefined);assert.equal((await readWorkerStatus(f.worker,()=>f.settings)).connectionId,undefined);
});

for(const mode of ['missing target','foreign target','wrong transport','unverified health'])test('unverified version3 SSH '+mode+' cannot publish a current connection id',async()=>{
 const f=fixture();independentConnection(f);if(mode==='missing target')f.worker.connectionTarget=null;else if(mode==='foreign target')f.worker.connectionTarget.connectionId='foreign-connection';else if(mode==='wrong transport')f.worker.connection.transport='ssh-terminal';else f.worker.request=async()=>({...f.health,ssh_service:false});
 if(mode!=='unverified health')assert.equal(workerObservationEvidence(f.worker).connectionId,undefined);
 const observed=await readWorkerStatus(f.worker,()=>f.settings);assert.equal(observed.status,'unknown');assert.equal(observed.connectionId,undefined);assert.equal(observed.sourceId,undefined);
});

for(const mode of ['identity connection id','target connection id','identity version'])test('a health reply for superseded SSH '+mode+' cannot publish its late connection id',async()=>{
 const f=fixture();independentConnection(f);let reply;f.worker.request=()=>new Promise(resolve=>{reply=resolve;});const pending=readWorkerStatus(f.worker,()=>f.settings);await new Promise(resolve=>setImmediate(resolve));
 if(mode==='identity connection id')f.worker.identity.connectionId='replacement';else if(mode==='target connection id')f.worker.connectionTarget.connectionId='replacement';else f.worker.identity.version=2;
 reply(f.health);const observed=await pending;assert.equal(observed.status,'unknown');assert.equal(observed.connectionId,undefined);assert.equal(observed.sourceId,undefined);
});

const eventLoop=()=>new Promise(resolve=>setImmediate(resolve));
function deferredHealth(f){let resolve;const pending=new Promise(done=>{resolve=done;});f.worker.connect=f.worker.restore=f.worker.close=()=>assert.fail('Status must not change or reconnect the existing transport');f.worker.request=async(method,path)=>{f.calls.push([method,path]);return pending;};return resolve;}

test('a healthy SSH service taking four seconds stays pending beyond the local budget and reports its exact existing source',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(),reply=deferredHealth(f);let settled=false;
 const pending=readWorkerStatus(f.worker,()=>f.settings).then(value=>{settled=true;return value;});await eventLoop();t.mock.timers.tick(4000);await eventLoop();assert.equal(settled,false);
 reply(f.health);const observed=await pending;assert.equal(observed.status,'connected');assert.equal(observed.sourceKind,'ssh');assert.deepEqual(f.calls,[['GET','/api/health']]);
});

test('default SSH observation times out at fifteen seconds without reconnecting or trusting its later response',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(),reply=deferredHealth(f);let settled=false;
 const pending=readWorkerStatus(f.worker,()=>f.settings).then(value=>{settled=true;return value;});await eventLoop();t.mock.timers.tick(14999);await eventLoop();assert.equal(settled,false);t.mock.timers.tick(1);const observed=await pending;assert.equal(observed.status,'unknown');
 reply(f.health);await eventLoop();assert.equal(observed.status,'unknown');assert.deepEqual(f.calls,[['GET','/api/health']]);
});

test('an explicit SSH observation timeout overrides the longer transport default',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(),reply=deferredHealth(f);let settled=false;
 const pending=readWorkerStatus(f.worker,()=>f.settings,{timeoutMs:5}).then(value=>{settled=true;return value;});await eventLoop();t.mock.timers.tick(4);await eventLoop();assert.equal(settled,false);t.mock.timers.tick(1);assert.equal((await pending).status,'unknown');reply(f.health);await eventLoop();assert.deepEqual(f.calls,[['GET','/api/health']]);
});

for(const changed of ['connection','identity','epoch','host binding'])test('slow healthy SSH cannot restore a superseded '+changed,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture(),reply=deferredHealth(f),pending=readWorkerStatus(f.worker,()=>f.settings);await eventLoop();t.mock.timers.tick(4000);await eventLoop();
 if(changed==='connection')f.worker.connection={...f.worker.connection};else if(changed==='identity')f.worker.identity={...f.worker.identity};else if(changed==='epoch')f.worker.connectionEpoch++;else f.worker.identity.hostIdentity.machineId='changed-host';
 reply(f.health);assert.equal((await pending).status,'unknown');assert.deepEqual(f.calls,[['GET','/api/health']]);
});

test('fresh snake-case Python health is compared against the accepted normalized identity',async()=>{const f=fixture();f.worker.request=async()=>({...f.health,hostIdentity:undefined,host_identity:{hostname:identity.hostIdentity.hostname,uid:1000,machine_id:identity.hostIdentity.machineId}});assert.equal((await readWorkerStatus(f.worker,()=>f.settings)).status,'connected');f.worker.request=async()=>({...f.health,hostIdentity:{...identity.hostIdentity,machineId:'different'}});assert.equal((await readWorkerStatus(f.worker,()=>f.settings)).status,'unknown');});

test('same-session task restore observes the exact SSH service without opening any transport',async()=>{const f=fixture(),value=await restoreTaskWorker(f.context,{taskId:f.task.id});assert.equal(value.status,'connected');assert.equal(value.profileId,identity.profileId);assert.deepEqual(f.calls,[['GET','/api/health']]);});

test('disconnected SSH task requests explicit original SSH login and never defaults to WSL',async()=>{const f=fixture();f.worker.connection=null;const value=await restoreTaskWorker(f.context,{taskId:f.task.id});assert.equal(value.status,'disconnected');assert.equal(value.reason,'ssh_reconnect_required');assert.equal(value.profileId,identity.profileId);assert.equal(f.calls.length,0);});

test('a new SSH connection must not be replaced automatically while restoring a historical WSL task',async()=>{const f=fixture();f.task.authoring.workerBinding={distribution:'Old WSL',root:'/old',port:8767};const value=await restoreTaskWorker(f.context,{taskId:f.task.id});assert.equal(value.reason,'source_mismatch');assert.equal(f.calls.length,0);});

test('explicit SSH receipt persists only verified stable identity and never a WSL target',async()=>{const f=fixture();assert.equal(await rememberExplicitWorker(f.context,explicitWorkerReceipt(f.worker,f.settings)),true);const saved=f.catalog.get('worker-binding','last-explicit');assert(validExplicitBinding(saved,f.settings));assert.equal(saved.kind,'ssh');assert.equal(saved.version,2);assert.equal(saved.sessionId,undefined);assert.equal(saved.port,undefined);assert.equal(saved.settingsSignature,undefined);});

test('global SSH restore is read-only and asks for original login after desktop disconnection',async()=>{const f=fixture();await rememberExplicitWorker(f.context,explicitWorkerReceipt(f.worker,f.settings));f.context.selection=()=>null;f.worker.connection=null;const value=await restoreTaskWorker(f.context,{scope:'global'});assert.equal(value.reason,'ssh_reconnect_required');assert.equal(value.profileId,identity.profileId);});
