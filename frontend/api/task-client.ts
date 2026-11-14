import {invoke} from './studio';
import type {TypedInvoke} from '../../contracts/dto/ipc';
import type {TaskEditRequest,TaskExecuteRequest,TaskInputReadRequest,TaskLinkRunRequest} from '../../contracts/dto/workspace';
const request:TypedInvoke=invoke;

export const taskApi={
 read:(id:string)=>request('task.read',{id}),
 edit:(value:TaskEditRequest)=>request('task.edit',value),
 readInput:(value:TaskInputReadRequest)=>request('task.input.read',value),
 linkRun:(value:TaskLinkRunRequest)=>request('task.linkRun',value),
 execute:(value:TaskExecuteRequest)=>request('task.execute',value),
};
