import path from 'node:path';
import crypto from 'node:crypto';
import {actualAuthoringWorker,stableSshWorkerBinding,taskWorkerSource} from '../../../contracts/compute/task-worker-binding.mjs';
import {listWorkerRuntimeFiles,readWorkerRuntimeFile} from './worker-runtime-files.mjs';

// Pure bundled-file identity, matching install.py's POSIX path+bytes algorithm.
// This never invokes the installer or observes/changes any running service.
export function bundledWorkerRuntimeId(source){
 try{
  const names=listWorkerRuntimeFiles(source);
  if(!names.includes('bootstrap.py'))return null;
  const digest=crypto.createHash('sha256');
  // Match the installer independently of the host path separator or locale.
  for(const name of names){digest.update(name);digest.update(readWorkerRuntimeFile(source,name));}
  return digest.digest('hex').slice(0,20);
 }catch{return null;}
}

// A disconnected desktop needs no bundled/service comparison. Capture the source
// location now and retain the first real hash when version evidence is requested.
export function bindBundledWorkerRuntimeId(worker,source){
 let resolved=false,value;
 Object.defineProperty(worker,'bundledRuntimeId',{get(){
  if(!resolved){value=bundledWorkerRuntimeId(source);resolved=true;}
  return value;
 }});
}

// Call only after the connection's health/identity has been verified. No paths escape.
export function workerServiceVersionEvidence(worker){
 if(!Object.hasOwn(worker,'bundledRuntimeId'))return {}; // Non-desktop callers have no bundle evidence.
 const expected=worker.bundledRuntimeId,root=worker.identity?.root,health=worker.connection?.health;
 if(worker.identity?.kind==='ssh'){try{const identity=actualAuthoringWorker(worker);if(!/^[a-f0-9]{20}$/.test(expected)||!/^[a-f0-9]{20}$/.test(identity.runtimeId))return {serviceVersion:'unconfirmed'};return {serviceVersion:identity.runtimeId===expected?'current':'different'};}catch{return {serviceVersion:'unconfirmed'};}}
 if(!/^[a-f0-9]{20}$/.test(expected)||typeof root!=='string'||!root.startsWith('/')||health?.root!==root||typeof health.runtime!=='string')return {serviceVersion:'unconfirmed'};
 const prefix=path.posix.join(root,'runtimes')+'/';
 if(!health.runtime.startsWith(prefix)||!/^[a-f0-9]{20}$/.test(health.runtime.slice(prefix.length)))return {serviceVersion:'unconfirmed'};
 return {serviceVersion:health.runtime===prefix+expected?'current':'different'};
}

export const sshSourceId=binding=>crypto.createHash('sha256').update(JSON.stringify(['studio-worker-source-v2',binding])).digest('hex');
export function wslSourceId(binding){
 const {distribution,root,port}=binding||{};
 if(typeof distribution!=='string'||!distribution||typeof root!=='string'||!root.startsWith('/')||!Number.isInteger(port)||port<1024||port>65535)return null;
 return crypto.createHash('sha256').update(JSON.stringify(['studio-worker-source-v1',distribution,root,port])).digest('hex');
}

// Derive a display hint from existing saved bindings without modifying the catalog.
export function taskForRecordIndex(task){
 const binding=taskWorkerSource(task)?.binding;
 if(!binding)return task;
 if(binding.kind!=='ssh')return {...task,workerSourceId:wslSourceId(binding)};
 try{return {...task,workerSourceId:sshSourceId(stableSshWorkerBinding(binding))};}
 catch{return {...task,workerSourceId:null};}
}

// Opaque, stable identity for local drafts. Called only after health verification;
// neither paths nor credentials are exposed to the renderer.
export function workerObservationEvidence(worker){
 if(worker.identity?.kind==='ssh'){try{
  const binding=actualAuthoringWorker(worker),identity=worker.identity,target=worker.connectionTarget;
  const connection=identity.version===3&&/^[A-Za-z0-9_-]{1,200}$/.test(identity.connectionId||'')&&worker.connection.transport==='ssh-connection'&&target?.kind==='ssh'&&target.version===3&&target.connectionId===identity.connectionId?{connectionId:identity.connectionId}:{};
  return {...workerServiceVersionEvidence(worker),sourceId:sshSourceId(binding),sourceKind:'ssh',profileId:binding.profileId,profileVersion:binding.profileVersion,...connection};
 }catch{return {serviceVersion:'unconfirmed'};}}
 const identity=worker.identity,port=worker.connectionTarget?.port;
 const sourceId=identity&&worker.connection?.health?.root===identity.root?wslSourceId({...identity,port}):null;
 const source=sourceId?{sourceId}:{};
 return {...workerServiceVersionEvidence(worker),...source};
}
