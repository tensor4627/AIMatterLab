import __node_test, {describe as __describe} from 'node:test';
import assert from "node:assert/strict";
import {createComputeOnboarding} from "../../backend/main/compute/compute-onboarding.mjs";
import {createComputeConnection} from "../../backend/main/compute/compute-connection.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Catalog} from "../../backend/main/workspace/catalog.mjs";
import {createComputeProfiles, previewComputeProfileUpdate} from "../../backend/main/compute/compute-profiles.mjs";
import {createComputeResourceBinding} from "../../backend/main/compute/resource-binding.mjs";
import {saveComputeProfileWithEnvironment} from "../../backend/main/compute/compute-profile-environment-save.mjs";
import {existingConnections, existingProfile, rememberXshellSession} from "../../backend/main/compute/existing-ssh.mjs";
import {createManagedComputeResources} from "../../backend/main/compute/managed-compute-resources.mjs";

await __describe("compute-onboarding", async () => {
const test = __node_test;
test('discovery registers only observed identities, with no grants or scientific requests',async()=>{
 const calls=[],events=[],worker={connection:{},async request(method,target,data){calls.push({method,target,data});return target.endsWith('discover')?{identity:'receipt',observed_at:123,entries:[{id:'gpu',status:'discovered'},{python:'/missing',status:'blocked'}]}:{environments:[{id:'env'}]};}};
 const result=await createComputeOnboarding({worker,publish:e=>events.push(e)})();
 assert.equal(result.status,'observed');assert.deepEqual(calls.map(x=>x.target),['/api/environments/discover','/api/environments/adopt']);assert.deepEqual(calls[1].data,{identity:'receipt',candidates:['gpu']});assert.equal(events.at(-1).params.count,1);
});
test('a worker switch during discovery cannot register the old findings into the new worker',async()=>{
 const calls=[],worker={connection:{},async request(method,target){calls.push(target);worker.connection={};return {identity:'old',entries:[{id:'old',status:'discovered'}]};}};
 await assert.rejects(createComputeOnboarding({worker})(),/connection changed/);assert.deepEqual(calls,['/api/environments/discover']);
});
test('discovery failure remains blocked and is not silently registered',async()=>{
 const events=[],worker={connection:{},async request(){throw Error('unavailable');}};
 await assert.rejects(createComputeOnboarding({worker,publish:e=>events.push(e)})(),/unavailable/);assert.equal(events.at(-1).params.status,'blocked');
});
test('parallel requests share the same discovery and registration, empty findings do not register',async()=>{
 let release,count=0;const waiting=new Promise(resolve=>{release=resolve;}),worker={connection:{},async request(){count++;await waiting;return {identity:'empty',entries:[]};}};
 const setup=createComputeOnboarding({worker}),first=setup(),second=setup();release();const values=await Promise.all([first,second]);assert.equal(count,1);assert.equal(values[0].status,'blocked');
});
test('explicit read-only setup cannot register a candidate',async()=>{
 const calls=[],worker={connection:{},async request(method,target){calls.push(target);return {identity:'receipt',entries:[{id:'gpu',status:'discovered'}]};}};
 await createComputeOnboarding({worker})({register:false});assert.deepEqual(calls,['/api/environments/discover']);
});
});

