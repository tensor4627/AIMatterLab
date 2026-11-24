import ChatMessage,{connectionAction,originalRunHint,type ChatMessageValue,type ChatMessageActions} from './ChatMessage';
import {memo} from 'react';
import type {ConversationBookmark} from '../../../contracts/dto/conversation-history';
import {ChevronRight,Wrench} from 'lucide-react';
import {t} from '../../ui/i18n';
import {toolLabel} from './tool-activity.mjs';
import {messageKey} from './message-mapping.mjs';
const bookmarkKey=(message:{turnId?:string;itemId?:string})=>JSON.stringify([message.turnId,message.itemId]);

type Props={messages:ChatMessageValue[];language:string;actions:ChatMessageActions;disabled:boolean;canOriginalRun:boolean;canCluster:boolean;canCompute:boolean;bookmarked?:ReadonlySet<string>;toolGroupOpen?:Record<string,boolean>;onToolGroupToggle?:(key:string,open:boolean)=>void};

export default memo(function ConversationMessages({messages,bookmarks,...props}:Omit<Props,'bookmarked'>&{bookmarks?:ConversationBookmark[]}){
 const bookmarked=bookmarks&&new Set(bookmarks.map(bookmarkKey));
 const groups:ChatMessageValue[][]=[];
 for(const message of messages){
  // Tool-only provider responses can include an empty assistant item. Keep its
  // position in the transcript for later deltas, but group only visible rows.
  if(message.role==='agent'&&!message.text.trim()&&!message.diff?.trim())continue;
  const previous=groups.at(-1);
  if(message.role==='tool'&&previous?.[0].role==='tool'&&previous?.[0].turnId===message.turnId)previous.push(message);
  else groups.push([message]);
 }
 return <>{groups.map(group=>group[0].role==='tool'
  ?<ToolGroup key={messageKey(group[0])} messages={group} {...props} bookmarked={bookmarked}/>
  :<ChatMessage key={messageKey(group[0])} message={group[0]} {...props} bookmarked={bookmarked?.has(bookmarkKey(group[0]))}/>
 )}</>;
});

const sharedTerminalTools=new Set(['list_shared_terminals','read_shared_terminal','write_shared_terminal']);
const states=[['running','处理中'],['failed','失败'],['unknown','待核对'],['blocked','待补充'],['completed','已完成']];
function toolName(message:ChatMessageValue){return message.toolName||message.text.split('\n',1)[0];}
type HoistedAction={key:string;label:string;disabled?:boolean;onClick:()=>void;testId?:string};

function hoistedGroupActions(messages:ChatMessageValue[],props:Omit<Props,'messages'>):HoistedAction[]{
 const seen=new Set<string>(),items:HoistedAction[]=[];
 const push=(action:HoistedAction)=>{if(seen.has(action.key))return;seen.add(action.key);items.push(action);};
 for(const message of messages){
  const artifact=message.activity?.artifact;
  if(artifact?.kind==='task-parameters'&&artifact.id)push({key:'workflow:'+artifact.id,label:t('打开计算流程'),onClick:()=>props.actions.workflow(artifact.id),testId:'tool-group-open-workflow'});
  else if(artifact?.engine&&artifact.id)push({key:'run:'+artifact.id,label:t('打开模块草稿'),onClick:()=>props.actions.run(artifact.id),testId:'tool-group-open-run'});
  const original=originalRunHint(message.activity?.details),connection=connectionAction(message.activity?.details);
  if(original&&props.canOriginalRun)push({key:'orig:'+original,label:t('打开原作业'),disabled:props.disabled,onClick:()=>props.actions.originalRun(original),testId:'tool-group-open-original-run'});
  else if(!original&&connection==='cluster'&&props.canCluster)push({key:'cluster',label:t('打开集群连接'),disabled:props.disabled,onClick:props.actions.cluster,testId:'tool-group-open-cluster'});
  if(connection==='compute'&&props.canCompute)push({key:'compute',label:t('核对作业服务更新'),disabled:props.disabled,onClick:props.actions.compute,testId:'tool-group-open-compute'});
 }
 return items;
}

function ToolGroup({messages,toolGroupOpen,onToolGroupToggle,...props}:Props){
 const first=messages[0],groupKey=messageKey(first),counts=new Map<string,number>();
 for(const message of messages){
  const state=message.activity?.state||'running';
  counts.set(state,(counts.get(state)||0)+1);
 }
 const allTerminal=messages.every(message=>sharedTerminalTools.has(toolName(message).replace(/^mcp__gpusampling__/,'')));
 const label=messages.length===1?t(toolLabel(toolName(first))):`${t(allTerminal?'共享终端调用':'工具调用')} · ${messages.length}`;
 const status=states.filter(([state])=>counts.has(state)).map(([state,label])=>`${t(label)} ${counts.get(state)}`).join(' · ');
 const severity=counts.has('failed')?'error':counts.has('unknown')||counts.has('blocked')?'warning':undefined;
 const override=toolGroupOpen?.[groupKey];
 const open=override!==undefined?override:(severity?true:undefined);
 const hoisted=!open?hoistedGroupActions(messages,props):[];
 return <div className="tool-group-block">
  <details className="tool-group" data-testid="tool-group" data-severity={severity} open={open} onToggle={event=>{const next=event.currentTarget.open;if(next!==Boolean(open))onToolGroupToggle?.(groupKey,next);}}>
   <summary data-message-id={`tool-group:${first.id}`} data-turn-id={first.turnId} title={status}>
    <ChevronRight className="tool-group-chevron" size={14} aria-hidden="true"/>
    <span className="tool-group-copy">
     <span className="tool-group-label"><Wrench size={14} aria-hidden="true"/><span>{label}</span></span>
     <span className="tool-group-status">{status}</span>
    </span>
   </summary>
   <div className="tool-group-content">{messages.map(message=><ChatMessage key={messageKey(message)} message={message} {...props} bookmarked={props.bookmarked?.has(bookmarkKey(message))}/>)}</div>
  </details>
  {hoisted.length>0&&<div className="tool-group-actions" data-testid="tool-group-actions">{hoisted.map(action=><button key={action.key} type="button" className="button" data-testid={action.testId} disabled={action.disabled} onClick={action.onClick}>{action.label}</button>)}</div>}
 </div>;
}
