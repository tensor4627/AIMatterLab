import {taskForRecordIndex} from '../compute/worker-service-version.mjs';

/** A deployment entry belongs to its workflow, independent of the global project filter. */
export async function openDeploymentSession({records,workflowContext,agents,connect,assertIdle},args){
 if(!args||typeof args!=='object'||Object.keys(args).join(',')!=='taskId'||typeof args.taskId!=='string')throw Error('Invalid typed deployment entry');const {taskId}=args;
 assertIdle();const task=records.read(taskId),conversation=records.conversation(task.provider,task.threadId);
 if(!conversation||conversation.taskId!==taskId||records.deleted(task.provider,task.threadId))throw Error('此流程的会话绑定已变化，请重新打开该流程。');
 if(agents.active!==task.provider){workflowContext.clear(agents.active);agents.disconnect(agents.active);}
 const ticket=workflowContext.begin(task.provider,task.threadId);
 await connect(task);workflowContext.assert(ticket);
 await workflowContext.synchronize(ticket,(provider,context)=>agents.selectContext(provider,context));workflowContext.assert(ticket);
 const current=records.conversation(task.provider,task.threadId);if(current?.taskId!==taskId)throw Error('流程会话已变化，请重新检查。');
 return {conversation:current,task:taskForRecordIndex(records.read(taskId))};
}
