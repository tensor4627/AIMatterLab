export type RunStatus='draft'|'validating'|'ready'|'queued'|'running'|'succeeded'|'failed'|'cancelled'|'unknown';
export interface Project {authoring_only?:boolean;authoring_task_id?:string;id:string;name:string;policy:{engines:string[];gpus:number[];max_seconds:number;max_concurrent:number;input_roots:string[];environments:string[];clusters?:string[]}}
export interface Environment {id:string;name:string;executables:Record<string,string>;repositories?:Record<string,string>;variables?:Record<string,string>}
export interface Run {superseded_by?:string;revision_of?:string;id:string;name:string;engine:string;project_id:string;environment_id:string;status:RunStatus;gpu:number;max_seconds:number;directory:string;validation:{status:string;message?:string;output?:string;scope?:string;scientific_status?:string;artifact_status?:string};created_at:number;updated_at:number;command:string[];parameters?:Record<string,unknown>;inputs:Record<string,string>;error?:string;exit?:{exit_code:number;reason?:string}}
export interface Workflow {id:string;project_id:string;name:string;steps:unknown[];run_ids:string[]}
export interface Artifact {id:string;name:string;path:string;kind:string;sha256:string;size:number;metadata?:Record<string,unknown>}
export type AgentProvider='codex'|'kimi'|'qwen'|'deepseek'|'compatible';
export interface AgentConnectRequest {provider:AgentProvider;repairTools?:boolean}
export interface AgentRpcRequest extends AgentConnectRequest {method:string;params?:Record<string,unknown>}
export type SkillAttachment={attachmentId:string;name:string}&({functionId:string;path?:never}|{path:string;functionId?:never});
export interface ScientificSkillFunction {id:string;title?:string;phase:string;engines:string[];tools:string[];status:string;sources:string[];permission:'allowed'|'permission_required';source_status:'registered'|'unregistered'}
export interface ScientificSkillCatalog {schema_version:1;functions:ScientificSkillFunction[];sharing:Record<string,AgentProvider[]>;source_scope:string}
export interface Settings {autoDiscoverCompute?:boolean;scientificSkillProviders?:Record<string,AgentProvider[]>;pygasSkillProviders?:AgentProvider[];projectAgents?:Record<string,AgentProvider>;agentLayout?:'right'|'center';agentProvider?:AgentProvider;kimiPath?:string;qwenPath?:string;agentProviders?:Partial<Record<AgentProvider,{contextWindow?:number;compactLimit?:number;effort?:string}>>;distribution:string;workerRoot:string;workerPort:number;codexPath:string;cwd:string;sourceRoots?:string[];sourceIds?:string[];skillRoots:string[];theme:string;language?:'zh-CN'|'en';fontFamily?:string;fontSize?:number;minimumFontSize?:number;chatFontSize?:number;editorFontSize?:number;terminalFontSize?:number;agent?:{contextWindow?:number;compactLimit?:number;effort?:string}}
export interface RpcEvent {provider?:AgentProvider;method:string;id?:string|number;params:any}
export interface Studio {invoke<T=any>(method:string,data?:unknown):Promise<T>;onEvent(callback:(event:RpcEvent)=>void):()=>void;onTerminal(callback:(event:{id:string;data?:string;closed?:boolean})=>void):()=>void}
export type ConversationRecovery={status:'required';oldThreadId:string}|{status:'recovered';oldThreadId:string;conversation:Conversation};
export type ConversationRecoveryRequest={provider:'codex';threadId:string;model?:string};
export interface ConversationResumeResult {thread?:{id:string;turns?:unknown[]};studioRecovery?:ConversationRecovery}
export const recoverConversation=(request:ConversationRecoveryRequest)=>invoke<ConversationResumeResult>('agent.recover',request);
declare global {interface Window {studio?:Studio}}
export async function invoke<T=any>(method:string,data?:unknown):Promise<T>{
  if(!window.studio) throw new Error('此页面是浏览器预览。请从 Electron 桌面应用连接计算环境。');
  return window.studio.invoke<T>(method,data);
}
export const api=<T=any>(method:string,target:string,data?:unknown)=>invoke<T>('worker.request',{method,target,data});
export interface WorkerStatus {status:'connected'|'disconnected'|'unknown'|'checking';checkedAt:number;taskId?:string;conversationId?:string;scope?:'global';serviceVersion?:'current'|'different'|'unconfirmed';reason?:string}
export const readWorkerStatus=()=>invoke<WorkerStatus>('worker.status');
export const restoreWorker=(owner:string|{conversationId:string}|{scope:'global'})=>invoke<WorkerStatus>('worker.restore',typeof owner==='string'?{taskId:owner}:owner);
export interface ComputeConnectionView {planId:string|null;status:string;phase:string;scope?:'task'|'saved-global'|'global';taskId?:string|null;ownerName?:string|null;locked?:boolean;needsLegacyPort?:boolean;portSource?:'unknown'|'saved'|'verified'|'human-confirmed';canChooseSource?:boolean;canUpdate?:boolean;distributions?:string[];target?:{distribution:string;root:string;port:number|null}|null;connection:string;discovery:string;scientificValidation?:'not_run';serviceVersion?:string;resolvedRoot?:string;mode?:string;environments?:number;finished:boolean;error?:{code:string;message:string}}
export function wslPath(path:string){return /^[a-z]:[\\/]/i.test(path)?'/mnt/'+path[0].toLowerCase()+'/'+path.slice(3).replaceAll('\\','/'):path}
export const engines=[
 ['gpumd.neb','GPU-Sampling · NEB'],['gpumd.md','GPUMD · 传统 MD'],['pydyn.md','PyDyn · 传统 MD'],['pygas.build','pyGAS · Bias 构建'],
 ['bias.validate','pyGAS · 产物验证'],['gpumd.sampling','GPUMD · GPU-Sampling'],['pydyn.sampling','PyDyn · pyGAS'],
 ['nep.analyze','NEP · 回归图'],['nep.train','NEP · 训练'],['nep.eval','NEP · 测试'],['hotpp.train','HotPP · 训练'],
 ['hotpp.eval','HotPP · 测试'],['hotpp.export','HotPP · 模型导出'],['pygas.reweight','WTMetaD · 重加权'],
 ['pygas.opes-reweight','OPES · 重加权']
];

