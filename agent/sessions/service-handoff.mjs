/** Explicit service-use handoff; shell ownership and authentication are untouched. */
import {isDeepStrictEqual as equal} from 'node:util';
import {providerId} from '../providers/contracts.mjs';
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v),fail=()=>{throw Error('ssh_service_context_changed');};
const context=v=>Object.fromEntries(['threadId','taskId','projectId','environmentId','inputRoot'].map(k=>[k,v?.[k]??null]));
export function createServiceHandoff({service,workflowContext,agents,records,resourceRouting,agentRpc,assertIdle}){
 let nextIntent=0;const intents=new Map(),controller=()=>typeof service==='function'?service():service;
 async function owner(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['connectionId','attemptId','owner','provider'].includes(k))||!validId(value.connectionId)||!validId(value.attemptId)||!['human','agent'].includes(value.owner))fail();
  if(value.provider!==undefined)providerId(value.provider);const serial=++nextIntent;intents.set(value.connectionId,serial);if(intents.size>64)intents.delete(intents.keys().next().value);
  if(value.owner==='human')return controller().owner({connectionId:value.connectionId,attemptId:value.attemptId,owner:'human'});
  const initial=structuredClone(workflowContext.current()),initialRevision=workflowContext.revision(),ticket=resourceRouting.capture(),provider=value.provider||initial?.provider||agents.active;
  providerId(provider);if(initial?.threadId&&initial.provider!==provider)fail();assertIdle();
  const initialConversation=initial?.threadId?structuredClone(records.conversation(provider,initial.threadId)):null;
  let preparation;
  function fresh(){if(intents.get(value.connectionId)!==serial)fail();ticket.assertCurrent();preparation?.assertCurrent();const selected=ticket.selection,state=controller().peek();if(selected?.schemaVersion!==2||selected.kind!=='ssh-connection'||selected.connectionId!==value.connectionId||state.connectionId!==value.connectionId||state.attemptId!==value.attemptId||state.status!=='connected'||state.workflowReady!==true)fail();}
  const before=()=>{fresh();if(workflowContext.revision()!==initialRevision||!equal(initial,workflowContext.current()))fail();};
  before();preparation=resourceRouting.prepareHandoff?.({provider,capability:'service',connectionId:value.connectionId,attemptId:value.attemptId});
  try{
  if(initial?.threadId){await agents.selectContext(provider,context(initial));before();}await agents.connect(provider);before();if(agents.active!==provider)fail();
  const resumed=initial?.threadId?await agentRpc({provider,method:'thread/resume',params:{threadId:initial.threadId}}):null,started=initial?.threadId?null:await agentRpc({provider,method:'thread/start',params:{}});fresh();
  const selected=structuredClone(workflowContext.current()),revision=workflowContext.revision();if(selected?.provider!==provider||!selected.threadId)fail();let conversation;
  if(started){if(started.thread?.id!==selected.threadId||selected.taskId)fail();conversation=records.remember({provider,threadId:selected.threadId,projectId:null});if(conversation?.threadId!==selected.threadId||conversation.provider!==provider)fail();}
  else{
   const recovered=resumed?.studioRecovery?.status==='recovered';if(resumed?.thread?.id!==selected.threadId||revision!==initialRevision+(recovered?2:1)||['taskId','projectId','environmentId','inputRoot'].some(k=>initial[k]!==selected[k]))fail();
   if(selected.threadId!==initial.threadId){const recovery=resumed?.studioRecovery,saved=records.conversation(provider,selected.threadId),retired=records.catalog?.get?.('retired-conversation-context',provider+':'+initial.threadId),body=v=>{if(!v)return null;const {id,threadId,updatedAt,...rest}=v;return rest;};if(provider!=='codex'||!recovered||recovery.oldThreadId!==initial.threadId||!initialConversation||!equal(recovery.conversation,saved)||saved?.id!==provider+':'+selected.threadId||retired?.replacementThreadId!==selected.threadId||(retired.taskId??null)!==initial.taskId||!records.deleted(provider,initial.threadId)||!equal(body(initialConversation),body(saved)))fail();conversation=saved;}else if(resumed?.studioRecovery)fail();
  }
  const ready=()=>{fresh();if(agents.active!==provider||workflowContext.revision()!==revision||!equal(selected,workflowContext.current()))fail();};ready();
  const result=controller().owner({connectionId:value.connectionId,attemptId:value.attemptId,owner:'agent',scope:{provider,threadId:selected.threadId,...selected.taskId?{taskId:selected.taskId}:{}}});
  try{ready();await agents.selectContext(provider,context(selected));ready();}catch(error){const now=controller().peek();let ownsPreparation=true;try{preparation?.assertCurrent();}catch{ownsPreparation=false;}if(ownsPreparation&&intents.get(value.connectionId)===serial&&now.connectionId===value.connectionId&&now.attemptId===value.attemptId&&now.revision===result.revision)controller().owner({connectionId:value.connectionId,attemptId:value.attemptId,owner:'human'});throw error;}
  return {...controller().peek(),...conversation?{conversation}:{}};
  }finally{preparation?.release();}
 }
 return {owner};
}
