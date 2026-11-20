import {invoke} from './studio';
import type {ResourceWorkspaceReference,WorkerStatus} from '../../contracts/dto/compute';

export const api=<T=any>(method:string,target:string,data?:unknown,projectScope?:ResourceWorkspaceReference)=>invoke<T>('worker.request',{method,target,data,...projectScope?{projectScope}:{}});

export const readWorkerStatus=()=>invoke<WorkerStatus>('worker.status');

export const restoreWorker=(owner:string|{conversationId:string}|{scope:'global'})=>invoke<WorkerStatus>('worker.restore',typeof owner==='string'?{taskId:owner}:owner);
