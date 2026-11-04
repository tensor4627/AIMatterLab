import {invoke,type Project,type Environment,type Conversation} from './types';
import type {ProjectAuthorizationSpec} from '../contracts/dto/compute';
export interface DeploymentDraftConfig {target:'local'|'cluster';projectId:string;targetId:string;inputSource:'local'|'remote';directoryName:string;maxSeconds:number;gpu:number;resources:{cpus:number;gpus:number;memory_mb:number;queue:string;account:string}}
export interface DeploymentContext {taskId:string;worker:{distribution:string;root:string};projects:Project[];environments:Environment[];clusters:any[]}
export interface DeploymentDraftRequest {taskId:string;value:DeploymentDraftConfig;expectedRevision:number;mutationId:string}
export interface DeploymentProjectRequest {taskId:string;spec:ProjectAuthorizationSpec;config:DeploymentDraftConfig;expectedRevision:number;requestId:string}
export const deploymentApi={
 read:(taskId:string)=>invoke<DeploymentContext>('task.deployment.context',{taskId}),
 open:(taskId:string)=>invoke<{conversation:Conversation;task:any}>('task.deployment.open',{taskId}),
 saveDraft:(value:DeploymentDraftRequest)=>invoke<any>('task.deployment.draft',value),
 createProject:(value:DeploymentProjectRequest)=>invoke<{project:Project;task:any}>('task.deployment.createProject',value)
};
