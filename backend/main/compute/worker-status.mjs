import {workerObservationEvidence} from "./worker-service-version.mjs";
import {actualAuthoringWorker} from '../../../contracts/compute/task-worker-binding.mjs';
const observations=new WeakMap();
function observeHealth(worker,connection,identity,epoch){
 const old=observations.get(worker);if(old?.connection===connection&&old.identity===identity&&old.epoch===epoch)return old.promise;
 const promise=Promise.resolve().then(()=>worker.request('GET','/api/health')),entry={connection,identity,epoch,promise};observations.set(worker,entry);
 promise.finally(()=>{if(observations.get(worker)===entry)observations.delete(worker);}).catch(()=>{});return promise;
}
// Observe only the existing bridge. Never bootstrap, reconnect, or publish secrets.
export async function readWorkerStatus(worker,currentSettings,{timeoutMs,now=Date.now}={}){
 const result=status=>({status,checkedAt:now()});
 if(worker.connecting||worker.restoring)return result('checking');
 const connection=worker.connection,identity=worker.identity,epoch=worker.connectionEpoch;
 if(!connection)return result('disconnected');
 const target=settings=>[settings.distribution,settings.workerRoot,settings.workerPort];
 const configured=target(currentSettings());
 const ssh=identity?.kind==='ssh',identityVersion=identity?.version,connectionId=ssh&&identityVersion===3?identity.connectionId:undefined;let bound;
 if(ssh){try{bound=actualAuthoringWorker(worker);}catch{return result('unknown');}}else if(!identity||typeof identity.distribution!=='string'||!identity.distribution)return result('unknown');
 // Shared SSH shell requests include bridge framing and remote health proof.
 // Keep their observation bounded without applying the local transport budget.
 const observationTimeoutMs=timeoutMs===undefined?(ssh?15000:3000):timeoutMs;
 const current=()=>{try{return worker.connection===connection&&worker.identity===identity&&worker.connectionEpoch===epoch&&(ssh?identity.version===identityVersion&&JSON.stringify(actualAuthoringWorker(worker))===JSON.stringify(bound)&&(identityVersion!==3||identity.connectionId===connectionId&&worker.connectionTarget?.connectionId===connectionId):JSON.stringify(target(currentSettings()))===JSON.stringify(configured));}catch{return false;}};
 let timer,health;
 try{health=await Promise.race([observeHealth(worker,connection,identity,epoch),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Observation timed out')),observationTimeoutMs);})]);}
 catch{return result('unknown');}
 finally{clearTimeout(timer);}
 if(!current()||health?.name!=='gpu-sampling-studio'||typeof identity.root!=='string'||health.root!==identity.root||health.root!==connection.health?.root)return result('unknown');
 const remoteHost=health?.hostIdentity||health?.host_identity,host=remoteHost&&{hostname:remoteHost.hostname,uid:remoteHost.uid,machineId:remoteHost.machineId??remoteHost.machine_id};
 if(ssh&&(health.ssh_service!==true||['hostname','uid','machineId'].some(key=>host?.[key]!==bound.hostIdentity[key])))return result('unknown');
 if(ssh&&(health.runtimeId??health.runtime_id)!==undefined&&(health.runtimeId??health.runtime_id)!==bound.runtimeId)return result('unknown');
 // Match the identity accepted by bootstrap/connect, without adding science gates.
 for(const field of ['runtime','execution_policy'])if(typeof connection.health?.[field]==='string'&&health[field]!==connection.health[field])return result('unknown');
 const evidence=workerObservationEvidence(worker);
 if(ssh&&identityVersion===3&&(!evidence.connectionId||evidence.connectionId!==connectionId))return result('unknown');
 return {...result('connected'),...evidence};
}
