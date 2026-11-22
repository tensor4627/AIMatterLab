import {BellDot,CircleHelp,Mail,Shield} from 'lucide-react';
import type {ConversationActivity,ConversationAttentionTarget} from '../../../contracts/dto/conversation-activity';
import {t} from '../../ui/i18n';
import './conversation-attention.css';

export type AttentionValue=Omit<ConversationAttentionTarget,'nonce'>;

export function ConversationAttentionBadges({activity,onSelect}:{activity?:ConversationActivity;onSelect:(value:AttentionValue)=>void}){
 if(!activity)return null;
 const {provider,threadId,pending,unread}=activity;
 const question=pending.find(value=>value.kind==='question'),approval=pending.find(value=>value.kind!=='question');
 return <>
  {question&&<button type="button" className="conversation-attention-badge" data-testid="conversation-waiting-question" aria-label={t('等你回答')} title={t('等你回答')} onClick={()=>onSelect({provider,threadId,target:question})}><CircleHelp size={14}/></button>}
  {approval&&<button type="button" className="conversation-attention-badge" data-testid="conversation-waiting-approval" aria-label={t('等你审批')} title={t('等你审批')} onClick={()=>onSelect({provider,threadId,target:approval})}><Shield size={14}/></button>}
  {unread&&<button type="button" className="conversation-attention-badge" data-state="unread" data-testid="conversation-unread-result" aria-label={t('结果未读')} title={t('结果未读')} onClick={()=>onSelect({provider,threadId,target:unread})}><Mail size={14}/></button>}
 </>;
}

export function NextConversationAttention({onSelect,compact=false,disabled=false}:{onSelect:()=>void;compact?:boolean;disabled?:boolean}){
 return <button type="button" className="next-conversation-attention" data-testid="next-conversation-attention" aria-label={t('下一条待处理')} title={t('下一条待处理')} disabled={disabled} onClick={onSelect}>
  <BellDot size={16}/>{!compact&&<span>{t('下一条待处理')}</span>}
 </button>;
}
