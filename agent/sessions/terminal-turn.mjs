import {SHARED_TERMINAL_CHAT_INSTRUCTIONS} from "../context/agent-settings.mjs";
import {interactionFlags,interactionModeContext} from '../context/interaction-mode.mjs';

/** An offline terminal turn sends the user's message, never automatic workflow files. */
export function terminalOnlyTurn(params,{provider,resource}={}){
 const flags=interactionFlags(params);
 if(params.reviewMode===true)throw Error('请先连接此流程的作业服务，再复核计算输入。');
 const first=params.input?.[0];
 if(first?.type!=='text'||typeof first.text!=='string'||!first.text.trim())throw Error('A terminal message is required');
 const {planningMode,reviewMode,studioTaskId,studioToolContext,input,...rest}=params;
 const selected=resource?.kind==='ssh-connection'?' The selected compute resource is an authenticated SSH connection. Use only its independently verified and explicitly handed-off shell. Service use is separate and is unavailable or not granted in this turn; do not infer that the shell or base connection failed. Do not stop or reconnect the service, acquire another terminal, or repeat authentication.':resource?.kind==='ssh-terminal'?' This selected terminal belongs to the legacy connection format and requires explicit human login before Agent use.':' The scientific worker is disconnected. Use only this handed-off terminal; do not ask for a second share or require a registered cluster.';
 return {...rest,input:[{type:'text',text:first.text},{type:'text',text:interactionModeContext({...flags,scope:'terminal'})+'\n[Studio shared terminal context]\n'+SHARED_TERMINAL_CHAT_INSTRUCTIONS+selected+' Workflow files and scientific tools are unavailable in this turn.'}],...['deepseek','compatible'].includes(provider)?{studioToolContext:{mode:'chat'}}:{}};
}
