import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {actualAuthoringWorker} from '../../../contracts/compute/task-worker-binding.mjs';

// Pure bundled-file identity, matching install.py's POSIX path+bytes algorithm.
// This never invokes the installer or observes/changes any running service.
export function bundledWorkerRuntimeId(source){
 try{
  const names=[];
  function walk(relative=''){
   const folder=path.join(source,relative);
   if(fs.lstatSync(folder).isSymbolicLink())throw Error('Unconfirmed bundled source');
   for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    if(['tests','__pycache__'].includes(entry.name))continue;
    const name=relative?relative+'/'+entry.name:entry.name;
    if(entry.isSymbolicLink())throw Error('Unconfirmed bundled source');
    if(entry.isDirectory())walk(name);
    else if(entry.isFile()&&(/\.(py|toml)$/.test(name)||['studio_worker/engine_contracts.json','studio_worker/pygas-editor-hints.json','studio_worker/tool_package.schema.json'].includes(name)))names.push(name);
   }
  }
  walk();if(!names.includes('bootstrap.py'))return null;
  const digest=crypto.createHash('sha256');
  // Match the installer independently of the host path separator or locale.
  for(const name of names.sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))){digest.update(name);digest.update(fs.readFileSync(path.join(source,name)));}
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

// Opaque, stable identity for local drafts. Called only after health verification;
// neither paths nor credentials are exposed to the renderer.
export function workerObservationEvidence(worker){
 if(worker.identity?.kind==='ssh'){try{
  const binding=actualAuthoringWorker(worker),identity=worker.identity,target=worker.connectionTarget;
  const connection=identity.version===3&&/^[A-Za-z0-9_-]{1,200}$/.test(identity.connectionId||'')&&worker.connection.transport==='ssh-connection'&&target?.kind==='ssh'&&target.version===3&&target.connectionId===identity.connectionId?{connectionId:identity.connectionId}:{};
  return {...workerServiceVersionEvidence(worker),sourceId:crypto.createHash('sha256').update(JSON.stringify(['studio-worker-source-v2',binding])).digest('hex'),sourceKind:'ssh',profileId:binding.profileId,profileVersion:binding.profileVersion,...connection};
 }catch{return {serviceVersion:'unconfirmed'};}}
 const identity=worker.identity,port=worker.connectionTarget?.port;
 const source=typeof identity?.distribution==='string'&&identity.distribution&&typeof identity.root==='string'&&identity.root.startsWith('/')&&Number.isInteger(port)&&port>=1024&&port<=65535&&worker.connection?.health?.root===identity.root
  ?{sourceId:crypto.createHash('sha256').update(JSON.stringify(['studio-worker-source-v1',identity.distribution,identity.root,port])).digest('hex')}:{};
 return {...workerServiceVersionEvidence(worker),...source};
}
