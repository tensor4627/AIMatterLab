import MonitorAttention from '../features/runs/MonitorAttention';
import type {ComputeConsoleChannel,ComputeConsoleResource,ComputeConsoleTerminal,ManagedResource,MonitorNotice} from '../../contracts/dto/managed-compute';
import ConversationResourceStatus from '../features/conversations/ConversationResourceStatus';
import {ConversationAttentionBadges,NextConversationAttention,type AttentionValue} from '../features/conversations/ConversationAttention';
import {activityKey,nextConversationAttention,useConversationActivity} from '../features/conversations/useConversationActivity';
import type {ConversationAttentionTarget} from '../../contracts/dto/conversation-activity';
import {useManagedResources} from '../features/compute/useManagedResources';
import CodexEnvImportDialog from '../features/conversations/CodexEnvImportDialog';
import GuideSpotlight from '../features/onboarding/GuideSpotlight';
import SetupLesson,{type SetupLessonLocation} from '../features/onboarding/SetupLesson';
import type {SetupGuideInfo,SetupPage,SetupProgress,SetupProgressRequest} from '../../contracts/dto/setup-guide';
import type {ModelReply,SetupPreferences,SetupVisit} from '../features/onboarding/SetupAssistant';
import {CircleHelp} from 'lucide-react';
import product from "../../contracts/product.json";
import type {DeleteConversationGroupRequest,DeleteConversationGroupResult} from '../../contracts/dto/agent';
import {savedSshChoice,sshStateLabel} from "../features/compute/ssh-connection-types";
import {taskWorkerSource,unboundWorkflow} from '../../contracts/compute/task-worker-binding.mjs';
import type {DiagnosticRepairRequest} from '../features/diagnostics/repair-request.mjs';
import {computeResources,resourceWorkspaces,sshConnections} from '../api/compute-resources';
import type {ComputeResourceState,ResourceWorkspaceReference,SshServiceState} from '../../contracts/dto/compute';
import type {ResourceToolRoute} from '../../contracts/dto/resource-tools';
import type {ResourceToolDiscussion} from '../features/tools/ResourceToolSetup';
import {readClusterGuide,storeClusterGuide,type ClusterGuideProgress} from '../features/onboarding/cluster-guide-progress';
import {useToolWorkflowNavigation} from "../features/workflows/useToolWorkflowNavigation";
import {useConversationSelection,storedConversation,storeConversation} from "../features/conversations/useConversationSelection";

import ConversationCommands from "../features/conversations/ConversationCommands";
import ConversationMenu from "../features/conversations/ConversationMenu";
import {ConversationHistorySearch} from '../features/conversations/ConversationHistory';
import type {ConversationAnchor,ConversationHistoryTarget} from '../../contracts/dto/conversation-history';
import {conversationHistory,hasConversationHistory} from '../api/conversation-history';
import WorkbenchImageCommand from "../features/diagnostics/WorkbenchImageCommand";
import {type WorkbenchImageResult} from '../../contracts/dto/diagnostics';


import type {SshAuthenticationRequest} from "../features/cluster/SshConnectionGuide";
import {enqueueSshGuide,takeQueuedSshGuide} from './ssh-guide-queue.mjs';
import {computeConnectionCommandMatches} from "../features/compute/compute-connection-command.mjs";

import DiagnosticNotice from "../features/diagnostics/DiagnosticNotice";
import {createDiagnostic,type UiDiagnostic} from "../features/diagnostics/ui-diagnostics.mjs";
import {ConfirmDialog,ConfirmProvider,useConfirm} from '../ui/ConfirmDialog';
import {ToastProvider,useToast} from '../ui/Toast';
import {statusLabel} from '../ui/StatusBadge';
import {recommendedMinimumFontSize} from '../features/settings/appearance-defaults';
import {shortcutLabel,workspaceShortcut,workspaceShortcuts,type WorkspaceShortcut} from './workspace-shortcuts';
import Button from '../ui/Button';
import Notice from '../ui/Notice';
import Disclosure from '../ui/Disclosure';
import Field from '../ui/Field';
import {EmptyState,LoadingState} from '../ui/States';

import {version as STUDIO_VERSION} from "../../package.json";
import './workspace-shortcuts.css';
import '../ui/tooltip.css';
import PaneDivider from "../ui/PaneDivider";
import Tooltip,{HelpTip} from "../ui/Tooltip";
import JobsPage,{type RecordObservation} from "../features/runs/JobsPage";
import {selectedRecordScope,matchesSelectedRecordService,readSelectedServiceRecords,type RecordServiceObservation} from '../features/runs/selected-service-records.mjs';
import {unifiedJobs,conversationMatches,computeProjectForSelection,toolGroups,type ClusterJob,type Job} from './workspace-shell.mjs';
import {followedProjectId} from './project-follow.mjs';
import ModuleIcon from "../ui/ModuleIcon";
import {workspaceModule,primaryDestination} from './workspace-navigation.mjs';
import type {CustomCvInvoke} from "../features/custom-cv/custom-cv-contract";
import type {CompositionAssetImportResult} from "../features/pygas/CompositionAssetImport";
import "../features/workflows/task-flow.css";
import ViewBoundary from "../ui/ViewBoundary";
import {tr} from "../ui/i18n";
import {useEffect,useRef,useState} from 'react';
import {Home,Clock,KeyRound,GitBranch,Activity,Atom,Box,FileCode2,Folder,Layers3,FlaskConical,GraduationCap,Database,Server,Terminal,BookOpen,Search,Plus,ArrowUpRight,Settings as SettingsIcon,Sun,Moon,Minus,Square,X,RefreshCw,PanelLeftClose,PanelLeftOpen,PanelRightClose,PanelRightOpen,Play,ChevronRight,Save,PlugZap,Check,CheckCircle2,MessageSquare,ChevronDown,ChevronUp} from 'lucide-react';
import {TaskCards,Relations,ToolPage,WorkflowPage} from "../features/workflows/Workflows";
import {tasks,tools} from "../features/workflows/workflow-catalog.mjs";
import {type Plan} from "../../contracts/workflows/plan.mjs";



import {deploymentApi} from "../api/deployment-client";

import ProjectAuthorizationForm,{type ProjectAuthorizationSpec} from "../features/compute/ProjectAuthorizationForm";
import {createProjectPolicyEditor,type ProjectPolicyEditor} from "../features/compute/project-policy-edit.mjs";

import Agent from "../features/conversations/Agent";




import {useWorkspaceLayout} from './useWorkspaceLayout';
import {readPreference,writePreference} from '../ui/preference-storage';
import {t,getLanguage,setLanguage} from "../ui/i18n";
import RunDetail from "../features/runs/RunDetail";
import RunReview,{taskModule} from "../features/runs/RunReview";



import {CodeEditor} from "../ui/widgets";
import {EvidenceConversation,EvidenceSelection,type EvidenceLineRange} from '../features/conversations/EvidenceSelection';
import type {SharedTerminalRequest} from "../features/terminal/SharedTerminalPanel";
import type {HandoffLessonStage,SshEnvironmentHelpTarget} from "../features/terminal/SshConnectionPanel";
import {Modal,Badge} from "../ui/Dialogs";
import {api,readWorkerStatus,restoreWorker} from '../api/worker';
import {clearTaskDrafts} from '../features/workflows/task-drafts';
import {invoke} from '../api/studio';
import {engines} from '../ui/presentation/engines';
import {type Project,type Environment,type ComputeProfile,type WslComputeProfile,type SshComputeProfile} from '../../contracts/dto/compute';
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
import {useWorkspaceUpdate,SoftwareUpdate,UpdateButton} from "../features/settings/SoftwareUpdate";
const SettingsPage=lazyPanel("SettingsPage",()=>import("../features/settings/SettingsPage"));
const SkillsWorkbench=lazyPanel("SkillsWorkbench",()=>import("../features/tools/SkillsWorkbench"));
const SharedTerminalPanel=lazyPanel("SharedTerminalPanel",()=>import("../features/terminal/SharedTerminalPanel"));
const ToolPackagesPanel=lazyPanel("ToolPackagesPanel",()=>import("../features/tools/ToolPackagesPanel"));
const PygasTaskComposer=lazyPanel("PygasTaskComposer",()=>import("../features/pygas/PygasTaskComposer"));
const StructureBuilder=lazyPanel("StructureBuilder",()=>import("../features/assets/StructureBuilder"));
const AssetInspector=lazyPanel("AssetInspector",()=>import("../features/assets/AssetInspector"));
const ClusterPage=lazyPanel("ClusterPage",()=>import("../features/cluster/ClusterPage"));
const ClusterRunPage=lazyPanel("ClusterRunPage",()=>import("../features/cluster/ClusterRunPage"));
const MaterialsProjectSearch=lazyPanel("MaterialsProjectSearch",async()=>{const module=await import("../features/assets/MaterialsProject");return {default:module.MaterialsProjectSearch};});
const SshConnectionGuide=lazyPanel("SshConnectionGuide",()=>import("../features/cluster/SshConnectionGuide"));
const ComputeResourceConsole=lazyPanel("ComputeResourceConsole",()=>import("../features/compute/ComputeResourceConsole"));
const ResourceToolSetup=lazyPanel("ResourceToolSetup",()=>import("../features/tools/ResourceToolSetup"));

