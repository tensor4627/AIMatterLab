import Tooltip from "../../ui/Tooltip";
import {providerAccountState,authenticationError} from "./provider-account.mjs";
import {ACCOUNT_GUIDANCE} from "../../../contracts/agent/provider-account.mjs";

import './agent.css';
import './codex-version-notice.css';
import {tr} from "../../ui/i18n";
import {useEffect,useRef,useState} from 'react';
import {ArrowUp,Square,Plus,Sparkles,Check,Shield,LoaderCircle,Settings2,History,PanelRightClose} from 'lucide-react';
import {t} from "../../ui/i18n";
import {type ChatMessageActions} from './ChatMessage';
import ConversationMessages from './ConversationMessages';
import {resumedEffort} from "./resume-effort.mjs";

import {upsertItemMessage,replayMessages} from './message-mapping.mjs';
import {createReadingPositions,readingKey} from './reading-position.mjs';
import {elicitationHasEditableInput} from './elicitation-input.mjs';

import ProviderLogin from "../settings/ProviderLogin";
import LoadingFeedback from "../../ui/LoadingFeedback";
import type {AgentConnectResult} from "../../../contracts/dto/agent";
import {explicitNewWorkflow} from "./workflow-intent.mjs";

import {createComposerDrafts} from "./composer-drafts.mjs";
import type {SessionSelection} from './useConversationSelection';

