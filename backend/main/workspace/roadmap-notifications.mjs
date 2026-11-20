import {sshSourceId,wslSourceId} from '../compute/worker-service-version.mjs';
import {sameSshWorkerData} from '../../../contracts/compute/task-worker-binding.mjs';

const finalStates=new Set(['passed','needs_review','failed','blocked','cancelled']);
const namespace='agent-service-notification';
function sourceFor(binding,sources){
 const ssh=binding?.kind==='ssh',id=ssh?sshSourceId(binding):wslSourceId(binding);
 return sources.find(source=>source.id===id)||(ssh&&sources.find(source=>source.kind==='ssh'&&sameSshWorkerData(binding,source.binding)));
}

export function createRoadmapNotifications({catalog,sources,emit,english=()=>false,now=Date.now}){
 let observing=false;
 return {
  completed(task,state){
   if(!finalStates.has(state.status)||!task?.provider||!task.threadId)return;
   const id='roadmap-'+state.id;
   if(catalog.get(namespace,id))return;
   const failed=Object.keys(state.nodes||{}).filter(key=>['failed','blocked','cancelled'].includes(state.nodes[key].status));
   const passed=(state.goals||[]).filter(goal=>goal.status==='passed').length;
   const title=task.name||task.id,count=passed+'/'+(state.goals||[]).length;
   const text=english()?`Workflow “${title}” finished (${state.status}). Deliverables passed: ${count}.${failed.length?' Check steps '+failed.join(', ')+'.':''} Open the workflow execution receipt to inspect outputs and logs.`:
    `计算流程「${title}」${({passed:'已完成',failed:'执行或验收失败',blocked:'受阻',cancelled:'已取消',needs_review:'等待人工验收'})[state.status]}。已通过的交付物 ${count}。${failed.length?'需核对步骤 '+failed.join('、')+'。':''}打开流程的执行回执可查看产物和日志。`;
   const row={id,taskId:task.id,threadId:task.threadId,provider:task.provider,text,createdAt:now()};
   catalog.put(namespace,id,row);
   emit({method:'studio/serviceNotification',provider:row.provider,params:{threadId:row.threadId,message:{id:'service:'+id,type:'serviceMessage',text,createdAt:row.createdAt}}});
  },
  async sweep(){
   if(observing)return;
   observing=true;
   try{
    const online=sources();
    for(const ref of catalog.list('roadmap-execution-index')){
     if(catalog.get(namespace,'roadmap-'+ref.id))continue;
     const task=catalog.get('agent-task',ref.task_id),source=sourceFor(ref.worker_binding,online);
     if(!task?.threadId||!source||source.health?.roadmap_execution_schema!==1)continue;
     try{
      const row=await source.request('POST','/api/workflow/roadmap/status',{task_id:ref.task_id,execution_id:ref.id});
      if(row.id===ref.id&&row.snapshot_sha256===ref.snapshot_sha256&&row.task_id===task.id&&catalog.get('agent-task',task.id)?.threadId===task.threadId)this.completed(task,row);
     }catch{/* The original worker retries observation after its transport is available. */}
    }
   }finally{observing=false;}
  }
 };
}
