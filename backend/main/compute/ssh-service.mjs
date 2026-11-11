/** Human connection action over the exact already-authenticated SSH terminal. */
import {randomUUID} from 'node:crypto';
import {prepareSshServiceResources} from './ssh-service-resources.mjs';
import {safeSshServiceError,safeSshServicePhase,safeSshServiceProgress} from './ssh-service-state.mjs';

const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=code=>{throw Error(code);};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v);
export function normalizeSshServiceHealth(value){
 const v=value?.health||value?.service?.health||value?.service||value;
 const h=v?.hostIdentity||v?.host_identity||{hostname:v?.hostname,uid:v?.uid,machineId:v?.machineId};
 const runtimeId=v?.runtimeId||v?.runtime_id;
 if(!object(v)||v.name!=='gpu-sampling-studio'||v.execution_policy!=='desktop-review-v1'||typeof v.root!=='string'||!v.root.startsWith('/')||typeof v.runtime!=='string'||!v.runtime.startsWith('/')||!(/^[a-f0-9]{20}$/).test(runtimeId||'')||typeof h.hostname!=='string'||!h.hostname||h.hostname.length>255||!Number.isSafeInteger(h.uid)||h.uid<0||typeof h.machineId!=='string'||!h.machineId||h.machineId.length>256||!Number.isInteger(v.port)||v.port<1024||v.port>65535)fail('ssh_service_identity_unavailable');
 const report={name:v.name,version:v.version,root:v.root,runtime:v.runtime,execution_policy:v.execution_policy,port:v.port,runtimeId,hostIdentity:{hostname:h.hostname,uid:h.uid,machineId:h.machineId},transport:'ssh-terminal',ssh_service:true};
 for(const key of ['tool_configuration_schema','tool_workflow_schema'])if(Number.isSafeInteger(v[key]))report[key]=v[key];
 return report;
}
export function createSshService({worker,terminal,profiles,resource,source,transportSource,current=()=>null,assertIdle=()=>{},publish=()=>{},remember=()=>{},prepareResources=prepareSshServiceResources}){
 let record=null,connecting=null,stopping=null,serial=0,displayRevision=0;
 const modern=()=>!!transportSource||record?.v2===true;
 function safe(){
  const value=record?{status:record.status,sessionId:record.sessionId,profileId:record.profileId,profileVersion:record.profileVersion,...record.health?{health:structuredClone(record.health)}:{},workflowReady:record.status==='connected'&&worker.connection===record.connection&&worker.identity?.kind==='ssh'}:{status:'disconnected',workflowReady:false};
  if(modern())Object.assign(value,{revision:displayRevision,terminalAccess:record?.terminalAccess||'available',...record?{attemptId:record.attemptId,phase:record.phase,startedAt:record.startedAt,phaseStartedAt:record.phaseStartedAt,updatedAt:record.updatedAt,...record.progress?{progress:structuredClone(record.progress)}:{},...record.error?{error:structuredClone(record.error)}:{}}:{}});
  return value;
 }
 function changed(owned=record){if(owned&&owned!==record)return;displayRevision++;if(record)record.updatedAt=Date.now();publish();}
 function phase(owned,value){if(record!==owned)return;const next=safeSshServicePhase(value,owned.phase);if(next!==owned.phase){owned.phase=next;owned.phaseStartedAt=Date.now();delete owned.progress;}changed(owned);}
 function applyView(owned,view){
  if(record!==owned||!view||typeof view!=='object')return;
  const previous=JSON.stringify([owned.phase,owned.progress,owned.error,owned.terminalAccess]);
  if(id(view.serviceId))owned.serviceId=view.serviceId;
  if(['available','reserved','unknown'].includes(view.terminalAccess))owned.terminalAccess=view.terminalAccess;
  else if(typeof view.serviceActive==='boolean')owned.terminalAccess=view.serviceActive?'reserved':'available';
  const next=safeSshServicePhase(view.phase||view.servicePhase,owned.phase);
  if(!(next==='ready'&&owned.status==='connecting'&&['checking_health','checking_tools'].includes(owned.phase))&&next!==owned.phase){owned.phase=next;owned.phaseStartedAt=Date.now();}
  const progress=safeSshServiceProgress(view.progress||view.serviceProgress);if(progress)owned.progress=progress;else if(!['transferring_transport','transferring_worker'].includes(owned.phase))delete owned.progress;
  if(view.error)owned.error=safeSshServiceError(view.error,owned.phase);
  if(previous!==JSON.stringify([owned.phase,owned.progress,owned.error,owned.terminalAccess]))changed(owned);
 }
 const validate=data=>{
  if(!object(data)||Object.keys(data).some(k=>!['sessionId','ownerEpoch','profileId','profileVersion','requestId'].includes(k))||!id(data.sessionId)||!id(data.profileId)||!id(data.requestId)||!Number.isSafeInteger(data.ownerEpoch)||data.ownerEpoch<0||!Number.isSafeInteger(data.profileVersion)||data.profileVersion<1)fail('ssh_service_invalid_request');
  const selected=resource.peek(),profile=profiles.read({id:data.profileId,version:data.profileVersion});
  if(selected?.kind!=='ssh-terminal'||selected.sessionId!==data.sessionId||selected.profileId!==data.profileId||selected.profileVersion!==data.profileVersion||profile.kind!=='ssh')fail('ssh_service_selection_changed');
  return {profile,ticket:resource.capture(),owner:JSON.stringify(current())};
 };
 async function connect(data){
  assertIdle();if(stopping)fail('ssh_service_busy');const captured=validate(data),key=JSON.stringify(data);
  if(connecting){if(connecting.key===key)return connecting.promise;fail('ssh_service_busy');}
  if(record?.status==='connected'&&record.sessionId===data.sessionId&&safe().workflowReady)return safe();
  if(record?.v2&&record.status==='failed'&&record.terminalAccess==='available')record=null;
  if(record)fail('请先在原 SSH 连接返回交互终端，再连接其他作业服务。');
  const revision=++serial,check=()=>{if(revision!==serial||JSON.stringify(current())!==captured.owner)fail('ssh_service_context_changed');resource.assertCurrent(captured.ticket);profiles.read({id:data.profileId,version:data.profileVersion});};
  const startedAt=Date.now(),attempt={status:'connecting',sessionId:data.sessionId,profileId:data.profileId,profileVersion:data.profileVersion,attemptId:data.requestId,v2:!!transportSource,phase:'preparing_local',startedAt,phaseStartedAt:startedAt,terminalAccess:'available'};
  const promise=(async()=>{
   record=attempt;changed();
   try{
    const bootstrap=prepareResources(source,{profileId:data.profileId,...transportSource?{transportSource}:{}});check();
    attempt.v2=!!bootstrap.transport;attempt.dispatched=true;attempt.terminalAccess='reserved';phase(attempt,'waiting_python');
    const result=await terminal.connectService({sessionId:data.sessionId,ownerEpoch:data.ownerEpoch,profileId:data.profileId,profileVersion:data.profileVersion,requestId:data.requestId},bootstrap);check();
    if(attempt.v2){applyView(attempt,result);if(result.status!=='connected'||result.serviceActive!==true){attempt.status=attempt.terminalAccess==='available'?'failed':'unknown';attempt.error=safeSshServiceError(result.error||'connection_unconfirmed',attempt.phase);changed(attempt);return safe();}}
    if(!id(result.serviceId))fail('ssh_service_identity_unavailable');record.serviceId=result.serviceId;
    const health=normalizeSshServiceHealth(result),identity={kind:'ssh',version:2,profileId:data.profileId,profileVersion:data.profileVersion,hostIdentity:health.hostIdentity,root:health.root,runtime:health.runtime,runtimeId:health.runtimeId};
    if(health.runtimeId!==bootstrap.payload.expected_runtime_id)fail('ssh_service_runtime_changed');
    const attached=record;phase(attached,'checking_health');
    await worker.attachServiceTransport({health,identity,target:{...identity,sessionId:data.sessionId,port:health.port},source,request:async packet=>{
     if(record!==attached||attached.status!=='connected'&&attached.status!=='connecting')fail('ssh_service_context_changed');
     profiles.read({id:data.profileId,version:data.profileVersion});
     try{return await terminal.serviceRequest({sessionId:data.sessionId,serviceId:attached.serviceId,requestId:randomUUID(),method:packet.method,target:packet.path,data:packet.data,mcp:packet.mcp});}
     catch(error){if(record===attached){attached.status='unknown';attached.terminalAccess='unknown';attached.error=safeSshServiceError(error?.message,attached.phase);changed(attached);}throw error;}
    },detach:()=>{if(record===attached&&attached.status==='connected'){attached.status='unknown';attached.terminalAccess='unknown';attached.error=safeSshServiceError('connection_unconfirmed',attached.phase);changed(attached);}}});check();
    attached.health=health;attached.connection=worker.connection;phase(attached,'checking_tools');
    const tools=await worker.probeTools();check();if(tools.status!=='ready'||tools.count<1)fail('ssh_service_tools_unavailable');
    await remember(identity,health);check();attached.status='connected';attached.terminalAccess='reserved';delete attached.error;phase(attached,'ready');return {...safe(),tools};
   }catch(error){if(record===attempt&&revision===serial){if(attempt.dispatched){record.status=attempt.v2&&record.terminalAccess==='available'?'failed':'unknown';if(record.status!=='failed')record.terminalAccess='unknown';record.error=safeSshServiceError(error?.message,record.phase);if(worker.identity?.kind==='ssh'&&worker.connectionTarget?.sessionId===data.sessionId)worker.close();}else if(attempt.v2){record.status='failed';record.terminalAccess='available';record.error=safeSshServiceError(error?.message,record.phase);}else record=null;changed();if(attempt.v2)return safe();}throw error;}
  })();connecting={key,promise,attempt};try{return await promise;}finally{if(connecting?.promise===promise)connecting=null;}
 }
 async function disconnect(data={}){
  if(!object(data)||Object.keys(data).some(key=>!['sessionId','attemptId'].includes(key))||Object.keys(data).length&&(!id(data.sessionId)||!id(data.attemptId)))fail('ssh_service_invalid_request');
  if(Object.keys(data).length&&(!record||record.sessionId!==data.sessionId||record.attemptId!==data.attemptId))fail('ssh_service_context_changed');assertIdle();serial++;
  if(stopping)return stopping;
  const owned=record;if(!owned)return safe();
  const pendingStart=connecting?.attempt===owned;
  if(owned.v2){owned.status='disconnecting';phase(owned,'stopping');}
  const finish=()=>{if(record!==owned)return safe();if(worker.identity?.kind==='ssh'&&worker.connectionTarget?.sessionId===owned.sessionId)worker.close();const final={...safe(),status:'disconnected',workflowReady:false,terminalAccess:'available',revision:displayRevision+1};for(const key of ['progress','error','phase','phaseStartedAt'])delete final[key];record=null;changed();return owned.v2?final:safe();};
  const pending=(async()=>{
   if(owned.v2&&owned.dispatched&&(pendingStart||!owned.serviceId&&owned.terminalAccess!=='available')){if(typeof terminal.cancelServiceStart!=='function')fail('service_stop_unknown');const result=await terminal.cancelServiceStart({sessionId:owned.sessionId,requestId:owned.attemptId});if(record!==owned)return safe();if(result.cancelled!==true||result.cancelledAttemptId!==owned.attemptId||result.serviceActive!==false||result.terminalAccess!=='available')fail('service_stop_unknown');applyView(owned,result);return finish();}
   if(!owned.dispatched||owned.v2&&owned.terminalAccess==='available'&&!pendingStart)return finish();
   let serviceId=owned.serviceId;if(!serviceId){const state=await terminal.serviceState({sessionId:owned.sessionId});serviceId=state.serviceId;applyView(owned,state);if(!serviceId&&state.serviceActive===false)return finish();}
   if(!id(serviceId))fail('ssh_service_identity_unavailable');
   const result=await terminal.disconnectService({sessionId:owned.sessionId,serviceId});
   if(owned.v2){applyView(owned,result);if(result.serviceActive!==false||result.terminalAccess!=='available')fail('service_stop_unknown');}
   return finish();
  })();stopping=pending;try{return await pending;}catch(error){if(record===owned&&owned.v2){owned.status='unknown';owned.terminalAccess='unknown';owned.error=safeSshServiceError(error?.message==='service_stop_unknown'?'stop_timeout':error?.message,owned.phase);changed(owned);return safe();}throw error;}finally{if(stopping===pending)stopping=null;}
 }
 async function status(data={}){
  if(!object(data)||Object.keys(data).length)fail('ssh_service_invalid_request');const owned=record;
  if(owned?.v2&&owned.dispatched&&owned.terminalAccess!=='available')try{const observedRevision=displayRevision,readId=owned.statusReadId=(owned.statusReadId||0)+1;const view=await terminal.serviceState({sessionId:owned.sessionId});if(record===owned&&owned.statusReadId===readId&&displayRevision===observedRevision&&view.attemptId===owned.attemptId){const previous=JSON.stringify([owned.status,owned.error,owned.terminalAccess]);applyView(owned,view);if(['failed','unknown'].includes(view.status)||view.serviceActive===false||view.status==='disconnected'){if(connecting?.attempt!==owned)owned.status=view.terminalAccess==='available'?'failed':'unknown';owned.error=safeSshServiceError(view.error||'connection_unconfirmed',owned.phase);if(worker.connection===owned.connection&&owned.connection)worker.close();if(previous!==JSON.stringify([owned.status,owned.error,owned.terminalAccess]))changed(owned);}}}catch{}
  return safe();
 }
 async function scheduler(data){
  assertIdle();if(!object(data)||!safe().workflowReady)fail('ssh_service_unavailable');
  return worker.request('POST','/api/ssh-service/scheduler',data);
 }
 // Main calls this only after the exact terminal close has been acknowledged.
 // The terminal bridge deletes that lease, so it must not strand this reference.
 function terminalClosed(sessionId){if(record?.sessionId!==sessionId)return;serial++;if(worker.identity?.kind==='ssh'&&worker.connectionTarget?.sessionId===sessionId)worker.close();record=null;changed();}
 return {connect,disconnect,status,peek:safe,scheduler,terminalClosed};
}
