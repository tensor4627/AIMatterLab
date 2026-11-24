import {ChatFiles} from './ChatFiles';
import type {ChatAttachmentRef} from '../../../contracts/dto/chat-attachments';
import product from "../../../contracts/product.json";
import {memo} from 'react';
import {t,tr} from '../../ui/i18n';
import ToolActivity from './ToolActivity';
import MessageText from './MessageText';
export type ChatMessageValue={id:string;role:string;text:string;turnId?:string;itemId?:string;clientUserMessageId?:string;deferredDetail?:boolean;justSent?:boolean;diff?:string;files?:ChatAttachmentRef[];toolName?:string;activity?:any};
export type ChatMessageActions={previewFile?:(file:ChatAttachmentRef)=>void;workflow:(id:string)=>void;run:(id:string)=>void;originalRun:(id:string)=>void;cluster:()=>void;compute:()=>void;quote?:(message:ChatMessageValue)=>void;branch?:(message:ChatMessageValue)=>void;bookmark?:(message:ChatMessageValue,bookmarked:boolean)=>void;detail?:(message:ChatMessageValue)=>void};
export function connectionAction(details:unknown):'cluster'|'compute'|null{if(typeof details!=='string'||details.length>16000)return null;function visit(value:any,depth=0):'cluster'|'compute'|null{if(depth>8||value==null)return null;if(typeof value==='string'){try{return visit(JSON.parse(value),depth+1);}catch{return null;}}if(Array.isArray(value)){for(const item of value.slice(0,64)){const found=visit(item,depth+1);if(found)return found;}return null;}if(typeof value!=='object')return null;if(value.status==='needs_human_auth'||value.code==='needs_human_auth')return 'cluster';if(value.status==='needs_worker_update'||value.code==='needs_worker_update')return 'compute';for(const key of ['content','structuredContent','result','text','data']){const found=visit(value[key],depth+1);if(found)return found;}return null;}return visit(details);}
export function originalRunHint(details:unknown):string|null{if(typeof details!=='string'||details.length>16000)return null;function walk(value:any,depth=0):string|null{if(depth>8||value==null)return null;if(typeof value==='string'){try{return walk(JSON.parse(value),depth+1);}catch{return null;}}if(Array.isArray(value)){for(const item of value.slice(0,64)){const found=walk(item,depth+1);if(found)return found;}return null;}if(typeof value!=='object')return null;if(value.kind==='authenticate_original_run'&&value.code==='needs_human_auth'&&typeof value.runId==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value.runId))return value.runId;for(const key of ['content','structuredContent','result','text','data','connection_action']){const found=walk(value[key],depth+1);if(found)return found;}return null;}return walk(details);}

// Unchanged messages retain their rendered subtree, selection and expanded tool details.
export default memo(function ChatMessage({message:m,actions,disabled,canOriginalRun,canCluster,canCompute,bookmarked=false}:{message:ChatMessageValue;language:string;actions:ChatMessageActions;disabled:boolean;canOriginalRun:boolean;canCluster:boolean;canCompute:boolean;bookmarked?:boolean}){
 const original=originalRunHint(m.activity?.details),connection=connectionAction(m.activity?.details);
 const speech=(m.role==='user'||m.role==='agent')&&!!m.text.trim();
 return <div className={'message '+m.role} data-message-id={m.id} data-turn-id={m.turnId} data-item-id={m.itemId||m.id} data-just-sent={m.justSent||undefined}>
  {m.role==='tool'?<><ToolActivity message={m} onWorkflow={actions.workflow} onRun={actions.run} onExpand={m.deferredDetail&&actions.detail?()=>actions.detail?.(m):undefined}/>{original&&canOriginalRun&&<button className="button" data-testid="agent-open-original-run" disabled={disabled} onClick={()=>actions.originalRun(original)}>{t('打开原作业')}</button>}{!original&&connection==='cluster'&&canCluster&&<button className="button" data-testid="agent-open-cluster" disabled={disabled} onClick={actions.cluster}>{t('打开集群连接')}</button>}{connection==='compute'&&canCompute&&<button className="button" data-testid="agent-open-compute" disabled={disabled} onClick={actions.compute}>{t('核对作业服务更新')}</button>}</>:<><div className="message-role">{tr(m.role==='user'?'你':m.role==='service'?'服务通知':m.role==='plan'?'本轮计划':product.name)}</div><div className="message-text">{(m.role==='agent'||m.role==='plan')?<MessageText text={m.text}/>:m.role==='compaction'?t(m.text):m.text}</div></>}
  {m.files?.length&&actions.previewFile?<ChatFiles files={m.files} preview={actions.previewFile}/>:null}{m.diff&&<pre className="diff-text">{m.diff}</pre>}
  {speech&&(actions.quote||m.turnId&&(actions.branch||actions.bookmark))&&<div className="chat-message-actions">
   {actions.quote&&<button className="text-button" type="button" onClick={()=>actions.quote?.(m)}>{t('引用到草稿')}</button>}
   {m.turnId&&actions.branch&&<button className="text-button" type="button" disabled={m.justSent} onClick={()=>actions.branch?.(m)}>{t('从此轮另开讨论')}</button>}
   {m.turnId&&actions.bookmark&&<button className="text-button" type="button" aria-pressed={bookmarked} onClick={()=>actions.bookmark?.(m,!bookmarked)}>{t(bookmarked?'移除书签':'添加书签')}</button>}
  </div>}
 </div>;
});
