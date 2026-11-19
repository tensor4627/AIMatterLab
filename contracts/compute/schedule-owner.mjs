import {createHash} from 'node:crypto';

// The worker's v1 schedule protocol names its owner key "taskId". Ordinary
// conversations get a separate namespace without creating a workflow record.
export function scheduleOwnerId(scope) {
 if(scope.taskId)return scope.taskId;
 if(!scope.provider||!scope.threadId||!scope.projectId)throw Error('managed_schedule_owner_required');
 return 'conversation:'+createHash('sha256').update(JSON.stringify([scope.provider,scope.threadId,scope.projectId])).digest('hex');
}
