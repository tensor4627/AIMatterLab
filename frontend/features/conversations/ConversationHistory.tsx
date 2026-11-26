import Disclosure from '../../ui/Disclosure';
import Button from '../../ui/Button';
import {useEffect,useState} from 'react';
import {Bookmark,ChevronUp,Search} from 'lucide-react';
import type {Conversation} from '../../../contracts/dto/agent';
import type {ConversationAnchor,ConversationBookmark,ConversationBranchPreview,ConversationHistorySearchRequest,ConversationHistorySearchResult} from '../../../contracts/dto/conversation-history';
import {conversationHistory} from '../../api/conversation-history';
import {Modal} from '../../ui/Dialogs';
import {t} from '../../ui/i18n';
import './conversation-history.css';

type SearchProps={scope:Omit<ConversationHistorySearchRequest,'query'>;conversations?:Conversation[];onOpen:(anchor:ConversationAnchor)=>void};
export function ConversationHistorySearch({scope,conversations,onOpen}:SearchProps){
 const [query,setQuery]=useState(''),[result,setResult]=useState<ConversationHistorySearchResult|null>(null),[failed,setFailed]=useState(false);
 const {conversationId,projectId}=scope;
 const label=t(conversationId?'在会话中查找':'搜索聊天正文');
 useEffect(()=>{
  let active=true;
  setResult(null);setFailed(false);
  if(!query.trim())return;
  const timer=setTimeout(()=>{
   void conversationHistory.search({query,...conversationId?{conversationId}:{projectId:projectId??null}})
    .then(value=>{if(active)setResult(value);}).catch(()=>{if(active)setFailed(true);});
  },180);
  return()=>{active=false;clearTimeout(timer);};
 },[conversationId,projectId,query]);
 const shown=result?.matches.filter(value=>!conversations||conversations.some(chat=>chat.id===value.conversationId&&(chat.projectId??null)===(projectId??null)))||[];
 return <div className="chat-history-search" role="search" aria-label={label}>
  <label><Search size={16}/><input type="search" autoFocus aria-label={label} placeholder={label} maxLength={250} value={query} onChange={event=>{setResult(null);setQuery(event.target.value);}}/></label>
  {query.trim()&&<div className="history-search-results" aria-live="polite">
   {failed?<p>{t('聊天搜索暂时不可用。')}</p>:!result?<p>{t('正在搜索聊天正文…')}</p>:<>
    {shown.map(({name,snippet,archived,...anchor})=><button type="button" key={JSON.stringify([anchor.conversationId,anchor.turnId,anchor.itemId])} onClick={()=>onOpen(anchor)}><strong>{name}{archived&&' · '+t('已归档')}</strong><span>{snippet}</span></button>)}
    {!shown.length&&<p>{t('没有匹配的消息')}</p>}
    {result.unavailable>0&&<p>{t('部分聊天历史暂时无法读取。')}</p>}
   </>}
  </div>}
 </div>;
}

export function ConversationHistoryToolbar({conversationId,source,bookmarks,atLatest,loading,onOpen,onLatest}:{conversationId:string;source:Conversation['source'];bookmarks:ConversationBookmark[];atLatest:boolean;loading:boolean;onOpen:(anchor:ConversationAnchor)=>void;onLatest:()=>void}){
 const [find,setFind]=useState(false);
 return <div className="chat-history-toolbar">
  <div className="chat-history-actions">
   <button className="text-button" type="button" aria-expanded={find} onClick={()=>setFind(value=>!value)}><Search size={14}/>{t('在会话中查找')}</button>
   {!!bookmarks.length&&<Disclosure summary={<><Bookmark size={14}/>{t('书签')}</>}><div className="chat-bookmarks">{bookmarks.map(({snippet,...anchor})=><button key={JSON.stringify([anchor.turnId,anchor.itemId])} type="button" className="text-button" onClick={()=>onOpen(anchor)}>{snippet||t('回合书签')}</button>)}</div></Disclosure>}
   {source&&<Button variant="ghost" tooltip={source.name} className="text-button chat-original-source" type="button" onClick={()=>onOpen({conversationId:source.conversationId,turnId:source.turnId,...source.itemId?{itemId:source.itemId}:{}})} >{t('返回来源')} · {source.name}</Button>}
   {!atLatest&&<button className="text-button" type="button" disabled={loading} onClick={onLatest}>{t('回到最新记录')}</button>}
  </div>
  {find&&<ConversationHistorySearch scope={{conversationId}} onOpen={anchor=>{onOpen(anchor);setFind(false);}}/>}
 </div>;
}

export function OlderConversationPage({loading,onLoad}:{loading:boolean;onLoad:()=>void}){
 return <div className="older-conversation-page"><Button  type="button" disabled={loading} onClick={onLoad}><ChevronUp size={14}/>{t(loading?'正在读取更早消息…':'加载更早消息')}</Button></div>;
}

export function ConversationExcerptDialog({value,busy,onClose,onConfirm}:{value:ConversationBranchPreview;busy:boolean;onClose:()=>void;onConfirm:()=>void}){
 return <Modal title={t('从此轮另开讨论')} closeDisabled={busy} onClose={onClose}>
  <p>{t('下面的摘录将放入新讨论的草稿。发送前可以修改。')}</p>
  <blockquote className="chat-branch-excerpt">{value.excerpt}</blockquote>
  <div className="button-row"><Button type="button"  disabled={busy} onClick={onClose}>{t('取消')}</Button><Button variant="primary" type="button"  disabled={busy} onClick={onConfirm}>{t(busy?'正在创建讨论…':'创建讨论草稿')}</Button></div>
 </Modal>;
}
