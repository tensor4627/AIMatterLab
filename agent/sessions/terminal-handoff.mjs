/** Human-only terminal handoff preparation. Creates a real empty chat, never a model turn. */
import {isDeepStrictEqual as equal} from 'node:util';
import {providerId} from '../providers/contracts.mjs';

const fail=()=>{throw Error('terminal_context_changed');};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const providerContext=value=>Object.fromEntries(['threadId','taskId','projectId','environmentId','inputRoot'].map(key=>[key,value?.[key]??null]));

export function createTerminalHandoff({terminal,workflowContext,agents,records,resourceRouting,agentRpc,assertIdle,service,beforeAgentHandoff}){
 const intents=new Map();let serial=0;
 function begin(sessionId){const value=++serial;intents.set(sessionId,value);if(intents.size>64)intents.delete(intents.keys().next().value);return value;}
 function request(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['sessionId','ownerEpoch','owner','provider'].includes(key))||!validId(value.sessionId)||!Number.isSafeInteger(value.ownerEpoch)||value.ownerEpoch<0||!['human','agent'].includes(value.owner))throw Error('terminal_invalid_request');
  if(value.provider!==undefined)providerId(value.provider);
  return {sessionId:value.sessionId,ownerEpoch:value.ownerEpoch,owner:value.owner};
 }
 async function owner(value){
  const data=request(value),intent=begin(data.sessionId);
  if(data.owner==='human'){
   return terminal.owner(data);
  }
  const initial=structuredClone(workflowContext.current()),initialRevision=workflowContext.revision(),resource=resourceRouting.capture(),provider=value.provider||initial?.provider||agents.active;
  providerId(provider);
  const initialConversation=initial?.threadId?structuredClone(records.conversation(provider,initial.threadId)):null;
  let preparation;
  const fresh=()=>{if(intents.get(data.sessionId)!==intent)fail();resource.assertCurrent();preparation?.assertCurrent();};
  const initialCurrent=()=>{fresh();if(workflowContext.revision()!==initialRevision||!equal(initial,workflowContext.current()))fail();};
  if(initial?.threadId&&initial.provider!==provider)fail();
  assertIdle();
  let session;
  const verifySession=async(assertCurrent,{restamp=false}={})=>{
   const result=await terminal.list({});assertCurrent();
   const found=result.sessions?.find(item=>item.sessionId===data.sessionId);
   if(!found||found.alive!==true||found.expired||found.owner!=='human')fail();
   const stamp={sessionId:found.sessionId,kind:found.kind,ownerEpoch:found.ownerEpoch,resource:found.resource??null};
   if(!session&&stamp.ownerEpoch!==data.ownerEpoch)fail();
   if(session&&(!equal(session.resource,stamp.resource)||session.kind!==stamp.kind||!restamp&&session.ownerEpoch!==stamp.ownerEpoch))fail();
   if(restamp&&stamp.ownerEpoch!==data.ownerEpoch)fail();
   const selected=resource.selection;
   if(selected&&(found.kind!=='ssh'||selected.schemaVersion!==2||selected.kind!=='ssh-connection'||selected.connectionId!==found.connectionId||selected.profileId!==found.resource?.profileId||selected.profileVersion!==found.resource?.profileVersion))fail();
   if(found.kind==='ssh'&&(!selected||found.resource?.kind!=='ssh-connection'))throw Error('terminal_connection_reauthentication_required');
   if(found.kind==='ssh'&&found.resource){
    const state=await terminal.resourceState({sessionId:data.sessionId});assertCurrent();
    if(state.sessionId!==found.sessionId||!equal(state.resource,found.resource)||state.operator!=='human'||state.ownerEpoch!==found.ownerEpoch||state.alive!==true||state.processStatus!=='running')fail();
   }
   if(found.serviceActive)throw Error('terminal_connection_reauthentication_required');
   session=stamp;
   return found;
  };
  await verifySession(initialCurrent);
  if(resource.selection?.kind==='ssh-connection')preparation=resourceRouting.prepareHandoff?.({provider,capability:'terminal',connectionId:resource.selection.connectionId,sessionId:data.sessionId});
  try{
  if(beforeAgentHandoff){await beforeAgentHandoff({sessionId:data.sessionId,ownerEpoch:data.ownerEpoch,provider});initialCurrent();await verifySession(initialCurrent,{restamp:true});}
  if(initial?.threadId){await agents.selectContext(provider,providerContext(initial));initialCurrent();}
  await agents.connect(provider);initialCurrent();if(agents.active!==provider)fail();
  await verifySession(initialCurrent);assertIdle();initialCurrent();
  const resumed=initial?.threadId?await agentRpc({provider,method:'thread/resume',params:{threadId:initial.threadId}}):null;
  const started=initial?.threadId?null:await agentRpc({provider,method:'thread/start',params:{}});fresh();
  const selected=structuredClone(workflowContext.current()),revision=workflowContext.revision();
  if(selected?.provider!==provider||!selected.threadId||(!initial?.threadId&&(!started?.thread?.id||selected.threadId!==started.thread.id||selected.taskId)))fail();
  let conversation;
  if(initial?.threadId){
   const recovery=resumed?.studioRecovery,recovered=recovery?.status==='recovered';
   if(resumed?.thread?.id!==selected.threadId||revision!==initialRevision+(recovered?2:1)||['taskId','projectId','environmentId','inputRoot'].some(key=>initial[key]!==selected[key]))fail();
   if(selected.threadId===initial.threadId){if(recovery)fail();}
   else{
    const saved=records.conversation(provider,selected.threadId),retired=records.catalog?.get?.('retired-conversation-context',provider+':'+initial.threadId);
    const body=value=>{if(!value)return null;const {id,threadId,updatedAt,...rest}=value;return rest;};
    if(provider!=='codex'||!recovered||recovery.oldThreadId!==initial.threadId||!initialConversation||!equal(recovery.conversation,saved)||saved?.id!==provider+':'+selected.threadId||saved.provider!==provider||retired?.replacementThreadId!==selected.threadId||(retired.taskId??null)!==initial.taskId||!records.deleted(provider,initial.threadId)||!equal(body(initialConversation),body(saved)))fail();
    conversation=saved;
   }
  }
  const selectedCurrent=()=>{fresh();if(agents.active!==provider||workflowContext.revision()!==revision||!equal(selected,workflowContext.current()))fail();};
  await verifySession(selectedCurrent);selectedCurrent();
  if(started)conversation=records.remember({provider,threadId:started.thread.id,projectId:null});
  if(started&&(!conversation||conversation.provider!==provider||conversation.threadId!==started.thread.id))fail();
  selectedCurrent();
  await verifySession(selectedCurrent);const result=await terminal.owner(data,{assertCurrent:selectedCurrent});selectedCurrent();
  return {...result,...conversation?{conversation}:{}};
  }finally{preparation?.release();}
 }
 async function close(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!validId(value.sessionId))throw Error('terminal_invalid_request');
  begin(value.sessionId);return terminal.close(value);
 }
 return {owner,close};
}