await __describe("compute-profile-connection", async () => {
const test = __node_test;
const defer=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture({selectedTask=true,intent='existing',present=true,inventoryWait}={}){
 let profile={id:'profile-one',version:2,kind:'wsl',name:'Saved test service',distribution:'Fixture Linux',root:'/fixture/service',port:9080,intent},epoch=1,selected=selectedTask?{provider:'codex',threadId:'fixture-thread',taskId:'fixture-task'}:null,config={distribution:'Default',workerRoot:'/default',workerPort:8767,autoDiscoverCompute:false},runtime={path:'/fixture/runtime'},last=null;
 const task={id:'fixture-task',provider:'codex',threadId:'fixture-thread',name:'Original task',authoring:{workerBinding:{distribution:'Original Linux',root:'/original',port:9081}}},original=structuredClone(task),calls=[];
 const worker={connection:null,connectionEpoch:0,bindingIntent:0,matchesTarget:t=>!!worker.connection&&worker.identity.root===t.workerRoot&&worker.identity.distribution===t.distribution&&worker.connectionTarget.port===t.workerPort,close(){calls.push('close');this.connection=null;this.connectionEpoch++;},readExisting:async()=>({status:'connected'}),async restore(t){calls.push('restore');if(present){this.identity={root:t.workerRoot,distribution:t.distribution};this.connectionTarget={port:t.workerPort};this.connection={};return {status:'connected'};}return {status:'disconnected'};},async connect(t){calls.push('start');this.bindingIntent++;this.connectionEpoch++;this.identity={root:t.workerRoot,distribution:t.distribution};this.connectionTarget={port:t.workerPort};this.connection={};},async request(){calls.push('discovery');return {identity:'fixture',entries:[]};}};
 const api=createComputeConnection({worker,profiles:{read:({id})=>{assert.equal(id,profile?.id||'profile-one');return structuredClone(profile);}},records:{read:()=>structuredClone(task)},catalog:{get:kind=>kind==='worker-binding'?last:null,put(){throw Error('Task binding must not change');}},settings:()=>config,selection:()=>selected,selectionEpoch:()=>epoch,source:()=>runtime,inventory:async()=>{if(inventoryWait)await inventoryWait;return ['Fixture Linux','Original Linux'];},readStatus:async(w,t)=>({status:w.matchesTarget(t())?'connected':'unknown',serviceVersion:'current'}),inspectDataRoot:async()=>({status:'available'}),beforeSwitch:()=>calls.push('switch'),saveSettings:t=>{calls.push('saveSettings');config={...t};},remember:(t,r)=>{calls.push('remember');last={target:t,intent:r.intent};},onConnected:()=>calls.push('connected'),bindFreshSources:()=>calls.push('bindSources')});
 return {api,worker,calls,task,original,get profile(){return profile;},setProfile:p=>profile=p,setOwner:()=>{selected=null;epoch++;},setSource:()=>runtime={path:'/changed'},get config(){return config;}};
}
const plan=f=>f.api.plan({profileId:f.profile.id,profileVersion:f.profile.version});
const connect=(f,p)=>f.api.connect({planId:p.planId,requestId:'fixture-request'});
test('explicit saved profile is a global target while selected task and its source remain unchanged',async()=>{
 const f=fixture(),p=await plan(f);assert.equal(p.scope,'saved-profile');assert.equal(p.profileId,'profile-one');assert.equal(p.profileVersion,2);assert.equal(p.profileName,'Saved test service');assert.equal(p.taskId,null);assert.deepEqual(p.target,{distribution:'Fixture Linux',root:'/fixture/service',port:9080});assert.equal(p.intent,'existing');assert.equal(p.locked,true);
 const result=await connect(f,p);assert.equal(result.connection,'connected');assert.deepEqual(f.task,f.original);assert.equal(f.config.workerRoot,'/fixture/service');assert.deepEqual(f.calls.filter(x=>['saveSettings','remember','connected'].includes(x)),['saveSettings','remember','connected']);assert(!f.calls.includes('bindSources'));assert(!f.calls.includes('discovery'));
});
test('profile renderer input cannot replace registry target or combine task restoration',async()=>{
 const f=fixture();for(const extra of [{taskId:'fixture-task'},{distribution:'Other'},{advanced:{root:'/other',port:9000}},{newSource:true},{intent:'standard'},{legacyPort:{planId:'x',port:9000}},{root:'/other'}])await assert.rejects(f.api.plan({profileId:'profile-one',profileVersion:2,...extra}));
 for(const value of [{profileId:'profile-one'},{profileVersion:2},{profileId:'profile-one',profileVersion:1},{profileId:'other',profileVersion:2}])await assert.rejects(f.api.plan(value));assert.deepEqual(f.calls,[]);
});
for(const change of ['version','target','removed','owner','source','task'])test('stale saved profile plan rejects before first connection side effect: '+change,async()=>{
 const f=fixture(),p=await plan(f);if(change==='version')f.setProfile({...f.profile,version:3});if(change==='target')f.setProfile({...f.profile,root:'/different'});if(change==='removed')f.setProfile(null);if(change==='task')f.task.authoring.workerBinding.root='/changed-task';if(change==='owner')f.setOwner();if(change==='source')f.setSource();await assert.rejects(connect(f,p));assert.deepEqual(f.calls,[]);assert.equal(f.api.status({planId:p.planId}).status,'superseded');
});
test('profile change during read-only restore rejects late result and prevents startup/settings/remember',async()=>{
 const f=fixture(),gate=defer();f.worker.readExisting=()=>gate.promise;const p=await plan(f),pending=connect(f,p);await Promise.resolve();f.setProfile({...f.profile,version:3});gate.resolve({status:'disconnected'});assert.equal((await pending).status,'superseded');assert(!f.calls.some(x=>['restore','start','saveSettings','remember','connected'].includes(x)));
});
test('cancelled profile plan has no side effects; duplicate connect request is idempotent',async()=>{
 const f=fixture(),p=await plan(f);f.api.cancel({planId:p.planId});await assert.rejects(connect(f,p));assert.deepEqual(f.calls,[]);
 const g=fixture(),q=await plan(g);await Promise.all([connect(g,q),connect(g,q)]);assert.equal(g.calls.filter(x=>x==='restore').length,1);assert.equal(g.calls.filter(x=>x==='remember').length,1);
});
test('saved profile standard startup remains explicit and cannot rewrite selected workflow transport',async()=>{
 const f=fixture({intent:'standard',present:false}),p=await plan(f);assert.equal((await connect(f,p)).mode,'started');assert.equal(f.calls.filter(x=>x==='start').length,1);assert(!f.calls.includes('bindSources'));assert.deepEqual(f.task,f.original);
});
test('invalid saved profiles fail closed without running inventory/worker operations',async()=>{
 for(const patch of [{kind:'ssh'},{version:0},{root:'/'},{port:22},{distribution:'bad;command'},{intent:'other'}]){const f=fixture();f.setProfile({...f.profile,...patch});await assert.rejects(plan(f));assert.deepEqual(f.calls,[]);}
});

test('profile removed while inventory is pending returns superseded without a target attempt',async()=>{const gate=defer(),f=fixture({inventoryWait:gate.promise}),pending=plan(f);f.setProfile(null);gate.resolve();const result=await pending;assert.equal(result.status,'superseded');assert.equal(result.planId,null);assert.deepEqual(f.calls,[]);});
});

