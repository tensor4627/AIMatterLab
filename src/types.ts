/** Compatibility facade. Cross-process DTOs and renderer clients have separate owners. */
export type {Project,Environment,WorkerStatus,ComputeConnectionView,ClusterQueueLimits,ClusterQueueEnvironment,ClusterQueueTarget,ClusterQueuePolicy,ClusterQueueProfile,ClusterSchedulerObservation,ExistingSshReference,WslComputeProfile,SshComputeProfile,ComputeProfile} from '../contracts/dto/compute';
export type {RunStatus,ContinuationMetadata,Run,ClusterRun} from '../contracts/dto/runs';
export type {Workflow,TaskEditRequest,TaskExecuteRequest,TaskLinkRunRequest,TaskInputReadRequest,TaskInputReadResult} from '../contracts/dto/workspace';
export type {AgentProvider,AgentConnectRequest,AgentRpcRequest,ScientificSkillFunction,ScientificSkillCatalog,RpcEvent,Conversation,ConversationRecovery,ConversationRecoveryRequest,ConversationResumeResult} from '../contracts/dto/agent';
export type {Settings} from '../contracts/dto/settings';
export type {WorkbenchImageRequest,WorkbenchImageResult} from '../contracts/dto/diagnostics';
export type {PygasExpectedInputs,PygasComposition,PygasTaskReadRequest,PygasTaskInitializeRequest,PygasTaskResult,PygasTaskSaveRequest,PygasTaskNormalizeRequest} from '../contracts/dto/pygas';
export type {Artifact,CompositionAssetImportResult} from '../contracts/dto/assets';
export type {CustomCvInvoke,CustomCvRequest,CustomCvReadResult,CustomCvMethod} from '../contracts/dto/custom-cv';
export type {LocalReviewApi,LocalReviewInspection,LocalReviewPreview,LocalReviewConfirmation,LocalReviewStatus} from '../contracts/dto/local-review';
export type {SkillAttachment,AgentIntent} from '../frontend/presentation/agent-types';
export type {Studio} from '../frontend/api/studio';
export {invoke} from '../frontend/api/studio';
export {api,readWorkerStatus,restoreWorker} from '../frontend/api/worker';
export {recoverConversation} from '../frontend/api/agent';
export {saveWorkbenchImage} from '../frontend/api/diagnostics';
export {wslPath} from '../frontend/presentation/paths';
export {engines} from '../frontend/presentation/engines';
