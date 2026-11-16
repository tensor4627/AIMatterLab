import {isDeepStrictEqual as equal} from 'node:util';
import {createHash} from 'node:crypto';
import {createVerifiedWorkerScope} from '../compute/verified-worker-scope.mjs';
import {assertConfirmedDeployment,assertDeploymentWorker} from './deployment-state.mjs';
import {sameWorkerBinding} from '../../../contracts/compute/task-worker-binding.mjs';
import {parameterValue,setParameter} from '../../../contracts/workflows/task-fields.mjs';
import {linuxPath} from '../../../contracts/transport-policy.mjs';

const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function request(value,keys){
 if(!value||!equal(Object.keys(value).sort(),[...keys].sort())||typeof value.taskId!=='string'||!value.taskId)throw Error('Invalid roadmap request');
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

export function createRoadmapController({worker,current,getSettings,getTask,catalog,groups,packages,assertIdle,confirm}){
 const scope=createVerifiedWorkerScope({worker,current,getSettings,label:'Roadmap'});
 function owned(taskId){
  const owner=current(),task=getTask(taskId);
  if(!task||task.workflowVersion!==2||owner?.taskId!==taskId||owner?.provider!==task.provider||!task.threadId||owner.threadId!==task.threadId)throw Error('请先打开此流程所属的会话。');
  assertDeploymentWorker(task,worker);
  return task;
 }
 function plan(task,environments){
  assertConfirmedDeployment(task);
  const config=task.deployment?.config;
  if(!task.roadmap||config?.target!=='local'||!task.deployment.workerBinding||!sameWorkerBinding(task.deployment.workerBinding,worker)||worker.identity?.kind==='ssh')throw Error('请先保存本地计算项目和环境，并连接原作业服务。');
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
   roadmap:structuredClone(task.roadmap),parameters,target:{project_id:config.projectId,environment_id:config.targetId,gpu:config.gpu??0,max_seconds:config.maxSeconds}};
 }
 async function start(taskId){
  owned(taskId);
  const ticket=await scope.verified();ticket.assert();owned(taskId);
  if(worker.connection.health?.roadmap_execution_schema!==1)throw Error('此作业服务尚未提供流程图执行接口。');
  return ticket;
 }
 const post=(route,data)=>worker.request('POST','/api/workflow/roadmap/'+route,data);
 function note(taskId,ticket,row){
  const id=createHash('sha256').update(JSON.stringify([taskId,row.snapshot_sha256])).digest('hex');
  if(row.task_id!==taskId||row.id!==id||!hash(row.snapshot_sha256))throw Error('Unexpected workflow execution receipt');
  const observation={execution_id:row.id,snapshot_sha256:row.snapshot_sha256,status:row.status,observed_at:Date.now(),
   goals:row.goals.map(goal=>({resource:goal.resource,status:goal.status,producer:goal.artifact?.producer,sha256:goal.artifact?.sha256,
    checks:goal.checks.map(({requirement,status})=>({requirement,status}))}))};
  catalog.put('roadmap-execution-index',row.id,{id:row.id,task_id:taskId,snapshot_sha256:row.snapshot_sha256,worker_binding:ticket.binding,
   confirmed_at:row.confirmed_at,...Object.keys(row.initial_private_versions||{}).length?{}:{observation}});
 }
 return {
  async preview(value){
   request(value,['taskId','environments']);const ticket=await start(value.taskId),source=plan(owned(value.taskId),value.environments);
   const result=await post('preview',source);ticket.assert();
   if(!equal(plan(owned(value.taskId),value.environments),source)||!hash(result.snapshot_sha256)||result.snapshot?.task_id!==value.taskId)throw Error('流程已修改，请重新核对。');
   return result;
  },
  async confirm(value,event){
   request(value,['taskId','snapshotSha256','environments']);if(!hash(value.snapshotSha256))throw Error('Reviewed snapshot required');
   assertIdle();const ticket=await start(value.taskId),source=plan(owned(value.taskId),value.environments);
   const guard=()=>{ticket.assert();assertIdle();if(!equal(plan(owned(value.taskId),value.environments),source))throw Error('流程已修改，请重新核对。');};
   const review=await post('preview',source);guard();
   if(review.snapshot_sha256!==value.snapshotSha256||review.snapshot?.task_id!==value.taskId)throw Error('输入、参数或工具版本已变化，请重新核对。');
   if(!await confirm(review,event))return null;
   guard();const state=await post('confirm',{plan:source,snapshot_sha256:value.snapshotSha256});
   ticket.assert();if(state.snapshot_sha256!==value.snapshotSha256)throw Error('Worker confirmed a different snapshot');
   note(value.taskId,ticket,state);return state;
  },
  async list(value){
   request(value,['taskId']);const ticket=await start(value.taskId),states=await post('list',{task_id:value.taskId});ticket.assert();owned(value.taskId);
   for(const state of states)note(value.taskId,ticket,state);
   return states;
  },
  async snapshot(value){
   request(value,['taskId','executionId']);if(!hash(value.executionId))throw Error('Invalid execution identity');
   const ticket=await start(value.taskId),review=await post('snapshot',{task_id:value.taskId,execution_id:value.executionId});
   ticket.assert();owned(value.taskId);
   if(review.snapshot?.task_id!==value.taskId||!hash(review.snapshot_sha256)||
      createHash('sha256').update(JSON.stringify([value.taskId,review.snapshot_sha256])).digest('hex')!==value.executionId)throw Error('Unexpected frozen workflow identity');
   return review;
  }
 };
}
