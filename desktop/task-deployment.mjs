import {sameAuthority} from './review-authority.mjs';
import {randomUUID} from 'node:crypto';
import {manifestDefinitionCorrection} from './manifest-binding.mjs';
import {legacyNebCorrection} from './neb-binding.mjs';
import {isDeepStrictEqual} from 'node:util';
import {deploymentProjectIssue} from '../shared/deployment-authorization.mjs';
import {assertDeploymentWorker,deploymentWorker,assertConfirmedDeployment} from './deployment-state.mjs';
import {taskOperation} from './task-operations.mjs';
import {validDeployment,scientificSpec,deploymentCurrent,snapshotIdentity,inputControlParameters} from '../shared/deployment.mjs';
export function saveDeployment(records,{taskId,value,expectedDraftRevision},localReview,worker){
 const task=records.read(taskId);if(task.workflowVersion!==2)throw Error('This workflow uses the legacy execution page');
 if(['validating','submitting','unknown'].includes(task.execution?.phase))throw Error('请先核对原作业状态');
 const config=validDeployment(value);if(localReview?!localReview.authority(task,config.target):task.review?.status!=='ready'||task.review.parameterRevision!==task.parameterRevision)throw Error('请先完成当前计算流程的科学参数复核');
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
 const task=records.read(taskId),target=task.deployment?.config?.target,authority=localReview?.authority(task,target);if(localReview?!authority:task.review?.status!=='ready'||task.review.parameterRevision!==task.parameterRevision)throw Error('计算流程已变化，请重新复核');
 assertDeploymentWorker(task,worker);assertConfirmedDeployment(task);const connection=worker.connection;
 if(['validating','submitting','unknown'].includes(task.execution?.phase))throw Error('请核对原提交，不要创建重复作业');
 const config=validDeployment(task.deployment?.config),science=scientificSpec(task),revision=task.deployment.revision,localOperation=authority?.kind==='local-human'?localReview.beginOperation(taskId):null;const assertLocal=()=>{if(connection&&worker.connection!==connection)throw Error('作业服务连接已变化，请核对原准备结果。');assertDeploymentWorker(task,worker);assertConfirmedDeployment(records.read(taskId));if(localOperation)localReview.assertOperation(localOperation);};
 if(authority?.kind==='local-human'){const checked=await localReview.verify(taskId);assertLocal();if(!sameAuthority(checked.authority,authority))throw Error('Human scientific input receipt changed');if(localReview.verifyDeployment){await localReview.verifyDeployment(taskId,config);assertLocal();}else if(config.target!=='local'||config.inputSource!=='local'||config.targetId!==task.authoring?.environmentId)throw Error('Human receipt requires its exact local reviewed runtime');}
 const projects=await worker.request('GET','/api/projects');assertLocal();
 if(!Array.isArray(projects))throw Error('无法读取计算项目，请检查作业服务连接后重试。');
 const issue=deploymentProjectIssue(projects.find(project=>project.id===config.projectId),config,science.engine);
 if(issue)throw Error(issue.message);
 const beforePrepare=records.read(taskId);if(beforePrepare.parameterRevision!==task.parameterRevision||beforePrepare.deployment?.revision!==revision||!isDeepStrictEqual(validDeployment(beforePrepare.deployment?.config),config)||(localReview?!sameAuthority(localReview.authority(beforePrepare,config.target),authority):beforePrepare.review?.status!=='ready'||beforePrepare.review.parameterRevision!==task.parameterRevision))throw Error('准备期间流程或部署已修改；请重新检查。');
 if(deploymentCurrent(task,authority)){const current=await worker.request('POST',task.deployment.config.target==='cluster'?'/api/cluster/status':'/api/run/status',{run_id:task.deployment.prepared.artifactId});assertLocal();return current;}
 const request=task.deployment.request,identity=request?.parameterRevision===task.parameterRevision&&request?.deploymentRevision===revision?request.id:randomUUID();task.deployment.request={id:identity,parameterRevision:task.parameterRevision,deploymentRevision:revision};records.save(task);
 const spec={...science,name:task.name,project_id:config.projectId,max_seconds:config.maxSeconds,idempotency_key:identity,directory_name:config.directoryName};
 if(task.authoring?.projectId&&task.authoring.projectId!==config.projectId&&config.inputSource!=='remote'){const adopted=await worker.request('POST','/api/authoring/adopt',{source_project_id:task.authoring.projectId,target_project_id:config.projectId,paths:Object.values(spec.inputs)});assertLocal();spec.inputs=Object.fromEntries(Object.entries(spec.inputs).map(([name,file])=>[name,adopted.paths[file]||file]));}
 if(config.target==='cluster'){spec.cluster_id=config.targetId;spec.resources=config.resources;if(config.inputSource==='remote'){spec.remote_inputs=spec.inputs;spec.inputs={};}}
 else{spec.environment_id=config.targetId;spec.gpu=config.gpu;}
 const run=await worker.request('POST',config.target==='cluster'?'/api/cluster/prepare':'/api/runs/prepare',{spec});assertLocal();
 let localPrepared=null;if(authority?.kind==='local-human'){localPrepared=await localReview.verifyPrepared(taskId,run,config,spec.inputs);assertLocal();if(!sameAuthority(localPrepared.authority,authority))throw Error('Local review authority changed during prepare');}
 const binding=task.inputBinding,hashes=(run.snapshots||[]).map(s=>({name:s.name,sha256:s.sha256})).sort((a,b)=>a.name.localeCompare(b.name));
 let correctedLegacy=null;
 if(binding&&!isDeepStrictEqual(inputControlParameters(binding.parameters),inputControlParameters(science.parameters))&&isDeepStrictEqual(binding.hashes,hashes)){
  const bindingArtifact=binding.artifactId||(!binding.contractVersion&&task.artifacts.find(artifact=>artifact.id===task.execution?.artifactId&&artifact.engine==='gpumd.neb'&&artifact.preparedRevision===binding.parameterRevision)?.id);
  if(config.target==='local'&&task.parameters.engine==='gpumd.neb'&&bindingArtifact){
   const prior=await worker.request('POST','/api/run/status',{run_id:bindingArtifact});if(prior.id===bindingArtifact&&prior.project_id===config.projectId&&run.input_contract?.status==='passed'&&legacyNebCorrection(task,prior,science.parameters))correctedLegacy={kind:'invalid-unstarted-neb-schema',previousArtifactId:prior.id,sameSnapshots:true,scope:'Equivalent aliases and recorded input facts only; full target validation still required'};
  }
  if(!correctedLegacy&&config.target==='local'&&task.parameters.engine==='gpumd.sampling'&&binding.contractVersion===2&&binding.artifactId){
   const prior=await worker.request('POST','/api/run/status',{run_id:binding.artifactId});correctedLegacy=await manifestDefinitionCorrection(task,prior,run,science.parameters,(run_id,name)=>worker.request('POST','/api/run/input',{run_id,name}),inputControlParameters);
  }
  if(!correctedLegacy){const blocked=records.read(taskId);blocked.deployment.request=null;records.save(blocked);throw Error('科学参数已修改，但实际输入文件未更新；请让 Agent 更新输入文件后重新复核，不能执行旧输入');}
 }
 const fresh=records.read(taskId);if(fresh.parameterRevision!==task.parameterRevision||fresh.deployment?.revision!==revision)throw Error('准备期间流程或部署已修改；已有草稿保留，请重新检查');
 if(correctedLegacy?.kind==='unstarted-optional-manifest-definition'&&!isDeepStrictEqual(fresh.inputBinding,task.inputBinding))throw Error('准备期间原输入绑定已变化，请重新检查');
 const artifact={kind:config.target==='cluster'?'cluster-run':'run',id:run.id,name:run.name,engine:run.engine,preparedRevision:task.parameterRevision};
 fresh.inputBinding={contractVersion:2,artifactId:run.id,parameters:science.parameters,hashes,parameterRevision:task.parameterRevision,semanticStatus:'not_run',...correctedLegacy?{correction:correctedLegacy}:{}};if(!fresh.authoring)fresh.projectId=config.projectId;fresh.artifacts=[...fresh.artifacts.filter(a=>a.id!==run.id),artifact];fresh.deployment.prepared={artifactId:run.id,parameterRevision:task.parameterRevision,deploymentRevision:revision,inputIdentity:snapshotIdentity(fresh,run),...(localPrepared?{reviewAuthority:localPrepared.authority,localInputLineage:localPrepared.lineage,localInputClosureSha:localPrepared.closureSha}:{})};records.save(fresh);return run;
}
