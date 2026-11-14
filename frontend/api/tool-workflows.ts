import {invoke} from './studio';
import type {TypedInvoke} from '../../contracts/dto/ipc';
import type {ToolWorkflowContext,ToolWorkflowCreate,ToolWorkflowReference,ToolWorkflowPrepare,ToolWorkflowExecute,ToolWorkflowRead,ToolWorkflowIndex,ToolWorkflowLocation} from '../../contracts/dto/tool-workflows';

const request:TypedInvoke=invoke;
export const toolWorkflows={
 context:(task_id:string)=>request('tools.workflows.context',{task_id}),
 list:(task_id:string)=>request('tools.workflows.list',{task_id}),
 locateRun:(run_id:string)=>request('tools.workflows.locateRun',{run_id}),
 create:(value:ToolWorkflowCreate)=>request('tools.workflows.create',value),
 retryCreate:(task_id:string,request_id:string)=>request('tools.workflows.retryCreate',{task_id,request_id}),
 prepareStep:(value:ToolWorkflowPrepare)=>request('tools.workflows.prepareStep',value),
 executeStep:(value:ToolWorkflowExecute)=>request('tools.workflows.executeStep',value),
 status:(value:ToolWorkflowReference)=>request('tools.workflows.status',value),
 read:(value:ToolWorkflowReference)=>request('tools.workflows.read',value)
};
