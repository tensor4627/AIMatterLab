/** Fixed, checked AIMatterLab worker source transfer. No user inputs, credentials or engine files. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {bundledWorkerRuntimeId} from './worker-service-version.mjs';
import {prepareResourcesOffThread} from './preparation-worker-client.mjs';
export function prepareSshServiceResourcesAsync(source,settings={}){return prepareResourcesOffThread('ssh',{source,settings});}

const jsonFiles=new Set(['studio_worker/engine_contracts.json','studio_worker/pygas-editor-hints.json','studio_worker/tool_package.schema.json']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
// The prepared file list is in the canonical byte order used by the remote installer.
export function shippedSshServiceManifest(files){
 const digest=createHash('sha256');
 for(const row of files){digest.update(row.path);digest.update(Buffer.from(row.base64,'base64'));}
 return digest.digest('hex');
}
function regular(file,directory=false){
 for(let current=path.resolve(file);;current=path.dirname(current)){
  const stat=fs.lstatSync(current);if(stat.isSymbolicLink()||(current!==file||directory)&&!stat.isDirectory())throw Error('ssh_service_resources_invalid');
  if(path.dirname(current)===current)break;
 }
 if(!same(fs.realpathSync(file),path.resolve(file)))throw Error('ssh_service_resources_invalid');
 const stat=fs.statSync(file);if(!directory&&(!stat.isFile()||stat.size>2*1024*1024||stat.nlink!==1))throw Error('ssh_service_resources_invalid');return stat;
}
export function prepareSshServiceResources(source,{profileId,port,transportSource,expectedRuntimeId,expectedRuntimeManifestSha256,reuseOnly=false,verifiedCacheOnly=false}={}){
 if(port===undefined&&typeof profileId==='string')port=20000+(Number.parseInt(sha(Buffer.from(profileId)).slice(0,8),16)%30000);
 if(typeof source!=='string'||!path.isAbsolute(source)||typeof profileId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(profileId)||!Number.isInteger(port)||port<1024||port>65535)throw Error('ssh_service_resources_invalid');
 if(typeof verifiedCacheOnly!=='boolean'||verifiedCacheOnly&&(reuseOnly!==true||transportSource===undefined||expectedRuntimeId!==undefined||expectedRuntimeManifestSha256!==undefined))throw Error('ssh_service_resources_invalid');
 regular(source,true);const files=[];let total=0;
 function walk(relative=''){
  const folder=path.join(source,relative);regular(folder,true);
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
   if(['tests','__pycache__'].includes(entry.name))continue;
   const name=relative?relative+'/'+entry.name:entry.name,file=path.join(source,name);
   if(entry.isSymbolicLink())throw Error('ssh_service_resources_invalid');
   if(entry.isDirectory())walk(name);
   else if(entry.isFile()&&(/\.(py|toml)$/.test(name)||jsonFiles.has(name))){
    const before=regular(file),content=fs.readFileSync(file),after=regular(file);
    if(before.size!==content.length||before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('ssh_service_resources_changed');
    total+=content.length;if(files.length>=256||total>8*1024*1024)throw Error('ssh_service_resources_invalid');
    files.push({path:name,size:content.length,sha256:sha(content),base64:content.toString('base64')});
   }
  }
 }
 walk();files.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
 for(const required of ['bootstrap.py','install.py','runtime_resources.py','ssh_service_bootstrap.py','ssh_service_bridge.py','studio_worker/server.py',...jsonFiles])if(!files.some(row=>row.path===required))throw Error('ssh_service_resources_incomplete');
 const manifest=()=>shippedSshServiceManifest(files),identity=()=>manifest().slice(0,20);
 let runtimeId=identity();if(bundledWorkerRuntimeId(source)!==runtimeId)throw Error('ssh_service_resources_changed');
 if(expectedRuntimeManifestSha256!==undefined&&(!/^[a-f0-9]{64}$/.test(expectedRuntimeManifestSha256)||expectedRuntimeManifestSha256.slice(0,20)!==expectedRuntimeId))throw Error('ssh_service_resources_invalid');
 const cachedRuntime=reuseOnly&&(expectedRuntimeId!==undefined||verifiedCacheOnly);
 if(cachedRuntime&&(!/^[a-f0-9]{20}$/.test(expectedRuntimeId??runtimeId)||transportSource===undefined))throw Error('ssh_service_resources_invalid');
 if(expectedRuntimeId!==undefined&&expectedRuntimeId!==runtimeId){
  if(cachedRuntime)runtimeId=expectedRuntimeId;
  else{
  // Preserve the exact released worker for an explicitly bound old workflow.
  // Only the known Python metadata difference may be reconstructed; the full
  // canonical file digest must still prove the original released identity.
  if(expectedRuntimeId!=='62034ec6cfc1428aaa4d')throw Error('ssh_service_resources_changed');
  const metadata=files.find(row=>row.path==='pyproject.toml');if(!metadata)throw Error('ssh_service_resources_changed');
  const text=Buffer.from(metadata.base64,'base64').toString('utf8');if(!text.includes('requires-python = ">=3.9"'))throw Error('ssh_service_resources_changed');
  const original=Buffer.from(text.replace('requires-python = ">=3.9"','requires-python = ">=3.10"'));
  Object.assign(metadata,{size:original.length,sha256:sha(original),base64:original.toString('base64')});runtimeId=identity();
  if(runtimeId!==expectedRuntimeId)throw Error('ssh_service_resources_changed');
  }
 }
 const bridge=files.find(row=>row.path==='ssh_service_bootstrap.py');
 const result={source:Buffer.from(bridge.base64,'base64').toString('utf8'),payload:{schema_version:1,profile_id:profileId,port,expected_runtime_id:runtimeId,files:cachedRuntime?[]:files,...verifiedCacheOnly?{runtime_manifest_sha256:manifest()}:cachedRuntime&&expectedRuntimeManifestSha256?{runtime_manifest_sha256:expectedRuntimeManifestSha256}:{}}};
 if(transportSource!==undefined){
  if(typeof transportSource!=='string'||!path.isAbsolute(transportSource))throw Error('ssh_service_resources_invalid');regular(transportSource,true);
  const read=name=>{const file=path.join(transportSource,name),before=regular(file),content=fs.readFileSync(file),after=regular(file);if(before.size!==content.length||before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('ssh_service_resources_changed');return content;};
  const loader=read('bootstrap.py'),transport=read('bridge.py');
  if(loader.length>32768||transport.length>128*1024)throw Error('ssh_service_resources_invalid');
  result.source=loader.toString('utf8');result.transport={source:transport.toString('utf8'),sha256:sha(transport)};
 }
 return result;
}
