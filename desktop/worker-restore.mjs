import {isDeepStrictEqual as equal} from 'node:util';
export async function restoreTaskWorker({records,worker,settings,selection},args){
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