import type {ComputeResourceState} from '../../../contracts/dto/compute';
import {invoke} from '../../api/studio';
import {recoverConversation} from '../../api/agent';
import {type RpcEvent,type AgentProvider,type Conversation} from '../../../contracts/dto/agent';
import {type AgentIntent,type SkillAttachment} from './agent-types';
type ModelCall={requestId:string;provider:AgentProvider;model:string;threadId:string;turnId:string|null;output:boolean;status:string};
type Message={id:string;role:string;text:string;diff?:string;toolName?:string;activity?:any};
type DraftSnapshot=ReturnType<ReturnType<typeof createComposerDrafts>['capture']>;
type SendFlight={provider:AgentProvider;threadId:string|null;turnId:string|null;phase:'preparing'|'submitted';cancelled:boolean;interrupting:boolean;interruptSent:boolean;current:()=>boolean;draft:DraftSnapshot;restoreDraft?:DraftSnapshot;text:string};
type HistoryLoad={provider:AgentProvider;threadId:string;projectId?:string;status:'loading'|'failed';error?:string};
type CodexVersionWarning={installedVersion:string;baselineVersion:string};
const versionNoticeStorageKey='studio.codexVersionNotice.shown';
const versionNoticeSessions=new WeakSet<Storage>();
let inaccessibleStorageNoticeShown=false;
function claimVersionNotice(){
 let storage:Storage;try{storage=localStorage;}catch{if(inaccessibleStorageNoticeShown)return false;inaccessibleStorageNoticeShown=true;return true;}
 if(versionNoticeSessions.has(storage))return false;
 try{if(storage.getItem(versionNoticeStorageKey)==='1')return false;}catch{/* Keep the notice once per renderer when storage is unavailable. */}
 versionNoticeSessions.add(storage);
 try{storage.setItem(versionNoticeStorageKey,'1');}catch{/* A warning must never prevent connection. */}
 return true;
}
function codexVersionWarning(value:any):CodexVersionWarning|null {const version=(text:unknown)=>typeof text==='string'&&text.length<=128&&/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(text);return value?.baselineMatch===false&&value?.versionWarning?.code==='STUDIO_CODEX_VERSION_DIFFERENCE'&&version(value.installedVersion)&&version(value.baselineVersion)?{installedVersion:value.installedVersion,baselineVersion:value.baselineVersion}:null;}
function storedPreference(key:string){try{return localStorage.getItem(key);}catch{return null;}}
function storePreference(key:string,value:string){try{localStorage.setItem(key,value);}catch{/* Storage is optional for chat. */}}
function sshResourceReady(resource:ComputeResourceState|null|undefined,tools:any){
 if(resource?.kind==='ssh-connection'){
  if(resource.schemaVersion!==2||resource.status!=='selected'||resource.alive!==true||resource.authentication!=='verified'||tools.status!=='ready')return false;
  return tools.scope==='terminal-only'?resource.capabilities?.terminal.status==='ready'&&resource.capabilities.terminal.agentReady===true:resource.capabilities?.service.status==='connected'&&resource.capabilities.service.workflowReady===true&&resource.capabilities.service.agentReady===true;
 }
 if(resource?.kind!=='ssh-terminal'||resource.status!=='selected'||resource.alive!==true||resource.agentReady!==true||tools.status!=='ready')return false;
 const workflow=resource.workflowReady===true&&resource.managedRuns===true&&resource.authentication==='verified';
 return workflow?tools.scope!=='terminal-only':tools.scope==='terminal-only';
}
export default function Agent({onOpenHistory,onCollapse,conversationGroupId,onOpenAccounts,planningMode,onPlanningModeChange,context,onError,skill,width,onOpenRun,intent,projectId,onOpenTask,sessionSelection,onConversation,onBusyChange,onNewConversation,hidden,visibleWorkflowId,onProviderChange,onAttachmentConsumed,onAttachmentClear,computeConnected,onConnectCompute,onReviewWorker,onOpenCluster,onOpenOriginalRun,computeResource,onComputeResource}:{onComputeResource?:(state:ComputeResourceState)=>void;onOpenHistory?:()=>void;onCollapse?:()=>void;computeResource?:ComputeResourceState|null;onOpenOriginalRun?:(runId:string)=>void;onOpenCluster?:()=>void;computeConnected?:boolean;onConnectCompute?:()=>void|Promise<void>;onReviewWorker?:()=>void|Promise<void>;conversationGroupId?:string|null;onOpenAccounts?:(provider:AgentProvider)=>void;planningMode:boolean;onPlanningModeChange:(value:boolean)=>void;projectId?:string;onOpenTask?:(id:string)=>void;intent?:AgentIntent;width?:number;context:string;onError:(e:unknown)=>void;skill?:SkillAttachment;onProviderChange?:(provider:AgentProvider)=>void;onAttachmentConsumed?:(attachmentId:string)=>void;onAttachmentClear?:()=>void;onOpenRun?:(id:string)=>void;sessionSelection?:SessionSelection;onConversation?:(value:Conversation|null,selectionNonce?:string)=>void;onBusyChange?:(busy:boolean)=>void;onNewConversation?:()=>void;hidden?:boolean;visibleWorkflowId?:string|null}){
 const draftsRef=useRef<ReturnType<typeof createComposerDrafts>|null>(null);if(!draftsRef.current){draftsRef.current=createComposerDrafts(()=>localStorage);const selected=sessionSelection?.conversation;if(selected)draftsRef.current.activate(selected.provider,selected.threadId);else if(sessionSelection?.new)draftsRef.current.activate(draftsRef.current.owner().provider,null,true);}const drafts=draftsRef.current;
 const [needsAuth,setNeedsAuth]=useState(false);
 function openAccounts(){if(onOpenAccounts)onOpenAccounts(providerRef.current);else setLogin(true);}
 const providerChangeRef=useRef(onProviderChange);providerChangeRef.current=onProviderChange;
 const attachmentClearRef=useRef(onAttachmentClear);attachmentClearRef.current=onAttachmentClear;
 const attachmentConsumedRef=useRef(onAttachmentConsumed);attachmentConsumedRef.current=onAttachmentConsumed;
 const [autoSkillStatus,setAutoSkillStatus]=useState<any>(null);
 const [tools,setTools]=useState<any>({status:'not_run',count:0});
 const [versionWarning,setVersionWarning]=useState<CodexVersionWarning|null>(null);
 const [versionNotice,setVersionNotice]=useState<CodexVersionWarning|null>(null);
 const resourceRef=useRef(computeResource),lastResourceProp=useRef(computeResource),toolsRef=useRef(tools);
 if(lastResourceProp.current!==computeResource){resourceRef.current=computeResource;lastResourceProp.current=computeResource;}toolsRef.current=tools;
 const terminalSelected=computeResource?.kind==='ssh-terminal'||computeResource?.kind==='ssh-connection';
 const workflowResource=terminalSelected&&(computeResource.kind==='ssh-connection'?tools.scope!=='terminal-only'&&computeResource.capabilities?.service.workflowReady===true:computeResource.workflowReady===true&&computeResource.managedRuns===true)&&computeResource.authentication==='verified';
 const terminalGranted=terminalSelected&&(computeResource.kind==='ssh-connection'?(tools.scope==='terminal-only'?computeResource.capabilities?.terminal.agentReady===true:computeResource.capabilities?.service.agentReady===true):computeResource.agentReady===true),terminalReady=sshResourceReady(computeResource,tools);
 const canAcquireTerminal=computeResource?.kind==='ssh-connection'&&computeResource.canAcquireConversationTerminal===true;
 const terminalPlanning=planningMode&&!workflowResource&&(terminalSelected||tools.scope==='terminal-only');
 const terminalNotice=computeResource?.kind==='ssh-connection'?computeResource.authentication!=='verified'?'请先在终端完成 SSH 登录，成功后会自动进入终端。':!terminalGranted?'请在终端点击“交给 Agent”，再发送当前消息。':'当前对话的工具尚未就绪，请核对终端或作业服务状态。':computeResource?.status!=='selected'||computeResource.alive!==true?'所选 SSH 终端不可用，请在终端核对或重新选择。':!terminalGranted?workflowResource?computeResource.operator==='agent'?'当前对话尚无此作业服务权限。请在终端接管后，再交给 Agent。':'SSH 作业服务已连接，请在终端点击“交给 Agent”，授权当前对话使用。':computeResource.operator==='agent'?'当前对话尚无此终端权限，请先接管，再交给 Agent。':'请在终端点击“交给 Agent”，再发送当前消息。':workflowResource?'SSH 作业服务已连接，请重新连接服务商以使用工作流工具。':'SSH 终端已交接，请连接或重新连接当前服务商。';
 const [provider,setProvider]=useState<AgentProvider>(drafts.owner().provider as AgentProvider),[login,setLogin]=useState(false);
 useEffect(()=>{
  if(hidden||provider!=='codex'){setVersionNotice(null);return;}
  if(versionWarning&&claimVersionNotice())setVersionNotice(versionWarning);
 },[versionWarning,provider,hidden]);
 useEffect(()=>{if(!versionNotice)return;const timer=setTimeout(()=>setVersionNotice(null),8000);return()=>clearTimeout(timer);},[versionNotice]);
 useEffect(()=>{providerChangeRef.current?.(provider);},[provider]);
 const [workflowId,setWorkflowId]=useState<string|null>(null),[newWorkflow,setNewWorkflow]=useState(false);
 const conversationRef=useRef(onConversation);conversationRef.current=onConversation;const consumedIntent=useRef(''),selectionSeq=useRef(0),selectionPending=useRef(false),connectionOwner=useRef<{provider:AgentProvider;seq:number;nonce:string|undefined;promise:Promise<boolean>}|null>(null),providerTouched=useRef(false),handledSelection=useRef<string|undefined>(undefined),sendOwner=useRef<symbol|null>(null);
 const handledDraftIntents=useRef(new Set<string>());
 const activeSend=useRef<SendFlight|null>(null),[stopStatus,setStopStatus]=useState<'waiting'|'stopping'|'unknown'|null>(null);
 const [historyLoad,setHistoryLoad]=useState<HistoryLoad|null>(null);
 const [retrying,setRetrying]=useState<{threadId:string;turnId:string}|null>(null);
 const [promptProposal,setPromptProposal]=useState<{provider:string;threadId:string|null;text:string}|null>(null);
 const messageCallbacks=useRef({onOpenTask,onOpenRun,onOpenOriginalRun,onOpenCluster,onReviewWorker,onConnectCompute,onError});messageCallbacks.current={onOpenTask,onOpenRun,onOpenOriginalRun,onOpenCluster,onReviewWorker,onConnectCompute,onError};
 const messageActions=useRef<ChatMessageActions|null>(null);if(!messageActions.current)messageActions.current={workflow:id=>messageCallbacks.current.onOpenTask?.(id),run:id=>messageCallbacks.current.onOpenRun?.(id),originalRun:id=>messageCallbacks.current.onOpenOriginalRun?.(id),cluster:()=>messageCallbacks.current.onOpenCluster?.(),compute:()=>{void Promise.resolve().then(()=>{const cb=messageCallbacks.current;return (cb.onReviewWorker||cb.onConnectCompute)?.();}).catch(error=>messageCallbacks.current.onError(error));}};
 const loginRef=useRef(login);loginRef.current=login;
 const providerRef=useRef<AgentProvider>(provider);providerRef.current=provider;
 const projectSeen=useRef(''),accountSeq=useRef(0),externalSeq=useRef(0);
 const [externalThreads,setExternalThreads]=useState<any[]>([]),[importOpen,setImportOpen]=useState(false),[importLoading,setImportLoading]=useState(false);
 const [connected,setConnected]=useState(false),[connecting,setConnecting]=useState(false),[models,setModels]=useState<any[]>([]),[model,setModel]=useState('');
 const [thread,setThread]=useState<string|null>(null),[threads,setThreads]=useState<any[]>([]),[messages,setMessages]=useState<Message[]>([]);
 const [recovery,setRecovery]=useState<{threadId:string;error?:string}|null>(null),pendingResume=useRef<string|null>(null);
 const [modelCall,setModelCall]=useState<ModelCall|null>(null),modelCallRef=useRef<ModelCall|null>(null),modelRef=useRef(model);modelRef.current=model;
 const [prompt,setPrompt]=useState(()=>drafts.text()),[busy,setBusy]=useState(false),[turn,setTurn]=useState<string|null>(null),[account,setAccount]=useState<any>(null),[sendNotice,setSendNotice]=useState('');
 function updatePrompt(text:string){providerTouched.current=true;setSendNotice('');setPrompt(drafts.edit(text));}
 function selectDraft(value:AgentProvider,id:string|null=null,fresh=false){const old=drafts.owner();if(fresh||old.provider!==value||old.threadId!==id){saveReadingPosition();readingOwner.current=readingKey(value,id);readingReady.current=false;setPromptProposal(null);}setPrompt(drafts.activate(value,id,fresh));}
 function proposePrompt(text:string){if(drafts.text()&&drafts.text()!==text)setPromptProposal({...drafts.owner(),text});else updatePrompt(text);}
 function resolvePromptProposal(choice:'append'|'replace'|'cancel'){const proposal=promptProposal,owner=drafts.owner();setPromptProposal(null);if(!proposal||choice==='cancel'||proposal.provider!==owner.provider||proposal.threadId!==owner.threadId)return;updatePrompt(choice==='append'?[drafts.text(),proposal.text].filter(Boolean).join('\n\n'):proposal.text);}
 function restoreStoppedDraft(flight:SendFlight){if(flight.current()&&drafts.retain(flight.restoreDraft||flight.draft,flight.text))setPrompt(drafts.text());}
 async function interruptFlight(flight:SendFlight){
  if(activeSend.current!==flight||!flight.current()||!flight.cancelled||flight.interrupting||flight.interruptSent||!flight.threadId||!flight.turnId)return;
  flight.interrupting=true;setStopStatus('stopping');
  try{await invoke('agent.rpc',{provider:flight.provider,method:'turn/interrupt',params:{threadId:flight.threadId,turnId:flight.turnId}});if(!flight.current()||activeSend.current!==flight)return;flight.interruptSent=true;setSendNotice(t('已请求停止，等待服务确认；草稿已保留。'));}
  catch(error){if(flight.current()&&activeSend.current===flight){setStopStatus('unknown');setSendNotice(t('停止结果尚未确认，草稿已保留；可再次请求停止。'));onError(error);}}
  finally{flight.interrupting=false;}
 }
 function stopSend(){const flight=activeSend.current;if(!flight)return;if(!flight.current()){setSendNotice(t('请求归属已变化，未发送停止命令；请在原对话核对执行状态。'));return;}flight.cancelled=true;restoreStoppedDraft(flight);if(flight.phase==='preparing'){activeSend.current=null;sendOwner.current=null;setBusy(false);setStopStatus(null);setSendNotice(t('已取消发送准备，草稿已保留。'));return;}if(!flight.turnId){setStopStatus('waiting');setSendNotice(t('正在确认消息是否已提交，确认后停止；草稿已保留。'));return;}void interruptFlight(flight);}
 async function retryHistory(){if(!historyLoad||busy||applying||connecting)return;const target=historyLoad,seq=++selectionSeq.current,different=target.provider!==providerRef.current;setHistoryLoad({...target,status:'loading',error:undefined});if(different&&!await selectProvider(target.provider,seq)){if(seq===selectionSeq.current)setHistoryLoad({...target,status:'failed',error:t('连接尚未恢复，请连接服务商后重试。')});return;}if((!connected||different)&&!await connect(false,seq)){if(seq===selectionSeq.current)setHistoryLoad({...target,status:'failed',error:t('连接尚未恢复，请连接服务商后重试。')});return;}if(seq===selectionSeq.current)await resume(target.threadId,seq,target.projectId);}
 const [requests,applyRequests]=useState<RpcEvent[]>([]),[answers,setAnswers]=useState<Record<string,Record<string,string>>>({}),[responding,setResponding]=useState<Set<string>>(new Set());
 const requestsRef=useRef(requests);
 function setRequests(value:RpcEvent[]|((previous:RpcEvent[])=>RpcEvent[])){const next=typeof value==='function'?value(requestsRef.current):value;requestsRef.current=next;applyRequests(next);}
 const requestScopes=useRef(new WeakMap<RpcEvent,string>()),requestOwners=useRef(new WeakMap<RpcEvent,{sequence:number;nonce:string|undefined}>()),requestSerial=useRef(0),responseFlights=useRef(new Set<string>());
 function requestScope(request:RpcEvent){let key=requestScopes.current.get(request);if(!key){key=JSON.stringify([request.provider||providerRef.current,request.params?.threadId||threadRef.current,request.id,++requestSerial.current]);requestScopes.current.set(request,key);requestOwners.current.set(request,{sequence:selectionSeq.current,nonce:sessionNonceRef.current});}return key;}
 function answer(request:RpcEvent,id:string){return answers[requestScope(request)]?.[id]||'';}
 function editAnswer(request:RpcEvent,id:string,value:string){if(!requestsRef.current.includes(request))return;const key=requestScope(request);setAnswers(previous=>({...previous,[key]:{...previous[key],[id]:value}}));}
 function clearAnswers(key:string){setAnswers(previous=>{if(!(key in previous))return previous;const next={...previous};delete next[key];return next;});}
 useEffect(()=>{const active=new Set(requests.map(requestScope));setAnswers(previous=>{const next=Object.fromEntries(Object.entries(previous).filter(([key])=>active.has(key)));return Object.keys(next).length===Object.keys(previous).length?previous:next;});setResponding(previous=>{const next=new Set([...previous].filter(key=>active.has(key)));return next.size===previous.size?previous:next;});},[requests]);
 const [effort,setEffort]=useState(storedPreference('studio.effort')||''),[contextWindow,setContextWindow]=useState(''),[compactLimit,setCompactLimit]=useState(''),[options,setOptions]=useState(false),[usage,setUsage]=useState<any>(null),[applying,setApplying]=useState(false),[applied,setApplied]=useState('');
 const sessionNonceRef=useRef(sessionSelection?.nonce),sessionPendingRef=useRef(sessionSelection?.pending);sessionNonceRef.current=sessionSelection?.nonce;sessionPendingRef.current=sessionSelection?.pending;
 const planningRef=useRef(planningMode);planningRef.current=planningMode;
 const openTaskRef=useRef(onOpenTask);openTaskRef.current=onOpenTask;
 const openRunRef=useRef(onOpenRun);openRunRef.current=onOpenRun;
 const currentModel=models.find(m=>m.model===model),efforts=currentModel?.supportedReasoningEfforts||[];
 useEffect(()=>{if(currentModel&&!efforts.some((e:any)=>e.reasoningEffort===effort))setEffort(currentModel.defaultReasoningEffort||'');},[model,models]);
 useEffect(()=>{onBusyChange?.(busy||connecting||applying);},[busy,connecting,applying]);
 useEffect(()=>{if(!projectId||sessionSelection?.conversation||busy||projectSeen.current===projectId)return;projectSeen.current=projectId;const seq=selectionSeq.current,draft=drafts.capture();void invoke('state').then(s=>{const latest=drafts.capture();if(seq!==selectionSeq.current||draft.entry!==latest.entry||draft.revision!==latest.revision)return;const preferred=s.settings.projectAgents?.[projectId];if(preferred&&preferred!==providerRef.current)void selectProvider(preferred);}).catch(onError);},[projectId,busy]);
 useEffect(()=>{if(model)storePreference('studio.model.'+provider,model);if(model&&effort&&efforts.some((value:any)=>value.reasoningEffort===effort))storePreference('studio.effort.'+provider+'.'+model,effort);},[model,effort,provider,models]);
 const scroll=useRef<HTMLDivElement>(null),threadRef=useRef<string|null>(null);threadRef.current=thread;
 const readingPositions=useRef<ReturnType<typeof createReadingPositions>|null>(null);if(!readingPositions.current)readingPositions.current=createReadingPositions(()=>localStorage);
 const readingOwner=useRef(readingKey(drafts.owner().provider,drafts.owner().threadId)),readingReady=useRef(false);
 const followScroll=useRef(true),[following,setFollowing]=useState(true),[hasNewMessages,setHasNewMessages]=useState(false);
 function saveReadingPosition(){const node=scroll.current;if(readingReady.current&&node&&(typeof node.querySelector!=='function'||node.querySelector('[data-message-id]')))readingPositions.current?.save(readingOwner.current,node,followScroll.current);}
 function followLatest(){followScroll.current=true;setFollowing(true);setHasNewMessages(false);scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:'auto'});saveReadingPosition();}
 function observeScroll(){const node=scroll.current;if(!node||!readingReady.current)return;const nearBottom=node.scrollHeight-node.clientHeight-node.scrollTop<=64;followScroll.current=nearBottom;setFollowing(nearBottom);if(nearBottom)setHasNewMessages(false);saveReadingPosition();}
 useEffect(()=>()=>saveReadingPosition(),[]);
 const rpc=(method:string,params?:any)=>invoke<any>('agent.rpc',{provider:providerRef.current,method,params});
 useEffect(()=>{
  const initialSeq=selectionSeq.current;void invoke('state').then(state=>{if(initialSeq!==selectionSeq.current||providerTouched.current)return;const selected=(drafts.owner().threadId||drafts.text()?drafts.owner().provider:state.settings?.agentProvider||'codex') as AgentProvider;selectDraft(selected,drafts.owner().provider===selected?drafts.owner().threadId:null);setProvider(selected);providerRef.current=selected;setThreads([]);const a=selected==='codex'?state.settings?.agent||{}:state.settings?.agentProviders?.[selected]||{};setContextWindow(a.contextWindow?.toString()||'');setCompactLimit(a.compactLimit?.toString()||'');setEffort(storedPreference('studio.effort.'+selected)||a.effort||'');}).catch(()=>{});
  const unsubscribe=window.studio?.onEvent(event=>{
   if(event.method==='studio/conversationDeleted'){readingPositions.current?.discard(readingKey(event.params.provider||event.provider||'codex',event.params.threadId));setPrompt(drafts.discard(event.params.provider||event.provider||'codex',event.params.threadId));}
   if(event.method==='studio/conversationContextChanged'){const p=event.params;setPrompt(drafts.rekey(p.conversation.provider,p.oldThreadId,p.conversation.threadId));}
   if((event.provider||'codex')!==providerRef.current)return;
   if(event.method==='studio/codexVersionWarning'&&providerRef.current==='codex'){setVersionWarning(codexVersionWarning(event.params));return;}
   if(event.method==='studio/skillsLoaded'){const call=modelCallRef.current,p=event.params||{};if(call&&p.requestId===call.requestId&&p.threadId===call.threadId&&p.threadId===threadRef.current&&(!p.turnId||!call.turnId||p.turnId===call.turnId))setAutoSkillStatus({...p,provider:event.provider||'codex'});return;}
   if(event.method==='studio/conversationContextChanged'){
    if(sessionPendingRef.current)return;const p=event.params,c=p.conversation;if(threadRef.current!==p.oldThreadId&&pendingResume.current!==p.oldThreadId)return;
    if(pendingResume.current===p.oldThreadId)pendingResume.current=c.threadId;
    threadRef.current=c.threadId;setThread(c.threadId);setWorkflowId(p.taskId);setTurn(null);setUsage(null);setRequests([]);setAutoSkillStatus(null);
    setMessages(old=>old.filter(message=>message.role==='user').slice(-1));
    const call=modelCallRef.current;if(call&&call.threadId===p.oldThreadId){call.threadId=c.threadId;call.turnId=null;call.output=false;setModelCall({...call});}
    setThreads(old=>[{...c,id:c.threadId},...old.filter(row=>row.id!==p.oldThreadId&&row.id!==c.threadId)]);conversationRef.current?.(c,sessionNonceRef.current);return;
   }
   if(event.method==='studio/conversationDeleted'){setThreads(old=>old.filter(t=>t.id!==event.params.threadId));return;}
   if(event.method==='studio/toolsStatus'){toolsRef.current=event.params;setTools(event.params);return;}
   if(event.method==='studio/toolsWarning'){setTools((previous:any)=>({...previous,inventoryWarning:event.params?.warnings?.length?event.params.message:null}));return;}
   if(event.method==='studio/login'&&event.params?.phase==='completed'&&!loginRef.current)void connect();
   if(event.method==='studio/accountUpdated'){if(event.params?.credentialsChanged){setConnected(false);setModels([]);setModel('');setNeedsAuth(false);void refreshAccount();}else void refreshAccount();}
   if(event.method==='studio/configUpdated'){const selectedProvider=providerRef.current,seq=selectionSeq.current;void invoke('agent.rpc',{provider:selectedProvider,method:'model/list'}).then(m=>{if(seq===selectionSeq.current&&selectedProvider===providerRef.current)setModels(m.data||[]);}).catch(error=>{if(seq===selectionSeq.current&&selectedProvider===providerRef.current)onError(error);});}
   if(event.method==='studio/taskUpdated'&&event.params?.task?.threadId===threadRef.current)setWorkflowId(event.params.task.id);
   if(event.params?.threadId&&event.params.threadId!==threadRef.current)return;
   if(event.id!==undefined){requestScope(event);setRequests(prev=>[...prev.filter(r=>r.id!==event.id),event]);return;}
   const p=event.params||{};
   if(event.method==='serverRequest/resolved')setRequests(prev=>prev.filter(r=>String(r.id)!==String(p.requestId)));
   if(p.threadId && p.threadId!==threadRef.current)return;
   if(event.method==='item/agentMessage/delta'){const call=modelCallRef.current;if(call&&call.provider===providerRef.current&&call.model===modelRef.current&&call.threadId===p.threadId&&call.turnId===p.turnId&&p.delta?.trim())call.output=true;}
   if(event.method==='item/agentMessage/delta')setRetrying(null);
    if(event.method==='turn/completed'||event.method==='studio/codexDisconnected')setRetrying(null);
    if(event.method==='item/agentMessage/delta')setMessages(prev=>{
    const id=p.itemId||'agent',existing=prev.find(m=>m.id===id);
    return existing?prev.map(m=>m.id===id?{...m,text:m.text+(p.delta||'')}:m):[...prev,{id,role:'agent',text:p.delta||''}];
   });
   if(['item/started','item/completed'].includes(event.method)&&p.item&&['mcpToolCall','commandExecution','fileChange','agentMessage'].includes(p.item.type))setMessages(prev=>upsertItemMessage(prev,{...p.item,status:p.item.status||(event.method==='item/completed'?'completed':'inProgress')}));
   if(event.method==='thread/tokenUsage/updated')setUsage(p.tokenUsage);
   if(event.method==='turn/started'){const owner=modelCallRef.current;if(owner?.turnId&&owner.turnId!==p.turn?.id)return;const flight=activeSend.current;if(flight?.phase==='submitted'&&flight.current()&&flight.threadId===p.threadId&&typeof p.turn?.id==='string'){flight.turnId=p.turn.id;if(flight.cancelled)void interruptFlight(flight);}setBusy(true);setTurn(p.turn?.id);const call=modelCallRef.current;if(call&&call.provider===providerRef.current&&call.model===modelRef.current&&call.threadId===p.threadId&&!call.turnId&&typeof p.turn?.id==='string')call.turnId=p.turn.id;}
   if(event.method==='turn/completed'){const call=modelCallRef.current;if(call&&(!call.turnId||call.turnId!==p.turn?.id))return;const flight=activeSend.current;if(flight&&flight.threadId===p.threadId&&flight.turnId===p.turn?.id){if(flight.cancelled)restoreStoppedDraft(flight);activeSend.current=null;setStopStatus(null);}setBusy(false);setTurn(null);if(call&&call.provider===providerRef.current&&call.model===modelRef.current&&call.threadId===p.threadId&&call.turnId&&call.turnId===p.turn?.id){call.status=p.turn.status==='completed'&&!p.turn.error&&call.output?'passed':'failed';setModelCall({...call});}if(p.turn?.error)onError(p.turn.error.message||p.turn.error);}
   if(event.method==='error'){if(p.willRetry===true){const call=modelCallRef.current;if(call&&call.threadId===p.threadId&&call.turnId===p.turnId)setRetrying({threadId:p.threadId,turnId:p.turnId});return;}setRetrying(null);const call=modelCallRef.current;if(call&&call.threadId===p.threadId&&call.turnId===p.turnId){call.status='failed';setModelCall({...call});}onError(p.error?.message||JSON.stringify(p));}
   if(event.method==='account/updated')void refreshAccount();
   if(event.method==='studio/codexDisconnected'){const flight=activeSend.current;if(flight?.cancelled)restoreStoppedDraft(flight);activeSend.current=null;setStopStatus(null);modelCallRef.current=null;setModelCall(null);setConnected(false);setBusy(false);const message=p.code==='STUDIO_CODEX_UNSCOPED_TOOL'?'AIMatterLab 隔离已阻止未授权工具'+(typeof p.tool==='string'&&/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(p.tool)?' · '+p.tool:'')+'；流程与草稿已保留，请显式重连并核对结果后再发送。':'Agent 连接已断开，请重新连接';setTools({status:'blocked',count:0,message});if(p.code==='STUDIO_CODEX_UNSCOPED_TOOL')onError(message);}
  });return()=>{selectionSeq.current++;unsubscribe?.();};
 },[]);
 useEffect(()=>{if(hidden||historyLoad)return;const key=readingKey(provider,thread);if(!readingReady.current||readingOwner.current!==key){readingOwner.current=key;followScroll.current=readingPositions.current!.restore(key,scroll.current);setFollowing(followScroll.current);setHasNewMessages(false);readingReady.current=true;}else if(followScroll.current)followLatest();else{readingPositions.current!.restore(key,scroll.current);if(messages.length||requests.length)setHasNewMessages(true);}},[messages,requests,hidden,historyLoad,thread,provider]);
 async function refreshAccount(selectedProvider=providerRef.current,seq=selectionSeq.current){
  const request=++accountSeq.current,current=()=>request===accountSeq.current&&seq===selectionSeq.current&&selectedProvider===providerRef.current;
  try{const value=await invoke('agent.account',{provider:selectedProvider});if(current()){setAccount(value);setNeedsAuth(providerAccountState(selectedProvider,value)==='missing');}return value;}
  catch(error){if(current())setAccount({metadataUnavailable:true,modelAccess:'not_run'});return null;}
 }
 async function importExisting(){
  const selectedProvider=providerRef.current,seq=selectionSeq.current,request=++externalSeq.current;setImportOpen(true);setImportLoading(true);
  const current=()=>request===externalSeq.current&&seq===selectionSeq.current&&selectedProvider===providerRef.current;
  try{const result=await invoke('agent.rpc',{provider:selectedProvider,method:'thread/list',params:{limit:20}});if(current())setExternalThreads(result.data||[]);}catch(error){if(current())onError(error);}finally{if(current())setImportLoading(false);}
 }
  function connect(repairTools=false,seq=selectionSeq.current,showLogin=false):Promise<boolean>{
  const selectedProvider=providerRef.current,nonce=sessionNonceRef.current,current=()=>seq===selectionSeq.current&&selectedProvider===providerRef.current&&nonce===sessionNonceRef.current;
  const selectedRpc=(method:string,params?:any)=>invoke<any>('agent.rpc',{provider:selectedProvider,method,params});
  const existing=connectionOwner.current;if(existing&&existing.provider===selectedProvider&&existing.seq===seq&&existing.nonce===nonce)return existing.promise;
  const owner={provider:selectedProvider,seq,nonce,promise:Promise.resolve(false)};connectionOwner.current=owner;
  const promise=(async()=>{modelCallRef.current=null;setModelCall(null);providerTouched.current=true;setConnecting(true);setVersionWarning(null);try{
   const connection=await invoke<AgentConnectResult>('agent.connect',{provider:selectedProvider,repairTools});if(!current())return false;
   if('loginRequired' in connection||'cliRequired' in connection){
    setNeedsAuth(true);setConnected(false);
    if(showLogin&&'loginRequired' in connection)openAccounts();
    return false;
   }
   setTools(connection.tools||{status:'not_run',count:0});setVersionWarning(selectedProvider==='codex'?codexVersionWarning(connection.studioCompatibility):null);
   const [a,m,conversations]=await Promise.all([refreshAccount(selectedProvider,seq),selectedRpc('model/list'),invoke<Conversation[]>('conversation.list')]);if(!current())return false;
   if(providerAccountState(selectedProvider,a)==='missing'){setNeedsAuth(true);setConnected(false);return false;}setNeedsAuth(false);
   const list=m.data||[];setModels(list);const chosen=list.find((v:any)=>v.model===storedPreference('studio.model.'+selectedProvider))||list.find((v:any)=>v.isDefault)||list[0];setModel(chosen?.model||'');setEffort(resumedEffort({provider:selectedProvider,model:chosen,preferences:{[selectedProvider]:storedPreference('studio.effort.'+selectedProvider+'.'+chosen?.model)||storedPreference('studio.effort.'+selectedProvider)}}));
   setThreads(conversations.filter(value=>value.provider===selectedProvider).map(value=>({...value,id:value.threadId})));setConnected(true);
   return true;
  }catch(e){if(current()){setConnected(false);setModels([]);if(authenticationError(e))setNeedsAuth(true);else onError(e);}return false;}finally{if(connectionOwner.current===owner){connectionOwner.current=null;setConnecting(false);}}
 })();owner.promise=promise;return promise;
 }
 useEffect(()=>{if(!connected)return;let active=true,checking=false;const check=async()=>{if(checking)return;checking=true;try{const result=await invoke('agent.tools',{provider:providerRef.current});if(active)setTools(result);}catch{if(active)setTools({status:'blocked',message:'科学工具连接中断，请重新连接',count:0});}finally{checking=false;}};const timer=setInterval(()=>void check(),15000);return()=>{active=false;clearInterval(timer);};},[connected,provider]);
 function resetConversation(invalidate=true){setHistoryLoad(null);setStopStatus(null);activeSend.current=null;attachmentClearRef.current?.();modelCallRef.current=null;setModelCall(null);if(invalidate)selectionSeq.current++;setRecovery(null);pendingResume.current=null;setImportOpen(false);setImportLoading(false);externalSeq.current++;selectionPending.current=false;setAutoSkillStatus(null);selectDraft(providerRef.current,null,true);setTurn(null);setAnswers({});setThread(null);threadRef.current=null;setMessages([]);setRequests([]);setUsage(null);setWorkflowId(null);setNewWorkflow(false);conversationRef.current?.(null,sessionNonceRef.current);}
 async function selectProvider(value:AgentProvider,selectedSeq?:number){
  const managed=selectedSeq!==undefined,seq=selectedSeq??++selectionSeq.current;
  if(busy||!managed&&connecting)return false;providerTouched.current=true;
  setRecovery(null);pendingResume.current=null;
  const old=providerRef.current,current=()=>seq===selectionSeq.current;
  setVersionWarning(null);
  try{setNeedsAuth(false);await invoke('agent.disconnect',{provider:old});if(!current())return false;await invoke('settings',{agentProvider:value});if(!current())return false;}catch(e){if(current())onError(e);return false;}
  modelCallRef.current=null;setModelCall(null);if(!managed)selectDraft(value);providerRef.current=value;setProvider(value);attachmentClearRef.current?.();setAutoSkillStatus(null);setTurn(null);setAnswers({});setTools({status:'not_run',count:0});setConnected(false);setModels([]);setModel('');setThread(null);threadRef.current=null;setThreads([]);setMessages([]);if(!managed)setHistoryLoad(null);setRequests([]);setUsage(null);setAccount(null);setImportOpen(false);setExternalThreads([]);setImportLoading(false);externalSeq.current++;setOptions(false);setLogin(false);setEffort(storedPreference('studio.effort.'+value)||'');setWorkflowId(null);setNewWorkflow(false);conversationRef.current?.(null,sessionNonceRef.current);return true;
 }
 async function selectModel(value:string){
  modelCallRef.current=null;setModelCall(null);
  const selectedProvider=providerRef.current,seq=selectionSeq.current,current=()=>seq===selectionSeq.current&&selectedProvider===providerRef.current;
  const selectEffort=(list:any[])=>{const entry=list.find(v=>v.model===value);setEffort(resumedEffort({provider:selectedProvider,model:entry,preferences:{[selectedProvider]:storedPreference('studio.effort.'+selectedProvider+'.'+value)}}));};
   if(threadRef.current&&currentModel?.profileId&&models.find(v=>v.model===value)?.profileId!==currentModel.profileId){onError(t('现有对话不能切换 API 服务商，请新建对话以保护历史记录。'));return;}
   if(selectedProvider==='codex'){setModel(value);selectEffort(models);return;}
  setApplying(true);try{const result=await invoke('agent.rpc',{provider:selectedProvider,method:'model/select',params:{model:value}});if(current()){setModel(value);setModels(result.data||[]);selectEffort(result.data||[]);}}catch(error){if(current())onError(error);}finally{if(current())setApplying(false);}
 }
 async function resume(id:string,seq=++selectionSeq.current,selectedProject=projectId,rebuild=false){
  if(busy)return;attachmentClearRef.current?.();const selectedProvider=providerRef.current,nonce=sessionNonceRef.current,current=()=>seq===selectionSeq.current&&selectedProvider===providerRef.current&&nonce===sessionNonceRef.current;
  setSendNotice('');selectDraft(selectedProvider,id);setMessages([]);setWorkflowId(null);setHistoryLoad({provider:selectedProvider,threadId:id,projectId:selectedProject,status:'loading'});
  const selectedRpc=(method:string,params?:any)=>invoke<any>('agent.rpc',{provider:selectedProvider,method,params});
  modelCallRef.current=null;setModelCall(null);selectionPending.current=true;pendingResume.current=id;setRecovery(null);threadRef.current=null;setThread(null);setApplying(true);setRequests([]);setAnswers({});setUsage(null);setAutoSkillStatus(null);setNewWorkflow(false);setTurn(null);
  try{
   const originalId=id;
   if(rebuild){if(selectedProvider!=='codex')throw Error('Unsupported conversation recovery provider');await invoke('conversation.select',{id:selectedProvider+':'+id});if(!current())return;}
   const r=rebuild?await recoverConversation({provider:'codex',threadId:id,...model?{model}:{}}):await selectedRpc('thread/resume',{threadId:id});if(!current())return;
   if(r.studioRecovery?.status==='required'){setRecovery({threadId:id});setMessages([]);setHistoryLoad(null);return;}
   if(r.studioRecovery?.status==='recovered'){
    const c=r.studioRecovery.conversation;if(selectedProvider!=='codex'||r.studioRecovery.oldThreadId!==id||c?.provider!==selectedProvider||c?.threadId!==r.thread?.id||c?.id!==selectedProvider+':'+r.thread?.id)throw Error('恢复的会话与选中会话不匹配');setPrompt(drafts.rekey(selectedProvider,id,c.threadId));id=c.threadId;
   }
   if(r.thread?.id!==id)throw Error('恢复的会话与选中会话不匹配');
   const read=await selectedRpc('thread/read',{threadId:id,includeTurns:true});if(!current())return;
   if(read.thread?.id&&read.thread.id!==id)throw Error('读取的会话与选中会话不匹配');
   const list:Message[]=replayMessages(read.thread?.turns||[]);
   const conversation=await invoke<Conversation>('conversation.remember',{provider:selectedProvider,threadId:id,projectId:selectedProject||null,name:r.thread.name||r.thread.preview||'对话'});if(!current())return;
   const resumedModel=r.model||model,catalog=await selectedRpc('model/list');if(!current())return;if(!Array.isArray(catalog.data))throw Error('Invalid resumed model catalog');setModels(catalog.data);
   setThread(id);threadRef.current=id;setModel(resumedModel);setEffort(resumedEffort({provider:selectedProvider,preferences:{[selectedProvider]:storedPreference('studio.effort.'+selectedProvider+'.'+resumedModel)||storedPreference('studio.effort.'+selectedProvider)},model:catalog.data.find((entry:any)=>entry.model===resumedModel),serverEffort:r.reasoningEffort}));setMessages(list);setHistoryLoad(null);setWorkflowId(conversation.taskId);setThreads(old=>[{id, name:conversation.name},...old.filter(value=>value.id!==id&&value.id!==originalId)]);setImportOpen(false);conversationRef.current?.(conversation,nonce);
  }catch(e){if(current()){if(rebuild)setRecovery({threadId:pendingResume.current||id,error:e instanceof Error?e.message:String(e)});else{setHistoryLoad({provider:selectedProvider,threadId:id,projectId:selectedProject,status:'failed',error:e instanceof Error?e.message:String(e)});onError(e);}}}finally{if(current()){pendingResume.current=null;selectionPending.current=false;setApplying(false);}}
 }
 useEffect(()=>{
  if(!sessionSelection||busy||handledSelection.current===sessionSelection.nonce)return;handledSelection.current=sessionSelection.nonce;const seq=++selectionSeq.current;
  if(sessionSelection.conversation){
   const selected=sessionSelection.conversation,owner=drafts.owner();
   if(sessionSelection.adoptDraft&&owner.provider===selected.provider&&!owner.threadId)drafts.rebind(drafts.capture(),selected.threadId);
   selectDraft(selected.provider,selected.threadId);
  }
  selectionPending.current=true;threadRef.current=null;setThread(null);setMessages([]);setWorkflowId(null);setHistoryLoad(sessionSelection.conversation?{provider:sessionSelection.conversation.provider,threadId:sessionSelection.conversation.threadId,projectId:sessionSelection.conversation.projectId||'',status:'loading'}:null);setApplying(true);
  if(sessionSelection.pending){pendingResume.current=null;return;}
  const activate=async()=>{try{
   if(busy)return;
   if(sessionSelection.new){resetConversation(false);if(sessionSelection.initialPrompt!==undefined&&seq===selectionSeq.current&&sessionSelection.nonce===sessionNonceRef.current&&!sessionPendingRef.current)updatePrompt(sessionSelection.initialPrompt);return;}
   const selected=sessionSelection.conversation;if(!selected)return;
   const different=selected.provider!==providerRef.current;if(different&&!await selectProvider(selected.provider,seq)){if(seq===selectionSeq.current)setHistoryLoad({provider:selected.provider,threadId:selected.threadId,projectId:selected.projectId||'',status:'failed',error:t('连接尚未恢复，请连接服务商后重试。')});return;}
   if(seq!==selectionSeq.current)return;
   if((!connected||different)&&!await connect(false,seq)){if(seq===selectionSeq.current)setHistoryLoad({provider:selected.provider,threadId:selected.threadId,projectId:selected.projectId||'',status:'failed',error:t('连接尚未恢复，请连接服务商后重试。')});return;}
   if(seq!==selectionSeq.current)return;await resume(selected.threadId,seq,selected.projectId||'');
  }finally{if(seq===selectionSeq.current){selectionPending.current=false;setApplying(false);}}};void activate();
 },[sessionSelection?.nonce,busy]);
 useEffect(()=>{
  if(!intent||intent.autoSend||handledDraftIntents.current.has(intent.id))return;
  const owner=drafts.owner();
  if(intent.provider&&intent.provider!==owner.provider||intent.threadId&&intent.threadId!==owner.threadId){const selected=sessionSelection?.conversation;if(!selected||intent.provider&&intent.provider!==selected.provider||intent.threadId&&intent.threadId!==selected.threadId)handledDraftIntents.current.add(intent.id);return;}
  handledDraftIntents.current.add(intent.id);
  proposePrompt(intent.text);
 },[intent?.id,sessionSelection?.nonce,thread,provider,busy]);
 useEffect(()=>{if(!intent?.autoSend||consumedIntent.current===intent.id||busy||applying||connecting||!connected||!models.length||terminalSelected&&!terminalReady&&!canAcquireTerminal||(intent.threadId&&thread!==intent.threadId)||(intent.provider&&providerRef.current!==intent.provider))return;consumedIntent.current=intent.id;void send(intent.text,{reviewMode:intent.reviewMode,taskId:intent.taskId});},[intent?.id,connected,busy,applying,connecting,thread,models.length,terminalReady,canAcquireTerminal]);
 async function send(textOverride?:string,action:{reviewMode?:boolean;taskId?:string}={}){
  const text=textOverride??prompt;if(needsAuth){openAccounts();return;}if(!text.trim()||busy||sendOwner.current)return;
  const turnPlanning=planningRef.current===true;
  if(applying||connecting||selectionPending.current){setSendNotice(t('正在恢复会话，请稍后发送。'));return;}
  if(recovery){setSendNotice(t('请先恢复当前对话，输入草稿已保留。'));return;}
  if(!connected||!models.length){setSendNotice(t('请先连接服务商并选择模型。'));return;}
  if(drafts.owner().provider!==providerRef.current||drafts.owner().threadId!==threadRef.current){setSendNotice(t('当前对话尚未恢复，输入草稿已保留。'));return;}
  if(terminalSelected&&(resourceRef.current?.status!=='selected'||resourceRef.current.alive!==true)){setSendNotice(t('所选 SSH 终端不可用，请在终端核对或重新选择。'));return;}
  let acquiring=canAcquireTerminal&&!sshResourceReady(resourceRef.current,toolsRef.current);
  if(terminalSelected&&!acquiring&&!sshResourceReady(resourceRef.current,toolsRef.current)){setSendNotice(t(terminalNotice));return;}
  if(!acquiring&&(turnPlanning||workflowId||action.reviewMode)&&tools.status==='blocked'&&(!terminalSelected||workflowResource)){setSendNotice(t(tools.message||'请先修复科学工具连接'));onError(t(tools.message||'请先修复科学工具连接'));return;}
  const attachment=skill,selectedProvider=providerRef.current,seq=selectionSeq.current,nonce=sessionNonceRef.current,draft=drafts.capture(),manual=textOverride===undefined,resourceSelection=resourceRef.current?.selectionId||null,resourceWorkflow=resourceRef.current?.workflowReady===true,resourceGranted=resourceRef.current?.agentReady===true;
  let route=toolsRef.current.scope;const routeState=(resource:ComputeResourceState|null|undefined)=>resource?.kind==='ssh-connection'?JSON.stringify(route==='terminal-only'?resource.capabilities?.terminal:resource.capabilities?.service):null;let resourceRoute=routeState(resourceRef.current);
  const current=()=>seq===selectionSeq.current&&selectedProvider===providerRef.current&&nonce===sessionNonceRef.current&&resourceSelection===(resourceRef.current?.selectionId||null)&&(resourceRef.current?.kind==='ssh-connection'?acquiring||route===toolsRef.current.scope&&resourceRoute===routeState(resourceRef.current):resourceWorkflow===(resourceRef.current?.workflowReady===true)&&resourceGranted===(resourceRef.current?.agentReady===true));
  const selectedRpc=(method:string,params?:any)=>invoke<any>('agent.rpc',{provider:selectedProvider,method,params});
  setRetrying(null);const owner=Symbol();sendOwner.current=owner;const flight:SendFlight={provider:selectedProvider,threadId:threadRef.current,turnId:null,phase:'preparing',cancelled:false,interrupting:false,interruptSent:false,current,draft,text};activeSend.current=flight;const preparing=()=>current()&&!flight.cancelled;let acknowledged=false,optimisticId:string|null=null;setSendNotice('');setStopStatus(null);setBusy(true);
  const retainRequest=()=>{if(!manual&&drafts.retain(draft,text))setPrompt(drafts.text());};
  try{
   let id=threadRef.current;
   if(!id){const r=await selectedRpc('thread/start',{model:model||undefined,...(terminalSelected && projectId ? {studioInitialProjectId:projectId} : {})});if(!preparing())return;id=r.thread.id;}
   else if(acquiring){const r=await selectedRpc('thread/resume',{threadId:id});if(!preparing())return;if(r.studioRecovery?.status==='required'){setRecovery({threadId:id});return;}id=r.thread.id;}
   flight.threadId=id;
   if(acquiring){
    const [state,toolsState]=await Promise.all([invoke<ComputeResourceState>('compute.resource.status',{}),invoke('agent.tools',{provider:selectedProvider})]);
    if(!preparing()||state.selectionId!==resourceSelection)return;
    if(!sshResourceReady(state,toolsState)){setSendNotice(t(terminalNotice));return;}
    resourceRef.current=state;onComputeResource?.(state);toolsRef.current=toolsState;route=toolsState.scope;resourceRoute=routeState(state);acquiring=false;setTools(toolsState);
   }
   const conversation=await invoke<Conversation>('conversation.remember',{provider:selectedProvider,threadId:id,projectId:projectId||null,groupId:conversationGroupId||null,intent:text});if(!preparing())return;conversationRef.current?.(conversation,nonce);drafts.rebind(draft,id!);setPrompt(drafts.text());setThread(id);threadRef.current=id;setThreads(old=>[{id,name:conversation.name},...old.filter(value=>value.id!==id)]);
   if(terminalSelected&&!sshResourceReady(resourceRef.current,toolsRef.current)){setSendNotice(t(terminalNotice));return;}
   let taskId=action.taskId||conversation.taskId;
   const fresh=newWorkflow||explicitNewWorkflow(text);
   if((turnPlanning||fresh)&&!action.reviewMode&&(!terminalSelected||resourceRef.current?.workflowReady)&&toolsRef.current.scope!=='terminal-only'){const task=await invoke('task.create',{workflowVersion:2,planningMode:true,newWorkflow:fresh,threadId:id,provider:selectedProvider,request:text,projectId:conversation.projectId||projectId||null});if(!preparing())return;taskId=task.id;openTaskRef.current?.(task.id);}
   if(terminalSelected&&!sshResourceReady(resourceRef.current,toolsRef.current)){setSendNotice(t(terminalNotice));return;}
   setWorkflowId(taskId||null);setNewWorkflow(false);
    followLatest();setMessages(prev=>[...prev,{id:(optimisticId=crypto.randomUUID()),role:'user',text}]);
   const input:any[]=[{type:'text',text},{type:'text',text:'[Studio workspace context]\n'+context}];if(attachment&&'path' in attachment)input.push({type:'skill',name:attachment.name,path:attachment.path});
   const call:ModelCall={requestId:crypto.randomUUID(),provider:selectedProvider,model:modelRef.current,threadId:id!,turnId:null,output:false,status:'in_progress'};modelCallRef.current=call;setModelCall({...call});
   if(!preparing())return;flight.phase='submitted';
    const r=await selectedRpc('turn/start',{studioTurnRequestId:call.requestId,...attachment&&'functionId' in attachment?{studioSkillId:attachment.functionId}:{},planningMode:turnPlanning,reviewMode:!!action.reviewMode,...taskId?{studioTaskId:taskId}:{},threadId:id,input,model:model||undefined,effort:effort||undefined});acknowledged=typeof r.turn?.id==='string'&&!!r.turn.id;if(acknowledged&&modelCallRef.current===call){if(call.turnId&&call.turnId!==r.turn.id)call.output=false;call.turnId=r.turn.id;setTurn(r.turn.id);}if(!current())return;if(r.studioRecovery?.status==='required'){setRecovery({threadId:r.studioRecovery.oldThreadId});setBusy(false);retainRequest();if(modelCallRef.current===call){call.status='failed';setModelCall({...call});}return;}if(!acknowledged)throw Error('Agent did not acknowledge the submitted message');if(manual&&!flight.cancelled&&drafts.acknowledge(draft)){setPrompt(drafts.text());flight.restoreDraft=drafts.capture();}if(acknowledged){flight.turnId=r.turn.id;if(flight.cancelled){restoreStoppedDraft(flight);void interruptFlight(flight);}}if(modelCallRef.current===call){if(attachment)attachmentConsumedRef.current?.(attachment.attachmentId);if(call.turnId&&call.turnId!==r.turn.id)call.output=false;call.turnId=r.turn.id;setTurn(r.turn.id);}
  }catch(e){if(!current()||activeSend.current!==flight||flight.cancelled&&flight.phase==='preparing')return;retainRequest();if(!acknowledged&&optimisticId)setMessages(prev=>prev.filter(message=>message.id!==optimisticId));const call=modelCallRef.current;if(call&&call.provider===providerRef.current&&call.model===modelRef.current&&call.threadId===threadRef.current){call.status='failed';setModelCall({...call});}setBusy(false);if(activeSend.current===flight){activeSend.current=null;setStopStatus(null);}onError(e);}finally{if(sendOwner.current===owner){sendOwner.current=null;if(!acknowledged){setBusy(false);if(activeSend.current===flight){activeSend.current=null;setStopStatus(null);}}}}
 }
 async function applyOptions(){
  const selectedProvider=providerRef.current,seq=selectionSeq.current,draft=drafts.capture(),current=()=>seq===selectionSeq.current&&selectedProvider===providerRef.current;
  modelCallRef.current=null;setModelCall(null);
  setApplying(true);try{
   const preferences={contextWindow:contextWindow?Number(contextWindow):undefined,compactLimit:compactLimit?Number(compactLimit):undefined,effort};
   if(connected){const result=await invoke('agent.configure',{provider:selectedProvider,preferences,threadId:thread,model:model||undefined});if(!current())return;if(result.studioRecovery?.status==='required'){setRecovery({threadId:result.studioRecovery.oldThreadId});return;}if(result.thread){drafts.rebind(draft,result.thread.id);setPrompt(drafts.text());setThread(result.thread.id);threadRef.current=result.thread.id;}setConnected(true);}
   else await invoke('settings',{agent:preferences});
   if(!current())return;
   setUsage(null);setApplied(t('已应用；实际窗口以服务回报为准'));
  }catch(e){if(current())onError(e);}finally{if(current())setApplying(false);}
 }
 async function respond(request:RpcEvent,result:any){
   const key=requestScope(request),owner=requestOwners.current.get(request)!,selectedProvider=providerRef.current,selectedThread=threadRef.current,seq=selectionSeq.current,nonce=sessionNonceRef.current;
   if(sessionPendingRef.current||selectionPending.current||owner.sequence!==seq||owner.nonce!==nonce||responseFlights.current.has(key)||!requestsRef.current.includes(request)||request.provider&&request.provider!==selectedProvider||request.params?.threadId&&request.params.threadId!==selectedThread)return;
   const current=()=>seq===selectionSeq.current&&nonce===sessionNonceRef.current&&selectedProvider===providerRef.current&&selectedThread===threadRef.current&&requestsRef.current.includes(request);
   responseFlights.current.add(key);setResponding(previous=>new Set(previous).add(key));
   try{await invoke('agent.respond',{provider:selectedProvider,id:request.id,result});if(!current())return;clearAnswers(key);setRequests(prev=>prev.filter(r=>r!==request));}catch(e){if(current())onError(e);}finally{responseFlights.current.delete(key);if(seq===selectionSeq.current&&nonce===sessionNonceRef.current)setResponding(previous=>{const next=new Set(previous);next.delete(key);return next;});}
 }
 const providerLabel=provider==='codex'?'Codex':provider==='kimi'?'Kimi':provider==='deepseek'?'DeepSeek API':provider==='compatible'?t('自定义 API'):'Qwen';
 const optionSummary=[providerLabel,models.find(m=>m.model===model)?.displayName||model,effort].filter(Boolean).join(' · ');
 const composerOwner=drafts.owner(),composerUnbound=composerOwner.provider!==provider||composerOwner.threadId!==thread;
 const historyHidden=!!historyLoad||!!(sessionSelection&&handledSelection.current!==sessionSelection.nonce)||!!sessionSelection?.pending;
 return <aside className="agent-panel" style={{width,display:hidden?'none':undefined}}>
  <div className={"agent-top-surface"+(options?" is-expanded":"")}>
  <div className="panel-heading agent-heading"><span className="agent-heading-title"><Sparkles size={16}/>{threads.find(value=>value.id===thread)?.name||tr("科研助手")}</span>{!options&&<span className="agent-collapsed-summary" data-testid="agent-options-summary" title={optionSummary}>{optionSummary}</span>}<div className="agent-header-actions">{onOpenHistory&&<button className="icon-button" data-testid="agent-history" aria-label={t('历史会话')} title={t('历史会话')} onClick={onOpenHistory}><History size={16}/></button>}{onCollapse&&<button className="icon-button" aria-label={t('收起助手')} title={t('收起助手')} onClick={onCollapse}><PanelRightClose size={16}/></button>}<button className="icon-button" data-testid="agent-options" title={t("Agent 选项")} aria-label={t("Agent 选项")} aria-expanded={options} aria-controls="agent-options-region" onClick={()=>setOptions(!options)}><Settings2 size={16}/></button>{!onNewConversation&&<button className="icon-button" data-testid="agent-new-conversation-fallback" title={tr("新会话")} aria-label={tr("新会话")} onClick={()=>resetConversation()} disabled={busy||connecting||applying}><Plus size={17}/></button>}</div></div>
  <div className="agent-configuration" data-testid="agent-configuration" hidden={!options&&connected&&tools.status!=='blocked'}>
   <div id="agent-options-region" role="region" aria-label={t("Agent 选项")} hidden={!options}>
   <div className="agent-primary">
    <div className="agent-provider"><label>{t("服务商")}<select data-testid="agent-provider" value={provider} disabled={busy||connecting||applying} onChange={e=>void selectProvider(e.target.value as AgentProvider)}><option value="codex">Codex</option><option value="kimi">Kimi</option><option value="qwen">Qwen</option><option value="deepseek">DeepSeek API</option><option value="compatible">{t('自定义 API')}</option></select></label></div>
    {connected?<div className="agent-model-controls"><label className="agent-model-field">{t("模型")}<select data-testid="agent-model" value={model} disabled={busy||applying} onChange={e=>void selectModel(e.target.value)}>{!models.length&&<option value="">{t("登录后加载模型目录")}</option>}{models.map(m=><option key={m.id} value={m.model}>{m.providerName?m.providerName+' · ':''}{m.displayName||m.model}</option>)}</select></label><label className="agent-effort-field">{provider==='codex'?'Effort':t('思考设置')}<select data-testid="agent-effort" value={effort} disabled={!connected||busy||applying} onChange={e=>setEffort(e.target.value)}>{!efforts.length&&<option value="">{t('模型默认')}</option>}{efforts.map((e:any)=><option key={e.reasoningEffort} value={e.reasoningEffort}>{provider==='deepseek'?t(e.reasoningEffort==='none'?'快速 · 关闭思考':e.reasoningEffort==='low'?'思考 · 低':e.reasoningEffort==='high'?'思考 · 高':'思考 · 最大'):e.reasoningEffort}</option>)}</select></label></div>:null}
   </div>
   {options&&<div className="agent-options-content" id="agent-options-content" role="region" aria-label={t("Agent 选项")}>
    <section className="agent-option-section"><div className="agent-option-heading"><h4>{t('连接与调用状态')}</h4>{connected&&<button className="text-button" disabled={busy||connecting||applying} onClick={openAccounts}>{t('管理账号')}</button>}</div>{connected?<div className="provider-account" data-testid="provider-access"><span>{t(modelCall?.status==='passed'&&modelCall.provider===provider&&modelCall.model===model&&modelCall.threadId===thread?'当前模型调用已验证':modelCall?.status==='failed'?'当前模型调用未通过':'当前模型调用尚未验证')}</span>{account?.modelAccess==='passed'&&<small>{t('此服务商曾成功回复')}</small>}<small>{t(account?.account?'账户信息可用':account?.credentialStored?'已保存凭据':'账户信息未返回')}</small><small>{t('会话已连接')}</small></div>:<p className="muted">{t('连接服务商后开始协作…')}</p>}</section>
    <section className="agent-option-section"><h4>{t('上下文设置')}</h4><div className="context-usage">{usage?t("上下文")+" "+(usage.last?.totalTokens?.toLocaleString()||t("未知"))+" / "+(usage.modelContextWindow?.toLocaleString()||t("未知"))+" tokens":t("上下文用量：等待服务回报")}</div>{provider==='codex'?<div className="context-options"><label>{t('上下文预算 · tokens')}<input type="number" min={1024} placeholder={t('模型默认')} value={contextWindow} disabled={busy||applying} onChange={e=>{setContextWindow(e.target.value);setApplied('');}}/></label><label>{t('自动压缩阈值 · tokens')}<input type="number" min={1024} placeholder={t('模型默认')} value={compactLimit} disabled={busy||applying} onChange={e=>{setCompactLimit(e.target.value);setApplied('');}}/></label><small>{t('预算不会扩大模型本身的最大容量。应用后恢复当前会话，计算作业继续运行。')}</small><button className="button" data-testid="agent-context-apply" disabled={busy||applying} onClick={()=>void applyOptions()}>{tr(applying?t('应用中…'):t('应用上下文设置'))}</button>{applied&&<small role="status">{applied}</small>}</div>:<p className="muted">{t('此提供方通过协议回报上下文，暂不支持修改预算')}</p>}</section>
    {workflowId&&<section className="agent-option-section"><h4><Tooltip content={t('此对话已绑定流程，可直接用自然语言调整')}>{t('计算流程')}</Tooltip></h4><button className="button" data-testid="agent-new-workflow" disabled={busy||applying} onClick={()=>setNewWorkflow(v=>!v)}>{t(newWorkflow?'取消新建流程':'新建流程')}</button></section>}
    {connected&&<section className="agent-option-section external-session-import"><button className="text-button" data-testid="agent-import-existing" disabled={busy||applying||connecting||importLoading} onClick={()=>importOpen?setImportOpen(false):void importExisting()}>{t(importOpen?'收起会话导入':'导入已有 Agent 会话')}</button>{importOpen&&<div>{importLoading?<small>{t('读取会话目录中…')}</small>:<><small>{t('仅导入选中的会话，不修改外部记录。')}</small><select aria-label={t('选择外部会话导入')} value="" disabled={busy||applying} onChange={e=>{if(e.target.value)void resume(e.target.value);}}><option value="">{t('请选择')}</option>{externalThreads.filter(value=>!threads.some(known=>known.id===value.id)).map(value=><option key={value.id} value={value.id}>{value.name||value.preview?.slice(0,48)||value.id.slice(0,12)}</option>)}</select></>}</div>}</section>}
    <section className="agent-option-section"><h4>{t(terminalSelected?'当前计算资源':'科学工具连接')}</h4><div className="agent-tools-status" data-testid="agent-tools-status" data-status={terminalSelected&&!terminalReady?'blocked':tools.status} data-scope={tools.scope}><span><i className={'flow-dot '+((terminalSelected?terminalReady:tools.status==='ready')?'ready':'missing')}/>{t(terminalSelected?!terminalGranted?(workflowResource?'SSH 作业服务待交接':'SSH 终端待交接'):workflowResource?(terminalReady?'SSH 工作流工具已连接':'请重新连接服务商'):(terminalReady?'共享终端可用':'终端工具待连接'):tools.scope==='terminal-only'?'共享终端可用':tools.status==='ready'?'科学工具通道已连接':tools.status==='blocked'?'科学工具未就绪':'科学工具待连接')}</span>{tools.status==='blocked'&&<small>{t(tools.message||'')}</small>}</div></section>
   </div>}
   </div>
    {!connected&&<button className="button wide" data-testid="agent-connect" onClick={()=>void connect(false,selectionSeq.current,true)} disabled={connecting}>{connecting?<LoadingFeedback busy inline label={t('正在连接服务商')+' · '+providerLabel}/>:<><Sparkles size={15}/>{t("连接")} {providerLabel}</>}</button>}
   {terminalSelected&&!terminalReady&&!canAcquireTerminal?<div className="agent-tool-alert" role="status" data-testid="agent-ssh-resource-notice"><span>{t(terminalNotice)}</span>{terminalGranted&&computeResource.status==='selected'&&computeResource.alive===true&&connected&&<button className="text-button" data-testid="agent-ssh-reconnect" disabled={busy||connecting||applying} onClick={()=>void connect()}>{t('重新连接服务商')}</button>}</div>:!terminalSelected&&(tools.status==='blocked'||computeConnected===false&&tools.scope!=='terminal-only')&&<div className="agent-tool-alert" role="status"><span>{t(tools.status==='blocked'?'科学工具未就绪':'科学工具待连接')}</span><button className="text-button" data-testid="agent-tool-repair" disabled={busy||connecting} onClick={()=>{if(computeConnected===false&&onConnectCompute)void Promise.resolve().then(onConnectCompute).catch(onError);else void connect(true);}}>{t(computeConnected===false?'连接计算资源':'修复工具连接')}</button></div>}
  </div>
  {connected&&(tools.warning||tools.inventoryWarning)&&<div className="agent-tool-alert" role="status" data-testid="agent-tools-warning">{t(tools.inventoryWarning||tools.message||'工具清单待核对，可继续讨论并由 Agent 协助配置环境。')}</div>}
  {provider==='codex'&&!hidden&&versionNotice&&<div className="codex-version-notice" role="alert" data-testid="codex-version-warning"><div><strong>{t('Codex CLI 版本不同，仍可继续使用。')}</strong><small>{versionNotice.installedVersion} · {t('参考版本')} {versionNotice.baselineVersion}</small></div><button className="text-button" aria-label={t('关闭版本提示')} onClick={()=>setVersionNotice(null)}>{t('关闭')}</button></div>}
  </div>
  {recovery&&<div className="agent-recovery" data-testid="conversation-recovery" role="status"><strong>{t('对话连接需要恢复')}</strong><p>{t('旧聊天历史目前无法读取。可为同一流程建立新的空白对话连接，本地流程和作业记录保留。')}</p><button className="button" disabled={applying||connecting||!connected} onClick={()=>void resume(recovery.threadId,++selectionSeq.current,projectId,true)}>{t('重新建立对话连接')}</button>{recovery.error&&<p role="alert">{recovery.error}</p>}</div>}
   <div className="chat-scroll" ref={scroll} role="log" onScroll={observeScroll}>
   {!historyHidden&&!messages.length&&<div className="agent-welcome"><div className="agent-orb"><Sparkles size={24}/></div><h3>{tr("让想法进入计算")}</h3><p>{tr("定义实验、准备输入、运行计算，")}<br/>{tr("然后一起检查结果。")}</p><div className="prompt-hints">{['检查我的计算环境','帮我设计一个 pyGAS bias','分析选中任务的运行日志'].map(t=><button key={t} onClick={()=>proposePrompt(t)}>{tr(t)}<ArrowUp size={13}/></button>)}</div></div>}
   {historyHidden&&<div className="agent-history-state" data-testid="agent-history-state" role="status">{historyLoad?.status==='failed'?<><p>{t('此会话暂时无法读取，草稿已保留。')}</p>{historyLoad.error&&<details data-testid="agent-history-error-details"><summary>{t('查看错误详情')}</summary><pre>{historyLoad.error}</pre></details>}<button className="button" data-testid="agent-history-retry" disabled={busy||applying||connecting} onClick={()=>void retryHistory()}>{t('重新读取会话')}</button></>:<p>{t('正在读取所选会话…')}</p>}</div>}
   {!historyHidden&&<ConversationMessages messages={messages} language={t('你')} actions={messageActions.current!} disabled={busy||connecting||applying} canOriginalRun={!!onOpenOriginalRun} canCluster={!!onOpenCluster} canCompute={!!(onReviewWorker||onConnectCompute)}/>}
   {!historyHidden&&requests.map(r=>{const scope=requestScope(r),pending=responding.has(scope);return <div key={scope} className="approval" role="alert" data-testid="agent-question-request" data-request-id={String(r.id)} aria-busy={pending}><div><Shield size={15}/>{tr("需要你的决定")}</div><p>{r.params?.reason||r.params?.message||r.method}</p>{r.params?.command&&<pre>{r.params.command}</pre>}
    {r.params?.questions?.map((q:any)=><fieldset key={q.id} className="agent-question" disabled={pending}><legend>{q.question||q.header}</legend>{q.options?.length>0&&<div className="agent-question-options">{q.options.map((option:any)=><button key={option.label} type="button" className="button agent-question-option" data-testid="agent-question-option" aria-pressed={answer(r,q.id)===option.label} onClick={()=>editAnswer(r,q.id,option.label)}><strong>{option.label}</strong>{option.description&&<span>{option.description}</span>}</button>)}</div>}<input data-testid="agent-question-input" aria-label={q.question||q.header} type={q.isSecret?'password':'text'} autoComplete="off" placeholder={tr("填写回答，或输入选项名称")} value={answer(r,q.id)} onChange={e=>editAnswer(r,q.id,e.target.value)}/></fieldset>)}
    {r.method==='studio/question'?<div className="button-row">{r.params.questionOptions?.map((o:any)=><button className="button" disabled={pending} key={o.optionId} onClick={()=>void respond(r,{optionId:o.optionId})}>{o.name}</button>)}<button className="button" disabled={pending} onClick={()=>void respond(r,{})}>{t('取消')}</button></div>:r.method==='item/tool/requestUserInput'&&r.params?.questions?<button className="button primary" data-testid="agent-question-submit" disabled={pending||r.params.questions.some((q:any)=>!answer(r,q.id).trim())} onClick={()=>{if(r.params.questions.some((q:any)=>!answer(r,q.id).trim()))return;void respond(r,{answers:Object.fromEntries(r.params.questions.map((q:any)=>[q.id,{answers:[answer(r,q.id)]}]))});}}>{pending?t('提交中…'):tr("提交回答")}</button>:
     r.method==='mcpServer/elicitation/request'?<>{elicitationHasEditableInput(r.params)&&<textarea data-testid="agent-approval-arguments" aria-label={t('审批参数')} placeholder="JSON content" disabled={pending} value={answer(r,'elicitation')||'{}'} onChange={e=>editAnswer(r,'elicitation',e.target.value)}/>}<div className="button-row"><button className="button primary" disabled={pending} onClick={()=>{try{void respond(r,{action:'accept',content:JSON.parse(answer(r,'elicitation')||'{}')});}catch(e){onError(e);}}}>{tr("接受")}</button><button className="button" disabled={pending} onClick={()=>void respond(r,{action:'decline',content:null})}>{tr("拒绝")}</button></div></>:
     r.method==='item/permissions/requestApproval'?<><pre>{JSON.stringify(r.params?.permissions,null,2)}</pre><div className="button-row"><button className="button primary" disabled={pending} onClick={()=>void respond(r,{permissions:r.params?.permissions,scope:"turn"})}>{tr("本轮允许所示权限")}</button><button className="button" disabled={pending} onClick={()=>void respond(r,{permissions:{},scope:"turn"})}>{tr("拒绝权限请求")}</button></div></>:
     ['item/commandExecution/requestApproval','item/fileChange/requestApproval','execCommandApproval','applyPatchApproval'].includes(r.method)?<div className="button-row"><button className="button primary" disabled={pending} onClick={()=>void respond(r,{decision:'accept'})}>{tr("允许一次")}</button><button className="button" disabled={pending} onClick={()=>void respond(r,{decision:'acceptForSession'})}>{tr("会话内允许")}</button><button className="button" disabled={pending} onClick={()=>void respond(r,{decision:'decline'})}>{tr("拒绝")}</button></div>:
     <div className="button-row"><button className="button" disabled={pending} onClick={()=>void respond(r,{decision:'decline'})}>{tr("拒绝")}</button></div>}
   </div>;})}
   {busy&&<div className="thinking" data-testid="agent-work-state" role="status"><LoaderCircle size={14} className={stopStatus==='unknown'?undefined:'spin'}/>{t(stopStatus==='waiting'?'正在确认提交，随后停止…':stopStatus==='stopping'?'等待服务确认停止…':stopStatus==='unknown'?'停止结果待确认':retrying?.threadId===thread?'正在重新连接模型服务…':activeSend.current?.phase==='preparing'?'正在准备消息…':'Agent 正在工作')}</div>}
  </div>
  {!following&&(messages.length>0||requests.length>0)&&<div className="agent-new-messages"><button type="button" className="button" data-testid="agent-new-messages" onClick={followLatest}>{hasNewMessages?t('有新消息 · 回到底部'):t('回到底部')}</button></div>}
  {autoSkillStatus&&autoSkillStatus.threadId===thread&&autoSkillStatus.provider===provider&&<details className="agent-auto-skills"><summary>{t(autoSkillStatus.status==='passed'?'本轮已载入任务指导':autoSkillStatus.status==='already_loaded'?'当前会话已有相同指导':autoSkillStatus.status==='permission_required'?'需要公开指导共享许可':autoSkillStatus.status==='prepared'?'指导已准备，等待服务接受':autoSkillStatus.status==='failed'?'指导发送未通过':autoSkillStatus.status==='unknown'?'指导接收状态未知':autoSkillStatus.status==='not_run'?'本轮未载入任务指导':'任务指导暂不可用')} · {(autoSkillStatus.names||[]).length}</summary>{(autoSkillStatus.names||[]).map((name:string)=><div key={name}>{name}</div>)}{autoSkillStatus.source&&<p>{autoSkillStatus.source}</p>}{autoSkillStatus.attachments?.map((a:any)=><p className="skill-loaded-file" key={a.name+a.sha256}>{a.name}<small>SHA256 · {a.sha256} · {a.bytes} bytes</small></p>)}{autoSkillStatus.message&&<p>{autoSkillStatus.message}</p>}</details>}
  {needsAuth&&<div className="account-login-guidance" role="status" data-testid="agent-login-required"><p>{t(ACCOUNT_GUIDANCE)}</p><button className="button" onClick={openAccounts}>{t('打开账号与 API')}</button></div>}
  {sessionSelection?.pending&&sessionSelection.error&&<div className="notice" role="alert"><span>{sessionSelection.error}</span><button className="button" onClick={()=>onNewConversation?.()}>{t("重试")}</button></div>}
  {connected&&composerUnbound&&!historyLoad&&!recovery&&!applying&&!connecting&&!sessionSelection?.pending&&<div className="agent-send-recovery" data-testid="agent-draft-unbound" role="status"><span>{t('当前对话尚未恢复，输入草稿已保留。')}</span>{composerOwner.provider===provider&&composerOwner.threadId&&<button className="button" data-testid="agent-restore-draft" disabled={busy} onClick={()=>void resume(composerOwner.threadId!)}>{t('恢复当前对话')}</button>}</div>}
  {promptProposal&&promptProposal.provider===composerOwner.provider&&promptProposal.threadId===composerOwner.threadId&&<section className="agent-prompt-proposal" data-testid="agent-prompt-proposal" role="region" aria-label={t('处理新的讨论内容')}><strong>{t('已有未发送草稿，请选择如何加入新内容。')}</strong><details open={promptProposal.text.length<=280} data-testid="agent-prompt-preview"><summary>{t('查看待加入内容')}</summary><pre tabIndex={0}>{promptProposal.text}</pre></details><div className="button-row"><button className="button primary" data-testid="agent-prompt-append" onClick={()=>resolvePromptProposal('append')}>{t('追加到草稿')}</button><button className="button" data-testid="agent-prompt-replace" onClick={()=>resolvePromptProposal('replace')}>{t('替换草稿')}</button><button className="button" data-testid="agent-prompt-cancel" onClick={()=>resolvePromptProposal('cancel')}>{t('保留原稿')}</button></div></section>}
  {sendNotice&&!composerUnbound&&<div className="agent-send-notice" role="status">{sendNotice}</div>}
  {terminalPlanning&&<div className="agent-tool-alert" role="status" data-testid="agent-planning-terminal-notice"><span>{t('任务规划已开启；当前仅有终端工具，可先讨论方案。生成可审阅流程需要连接作业服务。')}</span>{onConnectCompute&&<button className="text-button" data-testid="agent-planning-connect-worker" disabled={busy||connecting||applying} onClick={()=>void Promise.resolve().then(onConnectCompute).catch(onError)}>{t('连接作业服务')}</button>}</div>}
  <div className="composer">{connected&&!options&&<div className="composer-model-selection" data-testid="composer-model-selection"><label>{t('模型')}<select data-testid="composer-model" aria-label={t('对话模型')} value={model} disabled={busy||applying||connecting} onChange={e=>void selectModel(e.target.value)}>{models.map(m=><option key={m.id||m.model} value={m.model} disabled={!!thread&&!!currentModel?.profileId&&m.profileId!==currentModel.profileId}>{m.providerName?m.providerName+' · ':''}{m.displayName||m.model}</option>)}</select></label><label>{t('推理等级')}<select data-testid="composer-effort" aria-label={t('对话推理等级')} value={effort} disabled={busy||applying||connecting||!efforts.length} onChange={e=>setEffort(e.target.value)}>{!efforts.length&&<option value="">{t('模型默认')}</option>}{efforts.map((entry:any)=><option key={entry.reasoningEffort} value={entry.reasoningEffort}>{entry.reasoningEffort==='off'?t('关闭思考'):entry.reasoningEffort}</option>)}</select></label></div>}<div className="agent-compose-context"><label className="agent-mode-toggle"><input data-testid="agent-planning-mode" type="checkbox" checked={planningMode} disabled={busy||connecting||applying} onChange={e=>onPlanningModeChange(e.target.checked)}/>{t('任务规划模式')}</label>{(workflowId||planningMode||newWorkflow)&&<Tooltip className="agent-mode-explanation" content={t(terminalPlanning?'规划已开启，可先讨论方案':newWorkflow?'下条消息将新建流程；原流程保留。':workflowId?'此对话已绑定流程，可直接用自然语言调整':'生成计算流程和参数，等待审阅执行')}><span className="agent-mode-inline">{t(terminalPlanning?'规划已开启，可先讨论方案':newWorkflow?'下条消息将新建流程；原流程保留。':workflowId?'此对话已绑定流程，可直接用自然语言调整':'生成计算流程和参数，等待审阅执行')}</span></Tooltip>}{workflowId&&workflowId!==visibleWorkflowId&&<button className="text-button" data-testid="agent-current-workflow" disabled={busy||applying} onClick={()=>openTaskRef.current?.(workflowId)}>{t('打开当前流程')}</button>}</div>{skill&&<div className="skill-chip"><span>{t('仅下条消息')} · {skill.name}</span><button type="button" aria-label={t('移除本条消息技能')} onClick={()=>attachmentClearRef.current?.()}>×</button></div>}<textarea aria-busy={applying||connecting} value={prompt} onChange={e=>updatePrompt(e.target.value)} placeholder={t(connected?'描述计算目标，或询问选中任务…':'连接服务商后开始协作…')} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();void send();}}}/><div className="composer-bottom"><span>{t('Enter 发送 · Shift+Enter 换行')}</span>{busy?<button className="send agent-stop-action" data-testid="agent-stop" disabled={stopStatus==='waiting'||stopStatus==='stopping'} title={t(stopStatus==='waiting'?'确认提交中':stopStatus==='stopping'?'等待停止确认':stopStatus==='unknown'?'再次请求停止':activeSend.current?.phase==='preparing'?'取消发送准备':'中断 Agent，计算作业继续')} aria-label={t(stopStatus==='waiting'?'确认提交中':stopStatus==='stopping'?'等待停止确认':stopStatus==='unknown'?'再次请求停止':activeSend.current?.phase==='preparing'?'取消发送准备':'中断 Agent，计算作业继续')} onClick={stopSend}><Square size={13}/><span>{t(stopStatus==='waiting'?'确认提交中':stopStatus==='stopping'?'等待停止确认':stopStatus==='unknown'?'再次停止':activeSend.current?.phase==='preparing'?'取消准备':'停止')}</span></button>:<button className="send" aria-label={tr("发送")} onClick={()=>void send()} disabled={!!recovery||applying||connecting||selectionPending.current||composerUnbound||!connected||!models.length||terminalSelected&&!terminalReady&&!canAcquireTerminal||!prompt.trim()}><ArrowUp size={17}/></button>}</div></div>
  {login&&<ProviderLogin provider={provider} onClose={()=>setLogin(false)} onConfigured={()=>{setLogin(false);void connect();}} onError={onError}/>}
 </aside>;
}
