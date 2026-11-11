/** Pure software-resource preparation stays off Electron's main event loop. */
import {Worker} from 'node:worker_threads';
const pending=new Map();
export function prepareResourcesOffThread(kind,options){
 const key=JSON.stringify([kind,options]);if(pending.has(key))return pending.get(key);
 const promise=new Promise((resolve,reject)=>{
  // This fixed helper needs no parent entrypoint/debugger flags. Explicitly
  // forwarding execArgv also forwards host-only flags that Workers reject.
  const child=new Worker(new URL('./preparation-worker.mjs',import.meta.url),{workerData:{kind,options},execArgv:[]});let settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;error?reject(error):resolve(value);};
  child.once('message',value=>{if(value?.ok===true)finish(null,value.result);else finish(Error(value?.error||'resource_preparation_failed'));});
  child.once('error',error=>finish(error));child.once('exit',code=>{if(!settled)finish(Error('resource_preparation_failed'));});
 });
 pending.set(key,promise);promise.finally(()=>{if(pending.get(key)===promise)pending.delete(key);}).catch(()=>{});return promise;
}
