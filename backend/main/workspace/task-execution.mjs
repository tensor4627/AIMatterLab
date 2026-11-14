import {snapshotIdentity,deploymentCurrent} from '../../../contracts/compute/deployment.mjs';
import {assertDeploymentWorker,assertConfirmedDeployment} from './deployment-state.mjs';
import {taskOperation} from './task-operations.mjs';
import {isDeepStrictEqual} from 'node:util';

const immutableRun=run=>({...Object.fromEntries(['id','kind','project_id','cluster_id','nonce','directory','engine','snapshots','inputs','parameters','resources','max_seconds','command','environment_snapshot','private_cv_versions'].map(key=>[key,run[key]])),cluster:run.cluster?Object.fromEntries(Object.entries(run.cluster).filter(([key])=>!['probe','connection_check'].includes(key))):null});
export async function executeTask(records,worker,value,localReview){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['taskId','artifactId','inputReceipt','runChecks'].includes(key))||typeof value.taskId!=='string'||!value.taskId||typeof value.artifactId!=='string'||!value.artifactId||value.inputReceipt!==undefined&&typeof value.inputReceipt!=='string'||value.runChecks!==undefined&&typeof value.runChecks!=='boolean')throw Error('Invalid typed task execution request');
 const {taskId,artifactId,inputReceipt,runChecks=false}=value;
 return taskOperation(records,taskId,'execute',JSON.stringify([artifactId,inputReceipt,runChecks]),()=>executeOnce(records,worker,{taskId,artifactId,inputReceipt,runChecks},localReview));
}
async function executeOnce(records,worker,{taskId,artifactId,inputReceipt,runChecks},localReview){
 const task=records.read(taskId),artifact=task.artifacts.find(a=>a.id===artifactId);
 assertDeploymentWorker(task,worker);assertConfirmedDeployment(task);
 if(!artifact||!['run','cluster-run'].includes(artifact.kind))throw Error('Prepared run unavailable');
 if(task.workflowVersion===2&&(!deploymentCurrent(task)||task.deployment.prepared.artifactId!==artifactId))throw Error('Prepare the current input revision before execution');
 if(task.workflowVersion===2&&inputReceipt!==task.deployment.prepared.inputIdentity)throw Error('Review the actual input snapshots for this deployment before execution');
 const prefix=artifact.kind==='cluster-run'?'/api/cluster/':'/api/run/',connection=worker.connection,connectionEpoch=worker.connectionEpoch;
 const observesInputs=artifact.kind==='run'&&task.authoring&&localReview?.verifyPreparedActual&&(task.parameters?.engine==='pygas.build'?!!task.composition:!!task.consumerArtifact&&['bias.validate','gpumd.sampling'].includes(task.parameters?.engine));
 const observationOwner=observesInputs?localReview.beginOperation(taskId):null;
 const sameDraft=()=>{const fresh=records.read(taskId);return fresh.parameterRevision===task.parameterRevision&&fresh.deployment?.revision===task.deployment?.revision;};
 // The captured attempt is immutable; subsequent edits belong to the next draft.
 const assertWorker=()=>{if(connection&&(worker.connection!==connection||worker.connectionEpoch!==connectionEpoch))throw Error('作业服务连接已变化，请核对原作业状态。');assertDeploymentWorker(task,worker);assertDeploymentWorker(records.read(taskId),worker);if(observationOwner&&sameDraft())localReview.assertOperation(observationOwner);};
 const current=await worker.request('POST',prefix+'status',{run_id:artifact.id});assertWorker();
 if(task.workflowVersion===2&&inputReceipt!==snapshotIdentity(task,current))throw Error('Prepared input snapshot identity changed');
 if(current.project_id!==(task.workflowVersion===2?task.deployment.config.projectId:task.projectId))throw Error('Run project does not match workflow');
 if(!['draft','ready'].includes(current.status)){records.linkRun(taskId,current);return current;}
 const pending=records.read(taskId);
 if(pending.execution&&['validating','submitting','unknown'].includes(pending.execution.phase))throw Error('An execution request is pending; reconcile its recorded run, never resubmit unknown');
 const attempt={artifactId,parameterRevision:task.parameterRevision,deploymentRevision:task.deployment?.revision,inputIdentity:inputReceipt,runChecks};
 pending.execution={...attempt,phase:'validating'};records.save(pending);
 try{
  if(observesInputs&&sameDraft()){await localReview.verifyPreparedActual(taskId,current,task.deployment.config,current.inputs,true);assertWorker();}
  // Checks are evidence. The worker independently enforces authorization,
  // immutable inputs and mandatory serialized-artifact/target compatibility.
  const checked=runChecks?await worker.request('POST',prefix+'validate',{run_id:artifact.id}):current;assertWorker();
  const actual=observesInputs&&sameDraft()?await worker.request('POST',prefix+'status',{run_id:artifact.id}):checked?.id?checked:current;assertWorker();
  if(!['draft','ready'].includes(actual.status)||!isDeepStrictEqual(immutableRun(current),immutableRun(actual)))throw Error('Prepared execution identity changed during validation');
  if(observesInputs&&sameDraft()){await localReview.verifyPreparedActual(taskId,actual,task.deployment.config,actual.inputs,true);assertWorker();}
  const fresh=records.read(taskId);fresh.execution={...attempt,phase:'submitting'};records.save(fresh);
  const result=await worker.request('POST',prefix+'submit',{run_id:artifact.id});assertWorker();
  records.linkRun(taskId,result);const done=records.read(taskId);done.execution={...attempt,phase:'confirmed',status:result.status};records.save(done);return result;
 }catch(error){
  // Only an exact no-dispatch proof can clear an uncertain submission.
  let notSubmitted=false;
  if(artifact.kind==='cluster-run'&&['needs_human_auth','needs_worker_update'].includes(error.message)&&records.read(taskId).execution?.phase==='submitting'&&Number.isInteger(connectionEpoch)&&typeof current.nonce==='string'&&current.nonce){
   try{assertWorker();const proof=await worker.request('POST',prefix+'status',{run_id:artifact.id});assertWorker();notSubmitted=proof.id===artifact.id&&proof.kind==='cluster-run'&&['draft','ready'].includes(proof.status)&&!proof.submit_attempted&&!current.submit_attempted&&proof.job_id==null&&current.job_id==null&&isDeepStrictEqual(immutableRun(current),immutableRun(proof));}catch{notSubmitted=false;}
  }
  const failed=records.read(taskId);if(failed.execution?.phase!=='submitting'||failed.execution?.artifactId!==artifactId)notSubmitted=false;
  failed.execution={...attempt,phase:notSubmitted?'blocked':['submitting','unknown'].includes(failed.execution?.phase)?'unknown':'blocked',message:error.message,...notSubmitted?{authenticationRequired:true,notSubmitted:true}:{}};
  records.save(failed);throw error;
 }
}