await __describe("compute-profile-environment-save", async () => {
const test = __node_test;
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
const content={kind:'ssh',name:'Owned fixture',host:'fixture.invalid',username:'fixture-user',port:22,ssh_client:'/usr/bin/ssh',mode:'interactive'};
async function fixture(t,{live=true,service={status:'disconnected',workflowReady:false}}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-service-environment-save-')),catalog=new Catalog(root),registry=createComputeProfiles({catalog}),profile=registry.save({expectedVersion:0,...content}),events=[],sessionId='owned-session',receipts=new WeakMap();
 let knownVersion=1,binding,gate,prepareError,mainPending=false;
 const facts=()=>({sessionId,resource:{kind:'ssh-terminal',profileId:profile.id,profileVersion:knownVersion},operator:'human',processStatus:'running',alive:true,agentReady:false,authentication:'not_observed',managedRuns:false});
 const terminal={
  inUseProfileIds:()=>live?[profile.id]:[],resourceState:async()=>facts(),
  async prepareProfileEnvironmentUpdate({previous,next}){events.push('prepare');if(prepareError)throw Error(prepareError);const captured={revision:binding.revision(),knownVersion,previous,next};if(gate)await gate;const receipt=Object.freeze({sessionIds:Object.freeze(live?[sessionId]:[])});receipts.set(receipt,captured);return receipt;},
  assertProfileEnvironmentUpdate(receipt){const captured=receipts.get(receipt);if(!captured||captured.revision!==binding.revision()||captured.knownVersion!==knownVersion)throw Error('terminal_context_changed');},
  commitProfileEnvironmentUpdate(receipt,saved){terminal.assertProfileEnvironmentUpdate(receipt);assert.deepEqual(saved,receipts.get(receipt).next);assert.equal(registry.read({id:profile.id}).version,saved.version);knownVersion=saved.version;receipts.delete(receipt);events.push('terminal-commit');return {sessionIds:live?[sessionId]:[]};},
 };
 binding=createComputeResourceBinding({catalog,profiles:registry,terminal});if(live)await binding.activate({kind:'ssh-terminal',profileId:profile.id,profileVersion:1,sessionId});
 const profiles={...registry,save(request){events.push('profile-save');return registry.save(request);}};
 const sshService={peek:()=>structuredClone(service),assertProfileEnvironmentUpdate(){if(mainPending)throw Error('compute_profile_environment_in_use');},profileEnvironmentUpdated(previous,saved){assert.equal(previous.id,saved.id);events.push('service-retire');if(service.profileId===previous.id&&service.profileVersion===previous.version&&service.status==='failed'&&service.terminalAccess==='available')service={status:'disconnected',workflowReady:false};}};
 t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});
 const request={id:profile.id,expectedVersion:1,...content,serviceEnvironment:{python:'/fixture/venv/bin/python',activation:'source /fixture/venv/bin/activate'}};
 return {catalog,registry,profiles,profile,terminal,binding,sshService,events,sessionId,request,save:requestValue=>saveComputeProfileWithEnvironment({profiles,terminal,resource:binding,sshService,assertIdle:()=>{}},requestValue||request),setGate:value=>gate=value,setPrepareError:value=>prepareError=value,setMainPending:value=>mainPending=value,get knownVersion(){return knownVersion;}};
}

test('explicit environment save retains the selected authenticated terminal reference without reconnecting or granting readiness',async t=>{
 const f=await fixture(t),before=f.binding.peek(),oldTicket=f.binding.capture(),saved=await f.save();assert.equal(saved.version,2);assert.deepEqual(saved.serviceEnvironment,f.request.serviceEnvironment);assert.equal(f.knownVersion,2);assert.deepEqual(f.binding.peek(),{...before,profileVersion:2});assert.throws(()=>f.binding.assertCurrent(oldTicket),/selection_changed/);
 const current=await f.binding.status({});assert.equal(current.sessionId,f.sessionId);assert.equal(current.operator,'human');assert.equal(current.agentReady,false);assert.equal(current.managedRuns,false);assert.equal(current.authentication,'not_observed');assert.deepEqual(f.events,['prepare','profile-save','terminal-commit','service-retire']);
});

for(const status of ['connecting','connected','disconnecting','unknown'])test('environment save refuses an existing '+status+' service before changing a profile or terminal',async t=>{
 const f=await fixture(t);f.sshService.peek=()=>({profileId:f.profile.id,profileVersion:1,status,terminalAccess:status==='unknown'?'unknown':'reserved'});await assert.rejects(f.save(),/environment_in_use/);assert.equal(f.registry.read({id:f.profile.id}).version,1);assert.equal(f.binding.peek().profileVersion,1);assert.equal(f.knownVersion,1);assert.deepEqual(f.events,[]);
});

test('confirmed failed/available service may retire but a still-pending main attempt remains fenced',async t=>{
 const f=await fixture(t);f.sshService.peek=()=>({profileId:f.profile.id,profileVersion:1,status:'failed',terminalAccess:'available'});f.setMainPending(true);await assert.rejects(f.save(),/environment_in_use/);assert.equal(f.registry.read({id:f.profile.id}).version,1);f.setMainPending(false);assert.equal((await f.save()).version,2);
});

test('read-only bridge preparation refusal never falls back to saving an unadopted live environment',async t=>{
 const f=await fixture(t);f.setPrepareError('terminal_service_unknown');await assert.rejects(f.save(),/environment_in_use/);assert.equal(f.registry.read({id:f.profile.id}).version,1);assert.equal(f.binding.peek().profileVersion,1);assert.equal(f.knownVersion,1);assert.deepEqual(f.events,['prepare']);
});

test('selection changes during preparation leave environment and terminal proof unchanged',async t=>{
 const f=await fixture(t),gate=deferred();f.setGate(gate.promise);const saving=f.save();await new Promise(resolve=>setImmediate(resolve));f.binding.clear({selectionId:f.binding.peek().selectionId});gate.resolve();await assert.rejects(saving,/terminal_context_changed/);assert.equal(f.registry.read({id:f.profile.id}).version,1);assert.equal(f.knownVersion,1);assert.equal(f.binding.peek(),null);assert(!f.events.includes('profile-save'));
});

test('profile edits during preparation keep the newer saved content and reject stale environment adoption',async t=>{
 const f=await fixture(t),gate=deferred();f.setGate(gate.promise);const saving=f.save();await new Promise(resolve=>setImmediate(resolve));f.registry.save({id:f.profile.id,expectedVersion:1,...content,name:'Changed while checking'});gate.resolve();await assert.rejects(saving,/profile_changed/);assert.equal(f.registry.read({id:f.profile.id}).name,'Changed while checking');assert(!f.registry.read({id:f.profile.id}).serviceEnvironment);assert.equal(f.knownVersion,1);assert(!f.events.includes('profile-save'));
});

