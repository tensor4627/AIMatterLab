import type {Conversation} from './agent';
import type {Project,ComputeResourceActivation,ComputeResourceState} from './compute';
import type {Run,ClusterRun} from './runs';
import type {TaskEditRequest,TaskExecuteRequest,TaskInputReadRequest,TaskInputReadResult,TaskLinkRunRequest} from './workspace';
import type {DeploymentContext,DeploymentDraftRequest,DeploymentSaveRequest,DeploymentProjectRequest,TaskRecord} from './deployment';
import type {ToolWorkflowContext,ToolWorkflowCreate,ToolWorkflowReference,ToolWorkflowPrepare,ToolWorkflowExecute,ToolWorkflowRead,ToolWorkflowIndex,ToolWorkflowLocation} from './tool-workflows';

type Route<Request,Response>={request:Request;response:Response};
/** Critical authoring/execution boundary. Authorization remains a main/worker responsibility. */
export interface StudioIpcMap {
 'task.read':Route<{id:string},TaskRecord>;
 'task.edit':Route<TaskEditRequest,TaskRecord>;
 'task.input.read':Route<TaskInputReadRequest,TaskInputReadResult>;
 'task.linkRun':Route<TaskLinkRunRequest,TaskRecord>;
 'task.execute':Route<TaskExecuteRequest,Run|ClusterRun>;
 'task.deployment.context':Route<{taskId:string},DeploymentContext>;
 'task.deployment.open':Route<{taskId:string},{conversation:Conversation;task:TaskRecord}>;
 'task.deployment.draft':Route<DeploymentDraftRequest,TaskRecord>;
 'task.deployment.save':Route<DeploymentSaveRequest,TaskRecord>;
 'task.deployment.createProject':Route<DeploymentProjectRequest,{project:Project;task:TaskRecord}>;
 'task.deployment.prepare':Route<{taskId:string},Run|ClusterRun>;
 'tools.workflows.context':Route<{task_id:string},ToolWorkflowContext>;
 'tools.workflows.list':Route<{task_id:string},ToolWorkflowIndex[]>;
 'tools.workflows.locateRun':Route<{run_id:string},ToolWorkflowLocation>;
 'tools.workflows.create':Route<ToolWorkflowCreate,ToolWorkflowRead>;
 'tools.workflows.retryCreate':Route<{task_id:string;request_id:string},ToolWorkflowRead>;
 'tools.workflows.prepareStep':Route<ToolWorkflowPrepare,ToolWorkflowRead>;
 'tools.workflows.executeStep':Route<ToolWorkflowExecute,ToolWorkflowRead>;
 'tools.workflows.status':Route<ToolWorkflowReference,ToolWorkflowRead>;
 'tools.workflows.read':Route<ToolWorkflowReference,ToolWorkflowRead>;
 'compute.resource.status':Route<Record<string,never>,ComputeResourceState>;
 'compute.resource.activate':Route<ComputeResourceActivation,ComputeResourceState>;
 'compute.resource.clear':Route<{selectionId:string},ComputeResourceState>;
}
export type StudioMethod=keyof StudioIpcMap;
export type StudioRequest<M extends StudioMethod>=StudioIpcMap[M]['request'];
export type StudioResponse<M extends StudioMethod>=StudioIpcMap[M]['response'];
export type TypedInvoke=<M extends StudioMethod>(method:M,data:StudioRequest<M>)=>Promise<StudioResponse<M>>;
