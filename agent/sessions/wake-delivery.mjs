import {providerId} from '../providers/contracts.mjs';

const namespace='agent-service-notification';
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const label=id=>`[AIMatterLab scheduled service notification ${id}]`;
const message=record=>({id:'service:'+record.id,type:'serviceMessage',text:record.text,createdAt:record.createdAt});

/** Reconcile the local notification with any matching item in native history. */
export function serviceHistory(catalog,provider,threadId,turns=[]){
 const rows=catalog.list(namespace).filter(value=>value.provider===provider&&value.threadId===threadId);
 if(!rows.length)return turns;
 const known=new Map(rows.map(row=>[row.id,row])),remaining=new Map(known);
 const history=turns.map(turn=>({
  ...turn,items:(turn.items||[]).flatMap(item=>{
   const text=item.type==='userMessage'&&item.content?.find(part=>part.type==='text')?.text;
   const id=typeof text==='string'&&/^\[AIMatterLab scheduled service notification ([A-Za-z0-9_.:-]{1,200})\]\n/.exec(text)?.[1];
   const row=id&&known.get(id);
   if(!row)return [item];
   return remaining.delete(id)?[message(row)]:[];
  })
 }));
 for(const row of remaining.values())history.push({id:'service:'+row.id,status:'completed',items:[message(row)]});
 return history;
}

/** Only the main-owned worker poller can admit a background model turn. */
export function createAgentWakeDelivery({catalog,agents,dispatch,canWake=()=>true,now=Date.now}){
 return async function wake(delivery){
  const scope=delivery?.scope,provider=providerId(scope?.provider),threadId=scope?.threadId;
  if(!identifier(delivery?.id)||!identifier(delivery.scheduleId)||!identifier(threadId)||!identifier(scope.taskId)||!identifier(scope.projectId)||typeof delivery.text!=='string'||!delivery.text.trim()||Buffer.byteLength(delivery.text)>8192)throw Error('Invalid scheduled notification');
  if(catalog.get(namespace,delivery.id))return true;
  if(agents.isBusy(provider,threadId))return false;
  const conversation=catalog.get('conversation',provider+':'+threadId);
  if(!conversation||conversation.provider!==provider||conversation.threadId!==threadId||conversation.taskId!==scope.taskId||!await canWake(delivery))return 'discarded';
  return agents.runInConversation(provider,threadId,async()=>{
   if(catalog.get(namespace,delivery.id))return true;
   if(!await canWake(delivery))return 'discarded';
   const record={id:delivery.id,scheduleId:delivery.scheduleId,provider,threadId,taskId:scope.taskId,projectId:scope.projectId,text:delivery.text,createdAt:now(),status:'admitted'};
   // Persist admission before touching the provider. An uncertain transport
   // response must never cause the same scheduled model turn to run again.
   catalog.put(namespace,record.id,record);
   agents.emit('event',{method:'studio/serviceNotification',provider,params:{threadId,message:message(record)}});
   try{
    const input=[{type:'text',text:label(record.id)+'\n'+record.text+'\n\nThis is a scheduled service notification for the existing conversation. Review the authorized workflow as needed and report its current state.'}];
    const result=await dispatch({provider,method:'turn/start',params:{threadId,input}},{notification:record});
    if(typeof result?.turn?.id!=='string')throw Error('No scheduled reply receipt');
    catalog.put(namespace,record.id,{...record,status:'acknowledged',turnId:result.turn.id});
   }catch{
    catalog.put(namespace,record.id,{...record,status:'unconfirmed'});
   }
   return true;
  },{claimTurn:true,ifBusy:()=>false,origin:'service'});
 };
}
