import ChatMessage,{type ChatMessageValue,type ChatMessageActions} from './ChatMessage';
import {t} from '../../ui/i18n';
import {toolLabel} from './tool-activity.mjs';

type Props={messages:ChatMessageValue[];language:string;actions:ChatMessageActions;disabled:boolean;canOriginalRun:boolean;canCluster:boolean;canCompute:boolean};

export default function ConversationMessages({messages,...props}:Props){
 const groups:ChatMessageValue[][]=[];
 for(const message of messages){
  // Tool-only provider responses can include an empty assistant item. Keep its
  // position in the transcript for later deltas, but group only visible rows.
  if(message.role==='agent'&&!message.text.trim()&&!message.diff?.trim())continue;
  const previous=groups.at(-1);
  if(message.role==='tool'&&previous?.[0].role==='tool')previous.push(message);
  else groups.push([message]);
 }
 return <>{groups.map(group=>group[0].role==='tool'
  ?<ToolGroup key={group[0].id} messages={group} {...props}/>
  :<ChatMessage key={group[0].id} message={group[0]} {...props}/>
 )}</>;
}

const sharedTerminalTools=new Set(['list_shared_terminals','read_shared_terminal','write_shared_terminal']);
const states=[['running','处理中'],['failed','失败'],['unknown','待核对'],['blocked','待补充'],['completed','已完成']];
function toolName(message:ChatMessageValue){return message.toolName||message.text.split('\n',1)[0];}

function ToolGroup({messages,...props}:Props){
 const first=messages[0],counts=new Map<string,number>();
 for(const message of messages){
  const state=message.activity?.state||'running';
  counts.set(state,(counts.get(state)||0)+1);
 }
 const allTerminal=messages.every(message=>sharedTerminalTools.has(toolName(message).replace(/^mcp__gpusampling__/,'')));
 const label=messages.length===1?t(toolLabel(toolName(first))):`${t(allTerminal?'共享终端调用':'工具调用')} · ${messages.length}`;
 const status=states.filter(([state])=>counts.has(state)).map(([state,label])=>`${t(label)} ${counts.get(state)}`).join(' · ');
 return <details className="tool-group" data-testid="tool-group">
  <summary data-message-id={`tool-group:${first.id}`} title={status}>
   <span className="tool-group-label">{label}</span><span className="tool-group-status">{status}</span>
  </summary>
  <div className="tool-group-content">{messages.map(message=><ChatMessage key={message.id} message={message} {...props}/>)}</div>
 </details>;
}
