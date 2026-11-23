/** Service capability on an independently authenticated SSH connection. */
import {checkedSshLocations} from '../../../contracts/compute/ssh-service-locations.mjs';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {posix} from 'node:path';
import {prepareSshServiceResourcesAsync,shippedSshServiceManifest} from './ssh-service-resources.mjs';
import {safeSshServiceError,safeSshServicePhase,safeSshServiceProgress} from './ssh-service-state.mjs';
import {assertTaskWorker} from '../../../contracts/compute/task-worker-binding.mjs';
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v),id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v);
const fail=code=>{throw Error(code);};
const exact=(v,keys,required=keys)=>{if(!object(v)||Object.keys(v).some(k=>!keys.includes(k))||required.some(k=>!Object.hasOwn(v,k)))fail('ssh_service_invalid_request');};
export function normalizeSshServiceHealth(value){
 const v=value?.health||value?.service?.health||value?.service||value,h=v?.hostIdentity||v?.host_identity||{hostname:v?.hostname,uid:v?.uid,machineId:v?.machineId},runtimeId=v?.runtimeId||v?.runtime_id;
 if(!object(v)||v.name!=='gpu-sampling-studio'||v.execution_policy!=='desktop-review-v1'||typeof v.root!=='string'||!v.root.startsWith('/')||typeof v.runtime!=='string'||!v.runtime.startsWith('/')||!(/^[a-f0-9]{20}$/).test(runtimeId||'')||typeof h.hostname!=='string'||!h.hostname||h.hostname.length>255||!Number.isSafeInteger(h.uid)||h.uid<0||typeof h.machineId!=='string'||!h.machineId||h.machineId.length>256||!Number.isInteger(v.port)||v.port<1024||v.port>65535)fail('ssh_service_identity_unavailable');
 const report={name:v.name,version:v.version,root:v.root,runtime:v.runtime,execution_policy:v.execution_policy,port:v.port,runtimeId,hostIdentity:{hostname:h.hostname,uid:h.uid,machineId:h.machineId},transport:'ssh-connection',ssh_service:true};
 if(v.locations!==undefined){try{report.locations=checkedSshLocations(v.locations);}catch{fail('ssh_service_identity_unavailable');}}
 const manifest=v.runtimeManifestSha256||v.runtime_manifest_sha256;if(manifest!==undefined){if(!/^[a-f0-9]{64}$/.test(manifest)||manifest.slice(0,20)!==runtimeId)fail('ssh_service_identity_unavailable');report.runtimeManifestSha256=manifest;}
 if(['observed-legacy-cache','verified-cached-manifest','shipped-manifest'].includes(v.runtimeSourceScope||v.runtime_source_scope))report.runtimeSourceScope=v.runtimeSourceScope||v.runtime_source_scope;
 for(const [key,version] of Object.entries(v))if(/^[a-z][a-z0-9_]{0,80}_schema$/.test(key)&&Number.isSafeInteger(version)&&version>0)report[key]=version;
 return report;
}
const sameHealth=(a,b)=>['root','runtime','runtimeId','port'].every(k=>a[k]===b[k])&&equal(a.hostIdentity,b.hostIdentity);
function verifiedLiveHealth(ready,value){
 const live=normalizeSshServiceHealth(value);
 if(!sameHealth(ready,live)||ready.runtimeManifestSha256&&live.runtimeManifestSha256&&ready.runtimeManifestSha256!==live.runtimeManifestSha256)fail('ssh_service_identity_changed');
 return {...live,...ready.runtimeManifestSha256?{runtimeManifestSha256:ready.runtimeManifestSha256}:{},
  ...ready.runtimeSourceScope?{runtimeSourceScope:ready.runtimeSourceScope}:{},...ready.locations?{locations:ready.locations}:{}};
}
function createConnectionService({worker,connections,profiles,resource,source,transportSource,registration,preferredRuntimeId=()=>undefined,current=()=>null,assertIdle=()=>{},publish=()=>{},remember=()=>{},onRuntimeUpdated,prepareResources=prepareSshServiceResourcesAsync}){
 let record=null,connecting=null,stopping=null,updating=null,updatingGrant=null,reattaching=null,serial=0,revision=0,grant=null,grantIntent=0;
 const updates=new Map(),updateOrigins=new WeakSet();
 const authoringGrants=new WeakMap(),scope=v=>v&&typeof v.provider==='string'&&typeof v.threadId==='string'&&v.threadId?{provider:v.provider,threadId:v.threadId,...v.taskId?{taskId:v.taskId}:{}}:null;
 const contextScope=v=>{const owner=scope(v);return owner?{...owner,...Object.fromEntries(['projectId','environmentId','inputRoot'].map(k=>[k,v[k]??null]))}:null;};
 const selectedRecord=owned=>{const s=resource.peek();return s?.schemaVersion===2&&s.kind==='ssh-connection'&&s.connectionId===owned?.connectionId&&s.profileId===owned.profileId&&s.profileVersion===owned.profileVersion;};
 function hasCurrentGrant(provider,caller){return !!(grant&&record?.status==='connected'&&selectedRecord(record)&&worker.connection===record.connection&&equal(worker.identity,grant.identity)&&grant.provider===provider&&grant.connectionId===record.connectionId&&grant.serviceId===record.serviceId&&grant.attemptId===record.attemptId&&equal(grant.scope,contextScope(current()))&&(caller===undefined||equal(grant.scope,contextScope(caller))));}
 function revokeGrant(){if(grant)worker.revokeProvider?.(grant.provider);grant=null;}
 function safe(){return {schemaVersion:2,status:record?.status||'disconnected',workflowReady:!!(record?.status==='connected'&&worker.connection===record.connection&&worker.identity?.kind==='ssh'&&worker.identity.connectionId===record.connectionId&&worker.connectionTarget?.serviceId===record.serviceId),operator:hasCurrentGrant(scope(current())?.provider)?'agent':'human',revision,...record?{...record.warnings?.length?{warnings:[...record.warnings]}:{},connectionId:record.connectionId,profileId:record.profileId,profileVersion:record.profileVersion,attemptId:record.attemptId,serviceActive:record.active,...record.serviceId?{serviceId:record.serviceId}:{},phase:record.phase,startedAt:record.startedAt,phaseStartedAt:record.phaseStartedAt,updatedAt:record.updatedAt,...record.health?{health:structuredClone(record.health)}:{},...record.progress?{progress:structuredClone(record.progress)}:{},...record.error?{error:structuredClone(record.error)}:{}}:{serviceActive:false}};}
 function changed(owned=record){if(owned&&owned!==record)return;revision++;if(record)record.updatedAt=Date.now();publish();}
 function phase(owned,value){if(record!==owned)return;const next=safeSshServicePhase(value,owned.phase);if(next===owned.phase)return;owned.phase=next;owned.phaseStartedAt=Date.now();delete owned.progress;changed(owned);}
 function maintenance(profile,code){try{registration?.markMaintenance?.(profile,code);}catch{}}
 function unknown(owned,error){if(record!==owned)return;const before=JSON.stringify([owned.status,owned.active,owned.error,!!grant]);revokeGrant();owned.status='unknown';owned.active=true;owned.error=safeSshServiceError(error?.message||error,owned.phase);if(before!==JSON.stringify([owned.status,owned.active,owned.error,!!grant]))changed(owned);}
 const sameResource=(owned,v)=>v?.connectionId===owned.connectionId&&v.profileId===owned.profileId&&v.profileVersion===owned.profileVersion;
 const viewMatches=(owned,v)=>sameResource(owned,v)&&v.attemptId===owned.attemptId&&(!owned.serviceId||v.serviceId===owned.serviceId);
 const livePrivate=(owned,v)=>sameResource(owned,v)&&v.status==='connected'&&v.serviceActive===true&&v.channelKind==='private'&&id(v.attemptId)&&id(v.serviceId);
 function startupCancelled(owned,v){
  if(!sameResource(owned,v)||v.cancelled!==true||v.cancelledAttemptId!==owned.attemptId)return false;
  if(viewMatches(owned,v))return v.serviceActive===false;
  // The broker fences the requested start before returning its current channel.
  // An unrelated generation is allowed to remain live on the same master.
  return !owned.serviceId&&!owned.connection&&(id(v.attemptId)&&v.attemptId!==owned.attemptId||
   !v.attemptId&&v.status==='idle'&&v.serviceActive===false);
 }
 function applyView(owned,v){
  if(record!==owned||!viewMatches(owned,v))fail('ssh_service_context_changed');
  const before=JSON.stringify([owned.serviceId,owned.active,owned.progress,owned.error,owned.phase]),next=safeSshServicePhase(v.phase||v.servicePhase,owned.phase);
  if((next!=='ready'||owned.status!=='connecting')&&next!==owned.phase){owned.phase=next;owned.phaseStartedAt=Date.now();}
  if(id(v.serviceId))owned.serviceId=v.serviceId;if(typeof v.serviceActive==='boolean')owned.active=v.serviceActive;
  const p=safeSshServiceProgress(v.progress||v.serviceProgress);if(p)owned.progress=p;else delete owned.progress;
  if(v.error)owned.error=safeSshServiceError(v.error,owned.phase);
  if(before!==JSON.stringify([owned.serviceId,owned.active,owned.progress,owned.error,owned.phase]))changed(owned);
 }
 async function authenticated(owned){if(!connections?.state)fail('ssh_service_connection_required');const v=await connections.state({connectionId:owned.connectionId});if(v?.schemaVersion!==2||v.connectionId!==owned.connectionId||v.profileId!==owned.profileId||v.profileVersion!==owned.profileVersion||v.authentication!=='verified'||v.status!=='authenticated')fail('ssh_service_connection_unavailable');return v;}
 function exactAttempt(data,extra=[],required=[]){exact(data,['connectionId','attemptId',...extra],['connectionId','attemptId',...required]);if(!id(data.connectionId)||!id(data.attemptId)||record?.connectionId!==data.connectionId||record?.attemptId!==data.attemptId)fail('ssh_service_context_changed');return record;}
 async function checkedTools(owned){const failed=owned.failedTraffic||0;let tools;try{tools=await worker.probeTools();}catch{tools={status:'warning',count:0};}if((owned.failedTraffic||0)!==failed)fail('ssh_service_unavailable');const ready=tools?.status==='ready'&&Number.isSafeInteger(tools.count)&&tools.count>0;owned.warnings=ready?[]:['tools_unavailable'];return {status:ready?'ready':'warning',count:Number.isSafeInteger(tools?.count)&&tools.count>=0?tools.count:0,...ready?{}:{warnings:owned.warnings}};}
 async function attach(owned,fresh){
  const request=async p=>{
   if(record!==owned||!['connected','connecting','unknown'].includes(owned.status)||!selectedRecord(owned))fail('ssh_service_context_changed');
   if(owned.status==='unknown'&&!(p.method==='GET'&&p.path==='/api/health'||p.mcp&&p.data?.method==='tools/list'))fail('ssh_service_unavailable');
   profiles.read({id:owned.profileId,version:owned.profileVersion});
   owned.pendingRequests=(owned.pendingRequests||0)+1;
   try{
    const response=await connections.serviceRequest({connectionId:owned.connectionId,serviceId:owned.serviceId,requestId:randomUUID(),method:p.method,target:p.path,data:p.data,mcp:p.mcp,timeoutMs:p.timeoutMs});
    owned.trafficRevision=(owned.trafficRevision||0)+1;
    return response;
   }catch(error){
    // The broker checks the SSH master before forwarding the worker request.
    if(!['ssh_control_timeout','terminal_service_active','terminal_scope_denied','terminal_context_changed'].includes(error?.message)){
     owned.failedTraffic=(owned.failedTraffic||0)+1;
     unknown(owned,error);
    }
    throw error;
   }finally{owned.pendingRequests--;}
  };
  fresh();
  const reply=await request({method:'GET',path:'/api/health',mcp:false,timeoutMs:10000});fresh();
  if(reply.status!==200)fail('ssh_service_identity_changed');
  const health=verifiedLiveHealth(owned.health,reply.data);
  const identity={kind:'ssh',version:3,connectionId:owned.connectionId,profileId:owned.profileId,profileVersion:owned.profileVersion,hostIdentity:health.hostIdentity,root:health.root,runtime:health.runtime,runtimeId:health.runtimeId};
  const install=worker.attachServiceTransport({health,identity,target:{...identity,serviceId:owned.serviceId,port:health.port},source,request,detach:()=>{}});
  const installed=worker.connection;
  try{await install;fresh(installed);}catch(error){if(installed&&worker.connection===installed)worker.close();throw error;}
  owned.connection=worker.connection;owned.health=health;return identity;
 }
 async function update(data){
  const signature=JSON.stringify(data),previous=updates.get(data.requestId);if(previous){if(previous.signature!==signature)fail('ssh_service_invalid_request');resource.assertCurrent(previous.ticket);if(!equal(previous.owner,current()))fail('ssh_service_context_changed');await previous.promise;resource.assertCurrent(previous.ticket);if(!equal(previous.owner,current()))fail('ssh_service_context_changed');return safe();}
  assertIdle();if(updating||connecting||stopping)fail('ssh_service_busy');
  const owned=record;if(!owned||owned.status!=='connected'||!safe().workflowReady||!selectedRecord(owned)||data.expectedAttemptId!==owned.attemptId||data.connectionId!==owned.connectionId||data.profileId!==owned.profileId||data.profileVersion!==owned.profileVersion)fail('ssh_service_context_changed');
  if(typeof connections.prepareServiceUpdate!=='function')fail('ssh_service_context_changed');if(updates.size>=64)fail('ssh_service_busy');
  const ticket=resource.capture(),owner=structuredClone(current()),previousGrant=hasCurrentGrant(scope(owner)?.provider)?grant:null,previousGrantIntent=grantIntent;
  const previousIdentity=structuredClone(worker.identity);
  const fresh=()=>{resource.assertCurrent(ticket);if(!equal(owner,current()))fail('ssh_service_context_changed');profiles.read({id:data.profileId,version:data.profileVersion});};
  updatingGrant=previousGrant;const operation=(async()=>{fresh();const origin=await connections.prepareServiceUpdate({connectionId:owned.connectionId,serviceId:owned.serviceId});fresh();origin.assertCurrent();if(record!==owned||owned.status!=='connected')fail('ssh_service_context_changed');const mayRestoreGrant=previousGrant&&grant===previousGrant&&hasCurrentGrant(previousGrant.provider);
   const closed=await disconnect({connectionId:owned.connectionId,attemptId:owned.attemptId});if(closed.status!=='disconnected'||closed.serviceActive!==false)return closed;
   fresh();origin.assertCurrent();updateOrigins.add(origin);const result=await connect(data,{terminalSessionId:origin.sessionId,conversationChannel:origin.conversationChannel===true,updateOrigin:origin});fresh();origin.assertCurrent();
   if(result.workflowReady&&onRuntimeUpdated&&previousIdentity?.runtimeId!==worker.identity?.runtimeId){
    const updated=record,assertCurrent=()=>{fresh();origin.assertCurrent();if(record!==updated||worker.connection!==updated.connection)fail('ssh_service_context_changed');};
    await onRuntimeUpdated({owner,previous:previousIdentity,assertCurrent});assertCurrent();
   }
   if(result.workflowReady&&mayRestoreGrant&&grantIntent===previousGrantIntent){grant={...previousGrant,serviceId:record.serviceId,attemptId:record.attemptId,identity:structuredClone(worker.identity)};changed();return safe();}return safe();
  })();updates.set(data.requestId,{signature,promise:operation,owner,ticket});updating=operation;try{return await operation;}finally{if(updating===operation){updating=null;updatingGrant=null;}}
 }
 async function connect(data,{startCached=false,terminalSessionId,updateOrigin,conversationChannel=false,existingOnly=false}={}){
  exact(data,['connectionId','profileId','profileVersion','requestId','mode','expectedAttemptId'],['connectionId','profileId','profileVersion','requestId']);if(!id(data.connectionId)||!id(data.profileId)||!id(data.requestId)||!Number.isSafeInteger(data.profileVersion)||data.profileVersion<1||data.mode!==undefined&&!['setup','reuse','check','update'].includes(data.mode)||data.expectedAttemptId!==undefined&&(!id(data.expectedAttemptId)||data.mode!=='update'))fail('ssh_service_invalid_request');
  if(data.mode==='update'&&!updateOrigin){if(updates.has(data.requestId))return update(data);if(record?.status==='connected'){if(data.expectedAttemptId===undefined)fail('ssh_service_channel_in_use');return update(data);}if(data.expectedAttemptId!==undefined)fail('ssh_service_context_changed');}if(updateOrigin&&!updateOrigins.has(updateOrigin))fail('ssh_service_invalid_request');if(updating&&!updateOrigin)fail('ssh_service_busy');
  assertIdle();if(stopping)fail('ssh_service_busy');const profile=profiles.read({id:data.profileId,version:data.profileVersion});if(profile.kind!=='ssh'||!selectedRecord(data))fail('ssh_service_selection_changed');
  const key=JSON.stringify([data,startCached,terminalSessionId,conversationChannel,existingOnly]);if(connecting){if(connecting.key===key)return connecting.promise;fail('ssh_service_busy');}
  if(existingOnly&&record?.status==='unknown'&&record.phase==='ready'&&sameResource(record,data)&&worker.connection===record.connection){
   return check({connectionId:record.connectionId,attemptId:record.attemptId},{privateOnly:true});
  }
  if(record?.status==='connected'&&record.connectionId===data.connectionId){
   if(safe().workflowReady){if(!['reuse','check'].includes(data.mode)&&data.requestId!==record.attemptId)fail('ssh_service_channel_in_use');return check({connectionId:record.connectionId,attemptId:record.attemptId});}if(!['reuse','check'].includes(data.mode))fail('ssh_service_channel_in_use');
   const owned=record,ticket=resource.capture(),owner=structuredClone(current()),fresh=()=>{resource.assertCurrent(ticket);if(record!==owned||owned.status!=='connected'||!selectedRecord(owned)||!conversationChannel&&!equal(owner,current()))fail('ssh_service_context_changed');};
   revokeGrant();try{await authenticated(owned);fresh();const view=await connections.serviceState({connectionId:owned.connectionId,serviceId:owned.serviceId});fresh();if(!viewMatches(owned,view)||view.status!=='connected'||view.serviceActive!==true)fail('ssh_service_unavailable');await attach(owned,fresh);const tools=await checkedTools(owned);fresh();changed();return {...safe(),tools};}catch(error){unknown(owned,error);return safe();}
  }
  let replacement;
  if(existingOnly&&record?.status==='unknown'&&(record.mode??'setup')==='setup'&&record.dispatched&&!record.observedActive&&!record.serviceId&&!record.connection&&sameResource(record,data)){
   const old=record,guard=resource.capture(),owner=structuredClone(current()),version=serial;
   const stillCurrent=()=>{resource.assertCurrent(guard);if(record!==old||serial!==version||stopping||connecting||old.status!=='unknown'||old.serviceId||old.connection||!equal(owner,current()))fail('ssh_service_context_changed');};
   const live=await connections.serviceState({connectionId:old.connectionId});stillCurrent();
   if(livePrivate(old,live)&&live.attemptId!==old.attemptId){
    const cancelled=await connections.cancelServiceStart({connectionId:old.connectionId,requestId:old.attemptId,supersededBy:live.attemptId});stillCurrent();
    if(!startupCancelled(old,cancelled)||cancelled.attemptId!==live.attemptId||cancelled.serviceId!==live.serviceId||
     cancelled.status!=='connected'||cancelled.serviceActive!==true)fail('ssh_service_context_changed');
    replacement=live;revokeGrant();record=null;changed();
   }
  }
  if(record?.status==='failed'&&record.active===false)record=null;if(record)fail('ssh_service_channel_in_use');
  const ticket=resource.capture(),owner=structuredClone(current()),intent=++serial,startedAt=Date.now(),attempt={...data,attemptId:data.requestId,status:'connecting',active:false,dispatched:false,phase:'preparing_local',startedAt,phaseStartedAt:startedAt};
  const fresh=()=>{if(intent!==serial||!conversationChannel&&!equal(owner,current())||record!==attempt)fail('ssh_service_context_changed');resource.assertCurrent(ticket);if(!selectedRecord(attempt))fail('ssh_service_selection_changed');profiles.read({id:data.profileId,version:data.profileVersion});updateOrigin?.assertCurrent();};
  revokeGrant();record=attempt;changed();const promise=(async()=>{try{
   await authenticated(attempt);fresh();const mode=data.mode||'setup',reuse=['reuse','check'].includes(mode);let saved,reconciling=false,healthMaintenance=false;
   if(reuse){if(!registration)fail('ssh_service_registration_required');const view=registration.read({profileId:profile.id,profileVersion:profile.version});healthMaintenance=view.status==='maintenance_required'&&view.reason==='worker_health_invalid';saved=healthMaintenance?view.registration:mode==='reuse'?registration.validateReuse(profile):view.registration;if(!saved)fail('ssh_service_registration_required');}
   const registrationFresh=()=>registration.validateReconciliation(profile,saved);
   if(reuse){
    // Hosted SSH and the foreground workflow use the same authenticated
    // connection. Bind its already started private service without opening,
    // restarting, borrowing or staging a second channel.
    const observed=await connections.serviceState({connectionId:attempt.connectionId});fresh();
    if(replacement&&(!livePrivate(attempt,observed)||observed.attemptId!==replacement.attemptId||observed.serviceId!==replacement.serviceId))fail('ssh_service_context_changed');
    if(observed?.serviceActive===true||observed?.status==='unknown'){
     if(observed.connectionId!==attempt.connectionId||observed.profileId!==attempt.profileId||observed.profileVersion!==attempt.profileVersion||!id(observed.attemptId))fail('ssh_service_context_changed');
     attempt.attemptId=observed.attemptId;attempt.active=true;attempt.observedActive=true;
     applyView(attempt,observed);
     if(observed.status!=='connected'||observed.channelKind!=='private'||!id(observed.serviceId))fail('ssh_service_unavailable');
     const health=normalizeSshServiceHealth(observed);
     if(!sameHealth(health,saved)||saved.runtimeManifestSha256&&health.runtimeManifestSha256!==saved.runtimeManifestSha256)fail('ssh_service_identity_changed');
     if(healthMaintenance)registrationFresh();else registration.validateReuse(profile,health);
     attempt.health=health;phase(attempt,'checking_health');
     const identity=await attach(attempt,fresh);
     phase(attempt,'checking_tools');const tools=await checkedTools(attempt);fresh();
     if(healthMaintenance)registration.rememberVerifiedReuse(profile,saved,health,tools);
     await remember(identity,attempt.health);fresh();attempt.status='connected';delete attempt.error;phase(attempt,'ready');return {...safe(),tools};
    }
   }
   if(existingOnly)fail('ssh_service_unavailable');
   const prepare=async()=>{
    if(reconciling||healthMaintenance)registrationFresh();
    const expectedRuntimeId=reconciling?undefined:reuse?saved.runtimeId:mode==='update'?undefined:preferredRuntimeId(profile);
    const value=await prepareResources(source,{profileId:data.profileId,...reuse?{port:saved.port,reuseOnly:true,...reconciling?{verifiedCacheOnly:true}:saved.runtimeManifestSha256?{expectedRuntimeManifestSha256:saved.runtimeManifestSha256}:{}}:{},...transportSource?{transportSource}:{},...expectedRuntimeId?{expectedRuntimeId}:{}});fresh();await authenticated(attempt);fresh();
    if(reconciling||healthMaintenance)registrationFresh();
    if(reconciling){const p=value?.payload;if(!Array.isArray(p?.files)||p.files.length!==0||!/^[a-f0-9]{64}$/.test(p.runtime_manifest_sha256||'')||p.runtime_manifest_sha256.slice(0,20)!==p.expected_runtime_id)fail('ssh_service_resources_invalid');}
    return value;
   };
   const open=async bootstrap=>{const launch={...bootstrap,...profile.serviceEnvironment?{serviceEnvironment:structuredClone(profile.serviceEnvironment)}:{},...reuse?{reuseOnly:true,...reconciling||healthMaintenance?{startCached:false}:startCached?{startCached:true}:{}}:{}};phase(attempt,launch.serviceEnvironment?'preparing_environment':'waiting_python');attempt.dispatched=true;attempt.active=true;
    const value=await connections.openService({connectionId:data.connectionId,profileId:data.profileId,profileVersion:data.profileVersion,requestId:attempt.attemptId},launch,conversationChannel?{conversationChannel:true}:terminalSessionId?{sessionId:terminalSessionId}:undefined);fresh();applyView(attempt,value);return value;};
   let bootstrap=await prepare(),result;
   if(mode==='setup'&&!terminalSessionId&&!conversationChannel){
    const live=await connections.serviceState({connectionId:attempt.connectionId});fresh();
    if(live?.status==='connected'&&live.serviceActive===true&&live.attemptId!==attempt.attemptId){
     if(!livePrivate(attempt,live))fail('terminal_service_active');
     const health=normalizeSshServiceHealth(live),expected=bootstrap.payload;
     if(health.runtimeId!==expected.expected_runtime_id||health.port!==expected.port||!Array.isArray(expected.files)||!expected.files.length||
      health.runtimeManifestSha256!==shippedSshServiceManifest(expected.files))fail('ssh_service_identity_changed');
     attempt.attemptId=live.attemptId;attempt.observedActive=true;applyView(attempt,live);result=live;
    }
   }
   result??=await open(bootstrap);
   // Reconcile only a completed identity refusal. A timeout, unknown result or
   // active bridge never permits another dispatch. This second bridge can only
   // observe the exact shipped runtime already present and serving this port.
   if(reuse&&result.status==='failed'&&result.serviceActive===false&&(result.error?.code==='worker_health_invalid'&&result.error?.phase==='checking_health'||healthMaintenance&&result.error?.code==='maintenance_required'&&result.error?.phase==='checking_cache')){
    reconciling=true;attempt.dispatched=false;attempt.active=false;delete attempt.serviceId;delete attempt.error;
    const candidate=await prepare();fresh();
    if(candidate.payload.expected_runtime_id===saved.runtimeId){if(saved.runtimeManifestSha256!==undefined&&candidate.payload.runtime_manifest_sha256!==saved.runtimeManifestSha256)fail('ssh_service_identity_changed');reconciling=false;}
    else{bootstrap=candidate;attempt.attemptId=randomUUID();result=await open(bootstrap);}
   }
   if(result.status!=='connected'||result.serviceActive!==true){attempt.status=result.serviceActive===false?'failed':'unknown';attempt.error=safeSshServiceError(result.error||'connection_unconfirmed',attempt.phase);if(reuse)maintenance(profile,attempt.error.code);changed();return safe();}if(!id(result.serviceId))fail('ssh_service_identity_unavailable');
   const health=normalizeSshServiceHealth(result),identity={kind:'ssh',version:3,connectionId:data.connectionId,profileId:data.profileId,profileVersion:data.profileVersion,hostIdentity:health.hostIdentity,root:health.root,runtime:health.runtime,runtimeId:health.runtimeId};if(health.runtimeId!==bootstrap.payload.expected_runtime_id)fail('ssh_service_runtime_changed');
   if(reconciling){registrationFresh();await authenticated(attempt);fresh();registrationFresh();if(health.root!==saved.root||health.port!==saved.port||!equal(health.hostIdentity,saved.hostIdentity)||posix.normalize(health.root)!==health.root||health.root.endsWith('/')||health.runtime!==health.root+'/runtimes/'+health.runtimeId||health.runtimeManifestSha256!==bootstrap.payload.runtime_manifest_sha256||health.runtimeSourceScope!=='verified-cached-manifest')fail('ssh_service_identity_changed');}
   else if(saved&&(!sameHealth(health,saved)||healthMaintenance&&saved.runtimeManifestSha256!==undefined&&health.runtimeManifestSha256!==saved.runtimeManifestSha256))fail('ssh_service_identity_changed');attempt.health=health;phase(attempt,'checking_health');
   await attach(attempt,fresh);
   attempt.connection=worker.connection;phase(attempt,'checking_tools');const tools=await checkedTools(attempt);fresh();if(reconciling||healthMaintenance){await authenticated(attempt);fresh();if(reconciling)registration.reconcileCurrent(profile,saved,attempt.health,tools);else registration.rememberVerifiedReuse(profile,saved,attempt.health,tools);}else registration?.remember(profile,attempt.health,tools);await remember(identity,attempt.health);fresh();attempt.status='connected';attempt.active=true;delete attempt.error;phase(attempt,'ready');return {...safe(),tools};
  }catch(error){if(record!==attempt||intent!==serial)throw error;if(!attempt.observedActive&&(!attempt.dispatched||error?.serviceNotStarted===true)){attempt.dispatched=false;attempt.status='failed';attempt.active=false;if(error?.serviceNotStarted===true)phase(attempt,'preparing_local');attempt.error=safeSshServiceError(error?.message,attempt.phase);changed();}else unknown(attempt,error);if(['reuse','check'].includes(data.mode)&&!['ssh_service_registration_changed','ssh_service_maintenance_required'].includes(error?.message))maintenance(profile,attempt.error.code);return safe();}})();connecting={key,promise,attempt};try{return await promise;}finally{if(connecting?.promise===promise)connecting=null;}
 }
 async function disconnect(data={}){if(!record){exact(data,[]);return safe();}const owned=exactAttempt(data);if(stopping)return stopping;serial++;revokeGrant();owned.status='disconnecting';phase(owned,'stopping');const finish=()=>{if(record!==owned)return safe();record=null;if(worker.connection===owned.connection)worker.close();changed();return {schemaVersion:2,status:'disconnected',workflowReady:false,serviceActive:false,operator:'human',revision,connectionId:owned.connectionId,attemptId:owned.attemptId,profileId:owned.profileId,profileVersion:owned.profileVersion};};
  const pending=(async()=>{if(!owned.dispatched||owned.active===false)return finish();if(connecting?.attempt===owned||!owned.serviceId){const v=await connections.cancelServiceStart({connectionId:owned.connectionId,requestId:owned.attemptId});if(record!==owned)return safe();if(!startupCancelled(owned,v))fail('service_stop_unknown');return finish();}const v=await connections.closeService({connectionId:owned.connectionId,serviceId:owned.serviceId});if(record!==owned)return safe();if(!viewMatches(owned,v)||v.serviceActive!==false||v.status!=='disconnected')fail('service_stop_unknown');return finish();})();stopping=pending;try{return await pending;}catch(error){unknown(owned,error?.message==='service_stop_unknown'?'stop_timeout':error);return safe();}finally{if(stopping===pending)stopping=null;}}
 async function status(data={}){exact(data,[]);const owned=record;if(!owned||!owned.dispatched||!owned.active)return safe();const observingContext=structuredClone(current()),observed=revision,traffic=owned.trafficRevision||0,readId=owned.readId=(owned.readId||0)+1;try{const v=await connections.serviceState({connectionId:owned.connectionId,...owned.serviceId?{serviceId:owned.serviceId}:{}});if(record===owned&&revision===observed&&owned.readId===readId){if(owned.status==='connecting'&&v.status==='idle'&&v.serviceActive===false&&!v.attemptId)return safe();if(!viewMatches(owned,v))fail('ssh_service_context_changed');applyView(owned,v);if(v.status!=='connected'&&owned.status==='connected'||v.serviceActive===false)unknown(owned,v.error||'connection_unconfirmed');}}catch(error){if(error?.message==='terminal_context_changed'&&!equal(observingContext,current()))return safe();const transient=error?.message==='terminal_service_unknown'||error?.message==='terminal_unavailable';if(record===owned&&revision===observed&&owned.readId===readId&&!(transient&&(owned.pendingRequests>0||(owned.trafficRevision||0)!==traffic)))unknown(owned,error);}return safe();}
 async function check(data,{privateOnly=false}={}){
  const owned=exactAttempt(data);assertIdle();
  if(reattaching)fail('ssh_service_busy');
  const detached=owned.status==='unknown'&&owned.phase==='ready'&&owned.active===true&&!!owned.health&&id(owned.serviceId)&&!owned.connection&&!worker.connection;
  if(!detached&&(!['connected','unknown'].includes(owned.status)||!owned.connection||worker.connection!==owned.connection))fail('ssh_service_context_changed');
  const ticket=resource.capture(),owner=structuredClone(current()),generation=serial;
  const reference={profileId:owned.profileId,profileVersion:owned.profileVersion};
  let connection=worker.connection;
  const sameTarget=()=>record===owned&&serial===generation&&equal(owner,current())&&selectedRecord(owned);
  const fresh=(expected=connection)=>{resource.assertCurrent(ticket);if(!sameTarget()||worker.connection!==expected)fail('ssh_service_context_changed');};
  if(detached)reattaching=owned;
  try{
   const saved=detached&&registration?registration.read(reference).registration:undefined;
   if(detached&&registration&&(!saved||!sameHealth(owned.health,saved)))fail('ssh_service_registration_changed');
   fresh();await authenticated(owned);fresh();
   const view=await connections.serviceState({connectionId:owned.connectionId,serviceId:owned.serviceId});fresh();
   if(!viewMatches(owned,view)||view.status!=='connected'||view.serviceActive!==true||(privateOnly||detached)&&view.channelKind!=='private')fail('ssh_service_unavailable');
   let health;
   if(detached){
    await attach(owned,fresh);connection=owned.connection;health=owned.health;
   }else{
    health=verifiedLiveHealth(owned.health,await worker.request('GET','/api/health'));fresh();
   }
   const tools=await checkedTools(owned);fresh();
   if(saved&&!equal(saved,registration.read(reference).registration))fail('ssh_service_registration_changed');
   registration?.remember(profiles.read({id:owned.profileId,version:owned.profileVersion}),health,tools);
   const updated=owned.status!=='connected'||!equal(owned.health,health);
   owned.health=health;connection.health=structuredClone(health);owned.status='connected';delete owned.error;
   if(updated&&owned.phase==='ready')changed(owned);else phase(owned,'ready');
   return {...safe(),tools};
  }catch(error){
   if(detached&&connection&&owned.connection===connection&&worker.connection===connection){owned.connection=null;worker.close();}
   if(!sameTarget())return safe();
   if(error?.message==='ssh_control_timeout')throw error;
   unknown(owned,error);
   if(error?.message!=='ssh_service_registration_changed')maintenance({id:owned.profileId,version:owned.profileVersion,kind:'ssh'},safe().error?.code);
   return safe();
  }finally{if(detached&&reattaching===owned)reattaching=null;}
 }
 async function scheduler(data){const owned=exactAttempt(data,['configuration'],['configuration']);assertIdle();if(!object(data.configuration)||!safe().workflowReady||!selectedRecord(owned))fail('ssh_service_unavailable');const ticket=resource.capture(),connection=worker.connection,identity=structuredClone(worker.identity);const fresh=()=>{resource.assertCurrent(ticket);if(record!==owned||owned.status!=='connected'||worker.connection!==connection||!equal(worker.identity,identity)||!selectedRecord(owned))fail('ssh_service_context_changed');};fresh();const value=await worker.request('POST','/api/ssh-service/scheduler',data.configuration);fresh();return value;}
 function owner(data){const owned=exactAttempt(data,['owner','scope'],['owner']);if(!['human','agent'].includes(data.owner)||owned.status!=='connected'||!safe().workflowReady||!selectedRecord(owned))fail('ssh_service_context_changed');if(data.owner==='agent')assertIdle();const selected=scope(current());if(data.owner==='agent'&&(!selected||!equal(scope(data.scope),selected)))fail('ssh_service_context_changed');grantIntent++;revokeGrant();if(data.owner==='agent')grant={provider:selected.provider,scope:contextScope(current()),connectionId:owned.connectionId,serviceId:owned.serviceId,attemptId:owned.attemptId,identity:structuredClone(worker.identity)};changed();return {...safe(),handoffKind:'service'};}
 function markTerminalHandoff(data){exact(data,['connectionId','attemptId','sessionId']);if(!id(data.sessionId)||record?.connectionId!==data.connectionId||record.attemptId!==data.attemptId||!hasCurrentGrant(scope(current())?.provider))fail('ssh_service_context_changed');grant={...grant,terminalHandoff:{sessionId:data.sessionId,attemptId:data.attemptId}};}
 function reclaimTerminalHandoff(data){exact(data,['connectionId','attemptId','sessionId']);const origin=grant?.terminalHandoff;if(!record||record.connectionId!==data.connectionId||origin?.sessionId!==data.sessionId||origin.attemptId!==data.attemptId)return safe();grantIntent++;if(worker.connection===record.connection)revokeGrant();else grant=null;changed();return safe();}
 function connectionClosed(connectionId){if(record?.connectionId!==connectionId)return;serial++;const owned=record;revokeGrant();record=null;if(worker.connection===owned.connection)worker.close();changed();}
 function hostedServiceReplaced({connectionId,profileId,profileVersion,expectedRuntimeId}){
  if(record?.connectionId!==connectionId||record.profileId!==profileId||record.profileVersion!==profileVersion||record.health?.runtimeId!==expectedRuntimeId)return false;
  connectionClosed(connectionId);return true;
 }
 function connectionLost(connectionId){if(record?.connectionId!==connectionId)return;serial++;const owned=record;unknown(owned,'connection_unconfirmed');if(owned.connection&&worker.connection===owned.connection){owned.connection=null;worker.close();}}
 function terminalClosed(){} // Closing a shell cannot revoke an independent service.
 function releaseLocal(){revokeGrant();if(record?.connection&&worker.connection===record.connection){record.connection=null;worker.close();}changed();}
 function reconcileContext(){if(grant&&!equal(grant.scope,contextScope(current()))){revokeGrant();changed();}}
 function prepareAuthoringGrant(task){const selected=current(),before=contextScope(selected);if(!before||!hasCurrentGrant(before.provider))return null;const taskId=before.taskId??null;if(task?(task.id!==taskId||task.provider!==before.provider||task.threadId!==before.threadId):taskId!==null)return null;if(['taskId','projectId','environmentId','inputRoot'].every(k=>(before[k]??null)!==null))return null;assertIdle();if(task)assertTaskWorker(task,worker);const ticket=Object.freeze({});authoringGrants.set(ticket,{grant,record,connection:worker.connection,identity:structuredClone(worker.identity),resource:resource.capture(),serial:selected.serial,before,taskId:task?.id??null});worker.revokeProvider?.(before.provider);return ticket;}
 function abortAuthoringGrant(ticket){if(!object(ticket))return false;const c=authoringGrants.get(ticket);if(!c)return false;authoringGrants.delete(ticket);if(grant===c.grant||updatingGrant===c.grant)grantIntent++;if(grant===c.grant){revokeGrant();changed();}return false;}
 function completeAuthoringGrant(ticket,task){if(ticket==null)return false;const c=authoringGrants.get(ticket);if(!c)return false;try{resource.assertCurrent(c.resource);profiles.read({id:c.record.profileId,version:c.record.profileVersion});const selected=current(),after=contextScope(selected);if(grant!==c.grant||record!==c.record||record.status!=='connected'||worker.connection!==c.connection||!equal(worker.identity,c.identity)||selected?.serial!==c.serial||!after||after.provider!==c.before.provider||after.threadId!==c.before.threadId||!task||task.provider!==after.provider||task.threadId!==after.threadId||task.id!==(after.taskId??null)||c.taskId!==null&&task.id!==c.taskId)throw Error('ssh_service_context_changed');if(['taskId','projectId','environmentId','inputRoot'].some(k=>(c.before[k]??null)!==null&&c.before[k]!==after[k]))throw Error('ssh_service_context_changed');assertTaskWorker(task,worker);authoringGrants.delete(ticket);worker.revokeProvider?.(after.provider);grant={...c.grant,scope:after};changed();return true;}catch{return abortAuthoringGrant(ticket);}}
 function assertProfileEnvironmentUpdate(previous){if(record?.profileId===previous.id&&!(record.status==='failed'&&record.active===false))fail('compute_profile_environment_in_use');}
 function profileEnvironmentUpdated(previous,next){assertProfileEnvironmentUpdate(previous,next);if(record?.profileId===previous.id){serial++;record=null;changed();}}
 return {connect,useHosted:data=>connect(data,{existingOnly:true}),connectForConversations:data=>connect(data,{startCached:true,conversationChannel:true}),connectForAgent:(data,options)=>connect(data,{startCached:true,terminalSessionId:options?.sessionId}),disconnect,status,peek:safe,check,scheduler,owner,markTerminalHandoff,reclaimTerminalHandoff,hasCurrentGrant,prepareAuthoringGrant,completeAuthoringGrant,abortAuthoringGrant,connectionClosed,connectionLost,hostedServiceReplaced,terminalClosed,releaseLocal,reconcileContext,assertProfileEnvironmentUpdate,profileEnvironmentUpdated};
}

