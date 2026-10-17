import {deploymentCurrent} from '../shared/deployment.mjs';
export async function executeTask(records,worker,{taskId,artifactId}){
 const approved=()=>{const task=records.read(taskId),artifact=task.artifacts.find(a=>a.id===artifactId);const ready=task.workflowVersion===2?deploymentCurrent(task)&&task.deployment.prepared.artifactId===artifactId:task.review?.status==='ready'&&task.review.parameterRevision===task.parameterRevision&&task.review.artifactIds?.includes(artifactId);if(!ready||!artifact||!['run','cluster-run'].includes(artifact.kind))throw Error('Review the current parameters and module draft before execution');return {task,artifact};};
 const {task,artifact}=approved(),prefix=artifact.kind==='cluster-run'?'/api/cluster/':'/api/run/';
 const current=await worker.request('POST',prefix+'status',{run_id:artifact.id});
 if(current.project_id!==task.projectId)throw Error('Run project does not match workflow');
 if(!['draft','ready'].includes(current.status)){records.linkRun(taskId,current);return current;}
 const pending=records.read(taskId);if(pending.execution&&['validating','submitting','unknown'].includes(pending.execution.phase))throw Error('An execution request is pending; reconcile its recorded run, never resubmit unknown');
 pending.execution={artifactId,phase:'validating'};records.save(pending);
 try{
  const checked=await worker.request('POST',prefix+'validate',{run_id:artifact.id});if(checked.validation?.status!=='passed')throw Error(checked.validation?.message||'Target environment validation failed');
  const fresh=approved();fresh.task.execution={artifactId,phase:'submitting'};records.save(fresh.task);
  const result=await worker.request('POST',prefix+'submit',{run_id:artifact.id});records.linkRun(taskId,result);const done=records.read(taskId);done.execution={artifactId,phase:'confirmed',status:result.status};records.save(done);return result;
 }catch(error){const failed=records.read(taskId);failed.execution={artifactId,phase:failed.execution?.phase==='submitting'?'unknown':'blocked',message:error.message};failed.review={status:'not_run',summary:failed.execution.phase==='unknown'?'提交响应未确认，请核对原作业状态':'实际环境验证或参数版本检查未通过'};records.save(failed);throw error;}
}
