import {snapshotIdentity,deploymentCurrent} from '../../../contracts/compute/deployment.mjs';
import {assertDeploymentWorker,assertConfirmedDeployment} from './deployment-state.mjs';
import {taskOperation} from './task-operations.mjs';
import {isDeepStrictEqual} from 'node:util';
import {executionNotStartedPrefix} from '../../../contracts/compute/run-operation-receipt.mjs';

const immutableRun=run=>({...Object.fromEntries(['id','kind','project_id','cluster_id','nonce','directory','engine','snapshots','inputs','parameters','resources','max_seconds','command','environment_snapshot','private_cv_versions'].map(key=>[key,run[key]])),cluster:run.cluster?Object.fromEntries(Object.entries(run.cluster).filter(([key])=>!['probe','connection_check'].includes(key))):null});
const unsubmitted=error=>error?.message?.startsWith(executionNotStartedPrefix)?error:Error(executionNotStartedPrefix+String(error?.message||error),{cause:error});
const authRequired=error=>['needs_human_auth','needs_worker_update'].includes(error?.workerFailure?.code||error?.message);
export async function executeTask(records,worker,value,localReview){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['taskId','artifactId','inputReceipt','runChecks'].includes(key))||typeof value.taskId!=='string'||!value.taskId||typeof value.artifactId!=='string'||!value.artifactId||value.inputReceipt!==undefined&&typeof value.inputReceipt!=='string'||value.runChecks!==undefined&&typeof value.runChecks!=='boolean')throw unsubmitted(Error('Invalid typed task execution request'));
 const {taskId,artifactId,inputReceipt,runChecks=false}=value;
 return taskOperation(records,taskId,'execute',JSON.stringify([artifactId,inputReceipt,runChecks]),()=>executeOnce(records,worker,{taskId,artifactId,inputReceipt,runChecks},localReview))
  .catch(error=>{throw error?.operationNotStarted===true?unsubmitted(error):error;});
}
async function executeOnce(records,worker,{taskId,artifactId,inputReceipt,runChecks},localReview){
 let attempt,proveNotSubmitted,submitRequested=false;
 try{
  const task=records.read(taskId),target=task.workflowVersion===2?task.deployment?.config?.target:null;
  const kind=target==='local'?'run':target==='cluster'?'cluster-run':null;
  const matches=task.artifacts.filter(row=>row.id===artifactId&&['run','cluster-run'].includes(row.kind)&&(!kind||row.kind===kind));
  const [artifact]=matches;
  assertDeploymentWorker(task,worker);assertConfirmedDeployment(task);
  if(!artifact)throw Error('Prepared run unavailable');
  if(matches.length>1)throw Error('Run ID matches multiple records. Open the original run to continue.');
  if(task.workflowVersion===2&&(!deploymentCurrent(task)||task.deployment.prepared.artifactId!==artifactId))throw Error('Prepare the current input revision before execution');
  if(task.workflowVersion===2&&inputReceipt!==task.deployment.prepared.inputIdentity)throw Error('Review the actual input snapshots for this deployment before execution');
  const prefix=artifact.kind==='cluster-run'?'/api/cluster/':'/api/run/',connection=worker.connection,connectionEpoch=worker.connectionEpoch;
  const observesInputs=artifact.kind==='run'&&task.authoring&&localReview?.verifyPreparedActual&&(task.parameters?.engine==='pygas.build'?!!task.composition:!!task.consumerArtifact&&['bias.validate','gpumd.sampling'].includes(task.parameters?.engine));
  const observationOwner=observesInputs?localReview.beginOperation(taskId):null;
  const sameDraft=()=>{const fresh=records.read(taskId);return fresh.parameterRevision===task.parameterRevision&&fresh.deployment?.revision===task.deployment?.revision;};
  // The captured attempt is immutable; subsequent edits belong to the next draft.
  const assertWorker=()=>{if(connection&&(worker.connection!==connection||worker.connectionEpoch!==connectionEpoch))throw Error('作业服务连接已变化。');assertDeploymentWorker(task,worker);assertDeploymentWorker(records.read(taskId),worker);if(observationOwner&&sameDraft())localReview.assertOperation(observationOwner);};
  const current=await worker.request('POST',prefix+'status',{run_id:artifact.id});assertWorker();
  if(task.workflowVersion===2&&inputReceipt!==snapshotIdentity(task,current))throw Error('Prepared input snapshot identity changed');
  const matchesRun=run=>run?.id===artifact.id&&run.project_id===(task.workflowVersion===2?task.deployment.config.projectId:task.projectId)&&
   (artifact.kind==='cluster-run'?run.kind==='cluster-run':run.kind!=='cluster-run');
  if(!matchesRun(current))throw Error('Run identity does not match the workflow deployment');
  if(!['draft','ready'].includes(current.status)){records.linkRun(taskId,current);return current;}
  const pending=records.read(taskId);
  if(pending.execution&&['validating','submitting','unknown'].includes(pending.execution.phase))throw Error('An execution request is pending; reconcile its recorded run, never resubmit unknown');
  attempt={artifactId,artifactKind:artifact.kind,parameterRevision:task.parameterRevision,deploymentRevision:task.deployment?.revision,inputIdentity:inputReceipt,runChecks};
  pending.execution={...attempt,phase:'validating'};records.save(pending);
  if(observesInputs&&sameDraft()){await localReview.verifyPreparedActual(taskId,current,task.deployment.config,current.inputs,true);assertWorker();}
  // Checks are evidence. The worker independently enforces authorization,
  // immutable inputs and mandatory serialized-artifact/target compatibility.
  const checked=runChecks?await worker.request('POST',prefix+'validate',{run_id:artifact.id}):current;assertWorker();
  const actual=observesInputs&&sameDraft()?await worker.request('POST',prefix+'status',{run_id:artifact.id}):checked?.id?checked:current;assertWorker();
  if(!['draft','ready'].includes(actual.status)||!isDeepStrictEqual(immutableRun(current),immutableRun(actual)))throw Error('Prepared execution identity changed during validation');
  if(observesInputs&&sameDraft()){await localReview.verifyPreparedActual(taskId,actual,task.deployment.config,actual.inputs,true);assertWorker();}
  const fresh=records.read(taskId);fresh.execution={...attempt,phase:'submitting'};records.save(fresh);
  // Older workers may only return the authentication code. Verify their exact draft before clearing that attempt.
  if(artifact.kind==='cluster-run'&&Number.isInteger(connectionEpoch)&&typeof current.nonce==='string'&&current.nonce)proveNotSubmitted=async()=>{
   assertWorker();const proof=await worker.request('POST',prefix+'status',{run_id:artifact.id});assertWorker();
   return matchesRun(proof)&&['draft','ready'].includes(proof.status)&&!proof.submit_attempted&&!current.submit_attempted&&proof.job_id==null&&current.job_id==null&&isDeepStrictEqual(immutableRun(current),immutableRun(proof));
  };
  submitRequested=true;
  const result=await worker.request('POST',prefix+'submit',{run_id:artifact.id});assertWorker();
  if(!matchesRun(result)||!['queued','running','unknown','succeeded','failed','cancelled'].includes(result.status))throw Error('The worker did not confirm the exact submitted run');
  records.linkRun(taskId,result);const done=records.read(taskId);done.execution={...attempt,phase:result.status==='unknown'?'unknown':'confirmed',status:result.status};records.save(done);return result;
 }catch(error){
  let notSubmitted=!submitRequested||error?.operationNotStarted===true;
  if(!notSubmitted&&authRequired(error)&&proveNotSubmitted){try{notSubmitted=await proveNotSubmitted();}catch{}}
  if(attempt){
   const failed=records.read(taskId);
   failed.execution={...attempt,phase:notSubmitted?'blocked':'unknown',message:error.message,
    ...(notSubmitted?{notSubmitted:true,...authRequired(error)?{authenticationRequired:true}:{}}:{})};
   records.save(failed);
  }
  throw notSubmitted?unsubmitted(error):error;
 }
}
