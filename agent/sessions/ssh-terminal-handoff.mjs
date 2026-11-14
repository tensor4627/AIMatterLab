/** One human handoff enables the shell and its optional structured worker. */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {safeSshServiceError} from '../../backend/main/compute/ssh-service-state.mjs';

export function createSshTerminalHandoff({terminalHandoff,terminal,service,registration,resourceRouting,workflowContext,agents,agentRpc,records}){
 const intents=new Map(),combined=new Map();let serial=0;
 const controller=()=>typeof service==='function'?service():service;
 function reclaim(sessionId,expected){
  const owned=combined.get(sessionId);if(!owned||expected&&owned!==expected)return;combined.delete(sessionId);
  if(typeof controller().reclaimTerminalHandoff==='function'){controller().reclaimTerminalHandoff({...owned,sessionId});return;}
  const state=controller().peek({connectionId:owned.connectionId});
  if(state.attemptId===owned.attemptId&&state.status==='connected'&&state.workflowReady&&state.operator==='agent')controller().owner({...owned,owner:'human'});
 }
 async function owner(value){
  // The existing handoff validates the human request and exact PTY before any
  // remote setup. It also prepares a real conversation without sending a turn.
  const intent=++serial;intents.set(value?.sessionId,intent);if(intents.size>64)intents.delete(intents.keys().next().value);
  let result=await terminalHandoff.owner(value);
  if(value.owner==='human'){reclaim(value.sessionId);return result;}
  const ticket=resourceRouting.capture(),selected=ticket.selection;
  if(selected?.kind!=='ssh-connection'||result.kind!=='ssh')return result;
  let context=structuredClone(workflowContext.current());const provider=context?.provider;
  const fresh=()=>{
   ticket.assertCurrent();
   preparation?.assertCurrent();
   if(intents.get(value.sessionId)!==intent||!equal(context,workflowContext.current())||agents.active!==provider||!terminal.hasCurrentGrant(provider,value.sessionId))throw Error('terminal_context_changed');
  };
  let state,ownedGrant,preparation;
  try{
   preparation=resourceRouting.prepareHandoff?.({provider,capability:'terminal',connectionId:selected.connectionId,sessionId:value.sessionId});
   fresh();const saved=registration.read({profileId:selected.profileId,profileVersion:selected.profileVersion});fresh();
   state=controller().peek({connectionId:selected.connectionId});
   if(state.status==='unknown'||state.status==='connecting'||state.status==='disconnecting')throw Error('connection_unconfirmed');
   if(!state.workflowReady){
    // A stale runtime registration can reach only the backend's strictly
    // read-only reconciliation. It cannot become setup or mint a grant here.
    const reconcile=saved.status==='maintenance_required'&&saved.reason==='worker_health_invalid'&&saved.profileId===selected.profileId&&saved.profileVersion===selected.profileVersion;
    if(saved.status==='maintenance_required'&&saved.reason!=='configuration_changed'&&!reconcile)throw Error('maintenance_required');
    state=await controller().connectForAgent({connectionId:selected.connectionId,profileId:selected.profileId,profileVersion:selected.profileVersion,requestId:randomUUID(),mode:saved.status==='configured'||reconcile?'reuse':'setup'},{sessionId:value.sessionId});fresh();
   }
   if(state.connectionId!==selected.connectionId||state.profileId!==selected.profileId||state.profileVersion!==selected.profileVersion||state.status!=='connected'||!state.workflowReady||!state.attemptId)throw Error(state.error?.code||'connection_unconfirmed');
   fresh();const owned={connectionId:selected.connectionId,attemptId:state.attemptId};
   const terminalPreparation=preparation;
   preparation=resourceRouting.prepareHandoff?.({provider,capability:'service',connectionId:selected.connectionId,attemptId:owned.attemptId});
   terminalPreparation?.release();
   await agents.selectContext(provider,Object.fromEntries(['threadId','taskId','projectId','environmentId','inputRoot'].map(key=>[key,context[key]??null])));fresh();
   // Binding the service can replace Codex's native process. Complete any
   // verified empty-thread recovery before enabling service use or publishing
   // the conversation, so reconciliation cannot revoke a newly minted grant.
   if(provider==='codex'&&agentRpc){
    const before=context,conversation=records?.conversation(provider,before.threadId),resumed=await agentRpc({provider,method:'thread/resume',params:{threadId:before.threadId}}),after=structuredClone(workflowContext.current());
    ticket.assertCurrent();preparation?.assertCurrent();
    if(intents.get(value.sessionId)!==intent||agents.active!==provider||after?.provider!==provider||!resumed?.thread?.id||after.threadId!==resumed.thread.id||['taskId','projectId','environmentId','inputRoot'].some(key=>(before[key]??null)!==(after[key]??null)))throw Error('terminal_context_changed');
    if(after.threadId===before.threadId){if(after.serial!==before.serial+1||resumed.studioRecovery)throw Error('terminal_context_changed');}
    else{
     const recovery=resumed.studioRecovery,saved=records?.conversation(provider,after.threadId),retired=records?.catalog?.get('retired-conversation-context',provider+':'+before.threadId),body=c=>{if(!c)return null;const {id,threadId,updatedAt,...rest}=c;return rest;};
     if(after.serial!==before.serial+2||!conversation||recovery?.status!=='recovered'||recovery.oldThreadId!==before.threadId||!saved||!equal(recovery.conversation,saved)||saved.id!==provider+':'+after.threadId||retired?.replacementThreadId!==after.threadId||retired.reason!=='verified-empty-recovery'||!equal(body(conversation),body(saved)))throw Error('terminal_context_changed');
     // The original human handoff follows only this main-verified empty-thread
     // replacement. Rebind the exact terminal and return its new owner epoch.
     context=after;
     result={...await terminal.owner({sessionId:value.sessionId,ownerEpoch:result.ownerEpoch,owner:'agent'}),conversation:saved};
    }
    context=after;fresh();
   }
   state=controller().owner({...owned,owner:'agent',scope:{provider,threadId:context.threadId,...context.taskId?{taskId:context.taskId}:{}}});
   controller().markTerminalHandoff?.({...owned,sessionId:value.sessionId});
   for(const [sessionId,previous] of combined)if(previous.connectionId===owned.connectionId)combined.delete(sessionId);
   ownedGrant=owned;combined.set(value.sessionId,owned);
   return {...result,service:state};
  }catch(error){
   // A failed worker never takes away the granted ordinary terminal. Unknown
   // dispatches remain on the original service attempt; no retry or reconnect.
   if(ownedGrant){reclaim(value.sessionId,ownedGrant);preparation?.release();preparation=resourceRouting.prepareHandoff?.({provider,capability:'terminal',connectionId:selected.connectionId,sessionId:value.sessionId});}
   fresh();
   // Restore terminal-only tool discovery if binding the worker bridge failed.
   if(ownedGrant){try{await agents.selectContext(provider,Object.fromEntries(['threadId','taskId','projectId','environmentId','inputRoot'].map(key=>[key,context[key]??null])));}catch{}fresh();}
   return {...result,service:{...controller().peek({connectionId:selected.connectionId}),error:state?.error||safeSshServiceError(error?.message,'preparing_local')}};
  }finally{preparation?.release();}
 }
 async function close(value){intents.set(value?.sessionId,++serial);const result=await terminalHandoff.close(value);reclaim(value.sessionId);return result;}
 return {owner,close};
}
