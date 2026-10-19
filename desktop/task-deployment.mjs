import {randomUUID} from 'node:crypto';
import {legacyNebCorrection} from './neb-binding.mjs';
import {isDeepStrictEqual} from 'node:util';
import {validDeployment,scientificSpec,deploymentCurrent,snapshotIdentity,inputControlParameters} from '../shared/deployment.mjs';
export function saveDeployment(records,{taskId,value}){
 const task=records.read(taskId);if(task.workflowVersion!==2)throw Error('This workflow uses the legacy execution page');
 if(['validating','submitting','unknown'].includes(task.execution?.phase))throw Error('请先核对原作业状态');
 const config=validDeployment(value);if(task.review?.status!=='ready'||task.review.parameterRevision!==task.parameterRevision)throw Error('请先完成当前计算流程的科学参数复核');
 if(!isDeepStrictEqual(task.deployment?.config,config))task.deployment={config,revision:(task.deployment?.revision||0)+1};
 return records.save(task);
}
export async function prepareDeployment(records,worker,{taskId}){
 const task=records.read(taskId);if(task.review?.status!=='ready'||task.review.parameterRevision!==task.parameterRevision)throw Error('计算流程已变化，请重新复核');
 if(['validating','submitting','unknown'].includes(task.execution?.phase))throw Error('请核对原提交，不要创建重复作业');
 const config=validDeployment(task.deployment?.config),science=scientificSpec(task),revision=task.deployment.revision;
 if(deploymentCurrent(task))return worker.request('POST',task.deployment.config.target==='cluster'?'/api/cluster/status':'/api/run/status',{run_id:task.deployment.prepared.artifactId});
 const request=task.deployment.request,identity=request?.parameterRevision===task.parameterRevision&&request?.deploymentRevision===revision?request.id:randomUUID();task.deployment.request={id:identity,parameterRevision:task.parameterRevision,deploymentRevision:revision};records.save(task);
 const spec={...science,name:task.name,project_id:config.projectId,max_seconds:config.maxSeconds,idempotency_key:identity,directory_name:config.directoryName};
 if(task.authoring?.projectId&&task.authoring.projectId!==config.projectId&&config.inputSource!=='remote'){const adopted=await worker.request('POST','/api/authoring/adopt',{source_project_id:task.authoring.projectId,target_project_id:config.projectId,paths:Object.values(spec.inputs)});spec.inputs=Object.fromEntries(Object.entries(spec.inputs).map(([name,file])=>[name,adopted.paths[file]||file]));}
 if(config.target==='cluster'){spec.cluster_id=config.targetId;spec.resources=config.resources;if(config.inputSource==='remote'){spec.remote_inputs=spec.inputs;spec.inputs={};}}
 else{spec.environment_id=config.targetId;spec.gpu=config.gpu;}
 const run=await worker.request('POST',config.target==='cluster'?'/api/cluster/prepare':'/api/runs/prepare',{spec});
 const binding=task.inputBinding,hashes=(run.snapshots||[]).map(s=>({name:s.name,sha256:s.sha256})).sort((a,b)=>a.name.localeCompare(b.name));
 let correctedLegacy=null;
 if(binding&&!isDeepStrictEqual(inputControlParameters(binding.parameters),inputControlParameters(science.parameters))&&isDeepStrictEqual(binding.hashes,hashes)){
  const bindingArtifact=binding.artifactId||(!binding.contractVersion&&task.artifacts.find(artifact=>artifact.id===task.execution?.artifactId&&artifact.engine==='gpumd.neb'&&artifact.preparedRevision===binding.parameterRevision)?.id);
  if(config.target==='local'&&task.parameters.engine==='gpumd.neb'&&bindingArtifact){
   const prior=await worker.request('POST','/api/run/status',{run_id:bindingArtifact});if(prior.id===bindingArtifact&&prior.project_id===config.projectId&&run.input_contract?.status==='passed'&&legacyNebCorrection(task,prior,science.parameters))correctedLegacy={kind:'invalid-unstarted-neb-schema',previousArtifactId:prior.id,sameSnapshots:true,scope:'Equivalent aliases and recorded input facts only; full target validation still required'};
  }
  if(!correctedLegacy){const blocked=records.read(taskId);blocked.deployment.request=null;records.save(blocked);throw Error('科学参数已修改，但实际输入文件未更新；请让 Agent 更新输入文件后重新复核，不能执行旧输入');}
 }
 const fresh=records.read(taskId);if(fresh.parameterRevision!==task.parameterRevision||fresh.deployment?.revision!==revision)throw Error('准备期间流程或部署已修改；已有草稿保留，请重新检查');
 const artifact={kind:config.target==='cluster'?'cluster-run':'run',id:run.id,name:run.name,engine:run.engine,preparedRevision:task.parameterRevision};
 fresh.inputBinding={contractVersion:2,artifactId:run.id,parameters:science.parameters,hashes,parameterRevision:task.parameterRevision,semanticStatus:'not_run',...correctedLegacy?{correction:correctedLegacy}:{}};if(!fresh.authoring)fresh.projectId=config.projectId;fresh.artifacts=[...fresh.artifacts.filter(a=>a.id!==run.id),artifact];fresh.deployment.prepared={artifactId:run.id,parameterRevision:task.parameterRevision,deploymentRevision:revision,inputIdentity:snapshotIdentity(fresh,run)};records.save(fresh);return run;
}
