import {workerObservationEvidence} from "./worker-service-version.mjs";
import {isDeepStrictEqual as equal} from 'node:util';
import {explicitWorkerBindingKey,validExplicitBinding,workerSettingsSignature,taskWorkerTarget,taskTransportScope,taskTransportReceipt,validTransportPort} from './explicit-worker-binding.mjs';
import {taskWorkerSource,validTaskWorkerSource,taskWorkerSettings,sameWorkerBinding,unboundWorkflow,actualAuthoringWorker} from "../../../contracts/compute/task-worker-binding.mjs";
import {readWorkerStatus} from './worker-status.mjs';

async function observeSsh(bound,worker,settings,current){
 const detail={sourceKind:'ssh',profileId:bound.profileId,profileVersion:bound.profileVersion};
 if(!current())return {status:'unknown',reason:'selection_changed',...detail};
 if(!sameWorkerBinding(bound,worker))return {status:'disconnected',reason:'ssh_reconnect_required',...detail};
 const observed=await readWorkerStatus(worker,settings);
 if(!current())return {status:'unknown',reason:'selection_changed',...detail};
 return {...observed,...detail,reason:observed.status==='connected'?'restored':'ssh_service_unconfirmed'};
}

export async function restoreConversationWorker({records,catalog,worker,settings,selection,selectionEpoch,selectedResource},args){
 const response=(status,reason)=>({status,reason,conversationId:args.conversationId,checkedAt:Date.now(),...status==='connected'?workerObservationEvidence(worker):{}}),owner=selection();
 if(!owner?.threadId||args.conversationId!==owner.provider+':'+owner.threadId)return response('unknown','selection_changed');
 const conversation=records.conversation(owner.provider,owner.threadId);
 if(!conversation||records.deleted(owner.provider,owner.threadId))return response('unknown','selection_changed');
 // An explicit task owns its original binding, including failure. Never fall back to a global record.
 if(owner.taskId||conversation.taskId){if(!owner.taskId||owner.taskId!==conversation.taskId)return response('unknown','selection_changed');return restoreTaskWorker({records,catalog,worker,settings,selection,selectionEpoch,selectedResource},{taskId:owner.taskId});}
 if(!conversation.projectId)return response('disconnected','project_missing');
 const project=catalog.get('projects',conversation.projectId);if(!project||project.id!==conversation.projectId)return response('disconnected','project_missing');
 const target=settings(),bound=catalog.get('worker-binding',explicitWorkerBindingKey);
 if(!validExplicitBinding(bound,target))return response('disconnected','explicit_binding_missing');
 const current=()=>{try{return equal(owner,selection())&&equal(workerSettingsSignature(target),workerSettingsSignature(settings()))&&equal(conversation,records.conversation(owner.provider,owner.threadId))&&!records.deleted(owner.provider,owner.threadId)&&equal(project,catalog.get('projects',conversation.projectId))&&equal(bound,catalog.get('worker-binding',explicitWorkerBindingKey));}catch{return false;}};
 const observed=bound.kind==='ssh'?await observeSsh(bound,worker,settings,current):await worker.restore({...target,distribution:bound.distribution,workerRoot:bound.root,workerPort:bound.port},{current});
 if(!current())return response('unknown','selection_changed');
 if(observed.status!=='connected')return {...response(observed.status,observed.reason),...bound.kind==='ssh'?{sourceKind:'ssh',profileId:bound.profileId,profileVersion:bound.profileVersion}:{}};
 const connection=worker.connection,epoch=worker.connectionEpoch;
 // Project IDs are service-local. Confirm the exact saved project exists on this verified service.
 try{const projects=await worker.request('GET','/api/projects');if(!current()||worker.connection!==connection||worker.connectionEpoch!==epoch)return response('unknown','selection_changed');if(!Array.isArray(projects)||!projects.some(value=>value?.id===project.id))return response('unknown','project_unavailable');}
 catch{return response('unknown',current()?'project_unavailable':'selection_changed');}
 return response('connected','restored');
}
// Restore only the last explicitly verified desktop service when no saved owner exists.
export async function restoreGlobalWorker({catalog,worker,settings,selection,selectionEpoch}){
 const response=(status,reason)=>({status,reason,scope:'global',checkedAt:Date.now(),...status==='connected'?workerObservationEvidence(worker):{}}),owner=selection();
 const hasOwner=value=>!!value&&(!!value.threadId||!!value.taskId||!!value.projectId||!!value.environmentId||!!value.inputRoot||!!value.replacement);
 if(hasOwner(owner)||typeof selectionEpoch!=='function')return response('unknown','selection_changed');
 const revision=selectionEpoch(),target=settings(),signature=[...workerSettingsSignature(target)],bound=catalog.get('worker-binding',explicitWorkerBindingKey);
 if(!Number.isSafeInteger(revision))return response('unknown','selection_changed');
 if(!validExplicitBinding(bound,target))return response('disconnected','explicit_binding_missing');
 const current=()=>{try{return selectionEpoch()===revision&&!hasOwner(selection())&&equal(owner,selection())&&settings()===target&&equal(signature,workerSettingsSignature(settings()))&&equal(bound,catalog.get('worker-binding',explicitWorkerBindingKey));}catch{return false;}};
 const observed=bound.kind==='ssh'?await observeSsh(bound,worker,settings,current):await worker.restore({...target,distribution:bound.distribution,workerRoot:bound.root,workerPort:bound.port},{current});
 if(!current())return response('unknown','selection_changed');
 return {...response(observed.status,observed.reason),...bound.kind==='ssh'?{sourceKind:'ssh',profileId:bound.profileId,profileVersion:bound.profileVersion}:{}};
}
export async function restoreTaskWorker({records,catalog,worker,settings,selection,selectionEpoch,selectedResource},args){
 if(args&&typeof args==='object'&&Object.keys(args).join(',')==='scope'&&args.scope==='global')return restoreGlobalWorker({catalog,worker,settings,selection,selectionEpoch});
 if(args&&typeof args==='object'&&Object.keys(args).join(',')==='conversationId'&&typeof args.conversationId==='string'&&args.conversationId&&args.conversationId.length<=210)return restoreConversationWorker({records,catalog,worker,settings,selection,selectionEpoch,selectedResource},args);
 if(!args||typeof args!=='object'||Object.keys(args).join(',')!=='taskId'||typeof args.taskId!=='string'||!args.taskId||args.taskId.length>200)throw Error('Invalid typed worker restoration');
 const response=(status,reason)=>({status,reason,taskId:args.taskId,checkedAt:Date.now(),...status==='connected'?workerObservationEvidence(worker):{}}),task=records.read(args.taskId),source=taskWorkerSource(task);
 if(!source&&unboundWorkflow(task)&&worker.identity?.kind==='ssh'&&selectedResource){
  const owner=structuredClone(selection()),resource=structuredClone(selectedResource()),revision=selectionEpoch?.();
  if(owner?.taskId!==task.id||owner.provider!==task.provider||owner.threadId!==task.threadId)return response('unknown','selection_changed');
  if(resource?.kind!=='ssh-connection'||resource.connectionId!==worker.identity.connectionId||resource.profileId!==worker.identity.profileId||resource.profileVersion!==worker.identity.profileVersion)return response('disconnected','source_mismatch');
  const binding=actualAuthoringWorker(worker);
  const current=()=>{try{return equal(owner,selection())&&equal(resource,selectedResource())&&equal(task,records.read(task.id))&&(!selectionEpoch||selectionEpoch()===revision);}catch{return false;}};
  const observed=await observeSsh(binding,worker,settings,current);
  return {...response(observed.status,observed.reason),sourceKind:'ssh',profileId:binding.profileId,profileVersion:binding.profileVersion};
 }
 if(!validTaskWorkerSource(source))return response('disconnected','binding_missing');
 if(source.binding.kind==='ssh'){
  const owner=structuredClone(selection()),revision=selectionEpoch?.(),scope=taskTransportScope(task);
  if(!owner||owner.taskId!==task.id||owner.provider!==task.provider||owner.threadId!==task.threadId)return response('unknown','selection_changed');
  const current=()=>{try{return (!selectionEpoch||selectionEpoch()===revision)&&equal(owner,selection())&&equal(scope,taskTransportScope(records.read(task.id)));}catch{return false;}};
  const observed=await observeSsh(source.binding,worker,settings,current);return {...response(observed.status,observed.reason),sourceKind:'ssh',profileId:source.binding.profileId,profileVersion:source.binding.profileVersion};
 }
 if(worker.identity?.kind==='ssh')return response('disconnected','source_mismatch');
 const owner=structuredClone(selection()),epoch=typeof selectionEpoch==='function'?selectionEpoch():undefined,target=settings(),signature=value=>[value.distribution,value.workerRoot,value.workerPort],originalSignature=signature(target),scope=taskTransportScope(task),receipt=taskTransportReceipt(task,catalog);let resolved;try{resolved=taskWorkerTarget(task,target,catalog);}catch{return response('disconnected','binding_missing');}
 if(!owner||owner.taskId!==task.id||owner.provider!==task.provider||owner.threadId!==task.threadId)return response('unknown','selection_changed');
 if(!validTransportPort(resolved?.workerPort))return response('disconnected','legacy_port_unknown');
 const current=()=>{try{const fresh=records.read(task.id);return (typeof selectionEpoch!=='function'||selectionEpoch()===epoch)&&equal(owner,selection())&&equal(originalSignature,signature(settings()))&&equal(scope,taskTransportScope(fresh))&&equal(receipt,taskTransportReceipt(fresh,catalog));}catch{return false;}};
 const observed=await worker.restore(resolved,{current});
 if(!current())return response('unknown','selection_changed');
 return response(observed.status,observed.reason);
}
