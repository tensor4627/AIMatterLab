import SetupLesson,{type SetupLessonLocation} from '../features/onboarding/SetupLesson';
import type {SetupGuideInfo,SetupPage,SetupProgress,SetupProgressRequest} from '../../contracts/dto/setup-guide';
import type {ModelReply,SetupPreferences,SetupVisit} from '../features/onboarding/SetupAssistant';
import {CircleHelp} from 'lucide-react';
import product from "../../contracts/product.json";
import type {DeleteConversationGroupRequest,DeleteConversationGroupResult} from '../../contracts/dto/agent';
import {sshStateLabel} from "../features/compute/ssh-connection-types";
import {taskWorkerSource,unboundWorkflow} from '../../contracts/compute/task-worker-binding.mjs';
import type {DiagnosticRepairRequest} from '../features/diagnostics/repair-request.mjs';
import {computeResources} from '../api/compute-resources';
import type {ComputeResourceState} from '../../contracts/dto/compute';
import {useToolWorkflowNavigation} from "../features/workflows/useToolWorkflowNavigation";
import {useConversationSelection,storedConversation,storeConversation} from "../features/conversations/useConversationSelection";

import ConversationCommands from "../features/conversations/ConversationCommands";
import ConversationMenu from "../features/conversations/ConversationMenu";
import WorkbenchImageCommand from "../features/diagnostics/WorkbenchImageCommand";
import {type WorkbenchImageResult} from '../../contracts/dto/diagnostics';


import type {SshAuthenticationRequest} from "../features/cluster/SshConnectionGuide";
import {enqueueSshGuide,takeQueuedSshGuide} from './ssh-guide-queue.mjs';
import {computeConnectionCommandMatches} from "../features/compute/compute-connection-command.mjs";

import DiagnosticNotice from "../features/diagnostics/DiagnosticNotice";
import {createDiagnostic,type UiDiagnostic} from "../features/diagnostics/ui-diagnostics.mjs";

import {version as STUDIO_VERSION} from "../../package.json";
import './ux-finish.css';
import './project-navigation.css';
import './workspace-shell.css';
import './navigation.css';
import './frontend-refinement.css';
import './interactions.css';
import PaneDivider from "../ui/PaneDivider";
import Tooltip from "../ui/Tooltip";
import JobsPage,{type RecordObservation} from "../features/runs/JobsPage";
import {selectedRecordScope,matchesSelectedRecordService,readSelectedServiceRecords,type RecordServiceObservation} from '../features/runs/selected-service-records.mjs';
import {unifiedJobs,initialBottomExpanded,conversationMatches,computeProjectForSelection,toolGroups,type ClusterJob,type Job} from './workspace-shell.mjs';
import {followedProjectId} from './project-follow.mjs';
import ModuleIcon from "../ui/ModuleIcon";
import {workspaceModule,primaryDestination} from './workspace-navigation.mjs';
import type {CustomCvInvoke} from "../features/custom-cv/custom-cv-contract";
import type {CompositionAssetImportResult} from "../features/pygas/CompositionAssetImport";
import "../features/workflows/task-flow.css";
import ViewBoundary from "../ui/ViewBoundary";
import {tr} from "../ui/i18n";
import {useEffect,useRef,useState} from 'react';
import {Home,Clock,KeyRound,GitBranch,Activity,Atom,Box,Command,FileCode2,Folder,Layers3,FlaskConical,GraduationCap,Database,Server,Terminal,BookOpen,Search,Plus,ArrowUpRight,Settings as SettingsIcon,Sun,Moon,Minus,Square,X,RefreshCw,PanelRightClose,PanelRightOpen,Play,ShieldCheck,ChevronRight,Save,PlugZap,CheckCircle2,MessageSquare,ChevronDown,ChevronUp} from 'lucide-react';
import {TaskCards,Relations,ToolPage,WorkflowPage} from "../features/workflows/Workflows";
import {tasks,tools} from "../features/workflows/workflow-catalog.mjs";
import {type Plan} from "../../contracts/workflows/plan.mjs";



import {deploymentApi} from "../api/deployment-client";

import ProjectAuthorizationForm,{type ProjectAuthorizationSpec} from "../features/compute/ProjectAuthorizationForm";
import {createProjectPolicyEditor,type ProjectPolicyEditor} from "../features/compute/project-policy-edit.mjs";

import Agent from "../features/conversations/Agent";




import {t,setLanguage} from "../ui/i18n";
import RunDetail from "../features/runs/RunDetail";
import RunReview,{taskModule} from "../features/runs/RunReview";



import {CodeEditor} from "../ui/widgets";
import type {SharedTerminalRequest} from "../features/terminal/SharedTerminalPanel";
import {Modal,Empty,Badge,statusNames} from "../ui/Dialogs";
import {api,readWorkerStatus,restoreWorker} from '../api/worker';
import {clearTaskDrafts} from '../features/workflows/task-drafts';
import {invoke} from '../api/studio';
import {engines} from '../ui/presentation/engines';
import {type Project,type Environment,type WslComputeProfile,type SshComputeProfile} from '../../contracts/dto/compute';
import {type Run} from '../../contracts/dto/runs';
import {type Settings} from '../../contracts/dto/settings';
import {type Artifact} from '../../contracts/dto/assets';
import {type Conversation,type AgentProvider} from '../../contracts/dto/agent';
import {type AgentIntent,type SkillAttachment} from '../features/conversations/agent-types';

import {lazyPanel} from "../ui/lazy-panel";
import LoadingFeedback from "../ui/LoadingFeedback";
import CliRuntimeDialog from "../features/settings/CliRuntimeDialog";
import type {CliReadiness} from "../../contracts/dto/cli-runtime";
const SetupAssistant=lazyPanel("SetupAssistant",()=>import("../features/onboarding/SetupAssistant"));
const ComputeConnectionChooser=lazyPanel("ComputeConnectionChooser",()=>import("../features/compute/ComputeConnectionChooser"));
const ComputeEnvironments=lazyPanel("ComputeEnvironments",()=>import("../features/compute/ComputeEnvironments"));
const ComputeConnectionGuide=lazyPanel("ComputeConnectionGuide",()=>import("../features/compute/ComputeConnectionGuide"));
const DeploymentPanel=lazyPanel("DeploymentPanel",()=>import("../features/workflows/DeploymentPanel"));
const AgentTaskPage=lazyPanel("AgentTaskPage",()=>import("../features/workflows/AgentTaskPage"));
const AccountCenter=lazyPanel("AccountCenter",()=>import("../features/settings/AccountCenter"));
import {useWorkspaceUpdate,SoftwareUpdate} from "../features/settings/SoftwareUpdate";
const SettingsPage=lazyPanel("SettingsPage",()=>import("../features/settings/SettingsPage"));
const SkillsWorkbench=lazyPanel("SkillsWorkbench",()=>import("../features/tools/SkillsWorkbench"));
const SharedTerminalPanel=lazyPanel("SharedTerminalPanel",()=>import("../features/terminal/SharedTerminalPanel"));
const ToolPackagesPanel=lazyPanel("ToolPackagesPanel",()=>import("../features/tools/ToolPackagesPanel"));
const PygasTaskComposer=lazyPanel("PygasTaskComposer",()=>import("../features/pygas/PygasTaskComposer"));
const StructureBuilder=lazyPanel("StructureBuilder",()=>import("../features/assets/StructureBuilder"));
const AssetInspector=lazyPanel("AssetInspector",()=>import("../features/assets/AssetInspector"));
const ClusterPage=lazyPanel("ClusterPage",()=>import("../features/cluster/ClusterPage"));
const ClusterRunPage=lazyPanel("ClusterRunPage",async()=>{const module=await import("../features/cluster/ClusterPage");return {default:module.ClusterRunPage};});
const MaterialsProjectSearch=lazyPanel("MaterialsProjectSearch",async()=>{const module=await import("../features/assets/MaterialsProject");return {default:module.MaterialsProjectSearch};});
const SshConnectionGuide=lazyPanel("SshConnectionGuide",()=>import("../features/cluster/SshConnectionGuide"));

