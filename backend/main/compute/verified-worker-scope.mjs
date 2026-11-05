import {isDeepStrictEqual as equal} from 'node:util';
import {readWorkerStatus} from './worker-status.mjs';

/** Observe the selected original service without restoring or changing a connection. */
export function createVerifiedWorkerScope({worker,getSettings,current,currentTarget=()=>null,label='Configuration'}){
 const currentBinding=()=>{
  const identity=worker.identity,target=worker.connectionTarget;
  if(!worker.connection||!identity||typeof identity.distribution!=='string'||typeof identity.root!=='string'||!Number.isInteger(target?.port))throw Error('Connect and verify the intended job service first');
  return {distribution:identity.distribution,root:identity.root,port:target.port};
 };
 function capture(expected){
  const observed=currentBinding(),connection=worker.connection,epoch=worker.connectionEpoch,owner=structuredClone(current()),target=structuredClone(currentTarget());
  if(expected&&!equal(observed,expected))throw Error('Restore the original service for this '+label.toLowerCase());
  return {binding:observed,assert(){if(worker.connection!==connection||worker.connectionEpoch!==epoch||!equal(currentBinding(),observed)||!equal(current(),owner)||!equal(currentTarget(),target))throw Error(label+' owner, target or service changed');}};
 }
 async function verified(expected){const ticket=capture(expected),status=await readWorkerStatus(worker,getSettings);ticket.assert();if(status.status!=='connected')throw Error('Original service identity is not verified');return ticket;}
 return {currentBinding,capture,verified};
}
