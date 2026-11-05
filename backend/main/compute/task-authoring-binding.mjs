import {isDeepStrictEqual as equal} from 'node:util';
import {actualAuthoringWorker,legacyAuthoringBindingEligible} from "../../../contracts/compute/task-worker-binding.mjs";

import {readWorkerStatus} from './worker-status.mjs';
import path from 'node:path';
export async function bindLegacyAuthoringWorker({records,worker,selection,settings},args){
 if(!args||typeof args!=='object'||Object.keys(args).join(',')!=='taskId'||typeof args.taskId!=='string'||!args.taskId||args.taskId.length>200)throw Error('Invalid typed authoring binding');
 const task=records.read(args.taskId),owner=selection(),connection=worker.connection,epoch=worker.connectionEpoch,target=structuredClone(settings());
 if(!legacyAuthoringBindingEligible(task))throw Error('此流程已有来源或作业记录，不能通过旧草稿入口替换绑定。');
 if(task.projectId!==task.authoring.projectId)throw Error('此流程项目与原编写项目不一致，请先核对原记录。');
 const identity=actualAuthoringWorker(worker),signature=value=>[value.distribution,value.workerRoot,value.workerPort];
 const guard=()=>{const current=selection();if(!current||!owner||!equal(owner,current)||current.provider!==task.provider||current.threadId!==task.threadId||current.taskId!==task.id||records.bound(task.provider,task.threadId)?.id!==task.id||records.deleted(task.provider,task.threadId)||!equal(task,records.read(task.id))||!equal(signature(target),signature(settings()))||worker.connection!==connection||worker.connectionEpoch!==epoch||!equal(identity,actualAuthoringWorker(worker)))throw Error('流程或服务已变化，请重新核对此草稿的原服务。');};guard();
 const status=await readWorkerStatus(worker,settings);guard();if(status.status!=='connected')throw Error('尚未核实当前作业服务，请先显式连接。');
 const projects=await worker.request('GET','/api/projects');guard();const project=Array.isArray(projects)&&projects.find(value=>value?.id===task.authoring.projectId);
 if(!project||project.authoring_only&&!project.studio_workspace&&project.authoring_task_id!==task.id)throw Error('当前服务没有此草稿原项目，不能关联到其它项目。');
 // authoring_workspace.ensure returns this service-owned input root; never infer a service root from a saved path.
 if(typeof project.id!=='string'||['.','..'].includes(project.id)||/[\\/\x00-\x1f]/.test(project.id)||task.authoring.inputRoot!==path.posix.join(identity.root,'projects',project.id,'inputs'))throw Error('此草稿原输入根不属于当前已核验服务的原项目，无法证明原服务；未关联或修改路径。');
 const environments=await worker.request('GET','/api/environments');guard();if(!Array.isArray(environments)||!environments.some(value=>value?.id===task.authoring.environmentId))throw Error('当前服务没有此草稿原环境，不能替换环境。');
 const fresh=records.read(task.id);fresh.authoring={...fresh.authoring,workerBinding:identity};guard();return records.save(fresh);
}
