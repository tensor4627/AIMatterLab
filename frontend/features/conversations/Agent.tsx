import {ChatFiles,ChatFilePreview} from './ChatFiles';
import {readChatFile} from './read-chat-file';
import type {ChatAttachmentPreview,ChatAttachmentRef} from '../../../contracts/dto/chat-attachments';
import type {ChatEvidenceSelection} from '../../../contracts/dto/chat-evidence';
import {attachmentLimits} from '../../../contracts/agent/chat-attachments.mjs';
import {ChevronDown,ChevronUp,Paperclip,X} from 'lucide-react';
import Tooltip from "../../ui/Tooltip";
import {providerAccountState,authenticationError} from "./provider-account.mjs";
import {ACCOUNT_GUIDANCE} from "../../../contracts/agent/provider-account.mjs";
import {workspaceContextHeader} from '../../../contracts/agent/user-message.mjs';
import {attachmentPrompt,attachmentsAfterReplacement} from '../../../contracts/agent/chat-attachments.mjs';
import {isCodexVersion} from '../../../contracts/agent/codex-version.mjs';
import {redactTranscriptText} from '../../../contracts/agent/transcript-sanitizer.mjs';
import {API_PROVIDER_GROUPS} from '../../../contracts/agent/model-profiles.mjs';
import Notice from '../../ui/Notice';

import './agent.css';
import './codex-version-notice.css';
import {tr} from "../../ui/i18n";
import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {ArrowUp,ListPlus,PencilLine,Square,Plus,Sparkles,Check,Shield,LoaderCircle,Settings2,History,PanelRightClose} from 'lucide-react';
import {t} from "../../ui/i18n";
import {type ChatMessageActions,type ChatMessageValue} from './ChatMessage';
import ConversationMessages from './ConversationMessages';
import ConversationTurnActivity from './ConversationTurnActivity';
import type {ConversationActivity,ConversationAttentionTarget} from '../../../contracts/dto/conversation-activity';
import {resumedEffort,importedCodexSelection,readCodexDefaultsCatalog} from "./resume-effort.mjs";

import {messageKey,upsertItemMessage,replayMessages} from './message-mapping.mjs';
import {createReadingPositions,readingKey} from './reading-position.mjs';
import {elicitationHasEditableInput} from './elicitation-input.mjs';
import ComposerQuestion,{composerQuestionItems,initialQuestionProgress,type QuestionProgress} from './ComposerQuestion';
import SessionWorkspace from './SessionWorkspace';
import TerminalWorkspaceApproval from './TerminalWorkspaceApproval';

import ProviderLogin from "../settings/ProviderLogin";
import LoadingFeedback from "../../ui/LoadingFeedback";
import type {AgentConnectRequest,AgentConnectResult,AgentSteerRequest,AgentSteerResult,AgentToolsStatus,CodexCompatibility,NativeCodexDefaults} from "../../../contracts/dto/agent";
import {explicitNewWorkflow} from "./workflow-intent.mjs";

import {createComposerDrafts} from "./composer-drafts.mjs";
import {followUpKey,readLegacyFollowUps,forgetLegacyFollowUps,readQueueAdmission,rememberQueueAdmission,forgetQueueAdmission} from './follow-ups.mjs';
import type {AgentQueueAction,AgentQueueRequest,AgentQueueResult,AgentQueueView,QueuedMessage,QueueMessageInput} from '../../../contracts/dto/agent-queue';
import type {SessionSelection} from './useConversationSelection';

