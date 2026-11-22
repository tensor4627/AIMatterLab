import {useEffect,useState} from 'react';
import type {ConversationActivity,ConversationAttentionTarget} from '../../../contracts/dto/conversation-activity';
import {invoke} from '../../api/studio';

type Attention=Omit<ConversationAttentionTarget,'nonce'>;
export const activityKey=({provider,threadId}:Pick<ConversationActivity,'provider'|'threadId'>)=>provider+':'+threadId;

function targetKey({provider,threadId,target}:Attention){
 return JSON.stringify([provider,threadId,'requestId' in target?target.kind:'result','requestId' in target?target.requestId:target.receiptId]);
}
export function nextConversationAttention(rows:ConversationActivity[],visible:Set<string>,previous?:Attention|null):Attention|undefined{
 const entries:Attention[]=[];
 for(const {provider,threadId,pending,unread} of rows){
  if(!visible.has(activityKey({provider,threadId})))continue;
  for(const target of pending)entries.push({provider,threadId,target});
  if(unread)entries.push({provider,threadId,target:unread});
 }
 entries.sort((a,b)=>Number('receiptId' in a.target)-Number('receiptId' in b.target)||a.target.at-b.target.at||targetKey(a).localeCompare(targetKey(b)));
 const last=previous?entries.findIndex(value=>targetKey(value)===targetKey(previous)):-1;
 return entries.length?entries[(last+1)%entries.length]:undefined;
}

export function useConversationActivity(){
 const [rows,setRows]=useState<ConversationActivity[]>([]);
 useEffect(()=>{
  let alive=true,loading=false,dirty=false;
  async function refresh(){
   if(loading){dirty=true;return;}
   loading=true;
   try{
    do{
     dirty=false;
     const latest=await invoke<ConversationActivity[]>('conversation.activity.list',{}).catch(()=>null);
     if(alive&&!dirty&&Array.isArray(latest))setRows(latest);
    }while(alive&&dirty);
   }finally{loading=false;}
  }
  const unsubscribe=window.studio?.onEvent(event=>{
   if(['studio/conversationActivityChanged','studio/terminalApprovalChanged','studio/conversationTerminalChanged','studio/conversationDeleted','studio/conversationContextChanged'].includes(event.method))void refresh();
  });
  window.addEventListener('focus',refresh);
  void refresh();
  return()=>{alive=false;unsubscribe?.();window.removeEventListener('focus',refresh);};
 },[]);
 return rows;
}
