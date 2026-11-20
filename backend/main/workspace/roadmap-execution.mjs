import {isDeepStrictEqual as equal} from 'node:util';
import {createHash} from 'node:crypto';
import {createVerifiedWorkerScope} from '../compute/verified-worker-scope.mjs';
import {assertConfirmedDeployment,assertDeploymentWorker} from './deployment-state.mjs';
import {isSshWorkerBinding,sameSshWorkerData,sameWorkerBinding,taskWorkerSource} from '../../../contracts/compute/task-worker-binding.mjs';
import {parameterValue,setParameter} from '../../../contracts/workflows/task-fields.mjs';
import {linuxPath} from '../../../contracts/transport-policy.mjs';

const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const executionId=(taskId,sha256)=>createHash('sha256').update(JSON.stringify([taskId,sha256])).digest('hex');
const index='roadmap-execution-index';
const roadmapPath=route=>'/api/workflow/roadmap/'+route;
function request(value,keys){
 if(!value||!equal(Object.keys(value).sort(),[...keys].sort())||typeof value.taskId!=='string'||!value.taskId)throw Error('Invalid roadmap request');
}
function assertRoadmapSchema(health){
 if(health?.roadmap_execution_schema!==1)throw Error('此作业服务尚未提供流程图执行接口。');
}

function registeredGroup(ref,groups,packages){
 const group=groups.read(ref);
 if(!equal(ref,{id:group.id,version:group.version})||!group.definition_text)throw Error('Unknown frozen tool group');
 const features={};
 for(const step of group.compiled.steps){
  const pkg=packages.read({package_id:step.tool_id,package_version:step.package_version});
  const feature=pkg.manifest.functions.find(item=>item.id===step.function_id);
  if(!feature||feature.engine!==step.engine||pkg.package_version!==step.package_version)throw Error('Frozen tool function changed');
  features[step.id]={package_version:pkg.package_version,source_commit:pkg.source_commit,manifest_sha256:pkg.manifest_sha256,
    engine:feature.engine,command:feature.operation.command,entrypoint_sha256:pkg.files?.find(item=>item.path===feature.entrypoint)?.sha256||null,
    parameters:step.parameters};
 }
 return {definition_text:group.definition_text,features};
}

