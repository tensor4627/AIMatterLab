import {invoke} from './studio';
import type {WorkerStatus} from '../../contracts/dto/compute';

export const api=<T=any>(method:string,target:string,data?:unknown)=>invoke<T>('worker.request',{method,target,data});

export const readWorkerStatus=()=>invoke<WorkerStatus>('worker.status');

export const restoreWorker=(owner:string|{conversationId:string}|{scope:'global'})=>invoke<WorkerStatus>('worker.restore',typeof owner==='string'?{taskId:owner}:owner);