/** Preserve each authenticated pipeline while selecting one local scientific proxy. */
export function createSshService(options){
 const controllers=new Map(),authoringOwners=new WeakMap();
 const selectedId=()=>{const v=options.resource.peek();return v?.schemaVersion===2&&v.kind==='ssh-connection'?v.connectionId:null;};
 const empty=()=>({schemaVersion:2,status:'disconnected',workflowReady:false,serviceActive:false,operator:'human',revision:0});
 function controller(connectionId,create=false){if(!id(connectionId))fail('ssh_service_connection_required');let value=controllers.get(connectionId);if(!value&&create){if(controllers.size>=64)fail('ssh_service_connection_limit');value=createConnectionService(options);controllers.set(connectionId,value);}return value;}
 const chosen=data=>data?.connectionId||selectedId();
 return {
  connect:data=>controller(data?.connectionId,true).connect(data),
  useHosted:data=>controller(data?.connectionId,true).useHosted(data),
  hostedServiceReplaced:data=>controller(data.connectionId)?.hostedServiceReplaced(data)===true,
  connectForConversations:data=>controller(data?.connectionId,true).connectForConversations(data),
  connectForAgent:(data,options)=>controller(data?.connectionId,true).connectForAgent(data,options),
  peek:(data={})=>{exact(data,['connectionId'],[]);const key=chosen(data);return key?controller(key)?.peek()||empty():empty();},
  status:(data={})=>{exact(data,['connectionId'],[]);const key=chosen(data);return key?controller(key)?.status({})||Promise.resolve(empty()):Promise.resolve(empty());},
  disconnect:(data={})=>{const key=chosen(data),value=key?controller(key):null;if(!value){exact(data,['connectionId','attemptId'],[]);return Promise.resolve(empty());}return value.disconnect(data);},
  check:data=>controller(data?.connectionId)?.check(data)||Promise.reject(Error('ssh_service_context_changed')),
  owner:data=>{const c=controller(data?.connectionId);if(!c)fail('ssh_service_context_changed');return c.owner(data);},
  markTerminalHandoff:data=>{const c=controller(data?.connectionId);if(!c)fail('ssh_service_context_changed');return c.markTerminalHandoff(data);},
  reclaimTerminalHandoff:data=>controller(data?.connectionId)?.reclaimTerminalHandoff(data)||empty(),
  scheduler:data=>{const c=controller(data?.connectionId);if(!c)fail('ssh_service_unavailable');return c.scheduler(data);},
  hasCurrentGrant:(provider,caller)=>{const key=selectedId();return !!(key&&controller(key)?.hasCurrentGrant(provider,caller));},
  resourceChanged:async()=>{for(const c of controllers.values())c.releaseLocal();},
  reconcileContext:()=>{for(const c of controllers.values())c.reconcileContext();},
  connectionClosed:connectionId=>{controller(connectionId)?.connectionClosed(connectionId);controllers.delete(connectionId);},connectionLost:connectionId=>controller(connectionId)?.connectionLost(connectionId),terminalClosed:()=>{},prefersSharedTerminal:()=>false,
  prepareAuthoringGrant:task=>{const key=selectedId(),c=key?controller(key):null,ticket=c?.prepareAuthoringGrant(task);if(ticket)authoringOwners.set(ticket,c);return ticket||null;},
  completeAuthoringGrant:(ticket,task)=>authoringOwners.get(ticket)?.completeAuthoringGrant(ticket,task)||false,
  abortAuthoringGrant:ticket=>authoringOwners.get(ticket)?.abortAuthoringGrant(ticket)||false,
  assertProfileEnvironmentUpdate:(...args)=>{for(const c of controllers.values())c.assertProfileEnvironmentUpdate(...args);},
  profileEnvironmentUpdated:(...args)=>{for(const c of controllers.values())c.profileEnvironmentUpdated(...args);},
 };
}
