import type {Conversation} from './agent';
import type {Environment,Project,ProjectAuthorizationSpec} from './compute';

export interface DeploymentDraftConfig {
 target:'local'|'cluster';projectId:string;targetId:string;inputSource:'local'|'remote';directoryName:string;
 maxSeconds:number;gpu:number;queueSelection?:'policy';
 resources:{cpus:number;gpus:number;memory_mb:number;queue:string;account:string;queue_target_id?:string};
}
export interface DeploymentContext {
 taskId:string;
 worker:{kind?:'wsl'|'ssh';distribution?:string;root:string;profileId?:string;profileVersion?:number};
 projects:Project[];environments:Environment[];clusters:Record<string,unknown>[];
}
/** Extensible persisted task; consumers must narrow fields outside this shared identity. */
export interface TaskRecord {id:string;provider?:Conversation['provider'];threadId?:string;projectId?:string|null;roadmap?:import('../workflows/roadmap.mjs').WorkflowRoadmap;[key:string]:unknown}
export interface DeploymentDraftRequest {taskId:string;value:DeploymentDraftConfig;expectedRevision:number;mutationId:string}
export interface DeploymentSaveRequest {taskId:string;value:DeploymentDraftConfig;expectedDraftRevision?:number}
export interface DeploymentProjectRequest {taskId:string;spec:ProjectAuthorizationSpec;config:DeploymentDraftConfig;expectedRevision:number;requestId:string}
