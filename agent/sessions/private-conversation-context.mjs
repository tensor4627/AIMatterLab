import {isDeepStrictEqual} from 'node:util';
import {PROVIDERS} from '../providers/contracts.mjs';
const hashes=['specSha','parametersSha','codeSha'];
const snapshot=task=>{const value=structuredClone(task);delete value.updatedAt;return value;};
export function definitionContextMatches(task){
 const value=task?.privateDefinitionContext,current=task?.customCv;
 return !!current&&value?.provider===task.provider&&value.threadId===task.threadId&&value.taskId===task.id&&value.entryId===current.id&&hashes.every(key=>value[key]===current[key]);
}
function assertAnchor(records,expected){
 const current=records.read(expected.id);
 if(!isDeepStrictEqual(snapshot(current),snapshot(expected))||records.deleted(expected.provider,expected.threadId)||records.bound(expected.provider,expected.threadId)?.id!==expected.id)throw Error('The original workflow changed while creating its private model context');
 return current;
}
/** Retain the scientific task and local historical records; retire only the old model context. */
export function rebindDefinitionContext(records,expected,threadId){
 const task=assertAnchor(records,expected),provider=task.provider,oldThreadId=task.threadId;
 if(!PROVIDERS.includes(provider)||!task.customCv?.id||typeof threadId!=='string'||!threadId||threadId.length>200||threadId===oldThreadId||records.deleted(provider,threadId)||records.bound(provider,threadId))throw Error('A fresh native model context is required');
 if(['validating','submitting','unknown'].includes(task.execution?.phase))throw Error('Reconcile the existing execution request before changing model context');
 if(records.tasks().some(other=>other.id!==task.id&&other.provider===provider&&other.threadId===oldThreadId))throw Error('Multiple workflows need an explicit context migration');
 const catalog=records.catalog,oldId=provider+':'+oldThreadId,id=provider+':'+threadId,oldConversation=records.conversation(provider,oldThreadId);
 const conversation={...oldConversation,id,provider,threadId,taskId:task.id,projectId:oldConversation?.projectId||task.projectId||null,name:oldConversation?.name||task.name,updatedAt:Date.now()};
 task.threadId=threadId;task.privateDefinitionContext={provider,threadId,taskId:task.id,entryId:task.customCv.id,...Object.fromEntries(hashes.map(key=>[key,task.customCv[key]]))};task.updatedAt=Math.max(Date.now(),expected.updatedAt+1||0);
 catalog.transaction(()=>{
  assertAnchor(records,expected);
  catalog.put('conversation-context-history',oldId,{provider,threadId:oldThreadId,taskId:task.id,conversation:oldConversation,thread:provider==='codex'?catalog.get('thread',oldThreadId):null,agentThread:catalog.get('agent-thread',oldId),retiredAt:Date.now()});
  catalog.put('retired-conversation-context',oldId,{provider,threadId:oldThreadId,taskId:task.id,replacementThreadId:threadId});
  catalog.remove('conversation',oldId);catalog.remove('agent-thread',oldId);if(provider==='codex')catalog.remove('thread',oldThreadId);
  catalog.put('conversation',id,conversation);catalog.put('agent-task',task.id,task);
 });
 records.active.delete(oldId);records.turns.delete(oldId);records.deliveredWorkflowSnapshots?.delete(oldId);records.pendingSnapshots?.delete(oldId);records.cache.set(task.id,task);
 return {task,conversation,oldThreadId};
}
/** Called only by trusted main, before preparing the model turn. No model turn is retried. */
export async function ensureDefinitionContext({records,workflowContext,agents,task,model,ticket:previousTicket,publish=records.publish}){
 workflowContext.assert(previousTicket);
 if(definitionContextMatches(task))return {task,ticket:previousTicket};
 const expected=structuredClone(task),ticket=workflowContext.beginReplacement(task.provider,task.threadId);
 const sync=()=>workflowContext.synchronize(ticket,(provider,context)=>agents.selectContext(provider,context));
 let rebound=false;
 try{
  await sync();workflowContext.assert(ticket);assertAnchor(records,expected);
  const startParams={...(model?{model}:{}),...(['kimi','qwen'].includes(task.provider)?{excludeThreadId:task.threadId}:{})};
  const result=await agents.rpc(task.provider,'thread/start',startParams);workflowContext.assert(ticket);
  if(!result?.thread?.id||!Array.isArray(result.thread.turns)||result.thread.turns.length)throw Error('A verified empty native model context is required');
  const change=rebindDefinitionContext(records,expected,result.thread.id);rebound=true;
  workflowContext.started(ticket,result.thread.id);await sync();
  agents.forget(task.provider,change.oldThreadId);
  publish({method:'studio/conversationContextChanged',provider:task.provider,params:{conversation:change.conversation,taskId:task.id,oldThreadId:change.oldThreadId,threadId:result.thread.id}});
  publish({method:'studio/taskUpdated',provider:task.provider,params:{task:change.task,showFlow:false}});
  return {task:change.task,ticket};
 }catch(error){
  // A concurrent selection owns its own lease. Never clear that newer selection.
  try{workflowContext.assert(ticket);await agents.selectContext(task.provider,{threadId:null,taskId:null,projectId:null,environmentId:null,inputRoot:null});workflowContext.assert(ticket);workflowContext.clear(task.provider);}catch{}
  if(rebound)error.message='Private model context was saved but could not be bound; reconnect this same workflow before sending. '+error.message;
  throw error;
 }
}