import type {ComputeResourceState} from '../../../contracts/dto/compute';
import {invoke} from '../../api/studio';
import {conversationHistory,hasConversationHistory} from '../../api/conversation-history';
import type {ConversationAnchor,ConversationBranchPreview,ConversationHistoryPage,ConversationHistoryTarget} from '../../../contracts/dto/conversation-history';
import {ConversationExcerptDialog,ConversationHistoryToolbar,OlderConversationPage} from './ConversationHistory';
import {recoverConversation} from '../../api/agent';
import {type RpcEvent,type AgentProvider,type Conversation} from '../../../contracts/dto/agent';
import {type AgentIntent,type SkillAttachment,type MissingWorkflowToolQuestion} from './agent-types';
type ModelCall={requestId:string;provider:AgentProvider;model:string;threadId:string;turnId:string|null;output:boolean;status:string};
type Message=ChatMessageValue;
type DraftSnapshot=ReturnType<ReturnType<typeof createComposerDrafts>['capture']>;
type FollowUpAction='queue'|'steer';
type SendFlight={owner:symbol;provider:AgentProvider;threadId:string|null;turnId:string|null;phase:'preparing'|'submitted';cancelled:boolean;interrupting:boolean;interruptSent:boolean;settled:boolean;draftAccepted:boolean;manual:boolean;current:()=>boolean;draft:DraftSnapshot;text:string};
type HistoryLoad={provider:AgentProvider;threadId:string;projectId?:string;status:'loading'|'failed';error?:string};
type SessionTurn={threadId:string;busy:boolean;turnId:string|null;requests?:RpcEvent[]};
const isUserInputRequest=(request:RpcEvent)=>composerQuestionItems(request).length>0;
const questionKey=(request:RpcEvent)=>JSON.stringify([request.provider||'codex',request.params?.threadId||null,String(request.id)]);
const questionStamp=(request:RpcEvent)=>JSON.stringify([request.method,request.params?.turnId,request.params?.itemId,composerQuestionItems(request)]);
type QuestionDraft={request:RpcEvent;stamp:string;progress:QuestionProgress;pending:boolean};
type CodexVersionWarning={installedVersion:string;baselineVersion:string};
const versionNoticeStorageKey='studio.codexVersionNotice.shown';
const followUpEnterStorageKey='studio.follow-up-enter';
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
function codexVersionWarning(value:unknown):CodexVersionWarning|null {
 if(!value||typeof value!=='object')return null;
 const {installedVersion,baselineVersion,baselineMatch,status,versionWarning}=value as Partial<CodexCompatibility>;
 if(status!=='capabilities_verified'||baselineMatch!==false||versionWarning?.code!=='STUDIO_CODEX_VERSION_DIFFERENCE'||versionWarning.severity!=='warning')return null;
 return isCodexVersion(installedVersion)&&isCodexVersion(baselineVersion)&&installedVersion!==baselineVersion?{installedVersion,baselineVersion}:null;
}
function storedPreference(key:string){try{return localStorage.getItem(key);}catch{return null;}}
function storePreference(key:string,value:string){try{localStorage.setItem(key,value);}catch{/* Storage is optional for chat. */}}
function mergeResumedMessages(history:Message[],live:Message[]){
 const rows=new Map(history.map(message=>[messageKey(message),message]));
 for(const message of live){
  const key=messageKey(message),saved=rows.get(key);
  if(!saved||!message.deferredDetail&&(message.role!=='agent'||message.text.startsWith(saved.text)))rows.set(key,message);
 }
 return [...rows.values()];
}
function pageMessages(page:ConversationHistoryPage){return replayMessages(page.liveTurn?[...page.turns,page.liveTurn]:page.turns);}
function sshResourceReady(resource:ComputeResourceState|null|undefined,tools:AgentToolsStatus){
 if(resource?.kind==='ssh-connection'){
  if(resource.schemaVersion!==2||resource.status!=='selected'||resource.alive!==true||resource.authentication!=='verified'||tools.status!=='ready')return false;
  return tools.scope==='terminal-only'?resource.capabilities?.terminal.status==='ready'&&resource.capabilities.terminal.agentReady===true:resource.capabilities?.service.status==='connected'&&resource.capabilities.service.workflowReady===true&&resource.capabilities.service.agentReady===true;
 }
 if(resource?.kind!=='ssh-terminal'||resource.status!=='selected'||resource.alive!==true||resource.agentReady!==true||tools.status!=='ready')return false;
 const workflow=resource.workflowReady===true&&resource.managedRuns===true&&resource.authentication==='verified';
 return workflow?tools.scope!=='terminal-only':tools.scope==='terminal-only';
}
export default function Agent({terminalDraft,historyTarget,onOpenHistoryLocation,onOpenDiscussion,activity,attentionTarget,setupProviderChoice,onSetupReply,onOpenHistory,onCollapse,conversationGroupId,onOpenAccounts,planningMode,onPlanningModeChange,context,onError,skill,width,onOpenRun,intent,projectId,onOpenTask,sessionSelection,selectedLocalConversation,isLocalConversationCurrent,onConversation,onBusyChange,onNewConversation,hidden,visibleWorkflowId,onProviderChange,onAttachmentConsumed,onAttachmentClear,computeConnected,onConnectCompute,onReviewWorker,onOpenCluster,onOpenOriginalRun,computeResource,workspaceProfileId,onComputeResource,onReviewResourceTool,missingWorkflowToolQuestion}:{terminalDraft?:RefObject<((provider:AgentProvider)=>string|undefined)|null>;historyTarget?:ConversationHistoryTarget;onOpenHistoryLocation?:(target:ConversationAnchor)=>void;onOpenDiscussion?:(conversation:Conversation,draft?:string)=>void;activity?:ConversationActivity;attentionTarget?:ConversationAttentionTarget;setupProviderChoice?:{provider:AgentProvider;nonce:string};onSetupReply?:(reply:{provider:AgentProvider;model:string}|null)=>void;onComputeResource?:(state:ComputeResourceState)=>void;onOpenHistory?:()=>void;onReviewResourceTool?:()=>void;missingWorkflowToolQuestion?:MissingWorkflowToolQuestion;workspaceProfileId?:string;onCollapse?:()=>void;computeResource?:ComputeResourceState|null;onOpenOriginalRun?:(runId:string)=>void;onOpenCluster?:()=>void;computeConnected?:boolean;onConnectCompute?:()=>void|Promise<void>;onReviewWorker?:()=>void|Promise<void>;conversationGroupId?:string|null;onOpenAccounts?:(provider:AgentProvider)=>void;planningMode:boolean;onPlanningModeChange:(value:boolean)=>void;projectId?:string;onOpenTask?:(id:string)=>void;intent?:AgentIntent;width?:number;context:string;onError:(e:unknown)=>void;skill?:SkillAttachment;onProviderChange?:(provider:AgentProvider)=>void;onAttachmentConsumed?:(attachmentId:string)=>void;onAttachmentClear?:()=>void;onOpenRun?:(id:string)=>void;sessionSelection?:SessionSelection;selectedLocalConversation?:Pick<Conversation,'provider'|'threadId'>|null;isLocalConversationCurrent?:()=>boolean;onConversation?:(value:Conversation|null,selectionNonce?:string)=>void;onBusyChange?:(busy:boolean)=>void;onNewConversation?:()=>void;hidden?:boolean;visibleWorkflowId?:string|null}){
 const draftsRef=useRef<ReturnType<typeof createComposerDrafts>|null>(null);if(!draftsRef.current){draftsRef.current=createComposerDrafts(()=>localStorage);const selected=sessionSelection?.conversation;if(selected)draftsRef.current.activate(selected.provider,selected.threadId);else if(sessionSelection?.new)draftsRef.current.activate(draftsRef.current.owner().provider,null,true);}const drafts=draftsRef.current;
 const [needsAuth,setNeedsAuth]=useState(false);
 const [nativeDefaults,setNativeDefaults]=useState<NativeCodexDefaults|null>(null);
 const [defaultsReview,setDefaultsReview]=useState<'model'|'effort'|null>(null);
 function openAccounts(){if(onOpenAccounts)onOpenAccounts(providerRef.current);else setLogin(true);}
 const setupReplyRef=useRef(onSetupReply);setupReplyRef.current=onSetupReply;
 const pendingSetupProvider=useRef<AgentProvider|null>(null);
 const providerChangeRef=useRef(onProviderChange);providerChangeRef.current=onProviderChange;
 const attachmentClearRef=useRef(onAttachmentClear);attachmentClearRef.current=onAttachmentClear;
 const attachmentConsumedRef=useRef(onAttachmentConsumed);attachmentConsumedRef.current=onAttachmentConsumed;
 const [autoSkillStatus,setAutoSkillStatus]=useState<any>(null);
 const [tools,setTools]=useState<AgentToolsStatus>({status:'not_run',count:0});
 const [connected,setConnected]=useState(false),[connecting,setConnecting]=useState(false),[models,setModels]=useState<any[]>([]),[model,setModel]=useState('');
 const [versionWarning,setVersionWarning]=useState<CodexVersionWarning|null>(null);
 const [versionNotice,setVersionNotice]=useState<CodexVersionWarning|null>(null);
 const resourceRef=useRef(computeResource),lastResourceProp=useRef(computeResource),toolsRef=useRef(tools);
 if(lastResourceProp.current!==computeResource){resourceRef.current=computeResource;lastResourceProp.current=computeResource;}toolsRef.current=tools;
 const managedCompute=tools.managedCompute===true;
 const terminalSelected=computeResource?.kind==='ssh-terminal'||connected&&!managedCompute&&computeResource?.kind==='ssh-connection';
 const managedToolState=terminalSelected?undefined:tools.managedTools;
 const managedToolsBlocked=connected&&managedToolState?.status==='blocked';
 const workflowResource=terminalSelected&&(computeResource.kind==='ssh-connection'?tools.scope!=='terminal-only'&&computeResource.capabilities?.service.workflowReady===true:computeResource.workflowReady===true&&computeResource.managedRuns===true)&&computeResource.authentication==='verified';
 const terminalGranted=terminalSelected&&(computeResource.kind==='ssh-connection'?(tools.scope==='terminal-only'?computeResource.capabilities?.terminal.agentReady===true:computeResource.capabilities?.service.agentReady===true):computeResource.agentReady===true),terminalReady=sshResourceReady(computeResource,tools);
 const canAcquireTerminal=terminalSelected&&computeResource.kind==='ssh-connection'&&computeResource.canAcquireConversationTerminal===true;
 const terminalPlanning=planningMode&&!workflowResource&&(terminalSelected||tools.scope==='terminal-only');
 const terminalNotice=computeResource?.kind==='ssh-connection'?computeResource.authentication!=='verified'?'此会话原先选择的 SSH 连接尚未就绪。':!terminalGranted?'当前会话尚未取得此连接的终端或作业服务通道。':'当前对话的工具尚未就绪，请核对终端或作业服务状态。':computeResource?.status!=='selected'||computeResource.alive!==true?'所选 SSH 终端不可用，请在终端核对或重新选择。':!terminalGranted?workflowResource?computeResource.operator==='agent'?'当前对话尚无此作业服务权限。请在终端接管后，再交给 Agent。':'SSH 作业服务已连接，请在终端点击“交给 Agent”，授权当前对话使用。':computeResource.operator==='agent'?'当前对话尚无此终端权限，请先接管，再交给 Agent。':'请在终端点击“交给 Agent”，再发送当前消息。':workflowResource?'SSH 作业服务已连接，请重新连接服务商以使用工作流工具。':'SSH 终端已交接，请连接或重新连接当前服务商。';
 const [provider,setProvider]=useState<AgentProvider>(drafts.owner().provider as AgentProvider),[login,setLogin]=useState(false);
 useEffect(()=>{if(!versionNotice)return;const timer=setTimeout(()=>setVersionNotice(null),8000);return()=>clearTimeout(timer);},[versionNotice]);
 useEffect(()=>{providerChangeRef.current?.(provider);},[provider]);
 const [workflowId,setWorkflowId]=useState<string|null>(null),[newWorkflow,setNewWorkflow]=useState(false);
 const conversationRef=useRef(onConversation);conversationRef.current=onConversation;const consumedIntent=useRef(''),selectionSeq=useRef(0),selectionPending=useRef(false),connectionOwner=useRef<{provider:AgentProvider;seq:number;nonce:string|undefined;promise:Promise<boolean>}|null>(null),providerTouched=useRef(false),handledSelection=useRef<string|undefined>(undefined),sendOwner=useRef<symbol|null>(null);
 const handledDraftIntents=useRef(new Set<string>());
 const [followUpQueues,setFollowUpQueues]=useState<Record<string,AgentQueueView>>({});
 const queueAdmission=useRef(new Map<string,{draft:DraftSnapshot;id:string;pending:boolean}>());
 const [queueEdit,setQueueEdit]=useState<{owner:string;id:string;text:string}|null>(null);
 const queueOperations=useRef(new Set<string>());
 const [followUpEnter,setFollowUpEnter]=useState<FollowUpAction>(()=>storedPreference(followUpEnterStorageKey)==='steer'?'steer':'queue');
 const steering=useRef(new Set<string>());
 const [,redrawFollowUps]=useState(0);
 const refreshFollowUps=()=>redrawFollowUps(version=>version+1);
 function acceptQueue(view:AgentQueueView){
  if(!view||typeof view.threadId!=='string'||!Array.isArray(view.items))return;
  const key=followUpKey(view.provider,view.threadId);
  setFollowUpQueues(previous=>previous[key]?.revision>=view.revision?previous:{...previous,[key]:view});
 }
 const activeSend=useRef<SendFlight|null>(null),[stopStatus,setStopStatus]=useState<'waiting'|'stopping'|'unknown'|null>(null);
 const observedTurn=useRef<SessionTurn|null>(null),resolvedRequests=useRef(new Set<string>());
 const settledTurns=useRef(new Set<string>()),viewedStop=useRef<{threadId:string;turnId:string}|null>(null);
 const [historyLoad,setHistoryLoad]=useState<HistoryLoad|null>(null);
 const historyEnabled=hasConversationHistory();
 const [savedHistoryPage,setSavedHistoryPage]=useState<ConversationHistoryPage|null>(null),[paging,setPaging]=useState(false);
 const [historyJump,setHistoryJump]=useState<ConversationHistoryTarget>(),[branchPreview,setBranchPreview]=useState<ConversationBranchPreview|null>(null),[branching,setBranching]=useState(false);
 const filePicker=useRef<HTMLInputElement|null>(null),readingFiles=useRef(new Set<unknown>()),previewRequest=useRef(0);
 const [,redrawFiles]=useState(0),[filePreview,setFilePreview]=useState<{scope:string;value:ChatAttachmentPreview}|null>(null);
 const refreshFiles=()=>redrawFiles(value=>value+1);
 async function showFile(file:ChatAttachmentRef){
  const scope=drafts.attachmentOwner(),key=JSON.stringify(scope),ticket=++previewRequest.current;
  try{const value=await invoke<ChatAttachmentPreview>('agent.attachments.preview',{...scope,id:file.id});
   if(mounted.current&&ticket===previewRequest.current&&key===JSON.stringify(drafts.attachmentOwner()))setFilePreview({scope:key,value});
  }catch(error){if(mounted.current&&key===JSON.stringify(drafts.attachmentOwner()))messageCallbacks.current.onError(error);}
 }
 async function importFiles(selection:File[]){
  const snapshot=drafts.capture(),scope=drafts.attachmentOwner();
  if(!selection.length||readingFiles.current.has(snapshot.entry)||historyHidden||composerUnbound||sessionPendingRef.current)return;
  if(selection.length+snapshot.files.length>attachmentLimits.count){setSendNotice(t('每条消息最多添加 8 个附件。'));return;}
  readingFiles.current.add(snapshot.entry);setSendNotice('');refreshFiles();
  try{
   const files=[];
   for(const file of selection)files.push(await readChatFile(file));
   if(!mounted.current)return;
   const refs=await invoke<ChatAttachmentRef[]>('agent.attachments.import',{...scope,files});
   if(mounted.current&&!drafts.addToSnapshot(snapshot,refs)&&snapshot.entry===drafts.capture().entry)setSendNotice(t('对话已变化。请重新选取附件。'));
  }catch(error){if(mounted.current&&snapshot.entry===drafts.capture().entry)setSendNotice(error instanceof Error?error.message:String(error));}
  finally{readingFiles.current.delete(snapshot.entry);if(mounted.current)refreshFiles();}
 }
 const historyOperation=useRef(0),jumpRead=useRef(''),historyTargetHandled=useRef(''),historyDetails=useRef(new Set<string>()),branchInProgress=useRef(false);
 const historyActions=useRef({quote:quoteMessage,branch:branchMessage,bookmark:bookmarkMessage,detail:loadMessageDetail});
 historyActions.current={quote:quoteMessage,branch:branchMessage,bookmark:bookmarkMessage,detail:loadMessageDetail};
 const [retrying,setRetrying]=useState<{threadId:string;turnId:string}|null>(null);
 const [promptProposal,setPromptProposal]=useState<{provider:string;threadId:string|null;text:string}|null>(null);
 const messageCallbacks=useRef({onOpenTask,onOpenRun,onOpenOriginalRun,onOpenCluster,onReviewWorker,onConnectCompute,onError});messageCallbacks.current={onOpenTask,onOpenRun,onOpenOriginalRun,onOpenCluster,onReviewWorker,onConnectCompute,onError};
 const messageActions=useRef<ChatMessageActions|null>(null);if(!messageActions.current)messageActions.current={workflow:id=>messageCallbacks.current.onOpenTask?.(id),run:id=>messageCallbacks.current.onOpenRun?.(id),originalRun:id=>messageCallbacks.current.onOpenOriginalRun?.(id),cluster:()=>messageCallbacks.current.onOpenCluster?.(),compute:()=>{void Promise.resolve().then(()=>{const cb=messageCallbacks.current;return (cb.onReviewWorker||cb.onConnectCompute)?.();}).catch(error=>messageCallbacks.current.onError(error));}};
 if(!messageActions.current.previewFile)messageActions.current.previewFile=showFile;
 if(historyEnabled&&!messageActions.current.quote)Object.assign(messageActions.current,{
  quote:(message:Message)=>historyActions.current.quote(message),
  branch:(message:Message)=>void historyActions.current.branch(message),
  bookmark:(message:Message,bookmarked:boolean)=>void historyActions.current.bookmark(message,bookmarked),
  detail:(message:Message)=>void historyActions.current.detail(message),
 });
 const loginRef=useRef(login);loginRef.current=login;
 const providerRef=useRef<AgentProvider>(provider);providerRef.current=provider;
 const projectSeen=useRef(''),accountSeq=useRef(0),externalSeq=useRef(0);
 const [externalThreads,setExternalThreads]=useState<any[]>([]),[importOpen,setImportOpen]=useState(false),[importLoading,setImportLoading]=useState(false);
 useEffect(()=>{
  if(hidden||provider!=='codex'||!connected){setVersionNotice(null);return;}
  if(versionWarning&&claimVersionNotice())setVersionNotice(versionWarning);
 },[versionWarning,provider,hidden,connected]);
 const [thread,setThread]=useState<string|null>(null),[threads,setThreads]=useState<any[]>([]),[messages,setMessages]=useState<Message[]>([]);
 const localApiThread=!!thread&&(API_PROVIDER_GROUPS.includes(provider)||historyEnabled&&provider==='deepseek');
 const historyConversationId=thread?provider+':'+thread:null;
 const historyPage=savedHistoryPage?.conversation.id===historyConversationId?savedHistoryPage:null;
 const [recovery,setRecovery]=useState<{threadId:string;error?:string}|null>(null),pendingResume=useRef<string|null>(null);
 const resumeMetadata=useRef<Conversation|null>(null);
 const [modelCall,setModelCall]=useState<ModelCall|null>(null),modelCallRef=useRef<ModelCall|null>(null),modelRef=useRef(model);modelRef.current=model;
 const [prompt,setPrompt]=useState(()=>drafts.text()),[busy,setBusy]=useState(false),[turn,setTurn]=useState<string|null>(null),[account,setAccount]=useState<any>(null),[sendNotice,setSendNotice]=useState('');
 function updatePrompt(text:string){providerTouched.current=true;setSendNotice('');setPrompt(drafts.edit(text));}
 function recoverDraft(provider:AgentProvider,previous:string,threadId:string,uploadsRetained?:boolean){
  const result=drafts.rekey(provider,previous,threadId,uploadsRetained);
  setPrompt(result.text);refreshFiles();
  if(result.attachmentReview)setSendNotice(t('对话已变化。请重新选取附件。'));
 }
 function selectDraft(value:AgentProvider,id:string|null=null,fresh=false){const old=drafts.owner();if(fresh||old.provider!==value||old.threadId!==id){saveReadingPosition();readingOwner.current=readingKey(value,id);readingReady.current=false;setPromptProposal(null);}setPrompt(drafts.activate(value,id,fresh));}
 function proposePrompt(text:string){if(drafts.text()&&drafts.text()!==text)setPromptProposal({...drafts.owner(),text});else updatePrompt(text);}
 function resolvePromptProposal(choice:'append'|'replace'|'cancel'){const proposal=promptProposal,owner=drafts.owner();setPromptProposal(null);if(!proposal||choice==='cancel'||proposal.provider!==owner.provider||proposal.threadId!==owner.threadId)return;updatePrompt(choice==='append'?[drafts.text(),proposal.text].filter(Boolean).join('\n\n'):proposal.text);}
 function displayedTurnId(threadId:string){
  const flight=activeSend.current,observed=observedTurn.current;
  return (flight?.threadId===threadId?flight.turnId:null)||(observed?.threadId===threadId?observed.turnId:null);
 }
 function acceptDraft(flight:SendFlight){
  if(flight.draftAccepted||!flight.manual||!mounted.current)return;
  flight.draftAccepted=true;
  if(drafts.acknowledge(flight.draft)&&drafts.owner().provider===flight.provider&&drafts.owner().threadId===flight.threadId)setPrompt(drafts.text());
  if(flight.draft.files.length)refreshFiles();
 }
 function releaseSend(flight:SendFlight){
  if(activeSend.current===flight)activeSend.current=null;
  if(sendOwner.current===flight.owner)sendOwner.current=null;
 }
 async function interruptFlight(flight:SendFlight){
  if(flight.phase!=='submitted'||flight.settled||!flight.cancelled||flight.interrupting||flight.interruptSent||!flight.threadId||!flight.turnId)return;
  const visible=()=>activeSend.current===flight&&providerRef.current===flight.provider&&threadRef.current===flight.threadId;
  flight.interrupting=true;if(visible())setStopStatus('stopping');
  try{await invoke('agent.rpc',{provider:flight.provider,method:'turn/interrupt',params:{threadId:flight.threadId,turnId:flight.turnId}});flight.interruptSent=true;}
  catch(error){if(visible()){setStopStatus('unknown');setSendNotice(t('停止结果尚未确认，可再次请求停止。'));messageCallbacks.current.onError(error);}}
  finally{flight.interrupting=false;}
 }
 async function stopViewedTurn(){
  const threadId=threadRef.current,turnId=threadId&&displayedTurnId(threadId),selectedProvider=providerRef.current,seq=selectionSeq.current;
  if(!threadId||!turnId||viewedStop.current?.threadId===threadId&&viewedStop.current.turnId===turnId)return;
  const owner={threadId,turnId};
  viewedStop.current=owner;
  setStopStatus('stopping');
  try{await invoke('agent.rpc',{provider:selectedProvider,method:'turn/interrupt',params:{threadId,turnId}});}
  catch(error){
   if(viewedStop.current!==owner)return;
   viewedStop.current=null;
   if(seq===selectionSeq.current&&threadId===threadRef.current&&selectedProvider===providerRef.current&&displayedTurnId(threadId)===turnId){
    setStopStatus('unknown');setSendNotice(t('停止结果尚未确认，可再次请求停止。'));messageCallbacks.current.onError(error);
   }
  }
 }
 function stopSend(){
  const flight=activeSend.current;
  if(!flight){void stopViewedTurn();return;}
  flight.cancelled=true;
  if(flight.phase==='preparing'){
   if(flight.current()&&drafts.retain(flight.draft,flight.text))setPrompt(drafts.text());
   releaseSend(flight);setBusy(false);setStopStatus(null);setSendNotice(t('已取消发送准备，草稿已保留。'));return;
  }
  if(!flight.turnId){setStopStatus('waiting');return;}
  void interruptFlight(flight);
 }
 async function retryHistory(){if(!historyLoad||applying||connecting)return;const target=historyLoad,seq=++selectionSeq.current,different=target.provider!==providerRef.current;setHistoryLoad({...target,status:'loading',error:undefined});if(different&&!await selectProvider(target.provider,seq)){if(seq===selectionSeq.current)setHistoryLoad({...target,status:'failed',error:t('连接尚未恢复，请连接服务商后重试。')});return;}if(!API_PROVIDER_GROUPS.includes(target.provider)&&!await connect(false,seq,false,target.threadId)){if(seq===selectionSeq.current)setHistoryLoad({...target,status:'failed',error:t('连接尚未恢复，请连接服务商后重试。')});return;}if(seq===selectionSeq.current)await resume(target.threadId,seq,target.projectId);}
 const [requests,applyRequests]=useState<RpcEvent[]>([]),[answers,setAnswers]=useState<Record<string,Record<string,{value:string;option:boolean}>>>({}),[responding,setResponding]=useState<Set<string>>(new Set());
 const [missingToolProgress,setMissingToolProgress]=useState<{id:string;value:QuestionProgress}|null>(null);
 const missingToolRef=useRef(missingWorkflowToolQuestion);missingToolRef.current=missingWorkflowToolQuestion;
 const answeredMissingTool=useRef<string|null>(null);
 const requestsRef=useRef(requests);
 const mounted=useRef(false);
 function setRequests(value:RpcEvent[]|((previous:RpcEvent[])=>RpcEvent[])){const next=typeof value==='function'?value(requestsRef.current):value;requestsRef.current=next;applyRequests(next);}
 const requestScopes=useRef(new WeakMap<RpcEvent,string>()),requestOwners=useRef(new WeakMap<RpcEvent,{sequence:number;nonce:string|undefined}>()),requestSerial=useRef(0),responseFlights=useRef(new Set<string>());
 const questionDrafts=useRef(new Map<string,QuestionDraft>()),[,redrawQuestions]=useState(0);
 function restoreQuestion(request:RpcEvent){
  const key=questionKey(request),stamp=questionStamp(request),previous=questionDrafts.current.get(key);
  if(previous?.stamp===stamp){previous.request=request;return previous;}
  const draft={request,stamp,progress:initialQuestionProgress,pending:false};questionDrafts.current.set(key,draft);return draft;
 }
 function forgetQuestions(provider:AgentProvider,threadId?:string,requestId?:string,turnId?:string){
  for(const [key,{request}] of questionDrafts.current)if((request.provider||'codex')===provider&&(!threadId||request.params?.threadId===threadId)&&(requestId===undefined||String(request.id)===requestId)&&(!turnId||request.params?.turnId===turnId))questionDrafts.current.delete(key);
 }
 function requestScope(request:RpcEvent){let key=requestScopes.current.get(request);if(!key){key=JSON.stringify([request.provider||providerRef.current,request.params?.threadId||threadRef.current,request.id,++requestSerial.current]);requestScopes.current.set(request,key);requestOwners.current.set(request,{sequence:selectionSeq.current,nonce:sessionNonceRef.current});}return key;}
 function answer(request:RpcEvent,id:string){return answers[requestScope(request)]?.[id]?.value||'';}
 function editAnswer(request:RpcEvent,id:string,value:string,option=false){if(!requestsRef.current.includes(request))return;const key=requestScope(request);setAnswers(previous=>({...previous,[key]:{...previous[key],[id]:{value,option}}}));}
 function clearAnswers(key:string){setAnswers(previous=>{if(!(key in previous))return previous;const next={...previous};delete next[key];return next;});}
 useEffect(()=>{const active=new Set(requests.map(requestScope));setAnswers(previous=>{const next=Object.fromEntries(Object.entries(previous).filter(([key])=>active.has(key)));return Object.keys(next).length===Object.keys(previous).length?previous:next;});setResponding(previous=>{const next=new Set([...previous].filter(key=>active.has(key)));return next.size===previous.size?previous:next;});},[requests]);
 const [effort,setEffort]=useState(storedPreference('studio.effort')||''),[contextWindow,setContextWindow]=useState(''),[compactLimit,setCompactLimit]=useState(''),[options,setOptions]=useState(false),[usage,setUsage]=useState<any>(null),[applying,setApplying]=useState(false),[applied,setApplied]=useState('');
 const effortRef=useRef(effort);effortRef.current=effort;
 const sessionNonceRef=useRef(sessionSelection?.nonce),sessionPendingRef=useRef(sessionSelection?.pending);sessionNonceRef.current=sessionSelection?.nonce;sessionPendingRef.current=sessionSelection?.pending;
 const planningRef=useRef(planningMode);planningRef.current=planningMode;
 const openTaskRef=useRef(onOpenTask);openTaskRef.current=onOpenTask;
 const openRunRef=useRef(onOpenRun);openRunRef.current=onOpenRun;
 const currentModel=models.find(m=>m.model===model),efforts=currentModel?.supportedReasoningEfforts||[];
 const pendingDefaults=provider==='codex'&&connected&&!thread&&!sessionSelection?.conversation&&!!nativeDefaults&&storedPreference('studio.codex.appliedDefaults')!==nativeDefaults.id;
 function acceptDefaults(value:string,level:string){
  if(!nativeDefaults||!value)return;
  storePreference('studio.model.codex',value);
  if(level)storePreference('studio.effort.codex.'+value,level);
  storePreference('studio.codex.appliedDefaults',nativeDefaults.id);
  setNativeDefaults(null);setDefaultsReview(null);
 }
 useEffect(()=>{
  if(!pendingDefaults||!nativeDefaults||!models.length||defaultsReview)return;
  const choice=importedCodexSelection(models,nativeDefaults);
  setModel(choice.model);setEffort(choice.effort);
  if(choice.reason){setDefaultsReview(choice.reason);setOptions(true);}
  else acceptDefaults(choice.model,choice.effort);
 },[pendingDefaults,nativeDefaults,models,defaultsReview]);
 useEffect(()=>{if(currentModel&&!efforts.some((e:any)=>e.reasoningEffort===effort))setEffort(currentModel.defaultReasoningEffort||'');},[model,models]);
 useEffect(()=>{onBusyChange?.(busy||connecting||applying);},[busy,connecting,applying]);
 useEffect(()=>{if(!projectId||sessionSelection?.conversation||busy||projectSeen.current===projectId)return;projectSeen.current=projectId;const seq=selectionSeq.current,draft=drafts.capture();void invoke('state').then(s=>{const latest=drafts.capture();if(seq!==selectionSeq.current||draft.entry!==latest.entry||draft.revision!==latest.revision)return;const preferred=s.settings.projectAgents?.[projectId];if(preferred&&preferred!==providerRef.current)void selectProvider(preferred);}).catch(onError);},[projectId,busy]);
 useEffect(()=>{if(pendingDefaults)return;if(model)storePreference('studio.model.'+provider,model);if(model&&effort&&efforts.some((value:any)=>value.reasoningEffort===effort))storePreference('studio.effort.'+provider+'.'+model,effort);},[model,effort,provider,models,pendingDefaults]);
 const scroll=useRef<HTMLDivElement>(null),threadRef=useRef<string|null>(null);threadRef.current=thread;
 useEffect(()=>{
  if(!terminalDraft)return;
  terminalDraft.current=provider=>{
   const owner=drafts.attachmentOwner();
   if(mounted.current&&owner.provider===provider&&providerRef.current===provider&&!owner.threadId&&
      !threadRef.current&&!selectionPending.current&&!sessionPendingRef.current&&!readingFiles.current.has(drafts.capture().entry))return owner.draftId;
  };
  return ()=>{terminalDraft.current=null;};
 },[terminalDraft]);
 const readingPositions=useRef<ReturnType<typeof createReadingPositions>|null>(null);if(!readingPositions.current)readingPositions.current=createReadingPositions(()=>localStorage);
 const readingOwner=useRef(readingKey(drafts.owner().provider,drafts.owner().threadId)),readingReady=useRef(false);
 const followScroll=useRef(true),[following,setFollowing]=useState(true),[hasNewMessages,setHasNewMessages]=useState(false);
 function saveReadingPosition(){const node=scroll.current;if(readingReady.current&&node&&(typeof node.querySelector!=='function'||node.querySelector('[data-message-id]')))readingPositions.current?.save(readingOwner.current,node,followScroll.current);}
 function followLatest(){followScroll.current=true;setFollowing(true);setHasNewMessages(false);scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:'auto'});saveReadingPosition();}
 function observeScroll(){const node=scroll.current;if(!node||!readingReady.current)return;const nearBottom=node.scrollHeight-node.clientHeight-node.scrollTop<=64;followScroll.current=nearBottom;setFollowing(nearBottom);if(nearBottom)setHasNewMessages(false);saveReadingPosition();}
 function historyCurrent(){
  const seq=selectionSeq.current,owner=threadRef.current,scope=providerRef.current;
  return ()=>mounted.current&&seq===selectionSeq.current&&owner===threadRef.current&&scope===providerRef.current;
 }
 function historyAnchor(message:Message):Required<ConversationAnchor>|null{
  return historyConversationId&&message.turnId&&message.itemId?{conversationId:historyConversationId,turnId:message.turnId,itemId:message.itemId}:null;
 }
 function quoteMessage(message:Message){
  const excerpt=message.text.trim().slice(0,8000);
  if(!excerpt)return;
  updatePrompt([drafts.text(),excerpt.split('\n').map(line=>'> '+line).join('\n')].filter(Boolean).join('\n\n')+'\n\n');
  requestAnimationFrame(()=>scroll.current?.closest('.agent-panel')?.querySelector('textarea[data-guide-target="composer"]')?.closest('textarea')?.focus());
 }
 async function loadMessageDetail(message:Message){
  const anchor=historyAnchor(message),key=JSON.stringify(anchor);
  if(!anchor||historyDetails.current.has(key))return;
  const current=historyCurrent();
  historyDetails.current.add(key);
  try{
   const item=await conversationHistory.detail(anchor);
   if(current()&&item?.id===anchor.itemId)setMessages(previous=>upsertItemMessage(previous,item,anchor.turnId));
  }catch(error){if(current())onError(error);}finally{historyDetails.current.delete(key);}
 }
 async function bookmarkMessage(message:Message,bookmarked:boolean){
  const anchor=historyAnchor(message);if(!anchor)return;
  const current=historyCurrent();
  try{
   const items=await conversationHistory.bookmark({...anchor,bookmarked});if(!current())return;
   if(historyPage)setSavedHistoryPage(previous=>previous&&{...previous,bookmarks:items});
   else{
    const page=await conversationHistory.page({conversationId:anchor.conversationId});
    if(current())setSavedHistoryPage(page);
   }
  }
  catch(error){if(current())onError(error);}
 }
 async function createDiscussion(anchor:ConversationAnchor,revision?:string){
  if(branchInProgress.current)return;
  const current=historyCurrent();
  branchInProgress.current=true;setBranching(true);
  try{
   const result=await conversationHistory.branch({...anchor,...revision?{revision}:{}});
   if('conversation' in result&&result.draft)drafts.seed(result.conversation.provider,result.conversation.threadId,result.draft);
   if(!current())return;
   if('preview' in result){setBranchPreview(result.preview);return;}
   setBranchPreview(null);onOpenDiscussion?.(result.conversation);
  }catch(error){if(current())onError(error);}
  finally{branchInProgress.current=false;if(mounted.current)setBranching(false);}
 }
 async function branchMessage(message:Message){
  const anchor=historyAnchor(message);if(anchor)await createDiscussion(anchor);
 }
 function openHistoryLocation(anchor:ConversationAnchor){
  if(anchor.conversationId!==historyConversationId){onOpenHistoryLocation?.(anchor);return;}
  setHistoryJump({...anchor,nonce:crypto.randomUUID()});
 }
 async function loadHistoryPage(kind:'older'|'latest'|'locate',anchor?:ConversationAnchor){
  if(!historyConversationId||kind==='older'&&!historyPage?.before)return;
  const token=++historyOperation.current,current=historyCurrent();
  const before=kind==='older'?historyPage?.before||undefined:undefined;
  const liveAtStart=kind==='locate'||kind==='latest'?new Map(messages.map(message=>[messageKey(message),message])):null;
  if(kind==='older'){followScroll.current=false;setFollowing(false);saveReadingPosition();}
  setPaging(true);
  try{
   const next=anchor?await conversationHistory.locate(anchor):await conversationHistory.page({conversationId:historyConversationId,before});
   if(!current()||token!==historyOperation.current)return;
   if(next.conversation.id!==historyConversationId)throw Error('History belongs to a different conversation');
   const added=pageMessages(next);
   setMessages(previous=>mergeResumedMessages(added,liveAtStart?previous.filter(message=>liveAtStart.get(messageKey(message))!==message):previous));
   setSavedHistoryPage(previous=>({...next,atLatest:kind==='older'?previous?.atLatest??true:next.atLatest}));
   if(kind==='latest')followLatest();
  }catch(error){if(current()&&token===historyOperation.current){setHistoryJump(undefined);onError(error);}}
  finally{if(current()&&token===historyOperation.current)setPaging(false);}
 }
 useEffect(()=>{
  if(!historyTarget||historyTargetHandled.current===historyTarget.nonce||historyTarget.conversationId!==historyConversationId)return;
  historyTargetHandled.current=historyTarget.nonce;setHistoryJump(historyTarget);
 },[historyTarget?.nonce,historyConversationId]);
 useLayoutEffect(()=>{
  const node=scroll.current;
  if(!historyJump||!node||historyLoad||hidden||historyJump.conversationId!==historyConversationId)return;
  const rows=[...node.querySelectorAll<HTMLElement>('[data-turn-id]')];
  const row=rows.find(value=>value.dataset.turnId===historyJump.turnId&&(!historyJump.itemId||value.dataset.itemId===historyJump.itemId));
  if(row){
   const group=row.closest<HTMLDetailsElement>('details:not([open])');if(group)group.open=true;
   node.querySelector('[data-located]')?.removeAttribute('data-located');row.setAttribute('data-located','true');
   followScroll.current=false;setFollowing(false);row.scrollIntoView({block:'center',behavior:'instant'});
   readingOwner.current=readingKey(provider,thread);readingReady.current=true;saveReadingPosition();setHistoryJump(undefined);
   return;
  }
  if(jumpRead.current!==historyJump.nonce){
   jumpRead.current=historyJump.nonce;
   const {conversationId,turnId,itemId}=historyJump;
   void loadHistoryPage('locate',{conversationId,turnId,...itemId?{itemId}:{}});
  }else if(!paging){
   setHistoryJump(undefined);onError(t('此消息已无法定位。'));
  }
 },[historyJump?.nonce,historyConversationId,historyLoad,hidden,messages,paging]);
 useEffect(()=>()=>saveReadingPosition(),[]);
 const rpc=(method:string,params?:any)=>invoke<any>('agent.rpc',{provider:providerRef.current,method,params});
 useEffect(()=>{
  const initialSeq=selectionSeq.current;void invoke('state').then(state=>{if(initialSeq!==selectionSeq.current||providerTouched.current)return;const selected=(drafts.owner().threadId||drafts.text()?drafts.owner().provider:state.settings?.agentProvider||'codex') as AgentProvider;selectDraft(selected,drafts.owner().provider===selected?drafts.owner().threadId:null);setProvider(selected);providerRef.current=selected;setThreads([]);const a=selected==='codex'?state.settings?.agent||{}:state.settings?.agentProviders?.[selected]||{};setContextWindow(a.contextWindow?.toString()||'');setCompactLimit(a.compactLimit?.toString()||'');setEffort(storedPreference('studio.effort.'+selected)||a.effort||'');}).catch(()=>{});
  mounted.current=true;
  const unsubscribe=window.studio?.onEvent(event=>{
   if(event.method==='studio/chatEvidenceSelected'){
    const {provider,threadId,files,comment}=(event.params||{}) as Partial<ChatEvidenceSelection>;
    if(provider&&threadId&&Array.isArray(files)){try{const text=drafts.appendToDraft(provider,threadId,comment||'',files);setPrompt(text);refreshFiles();}catch(error){messageCallbacks.current.onError(error);}}
    return;
   }
   const eventProvider=event.provider||'codex';
   const eventThread=event.params?.threadId,receipt=event.params?.turn;
   if(event.method==='studio/agentQueueChanged'){acceptQueue(event.params);return;}
   if(event.method==='studio/conversationDeleted'&&typeof eventThread==='string'){
    forgetLegacyFollowUps(()=>localStorage,event.params.provider||eventProvider,eventThread);
    forgetQueueAdmission(()=>localStorage,followUpKey(event.params.provider||eventProvider,eventThread));
   }
   if(event.method==='studio/conversationDeleted')forgetQuestions(event.params.provider||eventProvider,event.params.threadId);
   if(event.method==='studio/conversationContextChanged')forgetQuestions(eventProvider,event.params.oldThreadId);
   if(event.method==='serverRequest/resolved')forgetQuestions(eventProvider,event.params?.threadId,String(event.params?.requestId));
   if(event.method==='studio/codexDisconnected')forgetQuestions(eventProvider,eventThread);
   if(event.method==='turn/completed'&&typeof receipt?.id==='string')forgetQuestions(eventProvider,eventThread,undefined,receipt.id);
   if(event.method==='studio/conversationDeleted'){readingPositions.current?.discard(readingKey(event.params.provider||event.provider||'codex',event.params.threadId));setPrompt(drafts.discard(event.params.provider||event.provider||'codex',event.params.threadId));}
   if(event.method==='studio/conversationContextChanged'){const p=event.params;recoverDraft(p.conversation.provider,p.oldThreadId,p.conversation.threadId,p.uploadsRetained===true);}
   if((event.provider||'codex')!==providerRef.current)return;
   if(event.method==='studio/skillsLoaded'){const call=modelCallRef.current,p=event.params||{};if(call&&p.requestId===call.requestId&&p.threadId===call.threadId&&p.threadId===threadRef.current&&(!p.turnId||!call.turnId||p.turnId===call.turnId))setAutoSkillStatus({...p,provider:event.provider||'codex'});return;}
   if(event.method==='studio/conversationContextChanged'){
    if(sessionPendingRef.current)return;const p=event.params,c=p.conversation;if(threadRef.current!==p.oldThreadId&&pendingResume.current!==p.oldThreadId)return;
    if(pendingResume.current===p.oldThreadId)pendingResume.current=c.threadId;
    threadRef.current=c.threadId;setThread(c.threadId);setWorkflowId(p.taskId);setTurn(null);observedTurn.current=null;settledTurns.current.clear();viewedStop.current=null;setUsage(null);setRequests([]);setAutoSkillStatus(null);
    const flight=activeSend.current;if(flight&&flight.threadId===p.oldThreadId){flight.threadId=c.threadId;flight.turnId=null;}
    setMessages(old=>old.filter(message=>message.role==='user').slice(-1).map(message=>({...message,files:attachmentsAfterReplacement(message.files,p.uploadsRetained===true)})));
    const call=modelCallRef.current;if(call&&call.threadId===p.oldThreadId){call.threadId=c.threadId;call.turnId=null;call.output=false;setModelCall({...call});}
    setThreads(old=>[{...c,id:c.threadId},...old.filter(row=>row.id!==p.oldThreadId&&row.id!==c.threadId)]);conversationRef.current?.(c,sessionNonceRef.current);return;
   }
   if(event.method==='studio/conversationDeleted'){setThreads(old=>old.filter(t=>t.id!==event.params.threadId));return;}
   if(event.method==='studio/conversationUpdated'){
    const c=event.params.conversation;
    if(pendingResume.current===c.threadId)resumeMetadata.current=c;
    setThreads(old=>[{id:c.threadId,name:c.name},...old.filter(row=>row.id!==c.threadId)]);
    return;
   }
   const viewedThread=threadRef.current||pendingResume.current;
   if(event.method==='studio/toolsStatus'){if(event.params?.threadId&&event.params.threadId!==viewedThread)return;toolsRef.current=event.params;setTools(event.params);return;}
   if(event.params?.threadId&&event.params.threadId!==viewedThread)return;
   if(event.method==='studio/agentQueueDelivered'){
    const {id,text,turnId,files}=event.params;
    if(typeof id==='string'&&typeof text==='string')setMessages(previous=>previous.some(message=>message.id===id)?previous:[
     ...previous,{id,role:'user',text,turnId,clientUserMessageId:id,justSent:true,...(Array.isArray(files)?{files}:{})},
    ]);
    return;
   }
   if(event.method==='studio/agentQueueStopUnconfirmed'){
    if(event.params.turnId===displayedTurnId(viewedThread||'')){
     setStopStatus('unknown');setSendNotice(t('停止结果尚未确认，可再次请求停止。'));
    }
    return;
   }
   if(event.method==='studio/codexVersionWarning'){
    if(providerRef.current==='codex'&&!connectionOwner.current){const warning=codexVersionWarning(event.params);if(warning)setVersionWarning(warning);}
    return;
   }
   if(event.method==='studio/toolsWarning'){setTools(previous=>({...previous,inventoryWarning:event.params?.warnings?.length?event.params.message:null}));return;}
   if(event.method==='studio/login'&&event.params?.phase==='completed'&&!loginRef.current)void connect();
   if(event.method==='studio/accountUpdated'){if(event.params?.credentialsChanged){setupReplyRef.current?.(null);setConnected(false);setModels([]);setModel('');setNeedsAuth(false);void refreshAccount();}else void refreshAccount();}
   if(event.method==='studio/configUpdated'){const selectedProvider=providerRef.current,seq=selectionSeq.current;void invoke('agent.rpc',{provider:selectedProvider,method:'model/list'}).then(m=>{if(seq===selectionSeq.current&&selectedProvider===providerRef.current)setModels(m.data||[]);}).catch(error=>{if(seq===selectionSeq.current&&selectedProvider===providerRef.current)onError(error);});}
   if(event.method==='studio/taskUpdated'&&event.params?.task?.threadId===threadRef.current)setWorkflowId(event.params.task.id);
   const p=event.params||{};
   const currentTurn=viewedThread&&displayedTurnId(viewedThread);
   if(p.turnId&&(settledTurns.current.has(p.turnId)||currentTurn&&p.turnId!==currentTurn)&&
      (event.id!==undefined||event.method.startsWith('item/')||event.method==='error'))return;
   if(event.id!==undefined){
    questionDrafts.current.delete(questionKey(event));requestScope(event);
    if(isUserInputRequest(event))restoreQuestion(event);
    setRequests(prev=>[...prev.filter(r=>String(r.id)!==String(event.id)),event]);return;
   }
   if(event.method==='studio/serviceNotification'&&p.message){setMessages(old=>upsertItemMessage(old,p.message));return;}
   if(event.method==='studio/agentTurnState'){
    if(!p.threadId||p.turnId&&settledTurns.current.has(p.turnId)||currentTurn&&p.turnId!==currentTurn)return;
    observedTurn.current=p;
    if(p.busy||!activeSend.current){setBusy(p.busy);setTurn(p.turnId);}
    if(!p.busy&&!activeSend.current)setStopStatus(null);
    return;
   }
   if(event.method==='studio/sessionReady'&&p.threadId===threadRef.current&&!currentTurn){
    setSendNotice(t(p.status?p.message:'上一轮回复已收到原服务回执。'));
   }
   if(event.method==='serverRequest/resolved'){if(pendingResume.current)resolvedRequests.current.add(String(p.requestId));setRequests(prev=>prev.filter(r=>String(r.id)!==String(p.requestId)));}
   if(event.method==='item/agentMessage/delta'){const call=modelCallRef.current;if(call&&call.provider===providerRef.current&&call.model===modelRef.current&&call.threadId===p.threadId&&call.turnId===p.turnId&&p.delta?.trim())call.output=true;}
   if(event.method==='item/agentMessage/delta')setRetrying(null);
    if(event.method==='item/agentMessage/delta')setMessages(prev=>{
    const id=p.itemId||'agent',turnId=p.turnId||currentTurn||undefined;
    const existing=prev.find(message=>message.id===id&&(!turnId||!message.turnId||message.turnId===turnId));
    return existing?prev.map(message=>message===existing?{...message,text:message.text+(p.delta||''),...turnId?{turnId,itemId:id}:{}}:message):[...prev,{id,role:'agent',text:p.delta||'',...turnId?{turnId,itemId:id}:{}}];
   });
   if(event.method==='thread/compacted'&&p.turnId===currentTurn&&currentTurn){
    const id='legacy-context-compaction:'+currentTurn;
    setMessages(previous=>previous.some(message=>message.role==='compaction'&&message.turnId===currentTurn)
     ?previous:upsertItemMessage(previous,{id,type:'contextCompaction'},currentTurn));
   }
   if(event.method==='item/completed'&&p.item?.type==='contextCompaction'){
    const id='legacy-context-compaction:'+p.turnId;
    setMessages(previous=>upsertItemMessage(previous.filter(message=>message.id!==id),{...p.item,turnId:p.turnId},p.turnId));
   }
   if(event.method==='item/completed'&&p.item?.type==='plan')setMessages(prev=>upsertItemMessage(prev,p.item,p.turnId||currentTurn||undefined));
   if(['item/started','item/completed'].includes(event.method)&&p.item&&['mcpToolCall','webSearch','commandExecution','fileChange','agentMessage'].includes(p.item.type))setMessages(prev=>upsertItemMessage(prev,{...p.item,status:p.item.status||(event.method==='item/completed'?'completed':'inProgress')},p.turnId||currentTurn||undefined));
   if(event.method==='thread/tokenUsage/updated')setUsage(p.tokenUsage);
   if(event.method==='turn/started'){
    const id=p.turn?.id;
    if(!p.threadId||typeof id!=='string'||settledTurns.current.has(id)||currentTurn&&currentTurn!==id)return;
    const flight=activeSend.current,call=modelCallRef.current;
    if(flight?.phase==='submitted'&&flight.threadId===p.threadId){
     flight.turnId=id;if(flight.cancelled)void interruptFlight(flight);
    }
    if(call?.status==='in_progress'&&call.threadId===p.threadId&&!call.turnId)call.turnId=id;
    observedTurn.current={threadId:p.threadId,busy:true,turnId:id};
    setBusy(true);setTurn(id);return;
   }
   if(event.method==='turn/completed'){
    const id=p.turn?.id;
    if(!p.threadId||typeof id!=='string'||id!==currentTurn||settledTurns.current.has(id))return;
    settledTurns.current.add(id);
    const interrupted=['interrupted','cancelled','canceled'].includes(p.turn.status),stillPreparing=p.studioTurnBusy===true;
    const flight=activeSend.current,call=modelCallRef.current;
    if(flight&&flight.threadId===p.threadId&&flight.turnId===id){
     flight.settled=true;
     if(interrupted||p.turn.status==='completed')acceptDraft(flight);
     releaseSend(flight);
    }
    const stopping=flight?.cancelled||viewedStop.current?.turnId===id;
    viewedStop.current=null;
    observedTurn.current={threadId:p.threadId,busy:stillPreparing,turnId:null};
    setStopStatus(null);setRetrying(null);setBusy(stillPreparing);setTurn(null);setRequests([]);
    forgetQuestions(eventProvider,p.threadId);
    if(call&&call.threadId===p.threadId&&call.turnId===id){
     call.status=interrupted?'interrupted':p.turn.status==='completed'&&!p.turn.error&&(call.output||p.turn.modelOutputReceived===true)?'passed':'failed';
     setModelCall({...call});if(call.status==='passed')setupReplyRef.current?.({provider:call.provider,model:call.model});
    }
    if(interrupted)setSendNotice(t('已停止当前回复。'));
    else if(stopping)setSendNotice('');
    if(!interrupted&&p.turn.error)messageCallbacks.current.onError(p.turn.error.message||p.turn.error);
    return;
   }
   if(event.method==='error'){if(p.willRetry===true){const call=modelCallRef.current;if(call&&call.threadId===p.threadId&&call.turnId===p.turnId)setRetrying({threadId:p.threadId,turnId:p.turnId});return;}setRetrying(null);const call=modelCallRef.current;if(call&&call.threadId===p.threadId&&call.turnId===p.turnId){call.status='failed';setModelCall({...call});}onError(p.error?.message||JSON.stringify(p));}
   if(event.method==='account/updated')void refreshAccount();
   if(event.method==='studio/codexDisconnected'){leaveDisplayedTurn();setRequests([]);modelCallRef.current=null;setModelCall(null);setConnected(false);setVersionWarning(null);const message=p.code==='STUDIO_CODEX_UNSCOPED_TOOL'?'AIMatterLab 隔离已阻止未授权工具'+(typeof p.tool==='string'&&/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(p.tool)?' · '+p.tool:'')+'；流程与草稿已保留，请显式重连并核对结果后再发送。':'Agent 连接已断开，请重新连接';setTools(previous=>({status:'blocked',count:0,message,...previous.managedTools?{managedCompute:true,managedTools:{status:'not_run',count:0}}:{}}));if(p.code==='STUDIO_CODEX_UNSCOPED_TOOL')messageCallbacks.current.onError(message);}
  });return()=>{mounted.current=false;selectionSeq.current++;unsubscribe?.();};
 },[]);
 useEffect(()=>{if(hidden||historyLoad)return;const key=readingKey(provider,thread);if(!readingReady.current||readingOwner.current!==key){readingOwner.current=key;followScroll.current=readingPositions.current!.restore(key,scroll.current);setFollowing(followScroll.current);setHasNewMessages(false);readingReady.current=true;}else if(followScroll.current)followLatest();else{readingPositions.current!.restore(key,scroll.current);if(messages.length||requests.length)setHasNewMessages(true);}},[messages,requests,hidden,historyLoad,thread,provider]);
 async function refreshAccount(selectedProvider=providerRef.current,seq=selectionSeq.current,requireReadback=false){
  const request=++accountSeq.current,current=()=>request===accountSeq.current&&seq===selectionSeq.current&&selectedProvider===providerRef.current;
  try{const value=await invoke('agent.account',{provider:selectedProvider});if(current()){setAccount(value);setNeedsAuth(providerAccountState(selectedProvider,value)==='missing');}return value;}
  catch(error){if(current())setAccount({metadataUnavailable:true,modelAccess:'not_run'});if(requireReadback)throw error;return null;}
 }
 async function importExisting(){
  const selectedProvider=providerRef.current,seq=selectionSeq.current,request=++externalSeq.current;setImportOpen(true);setImportLoading(true);
  const current=()=>request===externalSeq.current&&seq===selectionSeq.current&&selectedProvider===providerRef.current;
  try{const result=await invoke('agent.rpc',{provider:selectedProvider,method:'thread/list',params:{limit:20}});if(current())setExternalThreads(result.data||[]);}catch(error){if(current())onError(error);}finally{if(current())setImportLoading(false);}
 }
  function connect(repairTools:NonNullable<AgentConnectRequest['repairTools']>=false,seq=selectionSeq.current,showLogin=false,expectedThreadId=threadRef.current):Promise<boolean>{
  const selectedProvider=providerRef.current,nonce=sessionNonceRef.current,current=()=>seq===selectionSeq.current&&selectedProvider===providerRef.current&&nonce===sessionNonceRef.current;
  const apiThread=API_PROVIDER_GROUPS.includes(selectedProvider)?expectedThreadId:null;
  const selectedRpc=(method:string,params?:any)=>invoke<any>('agent.rpc',{provider:selectedProvider,method,params});
  const existing=connectionOwner.current;if(existing&&existing.provider===selectedProvider&&existing.seq===seq&&existing.nonce===nonce)return existing.promise;
  const owner={provider:selectedProvider,seq,nonce,promise:Promise.resolve(false)};connectionOwner.current=owner;
  const promise=(async()=>{modelCallRef.current=null;setModelCall(null);providerTouched.current=true;setConnecting(true);setNeedsAuth(false);setVersionWarning(null);setVersionNotice(null);try{
   const connection=await invoke<AgentConnectResult>('agent.connect',{provider:selectedProvider,repairTools,...expectedThreadId?{threadId:expectedThreadId}:{}});if(!current())return false;
   if('loginRequired' in connection||'cliRequired' in connection){
    setNeedsAuth(true);setConnected(false);
    if(showLogin&&'loginRequired' in connection)openAccounts();
    return false;
   }
   const resumed=apiThread?await selectedRpc('thread/resume',{threadId:apiThread}):null;
   if(!current())return false;
   if(resumed&&resumed.thread?.id!==apiThread)throw Error('恢复的会话与选中会话不匹配');
   const toolStatus=connection.tools||{status:'not_run',count:0};toolsRef.current=toolStatus;setTools(toolStatus);
   const modelCatalog=selectedProvider==='codex'&&connection.nativeCodexDefaults
    ?readCodexDefaultsCatalog(page=>selectedRpc('model/list',page),current):selectedRpc('model/list');
   const [a,m,conversations]=await Promise.all([refreshAccount(selectedProvider,seq,selectedProvider==='codex'),modelCatalog,invoke<Conversation[]>('conversation.list')]);if(!current())return false;
   if(providerAccountState(selectedProvider,a)==='missing'){setNeedsAuth(true);setConnected(false);return false;}setNeedsAuth(false);
   setDefaultsReview(null);setNativeDefaults(selectedProvider==='codex'?connection.nativeCodexDefaults??null:null);
   const list=m.data||[];
   const chosen=resumed?list.find((v:any)=>v.model===resumed.model):list.find((v:any)=>v.model===storedPreference('studio.model.'+selectedProvider))||list.find((v:any)=>v.isDefault)||list[0];
   if(resumed&&!chosen)throw Error('请选择此服务商已配置的模型');
   setModels(list);modelRef.current=chosen?.model||'';setModel(modelRef.current);
   effortRef.current=resumedEffort({provider:selectedProvider,model:chosen,preferences:{[selectedProvider]:storedPreference('studio.effort.'+selectedProvider+'.'+chosen?.model)||storedPreference('studio.effort.'+selectedProvider)},serverEffort:resumed?.reasoningEffort});setEffort(effortRef.current);
   if(selectedProvider==='codex')setVersionWarning(codexVersionWarning(connection.studioCompatibility));
   setThreads(conversations.filter(value=>value.provider===selectedProvider).map(value=>({...value,id:value.threadId})));setConnected(true);if(apiThread)setSendNotice('');
   return true;
  }catch(e){if(current()){setConnected(false);setModels([]);if(apiThread)setSendNotice(redactTranscriptText(e instanceof Error?e.message:String(e)));else if(selectedProvider!=='codex'&&authenticationError(e))setNeedsAuth(true);else onError(e);}return false;}finally{if(connectionOwner.current===owner){connectionOwner.current=null;setConnecting(false);}}
 })();owner.promise=promise;return promise;
 }
 useEffect(()=>{
  if(!connected)return;
  let active=true,checking=false;
  const check=async()=>{
   if(checking||selectionPending.current||connectionOwner.current||activeSend.current||observedTurn.current?.busy)return;
   const threadId=threadRef.current,seq=selectionSeq.current,nonce=sessionNonceRef.current,previous=toolsRef.current;
   const current=()=>active&&seq===selectionSeq.current&&nonce===sessionNonceRef.current&&provider===providerRef.current&&threadId===threadRef.current&&toolsRef.current===previous;
   checking=true;
   try{
    const result=await invoke<AgentToolsStatus>('agent.tools',{provider,...threadId?{threadId}:{}});
    if(current()){toolsRef.current=result;setTools(result);}
   }catch{/* A failed read or stale scope supplies no new readiness result. */}
   finally{checking=false;}
  };
  const timer=setInterval(()=>void check(),15000);
  return()=>{active=false;clearInterval(timer);};
 },[connected,provider]);
 function leaveDisplayedTurn(){activeSend.current=null;sendOwner.current=null;observedTurn.current=null;settledTurns.current.clear();viewedStop.current=null;resolvedRequests.current.clear();setBusy(false);setTurn(null);setStopStatus(null);setRetrying(null);}
 function resetConversation(invalidate=true){setHistoryLoad(null);leaveDisplayedTurn();attachmentClearRef.current?.();modelCallRef.current=null;setModelCall(null);if(invalidate)selectionSeq.current++;setRecovery(null);pendingResume.current=null;setImportOpen(false);setImportLoading(false);externalSeq.current++;selectionPending.current=false;setAutoSkillStatus(null);selectDraft(providerRef.current,null,true);setAnswers({});setThread(null);threadRef.current=null;setMessages([]);setRequests([]);setUsage(null);setWorkflowId(null);setNewWorkflow(false);conversationRef.current?.(null,sessionNonceRef.current);}
 useEffect(()=>{
  if(!setupProviderChoice)return;
  pendingSetupProvider.current=setupProviderChoice.provider;
  if(!selectedLocalConversation&&!sessionSelection?.conversation&&!threadRef.current&&!drafts.text()&&!busy&&!connecting&&!applying&&providerRef.current!==setupProviderChoice.provider)
   void selectProvider(setupProviderChoice.provider,undefined,false);
 },[setupProviderChoice?.nonce]);
 async function selectProvider(value:AgentProvider,selectedSeq?:number,persist=true){
  const managed=selectedSeq!==undefined,seq=selectedSeq??++selectionSeq.current;
  if(!managed&&connecting)return false;providerTouched.current=true;
  setRecovery(null);pendingResume.current=null;
  const current=()=>seq===selectionSeq.current;
  setVersionWarning(null);
  try{setNeedsAuth(false);if(!managed)await invoke('conversation.select',{new:true,provider:value});if(!current())return false;if(persist&&!managed)await invoke('settings',{agentProvider:value});if(!current())return false;}catch(e){if(current())onError(e);return false;}
  leaveDisplayedTurn();
  pendingSetupProvider.current=null;modelCallRef.current=null;setModelCall(null);if(!managed)selectDraft(value);providerRef.current=value;setProvider(value);attachmentClearRef.current?.();setAutoSkillStatus(null);setTurn(null);setAnswers({});setTools({status:'not_run',count:0});setConnected(false);setModels([]);setModel('');setThread(null);threadRef.current=null;setThreads([]);setMessages([]);if(!managed)setHistoryLoad(null);setRequests([]);setUsage(null);setAccount(null);setImportOpen(false);setExternalThreads([]);setImportLoading(false);externalSeq.current++;setOptions(false);setLogin(false);setEffort(storedPreference('studio.effort.'+value)||'');setWorkflowId(null);setNewWorkflow(false);if(!managed)conversationRef.current?.(null,sessionNonceRef.current);return true;
 }
 async function selectModel(value:string){
  modelCallRef.current=null;setModelCall(null);
  const selectedProvider=providerRef.current,seq=selectionSeq.current,current=()=>seq===selectionSeq.current&&selectedProvider===providerRef.current;
  const selectEffort=(list:any[])=>{const entry=list.find(v=>v.model===value);setEffort(resumedEffort({provider:selectedProvider,model:entry,preferences:{[selectedProvider]:storedPreference('studio.effort.'+selectedProvider+'.'+value)}}));};
   if(threadRef.current&&currentModel?.profileId&&models.find(v=>v.model===value)?.profileId!==currentModel.profileId){onError(t('现有对话不能切换 API 服务商，请新建对话以保护历史记录。'));return;}
   if(selectedProvider==='codex'){setModel(value);selectEffort(models);return;}
  setApplying(true);try{const result=await invoke('agent.rpc',{provider:selectedProvider,method:'model/select',params:{model:value}});if(current()){setModel(value);setModels(result.data||[]);selectEffort(result.data||[]);}}catch(error){if(current())onError(error);}finally{if(current())setApplying(false);}
 }
 async function resume(id:string,seq=++selectionSeq.current,selectedProject=projectId,rebuild=false,readOnly=false){
  attachmentClearRef.current?.();const selectedProvider=providerRef.current,nonce=sessionNonceRef.current,current=()=>seq===selectionSeq.current&&selectedProvider===providerRef.current&&nonce===sessionNonceRef.current;
  const localHistory=!rebuild&&(API_PROVIDER_GROUPS.includes(selectedProvider)||historyEnabled&&(selectedProvider==='deepseek'||readOnly));
  if(localHistory){setConnected(false);setModels([]);setModel('');setEffort('');setNeedsAuth(false);setTools({status:'not_run',count:0});}
  setSendNotice('');selectDraft(selectedProvider,id);setMessages([]);setWorkflowId(null);setHistoryLoad({provider:selectedProvider,threadId:id,projectId:selectedProject,status:'loading'});
  const selectedRpc=(method:string,params?:any)=>invoke<any>('agent.rpc',{provider:selectedProvider,method,params});
  modelCallRef.current=null;setModelCall(null);selectionPending.current=true;pendingResume.current=id;resumeMetadata.current=null;observedTurn.current=null;resolvedRequests.current.clear();setRecovery(null);threadRef.current=null;setThread(null);setApplying(true);setRequests([]);setAnswers({});setUsage(null);setAutoSkillStatus(null);setNewWorkflow(false);setTurn(null);
  try{
   const originalId=id;
   if(rebuild){if(selectedProvider!=='codex')throw Error('Unsupported conversation recovery provider');await invoke('conversation.select',{id:selectedProvider+':'+id});if(!current())return;}
   const r=localHistory?(historyEnabled?null:await selectedRpc('thread/read',{threadId:id,includeTurns:true})):rebuild?await recoverConversation({provider:'codex',threadId:id,...model?{model}:{}}):await selectedRpc('thread/resume',{threadId:id,...historyEnabled&&selectedProvider==='codex'?{excludeTurns:true}:{}});if(!current())return;
   if(r?.studioRecovery?.status==='required'){setRecovery({threadId:id});setMessages([]);setHistoryLoad(null);return;}
   if(r?.studioRecovery?.status==='recovered'){
    const c=r.studioRecovery.conversation;if(selectedProvider!=='codex'||r.studioRecovery.oldThreadId!==id||c?.provider!==selectedProvider||c?.threadId!==r.thread?.id||c?.id!==selectedProvider+':'+r.thread?.id)throw Error('恢复的会话与选中会话不匹配');recoverDraft(selectedProvider,id,c.threadId,r.studioRecovery.uploadsRetained===true);id=c.threadId;
   }
   if(r&&r.thread?.id!==id)throw Error('恢复的会话与选中会话不匹配');
   const saved=sessionSelection?.conversation;
   const conversationId=selectedProvider+':'+id;
   let page:ConversationHistoryPage|null=null,read;
   if(historyEnabled){
    if(!localHistory&&r&&!r.studioRecovery&&saved?.id!==conversationId){
     await invoke<Conversation>('conversation.remember',{provider:selectedProvider,threadId:id,projectId:selectedProject||null,name:r.thread.name||r.thread.preview||'对话'});if(!current())return;
    }
    page=await conversationHistory.page({conversationId});if(!current())return;
    if(page.conversation.id!==conversationId||page.conversation.provider!==selectedProvider||page.conversation.threadId!==id)throw Error('读取的会话与选中会话不匹配');
    const position=readingPositions.current?.read(readingKey(selectedProvider,id));
    const latest=page;
    if(position?.turnId&&!position.follow&&!page.turns.some(turn=>turn.id===position.turnId))try{
     const located=await conversationHistory.locate({conversationId,turnId:position.turnId});
     if(located.conversation.id===conversationId)page={...located,studioSession:latest.studioSession,liveTurn:latest.liveTurn};
    }catch{/* A stale reading anchor can restore to the latest retained page. */}
    if(!current())return;
   }else{
    read=localHistory?r:await selectedRpc('thread/read',{threadId:id,includeTurns:true});if(!current())return;
    if(read.thread?.id&&read.thread.id!==id||read.thread?.provider&&read.thread.provider!==selectedProvider)throw Error('读取的会话与选中会话不匹配');
   }
   const list:Message[]=page?pageMessages(page):replayMessages(read?.thread?.turns||[]);
   const remembered=page?.conversation??(localHistory&&saved?.provider===selectedProvider&&saved.threadId===id?saved:await invoke<Conversation>('conversation.remember',{provider:selectedProvider,threadId:id,projectId:selectedProject||null,name:r.thread.name||r.thread.preview||'对话'}));if(!current())return;
   if(!localHistory){
    const catalog=await selectedRpc('model/list');if(!current())return;if(!Array.isArray(catalog.data))throw Error('Invalid resumed model catalog');setModels(catalog.data);
    const resumedModel=r.model||modelRef.current||catalog.data.find((entry:any)=>entry.isDefault)?.model||catalog.data[0]?.model||'';
    setModel(resumedModel);setEffort(resumedEffort({provider:selectedProvider,preferences:{[selectedProvider]:storedPreference('studio.effort.'+selectedProvider+'.'+resumedModel)||storedPreference('studio.effort.'+selectedProvider)},model:catalog.data.find((entry:any)=>entry.model===resumedModel),serverEffort:r.reasoningEffort}));
   }
   // A background reply can rename this chat while its history or model list is loading.
   const latestRow=resumeMetadata.current as Conversation|null;
   const conversation=latestRow?.id===remembered.id?latestRow:remembered;
   const receipt:SessionTurn|undefined=page?.studioSession??read?.studioSession,latest=observedTurn.current as SessionTurn|null,active=latest?.threadId===id?latest:receipt;
   if(active?.threadId===id){observedTurn.current=active;setBusy(active.busy);setTurn(active.turnId);}
   if(receipt?.requests&&active?.busy){
    const requests=[...new Map([...receipt.requests,...requestsRef.current].filter(request=>!resolvedRequests.current.has(String(request.id))).map(request=>[String(request.id),request])).values()];
    const activeKeys=new Set(requests.filter(isUserInputRequest).map(questionKey));
    for(const [key,{request}] of questionDrafts.current)if((request.provider||'codex')===selectedProvider&&request.params?.threadId===id&&!activeKeys.has(key))questionDrafts.current.delete(key);
    for(const request of requests)if(isUserInputRequest(request))restoreQuestion(request);
    setRequests(requests);
   }else if(!active?.busy)forgetQuestions(selectedProvider,id);
   setThread(id);threadRef.current=id;setSavedHistoryPage(page);setMessages(live=>mergeResumedMessages(list,live));setHistoryLoad(null);setWorkflowId(conversation.taskId);setThreads(old=>[{id, name:conversation.name},...old.filter(value=>value.id!==id&&value.id!==originalId)]);setImportOpen(false);conversationRef.current?.(conversation,nonce);
  }catch(e){if(current()){const error=redactTranscriptText(e instanceof Error?e.message:String(e));if(rebuild)setRecovery({threadId:pendingResume.current||id,error});else setHistoryLoad({provider:selectedProvider,threadId:id,projectId:selectedProject,status:'failed',error});}}finally{if(current()){pendingResume.current=null;selectionPending.current=false;setApplying(false);}}
 }
 useEffect(()=>{
  if(!sessionSelection||handledSelection.current===sessionSelection.nonce)return;handledSelection.current=sessionSelection.nonce;const seq=++selectionSeq.current;
  leaveDisplayedTurn();
  historyOperation.current++;setSavedHistoryPage(null);setPaging(false);setHistoryJump(undefined);setBranchPreview(null);
  if(sessionSelection.conversation){
   const selected=sessionSelection.conversation,owner=drafts.attachmentOwner();
   if(sessionSelection.adoptedDraftId&&owner.provider===selected.provider&&!owner.threadId&&owner.draftId===sessionSelection.adoptedDraftId)drafts.rebind(drafts.capture(),selected.threadId);
   selectDraft(selected.provider,selected.threadId);
  }
  selectionPending.current=true;threadRef.current=null;setThread(null);setMessages([]);setWorkflowId(null);setHistoryLoad(sessionSelection.conversation?{provider:sessionSelection.conversation.provider,threadId:sessionSelection.conversation.threadId,projectId:sessionSelection.conversation.projectId||'',status:'loading'}:null);setApplying(true);
  if(sessionSelection.pending){pendingResume.current=null;return;}
  const activate=async()=>{try{
   if(sessionSelection.new){const preferred=sessionSelection.provider||pendingSetupProvider.current;if(preferred&&preferred!==providerRef.current&&!await selectProvider(preferred,seq,false))return;if(seq!==selectionSeq.current)return;pendingSetupProvider.current=null;resetConversation(false);if(sessionSelection.initialPrompt!==undefined&&seq===selectionSeq.current&&sessionSelection.nonce===sessionNonceRef.current&&!sessionPendingRef.current)updatePrompt(sessionSelection.initialPrompt);if(connected&&(!preferred||preferred===providerRef.current))await connect(false,seq,false,null);return;}
   const selected=sessionSelection.conversation;if(!selected)return;
   const different=selected.provider!==providerRef.current;if(different&&!await selectProvider(selected.provider,seq)){if(seq===selectionSeq.current)setHistoryLoad({provider:selected.provider,threadId:selected.threadId,projectId:selected.projectId||'',status:'failed',error:t('连接尚未恢复，请连接服务商后重试。')});return;}
   if(seq!==selectionSeq.current)return;
   const storedOnly=API_PROVIDER_GROUPS.includes(selected.provider)||historyEnabled&&selected.provider==='deepseek';
   const providerConnected=storedOnly||await connect(false,seq,false,selected.threadId);
   if(seq!==selectionSeq.current)return;
   if(!providerConnected&&!historyEnabled){setHistoryLoad({provider:selected.provider,threadId:selected.threadId,projectId:selected.projectId||'',status:'failed',error:t('连接尚未恢复，请连接服务商后重试。')});return;}
   await resume(selected.threadId,seq,selected.projectId||'',false,!providerConnected);
  }finally{if(seq===selectionSeq.current){selectionPending.current=false;setApplying(false);}}};void activate();
 },[sessionSelection?.nonce]);
 useEffect(()=>{
  if(!intent||intent.autoSend||handledDraftIntents.current.has(intent.id))return;
  const owner=drafts.owner();
  if(intent.provider&&intent.provider!==owner.provider||intent.threadId&&intent.threadId!==owner.threadId){const selected=sessionSelection?.conversation;if(!selected||intent.provider&&intent.provider!==selected.provider||intent.threadId&&intent.threadId!==selected.threadId)handledDraftIntents.current.add(intent.id);return;}
  handledDraftIntents.current.add(intent.id);
  proposePrompt(intent.text);
 },[intent?.id,sessionSelection?.nonce,thread,provider,busy]);
 useEffect(()=>{if(pendingDefaults||!intent?.autoSend||consumedIntent.current===intent.id||busy||queueComposer||requestsRef.current.some(isUserInputRequest)||applying||connecting||!localApiThread&&(!connected||!models.length)||terminalSelected&&!terminalReady&&!canAcquireTerminal||(intent.threadId&&thread!==intent.threadId)||(intent.provider&&providerRef.current!==intent.provider))return;consumedIntent.current=intent.id;void send(intent.text,{reviewMode:intent.reviewMode,taskId:intent.taskId});},[intent?.id,connected,busy,applying,connecting,thread,localApiThread,models.length,terminalReady,canAcquireTerminal,pendingDefaults,requests.length,followUpQueues]);
 async function send(textOverride?:string,action:{reviewMode?:boolean;taskId?:string}={}){
  if(pendingDefaults)return;
  const reconnectHistory=localApiThread&&(!connected||!models.length);
  const fileRefs=textOverride===undefined?drafts.files():[];
  if(fileRefs.some(file=>file.kind==='image')&&currentModel?.inputModalities&&!currentModel.inputModalities.includes('image')){setSendNotice(t('当前模型仅支持文字，请更换模型或移除图片。'));return;}
  if(readingFiles.current.has(drafts.capture().entry))return;
  const text=textOverride??(prompt.trim()?prompt:attachmentPrompt(fileRefs));if(needsAuth&&!reconnectHistory){openAccounts();return;}if(!text.trim()||busy||observedTurn.current?.busy||requestsRef.current.some(isUserInputRequest)||sendOwner.current||activeSend.current)return;
  const turnPlanning=planningRef.current;
  if(applying||connecting||selectionPending.current||historyHidden||handledSelection.current!==sessionNonceRef.current){setSendNotice(t('正在恢复会话，请稍后发送。'));return;}
  if(recovery){setSendNotice(t('请先恢复当前对话，输入草稿已保留。'));return;}
  if(!reconnectHistory&&(!connected||!models.length)){setSendNotice(t('请先连接服务商并选择模型。'));return;}
  if(drafts.owner().provider!==providerRef.current||drafts.owner().threadId!==threadRef.current){setSendNotice(t('当前对话尚未恢复，输入草稿已保留。'));return;}
  let acquiring=false,turnTerminal=terminalSelected,turnWorkflowResource=workflowResource,waitingForConnection=reconnectHistory;
  function checkTurnResource(){
   const resource=resourceRef.current,state=toolsRef.current;
   acquiring=turnTerminal&&resource?.kind==='ssh-connection'&&resource.canAcquireConversationTerminal===true&&!sshResourceReady(resource,state);
   if(turnTerminal&&(resource?.status!=='selected'||resource.alive!==true)){setSendNotice(t('所选 SSH 终端不可用，请在终端核对或重新选择。'));return false;}
   if(turnTerminal&&!acquiring&&!sshResourceReady(resource,state)){setSendNotice(t(terminalNotice));return false;}
   if(!acquiring&&(turnPlanning||workflowId||action.reviewMode)&&state.status==='blocked'&&(state.managedCompute!==true||action.reviewMode)&&(!turnTerminal||turnWorkflowResource)){setSendNotice(t(state.message||'请先修复科学工具连接'));onError(t(state.message||'请先修复科学工具连接'));return false;}
   return true;
  }
  if(!reconnectHistory&&!checkTurnResource())return;
  const attachment=skill,selectedProvider=providerRef.current,seq=selectionSeq.current,nonce=sessionNonceRef.current,draft=drafts.capture(),manual=textOverride===undefined,resourceSelection=resourceRef.current?.selectionId||null;
  let resourceWorkflow=resourceRef.current?.workflowReady===true,resourceGranted=resourceRef.current?.agentReady===true;
  let route=toolsRef.current.scope;const routeState=(resource:ComputeResourceState|null|undefined)=>resource?.kind==='ssh-connection'?JSON.stringify(route==='terminal-only'?resource.capabilities?.terminal:resource.capabilities?.service):null;let resourceRoute=routeState(resourceRef.current);
  const current=()=>seq===selectionSeq.current&&selectedProvider===providerRef.current&&nonce===sessionNonceRef.current&&resourceSelection===(resourceRef.current?.selectionId||null)&&(waitingForConnection||(resourceRef.current?.kind==='ssh-connection'?acquiring||route===toolsRef.current.scope&&resourceRoute===routeState(resourceRef.current):resourceWorkflow===(resourceRef.current?.workflowReady===true)&&resourceGranted===(resourceRef.current?.agentReady===true)));
  const selectedRpc=(method:string,params?:any)=>invoke<any>('agent.rpc',{provider:selectedProvider,method,params});
  const owner=Symbol(),flight:SendFlight={owner,provider:selectedProvider,threadId:threadRef.current,turnId:null,phase:'preparing',cancelled:false,interrupting:false,interruptSent:false,settled:false,draftAccepted:false,manual,current,draft,text};
  sendOwner.current=owner;activeSend.current=flight;
  const preparing=()=>activeSend.current===flight&&current()&&!flight.cancelled;
  let acknowledged=false,optimisticId:string|null=null;
  setSendNotice('');setStopStatus(null);setRetrying(null);setBusy(true);
  const retainRequest=()=>{if(!manual&&drafts.retain(draft,text))setPrompt(drafts.text());};
  try{
   let id=threadRef.current;
   let turnModel=model,turnEffort=effort;
   if(reconnectHistory){
    const ready=await connect(false,seq,false,id);if(!preparing())return;
    if(!ready){retainRequest();return;}
    turnModel=modelRef.current;turnEffort=effortRef.current;
    const resource=resourceRef.current,state=toolsRef.current;
    turnTerminal=resource?.kind==='ssh-terminal'||state.managedCompute!==true&&resource?.kind==='ssh-connection';
    turnWorkflowResource=turnTerminal&&resource?.authentication==='verified'&&(resource.kind==='ssh-connection'?state.scope!=='terminal-only'&&resource.capabilities?.service.workflowReady===true:resource.workflowReady===true&&resource.managedRuns===true);
    route=state.scope;resourceRoute=routeState(resource);resourceWorkflow=resource?.workflowReady===true;resourceGranted=resource?.agentReady===true;waitingForConnection=false;
    if(!checkTurnResource()){retainRequest();return;}
   }
   if(!id){const r=await selectedRpc('thread/start',{model:turnModel||undefined,...fileRefs.length?{studioAttachmentDraftId:drafts.attachmentOwner().draftId}:{},...(turnTerminal && projectId ? {studioInitialProjectId:projectId} : {})});if(!preparing())return;id=r.thread.id;}
   else if(acquiring){const r=await selectedRpc('thread/resume',{threadId:id});if(!preparing())return;if(r.studioRecovery?.status==='required'){setRecovery({threadId:id});return;}id=r.thread.id;}
   flight.threadId=id;
   if(acquiring){
    const [state,toolsState]=await Promise.all([invoke<ComputeResourceState>('compute.resource.status',{}),invoke('agent.tools',{provider:selectedProvider})]);
    if(!preparing()||state.selectionId!==resourceSelection)return;
    if(!sshResourceReady(state,toolsState)){setSendNotice(t(terminalNotice));return;}
    resourceRef.current=state;onComputeResource?.(state);toolsRef.current=toolsState;route=toolsState.scope;resourceRoute=routeState(state);acquiring=false;setTools(toolsState);
   }
   const conversation=await invoke<Conversation>('conversation.remember',{provider:selectedProvider,threadId:id,projectId:projectId||null,groupId:conversationGroupId||null,intent:text});if(!preparing())return;conversationRef.current?.(conversation,nonce);drafts.rebind(draft,id!);setPrompt(drafts.text());setThread(id);threadRef.current=id;setThreads(old=>[{id,name:conversation.name},...old.filter(value=>value.id!==id)]);
   if(turnTerminal&&!sshResourceReady(resourceRef.current,toolsRef.current)){setSendNotice(t(terminalNotice));return;}
   let taskId=action.taskId||conversation.taskId;
   const fresh=newWorkflow||explicitNewWorkflow(text);
   if((turnPlanning||fresh)&&!action.reviewMode&&(!turnTerminal||resourceRef.current?.workflowReady)&&toolsRef.current.scope!=='terminal-only'){
    const task=await invoke('task.create',{workflowVersion:2,planningMode:true,newWorkflow:fresh,threadId:id,provider:selectedProvider,request:text,projectId:conversation.projectId??null});
    if(!preparing())return;taskId=task.id;openTaskRef.current?.(task.id);
   }
   if(turnTerminal&&!sshResourceReady(resourceRef.current,toolsRef.current)){setSendNotice(t(terminalNotice));return;}
   setWorkflowId(taskId||null);setNewWorkflow(false);
    followLatest();setMessages(prev=>[...prev,{id:(optimisticId=crypto.randomUUID()),role:'user',text,...fileRefs.length?{files:fileRefs}:{},justSent:true}]);
   const input:any[]=[{type:'text',text},{type:'text',text:workspaceContextHeader+'\n'+context}];if(attachment&&'path' in attachment)input.push({type:'skill',name:attachment.name,path:attachment.path});
   const call:ModelCall={requestId:crypto.randomUUID(),provider:selectedProvider,model:turnModel,threadId:id!,turnId:null,output:false,status:'in_progress'};modelCallRef.current=call;setModelCall({...call});
   if(!preparing())return;flight.phase='submitted';
   const r=await selectedRpc('turn/start',{studioTurnRequestId:call.requestId,...fileRefs.length?{studioAttachments:fileRefs.map(file=>file.id)}:{},...attachment&&'functionId' in attachment?{studioSkillId:attachment.functionId}:{},planningMode:turnPlanning,reviewMode:!!action.reviewMode,...taskId?{studioTaskId:taskId}:{},threadId:id,input,model:turnModel||undefined,effort:turnEffort||undefined});
   if(typeof r.turn?.id==='string'&&r.turn.id){
    if(flight.turnId&&flight.turnId!==r.turn.id)throw Error('Agent acknowledged a different turn');
    acknowledged=true;flight.turnId=r.turn.id;acceptDraft(flight);
    if(flight.cancelled)void interruptFlight(flight);
   }
   if(!current()||activeSend.current!==flight){
    if(acknowledged&&current()&&modelCallRef.current===call&&attachment)attachmentConsumedRef.current?.(attachment.attachmentId);
    return;
   }
   if(r.studioRecovery?.status==='required'){setRecovery({threadId:r.studioRecovery.oldThreadId});retainRequest();if(modelCallRef.current===call){call.status='failed';setModelCall({...call});}return;}
   if(!acknowledged)throw Error('Agent did not acknowledge the submitted message');
   if(modelCallRef.current===call){
    if(attachment)attachmentConsumedRef.current?.(attachment.attachmentId);
    call.turnId=r.turn.id;
   }
   observedTurn.current={threadId:flight.threadId!,busy:true,turnId:flight.turnId};
   setTurn(flight.turnId);
  }catch(error){
   if(!current()||activeSend.current!==flight)return;
   if(!flight.turnId){
    retainRequest();if(optimisticId)setMessages(prev=>prev.filter(message=>message.id!==optimisticId));
    const call=modelCallRef.current;
    if(call?.provider===selectedProvider&&call.threadId===flight.threadId){call.status='failed';setModelCall({...call});}
   }
   messageCallbacks.current.onError(error);
  }finally{
   if(sendOwner.current===owner)sendOwner.current=null;
   if(activeSend.current===flight&&!acknowledged&&!flight.turnId){releaseSend(flight);setBusy(false);setStopStatus(null);}
  }
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
 function canRespond(request:RpcEvent){
  const key=requestScope(request),owner=requestOwners.current.get(request)!;
  return !sessionPendingRef.current&&!selectionPending.current&&owner.sequence===selectionSeq.current&&owner.nonce===sessionNonceRef.current&&!responseFlights.current.has(key)&&requestsRef.current.includes(request)&&(!request.provider||request.provider===providerRef.current)&&(!request.params?.threadId||request.params.threadId===threadRef.current);
 }
 function changeQuestion(request:RpcEvent,index:number,update:(current:QuestionProgress)=>QuestionProgress,submit=false){
  if(!canRespond(request)||requestsRef.current.find(isUserInputRequest)!==request)return;
  const draft=questionDrafts.current.get(questionKey(request));
  if(draft?.request!==request||draft.pending||draft.progress.index!==index)return;
  const next=update(draft.progress);
  if(!submit){draft.progress=next;redrawQuestions(value=>value+1);return;}
  const questions=composerQuestionItems(request),finished=(id:string)=>{const answer=next.answers[id];return answer&&(answer.kind==='skipped'||answer.value.trim());};
  if(!finished(questions[index].id))return;
  const nextIndex=index<questions.length-1?index+1:questions.findIndex(question=>!finished(question.id));
  draft.progress=nextIndex<0?next:{...next,index:nextIndex,highlight:undefined};
  redrawQuestions(value=>value+1);
  if(nextIndex>=0)return;
  if(request.method==='studio/question'){
   const answer=next.answers[questions[0].id];void respond(request,answer.kind==='choice'?{optionId:answer.value}:{});return;
  }
  const answers=Object.fromEntries(questions.flatMap(({id})=>{const answer=next.answers[id];return answer.kind==='skipped'?[]:[[id,{answers:[answer.kind==='text'?answer.value.trim():answer.value]}]];}));
  void respond(request,{answers});
 }
 async function respond(request:RpcEvent,result:any){
   if(!canRespond(request))return;
   const key=requestScope(request),selectedProvider=providerRef.current,selectedThread=threadRef.current,seq=selectionSeq.current,nonce=sessionNonceRef.current;
   const questionId=questionKey(request),question=isUserInputRequest(request)?questionDrafts.current.get(questionId):undefined;
   if(question?.pending)return;
   if(question)question.pending=true;
   const current=()=>seq===selectionSeq.current&&nonce===sessionNonceRef.current&&selectedProvider===providerRef.current&&selectedThread===threadRef.current&&requestsRef.current.includes(request);
   responseFlights.current.add(key);setResponding(previous=>new Set(previous).add(key));
   try{
    await invoke('agent.respond',{provider:selectedProvider,threadId:selectedThread,id:request.id,result});
    if(question&&questionDrafts.current.get(questionId)===question){questionDrafts.current.delete(questionId);setRequests(prev=>prev.filter(r=>r!==question.request));}
    if(current()){clearAnswers(key);setRequests(prev=>prev.filter(r=>r!==request));}
   }catch(e){if(current())onError(e);}finally{
    responseFlights.current.delete(key);
    if(question&&questionDrafts.current.get(questionId)===question){question.pending=false;redrawQuestions(value=>value+1);}
    if(seq===selectionSeq.current&&nonce===sessionNonceRef.current)setResponding(previous=>{const next=new Set(previous);next.delete(key);return next;});
   }
 }
 const providerLabel=provider==='codex'?'Codex':provider==='kimi'?'Kimi':provider==='deepseek'?'DeepSeek API':provider==='compatible'?t('自定义 API'):'Qwen';
 const optionSummary=[providerLabel,models.find(m=>m.model===model)?.displayName||model,effort].filter(Boolean).join(' · ');
 const composerOwner=drafts.owner(),composerUnbound=composerOwner.provider!==provider||composerOwner.threadId!==thread;
 const historyHidden=!!historyLoad||!!(sessionSelection&&handledSelection.current!==sessionSelection.nonce)||!!sessionSelection?.pending;
 const composerQuestions=historyHidden?[]:requests.filter(isUserInputRequest);
 const jumpRequest=attentionTarget?.provider===provider&&attentionTarget.threadId===thread&&'requestId' in attentionTarget.target
  &&attentionTarget.target.kind==='question'?attentionTarget.target:undefined;
 const composerQuestion=composerQuestions.find(request=>jumpRequest&&String(request.id)===jumpRequest.requestId&&
  (!request.params?.turnId||request.params.turnId===jumpRequest.turnId))||composerQuestions[0];
 const questionDraft=composerQuestion?questionDrafts.current.get(questionKey(composerQuestion)):undefined;
 const sessionWorkspaceProfile=workspaceProfileId||(computeResource?.kind==='ssh-connection'?computeResource.profileId:null);
 const localConversation=sessionSelection?.pending?null:selectedLocalConversation===undefined?sessionSelection?.conversation||(thread?{provider,threadId:thread}:null):selectedLocalConversation;
 const localOwner=localConversation?JSON.stringify([localConversation.provider,localConversation.threadId,sessionWorkspaceProfile,computeResource?.selectionId]):null;
 const localOwnerRef=useRef(localOwner);localOwnerRef.current=hidden?null:localOwner;
 const localNonce=sessionSelection?.nonce;
 const localCurrent=()=>!!localOwner&&localOwnerRef.current===localOwner&&localNonce===sessionNonceRef.current&&!sessionPendingRef.current&&isLocalConversationCurrent?.()!==false;
 const missingTool=!composerQuestion&&localConversation&&missingWorkflowToolQuestion?.provider===localConversation.provider&&missingWorkflowToolQuestion.threadId===localConversation.threadId?missingWorkflowToolQuestion:null;
 const setupToolLabel=t('让 Agent 配置');
 const missingRequest:RpcEvent|null=missingTool?{method:'item/tool/requestUserInput',id:missingTool.id,params:{questions:[{id:'action',question:t('流程缺少工具')+' · '+missingTool.tool,options:[{label:setupToolLabel},{label:t('稍后')}]}]}}:null;
 const queueKey=thread&&localConversation?.provider===provider&&localConversation.threadId===thread?followUpKey(provider,thread):null;
 const queue=queueKey?followUpQueues[queueKey]:undefined;
 const queueItems=queue?.items??[];
 const queueFlight=queueItems.some(item=>item.status==='preparing'||item.status==='submitting');
 const queueComposer=busy||(!queue?.pause&&queueItems.length>0);
 const followUpCurrent=()=>mounted.current&&!!queueKey&&localCurrent()&&threadRef.current===thread&&providerRef.current===provider
  &&handledSelection.current===sessionNonceRef.current&&!selectionPending.current&&!historyHidden&&!composerUnbound;
 const followUpControlsReady=followUpCurrent()&&!applying&&!connecting&&!pendingDefaults&&!recovery&&!stopStatus
  &&!requestsRef.current.some(isUserInputRequest)&&!missingRequest&&!sendOwner.current&&!steering.current.has(queueKey??'')
  &&!queueAdmission.current.get(queueKey??'')?.pending;
 const queueAllowed=followUpControlsReady&&(!!turn||queueItems.length>0);
 const canSteer=provider!=='kimi'&&(connected||localApiThread)&&followUpControlsReady&&busy&&!!turn
  &&!settledTurns.current.has(turn)&&!queueFlight;

 async function queueRpc(action:AgentQueueAction){
  if(!thread)throw Error('A saved conversation is required');
  const request:AgentQueueRequest={provider,threadId:thread,...action};
  const result=await invoke<AgentQueueResult>('agent.queue',request);
  if(!result?.queue||result.queue.provider!==provider||result.queue.threadId!==thread)throw Error('Follow-up receipt belongs to another conversation');
  if(mounted.current)acceptQueue(result.queue);
  return result;
 }
 function queueError(error:unknown){
  if(followUpCurrent())setSendNotice(redactTranscriptText(error instanceof Error?error.message:String(error)));
 }
 useEffect(()=>{
  if(!queueKey||!thread||!followUpCurrent())return;
  const legacy=readLegacyFollowUps(()=>localStorage,provider,thread);
  const draft=drafts.capture(),fingerprint=JSON.stringify([draft.text,draft.files.map(file=>file.id)]);
  const pendingId=readQueueAdmission(()=>localStorage,queueKey,fingerprint);
  void (async()=>{
   if(legacy.length){
    await queueRpc({action:'import',items:legacy});
    forgetLegacyFollowUps(()=>localStorage,provider,thread);
   }
   const result=await queueRpc({action:'read',...(pendingId?{pendingId}:{})});
   if(pendingId&&result.admitted&&mounted.current){
    if(drafts.acknowledge(draft)&&followUpCurrent())setPrompt(drafts.text());
    forgetQueueAdmission(()=>localStorage,queueKey,pendingId);
   }
  })().catch(queueError);
 },[queueKey,historyHidden,composerUnbound,hidden,sessionSelection?.nonce]);

 async function enqueuePrompt(){
  if(draftImageMismatch){setSendNotice(t('当前模型仅支持文字，请更换模型或移除图片。'));return;}
  if(!queueKey||!queueAllowed||!followUpCurrent()||sendOwner.current||steering.current.has(queueKey)||queueAdmission.current.get(queueKey)?.pending)return;
  const draft=drafts.capture();
  if(readingFiles.current.has(draft.entry))return;
  if(!draft.text.trim()&&!draft.files.length)return;
  const prior=queueAdmission.current.get(queueKey),fingerprint=JSON.stringify([draft.text,draft.files.map(file=>file.id)]);
  const previousId=prior&&prior.draft.entry===draft.entry&&prior.draft.revision===draft.revision?prior.id:readQueueAdmission(()=>localStorage,queueKey,fingerprint);
  const id=previousId??crypto.randomUUID();
  const item:QueueMessageInput={id,text:draft.text.trim()?draft.text:'',context,planningMode:planningRef.current,newWorkflow,
   ...(modelRef.current?{model:modelRef.current}:{}),...(effortRef.current?{effort:effortRef.current}:{}),
   ...(skill?{skill:'path' in skill?{name:skill.name,path:skill.path!}:{name:skill.name,functionId:skill.functionId}}:{}),
   ...(draft.files.length?{files:draft.files}:{}),
  };
  const admission={draft,id,pending:true};
  rememberQueueAdmission(()=>localStorage,queueKey,id,fingerprint);
  queueAdmission.current.set(queueKey,admission);refreshFollowUps();
  try{
   await queueRpc({action:'enqueue',after:turn,item});
   queueAdmission.current.delete(queueKey);
   if(!mounted.current)return;
   const cleared=drafts.acknowledge(draft);
   forgetQueueAdmission(()=>localStorage,queueKey,id);
   if(skill)attachmentConsumedRef.current?.(skill.attachmentId);
   if(followUpCurrent()){
    if(cleared)setPrompt(drafts.text());
    setSendNotice('');setNewWorkflow(false);
   }
  }catch(error){
   admission.pending=false;queueError(error);
  }finally{if(mounted.current)refreshFollowUps();}
 }

 async function steer(item?:QueuedMessage){
  if(provider==='kimi'||!queueKey||!thread||!followUpCurrent()||steering.current.has(queueKey))return;
  const draft=drafts.capture(),text=item?.text??draft.text;
  if(!item&&readingFiles.current.has(draft.entry))return;
  if(!text.trim()||(item?!item.steerable||item.status!=='queued':skill||newWorkflow||draft.files.length))return;
  if(!canSteer||!turn||settledTurns.current.has(turn)){
   setSendNotice(t('当前回复无法接收引导，消息已保留。'));
   return;
  }
  const request:AgentSteerRequest={provider,method:'turn/steer',params:{threadId:thread,expectedTurnId:turn,clientUserMessageId:crypto.randomUUID(),
   input:[{type:'text',text}],planningMode:planningRef.current}};
  steering.current.add(queueKey);refreshFollowUps();setSendNotice('');
  try{
   const result=item?await queueRpc({action:'steer',id:item.id,turnId:turn}):await invoke<AgentSteerResult>('agent.rpc',request);
   if(result?.turnId!==turn)throw Error(t('当前回复未确认引导。'));
   if(!item&&mounted.current&&drafts.acknowledge(draft)&&followUpCurrent())setPrompt(drafts.text());
   if(followUpCurrent()){
    followLatest();
    if(!item)setMessages(previous=>[...previous,{id:request.params.clientUserMessageId,role:'user',text,turnId:turn,
     clientUserMessageId:request.params.clientUserMessageId,justSent:true}]);
    setSendNotice(t('引导已发送到当前回复。'));
   }
  }catch{
   if(followUpCurrent())setSendNotice(t(settledTurns.current.has(turn)?'当前回复已结束，引导结果待核对，消息已保留。':'引导结果待核对，消息已保留。'));
  }finally{
   steering.current.delete(queueKey);
   if(mounted.current)refreshFollowUps();
  }
 }

 async function queueAction(action:AgentQueueAction,id=queueKey){
  if(!id||!followUpCurrent()||queueOperations.current.has(id))return;
  queueOperations.current.add(id);refreshFollowUps();
  try{return await queueRpc(action);}
  catch(error){queueError(error);}
  finally{queueOperations.current.delete(id);if(mounted.current)refreshFollowUps();}
 }

 async function removeQueued(item:QueuedMessage,restoreText=false){
  if(!thread||!followUpCurrent()||queueOperations.current.has(item.id))return;
  if(restoreText){
   if(readingFiles.current.has(drafts.capture().entry))return;
   try{
    setPrompt(drafts.appendToDraft(provider,thread,item.text,item.files??[],{requireStorage:true}));
    refreshFiles();
   }catch(error){queueError(error);return;}
  }
  const result=await queueAction({action:'remove',id:item.id},item.id);
  if(restoreText&&followUpCurrent())setSendNotice(result?(item.attachmentReview?t('对话已变化。请重新选取附件。'):''):t('草稿已保留。请核对队列中的原消息。'));
 }
 async function saveQueueEdit(item:QueuedMessage){
  if(!queueEdit||queueEdit.owner!==queueKey||queueEdit.id!==item.id)return;
  const text=queueEdit.text.trim()?queueEdit.text:'';
  if(await queueAction({action:'edit',id:item.id,text},item.id))setQueueEdit(null);
 }
 async function checkQueuedDelivery(item:QueuedMessage){
  const result=await queueAction({action:'reconcile',id:item.id},item.id);
  if(result&&followUpCurrent())setSendNotice(t(result.turnId?'已在原对话找到此消息的回执。':'未找到可核对的投递回执，消息仍保留。'));
 }

 const queueNotice=queue?.pause==='changed'?t('发送环境已变化，可以把消息移回草稿。'):
  queue?.pause==='unconfirmed'?t('有消息的发送结果待核对，队列已暂停。'):
  queue?.pause==='restored'?t('队列已恢复，核对后可继续发送。'):
  queue?.pause?t('队列已暂停。'):queueFlight?t('正在发送排队消息…'):
  queue?.after?t('等待当前回复完成'):t('等待发送');
 const queueCanResume=!!queue?.pause&&!busy&&!queueFlight&&!queueItems.some(item=>item.status==='unconfirmed')&&followUpControlsReady;
 const draftImageMismatch=drafts.files().some(file=>file.kind==='image')&&currentModel?.inputModalities&&!currentModel.inputModalities.includes('image');
 const draftHasFiles=drafts.files().length>0,fileImportBusy=readingFiles.current.has(drafts.capture().entry);
 const supportsDraftSteer=busy&&provider!=='kimi'&&!skill&&!newWorkflow&&!draftHasFiles;
 const queueHint=t(busy&&!turn?'回复开始后可以排队':!supportsDraftSteer?'Enter 排队 · Shift+Enter 换行':
  followUpEnter==='steer'?'Enter 引导 · Ctrl/Cmd+Enter 排队 · Shift+Enter 换行':'Enter 排队 · Ctrl/Cmd+Enter 引导 · Shift+Enter 换行');
 const steerDraftAllowed=!fileImportBusy&&canSteer&&supportsDraftSteer&&!!prompt.trim();
 function sendFromComposer(alternate=false){
  if(!queueComposer){void send();return;}
  const action=alternate?(followUpEnter==='queue'?'steer':'queue'):followUpEnter;
  if(action==='steer'&&supportsDraftSteer)void steer();
  else void enqueuePrompt();
 }
 function stopWithQueue(){
  const mainPreparing=queueFlight&&!activeSend.current&&!turn;
  if(queueItems.length)void queueAction({action:'pause',stop:mainPreparing});
  if(!mainPreparing)stopSend();
 }
 const stopTitle=t(stopStatus==='waiting'?'确认提交中':stopStatus==='stopping'?'等待停止确认':stopStatus==='unknown'?'再次请求停止':activeSend.current?.phase==='preparing'?'取消发送准备':'中断 Agent，计算作业继续');
 const stopControl=busy?<button type="button" className="send agent-stop-action" data-testid="agent-stop" disabled={stopStatus==='waiting'||stopStatus==='stopping'||!activeSend.current&&!turn&&!queueFlight} title={stopTitle} aria-label={stopTitle} onClick={stopWithQueue}>
  <Square size={13}/><span>{t(stopStatus==='waiting'?'确认提交中':stopStatus==='stopping'?'等待停止确认':stopStatus==='unknown'?'再次停止':activeSend.current?.phase==='preparing'?'取消准备':'停止')}</span>
 </button>:null;
 return <aside className="agent-panel" style={{width,display:hidden?'none':undefined}}>
  <div className={"agent-top-surface"+(options?" is-expanded":"")}>
  <div className="panel-heading agent-heading"><span className="agent-heading-title"><Sparkles size={16}/>{threads.find(value=>value.id===thread)?.name||tr("科研助手")}</span>{!options&&<span className="agent-collapsed-summary" data-testid="agent-options-summary" title={optionSummary}>{optionSummary}</span>}<div className="agent-header-actions">{onOpenHistory&&<button className="icon-button" data-testid="agent-history" aria-label={t('历史会话')} title={t('历史会话')} onClick={onOpenHistory}><History size={16}/></button>}{onCollapse&&<button className="icon-button" aria-label={t('收起助手')} title={t('收起助手')} onClick={onCollapse}><PanelRightClose size={16}/></button>}<button className="icon-button" data-testid="agent-options" title={t("Agent 选项")} aria-label={t("Agent 选项")} aria-expanded={options} aria-controls="agent-options-region" onClick={()=>setOptions(!options)}><Settings2 size={16}/></button>{!onNewConversation&&<button className="icon-button" data-testid="agent-new-conversation-fallback" title={tr("新会话")} aria-label={tr("新会话")} onClick={()=>resetConversation()} disabled={busy||connecting||applying}><Plus size={17}/></button>}</div></div>
  <div className="agent-configuration" data-testid="agent-configuration" hidden={!options&&connected&&(managedToolState?!managedToolsBlocked:tools.status!=='blocked')}>
   <div id="agent-options-region" role="region" aria-label={t("Agent 选项")} hidden={!options}>
   <div className="agent-primary">
    <div className="agent-provider"><label>{t("服务商")}<select data-testid="agent-provider" value={provider} disabled={busy||connecting||applying} onChange={e=>void selectProvider(e.target.value as AgentProvider)}><option value="codex">Codex</option><option value="kimi">Kimi</option><option value="qwen">Qwen</option><option value="deepseek">DeepSeek API</option><option value="compatible">{t('自定义 API')}</option></select></label></div>
    {connected?<div className="agent-model-controls"><label className="agent-model-field">{t("模型")}<select data-testid="agent-model" value={model} disabled={busy||applying} onChange={e=>void selectModel(e.target.value)}>{!models.length&&<option value="">{t("登录后加载模型目录")}</option>}{models.map(m=><option key={m.id} value={m.model}>{m.providerName?m.providerName+' · ':''}{m.displayName||m.model}</option>)}</select></label><label className="agent-effort-field">{provider==='codex'?'Effort':t('思考设置')}<select data-testid="agent-effort" value={effort} disabled={!connected||busy||applying} onChange={e=>setEffort(e.target.value)}>{!efforts.length&&<option value="">{t('模型默认')}</option>}{efforts.map((e:any)=><option key={e.reasoningEffort} value={e.reasoningEffort}>{provider==='deepseek'?t(e.reasoningEffort==='none'?'快速 · 关闭思考':e.reasoningEffort==='low'?'思考 · 低':e.reasoningEffort==='high'?'思考 · 高':'思考 · 最大'):e.reasoningEffort}</option>)}</select></label></div>:null}
   </div>
   {options&&<div className="agent-options-content" id="agent-options-content" role="region" aria-label={t("Agent 选项")}>
    <section className="agent-option-section"><div className="agent-option-heading"><h4>{t('连接与调用状态')}</h4>{connected&&<button className="text-button" disabled={busy||connecting||applying} onClick={openAccounts}>{t('管理账号')}</button>}</div>{connected?<div className="provider-account" data-testid="provider-access"><span>{t(modelCall?.status==='passed'&&modelCall.provider===provider&&modelCall.model===model&&modelCall.threadId===thread?'当前模型调用已验证':modelCall?.status==='failed'?'当前模型调用未通过':'当前模型调用尚未验证')}</span>{account?.modelAccess==='passed'&&<small>{t('此服务商曾成功回复')}</small>}<small>{t(account?.account?'账户信息可用':account?.credentialStored?'已保存凭据':'账户信息未返回')}</small><small>{t('会话已连接')}</small></div>:<p className="muted">{t('连接服务商后开始协作…')}</p>}</section>
    <section className="agent-option-section">
     <label className="agent-follow-up-preference"><span>{t('回复期间按 Enter')}</span>
      <select data-testid="agent-follow-up-enter-mode" value={followUpEnter} onChange={e=>{
       const action=e.target.value==='steer'?'steer':'queue';
       setFollowUpEnter(action);storePreference(followUpEnterStorageKey,action);
      }}><option value="queue">{t('排队')}</option><option value="steer">{t('引导')}</option></select>
     </label>
    </section>
    <section className="agent-option-section"><h4>{t('上下文设置')}</h4><div className="context-usage">{usage?t("上下文")+" "+(usage.last?.totalTokens?.toLocaleString()||t("未知"))+" / "+(usage.modelContextWindow?.toLocaleString()||t("未知"))+" tokens":t("上下文用量：等待服务回报")}</div>{provider==='codex'?<div className="context-options"><label>{t('上下文预算 · tokens')}<input type="number" min={1024} placeholder={t('模型默认')} value={contextWindow} disabled={busy||applying} onChange={e=>{setContextWindow(e.target.value);setApplied('');}}/></label><label>{t('自动压缩阈值 · tokens')}<input type="number" min={1024} placeholder={t('模型默认')} value={compactLimit} disabled={busy||applying} onChange={e=>{setCompactLimit(e.target.value);setApplied('');}}/></label><small>{t('预算不会扩大模型本身的最大容量。应用后恢复当前会话，计算作业继续运行。')}</small><button className="button" data-testid="agent-context-apply" disabled={busy||applying} onClick={()=>void applyOptions()}>{tr(applying?t('应用中…'):t('应用上下文设置'))}</button>{applied&&<small role="status">{applied}</small>}</div>:<p className="muted">{t('此提供方通过协议回报上下文，暂不支持修改预算')}</p>}</section>
    {workflowId&&<section className="agent-option-section"><h4><Tooltip content={t('此对话已绑定流程，可直接用自然语言调整')}>{t('计算流程')}</Tooltip></h4><button className="button" data-testid="agent-new-workflow" disabled={busy||applying} onClick={()=>setNewWorkflow(v=>!v)}>{t(newWorkflow?'取消新建流程':'新建流程')}</button></section>}
    {connected&&<section className="agent-option-section external-session-import"><button className="text-button" data-testid="agent-import-existing" disabled={busy||applying||connecting||importLoading} onClick={()=>importOpen?setImportOpen(false):void importExisting()}>{t(importOpen?'收起会话导入':'导入已有 Agent 会话')}</button>{importOpen&&<div>{importLoading?<small>{t('读取会话目录中…')}</small>:<><small>{t('仅导入选中的会话，不修改外部记录。')}</small><select aria-label={t('选择外部会话导入')} value="" disabled={busy||applying} onChange={e=>{if(e.target.value)void resume(e.target.value);}}><option value="">{t('请选择')}</option>{externalThreads.filter(value=>!threads.some(known=>known.id===value.id)).map(value=><option key={value.id} value={value.id}>{value.name||value.preview?.slice(0,48)||value.id.slice(0,12)}</option>)}</select></>}</div>}</section>}
    <section className="agent-option-section"><h4>{t(terminalSelected?'当前计算资源':managedToolState?'托管计算工具':'科学工具连接')}</h4>
     {managedToolState?<div className="agent-tools-status" data-testid="agent-tools-status" data-status={managedToolState.status} data-scope="managed"><span><i className={'flow-dot '+(managedToolState.status==='ready'?'ready':'missing')}/>{t(managedToolState.status==='ready'?'托管计算工具通道已连接':managedToolState.status==='blocked'?'托管计算工具待修复':'托管计算工具待核对')}</span></div>:<div className="agent-tools-status" data-testid="agent-tools-status" data-status={terminalSelected&&!terminalReady?'blocked':tools.status} data-scope={tools.scope}><span><i className={'flow-dot '+((terminalSelected?terminalReady:tools.status==='ready')?'ready':'missing')}/>{t(terminalSelected?!terminalGranted?(workflowResource?'SSH 作业服务待交接':'SSH 终端待交接'):workflowResource?(terminalReady?'SSH 工作流工具已连接':'请重新连接服务商'):(terminalReady?'共享终端可用':'终端工具待连接'):tools.scope==='terminal-only'?'共享终端可用':tools.status==='ready'?'科学工具通道已连接':tools.status==='blocked'?'科学工具未就绪':'科学工具待连接')}</span>{tools.status==='blocked'&&<small>{t(tools.message||'')}</small>}</div>}
    </section>
    {managedToolState&&tools.workflowBound&&<section className="agent-option-section"><h4>{t('原流程作业服务')}</h4><div className="agent-tools-status" data-testid="agent-workflow-tools-status" data-status={tools.status} data-scope={tools.scope}><span><i className={'flow-dot '+(tools.status==='ready'?'ready':'missing')}/>{t(tools.scope==='definition-only'?'受限科学工具已连接':tools.scope!=='terminal-only'&&tools.status==='ready'?'流程工具已连接':'流程工具待核对')}</span>{tools.message&&<small>{t(tools.message)}</small>}{tools.status==='blocked'&&computeConnected===false&&onReviewWorker&&<button className="text-button" disabled={busy||connecting||applying} onClick={()=>void Promise.resolve().then(onReviewWorker).catch(onError)}>{t('恢复原作业服务')}</button>}</div></section>}
   </div>}
   </div>
    {!connected&&<button className="button wide" data-testid="agent-connect" onClick={()=>void connect(false,selectionSeq.current,true)} disabled={connecting||applying||busy||historyHidden}>{connecting?<LoadingFeedback busy inline label={t('正在连接服务商')+' · '+providerLabel}/>:<><Sparkles size={15}/>{t("连接")} {providerLabel}</>}</button>}
   {terminalSelected&&!terminalReady&&!canAcquireTerminal&&(connected||computeResource.kind==='ssh-terminal')?<div className="agent-tool-alert" role="status" data-testid="agent-ssh-resource-notice"><span>{t(terminalNotice)}</span>{terminalGranted&&computeResource.status==='selected'&&computeResource.alive===true&&connected&&<button className="text-button" data-testid="agent-ssh-reconnect" disabled={busy||connecting||applying} onClick={()=>void connect()}>{t('重新连接服务商')}</button>}</div>:!terminalSelected&&!managedToolState&&(connected||computeResource?.kind!=='ssh-connection')&&(tools.status==='blocked'||computeConnected===false&&!managedCompute&&tools.scope!=='terminal-only')&&<div className="agent-tool-alert" role="status"><span>{t(tools.status==='blocked'?'科学工具未就绪':'科学工具待连接')}</span><button className="text-button" data-testid="agent-tool-repair" disabled={busy||connecting} onClick={()=>{if(computeConnected===false&&onConnectCompute)void Promise.resolve().then(onConnectCompute).catch(onError);else void connect(true);}}>{t(computeConnected===false?'连接计算资源':'修复工具连接')}</button></div>}
   {managedToolsBlocked&&<div className="agent-tool-alert" role="status" data-testid="agent-managed-tools-notice"><span>{t(managedToolState.message||'托管计算工具待修复')}</span><button className="text-button" data-testid="agent-managed-tools-repair" disabled={busy||connecting||applying} onClick={()=>void connect('managed')}>{t('修复工具连接')}</button></div>}
  </div>
  {connected&&(tools.inventoryWarning||tools.warning&&(!managedToolState||tools.workflowBound))&&<Notice severity="warning" className="agent-tool-alert" data-testid="agent-tools-warning">{t(tools.inventoryWarning||tools.message||'工具清单待核对，可继续讨论并由 Agent 协助配置环境。')}</Notice>}
  {provider==='codex'&&!hidden&&connected&&versionNotice&&<Notice severity="warning" className="codex-version-notice" data-testid="codex-version-warning" action={<button className="text-button" aria-label={t('关闭版本提示')} onClick={()=>setVersionNotice(null)}>{t('关闭')}</button>}>
   <strong>{t('Codex CLI 版本不同，仍可继续使用。')}</strong><small>{versionNotice.installedVersion} · {t('参考版本')} {versionNotice.baselineVersion}</small>
  </Notice>}
  </div>
  {recovery&&<Notice className="agent-recovery" severity={recovery.error?'error':'warning'} data-testid="conversation-recovery"><strong>{t('对话连接需要恢复')}</strong><p>{t('旧聊天历史目前无法读取。可为同一流程建立新的空白对话连接，本地流程和作业记录保留。')}</p><button className="button" disabled={applying||connecting||!connected} onClick={()=>void resume(recovery.threadId,++selectionSeq.current,projectId,true)}>{t('重新建立对话连接')}</button>{recovery.error&&<p>{recovery.error}</p>}</Notice>}
  {localApiThread&&!connected&&!historyHidden&&!busy&&<Notice severity="info" className="agent-history-state" data-testid="agent-local-history">{t('正在查看本地历史。发送时会核对原 API 配置。')}</Notice>}
  <ConversationTurnActivity activity={activity?.provider===provider&&activity.threadId===thread?activity:undefined}
   notice={attentionTarget?.provider===provider&&attentionTarget.threadId===thread?attentionTarget:undefined}
   scroll={scroll} rendered={messages}
   ownerCurrent={()=>!hidden&&!historyHidden&&localCurrent()&&threadRef.current===thread&&providerRef.current===provider}
   onJump={()=>{followScroll.current=false;setFollowing(false);saveReadingPosition();}}/>
  {historyEnabled&&historyConversationId&&!historyHidden&&<ConversationHistoryToolbar key={historyConversationId} conversationId={historyConversationId} source={historyPage?.conversation.source} bookmarks={historyPage?.bookmarks||[]} atLatest={historyPage?.atLatest??true} loading={paging} onOpen={openHistoryLocation} onLatest={()=>void loadHistoryPage('latest')}/>}
   <div className="chat-scroll" ref={scroll} role="log" onScroll={observeScroll}>
   {!historyHidden&&historyPage?.before&&<OlderConversationPage loading={paging} onLoad={()=>void loadHistoryPage('older')}/>}
   {!historyHidden&&!messages.length&&<div className="agent-welcome"><h3>{t('对话示例')}</h3><div className="prompt-hints">{['检查我的计算环境','帮我设计一个 pyGAS bias','分析选中任务的运行日志'].map(t=><button key={t} onClick={()=>proposePrompt(t)}>{tr(t)}<PencilLine size={14} aria-hidden="true"/></button>)}</div></div>}
   {historyHidden&&<Notice className="agent-history-state" data-testid="agent-history-state" severity={historyLoad?.status==='failed'?'error':'info'}>{historyLoad?.status==='failed'?<><p>{t('此会话暂时无法读取，草稿已保留。')}</p>{historyLoad.error&&<details data-testid="agent-history-error-details"><summary>{t('查看错误详情')}</summary><pre>{historyLoad.error}</pre></details>}<button className="button" data-testid="agent-history-retry" disabled={busy||applying||connecting} onClick={()=>void retryHistory()}>{t('重新读取会话')}</button></>:<p>{t('正在读取所选会话…')}</p>}</Notice>}
   {!historyHidden&&<ConversationMessages messages={messages} language={t('你')} actions={messageActions.current!} disabled={busy||connecting||applying} canOriginalRun={!!onOpenOriginalRun} canCluster={!!onOpenCluster} canCompute={!!(onReviewWorker||onConnectCompute)} bookmarked={new Set(historyPage?.bookmarks.map(bookmark=>JSON.stringify([bookmark.turnId,bookmark.itemId]))||[])}/>}
   {!historyHidden&&requests.filter(r=>!isUserInputRequest(r)).map(r=>{const scope=requestScope(r),pending=responding.has(scope);return <div key={scope} className="approval" role="alert" data-testid="agent-question-request" data-request-id={String(r.id)} data-request-turn-id={r.params?.turnId} aria-busy={pending}><div><Shield size={15}/>{tr("需要你的决定")}</div><p>{r.params?.reason||r.params?.message||r.method}</p>{r.params?.command&&<pre>{r.params.command}</pre>}
    {r.method==='studio/question'?<div className="button-row">{r.params.questionOptions?.map((o:any)=><button className="button" disabled={pending} key={o.optionId} onClick={()=>void respond(r,{optionId:o.optionId})}>{o.name}</button>)}<button className="button" disabled={pending} onClick={()=>void respond(r,{})}>{t('取消')}</button></div>:
     r.method==='mcpServer/elicitation/request'?<>{elicitationHasEditableInput(r.params)&&<textarea data-testid="agent-approval-arguments" aria-label={t('审批参数')} placeholder="JSON content" disabled={pending} value={answer(r,'elicitation')||'{}'} onChange={e=>editAnswer(r,'elicitation',e.target.value)}/>}<div className="button-row"><button className="button primary" disabled={pending} onClick={()=>{try{void respond(r,{action:'accept',content:JSON.parse(answer(r,'elicitation')||'{}')});}catch(e){onError(e);}}}>{tr("接受")}</button><button className="button" disabled={pending} onClick={()=>void respond(r,{action:'decline',content:null})}>{tr("拒绝")}</button></div></>:
     r.method==='item/permissions/requestApproval'?<><pre>{JSON.stringify(r.params?.permissions,null,2)}</pre><div className="button-row"><button className="button primary" disabled={pending} onClick={()=>void respond(r,{permissions:r.params?.permissions,scope:"turn"})}>{tr("本轮允许所示权限")}</button><button className="button" disabled={pending} onClick={()=>void respond(r,{permissions:{},scope:"turn"})}>{tr("拒绝权限请求")}</button></div></>:
     ['item/commandExecution/requestApproval','item/fileChange/requestApproval','execCommandApproval','applyPatchApproval'].includes(r.method)?<div className="button-row"><button className="button primary" disabled={pending} onClick={()=>void respond(r,{decision:'accept'})}>{tr("允许一次")}</button><button className="button" disabled={pending} onClick={()=>void respond(r,{decision:'acceptForSession'})}>{tr("会话内允许")}</button><button className="button" disabled={pending} onClick={()=>void respond(r,{decision:'decline'})}>{tr("拒绝")}</button></div>:
     <div className="button-row"><button className="button" disabled={pending} onClick={()=>void respond(r,{decision:'decline'})}>{tr("拒绝")}</button></div>}
   </div>;})}
   {busy&&(!composerQuestions.length||stopStatus)&&<div className="thinking" data-testid="agent-work-state" role="status"><LoaderCircle size={14} className={stopStatus==='unknown'?undefined:'spin'}/>{t(stopStatus==='waiting'?'正在确认提交，随后停止…':stopStatus==='stopping'?'等待服务确认停止…':stopStatus==='unknown'?'停止结果待确认':retrying?.threadId===thread?'正在重新连接模型服务…':activeSend.current?.phase==='preparing'?'正在准备消息…':'Agent 正在工作')}</div>}
  </div>
  {!following&&(messages.length>0||requests.length>0)&&<div className="agent-new-messages"><button type="button" className="button" data-testid="agent-new-messages" onClick={followLatest}>{hasNewMessages?t('有新消息 · 回到底部'):t('回到底部')}</button></div>}
  {autoSkillStatus&&autoSkillStatus.threadId===thread&&autoSkillStatus.provider===provider&&<details className="agent-auto-skills"><summary>{t(autoSkillStatus.status==='passed'?'本轮已载入任务指导':autoSkillStatus.status==='already_loaded'?'当前会话已有相同指导':autoSkillStatus.status==='permission_required'?'需要公开指导共享许可':autoSkillStatus.status==='prepared'?'指导已准备，等待服务接受':autoSkillStatus.status==='failed'?'指导发送未通过':autoSkillStatus.status==='unknown'?'指导接收状态未知':autoSkillStatus.status==='not_run'?'本轮未载入任务指导':'任务指导暂不可用')} · {(autoSkillStatus.names||[]).length}</summary>{(autoSkillStatus.names||[]).map((name:string)=><div key={name}>{name}</div>)}{autoSkillStatus.source&&<p>{autoSkillStatus.source}</p>}{autoSkillStatus.attachments?.map((a:any)=><p className="skill-loaded-file" key={a.name+a.sha256}>{a.name}<small>SHA256 · {a.sha256} · {a.bytes} bytes</small></p>)}{autoSkillStatus.message&&<p>{autoSkillStatus.message}</p>}</details>}
  {needsAuth&&<Notice className="account-login-guidance" severity="warning" data-testid="agent-login-required"><p>{t(ACCOUNT_GUIDANCE)}</p><button className="button" onClick={openAccounts}>{t('打开账号与 API')}</button></Notice>}
  {pendingDefaults&&defaultsReview&&nativeDefaults&&<div className="account-login-guidance" role="status" data-testid="codex-model-defaults-review">
   <p>{t(defaultsReview==='model'?'当前账号的模型目录未列出本机默认模型。':'当前模型未列出本机默认推理强度。')} <strong>{defaultsReview==='model'?nativeDefaults.model:nativeDefaults.effort}</strong></p>
   <p>{t('请在对话面板选择可用的模型和推理强度，再确认使用。')}</p>
   <button className="button" disabled={!model} onClick={()=>acceptDefaults(model,effort)}>{t('确认使用所选配置')}</button>
  </div>}
  {sessionSelection?.pending&&sessionSelection.error&&<div className="notice" role="alert"><span>{sessionSelection.error}</span><button className="button" onClick={()=>onNewConversation?.()}>{t("重试")}</button></div>}
  {connected&&composerUnbound&&!historyLoad&&!recovery&&!applying&&!connecting&&!sessionSelection?.pending&&<div className="agent-send-recovery" data-testid="agent-draft-unbound" role="status"><span>{t('当前对话尚未恢复，输入草稿已保留。')}</span>{composerOwner.provider===provider&&composerOwner.threadId&&<button className="button" data-testid="agent-restore-draft" disabled={busy} onClick={()=>void resume(composerOwner.threadId!)}>{t('恢复当前对话')}</button>}</div>}
  {promptProposal&&promptProposal.provider===composerOwner.provider&&promptProposal.threadId===composerOwner.threadId&&<section className="agent-prompt-proposal" data-testid="agent-prompt-proposal" role="region" aria-label={t('处理新的讨论内容')}><strong>{t('已有未发送草稿，请选择如何加入新内容。')}</strong><details open={promptProposal.text.length<=280} data-testid="agent-prompt-preview"><summary>{t('查看待加入内容')}</summary><pre tabIndex={0}>{promptProposal.text}</pre></details><div className="button-row"><button className="button primary" data-testid="agent-prompt-append" onClick={()=>resolvePromptProposal('append')}>{t('追加到草稿')}</button><button className="button" data-testid="agent-prompt-replace" onClick={()=>resolvePromptProposal('replace')}>{t('替换草稿')}</button><button className="button" data-testid="agent-prompt-cancel" onClick={()=>resolvePromptProposal('cancel')}>{t('保留原稿')}</button></div></section>}
  {sendNotice&&!composerUnbound&&<div className="agent-send-notice" role="status">{sendNotice}</div>}
  {!historyHidden&&queueItems.length>0&&<section className="agent-follow-up-queue" data-testid="agent-follow-up-queue" aria-label={t('待发送消息')}>
   <header><strong>{t('待发送消息')} · {queueItems.length}</strong><small role="status">{queueNotice}</small>
    {queueCanResume&&<button className="text-button" type="button" data-testid="agent-resume-queue" onClick={()=>void queueAction({action:'resume'})}>{t('继续发送队列')}</button>}
   </header>
   <ul>{queueItems.map((item,index)=>{
    const editing=item.status==='queued'&&queueEdit?.owner===queueKey&&queueEdit.id===item.id?queueEdit:null;
    const locked=item.status==='preparing'||item.status==='submitting'||queueOperations.current.has(item.id);
    return <li key={item.id} data-testid="agent-queued-message" data-status={item.status}>
     {editing?<textarea autoFocus className="agent-queued-editor" data-testid="agent-queued-editor" aria-label={t('编辑排队消息')}
      value={editing.text} onChange={event=>setQueueEdit({...editing,text:event.target.value})}/>:
      item.text&&<div className="agent-queued-text" title={item.text}>{item.text}</div>}
     {item.skillName&&<small className="agent-queued-attachment">{item.skillName}</small>}
     {item.files?.map(file=><small className="agent-queued-attachment" key={file.id}>{file.name}</small>)}
     {item.status==='unconfirmed'&&<small className="agent-queued-attachment">{t('发送结果待核对')}</small>}
     {item.attachmentReview&&<small className="agent-queued-attachment">{t('对话已变化。请重新选取附件。')}</small>}
     <div className="agent-queue-actions">
      {editing?<><button type="button" className="text-button" data-testid="agent-queued-save" disabled={locked||!editing.text.trim()&&!item.files?.length} onClick={()=>void saveQueueEdit(item)}>{t('保存')}</button>
       <button type="button" className="text-button" onClick={()=>setQueueEdit(null)}>{t('取消')}</button></>:<>
       {canSteer&&item.status==='queued'&&item.steerable&&<button type="button" className="text-button" data-testid="agent-queued-steer" disabled={locked} onClick={()=>void steer(item)}>{t('引导当前回复')}</button>}
       {item.status==='queued'&&<>
        <button type="button" className="text-button queue-icon" aria-label={t('编辑排队消息')} title={t('编辑排队消息')} data-testid="agent-queued-edit" disabled={locked} onClick={()=>queueKey&&setQueueEdit({owner:queueKey,id:item.id,text:item.text})}><PencilLine size={14}/></button>
        {queueItems[index-1]?.status==='queued'&&<button type="button" className="text-button queue-icon" aria-label={t('上移')} title={t('上移')} data-testid="agent-queued-up" disabled={locked} onClick={()=>void queueAction({action:'move',id:item.id,direction:'up'},item.id)}><ChevronUp size={15}/></button>}
        {queueItems[index+1]?.status==='queued'&&<button type="button" className="text-button queue-icon" aria-label={t('下移')} title={t('下移')} data-testid="agent-queued-down" disabled={locked} onClick={()=>void queueAction({action:'move',id:item.id,direction:'down'},item.id)}><ChevronDown size={15}/></button>}
       </>}
       {item.status==='unconfirmed'&&<button type="button" className="text-button" data-testid="agent-queued-reconcile" disabled={locked} onClick={()=>void checkQueuedDelivery(item)}>{t('核对原回执')}</button>}
       <button type="button" className="text-button" data-testid="agent-queued-to-draft" disabled={locked||fileImportBusy} onClick={()=>void removeQueued(item,true)}>{t('移回草稿')}</button>
       <button type="button" className="text-button queue-icon" aria-label={t('取消排队')} title={t('取消排队')} data-testid="agent-queued-remove" disabled={locked} onClick={()=>void removeQueued(item)}><X size={14}/></button>
      </>}
     </div>
    </li>;
   })}</ul>
  </section>}
  {terminalPlanning&&<div className="agent-tool-alert" role="status" data-testid="agent-planning-terminal-notice"><span>{t('任务规划已开启；当前仅有终端工具，可先讨论方案。生成可审阅流程需要连接作业服务。')}</span>{onConnectCompute&&<button className="text-button" data-testid="agent-planning-connect-worker" disabled={busy||connecting||applying} onClick={()=>void Promise.resolve().then(onConnectCompute).catch(onError)}>{t('连接作业服务')}</button>}</div>}
  {localOwner&&sessionWorkspaceProfile&&<SessionWorkspace key={localOwner} profileId={sessionWorkspaceProfile} owner={localOwner} active={!hidden} busy={busy} isCurrent={localCurrent}/>}
  {!historyHidden&&onReviewResourceTool&&<div className="agent-tool-alert"><button type="button" className="button" data-testid="agent-resource-tool-review" data-guide-target="resource-tool-review" onClick={onReviewResourceTool}>{t('核对准备好的工具配置')}</button></div>}
  <div className="composer" onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}} onDrop={event=>{
   if(event.dataTransfer.files.length){event.preventDefault();if(!composerQuestion&&!missingRequest)void importFiles(Array.from(event.dataTransfer.files));}
  }} data-state={composerQuestion&&questionDraft||missingRequest?'question':undefined}>
   {!historyHidden&&thread&&<TerminalWorkspaceApproval key={`${provider}:${thread}:${computeResource?.selectionId}`} provider={provider} threadId={thread} active={!hidden} selection={computeResource?.selectionId}
    isCurrent={()=>!sessionPendingRef.current&&!selectionPending.current&&providerRef.current===provider&&threadRef.current===thread&&resourceRef.current?.selectionId===computeResource?.selectionId}/>}
   {composerQuestion&&questionDraft?<div className="agent-composer-questions">
    <ComposerQuestion key={requestScope(composerQuestion)} request={composerQuestion} questions={composerQuestionItems(composerQuestion)} progress={questionDraft.progress}
     pending={questionDraft.pending||stopStatus==='waiting'||stopStatus==='stopping'} active={!hidden}
     stopControl={stopControl}
     onChange={(index,update)=>changeQuestion(composerQuestion,index,update)}
     onSubmit={(index,update)=>changeQuestion(composerQuestion,index,update||((current)=>current),true)}/>
   </div>:missingRequest&&missingTool?<div className="agent-composer-questions" data-testid="agent-missing-tool-question">
    <ComposerQuestion key={missingTool.id} request={missingRequest} questions={composerQuestionItems(missingRequest)} progress={missingToolProgress?.id===missingTool.id?missingToolProgress.value:initialQuestionProgress} active={!hidden} pending={false} stopControl={stopControl}
     onChange={(_index,update)=>setMissingToolProgress(current=>({id:missingTool.id,value:update(current?.id===missingTool.id?current.value:initialQuestionProgress)}))}
     onSubmit={(_index,update)=>{
      if(!update||!localCurrent()||missingToolRef.current?.id!==missingTool.id||answeredMissingTool.current===missingTool.id)return;
      const answer=update(initialQuestionProgress).answers.action;
      if(answer?.kind==='choice'){answeredMissingTool.current=missingTool.id;missingTool.onAnswer(answer.value===setupToolLabel?'setup':'later');}
     }}/>
   </div>:<>
    {connected&&!options&&<div className="composer-model-selection" data-testid="composer-model-selection"><label>{t('模型')}<select data-testid="composer-model" aria-label={t('对话模型')} value={model} disabled={busy||applying||connecting} onChange={e=>void selectModel(e.target.value)}>{models.map(m=><option key={m.id||m.model} value={m.model} disabled={!!thread&&!!currentModel?.profileId&&m.profileId!==currentModel.profileId}>{m.providerName?m.providerName+' · ':''}{m.displayName||m.model}</option>)}</select></label><label>{t('推理等级')}<select data-testid="composer-effort" aria-label={t('对话推理等级')} value={effort} disabled={busy||applying||connecting||!efforts.length} onChange={e=>setEffort(e.target.value)}>{!efforts.length&&<option value="">{t('模型默认')}</option>}{efforts.map((entry:any)=><option key={entry.reasoningEffort} value={entry.reasoningEffort}>{entry.reasoningEffort==='off'?t('关闭思考'):entry.reasoningEffort}</option>)}</select></label></div>}<div className="agent-compose-context"><label className="agent-mode-toggle"><input data-testid="agent-planning-mode" type="checkbox" checked={planningMode} disabled={busy||connecting||applying} onChange={e=>onPlanningModeChange(e.target.checked)}/>{t('任务规划模式')}</label>{(workflowId||planningMode||newWorkflow)&&<Tooltip className="agent-mode-explanation" content={t(terminalPlanning?'规划已开启，可先讨论方案':newWorkflow?'下条消息将新建流程；原流程保留。':workflowId?'此对话已绑定流程，可直接用自然语言调整':'生成计算流程和参数，等待审阅执行')}><span className="agent-mode-inline">{t(terminalPlanning?'规划已开启，可先讨论方案':newWorkflow?'下条消息将新建流程；原流程保留。':workflowId?'此对话已绑定流程，可直接用自然语言调整':'生成计算流程和参数，等待审阅执行')}</span></Tooltip>}{workflowId&&workflowId!==visibleWorkflowId&&<button className="text-button" data-testid="agent-current-workflow" disabled={busy||applying} onClick={()=>openTaskRef.current?.(workflowId)}>{t('打开当前流程')}</button>}</div>{skill&&<div className="skill-chip"><span>{t('仅下条消息')} · {skill.name}</span><button type="button" aria-label={t('移除本条消息技能')} onClick={()=>attachmentClearRef.current?.()}>×</button></div>}
    {draftImageMismatch&&<small className="chat-file-capability" role="status">{t('当前模型仅支持文字，请更换模型或移除图片。')}</small>}
    <ChatFiles files={drafts.files()} preview={showFile} remove={id=>{drafts.removeFile(id);refreshFiles();}}/>
    <input ref={filePicker} hidden type="file" multiple data-testid="chat-file-picker" onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';void importFiles(files);}}/>
    <textarea onPaste={event=>{const files=Array.from(event.clipboardData.files);if(files.length){event.preventDefault();void importFiles(files);}}} data-guide-target="composer" aria-label={t('对话草稿')} aria-busy={applying||connecting} value={prompt} onChange={e=>updatePrompt(e.target.value)} placeholder={t(connected?'描述计算目标，或询问选中任务…':'连接服务商后开始协作…')} onKeyDown={e=>{
     if(e.key==='Enter'&&!e.shiftKey&&!e.altKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){
      e.preventDefault();if(!e.repeat)sendFromComposer(e.ctrlKey||e.metaKey);
     }
    }}/>
   </>}
   {!(composerQuestion&&questionDraft)&&!missingRequest&&<div className="composer-bottom">
    <button type="button" className="icon-button chat-file-add" data-testid="chat-file-add" title={t('添加文本、PDF、Office 文档或图片，也可拖入或粘贴')} aria-label={t('添加文件或图片')} disabled={fileImportBusy||historyHidden||composerUnbound} onClick={()=>filePicker.current?.click()}><Paperclip size={17}/></button>
    {fileImportBusy&&<small role="status">{t('正在读取附件…')}</small>}
    <span data-testid={queueComposer?'agent-follow-up-shortcuts':undefined}>{queueComposer?queueHint:t('Enter 发送 · Shift+Enter 换行')}</span>
    {queueComposer?<div className="agent-follow-up-actions">
     {provider!=='kimi'&&busy&&<button type="button" className="button" data-testid="agent-steer" disabled={!steerDraftAllowed}
      title={t(draftHasFiles?'带文件的消息将在下一轮发送':skill?'带技能的消息将在下一轮发送':'将文字发送到当前回复')} onClick={()=>void steer()}>{t(steering.current.has(queueKey??'')?'引导中…':'引导')}</button>}
     <button type="button" className="button primary" data-testid="agent-queue" disabled={draftImageMismatch||fileImportBusy||!queueAllowed||!prompt.trim()&&!draftHasFiles} title={t('本对话的当前回复完成后发送')}
      onClick={()=>void enqueuePrompt()}><ListPlus size={15}/>{t('排队')}</button>
     {stopControl}
    </div>:<button className="send" aria-label={tr("发送")} onClick={()=>sendFromComposer()} disabled={pendingDefaults||!!recovery||applying||connecting||selectionPending.current||historyHidden||composerUnbound||!localApiThread&&(!connected||!models.length)||terminalSelected&&!terminalReady&&!canAcquireTerminal||draftImageMismatch||fileImportBusy||!prompt.trim()&&!draftHasFiles}><ArrowUp size={17}/></button>}
   </div>}
  </div>
  {branchPreview&&<ConversationExcerptDialog value={branchPreview} busy={branching} onClose={()=>setBranchPreview(null)} onConfirm={()=>{const {conversationId,turnId,itemId}=branchPreview.source;void createDiscussion({conversationId,turnId,...itemId?{itemId}:{}},branchPreview.revision);}}/>}
  {filePreview&&filePreview.scope===JSON.stringify(drafts.attachmentOwner())&&<ChatFilePreview value={filePreview.value} close={()=>setFilePreview(null)}/>}
  {login&&<ProviderLogin provider={provider} onClose={()=>setLogin(false)} onConfigured={()=>{setLogin(false);void connect();}} onError={onError}/>}
 </aside>;
}