export function createRoadmapController({worker,current,getSettings,getTask,catalog,groups,packages,assertIdle,confirm,allocateWorkspace,completed,sources=()=>[]}){
 const scope=createVerifiedWorkerScope({worker,current,getSettings,label:'Roadmap',allowSsh:true});
 function owned(taskId){
  const owner=current(),task=getTask(taskId);
  if(task?.id!==taskId||task.workflowVersion!==2||owner?.taskId!==taskId||owner?.provider!==task.provider||!task.threadId||owner.threadId!==task.threadId)throw Error('请先打开此流程所属的会话。');
  return task;
 }
 function deploymentOwner(taskId){
  const task=owned(taskId);
  assertDeploymentWorker(task,worker);
  return task;
 }
 function plan(task,environments){
  assertConfirmedDeployment(task);
  const config=task.deployment?.config;
  const remote=worker.identity?.kind==='ssh';
  if(!task.roadmap||config?.target!==(remote?'cluster':'local')||!task.deployment.workerBinding||!sameWorkerBinding(task.deployment.workerBinding,worker))throw Error('请先保存计算项目及目标资源，并连接此流程的原作业服务。');
  if(task.workspaceChoice==='pending')throw Error('请先选择此流程的工作区。');
  let parameters=structuredClone(task.parameters);
  for(const input of task.roadmap.resources.filter(resource=>resource.field)){
   const value=parameterValue(parameters,input.field);
   if(typeof value==='string'&&value)parameters=setParameter(parameters,input.field,linuxPath(value));
   if(Array.isArray(value))parameters=setParameter(parameters,input.field,value.map(path=>typeof path==='string'&&path?linuxPath(path):path));
  }
  if(!environments||typeof environments!=='object'||Array.isArray(environments)||Object.entries(environments).some(([key,id])=>!task.roadmap.steps.some(step=>step.id===key)||typeof id!=='string'||!id.length||id.length>128))throw Error('Invalid per-node environment selection');
  return {task_id:task.id,name:task.name,original_request:task.request||task.name,
   workspace:{choice:task.workspaceChoice??null,id:task.workspace?.id??null,root:task.workspace?.root??null},
   revision:{parameters:task.parameterRevision||0,deployment:task.deployment.revision},
   ...(task.roadmap.tool_group?{tool_group:registeredGroup(task.roadmap.tool_group,groups,packages)}:{}),node_environments:structuredClone(environments),
   roadmap:structuredClone(task.roadmap),parameters,target:{project_id:config.projectId,gpu:config.gpu??0,max_seconds:config.maxSeconds,
    ...(remote?{cluster_id:config.targetId,resources:Object.fromEntries(Object.entries(config.resources).filter(([key,v])=>v!==''&&(!config.queueSelection||!['queue','account'].includes(key)))),
      conversation:{provider:task.provider,thread_id:task.threadId}}:{environment_id:config.targetId})}};
 }
 async function start(taskId){
  deploymentOwner(taskId);
  const ticket=await scope.verified();ticket.assert();deploymentOwner(taskId);
  assertRoadmapSchema(worker.connection.health);
  return ticket;
 }
 const post=(route,data)=>worker.request('POST',roadmapPath(route),data);
 async function observation(taskId){
  const expected=structuredClone(taskWorkerSource(owned(taskId))),owner=structuredClone(current()),binding=expected?.binding;
  const guard=()=>{
   if(!equal(current(),owner)||!equal(taskWorkerSource(owned(taskId)),expected))throw Error('此流程的会话或作业服务来源已变化。');
  };
  let foreground;
  if(isSshWorkerBinding(binding)){
   try{foreground=scope.currentBinding();}catch{/* A separately hosted service can still read the original receipts. */}
   if(!equal(binding,foreground)||worker.connection?.health?.roadmap_execution_schema!==1){
    const hosted=sources().find(source=>source.kind==='ssh'&&source.health?.roadmap_execution_schema===1&&sameSshWorkerData(binding,source.binding));
    if(hosted){
     const beforeDispatch=health=>{
      guard();assertRoadmapSchema(health);
      if(!sameSshWorkerData(binding,{...hosted.binding,root:health.root,hostIdentity:health.hostIdentity}))throw Error('原流程的 SSH 作业服务来源尚未核对。');
     };
     return {binding,assert:guard,read:(route,data)=>hosted.request('POST',roadmapPath(route),data,{beforeDispatch,timeoutMs:15000})};
    }
   }
  }
  const ticket=sameSshWorkerData(binding,foreground)?await scope.verified(foreground):await start(taskId);
  const assert=()=>{ticket.assert();guard();assertRoadmapSchema(worker.connection.health);};
  return {binding:isSshWorkerBinding(binding)?binding:ticket.binding,assert,read:post};
 }
 function storedReceipt(taskId,id,sha256,binding){
  const stored=catalog.get(index,id);
  if(stored&&(stored.id!==id||stored.task_id!==taskId||stored.snapshot_sha256!==sha256||
     !equal(stored.worker_binding,binding)&&!sameSshWorkerData(stored.worker_binding,binding)))throw Error('已保存执行回执的来源或快照不一致。');
  return stored;
 }
 function note(taskId,binding,row){
  if(row.task_id!==taskId||!hash(row.snapshot_sha256)||row.id!==executionId(taskId,row.snapshot_sha256))throw Error('Unexpected workflow execution receipt');
  const prior=storedReceipt(taskId,row.id,row.snapshot_sha256,binding);
  if(prior&&prior.confirmed_at!==row.confirmed_at)throw Error('已保存执行回执的确认时间不一致。');
  const receipt=prior?{...prior}:{id:row.id,task_id:taskId,snapshot_sha256:row.snapshot_sha256,worker_binding:binding,confirmed_at:row.confirmed_at};
  if(Object.keys(row.initial_private_versions||{}).length)delete receipt.observation;
  else receipt.observation={execution_id:row.id,snapshot_sha256:row.snapshot_sha256,status:row.status,observed_at:Date.now(),
   goals:row.goals.map(goal=>({resource:goal.resource,status:goal.status,producer:goal.artifact?.producer,sha256:goal.artifact?.sha256,
    checks:goal.checks.map(({requirement,status})=>({requirement,status}))}))};
  catalog.put(index,row.id,receipt);
  completed?.(getTask(taskId),row);
 }
 return {
  async preview(value){
   request(value,['taskId','environments']);const ticket=await start(value.taskId),source=plan(deploymentOwner(value.taskId),value.environments);
   const result=await post('preview',source);ticket.assert();
   if(!equal(plan(deploymentOwner(value.taskId),value.environments),source))throw Error('流程已修改，请重新核对。');
   if(source.target.cluster_id&&result.task_id===value.taskId&&Array.isArray(result.missing_tools)&&result.missing_tools.length)return result;
   if(!hash(result.snapshot_sha256)||result.snapshot?.task_id!==value.taskId)throw Error('流程快照尚未核对。');
   return result;
  },
  async confirm(value,event){
   request(value,['taskId','snapshotSha256','environments']);if(!hash(value.snapshotSha256))throw Error('Reviewed snapshot required');
   assertIdle();const ticket=await start(value.taskId),source=plan(deploymentOwner(value.taskId),value.environments);
   const guard=()=>{ticket.assert();assertIdle();if(!equal(plan(deploymentOwner(value.taskId),value.environments),source))throw Error('流程已修改，请重新核对。');};
   const review=await post('preview',source);guard();
   if(review.snapshot_sha256!==value.snapshotSha256||review.snapshot?.task_id!==value.taskId)throw Error('输入、参数或工具版本已变化，请重新核对。');
   if(!await confirm(review,event))return null;
   guard();
   const workspace=source.target.cluster_id?await allocateWorkspace({task:deploymentOwner(value.taskId),requestId:value.snapshotSha256},guard):null;
   guard();const state=await post('confirm',{plan:source,snapshot_sha256:value.snapshotSha256,...workspace?{workspace_receipt:workspace}:{}});
   ticket.assert();if(state.snapshot_sha256!==value.snapshotSha256)throw Error('Worker confirmed a different snapshot');
   note(value.taskId,ticket.binding,state);return state;
  },
  async list(value){
   request(value,['taskId']);const ticket=await observation(value.taskId);ticket.assert();
   const states=await ticket.read('list',{task_id:value.taskId});ticket.assert();
   for(const state of states)note(value.taskId,ticket.binding,state);
   return states;
  },
  async snapshot(value){
   request(value,['taskId','executionId']);if(!hash(value.executionId))throw Error('Invalid execution identity');
   const ticket=await observation(value.taskId);ticket.assert();
   const review=await ticket.read('snapshot',{task_id:value.taskId,execution_id:value.executionId});ticket.assert();
   if(review.snapshot?.task_id!==value.taskId||!hash(review.snapshot_sha256)||
      executionId(value.taskId,review.snapshot_sha256)!==value.executionId)throw Error('Unexpected frozen workflow identity');
   storedReceipt(value.taskId,value.executionId,review.snapshot_sha256,ticket.binding);
   return review;
  }
 };
}
