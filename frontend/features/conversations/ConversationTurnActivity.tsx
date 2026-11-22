import {useEffect,useRef,type RefObject} from 'react';
import type {ConversationActivity,ConversationAttentionTarget,ConversationResultReceipt} from '../../../contracts/dto/conversation-activity';
import {invoke} from '../../api/studio';
import {t} from '../../ui/i18n';
import {toolLabel} from './tool-activity.mjs';
import './conversation-attention.css';

const planStatus={pending:'待开始',inProgress:'进行中',completed:'已完成'};
const toolStatus={running:'工具处理中',reported:'已收到工具结果',failed:'工具报告失败'};

function attributeNode(root:HTMLElement,attribute:string,value:string){
 return Array.from(root.querySelectorAll<HTMLElement>('['+attribute+']')).find(node=>node.getAttribute(attribute)===value);
}
function resultNode(scroll:HTMLElement,receipt:ConversationResultReceipt){
 if(receipt.itemId){
  const exact=attributeNode(scroll,'data-item-id',receipt.itemId)||attributeNode(scroll,'data-message-id',receipt.itemId);
  return exact&&(!exact.dataset.turnId||exact.dataset.turnId===receipt.turnId)?exact:undefined;
 }
 return [...scroll.querySelectorAll<HTMLElement>('[data-turn-id]')].reverse().find(node=>node.dataset.turnId===receipt.turnId&&node.getClientRects().length>0);
}

export default function ConversationTurnActivity({activity,notice,scroll,ownerCurrent,rendered,onJump}:{activity?:ConversationActivity;notice?:ConversationAttentionTarget;scroll:RefObject<HTMLDivElement|null>;ownerCurrent:()=>boolean;rendered:unknown;onJump:()=>void}){
 const presented=useRef<string|undefined>(undefined),acknowledged=useRef<string|undefined>(undefined);
 const current=useRef(ownerCurrent);current.current=ownerCurrent;
 const ownerVisible=ownerCurrent();
 useEffect(()=>{
  const root=scroll.current,panel=root?.closest<HTMLElement>('.agent-panel');
  const owner=activity||notice;
  if(!root||!panel||!owner||!ownerVisible)return;
  let stopped=false,observer:IntersectionObserver|undefined;
  const unread=activity?.unread;
  const read=(receipt:ConversationResultReceipt)=>{
   if(stopped||!current.current()||document.visibilityState==='hidden'||!document.hasFocus()||acknowledged.current===receipt.receiptId)return;
   acknowledged.current=receipt.receiptId;
   const {provider,threadId}=owner;
   void invoke<{acknowledged:boolean}>('conversation.activity.markRead',{provider,threadId,receiptId:receipt.receiptId})
    .catch(()=>null).then(result=>{if(!result?.acknowledged&&acknowledged.current===receipt.receiptId)acknowledged.current=undefined;});
  };
  const observeResult=()=>{
   const node=unread&&resultNode(root,unread);
   if(!node||!unread||!node.getClientRects().length)return;
   if(typeof IntersectionObserver==='function'){
    observer?.disconnect();
    observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))read(unread);},{root,threshold:0});
    observer.observe(node);
   }
  };
  const jump=()=>{
   if(stopped||!notice||presented.current===notice.nonce||!current.current()||notice.provider!==owner.provider||notice.threadId!==owner.threadId)return;
   const {target}=notice;
   let node:HTMLElement|undefined;
   if('requestId' in target){
    if(!activity?.pending.some(request=>request.kind===target.kind&&request.requestId===target.requestId&&request.turnId===target.turnId))return;
    node=attributeNode(panel,target.kind==='terminalApproval'?'data-terminal-approval-id':'data-request-id',target.requestId);
    if(node?.dataset.requestTurnId&&node.dataset.requestTurnId!==target.turnId)return;
   }else{
    node=resultNode(root,target)||undefined;
    const closed=node?.closest<HTMLDetailsElement>('details:not([open])');
    if(closed)closed.open=true;
   }
   if(!node||!node.getClientRects().length)return;
   presented.current=notice.nonce;
   node.tabIndex=-1;
   node.scrollIntoView({block:'nearest',inline:'nearest'});
   node.focus({preventScroll:true});
   if(!('requestId' in target))onJump();
   observeResult();
  };
  jump();observeResult();
  const changes=notice&&presented.current!==notice.nonce?new MutationObserver(jump):null;
  changes?.observe(panel,{childList:true,subtree:true});
  window.addEventListener('focus',observeResult);
  document.addEventListener('visibilitychange',observeResult);
  return()=>{
   stopped=true;observer?.disconnect();changes?.disconnect();
   window.removeEventListener('focus',observeResult);
   document.removeEventListener('visibilitychange',observeResult);
  };
 },[activity,notice,rendered,ownerVisible]);
 const plan=activity?.live?.plan,tool=activity?.live?.tool,pending=activity?.pending[0];
 if(!activity||activity.phase==='idle'||!plan&&!tool&&!pending)return null;
 const step=plan?.steps.find(item=>item.status==='inProgress');
 const summary=pending?t(pending.kind==='question'?'等你回答':'等你审批'):step?.text||(!plan&&tool?t(toolStatus[tool.state])+' · '+t(toolLabel(tool.name)):t('本轮计划'));
 return <details className="agent-turn-activity" data-testid="agent-turn-activity">
  <summary><span>{t('本轮进度')}</span><strong>{summary}</strong></summary>
  {plan?.explanation&&<p>{plan.explanation}</p>}
  {!!plan?.steps.length&&<ol>{plan.steps.map((item,index)=><li key={index} data-status={item.status}><small>{t(planStatus[item.status])}</small><span>{item.text}</span></li>)}</ol>}
  {tool&&<p>{t(toolStatus[tool.state])} · {t(toolLabel(tool.name))}</p>}
 </details>;
}