export interface ClusterRun {id:string;kind:'cluster-run';name:string;engine:string;project_id:string;cluster_id:string;status:RunStatus;directory:string;parameters?:Record<string,unknown>;inputs:Record<string,string>;resources:any;max_seconds:number;cluster:any;script:string;job_id:string|null;validation:any;scientific_validation:any;snapshots:{name:string;source:string;sha256:string;size:number}[]}

export interface Conversation {groupId?:string|null;pinned?:boolean;id:string;provider:AgentProvider;threadId:string;name:string;projectId:string|null;taskId:string|null;updatedAt:number}
export interface AgentIntent {id:string;text:string;autoSend?:boolean;taskId?:string;reviewMode?:boolean;threadId?:string;provider?:AgentProvider}

export interface TaskEditRequest {id:string;changes:Record<string,unknown>}
export interface TaskExecuteRequest {taskId:string;artifactId:string;inputReceipt?:string}
export interface TaskLinkRunRequest {taskId:string;runId:string;kind:'run'|'cluster-run'}

export interface TaskInputReadRequest {taskId:string;path:string}
export interface TaskInputReadResult {path:string;sha256:string;size:number;text?:string;binary?:boolean;truncated?:boolean;reason?:string}
export interface PygasExpectedInputs {journal_sha256:string|null;files:Record<string,string|null>}
export interface PygasComposition {id:string;graphPath:string;sourcePath:string;status:'rendered'|'draft'|'blocked';expected:PygasExpectedInputs;graph_sha256:string|null;source_sha256:string|null;missing_fields?:string[];render_blocked?:boolean;reasons?:string[]}
export interface PygasTaskReadRequest {taskId:string;path?:string}
export interface PygasTaskInitializeRequest {taskId:string;expected:{journal_sha256:null;files:Record<string,never>};catalog_files:Record<string,string>}
export interface PygasTaskResult {taskId:string;composition:PygasComposition|null;catalog:import('./pygas-composer-types').CatalogResponse;graph:import('./pygas-composer-types').CanonicalGraph|null;derived?:import('./pygas-composer-types').DerivedStructure;assets:import('./pygas-composer-types').AssetOption[];missing_fields?:string[];render_blocked?:boolean;reasons?:string[]}
export interface PygasTaskSaveRequest {taskId:string;path:string;expected:PygasExpectedInputs;catalog_files:Record<string,string>;graph:import('./pygas-composer-types').CanonicalGraph}
export interface PygasTaskNormalizeRequest {taskId:string;path:string;expected:PygasExpectedInputs;catalog_files:Record<string,string>}

/** Privileged custom CV operations have a closed dedicated typed port. */
export type {CustomCvInvoke,CustomCvRequest,CustomCvReadResult,CustomCvMethod} from './custom-cv-contract';
export type {CompositionAssetImportResult} from './CompositionAssetImport';

export type {LocalReviewApi,LocalReviewInspection,LocalReviewPreview,LocalReviewConfirmation,LocalReviewStatus} from './local-review-types';

export type WorkbenchImageRequest=Record<string,never>;
export type WorkbenchImageResult={status:'saved';path:string;width:number;height:number;bytes:number;sha256:string;geometry:{before:{width:number;height:number;displayScale:number;zoomFactor:number};after:{width:number;height:number;displayScale:number;zoomFactor:number};nativeImage1xSize:{width:number;height:number};availableScaleFactors:number[];requestedPngScaleFactor:1}}|{status:'cancelled'}|null;
export const saveWorkbenchImage=()=>invoke<WorkbenchImageResult>('diagnostics.saveWorkbenchImage',{} satisfies WorkbenchImageRequest);
