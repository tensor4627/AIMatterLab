import {isDeepStrictEqual as equal} from 'node:util';
import {assertTaskWorker,actualAuthoringWorker,validTaskWorkerSource,sameWorkerBinding} from '../shared/task-worker-binding.mjs';

/** Human renderer path only. MCP retains the worker's existing authorization gate. */
export async function createStructureWithAuthoringContext({records,worker,selection},data){
 const owner=structuredClone(selection()||null),task=owner?.taskId?records.read(owner.taskId):null;
 const dispatch=()=>worker.request('POST','/api/structures/create',data);
 if(!task||task.provider!==owner.provider||task.threadId!==owner.threadId||task.authoring?.projectId!==data?.project_id)return dispatch();
 if(!validTaskWorkerSource({source:'authoring',binding:task.authoring.workerBinding})||!sameWorkerBinding(task.authoring.workerBinding,worker))throw Error('Restore this workflow\'s original authoring source before creating a structure.');
 const connection=worker.connection,epoch=worker.connectionEpoch,identity=actualAuthoringWorker(worker);
 const scope=value=>({provider:value.provider,threadId:value.threadId,authoring:value.authoring,workspace:value.workspace});
 const expected=structuredClone(scope(task));
 const guard=()=>{
  const current=records.read(task.id);
  if(!equal(owner,selection())||worker.connection!==connection||worker.connectionEpoch!==epoch||!equal(identity,actualAuthoringWorker(worker))||!equal(expected,scope(current))||records.bound(owner.provider,owner.threadId)?.id!==task.id||records.deleted(owner.provider,owner.threadId))throw Error('Structure authoring context changed; retry in the original workflow.');
  assertTaskWorker(current,worker);
 };
 guard();
 const projects=await worker.request('GET','/api/projects');guard();
 const project=projects.find(value=>value.id===data.project_id);
 const owned=project?.authoring_only===true&&(project.authoring_task_id===task.id||project.studio_workspace?.schema_version===1&&task.workspace?.id===project.id);
 if(owned){
  const environments=await worker.request('GET','/api/environments');guard();
  if(environments.some(value=>value.id===data.environment_id&&typeof value.executables?.python==='string')){
   const context=await worker.request('POST','/api/authoring/context',{workspace_id:task.id,project_id:project.id,name:task.name,structure_paths:[],selected_paths:[]});guard();
   if(context.project?.id!==project.id||context.input_root!==task.authoring.inputRoot||!equal(context.project.policy.engines,project.policy.engines)||!equal(context.project.policy.clusters,project.policy.clusters))throw Error('Unexpected authoring project scope; structure was not created.');
   // Do not adopt context.environment_id, import files, or rewrite the task's canonical environment.
  }
 }
 guard();
 return dispatch();
}
