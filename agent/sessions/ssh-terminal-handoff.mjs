/** One human handoff enables the shell and its optional structured worker. */
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {safeSshServiceError} from '../../backend/main/compute/ssh-service-state.mjs';

export function createSshTerminalHandoff({terminalHandoff,terminal,service,registration,resourceRouting,workflowContext,agents}){
 const intents=new Map(),combined=new Map();let serial=0;
 const controller=()=>typeof service==='function'?service():service;
 function reclaim(sessionId,expected){
  const owned=combined.get(sessionId);if(!owned||expected&&owned!==expected)return;combined.delete(sessionId);
  const state=controller().peek({connectionId:owned.connectionId});
  if(state.attemptId===owned.attemptId&&state.status==='connected'&&state.workflowReady&&state.operator==='agent')controller().owner({...owned,owner:'human'});
 }
 async function owner(value){
  // The existing handoff validates the human request and exact PTY before any
  // remote setup. It also prepares a real conversation without sending a turn.
  const intent=++serial;intents.set(value?.sessionId,intent);if(intents.size>64)intents.delete(intents.keys().next().value);
  let prepared;
  if(value?.owner==='agent'&&controller().waitForPreparation){
   const before=resourceRouting.capture();
   if(before.selection?.kind==='ssh-connection'){prepared=await controller().waitForPreparation({connectionId:before.selection.connectionId});before.assertCurrent();if(intents.get(value.sessionId)!==intent)throw Error('terminal_context_changed');}
  }
  const result=await terminalHandoff.owner(value);
  if(value.owner==='human'){reclaim(value.sessionId);return result;}
  const ticket=resourceRouting.capture(),selected=ticket.selection;
  if(selected?.kind!=='ssh-connection'||result.kind!=='ssh')return result;
  const context=structuredClone(workflowContext.current()),provider=context?.provider;
  const fresh=()=>{
   ticket.assertCurrent();
   if(intents.get(value.sessionId)!==intent||!equal(context,workflowContext.current())||agents.active!==provider||!terminal.hasCurrentGrant(provider,value.sessionId))throw Error('terminal_context_changed');
  };
  let state,ownedGrant;
  try{
   fresh();const saved=registration.read({profileId:selected.profileId,profileVersion:selected.profileVersion});fresh();
   state=controller().peek({connectionId:selected.connectionId});
   if(prepared?.status==='failed')throw Error(prepared.error?.code||'connection_unconfirmed');
   if(state.status==='unknown'||state.status==='connecting'||state.status==='disconnecting')throw Error('connection_unconfirmed');
   if(!state.workflowReady){
    if(saved.status==='maintenance_required'&&saved.reason!=='configuration_changed')throw Error('maintenance_required');
    state=await controller().connectForAgent({connectionId:selected.connectionId,profileId:selected.profileId,profileVersion:selected.profileVersion,requestId:randomUUID(),mode:saved.status==='configured'?'reuse':'setup'});fresh();
   }
   if(state.connectionId!==selected.connectionId||state.profileId!==selected.profileId||state.profileVersion!==selected.profileVersion||state.status!=='connected'||!state.workflowReady||!state.attemptId)throw Error(state.error?.code||'connection_unconfirmed');
   fresh();const owned={connectionId:selected.connectionId,attemptId:state.attemptId};
   state=controller().owner({...owned,owner:'agent',scope:{provider,threadId:context.threadId,...context.taskId?{taskId:context.taskId}:{}}});
   for(const [sessionId,previous] of combined)if(previous.connectionId===owned.connectionId)combined.delete(sessionId);
   ownedGrant=owned;combined.set(value.sessionId,owned);
   await agents.selectContext(provider,Object.fromEntries(['threadId','taskId','projectId','environmentId','inputRoot'].map(key=>[key,context[key]??null])));fresh();
   return {...result,service:state};
  }catch(error){
   // A failed worker never takes away the granted ordinary terminal. Unknown
   // dispatches remain on the original service attempt; no retry or reconnect.
   if(ownedGrant)reclaim(value.sessionId,ownedGrant);
   fresh();
   // Restore terminal-only tool discovery if binding the worker bridge failed.
   if(ownedGrant){try{await agents.selectContext(provider,Object.fromEntries(['threadId','taskId','projectId','environmentId','inputRoot'].map(key=>[key,context[key]??null])));}catch{}fresh();}
   return {...result,service:{...controller().peek({connectionId:selected.connectionId}),error:state?.error||safeSshServiceError(error?.message,'preparing_local')}};
  }
 }
 async function close(value){intents.set(value?.sessionId,++serial);const result=await terminalHandoff.close(value);reclaim(value.sessionId);return result;}
 return {owner,close};
}