const sections=[['home','工作区',Layers3],['tools','工具与资源',Layers3],['extensions','第三方工具包',BookOpen],['relations','工具关系图',GitBranch],['runs','运行记录',Activity],['bias','Bias 实验室',FlaskConical],['training','模型与训练',GraduationCap],['assets','数据资产',Database],['environments','计算环境',Server],['deployment','部署与执行',Play],['ssh','SSH 集群',Terminal],['skills','技能库',BookOpen]] as const;
const initialSettings:Settings={distribution:'Ubuntu',workerRoot:'~/.local/state/gpu-sampling-studio',workerPort:8767,codexPath:'codex',cwd:'',skillRoots:[],theme:'dark'};
function isSshResource(value:ComputeResourceState|null|undefined):value is ComputeResourceState{return value?.kind==='ssh-terminal'||value?.kind==='ssh-connection';}
function sshSummary(value:ComputeResourceState){return 'SSH: '+t(sshStateLabel(value.connectionStatus||value.status))+' · '+t('终端')+': '+t(sshStateLabel(value.capabilities?.terminal.status))+' · '+t('作业服务')+': '+t(sshStateLabel(value.capabilities?.service.status));}
function shortTime(value:number){return new Date(value*1000).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
function errorText(e:unknown){return e instanceof Error?e.message:String(e);}
function stored(key:string,fallback:number){const value=Number(localStorage.getItem(key));return Number.isFinite(value)&&value>0?value:fallback;}
function bounded(value:number|undefined,min:number,max:number,fallback:number){return typeof value==='number'&&Number.isFinite(value)&&value>0?Math.min(max,Math.max(min,value)):fallback;}
function RunTable({items,selected,onOpen,canOpen,canPrepare,onPrepare}:{items:Run[];selected:string|null;onOpen:(run:Run)=>void;canOpen:boolean;canPrepare:boolean;onPrepare:()=>void}){
 return items.length?<div className="run-table"><div className="table-heading"><span>{tr("计算名称")}</span><span>{tr("状态")}</span><span>{tr("资源")}</span><span>{tr("创建时间")}</span></div>{items.map(r=><button key={r.id} className={'run-row '+(selected===r.id?'selected':'')} aria-current={selected===r.id?'true':undefined} disabled={!canOpen} onClick={()=>onOpen(r)}><span><span className="run-icon"><Atom size={17}/></span><span><strong>{r.name}</strong><small>{r.engine}</small></span></span><Badge status={r.status}/><span className="mono">GPU {r.gpu}</span><span className="muted">{shortTime(r.created_at)}</span></button>)}</div>:<Empty title={tr("这里将记录你的计算")} body={"准备输入并提交任务，检查结果单独保留。所有状态来自作业服务。"} action={<button className="button" onClick={onPrepare} disabled={!canPrepare}><Plus size={14}/>{tr("准备第一个计算")}</button>}/>;
}
type SshGuideState={request:SshAuthenticationRequest;taskId?:string;conversationId?:string;selectionSeq:number;standalone:boolean};
export default function App(){
 const updates=useWorkspaceUpdate();
 const updateVisible=['available','downloading','verifying','ready'].includes(updates.state.phase);
 const [guideInfo,setGuideInfo]=useState<SetupGuideInfo|null>(null),[guidePage,setGuidePage]=useState<SetupPage|null>(null);
 const [lesson,setLesson]=useState<SetupLessonLocation|null>(null),[guideKind,setGuideKind]=useState<'wsl'|'ssh'>();
 const [guideProvider,setGuideProvider]=useState<{provider:AgentProvider;nonce:string}>(),[guideReply,setGuideReply]=useState<ModelReply|null>(null);
 const guideShowing=guidePage!==null&&!lesson;
 const lessonOpener=useRef<HTMLElement|null>(null);
 const [computeChooser,setComputeChooser]=useState(false);
 const [computeChooserEdit,setComputeChooserEdit]=useState<{profileId:string;profileVersion:number;nonce:string;section?:"service"}|undefined>();
 const [sshGuide,setSshGuide]=useState<SshGuideState|null>(null),[clusterSelection,setClusterSelection]=useState<string|null>(null);
 const pendingSshGuide=useRef<SshGuideState|null>(null);
 function buildSshGuide(request:SshAuthenticationRequest):SshGuideState{const conversation=selectedConversationRef.current,standalone=request.kind==='original-run'&&!request.taskId;return {request:{...request,owner:conversation?{provider:conversation.provider,threadId:conversation.threadId,taskId:conversation.taskId||null}:null},taskId:request.kind==='original-run'?request.taskId:conversation?.taskId||undefined,conversationId:conversation?.id,selectionSeq:conversationSelectionSeq.current,standalone};}
 function openSshGuide(request:SshAuthenticationRequest){const next=buildSshGuide(request);setSshGuide(current=>{const result=enqueueSshGuide(current,pendingSshGuide.current,next);pendingSshGuide.current=result.queued;return result.current;});}
 function closeSshGuide(){setSshGuide(null);}
 useEffect(()=>{if(sshGuide)return;const result=takeQueuedSshGuide(sshGuide,pendingSshGuide.current);pendingSshGuide.current=result.queued;if(result.current!==sshGuide)setSshGuide(result.current);},[sshGuide]);
 function runSourceTask(runId:string){return agentTasks.find(task=>task.id===selectedConversationRef.current?.taskId&&task.artifacts?.some((artifact:any)=>artifact.kind==='cluster-run'&&artifact.id===runId));}
 function openOriginalConnection(source:{runId?:string;taskId?:string;clusterId?:string}){if(source.runId)openSshGuide({kind:'original-run',runId:source.runId,...source.taskId?{taskId:source.taskId}:{},owner:null});else if(source.clusterId){setClusterSelection(source.clusterId);go('ssh');}}
 const workerHydrationEpoch=useRef(0),settingsRevision=useRef(0);
 const explicitConnection=useRef<number|null>(null);
 const [computeGuide,setComputeGuide]=useState<{id:string;taskId?:string;profile?:{id:string;version:number}}|null>(null),computeGuideRequest=useRef<{id:string;promise:Promise<boolean>;resolve:(connected:boolean)=>void}|null>(null);
 useEffect(()=>()=>{computeGuideRequest.current?.resolve(false);computeGuideRequest.current=null;},[]);
 const workerReady=useRef(false),mounted=useRef(true),initialSelectionReady=useRef(false),settingsKnown=useRef(false),settingsReady=useRef<Promise<void>|null>(null),finishSettings=useRef<()=>void>(()=>{}),settingsRef=useRef(initialSettings);
 if(!settingsReady.current)settingsReady.current=new Promise<void>(resolve=>{finishSettings.current=resolve;});
 const [workerRestoring,setWorkerRestoring]=useState(true),[runSourceEpoch,setRunSourceEpoch]=useState<number|null>(null),[serviceVersion,setServiceVersion]=useState<'current'|'different'|'unconfirmed'>('unconfirmed');
 const [sidebarVisible,setSidebarVisible]=useState(localStorage.getItem('studio.sidebarVisible')!=='false'),[sidebarWidth,setSidebarWidth]=useState(stored('studio.sidebarWidth',240)),[chatGroups,setChatGroups]=useState<{id:string;name:string}[]>([]),[chatGroupId,setChatGroupId]=useState<string|null>(null),[groupName,setGroupName]=useState('');
 const [cliRequired,setCliRequired]=useState<CliReadiness|null>(null);
 const [accountsProvider,setAccountsProvider]=useState<AgentProvider>('codex'),[renameTarget,setRenameTarget]=useState<Conversation|null>(null),[conversationName,setConversationName]=useState(''),[renaming,setRenaming]=useState(false);
 const [groupDeleteTarget,setGroupDeleteTarget]=useState<{id:string;name:string}|null>(null),[groupDeleting,setGroupDeleting]=useState(false),groupDeletion=useRef(false);
 const [deleteTarget,setDeleteTarget]=useState<Conversation|null>(null),[deleting,setDeleting]=useState(false);
 const [agentTasks,setAgentTasks]=useState<any[]>([]),[clusterDraft,setClusterDraft]=useState<any>();
 const [plans,setPlans]=useState<Plan[]>([]),[agentIntent,setAgentIntent]=useState<AgentIntent>();
 const [section,setSection]=useState(localStorage.getItem('studio.section')||'home'),[projects,setProjects]=useState<Project[]>([]),[environments,setEnvironments]=useState<Environment[]>([]),[runs,setRuns]=useState<Run[]>([]),[assets,setAssets]=useState<Artifact[]>([]);
 const [projectId,setProjectId]=useState(''),[settings,applySettings]=useState(initialSettings),[worker,setWorker]=useState(false),[connecting,setConnecting]=useState(false);
 const [workerSourceId,setWorkerSourceId]=useState(''),[workerNotice,setWorkerNotice]=useState('');
 function setSettings(value:Settings|((previous:Settings)=>Settings)){settingsRevision.current++;const next=typeof value==='function'?value(settingsRef.current):value,previous=settingsRef.current;settingsRef.current=next;applySettings(next);if([next.distribution,next.workerRoot,next.workerPort].join('\n')!==[previous.distribution,previous.workerRoot,previous.workerPort].join('\n')){beginWorkerGate();setWorkerRestoring(false);}}
 const [selected,setSelected]=useState<string|null>(null),[agentVisible,setAgentVisible]=useState(localStorage.getItem('studio.agent')!=='false'),[bottomHeight,setBottomHeight]=useState(stored('studio.bottom',190));
 const [bottomExpanded,setBottomExpanded]=useState(()=>initialBottomExpanded(key=>localStorage.getItem(key))),[primaryPanel,setPrimaryPanel]=useState<'agent'|'workspace'>('agent'),[windowWidth,setWindowWidth]=useState(window.innerWidth),[conversationSearch,setConversationSearch]=useState('');
 const [clusterRuns,setClusterRuns]=useState<ClusterJob[]>([]),[recordObservations,setRecordObservations]=useState<{local:RecordObservation;cluster:RecordObservation}>({local:{at:null,stale:false,loaded:false},cluster:{at:null,stale:false,loaded:false}});
 const [recordService,setRecordService]=useState<RecordServiceObservation>({phase:'unavailable'}),recordServiceRef=useRef(recordService);recordServiceRef.current=recordService;
 const [recordDetailReceipt,setRecordDetailReceipt]=useState<{id:string;sourceId:string;scopeKey:string}|null>(null);
 const verifiedRecordSource=useRef<string|null>(null),verifiedExecutionSource=useRef<string|null>(null);
 const recordReadSequence=useRef(0),recordReadPending=useRef<{key:string;promise:Promise<void>}|null>(null);
 const [projectPolicyEdit,setProjectPolicyEdit]=useState<ProjectPolicyEditor|null>(null),[projectPolicyInitial,setProjectPolicyInitial]=useState<ProjectAuthorizationSpec|null>(null),[projectPolicyId,setProjectPolicyId]=useState(''),[projectPolicyError,setProjectPolicyError]=useState('');
 const projectPolicySeq=useRef(0),projectPolicyWorkerEpoch=useRef(0),projectPolicyOwner=useRef<any>({});
 const [imageSaving,setImageSaving]=useState(false),[imageReceipt,setImageReceipt]=useState<WorkbenchImageResult>(null);
 const settingsSavingRef=useRef(false),[settingsSaving,setSettingsSaving]=useState(false);
 const [modal,setModal]=useState(''),[error,setError]=useState<UiDiagnostic|null>(null),[command,setCommand]=useState(false),[busy,setBusy]=useState(false);
 const [editor,setEditor]=useState({name:'workflow.py',source:'# 打开输入文件，或在 Bias 实验室生成可检查的构建源码。\n',id:'',path:''});
 const [environmentDraft,setEnvironmentDraft]=useState(''),[runDraft,setRunDraft]=useState<any>({}),[runJson,setRunJson]=useState('{}');
 const [terminalRequest,setTerminalRequest]=useState<SharedTerminalRequest>(),[bottomTab,setBottomTab]=useState('queue'),[skill,setSkill]=useState<SkillAttachment>(),[agentProvider,setAgentProvider]=useState<AgentProvider>('codex');
 const [terminalOpened,setTerminalOpened]=useState(false);
 function showTerminal(){setTerminalOpened(true);setBottomTab('terminal');setBottomExpanded(true);setBottomHeight(old=>Math.max(old,300));}
 const [computeResource,setComputeResource]=useState<ComputeResourceState|null>(null),[computeResourceLabel,setComputeResourceLabel]=useState('');
 const computeResourceRef=useRef(computeResource),resourceReadSequence=useRef(0),resourceScopeRef=useRef('');computeResourceRef.current=computeResource;
 function leavePreviousRun(){
  openSeq.current++;setRecordDetailReceipt(null);setSelected(null);
  setRecordObservations(old=>({local:{...old.local,sourceChanged:old.local.loaded,stale:old.local.loaded},cluster:{...old.cluster,sourceChanged:old.cluster.loaded,stale:old.cluster.loaded}}));
  setSection(page=>page.startsWith('task:')||page.startsWith('cluster-run:')?'runs':page);
 }
 function acceptComputeResource(value:ComputeResourceState,label?:string){
  resourceReadSequence.current++;
  const previous=computeResourceRef.current;
  if(selectedRecordScope(previous,0)?.key!==selectedRecordScope(value,0)?.key){
   leavePreviousRun();verifiedRecordSource.current=null;
  }
  computeResourceRef.current=value;setComputeResource(value);
  if(label)setComputeResourceLabel(label);else if(previous?.sessionId!==value.sessionId)setComputeResourceLabel('');
 }
 async function refreshComputeResource(){const seq=++resourceReadSequence.current,scope=resourceScopeRef.current,selection=conversationSelectionSeq.current;try{const value=await computeResources.status();if(mounted.current&&seq===resourceReadSequence.current&&scope===resourceScopeRef.current&&selection===conversationSelectionSeq.current)acceptComputeResource(value);}catch{/* Unknown resource state must not replace the actual worker observation. */}}
 const deploymentOpening=useRef<{taskId:string;promise:Promise<void>}|null>(null);
 const [agentWidth,setAgentWidth]=useState(stored('studio.agentWidth',340)),[overviewAgentWidth,setOverviewAgentWidth]=useState(stored('studio.overviewAgentWidth',340)),[gpuStatus,setGpuStatus]=useState<any[]>([]),[disconnected,setDisconnected]=useState(false);
 const editorSaving=useRef(false),editorLatest=useRef(editor);editorLatest.current=editor;
 const [editorSave,setEditorSave]=useState(''),[openingRun,setOpeningRun]=useState<{id:string;sequence:number}|null>(null),openingRunRef=useRef<{id:string;sequence:number}|null>(null);
 const [editorDirty,setEditorDirty]=useState(false),[paletteSearch,setPaletteSearch]=useState('');
 const [refreshFeedback,setRefreshFeedback]=useState<{seq:number;status:'loading'|'complete'|'partial'|'failed';at:number|null}|null>(null);
 const refreshing=useRef(false),gpuLoading=useRef(false),sourceFailures=useRef(new Map<string,number>()),sourceGeneration=useRef(0);const [gpuStale,setGpuStale]=useState(false);
 const referenceReads=useRef(new Map<string,number>());
 const refreshSeq=useRef(0),latestRefresh=useRef<Promise<void>>(Promise.resolve()),openSeq=useRef(0),settingsBackup=useRef<Settings|null>(null),settingsWorkerReady=useRef(false),editorSource=useRef(editor.source);editorSource.current=editor.source;
 const onError=(e:unknown)=>setError(createDiagnostic(e));
 const {conversations,setConversations,selectedConversationId,setSelectedConversationId,selectedConversationRef,conversationSelectionSeq,sessionSelection,setSessionSelection,freshSelectionPending,agentBusy,setAgentBusy,planningMode,setPlanningMode,conversationChanged,acceptAgentConversation,chooseConversation,newConversation,retryNewConversation}=useConversationSelection({
  invoke,mounted,settingsReady,editorDirty,confirmReplace,language:settings.language,
  beforeSelection(){openSeq.current++;deploymentOpening.current=null;setSkill(undefined);},
  clearIntent:()=>setAgentIntent(undefined),beginWorkerGate,observeWorker,
  onSelected:selected=>presentConversation(selected),
  onFreshSelected(){setAgentVisible(true);setPrimaryPanel('agent');setSection('home');},
  onSelectionError(error){setWorkerRestoring(false);onError(error);},onError
 });
 const computeResourceScope=agentProvider+'|'+conversationSelectionSeq.current+'|'+(sessionSelection?.nonce||'')+'|'+(selectedConversationId||'');resourceScopeRef.current=computeResourceScope;
 const selectedRecords=selectedRecordScope(computeResource,conversationSelectionSeq.current);
 const activeFlow=agentTasks.find(task=>task.id===selectedConversationRef.current?.taskId);
 const flowWorker=taskWorkerSource(activeFlow)?.binding;
 const sshDraftTaskId=computeResource?.kind==='ssh-connection'&&computeResource.status==='selected'&&
  computeResource.authentication==='verified'&&computeResource.workflowReady&&
  (unboundWorkflow(activeFlow)||flowWorker?.kind==='ssh'&&computeResource.profileId===flowWorker.profileId&&computeResource.profileVersion===flowWorker.profileVersion)?activeFlow.id:undefined;
 useEffect(()=>{
  // The workflow may receive its draft binding after the first disconnected observation.
  if(sshDraftTaskId&&!agentBusy&&!workerReady.current&&initialSelectionReady.current)void observeWorker(sshDraftTaskId);
 },[sshDraftTaskId,selectedRecords?.key,JSON.stringify(flowWorker),agentBusy]);
 useEffect(()=>{
  recordReadSequence.current++;recordReadPending.current=null;
  if(selectedRecords){setRecordService({phase:'checking',scopeKey:selectedRecords.key});setRecordObservations(old=>({local:{...old.local,stale:old.local.loaded,sourceChanged:old.local.loaded},cluster:{...old.cluster,stale:old.cluster.loaded,sourceChanged:old.cluster.loaded}}));void refreshSelectedRecords();}
  return()=>{recordReadSequence.current++;};
 },[selectedRecords?.key,computeResource?.workflowReady,computeResource?.capabilities?.service?.status]);
 useEffect(()=>{if(!selectedRecords||section!=='runs')return;const timer=setInterval(()=>void refreshSelectedRecords(),30000);return()=>clearInterval(timer);},[selectedRecords?.key,section]);
 useEffect(()=>{void refreshComputeResource();return()=>{resourceReadSequence.current++;};},[computeResourceScope]);
 const {focus:toolWorkflowFocus,open:openToolWorkflow}=useToolWorkflowNavigation({mounted,selected:selectedConversationRef,selectionSequence:conversationSelectionSeq,navigationSequence:openSeq,busy:agentBusy,conversations,chooseConversation,onError,onOpen:location=>{setPrimaryPanel('workspace');setSelected(null);setSection('agent-task:'+location.task_id);}});
 useEffect(()=>window.studio?.onEvent(event=>{
  if(event.method==='studio/cliRuntimeRequired'&&['kimi','qwen'].includes(event.provider||'')&&event.params?.provider===event.provider)setCliRequired(event.params);
  if(event.method==='studio/computeResourceChanged'||event.method==='studio/conversationTerminalChanged'||event.method==='studio/sshConnectionChanged'||event.method==='studio/toolsStatus'||event.method==='studio/sshServiceChanged')void refreshComputeResource();
  if(event.method==='studio/computeSetup'&&event.params.status!=='discovering')void refresh();
  if(event.method==='studio/workerConnected'&&explicitConnection.current===null){beginWorkerGate();if(initialSelectionReady.current)void observeWorker(selectedConversationRef.current?.taskId);}
  if(event.method==='studio/conversationContextChanged'){
   const p=event.params,c=p.conversation;setConversations(old=>[c,...old.filter(row=>!(row.provider===c.provider&&[p.oldThreadId,c.threadId].includes(row.threadId)))]);
   if(selectedConversationRef.current?.provider===c.provider&&selectedConversationRef.current?.threadId===p.oldThreadId){selectedConversationRef.current=c;setSelectedConversationId(c.id);storeConversation(c.id);}
  }
  if(event.method==='studio/conversationGroupDeleted')applyGroupDeletion(event.params);
  if(event.method==='studio/conversationDeleted')applyConversationDeletion(event.params);
  if(event.method==='studio/conversationUpdated'){const conversation=event.params.conversation;setConversations(old=>[conversation,...old.filter(c=>c.id!==conversation.id)]);const previous=selectedConversationRef.current;if(previous&&conversation.id===previous.id){selectedConversationRef.current=conversation;setProjectId(current=>followedProjectId(current,previous.projectId,conversation.projectId));void refresh();}}
  if(event.method==='studio/taskUpdated'){const task=event.params.task;setAgentTasks(old=>[task,...old.filter(t=>t.id!==task.id)]);if(event.params.showFlow&&task.threadId===selectedConversationRef.current?.threadId&&task.provider===selectedConversationRef.current?.provider)setSection('agent-task:'+task.id);}
 }),[]);
 projectPolicyOwner.current={worker:worker&&!disconnected,projectId,selection:conversationSelectionSeq.current,modal,saving:busy};
 const project=projects.find(p=>p.id===projectId),selectedRun=runs.find(r=>r.id===selected);
 const runProjectId=computeProjectForSelection(projectId,agentTasks.find(task=>task.id===selectedConversationRef.current?.taskId));
 const runProject=projects.find(p=>p.id===runProjectId);
 const trainingRuns=runs.filter(run=>(!runProjectId||run.project_id===runProjectId)&&/^(nep|hotpp)\./.test(run.engine));
 useEffect(()=>{
   mounted.current=true;
  const interactiveFrame=requestAnimationFrame(()=>void invoke('diagnostics.performance',{phase:'renderer-interactive'}).catch(()=>{}));
  let disposed=false;const revision=settingsRevision.current;
  const restoreSequence=conversationSelectionSeq.current,list=invoke<Conversation[]>('conversation.list').then(values=>{if(!disposed)setConversations(values);return values;}).catch(error=>{if(!disposed)onError(error);return [];});
  void invoke<any[]>('conversation.groups').then(setChatGroups).catch(onError);
  void invoke<any[]>('task.list').then(setAgentTasks).catch(()=>{});
  void invoke<Plan[]>('workflow.list').then(setPlans).catch(()=>{});
  const state=invoke('state').then(state=>{if(disposed)return;if(state.setupGuide){setGuideInfo(state.setupGuide);if(state.setupGuide.page!=='complete')setGuidePage(state.setupGuide.page);}if(revision!==settingsRevision.current)return;setLanguage(state.settings.language||'zh-CN');settingsKnown.current=true;settingsRef.current=state.settings;applySettings(state.settings);}).catch(error=>{if(!disposed)onError(error);}).finally(()=>finishSettings.current());
  void Promise.all([list,state]).then(async([values])=>{if(disposed)return;initialSelectionReady.current=true;if(restoreSequence!==conversationSelectionSeq.current)return;const previous=values.find(c=>c.id===storedConversation());if(previous)await chooseConversation(previous);else if(revision===settingsRevision.current&&explicitConnection.current===null)await observeWorker(undefined,false,true);});
  const handle=(e:KeyboardEvent)=>{if(document.querySelector('.setup-layer:not([hidden])')&&(e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();return;}if(projectPolicyOwner.current.modal==='project-edit'&&projectPolicyOwner.current.saving&&(e.key==='Escape'||(e.ctrlKey||e.metaKey)&&e.key==='k')){e.preventDefault();return;}if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();setCommand(v=>!v);}if(e.key==='Escape'){setModal(m=>m==='settings'?m:'');setCommand(false);setPaletteSearch('');}};
  document.addEventListener('keydown',handle);return()=>{cancelAnimationFrame(interactiveFrame);disposed=true;mounted.current=false;workerHydrationEpoch.current++;workerReady.current=false;finishSettings.current();document.removeEventListener('keydown',handle);};
 },[]);
 useEffect(()=>{
  document.documentElement.dataset.theme=settings.theme;
  document.documentElement.lang=settings.language||'zh-CN';
  const fonts:Record<string,string>={system:'"Segoe UI", "Microsoft YaHei", sans-serif',sans:'"Segoe UI", "Microsoft YaHei", sans-serif',serif:'Georgia, "SimSun", serif'};
  const fontSize=bounded(settings.fontSize,12,24,18);
  document.documentElement.style.setProperty('--ui-font',fonts[settings.fontFamily||'system']||fonts.system);
  document.documentElement.style.setProperty('--ui-min-font',bounded(settings.minimumFontSize,11,18,17)+'px');
  document.documentElement.style.setProperty('--chat-font-size',bounded(settings.chatFontSize||settings.fontSize,12,28,18)+'px');
  document.documentElement.style.setProperty('--ui-scale',String(fontSize/13));
  document.documentElement.style.setProperty('--editor-font-size',String(bounded(settings.editorFontSize,10,28,18)));
  document.documentElement.style.setProperty('--terminal-font-size',String(bounded(settings.terminalFontSize,10,24,17)));
  window.dispatchEvent(new Event('studio:appearance'));
 },[settings]);
 useEffect(()=>{setRunJson(JSON.stringify(runDraft,null,2));},[runDraft]);
 useEffect(()=>{localStorage.setItem('studio.agent',String(agentVisible));},[agentVisible]);
 useEffect(()=>{localStorage.setItem('studio.sidebarVisible',String(sidebarVisible));localStorage.setItem('studio.sidebarWidth',String(sidebarWidth));},[sidebarVisible,sidebarWidth]);
 useEffect(()=>{localStorage.setItem('studio.agentWidth',String(agentWidth));},[agentWidth]);
 useEffect(()=>{localStorage.setItem('studio.overviewAgentWidth',String(overviewAgentWidth));},[overviewAgentWidth]);
 useEffect(()=>{localStorage.setItem('studio.section',section);},[section]);
 useEffect(()=>{if(!worker)return;let disposed=false;const refreshGpu=()=>{if(gpuLoading.current||(sourceFailures.current.get('/api/gpu')||0)>=3)return;gpuLoading.current=true;const generation=sourceGeneration.current;void api<any[]>('GET','/api/gpu').then(value=>{if(disposed||generation!==sourceGeneration.current)return;sourceFailures.current.delete('/api/gpu');setGpuStale(false);setGpuStatus(value);}).catch(()=>{if(!disposed&&generation===sourceGeneration.current){sourceFailures.current.set('/api/gpu',(sourceFailures.current.get('/api/gpu')||0)+1);setGpuStale(true);}}).finally(()=>{if(!disposed)gpuLoading.current=false;});};refreshGpu();const timer=setInterval(refreshGpu,5000);return()=>{disposed=true;gpuLoading.current=false;clearInterval(timer);};},[worker]);
 useEffect(()=>{localStorage.setItem('studio.bottom',String(bottomHeight));},[bottomHeight]);
 useEffect(()=>{localStorage.setItem('studio.bottomExpanded',String(bottomExpanded));},[bottomExpanded]);
 useEffect(()=>{const resize=()=>setWindowWidth(window.innerWidth);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
 useEffect(()=>{if(section!=='home')setPrimaryPanel('workspace');},[section]);
 useEffect(()=>{if(!sessionSelection?.new)return;const frame=requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('.agent-panel .composer textarea')?.focus());return()=>cancelAnimationFrame(frame);},[sessionSelection?.nonce]);
 function invalidateRefresh(){setRefreshFeedback(null);refreshSeq.current++;refreshing.current=false;latestRefresh.current=Promise.resolve();}
 function beginWorkerGate(){workerHydrationEpoch.current++;workerReady.current=false;setRunSourceEpoch(null);setWorkerSourceId('');setWorkerNotice('');setServiceVersion('unconfirmed');setWorker(false);setWorkerRestoring(true);sourceGeneration.current++;referenceReads.current.clear();projectPolicyWorkerEpoch.current++;invalidateRefresh();return workerHydrationEpoch.current;}
 async function observeWorker(taskId?:string|null,explicit=false,global=false){
  const epoch=beginWorkerGate(),conversationId=!taskId&&!explicit?selectedConversationRef.current?.id:undefined,current=()=>mounted.current&&epoch===workerHydrationEpoch.current;
  await settingsReady.current;if(!current())return false;if(!settingsKnown.current){setWorkerRestoring(false);return true;}
  const read=()=>taskId?restoreWorker(taskId):conversationId?restoreWorker({conversationId}):global?restoreWorker({scope:'global'}):readWorkerStatus();
  try{let observed=await read();for(let retry=0;observed.status==='checking'&&retry<8&&current();retry++){await new Promise(resolve=>setTimeout(resolve,250));if(!current())return false;observed=await read();}if(!current())return false;workerReady.current=observed.status==='connected'&&(!taskId||observed.taskId===taskId)&&(!conversationId||observed.conversationId===conversationId);if(workerReady.current&&observed.sourceId){
   if(verifiedExecutionSource.current&&verifiedExecutionSource.current!==observed.sourceId&&!selectedRecordScope(computeResourceRef.current,conversationSelectionSeq.current))leavePreviousRun();
  }
  if(workerReady.current)verifiedExecutionSource.current=observed.sourceId||null;
  setWorker(workerReady.current);setWorkerSourceId(workerReady.current?observed.sourceId||'':'');setServiceVersion(workerReady.current&&(observed.serviceVersion==='current'||observed.serviceVersion==='different')?observed.serviceVersion:'unconfirmed');setWorkerRestoring(false);if(workerReady.current){sourceFailures.current.clear();await refresh();}else if(observed.reason==='ssh_reconnect_required'||observed.reason==='ssh_service_unconfirmed'){setWorkerNotice('请恢复此流程原有的 SSH 连接，登录后接入作业服务。');}else if(observed.reason==='wsl_access_denied'){setWorkerNotice('当前账户无法访问 WSL，请检查 Windows 用户与发行版权限后重试。');}else if(observed.reason==='project_missing'){setWorkerNotice('当前会话未绑定计算项目');const service=await readWorkerStatus();if(current()&&service.status==='connected')setWorkerNotice('服务已连接 · 当前会话未绑定计算项目');}}
  catch(error){if(current()){setWorkerRestoring(false);onError(error);}}
  return current();
 }
 function refresh(force=true,manual=false):Promise<void>{
  if(!workerReady.current)return Promise.resolve();
  if(refreshing.current&&(!force||manual)){if(manual)setRefreshFeedback({seq:refreshSeq.current,status:'loading',at:null});return latestRefresh.current;}
  if(force){sourceFailures.current.clear();sourceGeneration.current++;}
  const seq=++refreshSeq.current;if(manual)setRefreshFeedback({seq,status:'loading',at:null});else if(force)setRefreshFeedback(null);
  refreshing.current=true;const job=loadAll(seq,force).finally(()=>{if(seq===refreshSeq.current)refreshing.current=false;});latestRefresh.current=job;return job;
 }
 function refreshSelectedRecords(manual=false):Promise<void>{
  const scope=selectedRecordScope(computeResourceRef.current,conversationSelectionSeq.current);if(!scope)return refresh(true,manual);
  if(recordReadPending.current?.key===scope.key)return recordReadPending.current.promise;
  const seq=++recordReadSequence.current,current=()=>mounted.current&&seq===recordReadSequence.current&&selectedRecordScope(computeResourceRef.current,conversationSelectionSeq.current)?.key===scope.key;
  setRecordService(old=>({...old,phase:'checking',scopeKey:scope.key}));
  const promise=(async()=>{try{
   const result=await readSelectedServiceRecords({scope,current,readStatus:readWorkerStatus,read:target=>api<any[]>('GET',target),onSource:sourceId=>{if(!current())return;
    if(verifiedRecordSource.current&&verifiedRecordSource.current!==sourceId)leavePreviousRun();
    verifiedRecordSource.current=sourceId;setRecordObservations(old=>({local:{...old.local,stale:old.local.loaded,sourceChanged:old.local.loaded&&old.local.sourceId!==sourceId},cluster:{...old.cluster,stale:old.cluster.loaded,sourceChanged:old.cluster.loaded&&old.cluster.sourceId!==sourceId}}));}});
   if(!current()||!result)return;
   if(result.phase!=='ready'){setRecordService({phase:'unavailable',scopeKey:scope.key});setRecordObservations(old=>({local:{...old.local,stale:old.local.loaded,sourceChanged:result.sourceChanged||old.local.sourceChanged},cluster:{...old.cluster,stale:old.cluster.loaded,sourceChanged:result.sourceChanged||old.cluster.sourceChanged}}));return;}
   setRecordService({phase:'ready',sourceId:result.sourceId,scopeKey:scope.key,serviceVersion:result.serviceVersion});
   for(const [index,key] of (['local','cluster'] as const).entries()){
    const observed=result.records[index];if(observed.status==='fulfilled'&&Array.isArray(observed.value)){
     if(key==='local')setRuns(observed.value);else setClusterRuns(observed.value);
     setRecordObservations(old=>({...old,[key]:{at:Date.now()/1000,loaded:true,stale:false,sourceId:result.sourceId,sourceChanged:false}}));
    }else setRecordObservations(old=>({...old,[key]:{...old[key],stale:true}}));
   }
  }catch{if(current()){setRecordService({phase:'unavailable',scopeKey:scope.key});setRecordObservations(old=>({local:{...old.local,stale:old.local.loaded},cluster:{...old.cluster,stale:old.cluster.loaded}}));}}finally{if(seq===recordReadSequence.current)recordReadPending.current=null;}})();
  recordReadPending.current={key:scope.key,promise};return promise;
 }
 async function loadAll(seq:number,force:boolean):Promise<void>{
  const paths=['/api/projects','/api/environments','/api/runs','/api/assets','/api/cluster-runs'],epoch=workerHydrationEpoch.current,generation=sourceGeneration.current;
  const current=()=>mounted.current&&seq===refreshSeq.current&&epoch===workerHydrationEpoch.current&&generation===sourceGeneration.current;
  const now=Date.now(),requested=paths.map(path=>{
   if(computeResourceRef.current?.kind==='ssh-connection'&&(path==='/api/runs'||path==='/api/cluster-runs'))return false;
   if((sourceFailures.current.get(path)||0)>=3)return false;
   if(path==='/api/assets')return section==='assets';
   if(path==='/api/projects'||path==='/api/environments')return force||!referenceReads.current.has(path)||now-referenceReads.current.get(path)!>=30000;
   return true;
  });
  const results=await Promise.allSettled(paths.map(async(path,index)=>{
   if(!requested[index])return;
   if(index<2)referenceReads.current.set(path,now);
   const isRecord=index===2||index===4;
   const ownsResult=()=>current()&&(!isRecord||!selectedRecordScope(computeResourceRef.current,conversationSelectionSeq.current));
   try{
    const value=await api<any[]>('GET',path);if(!ownsResult())return;
    sourceFailures.current.delete(path);
    if(index===0)setProjects(value);
    if(index===1)setEnvironments(value);
    if(index===2){setRuns(value);setRunSourceEpoch(epoch);setDisconnected(false);}
    if(index===3)setAssets(value);
    if(index===4)setClusterRuns(value);
    const key=index===2?'local':index===4?'cluster':null;
    if(key)setRecordObservations(previous=>({...previous,[key]:{at:Date.now()/1000,stale:false,loaded:true,workerEpoch:epoch,sourceId:verifiedExecutionSource.current||undefined}}));
   }catch(error){
    if(ownsResult()){
     const failures=(sourceFailures.current.get(path)||0)+1;sourceFailures.current.set(path,failures);
     if(index===2)setDisconnected(true);
     const key=index===2?'local':index===4?'cluster':null;
     if(key)setRecordObservations(previous=>({...previous,[key]:{...previous[key],stale:true,paused:failures>=3}}));
    }
    throw error;
   }
  }));
  if(!current())return;
  const scored=results.filter((_result,index)=>requested[index]);
  if(results[2].status==='fulfilled'&&requested[2]&&results[4].status==='fulfilled'&&requested[4])void invoke('diagnostics.performance',{phase:'workspace-observed'}).catch(()=>{});
  setRefreshFeedback(previous=>previous?.seq===seq?{seq,status:scored.every(result=>result.status==='fulfilled')?'complete':scored.some(result=>result.status==='fulfilled')?'partial':'failed',at:Date.now()}:previous);
 }
 useEffect(()=>{if(!worker)return;void refresh(false);const timer=setInterval(()=>void refresh(false),2500);return()=>clearInterval(timer);},[worker,projectId,section]);
 function openComputeGuide(taskId=selectedConversationRef.current?.taskId,profile?:{id:string;version:number}):Promise<boolean>{if(computeGuideRequest.current)return computeGuideRequest.current.promise;const id=crypto.randomUUID();let resolve!:(connected:boolean)=>void;const promise=new Promise<boolean>(done=>{resolve=done;});computeGuideRequest.current={id,promise,resolve};setConnecting(true);setComputeGuide({id,...profile?{profile}:taskId?{taskId}:{}});return promise;}
 function closeComputeGuide(id:string,connected:boolean){if(computeGuideRequest.current?.id!==id)return;const request=computeGuideRequest.current;computeGuideRequest.current=null;setComputeGuide(null);setConnecting(false);request.resolve(connected);}
 async function connectWorker(taskId=selectedConversationRef.current?.taskId){const binding=taskWorkerSource(agentTasks.find(task=>task.id===taskId))?.binding,resource=computeResourceRef.current;if(binding?.kind==='ssh'||!binding&&isSshResource(resource)){setWorkerNotice('请恢复此流程原有的 SSH 连接，登录后接入作业服务。');setPrimaryPanel('workspace');showTerminal();if(isSshResource(resource)&&resource.alive===true&&(!binding||resource.profileId===binding.profileId&&resource.profileVersion===binding.profileVersion)){/* Reuse the already-open terminal; never open another authentication process. */}else setComputeChooser(true);return;}const sequence=conversationSelectionSeq.current,conversation=selectedConversationRef.current,current=()=>mounted.current&&sequence===conversationSelectionSeq.current&&conversation?.id===selectedConversationRef.current?.id;try{const pending=freshSelectionPending.current;if(pending?.sequence===sequence){await pending.promise;if(!current())return;taskId=selectedConversationRef.current?.taskId;}const connected=await openComputeGuide(taskId);if(!connected||!current())return;const state=await invoke<{settings:Settings}>('state');if(!current())return;setSettings(state.settings);settingsKnown.current=true;await observeWorker(taskId,true);}catch(error){if(current())onError(error);}}
 async function connectAndBindDraft(taskId:string){
  const conversation=selectedConversationRef.current;if(agentBusy||conversation?.taskId!==taskId)return;
  const sequence=conversationSelectionSeq.current,epoch=beginWorkerGate();explicitConnection.current=epoch;setConnecting(true);
  const current=()=>mounted.current&&epoch===workerHydrationEpoch.current&&sequence===conversationSelectionSeq.current&&selectedConversationRef.current?.id===conversation.id;
  try{const status=await readWorkerStatus();if(!current())return;if(status.status!=='connected'){if(!await openComputeGuide(taskId)||!current())return;}settingsKnown.current=true;const task=await invoke('task.authoring.bindWorker',{taskId});if(!current())return;setAgentTasks(old=>[task,...old.filter(value=>value.id!==taskId)]);if(!await observeWorker(taskId)||selectedConversationRef.current?.id!==conversation.id)return;setSessionSelection({nonce:crypto.randomUUID(),conversation});}
  catch(error){if(current()){setWorkerRestoring(false);onError(error);}}
  finally{if(explicitConnection.current===epoch){explicitConnection.current=null;setConnecting(false);}}
 }
 function newProject(){setModal('project');}
 function policyError(value:unknown){const code=errorText(value),messages:Record<string,string>={project_edit_authoring_only:'草稿工作区不能通过此入口升级计算授权。',project_edit_unavailable:'项目、会话或计算连接已变化，请关闭后重新打开。',project_edit_record_invalid:'无法读取此计算项目的完整记录。',project_edit_conflict:'项目记录已变化，请关闭后重新打开并检查最新授权。',project_edit_invalid_fields:'授权字段无效，请检查表单。',project_edit_no_changes:'尚无变更',project_edit_busy:'保存中，请稍候。',project_edit_save_mismatch:'保存返回与原项目不一致，请重新读取实际项目状态。',project_edit_save_unconfirmed:'保存结果未能确认，可能已写入；请关闭后核对实际项目，不要假定已撤销。'};return t(messages[code]||code);}
 function closeProjectPolicy(){if(projectPolicyOwner.current.saving)return;projectPolicySeq.current++;projectPolicyEdit?.cancel();setProjectPolicyEdit(null);setProjectPolicyInitial(null);setProjectPolicyError('');setModal('');}
 async function editProjectPolicy(record:Project){
  if(!worker||disconnected||record.authoring_only){onError(t('草稿工作区不能通过此入口升级计算授权。'));return;}
  const seq=++projectPolicySeq.current,selectedProject=projectId,selection=conversationSelectionSeq.current,epoch=projectPolicyWorkerEpoch.current;
  projectPolicyEdit?.cancel();setProjectPolicyInitial(null);setProjectPolicyError('');setProjectPolicyId(record.id);setModal('project-edit');projectPolicyOwner.current={...projectPolicyOwner.current,modal:'project-edit'};
  const current=()=>{const owner=projectPolicyOwner.current;return seq===projectPolicySeq.current&&owner.worker&&owner.modal==='project-edit'&&owner.projectId===selectedProject&&owner.selection===selection&&projectPolicyWorkerEpoch.current===epoch;};
  const editor=createProjectPolicyEditor({projectId:record.id,engines:engines.map(([id])=>id),current,read:()=>api<Project[]>('GET','/api/projects'),write:value=>api<Project>('POST','/api/projects',value)});setProjectPolicyEdit(editor);
  try{const opened=await editor.open();if(current())setProjectPolicyInitial(opened.spec);}catch(error){if(seq===projectPolicySeq.current)setProjectPolicyError(policyError(error));}
 }
 async function saveProjectPolicy(spec:ProjectAuthorizationSpec){
  if(!projectPolicyEdit)return;setBusy(true);projectPolicyOwner.current={...projectPolicyOwner.current,saving:true};
  try{const saved=await projectPolicyEdit.save(spec);setProjects(old=>old.map(project=>project.id===saved.id?saved:project));setProjectPolicyEdit(null);setProjectPolicyInitial(null);setModal('projects');}
  catch(error){throw Error(policyError(error));}finally{projectPolicyOwner.current={...projectPolicyOwner.current,saving:false};setBusy(false);}
 }

 function projectLabel(value:Project){return value.authoring_only?(agentTasks.find(task=>task.id===value.authoring_task_id)?.name||value.name):value.name;}
 function newEnvironment(){
  setEnvironmentDraft(JSON.stringify({name:'WSL 科学环境',executables:{python:'/usr/bin/python3'},repositories:{},variables:{}},null,2));setModal('environment');
 }
 function makeRun(engine:string){
  const inputs=engine.startsWith('gpumd')?{'run.in':'','model.xyz':''}:engine.startsWith('pydyn')?{'run.py':''}:engine==='nep.eval'?{'nep.in':'','train.xyz':'','nep.txt':''}:engine==='nep.train'?{'nep.in':'','train.xyz':'','test.xyz':''}:engine==='hotpp.train'?{'input.yaml':''}:engine==='pygas.build'?{'build_bias.py':''}:{};
  return {name:engines.find(e=>e[0]===engine)?.[1],engine,project_id:projectId,environment_id:project?.policy.environments[0]||environments[0]?.id||'',gpu:project?.policy.gpus[0]??0,max_seconds:Math.min(3600,project?.policy.max_seconds??3600),idempotency_key:crypto.randomUUID(),inputs,parameters:{}};
 }
 function newRun(engine='gpumd.md'){
  setRunDraft(makeRun(engine));setModal('run');
 }
 function changeEngine(engine:string){
  setRunDraft((old:any)=>({...makeRun(engine),environment_id:old.environment_id,gpu:old.gpu,max_seconds:old.max_seconds}));
 }
 const runDirty=modal==='run'&&runJson!==JSON.stringify(runDraft,null,2);
 function applyRunJson(){
  try{const value=JSON.parse(runJson);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('JSON object required');setRunDraft(value);}catch(e){onError(e);}
 }
 function confirmReplace(extra=false){return !(editorDirty||extra)||window.confirm(tr('编辑器中有未保存的修改，是否替换？'));}
 async function saveInput(mode:'project'|'windows'='project'){
  if(editorSaving.current)return;editorSaving.current=true;setEditorSave(mode);
  const snapshot=editorLatest.current,epoch=workerHydrationEpoch.current,selectedProject=projectId;
  const current=()=>mounted.current&&editorLatest.current.id===snapshot.id&&editorLatest.current.name===snapshot.name&&editorLatest.current.source===snapshot.source;
  try{
   if(mode==='windows'){
    const result=await invoke('file.save',{id:snapshot.id,content:snapshot.source,name:snapshot.name});
    if(result&&current()){setEditor(previous=>({...previous,...result}));setEditorDirty(false);}return result?.path;
   }
   if(!project)throw Error('先选择或创建项目');
   const result=await api('POST','/api/workspace/write',{project_id:selectedProject,name:snapshot.name,content:snapshot.source});
   if(current()&&epoch===workerHydrationEpoch.current&&projectPolicyOwner.current.projectId===selectedProject){setEditor(previous=>({...previous,path:result.path}));setEditorDirty(false);}return result.path;
  }finally{editorSaving.current=false;if(mounted.current)setEditorSave('');}
 }
 async function runAction(id:string,action:string){try{await api('POST','/api/run/'+action,{run_id:id});await refresh();}catch(e){onError(e);}}
 function startTerminal(){
  setPrimaryPanel('workspace');setTerminalRequest({nonce:crypto.randomUUID(),kind:'local',mode:'interactive'});showTerminal();
 }
 function startClusterTerminal(clusterId:string,mode:'interactive'|'key'='interactive',version?:number){
  setPrimaryPanel('workspace');setTerminalRequest({nonce:crypto.randomUUID(),kind:'ssh',mode,clusterId,version});showTerminal();
 }
 function presentConversation(conversation:Conversation,focusAgent=false){setChatGroupId(conversation.groupId||null);setProjectId(conversation.projectId||'');setAgentVisible(true);if(focusAgent||!conversation.taskId)setPrimaryPanel('agent');setSection(conversation.taskId?'agent-task:'+conversation.taskId:'home');}
 function terminalConversationPrepared(conversation:Conversation){
  if(!mounted.current||freshSelectionPending.current||selectedConversationRef.current?.threadId)return;
  conversationSelectionSeq.current++;openSeq.current++;deploymentOpening.current=null;setSkill(undefined);setAgentIntent(undefined);beginWorkerGate();
  conversationChanged(conversation);setAgentProvider(conversation.provider);presentConversation(conversation,true);
  setSessionSelection({nonce:crypto.randomUUID(),conversation,adoptDraft:true});void observeWorker(conversation.taskId);
 }
 const legacyRunDraftScope=JSON.stringify(selectedConversationRef.current?.taskId?['task-source',selectedConversationRef.current.provider,selectedConversationRef.current.id,selectedConversationRef.current.taskId]:['global-source',settings.distribution,settings.workerRoot,settings.workerPort]);
 const runDraftScope=workerSourceId?JSON.stringify(['worker-source',workerSourceId]):legacyRunDraftScope;
 const active=runs.filter(r=>r.status==='running'),allJobs=unifiedJobs(runs,clusterRuns);
 const queueItems=allJobs.filter(job=>['queued','running','unknown'].includes(job.run.status));
 const context=JSON.stringify({workflow:section.startsWith('plan:')?plans.find(p=>p.id===section.slice(5)):section.startsWith('workflow:')?tasks.find(t=>t.id===section.slice(9)):null,clusters:project?.policy.clusters||[],project:project?{id:project.id,name:project.name,policy:project.policy}:null,selectedRun:selectedRun?{id:selectedRun.id,engine:selectedRun.engine,status:selectedRun.status}:null,environments:environments.map(e=>({id:e.id,name:e.name}))});
 async function openTask(id:string){
  if(openingRunRef.current?.id===id&&openingRunRef.current.sequence===openSeq.current)return;
  const sequence=++openSeq.current,ticket={id,sequence};openingRunRef.current=ticket;setOpeningRun(ticket);
  const scope=selectedRecordScope(computeResourceRef.current,conversationSelectionSeq.current),sourceId=recordServiceRef.current.sourceId,epoch=workerHydrationEpoch.current;
  const current=()=>sequence===openSeq.current&&mounted.current&&selectedRecordScope(computeResourceRef.current,conversationSelectionSeq.current)?.key===scope?.key&&
   (scope?recordServiceRef.current.phase==='ready'&&recordServiceRef.current.sourceId===sourceId:workerHydrationEpoch.current===epoch);
  try{
   if(scope&&!await verifyRecordSource(scope,sourceId,current))return;
   const run=await api<Run>('POST','/api/run/status',{run_id:id});if(!current()||scope&&!await verifyRecordSource(scope,sourceId,current))return;
   if(run.id!==id)throw Error(t('作业服务返回的记录与所选作业不一致。'));
   invalidateRefresh();setRuns(old=>[run,...old.filter(r=>r.id!==run.id)]);if(scope&&sourceId)setRecordDetailReceipt({id,sourceId,scopeKey:scope.key});setPrimaryPanel('workspace');setSelected(id);setSection('task:'+id);if(!scope)void refresh();
  }catch(error){if(current())onError(error);}finally{if(openingRunRef.current===ticket){openingRunRef.current=null;if(mounted.current)setOpeningRun(null);}}
 }
 async function verifyRecordSource(scope:NonNullable<ReturnType<typeof selectedRecordScope>>,sourceId:string|undefined,current:()=>boolean){
  const status=await readWorkerStatus();if(!current())return false;
  if(matchesSelectedRecordService(status,scope)&&status.sourceId===sourceId)return true;
  setRecordService({phase:'unavailable',scopeKey:scope.key});setRecordObservations(old=>({local:{...old.local,stale:old.local.loaded,sourceChanged:true},cluster:{...old.cluster,stale:old.cluster.loaded,sourceChanged:true}}));return false;
 }
 function replaceTask(run:Run){openSeq.current++;invalidateRefresh();setRuns(old=>[run,...old.filter(r=>r.id!==run.id)]);setSelected(run.id);setSection('task:'+run.id);}
 function openWorkflow(id:string){openSeq.current++;setSection('workflow:'+id);setSelected(null);}
 function go(id:string){if(section==='editor'&&id!=='editor'&&!confirmReplace())return;conversationSelectionSeq.current++;deploymentOpening.current=null;setPrimaryPanel('workspace');openSeq.current++;setSection(id);setSelected(id.startsWith('task:')?id.slice(5):null);return true;}
 async function guideProgress(page:SetupProgress){
  const info=await invoke<SetupGuideInfo>('onboarding.progress',{page} satisfies SetupProgressRequest);
  if(!info||page==='complete'&&info.page!=='complete')throw Error(t('引导进度未保存，请重试。'));
  setGuideInfo(info);setGuidePage(page==='complete'?null:page);setLesson(null);
 }
 async function guidePreferences(patch:SetupPreferences){
  const saved=await invoke<Settings>('settings',patch);
  if(!saved)throw Error(t('设置未保存，请重试。'));
  setLanguage(saved.language||'zh-CN');setSettings(saved);
  if(patch.agentProvider){setGuideReply(null);setGuideProvider({provider:patch.agentProvider,nonce:crypto.randomUUID()});}
 }
 function openSetupGuide(){
  setLesson(null);if(!guidePage)setGuidePage('welcome');else requestAnimationFrame(()=>{const anchor=lessonOpener.current;
   (anchor?.isConnected&&anchor.getClientRects().length?anchor:document.getElementById('setup-heading'))?.focus({preventScroll:true});lessonOpener.current=null;
  });
  const revision=settingsRevision.current;
  void invoke<{settings:Settings}>('state').then(state=>{
   if(!mounted.current||revision!==settingsRevision.current||!state?.settings)return;
   setLanguage(state.settings.language||'zh-CN');setSettings(state.settings);
  }).catch(onError);
 }
 function connectFromGuide(kind:'wsl'|'ssh'){
  if(kind==='wsl'&&!isSshResource(computeResource)&&!selectedConversationRef.current?.taskId){openLocalCompute();return;}
  lessonOpener.current=document.activeElement as HTMLElement|null;
  setGuideKind(kind);setComputeChooserEdit(undefined);setComputeChooser(true);
 }
 async function visitFromGuide(destination:SetupVisit,shortCase?:string){
  lessonOpener.current=document.activeElement as HTMLElement|null;
  const english=settings.language==='en',provider=settingsRef.current.agentProvider||'codex';
  switch(destination){
   case 'model-test': {
    const message=english?'Reply with OK to test this model connection.':'请回复 OK，测试这条模型连接。';
    if(await newConversation(false,message,provider))setLesson({destination});
    break;
   }
   case 'tour-goal': {
    const goal=english?'I want to run a short molecular dynamics simulation of FCC copper and inspect its temperature and trajectory. List the structure, potential and compute environment I need, then draft a workflow for me to review.':
      '我想对面心立方铜做一次分子动力学短试算，观察温度和轨迹。请先列出需要的结构、势模型和计算环境，再给我一份待核对的流程草稿。';
    if(await newConversation(true,goal,provider))setLesson({destination});
    break;
   }
   case 'short-check': {
    const check=english?`Use studio-install-readiness to prepare the installation check ${shortCase}. Use the selected resource and registered environment. Show me the inputs and resources before running.`:
      `请按 studio-install-readiness 准备安装短例 ${shortCase}。沿用所选计算资源和已登记环境，先给我看输入和资源，再决定执行。`;
    if(await newConversation(true,check,provider))setLesson({destination,shortCase});
    break;
   }
   default: if(go(destination))setLesson({destination});
  }
 }
 function openSettings(){settingsBackup.current=settings;settingsWorkerReady.current=workerReady.current;setModal('settings');}
 function openAccounts(provider:AgentProvider=agentProvider){setAccountsProvider(provider);setModal('accounts');}
 async function renameConversation(){if(!renameTarget||renaming)return;setRenaming(true);try{const value=await invoke<Conversation>('conversation.rename',{id:renameTarget.id,name:conversationName});setConversations(old=>old.map(c=>c.id===value.id?value:c));setRenameTarget(null);}catch(error){onError(error);}finally{setRenaming(false);}}
 function openComputeResources(){setGuideKind(undefined);if(modal==='settings'){if(settingsSavingRef.current)return;closeSettings();}setComputeChooser(true);}
 async function connectSavedLocal(profile:WslComputeProfile){
  if(agentBusy||explicitConnection.current!==null)return;
  const sequence=conversationSelectionSeq.current,token=Date.now(),initialSelection=computeResourceRef.current?.selectionId??null;
  explicitConnection.current=token;setComputeChooser(false);
  const current=()=>mounted.current&&sequence===conversationSelectionSeq.current;
  try{
   const originalResource=await computeResources.status();
   if(!current()||(computeResourceRef.current?.selectionId??null)!==initialSelection)return;
   acceptComputeResource(originalResource);
   if(originalResource.selectionId){
    const cleared=await computeResources.clear(originalResource.selectionId);
    if(!current())return;
    const selected=computeResourceRef.current?.selectionId??null;
    if(selected!==null&&selected!==originalResource.selectionId)return;
    if(cleared.selectionId!==null||cleared.kind!==null||cleared.status!=='none')throw Error(t('操作结果尚未确认，请刷新原连接；不会自动重连或重发。'));
    acceptComputeResource(cleared);
   }
   const connected=await openComputeGuide(undefined,{id:profile.id,version:profile.version});
   if(!current()||!connected||computeResourceRef.current?.selectionId)return;
   const state=await invoke<{settings:Settings}>('state');
   if(!current()||computeResourceRef.current?.selectionId)return;
   setSettings(state.settings);settingsKnown.current=true;await observeWorker(null,true);
   if(current()&&!computeResourceRef.current?.selectionId)setComputeChooser(true);
  }catch(e){onError(e);}finally{if(explicitConnection.current===token)explicitConnection.current=null;}
 }

 function connectSavedSsh(profile:SshComputeProfile,options?:{plain?:boolean}){if(guideShowing)setLesson({destination:'ssh-login'});setGuideKind(undefined);setComputeChooser(false);setComputeChooserEdit(undefined);setPrimaryPanel('workspace');setTerminalRequest({nonce:crypto.randomUUID(),kind:'ssh',mode:profile.mode,profileId:profile.id,version:profile.version,profileName:profile.name,...computeResource?.kind==="ssh-connection"&&!!computeResource.connectionId&&computeResource.profileId===profile.id&&computeResource.profileVersion===profile.version?{connectionId:computeResource.connectionId}:{},connectionMode:options?.plain?'plain':'managed'});showTerminal();}
 function configureTerminalSsh(ref?:{profileId:string;profileVersion:number;section?:"service"}){setComputeChooserEdit(ref?{...ref,nonce:crypto.randomUUID()}:undefined);setComputeChooser(true);}
 function openCurrentServiceUpdate(expected:NonNullable<ReturnType<typeof selectedRecordScope>>){
  const value=computeResourceRef.current,observed=recordServiceRef.current;
  if(value?.kind!=='ssh-connection'||value.status!=='selected'||value.authentication!=='verified'||typeof value.profileId!=='string'||typeof value.profileVersion!=='number'||observed.phase!=='ready'||observed.serviceVersion!=='different'||observed.scopeKey!==expected.key||selectedRecordScope(value,conversationSelectionSeq.current)?.key!==expected.key)return;
  configureTerminalSsh({profileId:value.profileId,profileVersion:value.profileVersion,section:'service'});
 }
 function openLocalCompute(){if(modal==='settings'){if(settingsSavingRef.current)return;closeSettings();}setComputeChooser(false);void connectWorker();}
 function openSshConfiguration(){setGuideKind(undefined);if(modal==='settings'){if(settingsSavingRef.current)return;closeSettings();}setComputeChooser(false);if(go('ssh')&&guideShowing)setLesson({destination:'ssh-settings'});}
 function openProjects(){if(modal==='settings'){if(settingsSavingRef.current)return;closeSettings();}setModal('projects');}
 function closeSettings(){if(settingsSavingRef.current)return;const backup=settingsBackup.current,wasReady=settingsWorkerReady.current;settingsBackup.current=null;settingsWorkerReady.current=false;if(backup){setSettings(backup);setLanguage(backup.language||'zh-CN');}setModal('');if(wasReady&&!workerReady.current)void observeWorker();}
 function openDeployment(taskId:string):Promise<void>{
  if(agentBusy)return Promise.resolve();if(deploymentOpening.current?.taskId===taskId)return deploymentOpening.current.promise;
  const sequence=++conversationSelectionSeq.current;beginWorkerGate();openSeq.current++;setPrimaryPanel('workspace');setAgentIntent(undefined);setSection('deployment:'+taskId);
  const promise=(async()=>{try{const value=await deploymentApi.open(taskId);if(sequence!==conversationSelectionSeq.current)return;const conversation=value.conversation;if(conversation.taskId!==taskId)throw Error(t('此流程的会话绑定已变化，请重新打开该流程。'));const changed=selectedConversationRef.current?.id!==conversation.id;if(changed){setSkill(undefined);conversationChanged(conversation);}if(conversation.projectId)setProjectId(conversation.projectId);setAgentTasks(old=>[value.task,...old.filter(task=>task.id!==taskId)]);setSection('deployment:'+taskId);if(!await observeWorker(taskId)||sequence!==conversationSelectionSeq.current)return;if(changed)setSessionSelection({nonce:crypto.randomUUID(),conversation});}catch(error){if(sequence===conversationSelectionSeq.current){setWorkerRestoring(false);onError(error);}}})().finally(()=>{if(deploymentOpening.current?.promise===promise)deploymentOpening.current=null;});
  deploymentOpening.current={taskId,promise};return promise;
 }
 function applyConversationDeletion(value:{id:string;taskIds:string[]}){
  const deleted=new Set(value.taskIds);setConversations(old=>old.filter(c=>c.id!==value.id));setAgentTasks(old=>old.filter(t=>!deleted.has(t.id)));
  for(const id of deleted){localStorage.removeItem('studio.pending.'+id);localStorage.removeItem('studio.deployment.pending.'+id);clearTaskDrafts(id);}
  const removed=(id:string)=>(id.startsWith('agent-task:')&&deleted.has(id.slice(11)))||(id.startsWith('deployment:')&&deleted.has(id.slice(11)));
  setSection(old=>removed(old)?'home':old);
  if(selectedConversationRef.current?.id===value.id){conversationSelectionSeq.current++;beginWorkerGate();setSkill(undefined);conversationChanged(null);setAgentIntent(undefined);setPlanningMode(false);setSessionSelection({nonce:crypto.randomUUID(),new:true});void observeWorker();}
 }
 async function deleteConversation(){if(!deleteTarget||deleting||agentBusy)return;setDeleting(true);try{const result=await invoke<{id:string;taskIds:string[]}>('conversation.delete',{id:deleteTarget.id});applyConversationDeletion(result);setDeleteTarget(null);}catch(e){onError(e);}finally{setDeleting(false);}}
 function applyGroupDeletion(value:DeleteConversationGroupResult){
  setChatGroups(old=>old.filter(group=>group.id!==value.id));
  setChatGroupId(old=>old===value.id?null:old);
  setConversations(old=>old.map(row=>row.groupId===value.id?{...row,groupId:null}:row));
  const selected=selectedConversationRef.current;if(selected?.groupId===value.id)selectedConversationRef.current={...selected,groupId:null};
 }
 async function deleteConversationGroup(){
  if(!groupDeleteTarget||groupDeletion.current||agentBusy)return;
  const request:DeleteConversationGroupRequest={id:groupDeleteTarget.id};groupDeletion.current=true;setGroupDeleting(true);
  try{const value=await invoke<DeleteConversationGroupResult>('conversation.deleteGroup',request);if(value.id!==request.id)throw Error(t('分组删除结果未能确认，请重新读取分组列表。'));applyGroupDeletion(value);setGroupDeleteTarget(null);}catch(error){onError(error);}finally{groupDeletion.current=false;setGroupDeleting(false);}
 }
 async function organizeConversation(c:Conversation,pinned=c.pinned||false,groupId:string|null=c.groupId||null){try{const value=await invoke<Conversation>('conversation.organize',{id:c.id,pinned,groupId});setConversations(old=>old.map(row=>row.id===value.id?value:row));if(selectedConversationRef.current?.id===value.id)setChatGroupId(groupId);}catch(error){onError(error);}}
 async function createChatGroup(){if(!groupName.trim()||busy)return;setBusy(true);try{const group=await invoke<{id:string;name:string}>('conversation.createGroup',{name:groupName.trim()});setChatGroups(old=>[...old,group]);setChatGroupId(group.id);setModal('');newConversation();}catch(error){onError(error);}finally{setBusy(false);}}
 function conversationRow(c:Conversation){return <div className="conversation-row" key={c.id}><button className={'conversation-item '+(selectedConversationId===c.id?'selected-conversation':'')} disabled={agentBusy||deleting} onClick={()=>{if(modal==='history')setModal('');void chooseConversation(c);}} title={c.name+(c.taskId?' · '+t('已关联计算流程'):'')}><span>{c.name}</span></button><ConversationMenu conversation={c} groups={chatGroups} disabled={agentBusy} deleting={deleting} onRename={()=>{setRenameTarget(c);setConversationName(c.name);}} onDelete={()=>setDeleteTarget(c)} onOrganize={(pinned,groupId)=>void organizeConversation(c,pinned,groupId)}/></div>;}
 function chooseProject(value:Project){if(agentBusy)return;setProjectId(value.id);setSelected(null);const conversation=conversations.find(c=>c.projectId===value.id);if(conversation)void chooseConversation(conversation);else newConversation();}
 async function reviewWorkflow(task:any){if(agentBusy)return;const seq=++conversationSelectionSeq.current;beginWorkerGate();setAgentIntent(undefined);try{await settingsReady.current;if(seq!==conversationSelectionSeq.current)return;const conversation=await invoke<Conversation>('conversation.select',{id:task.provider+':'+task.threadId});if(seq!==conversationSelectionSeq.current)return;const changed=selectedConversationRef.current?.id!==conversation.id;if(changed){setSkill(undefined);conversationChanged(conversation);if(conversation.projectId)setProjectId(conversation.projectId);}if(!await observeWorker(conversation.taskId)||seq!==conversationSelectionSeq.current)return;if(changed){setSessionSelection({nonce:crypto.randomUUID(),conversation});setSection(conversation.taskId?'agent-task:'+conversation.taskId:'home');}setAgentVisible(true);setAgentIntent({id:crypto.randomUUID(),autoSend:true,reviewMode:true,threadId:task.threadId,provider:task.provider,taskId:task.id,text:'复核当前计算流程 '+task.id+' 的手工参数与文件。请直接读取本轮提供的最新流程，检查科学条件和执行所需输入，更新同一流程并准备匹配当前参数的实际模块草稿。不要执行计算；请明确指出仍缺的信息。'});}catch(e){onError(e);}}
 const customCvInvoke:CustomCvInvoke=(method,request)=>invoke(method,request);
 const importCompositionAsset=(request:{taskId:string})=>invoke<CompositionAssetImportResult>('task.pygas.importAsset',request);
 async function discussCustomCv(request:{taskId:string;reason:'formula'|'stable_phase';includePrivate:boolean;entryId?:string}){
  if(agentBusy)return;const task=agentTasks.find(value=>value.id===request.taskId);if(!task?.threadId)return onError(new Error('请先选择此流程绑定的会话'));
  const seq=++conversationSelectionSeq.current;beginWorkerGate();setAgentIntent(undefined);
  try{await settingsReady.current;if(seq!==conversationSelectionSeq.current)return;const conversation=await invoke<Conversation>('conversation.select',{id:task.provider+':'+task.threadId});if(seq!==conversationSelectionSeq.current||conversation.taskId!==task.id)return;
   const changed=selectedConversationRef.current?.id!==conversation.id;if(changed){setSkill(undefined);conversationChanged(conversation);if(conversation.projectId)setProjectId(conversation.projectId);}if(!await observeWorker(conversation.taskId)||seq!==conversationSelectionSeq.current)return;if(changed)setSessionSelection({nonce:crypto.randomUUID(),conversation});
   setSection('agent-task:'+task.id);setAgentVisible(true);
   const text=request.reason==='stable_phase'?'请在当前流程中讨论这个 CV 的物理适用性，以及如何选择稳态相或独立参考验证。区分公式数值一致性、物理判别力和实际引擎验证；先给我可审阅方案，不执行计算。':'请先查当前 pyGAS CV/Bias 类库和可核对的官方示例，优先用已有组合表达我的需求。确实缺少等价定义时，先讨论并展示公式、符号、单位、定义域、奇点和参数，再保存到本会话的自定义 CV 草稿供我审阅；不要直接生成代码或执行。';
   setAgentIntent({id:crypto.randomUUID(),threadId:task.threadId,provider:task.provider,taskId:task.id,text:text+(request.includePrivate?' 已共享的私有定义请按页面中明确选择的本服务商共享范围读取。':' 私有库内容尚未授权共享时不要读取或附加正文。')});
  }catch(error){onError(error);}
 }
 async function openWorkflowDiscussion(request:DiagnosticRepairRequest){
  if(agentBusy)return;const task=agentTasks.find(value=>value.id===request.taskId);if(!task||task.provider!==request.provider||task.threadId!==request.threadId)return;
  const seq=++conversationSelectionSeq.current;setAgentIntent(undefined);
  try{await settingsReady.current;if(seq!==conversationSelectionSeq.current||!mounted.current)return;
   const conversation=await invoke<Conversation>('conversation.select',{id:request.provider+':'+request.threadId});
   if(seq!==conversationSelectionSeq.current||!mounted.current)return;
   if(conversation.provider!==request.provider||conversation.threadId!==request.threadId||conversation.taskId!==request.taskId)throw Error(t('此流程的会话绑定已变化，请重新打开该流程。'));
   const changed=selectedConversationRef.current?.id!==conversation.id;
   if(changed){beginWorkerGate();setSkill(undefined);conversationChanged(conversation);if(conversation.projectId)setProjectId(conversation.projectId);setSessionSelection({nonce:crypto.randomUUID(),conversation});void observeWorker(conversation.taskId);}
   setAgentVisible(true);setPrimaryPanel('agent');setAgentIntent({id:crypto.randomUUID(),...request});
  }catch(error){if(seq===conversationSelectionSeq.current&&mounted.current)onError(error);}
 }
 function askAgent(text:string,taskId?:string){
  if(taskId){
   const task=agentTasks.find(value=>value.id===taskId);
   if(!task?.provider||!task.threadId)return onError(new Error(t('此流程的会话绑定已变化，请重新打开该流程。')));
   void openWorkflowDiscussion({taskId,provider:task.provider,threadId:task.threadId,text});
   return;
  }
  setPrimaryPanel('agent');setAgentVisible(true);setAgentIntent({id:crypto.randomUUID(),text});
 }
 function tabName(id:string){if(id.startsWith('deployment:'))return t('部署与执行');if(id.startsWith('agent-task:'))return agentTasks.find(t=>t.id===id.slice(11))?.name;if(id.startsWith('cluster-run:'))return t('集群任务');return id.startsWith('tool:')?tools.find(t=>t.id===id.slice(5))?.name:id.startsWith('workflow:')?tasks.find(t=>t.id===id.slice(9))?.title:id.startsWith('plan:')?plans.find(p=>p.id===id.slice(5))?.name:undefined;}
 const entityMissing=section.startsWith('deployment:')?!agentTasks.some(t=>t.id===section.slice(11)):section.startsWith('agent-task:')?!agentTasks.some(k=>k.id===section.slice(11)):section.startsWith('plan:')?!plans.some(p=>p.id===section.slice(5)&&tasks.some(k=>k.id===p.taskId)):section.startsWith('workflow:')?!tasks.some(k=>k.id===section.slice(9)):section.startsWith('tool:')?!tools.some(k=>k.id===section.slice(5)):section.startsWith('task:')?false:section.startsWith('cluster-run:')?false:!(sections.some(s=>s[0]===section)||section==='editor');
 const retainedTask=agentTasks.find(task=>task.id===selectedConversationRef.current?.taskId);
 const selectedRecordsReady=!!selectedRecords&&recordService.phase==='ready'&&recordService.scopeKey===selectedRecords.key;
 const recordsConnected=selectedRecords?selectedRecordsReady:worker&&!disconnected;
 const recordsExecutionAllowed=worker&&!disconnected&&(!selectedRecords||selectedRecordsReady&&recordService.sourceId===workerSourceId);
 const displayedServiceVersion=selectedRecords?recordService.serviceVersion||'unconfirmed':serviceVersion;
 const runSourceReady=selectedRecords?selectedRecordsReady&&recordObservations.local.loaded&&!recordObservations.local.sourceChanged&&recordObservations.local.sourceId===recordService.sourceId&&(!recordObservations.local.stale||recordDetailReceipt?.id===section.slice(5)&&recordDetailReceipt.sourceId===recordService.sourceId&&recordDetailReceipt.scopeKey===selectedRecords.key):worker&&!disconnected&&recordObservations.local.loaded&&!recordObservations.local.stale&&runSourceEpoch===workerHydrationEpoch.current;
 function canOpenRecord(location:Job['location']){
  const observed=recordObservations[location];
  if(!recordsConnected||!observed.loaded||observed.sourceChanged)return false;
  return selectedRecords?observed.sourceId===recordService.sourceId:observed.workerEpoch===workerHydrationEpoch.current;
 }
 const clusterSourceReady=canOpenRecord('cluster');
 const statusKnown=canOpenRecord('local')&&clusterSourceReady&&!recordObservations.local.stale&&!recordObservations.cluster.stale;
 const conversationWorkspace=section==='home'||section.startsWith('agent-task:')||section.startsWith('deployment:');
 const sidebarExpanded=sidebarVisible&&windowWidth>=1180;
 const availableWidth=windowWidth-(sidebarExpanded?sidebarWidth+7:56);
 const centerLayout=conversationWorkspace&&settings.agentLayout==='center';
 const singlePanel=availableWidth<620,paneMax=Math.max(260,conversationWorkspace?availableWidth-290:Math.min(600,Math.floor(availableWidth*.45))),displayAgentWidth=Math.min(paneMax,Math.max(260,conversationWorkspace?agentWidth:overviewAgentWidth));
 const agentPanelVisible=agentVisible&&(!singlePanel||primaryPanel==='agent');
 const workspacePanelVisible=!agentVisible||!singlePanel||primaryPanel==='workspace';
 const needsPanelSelection=singlePanel||!agentVisible;
 const shownConversations=conversations.filter(conversation=>conversationMatches(conversation,conversationSearch,projects.find(project=>project.id===conversation.projectId)?.name||''));
 const assetWorkerScope=JSON.stringify([settings.distribution,settings.workerRoot,settings.workerPort,workerHydrationEpoch.current]);
 function openWorkflowRun(id:string,location:Job['location'],task:any){
  if(selectedRecords){
   if(!selectedRecordsReady||!task||task.workerSourceId!==recordService.sourceId){go('runs');return;}
   if(!recordsExecutionAllowed){
    const record=allJobs.find(job=>job.location===location&&job.run.id===id);
    if(record&&canOpenRecord(location))void openJob(record);else go('runs');
    return;
   }
  }
  if(location==='cluster')go('cluster-run:'+id);else void openTask(id);
 }
 async function openJob(job:Job){
  const scope=selectedRecordScope(computeResourceRef.current,conversationSelectionSeq.current),observation=recordObservations[job.location],sourceId=recordServiceRef.current.sourceId;
  if(scope?.key!==selectedRecords?.key||!canOpenRecord(job.location))return;
  if(scope){const current=()=>mounted.current&&selectedRecordScope(computeResourceRef.current,conversationSelectionSeq.current)?.key===scope.key&&recordServiceRef.current.phase==='ready'&&recordServiceRef.current.sourceId===sourceId;if(!current()||observation.sourceChanged||observation.sourceId!==sourceId)return;if(job.location==='cluster'){
   const ticket={id:job.run.id,sequence:++openSeq.current};openingRunRef.current=ticket;setOpeningRun(ticket);
   try{if(!await verifyRecordSource(scope,sourceId,()=>current()&&ticket.sequence===openSeq.current))return;}catch(error){if(current()&&ticket.sequence===openSeq.current)onError(error);return;}finally{if(openingRunRef.current===ticket){openingRunRef.current=null;if(mounted.current)setOpeningRun(null);}}
  }}
  if(job.location==='cluster'){setPrimaryPanel('workspace');setSelected(null);setSection('cluster-run:'+job.run.id);}else void openTask(job.run.id);
 }
 function switchPriority(layout:'right'|'center',button:HTMLButtonElement){const menu=button.closest('details');if(menu){menu.open=false;menu.querySelector('summary')?.focus();}setAgentWidth(Math.round(availableWidth*(layout==='center'?.6:.38)));setSettings(previous=>({...previous,agentLayout:layout}));void invoke('settings',{agentLayout:layout}).catch(onError);}
 function showAgent(){setAgentVisible(true);setPrimaryPanel('agent');requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('.agent-panel .composer textarea')?.focus());}
 function selectToolSkill(value:SkillAttachment){setSkill(value);setAgentVisible(true);}
 function toggleAgent(){if(!agentVisible){showAgent();return;}if(singlePanel){setPrimaryPanel(agentPanelVisible?'workspace':'agent');return;}setAgentVisible(false);}
 const lessonBubble=lesson&&guidePage&&!modal&&!command&&!computeChooser&&!computeGuide&&!sshGuide
  ? <SetupLesson lesson={lesson} english={settings.language==='en'} onReturn={openSetupGuide}/> : null;
 return <div className={guideShowing?"application showing-setup":"application"}>
  <header className="titlebar"><div className="brand"><span className="brand-mark"><Atom size={19}/></span><strong>{product.name}</strong><button className={'version'+(updateVisible?' has-update':'')} aria-label={tr('软件更新')} title={tr('软件更新')} onClick={()=>setModal('updates')}>{updateVisible?tr('软件更新')+' '+updates.state.version:STUDIO_VERSION}</button></div><div className="title-path"><Folder size={12}/>{project?projectLabel(project):tr('科学计算工作台')}</div>{guideInfo&&!guidePage&&<button className="setup-help" data-testid="open-setup-guide" disabled={!!modal||computeChooser||!!computeGuide||!!sshGuide} onClick={openSetupGuide}><CircleHelp size={15}/>{t('新手引导')}</button>}<div className="window-buttons"><button aria-label={tr('最小化')} onClick={()=>void invoke('window',{action:'minimize'}).catch(()=>{})}><Minus size={13}/></button><button aria-label={tr('最大化或还原')} title={tr('最大化或还原')} onClick={()=>void invoke('window',{action:'maximize'}).catch(()=>{})}><Square size={11}/></button><button className="close" aria-label={tr('关闭')} onClick={()=>void invoke('window',{action:'close'}).catch(()=>{})}><X size={14}/></button></div></header>
  <div inert={guideShowing||undefined} className={"shell workspace-shell "+(centerLayout?'agent-center ':'')+(singlePanel?'single-panel':'')} style={{'--agent-width':displayAgentWidth+'px','--conversation-width':sidebarWidth+'px'} as React.CSSProperties} data-primary-panel={agentVisible?primaryPanel:'workspace'}>
   <nav hidden={sidebarExpanded} className="navigation-rail" aria-label={t('主导航')}><Tooltip asChild content={t('工作区')}><button data-testid={sidebarExpanded?undefined:"navigate-home"} aria-label={t('工作区')} aria-current={primaryDestination(section)==='home'?'page':undefined} onClick={()=>go(retainedTask?'agent-task:'+retainedTask.id:'home')}><Home size={21}/></button></Tooltip><Tooltip asChild content={t('工具与资源')}><button data-testid={sidebarExpanded?undefined:"navigate-tools"} aria-label={t('工具与资源')} aria-current={primaryDestination(section)==='tools'?'page':undefined} onClick={()=>go('tools')}><BookOpen size={21}/></button></Tooltip><Tooltip asChild content={t('运行记录')}><button data-testid={sidebarExpanded?undefined:"navigate-runs"} aria-label={t('运行记录')} aria-current={primaryDestination(section)==='runs'?'page':undefined} onClick={()=>go('runs')}><Clock size={21}/></button></Tooltip><button aria-label={t(windowWidth<1180?'历史会话':'展开导航')} onClick={()=>{if(windowWidth<1180)setModal('history');else setSidebarVisible(true);}}><PanelRightOpen size={20}/></button><button aria-label={t('连接计算资源')} onClick={openComputeResources}><PlugZap size={20}/></button><span className="rail-spacer"/><Tooltip asChild content={t('设置')}><button aria-label={t('设置')} onClick={openSettings}><SettingsIcon size={21}/></button></Tooltip></nav>
   <nav className="sidebar" aria-label={t('工作台导航')} hidden={!sidebarExpanded}><div className="sidebar-title"><button className="quick-search" title={tr("搜索与命令")+" (Ctrl+K)"} onClick={()=>setCommand(true)}><Search size={15}/><span>{tr("搜索与命令")}</span><kbd>Ctrl K</kbd></button><button className="icon-button" aria-label={t('收起导航')} onClick={()=>setSidebarVisible(false)}><PanelRightClose size={16}/></button></div><div className="primary-navigation">{([['home','工作区',Home],['runs','运行记录',Clock],['tools','工具与资源',Layers3]] as const).map(([id,label,Icon])=><button key={id} data-testid={sidebarExpanded?'navigate-'+id:undefined} aria-current={primaryDestination(section)===id?'page':undefined} onClick={()=>go(id==='home'&&retainedTask?'agent-task:'+retainedTask.id:id)}><Icon size={18}/><span>{t(label)}</span></button>)}</div>

    <button className="sidebar-accounts" data-testid="open-accounts" onClick={()=>openAccounts()}><KeyRound size={16}/><span>{t('账号与 API')}</span></button>
    <button className="new-conversation-button sidebar-new-conversation" data-testid="new-conversation" aria-label={t('新对话')} disabled={agentBusy} onClick={()=>newConversation()}><Plus size={16}/><span>{t('新对话')}</span></button>
    <button className="new-conversation-button sidebar-new-conversation" data-testid="new-computation" disabled={agentBusy} onClick={()=>newConversation(true)}><GitBranch size={16}/>{t('新建计算')}</button>

    <label className="conversation-search"><Search size={14}/><input aria-label={t('搜索会话')} placeholder={t('搜索会话')} value={conversationSearch} onChange={event=>setConversationSearch(event.target.value)}/></label>
    <div className="sidebar-scroll conversation-sidebar" data-testid="conversation-sidebar">{shownConversations.some(c=>c.pinned)&&<><div className="nav-label">{t('置顶')}</div>{shownConversations.filter(c=>c.pinned).map(conversationRow)}</>}<div className="chat-group-header"><span className="nav-label">{t('会话分组')}</span><button aria-label={t('新建会话分组')} onClick={()=>{setGroupName('');setModal('chat-project');}}><Plus size={15}/></button></div>{chatGroups.map(group=><details className={'conversation-project '+(chatGroupId===group.id?'active':'')} key={group.id} open><summary><ChevronRight size={14} className="group-chevron" aria-hidden="true"/><span>{group.name}</span><button disabled={agentBusy} aria-label={t('在分组中新建对话')+' · '+group.name} onClick={e=>{e.preventDefault();setChatGroupId(group.id);newConversation();}}><Plus size={14}/></button><ConversationMenu group={group} disabled={agentBusy||groupDeleting} onDelete={()=>setGroupDeleteTarget(group)}/></summary>{shownConversations.filter(c=>c.groupId===group.id&&!c.pinned).map(conversationRow)}</details>)}<div className="chat-group-header"><span className="nav-label">{t('未分组会话')}</span><button aria-label={t('新建未分组会话')} disabled={agentBusy} onClick={()=>{setChatGroupId(null);newConversation();}}><Plus size={14}/></button></div>{shownConversations.filter(c=>!c.groupId&&!c.pinned).map(conversationRow)}{!shownConversations.length&&conversationSearch.trim()&&<span className="muted">{t('没有匹配的会话')}</span>}</div>
    <div className="sidebar-bottom"><button className="resource-mini compute-resource-entry" data-testid="unified-compute-entry" aria-label={t('连接计算资源')} onClick={()=>setComputeChooser(true)}><i className={(isSshResource(computeResource)?computeResource.alive===true:statusKnown)?'online':''}/><span><strong>{t('连接计算资源')}</strong>{isSshResource(computeResource)?<small data-testid="active-ssh-resource">{computeResource.kind==='ssh-connection'?sshSummary(computeResource):<>{computeResourceLabel||t(computeResource.workflowReady?'SSH 作业服务':'SSH 终端')} · {t(computeResource.workflowReady?'工作流服务已连接':computeResource.status!=='selected'?'资源需重新选择':computeResource.processStatus==='exited'?'终端进程已退出':computeResource.processStatus==='expired'?'访问已过期':computeResource.processStatus!=='running'?'终端状态未知':computeResource.operator==='agent'?computeResource.agentReady?'由 Agent 操作':'Agent 访问待核对':computeResource.operator==='human'?'由你操作':'操作权限待核对')}</>}</small>:<small>{settings.distribution} · {tr(workerNotice||(disconnected?'连接中断 · 状态未知':worker?(serviceVersion==='different'?tr('已连接 · 服务版本不同'):serviceVersion==='unconfirmed'?tr('已连接 · 服务版本未核对'):gpuStale?tr('GPU 记录待核对'):gpuStatus[0]?gpuStatus[0].memory_used+' / '+gpuStatus[0].memory_total+' MiB':active.length+' '+tr('个运行任务')):'本地作业服务未连接'))}</small>}</span><PlugZap size={16}/></button>
<div className="sidebar-tools"><button aria-label={t('设置')} onClick={openSettings}><SettingsIcon size={16}/><span>{t('设置')}</span></button><button title={tr("切换主题")} aria-label={tr("切换主题")} onClick={()=>{const theme=settings.theme==='dark'?'light':'dark';setSettings({...settings,theme});void invoke('settings',{theme}).catch(onError);}}>{settings.theme==='dark'?<Sun size={15}/>:<Moon size={15}/>}</button></div></div>
   </nav>{sidebarExpanded&&<PaneDivider label={t('调整会话列表宽度')} value={sidebarWidth} min={170} max={Math.min(420,windowWidth-360)} onChange={setSidebarWidth}/>}
   <section className="workspace-stage">
    {lessonBubble}
    <div className="workspace-toolbar" data-testid="workspace-modebar">
     <div className="workspace-current-title"><ModuleIcon module={workspaceModule(section,selectedRun?.engine||'')} size={16}/><strong>{tr(tabName(section)||sections.find(value=>value[0]===section)?.[1]||(section.startsWith('task:')?selectedRun?.name:section==='editor'?editor.name:'工作区')||'工作区')}</strong></div>
     {needsPanelSelection&&<div className="panel-selection"><button data-testid="show-workspace" aria-pressed={workspacePanelVisible} onClick={()=>setPrimaryPanel('workspace')}>{t('工作区')}</button><button data-testid="show-agent" aria-pressed={agentPanelVisible} onClick={showAgent}>{t('对话')}</button></div>}
     <div className="toolbar-actions"><button className="icon-button" title={t('刷新')} aria-label={t('刷新')} disabled={!worker||refreshFeedback?.status==='loading'} onClick={()=>void refresh(true,true)}><RefreshCw size={15}/></button><details className="workspace-layout-menu" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false;}} onKeyDown={event=>{
      if(event.key==='Escape'&&event.currentTarget.open){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}
     }}><summary>{t('布局')}<ChevronDown size={13} aria-hidden="true"/></summary><div><button data-testid="priority-chat" aria-pressed={settings.agentLayout==='center'} onClick={event=>switchPriority('center',event.currentTarget)}>{t('对话优先')}</button><button data-testid="priority-workflow" aria-pressed={settings.agentLayout!=='center'} onClick={event=>switchPriority('right',event.currentTarget)}>{t('流程优先')}</button></div></details><button className="icon-button" title={t('切换 Agent 面板')} aria-label={t('切换 Agent 面板')} aria-pressed={agentPanelVisible} onClick={toggleAgent}>{agentPanelVisible?<PanelRightClose size={16}/>:<PanelRightOpen size={16}/>}</button></div>
    </div><div className="workspace-panels"><main className="main-column">
    <div className="workspace-content"><LoadingFeedback busy={!!openingRun&&openingRun.sequence===openSeq.current} label={tr("正在读取运行记录…")}/>{recordsConnected&&displayedServiceVersion!=='current'&&<details className="notice service-version-notice" role="status" data-testid="worker-service-version" data-version={displayedServiceVersion}><summary data-testid="worker-service-version-summary"><span>{tr(displayedServiceVersion==='different'?'作业服务与当前软件版本不同':'作业服务实现版本尚未核对')}</span>{selectedRecords&&displayedServiceVersion==='different'&&<button className="button service-version-upgrade" data-testid="worker-service-upgrade" onClick={event=>{event.preventDefault();event.stopPropagation();openCurrentServiceUpdate(selectedRecords);}}>{t('更新作业服务…')}</button>}</summary><p>{tr(selectedRecords?displayedServiceVersion==='different'?'当前服务可继续使用已有工具和提交获准的任务。需要更新时，请在当前连接设置中选择“更新作业服务”，现有任务保留。':'当前服务已响应，实现版本尚未核对；可查看记录，工具与任务操作以实际可用接口及项目授权为准。请在当前连接设置中核对作业服务。':'历史记录可继续读取；当前软件的新工具接口尚未确认。需要更新时，请使用“连接计算资源 → 本地 WSL”明确连接，现有任务保留。')}</p></details>}<div hidden={section!=='runs'}><ViewBoundary onHome={()=>go('home')}><JobsPage local={runs} cluster={clusterRuns} observations={recordObservations} projects={projects} projectId={runProjectId} tasks={agentTasks} conversations={conversations} worker={recordsConnected} servicePhase={selectedRecords?recordService.phase:undefined} readOnly={!!selectedRecords&&!recordsExecutionAllowed} canRefresh={selectedRecords?recordService.phase!=='checking':worker} canOpen={canOpenRecord} busy={agentBusy} onRefresh={()=>void refreshSelectedRecords(true)} onOpen={job=>void openJob(job)} onConversation={conversation=>void chooseConversation(conversation)}/></ViewBoundary></div>
    <div hidden={!retainedTask||section!=='agent-task:'+retainedTask.id}>{retainedTask&&<ViewBoundary key={retainedTask.id} onHome={()=>go('home')}><AgentTaskPage toolWorkflowFocus={toolWorkflowFocus} onBindDraft={connectAndBindDraft} onDeploy={id=>void openDeployment(id)} navigationBusy={agentBusy} key={retainedTask.id} worker={worker&&!disconnected} onReconnect={connectWorker} task={retainedTask} environments={environments} theme={settings.theme} onError={onError} onRun={id=>openWorkflowRun(id,'local',retainedTask)} onCluster={id=>openWorkflowRun(id,'cluster',retainedTask)} onSetup={id=>void api<any[]>('GET','/api/cluster-drafts').then(values=>{setClusterDraft(values.find(v=>v.id===id));setSection('ssh');}).catch(onError)} onAgent={text=>askAgent(text,retainedTask.id)} onReview={task=>void reviewWorkflow(task)} onReplace={replaceTask} onRefresh={()=>refresh()} customCvInvoke={customCvInvoke} customProvider={agentProvider} onCustomDiscussion={request=>void discussCustomCv(request)} importAsset={importCompositionAsset}/></ViewBoundary>}</div><ViewBoundary key={section} onHome={()=>go('home')}>
     {section==='deployment'&&<div className="page"><div className="page-heading"><div><h1>{tr('部署与执行')}</h1><p>{tr('选择已定义的科学流程，再配置算力和提交方式。')}</p></div></div><div className="task-cards">{agentTasks.filter(t=>t.workflowVersion===2).map(task=><button key={task.id} className="card" disabled={agentBusy} onClick={()=>void openDeployment(task.id)}><strong>{task.name}</strong><p>{tr(task.review?.status==='ready'?'科学参数已复核':'等待科学参数复核')}</p></button>)}</div></div>}
     {section.startsWith('deployment:')&&agentTasks.find(t=>t.id===section.slice(11))&&<DeploymentPanel onRepair={request=>void openWorkflowDiscussion(request)} onOpenConnections={openOriginalConnection} key={section} task={agentTasks.find(t=>t.id===section.slice(11))} worker={worker&&!disconnected} restoring={workerRestoring} onAutomaticRestore={()=>observeWorker(section.slice(11))} projects={projects} environments={environments} onTask={id=>setSection('agent-task:'+id)} onRun={(id,kind)=>openWorkflowRun(id,kind==='cluster-run'?'cluster':'local',agentTasks.find(task=>task.id===section.slice(11)))} onError={onError} onRefresh={()=>refresh()} onProjectSettings={project=>void editProjectPolicy(project)} onReconnect={()=>connectWorker(section.slice(11))}/>}
     {section.startsWith('agent-task:')&&section!=='agent-task:'+retainedTask?.id&&agentTasks.find(t=>t.id===section.slice(11))&&<AgentTaskPage toolWorkflowFocus={toolWorkflowFocus} onBindDraft={connectAndBindDraft} onDeploy={id=>void openDeployment(id)} navigationBusy={agentBusy} key={section} worker={worker&&!disconnected} onReconnect={connectWorker} task={agentTasks.find(t=>t.id===section.slice(11))} environments={environments} theme={settings.theme} onError={onError} onRun={id=>openWorkflowRun(id,'local',agentTasks.find(task=>task.id===section.slice(11)))} onCluster={id=>openWorkflowRun(id,'cluster',agentTasks.find(task=>task.id===section.slice(11)))} onSetup={id=>void api<any[]>('GET','/api/cluster-drafts').then(values=>{setClusterDraft(values.find(v=>v.id===id));setSection('ssh');}).catch(onError)} onAgent={text=>askAgent(text,section.slice(11))} onReview={task=>void reviewWorkflow(task)} onReplace={replaceTask} onRefresh={()=>refresh()} customCvInvoke={customCvInvoke} customProvider={agentProvider} onCustomDiscussion={request=>void discussCustomCv(request)} importAsset={importCompositionAsset}/>}
     {section.startsWith('cluster-run:')&&(clusterSourceReady?<ClusterRunPage readOnly={!recordsExecutionAllowed} onOpenConnections={openOriginalConnection} key={(selectedRecords?recordService.sourceId:'')+section} id={section.slice(12)} onError={onError} onAgent={askAgent}/>:<div className="page"><div className="connect-banner"><Server size={24}/><strong>{tr('连接作业服务')}</strong>{runSourceTask(section.slice(12))?<button className="button" disabled={connecting} onClick={()=>{const original=runSourceTask(section.slice(12));if(original)void connectWorker(original.id);}}>{tr('恢复原作业服务')}</button>:<p>{tr('请先明确连接保存此作业的原服务；不会改用当前聊天或默认来源。')}</p>}</div></div>)}

     {section.startsWith('workflow:')&&tasks.some(k=>k.id===section.slice(9))&&<WorkflowPage key={section} taskId={section.slice(9)} onSaved={(plan,options)=>{setPlans(old=>[plan,...old.filter(p=>p.id!==plan.id)]);if(options.navigate)setSection(current=>current==='workflow:'+plan.taskId?'plan:'+plan.id:current);}} onAgent={askAgent} onTool={id=>setSection('tool:'+id)} onError={onError}/>}
     {section.startsWith('plan:')&&plans.find(p=>p.id===section.slice(5))&&tasks.some(k=>k.id===plans.find(p=>p.id===section.slice(5))!.taskId)&&<WorkflowPage key={section} taskId={plans.find(p=>p.id===section.slice(5))!.taskId} initial={plans.find(p=>p.id===section.slice(5))} onSaved={plan=>setPlans(old=>[plan,...old.filter(p=>p.id!==plan.id)])} onAgent={askAgent} onTool={id=>setSection('tool:'+id)} onError={onError}/>}
     {section==='relations'&&<div className="page"><div className="page-heading"><div><h1>{t('工具关系图')}</h1><p>{t('从目标出发串联工具，从工具出发预览任务。')}</p></div></div><Relations onTask={openWorkflow} onTool={id=>setSection('tool:'+id)}/></div>}
     {section.startsWith('tool:')&&tools.some(k=>k.id===section.slice(5))&&<ToolPage id={section.slice(5)} onTask={openWorkflow} onNavigate={setSection} onPrepare={newRun} canPrepare={worker&&!!project}/>}

     {section.startsWith('task:')&&runSourceReady&&runs.find(r=>r.id===section.slice(5))&&(selectedRecords&&!recordsExecutionAllowed?<RunDetail readOnly connected key={recordService.sourceId+section} run={runs.find(r=>r.id===section.slice(5))!} onRefresh={()=>refreshSelectedRecords()} onError={onError}/>:<RunReview draftScope={runDraftScope} legacyDraftScopes={workerSourceId?[legacyRunDraftScope]:[]} onOpenWorkflow={id=>void openToolWorkflow(id)} connected={worker&&!disconnected} key={section} run={runs.find(r=>r.id===section.slice(5))!} environments={environments} onRefresh={()=>refresh()} onError={onError} onReplace={replaceTask} theme={settings.theme}/>)}

     {section==='home'&&<div className="home-page"><div className="page-heading"><h1>{tr("计算工作区")}</h1>{!sidebarExpanded&&<button className="button primary" disabled={agentBusy} onClick={()=>newConversation(true)}><Plus size={15}/>{tr("新建计算")}</button>}</div>
      {!recordsConnected&&!(isSshResource(computeResource)&&computeResource.status==='selected'&&computeResource.processStatus==='running'&&computeResource.alive===true)&&<div className="connect-banner"><div className="banner-icon"><Server size={21}/></div><div><strong>{tr("连接计算资源")}</strong><p>{tr("连接本地 WSL 或 SSH 集群，保存常用连接。")}</p></div><button className="button" onClick={openComputeResources} disabled={connecting}>{tr(connecting?'连接中…':'选择连接')}<ArrowUpRight size={13}/></button></div>}
      {retainedTask&&<section className="continue-work"><span className="eyebrow">{t('继续工作')}</span><h2>{retainedTask.name}</h2><p>{t(retainedTask.review?.status==='ready'?'参数已复核，等待运行设置':'流程草稿，等待完善与复核')}</p><button className="button" onClick={()=>go('agent-task:'+retainedTask.id)}>{t('打开当前计算流程')}<ArrowUpRight size={15}/></button></section>}
      {conversations.length>0&&<><div className="section-heading"><h3>{t('最近会话')}</h3><button onClick={()=>setModal('history')}>{t('历史会话')}<ChevronRight size={14}/></button></div><div className="recent-conversations">{conversations.slice(0,4).map(conversation=><button key={conversation.id} disabled={agentBusy} onClick={()=>void chooseConversation(conversation)}><MessageSquare size={16}/><span>{conversation.name}</span></button>)}</div></>}
      <div className="section-heading"><h3>{t('最近运行')}</h3><button onClick={()=>go('runs')}>{t('查看全部')}<ChevronRight size={14}/></button></div><div className="recent-runs">{allJobs.slice(0,5).map(job=><button key={job.key} disabled={!canOpenRecord(job.location)} onClick={()=>openJob(job)}><Activity size={16}/><span>{job.run.name}<small>{t(job.location==='cluster'?'集群':'本地')} · {job.run.engine}</small></span><Badge status={job.run.status}/></button>)}{!runs.length&&!clusterRuns.length&&<p className="muted">{t(recordObservations.local.loaded&&recordObservations.cluster.loaded?'尚无运行记录':'尚未读取运行记录')}</p>}</div>
      <details className="home-disclosure"><summary>{t('按任务开始')}</summary><TaskCards onOpen={openWorkflow}/><button className="text-button" onClick={()=>go('relations')}>{t('查看工具关系')}</button>{plans.length>0&&<div className="saved-plans">{plans.map(plan=><button key={plan.id} onClick={()=>go('plan:'+plan.id)}><GitBranch size={15}/>{plan.name}<small>{t('草稿 · 尚未执行')}</small></button>)}</div>}</details>
      <details className="home-disclosure"><summary>{t('记录统计与高级入口')}</summary><p className="muted">{t('统计包含当前作业服务已读取的本地与集群记录；连接中断时保留上次记录。')}</p><div className="stat-grid">{['running','queued','succeeded','unknown'].map(status=><div className="stat" key={status}><div>{t(statusNames[status]||status)}</div><strong>{statusKnown?allJobs.filter(job=>job.run.status===status).length:'—'}</strong><small>{t(statusKnown?'已读取记录':'状态待核对')}</small></div>)}</div><button className="button" disabled={!worker||!project} onClick={()=>newRun()}>{t('高级：原生计算草稿')}</button></details>
     </div>}
      {section==='tools'&&<div className="page tools-directory" data-testid="tools-directory"><div className="page-heading"><div><h1>{t('工具')}</h1></div></div>{toolGroups.map(group=><section className="tool-directory-group" key={group.id}><h2>{t(group.label)}</h2><div className="tool-directory-grid">{group.tools.map(id=>{const tool=tools.find(value=>value.id===id)!;return <button key={id} data-testid={'open-tool-'+id} onClick={()=>go('tool:'+id)}><ModuleIcon module={id}/><span><strong>{t(tool.name)}</strong><small>{t(tool.description)}</small></span><ChevronRight size={16}/></button>;})}{group.pages.map(id=><button key={id} onClick={()=>go(id)}><ModuleIcon module={workspaceModule(id)}/><span><strong>{t(sections.find(value=>value[0]===id)?.[1]||id)}</strong></span><ChevronRight size={16}/></button>)}</div></section>)}</div>}
     {section==='bias'&&<div className="page"><div className="page-heading"><div><h1>{tr('Bias 实验室')}</h1><p>{tr('使用当前会话的实际 pyGAS 类库与组合图；保存后仍需独立复核和执行。')}</p></div><FileCode2 size={27}/></div>{(()=>{const current=agentTasks.find(task=>task.id===selectedConversationRef.current?.taskId);return current?<><button className="button" onClick={()=>setSection('agent-task:'+current.id)}>{tr('返回当前计算流程')}</button><PygasTaskComposer key={current.id+':'+(current.composition?.graphPath||'auto')} task={current} worker={worker} language={settings.language||'zh-CN'} onSaved={()=>refresh()} onError={onError} onDiscussion={askAgent} customCvInvoke={customCvInvoke} customProvider={agentProvider} onCustomDiscussion={request=>void discussCustomCv(request)} importAsset={importCompositionAsset}/></>:<section className="card"><p>{tr('先选择已有会话，或开启任务规划描述体系与目标。Agent 会选择实际类库并创建绑定当前会话的组合图。')}</p><button className="button primary" onClick={()=>{setAgentVisible(true);setPlanningMode(true);askAgent(tr('请基于我的实际体系准备 pyGAS CV/Bias 组合流程，使用已登记类库，展示参数供审阅；不构建、不运行。'));}}>{tr('开启任务规划')}</button></section>;})()}</div>}
     {section==='training'&&<div className="page"><div className="page-heading"><div><h1>{tr("模型与训练")}</h1><p>{tr("保留数据划分、标签范围、checkpoint 和消费端格式。")}</p></div></div><div className="model-grid">{['nep','hotpp'].map(e=><section className="card" key={e}><div className="model-logo">{e==='nep'?<Atom size={27}/>:<Box size={27}/>}</div><h2>{e==='nep'?'NEP':'HotPP'}</h2><p>{tr(e==='nep'?'GPUMD 原生训练与 prediction 模式':'张量消息传递势 · train / eval / freeze')}</p><div className="button-row"><button className="button primary" disabled={!worker||!project} onClick={()=>newRun(e+'.train')}>{tr("训练")}</button><button className="button" disabled={!worker||!project} onClick={()=>newRun(e+'.eval')}>{tr("独立测试")}</button>{e==='hotpp'&&<button className="button" disabled={!worker||!project} onClick={()=>newRun('hotpp.export')}>{tr("导出")}</button>}</div></section>)}</div><div className="notice"><ShieldCheck size={16}/>{tr("PyDyn 使用 ase-* HotPP 导出。缺失 virial 标签时不报告虚假 RMSE。")}</div><RunTable items={trainingRuns} selected={selected} canOpen={canOpenRecord('local')} onOpen={run=>void openJob({key:'local:'+run.id,location:'local',run})} canPrepare={worker&&!!project} onPrepare={()=>newRun()}/></div>}
     {section==='editor'&&<div className="editor-workspace"><div className="toolbar"><span><FileCode2 size={14}/>{editor.name}{editorDirty?' *':''}</span><input value={editor.name} aria-label={tr("文件路径")} onChange={e=>setEditor({...editor,name:e.target.value})}/><button className="button" disabled={!worker||!project||!!editorSave} onClick={()=>void saveInput().catch(onError)}><Save size={14}/>{tr("保存到项目输入")}</button><button className="button" disabled={!!editorSave} onClick={()=>void saveInput('windows').catch(onError)}>{tr("另存到 Windows")}</button><LoadingFeedback busy={!!editorSave} label={tr("正在保存输入文件…")}/></div><CodeEditor value={editor.source} onChange={v=>{if(v===editorSource.current)return;setEditor(old=>({...old,source:v}));setEditorDirty(true);}} theme={settings.theme}/><div className="editor-path">{tr(editor.path||'尚未保存')}{tr("· Python 源码不会在前端执行")}</div></div>}
     {section==='assets'&&<div className="page"><StructureBuilder projectId={project?.id||''} environments={environments} worker={worker&&!disconnected} workerScope={assetWorkerScope} onSaved={()=>void refresh()} onError={onError}/><MaterialsProjectSearch projectId={project?.id||''} environments={environments} worker={worker&&!disconnected} workerScope={assetWorkerScope} onSaved={()=>void refresh()} onError={onError}/><AssetInspector projectId={project?.id||''} environments={environments} worker={worker&&!disconnected} workerScope={assetWorkerScope} onSaved={()=>void refresh()} onError={onError}/><div className="asset-list">{assets.filter(a=>(a as any).project_id===projectId).map(a=><div className="asset-row" key={a.id}><Database size={17}/><div><strong>{a.name}</strong><small>{a.path}</small></div><span className="tag">{a.kind}</span><span className="mono">{a.sha256.slice(0,12)}</span></div>)}</div></div>}
     {section==='environments'&&<ComputeEnvironments worker={worker&&!disconnected} workerGeneration={workerHydrationEpoch.current} environments={environments} onRefresh={()=>refresh()} onConnect={openComputeResources} onManual={newEnvironment} onAgent={askAgent} onCluster={openComputeResources} onError={onError}/>}
     {section==='ssh'&&<ClusterPage selectedClusterId={clusterSelection||undefined} serviceVersion={serviceVersion} onAuthenticate={openSshGuide} onConnectCompute={connectWorker} worker={worker} project={project} settings={settings} draft={clusterDraft} onQueueTest={async text=>{await newConversation(true,text);}} onError={onError} onRefresh={()=>void refresh()} onAgent={askAgent} onRun={id=>setSection('cluster-run:'+id)} onTerminal={startClusterTerminal}/>}
     {section==='extensions'&&<div className="page"><ToolPackagesPanel provider={agentProvider} onSelect={selectToolSkill}/></div>}
     {section==='skills'&&<><div className="skill-navigation"><button className="button" onClick={()=>go('relations')}>{t('计算链条')}</button><button data-testid="navigate-tools" className="button" onClick={()=>go('tools')}>{t('软件功能')}</button></div><SkillsWorkbench provider={agentProvider} settings={settings} onSaved={setSettings} selected={skill} onSelect={selectToolSkill} onError={onError}/></>}
     {section.startsWith('task:')&&(!runSourceReady||!runs.some(r=>r.id===section.slice(5)))&&<div className="page" data-testid="run-record-unavailable" data-observed={runSourceReady?'current':'unconfirmed'}><Empty title={tr(runSourceReady?'当前连接未返回此记录':'运行记录尚待核对')} body={tr(runSourceReady?'当前连接已读取运行列表，但未返回此记录。请核对原作业服务；此提示不代表记录已被删除。':'尚未取得当前服务的运行记录。恢复原作业服务后再核对，当前页面将保留。')} action={<button className="button" disabled={connecting} onClick={()=>worker?void refresh():void connectWorker()}>{tr(worker?'同步记录':'连接 WSL')}</button>}/></div>}
     {entityMissing&&<div className="page"><Empty title={tr('找不到该页面')} body={'内容尚未加载或已不存在。'} action={<button className="button" onClick={()=>go('home')}>{tr('返回工作台')}</button>}/></div>}
    </ViewBoundary></div>
    {bottomExpanded&&<PaneDivider className="bottom-resize" label={t('调整终端与队列高度')} orientation="horizontal" value={bottomHeight} min={90} max={380} reverse onChange={setBottomHeight}/>}
    <div className={"bottom-panel "+(bottomExpanded?'':'is-collapsed')} data-testid="bottom-panel" style={{height:bottomExpanded?bottomHeight:undefined}}><div className="bottom-tabs"><button className={bottomTab==='queue'?'active':''} onClick={()=>{setBottomTab('queue');setBottomExpanded(true);}}><Activity size={13}/>{tr("运行队列")}<span>{statusKnown?queueItems.length:'?'}</span></button><button className={bottomTab==='terminal'?'active':''} onClick={()=>{setTerminalOpened(true);setBottomTab('terminal');setBottomExpanded(true);}}><Terminal size={13}/>{tr("终端")}</button><div/><button hidden={!bottomExpanded} onClick={()=>void startTerminal()}><Plus size={13}/>{t('本地终端')}</button><button hidden={!bottomExpanded} title={tr("打开源码")} aria-label={tr("打开源码")} onClick={()=>void invoke('file.open').then(r=>{if(r&&confirmReplace()){setEditor({...r,source:r.content});setEditorDirty(false);setSection('editor');}}).catch(onError)}><FileCode2 size={14}/></button><button className="bottom-collapse" data-testid="toggle-bottom-panel" aria-expanded={bottomExpanded} onClick={()=>setBottomExpanded(value=>!value)}>{bottomExpanded?<ChevronDown size={15}/>:<ChevronUp size={15}/>}<span>{t(bottomExpanded?'收起':'展开')}</span></button></div><div className={bottomTab==='queue'?'queue-strip':'hidden'}>{queueItems.length?queueItems.map(job=><button key={job.key} disabled={!canOpenRecord(job.location)} onClick={()=>void openJob(job)}><span className="queue-pulse"/><strong>{job.run.name}</strong><Badge status={job.run.status}/><span>{job.location==='cluster'?t('集群'):'GPU '+job.run.gpu}</span><ChevronRight size={13}/></button>):<div className="queue-empty">{statusKnown?<CheckCircle2 size={18}/>:<Activity size={18}/>}<span>{tr(statusKnown?'队列空闲':'状态未知')}</span><small>{tr(workerNotice||(disconnected?'连接中断 · 状态未知':worker?'准备并验证输入后开始计算':'连接 WSL 作业服务以读取队列'))}</small></div>}</div><div className={bottomTab==='terminal'?'terminal-holder':'hidden'}>{terminalOpened&&<SharedTerminalPanel activeResource={computeResource} visible={bottomTab==='terminal'&&bottomExpanded&&workspacePanelVisible} request={terminalRequest} canShare={!agentBusy&&!sessionSelection?.pending} provider={agentProvider} onConversationPrepared={terminalConversationPrepared} onConfigureSsh={configureTerminalSsh} onPlainSsh={()=>setTerminalRequest(old=>old?{...old,nonce:crypto.randomUUID(),connectionMode:"plain"}:old)} resourceScope={computeResourceScope} onResourceChange={acceptComputeResource} onError={onError}/>}</div></div>
    <footer className="statusbar">{refreshFeedback&&<span role="status" aria-live="polite" data-testid="manual-refresh-feedback">{tr(refreshFeedback.status==='loading'?'正在同步记录…':refreshFeedback.status==='complete'?'记录已刷新':refreshFeedback.status==='partial'?'部分记录未刷新':'记录刷新失败')}{refreshFeedback.at&&' · '+new Date(refreshFeedback.at).toLocaleTimeString()}</span>}<span data-testid="current-compute-resource-status"><i className={(isSshResource(computeResource)?computeResource.alive===true:statusKnown)?'online':''}/>{isSshResource(computeResource)?computeResource.kind==='ssh-connection'?sshSummary(computeResource):<>{tr(computeResource.workflowReady?'SSH 作业服务已连接':computeResource.processStatus==='exited'?'SSH 终端已退出':computeResource.processStatus==='expired'?'SSH 终端访问已过期':computeResource.processStatus==='running'&&computeResource.alive===true?'SSH 终端已打开':'SSH 终端状态未知')}{computeResource.alive===true&&' · '+tr(computeResource.operator==='human'?'由你操作':computeResource.operator==='agent'?'由 Agent 操作':'操作权限待核对')}</>:tr(workerNotice||(disconnected?'连接中断 · 状态未知':worker?(serviceVersion==='current'?'WSL 已连接':serviceVersion==='different'?'WSL 已连接 · 服务版本不同':'WSL 已连接 · 服务版本未核对'):'WSL 未连接'))}</span><span>{runProject?.authoring_only?tr('草稿工作区 · 执行需选择计算项目'):(runProject?runProject.policy.gpus.map(g=>'GPU '+g).join(', ')+' · '+tr('项目授权'):tr('尚未选择项目'))}</span><div/></footer>
   </main>
   {<>{agentVisible&&<PaneDivider className="agent-divider" label={t('调整对话与内容比例')} value={displayAgentWidth} min={260} max={paneMax} reverse={!centerLayout} onChange={conversationWorkspace?setAgentWidth:setOverviewAgentWidth}/>} <Agent setupProviderChoice={guideProvider} onSetupReply={setGuideReply} onOpenHistory={()=>setModal('history')} onCollapse={()=>setAgentVisible(false)} visibleWorkflowId={workspacePanelVisible&&section.startsWith('agent-task:')&&agentTasks.some(task=>task.id===section.slice(11))?section.slice(11):null} onOpenOriginalRun={id=>openWorkflowRun(id,'cluster',activeFlow)} onOpenCluster={()=>{setClusterSelection(null);go('ssh');}} computeConnected={worker&&!disconnected} computeResource={computeResource} onComputeResource={acceptComputeResource} onConnectCompute={openComputeResources} onReviewWorker={connectWorker} conversationGroupId={chatGroupId} onOpenAccounts={openAccounts} onProviderChange={setAgentProvider} onAttachmentClear={()=>setSkill(undefined)} onAttachmentConsumed={id=>setSkill(current=>current?.attachmentId===id?undefined:current)} onNewConversation={retryNewConversation} hidden={!agentPanelVisible} sessionSelection={sessionSelection} onConversation={acceptAgentConversation} onBusyChange={setAgentBusy} planningMode={planningMode} onPlanningModeChange={setPlanningMode} projectId={projectId} onOpenTask={id=>{setSection('agent-task:'+id);setAgentVisible(true);}} intent={agentIntent} context={context} onError={onError} skill={skill} width={displayAgentWidth} onOpenRun={id=>openWorkflowRun(id,'local',activeFlow)}/></>}
  </div></section></div>
  {guidePage&&guideInfo&&<div className="setup-layer" hidden={!!lesson}><SetupAssistant info={guideInfo} page={guidePage} settings={settings} localConnected={!isSshResource(computeResource)&&worker&&!disconnected} resource={computeResource} agentBusy={agentBusy} reply={guideReply} onReply={setGuideReply} onPreferences={guidePreferences} onProgress={guideProgress} onConnect={connectFromGuide} onVisit={visitFromGuide}/></div>}
  {error&&<div className="toast" role="alert"><DiagnosticNotice record={error}/><button className="icon-button" aria-label={tr('关闭')} onClick={()=>setError(null)}><X size={16}/></button></div>}
  {deleteTarget&&<Modal title={t('删除对话')} onClose={()=>{if(!deleting)setDeleteTarget(null);}}><p>{deleteTarget.name}</p><p>{t('删除此会话及附带流程页面。已提交作业和计算文件保留。')}</p><div className="button-row"><button className="button" disabled={deleting} onClick={()=>setDeleteTarget(null)}>{t('取消')}</button><button className="button danger" disabled={deleting||agentBusy} onClick={()=>void deleteConversation()}>{t(deleting?'删除中…':'确认删除')}</button></div></Modal>}
  {modal==='history'&&<Modal title={t('历史会话')} onClose={()=>setModal('')}><label className="conversation-search"><Search size={16}/><input autoFocus aria-label={t('搜索历史会话')} placeholder={t('搜索会话')} value={conversationSearch} onChange={event=>setConversationSearch(event.target.value)}/></label><div className="history-conversations conversation-sidebar">{shownConversations.map(conversationRow)}{!shownConversations.length&&<p className="muted">{t('没有匹配的会话')}</p>}</div><button className="button" disabled={agentBusy} onClick={()=>{setModal('');newConversation();}}><Plus size={16}/>{t('新对话')}</button></Modal>}
  {groupDeleteTarget&&<Modal title={t('删除会话分组')} closeDisabled={groupDeleting} onClose={()=>{if(!groupDeletion.current)setGroupDeleteTarget(null);}}><p>{t('删除分组')}“{groupDeleteTarget.name}”？</p><p>{t('组内会话将保留在“未分组会话”中，计算流程与运行记录保留。')}</p><div className="button-row"><button className="button" disabled={groupDeleting} onClick={()=>setGroupDeleteTarget(null)}>{t('取消')}</button><button className="button danger" disabled={groupDeleting||agentBusy} onClick={()=>void deleteConversationGroup()}>{t(groupDeleting?'正在删除分组…':'删除分组')}</button></div></Modal>}
  {modal==='chat-project'&&<Modal title={t('新建会话分组')} onClose={()=>setModal('')}><label>{t('分组名称')}<input autoFocus aria-label={t('会话分组名称')} value={groupName} onChange={e=>setGroupName(e.target.value)} maxLength={60}/></label><p className="muted">{t('分组仅用于整理会话；计算项目负责执行范围与授权。')}</p><button className="button primary" disabled={busy||!groupName.trim()} onClick={()=>void createChatGroup()}>{t('创建分组')}</button></Modal>}
  {command&&<Modal title={tr("搜索与命令")} onClose={()=>{setCommand(false);setPaletteSearch('');}}><input autoFocus aria-label={tr("搜索页面、引擎或任务…")} placeholder={tr("搜索页面、引擎或任务…")} value={paletteSearch} onChange={e=>setPaletteSearch(e.target.value)}/><div className="command-list">{computeConnectionCommandMatches(paletteSearch)&&<button disabled={agentBusy||connecting} onClick={()=>{setCommand(false);setPaletteSearch('');setComputeChooser(true);}}><Server size={17}/>{settings.language==='en'?'Connect compute resources…':t('连接计算资源…')}<ChevronRight size={13}/></button>}<ConversationCommands query={paletteSearch} blocked={agentBusy||deleting||renaming||busy||imageSaving||!!modal||!!deleteTarget||!!renameTarget} onDismiss={()=>{setCommand(false);setPaletteSearch('');}} onNewConversation={newConversation} onShowConversations={()=>{setModal('history');}}/>{sections.filter(s=>tr(s[1]).toLowerCase().includes(paletteSearch.toLowerCase())||s[0].includes(paletteSearch.toLowerCase())).map(([id,label,Icon])=><button key={id} onClick={()=>{go(id==='home'&&retainedTask?'agent-task:'+retainedTask.id:id);setCommand(false);setPaletteSearch('');}}><Icon size={17}/>{tr(label)}<ChevronRight size={13}/></button>)}{allJobs.filter(job=>job.run.name.toLowerCase().includes(paletteSearch.toLowerCase())).slice(0,8).map(job=><button key={job.key} disabled={!canOpenRecord(job.location)} onClick={()=>{void openJob(job);setCommand(false);setPaletteSearch('');}}><Activity size={17}/>{job.run.name}<Badge status={job.run.status}/></button>)}{conversations.filter(conversation=>conversationMatches(conversation,paletteSearch)).slice(0,8).map(conversation=><button key={'conversation:'+conversation.id} disabled={agentBusy} onClick={()=>{void chooseConversation(conversation);setCommand(false);setPaletteSearch('');}}><MessageSquare size={17}/>{conversation.name}<ChevronRight size={13}/></button>)}{tools.filter(tool=>t(tool.name).toLocaleLowerCase().includes(paletteSearch.toLocaleLowerCase())).map(tool=><button key={'tool:'+tool.id} onClick={()=>{go('tool:'+tool.id);setCommand(false);setPaletteSearch('');}}><ModuleIcon module={tool.id}/>{t(tool.name)}<ChevronRight size={13}/></button>)}<WorkbenchImageCommand query={paletteSearch} busy={imageSaving} onDismiss={()=>{setCommand(false);setPaletteSearch('');}} onBusy={setImageSaving} onSaved={setImageReceipt} onError={onError}/></div></Modal>}
  {imageReceipt?.status==='saved'&&<Modal title={t('工作台图像已保存')} onClose={()=>setImageReceipt(null)}><p>PNG · {imageReceipt.width} × {imageReceipt.height} · {imageReceipt.bytes} bytes</p><p className="mono">{imageReceipt.path}</p><small className="mono">SHA256 · {imageReceipt.sha256}</small><button className="button" onClick={()=>setImageReceipt(null)}>{t('关闭')}</button></Modal>}
  {cliRequired&&<CliRuntimeDialog provider={cliRequired.provider} readiness={cliRequired} onClose={()=>setCliRequired(null)} onReady={()=>{const provider=cliRequired.provider;setCliRequired(null);openAccounts(provider);}}/>}
  {modal==='accounts'&&<Modal title={t('账号与 API')} onClose={()=>setModal('')}><AccountCenter provider={accountsProvider} busy={agentBusy} onError={onError}/></Modal>}
  {renameTarget&&<Modal title={t('重命名会话')} onClose={()=>{if(!renaming)setRenameTarget(null);}}><label>{t('会话简称')}<input autoFocus data-testid="conversation-name" maxLength={60} value={conversationName} disabled={renaming} onChange={e=>setConversationName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)void renameConversation();}}/></label><div className="button-row"><button className="button" disabled={renaming} onClick={()=>setRenameTarget(null)}>{t('取消')}</button><button className="button primary" disabled={renaming||!conversationName.trim()} onClick={()=>void renameConversation()}>{t('保存名称')}</button></div></Modal>}
  {modal==='projects'&&<Modal title={t('计算项目')} onClose={()=>setModal('')}><section data-testid="project-management"><p className="project-management-intro">{t('选择计算项目，或创建独立的计算权限范围。')}</p><div className="project-management-actions"><button className="button primary" data-testid="new-project" onClick={newProject} disabled={!worker||disconnected||busy}><Plus size={15}/>{t('新建计算项目')}</button><button className="button" data-testid="project-compute-resources" onClick={()=>{setModal('');go('environments');}}><Server size={15}/>{t('计算资源')}</button></div><div className="project-management-list">{projects.map(p=><div key={p.id} className={'project-management-row '+(projectId===p.id?'current-project':'')}><button className="project-management-select" aria-label={projectLabel(p)} onClick={()=>{setSkill(undefined);setProjectId(p.id);setModal('');}}><ModuleIcon module="project"/><span><strong>{projectLabel(p)}</strong><small>{t(p.authoring_only?'草稿工作区':'计算项目')}{projectId===p.id?' · '+t('当前项目'):''}</small></span></button>{!p.authoring_only&&<button className="button" aria-label={t('计算权限设置')+' · '+p.name} disabled={!worker||disconnected||busy} onClick={()=>void editProjectPolicy(p)}><SettingsIcon size={15}/>{t('计算权限设置')}</button>}</div>)}{!projects.length&&<p className="project-management-empty">{t('尚无项目')}</p>}</div></section></Modal>}
  {modal==='project-edit'&&<Modal title={t('计算权限设置')} wide onClose={closeProjectPolicy}><details className="project-technical-id"><summary>{t('项目标识')}</summary><code>{projectPolicyId}</code></details>{projectPolicyError?<p role="alert">{projectPolicyError}</p>:projectPolicyInitial?<ProjectAuthorizationForm key={projectPolicyId} environments={environments} busy={busy} initialSpec={projectPolicyInitial} onCancel={closeProjectPolicy} onSubmit={saveProjectPolicy}/>:<p role="status">{t('正在读取当前项目授权…')}</p>}</Modal>}
  {modal==='project'&&<Modal title={t('新建计算项目')} wide onClose={()=>setModal('projects')}><ProjectAuthorizationForm environments={environments} busy={busy} onCancel={()=>setModal('projects')} suggestedEnvironmentId={agentTasks.find(task=>task.id===selectedConversationRef.current?.taskId)?.authoring?.environmentId} suggestedInputRoot={agentTasks.find(task=>task.id===selectedConversationRef.current?.taskId)?.authoring?.inputRoot} onSubmit={async spec=>{setBusy(true);try{const value=await api<Project>('POST','/api/projects',spec);setProjectId(value.id);setModal('');await refresh();}finally{setBusy(false);}}}/></Modal>}
  {modal==='environment'&&<Modal title={tr("注册独立科学环境")} wide onClose={()=>setModal('')}><p className="muted">{tr("填写 Linux 绝对路径。executables 支持 python、gpumd、gpu-sampling、nep、hotpp、pygas；repositories 支持 pydyn、pygas、hotpp。")}</p><textarea className="json-input" value={environmentDraft} onChange={e=>setEnvironmentDraft(e.target.value)}/><button className="button primary" disabled={busy} onClick={()=>{if(busy)return;let spec:any;try{spec=JSON.parse(environmentDraft);}catch(e){onError(e);return;}setBusy(true);void api('POST','/api/environments',spec).then(()=>{setModal('');void refresh();}).catch(onError).finally(()=>setBusy(false));}}>{tr("保存环境")}</button></Modal>}
  {modal==='run'&&<Modal title={tr("高级：原生计算草稿")} wide onClose={()=>setModal('')}><div className="form-row"><label>{tr("计算名称")}<input disabled={runDirty} value={runDraft.name||''} onChange={e=>setRunDraft({...runDraft,name:e.target.value})}/></label><label>{tr("引擎")}<select disabled={runDirty} value={runDraft.engine||''} onChange={e=>changeEngine(e.target.value)}>{engines.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label></div><div className="form-row"><label>{tr("计算环境")}<select disabled={runDirty} value={runDraft.environment_id||''} onChange={e=>setRunDraft({...runDraft,environment_id:e.target.value})}><option value="">{tr("选择环境")}</option>{environments.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label>{t('GPU 编号')}<input disabled={runDirty} type="number" min={0} value={runDraft.gpu??''} onChange={e=>setRunDraft({...runDraft,gpu:Number(e.target.value)})}/></label><label>{tr("时长上限 · s")}<input disabled={runDirty} type="number" min={1} value={runDraft.max_seconds??''} onChange={e=>setRunDraft({...runDraft,max_seconds:Number(e.target.value)})}/></label></div><label>{tr("完整任务描述 · inputs 是运行目录文件名 → 已授权源文件路径")}</label><textarea className="json-input" aria-label={tr("完整任务描述 · inputs 是运行目录文件名 → 已授权源文件路径")} value={runJson} onChange={e=>setRunJson(e.target.value)}/>{runDirty&&<div className="button-row"><button className="button" onClick={applyRunJson}>{tr('应用 JSON')}</button><span className="muted">{tr('存在未应用的 JSON 修改')}</span></div>}<p className="muted">{tr("采样任务需 bias_file、structure_file、cv_size、cutoff 和 mode。输入复制到独立目录；检查结果单独记录，可在授权范围内提交。")}</p><button className="button primary" disabled={busy||runDirty} onClick={async()=>{setBusy(true);try{const r=await api('POST','/api/runs/prepare',{spec:runDraft});void openTask(r.id);setModal('');await refresh();}catch(e){onError(e);}finally{setBusy(false);}}}>{tr("创建输入快照与草稿")}</button></Modal>}
  {modal==='updates'&&<Modal title={t('软件更新')} onClose={()=>setModal('')}><SoftwareUpdate {...updates}/></Modal>}
  {modal==='settings'&&<Modal title={t('工作台设置')} wide closeDisabled={settingsSaving} onClose={closeSettings}><SettingsPage updates={updates} onOpenComputeResources={openComputeResources} onOpenLocalCompute={openLocalCompute} onOpenSshCompute={openSshConfiguration} onOpenProjects={openProjects} onOpenSkills={()=>{if(settingsSavingRef.current)return;closeSettings();setSection('skills');}} settings={settings} onChange={setSettings} onClose={closeSettings} onSavingChange={saving=>{settingsSavingRef.current=saving;setSettingsSaving(saving);}} onSaved={saved=>{settingsBackup.current=saved;}} onError={onError}/></Modal>}
  {computeChooser&&<ComputeConnectionChooser preferredKind={guideShowing?guideKind:undefined} initialEdit={computeChooserEdit} activeResource={computeResource} connectionBusy={agentBusy||connecting} onLocal={connectSavedLocal} onSsh={connectSavedSsh} onManageSsh={openSshConfiguration} onServiceChange={()=>void refreshComputeResource()} onServiceEnvironmentHelp={profile=>{if(guideShowing)setLesson({destination:'ssh-service'});setComputeChooser(false);askAgent('协助配置此 SSH 连接的 AIMatterLab 作业服务环境：连接 ID '+profile.id+'，保存版本 '+profile.version+'。先读取 studio-compute-workflow 的作业服务接入指引；使用我已核验的基础 SSH 连接及明确交给 Agent 的独立 Shell，优先查找已有 Conda/venv/module 环境，核对 Python 版本与 sqlite3，给出明确的解释器路径和激活命令，再由我保存到该连接的作业服务环境。不要新建 SSH 登录、代输认证信息、安装软件、更改项目授权或提交计算；未取得服务就绪证据时不要声称已完成。');}} onClose={()=>{setComputeChooser(false);setComputeChooserEdit(undefined);setGuideKind(undefined);}} localConnected={worker&&!disconnected}/>}
  {sshGuide&&<SshConnectionGuide request={sshGuide.request} language={settings.language} onClose={()=>closeSshGuide()} onWorkerUpdate={sshGuide.standalone?undefined:()=>{if(conversationSelectionSeq.current!==sshGuide.selectionSeq||selectedConversationRef.current?.id!==sshGuide.conversationId)return;return connectWorker(sshGuide.taskId);}}/>}
  {computeGuide&&<ComputeConnectionGuide key={computeGuide.id} taskId={computeGuide.taskId} profile={computeGuide.profile} language={settings.language} onConnectStart={()=>{if(computeGuideRequest.current?.id===computeGuide.id){beginWorkerGate();setWorkerRestoring(false);}}} onClose={connected=>closeComputeGuide(computeGuide.id,connected)}/>}

 </div>;
}
