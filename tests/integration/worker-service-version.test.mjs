import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {bindBundledWorkerRuntimeId,bundledWorkerRuntimeId,taskForRecordIndex,workerServiceVersionEvidence,workerObservationEvidence} from "../../backend/main/compute/worker-service-version.mjs";
import {readWorkerStatus} from "../../backend/main/compute/worker-status.mjs";
const digest='a'.repeat(20),other='b'.repeat(20),root='/fixture/worker';
test('verified draft source is opaque, stable across runtime updates and isolated across ports and roots',()=>{
 const worker=verifiedWorker();worker.connectionTarget={port:8767};const source=workerObservationEvidence(worker).sourceId;assert.match(source,/^[a-f0-9]{64}$/);
 worker.connection.health.runtime=root+'/runtimes/'+other;assert.equal(workerObservationEvidence(worker).sourceId,source);
 worker.connectionTarget.port=8768;assert.notEqual(workerObservationEvidence(worker).sourceId,source);
 worker.identity={...worker.identity,root:'/other'};assert.equal(workerObservationEvidence(worker).sourceId,undefined);
 worker.connection.health.root='/other';assert.notEqual(workerObservationEvidence(worker).sourceId,source);
});
function verifiedWorker(runtime=root+'/runtimes/'+digest){const health={name:'gpu-sampling-studio',root,runtime,execution_policy:'desktop-review-v1'};return{bundledRuntimeId:digest,connection:{health},identity:{distribution:'Fixture',root},connectionEpoch:1,request:async(method,target)=>{assert.equal(method,'GET');assert.equal(target,'/api/health');return {...health};}};}
test('record indexes use the verified WSL or SSH binding without writing into a saved workflow',()=>{
 const wsl=verifiedWorker();wsl.connectionTarget={port:8767};
 const binding={kind:'ssh',version:2,profileId:'fixture',profileVersion:2,hostIdentity:{hostname:'fixture',uid:1,machineId:'fixture'},root,runtime:root+'/runtimes/'+digest,runtimeId:digest};
 const ssh={identity:binding,connection:{health:{...binding,ssh_service:true}},connectionTarget:{kind:'ssh',version:2}};
 for(const [worker,saved] of [[wsl,{...wsl.identity,port:8767}],[ssh,binding]]){
  const task={id:'flow',deployment:{workerBinding:saved}},source=workerObservationEvidence(worker).sourceId;
  assert.match(source,/^[a-f0-9]{64}$/);assert.equal(taskForRecordIndex(task).workerSourceId,source);assert(!Object.hasOwn(task,'workerSourceId'));
 }
 assert.equal(taskForRecordIndex({workspace:{workerBinding:wsl.identity}}).workerSourceId,null);
});
test('bundled fingerprint matches the installer fixed input specification and excludes tests, caches and other JSON',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'studio-source-id-'));try{
  const files={'bootstrap.py':'bootstrap','pyproject.toml':'metadata','studio_worker/server.py':'server','studio_worker/engine_contracts.json':'contract','studio_worker/pygas-editor-hints.json':'hints','tests/not-shipped.py':'ignored-test','studio_worker/__pycache__/ignored.py':'ignored-cache','studio_worker/other.json':'ignored-json','README.md':'ignored-doc'};
  for(const [name,text]of Object.entries(files)){const p=path.join(folder,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);}
  const h=crypto.createHash('sha256');for(const [name,text]of [['bootstrap.py','bootstrap'],['pyproject.toml','metadata'],['studio_worker/engine_contracts.json','contract'],['studio_worker/pygas-editor-hints.json','hints'],['studio_worker/server.py','server']]){h.update(name);h.update(text);}
  const expected=h.digest('hex').slice(0,20);assert.equal(bundledWorkerRuntimeId(folder),expected);fs.writeFileSync(path.join(folder,'tests/not-shipped.py'),'changed ignored fixture');assert.equal(bundledWorkerRuntimeId(folder),expected);fs.writeFileSync(path.join(folder,'studio_worker/server.py'),'changed product');assert.notEqual(bundledWorkerRuntimeId(folder),expected);
 }finally{assert(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(folder,{recursive:true,force:true});}
});
test('missing bundled source has unconfirmed identity and never blocks startup',()=>{assert.equal(bundledWorkerRuntimeId('/nonexistent-fixture-source'),null);const f=verifiedWorker();f.bundledRuntimeId=null;assert.deepEqual(workerServiceVersionEvidence(f),{serviceVersion:'unconfirmed'});});
for(const mode of ['matching','different','foreign-namespace','malformed-id','wrong-root','no-health','missing-expected'])test('safe version enumeration contains no paths or capability/age inference: '+mode,()=>{
 const f=verifiedWorker();if(mode==='different')f.connection.health.runtime=root+'/runtimes/'+other;if(mode==='foreign-namespace')f.connection.health.runtime='/unrelated/runtimes/'+digest;if(mode==='malformed-id')f.connection.health.runtime=root+'/runtimes/not-immutable';if(mode==='wrong-root')f.connection.health.root='/another';if(mode==='no-health')f.connection=null;if(mode==='missing-expected')f.bundledRuntimeId=undefined;const value=workerServiceVersionEvidence(f);assert.deepEqual(value,{serviceVersion:mode==='matching'?'current':mode==='different'?'different':'unconfirmed'});assert(!/fixture|runtime|root|token|url|older|capabilities/.test(JSON.stringify(value)));
});
test('health-verified different service stays connected and historical reads remain available without update',async()=>{const f=verifiedWorker(root+'/runtimes/'+other),calls=[];f.request=async(method,target)=>{calls.push([method,target]);return {...f.connection.health};};const result=await readWorkerStatus(f,()=>({distribution:'Fixture',workerRoot:root,workerPort:8767}));assert.equal(result.status,'connected');assert.equal(result.serviceVersion,'different');assert.deepEqual(calls,[['GET','/api/health']]);assert(!Object.keys(result).some(key=>/runtime|root|token|url/.test(key)));});
test('a stale or failed health receipt cannot publish a service-version claim',async()=>{for(const mode of ['health','epoch','connection']){const f=verifiedWorker();f.request=async()=>{if(mode==='epoch')f.connectionEpoch++;if(mode==='connection')f.connection={health:{...f.connection.health}};return {...f.connection.health,...mode==='health'?{runtime:'/unrelated'}:{}};};const value=await readWorkerStatus(f,()=>({}));assert.equal(value.status,'unknown');assert.equal(value.serviceVersion,undefined);}});
test('main binds a lazy nonwritable bundled digest and disconnected status never reads the tree',async()=>{
 const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8');
 assert(source.includes('bindBundledWorkerRuntimeId(worker,workerSource)'));
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'studio-lazy-worker-'));
 try{
  const worker={connection:null};bindBundledWorkerRuntimeId(worker,folder);
  await readWorkerStatus(worker,()=>({}));
  fs.writeFileSync(path.join(folder,'bootstrap.py'),'first requested bundled bytes');
  const expected=bundledWorkerRuntimeId(folder);assert.equal(worker.bundledRuntimeId,expected);
  fs.writeFileSync(path.join(folder,'bootstrap.py'),'subsequent mutation does not change this desktop comparison');
  assert.equal(worker.bundledRuntimeId,expected);
  assert.throws(()=>{worker.bundledRuntimeId='changed';},TypeError);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
