import './agent.css';
import {tr} from './i18n';
import {useEffect,useRef,useState} from 'react';
import {ArrowUp,Square,Plus,Sparkles,Check,Shield,LoaderCircle,Settings2} from 'lucide-react';
import {t} from './i18n';
import ToolActivity from './ToolActivity';
import {toolActivity,visibleUserText} from '../shared/tool-activity.mjs';
import ProviderLogin from './ProviderLogin';
import {explicitNewWorkflow} from '../shared/task-fields.mjs';
import {invoke,type RpcEvent,type AgentProvider,type Conversation,type AgentIntent,type SkillAttachment} from './types';
type ModelCall={requestId:string;provider:AgentProvider;model:string;threadId:string;turnId:string|null;output:boolean;status:string};
type Message={id:string;role:string;text:string;runId?:string;diff?:string;toolName?:string;activity?:any};
export default function Agent({planningMode,onPlanningModeChange,context,onError,skill,width,onOpenRun,intent,projectId,onOpenTask,sessionSelection,onConversation,onBusyChange,onNewConversation,hidden,onProviderChange,onAttachmentConsumed,onAttachmentClear}:{planningMode:boolean;onPlanningModeChange:(value:boolean)=>void;projectId?:string;onOpenTask?:(id:string)=>void;intent?:AgentIntent;width?:number;context:string;onError:(e:unknown)=>void;skill?:SkillAttachment;onProviderChange?:(provider:AgentProvider)=>void;onAttachmentConsumed?:(attachmentId:string)=>void;onAttachmentClear?:()=>void;onOpenRun?:(id:string)=>void;sessionSelection?:{nonce:string;conversation?:Conversation;new?:boolean};onConversation?:(value:Conversation|null)=>void;onBusyChange?:(busy:boolean)=>void;onNewConversation?:()=>void;hidden?:boolean}){
 const providerChangeRef=useRef(onProviderChange);providerChangeRef.current=onProviderChange;
 const attachmentClearRef=useRef(onAttachmentClear);attachmentClearRef.current=onAttachmentClear;
 const attachmentConsumedRef=useRef(onAttachmentConsumed);attachmentConsumedRef.current=onAttachmentConsumed;
 const [autoSkillStatus,setAutoSkillStatus]=useState<any>(null);
 const [tools,setTools]=useState<any>({status:'not_run',count:0});
 const [provider,setProvider]=useState<AgentProvider>('codex'),[login,setLogin]=useState(false);
 useEffect(()=>{providerChangeRef.current?.(provider);},[provider]);
 const [workflowId,setWorkflowId]=useState<string|null>(null),[newWorkflow,setNewWorkflow]=useState(false);
 const conversationRef=useRef(onConversation);conversationRef.current=onConversation;const consumedIntent=useRef(''),selectionSeq=useRef(0),selectionPending=useRef(false),connectionOwner=useRef<symbol|null>(null),providerTouched=useRef(false);
 useEffect(()=>{if(intent&&!intent.autoSend)setPrompt(intent.text);},[intent?.id]);
 const loginRef=useRef(login);loginRef.current=login;
 const providerRef=useRef<AgentProvider>('codex');providerRef.current=provider;
 const projectSeen=useRef(''),accountSeq=useRef(0),externalSeq=useRef(0);
 const [externalThreads,setExternalThreads]=useState<any[]>([]),[importOpen,setImportOpen]=useState(false),[importLoading,setImportLoading]=useState(false);
 const [connected,setConnected]=useState(false),[connecting,setConnecting]=useState(false),[models,setModels]=useState<any[]>([]),[model,setModel]=useState('');
 const [thread,setThread]=useState<string|null>(null),[threads,setThreads]=useState<any[]>([]),[messages,setMessages]=useState<Message[]>([]);
 const [modelCall,setModelCall]=useState<ModelCall|null>(null),modelCallRef=useRef<ModelCall|null>(null),modelRef=useRef(model);modelRef.current=model;
 const [prompt,setPrompt]=useState(''),[busy,setBusy]=useState(false),[turn,setTurn]=useState<string|null>(null),[account,setAccount]=useState<any>(null);
 const [requests,setRequests]=useState<RpcEvent[]>([]),[answers,setAnswers]=useState<Record<string,string>>({});
 const [effort,setEffort]=useState(localStorage.getItem('studio.effort')||''),[contextWindow,setContextWindow]=useState(''),[compactLimit,setCompactLimit]=useState(''),[options,setOptions]=useState(false),[usage,setUsage]=useState<any>(null),[applying,setApplying]=useState(false),[applied,setApplied]=useState('');
 const planningRef=useRef(planningMode);planningRef.current=planningMode;
 const openTaskRef=useRef(onOpenTask);openTaskRef.current=onOpenTask;
 const openRunRef=useRef(onOpenRun);openRunRef.current=onOpenRun;
 const currentModel=models.find(m=>m.model===model),efforts=currentModel?.supportedReasoningEfforts||[];
 useEffect(()=>{if(currentModel&&!efforts.some((e:any)=>e.reasoningEffort===effort))setEffort(currentModel.defaultReasoningEffort||'');},[model,models]);
 useEffect(()=>{onBusyChange?.(busy||connecting||applying);},[busy,connecting,applying]);
 useEffect(()=>{if(!projectId||sessionSelection?.conversation||busy||projectSeen.current===projectId)return;projectSeen.current=projectId;void invoke('state').then(s=>{const preferred=s.settings.projectAgents?.[projectId];if(preferred&&preferred!==providerRef.current)void selectProvider(preferred);}).catch(onError);},[projectId,busy]);
 useEffect(()=>{if(model)localStorage.setItem('studio.model.'+provider,model);if(effort)localStorage.setItem('studio.effort.'+provider,effort);},[model,effort,provider]);
 const scroll=useRef<HTMLDivElement>(null),threadRef=useRef<string|null>(null);threadRef.current=thread;
 const rpc=(method:string,params?:any)=>invoke<any>('agent.rpc',{provider:providerRef.current,method,params});
 useEffect(()=>{
  const initialSeq=selectionSeq.current;void invoke('state').then(state=>{if(initialSeq!==selectionSeq.current||providerTouched.current)return;const selected=state.settings?.agentProvider||'codex';setProvider(selected);providerRef.current=selected;setThreads([]);const a=selected==='codex'?state.settings?.agent||{}:state.settings?.agentProviders?.[selected]||{};setContextWindow(a.contextWindow?.toString()||'');setCompactLimit(a.compactLimit?.toString()||'');setEffort(localStorage.getItem('studio.effort.'+selected)||a.effort||'');}).catch(()=>{});
  return window.studio?.onEvent(event=>{
   if((event.provider||'codex')!==providerRef.current)return;
   if(event.method==='studio/skillsLoaded'){const call=modelCallRef.current,p=event.params||{};if(call&&p.requestId===call.requestId&&p.threadId===call.threadId&&p.threadId===threadRef.current&&(!p.turnId||!call.turnId||p.turnId===call.turnId))setAutoSkillStatus({...p,provider:event.provider||'codex'});return;}
   if(event.method==='studio/conversationContextChanged'){
    const p=event.params,c=p.conversation;if(threadRef.current!==p.oldThreadId)return;
    threadRef.current=c.threadId;setThread(c.threadId);setWorkflowId(p.taskId);setTurn(null);setUsage(null);setRequests([]);setAutoSkillStatus(null);
    setMessages(old=>old.filter(message=>message.role==='user').slice(-1));
    const call=modelCallRef.current;if(call&&call.threadId===p.oldThreadId){call.threadId=c.threadId;call.turnId=null;call.output=false;setModelCall({...call});}
    setThreads(old=>[{...c,id:c.threadId},...old.filter(row=>row.id!==p.oldThreadId&&row.id!==c.threadId)]);conversationRef.current?.(c);return;
   }
   if(event.method==='studio/conversationDeleted'){setThreads(old=>old.filter(t=>t.id!==event.params.threadId));return;}
   if(event.method==='studio/toolsStatus'){setTools(event.params);return;}
   if(event.method==='studio/login'&&event.params?.phase==='completed'&&!loginRef.current)void connect();
   if(event.method==='studio/accountUpdated')void refreshAccount();
   if(event.method==='studio/configUpdated'){const selectedProvider=providerRef.current,seq=selectionSeq.current;void invoke('agent.rpc',{provider:selectedProvider,method:'model/list'}).then(m=>{if(seq===selectionSeq.current&&selectedProvider===providerRef.current)setModels(m.data||[]);}).catch(error=>{if(seq===selectionSeq.current&&selectedProvider===providerRef.current)onError(error);});}
   if(event.method==='studio/taskUpdated'&&event.params?.task?.threadId===threadRef.current)setWorkflowId(event.params.task.id);
   if(event.params?.threadId&&event.params.threadId!==threadRef.current)return;
   if(event.id!==undefined){setRequests(prev=>[...prev.filter(r=>r.id!==event.id),event]);return;}
   const p=event.params||{};
   if(event.method==='serverRequest/resolved')setRequests(prev=>prev.filter(r=>String(r.id)!==String(p.requestId)));
   if(p.threadId && p.threadId!==threadRef.current)return;
   if(event.method==='item/agentMessage/delta'){const call=modelCallRef.current;if(call&&call.provider===providerRef.current&&call.model===modelRef.current&&call.threadId===p.threadId&&call.turnId===p.turnId&&p.delta?.trim())call.output=true;}
   if(event.method==='item/agentMessage/delta')setMessages(prev=>{
    const id=p.itemId||'agent',existing=prev.find(m=>m.id===id);
    return existing?prev.map(m=>m.id===id?{...m,text:m.text+(p.delta||'')}:m):[...prev,{id,role:'agent',text:p.delta||''}];
   });
   if(event.method==='item/started' && p.item && ['mcpToolCall','commandExecution','fileChange'].includes(p.item.type))
    setMessages(prev=>[...prev,{id:p.item.id,role:'tool',text:p.item.tool||p.item.command||'文件变更'}]);
   if(event.method==='item/completed' && p.item?.type==='mcpToolCall'){
    const activity=toolActivity(p.item);setMessages(prev=>{const message={id:p.item.id,role:'tool',toolName:p.item.tool,text:p.item.tool||'工具',activity};return prev.some(m=>m.id===p.item.id)?prev.map(m=>m.id===p.item.id?message:m):[...prev,message];});
   }
   if(event.method==='item/completed' && p.item?.type==='fileChange')setMessages(prev=>prev.map(m=>m.id===p.item.id?{...m,diff:p.item.changes?.map((c:any)=>c.path+'\n'+c.diff).join('\n')}:m));
   if(event.method==='thread/tokenUsage/updated')setUsage(p.tokenUsage);
   if(event.method==='turn/started'){const owner=modelCallRef.current;if(owner?.turnId&&owner.turnId!==p.turn?.id)return;setBusy(true);setTurn(p.turn?.id);const call=modelCallRef.current;if(call&&call.provider===providerRef.current&&call.model===modelRef.current&&call.threadId===p.threadId&&!call.turnId&&typeof p.turn?.id==='string')call.turnId=p.turn.id;}
   if(event.method==='turn/completed'){const call=modelCallRef.current;if(call&&(!call.turnId||call.turnId!==p.turn?.id))return;setBusy(false);setTurn(null);if(call&&call.provider===providerRef.current&&call.model===modelRef.current&&call.threadId===p.threadId&&call.turnId&&call.turnId===p.turn?.id){call.status=p.turn.status==='completed'&&!p.turn.error&&call.output?'passed':'failed';setModelCall({...call});}if(p.turn?.error)onError(p.turn.error.message||p.turn.error);}
   if(event.method==='error'){const call=modelCallRef.current;if(call&&call.threadId===p.threadId&&call.turnId===p.turnId){call.status='failed';setModelCall({...call});}onError(p.error?.message||JSON.stringify(p));}
   if(event.method==='account/updated')void refreshAccount();
   if(event.method==='studio/codexDisconnected'){modelCallRef.current=null;setModelCall(null);setConnected(false);setBusy(false);setTools({status:'blocked',count:0,message:'Agent 连接已断开，请重新连接'});}
  });
 },[]);
 useEffect(()=>{scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:'smooth'});},[messages,requests]);
 async function refreshAccount(selectedProvider=providerRef.current,seq=selectionSeq.current){
  const request=++accountSeq.current,current=()=>request===accountSeq.current&&seq===selectionSeq.current&&selectedProvider===providerRef.current;
  try{const value=await invoke('agent.account',{provider:selectedProvider});if(current())setAccount(value);return value;}
  catch(error){if(current())setAccount({metadataUnavailable:true,modelAccess:'not_run'});return null;}
 }
 async function importExisting(){
  const selectedProvider=providerRef.current,seq=selectionSeq.current,request=++externalSeq.current;setImportOpen(true);setImportLoading(true);
  const current=()=>request===externalSeq.current&&seq===selectionSeq.current&&selectedProvider===providerRef.current;
  try{const result=await invoke('agent.rpc',{provider:selectedProvider,method:'thread/list',params:{limit:20}});if(current())setExternalThreads(result.data||[]);}catch(error){if(current())onError(error);}finally{if(current())setImportLoading(false);}
 }
 async function connect(repairTools=false,seq=selectionSeq.current){
  modelCallRef.current=null;setModelCall(null);
  const selectedProvider=providerRef.current,current=()=>seq===selectionSeq.current&&selectedProvider===providerRef.current;
  const selectedRpc=(method:string,params?:any)=>invoke<any>('agent.rpc',{provider:selectedProvider,method,params});
  const owner=Symbol();connectionOwner.current=owner;providerTouched.current=true;setConnecting(true);try{
   const connection=await invoke('agent.connect',{provider:selectedProvider,repairTools});if(!current())return false;setTools(connection.tools||{status:'not_run',count:0});
   const [a,m,conversations]=await Promise.all([refreshAccount(selectedProvider,seq),selectedRpc('model/list'),invoke<Conversation[]>('conversation.list')]);if(!current())return false;
   const list=m.data||[];setModels(list);setModel(list.find((v:any)=>v.model===localStorage.getItem('studio.model.'+selectedProvider))?.model||list.find((v:any)=>v.isDefault)?.model||list[0]?.model||'');
   setThreads(conversations.filter(value=>value.provider===selectedProvider).map(value=>({...value,id:value.threadId})));setConnected(true);
   return true;
  }catch(e){if(current()){setConnected(false);setModels([]);onError(e);}return false;}finally{if(connectionOwner.current===owner){connectionOwner.current=null;setConnecting(false);}}
 }
 useEffect(()=>{if(!connected)return;let active=true,checking=false;const check=async()=>{if(checking)return;checking=true;try{const result=await invoke('agent.tools',{provider:providerRef.current});if(active)setTools(result);}catch{if(active)setTools({status:'blocked',message:'科学工具连接中断，请重新连接',count:0});}finally{checking=false;}};const timer=setInterval(()=>void check(),15000);return()=>{active=false;clearInterval(timer);};},[connected,provider]);
 function resetConversation(invalidate=true){attachmentClearRef.current?.();modelCallRef.current=null;setModelCall(null);if(invalidate)selectionSeq.current++;setImportOpen(false);setImportLoading(false);externalSeq.current++;selectionPending.current=false;setAutoSkillStatus(null);setPrompt('');setTurn(null);setAnswers({});setThread(null);threadRef.current=null;setMessages([]);setRequests([]);setUsage(null);setWorkflowId(null);setNewWorkflow(false);conversationRef.current?.(null);}
 async function selectProvider(value:AgentProvider,selectedSeq?:number){
  const managed=selectedSeq!==undefined,seq=selectedSeq??++selectionSeq.current;
  if(busy||!managed&&connecting)return false;providerTouched.current=true;
  const old=providerRef.current,current=()=>seq===selectionSeq.current;
  try{await invoke('agent.login.cancel');if(!current())return false;await invoke('agent.disconnect',{provider:old});if(!current())return false;await invoke('settings',{agentProvider:value});if(!current())return false;}catch(e){if(current())onError(e);return false;}
  modelCallRef.current=null;setModelCall(null);providerRef.current=value;setProvider(value);attachmentClearRef.current?.();setAutoSkillStatus(null);setTurn(null);setAnswers({});setTools({status:'not_run',count:0});setConnected(false);setModels([]);setModel('');setThread(null);threadRef.current=null;setThreads([]);setMessages([]);setRequests([]);setUsage(null);setAccount(null);setImportOpen(false);setExternalThreads([]);setImportLoading(false);externalSeq.current++;setOptions(false);setLogin(false);setEffort(localStorage.getItem('studio.effort.'+value)||'');setWorkflowId(null);setNewWorkflow(false);conversationRef.current?.(null);return true;
 }
 async function selectModel(value:string){
  modelCallRef.current=null;setModelCall(null);
  const selectedProvider=providerRef.current,seq=selectionSeq.current,current=()=>seq===selectionSeq.current&&selectedProvider===providerRef.current;
  if(selectedProvider==='codex'){setModel(value);return;}
  setApplying(true);try{const result=await invoke('agent.rpc',{provider:selectedProvider,method:'model/select',params:{model:value}});if(current()){setModel(value);setModels(result.data||[]);}}catch(error){if(current())onError(error);}finally{if(current())setApplying(false);}
 }
 async function resume(id:string,seq=++selectionSeq.current,selectedProject=projectId){
  if(busy)return;attachmentClearRef.current?.();const selectedProvider=providerRef.current,current=()=>seq===selectionSeq.current&&selectedProvider===providerRef.current;
  const selectedRpc=(method:string,params?:any)=>invoke<any>('agent.rpc',{provider:selectedProvider,method,params});
  modelCallRef.current=null;setModelCall(null);selectionPending.current=true;threadRef.current=null;setThread(null);setApplying(true);setRequests([]);setAnswers({});setUsage(null);setAutoSkillStatus(null);setNewWorkflow(false);setTurn(null);
  try{
   const r=await selectedRpc('thread/resume',{threadId:id});if(!current())return;
   if(r.thread?.id!==id)throw Error('恢复的会话与选中会话不匹配');
   const read=await selectedRpc('thread/read',{threadId:id,includeTurns:true});if(!current())return;const list:Message[]=[];
   if(read.thread?.id&&read.thread.id!==id)throw Error('读取的会话与选中会话不匹配');
   for(const turn of read.thread?.turns||[])for(const item of turn.items||[]){
    if(item.type==='agentMessage')list.push({id:item.id,role:'agent',text:item.text||''});
    if(item.type==='mcpToolCall')list.push({id:item.id,role:'tool',text:item.tool||'工具',toolName:item.tool,activity:toolActivity(item)});
    if(item.type==='userMessage')list.push({id:item.id,role:'user',text:visibleUserText(item.content||[])});
   }
   const conversation=await invoke<Conversation>('conversation.remember',{provider:selectedProvider,threadId:id,projectId:selectedProject||null,name:r.thread.name||r.thread.preview||'对话'});if(!current())return;
   setThread(id);threadRef.current=id;setModel(r.model||model);setEffort(r.reasoningEffort||'');setMessages(list);setWorkflowId(conversation.taskId);setThreads(old=>[{id, name:conversation.name},...old.filter(value=>value.id!==id)]);setImportOpen(false);conversationRef.current?.(conversation);
  }catch(e){if(current())onError(e);}finally{if(current()){selectionPending.current=false;setApplying(false);}}
 }
 useEffect(()=>{
  if(!sessionSelection||busy)return;const seq=++selectionSeq.current;
  selectionPending.current=true;threadRef.current=null;setThread(null);setApplying(true);
  const activate=async()=>{try{
   if(busy)return;
   if(sessionSelection.new){resetConversation(false);return;}
   const selected=sessionSelection.conversation;if(!selected)return;
   const different=selected.provider!==providerRef.current;if(different&&!await selectProvider(selected.provider,seq))return;
   if(seq!==selectionSeq.current)return;
   if((!connected||different)&&!await connect(false,seq))return;
   if(seq!==selectionSeq.current)return;await resume(selected.threadId,seq,selected.projectId||'');
  }finally{if(seq===selectionSeq.current){selectionPending.current=false;setApplying(false);}}};void activate();
 },[sessionSelection?.nonce]);
 useEffect(()=>{if(!intent?.autoSend||consumedIntent.current===intent.id||busy||applying||connecting||!connected||!models.length||(intent.threadId&&thread!==intent.threadId)||(intent.provider&&providerRef.current!==intent.provider))return;consumedIntent.current=intent.id;void send(intent.text,{reviewMode:intent.reviewMode,taskId:intent.taskId});},[intent?.id,connected,busy,applying,connecting,thread,models.length]);
 async function send(textOverride?:string,action:{reviewMode?:boolean;taskId?:string}={}){
  const text=textOverride??prompt;if(!text.trim()||busy||applying||connecting||selectionPending.current||!connected||!models.length)return;
  if((planningMode||workflowId||action.reviewMode)&&tools.status==='blocked'){onError(tools.message||'请先修复科学工具连接');return;}
  const attachment=skill;
  if(!textOverride)setPrompt('');setBusy(true);
  try{
   let id=threadRef.current;
   if(!id){const r=await rpc('thread/start',{model:model||undefined});id=r.thread.id;setThread(id);threadRef.current=id;}
   const conversation=await invoke<Conversation>('conversation.remember',{provider:providerRef.current,threadId:id,projectId:projectId||null,name:text});conversationRef.current?.(conversation);setThreads(old=>[{id,name:conversation.name},...old.filter(value=>value.id!==id)]);
   let taskId=action.taskId||conversation.taskId;
   const fresh=newWorkflow||explicitNewWorkflow(text);
   if((planningMode||fresh)&&!action.reviewMode){const task=await invoke('task.create',{workflowVersion:2,planningMode:true,newWorkflow:fresh,threadId:id,provider:providerRef.current,request:text,projectId:conversation.projectId||projectId||null});taskId=task.id;openTaskRef.current?.(task.id);}
   setWorkflowId(taskId||null);setNewWorkflow(false);
   setMessages(prev=>[...prev,{id:crypto.randomUUID(),role:'user',text}]);
   const input:any[]=[{type:'text',text},{type:'text',text:'[Studio workspace context]\n'+context}];if(attachment&&'path' in attachment)input.push({type:'skill',name:attachment.name,path:attachment.path});
   const call:ModelCall={requestId:crypto.randomUUID(),provider:providerRef.current,model:modelRef.current,threadId:id!,turnId:null,output:false,status:'in_progress'};modelCallRef.current=call;setModelCall({...call});
   const r=await rpc('turn/start',{studioTurnRequestId:call.requestId,...attachment&&'functionId' in attachment?{studioSkillId:attachment.functionId}:{},planningMode,reviewMode:!!action.reviewMode,...taskId?{studioTaskId:taskId}:{},threadId:id,input,model:model||undefined,effort:effort||undefined});if(modelCallRef.current===call){if(attachment&&typeof r.turn?.id==='string')attachmentConsumedRef.current?.(attachment.attachmentId);if(call.turnId&&call.turnId!==r.turn.id)call.output=false;call.turnId=r.turn.id;setTurn(r.turn.id);}
  }catch(e){const call=modelCallRef.current;if(call&&call.provider===providerRef.current&&call.model===modelRef.current&&call.threadId===threadRef.current){call.status='failed';setModelCall({...call});}setBusy(false);if(!textOverride)setPrompt(old=>old||text);onError(e);}
 }
 async function applyOptions(){
  modelCallRef.current=null;setModelCall(null);
  setApplying(true);try{
   const preferences={contextWindow:contextWindow?Number(contextWindow):undefined,compactLimit:compactLimit?Number(compactLimit):undefined,effort};
   if(connected){const result=await invoke('agent.configure',{provider:providerRef.current,preferences,threadId:thread,model:model||undefined});if(result.thread){setThread(result.thread.id);threadRef.current=result.thread.id;}setConnected(true);}
   else await invoke('settings',{agent:preferences});
   setUsage(null);setApplied(t('已应用；实际窗口以服务回报为准'));
  }catch(e){onError(e);}finally{setApplying(false);}
 }
 async function respond(request:RpcEvent,result:any){
  try{await invoke('agent.respond',{provider:providerRef.current,id:request.id,result});setRequests(prev=>prev.filter(r=>r.id!==request.id));}catch(e){onError(e);}
 }
 return <aside className="agent-panel" style={{width,display:hidden?'none':undefined}}>
  <div className="panel-heading"><span><Sparkles size={16}/>{tr("科研助手")}</span><div className="agent-header-actions"><button className="icon-button" data-testid="agent-options" title={t("Agent 选项")} aria-label={t("Agent 选项")} aria-expanded={options} aria-controls="agent-options-content" onClick={()=>setOptions(!options)}><Settings2 size={16}/></button>{!onNewConversation&&<button className="icon-button" data-testid="agent-new-conversation-fallback" title={tr("新会话")} aria-label={tr("新会话")} onClick={()=>resetConversation()} disabled={busy||connecting||applying}><Plus size={17}/></button>}</div></div>
  <div className="agent-configuration" data-testid="agent-configuration">
   <div className="agent-primary">
    <div className="agent-provider"><label>{t("服务商")}<select data-testid="agent-provider" value={provider} disabled={busy||connecting||applying} onChange={e=>void selectProvider(e.target.value as AgentProvider)}><option value="codex">Codex</option><option value="kimi">Kimi</option><option value="qwen">Qwen</option><option value="deepseek">DeepSeek API</option></select></label>{!connected&&<button className="button" disabled={busy||connecting||applying} onClick={()=>setLogin(true)}>{t("登录 / 账户")}</button>}</div>
    {connected?<div className="agent-model-controls"><label className="agent-model-field">{t("模型")}<select data-testid="agent-model" value={model} disabled={busy||applying} onChange={e=>void selectModel(e.target.value)}>{!models.length&&<option value="">{t("登录后加载模型目录")}</option>}{models.map(m=><option key={m.id} value={m.model}>{m.displayName||m.model}</option>)}</select></label><label className="agent-effort-field">{provider==='codex'?'Effort':t('思考设置')}<select data-testid="agent-effort" value={effort} disabled={!connected||busy||applying} onChange={e=>setEffort(e.target.value)}>{!efforts.length&&<option value="">{t('模型默认')}</option>}{efforts.map((e:any)=><option key={e.reasoningEffort} value={e.reasoningEffort}>{provider==='deepseek'?t(e.reasoningEffort==='none'?'快速 · 关闭思考':e.reasoningEffort==='low'?'思考 · 低':e.reasoningEffort==='high'?'思考 · 高':'思考 · 最大'):e.reasoningEffort}</option>)}</select></label></div>:<button className="button wide" data-testid="agent-connect" onClick={()=>void connect()} disabled={connecting}>{connecting?<LoaderCircle className="spin" size={15}/>:<Sparkles size={15}/>}{t("连接")} {provider==='codex'?'Codex':provider==='kimi'?'Kimi':provider==='deepseek'?'DeepSeek API':'Qwen'}</button>}
   </div>
   {tools.status==='blocked'&&<div className="agent-tool-alert" role="status"><span>{t('科学工具未就绪')}</span><button className="text-button" data-testid="agent-tool-repair" disabled={busy||connecting} onClick={()=>void connect(true)}>{t('修复工具连接')}</button></div>}
   {options&&<div className="agent-options-content" id="agent-options-content" role="region" aria-label={t("Agent 选项")}>
    <section className="agent-option-section"><div className="agent-option-heading"><h4>{t('账户与连接')}</h4>{connected&&<button className="text-button" disabled={busy||connecting||applying} onClick={()=>setLogin(true)}>{t("登录 / 账户")}</button>}</div>{connected?<div className="provider-account" data-testid="provider-access"><span>{t(modelCall?.status==='passed'&&modelCall.provider===provider&&modelCall.model===model&&modelCall.threadId===thread?'当前模型调用已验证':modelCall?.status==='failed'?'当前模型调用未通过':'当前模型调用尚未验证')}</span>{account?.modelAccess==='passed'&&<small>{t('此服务商曾成功回复')}</small>}<small>{t(account?.account?'账户信息可用':account?.credentialStored?'已保存凭据':'账户信息未返回')}</small><small>{t('会话已连接')}</small></div>:<p className="muted">{t('连接服务商后开始协作…')}</p>}</section>
    <section className="agent-option-section"><h4>{t('上下文设置')}</h4><div className="context-usage">{usage?t("上下文")+" "+(usage.last?.totalTokens?.toLocaleString()||t("未知"))+" / "+(usage.modelContextWindow?.toLocaleString()||t("未知"))+" tokens":t("上下文用量：等待服务回报")}</div>{provider==='codex'?<div className="context-options"><label>{t('上下文预算 · tokens')}<input type="number" min={1024} placeholder={t('模型默认')} value={contextWindow} disabled={busy||applying} onChange={e=>{setContextWindow(e.target.value);setApplied('');}}/></label><label>{t('自动压缩阈值 · tokens')}<input type="number" min={1024} placeholder={t('模型默认')} value={compactLimit} disabled={busy||applying} onChange={e=>{setCompactLimit(e.target.value);setApplied('');}}/></label><small>{t('预算不会扩大模型本身的最大容量。应用后恢复当前会话，计算作业继续运行。')}</small><button className="button" data-testid="agent-context-apply" disabled={busy||applying} onClick={()=>void applyOptions()}>{tr(applying?t('应用中…'):t('应用上下文设置'))}</button>{applied&&<small role="status">{applied}</small>}</div>:<p className="muted">{t('此提供方通过协议回报上下文，暂不支持修改预算')}</p>}</section>
    {workflowId&&<section className="agent-option-section"><h4>{t('计算流程')}</h4><button className="button" data-testid="agent-new-workflow" disabled={busy||applying} onClick={()=>setNewWorkflow(v=>!v)}>{t(newWorkflow?'取消新建流程':'新建流程')}</button>{!newWorkflow&&<small>{t('此对话已绑定流程，可直接用自然语言调整')}</small>}</section>}
    {connected&&<section className="agent-option-section external-session-import"><button className="text-button" data-testid="agent-import-existing" disabled={busy||applying||connecting||importLoading} onClick={()=>importOpen?setImportOpen(false):void importExisting()}>{t(importOpen?'收起会话导入':'导入已有 Agent 会话')}</button>{importOpen&&<div>{importLoading?<small>{t('读取会话目录中…')}</small>:<><small>{t('仅导入选中的会话，不修改外部记录。')}</small><select aria-label={t('选择外部会话导入')} value="" disabled={busy||applying} onChange={e=>{if(e.target.value)void resume(e.target.value);}}><option value="">{t('请选择')}</option>{externalThreads.filter(value=>!threads.some(known=>known.id===value.id)).map(value=><option key={value.id} value={value.id}>{value.name||value.preview?.slice(0,48)||value.id.slice(0,12)}</option>)}</select></>}</div>}</section>}
    <section className="agent-option-section"><h4>{t('科学工具连接')}</h4><div className="agent-tools-status" data-testid="agent-tools-status" data-status={tools.status}><span><i className={'flow-dot '+(tools.status==='ready'?'ready':'missing')}/>{t(tools.status==='ready'?'科学工具已就绪':tools.status==='blocked'?'科学工具未就绪':'科学工具待连接')}{tools.status==='ready'&&' · '+tools.count}</span>{tools.status==='blocked'&&<small>{tools.message}</small>}</div></section>
   </div>}
  </div>
  <div className="chat-scroll" ref={scroll} role="log">
   {!messages.length&&<div className="agent-welcome"><div className="agent-orb"><Sparkles size={24}/></div><h3>{tr("让想法进入计算")}</h3><p>{tr("定义实验、准备输入、运行计算，")}<br/>{tr("然后一起检查结果。")}</p><div className="prompt-hints">{['检查我的计算环境','帮我设计一个 pyGAS bias','分析选中任务的运行日志'].map(t=><button key={t} onClick={()=>setPrompt(t)}>{tr(t)}<ArrowUp size={13}/></button>)}</div><small>{tr("科学参数会显式记录；作业状态来自真实进程。")}</small></div>}
   {messages.map(m=><div key={m.id} className={'message '+m.role}>{m.role==='tool'?<ToolActivity message={m} onWorkflow={onOpenTask} onRun={onOpenRun}/>:<><div className="message-role">{tr(m.role==='user'?'你':'GPU Sampling Studio')}</div><div className="message-text">{m.text}</div></>}{m.runId&&<button className="tool-card" onClick={()=>onOpenRun?.(m.runId!)}>{tr("打开计算记录 ·")}{m.runId.slice(0,12)}</button>}{m.diff&&<pre className="diff-text">{m.diff}</pre>}</div>)}
   {requests.map(r=><div key={String(r.id)} className="approval" role="alert"><div><Shield size={15}/>{tr("需要你的决定")}</div><p>{r.params?.reason||r.params?.message||r.method}</p>{r.params?.command&&<pre>{r.params.command}</pre>}
    {r.params?.questions?.map((q:any)=><label key={q.id}>{q.question||q.header}<input placeholder={tr("填写回答，或输入选项名称")} value={answers[q.id]||''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}/><small>{q.options?.map((o:any)=>o.label).join(' / ')}</small></label>)}
    {r.method==='studio/question'?<div className="button-row">{r.params.questionOptions?.map((o:any)=><button className="button" key={o.optionId} onClick={()=>void respond(r,{optionId:o.optionId})}>{o.name}</button>)}<button className="button" onClick={()=>void respond(r,{})}>{t('取消')}</button></div>:r.method==='item/tool/requestUserInput'&&r.params?.questions?<button className="button primary" onClick={()=>void respond(r,{answers:Object.fromEntries(r.params.questions.map((q:any)=>[q.id,{answers:[answers[q.id]||'']}]))})}>{tr("提交回答")}</button>:
     r.method==='mcpServer/elicitation/request'?<><textarea placeholder="JSON content" value={answers[String(r.id)]||'{}'} onChange={e=>setAnswers({...answers,[String(r.id)]:e.target.value})}/><div className="button-row"><button className="button primary" onClick={()=>{try{void respond(r,{action:'accept',content:JSON.parse(answers[String(r.id)]||'{}')});}catch(e){onError(e);}}}>{tr("接受")}</button><button className="button" onClick={()=>void respond(r,{action:'decline',content:null})}>{tr("拒绝")}</button></div></>:
     r.method==='item/permissions/requestApproval'?<><pre>{JSON.stringify(r.params?.permissions,null,2)}</pre><div className="button-row"><button className="button primary" onClick={()=>void respond(r,{permissions:r.params?.permissions,scope:"turn"})}>{tr("本轮允许所示权限")}</button><button className="button" onClick={()=>void respond(r,{permissions:{},scope:"turn"})}>{tr("拒绝权限请求")}</button></div></>:
     ['item/commandExecution/requestApproval','item/fileChange/requestApproval','execCommandApproval','applyPatchApproval'].includes(r.method)?<div className="button-row"><button className="button primary" onClick={()=>void respond(r,{decision:'accept'})}>{tr("允许一次")}</button><button className="button" onClick={()=>void respond(r,{decision:'acceptForSession'})}>{tr("会话内允许")}</button><button className="button" onClick={()=>void respond(r,{decision:'decline'})}>{tr("拒绝")}</button></div>:
     <div className="button-row"><button className="button" onClick={()=>void respond(r,{decision:'decline'})}>{tr("拒绝")}</button></div>}
   </div>)}
   {busy&&<div className="thinking"><LoaderCircle size={14} className="spin"/>{tr("Agent 正在工作")}</div>}
  </div>
  {autoSkillStatus&&autoSkillStatus.threadId===thread&&autoSkillStatus.provider===provider&&<details className="agent-auto-skills"><summary>{t(autoSkillStatus.status==='passed'?'本轮已载入任务指导':autoSkillStatus.status==='already_loaded'?'当前会话已有相同指导':autoSkillStatus.status==='permission_required'?'需要公开指导共享许可':autoSkillStatus.status==='prepared'?'指导已准备，等待服务接受':autoSkillStatus.status==='failed'?'指导发送未通过':autoSkillStatus.status==='unknown'?'指导接收状态未知':autoSkillStatus.status==='not_run'?'本轮未载入任务指导':'任务指导暂不可用')} · {(autoSkillStatus.names||[]).length}</summary>{(autoSkillStatus.names||[]).map((name:string)=><div key={name}>{name}</div>)}{autoSkillStatus.source&&<p>{autoSkillStatus.source}</p>}{autoSkillStatus.attachments?.map((a:any)=><p className="skill-loaded-file" key={a.name+a.sha256}>{a.name}<small>SHA256 · {a.sha256} · {a.bytes} bytes</small></p>)}{autoSkillStatus.message&&<p>{autoSkillStatus.message}</p>}</details>}
  <div className="composer"><div className="agent-compose-context"><label className="agent-mode-toggle"><input data-testid="agent-planning-mode" type="checkbox" checked={planningMode} disabled={busy||connecting||applying} onChange={e=>onPlanningModeChange(e.target.checked)}/>{t('任务规划模式')}</label>{workflowId&&<button className="text-button" data-testid="agent-current-workflow" disabled={busy||applying} onClick={()=>openTaskRef.current?.(workflowId)}>{t('打开当前流程')}</button>}</div>{(workflowId||planningMode||newWorkflow)&&<small className="agent-mode-help">{t(newWorkflow?'下条消息将新建流程；原流程保留。':workflowId?'此对话已绑定流程，可直接用自然语言调整':'生成计算流程和参数，等待审阅执行')}</small>}{skill&&<div className="skill-chip"><span>{t('仅下条消息')} · {skill.name}</span><button type="button" aria-label={t('移除本条消息技能')} onClick={()=>attachmentClearRef.current?.()}>×</button></div>}<textarea aria-busy={applying||connecting} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={t(connected?'描述计算目标，或询问选中任务…':'连接服务商后开始协作…')} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();void send();}}}/><div className="composer-bottom"><span>{t('Enter 发送 · Shift+Enter 换行')}</span>{busy?<button className="send" title={tr("中断 Agent，计算作业继续")} aria-label={tr("中断 Agent，计算作业继续")} onClick={()=>void rpc('turn/interrupt',{threadId:thread,turnId:turn}).catch(onError)}><Square size={13}/></button>:<button className="send" aria-label={tr("发送")} onClick={()=>void send()} disabled={applying||connecting||!connected||!models.length||!prompt.trim()}><ArrowUp size={17}/></button>}</div></div>
  <div className="agent-footer">{tr("Agent 会话与科学计算队列独立运行")}</div>
  {login&&<ProviderLogin projectId={projectId} provider={provider} onClose={()=>setLogin(false)} onConfigured={()=>{setLogin(false);void connect();}} onError={onError}/>}
 </aside>;
}
