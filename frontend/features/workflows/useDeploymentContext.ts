import {useEffect,useRef,useState} from 'react';
import type {Project,Environment} from '../../../contracts/dto/compute';
import type {DeploymentContext} from "../../api/deployment-client";

export interface DeploymentContextOptions{
 task:any;
 worker:boolean;
 restoring:boolean;
 parentProjects:Project[];
 parentEnvironments:Environment[];
 readDeploymentContext:(taskId:string)=>Promise<DeploymentContext>;
 onReconnect?:()=>unknown|Promise<unknown>;
 onAutomaticRestore?:()=>unknown|Promise<unknown>;
 onError:(error:unknown)=>void;
}

/** Owns deployment resource reads and recovery; saving and execution remain reviewed actions. */
export function useDeploymentContext({task,worker,restoring,parentProjects,parentEnvironments,readDeploymentContext,onReconnect,onAutomaticRestore,onError}:DeploymentContextOptions){
 const [reconnecting,setReconnecting]=useState(false);
 const [catalog,setCatalog]=useState<{status:string;data?:any;error?:string}>({status:worker?'loading':'offline'}),catalogSequence=useRef(0),attemptedReconnect=useRef(false);
 const latestTask=useRef(task),alive=useRef(true);latestTask.current=task;
 const catalogSources=JSON.stringify([parentProjects,parentEnvironments.map(environment=>({id:environment.id,executables:environment.executables,repositories:environment.repositories}))]),previousCatalogSources=useRef(catalogSources);
 const contextReady=worker&&catalog.status==='ready',projects:Project[]=contextReady?catalog.data.projects:parentProjects,environments:Environment[]=contextReady?catalog.data.environments:parentEnvironments,clusters:any[]=contextReady?catalog.data.clusters:[];
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;catalogSequence.current++;};},[]);
 async function readContext(){if(!worker||restoring||!alive.current||latestTask.current.id!==task.id)return;const sequence=++catalogSequence.current;setCatalog({status:'loading'});try{const value=await readDeploymentContext(task.id);if(alive.current&&latestTask.current.id===task.id&&sequence===catalogSequence.current&&value.taskId===task.id)setCatalog({status:'ready',data:value});}catch(error){if(alive.current&&latestTask.current.id===task.id&&sequence===catalogSequence.current)setCatalog({status:'error',error:error instanceof Error?error.message:String(error)});}}
 async function reconnect(){if(!onReconnect||reconnecting)return;setReconnecting(true);try{await onReconnect();if(alive.current&&latestTask.current.id===task.id)await readContext();}finally{if(alive.current&&latestTask.current.id===task.id)setReconnecting(false);}}
 useEffect(()=>{if(worker)void readContext();else{catalogSequence.current++;setCatalog({status:'offline'});if(!restoring&&!attemptedReconnect.current&&(onAutomaticRestore||onReconnect)){attemptedReconnect.current=true;if(onAutomaticRestore)void Promise.resolve(onAutomaticRestore()).catch(onError);else void reconnect().catch(onError);}}},[worker,task.id,restoring]);
 useEffect(()=>{if(previousCatalogSources.current===catalogSources)return;previousCatalogSources.current=catalogSources;if(worker&&catalog.status==='ready')void readContext();},[catalogSources,worker,catalog.status]);
 useEffect(()=>{if(typeof window==='undefined')return;return window.studio?.onEvent(event=>{if(event.method==='studio/sshSchedulerChanged'&&worker&&!restoring)void readContext();});},[worker,restoring,task.id]);
 return {catalog,contextReady,projects,environments,clusters,readContext,reconnect,reconnecting,latestTask,alive};
}
