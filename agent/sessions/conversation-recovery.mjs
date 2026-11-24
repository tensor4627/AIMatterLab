import {isDeepStrictEqual} from 'node:util';
import {providerId} from '../providers/contracts.mjs';
import {definitionContextMatches} from './private-conversation-context.mjs';

export function missingRollout(error){return error?.code==='STUDIO_CODEX_ROLLOUT_MISSING';}
function anchor(records,provider,threadId){
 const conversation=records.conversation(provider,threadId),task=records.bound(provider,threadId);
 if(!conversation||records.deleted(provider,threadId))throw Error('A saved current conversation is required');
 if(records.tasks().filter(value=>value.provider===provider&&value.threadId===threadId).length>1)throw Error('Multiple workflows require an explicit migration');
 if(task&&['validating','submitting','unknown'].includes(task.execution?.phase))throw Error('Reconcile the existing execution request before rebuilding its conversation connection');
 return {conversation:structuredClone(conversation),task:task?structuredClone(task):null};
}

// Only main calls this after an actual missing-session response or explicit recovery. No user turn is sent.
export async function recoverConversationContext({records,workflowContext,agents,attachments,ticket:previousTicket,provider='codex',threadId,model,automatic=false,publish=records.publish}){
 providerId(provider);
 workflowContext.assert(previousTicket);agents.assertContextIdle();
 if(automatic&&(provider!=='codex'||agents.codexThreadState(threadId)?.state!=='empty'))throw Error('An uncertain or historical conversation cannot be replaced automatically');
 const expected=anchor(records,provider,threadId),ticket=workflowContext.beginConversationReplacement(provider,threadId);
 const check=()=>{workflowContext.assert(ticket);if(!isDeepStrictEqual(anchor(records,provider,threadId),expected))throw Error('The original conversation or workflow changed during recovery');};
 const sync=()=>workflowContext.synchronize(ticket,(selectedProvider,context)=>agents.selectContext(selectedProvider,context));
 let change;
 const announce=()=>{if(!change)return;publish({method:'studio/conversationContextChanged',provider,params:{conversation:change.conversation,taskId:change.task?.id||null,oldThreadId:threadId,threadId:change.conversation.threadId,recovery:true,uploadsRetained:!!attachments}});if(change.task)publish({method:'studio/taskUpdated',provider,params:{task:change.task,showFlow:false}});};
 try{
  await sync();check();
  const startParams={...(model?{model}:{}),...(['kimi','qwen'].includes(provider)?{excludeThreadId:threadId}:{})};
  const result=await agents.rpc(provider,'thread/start',startParams);check();
  const next=result?.thread?.id;
  if(typeof next!=='string'||!next||next===threadId||!Array.isArray(result.thread.turns)||result.thread.turns.length||records.deleted(provider,next)||records.conversation(provider,next)||records.bound(provider,next))throw Error('A verified fresh empty native conversation is required');
  const conversation={...expected.conversation,id:provider+':'+next,threadId:next,updatedAt:Date.now()},task=expected.task?{...expected.task,threadId:next,updatedAt:Math.max(Date.now(),expected.task.updatedAt+1)}:null;
  if(task&&definitionContextMatches(expected.task))task.privateDefinitionContext={...task.privateDefinitionContext,threadId:next};
  records.catalog.transaction(()=>{
   check();const oldId=provider+':'+threadId;
   attachments?.recoverUploads(provider,threadId,next);
   records.catalog.put('conversation-context-history',oldId,{provider,threadId,taskId:task?.id||null,conversation:expected.conversation,thread:provider==='codex'?records.catalog.get('thread',threadId):null,agentThread:records.catalog.get('agent-thread',oldId),lifecycle:provider==='codex'?agents.codexThreadState(threadId):null,retiredAt:Date.now()});
   records.catalog.put('retired-conversation-context',oldId,{provider,threadId,taskId:task?.id||null,projectId:conversation.projectId??null,replacementThreadId:next,reason:automatic?'verified-empty-recovery':'explicit-missing-history-recovery',uploadsRetained:!!attachments});
   records.catalog.remove('conversation',oldId);records.catalog.remove('agent-thread',oldId);if(provider==='codex')records.catalog.remove('thread',threadId);
   records.catalog.put('conversation',conversation.id,conversation);if(task)records.catalog.put('agent-task',task.id,task);
  });
  const oldId=provider+':'+threadId;
  change={conversation,task};records.active.delete(oldId);records.turns.delete(oldId);records.deliveredWorkflowSnapshots?.delete(oldId);records.pendingSnapshots?.delete(oldId);if(task)records.cache.set(task.id,task);
  workflowContext.started(ticket,next);await sync();agents.forget(provider,threadId);announce();
  return {ticket,result:{...result,studioRecovery:{status:'recovered',oldThreadId:threadId,conversation,uploadsRetained:!!attachments}}};
 }catch(error){
  try{workflowContext.assert(ticket);await agents.selectContext(provider,{threadId:null,taskId:null,projectId:null,environmentId:null,inputRoot:null});workflowContext.assert(ticket);workflowContext.clear(provider);}catch{}
  if(change){agents.forget(provider,threadId);announce();error.message='对话连接已保存，请重新选择此会话以完成连接。'+error.message;}
  throw error;
 }
}

export async function resumeConversationContext({records,workflowContext,agents,attachments,ticket,provider='codex',threadId,model,excludeTurns=false,explicit=false,publish}){
 providerId(provider);
 workflowContext.assert(ticket);
 try{const result=await agents.rpc(provider,'thread/resume',{threadId,...model?{model}:{},...provider==='codex'&&excludeTurns?{excludeTurns:true}:{}});workflowContext.assert(ticket);if(result?.thread?.id!==threadId)throw Error('The server returned a different conversation during recovery');return {ticket,result};}
 catch(error){
  workflowContext.assert(ticket);
  if(provider==='codex'){
   if(!missingRollout(error))throw error;
   if(!records.conversation('codex',threadId))throw error;
   if(!explicit&&agents.codexThreadState(threadId)?.state!=='empty')return {ticket,result:{studioRecovery:{status:'required',oldThreadId:threadId}}};
   const recoveredModel=model??agents.codexThreadState(threadId)?.model??undefined;
   return recoverConversationContext({records,workflowContext,agents,attachments,ticket,provider:'codex',threadId,model:recoveredModel,automatic:!explicit,publish});
  }
  if(!explicit||!records.conversation(provider,threadId))throw error;
  return recoverConversationContext({records,workflowContext,agents,attachments,ticket,provider,threadId,model,automatic:false,publish});
 }
}