const sections=[['home','工作区',Layers3],['tools','工具与资源',Layers3],['extensions','第三方工具包',BookOpen],['relations','工具关系图',GitBranch],['runs','运行记录',Activity],['bias','Bias 实验室',FlaskConical],['training','模型与训练',GraduationCap],['assets','数据资产',Database],['compute-resources','计算资源',Server],['environments','计算环境',Server],['deployment','部署与执行',Play],['ssh','SSH 集群',Terminal],['skills','技能库',BookOpen]] as const;
const mainDestinations=[['home','工作区',Home],['runs','运行记录',Clock],['tools','工具与资源',Layers3],['compute-resources','计算资源',Server]] as const;
const initialSettings:Settings={distribution:'Ubuntu',workerRoot:'~/.local/state/gpu-sampling-studio',workerPort:8767,codexPath:'codex',cwd:'',skillRoots:[],theme:'dark'};
function isSshResource(value:ComputeResourceState|null|undefined):value is ComputeResourceState{return value?.kind==='ssh-terminal'||value?.kind==='ssh-connection';}
function isActiveSshResource(value:ComputeResourceState|null|undefined):boolean{return isSshResource(value)&&value.status==='selected'&&value.alive===true;}
function sshSummary(value:ComputeResourceState){
 if(!value.connectionStatus&&value.status==='unavailable')return t('上次选择的 SSH 连接已不可用');
 return 'SSH: '+t(sshStateLabel(value.connectionStatus||value.status))+' · '+t('终端')+': '+t(sshStateLabel(value.capabilities?.terminal.status))+' · '+t('当前流程作业服务')+': '+t(sshStateLabel(value.capabilities?.service.status));
}
function hostedSshSummary(resources:ManagedResource[],pending=false){
 if(!resources.length)return '';
 const names=resources.map(resource=>resources.length>1&&resource.verificationPending?resource.name+' ('+t('待核对')+')':resource.name).join(' · ');
 const summary='SSH · '+t('已托管')+' · '+names;
 if(pending)return summary+' · '+t('状态待核对');
 if(resources.length>1)return summary;
 const labels={ready:'可用',idle:'未连接',preparing:'准备中',configuration_required:'未配置',unavailable:'不可用'} as const;
 const {verificationPending,serviceStatus}=resources[0];
 return summary+' · '+t('作业服务')+' '+t(verificationPending?'待核对':serviceStatus?labels[serviceStatus]:'状态未知');
}
function shortTime(value:number){return new Date(value*1000).toLocaleString(getLanguage(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
function errorText(e:unknown){return e instanceof Error?e.message:String(e);}
function bounded(value:number|undefined,min:number,max:number,fallback:number){return typeof value==='number'&&Number.isFinite(value)&&value>0?Math.min(max,Math.max(min,value)):fallback;}
function RunTable({items,selected,onOpen,canOpen,canPrepare,onPrepare}:{items:Run[];selected:string|null;onOpen:(run:Run)=>void;canOpen:boolean;canPrepare:boolean;onPrepare:()=>void}){
 return items.length?<div className="run-table"><div className="table-heading"><span>{tr("计算名称")}</span><span>{tr("状态")}</span><span>{tr("资源")}</span><span>{tr("创建时间")}</span></div>{items.map(r=><button key={r.id} className={'run-row '+(selected===r.id?'selected':'')} aria-current={selected===r.id?'true':undefined} disabled={!canOpen} onClick={()=>onOpen(r)}><span><span className="run-icon"><Atom size={17}/></span><span><strong>{r.name}</strong><small>{r.engine}</small></span></span><Badge status={r.status}/><span className="mono">GPU {r.gpu}</span><span className="muted">{shortTime(r.created_at)}</span></button>)}</div>:<EmptyState title="这里将记录你的计算" body="准备输入并提交任务，检查结果单独保留。所有状态来自作业服务。" action={<Button onClick={onPrepare} disabled={!canPrepare} disabledReason={t('连接作业服务并选择计算项目后继续。')}><Plus size={14} aria-hidden="true"/>{tr("准备第一个计算")}</Button>}/>;
}
type SshGuideState={request:SshAuthenticationRequest;taskId?:string;conversationId?:string;selectionSeq:number;standalone:boolean};
type ResourceToolLocation={profileId:string;profileVersion:number;name:string;route?:ResourceToolRoute;missing?:string;taskId?:string;conversationId?:string;newPlanAfter?:string[]};
type WorkflowToolQuestion={id:string;taskId:string;workflowRevision:string;provider:AgentProvider;threadId:string;profileId:string;profileVersion:number;tool:string};
const toolQuestionRevision=(task:any)=>JSON.stringify([task?.parameterRevision,task?.deployment?.revision,task?.roadmap]);
export default function AppRoot(){
 return <ToastProvider><ConfirmProvider><App/></ConfirmProvider></ToastProvider>;
}

export function App(){
 const confirm=useConfirm(),{show:showToast,dismiss:dismissToast}=useToast();
 const managed=useManagedResources();
 const managedPending=managed.observation==='pending';
 const [focusSchedule,setFocusSchedule]=useState<{sourceId:string;scheduleId:string;nonce:string}|null>(null);
 const openNoticeRef=useRef<(notice:Pick<MonitorNotice,'id'|'sourceId'|'scheduleId'>)=>void>(()=>{});
 function acknowledgeNotice(id:string){void invoke('compute.managed.acknowledgeNotice',{id}).catch(onError);}
 async function openNotice(notice:Pick<MonitorNotice,'id'|'sourceId'|'scheduleId'>){
  if(!await go('runs'))return;
  setPrimaryPanel('workspace');setFocusSchedule({sourceId:notice.sourceId,scheduleId:notice.scheduleId,nonce:crypto.randomUUID()});
  acknowledgeNotice(notice.id);
 }
 openNoticeRef.current=openNotice;
 const replying=(owner?:{provider?:string;threadId?:string}|null)=>!managedPending&&!!owner&&managed.conversations.some(c=>c.provider===owner.provider&&c.threadId===owner.threadId&&c.replying);
 const updates=useWorkspaceUpdate();
 const openUpdates=()=>setModal('updates');
 const updateVisible=['available','downloading','verifying','ready'].includes(updates.state.phase);
 const [guideInfo,setGuideInfo]=useState<SetupGuideInfo|null>(null),[guidePage,setGuidePage]=useState<SetupPage|null>(null);
 const [dismissedLesson,setDismissedLesson]=useState<SetupLessonLocation|null>(null);
 const [lesson,setLesson]=useState<SetupLessonLocation|null>(null),[guideKind,setGuideKind]=useState<'wsl'|'ssh'>();
 const [clusterGuide,setClusterGuide]=useState<ClusterGuideProgress|null>(readClusterGuide);
 const [toolSetup,setToolSetup]=useState<ResourceToolLocation|null>(null),[toolSetupReview,setToolSetupReview]=useState<(ResourceToolLocation&{selectionSeq:number;provider:AgentProvider})|null>(null);
 const [toolSetupRevision,setToolSetupRevision]=useState('');
 const [workflowToolQuestion,setWorkflowToolQuestion]=useState<WorkflowToolQuestion|null>(null);
 const [toolSetupReturn,setToolSetupReturn]=useState<{destination:'scheduler'|'project';owner?:string;scope:string;opener:HTMLElement|null;workerScope?:ResourceWorkspaceReference}|null>(null);
 const [toolSetupTargetDefaults,setToolSetupTargetDefaults]=useState<{profileId:string;profileVersion:number;root?:string;schedulerId?:string}|null>(null);
 const [guideProvider,setGuideProvider]=useState<{provider:AgentProvider;nonce:string}>(),[guideReply,setGuideReply]=useState<ModelReply|null>(null);
 const guideShowing=guidePage!==null&&!lesson;
 const lessonOpener=useRef<HTMLElement|null>(null);
 const [computeChooser,setComputeChooser]=useState(false);
 const [computeChooserEdit,setComputeChooserEdit]=useState<{profileId:string;profileVersion:number;nonce:string;section?:'service'|'environment';connectionId?:string;sessionId?:string}|undefined>();
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
 const {sidebarVisible,setSidebarVisible,sidebarWidth,setSidebarWidth,agentVisible,setAgentVisible,agentWidth,setAgentWidth,
  overviewAgentWidth,setOverviewAgentWidth,bottomHeight,setBottomHeight,bottomExpanded,setBottomExpanded,windowWidth}=useWorkspaceLayout();
 const [chatGroups,setChatGroups]=useState<{id:string;name:string}[]>([]),[chatGroupId,setChatGroupId]=useState<string|null>(null),[groupName,setGroupName]=useState('');
 const [pinnedToolIds,setPinnedToolIds]=useState<string[]>(()=>{
  try{
   const saved:unknown=JSON.parse(readPreference('studio.pinnedTools')||'[]');
   return Array.isArray(saved)?[...new Set(saved.filter((id):id is string=>tools.some(tool=>tool.id===id)))]:[];
  }catch{return [];}
 });
 function togglePinnedTool(id:string){
  const next=pinnedToolIds.includes(id)?pinnedToolIds.filter(pinned=>pinned!==id):[...pinnedToolIds,id];
  setPinnedToolIds(next);
  writePreference('studio.pinnedTools',JSON.stringify(next));
 }
 const pinnedTools=pinnedToolIds.map(id=>tools.find(tool=>tool.id===id)!);
 const [cliRequired,setCliRequired]=useState<CliReadiness|null>(null);
 const [accountsProvider,setAccountsProvider]=useState<AgentProvider>('codex'),[renameTarget,setRenameTarget]=useState<Conversation|null>(null),[conversationName,setConversationName]=useState(''),[renaming,setRenaming]=useState(false);
 const [groupDeleteTarget,setGroupDeleteTarget]=useState<{id:string;name:string}|null>(null),[groupDeleting,setGroupDeleting]=useState(false),groupDeletion=useRef(false);
 const [deleteTarget,setDeleteTarget]=useState<Conversation|null>(null),[deleting,setDeleting]=useState(false),conversationDeletion=useRef(false);
 const [agentTasks,setAgentTasks]=useState<any[]>([]),[clusterDraft,setClusterDraft]=useState<any>();
 const [plans,setPlans]=useState<Plan[]>([]),[agentIntent,setAgentIntent]=useState<AgentIntent>();
 const [section,setSection]=useState(()=>readPreference('studio.section')||'home'),[projects,setProjects]=useState<Project[]>([]),[environments,setEnvironments]=useState<Environment[]>([]),[runs,setRuns]=useState<Run[]>([]),[assets,setAssets]=useState<Artifact[]>([]);
 const sectionRef=useRef(section);sectionRef.current=section;
 const [projectId,setProjectId]=useState(''),[settings,applySettings]=useState(initialSettings),[worker,setWorker]=useState(false),[connecting,setConnecting]=useState(false);
 const [workerSourceId,setWorkerSourceId]=useState(''),[workerNotice,setWorkerNotice]=useState('');
 function setSettings(value:Settings|((previous:Settings)=>Settings)){settingsRevision.current++;const next=typeof value==='function'?value(settingsRef.current):value,previous=settingsRef.current;settingsRef.current=next;applySettings(next);if([next.distribution,next.workerRoot,next.workerPort].join('\n')!==[previous.distribution,previous.workerRoot,previous.workerPort].join('\n')){beginWorkerGate();setWorkerRestoring(false);}}
 const [selected,setSelected]=useState<string|null>(null);
 const [primaryPanel,setPrimaryPanel]=useState<'agent'|'workspace'>('agent'),[conversationSearch,setConversationSearch]=useState('');
 const [compactPane,setCompactPane]=useState(false);
 const workspaceContent=useRef<HTMLDivElement>(null);
 const workspaceScroll=useRef(new Map<string,number>()),workspacePage=useRef(section);
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
 const shortcutHandler=useRef<(event:KeyboardEvent)=>void>(()=>{});
 const [editor,setEditor]=useState({name:'workflow.py',source:'# 打开输入文件，或在 Bias 实验室生成可检查的构建源码。\n',id:'',path:''});
 const [environmentDraft,setEnvironmentDraft]=useState(''),[runDraft,setRunDraft]=useState<any>({}),[runJson,setRunJson]=useState('{}');
 const [environmentJsonError,setEnvironmentJsonError]=useState('');
 const environmentEditorRevision=useRef(0);
 const [runJsonError,setRunJsonError]=useState('');
 const [terminalRequest,setTerminalRequest]=useState<SharedTerminalRequest>(),[bottomTab,setBottomTab]=useState('queue'),[skill,setSkill]=useState<SkillAttachment>(),[agentProvider,setAgentProvider]=useState<AgentProvider>('codex');
 const terminalDraft=useRef<((provider:AgentProvider)=>string|undefined)|null>(null);
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
 const [gpuStatus,setGpuStatus]=useState<any[]>([]),[disconnected,setDisconnected]=useState(false);
 const editorSaving=useRef(false),editorOpening=useRef(false),editorLatest=useRef(editor);editorLatest.current=editor;
 const [editorSave,setEditorSave]=useState(''),[openingRun,setOpeningRun]=useState<{id:string;sequence:number}|null>(null),openingRunRef=useRef<{id:string;sequence:number}|null>(null);
 const [editorDirty,setEditorDirty]=useState(false),[paletteSearch,setPaletteSearch]=useState('');
 const editorDirtyRef=useRef(editorDirty);editorDirtyRef.current=editorDirty;
 const [editorLineRange,setEditorLineRange]=useState<EvidenceLineRange|null>(null);
 const [refreshFeedback,setRefreshFeedback]=useState<{seq:number;status:'loading'|'complete'|'partial'|'failed';at:number|null}|null>(null);
 const announcedRefresh=useRef<{seq:number;toast:number}|null>(null);
 useEffect(()=>{
  const previous=announcedRefresh.current;
  if(previous&&previous.seq!==refreshFeedback?.seq){dismissToast(previous.toast);announcedRefresh.current=null;}
  if(refreshFeedback?.status==='complete'&&previous?.seq!==refreshFeedback.seq){
   announcedRefresh.current={seq:refreshFeedback.seq,toast:showToast({severity:'success',message:t('记录已刷新'),testId:'manual-refresh-feedback'})};
  }
 },[refreshFeedback,showToast,dismissToast]);
 const refreshing=useRef(false),gpuLoading=useRef(false),sourceFailures=useRef(new Map<string,number>()),sourceGeneration=useRef(0);const [gpuStale,setGpuStale]=useState(false);
 const referenceReads=useRef(new Map<string,number>());
 const refreshSeq=useRef(0),latestRefresh=useRef<Promise<void>>(Promise.resolve()),openSeq=useRef(0),settingsBackup=useRef<Settings|null>(null),settingsWorkerReady=useRef(false),editorSource=useRef(editor.source);editorSource.current=editor.source;
 const onError=(e:unknown)=>{const next=createDiagnostic(e);setError(previous=>previous?.raw===next.raw?previous:next);};
 useEffect(()=>{
  if(!error)return;
  const id=showToast({severity:'error',testId:'global-diagnostic-toast',message:<DiagnosticNotice record={error} announce={false}/>,onDismiss:()=>setError(value=>value===error?null:value)});
  return()=>dismissToast(id);
 },[error,showToast,dismissToast]);
 const activityRows=useConversationActivity(),[attentionTarget,setAttentionTarget]=useState<ConversationAttentionTarget>();
 const [historyTarget,setHistoryTarget]=useState<ConversationHistoryTarget>(),[searchHistoryBody,setSearchHistoryBody]=useState(false);
 const historyEnabled=hasConversationHistory();
 const {conversations,setConversations,selectedConversationId,setSelectedConversationId,selectedConversationRef,conversationSelectionSeq,sessionSelection,setSessionSelection,freshSelectionPending,agentBusy,setAgentBusy,planningMode,setPlanningMode,conversationChanged,acceptAgentConversation,chooseConversation,newConversation,retryNewConversation}=useConversationSelection({
  invoke,mounted,settingsReady,editorDirty,confirmReplace,language:settings.language,
  beforeSelection(){openSeq.current++;deploymentOpening.current=null;setSkill(undefined);setAttentionTarget(undefined);setHistoryTarget(undefined);},
  clearIntent:()=>setAgentIntent(undefined),beginWorkerGate,observeWorker,
  onSelected:selected=>presentConversation(selected),
  onFreshSelected(){setAgentVisible(true);setPrimaryPanel('agent');setSection('home');},
  onSelectionError(error){setWorkerRestoring(false);onError(error);},onError
 });
 const activityByConversation=new Map(activityRows.map(row=>[activityKey(row),row]));
 const nextAttention=nextConversationAttention(activityRows,new Set(conversations.map(row=>row.id)),attentionTarget);
 async function openConversationAttention(owner:AttentionValue){
  if(deleting||modal&&modal!=='history')return;
  const id=activityKey(owner),selected=conversations.find(row=>row.id===id);
  if(!selected)return;
  if(modal==='history')setModal('');
  if(selectedConversationRef.current?.id!==id){
   const expected=conversationSelectionSeq.current+1;
   await chooseConversation(selected);
   if(!mounted.current||conversationSelectionSeq.current!==expected||selectedConversationRef.current?.id!==id)return;
  }
  setAgentVisible(true);setPrimaryPanel('agent');
  setAttentionTarget({...owner,nonce:crypto.randomUUID()});
  if(historyEnabled&&'receiptId' in owner.target)setHistoryTarget({conversationId:id,turnId:owner.target.turnId,...owner.target.itemId?{itemId:owner.target.itemId}:{},nonce:crypto.randomUUID()});
 }
 async function openHistoryLocation(target:ConversationAnchor){
  const conversation=conversations.find(row=>row.id===target.conversationId);
  if(!conversation){onError(t('此消息已无法定位。'));return;}
  if(modal==='history'){setModal('');setSearchHistoryBody(false);}
  if(selectedConversationRef.current?.id!==conversation.id){
   const expected=conversationSelectionSeq.current+1;
   await chooseConversation(conversation);
   if(!mounted.current||conversationSelectionSeq.current!==expected||selectedConversationRef.current?.id!==conversation.id)return;
  }
  setAgentVisible(true);setPrimaryPanel('agent');setHistoryTarget({...target,nonce:crypto.randomUUID()});
 }
 async function openDiscussion(conversation:Conversation){
  setConversations(previous=>[conversation,...previous.filter(value=>value.id!==conversation.id)]);
  await chooseConversation(conversation);
 }
 async function archiveConversation(conversation:Conversation){
  try{
   const updated=await conversationHistory.archive({id:conversation.id,archived:!conversation.archived});
   setConversations(previous=>previous.map(value=>value.id===updated.id?updated:value));
  }catch(error){onError(error);}
 }
 const computeResourceScope=agentProvider+'|'+conversationSelectionSeq.current+'|'+(sessionSelection?.nonce||'')+'|'+(selectedConversationId||'');resourceScopeRef.current=computeResourceScope;
 const selectedRecords=selectedRecordScope(computeResource,conversationSelectionSeq.current);
 const activeFlow=agentTasks.find(task=>task.id===selectedConversationRef.current?.taskId);
 const flowWorker=taskWorkerSource(activeFlow)?.binding;
 const projectToolResource=flowWorker?.kind==='ssh'?{profileId:flowWorker.profileId,profileVersion:flowWorker.profileVersion}:
  computeResource?.kind==='ssh-connection'&&computeResource.profileId&&computeResource.profileVersion?{profileId:computeResource.profileId,profileVersion:computeResource.profileVersion}:undefined;
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
 useEffect(()=>{
  if(!toolSetupReturn)return;
  const targetOpen=toolSetupReturn.destination==='scheduler'?computeChooser:['projects','project','project-edit'].includes(modal);
  if(toolSetupReturn.owner!==(selectedConversationId||undefined)||toolSetupReturn.scope!==resourceScopeRef.current){
   if(targetOpen){if(toolSetupReturn.destination==='scheduler')setComputeChooser(false);else setModal('');}
   setToolSetup(null);setToolSetupReturn(null);return;
  }
  if(!targetOpen){setToolSetupReturn(null);requestAnimationFrame(()=>{
   const opener=toolSetupReturn.opener;
   if(toolSetupReturn.scope!==resourceScopeRef.current)return;
   if(opener?.isConnected&&opener.getClientRects().length&&!opener.matches(':disabled'))opener.focus({preventScroll:true});
   else document.querySelector<HTMLElement>('.resource-tool-setup [aria-pressed="true"]')?.focus({preventScroll:true});
  });}
 },[toolSetupReturn,computeChooser,modal,selectedConversationId,computeResourceScope]);
 const {focus:toolWorkflowFocus,open:openToolWorkflow}=useToolWorkflowNavigation({mounted,selected:selectedConversationRef,selectionSequence:conversationSelectionSeq,navigationSequence:openSeq,busy:false,conversations,chooseConversation,onError,onOpen:location=>{setPrimaryPanel('workspace');setSelected(null);setSection('agent-task:'+location.task_id);}});
 useEffect(()=>window.studio?.onEvent(event=>{
  if(event.method==='studio/openManagedAttention'&&event.params?.id&&event.params.sourceId&&event.params.scheduleId)openNoticeRef.current(event.params);
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
  if(event.method==='studio/conversationUpdated'){
   const {conversation,titleOnly,organizationOnly}=event.params;
   setConversations(old=>(titleOnly||organizationOnly)&&old.some(c=>c.id===conversation.id)?old.map(c=>c.id===conversation.id?conversation:c):[conversation,...old.filter(c=>c.id!==conversation.id)]);
   const previous=selectedConversationRef.current;
   if(previous&&previous.id===conversation.id){
    selectedConversationRef.current=conversation;
    if(!titleOnly&&!organizationOnly){setProjectId(current=>followedProjectId(current,previous.projectId,conversation.projectId));void refresh();}
   }
  }
  if(event.method==='studio/taskUpdated'){const task=event.params.task;setAgentTasks(old=>[task,...old.filter(t=>t.id!==task.id)]);if(event.params.showFlow&&task.threadId===selectedConversationRef.current?.threadId&&task.provider===selectedConversationRef.current?.provider)setSection('agent-task:'+task.id);}
 }),[]);
 projectPolicyOwner.current={worker:worker&&!disconnected,projectId,selection:conversationSelectionSeq.current,modal,saving:busy};
 const project=projects.find(p=>p.id===projectId),selectedRun=runs.find(r=>r.id===selected);
 const runProjectId=computeProjectForSelection(projectId,agentTasks.find(task=>task.id===selectedConversationRef.current?.taskId));
 const runProject=projects.find(p=>p.id===runProjectId);
 const trainingRuns=runs.filter(run=>(!runProjectId||run.project_id===runProjectId)&&/^(nep|hotpp)\./.test(run.engine));
 const projectAssets=assets.filter(asset=>'project_id' in asset&&asset.project_id===projectId);
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
  const handle=(event:KeyboardEvent)=>shortcutHandler.current(event);
  document.addEventListener('keydown',handle,true);return()=>{cancelAnimationFrame(interactiveFrame);disposed=true;mounted.current=false;workerHydrationEpoch.current++;workerReady.current=false;finishSettings.current();document.removeEventListener('keydown',handle,true);};
 },[]);
 useEffect(()=>{
  document.documentElement.dataset.theme=settings.theme;
  document.documentElement.lang=settings.language||'zh-CN';
  const fonts:Record<string,string>={
   system:'-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif',
   sans:'"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif',
   serif:'Georgia, "Songti SC", "SimSun", serif',
  };
  const fontSize=bounded(settings.fontSize,12,24,18);
  document.documentElement.style.setProperty('--ui-font',fonts[settings.fontFamily||'system']||fonts.system);
  document.documentElement.style.setProperty('--ui-min-font',bounded(settings.minimumFontSize,11,18,recommendedMinimumFontSize)+'px');
  document.documentElement.style.setProperty('--chat-font-size',bounded(settings.chatFontSize||settings.fontSize,12,28,18)+'px');
  document.documentElement.style.setProperty('--ui-scale',String(fontSize/13));
  document.documentElement.style.setProperty('--editor-font-size',String(bounded(settings.editorFontSize,10,28,18)));
  document.documentElement.style.setProperty('--terminal-font-size',String(bounded(settings.terminalFontSize,10,24,17)));
  window.dispatchEvent(new Event('studio:appearance'));
 },[settings]);
 useEffect(()=>{setRunJson(JSON.stringify(runDraft,null,2));},[runDraft]);
 useEffect(()=>{writePreference('studio.section',section);},[section]);
 useEffect(()=>{if(!worker)return;let disposed=false;const refreshGpu=()=>{if(gpuLoading.current||(sourceFailures.current.get('/api/gpu')||0)>=3)return;gpuLoading.current=true;const generation=sourceGeneration.current;void api<any[]>('GET','/api/gpu').then(value=>{if(disposed||generation!==sourceGeneration.current)return;sourceFailures.current.delete('/api/gpu');setGpuStale(false);setGpuStatus(value);}).catch(()=>{if(!disposed&&generation===sourceGeneration.current){sourceFailures.current.set('/api/gpu',(sourceFailures.current.get('/api/gpu')||0)+1);setGpuStale(true);}}).finally(()=>{if(!disposed)gpuLoading.current=false;});};refreshGpu();const timer=setInterval(refreshGpu,5000);return()=>{disposed=true;gpuLoading.current=false;clearInterval(timer);};},[worker]);
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
  if(manual)void invoke('compute.managed.refresh',{}).catch(onError);
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
 async function connectWorker(taskId=selectedConversationRef.current?.taskId){const binding=taskWorkerSource(agentTasks.find(task=>task.id===taskId))?.binding,resource=computeResourceRef.current;if(binding?.kind==='ssh'||!binding&&isActiveSshResource(resource)){setWorkerNotice('请恢复此流程原有的 SSH 连接，登录后接入作业服务。');setPrimaryPanel('workspace');showTerminal();if(isActiveSshResource(resource)&&(!binding||resource?.profileId===binding.profileId&&resource?.profileVersion===binding.profileVersion)){/* Reuse the already-open terminal; never open another authentication process. */}else setComputeChooser(true);return;}const sequence=conversationSelectionSeq.current,conversation=selectedConversationRef.current,current=()=>mounted.current&&sequence===conversationSelectionSeq.current&&conversation?.id===selectedConversationRef.current?.id;try{const pending=freshSelectionPending.current;if(pending?.sequence===sequence){await pending.promise;if(!current())return;taskId=selectedConversationRef.current?.taskId;}if(!binding&&resource?.selectionId&&!isActiveSshResource(resource)){await computeResources.clear(resource.selectionId).then(cleared=>{if(current())acceptComputeResource(cleared);}).catch(()=>{});if(!current())return;}const connected=await openComputeGuide(taskId);if(!connected||!current())return;const state=await invoke<{settings:Settings}>('state');if(!current())return;setSettings(state.settings);settingsKnown.current=true;await observeWorker(taskId,true);}catch(error){if(current())onError(error);}}
 async function connectAndBindDraft(taskId:string){
  const conversation=selectedConversationRef.current;if(agentBusy||conversation?.taskId!==taskId)return;
  const sequence=conversationSelectionSeq.current,epoch=beginWorkerGate();explicitConnection.current=epoch;setConnecting(true);
  const current=()=>mounted.current&&epoch===workerHydrationEpoch.current&&sequence===conversationSelectionSeq.current&&selectedConversationRef.current?.id===conversation.id;
  try{const status=await readWorkerStatus();if(!current())return;if(status.status!=='connected'){if(!await openComputeGuide(taskId)||!current())return;}settingsKnown.current=true;const task=await invoke('task.authoring.bindWorker',{taskId});if(!current())return;setAgentTasks(old=>[task,...old.filter(value=>value.id!==taskId)]);if(!await observeWorker(taskId)||selectedConversationRef.current?.id!==conversation.id)return;setSessionSelection({nonce:crypto.randomUUID(),conversation});}
  catch(error){if(current()){setWorkerRestoring(false);onError(error);}}
  finally{if(explicitConnection.current===epoch){explicitConnection.current=null;setConnecting(false);}}
 }
 function newProject(){setModal('project');}
 async function toolProjectRequest<T>(method:'GET'|'POST',data?:unknown){
  const access=toolSetupReturn,expected=access?.workerScope;
  if(expected){
   const selected=computeResourceRef.current;
   if(!mounted.current||access.scope!==resourceScopeRef.current||!workerReady.current||selected?.kind!=='ssh-connection'||selected.status!=='selected'||
    selected.connectionId!==expected.connectionId||selected.profileId!==expected.profileId||selected.profileVersion!==expected.profileVersion)throw Error('project_edit_unavailable');
  }
  return api<T>(method,'/api/projects',data,expected);
 }
 function policyError(value:unknown){const code=errorText(value),messages:Record<string,string>={project_edit_authoring_only:'草稿工作区不能通过此入口升级计算授权。',project_edit_unavailable:'项目、会话或计算连接已变化，请关闭后重新打开。',project_edit_record_invalid:'无法读取此计算项目的完整记录。',project_edit_conflict:'项目记录已变化，请关闭后重新打开并检查最新授权。',project_edit_invalid_fields:'授权字段无效，请检查表单。',project_edit_no_changes:'尚无变更',project_edit_busy:'保存中，请稍候。',project_edit_save_mismatch:'保存返回与原项目不一致，请重新读取实际项目状态。',project_edit_save_unconfirmed:'保存结果未能确认，可能已写入；请关闭后核对实际项目，不要假定已撤销。'};return t(messages[code]||code);}
 function closeProjectPolicy(){if(projectPolicyOwner.current.saving)return;projectPolicySeq.current++;projectPolicyEdit?.cancel();setProjectPolicyEdit(null);setProjectPolicyInitial(null);setProjectPolicyError('');setModal('');}
 async function editProjectPolicy(record:Project){
  if(!worker||disconnected||record.authoring_only){onError(t('草稿工作区不能通过此入口升级计算授权。'));return;}
  const seq=++projectPolicySeq.current,selectedProject=projectId,selection=conversationSelectionSeq.current,epoch=projectPolicyWorkerEpoch.current;
  projectPolicyEdit?.cancel();setProjectPolicyInitial(null);setProjectPolicyError('');setProjectPolicyId(record.id);setModal('project-edit');projectPolicyOwner.current={...projectPolicyOwner.current,modal:'project-edit'};
  const current=()=>{const owner=projectPolicyOwner.current;return seq===projectPolicySeq.current&&owner.worker&&owner.modal==='project-edit'&&owner.projectId===selectedProject&&owner.selection===selection&&projectPolicyWorkerEpoch.current===epoch;};
  const editor=createProjectPolicyEditor({projectId:record.id,engines:engines.map(([id])=>id),current,read:()=>toolProjectRequest<Project[]>('GET'),write:value=>toolProjectRequest<Project>('POST',value)});setProjectPolicyEdit(editor);
  try{const opened=await editor.open();if(current())setProjectPolicyInitial(opened.spec);}catch(error){if(seq===projectPolicySeq.current)setProjectPolicyError(policyError(error));}
 }
 async function saveProjectPolicy(spec:ProjectAuthorizationSpec){
  if(!projectPolicyEdit)return;setBusy(true);projectPolicyOwner.current={...projectPolicyOwner.current,saving:true};
  try{const saved=await projectPolicyEdit.save(spec);setProjects(old=>old.map(project=>project.id===saved.id?saved:project));setProjectPolicyEdit(null);setProjectPolicyInitial(null);setModal('projects');}
  catch(error){throw Error(policyError(error));}finally{projectPolicyOwner.current={...projectPolicyOwner.current,saving:false};setBusy(false);}
 }

 function projectLabel(value:Project){return value.authoring_only?(agentTasks.find(task=>task.id===value.authoring_task_id)?.name||value.name):value.name;}
 function newEnvironment(){
  environmentEditorRevision.current++;
  setEnvironmentDraft(JSON.stringify({name:'WSL 科学环境',executables:{python:'/usr/bin/python3'},repositories:{},variables:{}},null,2));setEnvironmentJsonError('');setModal('environment');
 }
 async function saveEnvironment(){
  if(busy)return;
  let spec:unknown;
  try{spec=JSON.parse(environmentDraft);}catch{setEnvironmentJsonError(t('JSON 语法有误。'));return;}
  const revision=environmentEditorRevision.current,epoch=workerHydrationEpoch.current;
  setBusy(true);
  try{
   const saved=await api<Environment>('POST','/api/environments',spec);
   if(!mounted.current||workerHydrationEpoch.current!==epoch)return;
   if(environmentEditorRevision.current===revision)setModal(current=>current==='environment'?'':current);
   void refresh();
   if(saved?.id)showToast({severity:'success',message:t('计算环境已登记。')});
  }catch(error){if(mounted.current&&workerHydrationEpoch.current===epoch)onError(error);}
  finally{if(mounted.current)setBusy(false);}
 }
 function makeRun(engine:string){
  const inputs=engine.startsWith('gpumd')?{'run.in':'','model.xyz':''}:engine.startsWith('pydyn')?{'run.py':''}:engine==='nep.eval'?{'nep.in':'','train.xyz':'','nep.txt':''}:engine==='nep.train'?{'nep.in':'','train.xyz':'','test.xyz':''}:engine==='hotpp.train'?{'input.yaml':''}:engine==='pygas.build'?{'build_bias.py':''}:{};
  return {name:engines.find(e=>e[0]===engine)?.[1],engine,project_id:projectId,environment_id:project?.policy.environments[0]||environments[0]?.id||'',gpu:project?.policy.gpus[0]??0,max_seconds:Math.min(3600,project?.policy.max_seconds??3600),idempotency_key:crypto.randomUUID(),inputs,parameters:{}};
 }
 function newRun(engine='gpumd.md'){
  setRunDraft(makeRun(engine));setRunJsonError('');setModal('run');
 }
 function changeEngine(engine:string){
  setRunDraft((old:any)=>({...makeRun(engine),environment_id:old.environment_id,gpu:old.gpu,max_seconds:old.max_seconds}));
 }
 const runDirty=modal==='run'&&runJson!==JSON.stringify(runDraft,null,2);
 function applyRunJson(){
  let value:unknown;
  try{value=JSON.parse(runJson);}catch{setRunJsonError('JSON 语法有误。');return;}
  if(!value||typeof value!=='object'||Array.isArray(value)){setRunJsonError('请填写 JSON 对象。');return;}
  setRunDraft(value);setRunJson(JSON.stringify(value,null,2));setRunJsonError('');
 }
 async function confirmReplace(replacing=false){
  if(!editorDirtyRef.current)return true;
  const snapshot=editorLatest.current,sequence=openSeq.current,previousSection=sectionRef.current;
  const accepted=await confirm({
   title:t(replacing?'替换编辑器内容':'离开编辑器'),
   target:snapshot.path||snapshot.name||t('未保存的源码'),
   consequence:t(replacing?'打开另一个文件会替换编辑器中未保存的内容。':'离开前的修改尚未写入文件。'),
   confirmLabel:t(replacing?'替换内容':'离开'),
   testId:'confirm-editor-replace',
  });
  return accepted&&mounted.current&&editorLatest.current===snapshot&&openSeq.current===sequence&&sectionRef.current===previousSection;
 }
 async function openEditorFile(){
  if(editorOpening.current)return;
  editorOpening.current=true;
  const sequence=openSeq.current,previousSection=sectionRef.current;
  const current=()=>mounted.current&&openSeq.current===sequence&&sectionRef.current===previousSection;
  try{
   const file=await invoke('file.open');
   if(!file||!current()||!await confirmReplace(true)||!current())return;
   setEditor({...file,source:file.content});setEditorLineRange(null);setEditorDirty(false);setSection('editor');
  }catch(error){if(current())onError(error);}
  finally{editorOpening.current=false;}
 }
 async function saveInput(mode:'project'|'windows'='project'){
  if(editorSaving.current)return;editorSaving.current=true;setEditorSave(mode);
  const snapshot=editorLatest.current,epoch=workerHydrationEpoch.current,selectedProject=projectId;
  const current=()=>mounted.current&&editorLatest.current.id===snapshot.id&&editorLatest.current.name===snapshot.name&&editorLatest.current.source===snapshot.source;
  try{
   if(mode==='windows'){
    const result=await invoke('file.save',{id:snapshot.id,content:snapshot.source,name:snapshot.name});
    if(result&&current()){
     setEditor(previous=>({...previous,...result}));setEditorDirty(false);
     if(result.path)showToast({severity:'success',message:t('文件已保存。'),testId:'editor-save-feedback'});
    }
    return result?.path;
   }
   if(!project)throw Error('先选择或创建项目');
   const result=await api('POST','/api/workspace/write',{project_id:selectedProject,name:snapshot.name,content:snapshot.source});
   if(current()&&epoch===workerHydrationEpoch.current&&projectPolicyOwner.current.projectId===selectedProject){
    setEditor(previous=>({...previous,id:result.evidenceId||'',path:result.path}));setEditorDirty(false);
    if(result.path)showToast({severity:'success',message:t('文件已保存。'),testId:'editor-save-feedback'});
   }
   return result.path;
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
 function draftForTerminalHandoff(provider:AgentProvider){
  if(!mounted.current||freshSelectionPending.current||selectedConversationRef.current?.threadId)return undefined;
  return terminalDraft.current?.(provider);
 }
 function terminalConversationPrepared(conversation:Conversation,adoptedDraftId?:string){
  if(!mounted.current||freshSelectionPending.current||selectedConversationRef.current?.threadId)return;
  conversationSelectionSeq.current++;openSeq.current++;deploymentOpening.current=null;setSkill(undefined);setAgentIntent(undefined);beginWorkerGate();
  conversationChanged(conversation);setAgentProvider(conversation.provider);presentConversation(conversation,true);
  setSessionSelection({nonce:crypto.randomUUID(),conversation,...adoptedDraftId?{adoptedDraftId}:{}});void observeWorker(conversation.taskId);
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
 async function go(id:string){
  if(sectionRef.current==='editor'&&id!=='editor'&&editorDirtyRef.current&&!await confirmReplace())return false;
  conversationSelectionSeq.current++;deploymentOpening.current=null;setPrimaryPanel('workspace');openSeq.current++;sectionRef.current=id;setSection(id);setSelected(id.startsWith('task:')?id.slice(5):null);
  return true;
 }
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
  setLesson(null);if(lesson?.destination==='resource-tools')setToolSetup(null);if(!guidePage)setGuidePage('welcome');else requestAnimationFrame(()=>{const anchor=lessonOpener.current;
   (anchor?.isConnected&&anchor.getClientRects().length?anchor:document.getElementById('setup-heading'))?.focus({preventScroll:true});lessonOpener.current=null;
  });
  const revision=settingsRevision.current;
  void invoke<{settings:Settings}>('state').then(state=>{
   if(!mounted.current||revision!==settingsRevision.current||!state?.settings)return;
   setLanguage(state.settings.language||'zh-CN');setSettings(state.settings);
  }).catch(onError);
 }
 function connectFromGuide(kind:'wsl'|'ssh'){
  if(kind==='wsl'&&!isActiveSshResource(computeResource)&&!selectedConversationRef.current?.taskId){openLocalCompute();return;}
  lessonOpener.current=document.activeElement as HTMLElement|null;
  setGuideKind(kind);setComputeChooserEdit(undefined);setComputeChooser(true);
 }
 function rememberCluster(target:Pick<ClusterGuideProgress,'profileId'|'profileVersion'|'name'>,step:ClusterGuideProgress['step'],route?:ResourceToolRoute){
  const previous=readClusterGuide(target),value={profileId:target.profileId,profileVersion:target.profileVersion,name:target.name,step,route:route||previous?.route};
  storeClusterGuide(value);setClusterGuide(value);return value;
 }
 function guideTarget(){
  if(guidePage&&clusterGuide)return clusterGuide;
  const selected=computeResourceRef.current;
  if(selected?.kind==='ssh-connection'&&selected.profileId&&selected.profileVersion){
   const resource=managed.resources.find(row=>row.profileId===selected.profileId&&row.profileVersion===selected.profileVersion);
   return {profileId:selected.profileId,profileVersion:selected.profileVersion,name:resource?.name||selected.profileId};
  }
  if(terminalRequest?.kind==='ssh'&&terminalRequest.profileId&&terminalRequest.version)return {profileId:terminalRequest.profileId,profileVersion:terminalRequest.version,name:terminalRequest.profileName||terminalRequest.profileId};
  return clusterGuide;
 }
 async function visitFromGuide(destination:SetupVisit,shortCase?:string,source?:SetupLessonLocation['source']){
  lessonOpener.current=document.activeElement as HTMLElement|null;
  const english=settings.language==='en',provider=settingsRef.current.agentProvider||'codex';
  switch(destination){
   case 'model-test': {
    const message=english?'Reply with OK to test this model connection.':'请回复 OK，测试这条模型连接。';
    if(await newConversation(false,message,provider))setLesson({destination});
    break;
   }
   case 'tour-goal': {
    const target=guideTarget();if(target)rememberCluster(target,'tour-goal');
    const goal=english?'I want to run a short molecular dynamics simulation of FCC copper and inspect its temperature and trajectory. List the structure, potential and compute environment I need, then draft a workflow for me to review.':
      '我想对面心立方铜做一次分子动力学短试算，观察温度和轨迹。请先列出需要的结构、势模型和计算环境，再给我一份待核对的流程草稿。';
    if(await newConversation(true,goal,provider))setLesson({destination,...source?{source}:{}});
    break;
   }
   case 'resource-tools': {
    const target=guideTarget(),route=['fresh','existing','custom'].includes(shortCase||'')?shortCase as ResourceToolRoute:undefined;
    if(target){rememberCluster(target,destination,route);setLesson({destination});setToolSetup({profileId:target.profileId,profileVersion:target.profileVersion,name:target.name,route});}
    else if(await go('compute-resources'))setLesson({destination});
    break;
   }
   case 'ssh-terminal-practice': {
    const target=guideTarget();
    if(!target){connectFromGuide('ssh');break;}
    rememberCluster(target,destination);setLesson({destination});
    const text=english?`Use resource ssh:${target.profileId} (${target.name}, saved version ${target.profileVersion}). Verify its registered workspace and list the workfile directory. If authorized, write a new practice note named aimatterlab-guide-${crypto.randomUUID().slice(0,8)}.txt under workfile and report its actual absolute path. Use the existing connection. Do not submit a job.`:
     `请使用资源 ssh:${target.profileId}（${target.name}，已保存版本 ${target.profileVersion}）。核对已登记的总工作区并列出 workfile 目录。若有此权限，请在 workfile 下写一个新的练习笔记 aimatterlab-guide-${crypto.randomUUID().slice(0,8)}.txt，报告实际绝对路径。沿用原连接，不提交作业。`;
    askAgent(text);break;
   }
   case 'resume-cluster': {
    if(!clusterGuide){connectFromGuide('ssh');break;}
    const target=clusterGuide;
    if(target.step==='resource-tools'){setLesson({destination:target.step});setToolSetup({profileId:target.profileId,profileVersion:target.profileVersion,name:target.name,route:target.route});}
    else if(target.step==='ssh-service'){configureTerminalSsh({profileId:target.profileId,profileVersion:target.profileVersion,section:'service'});}
    else if(target.step==='ssh-login'){connectFromGuide('ssh');}
    else {await visitFromGuide(target.step);}
    break;
   }
   case 'short-check': {
    const check=english?`Use studio-install-readiness to prepare the installation check ${shortCase}. Use the selected resource and registered environment. Show me the inputs and resources before running.`:
      `请按 studio-install-readiness 准备安装短例 ${shortCase}。沿用所选计算资源和已登记环境，先给我看输入和资源，再决定执行。`;
    if(await newConversation(true,check,provider))setLesson({destination,shortCase});
    break;
   }
   default: if(await go(destination))setLesson({destination,...source?{source}:{}});
  }
 }
 function openSettings(){settingsBackup.current=settings;settingsWorkerReady.current=workerReady.current;setModal('settings');}
 function openAccounts(provider:AgentProvider=agentProvider){setAccountsProvider(provider);setModal('accounts');}
 async function renameConversation(){if(!renameTarget||renaming)return;setRenaming(true);try{const value=await invoke<Conversation>('conversation.rename',{id:renameTarget.id,name:conversationName});setConversations(old=>old.map(c=>c.id===value.id?value:c));setRenameTarget(null);}catch(error){onError(error);}finally{setRenaming(false);}}
 function openComputeResources(){setGuideKind(undefined);if(modal==='settings'){if(settingsSavingRef.current)return;closeSettings();}setComputeChooser(true);}
 async function openComputeConsole(){
  if(modal==='settings'&&settingsSavingRef.current||!await go('compute-resources'))return;
  if(modal==='settings')closeSettings();
  setGuideKind(undefined);setComputeChooser(false);setComputeChooserEdit(undefined);
 }
 function connectConsoleSsh(resource:ComputeConsoleResource){
  setPrimaryPanel('workspace');setTerminalRequest({nonce:crypto.randomUUID(),kind:'ssh',mode:resource.mode||'interactive',
    profileId:resource.profileId,version:resource.profileVersion,profileName:resource.name,connectionMode:'managed'});showTerminal();
 }
 function openConsoleTerminal(resource:ComputeConsoleResource|null,terminal?:ComputeConsoleTerminal){
  if(!resource?.connectionId&&!terminal)return;
  const profileId=resource?.profileId??terminal?.profileId,version=resource?.profileVersion??terminal?.profileVersion;
  setPrimaryPanel('workspace');setTerminalRequest({nonce:crypto.randomUUID(),kind:terminal?.kind||'ssh',
    mode:terminal?.mode||resource?.mode||'interactive',profileId,version,profileName:resource?.name,
    connectionId:resource?.connectionId||undefined,sessionId:terminal?.sessionId,connectionMode:resource?.connectionId?'managed':'plain',exact:true});showTerminal();
 }
 function openConsoleWorkspace(resource:ComputeConsoleResource,mode:'handoff'|'change'){
  if(!resource.connectionId)return;
  const observed=resource.terminals.filter(value=>value.owner==='human'&&value.status==='online');
  const sessionId=terminalRequest?.connectionId===resource.connectionId?terminalRequest.sessionId:observed.length===1?observed[0].sessionId:undefined;
  setPrimaryPanel('workspace');setTerminalRequest({nonce:crypto.randomUUID(),kind:'ssh',mode:resource.mode||'interactive',profileId:resource.profileId,version:resource.profileVersion,profileName:resource.name,connectionId:resource.connectionId,sessionId,connectionMode:'managed',exact:true,reviewWorkspace:mode});showTerminal();
 }
 async function usePublishedWorkflow(ref:ResourceWorkspaceReference){
  const owner=selectedConversationRef.current,sequence=conversationSelectionSeq.current,prior=taskWorkerSource(owner?.taskId?agentTasks.find(task=>task.id===owner.taskId):undefined)?.binding;
  if(prior&&(prior.kind!=='ssh'||prior.profileId!==ref.profileId||prior.profileVersion!==ref.profileVersion))throw Object.assign(Error(t('此流程已绑定其他计算资源。请打开原资源，或为此资源新建流程。')),{code:'ssh_service_workflow_target_changed'});
  const result=await invoke<SshServiceState>('compute.managed.useForWorkflow',ref);
  const current=()=>mounted.current&&sequence===conversationSelectionSeq.current&&selectedConversationRef.current?.id===owner?.id;
  if(!current())return {status:'unconfirmed' as const};
  if(result?.connectionId!==ref.connectionId||result.profileId!==ref.profileId||result.profileVersion!==ref.profileVersion)throw Error('ssh_service_workflow_unconfirmed');
  if(result.status!=='connected'||result.workflowReady!==true)throw Error(result.error?.code||'ssh_service_workflow_unconfirmed');
  const selected=await computeResources.status();
  if(!current()||selected.status!=='selected'||selected.connectionId!==ref.connectionId||selected.profileId!==ref.profileId||selected.profileVersion!==ref.profileVersion)return {status:'unconfirmed' as const};
  acceptComputeResource(selected);await observeWorker(owner?.taskId,true);
  return result;
 }
 function openResourceTools(resource:ComputeConsoleResource){
  if(lesson?.destination==='resource-tools')rememberCluster(resource,'resource-tools');
  setToolSetup({profileId:resource.profileId,profileVersion:resource.profileVersion,name:resource.name});
 }
 function openResourceGuide(resource:ComputeConsoleResource){
  const previous=readClusterGuide(resource);
  rememberCluster(resource,previous?.step||(resource.service.status==='online'?'resource-tools':resource.managedId?'ssh-service':'ssh-login'));
  setLesson(null);setGuidePage('compute');
 }
 function openMissingResourceTool(task:any,tool:string){
  const binding=taskWorkerSource(task)?.binding,chat=selectedConversationRef.current;
  if(binding?.kind!=='ssh'||!chat||chat.provider!==task.provider||chat.threadId!==task.threadId)return;
  const resource=managed.resources.find(row=>row.profileId===binding.profileId&&row.profileVersion===binding.profileVersion);
  setWorkflowToolQuestion(previous=>previous?.taskId===task.id?null:previous);
  setToolSetup({profileId:binding.profileId,profileVersion:binding.profileVersion,name:resource?.name||binding.profileId,missing:tool,taskId:task.id,conversationId:chat.id});
 }
 function askAboutMissingWorkflowTool(task:any,tool?:string){
  const binding=taskWorkerSource(task)?.binding,chat=selectedConversationRef.current;
  if(binding?.kind!=='ssh'||!chat||chat.provider!==task.provider||chat.threadId!==task.threadId||chat.taskId!==task.id)return;
  if(!tool){setWorkflowToolQuestion(previous=>previous?.taskId===task.id?null:previous);return;}
  setWorkflowToolQuestion({id:crypto.randomUUID(),taskId:task.id,workflowRevision:toolQuestionRevision(task),provider:chat.provider,threadId:chat.threadId,profileId:binding.profileId,profileVersion:binding.profileVersion,tool});
  setAgentVisible(true);if(singlePanel)setPrimaryPanel('agent');
 }
 function closeResourceTools(activated=false){
  setToolSetup(null);
  if(activated&&toolSetup?.taskId&&toolSetup.conversationId===selectedConversationRef.current?.id){setToolSetupRevision(crypto.randomUUID());void refresh();}
 }
 function configureResourceToolTarget(kind:'scheduler'|'project'){
  if(!toolSetup)return;
  const target=toolSetup,selected=computeResourceRef.current;
  const original=taskWorkerSource(activeFlow)?.binding;
  const exact={profileId:target.profileId,profileVersion:target.profileVersion};
  const workerScope=kind==='project'&&selected?.kind==='ssh-connection'&&selected.status==='selected'&&selected.authentication==='verified'&&
   selected.profileId===target.profileId&&selected.profileVersion===target.profileVersion&&selected.connectionId&&workerReady.current&&
   (!original||original.kind==='ssh'&&original.profileId===target.profileId&&original.profileVersion===target.profileVersion)?{...exact,connectionId:selected.connectionId}:undefined;
  setToolSetupReturn({destination:workerScope?'project':'scheduler',owner:selectedConversationRef.current?.id,scope:resourceScopeRef.current,opener:document.activeElement as HTMLElement|null,workerScope});
  setToolSetupTargetDefaults(old=>old?.profileId===exact.profileId&&old.profileVersion===exact.profileVersion?old:exact);
  void resourceWorkspaces.read(exact).then(value=>{
   if(mounted.current&&value.status==='confirmed'&&value.profileId===exact.profileId&&value.profileVersion===exact.profileVersion)setToolSetupTargetDefaults(old=>old?.profileId===exact.profileId&&old.profileVersion===exact.profileVersion?{...old,root:value.directories[0]}:old);
  }).catch(()=>{});
  if(workerScope){openProjects();return;}
  configureTerminalSsh({...exact,section:'service'});
 }
 function rememberToolScheduler(value:{id:string}){
  const edit=computeChooserEdit;
  if(edit)setToolSetupTargetDefaults(old=>old?.profileId===edit.profileId&&old.profileVersion===edit.profileVersion?{...old,schedulerId:value.id}:old);
 }
 function discussResourceTool({route,tool,directory,candidate,target:queue,description,source,setupIds}:ResourceToolDiscussion){
  if(!toolSetup)return;
  const instructions={fresh:'Prepare a pinned acquisition and minimal test for a new tool.',existing:'Use discover_resource_tool_scripts for a read-only scan and representative-script review when the directory is supplied. I will choose the script.',custom:'Prepare a private manifest for my program with its source, environment, execution interface, input/output and minimal test.'};
  const zh={fresh:'为新工具准备指定版本的获取方案与最小测试。',existing:'在已知目录时用 discover_resource_tool_scripts 只读分类扫描已有脚本，由我核对并选择代表脚本。',custom:'为我的程序准备私有清单，涵盖来源、环境、运行接口、输入输出和最小测试。'};
  const target=`${toolSetup.name} · ssh:${toolSetup.profileId} · v${toolSetup.profileVersion}`;
  const details=JSON.stringify({tool,directory,candidate,queue,description,source},null,2);
  const text=settings.language==='en'?`Use this exact compute resource: ${target}. ${instructions[route]} Read the resource tool setup guidance, use list_resource_tools for available targets, and save a reviewed draft through plan_resource_tool_setup for route ${route}. I will review it in tool setup before any installation or test.\n${details}`:
   `使用这个计算资源 ${target}。${zh[route]}请读工具配置指导，用 list_resource_tools 核对可用的测试目标，再按 ${route} 路线用 plan_resource_tool_setup 保存待核对草稿。回到工具配置由我审阅后再安装或测试。\n${details}`;
  setToolSetupReview({...toolSetup,route,newPlanAfter:setupIds,conversationId:selectedConversationRef.current?.id,selectionSeq:conversationSelectionSeq.current,provider:agentProvider});
  closeResourceTools();askAgent(text,toolSetup.taskId);
 }
 function acceptConversationWithToolPlan(value:Conversation|null,nonce?:string){
  acceptAgentConversation(value,nonce);
  if(value)setToolSetupReview(previous=>previous&&!previous.conversationId&&previous.provider===value.provider&&previous.selectionSeq===conversationSelectionSeq.current?{...previous,conversationId:value.id}:previous);
 }
 async function openConsoleConversation(channel:ComputeConsoleChannel){
  const sequence=openSeq.current;
  try{
   const values=await invoke<Conversation[]>('conversation.list');
   if(!mounted.current||sequence!==openSeq.current)return;
   const chat=values.find(row=>row.id===channel.conversationId&&row.provider===channel.provider&&row.threadId===channel.threadId);
   if(!chat)throw Error(t('资源或会话已变化，请刷新后重试。'));
   await chooseConversation(chat);
  }catch(error){if(mounted.current&&sequence===openSeq.current)onError(error);}
 }
 async function connectSavedLocal(profile:WslComputeProfile){
  if(explicitConnection.current!==null)return;
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

 function connectSavedSsh(profile:SshComputeProfile,options?:{plain?:boolean}){
  if(guideShowing){rememberCluster({profileId:profile.id,profileVersion:profile.version,name:profile.name},'ssh-login');setLesson({destination:'ssh-login'});}
  setGuideKind(undefined);setComputeChooser(false);setComputeChooserEdit(undefined);setPrimaryPanel('workspace');
  const connectionId=options?.plain?undefined:savedSshChoice(profile,computeResourceRef.current,managed.resources,managedPending).connectionId;
  setTerminalRequest({nonce:crypto.randomUUID(),kind:'ssh',mode:profile.mode,profileId:profile.id,version:profile.version,profileName:profile.name,
   ...(connectionId?{connectionId}:{}),connectionMode:options?.plain?'plain':'managed'});
  showTerminal();
 }
 function configureTerminalSsh(ref?:{profileId:string;profileVersion:number;section?:'service'|'environment'},connectionId?:string,sessionId?:string){setComputeChooserEdit(ref?{...ref,connectionId,sessionId,nonce:crypto.randomUUID()}:undefined);setComputeChooser(true);}
 function observeSavedSshProfile(profile:ComputeProfile,previousVersion:number){
  const origin=terminalRequest,edit=computeChooserEdit;
  if(profile.kind!=='ssh'||profile.version===previousVersion||edit?.profileId!==profile.id||edit.profileVersion!==previousVersion||!edit.connectionId||origin?.profileId!==profile.id||origin.version!==previousVersion)return;
  const connectionId=edit.connectionId;
  void sshConnections.state({connectionId}).then(value=>{
   if(!mounted.current||value.connectionId!==connectionId||value.status!=='authenticated'||value.authentication!=='verified'||value.profileId!==profile.id||value.profileVersion!==profile.version)return;
   const sessionId=edit.sessionId||origin.sessionId;
   setTerminalRequest(current=>current?.nonce===origin.nonce?{...current,nonce:crypto.randomUUID(),connectionId,sessionId,version:profile.version,profileName:profile.name,reviewWorkspace:undefined,exact:true}:current);
  }).catch(onError);
 }
 function openCurrentServiceUpdate(expected:NonNullable<ReturnType<typeof selectedRecordScope>>){
  const value=computeResourceRef.current,observed=recordServiceRef.current;
  if(value?.kind!=='ssh-connection'||value.status!=='selected'||value.authentication!=='verified'||typeof value.profileId!=='string'||typeof value.profileVersion!=='number'||observed.phase!=='ready'||observed.serviceVersion!=='different'||observed.scopeKey!==expected.key||selectedRecordScope(value,conversationSelectionSeq.current)?.key!==expected.key)return;
  configureTerminalSsh({profileId:value.profileId,profileVersion:value.profileVersion,section:'service'});
 }
 function openLocalCompute(){if(modal==='settings'){if(settingsSavingRef.current)return;closeSettings();}setComputeChooser(false);void connectWorker();}
 async function openSshConfiguration(){setGuideKind(undefined);if(modal==='settings'){if(settingsSavingRef.current)return;closeSettings();}setComputeChooser(false);if(await go('ssh')&&guideShowing)setLesson({destination:'ssh-settings'});}
 function openProjects(){if(modal==='settings'){if(settingsSavingRef.current)return;closeSettings();}setModal('projects');}
 function closeSettings(){if(settingsSavingRef.current)return;const backup=settingsBackup.current,wasReady=settingsWorkerReady.current;settingsBackup.current=null;settingsWorkerReady.current=false;if(backup){setSettings(backup);setLanguage(backup.language||'zh-CN');}setModal('');if(wasReady&&!workerReady.current)void observeWorker();}
 function openDeployment(taskId:string):Promise<void>{
  if(deploymentOpening.current?.taskId===taskId)return deploymentOpening.current.promise;
  const sequence=++conversationSelectionSeq.current;beginWorkerGate();openSeq.current++;setPrimaryPanel('workspace');setAgentIntent(undefined);setSection('deployment:'+taskId);
  const promise=(async()=>{try{const value=await deploymentApi.open(taskId);if(sequence!==conversationSelectionSeq.current)return;const conversation=value.conversation;if(conversation.taskId!==taskId)throw Error(t('此流程的会话绑定已变化，请重新打开该流程。'));const changed=selectedConversationRef.current?.id!==conversation.id;if(changed){setSkill(undefined);conversationChanged(conversation);}if(conversation.projectId)setProjectId(conversation.projectId);setAgentTasks(old=>[value.task,...old.filter(task=>task.id!==taskId)]);setSection('deployment:'+taskId);if(!await observeWorker(taskId)||sequence!==conversationSelectionSeq.current)return;if(changed)setSessionSelection({nonce:crypto.randomUUID(),conversation});}catch(error){if(sequence===conversationSelectionSeq.current){setWorkerRestoring(false);onError(error);}}})().finally(()=>{if(deploymentOpening.current?.promise===promise)deploymentOpening.current=null;});
  deploymentOpening.current={taskId,promise};return promise;
 }
 function applyConversationDeletion(value:{id:string;taskIds:string[]}){
  const deleted=new Set(value.taskIds);setConversations(old=>old.filter(c=>c.id!==value.id));setAgentTasks(old=>old.filter(t=>!deleted.has(t.id)));
  for(const id of deleted)clearTaskDrafts(id);
  const removed=(id:string)=>(id.startsWith('agent-task:')&&deleted.has(id.slice(11)))||(id.startsWith('deployment:')&&deleted.has(id.slice(11)));
  setSection(old=>removed(old)?'home':old);
  setAttentionTarget(old=>old&&old.provider+':'+old.threadId===value.id?undefined:old);
  setHistoryTarget(old=>old?.conversationId===value.id?undefined:old);
  setToolSetupReview(old=>old&&(old.conversationId===value.id||old.taskId&&deleted.has(old.taskId))?null:old);
  setWorkflowToolQuestion(old=>old&&(old.provider+':'+old.threadId===value.id||deleted.has(old.taskId))?null:old);
  setToolSetup(old=>old&&(old.conversationId===value.id||old.taskId&&deleted.has(old.taskId))?null:old);
  setRenameTarget(old=>old?.id===value.id?null:old);
  setDeleteTarget(old=>old?.id===value.id?null:old);
  if(pendingSshGuide.current&&(pendingSshGuide.current.conversationId===value.id||pendingSshGuide.current.taskId&&deleted.has(pendingSshGuide.current.taskId)))pendingSshGuide.current=null;
  setSshGuide(old=>old&&(old.conversationId===value.id||old.taskId&&deleted.has(old.taskId))?null:old);
  if(deploymentOpening.current&&deleted.has(deploymentOpening.current.taskId))deploymentOpening.current=null;
  if(selectedConversationRef.current?.id===value.id){conversationSelectionSeq.current++;beginWorkerGate();setSkill(undefined);conversationChanged(null);setAgentIntent(undefined);setPlanningMode(false);setSessionSelection({nonce:crypto.randomUUID(),new:true});void observeWorker();}
 }
 async function deleteConversation(){
  if(!deleteTarget||conversationDeletion.current||replying(deleteTarget))return;
  conversationDeletion.current=true;setDeleting(true);
  try{
   const result=await invoke<{id:string;taskIds:string[]}>('conversation.delete',{id:deleteTarget.id});
   applyConversationDeletion(result);setDeleteTarget(null);
  }catch(error){onError(error);}
  finally{conversationDeletion.current=false;setDeleting(false);}
 }
 function applyGroupDeletion(value:DeleteConversationGroupResult){
  setChatGroups(old=>old.filter(group=>group.id!==value.id));
  setChatGroupId(old=>old===value.id?null:old);
  setConversations(old=>old.map(row=>row.groupId===value.id?{...row,groupId:null}:row));
  const selected=selectedConversationRef.current;if(selected?.groupId===value.id)selectedConversationRef.current={...selected,groupId:null};
 }
 async function deleteConversationGroup(){
  if(!groupDeleteTarget||groupDeletion.current)return;
  const request:DeleteConversationGroupRequest={id:groupDeleteTarget.id};groupDeletion.current=true;setGroupDeleting(true);
  try{const value=await invoke<DeleteConversationGroupResult>('conversation.deleteGroup',request);if(value.id!==request.id)throw Error(t('分组删除结果未能确认，请重新读取分组列表。'));applyGroupDeletion(value);setGroupDeleteTarget(null);}catch(error){onError(error);}finally{groupDeletion.current=false;setGroupDeleting(false);}
 }
 async function organizeConversation(c:Conversation,pinned=c.pinned||false,groupId:string|null=c.groupId||null){try{const value=await invoke<Conversation>('conversation.organize',{id:c.id,pinned,groupId});setConversations(old=>old.map(row=>row.id===value.id?value:row));if(selectedConversationRef.current?.id===value.id)setChatGroupId(groupId);}catch(error){onError(error);}}
 async function createChatGroup(){if(!groupName.trim()||busy)return;setBusy(true);try{const group=await invoke<{id:string;name:string}>('conversation.createGroup',{name:groupName.trim()});setChatGroups(old=>[...old,group]);setChatGroupId(group.id);setModal('');newConversation();}catch(error){onError(error);}finally{setBusy(false);}}
 function conversationRow(c:Conversation){
  const activity=managed.conversations.find(item=>item.threadId===c.threadId&&item.provider===c.provider);
  const attention=activityByConversation.get(c.id);
  return <div className="conversation-row" key={c.id}>
   <Tooltip asChild content={c.name+(c.taskId?' · '+t('已关联计算流程'):'')}><button className={'conversation-item '+(selectedConversationId===c.id?'selected-conversation':'')} aria-current={selectedConversationId===c.id?'true':undefined} disabled={deleting} onClick={()=>{if(modal==='history')setModal('');void chooseConversation(c);}}>
    <span className="conversation-title">{c.name}</span><ConversationResourceStatus activity={activity} pending={managedPending} waiting={!!attention?.pending.length} motion={settings.resourceBadgeMotion}/>
   </button></Tooltip>
   <ConversationAttentionBadges activity={attention} onSelect={value=>void openConversationAttention(value)}/>
   {historyEnabled&&c.archived?<button className="text-button" type="button" disabled={deleting} onClick={()=>void archiveConversation(c)}>{t('恢复归档会话')}</button>:
    <ConversationMenu conversation={c} groups={chatGroups} disabled={!!activity?.replying} deleting={deleting} onRename={()=>{setRenameTarget(c);setConversationName(c.name);}} onDelete={()=>setDeleteTarget(c)} onOrganize={(pinned,groupId)=>void organizeConversation(c,pinned,groupId)} onArchive={historyEnabled?()=>void archiveConversation(c):undefined}/>}
  </div>;
 }
 function chooseProject(value:Project){setProjectId(value.id);setSelected(null);const conversation=conversations.find(c=>c.projectId===value.id);if(conversation)void chooseConversation(conversation);else newConversation();}
 async function reviewWorkflow(task:any){if(replying(task))return;const seq=++conversationSelectionSeq.current;beginWorkerGate();setAgentIntent(undefined);try{await settingsReady.current;if(seq!==conversationSelectionSeq.current)return;const conversation=await invoke<Conversation>('conversation.select',{id:task.provider+':'+task.threadId});if(seq!==conversationSelectionSeq.current)return;const changed=selectedConversationRef.current?.id!==conversation.id;if(changed){setSkill(undefined);conversationChanged(conversation);if(conversation.projectId)setProjectId(conversation.projectId);}if(!await observeWorker(conversation.taskId)||seq!==conversationSelectionSeq.current)return;if(changed){setSessionSelection({nonce:crypto.randomUUID(),conversation});setSection(conversation.taskId?'agent-task:'+conversation.taskId:'home');}setAgentVisible(true);setAgentIntent({id:crypto.randomUUID(),autoSend:true,reviewMode:true,threadId:task.threadId,provider:task.provider,taskId:task.id,text:t('复核当前计算流程 {id} 的手工参数与文件。请直接读取本轮提供的最新流程，检查科学条件和执行所需输入，更新同一流程并准备匹配当前参数的实际模块草稿。不要执行计算；请明确指出仍缺的信息。').replace('{id}',task.id)});}catch(e){onError(e);}}
 const customCvInvoke:CustomCvInvoke=(method,request)=>invoke(method,request);
 const importCompositionAsset=(request:{taskId:string})=>invoke<CompositionAssetImportResult>('task.pygas.importAsset',request);
 async function discussCustomCv(request:{taskId:string;reason:'formula'|'stable_phase';includePrivate:boolean;entryId?:string}){
  const task=agentTasks.find(value=>value.id===request.taskId);if(replying(task))return;if(!task?.threadId)return onError(new Error('请先选择此流程绑定的会话'));
  const seq=++conversationSelectionSeq.current;beginWorkerGate();setAgentIntent(undefined);
  try{await settingsReady.current;if(seq!==conversationSelectionSeq.current)return;const conversation=await invoke<Conversation>('conversation.select',{id:task.provider+':'+task.threadId});if(seq!==conversationSelectionSeq.current||conversation.taskId!==task.id)return;
   const changed=selectedConversationRef.current?.id!==conversation.id;if(changed){setSkill(undefined);conversationChanged(conversation);if(conversation.projectId)setProjectId(conversation.projectId);}if(!await observeWorker(conversation.taskId)||seq!==conversationSelectionSeq.current)return;if(changed)setSessionSelection({nonce:crypto.randomUUID(),conversation});
   setSection('agent-task:'+task.id);setAgentVisible(true);
   const text=request.reason==='stable_phase'?t('请在当前流程中讨论这个 CV 的物理适用性，以及如何选择稳态相或独立参考验证。区分公式数值一致性、物理判别力和实际引擎验证；先给我可审阅方案，不执行计算。'):t('请先查当前 pyGAS CV/Bias 类库和可核对的官方示例，优先用已有组合表达我的需求。确实缺少等价定义时，先讨论并展示公式、符号、单位、定义域、奇点和参数，再保存到本会话的自定义 CV 草稿供我审阅；不要直接生成代码或执行。');
   setAgentIntent({id:crypto.randomUUID(),threadId:task.threadId,provider:task.provider,taskId:task.id,text:text+(request.includePrivate?t(' 已共享的私有定义请按页面中明确选择的本服务商共享范围读取。'):t(' 私有库内容尚未授权共享时不要读取或附加正文。'))});
  }catch(error){onError(error);}
 }
 async function openWorkflowDiscussion({taskId,provider,threadId,text}:DiagnosticRepairRequest){
  const task=agentTasks.find(value=>value.id===taskId);
  if(!task||task.provider!==provider||task.threadId!==threadId)return;
  const id=provider+':'+threadId,seq=++conversationSelectionSeq.current;
  const current=()=>seq===conversationSelectionSeq.current&&mounted.current;
  setAgentIntent(undefined);
  try{
   await settingsReady.current;
   if(!current())return;
   const conversation=await invoke<Conversation>('conversation.select',{id});
   if(!current())return;
   if(conversation.id!==id||conversation.provider!==provider||conversation.threadId!==threadId||conversation.taskId!==taskId)throw Error(t('此流程的会话绑定已变化，请重新打开该流程。'));
   if(selectedConversationRef.current?.id!==conversation.id){
    beginWorkerGate();
    setSkill(undefined);
    conversationChanged(conversation);
    setProjectId(conversation.projectId||'');
    setSessionSelection({nonce:crypto.randomUUID(),conversation});
    void observeWorker(conversation.taskId);
   }
   setAgentVisible(true);
   setPrimaryPanel('agent');
   setAgentIntent({id:crypto.randomUUID(),taskId,provider,threadId,text});
  }catch(error){if(current())onError(error);}
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
 function helpWithSshServiceEnvironment(profile:SshEnvironmentHelpTarget){
  if(guidePage){rememberCluster({profileId:profile.id,profileVersion:profile.version,name:profile.name},'ssh-service');setLesson({destination:'ssh-service'});}
  setComputeChooser(false);
  const text=settings.language==='en'?
   `Please use "${profile.name}" to inspect its AIMatterLab SSH job-service environment. The saved profile ID is ${profile.id}, version ${profile.version}${profile.connectionId?`, and the open connection is ${profile.connectionId}`:''}. Read cluster.connection-setup and environment.probe. Check the exact connection with list_compute_resources and use one selector with acquire_compute_resource. If there is already a manual share, use the terminal only when it matches this connection. Reuse this authenticated connection to inspect a Conda, venv or module environment and verify Python and sqlite3. Report the interpreter path and required activation commands for me to save. If the resource or permission is unavailable, report its actual state. Do not start another SSH login, handle credentials, install software, change project permissions or submit jobs. Claim service readiness only with a verified receipt.`:
   `请使用「${profile.name}」检查 AIMatterLab 的 SSH 作业服务环境。保存的配置 ID 为 ${profile.id}，版本 ${profile.version}${profile.connectionId?`，原连接为 ${profile.connectionId}`:''}。读取 cluster.connection-setup 和 environment.probe。用 list_compute_resources 核对原连接，再用一个选择参数调用 acquire_compute_resource。已有人工共享时，请核对共享终端与原连接相符后使用。复用这条已认证连接查找已有 Conda、venv 或 module 环境，核对 Python 和 sqlite3，给出解释器路径和所需激活命令，由我保存。资源或权限不可用时，报告实际状态。不要新建 SSH 登录、代输认证信息、安装软件、更改项目授权或提交作业。拿到服务核验回执后才能报告服务就绪。`;
  askAgent(text);
 }
 function moveHandoffLesson(stage:HandoffLessonStage,profile:SshEnvironmentHelpTarget){
  if(!guidePage||!lesson||!['ssh-login','ssh-workspace','ssh-service-observe'].includes(lesson.destination))return;
  if(clusterGuide?.profileId!==profile.id||clusterGuide.profileVersion!==profile.version)return;
  rememberCluster({profileId:profile.id,profileVersion:profile.version,name:profile.name},stage==='ssh-service-observe'?'ssh-service':'ssh-login');
  setLesson({destination:stage});
 }
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
 const clusterSettingsSource=workerSourceId||verifiedExecutionSource.current||'';
 const clusterRecordSource=selectedRecords?recordObservations.cluster.sourceId:clusterSettingsSource;
 const clusterRecordRetained=!!clusterRecordSource&&recordObservations.cluster.loaded&&!recordObservations.cluster.sourceChanged&&
  recordObservations.cluster.sourceId===clusterRecordSource&&clusterRecordSource===(selectedRecords?verifiedRecordSource.current:verifiedExecutionSource.current);
 const statusKnown=canOpenRecord('local')&&clusterSourceReady&&!recordObservations.local.stale&&!recordObservations.cluster.stale;
 const conversationWorkspace=section==='home'||section.startsWith('agent-task:')||section.startsWith('deployment:');
 const sidebarExpanded=sidebarVisible&&windowWidth>=1180;
 const availableWidth=windowWidth-(sidebarExpanded?sidebarWidth+7:56);
 const layoutKey=conversationWorkspace?'agentLayout':'overviewAgentLayout';
 const centerLayout=settings[layoutKey]==='center';
 const offerCompactPanes=windowWidth<=1024&&availableWidth>=620;
 const singlePanel=availableWidth<620||offerCompactPanes&&compactPane;
 const paneMax=Math.max(260,conversationWorkspace||centerLayout?availableWidth-290:Math.min(600,Math.floor(availableWidth*.45)));
 const savedPaneWidth=conversationWorkspace?agentWidth:overviewAgentWidth;
 const defaultPaneWidth=centerLayout?Math.round(availableWidth*.60):340;
 const displayAgentWidth=Math.min(paneMax,Math.max(260,savedPaneWidth||defaultPaneWidth));
 const agentPanelVisible=agentVisible&&(!singlePanel||primaryPanel==='agent');
 const workspacePanelVisible=!agentVisible||!singlePanel||primaryPanel==='workspace';
 const terminalPanelVisible=bottomTab==='terminal'&&bottomExpanded&&workspacePanelVisible;
 // A saved run or service keeps its exact selection. Describe newly hosted
 // connections separately without rebinding the old run to another SSH instance.
 const showHosted=computeResource?.kind==='ssh-connection'
  ?computeResource.status!=='selected'||computeResource.alive!==true
  :!isSshResource(computeResource)&&(!worker||disconnected);
 const hostedResources=showHosted?managed.resources.filter(row=>row.kind==='ssh'&&row.connectionId):[];
 const hostedSummary=hostedSshSummary(hostedResources,managedPending)||(managedPending&&showHosted&&!isSshResource(computeResource)?t('托管资源状态待核对'):'');
 const resourceOnline=hostedResources.length?!managedPending&&hostedResources.some(row=>!row.verificationPending):isSshResource(computeResource)?computeResource.alive===true:statusKnown;
 const queueStatusKnown=statusKnown&&!(managedPending&&showHosted);
 function onTerminalError(error:unknown) {
  if(terminalPanelVisible&&error instanceof Error&&'presentation' in error&&error.presentation==='inline')return;
  onError(error);
 }
 const needsPanelSelection=singlePanel||!agentVisible||offerCompactPanes;
 const closePalette=()=>{setCommand(false);setPaletteSearch('');};
 const paletteBlocked=deleting||renaming||busy||imageSaving||!!modal||!!deleteTarget||!!renameTarget;
 const hasOpenDialog=()=>!!document.querySelector('[role="dialog"]:not(dialog:not([open]))');
 function toggleSidebar(){
  if(windowWidth<1180){
   if(modal==='history'){setModal('');setSearchHistoryBody(false);}else setModal('history');
   return;
  }
  setSidebarVisible(value=>!value);
 }
 function toggleBottomPanel(){
  if(!workspacePanelVisible){setPrimaryPanel('workspace');setBottomExpanded(true);return;}
  setBottomExpanded(value=>!value);
 }
 const shortcutActions:Record<WorkspaceShortcut,()=>void>={
  search:()=>{if(command)closePalette();else setCommand(true);},
  conversation:()=>{if(!paletteBlocked)void newConversation();},
  sidebar:toggleSidebar,
  bottom:toggleBottomPanel,
  settings:openSettings,
  help:()=>setModal('shortcuts'),
 };
 shortcutHandler.current=event=>{
  const id=workspaceShortcut(event);
  if(!id)return;
  if(guideShowing||projectPolicyOwner.current.modal==='project-edit'&&projectPolicyOwner.current.saving){event.preventDefault();return;}
  if(hasOpenDialog()&&!(id==='search'&&command)&&!(id==='sidebar'&&modal==='history'))return;
  event.preventDefault();
  event.stopPropagation();
  shortcutActions[id]();
 };
 useEffect(()=>{
  const content=workspaceContent.current;
  if(!content||section===workspacePage.current||!workspacePanelVisible||guideShowing||modal||command||computeChooser||sshGuide||computeGuide)return;
  const opener=document.activeElement,lastScroll=workspaceScroll.current.get(section)||0;
  let observer:MutationObserver|undefined;
  const finish=(target:HTMLElement)=>{
   workspacePage.current=section;
   content.scrollTop=lastScroll;
   if((document.activeElement===opener||document.activeElement===document.body)&&!hasOpenDialog()){
    target.tabIndex=-1;
    target.focus({preventScroll:true});
   }
   observer?.disconnect();
  };
  const focusHeading=()=>{
   const visible=(selector:string)=>[...content.querySelectorAll<HTMLElement>(selector)].find(node=>node.getClientRects().length);
   const heading=visible('h1')||visible('.page-heading h2');
   if(heading)finish(heading);
   return !!heading;
  };
  const frame=requestAnimationFrame(()=>{
   if(focusHeading())return;
   observer=new MutationObserver(focusHeading);
   observer.observe(content,{childList:true,subtree:true});
  });
  const timeout=setTimeout(()=>{if(workspacePage.current!==section)finish(content);},800);
  return()=>{cancelAnimationFrame(frame);clearTimeout(timeout);observer?.disconnect();};
 },[section,workspacePanelVisible,guideShowing,modal,command,computeChooser,sshGuide,computeGuide]);
 const matchingConversations=conversations.filter(conversation=>conversationMatches(conversation,conversationSearch,projects.find(project=>project.id===conversation.projectId)?.name||''));
 const shownConversations=matchingConversations.filter(conversation=>!conversation.archived),archivedConversations=matchingConversations.filter(conversation=>conversation.archived),recentConversations=conversations.filter(conversation=>!conversation.archived).slice(0,4);
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
 const layoutMenu=useRef<HTMLDetailsElement>(null);
 const panelFocus=useRef<Partial<Record<'workspace'|'agent',{scope:string;element:HTMLElement}>>>({});
 function rememberPanelFocus(event:React.FocusEvent<HTMLDivElement>){
  const element=event.target;
  if(!(element instanceof HTMLElement)||element.closest('[role="dialog"]'))return;
  const panel=element.closest('.main-column')?'workspace':element.closest('.agent-panel')?'agent':null;
  if(panel)panelFocus.current[panel]={scope:panel==='workspace'?section:selectedConversationId||'',element};
 }
 function selectPanel(panel:'workspace'|'agent'){
  const trigger=document.activeElement;
  if(offerCompactPanes)setCompactPane(true);
  if(panel==='agent')setAgentVisible(true);
  setPrimaryPanel(panel);
  requestAnimationFrame(()=>{
   if(document.activeElement!==trigger)return;
   const pane=document.querySelector<HTMLElement>(panel==='workspace'?'.workspace-panels>.main-column':'.workspace-panels>.agent-panel');
   if(!pane?.getClientRects().length||pane.closest('[inert]'))return;
   const last=panelFocus.current[panel],scope=panel==='workspace'?section:selectedConversationId||'';
   const target=last?.scope===scope&&pane.contains(last.element)&&last.element.getClientRects().length&&!last.element.matches(':disabled')?last.element:
    panel==='workspace'?pane:pane.querySelector<HTMLElement>('.composer textarea');
   target?.focus({preventScroll:true});
  });
 }
 function revealLayout(layout:'right'|'center',changed:boolean){
  const chatFirst=layout==='center';
  if(chatFirst)setAgentVisible(true);
  setPrimaryPanel(chatFirst?'agent':'workspace');
  // Size the new arrangement against the actual split when both panes are visible.
  if(changed)(conversationWorkspace?setAgentWidth:setOverviewAgentWidth)(0);
 }
 function switchPriority(layout:'right'|'center'){
  const menu=layoutMenu.current;
  if(menu){menu.open=false;menu.querySelector('summary')?.focus();}
  revealLayout(layout,(settings[layoutKey]||'right')!==layout);
  setSettings(previous=>({...previous,[layoutKey]:layout}));
  void invoke('settings',{[layoutKey]:layout}).catch(onError);
 }
 function rememberSavedSettings(saved:Settings){
  if(settingsBackup.current&&(settingsBackup.current[layoutKey]||'right')!==(saved[layoutKey]||'right')&&saved[layoutKey]===settingsRef.current[layoutKey]){
   revealLayout(saved[layoutKey]||'right',true);
  }
  settingsBackup.current=saved;
 }
 function selectToolSkill(value:SkillAttachment){setSkill(value);setAgentVisible(true);}
 function toggleAgent(){if(!agentVisible||singlePanel){selectPanel(agentPanelVisible?'workspace':'agent');return;}setAgentVisible(false);}
 const lessonControls=lesson&&guidePage&&!modal&&!command&&!computeChooser&&!computeGuide&&!sshGuide
  ? <SetupLesson lesson={lesson} page={guidePage} english={settings.language==='en'} showFocus={dismissedLesson!==lesson}
    onDismiss={()=>setDismissedLesson(lesson)} onRehighlight={()=>setDismissedLesson(null)} onReturn={openSetupGuide}/> : null;
 const canReviewToolSetup=toolSetupReview&&!sessionSelection?.pending&&(toolSetupReview.conversationId?selectedConversationId===toolSetupReview.conversationId:!selectedConversationId&&agentProvider===toolSetupReview.provider&&toolSetupReview.selectionSeq===conversationSelectionSeq.current);
 const pendingWorkflowTool=workflowToolQuestion&&activeFlow?.id===workflowToolQuestion.taskId&&toolQuestionRevision(activeFlow)===workflowToolQuestion.workflowRevision&&flowWorker?.kind==='ssh'&&flowWorker.profileId===workflowToolQuestion.profileId&&flowWorker.profileVersion===workflowToolQuestion.profileVersion?workflowToolQuestion:null;
 const selectedLocalConversation=workerRestoring?null:selectedConversationRef.current,localSelectionSeq=conversationSelectionSeq.current;
 const localConversationProps={selectedLocalConversation,historyTarget,terminalDraft,onOpenHistoryLocation:(anchor:ConversationAnchor)=>void openHistoryLocation(anchor),onOpenDiscussion:(conversation:Conversation)=>void openDiscussion(conversation),isLocalConversationCurrent:()=>!!selectedLocalConversation&&
  mounted.current&&localSelectionSeq===conversationSelectionSeq.current&&selectedLocalConversation.id===selectedConversationRef.current?.id};
 const toolProjectDefaults=projectToolResource&&toolSetupTargetDefaults&&toolSetupTargetDefaults.profileId===projectToolResource.profileId&&toolSetupTargetDefaults.profileVersion===projectToolResource.profileVersion?toolSetupTargetDefaults:null;
 const toolSchedulerDefaults=computeChooserEdit&&toolSetupTargetDefaults&&toolSetupTargetDefaults.profileId===computeChooserEdit.profileId&&toolSetupTargetDefaults.profileVersion===computeChooserEdit.profileVersion?toolSetupTargetDefaults:null;
 return <EvidenceConversation.Provider value={selectedLocalConversation&&!sessionSelection?.pending?selectedLocalConversation:null}><div className={guideShowing?"application showing-setup":"application"}>
  <MonitorAttention notices={managed.notices||[]} onOpen={openNotice} onDismiss={acknowledgeNotice}/>
   <header className="titlebar">
    <div className="brand"><span className="brand-mark"><Atom size={18}/></span><strong>{product.name}</strong><Tooltip asChild content={t('软件更新')}><button className={'version'+(updateVisible?' has-update':'')} aria-label={t('软件更新')} onClick={()=>setModal('updates')}>{updateVisible?t('软件更新')+' '+updates.state.version:STUDIO_VERSION}</button></Tooltip></div>
    {lessonControls}
    {guideInfo&&!guidePage&&<Tooltip asChild content={t('新手引导')}><button className="setup-help" data-testid="open-setup-guide" aria-label={t('新手引导')} disabled={!!modal||computeChooser||!!computeGuide||!!sshGuide} onClick={openSetupGuide}><CircleHelp size={16}/><span>{t('新手引导')}</span></button></Tooltip>}
    <div className="window-buttons">
     <Tooltip asChild content={t('最小化')}><button aria-label={t('最小化')} onClick={()=>void invoke('window',{action:'minimize'}).catch(()=>{})}><Minus size={13}/></button></Tooltip>
     <Tooltip asChild content={t('最大化或还原')}><button aria-label={t('最大化或还原')} onClick={()=>void invoke('window',{action:'maximize'}).catch(()=>{})}><Square size={11}/></button></Tooltip>
     <Tooltip asChild content={t('关闭')}><button className="close" aria-label={t('关闭')} onClick={()=>void invoke('window',{action:'close'}).catch(()=>{})}><X size={14}/></button></Tooltip>
    </div>
   </header>
  <div inert={guideShowing||undefined} className={"shell workspace-shell "+(centerLayout?'agent-center ':'')+(singlePanel?'single-panel':'')} style={{'--agent-width':displayAgentWidth+'px','--conversation-width':sidebarWidth+'px'} as React.CSSProperties} data-primary-panel={agentVisible?primaryPanel:'workspace'}>
    <nav hidden={sidebarExpanded} className="navigation-rail" aria-label={t('主导航')}>
     <Tooltip asChild placement="right" content={t('搜索与命令')+' · '+shortcutLabel('search')}><button aria-label={t('搜索与命令')} aria-keyshortcuts="Control+K" onClick={()=>setCommand(true)}><Search size={20}/></button></Tooltip>
     <div className="rail-destinations">{mainDestinations.map(([id,label,Icon])=><Tooltip key={id} asChild placement="right" content={t(label)}>
      <button data-testid={sidebarExpanded?undefined:'navigate-'+id} aria-label={t(label)} aria-current={primaryDestination(section)===id?'page':undefined} onClick={()=>id==='compute-resources'?openComputeConsole():go(id==='home'&&retainedTask?'agent-task:'+retainedTask.id:id)}><Icon size={20}/></button>
     </Tooltip>)}</div>
     <Tooltip asChild placement="right" content={t('新对话')+' · '+shortcutLabel('conversation')}><button data-testid={sidebarExpanded?undefined:'new-conversation'} aria-label={t('新对话')} aria-keyshortcuts="Control+N" onClick={()=>void newConversation()}><Plus size={19}/></button></Tooltip>
     {!sidebarExpanded&&section!=='home'&&<Tooltip asChild placement="right" content={t('新建计算')}><button type="button" className="rail-new-computation" data-testid="new-computation" aria-label={t('新建计算')} onClick={()=>newConversation(true)}><GitBranch size={19}/></button></Tooltip>}
     <Tooltip asChild placement="right" content={t(windowWidth<1180?'历史会话':'展开导航')+' · '+shortcutLabel('sidebar')}><button aria-label={t(windowWidth<1180?'历史会话':'展开导航')} aria-keyshortcuts="Control+B" onClick={toggleSidebar}>{windowWidth<1180?<MessageSquare size={19}/>:<PanelLeftOpen size={20}/>}</button></Tooltip>
     <span className="rail-spacer"/>
     <div className="rail-settings-actions">
      <Tooltip asChild placement="right" content={t('账号与 API')}><button data-testid={sidebarExpanded?undefined:'open-accounts'} aria-label={t('账号与 API')} onClick={()=>openAccounts()}><KeyRound size={17}/></button></Tooltip>
      <Tooltip asChild placement="right" content={t('设置')+' · '+shortcutLabel('settings')}><button aria-label={t('设置')} aria-keyshortcuts="Control+," onClick={openSettings}><SettingsIcon size={18}/></button></Tooltip>
      <UpdateButton {...updates} open={openUpdates} compact/>
     </div>
    </nav>
    <nav className="sidebar" aria-label={t('工作台导航')} hidden={!sidebarExpanded}>
     <div className="sidebar-title">
      <Tooltip asChild content={t('搜索与命令')+' · '+shortcutLabel('search')}><button className="quick-search" aria-label={t('搜索与命令')} aria-keyshortcuts="Control+K" onClick={()=>setCommand(true)}><Search size={16}/><span>{t('搜索与命令')}</span><kbd aria-hidden="true">{shortcutLabel('search')}</kbd></button></Tooltip>
      <Tooltip asChild content={t('账号与 API')}><button className="icon-button sidebar-accounts" data-testid={sidebarExpanded?'open-accounts':undefined} aria-label={t('账号与 API')} onClick={()=>openAccounts()}><KeyRound size={17}/></button></Tooltip>
      <Tooltip asChild content={t('收起导航')+' · '+shortcutLabel('sidebar')}><button className="icon-button" aria-label={t('收起导航')} aria-keyshortcuts="Control+B" onClick={toggleSidebar}><PanelLeftClose size={17}/></button></Tooltip>
     </div>
     <div className="primary-navigation">{mainDestinations.map(([id,label,Icon])=><button key={id} data-testid={sidebarExpanded?'navigate-'+id:undefined} aria-current={primaryDestination(section)===id?'page':undefined} onClick={()=>go(id==='home'&&retainedTask?'agent-task:'+retainedTask.id:id)}><Icon size={18}/><span>{t(label)}</span></button>)}</div>

    <Tooltip asChild content={t('新对话')+' · '+shortcutLabel('conversation')}><button className="new-conversation-button sidebar-new-conversation" data-testid={sidebarExpanded?'new-conversation':undefined} aria-label={t('新对话')} aria-keyshortcuts="Control+N" onClick={()=>void newConversation()}><Plus size={16}/><span>{t('新对话')}</span></button></Tooltip>
    {section!=='home'&&<button className="new-conversation-button sidebar-new-conversation" data-testid={sidebarExpanded?'new-computation':undefined} onClick={()=>newConversation(true)}><GitBranch size={16}/>{t('新建计算')}</button>}

    {sidebarExpanded&&nextAttention&&<NextConversationAttention onSelect={()=>void openConversationAttention(nextAttention)}/>}
    <label className="conversation-search"><Search size={14}/><input aria-label={t('搜索会话')} placeholder={t('搜索会话')} value={conversationSearch} onChange={event=>setConversationSearch(event.target.value)}/></label>
    {historyEnabled&&<button className="text-button conversation-history-search-open" type="button" onClick={()=>{setSearchHistoryBody(true);setModal('history');}}>{t('搜索聊天正文')}</button>}
    <div className="sidebar-scroll conversation-sidebar" data-testid="conversation-sidebar">
     {!!pinnedTools.length&&<div className="pinned-tool-links" data-testid="sidebar-pinned-tools">
      <span className="nav-label">{t('常用工具')}</span>
      {pinnedTools.map(tool=><button type="button" className="text-button" key={tool.id} onClick={()=>go('tool:'+tool.id)}>{t(tool.name)}</button>)}
     </div>}
     {shownConversations.some(c=>c.pinned)&&<><div className="nav-label">{t('置顶')}</div>{shownConversations.filter(c=>c.pinned).map(conversationRow)}</>}
     <div className="chat-group-header"><span className="nav-label">{t('会话分组')}</span>
      <Button variant="icon" size="sm" aria-label={t('新建会话分组')} onClick={()=>{setGroupName('');setModal('chat-project');}}><Plus size={15} aria-hidden="true"/></Button>
     </div>
     {chatGroups.map(group=><Disclosure className={'conversation-project '+(chatGroupId===group.id?'active':'')} key={group.id} open variant="section" summary={<>
      <span>{group.name}</span>
      <Button variant="icon" size="sm" aria-label={t('在分组中新建对话')+' · '+group.name} onClick={e=>{e.preventDefault();setChatGroupId(group.id);newConversation();}}><Plus size={14} aria-hidden="true"/></Button>
      <ConversationMenu group={group} disabled={groupDeleting} onDelete={()=>setGroupDeleteTarget(group)}/>
     </>}>{shownConversations.filter(c=>c.groupId===group.id&&!c.pinned).map(conversationRow)}</Disclosure>)}
     <div className="chat-group-header"><span className="nav-label">{t('未分组会话')}</span>
      <Button variant="icon" size="sm" aria-label={t('新建未分组会话')} onClick={()=>{setChatGroupId(null);newConversation();}}><Plus size={14} aria-hidden="true"/></Button>
     </div>
     {shownConversations.filter(c=>!c.groupId&&!c.pinned).map(conversationRow)}
     {!shownConversations.length&&conversationSearch.trim()&&<span className="muted">{t('没有匹配的会话')}</span>}</div>
    <div className="sidebar-bottom"><button className="resource-mini compute-resource-entry" data-testid="unified-compute-entry" aria-label={t('连接计算资源')} onClick={()=>setComputeChooser(true)}><i className={resourceOnline?'online':''}/><span><strong>{t('连接计算资源')}</strong>{hostedSummary?<small data-testid="active-ssh-resource">{hostedSummary}</small>:isSshResource(computeResource)?<small data-testid="active-ssh-resource">{computeResource.kind==='ssh-connection'?sshSummary(computeResource):<>{computeResourceLabel||t(computeResource.workflowReady?'SSH 作业服务':'SSH 终端')} · {t(computeResource.workflowReady?'工作流服务已连接':computeResource.status!=='selected'?'资源需重新选择':computeResource.processStatus==='exited'?'终端进程已退出':computeResource.processStatus==='expired'?'访问已过期':computeResource.processStatus!=='running'?'终端状态未知':computeResource.operator==='agent'?computeResource.agentReady?'由 Agent 操作':'Agent 访问待核对':computeResource.operator==='human'?'由你操作':'操作权限待核对')}</>}</small>:<small>{settings.distribution} · {tr(workerNotice||(disconnected?'连接中断 · 状态未知':worker?(serviceVersion==='different'?tr('已连接 · 服务版本不同'):serviceVersion==='unconfirmed'?tr('已连接 · 服务版本未核对'):gpuStale?tr('GPU 记录待核对'):gpuStatus[0]?gpuStatus[0].memory_used+' / '+gpuStatus[0].memory_total+' MiB':active.length+' '+tr('个运行任务')):'本地作业服务未连接'))}</small>}</span><PlugZap size={16}/></button>
      <div className="sidebar-tools">
       <Tooltip asChild content={t('设置')+' · '+shortcutLabel('settings')}><button className="sidebar-settings" aria-label={t('设置')} aria-keyshortcuts="Control+," onClick={openSettings}><SettingsIcon size={17}/></button></Tooltip>
       <UpdateButton {...updates} open={openUpdates} compact/>
       <Tooltip asChild content={t('切换主题')}><button aria-label={t('切换主题')} onClick={()=>{const theme=settings.theme==='dark'?'light':'dark';setSettings({...settings,theme});void invoke('settings',{theme}).catch(onError);}}>{settings.theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}</button></Tooltip>
      </div>
     </div>
   </nav>{sidebarExpanded&&<PaneDivider pane="conversation" label={t('调整会话列表宽度')} value={sidebarWidth} min={170} max={Math.min(420,windowWidth-360)} onChange={setSidebarWidth}/>}
   <section className="workspace-stage">
    <div className="workspace-toolbar" data-testid="workspace-modebar">
      <div className="workspace-current-title">
        <button type="button" className="workspace-project-trigger" data-testid="open-project-selector" aria-haspopup="dialog" aria-label={t('选择计算项目')+' · '+(project?projectLabel(project):t('尚未选择项目'))} onClick={openProjects}>
         <Folder size={16} aria-hidden="true"/><strong><span className="title-path">{project?projectLabel(project):t('尚未选择项目')}</span></strong><ChevronDown size={13} aria-hidden="true"/>
        </button>
      </div>
       {needsPanelSelection&&<div className="panel-selection" role="group" aria-label={t('工作区布局')}>
        <button data-testid="show-workspace" aria-pressed={workspacePanelVisible&&!agentPanelVisible} onClick={()=>selectPanel('workspace')}>{t('工作区')}</button>
        <button data-testid="show-agent" aria-pressed={agentPanelVisible&&!workspacePanelVisible} onClick={()=>selectPanel('agent')}>{t('对话')}</button>
        {offerCompactPanes&&<button data-testid="show-split-panels" aria-pressed={workspacePanelVisible&&agentPanelVisible} onClick={()=>{setAgentVisible(true);setCompactPane(false);}}>{t('并排显示')}</button>}
       </div>}
      <div className="toolbar-actions">
       <Button variant="icon" className="icon-button" aria-label={t('刷新')} loading={refreshFeedback?.status==='loading'}
        disabled={!worker} disabledReason={t(!worker?'作业服务未连接':'正在同步记录…')} onClick={()=>void refresh(true,true)}><RefreshCw size={16} aria-hidden="true"/></Button>
       <Disclosure className="workspace-layout-menu" summary={t('布局')} ref={layoutMenu} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false;}} onKeyDown={event=>{
      if(event.key==='Escape'&&event.currentTarget.open){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}
       }}><div>
        <button data-testid="priority-chat" aria-pressed={centerLayout} onClick={()=>switchPriority('center')}><Check size={15} aria-hidden="true"/>{t('对话优先')}</button>
        <button data-testid="priority-workflow" aria-pressed={!centerLayout} onClick={()=>switchPriority('right')}><Check size={15} aria-hidden="true"/>{t('流程优先')}</button>
       </div></Disclosure>
       <Tooltip asChild content={t('切换 Agent 面板')}><button className="icon-button agent-panel-toggle" aria-label={t('切换 Agent 面板')} aria-pressed={agentPanelVisible} onClick={toggleAgent}>{agentPanelVisible?<PanelRightClose size={17}/>:<PanelRightOpen size={17}/>}</button></Tooltip>
      </div>
    </div><div className="workspace-panels" onFocusCapture={rememberPanelFocus}><main className="main-column" tabIndex={-1}>
    <div className="workspace-content" ref={workspaceContent} onScroll={event=>{if(workspacePage.current===section)workspaceScroll.current.set(section,event.currentTarget.scrollTop);}}><LoadingFeedback busy={!!openingRun&&openingRun.sequence===openSeq.current} label={tr("正在读取运行记录…")}/>{recordsConnected&&displayedServiceVersion!=='current'&&<Disclosure className="service-version-notice" role="status" data-testid="worker-service-version" data-version={displayedServiceVersion} summaryProps={{'data-testid':'worker-service-version-summary'}} summary={<><span>{tr(displayedServiceVersion==='different'?'作业服务与当前软件版本不同':'作业服务实现版本尚未核对')}</span>{selectedRecords&&displayedServiceVersion==='different'&&<button className="button service-version-upgrade" data-testid="worker-service-upgrade" onClick={event=>{event.preventDefault();event.stopPropagation();openCurrentServiceUpdate(selectedRecords);}}>{t('更新作业服务…')}</button>}</>}><p>{tr(selectedRecords?displayedServiceVersion==='different'?'当前服务可继续使用已有工具和提交获准的任务。需要更新时，请在当前连接设置中选择“更新作业服务”，现有任务保留。':'当前服务已响应，实现版本尚未核对；可查看记录，工具与任务操作以实际可用接口及项目授权为准。请在当前连接设置中核对作业服务。':'历史记录可继续读取；当前软件的新工具接口尚未确认。需要更新时，请使用“连接计算资源 → 本地 WSL”明确连接，现有任务保留。')}</p></Disclosure>}<div hidden={section!=='runs'}><ViewBoundary onHome={()=>go('home')}><JobsPage managed={managed} managedPending={managedPending} focusSchedule={focusSchedule} local={runs} cluster={clusterRuns} observations={recordObservations} projects={projects} projectId={runProjectId} tasks={agentTasks} conversations={conversations} worker={recordsConnected} servicePhase={selectedRecords?recordService.phase:undefined} readOnly={!!selectedRecords&&!recordsExecutionAllowed} canRefresh={selectedRecords?recordService.phase!=='checking':worker} canOpen={canOpenRecord} busy={false} onRefresh={()=>void refreshSelectedRecords(true)} onOpen={job=>void openJob(job)} onConversation={conversation=>void chooseConversation(conversation)}/></ViewBoundary></div>
    <div hidden={!retainedTask||section!=='agent-task:'+retainedTask.id}>{retainedTask&&<ViewBoundary key={retainedTask.id} onHome={()=>go('home')}><AgentTaskPage viewActive={workspacePanelVisible&&section==='agent-task:'+retainedTask.id} onOpenWorkflow={id=>void openToolWorkflow(id)} toolWorkflowFocus={toolWorkflowFocus} onBindDraft={connectAndBindDraft} onDeploy={id=>void openDeployment(id)} navigationBusy={false} key={retainedTask.id} worker={worker&&!disconnected} onReconnect={connectWorker} task={retainedTask} environments={environments} theme={settings.theme} onError={onError} onRun={id=>openWorkflowRun(id,'local',retainedTask)} onCluster={id=>openWorkflowRun(id,'cluster',retainedTask)} onSetup={id=>void api<any[]>('GET','/api/cluster-drafts').then(values=>{setClusterDraft(values.find(v=>v.id===id));setSection('ssh');}).catch(onError)} onAgent={text=>askAgent(text,retainedTask.id)} onReview={task=>void reviewWorkflow(task)} onReplace={replaceTask} onRefresh={()=>refresh()} customCvInvoke={customCvInvoke} customProvider={agentProvider} onCustomDiscussion={request=>void discussCustomCv(request)} importAsset={importCompositionAsset} onMissingTool={openMissingResourceTool} onMissingToolQuestion={askAboutMissingWorkflowTool} toolSetupRevision={toolSetupRevision}/></ViewBoundary>}</div><ViewBoundary key={section} onHome={()=>go('home')}>
     {section==='deployment'&&<div className="page"><div className="page-heading"><div><h1>{tr('部署与执行')}</h1></div></div><div className="task-cards">{agentTasks.filter(t=>t.workflowVersion===2).map(task=><button key={task.id} className="card" onClick={()=>void openDeployment(task.id)}><strong>{task.name}</strong><p>{tr(task.review?.status==='ready'?'科学参数已复核':'等待科学参数复核')}</p></button>)}</div></div>}
     {section.startsWith('deployment:')&&agentTasks.find(t=>t.id===section.slice(11))&&<DeploymentPanel onRepair={request=>void openWorkflowDiscussion(request)} onOpenConnections={openOriginalConnection} key={section} task={agentTasks.find(t=>t.id===section.slice(11))} worker={worker&&!disconnected} restoring={workerRestoring} onAutomaticRestore={()=>observeWorker(section.slice(11))} projects={projects} environments={environments} onTask={id=>setSection('agent-task:'+id)} onRun={(id,kind)=>openWorkflowRun(id,kind==='cluster-run'?'cluster':'local',agentTasks.find(task=>task.id===section.slice(11)))} onError={onError} onRefresh={()=>refresh()} onProjectSettings={project=>void editProjectPolicy(project)} onReconnect={()=>connectWorker(section.slice(11))}/>}
     {section.startsWith('agent-task:')&&section!=='agent-task:'+retainedTask?.id&&agentTasks.find(t=>t.id===section.slice(11))&&<AgentTaskPage viewActive={workspacePanelVisible} onOpenWorkflow={id=>void openToolWorkflow(id)} toolWorkflowFocus={toolWorkflowFocus} onBindDraft={connectAndBindDraft} onDeploy={id=>void openDeployment(id)} navigationBusy={false} key={section} worker={worker&&!disconnected} onReconnect={connectWorker} task={agentTasks.find(t=>t.id===section.slice(11))} environments={environments} theme={settings.theme} onError={onError} onRun={id=>openWorkflowRun(id,'local',agentTasks.find(task=>task.id===section.slice(11)))} onCluster={id=>openWorkflowRun(id,'cluster',agentTasks.find(task=>task.id===section.slice(11)))} onSetup={id=>void api<any[]>('GET','/api/cluster-drafts').then(values=>{setClusterDraft(values.find(v=>v.id===id));setSection('ssh');}).catch(onError)} onAgent={text=>askAgent(text,section.slice(11))} onReview={task=>void reviewWorkflow(task)} onReplace={replaceTask} onRefresh={()=>refresh()} customCvInvoke={customCvInvoke} customProvider={agentProvider} onCustomDiscussion={request=>void discussCustomCv(request)} importAsset={importCompositionAsset} onMissingTool={openMissingResourceTool} onMissingToolQuestion={askAboutMissingWorkflowTool} toolSetupRevision={toolSetupRevision}/>}
     {section.startsWith('cluster-run:')&&<>
      {!clusterSourceReady&&<div className="page"><div className="connect-banner"><Server size={24}/><strong>{tr('连接作业服务')}</strong>{runSourceTask(section.slice(12))?<button className="button" disabled={connecting} onClick={()=>{const original=runSourceTask(section.slice(12));if(original)void connectWorker(original.id);}}>{tr('恢复原作业服务')}</button>:<p>{tr('请先明确连接保存此作业的原服务；不会改用当前聊天或默认来源。')}</p>}</div></div>}
      {(clusterSourceReady||clusterRecordRetained)&&<ClusterRunPage readOnly={!recordsExecutionAllowed} onOpenConnections={openOriginalConnection} key={JSON.stringify([selectedRecords?.key,clusterRecordSource,section])} id={section.slice(12)} sourceId={clusterRecordSource} workerGeneration={workerHydrationEpoch.current} connected={clusterSourceReady} visible={workspacePanelVisible} onError={onError} onAgent={askAgent}/>}
     </>}

     {section.startsWith('workflow:')&&tasks.some(k=>k.id===section.slice(9))&&<WorkflowPage key={section} taskId={section.slice(9)} onSaved={(plan,options)=>{setPlans(old=>[plan,...old.filter(p=>p.id!==plan.id)]);if(options.navigate)setSection(current=>current==='workflow:'+plan.taskId?'plan:'+plan.id:current);}} onAgent={askAgent} onTool={id=>setSection('tool:'+id)} onError={onError}/>}
     {section.startsWith('plan:')&&plans.find(p=>p.id===section.slice(5))&&tasks.some(k=>k.id===plans.find(p=>p.id===section.slice(5))!.taskId)&&<WorkflowPage key={section} taskId={plans.find(p=>p.id===section.slice(5))!.taskId} initial={plans.find(p=>p.id===section.slice(5))} onSaved={plan=>setPlans(old=>[plan,...old.filter(p=>p.id!==plan.id)])} onAgent={askAgent} onTool={id=>setSection('tool:'+id)} onError={onError}/>}
     {section==='relations'&&<div className="page"><div className="page-heading"><div><h1>{t('工具关系图')}</h1></div></div><Relations onTask={openWorkflow} onTool={id=>setSection('tool:'+id)}/></div>}
     {section.startsWith('tool:')&&tools.some(k=>k.id===section.slice(5))&&<ToolPage id={section.slice(5)} pinned={pinnedToolIds.includes(section.slice(5))} onTogglePin={togglePinnedTool} onTask={openWorkflow} onNavigate={setSection} onPrepare={newRun} canPrepare={worker&&!!project}/>}

     {section.startsWith('task:')&&runSourceReady&&runs.find(r=>r.id===section.slice(5))&&(selectedRecords&&!recordsExecutionAllowed?<RunDetail readOnly connected viewActive={workspacePanelVisible} key={recordService.sourceId+section} run={runs.find(r=>r.id===section.slice(5))!} onRefresh={()=>refreshSelectedRecords()} onError={onError}/>:<RunReview viewActive={workspacePanelVisible} draftScope={runDraftScope} legacyDraftScopes={workerSourceId?[legacyRunDraftScope]:[]} onOpenWorkflow={id=>void openToolWorkflow(id)} connected={worker&&!disconnected} key={section} run={runs.find(r=>r.id===section.slice(5))!} environments={environments} onRefresh={()=>refresh()} onError={onError} onReplace={replaceTask} theme={settings.theme}/>)}

     {section==='home'&&<div className="home-page">
      <div className="page-heading">
       <h1>{tr('计算工作区')}</h1>
       <Button variant="primary" className="home-new-computation" data-testid="new-computation" onClick={()=>void newConversation(true)}><Plus size={16} aria-hidden="true"/>{t('新建计算')}</Button>
      </div>
      {retainedTask&&<section className="continue-work">
       <h2>{t('继续工作')}</h2>
       <button className="home-row" aria-label={t('打开当前计算流程')+' · '+retainedTask.name} onClick={()=>go('agent-task:'+retainedTask.id)}>
        <GitBranch size={19} aria-hidden="true"/><span><strong>{retainedTask.name}</strong><small>{t(retainedTask.review?.status==='ready'?'参数已复核，等待运行设置':'流程草稿，等待完善与复核')}</small></span><ArrowUpRight size={16} aria-hidden="true"/>
       </button>
      </section>}
      {!hostedSummary&&!recordsConnected&&!(isSshResource(computeResource)&&computeResource.status==='selected'&&computeResource.processStatus==='running'&&computeResource.alive===true)&&
       <button className="home-connect home-row" onClick={openComputeResources} disabled={connecting}>
        <Server size={18} aria-hidden="true"/><span>{tr(connecting?'连接中…':'连接计算资源')}</span><ArrowUpRight size={16} aria-hidden="true"/>
       </button>}
      {recentConversations.length>0&&<section className="home-section">
       <div className="section-heading"><h2>{t('最近会话')}</h2><button onClick={()=>setModal('history')}>{t('历史会话')}<ChevronRight size={14} aria-hidden="true"/></button></div>
       <div className="recent-conversations">{recentConversations.map(conversation=>
        <button className="home-row" key={conversation.id} onClick={()=>void chooseConversation(conversation)}><MessageSquare size={16} aria-hidden="true"/><span>{conversation.name}</span><ChevronRight size={14} aria-hidden="true"/></button>
       )}</div>
      </section>}
      <section className="home-section">
       <div className="section-heading"><h2>{t('最近运行')}</h2><button onClick={()=>go('runs')}>{t('查看全部')}<ChevronRight size={14} aria-hidden="true"/></button></div>
       <div className="recent-runs">{allJobs.slice(0,5).map(job=>
        <button className="home-row" key={job.key} disabled={!canOpenRecord(job.location)} onClick={()=>void openJob(job)}>
         <Activity size={16} aria-hidden="true"/><span>{job.run.name}<small>{t(job.location==='cluster'?'集群':'本地')} · {job.run.engine}{(recordObservations[job.location].stale||recordObservations[job.location].sourceChanged)&&' · '+t('运行状态待核对')}</small></span><Badge status={job.run.status}/>
        </button>
       )}{!allJobs.length&&<p className="muted">{t(recordObservations.local.loaded&&recordObservations.cluster.loaded?'尚无运行记录':'尚未读取运行记录')}</p>}</div>
      </section>
      <Disclosure className="home-disclosure" variant="section" summary={t('按任务开始')}><TaskCards onOpen={openWorkflow}/><button className="text-button" onClick={()=>go('relations')}>{t('查看工具关系')}</button>{plans.length>0&&<div className="saved-plans">{plans.map(plan=><button key={plan.id} onClick={()=>go('plan:'+plan.id)}><GitBranch size={15}/>{plan.name}<small>{t('草稿 · 尚未执行')}</small></button>)}</div>}</Disclosure>
      <Disclosure className="home-disclosure" variant="section" summary={t('记录统计与高级入口')}>
       <div className="home-statistics">
        {!statusKnown&&<span className="muted" id="home-stat-observation">{t('运行状态待核对')}</span>}
        <HelpTip label={t('记录统计与高级入口')} content={t('统计包含当前作业服务已读取的本地与集群记录；连接中断时保留上次记录。')}/>
        <dl className="stat-grid" aria-describedby={statusKnown?undefined:'home-stat-observation'}>{['running','queued','succeeded','unknown'].map(status=><div className="stat" key={status}><dt>{statusLabel(status)}</dt><dd><strong>{statusKnown?allJobs.filter(job=>job.run.status===status).length:'—'}</strong></dd></div>)}</dl>
       </div>
       <Button disabled={!worker||!project} disabledReason={t(!worker?'作业服务未连接':'先选择或创建项目')} onClick={()=>newRun()}>{t('高级：原生计算草稿')}</Button>
      </Disclosure>
     </div>}
     {section==='tools'&&<div className="page tools-directory" data-testid="tools-directory">
      <div className="page-heading"><h1>{t('工具')}</h1></div>
      {!!pinnedTools.length&&<section className="tool-directory-group" data-testid="directory-pinned-tools">
       <h2>{t('常用工具')}</h2><div className="tool-directory-grid">{pinnedTools.map(tool=>
        <button type="button" key={tool.id} onClick={()=>go('tool:'+tool.id)}><ModuleIcon module={tool.id}/><strong>{t(tool.name)}</strong><ChevronRight size={16} aria-hidden="true"/></button>
       )}</div>
      </section>}
      {toolGroups.map(group=><section className="tool-directory-group" key={group.id}>
       <h2>{t(group.label)}</h2>
       <div className="tool-directory-grid">
        {group.tools.map(id=>{const tool=tools.find(value=>value.id===id)!;return <Tooltip asChild key={id} content={t(tool.description)}>
         <button data-testid={'open-tool-'+id} onClick={()=>go('tool:'+id)}><ModuleIcon module={id}/><strong>{t(tool.name)}</strong><ChevronRight size={16} aria-hidden="true"/></button>
        </Tooltip>;})}
        {group.pages.map(id=><button key={id} onClick={()=>go(id)}><ModuleIcon module={workspaceModule(id)}/><strong>{t(sections.find(value=>value[0]===id)?.[1]||id)}</strong><ChevronRight size={16} aria-hidden="true"/></button>)}
       </div>
      </section>)}
     </div>}
     {section==='bias'&&<div className="page"><div className="page-heading"><h1>{tr('Bias 实验室')}</h1></div>{(()=>{const current=agentTasks.find(task=>task.id===selectedConversationRef.current?.taskId);return current?<><button className="button" onClick={()=>setSection('agent-task:'+current.id)}>{tr('返回当前计算流程')}</button><PygasTaskComposer key={current.id+':'+(current.composition?.graphPath||'auto')} task={current} worker={worker} language={settings.language||'zh-CN'} onSaved={()=>refresh()} onError={onError} onDiscussion={askAgent} customCvInvoke={customCvInvoke} customProvider={agentProvider} onCustomDiscussion={request=>void discussCustomCv(request)} importAsset={importCompositionAsset}/></>:<div className="button-row"><button className="button" onClick={()=>setModal('history')}>{t('历史会话')}</button><button className="button primary" onClick={()=>{setAgentVisible(true);setPlanningMode(true);askAgent(tr('请基于我的实际体系准备 pyGAS CV/Bias 组合流程，使用已登记类库，展示参数供审阅；不构建、不运行。'));}}>{tr('开启任务规划')}</button></div>;})()}</div>}
     {section==='training'&&<div className="page training-page">
      <div className="page-heading"><h1>{tr('模型与训练')}</h1></div>
      <div className="model-grid">{['nep','hotpp'].map(engine=><section className="card" key={engine}>
       <h2>{engine==='nep'?<Atom size={21}/>:<Box size={21}/>} {engine==='nep'?'NEP':'HotPP'}</h2>
       <div className="button-row">
        <button className="button" disabled={!worker||!project} onClick={()=>newRun(engine+'.train')}>{t('训练')}</button>
        <button className="button" disabled={!worker||!project} onClick={()=>newRun(engine+'.eval')}>{t('独立测试')}</button>
        {engine==='hotpp'&&<span className="export-action"><button className="button" disabled={!worker||!project} onClick={()=>newRun('hotpp.export')}>{t('导出')}</button><HelpTip label={t('导出')} content={t('PyDyn 使用 HotPP 的 ase-* 导出格式。')}/></span>}
       </div>
      </section>)}</div>
      <RunTable items={trainingRuns} selected={selected} canOpen={canOpenRecord('local')} onOpen={run=>void openJob({key:'local:'+run.id,location:'local',run})} canPrepare={worker&&!!project} onPrepare={()=>newRun()}/>
     </div>}
     {section==='editor'&&<div className="editor-workspace">
      <div className="toolbar">
       <input value={editor.name} aria-label={tr('文件路径')} onChange={e=>setEditor({...editor,name:e.target.value})}/>
       <button className="button" disabled={!worker||!project||!!editorSave} onClick={()=>void saveInput().catch(onError)}><Save size={14}/>{tr('保存到项目输入')}</button>
       <button className="button" disabled={!!editorSave} onClick={()=>void saveInput('windows').catch(onError)}>{tr('另存到 Windows')}</button>
       <LoadingFeedback busy={!!editorSave} label={tr('正在保存输入文件…')}/>
       <HelpTip label={tr('打开源码')} content={tr('Python 源码不会在前端执行')}/>
      </div>
      <CodeEditor onLineSelection={setEditorLineRange} value={editor.source} onChange={v=>{if(v===editorSource.current)return;setEditor(old=>({...old,source:v}));setEditorDirty(true);}} theme={settings.theme}/>
      {editor.id&&!editorDirty&&<EvidenceSelection comparable range={editorLineRange} source={{kind:'editor',id:editor.id}} text={editor.source}/>}
      <div className="editor-path">{editor.path||t('未保存')}{editor.path&&editorDirty&&<span>{t('未保存')}</span>}</div>
     </div>}
     {section==='assets'&&<div className="page">
      <AssetInspector projectId={project?.id||''} environments={environments} worker={worker&&!disconnected} workerScope={assetWorkerScope} onSaved={()=>void refresh()}/>
      {projectAssets.length>0&&<ul className="asset-list registered-assets">
       {projectAssets.map(asset=><li className="asset-row" key={asset.id}>
        <Database size={17} aria-hidden="true"/><div><strong>{asset.name}</strong><small>{asset.path}</small></div><span className="tag">{asset.kind}</span><span className="mono">{asset.sha256.slice(0,12)}</span>
       </li>)}
      </ul>}
      <StructureBuilder projectId={project?.id||''} environments={environments} worker={worker&&!disconnected} workerScope={assetWorkerScope} onSaved={()=>void refresh()}/>
      <MaterialsProjectSearch projectId={project?.id||''} environments={environments} worker={worker&&!disconnected} workerScope={assetWorkerScope} onSaved={()=>void refresh()}/>
     </div>}
     {section==='environments'&&<ComputeEnvironments worker={worker&&!disconnected} workerGeneration={workerHydrationEpoch.current} environments={environments} onRefresh={()=>refresh()} onConnect={openComputeResources} onManual={newEnvironment} onAgent={askAgent} onCluster={openComputeResources} onError={onError}/>}
     {section==='compute-resources'&&<ComputeResourceConsole projectId={projectId} onConnections={openComputeResources} onConnectSsh={connectConsoleSsh} onOpenTerminal={openConsoleTerminal} onOpenConversation={channel=>void openConsoleConversation(channel)} onWorkspace={openConsoleWorkspace} onUseForWorkflow={resource=>usePublishedWorkflow({connectionId:resource.connectionId!,profileId:resource.profileId,profileVersion:resource.profileVersion})} onTools={openResourceTools} onGuide={openResourceGuide} onConfigure={(resource,section)=>configureTerminalSsh({profileId:resource.profileId,profileVersion:resource.profileVersion,section},resource.connectionId||undefined)}/>}
     {section==='ssh'&&<ClusterPage key={clusterSettingsSource||workerHydrationEpoch.current} sourceId={clusterSettingsSource} workerGeneration={workerHydrationEpoch.current} visible={workspacePanelVisible} selectedClusterId={clusterSelection||undefined} serviceVersion={serviceVersion} onAuthenticate={openSshGuide} onConnectCompute={connectWorker} worker={worker&&!disconnected} project={project} settings={settings} draft={clusterDraft} onQueueTest={async text=>{await newConversation(true,text);}} onError={onError} onRefresh={()=>void refresh()} onAgent={askAgent} onRun={id=>setSection('cluster-run:'+id)} onTerminal={startClusterTerminal}/>}
     {section==='extensions'&&<div className="page"><ToolPackagesPanel provider={agentProvider} onSelect={selectToolSkill}/></div>}
     {section==='skills'&&<><div className="skill-navigation"><button className="button" onClick={()=>go('relations')}>{t('计算链条')}</button><button data-testid="navigate-tools" className="button" onClick={()=>go('tools')}>{t('软件功能')}</button></div><SkillsWorkbench provider={agentProvider} settings={settings} onSaved={setSettings} selected={skill} onSelect={selectToolSkill} onError={onError}/></>}
     {section.startsWith('task:')&&(!runSourceReady||!runs.some(r=>r.id===section.slice(5)))&&<div className="page" data-testid="run-record-unavailable" data-observed={runSourceReady?'current':'unconfirmed'}><EmptyState title={runSourceReady?'当前连接未返回此记录':'运行记录尚待核对'} body={runSourceReady?'当前连接已读取运行列表，但未返回此记录。请核对原作业服务；此提示不代表记录已被删除。':'尚未取得当前服务的运行记录。恢复原作业服务后再核对，当前页面将保留。'} action={<Button disabled={connecting} disabledReason={t('处理中…')} onClick={()=>worker?void refresh():void connectWorker()}>{tr(worker?'同步记录':'连接 WSL')}</Button>}/></div>}
     {entityMissing&&<div className="page"><EmptyState title="找不到该页面" body="内容尚未加载或已不存在。" action={<Button onClick={()=>go('home')}>{tr('返回工作台')}</Button>}/></div>}
    </ViewBoundary></div>
    {bottomExpanded&&<PaneDivider pane="bottom" className="bottom-resize" label={t('调整终端与队列高度')} orientation="horizontal" value={bottomHeight} min={90} max={380} reverse onChange={setBottomHeight}/>}
    <div className={"bottom-panel "+(bottomExpanded?'':'is-collapsed')} data-testid="bottom-panel" style={bottomExpanded?{'--bottom-height':bottomHeight+'px'} as React.CSSProperties:undefined}><div className="bottom-tabs"><button className={bottomTab==='queue'?'active':''} onClick={()=>{setBottomTab('queue');setBottomExpanded(true);}}><Activity size={13}/>{tr("运行队列")}<span>{queueStatusKnown?queueItems.length:'?'}</span></button><button className={bottomTab==='terminal'?'active':''} onClick={()=>{setTerminalOpened(true);setBottomTab('terminal');setBottomExpanded(true);}}><Terminal size={13}/>{tr("终端")}</button><div/><button hidden={!bottomExpanded} onClick={()=>void startTerminal()}><Plus size={13}/>{t('本地终端')}</button><Tooltip asChild content={t('打开源码')}><button hidden={!bottomExpanded} aria-label={t('打开源码')} onClick={()=>void openEditorFile()}><FileCode2 size={14} aria-hidden="true"/></button></Tooltip><Tooltip asChild content={t('切换底部任务与终端面板')+' · '+shortcutLabel('bottom')}><button className="bottom-collapse" data-testid="toggle-bottom-panel" aria-expanded={bottomExpanded} aria-keyshortcuts="Control+J" onClick={toggleBottomPanel}>{bottomExpanded?<ChevronDown size={15}/>:<ChevronUp size={15}/>}<span>{t(bottomExpanded?'收起':'展开')}</span></button></Tooltip></div><div className={bottomTab==='queue'?'queue-strip':'hidden'}>{queueItems.length?queueItems.map(job=><button key={job.key} disabled={!canOpenRecord(job.location)} onClick={()=>void openJob(job)}><span className="queue-pulse"/><strong>{job.run.name}</strong><Badge status={job.run.status}/><span>{job.location==='cluster'?t('集群'):'GPU '+job.run.gpu}</span><ChevronRight size={13}/></button>):<div className="queue-empty">{queueStatusKnown?<CheckCircle2 size={18}/>:<Activity size={18}/>}<span>{tr(queueStatusKnown?'队列空闲':'状态未知')}</span><small>{hostedSummary?t('在计算资源中核对托管作业服务'):tr(workerNotice||(disconnected?'连接中断 · 状态未知':worker?'准备并验证输入后开始计算':'连接 WSL 作业服务以读取队列'))}</small></div>}</div><div className={bottomTab==='terminal'?'terminal-holder':'hidden'}>{terminalOpened&&<ViewBoundary title={t('共享终端面板暂时无法显示')}><SharedTerminalPanel activeResource={computeResource} visible={terminalPanelVisible} request={terminalRequest} canShare={!agentBusy&&!sessionSelection?.pending} provider={agentProvider} draftForHandoff={draftForTerminalHandoff} onConversationPrepared={terminalConversationPrepared} onConfigureSsh={configureTerminalSsh} onServiceEnvironmentHelp={helpWithSshServiceEnvironment} onHandoffLesson={moveHandoffLesson} onUseForWorkflow={usePublishedWorkflow} onPlainSsh={()=>setTerminalRequest(old=>old?{...old,nonce:crypto.randomUUID(),connectionMode:"plain"}:old)} resourceScope={computeResourceScope} onResourceChange={acceptComputeResource} onError={onTerminalError}/></ViewBoundary>}</div></div>
    <footer className="statusbar">
     {managedPending&&<span role="status" data-testid="managed-resources-pending">{t('托管资源状态待核对')} <button type="button" className="text-button" onClick={managed.retry}>{t('重试')}</button></span>}
     {refreshFeedback?.status==='loading'&&<LoadingState inline label={t('正在同步记录…')} data-testid="manual-refresh-feedback"/>}
     {refreshFeedback&&(refreshFeedback.status==='partial'||refreshFeedback.status==='failed')&&
      <span role="status" data-testid="manual-refresh-feedback">{t(refreshFeedback.status==='partial'?'部分记录未刷新':'记录刷新失败')}{refreshFeedback.at&&' · '+new Date(refreshFeedback.at).toLocaleTimeString()}</span>}
     <span data-testid="current-compute-resource-status"><i className={resourceOnline?'online':''}/>{hostedSummary|| (isSshResource(computeResource)?computeResource.kind==='ssh-connection'?sshSummary(computeResource):<>{tr(computeResource.workflowReady?'SSH 作业服务已连接':computeResource.processStatus==='exited'?'SSH 终端已退出':computeResource.processStatus==='expired'?'SSH 终端访问已过期':computeResource.processStatus==='running'&&computeResource.alive===true?'SSH 终端已打开':'SSH 终端状态未知')}{computeResource.alive===true&&' · '+tr(computeResource.operator==='human'?'由你操作':computeResource.operator==='agent'?'由 Agent 操作':'操作权限待核对')}</>:tr(workerNotice||(disconnected?'连接中断 · 状态未知':worker?(serviceVersion==='current'?'WSL 已连接':serviceVersion==='different'?'WSL 已连接 · 服务版本不同':'WSL 已连接 · 服务版本未核对'):'WSL 未连接')))}</span>
     {runProject&&<span>{runProject.authoring_only?tr('草稿工作区 · 执行需选择计算项目'):runProject.policy.gpus.map(g=>'GPU '+g).join(', ')+' · '+tr('项目授权')}</span>}
    </footer>
   </main>
   {<>{agentVisible&&<PaneDivider pane="agent" className="agent-divider" label={t('调整对话与内容比例')} value={displayAgentWidth} min={260} max={paneMax} reverse={!centerLayout} onChange={conversationWorkspace?setAgentWidth:setOverviewAgentWidth}/>} <ViewBoundary title={t('Agent 对话面板暂时无法显示')}><Agent {...localConversationProps} attentionTarget={!modal&&!command&&!guideShowing?attentionTarget:undefined} activity={selectedLocalConversation&&!modal&&!command&&!guideShowing?activityByConversation.get(selectedLocalConversation.id):undefined} setupProviderChoice={guideProvider} onSetupReply={setGuideReply} onOpenHistory={()=>setModal('history')} onCollapse={()=>setAgentVisible(false)} visibleWorkflowId={workspacePanelVisible&&section.startsWith('agent-task:')&&agentTasks.some(task=>task.id===section.slice(11))?section.slice(11):null} onOpenOriginalRun={id=>openWorkflowRun(id,'cluster',activeFlow)} onOpenCluster={()=>{setClusterSelection(null);go('ssh');}} computeConnected={worker&&!disconnected} computeResource={computeResource} workspaceProfileId={flowWorker?.kind==="ssh"?flowWorker.profileId:undefined} onComputeResource={acceptComputeResource} onConnectCompute={openComputeResources} onReviewWorker={connectWorker} conversationGroupId={chatGroupId} onOpenAccounts={openAccounts} onProviderChange={setAgentProvider} onAttachmentClear={()=>setSkill(undefined)} onAttachmentConsumed={id=>setSkill(current=>current?.attachmentId===id?undefined:current)} onNewConversation={retryNewConversation} hidden={!agentPanelVisible} sessionSelection={sessionSelection} onConversation={acceptConversationWithToolPlan} onReviewResourceTool={canReviewToolSetup?()=>setToolSetup(toolSetupReview):undefined} missingWorkflowToolQuestion={pendingWorkflowTool?{...pendingWorkflowTool,onAnswer:action=>{setWorkflowToolQuestion(previous=>previous?.id===pendingWorkflowTool.id?null:previous);if(action==='setup')openMissingResourceTool(activeFlow,pendingWorkflowTool.tool);}}:undefined} onBusyChange={setAgentBusy} planningMode={planningMode} onPlanningModeChange={setPlanningMode} projectId={projectId} onOpenTask={id=>{setSection('agent-task:'+id);setAgentVisible(true);}} intent={agentIntent} context={context} onError={onError} skill={skill} width={displayAgentWidth} onOpenRun={id=>openWorkflowRun(id,'local',activeFlow)}/></ViewBoundary></>}
  </div></section></div>
  {guidePage&&guideInfo&&<div className="setup-layer" hidden={!!lesson}><SetupAssistant info={guideInfo} page={guidePage} settings={settings} localConnected={!isSshResource(computeResource)&&worker&&!disconnected} resource={computeResource} clusterGuide={clusterGuide} agentBusy={agentBusy} reply={guideReply} onReply={setGuideReply} onPreferences={guidePreferences} onProgress={guideProgress} onConnect={connectFromGuide} onVisit={visitFromGuide}/></div>}
  {toolSetup&&(!toolSetup.conversationId||selectedConversationId===toolSetup.conversationId)&&<div hidden={!!toolSetupReturn}><Modal title={t('配置资源工具')} wide onClose={()=>closeResourceTools()}>
   <ResourceToolSetup key={`${toolSetup.profileId}:${toolSetup.profileVersion}:${toolSetup.taskId||''}`} resourceId={'ssh:'+toolSetup.profileId} profileVersion={toolSetup.profileVersion} resourceName={toolSetup.name} initialRoute={toolSetup.route} missingTool={toolSetup.missing} newPlanAfter={toolSetup.newPlanAfter} suspended={!!toolSetupReturn} onClose={()=>closeResourceTools(true)} onDiscuss={discussResourceTool} onConfigureTarget={configureResourceToolTarget} onRoute={route=>{setToolSetup(old=>old?.profileId===toolSetup.profileId&&old.profileVersion===toolSetup.profileVersion?{...old,route}:old);if(guidePage&&lesson?.destination==='resource-tools')rememberCluster(toolSetup,'resource-tools',route);}}/>
  </Modal></div>}
  {deleteTarget&&<ConfirmDialog title={t('删除对话')} target={deleteTarget.name}
   consequence={t('删除此会话及附带流程页面。已提交作业和计算文件保留。')} confirmLabel={t('确认删除')} tone="danger"
   pending={deleting} disabled={replying(deleteTarget)} onConfirm={()=>void deleteConversation()} onCancel={()=>{if(!conversationDeletion.current)setDeleteTarget(null);}}/>}
  {modal==='history'&&<Modal title={t('历史会话')} onClose={()=>{setModal('');setSearchHistoryBody(false);}}>
   {historyEnabled&&<button className="text-button" type="button" aria-expanded={searchHistoryBody} onClick={()=>setSearchHistoryBody(previous=>!previous)}>{t(searchHistoryBody?'搜索会话':'搜索聊天正文')}</button>}
   {historyEnabled&&searchHistoryBody?<><p className="muted">{project?.name||t('未绑定项目')}</p><ConversationHistorySearch scope={{projectId:projectId||null}} conversations={conversations} onOpen={anchor=>void openHistoryLocation(anchor)}/></>:<>
    <label className="conversation-search"><Search size={16}/><input autoFocus aria-label={t('搜索历史会话')} placeholder={t('搜索会话')} value={conversationSearch} onChange={event=>setConversationSearch(event.target.value)}/></label>
    <div className="history-conversations conversation-sidebar">{shownConversations.map(conversationRow)}{!shownConversations.length&&!archivedConversations.length&&<p className="muted">{t('没有匹配的会话')}</p>}{!!archivedConversations.length&&<Disclosure variant="section" summary={t('已归档会话')}>{archivedConversations.map(conversationRow)}</Disclosure>}</div>
   </>}
   <button className="button" onClick={()=>{setModal('');setSearchHistoryBody(false);newConversation();}}><Plus size={16}/>{t('新对话')}</button>
  </Modal>}
  {groupDeleteTarget&&<ConfirmDialog title={t('删除会话分组')} target={groupDeleteTarget.name}
   consequence={t('组内会话将保留在“未分组会话”中，计算流程与运行记录保留。')} confirmLabel={t('删除分组')} tone="danger"
   pending={groupDeleting} onConfirm={()=>void deleteConversationGroup()} onCancel={()=>{if(!groupDeletion.current)setGroupDeleteTarget(null);}}/>}
  {modal==='chat-project'&&<Modal title={t('新建会话分组')} onClose={()=>setModal('')}><label>{t('分组名称')}<input autoFocus aria-label={t('会话分组名称')} value={groupName} onChange={e=>setGroupName(e.target.value)} maxLength={60}/></label><p className="muted">{t('分组仅用于整理会话；计算项目负责执行范围与授权。')}</p><button className="button primary" disabled={busy||!groupName.trim()} onClick={()=>void createChatGroup()}>{t('创建分组')}</button></Modal>}
  {command&&<Modal title={tr("搜索与命令")} onClose={closePalette}><input autoFocus aria-label={tr("搜索页面、引擎或任务…")} placeholder={tr("搜索页面、引擎或任务…")} value={paletteSearch} onChange={e=>setPaletteSearch(e.target.value)}/><div className="command-list">{computeConnectionCommandMatches(paletteSearch)&&<button disabled={connecting} onClick={()=>{setCommand(false);setPaletteSearch('');setComputeChooser(true);}}><Server size={17}/>{settings.language==='en'?'Connect compute resources…':t('连接计算资源…')}<ChevronRight size={13}/></button>}<ConversationCommands query={paletteSearch} blocked={paletteBlocked} onDismiss={closePalette} onNewConversation={newConversation} onShowConversations={()=>{setModal('history');}}/>
    {(['sidebar','bottom','settings','help'] as const).filter(id=>
     [workspaceShortcuts[id].label,t(workspaceShortcuts[id].label),shortcutLabel(id)].some(label=>label.toLowerCase().includes(paletteSearch.trim().toLowerCase()))
    ).map(id=><button key={id} disabled={paletteBlocked} onClick={()=>{closePalette();shortcutActions[id]();}}>
     {t(workspaceShortcuts[id].label)}<kbd aria-hidden="true">{shortcutLabel(id)}</kbd>
    </button>)}
{sections.filter(s=>tr(s[1]).toLowerCase().includes(paletteSearch.toLowerCase())||s[0].includes(paletteSearch.toLowerCase())).map(([id,label,Icon])=><button key={id} onClick={async()=>{if(await go(id==='home'&&retainedTask?'agent-task:'+retainedTask.id:id))closePalette();}}><Icon size={17}/>{tr(label)}<ChevronRight size={13}/></button>)}{allJobs.filter(job=>job.run.name.toLowerCase().includes(paletteSearch.toLowerCase())).slice(0,8).map(job=><button key={job.key} disabled={!canOpenRecord(job.location)} onClick={()=>{void openJob(job);setCommand(false);setPaletteSearch('');}}><Activity size={17}/>{job.run.name}<Badge status={job.run.status}/></button>)}{conversations.filter(conversation=>conversationMatches(conversation,paletteSearch)).slice(0,8).map(conversation=><button key={'conversation:'+conversation.id} onClick={()=>{void chooseConversation(conversation);setCommand(false);setPaletteSearch('');}}><MessageSquare size={17}/>{conversation.name}<ChevronRight size={13}/></button>)}{tools.filter(tool=>t(tool.name).toLocaleLowerCase().includes(paletteSearch.toLocaleLowerCase())).map(tool=><button key={'tool:'+tool.id} onClick={async()=>{if(await go('tool:'+tool.id))closePalette();}}><ModuleIcon module={tool.id}/>{t(tool.name)}<ChevronRight size={13}/></button>)}<WorkbenchImageCommand query={paletteSearch} busy={imageSaving} onDismiss={closePalette} onBusy={setImageSaving} onSaved={setImageReceipt} onError={onError}/></div></Modal>}
  {modal==='shortcuts'&&<Modal title={t('键盘快捷键')} onClose={()=>setModal('')}>
   <dl className="workspace-shortcut-list" data-testid="workspace-shortcuts">
    {(Object.keys(workspaceShortcuts) as WorkspaceShortcut[]).map(id=><div key={id}>
     <dt>{t(workspaceShortcuts[id].label)}</dt><dd><kbd>{shortcutLabel(id)}</kbd></dd>
    </div>)}
    <div><dt>{t('关闭当前浮层')}</dt><dd><kbd>Esc</kbd></dd></div>
   </dl>
  </Modal>}
  {imageReceipt?.status==='saved'&&<Modal title={t('工作台图像已保存')} onClose={()=>setImageReceipt(null)}><p>PNG · {imageReceipt.width} × {imageReceipt.height} · {imageReceipt.bytes} bytes</p><p className="mono">{imageReceipt.path}</p><small className="mono">SHA256 · {imageReceipt.sha256}</small><button className="button" onClick={()=>setImageReceipt(null)}>{t('关闭')}</button></Modal>}
  {cliRequired&&<CliRuntimeDialog provider={cliRequired.provider} readiness={cliRequired} onClose={()=>setCliRequired(null)} onReady={()=>{const provider=cliRequired.provider;setCliRequired(null);openAccounts(provider);}}/>}
  {modal==='accounts'&&<Modal title={t('账号与 API')} onClose={()=>setModal('')}><AccountCenter provider={accountsProvider} busy={agentBusy} onError={onError}/></Modal>}
  {renameTarget&&<Modal title={t('重命名会话')} onClose={()=>{if(!renaming)setRenameTarget(null);}}><label>{t('会话简称')}<input autoFocus data-testid="conversation-name" maxLength={60} value={conversationName} disabled={renaming} onChange={e=>setConversationName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)void renameConversation();}}/></label><div className="button-row"><button className="button" disabled={renaming} onClick={()=>setRenameTarget(null)}>{t('取消')}</button><button className="button primary" disabled={renaming||!conversationName.trim()} onClick={()=>void renameConversation()}>{t('保存名称')}</button></div></Modal>}
  {modal==='projects'&&<Modal title={t('计算项目')} onClose={()=>setModal('')}><section data-testid="project-management"><div className="project-management-actions"><button className="button primary" data-testid="new-project" onClick={newProject} disabled={!worker||disconnected||busy}><Plus size={15}/>{t('新建计算项目')}</button><button className="button" data-testid="project-compute-resources" onClick={()=>{setModal('');openComputeConsole();}}><Server size={15}/>{t('计算资源')}</button></div><div className="project-management-list">{projects.map(p=><div key={p.id} className={'project-management-row '+(projectId===p.id?'current-project':'')}><button className="project-management-select" aria-label={projectLabel(p)} onClick={()=>{setSkill(undefined);setProjectId(p.id);setModal('');}}><ModuleIcon module="project"/><span><strong>{projectLabel(p)}</strong><small>{t(p.authoring_only?'草稿工作区':'计算项目')}{projectId===p.id?' · '+t('当前项目'):''}</small></span></button>{!p.authoring_only&&<button className="button" aria-label={t('计算权限设置')+' · '+p.name} disabled={!worker||disconnected||busy} onClick={()=>void editProjectPolicy(p)}><SettingsIcon size={15}/>{t('计算权限设置')}</button>}</div>)}{!projects.length&&<p className="project-management-empty">{t('尚无项目')}</p>}</div></section></Modal>}
  {modal==='project-edit'&&<Modal title={t('计算权限设置')} wide onClose={closeProjectPolicy}><Disclosure className="project-technical-id" summary={t('项目标识')}><code>{projectPolicyId}</code></Disclosure>{projectPolicyError?<Notice severity="error">{projectPolicyError}</Notice>:projectPolicyInitial?<ProjectAuthorizationForm key={projectPolicyId} resource={projectToolResource} suggestedInputRoot={toolProjectDefaults?.root} suggestedSchedulerId={toolProjectDefaults?.schedulerId} environments={environments} busy={busy} initialSpec={projectPolicyInitial} onCancel={closeProjectPolicy} onSubmit={saveProjectPolicy}/>:<LoadingFeedback busy label={t('正在读取当前项目授权…')}/>}</Modal>}
  {modal==='project'&&<Modal title={t('新建计算项目')} wide closeDisabled={busy} onClose={()=>setModal('projects')}><ProjectAuthorizationForm resource={projectToolResource} environments={environments} busy={busy} onCancel={()=>setModal('projects')} suggestedEnvironmentId={agentTasks.find(task=>task.id===selectedConversationRef.current?.taskId)?.authoring?.environmentId} suggestedInputRoot={toolProjectDefaults?.root||agentTasks.find(task=>task.id===selectedConversationRef.current?.taskId)?.authoring?.inputRoot} suggestedSchedulerId={toolProjectDefaults?.schedulerId} onSubmit={async spec=>{setBusy(true);try{const value=await toolProjectRequest<Project>('POST',spec);setProjectId(value.id);setModal('');await refresh();}catch(error){throw Error(policyError(error));}finally{setBusy(false);}}}/></Modal>}
  {modal==='environment'&&<Modal title={tr("注册独立科学环境")} wide onClose={()=>setModal('')}>
   <p className="muted">{tr("填写 Linux 绝对路径。executables 支持 python、gpumd、gpu-sampling、nep、hotpp、pygas；repositories 支持 pydyn、pygas、hotpp。")}</p>
   <Field label={t('高级 JSON 配置')} error={environmentJsonError}>
    {props=><textarea {...props} className="json-input" value={environmentDraft} onChange={e=>{setEnvironmentDraft(e.target.value);setEnvironmentJsonError('');}}/>}
   </Field>
   <Button variant="primary" loading={busy} disabledReason={t('处理中…')} onClick={()=>void saveEnvironment()}>{tr("保存环境")}</Button>
  </Modal>}
  {modal==='run'&&<Modal title={tr("高级：原生计算草稿")} wide onClose={()=>setModal('')}>
   <div className="form-row">
    <label>{tr("计算名称")}<input disabled={runDirty} value={runDraft.name||''} onChange={e=>setRunDraft({...runDraft,name:e.target.value})}/></label>
    <label>{tr("引擎")}<select disabled={runDirty} value={runDraft.engine||''} onChange={e=>changeEngine(e.target.value)}>{engines.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
   </div>
   <div className="form-row">
    <label>{tr("计算环境")}<select disabled={runDirty} value={runDraft.environment_id||''} onChange={e=>setRunDraft({...runDraft,environment_id:e.target.value})}><option value="">{tr("选择环境")}</option>{environments.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    <label>{t('GPU 编号')}<input disabled={runDirty} type="number" min={0} value={runDraft.gpu??''} onChange={e=>setRunDraft({...runDraft,gpu:Number(e.target.value)})}/></label>
    <label>{tr("时长上限 · s")}<input disabled={runDirty} type="number" min={1} value={runDraft.max_seconds??''} onChange={e=>setRunDraft({...runDraft,max_seconds:Number(e.target.value)})}/></label>
   </div>
   <Field label={tr("完整任务描述 · inputs 是运行目录文件名 → 已授权源文件路径")} error={runJsonError&&t(runJsonError)}>
    {props=><textarea {...props} className="json-input" value={runJson} onChange={e=>{setRunJson(e.target.value);setRunJsonError('');}}/>}
   </Field>
   {runDirty&&<div className="button-row"><Button variant="primary" onClick={applyRunJson}>{tr('应用 JSON')}</Button><span className="muted">{tr('存在未应用的 JSON 修改')}</span></div>}
   <p className="muted">{tr("采样任务需 bias_file、structure_file、cv_size、cutoff 和 mode。输入复制到独立目录；检查结果单独记录，可在授权范围内提交。")}</p>
   <Button variant={runDirty?'secondary':'primary'} disabled={busy||runDirty}
    disabledReason={t(runDirty?'存在未应用的 JSON 修改':'正在创建输入快照…')}
    onClick={async()=>{setBusy(true);try{const r=await api('POST','/api/runs/prepare',{spec:runDraft});void openTask(r.id);setModal('');await refresh();}catch(e){onError(e);}finally{setBusy(false);}}}>
    {tr("创建输入快照与草稿")}
   </Button>
  </Modal>}
  {modal==='updates'&&<Modal title={t('软件更新')} onClose={()=>setModal('')}><SoftwareUpdate {...updates}/></Modal>}
  {modal==='settings'&&<Modal title={t('工作台设置')} wide closeDisabled={settingsSaving} onClose={closeSettings}><SettingsPage layoutKey={layoutKey} updates={updates} onOpenComputeResources={openComputeConsole} onOpenLocalCompute={openLocalCompute} onOpenSshCompute={openSshConfiguration} onOpenProjects={openProjects} onOpenSkills={()=>{if(settingsSavingRef.current)return;closeSettings();setSection('skills');}} settings={settings} onChange={setSettings} onClose={closeSettings} onSavingChange={saving=>{settingsSavingRef.current=saving;setSettingsSaving(saving);}} onSaved={rememberSavedSettings} onError={onError}/></Modal>}
  {guideShowing&&computeChooser&&guideKind&&<GuideSpotlight key={'choose-'+guideKind} step={guideKind==='ssh'?'choose-ssh':'choose-wsl'} english={settings.language==='en'}/>}
  {guideShowing&&computeGuide&&<GuideSpotlight key={computeGuide.id} step="wsl" english={settings.language==='en'}/>}
  {computeChooser&&<ComputeConnectionChooser preferredKind={guideShowing?guideKind:undefined} initialEdit={computeChooserEdit} suggestedWorkfileRoot={toolSchedulerDefaults?.root} onSchedulerSaved={rememberToolScheduler} activeResource={computeResource} managedResources={managed.resources} managedPending={managedPending} connectionBusy={connecting} onLocal={connectSavedLocal} onSsh={connectSavedSsh} onManageSsh={openSshConfiguration} onOpenResourceConsole={guideShowing?undefined:openComputeConsole} onServiceChange={()=>void refreshComputeResource()} onProfileSaved={observeSavedSshProfile} onServiceEnvironmentHelp={helpWithSshServiceEnvironment} onClose={()=>{setComputeChooser(false);setComputeChooserEdit(undefined);setGuideKind(undefined);}} localConnected={worker&&!disconnected}/>}
  {sshGuide&&<SshConnectionGuide request={sshGuide.request} language={settings.language} onClose={()=>closeSshGuide()} onWorkerUpdate={sshGuide.standalone?undefined:()=>{if(conversationSelectionSeq.current!==sshGuide.selectionSeq||selectedConversationRef.current?.id!==sshGuide.conversationId)return;return connectWorker(sshGuide.taskId);}}/>}
  {computeGuide&&<ComputeConnectionGuide key={computeGuide.id} taskId={computeGuide.taskId} profile={computeGuide.profile} language={settings.language} onConnectStart={()=>{if(computeGuideRequest.current?.id===computeGuide.id){beginWorkerGate();setWorkerRestoring(false);}}} onClose={connected=>closeComputeGuide(computeGuide.id,connected)}/>}

  <CodexEnvImportDialog/>
 </div></EvidenceConversation.Provider>;
}
