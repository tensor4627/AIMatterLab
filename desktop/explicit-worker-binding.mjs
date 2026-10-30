import {isDeepStrictEqual as equal} from 'node:util';
import {readWorkerStatus} from './worker-status.mjs';
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
