import {randomUUID} from 'node:crypto';
import {PROVIDERS} from '../providers/contracts.mjs';
import {titleReviewToolName} from '../../contracts/agent/conversation-title.mjs';
import {redactTranscriptText} from '../../contracts/agent/transcript-sanitizer.mjs';

export const conversationReceiptKind='conversation-result-receipt';
const questions=new Set(['item/tool/requestUserInput','studio/question']);
const approvals=new Set([
 'mcpServer/elicitation/request','item/permissions/requestApproval',
 'item/commandExecution/requestApproval','item/fileChange/requestApproval','execCommandApproval','applyPatchApproval',
]);
const toolLabels={commandExecution:'命令执行',fileChange:'文件变更',webSearch:'网页检索'};
const planStatuses=new Set(['pending','inProgress','completed']);
const identity=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\x00-\x1f]/.test(value);
const knownOwner=(provider,threadId)=>PROVIDERS.includes(provider)&&identity(threadId);
const key=(provider,threadId)=>provider+':'+threadId;
const publicText=(value,limit)=>typeof value==='string'?redactTranscriptText(value.trim()).slice(0,limit):'';
const requestIdentity=value=>identity(value)||Number.isSafeInteger(value);
const knownReceipt=row=>knownOwner(row?.provider,row?.threadId)&&identity(row.turnId)&&identity(row.receiptId)&&
 Number.isFinite(row.at)&&typeof row.read==='boolean'&&(row.itemId===undefined||identity(row.itemId));

function planOf(params){
 if(!Array.isArray(params.plan))return null;
 const steps=params.plan.slice(0,24).flatMap(step=>{
  const text=publicText(step?.step,300);
  return text&&planStatuses.has(step.status)?[{text,status:step.status}]:[];
 });
 if(!steps.length)return null;
 const explanation=publicText(params.explanation,800);
 return {steps,...explanation?{explanation}:{}};
}

function toolOf(item,completed){
 if(item.type==='mcpToolCall'&&item.tool===titleReviewToolName)return null;
 const name=item.type==='mcpToolCall'?publicText(item.tool,120):Object.hasOwn(toolLabels,item.type)?toolLabels[item.type]:'';
 if(!name)return null;
 const state=item.status==='failed'||item.error||item.result?.isError||Number.isInteger(item.exitCode)&&item.exitCode!==0
  ?'failed':completed?'reported':'running';
 return {name,state};
}

