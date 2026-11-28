import {useEffect,useState} from 'react';
import Button from '../../ui/Button';
import Disclosure from '../../ui/Disclosure';
import Notice from '../../ui/Notice';
import {t} from '../../ui/i18n';
import {invoke} from '../../api/studio';
import type {ConversationApproval,ConversationApprovalOwner} from '../../../contracts/dto/conversation-approvals';
import type {TypedInvoke} from '../../../contracts/dto/ipc';

const request:TypedInvoke=invoke;

export default function ConversationApprovals({provider,threadId}:ConversationApprovalOwner){
 const [rows,setRows]=useState<ConversationApproval[]|null>(null);
 const [error,setError]=useState('');
 const [revoking,setRevoking]=useState(false);
 useEffect(()=>{
  let live=true,sequence=0;
  const load=async()=>{
   const current=++sequence;
   try{const value=await request('conversation.approvals',{provider,threadId});
    if(live&&current===sequence){setRows(Array.isArray(value)?value:[]);setError('');}
   }catch{if(live&&current===sequence)setError(t('无法读取会话审批。'));}
  };
  void load();
  const unsubscribe=window.studio?.onEvent(event=>{
   if(event.method==='studio/conversationApprovalChanged'&&event.params?.provider===provider&&event.params?.threadId===threadId)void load();
  });
  return()=>{live=false;unsubscribe?.();};
 },[provider,threadId]);
 async function revoke(id:string){
  setRevoking(true);
  try{setRows(await request('conversation.revokeApproval',{provider,threadId,id}));setError('');}
  catch{setError(t('撤销审批失败，请重试。'));}
  finally{setRevoking(false);}
 }
 return <Disclosure className="agent-option-section" summary={t('会话审批')} data-testid="conversation-approvals">
  {error&&<Notice compact severity="error">{error}</Notice>}
  {!error&&rows===null&&<p>{t('正在读取…')}</p>}
  {!error&&rows?.length===0&&<p>{t('此会话没有额外审批。')}</p>}
  {!!rows?.length&&<ul className="conversation-approval-list">{rows.map(row=><li key={row.id}>
   <strong>{t(row.operation)}</strong>
   <small>{row.resource&&row.resource+' · '}{new Date(row.approvedAt).toLocaleString()} · {t(row.revokedAt?'已撤销':row.lifetime==='conversation'?'本会话有效':'仅本次')}</small>
   {row.paths.map((file,index)=><code key={index}>{file}</code>)}
   {row.lifetime==='conversation'&&!row.revokedAt&&<Button disabled={revoking} onClick={()=>void revoke(row.id)}>{t('撤销审批')}</Button>}
  </li>)}</ul>}
 </Disclosure>;
}
