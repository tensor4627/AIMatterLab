import {invoke} from './studio';
import type {ToolWorkflowContext,ToolWorkflowCreate,ToolWorkflowReference,ToolWorkflowPrepare,ToolWorkflowExecute,ToolWorkflowRead,ToolWorkflowIndex,ToolWorkflowLocation} from '../../contracts/dto/tool-workflows';

export const toolWorkflows={
 context:(task_id:string)=>invoke<ToolWorkflowContext>('tools.workflows.context',{task_id}),
 list:(task_id:string)=>invoke<ToolWorkflowIndex[]>('tools.workflows.list',{task_id}),
 locateRun:(run_id:string)=>invoke<ToolWorkflowLocation>('tools.workflows.locateRun',{run_id}),
 create:(value:ToolWorkflowCreate)=>invoke<ToolWorkflowRead>('tools.workflows.create',value),
 retryCreate:(task_id:string,request_id:string)=>invoke<ToolWorkflowRead>('tools.workflows.retryCreate',{task_id,request_id}),
 prepareStep:(value:ToolWorkflowPrepare)=>invoke<ToolWorkflowRead>('tools.workflows.prepareStep',value),
 executeStep:(value:ToolWorkflowExecute)=>invoke<ToolWorkflowRead>('tools.workflows.executeStep',value),
 status:(value:ToolWorkflowReference)=>invoke<ToolWorkflowRead>('tools.workflows.status',value),
 read:(value:ToolWorkflowReference)=>invoke<ToolWorkflowRead>('tools.workflows.read',value)
};
