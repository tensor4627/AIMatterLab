/** Human-only terminal handoff preparation. Creates a real empty chat, never a model turn. */
import {isDeepStrictEqual as equal} from 'node:util';
import {providerId} from '../providers/contracts.mjs';

const fail=()=>{throw Error('terminal_context_changed');};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);

export function createTerminalHandoff({terminal,workflowContext,agents,records,resourceRouting,agentRpc,assertIdle}){
 const intents=new Map();let serial=0;
 function begin(sessionId){const value=++serial;intents.set(sessionId,value);if(intents.size>64)intents.delete(intents.keys().next().value);return value;}
 function request(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['sessionId','ownerEpoch','owner','provider'].includes(key))||!validId(value.sessionId)||!Number.isSafeInteger(value.ownerEpoch)||value.ownerEpoch<0||!['human','agent'].includes(value.owner))throw Error('terminal_invalid_request');
  if(value.provider!==undefined)providerId(value.provider);
  return {sessionId:value.sessionId,ownerEpoch:value.ownerEpoch,owner:value.owner};
 }
 async function owner(value){
  const data=request(value),intent=begin(data.sessionId);
  if(data.owner==='human')return terminal.owner(data);
  const initial=structuredClone(workflowContext.current()),initialRevision=workflowContext.revision(),resource=resourceRouting.capture(),provider=value.provider||initial?.provider||agents.active;
  providerId(provider);
  const fresh=()=>{if(intents.get(data.sessionId)!==intent)fail();resource.assertCurrent();};
  const initialCurrent=()=>{fresh();if(workflowContext.revision()!==initialRevision||!equal(initial,workflowContext.current()))fail();};
  if(initial?.threadId){
   if(initial.provider!==provider)fail();
   const result=await terminal.owner(data);fresh();return result;
  }
  assertIdle();
  let session;
  const verifySession=async(assertCurrent)=>{
   const result=await terminal.list({});assertCurrent();
   const found=result.sessions?.find(item=>item.sessionId===data.sessionId);
   if(!found||found.alive!==true||found.expired||found.owner!=='human'||found.ownerEpoch!==data.ownerEpoch)fail();
   const stamp={sessionId:found.sessionId,kind:found.kind,ownerEpoch:found.ownerEpoch,resource:found.resource??null};
   if(session&&!equal(session,stamp))fail();session=stamp;
   const selected=resource.selection;
   if(selected&&(found.kind!=='ssh'||selected.kind!=='ssh-terminal'||selected.sessionId!==found.sessionId||selected.profileId!==found.resource?.profileId||selected.profileVersion!==found.resource?.profileVersion))fail();
   if(found.kind==='ssh'&&found.resource){
    const state=await terminal.resourceState({sessionId:data.sessionId});assertCurrent();
    if(state.sessionId!==found.sessionId||!equal(state.resource,found.resource)||state.operator!=='human'||state.ownerEpoch!==data.ownerEpoch||state.alive!==true||state.processStatus!=='running')fail();
   }
  };
  await verifySession(initialCurrent);
  await agents.connect(provider);initialCurrent();if(agents.active!==provider)fail();
  await verifySession(initialCurrent);assertIdle();initialCurrent();
  const started=await agentRpc({provider,method:'thread/start',params:{}});fresh();
  const selected=structuredClone(workflowContext.current()),revision=workflowContext.revision();
  if(!started?.thread?.id||selected?.provider!==provider||selected.threadId!==started.thread.id||selected.taskId)fail();
  const selectedCurrent=()=>{fresh();if(agents.active!==provider||workflowContext.revision()!==revision||!equal(selected,workflowContext.current()))fail();};
  await verifySession(selectedCurrent);selectedCurrent();
  const conversation=records.remember({provider,threadId:started.thread.id,projectId:null});
  if(!conversation||conversation.provider!==provider||conversation.threadId!==started.thread.id)fail();
  selectedCurrent();const result=await terminal.owner(data);selectedCurrent();
  return {...result,conversation};
 }
 async function close(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!validId(value.sessionId))throw Error('terminal_invalid_request');
  begin(value.sessionId);return terminal.close(value);
 }
 return {owner,close};
}