/** Keeps durable read receipts and projects only live, scoped provider activity. */
export function createConversationActivity({catalog,exists,publish=()=>{},terminalApproval=()=>null,now=Date.now,uuid=randomUUID}){
 const live=new Map();
 const receipts=new Map(catalog.list(conversationReceiptKind).filter(knownReceipt).map(row=>[key(row.provider,row.threadId),row]));

 function entry(provider,threadId){
  const id=key(provider,threadId);
  if(!live.has(id))live.set(id,{provider,threadId,phase:'idle',pending:new Map()});
  return live.get(id);
 }
 function forget(provider,threadId){
  const id=key(provider,threadId),removed=live.delete(id);
  if(receipts.delete(id)){
   try{catalog.remove(conversationReceiptKind,id);}catch{/* A removed chat cannot surface a saved receipt. */}
   publish();
  }
  else if(removed)publish();
 }
 function markRead(value){
  if(!value||Object.keys(value).sort().join(',')!=='provider,receiptId,threadId'||
     !knownOwner(value.provider,value.threadId)||!identity(value.receiptId))throw Error('Invalid conversation read receipt');
  const {provider,threadId,receiptId}=value,id=key(provider,threadId);
  if(!exists(provider,threadId))return {acknowledged:false};
  const saved=catalog.transaction(()=>{
   const row=catalog.get(conversationReceiptKind,id);
   if(!knownReceipt(row)||row.receiptId!==receiptId||row.read)return row;
   return catalog.put(conversationReceiptKind,id,{...row,read:true});
  });
  if(knownReceipt(saved)&&(receipts.get(id)?.receiptId!==saved.receiptId||receipts.get(id)?.read!==saved.read)){
   receipts.set(id,saved);publish();
  }
  return {acknowledged:knownReceipt(saved)&&saved.receiptId===receiptId&&saved.read};
 }
 function snapshot(){
  const rows=new Map();
  const project=(provider,threadId)=>{
   const id=key(provider,threadId);
   if(!rows.has(id))rows.set(id,{provider,threadId,phase:'idle',pending:[]});
   return rows.get(id);
  };
  for(const row of live.values()){
   if(!exists(row.provider,row.threadId))continue;
   const value=project(row.provider,row.threadId);
   value.phase=row.phase;value.pending=[...row.pending.values()];
   if(row.turn)value.live={id:row.turn.id,...row.turn.plan?{plan:row.turn.plan}:{},...row.turn.tool?{tool:row.turn.tool}:{}};
  }
  for(const row of receipts.values()){
   if(!row.read&&exists(row.provider,row.threadId)){
    const {receiptId,turnId,itemId,at}=row;
    project(row.provider,row.threadId).unread={receiptId,turnId,...itemId?{itemId}:{},at};
   }
  }
  const approval=terminalApproval();
  if(approval&&knownOwner(approval.provider,approval.threadId)&&exists(approval.provider,approval.threadId)&&
     identity(approval.approvalId)&&approval.expiresAt>now()){
   const row=project(approval.provider,approval.threadId);
   row.pending.push({kind:'terminalApproval',requestId:approval.approvalId,at:approval.at,...row.live?{turnId:row.live.id}:{}});
  }
  return [...rows.values()];
 }
 function resolved(provider,threadId,id){
  if(live.get(key(provider,threadId))?.pending.delete(String(id)))publish();
 }
 function event({provider,method,id,params={}}){
  const {threadId,turnId}=params;
  if(!knownOwner(provider,threadId))return;
  const owner=key(provider,threadId),row=live.get(owner);
  if(method==='studio/codexDisconnected'){if(live.delete(owner))publish();return;}
  if(method==='serverRequest/resolved'){resolved(provider,threadId,params.requestId);return;}
  if(method==='studio/agentTurnState'&&!params.busy&&row?.phase==='preparing'){
   live.delete(owner);publish();return;
  }
  if(method==='studio/agentTurnState'&&params.phase==='preparing'&&!row&&exists(provider,threadId)){
   entry(provider,threadId).phase='preparing';publish();return;
  }
  const started=method==='turn/started'?params.turn?.id:method==='studio/agentTurnState'&&params.busy&&params.phase==='working'?turnId:undefined;
  if(identity(started)&&exists(provider,threadId)){
   if(row?.turn||receipts.get(owner)?.turnId===started)return;
   const state=entry(provider,threadId);
   state.turn={id:started};state.phase='replying';publish();return;
  }
  if(!row?.turn)return;
  const turn=row.turn;
  if(method==='turn/completed'&&params.turn?.id===turn.id){
   if(params.turn.status==='completed'&&!params.turn.error&&exists(provider,threadId)&&receipts.get(owner)?.turnId!==turn.id){
    const items=Array.isArray(params.turn.items)?params.turn.items:[];
    const final=items.findLast(item=>['agentMessage','plan'].includes(item?.type)&&identity(item.id)&&typeof item.text==='string'&&item.text.trim());
    const tool=items.findLast(item=>item&&identity(item.id)&&toolOf(item,true));
    const itemId=final?.id||turn.assistantItem||turn.resultItem||tool?.id;
    if(itemId){
     const result={provider,threadId,turnId:turn.id,receiptId:uuid(),at:now(),read:false,itemId};
     receipts.set(owner,result);
     try{catalog.put(conversationReceiptKind,owner,result);}catch{/* The live result remains visible while its local store is unavailable. */}
    }
   }
   live.delete(owner);publish();return;
  }
  if(turnId&&turnId!==turn.id)return;
  if(requestIdentity(id)&&(questions.has(method)||approvals.has(method))){
   const requestId=String(id);
   row.pending.set(requestId,{requestId,turnId:turn.id,kind:questions.has(method)?'question':'approval',at:now()});
   publish();return;
  }
  if(method==='turn/plan/updated'){
   turn.plan=planOf(params)??undefined;publish();return;
  }
  if(method==='item/agentMessage/delta'&&identity(params.itemId)&&typeof params.delta==='string'&&params.delta.trim()){
   turn.assistantItem=params.itemId;return;
  }
  const item=params.item,completed=method==='item/completed';
  if(!(completed||method==='item/started')||!item||!identity(item.id))return;
  if(completed&&item.type==='agentMessage'&&typeof item.text==='string'&&item.text.trim()){
   turn.assistantItem=item.id;return;
  }
  if(completed&&item.type==='plan'){
   const text=publicText(item.text,1200);
   if(text){
    turn.resultItem=item.id;
    if(!turn.plan?.steps.length){turn.plan={steps:[],explanation:text};publish();}
   }
   return;
  }
  const tool=toolOf(item,completed);
  if(tool){
   if(completed)turn.resultItem=item.id;
   turn.tool=tool;publish();
  }
 }
 return {snapshot,markRead,event,resolved,forget};
}
