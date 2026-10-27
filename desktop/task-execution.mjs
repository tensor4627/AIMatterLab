import {sameAuthority} from './review-authority.mjs';
import {deploymentCurrent,snapshotIdentity} from '../shared/deployment.mjs';
import {assertDeploymentWorker,assertConfirmedDeployment} from './deployment-state.mjs';
import {taskOperation} from './task-operations.mjs';
export async function executeTask(records,worker,{taskId,artifactId,inputReceipt},localReview){
 return taskOperation(records,taskId,'execute',JSON.stringify([artifactId,inputReceipt]),()=>executeOnce(records,worker,{taskId,artifactId,inputReceipt},localReview));
}
async function executeOnce(records,worker,{taskId,artifactId,inputReceipt},localReview){
 assertDeploymentWorker(records.read(taskId),worker);assertConfirmedDeployment(records.read(taskId));const connection=worker.connection;
 const approved=()=>{const task=records.read(taskId),artifact=task.artifacts.find(a=>a.id===artifactId),authority=localReview?.authority(task,task.deployment?.config?.target);const ready=task.workflowVersion===2?deploymentCurrent(task,authority)&&task.deployment.prepared.artifactId===artifactId:task.review?.status==='ready'&&task.review.parameterRevision===task.parameterRevision&&task.review.artifactIds?.includes(artifactId);if(task.workflowVersion===2&&inputReceipt!==task.deployment?.prepared?.inputIdentity)throw Error('Review the actual input snapshots for this deployment before execution');if(!ready||!artifact||!['run','cluster-run'].includes(artifact.kind))throw Error('Review the current parameters and module draft before execution');return {task,artifact,authority};};
 const {task,artifact,authority}=approved(),prefix=artifact.kind==='cluster-run'?'/api/cluster/':'/api/run/';
 const localOperation=authority?.kind==='local-human'?localReview.beginOperation(taskId):null,assertLocal=()=>{if(connection&&worker.connection!==connection)throw Error('作业服务连接已变化，请核对原作业状态。');assertDeploymentWorker(records.read(taskId),worker);assertConfirmedDeployment(records.read(taskId));if(localOperation)localReview.assertOperation(localOperation);};
 const current=await worker.request('POST',prefix+'status',{run_id:artifact.id});assertLocal();
 if(authority?.kind==='local-human'){const checked=await localReview.verify(taskId);assertLocal();if(!sameAuthority(checked.authority,authority)||!sameAuthority(approved().authority,authority))throw Error('Local human review changed before validation');}
 if(task.workflowVersion===2&&inputReceipt!==snapshotIdentity(task,current))throw Error('Reviewed input snapshot identity changed');
 if(current.project_id!==(task.workflowVersion===2?task.deployment.config.projectId:task.projectId))throw Error('Run project does not match workflow');
 if(!['draft','ready'].includes(current.status)){records.linkRun(taskId,current);return current;}
 if(authority?.kind==='local-human'){const checked=await localReview.verifyPrepared(taskId,current,task.deployment.config,current.inputs,true);assertLocal();if(!sameAuthority(checked.authority,authority))throw Error('Prepared human authority differs');}
 const pending=records.read(taskId);if(pending.execution&&['validating','submitting','unknown'].includes(pending.execution.phase))throw Error('An execution request is pending; reconcile its recorded run, never resubmit unknown');
 pending.execution={artifactId,phase:'validating'};records.save(pending);
 try{
  const checked=await worker.request('POST',prefix+'validate',{run_id:artifact.id});assertLocal();if(checked.validation?.status!=='passed')throw Error(checked.validation?.message||'Target environment validation failed');
  if(authority?.kind==='local-human'){
   const checked=await localReview.verify(taskId);assertLocal();if(!sameAuthority(checked.authority,authority)||!sameAuthority(approved().authority,authority))throw Error('Local human review changed during target validation');
   const actual=await worker.request('POST',prefix+'status',{run_id:artifact.id});assertLocal();const beforeSubmit=approved();
   if(actual.id!==artifact.id||actual.status!=='ready'||actual.validation?.status!=='passed')throw Error('Actual validated run is no longer the same unstarted ready run');
   const prepared=await localReview.verifyPrepared(taskId,actual,beforeSubmit.task.deployment.config,actual.inputs,true);assertLocal();
   if(!sameAuthority(prepared.authority,authority)||!sameAuthority(approved().authority,authority))throw Error('Prepared human authority changed after target validation');
  }
  const fresh=approved();fresh.task.execution={artifactId,phase:'submitting'};records.save(fresh.task);
  const result=await worker.request('POST',prefix+'submit',{run_id:artifact.id});assertLocal();records.linkRun(taskId,result);const done=records.read(taskId);done.execution={artifactId,phase:'confirmed',status:result.status};records.save(done);return result;
 }catch(error){const failed=records.read(taskId);failed.execution={artifactId,phase:failed.execution?.phase==='submitting'?'unknown':'blocked',message:error.message};if(authority?.kind==='local-human'&&failed.localInputReview)failed.localInputReview={...failed.localInputReview,status:'invalidated',reason:'Target validation, execution identity or submit response was not confirmed; review/reconcile the original run'};failed.review={status:'not_run',summary:failed.execution.phase==='unknown'?'提交响应未确认，请核对原作业状态':'实际环境验证或参数版本检查未通过'};records.save(failed);throw error;}
}
