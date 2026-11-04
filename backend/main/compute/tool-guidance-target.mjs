import {taskWorkerSource} from '../../../shared/task-worker-binding.mjs';

/** The deployment target uses targetId; authoring is a separate fallback only before deployment. */
export function toolGuidanceTarget(task){
 if(!task)return null;
 const config=task.deployment?.config,source=taskWorkerSource(task);
 const workerBinding=source?{distribution:source.binding.distribution,root:source.binding.root,port:source.binding.port}:undefined;
 if(config?.target==='cluster')return {kind:'cluster',projectId:config.projectId,engine:task.parameters?.engine};
 if(config?.target==='local')return {kind:'local',projectId:config.projectId,environmentId:config.targetId,engine:task.parameters?.engine,...workerBinding?{workerBinding}:{}};
 return {kind:'local',projectId:task.authoring?.projectId||task.projectId,environmentId:task.authoring?.environmentId,engine:task.parameters?.engine,...workerBinding?{workerBinding}:{}};
}