test('live environment adoption rejects simultaneous host/client metadata changes and missing selected-session proof',async t=>{
 const f=await fixture(t);await assert.rejects(f.save({...f.request,host:'another.invalid'}),/environment_in_use/);assert.equal(f.registry.read({id:f.profile.id}).version,1);assert.deepEqual(f.events,[]);
 const original=f.terminal.prepareProfileEnvironmentUpdate;f.terminal.prepareProfileEnvironmentUpdate=async value=>{const receipt=await original(value);return {...receipt,sessionIds:[]};};await assert.rejects(f.save(),/session_mismatch/);assert.equal(f.registry.read({id:f.profile.id}).version,1);assert.equal(f.knownVersion,1);
});

test('normalized update preview is side-effect free and preserves an unchanged version',async t=>{
 const f=await fixture(t),next=previewComputeProfileUpdate(f.profile,f.request);assert.equal(next.version,2);assert.deepEqual(next.serviceEnvironment,f.request.serviceEnvironment);assert.equal(f.registry.read({id:f.profile.id}).version,1);assert.equal(previewComputeProfileUpdate(f.profile,{id:f.profile.id,expectedVersion:1,...content}).version,1);assert.throws(()=>previewComputeProfileUpdate(f.profile,{...f.request,expectedVersion:2}),/profile_changed/);assert.throws(()=>previewComputeProfileUpdate(f.profile,{...f.request,serviceEnvironment:{python:'python;id',activation:''}}),/invalid_request/);
});

test('saving SSH Python environment preserves managed SSH hosting on the updated version without probing',async t=>{
 const f=await fixture(t),calls=[];
 let openRequests=0,failPrepare=true,readyService={id:'service-active',generation:'gen-active',health:{},verify:async()=>({})};
 const terminal={
  connections:{
   state:async({connectionId})=>connectionId===f.sessionId?{connectionId:f.sessionId,profileId:f.profile.id,profileVersion:f.profiles.read({id:f.profile.id}).version,status:'authenticated',authentication:'verified',capabilities:{multiplex:true}}:null,
   managedShell:async()=>{openRequests++;return {sessionId:'shell-1'};},
  },
 };
 const services={ssh:async()=>{calls.push('prepare');if(failPrepare)throw Error('ssh_service_registration_required');return readyService;}};
 const workspace={assertHandoff:async()=>({workspaceId:'2'.repeat(64),resourceId:'1'.repeat(64),root:'/fixture/work',account:'user',hostIdentity:{hostname:'cluster.example',uid:1001,machineId:'machine-1'}}),publicWorkspace:row=>({workspaceId:row.workspaceId,root:row.root})};
 const managedResources=createManagedComputeResources({profiles:f.profiles,terminal,resourceWorkspace:workspace,services,selectionCatalog:f.catalog,authorizeTerminal:()=>true,terminalPolicyRevision:()=>1});
 t.after(()=>managedResources.stop());
 const resource=await managedResources.publish({connectionId:f.sessionId,profileId:f.profile.id,profileVersion:1});
 assert.equal(resource.profileVersion,1);
 for(let i=0;i<10&&managedResources.snapshot().find(item=>item.profileId===f.profile.id)?.serviceStatus==='preparing';i++)await new Promise(resolve=>setImmediate(resolve));
 calls.length=0;
 const result=await saveComputeProfileWithEnvironment({profiles:f.profiles,terminal:f.terminal,resource:f.binding,managedResources,assertIdle:()=>{}},f.request);
 assert.equal(result.version,2);
 const updated=managedResources.snapshot().find(item=>item.profileId===f.profile.id);
 assert.equal(updated.profileVersion,2);
 assert.equal(updated.serviceStatus,'configuration_required');
 assert.equal(f.catalog.get('managed-ssh-hosting',f.profile.id).profileVersion,2);
 assert.deepEqual(calls,[]);
 assert.equal(openRequests,0);

 failPrepare=false;
 await managedResources.configureService({connectionId:f.sessionId,profileId:f.profile.id,profileVersion:2});
 assert.throws(()=>managedResources.assertProfileEnvironmentUpdate(result),/compute_profile_environment_in_use/);
});
});

await __describe("compute-profile-removal", async () => {
const test = __node_test;
const wsl={kind:'wsl',name:'Removal fixture WSL',distribution:'Fixture Linux',root:'/fixture/service',port:19000,intent:'existing'};
const ssh={kind:'ssh',name:'Removal fixture SSH',host:'example.invalid',username:'fixture-user',port:22,ssh_client:'/usr/bin/ssh',identity_file:'~/.ssh/inert-reference',mode:'interactive'};
function fixture(t){const base=process.env.STUDIO_PROFILE_REMOVAL_TEST_ROOT||os.tmpdir();fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'profile-removal-')),catalog=new Catalog(root),profiles=createComputeProfiles({catalog,initialWsl:wsl});t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});return {catalog,profiles,root};}

for(const profile of [wsl,ssh])test('removing saved '+profile.kind+' metadata preserves every other catalog domain and profile',t=>{
 const f=fixture(t),a=f.profiles.save({expectedVersion:0,...profile}),b=f.profiles.save({expectedVersion:0,...ssh,name:'Preserved other connection'});
 for(const kind of ['settings','worker-binding','environment','project','run','shared-terminal','credential-reference'])f.catalog.put(kind,'preserved',{kind,fixture:true});
 const before=f.catalog.db.prepare("SELECT kind,id,data FROM records WHERE kind!='compute-profile' ORDER BY kind,id").all();
 assert.deepEqual(f.profiles.remove({id:a.id,expectedVersion:a.version}),{removed:true,id:a.id,version:a.version});
 assert.throws(()=>f.profiles.read({id:a.id}),/compute_profile_unavailable/);assert.deepEqual(f.profiles.list(),[b]);
 const after=f.catalog.db.prepare("SELECT kind,id,data FROM records WHERE kind NOT IN ('compute-profile','compute-profile-registry') ORDER BY kind,id").all();assert.deepEqual(after,before);
 assert.equal(fs.readdirSync(f.root).some(name=>/key|credential/.test(name)),false);
});

