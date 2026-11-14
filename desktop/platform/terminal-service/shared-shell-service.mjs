/** Serialize bounded worker exchanges on the exact, already handed-off shell.
 * Every successful exchange confirms STOPPED and the original shell prompt
 * barrier before releasing the terminal. Unknown exchanges never replay. */
import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {TerminalFault,exact} from './session.mjs';
const fail=code=>{throw new TerminalFault(code,409);};
export function sharedShellService({session,sessionId,bootstrap,requestId,authorization,assertCurrent}){
 let tail=Promise.resolve(),ready=false,closed=false,health,error,unknown=false,physical;
 const serviceId=randomUUID(),requests=new Map();
 const verify=auth=>{assertCurrent();const s=session.state();if(closed||!s.alive||s.expired||s.owner!=='agent'||s.ownerEpoch!==auth.ownerEpoch||!equal(s.scope,auth.scope))fail('service_changed');return s;};
 const enqueue=fn=>{const pending=tail.then(fn);tail=pending.catch(()=>{});return pending;};
 async function exchange(auth,action,initial=false){
  let s=verify(auth);await session.waitShellReady(()=>verify(auth));s=verify(auth);if(unknown||session.serviceState().serviceActive)fail('service_transport_unknown');
  const start={ownerEpoch:s.ownerEpoch,requestId:randomUUID(),borrowed:true,scope:auth.scope,bootstrap:initial?bootstrap:{...bootstrap,reuseOnly:true,startCached:false}};
  try{
   const result=await session.serviceStart(start);verify(auth);const view=session.serviceState();physical=view.serviceId;
   if(view.serviceStatus!=='connected'||!view.serviceActive||!view.service){error=view.error;unknown=view.serviceActive===true;fail(unknown?'service_transport_unknown':'service_remote_failed');}
   const observed=structuredClone(view.service);if(health&&!equal(health,observed))fail('service_identity_failed');
   const response=action?await action(physical):null;verify(auth);
   await session.serviceStop({serviceId:physical});verify(auth);
   if(session.serviceState().serviceActive||session.serviceState().terminalAccess!=='available')fail('service_stop_unknown');
   health=observed;ready=true;error=null;physical=null;return response;
  }catch(e){const view=session.serviceState();error=view.error||{code:e.code||'service_transport_unknown',phase:view.servicePhase||'waiting_python'};unknown=view.serviceActive===true;throw e;}
 }
 const view=()=>{const live=session.state(),state=session.serviceState(),active=state.serviceActive===true;return {status:closed||!live.alive?'disconnected':unknown?'unknown':error?'failed':ready?'connected':'connecting',serviceActive:!closed&&live.alive&&(ready||active||!error),serviceId,terminalSessionId:sessionId,servicePhase:!ready||active?state.servicePhase||'waiting_python':'ready',...active&&state.progress?{progress:state.progress}:{},...health?{service:structuredClone(health)}:{},...error?{error:structuredClone(error)}:{}};};
 return {
  sessionId,view,
  start:()=>enqueue(async()=>{try{await exchange(authorization,null,true);}catch(e){if(!error)error={code:e.code||'internal_error',phase:'waiting_python'};unknown=session.serviceState().serviceActive===true;}return view();}),
  request(value,auth){exact(value,['serviceId','requestId','method','target','data','mcp','timeoutMs'],['serviceId','requestId','method','target','mcp']);if(value.serviceId!==serviceId||closed)fail('service_changed');const digest=createHash('sha256').update(JSON.stringify(value)).digest('hex'),previous=requests.get(value.requestId);if(previous){if(previous.digest!==digest)fail('request_changed');return previous.promise;}if(requests.size>=2048)fail('request_limit');const promise=enqueue(()=>exchange(auth,id=>session.serviceRequest({...value,serviceId:id})));requests.set(value.requestId,{digest,promise});return promise;},
  shell:fn=>enqueue(()=>{if(session.serviceState().serviceActive)fail('service_active');return fn();}),
  close:()=>enqueue(async()=>{if(session.serviceState().serviceActive)await session.serviceStop({serviceId:session.serviceState().serviceId});if(session.serviceState().serviceActive)fail('service_stop_unknown');closed=true;return view();}),
  cancel:async()=>{if(session.serviceState().serviceActive)await session.serviceCancelStart({requestId:session.serviceState().startRequestId});if(session.serviceState().serviceActive)fail('service_stop_unknown');closed=true;return view();}
 };
}
