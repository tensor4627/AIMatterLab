import {parentPort,workerData} from 'node:worker_threads';
try{
 let result;
 if(workerData.kind==='ssh'){const {prepareSshServiceResources}=await import('./ssh-service-resources.mjs');result=prepareSshServiceResources(workerData.options.source,workerData.options.settings);}
 else if(workerData.kind==='terminal'){const {prepareTerminalRuntime}=await import('./terminal-runtime.mjs');result=await prepareTerminalRuntime(workerData.options);}
 else throw Error('resource_preparation_failed');
 parentPort.postMessage({ok:true,result});
}catch(error){parentPort.postMessage({ok:false,error:error?.message||'resource_preparation_failed'});}
