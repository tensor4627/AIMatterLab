import {randomUUID} from 'node:crypto';
import {manifestDefinitionCorrection} from './manifest-binding.mjs';
import {legacyNebCorrection} from './neb-binding.mjs';
import {isDeepStrictEqual} from 'node:util';
import {deploymentProjectIssue} from "../../../contracts/compute/deployment-authorization.mjs";

import {assertDeploymentWorker,deploymentWorker,assertConfirmedDeployment} from './deployment-state.mjs';
import {taskOperation} from './task-operations.mjs';
import {validDeployment,scientificSpec,deploymentCurrent,snapshotIdentity,inputControlParameters} from "../../../contracts/compute/deployment.mjs";
import {assertDeploymentOwner,ensureWorkflowDeploymentScope} from './workflow-deployment-scope.mjs';

export function saveDeployment(records,{taskId,value,expectedDraftRevision},localReview,worker){
 const task=records.read(taskId);if(task.workflowVersion!==2)throw Error('This workflow uses the legacy execution page');
 const config=validDeployment(value);
 if(!config.projectId)assertDeploymentOwner(task);
 if(expectedDraftRevision!==undefined&&expectedDraftRevision!==(task.deploymentDraft?.revision||0))throw Error('部署设置已变化，请先保存并核对最新草稿。');
 if(worker)assertDeploymentWorker(task,worker);
 if(!isDeepStrictEqual(task.deployment?.config,config))task.deployment={config,revision:(task.deployment?.revision||0)+1};
 if(worker)task.deployment.workerBinding=deploymentWorker(worker);
 if(task.deploymentDraft&&!isDeepStrictEqual(task.deploymentDraft.config,config))task.deploymentDraft={...task.deploymentDraft,revision:task.deploymentDraft.revision+1,config,lastMutationId:null};
 return records.save(task);
}
export async function prepareDeployment(records,worker,{taskId},localReview){
 const task=records.read(taskId);return taskOperation(records,taskId,'prepare',JSON.stringify([task.parameterRevision,task.deployment?.revision,task.deployment?.config]),()=>prepareOnce(records,worker,{taskId},localReview));
}
async function prepareOnce(records,worker,{taskId},localReview){
 if(records.read(taskId).workspaceChoice==='pending')throw Error('请先在计算流程的“工作区与文件”选择新建、已有工作区或沿用草稿目录。');
 const task=records.read(taskId),target=task.deployment?.config?.target,authority=localReview?.authority(task,target);
 assertDeploymentWorker(task,worker);assertConfirmedDeployment(task);const connection=worker.connection;
 if(['validating','submitting','unknown'].includes(task.execution?.phase))throw Error('请核对原提交，不要创建重复作业');
 const config=validDeployment(task.deployment?.config),science=scientificSpec(task),revision=task.deployment.revision;
 const observationOwner=config.target==='local'&&task.authoring&&localReview?.verifyPreparedActual&&(science.engine==='pygas.build'?!!task.composition:!!task.consumerArtifact&&['bias.validate','gpumd.sampling'].includes(science.engine))?localReview.beginOperation(taskId):null;
 const epoch=worker.connectionEpoch;
 const assertLocal=()=>{
  if(connection&&(worker.connection!==connection||worker.connectionEpoch!==epoch))throw Error('作业服务连接已变化，请核对原准备结果。');
  const latest=records.read(taskId);assertDeploymentWorker(latest,worker);assertConfirmedDeployment(latest);
  if(latest.provider!==task.provider||latest.threadId!==task.threadId||latest.parameterRevision!==task.parameterRevision||latest.deployment?.revision!==revision||!isDeepStrictEqual(validDeployment(latest.deployment?.config),config))throw Error('准备期间流程或部署已修改；请重新检查。');
  if(observationOwner)localReview.assertOperation(observationOwner);
 };
 let newAttempt=false;
 if(deploymentCurrent(task,authority)){const current=await worker.request('POST',task.deployment.config.target==='cluster'?'/api/cluster/status':'/api/run/status',{run_id:task.deployment.prepared.artifactId});assertLocal();if(!['succeeded','failed','cancelled'].includes(current.status))return current;newAttempt=true;}
 const request=newAttempt?null:task.deployment.request;
 const pending=request?.parameterRevision===task.parameterRevision&&request?.deploymentRevision===revision?request:null;
 let projectId=config.projectId||pending?.projectId;
 if(config.projectId){
  const projects=await worker.request('GET','/api/projects');assertLocal();
  if(!Array.isArray(projects))throw Error('无法读取计算项目，请检查作业服务连接后重试。');
  const issue=deploymentProjectIssue(projects.find(project=>project.id===projectId),config,science.engine);
  if(issue)throw Error(issue.message);
 }
 if(!projectId){
  const inputs=Object.values(science.inputs),remote=config.inputSource==='remote';
  projectId=await ensureWorkflowDeploymentScope(worker,task,config,{engines:[science.engine],localInputs:remote?[]:inputs,remoteInputs:remote?inputs:[]},assertLocal);
 }
 const identity=pending?.id||randomUUID(),intent=records.read(taskId);
 intent.deployment.request={id:identity,parameterRevision:task.parameterRevision,deploymentRevision:revision,...!config.projectId?{projectId}:{}};records.save(intent);
 const spec={...science,name:task.name,project_id:projectId,max_seconds:config.maxSeconds,idempotency_key:identity,directory_name:config.directoryName};
 if(task.authoring?.projectId&&task.authoring.projectId!==projectId&&config.inputSource!=='remote'){const adopted=await worker.request('POST','/api/authoring/adopt',{source_project_id:task.authoring.projectId,target_project_id:projectId,paths:Object.values(spec.inputs)});assertLocal();spec.inputs=Object.fromEntries(Object.entries(spec.inputs).map(([name,file])=>[name,adopted.paths[file]||file]));}
 if(config.target==='cluster'){spec.cluster_id=config.targetId;spec.resources=config.resources;if(config.inputSource==='remote'){spec.remote_inputs=spec.inputs;spec.inputs={};}}
 else{spec.environment_id=config.targetId;spec.gpu=config.gpu;}
 const run=await worker.request('POST',config.target==='cluster'?'/api/cluster/prepare':'/api/runs/prepare',{spec});assertLocal();
 if(!config.projectId&&run?.project_id!==projectId)throw Error('准备回执不属于此会话的部署。');
 let localPrepared=null;
 const authorizedConfig={...config,projectId};
 if(config.target==='local'&&localReview?.verifyPreparedActual&&task.authoring&&(science.engine==='pygas.build'?!!task.composition:!!task.consumerArtifact&&['bias.validate','gpumd.sampling'].includes(science.engine))){localPrepared=await localReview.verifyPreparedActual(taskId,run,authorizedConfig,spec.inputs,false);assertLocal();}
 else if(authority?.kind==='local-human'){localPrepared=await localReview.verifyPrepared(taskId,run,authorizedConfig,spec.inputs,false);assertLocal();}
 const binding=task.inputBinding,hashes=(run.snapshots||[]).map(s=>({name:s.name,sha256:s.sha256})).sort((a,b)=>a.name.localeCompare(b.name));
 let correctedLegacy=null,inputFindings=[];
 if(binding&&!isDeepStrictEqual(inputControlParameters(binding.parameters),inputControlParameters(science.parameters))&&isDeepStrictEqual(binding.hashes,hashes)){
  const bindingArtifact=binding.artifactId||(!binding.contractVersion&&task.artifacts.find(artifact=>artifact.id===task.execution?.artifactId&&artifact.engine==='gpumd.neb'&&artifact.preparedRevision===binding.parameterRevision)?.id);
  if(config.target==='local'&&task.parameters.engine==='gpumd.neb'&&bindingArtifact){
   const prior=await worker.request('POST','/api/run/status',{run_id:bindingArtifact});if(prior.id===bindingArtifact&&prior.project_id===projectId&&run.input_contract?.status==='passed'&&legacyNebCorrection(task,prior,science.parameters))correctedLegacy={kind:'invalid-unstarted-neb-schema',previousArtifactId:prior.id,sameSnapshots:true,scope:'Equivalent aliases and recorded input facts only; full target validation still required'};
  }
  if(!correctedLegacy&&config.target==='local'&&task.parameters.engine==='gpumd.sampling'&&binding.contractVersion===2&&binding.artifactId){
   const prior=await worker.request('POST','/api/run/status',{run_id:binding.artifactId});correctedLegacy=await manifestDefinitionCorrection(task,prior,run,science.parameters,(run_id,name)=>worker.request('POST','/api/run/input',{run_id,name}),inputControlParameters);
  }
  if(!correctedLegacy)inputFindings.push({status:'warning',code:'declared_controls_changed_with_identical_inputs',message:'科学参数已修改，但实际输入文件未更新；本次执行仍以保存的实际输入快照为准。'});
 }
 const fresh=records.read(taskId);if(fresh.parameterRevision!==task.parameterRevision||fresh.deployment?.revision!==revision)throw Error('准备期间流程或部署已修改；已有草稿保留，请重新检查');
 if(correctedLegacy?.kind==='unstarted-optional-manifest-definition'&&!isDeepStrictEqual(fresh.inputBinding,task.inputBinding))throw Error('准备期间原输入绑定已变化，请重新检查');
 const artifact={kind:config.target==='cluster'?'cluster-run':'run',id:run.id,name:run.name,engine:run.engine,preparedRevision:task.parameterRevision,...!config.projectId?{projectId}:{}};
 fresh.inputBinding={contractVersion:2,artifactId:run.id,parameters:science.parameters,hashes,parameterRevision:task.parameterRevision,semanticStatus:'not_run',findings:inputFindings,...correctedLegacy?{correction:correctedLegacy}:{}};if(!fresh.authoring&&config.projectId)fresh.projectId=projectId;fresh.artifacts=[...fresh.artifacts.filter(a=>a.id!==run.id||a.kind!==artifact.kind),artifact];fresh.deployment.prepared={artifactId:run.id,parameterRevision:task.parameterRevision,deploymentRevision:revision,inputIdentity:snapshotIdentity(fresh,run),...!config.projectId?{projectId}:{},...(localPrepared?{...(authority?.kind==='local-human'?{reviewAuthority:authority}:{}),inputObservation:localPrepared.authority,localInputLineage:localPrepared.lineage,localInputClosureSha:localPrepared.closureSha}:{})};records.save(fresh);return run;
}
