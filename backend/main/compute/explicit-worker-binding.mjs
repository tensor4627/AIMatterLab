import {isDeepStrictEqual as equal} from 'node:util';
import {readWorkerStatus} from './worker-status.mjs';
import {taskWorkerSettings,taskWorkerSource} from "../../../contracts/compute/task-worker-binding.mjs";

export const taskTransportNamespace='task-worker-transport';
export const validTransportPort=value=>Number.isInteger(value)&&value>=1024&&value<=65535;
export function taskTransportScope(task){const source=taskWorkerSource(task);return structuredClone({taskId:task.id,provider:task.provider,threadId:task.threadId,projectId:task.deployment?.config?.projectId??task.projectId??task.authoring?.projectId??task.workspace?.projectId??null,source,portEvidence:source&&source.binding.port===undefined?['deployment','deploymentDraft','workspace','authoring'].filter(key=>task[key]?.workerBinding?.distribution===source.binding.distribution&&task[key]?.workerBinding?.root===source.binding.root).map(key=>({source:key,binding:task[key].workerBinding})):[]});}
export function taskTransportReceipt(task,catalog){const value=catalog?.get?.(taskTransportNamespace,task.id);return value?.version===1&&equal(value.scope,taskTransportScope(task))&&validTransportPort(value.port)&&value.root===value.scope.source?.binding.root&&Number.isFinite(value.checkedAt)&&typeof value.runtime==='string'&&value.runtime.startsWith('/')&&value.executionPolicy==='desktop-review-v1'?structuredClone(value):null;}
// The shared low-level helper remains compatible. Only desktop consumers use
// this resolver: explicit saved ports dominate, absent ports never use globals.
export function taskWorkerTarget(task,settings,catalog){const target=taskWorkerSettings(task,settings),source=taskWorkerSource(task);if(!target)return null;const saved=source.binding.port;if(saved!==undefined&&!validTransportPort(saved))throw Error('Invalid original service port');if(saved!==undefined)return {...target,workerPort:saved};const candidates=taskTransportScope(task).portEvidence.map(item=>item.binding.port).filter(value=>value!==undefined);if(candidates.some(value=>!validTransportPort(value))||new Set(candidates).size>1)throw Error('Conflicting original service port evidence');return {...target,workerPort:taskTransportReceipt(task,catalog)?.port??candidates[0]};}
export const workerSettingsSignature=settings=>[settings.distribution,settings.workerRoot,settings.workerPort];
export const explicitWorkerBindingKey='last-explicit';
export function explicitWorkerReceipt(worker,target){return {connection:worker.connection,identity:worker.identity,epoch:worker.connectionEpoch,signature:workerSettingsSignature(target)};}
export function validExplicitBinding(value,settings){return value?.version===1&&typeof value.distribution==='string'&&!!value.distribution&&typeof value.root==='string'&&value.root.startsWith('/')&&!/[\r\n\0]/.test(value.root)&&Number.isInteger(value.port)&&value.port>=1024&&value.port<=65535&&Number.isFinite(value.checkedAt)&&equal(value.settingsSignature,workerSettingsSignature(settings))&&value.distribution===settings.distribution&&value.port===settings.workerPort;}
// Only the explicitly requested connect handler calls this. Never store credentials or a cached health verdict.
export async function rememberExplicitWorker({catalog,worker,settings},receipt){
 const current=()=>receipt.connection&&worker.connection===receipt.connection&&worker.identity===receipt.identity&&worker.connectionEpoch===receipt.epoch&&equal(receipt.signature,workerSettingsSignature(settings()));
 if(!current()||worker.connecting||worker.restoring)return false;
 const observed=await readWorkerStatus(worker,settings);if(observed.status!=='connected'||!current())return false;
 const value={version:1,distribution:receipt.identity?.distribution,root:receipt.identity?.root,port:receipt.signature[2],settingsSignature:[...receipt.signature],checkedAt:observed.checkedAt};
 if(!validExplicitBinding(value,settings())||receipt.connection.health?.root!==value.root||worker.connectionTarget?.port!==value.port)return false;
 catalog.put('worker-binding',explicitWorkerBindingKey,value);return true;
}
