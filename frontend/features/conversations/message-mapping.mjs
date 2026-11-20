import {visibleUserText} from '../../../contracts/agent/user-message.mjs';
import {toolActivity} from './tool-activity.mjs';

// Both replay and live events use the same item projection. Completion events can
// arrive without a start event, and replace the same item rather than adding it.
export function messageForItem(item){
 if(!item||typeof item.id!=='string')return null;
 if(item.type==='userMessage')return {id:item.id,role:'user',text:visibleUserText(item.content||[])};
 if(item.type==='serviceMessage')return {id:item.id,role:'service',text:item.text||''};
 if(item.type==='agentMessage')return {id:item.id,role:'agent',text:item.text||''};
 if(item.type==='mcpToolCall')return {id:item.id,role:'tool',text:item.tool||'工具',toolName:item.tool,activity:toolActivity(item)};
 if(item.type==='webSearch'){
  const action=item.action||{},state=item.error||item.status==='failed'?'failed':item.status==='inProgress'?'running':'completed';
  const details=[item.query,action.query,...(Array.isArray(action.queries)?action.queries:[]),action.url,action.pattern].filter(value=>typeof value==='string'&&value);
  return {id:item.id,role:'tool',text:'网页检索',toolName:'webSearch',activity:{state,summary:'网页检索',details:[...new Set(details)].join('\n')}};
 }
 if(item.type==='commandExecution'){
  const failed=item.status==='failed'||item.error!=null||Number.isInteger(item.exitCode)&&item.exitCode!==0;
  const state=failed?'failed':item.status==='completed'?'completed':'running';
  const details=[item.command,item.cwd&&'cwd: '+item.cwd,item.aggregatedOutput||item.output,Number.isInteger(item.exitCode)&&'exit: '+item.exitCode,item.error&&JSON.stringify(item.error)].filter(value=>value!==undefined&&value!==false&&value!==null&&value!=='').join('\n');
  return {id:item.id,role:'tool',text:item.command||'执行命令',toolName:'commandExecution',activity:{state,summary:state==='failed'?'命令执行失败':state==='completed'?'命令执行完成':'正在执行命令',details}};
 }
 if(item.type==='fileChange'){
  const changes=Array.isArray(item.changes)?item.changes:[],state=item.status==='failed'||item.error?'failed':item.status==='completed'?'completed':'running';
  return {id:item.id,role:'tool',text:'文件变更',toolName:'fileChange',activity:{state,summary:state==='failed'?'文件修改失败':state==='completed'?'文件修改完成':'正在修改文件',details:changes.map(change=>[change.kind?.type||change.kind,change.path,change.diff].filter(value=>typeof value==='string'&&value).join('\n')).join('\n\n')||JSON.stringify(item.error||{},null,2)}};
 }
 return null;
}

export function upsertItemMessage(messages,item){
 const message=messageForItem(item);if(!message)return messages;
 return messages.some(value=>value.id===message.id)?messages.map(value=>value.id===message.id?message:value):[...messages,message];
}

export function replayMessages(turns=[]){const messages=[],indices=new Map();for(const turn of turns)for(const item of turn.items||[]){const message=messageForItem(item);if(!message)continue;const index=indices.get(message.id);if(index===undefined){indices.set(message.id,messages.length);messages.push(message);}else messages[index]=message;}return messages;}
