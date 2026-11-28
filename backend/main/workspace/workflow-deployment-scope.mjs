import {createHash} from 'node:crypto';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {resourceDeploymentQueue} from '../../../contracts/compute/deployment-authorization.mjs';
import {deploymentWorker} from './deployment-state.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function assertDeploymentOwner(task){
 if(!task.provider||!task.threadId)throw Error('请从此计算流程所属会话打开运行设置。');
}

export async function describeWorkflowDeploymentScope(worker,task,config,{engines,localInputs,environments=[],remoteInputs=[]},guard){
 assertDeploymentOwner(task);
 const binding=deploymentWorker(worker),remote=config.target==='cluster';
 const targets=await worker.request('GET',remote?'/api/clusters':'/api/environments');
 guard();
 const selected=Array.isArray(targets)&&targets.find(target=>target.id===config.targetId);
 const environmentIds=remote?[]:[...new Set([config.targetId,...environments])].sort();
 if(!selected||environmentIds.some(id=>!targets.some(target=>target.id===id)))throw Error('所选计算资源已不在登记列表中，请重新选择。');

 const queue=remote?resourceDeploymentQueue(selected,engines):null;
 if(queue){
  if(config.queueSelection!=='policy')throw Error('请选择此计算资源已登记的队列环境。');
  const targetId=config.resources.queue_target_id;
  if(!queue.targets.length||targetId&&!queue.targets.some(target=>target.id===targetId))throw Error('此资源没有可用于当前引擎的已授权队列环境。');
 }
 if(localInputs.some(file=>typeof file!=='string'||!path.posix.isAbsolute(file)||path.posix.normalize(file)==='/'||/[\\\r\n\0]/.test(file)))
  throw Error('请选择作业服务可读取的完整 Linux 输入文件路径。');
 const scope={owner:digest([task.provider,task.threadId]),workflow:task.id,resource:digest(binding),
  target:config.target,targetId:config.targetId,targetVersion:selected.version??null,
  ...remoteInputs.length?{remoteInputs:[...new Set(remoteInputs)].sort()}:{}};
 const policy={engines:[...new Set(engines)].sort(),gpus:remote?[]:[config.gpu],max_seconds:config.maxSeconds,max_concurrent:1,
  input_roots:[...new Set(localInputs)].sort(),environments:environmentIds,clusters:remote?[config.targetId]:[],
  ...(queue?{cluster_queue_policies:{[config.targetId]:queue.policy}}:{})};
 const id='workflow-scope-'+digest([scope,config,policy]).slice(0,48);
 policy.input_roots.push(path.posix.join(binding.root,'projects',id,'inputs'));
 return {id,name:id,conversation_scope:scope,policy};
}

export async function ensureWorkflowDeploymentScope(worker,task,config,inputs,guard){
 const project=await describeWorkflowDeploymentScope(worker,task,config,inputs,guard);
 const saved=await worker.request('POST','/api/projects',project);
 guard();
 if(!saved||saved.id!==project.id||!isDeepStrictEqual(saved.conversation_scope,project.conversation_scope)||!isDeepStrictEqual(saved.policy,project.policy))
  throw Error('作业服务返回的会话权限与当前部署不一致。');
 return project.id;
}
