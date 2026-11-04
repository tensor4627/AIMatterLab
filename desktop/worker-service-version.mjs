import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
    else if(entry.isFile()&&(/\.(py|toml)$/.test(name)||['studio_worker/engine_contracts.json','studio_worker/pygas-editor-hints.json'].includes(name)))names.push(name);
   }
  }
  walk();if(!names.includes('bootstrap.py'))return null;
  const digest=crypto.createHash('sha256');
  // Match the installer independently of the host path separator or locale.
  for(const name of names.sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))){digest.update(name);digest.update(fs.readFileSync(path.join(source,name)));}
  return digest.digest('hex').slice(0,20);
 }catch{return null;}
}

// Call only after the connection's health/identity has been verified. No paths escape.
export function workerServiceVersionEvidence(worker){
 if(!Object.hasOwn(worker,'bundledRuntimeId'))return {}; // Non-desktop callers have no bundle evidence.
 const expected=worker.bundledRuntimeId,root=worker.identity?.root,health=worker.connection?.health;
 if(!/^[a-f0-9]{20}$/.test(expected)||typeof root!=='string'||!root.startsWith('/')||health?.root!==root||typeof health.runtime!=='string')return {serviceVersion:'unconfirmed'};
 const prefix=path.posix.join(root,'runtimes')+'/';
 if(!health.runtime.startsWith(prefix)||!/^[a-f0-9]{20}$/.test(health.runtime.slice(prefix.length)))return {serviceVersion:'unconfirmed'};
 return {serviceVersion:health.runtime===prefix+expected?'current':'different'};
}