test('stale version refuses removal without writing a seed marker or touching the latest profile',t=>{
 const f=fixture(t),a=f.profiles.save({expectedVersion:0,...ssh}),updated=f.profiles.save({id:a.id,expectedVersion:1,...ssh,name:'Newer retained version'});
 assert.throws(()=>f.profiles.remove({id:a.id,expectedVersion:1}),/compute_profile_changed/);assert.deepEqual(f.profiles.read({id:a.id}),updated);assert.equal(f.catalog.get('compute-profile-registry','main'),null);
});

test('removal request is exact, versioned and never accepts transport or credential mutations',t=>{
 const f=fixture(t),a=f.profiles.save({expectedVersion:0,...ssh});
 for(const request of [null,{},[],{id:a.id},{id:a.id,expectedVersion:0},{id:a.id,expectedVersion:1.5},{id:'invalid',expectedVersion:1},{id:a.id,expectedVersion:1,disconnect:true},{id:a.id,expectedVersion:1,deleteRemote:true},{id:a.id,expectedVersion:1,password:'INERT TEST ONLY'}])assert.throws(()=>f.profiles.remove(request),/compute_profile_invalid_request/);
 assert.deepEqual(f.profiles.read({id:a.id}),a);assert.equal(f.catalog.get('compute-profile-registry','main'),null);
});

test('missing saved record fails without inventing success or a seed marker',t=>{
 const f=fixture(t);assert.throws(()=>f.profiles.remove({id:'00000000-0000-4000-8000-000000000001',expectedVersion:1}),/compute_profile_unavailable/);assert.equal(f.catalog.get('compute-profile-registry','main'),null);
});

test('deleting the last seeded WSL profile stays deleted across registry recreation and database reopen',t=>{
 const f=fixture(t),[a]=f.profiles.list();f.profiles.remove({id:a.id,expectedVersion:a.version});assert.deepEqual(f.profiles.list(),[]);
 const reopened=new Catalog(f.root);try{const again=createComputeProfiles({catalog:reopened,initialWsl:wsl});assert.deepEqual(again.list(),[]);assert.equal(reopened.get('compute-profile-registry','main').initial_wsl_seed_consumed,true);assert.throws(()=>again.read({id:a.id}),/compute_profile_unavailable/);}finally{reopened.db.close();}
});

test('marker write failure rolls back deletion and preserves the saved profile',t=>{
 const f=fixture(t),a=f.profiles.save({expectedVersion:0,...ssh}),put=f.catalog.put;
 f.catalog.put=function(kind,...args){if(kind==='compute-profile-registry')throw Error('owned marker fixture failure');return put.call(this,kind,...args);};
 assert.throws(()=>f.profiles.remove({id:a.id,expectedVersion:1}),/marker fixture failure/);assert.deepEqual(f.profiles.read({id:a.id}),a);assert.equal(f.catalog.get('compute-profile-registry','main'),null);
});

test('removal requires a transaction-capable catalog before any mutation',()=>{
 let changes=0;const profiles=createComputeProfiles({catalog:{get:()=>null,list:()=>[],put:()=>changes++,remove:()=>changes++}});
 assert.throws(()=>profiles.remove({id:'00000000-0000-4000-8000-000000000001',expectedVersion:1}),/compute_profile_unavailable/);assert.equal(changes,0);
});

test('unknown or malformed registry marker refuses deletion and preserves both stored records byte for byte',t=>{
 const f=fixture(t),a=f.profiles.save({expectedVersion:0,...ssh});
 for(const marker of [{schema_version:2,initial_wsl_seed_consumed:true,future:'preserve'}, {schema_version:1,initial_wsl_seed_consumed:false},{schema_version:1},'malformed',[],false]){
  f.catalog.put('compute-profile-registry','main',marker);const before=f.catalog.db.prepare('SELECT kind,id,data FROM records ORDER BY kind,id').all();assert.throws(()=>f.profiles.remove({id:a.id,expectedVersion:1}),/compute_profile_unavailable/);assert.deepEqual(f.catalog.db.prepare('SELECT kind,id,data FROM records ORDER BY kind,id').all(),before);
 }
});

test('a valid existing registry marker is retained without rewriting extension fields',t=>{
 const f=fixture(t),a=f.profiles.save({expectedVersion:0,...ssh}),marker={schema_version:1,initial_wsl_seed_consumed:true,compatible_note:'retained'};f.catalog.put('compute-profile-registry','main',marker);assert.equal(f.profiles.remove({id:a.id,expectedVersion:1}).removed,true);assert.deepEqual(f.catalog.get('compute-profile-registry','main'),marker);
});
});

