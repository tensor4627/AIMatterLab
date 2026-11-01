import {workerServiceVersionEvidence} from './worker-service-version.mjs';
// Observe only the existing bridge. Never bootstrap, reconnect, or publish secrets.
export async function readWorkerStatus(worker,currentSettings,{timeoutMs=3000,now=Date.now}={}){
 const result=status=>({status,checkedAt:now()});
 if(worker.connecting||worker.restoring)return result('checking');
 const connection=worker.connection,identity=worker.identity,epoch=worker.connectionEpoch;
 if(!connection)return result('disconnected');
 const target=settings=>[settings.distribution,settings.workerRoot,settings.workerPort];
 const configured=target(currentSettings());
 if(!identity||typeof identity.distribution!=='string'||!identity.distribution)return result('unknown');
 const current=()=>worker.connection===connection&&worker.identity===identity&&worker.connectionEpoch===epoch&&JSON.stringify(target(currentSettings()))===JSON.stringify(configured);
 let timer,health;
 try{health=await Promise.race([worker.request('GET','/api/health'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Observation timed out')),timeoutMs);})]);}
 catch{return result('unknown');}
 finally{clearTimeout(timer);}
 if(!current()||health?.name!=='gpu-sampling-studio'||typeof identity.root!=='string'||health.root!==identity.root||health.root!==connection.health?.root)return result('unknown');
 // Match the identity accepted by bootstrap/connect, without adding science gates.
 for(const field of ['runtime','execution_policy'])if(typeof connection.health?.[field]==='string'&&health[field]!==connection.health[field])return result('unknown');
 return {...result('connected'),...workerServiceVersionEvidence(worker)};
}
