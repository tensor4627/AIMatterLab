import {isDeepStrictEqual as equal} from 'node:util';
import {validDeploymentDraft,sameDeploymentConfig} from '../shared/deployment-draft.mjs';
import {validateProjectSpec} from '../shared/project-policy-edit.mjs';
import {engineContracts} from '../shared/engine-contracts.mjs';
import {taskOperation} from './task-operations.mjs';
import {assertTaskWorker} from '../shared/task-worker-binding.mjs';
const locked=task=>['validating','submitting','unknown'].includes(task.execution?.phase);
function request(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(',')||typeof value.taskId!=='string'||!value.taskId||value.taskId.length>200)throw Error('Invalid typed deployment request');}
export function deploymentWorker(worker){if(!worker?.connection||!worker.identity?.distribution||!worker.identity?.root)throw Error('请连接此流程的作业服务后继续。');const port=worker.connectionTarget?.port;if(port!==undefined&&(!Number.isInteger(port)||port<1024||port>65535))throw Error('实际作业服务端口无效，请重新核对连接。');return {...structuredClone(worker.identity),...port!==undefined?{port}:{}};}
export function assertDeploymentWorker(task,worker){assertTaskWorker(task,worker);}
export function assertConfirmedDeployment(task){if(task.deploymentDraft&&!sameDeploymentConfig(task.deploymentDraft.config,task.deployment?.config))throw Error('部署草稿与已确认版本不同，请先保存并核对最新部署设置。');}
export function saveDeploymentDraft(records,worker,args){
 request(args,['taskId','value','expectedRevision','mutationId']);const {taskId,value,expectedRevision,mutationId}=args;
 const task=records.read(taskId);if(task.workflowVersion!==2||locked(task))throw Error('请先核对原作业状态，再修改部署设置。');
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||typeof mutationId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(mutationId))throw Error('无效的部署草稿保存请求');
 const config=validDeploymentDraft(value),identity=deploymentWorker(worker);assertDeploymentWorker(task,worker);
 if(task.deploymentDraft?.lastMutationId===mutationId){if(!equal(config,task.deploymentDraft.config))throw Error('部署草稿请求内容发生变化');return task;}
 if((task.deploymentDraft?.revision||0)!==expectedRevision)throw Error('部署设置已在其他页面更新；本机修改保留，请重新读取并核对。');
 task.deploymentDraft={revision:expectedRevision+1,config,workerBinding:identity,lastMutationId:mutationId};return records.save(task);
}
export async function deploymentContext(records,worker,args){
 request(args,['taskId']);const {taskId}=args;
 const task=records.read(taskId),connection=worker.connection,identity=deploymentWorker(worker);assertDeploymentWorker(task,worker);
 const [projects,environments,clusters]=await Promise.all(['/api/projects','/api/environments','/api/clusters'].map(route=>worker.request('GET',route)));
 if(worker.connection!==connection||!equal(identity,deploymentWorker(worker)))throw Error('作业服务连接已变化，请重新读取当前流程。');
 if(![projects,environments,clusters].every(Array.isArray))throw Error('计算项目或环境列表尚未完整读取，请重试。');
 return {taskId,worker:identity,projects,environments,clusters};
}
/** One human action records a stable intent before creating a new project. No job is prepared. */
export async function createDeploymentProject(records,worker,args){
 request(args,['taskId','spec','config','expectedRevision','requestId']);const {taskId,spec,config,expectedRevision,requestId}=args;
 return taskOperation(records,taskId,'create-project',JSON.stringify([requestId,spec,config]),()=>createProjectOnce(records,worker,{taskId,spec,config,expectedRevision,requestId}));
}
async function createProjectOnce(records,worker,{taskId,spec,config,expectedRevision,requestId}){
 if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(requestId))throw Error('无效的计算项目创建请求');
 validateProjectSpec(spec,Object.keys(engineContracts.engines));const task=records.read(taskId);if(task.workflowVersion!==2||locked(task))throw Error('请先核对原作业状态');assertDeploymentWorker(task,worker);
 const connection=worker.connection,identity=deploymentWorker(worker),projectId='compute-'+requestId,value=validDeploymentDraft({...config,projectId});
 const prior=task.deploymentProjectIntent;
 if(prior?.status==='creating'&&prior.requestId!==requestId)throw Error('上一次项目创建尚未核对；请先恢复其结果，避免重复创建。');
 if(prior?.requestId===requestId){if(!equal(prior.spec,spec)||!equal(prior.config,value))throw Error('原创建请求已存在，请核对其结果后再修改。');}
 else{saveDeploymentDraft(records,worker,{taskId,value,expectedRevision,mutationId:requestId});const fresh=records.read(taskId);fresh.deploymentProjectIntent={requestId,projectId,spec:structuredClone(spec),config:value,workerBinding:identity,status:'creating'};records.save(fresh);}
 const guard=()=>{const fresh=records.read(taskId);if(locked(fresh)||worker.connection!==connection||!equal(identity,deploymentWorker(worker))||fresh.deploymentProjectIntent?.requestId!==requestId)throw Error('项目创建上下文已变化，原创建结果保留，请重新核对。');return fresh;};
 let rows=await worker.request('GET','/api/projects');guard();if(!Array.isArray(rows))throw Error('无法核对计算项目创建状态');
 let project=rows.find(row=>row.id===projectId);
 if(!project){project=await worker.request('POST','/api/projects',{...spec,id:projectId});guard();}
 if(project.id!==projectId||project.authoring_only||!equal({name:project.name,policy:project.policy},spec))throw Error('计算项目返回与审阅设置不一致；请保留当前结果并检查。');
 const fresh=guard();fresh.deploymentProjectIntent.status='confirmed';records.save(fresh);return {project,task:records.read(taskId)};
}
