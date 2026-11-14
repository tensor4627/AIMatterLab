import {invoke} from './studio';
import type {DeploymentDraftRequest,DeploymentProjectRequest,DeploymentSaveRequest} from '../../contracts/dto/deployment';
import type {TypedInvoke} from '../../contracts/dto/ipc';
export type {DeploymentDraftConfig,DeploymentContext,DeploymentDraftRequest,DeploymentProjectRequest} from '../../contracts/dto/deployment';
const request:TypedInvoke=invoke;
export const deploymentApi={
 read:(taskId:string)=>request('task.deployment.context',{taskId}),
 open:(taskId:string)=>request('task.deployment.open',{taskId}),
 saveDraft:(value:DeploymentDraftRequest)=>request('task.deployment.draft',value),
 save:(value:DeploymentSaveRequest)=>request('task.deployment.save',value),
 prepare:(taskId:string)=>request('task.deployment.prepare',{taskId}),
 createProject:(value:DeploymentProjectRequest)=>request('task.deployment.createProject',value)
};
