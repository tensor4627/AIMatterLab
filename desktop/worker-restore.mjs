import {isDeepStrictEqual as equal} from 'node:util';
import {explicitWorkerBindingKey,validExplicitBinding,workerSettingsSignature} from './explicit-worker-binding.mjs';
export async function restoreConversationWorker({records,catalog,worker,settings,selection},args){
 const response=(status,reason)=>({status,reason,conversationId:args.conversationId,checkedAt:Date.now()}),owner=selection();
 if(!owner?.threadId||args.conversationId!==owner.provider+':'+owner.threadId)return response('unknown','selection_changed');
 const conversation=records.conversation(owner.provider,owner.threadId);
 if(!conversation||records.deleted(owner.provider,owner.threadId))return response('unknown','selection_changed');
 // An explicit task owns its original binding, including failure. Never fall back to a global record.
 if(owner.taskId||conversation.taskId){if(!owner.taskId||owner.taskId!==conversation.taskId)return response('unknown','selection_changed');return restoreTaskWorker({records,catalog,worker,settings,selection},{taskId:owner.taskId});}
 if(!conversation.projectId)return response('disconnected','project_missing');
 const project=catalog.get('projects',conversation.projectId);if(!project||project.id!==conversation.projectId)return response('disconnected','project_missing');
 const target=settings(),bound=catalog.get('worker-binding',explicitWorkerBindingKey);
 if(!validExplicitBinding(bound,target))return response('disconnected','explicit_binding_missing');
 const current=()=>{try{return equal(owner,selection())&&equal(workerSettingsSignature(target),workerSettingsSignature(settings()))&&equal(conversation,records.conversation(owner.provider,owner.threadId))&&!records.deleted(owner.provider,owner.threadId)&&equal(project,catalog.get('projects',conversation.projectId))&&equal(bound,catalog.get('worker-binding',explicitWorkerBindingKey));}catch{return false;}};
 const observed=await worker.restore({...target,distribution:bound.distribution,workerRoot:bound.root,workerPort:bound.port},{current});
 if(!current())return response('unknown','selection_changed');
 if(observed.status!=='connected')return response(observed.status,observed.reason);
 const connection=worker.connection,epoch=worker.connectionEpoch;
 // Project IDs are service-local. Confirm the exact saved project exists on this verified service.
 try{const projects=await worker.request('GET','/api/projects');if(!current()||worker.connection!==connection||worker.connectionEpoch!==epoch)return response('unknown','selection_changed');if(!Array.isArray(projects)||!projects.some(value=>value?.id===project.id))return response('unknown','project_unavailable');}
 catch{return response('unknown',current()?'project_unavailable':'selection_changed');}
 return response('connected','restored');
}
export async function restoreTaskWorker({records,catalog,worker,settings,selection},args){
 if(args&&typeof args==='object'&&Object.keys(args).join(',')==='conversationId'&&typeof args.conversationId==='string'&&args.conversationId&&args.conversationId.length<=210)return restoreConversationWorker({records,catalog,worker,settings,selection},args);
 if(!args||typeof args!=='object'||Object.keys(args).join(',')!=='taskId'||typeof args.taskId!=='string'||!args.taskId||args.taskId.length>200)throw Error('Invalid typed worker restoration');
 const response=(status,reason)=>({status,reason,taskId:args.taskId,checkedAt:Date.now()}),task=records.read(args.taskId),bound=task.deployment?.workerBinding||task.deploymentDraft?.workerBinding||task.workspace?.workerBinding;
 if(!bound||typeof bound.distribution!=='string'||typeof bound.root!=='string'||!bound.root.startsWith('/'))return response('disconnected','binding_missing');
 const owner=selection(),target=settings(),signature=value=>[value.distribution,value.workerRoot,value.workerPort];
 if(!owner||owner.taskId!==task.id||owner.provider!==task.provider||owner.threadId!==task.threadId)return response('unknown','selection_changed');
 const current=()=>{try{const now=selection(),actual=records.read(task.id),binding=actual.deployment?.workerBinding||actual.deploymentDraft?.workerBinding||actual.workspace?.workerBinding;return equal(owner,now)&&equal(signature(target),signature(settings()))&&equal(bound,binding);}catch{return false;}};
 const observed=await worker.restore({...target,distribution:bound.distribution,workerRoot:bound.root},{current});
 if(!current())return response('unknown','selection_changed');
 return response(observed.status,observed.reason);
}