await __describe("compute-profiles", async () => {
const test = __node_test;
const wsl={kind:'wsl',name:'Fixture WSL',distribution:'Fixture Linux',root:'/fixture/worker',port:19000,intent:'existing'};
const ssh={kind:'ssh',name:'Fixture SSH',host:'example.invalid',username:'fixture-user',port:22,ssh_client:'/usr/bin/ssh',mode:'interactive',distribution:'Fixture Linux'};
test('gateway asset login remains one literal username and persists its exact route',()=>{const h=setup(),username='fixture-user/10.20.30.40/self',saved=h.profiles.save({expectedVersion:0,...ssh,username});assert.equal(h.profiles.read({id:saved.id}).username,username);for(const name of ['fixture/host','fixture//self','fixture/host/','fixture/host/self/other','fixture/host/self;id','fixture/host/$(id)','-oProxyCommand/host/self','fixture/host/self\nextra'])assert.throws(()=>h.profiles.save({expectedVersion:0,...ssh,username:name}),/invalid_request/);});
function setup(extra={}){let serial=0,inside=false,transactions=0;const rows=new Map(),catalog={get(k,id){return rows.get(k+':'+id)?structuredClone(rows.get(k+':'+id)):null;},put(k,id,v){assert(inside);rows.set(k+':'+id,structuredClone(v));},remove(k,id){assert(inside);rows.delete(k+':'+id);},list(k){return [...rows].filter(([key])=>key.startsWith(k+':')).map(([,v])=>structuredClone(v));},transaction(work){assert(!inside);inside=true;transactions++;try{return work();}finally{inside=false;}}};const profiles=createComputeProfiles({catalog,id:()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`,...extra});return {profiles,rows,catalog,get transactions(){return transactions;}};}
test('multiple flat WSL/SSH profiles have main-owned UUID/version and isolated returned values',()=>{const h=setup(),a=h.profiles.save({expectedVersion:0,...wsl}),b=h.profiles.save({expectedVersion:0,...ssh});assert.notEqual(a.id,b.id);assert.equal(a.version,1);assert.equal(b.version,1);assert.equal(h.profiles.list().length,2);assert.equal(h.profiles.list({kind:'ssh'})[0].id,b.id);b.proxy_jump.push('not-stored');assert.deepEqual(h.profiles.read({id:b.id}).proxy_jump,[]);assert.equal(h.transactions,2);});
test('optimistic update rejects stale/foreign IDs, keeps no-op version stable and cannot change kind',()=>{const h=setup(),a=h.profiles.save({expectedVersion:0,...wsl});assert.equal(h.profiles.save({id:a.id,expectedVersion:1,...wsl}).version,1);const b=h.profiles.save({id:a.id,expectedVersion:1,...wsl,name:'Renamed'});assert.equal(b.version,2);assert.throws(()=>h.profiles.save({id:a.id,expectedVersion:1,...wsl}),/profile_changed/);assert.deepEqual(h.profiles.read({id:a.id,version:1}),a);assert.throws(()=>h.profiles.read({id:a.id,version:99}),/profile_changed/);assert.throws(()=>h.profiles.save({id:'00000000-0000-4000-8000-999999999999',expectedVersion:1,...wsl}),/profile_unavailable/);assert.throws(()=>h.profiles.save({id:a.id,expectedVersion:2,...ssh}),/invalid_request/);assert.equal(h.profiles.read({id:a.id}).version,2);});
test('no password/token/inline-key fields or caller versions/creation IDs enter storage',()=>{const h=setup();for(const bad of [{...ssh,password:'TEST_ONLY'},{...ssh,passphrase:'TEST_ONLY'},{...ssh,token:'TEST_ONLY'},{...ssh,private_key:'TEST_ONLY'},{...ssh,identity_file:'-----BEGIN PRIVATE KEY-----'},{...ssh,identity_file:'ssh-ed25519 public-inline'},{...ssh,version:20},{...ssh,id:'00000000-0000-4000-8000-999999999999'}])assert.throws(()=>h.profiles.save({expectedVersion:0,...bad}));assert.equal(h.rows.size,0);});
test('flat schema and bounded paths/endpoints/routes reject ambiguous or hostile data',()=>{const h=setup();for(const bad of [{...wsl,root:'/'},{...wsl,root:'/fixture/../other'},{...wsl,port:22},{...wsl,intent:'update'},{...wsl,wsl:{root:'/other'}},{...ssh,host:'-oProxyCommand=x'},{...ssh,username:''},{...ssh,ssh_client:'ssh'},{...ssh,port:65536},{...ssh,distribution:''},{...ssh,proxy_jump:['bad; command']},{...ssh,via:Array(9).fill('hop.invalid')},{...ssh,identity_file:'/fixture/key\nextra'}])assert.throws(()=>h.profiles.save({expectedVersion:0,...bad}),/invalid_request/);assert.equal(h.rows.size,0);});
test('explicit current WSL seed is generic, happens once on first empty list and never guesses SSH',()=>{const h=setup({initialWsl:{...wsl,name:'must-not-copy',version:1,checkedAt:123,host:'must-not-copy.invalid'}});assert.equal(h.rows.size,0);const [a]=h.profiles.list();assert.equal(a.name,'WSL');assert.equal(a.kind,'wsl');assert.equal(a.intent,'existing');assert(!Object.hasOwn(a,'host'));assert.equal(h.profiles.list()[0].id,a.id);assert.equal(h.catalog.list('compute-profile').length,1);assert.equal(h.catalog.list('compute-profile-version').length,1);assert.deepEqual(setup().profiles.list(),[]);});
test('seed never overwrites an existing registry and save/read/list have no transport side effects',()=>{const h=setup({initialWsl:wsl});const a=h.profiles.save({expectedVersion:0,...ssh});assert.deepEqual(h.profiles.list().map(x=>x.id),[a.id]);assert.equal(h.catalog.list('compute-profile').length,1);assert.equal(h.catalog.list('compute-profile-version').length,1);assert.deepEqual(Object.keys(h.profiles).sort(),['list','read','remove','save']);assert.throws(()=>h.profiles.read({id:a.id,connect:true}),/invalid_request/);assert.throws(()=>h.profiles.list({kind:'other'}),/invalid_request/);});
test('explicit SSH default identities and optional WSL namespace survive without credential resolution',()=>{const h=setup(),a=h.profiles.save({expectedVersion:0,...ssh,distribution:'Another Fixture Linux',identity_file:'~/.ssh/fixture',proxy_jump:['jump-user@hop.invalid:22'],via:['legacy.invalid']});assert.equal(a.identity_file,'~/.ssh/fixture');assert.equal(a.distribution,'Another Fixture Linux');const b=h.profiles.save({expectedVersion:0,...ssh,distribution:undefined,ssh_client:'C:\\Windows\\System32\\OpenSSH\\ssh.exe'});assert.equal(b.identity_file,'');assert(!Object.hasOwn(b,'distribution'));assert.deepEqual(b.proxy_jump,[]);});

test('optional SSH service environment is versioned per profile and legacy profiles keep their original shape',()=>{
 const h=setup(),legacy=h.profiles.save({expectedVersion:0,...ssh});assert(!Object.hasOwn(legacy,'serviceEnvironment'));
 assert.equal(h.profiles.save({id:legacy.id,expectedVersion:1,...ssh}).version,1);
 const serviceEnvironment={python:'/opt/fixture conda/envs/studio/bin/python',activation:'source /opt/fixture/conda.sh\r\nconda activate studio'};
 const saved=h.profiles.save({id:legacy.id,expectedVersion:1,...ssh,serviceEnvironment});assert.equal(saved.version,2);assert.deepEqual(saved.serviceEnvironment,{python:serviceEnvironment.python,activation:'source /opt/fixture/conda.sh\nconda activate studio'});
 saved.serviceEnvironment.python='mutated';assert.equal(h.profiles.read({id:saved.id}).serviceEnvironment.python,serviceEnvironment.python);
 const another=h.profiles.save({expectedVersion:0,...ssh,name:'Other connection',serviceEnvironment:{python:'python3.12'}});assert.deepEqual(another.serviceEnvironment,{python:'python3.12',activation:''});assert.equal(h.profiles.read({id:legacy.id}).serviceEnvironment.activation,'source /opt/fixture/conda.sh\nconda activate studio');
 assert.throws(()=>h.profiles.save({id:legacy.id,expectedVersion:1,...ssh,serviceEnvironment}),/profile_changed/);
});

test('service interpreter is a single explicit executable and activation is bounded typed text only',()=>{
 const h=setup();
 for(const python of ['', '-c','python3 -u','python;id','$(python)','python`id`','~/env/bin/python','./python','/opt/env/bin/python;id','/opt/../bin/python','/opt//python','/opt/python\nextra','C:\\env\\python.exe','/opt/env/'])assert.throws(()=>h.profiles.save({expectedVersion:0,...ssh,serviceEnvironment:{python,activation:''}}),/invalid_request/,python);
 for(const env of [null,[],{}, {python:'python3',password:'private'}, {python:'python3',activation:9}, {python:'python3',activation:'x'.repeat(8193)}, {python:'python3',activation:'source\0private'}, {python:'python3',activation:'\x1b[H'}])assert.throws(()=>h.profiles.save({expectedVersion:0,...ssh,serviceEnvironment:env}),/invalid_request/);
 assert.throws(()=>h.profiles.save({expectedVersion:0,...wsl,serviceEnvironment:{python:'python3',activation:''}}),/invalid_request/);assert.equal(h.rows.size,0);
});
});

await __describe("existing-ssh-xshell", async () => {
const test = __node_test;
function fixture(t){const home=fs.mkdtempSync(path.join(os.tmpdir(),'studio-native-session-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));const sessions=path.join(home,'Documents','NetSarang Computer','8','Xshell','Sessions');fs.mkdirSync(sessions,{recursive:true});return {home,sessions,write(name,body,encoding='utf8'){const file=path.join(sessions,name+'.xsh');fs.writeFileSync(file,encoding==='utf16le'?Buffer.concat([Buffer.from([255,254]),Buffer.from(body,'utf16le')]):body);return file;}};}
const session=(extra='')=>'[CONNECTION]\r\nHost=fixture.example.invalid\r\nPort=2201\r\nProtocol=SSH\r\n[CONNECTION:AUTHENTICATION]\r\nUserName=fixture_user\r\nUserKey=\r\nPassword=DO_NOT_EXPOSE_PASSWORD\r\nPassphrase=DO_NOT_EXPOSE_PASSPHRASE\r\nPkcs11Pin=DO_NOT_EXPOSE_PIN\r\n[CONNECTION:PROXY]\r\nProxy=0\r\n'+extra;
test('Xshell discovery returns opaque local labels and selected import keeps default authentication',t=>{const f=fixture(t);f.write('合成会话',session(),'utf16le');const rows=existingConnections(f.home),entry=rows.find(r=>r.source==='xshell');assert(entry);assert.equal(entry.label,'合成会话');assert(!JSON.stringify(rows).includes(f.home));assert(!JSON.stringify(rows).includes('fixture.example.invalid'));const p=existingProfile(f.home,entry.ref);assert.equal(p.host,'fixture.example.invalid');assert.equal(p.username,'fixture_user');assert.equal(p.port,2201);assert.equal(p.identity_file,'');assert.equal(p.auth_mode,'key');assert.equal(p.source,'xshell');assert.equal(p.import_review.requires_review,false);assert.equal(p.import_review.identity_reference_kind,'default');for(const secret of ['DO_NOT_EXPOSE_PASSWORD','DO_NOT_EXPOSE_PASSPHRASE','DO_NOT_EXPOSE_PIN'])assert(!JSON.stringify(p).includes(secret));});
test('Codex import without identity uses normal client defaults rather than guessing id_rsa',t=>{const f=fixture(t),dir=path.join(f.home,'.codex');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'.codex-global-state.json'),JSON.stringify({'codex-managed-remote-connections':[{hostId:'old-ref',hostname:'user@fixture.example.invalid'}]}));const p=existingProfile(f.home,'old-ref');assert.equal(p.identity_file,'');assert.equal(p.username,'user');assert.equal(p.source,'codex');assert(!JSON.stringify(p).includes('id_rsa'));});
test('Xshell file identity, ownership and literal refs prevent path or stale-source import',t=>{const f=fixture(t),file=f.write('fixture',session()),entry=existingConnections(f.home).find(r=>r.source==='xshell');assert.throws(()=>existingProfile(f.home,file),/available|reference/i);assert.throws(()=>existingProfile(f.home,{path:file}),/reference/i);const other=fixture(t);assert.throws(()=>existingProfile(other.home,entry.ref),/available|reference/i);fs.appendFileSync(file,'\r\n[SessionInfo]\r\nDescription=changed\r\n');assert.throws(()=>existingProfile(f.home,entry.ref),/changed|stale/i);});
test('UTF8 source preserves explicit key references without opening the key file',t=>{const f=fixture(t),key=path.join(f.home,'fixture-key-reference');fs.writeFileSync(key,'DO_NOT_READ_PRIVATE_KEY_CONTENT');const file=f.write('referenced',session().replace('UserKey=','UserKey='+key)),open=fs.openSync,read=fs.readFileSync;fs.openSync=(p,...args)=>{assert.notEqual(p,key,'private key must not be opened');return open(p,...args);};fs.readFileSync=(p,...args)=>{assert.notEqual(p,key,'private key must not be read');return read(p,...args);};try{const entry=rememberXshellSession(f.home,file),p=existingProfile(f.home,entry.ref);assert.equal(p.identity_file,key);assert.equal(p.import_review.identity_reference_kind,'file');assert(!JSON.stringify(p).includes('DO_NOT_READ_PRIVATE_KEY_CONTENT'));}finally{fs.openSync=open;fs.readFileSync=read;}});
test('complex proxy, native key names and startup scripts remain explicit pending review',t=>{const f=fixture(t),file=f.write('review',session().replace('UserKey=','UserKey=native-vault-reference').replace('Proxy=0','Proxy=proxy-reference')+'[CONNECTION:SSH]\r\nFwdReqCount=1\r\nRemoteCommand=native-startup-reference\r\n');const p=existingProfile(f.home,rememberXshellSession(f.home,file).ref);assert.equal(p.import_review.requires_review,true);assert.equal(p.import_review.route_status,'needs_review');assert.equal(p.import_review.identity_reference_kind,'native_reference');assert(p.import_review.reasons.includes('xshell_proxy_requires_review'));assert(p.import_review.reasons.includes('xshell_forwarding_requires_review'));assert(p.import_review.reasons.includes('xshell_native_key_reference_requires_review'));assert(p.import_review.reasons.includes('xshell_startup_requires_review'));assert.equal(p.identity_file,'');assert.deepEqual(p.proxy_jump,[]);assert.deepEqual(p.via,[]);});
test('an explicit picker action never accepts a renderer path, preserves cancellation and imports selected file only',async t=>{const f=fixture(t),file=f.write('picked',session());const entry=existingConnections(f.home,{includeXshellPicker:true}).find(r=>r.action==='select-session');assert(entry);let calls=0;const cancelled=await existingProfile(f.home,entry.ref,{selectXshellSession:async()=>{calls++;return null;}});assert.deepEqual(cancelled,{cancelled:true});assert.equal(calls,1);const p=await existingProfile(f.home,entry.ref,{selectXshellSession:async()=>file});assert.equal(p.host,'fixture.example.invalid');assert.equal(p.source,'xshell');assert.throws(()=>existingProfile(f.home,entry.ref),/selection|picker/i);});
test('unsupported protocol, duplicate connection fields and inline key contents fail closed',t=>{const f=fixture(t);for(const [name,body]of [['protocol',session().replace('Protocol=SSH','Protocol=TELNET')],['duplicate',session().replace('Host=fixture.example.invalid','Host=fixture.example.invalid\r\nHost=other.example.invalid')],['inlinekey',session().replace('UserKey=','UserKey=-----BEGIN PRIVATE KEY-----')]]){const file=f.write(name,body);assert.throws(()=>existingProfile(f.home,rememberXshellSession(f.home,file).ref),/protocol|duplicate|reference/i);}});
test('discovery does not follow session symlinks and selected import rejects oversized data',t=>{const f=fixture(t),large=f.write('oversized',session()+';'+'.'.repeat(300000));assert.throws(()=>rememberXshellSession(f.home,large),/bounded|size/i);const outside=path.join(f.home,'outside.xsh');fs.writeFileSync(outside,session());try{fs.symlinkSync(outside,path.join(f.sessions,'link.xsh'));}catch(e){if(['EPERM','EACCES'].includes(e.code))return;throw e;}assert(!existingConnections(f.home).some(r=>r.label==='link'));});
test('main-provided redirected Documents metadata is bounded and missing source errors disclose no path',t=>{const f=fixture(t),documents=path.join(f.home,'redirected-documents'),sessions=path.join(documents,'NetSarang Computer','7','Xshell','Sessions');fs.mkdirSync(sessions,{recursive:true});const file=path.join(sessions,'redirected.xsh');fs.writeFileSync(file,session());const entry=existingConnections(f.home,{documents}).find(r=>r.label==='redirected');assert(entry);fs.unlinkSync(file);assert.throws(()=>existingProfile(f.home,entry.ref),error=>/unavailable/.test(error.message)&&!error.message.includes(f.home));});
test('forged picker-looking references do not call the native file picker',t=>{const f=fixture(t);let called=false;assert.throws(()=>existingProfile(f.home,'xshell-forged',{selectXshellSession:()=>{called=true;return 'untrusted';}}),/available/);assert.equal(called,false);});
test('discovery bounds all streamed directory entries including unrelated files',t=>{const f=fixture(t),open=fs.opendirSync;let reads=0,closed=0;fs.opendirSync=()=>({readSync(){reads++;assert(reads<=1024,'entry scan must stop at the global limit');return {name:'unrelated-'+reads+'.txt',isSymbolicLink:()=>false,isDirectory:()=>false,isFile:()=>true};},closeSync(){closed++;}});try{assert.deepEqual(existingConnections(f.home),[]);assert.equal(reads,1024);assert.equal(closed,1);}finally{fs.opendirSync=open;}});
});
