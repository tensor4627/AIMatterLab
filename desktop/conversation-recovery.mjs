import {isDeepStrictEqual} from 'node:util';
import {definitionContextMatches} from './private-conversation-context.mjs';

export function missingRollout(error){return error?.code==='STUDIO_CODEX_ROLLOUT_MISSING';}
function anchor(records,threadId){
 const conversation=records.conversation('codex',threadId),task=records.bound('codex',threadId);
 if(!conversation||records.deleted('codex',threadId))throw Error('A saved current conversation is required');
 if(records.tasks().filter(value=>value.provider==='codex'&&value.threadId===threadId).length>1)throw Error('Multiple workflows require an explicit migration');
 if(task&&['validating','submitting','unknown'].includes(task.execution?.phase))throw Error('Reconcile the existing execution request before rebuilding its conversation connection');
 return {conversation:structuredClone(conversation),task:task?structuredClone(task):null};
}

// Only main calls this after an actual missing-rollout response. No user turn is sent.
export async function recoverConversationContext({records,workflowContext,agents,ticket:previousTicket,threadId,model,automatic=false,publish=records.publish}){
 workflowContext.assert(previousTicket);agents.assertContextIdle();
 if(automatic&&agents.codexThreadState(threadId)?.state!=='empty')throw Error('An uncertain or historical conversation cannot be replaced automatically');
 const expected=anchor(records,threadId),ticket=workflowContext.beginConversationReplacement('codex',threadId);
 const check=()=>{workflowContext.assert(ticket);if(!isDeepStrictEqual(anchor(records,threadId),expected))throw Error('The original conversation or workflow changed during recovery');};
 const sync=()=>workflowContext.synchronize(ticket,(provider,context)=>agents.selectContext(provider,context));
 let change;
 const announce=()=>{if(!change)return;publish({method:'studio/conversationContextChanged',provider:'codex',params:{conversation:change.conversation,taskId:change.task?.id||null,oldThreadId:threadId,threadId:change.conversation.threadId,recovery:true}});if(change.task)publish({method:'studio/taskUpdated',provider:'codex',params:{task:change.task,showFlow:false}});};
 try{
  await sync();check();
  const result=await agents.rpc('codex','thread/start',{...(model?{model}:{})});check();
  const next=result?.thread?.id;
  if(typeof next!=='string'||!next||next===threadId||!Array.isArray(result.thread.turns)||result.thread.turns.length||records.deleted('codex',next)||records.conversation('codex',next)||records.bound('codex',next))throw Error('A verified fresh empty native conversation is required');
  const conversation={...expected.conversation,id:'codex:'+next,threadId:next,updatedAt:Date.now()},task=expected.task?{...expected.task,threadId:next,updatedAt:Math.max(Date.now(),expected.task.updatedAt+1)}:null;
  if(task&&definitionContextMatches(expected.task))task.privateDefinitionContext={...task.privateDefinitionContext,threadId:next};
  records.catalog.transaction(()=>{
   check();const oldId='codex:'+threadId;
   records.catalog.put('conversation-context-history',oldId,{provider:'codex',threadId,taskId:task?.id||null,conversation:expected.conversation,thread:records.catalog.get('thread',threadId),agentThread:records.catalog.get('agent-thread',oldId),lifecycle:agents.codexThreadState(threadId),retiredAt:Date.now()});
   records.catalog.put('retired-conversation-context',oldId,{provider:'codex',threadId,taskId:task?.id||null,replacementThreadId:next,reason:automatic?'verified-empty-recovery':'explicit-missing-history-recovery'});
   records.catalog.remove('conversation',oldId);records.catalog.remove('agent-thread',oldId);records.catalog.remove('thread',threadId);
   records.catalog.put('conversation',conversation.id,conversation);if(task)records.catalog.put('agent-task',task.id,task);
  });
  change={conversation,task};records.active.delete('codex:'+threadId);records.turns.delete('codex:'+threadId);if(task)records.cache.set(task.id,task);
  workflowContext.started(ticket,next);await sync();agents.forget('codex',threadId);announce();
  return {ticket,result:{...result,studioRecovery:{status:'recovered',oldThreadId:threadId,conversation}}};
 }catch(error){
  try{workflowContext.assert(ticket);await agents.selectContext('codex',{threadId:null,taskId:null,projectId:null,environmentId:null,inputRoot:null});workflowContext.assert(ticket);workflowContext.clear('codex');}catch{}
  if(change){agents.forget('codex',threadId);announce();error.message='对话连接已保存，请重新选择此会话以完成连接。'+error.message;}
  throw error;
 }
}

export async function resumeConversationContext({records,workflowContext,agents,ticket,threadId,model,explicit=false,publish}){
 workflowContext.assert(ticket);
 try{const result=await agents.rpc('codex','thread/resume',{threadId,...model?{model}:{}});workflowContext.assert(ticket);if(result?.thread?.id!==threadId)throw Error('The server returned a different conversation during recovery');return {ticket,result};}
 catch(error){
  workflowContext.assert(ticket);if(!missingRollout(error))throw error;
  if(!records.conversation('codex',threadId))throw error;
  if(!explicit&&agents.codexThreadState(threadId)?.state!=='empty')return {ticket,result:{studioRecovery:{status:'required',oldThreadId:threadId}}};
  const recoveredModel=model??agents.codexThreadState(threadId)?.model??undefined;
  return recoverConversationContext({records,workflowContext,agents,ticket,threadId,model:recoveredModel,automatic:!explicit,publish});
 }
}
