import {workspaceController} from "./workspaces.mjs";
import {taskOperation} from "./task-operations.mjs";
import {saveDeployment,prepareDeployment} from "./task-deployment.mjs";
import {saveDeploymentDraft,deploymentContext,createDeploymentProject} from "./deployment-state.mjs";
import {openDeploymentSession} from "./deployment-session.mjs";
import {executeTask} from "./task-execution.mjs";
import {readTaskInput} from "./task-input-preview.mjs";
import {readTaskPygas,saveTaskPygas,initializeTaskPygas} from "./task-pygas.mjs";
import {restoreTaskWorker} from "../compute/worker-restore.mjs";
import {taskWorkerSource} from "../../../contracts/compute/task-worker-binding.mjs";


/** Register application operations through the host's existing trusted IPC port. */
export function registerWorkspaceTaskRoutes({
  handle,records,catalog,worker,workflowContext,agents,assertIdle,authoringAuthorization,
  getSettings,getLocalReview=()=>undefined,chooseFile,emit=()=>{},
}){
  handle('task.create',value=>{
    const selected=workflowContext.current(),ticket=value?.provider===selected?.provider&&value?.threadId===selected?.threadId?authoringAuthorization?.begin?.():null;
    const finish=task=>{authoringAuthorization?.commit?.(ticket,task);return task;};
    try{
    const task=records.create(value);
    if(task.workflowVersion===2&&!task.authoring&&task.workspaceChoice===undefined){
      const workspace=catalog.list('workspace-index').find(item=>item.id===value.projectId&&JSON.stringify(item.workerBinding)===JSON.stringify(worker.identity));
      task.workspaceChoice=workspace?'workspace':'pending';
      if(workspace)task.workspace=workspace;
      return finish(records.save(task));
    }
    return finish(task);
    }catch(error){authoringAuthorization?.abort?.(ticket);throw error;}
  });
  const workspaces=()=>workspaceController({
    records,worker,selection:()=>workflowContext.current(),assertIdle,authorization:authoringAuthorization,
    onBound:workspace=>catalog.put('workspace-index',workspace.workerBinding.distribution+':'+workspace.workerBinding.root+':'+workspace.id,{...workspace,assets:[]}),
    chooseFile,
    refreshContext:async task=>{
      const current=workflowContext.current();
      if(current.taskId===task.id){
        const ticket=workflowContext.begin(task.provider,task.threadId);
        await workflowContext.synchronize(ticket,(provider,context)=>agents.selectContext(provider,context));
      }
    },
  });
  for(const [method,action]of [
    ['workspace.list','list'],['workspace.create','create'],['workspace.select','select'],
    ['workspace.keepDraft','keepDraft'],['workspace.import','importAsset'],['workspace.attach','attach'],
  ])handle(method,value=>action==='list'?workspaces()[action](value):taskOperation(records,value.taskId,'workspace-'+action,JSON.stringify(value),()=>workspaces()[action](value)));
  handle('task.deployment.save',value=>saveDeployment(records,value,getLocalReview(),worker));
  handle('task.deployment.draft',value=>saveDeploymentDraft(records,worker,value));
  handle('task.deployment.context',value=>deploymentContext(records,worker,value));
  handle('task.deployment.open',value=>openDeploymentSession({
    records,workflowContext,agents,assertIdle,
    connect:async task=>{
      // Opening an existing deployment only observes/restores its original service.
      if(!taskWorkerSource(task))return;
      const observed=await restoreTaskWorker({records,catalog,worker,settings:getSettings,selection:()=>workflowContext.current(),selectionEpoch:()=>workflowContext.revision()},{taskId:task.id});
      if(observed.status==='connected')emit('studio:event',{method:'studio/workerConnected',params:{}});
    },
  },value));
  handle('task.deployment.createProject',value=>{assertIdle();return createDeploymentProject(records,worker,value);});
  handle('task.deployment.prepare',value=>prepareDeployment(records,worker,value,getLocalReview()));
  handle('task.list',()=>catalog.list('agent-task'));
  handle('task.read',({id})=>records.read(id));
  handle('task.input.read',value=>readTaskInput(records,worker,value));
  handle('task.pygas.read',value=>readTaskPygas(records,worker,value));
  handle('task.pygas.initialize',value=>initializeTaskPygas(records,worker,value,()=>workflowContext.current()));
  handle('task.pygas.save',value=>saveTaskPygas(records,worker,value));
  handle('task.pygas.normalize',value=>saveTaskPygas(records,worker,value,true));
  handle('task.edit',value=>records.edit(value));
  handle('task.execute',value=>executeTask(records,worker,value,getLocalReview()));
  handle('task.linkRun',async({taskId,runId,kind,expectedPrepared})=>{
    if(!['run','cluster-run'].includes(kind)||typeof runId!=='string')throw Error('Invalid run reference');
    const run=await worker.request('POST',kind==='run'?'/api/run/status':'/api/cluster/status',{run_id:runId});
    return records.linkRun(taskId,run,expectedPrepared);
  });
}
