import __node_test, {describe as __describe} from 'node:test';
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {prepareSshServiceResources, prepareSshServiceResourcesAsync} from "../../backend/main/compute/ssh-service-resources.mjs";
import {bundledWorkerRuntimeId} from "../../backend/main/compute/worker-service-version.mjs";
import {gunzipSync} from "node:zlib";
import {deltaBundle} from "../../desktop/platform/terminal-service/worker-delta.mjs";
import {Catalog} from "../../backend/main/workspace/catalog.mjs";
import {createComputeProfiles} from "../../backend/main/compute/compute-profiles.mjs";
import {sshServiceEnvironmentGuide, writeSshServiceEnvironmentGuide} from "../../backend/main/compute/ssh-service-environment-guide.mjs";
import {createSshService} from "../../backend/main/compute/ssh-service.mjs";
import {WorkerClient} from "../../agent/tools/worker-client.mjs";
import {restoreTaskWorker} from "../../backend/main/compute/worker-restore.mjs";
import {stableSshWorkerBinding} from "../../contracts/compute/task-worker-binding.mjs";
import {spawn} from "node:child_process";
import {preferredSshRuntime, carrySshRuntimePreference, globalSshBindingForProfile} from "../../backend/main/compute/ssh-runtime-preference.mjs";

await __describe("ssh-service-resources", async () => {
const test = __node_test;
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-ssh-resources-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(const name of ['bootstrap.py','install.py','runtime_resources.py','ssh_service_bootstrap.py','ssh_service_bridge.py','studio_worker/server.py','studio_worker/engine_contracts.json','studio_worker/pygas-editor-hints.json','studio_worker/tool_package.schema.json']){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),name.endsWith('.json')?'{}':'# inert '+name+'\n');}return root;}
test('fixed source manifest matches runtime identity and carries no runtime data or sibling engines',t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,'connection.json'),'PRIVATE NEVER TRANSFER');fs.mkdirSync(path.join(root,'tests'));fs.writeFileSync(path.join(root,'tests','private.py'),'PRIVATE NEVER TRANSFER');
 const result=prepareSshServiceResources(root,{profileId:'owned-profile'});assert.equal(result.payload.expected_runtime_id,bundledWorkerRuntimeId(root));assert.equal(result.source,'# inert ssh_service_bootstrap.py\n');assert(!JSON.stringify(result).includes('PRIVATE NEVER TRANSFER'));assert(result.payload.port>=20000&&result.payload.port<50000);
 for(const file of result.payload.files)assert.equal(createHash('sha256').update(Buffer.from(file.base64,'base64')).digest('hex'),file.sha256);
});

test('a registered prior runtime uses cache-only verification without reconstructing old shipped bytes',()=>{
 const source=path.resolve('backend/worker'),options={profileId:'owned-profile',transportSource:path.resolve('desktop/platform/terminal-service/python')},current=prepareSshServiceResources(source,options),legacy=prepareSshServiceResources(source,{...options,reuseOnly:true,expectedRuntimeId:'62034ec6cfc1428aaa4d'});
 assert.equal(legacy.payload.expected_runtime_id,'62034ec6cfc1428aaa4d');assert.deepEqual(legacy.payload.files,[]);assert.equal(legacy.payload.runtime_manifest_sha256,undefined);assert(current.payload.files.length>5);assert.equal(legacy.transport.sha256,current.transport.sha256);
 assert.throws(()=>prepareSshServiceResources(source,{...options,expectedRuntimeId:'f'.repeat(20)}),/resources_changed/);
 assert.throws(()=>prepareSshServiceResources(source,{...options,reuseOnly:true,expectedRuntimeId:'f'.repeat(20),expectedRuntimeManifestSha256:'a'.repeat(64)}),/resources_invalid/);
});

test('current-runtime reconciliation computes the full shipped manifest but sends no worker files',()=>{
 const source=path.resolve('backend/worker'),options={profileId:'owned-profile',port:25252,transportSource:path.resolve('desktop/platform/terminal-service/python')},shipped=prepareSshServiceResources(source,options),cached=prepareSshServiceResources(source,{...options,reuseOnly:true,verifiedCacheOnly:true});
 const digest=createHash('sha256');for(const row of shipped.payload.files){digest.update(row.path);digest.update(Buffer.from(row.base64,'base64'));}const expected=digest.digest('hex');
 assert.deepEqual(cached.payload.files,[]);assert.equal(cached.payload.expected_runtime_id,shipped.payload.expected_runtime_id);assert.equal(cached.payload.runtime_manifest_sha256,expected);assert.equal(cached.payload.port,25252);
 for(const changed of [{reuseOnly:false},{expectedRuntimeId:'a'.repeat(20)},{expectedRuntimeManifestSha256:'a'.repeat(64)},{transportSource:undefined}])assert.throws(()=>prepareSshServiceResources(source,{...options,reuseOnly:true,verifiedCacheOnly:true,...changed}),/resources_invalid/);
});

test('missing worker entry fails instead of sending a partial install',t=>{const root=fixture(t);fs.unlinkSync(path.join(root,'runtime_resources.py'));assert.throws(()=>prepareSshServiceResources(root,{profileId:'owned-profile'}),/resources_incomplete/);});
test('linked source trees and arbitrary profile paths cannot enter the trusted bundle',t=>{
 const root=fixture(t);assert.throws(()=>prepareSshServiceResources(root,{profileId:'../escape'}),/resources_invalid/);const alias=path.join(root,'linked');fs.symlinkSync(path.join(root,'studio_worker'),alias,'junction');assert.throws(()=>prepareSshServiceResources(root,{profileId:'owned-profile'}),/resources_invalid/);
});
test('manifest limits match the remote installer before any payload is sent',t=>{
 const root=fixture(t);assert.throws(()=>prepareSshServiceResources(root,{profileId:'a'.repeat(101)}),/resources_invalid/);
 for(let index=0;index<4;index++)fs.writeFileSync(path.join(root,'studio_worker','bounded-'+index+'.py'),Buffer.alloc(2*1024*1024,120));
 assert.throws(()=>prepareSshServiceResources(root,{profileId:'owned-profile'}),/resources_invalid/);
});

test('versioned SSH transport is separate from the immutable worker and cannot rewrite existing task provenance',t=>{
 const root=fixture(t),transport=fs.mkdtempSync(path.join(os.tmpdir(),'studio-transport-source-'));t.after(()=>fs.rmSync(transport,{recursive:true,force:true}));
 fs.writeFileSync(path.join(transport,'bootstrap.py'),'# owned loader one\n');fs.writeFileSync(path.join(transport,'bridge.py'),'# owned bridge one\n');
 const old=prepareSshServiceResources(root,{profileId:'owned-profile'}),one=prepareSshServiceResources(root,{profileId:'owned-profile',transportSource:transport});
 assert.deepEqual(one.payload,old.payload);assert.equal(one.source,'# owned loader one\n');assert.equal(one.transport.sha256,createHash('sha256').update(one.transport.source).digest('hex'));
 fs.writeFileSync(path.join(transport,'bootstrap.py'),'# owned loader two\n');fs.writeFileSync(path.join(transport,'bridge.py'),'# owned bridge two\n');const next=prepareSshServiceResources(root,{profileId:'owned-profile',transportSource:transport});assert.equal(next.payload.expected_runtime_id,old.payload.expected_runtime_id);assert.notEqual(next.transport.sha256,one.transport.sha256);
});

test('linked or oversized separate transport source fails before an SSH payload is published',t=>{
 const root=fixture(t),transport=fs.mkdtempSync(path.join(os.tmpdir(),'studio-transport-bounds-')),linked=path.join(transport,'linked');
 t.after(()=>{try{fs.unlinkSync(linked);}catch{try{fs.rmdirSync(linked);}catch{}}fs.rmSync(transport,{recursive:true,force:true});});
 fs.writeFileSync(path.join(transport,'bootstrap.py'),'# owned\n');fs.writeFileSync(path.join(transport,'bridge.py'),Buffer.alloc(128*1024+1,120));assert.throws(()=>prepareSshServiceResources(root,{profileId:'owned-profile',transportSource:transport}),/resources_invalid/);
 fs.writeFileSync(path.join(transport,'bridge.py'),'# owned bridge\n');fs.symlinkSync(transport,linked,'junction');assert.throws(()=>prepareSshServiceResources(root,{profileId:'owned-profile',transportSource:linked}),/resources_invalid/);
});
});

await __describe("ssh-service-delta", async () => {
const test = __node_test;
const row=(path,text)=>{const bytes=Buffer.from(text);return {path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')};};
const meta=({base64,...value})=>value;
test('delta inventory chooses only known changed or added source bytes and declares the complete target',()=>{
 const files=[row('bootstrap.py','base'),row('studio_worker/changed.py','updated'),row('studio_worker/added.py','added')],payload={schema_version:1,profile_id:'owned',port:23456,expected_runtime_id:'a'.repeat(20),files};
 const delta=deltaBundle(payload,[meta(files[0]),meta(row(files[1].path,'old')),meta(row('studio_worker/deleted.py','old'))]);
 assert.deepEqual(delta.changedPaths,['studio_worker/changed.py','studio_worker/added.py']);assert.equal(delta.sourceBytes,12);
 const raw=gunzipSync(delta.packed),value=JSON.parse(raw);assert.deepEqual(value.files,files.slice(1));assert.deepEqual(value.manifest,files.map(meta));assert.equal(delta.end.uncompressed_sha256,createHash('sha256').update(raw).digest('hex'));assert.equal(delta.end.size,delta.packed.length);
});
test('matching hashes transfer zero source bytes; malformed or duplicate inventories fail closed',()=>{
 const files=[row('bootstrap.py','unchanged')],payload={files};assert.equal(deltaBundle(payload,files.map(meta)).sourceBytes,0);
 for(const inventory of [null,Array(513).fill(meta(files[0])),[meta(files[0]),meta(files[0])],[{...meta(files[0]),sha256:'x'}],[{...meta(files[0]),size:-1}],[{...meta(files[0]),base64:'untrusted'}]])assert.throws(()=>deltaBundle(payload,inventory),/service_protocol_failed/);
});
});

await __describe("ssh-service-environment-guide", async () => {
const test = __node_test;
const ssh={kind:'ssh',name:'Private fixture connection',host:'private-fixture.invalid',username:'private-fixture-user',port:22,ssh_client:'/usr/bin/ssh',mode:'interactive'};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-service-env-guide-')),catalog=new Catalog(path.join(root,'catalog')),guideRoot=path.join(root,'guides');t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});return {root,catalog,guideRoot,profiles:createComputeProfiles({catalog,guideRoot})};}

test('human SSH profile save derives only connection-specific guidance and keeps activation out of skills',t=>{
 const f=fixture(t),serviceEnvironment={python:'/fixture/conda/envs/studio/bin/python',activation:'source /fixture/conda.sh\nexport API_TOKEN=NEVER_COPY_PRIVATE_VALUE\nconda activate studio'},saved=f.profiles.save({expectedVersion:0,...ssh,serviceEnvironment});
 const file=path.join(f.guideRoot,saved.id,'SKILL.md'),body=fs.readFileSync(file,'utf8');assert(body.includes(saved.id));assert(body.includes('Profile version: 1'));assert(body.includes(serviceEnvironment.python));assert(body.includes('existing Conda or virtual environment'));assert(!body.includes('NEVER_COPY_PRIVATE_VALUE'));assert(!body.includes(serviceEnvironment.activation));assert(!body.includes(ssh.host));assert(!body.includes(ssh.username));assert(!body.includes(ssh.name));assert.deepEqual(f.profiles.read({id:saved.id}).serviceEnvironment,serviceEnvironment);assert.deepEqual(fs.readdirSync(f.guideRoot),[saved.id]);
});

test('guide update follows optimistic profile version, cannot modify another connection and never changes legacy shape',t=>{
 const f=fixture(t),first=f.profiles.save({expectedVersion:0,...ssh}),second=f.profiles.save({expectedVersion:0,...ssh,name:'Second fixture'}),firstFile=path.join(f.guideRoot,first.id,'SKILL.md'),secondFile=path.join(f.guideRoot,second.id,'SKILL.md'),secondBefore=fs.readFileSync(secondFile,'utf8');assert(!Object.hasOwn(first,'serviceEnvironment'));assert(fs.readFileSync(firstFile,'utf8').includes('Python executable: `python3`'));
 const updated=f.profiles.save({id:first.id,expectedVersion:1,...ssh,serviceEnvironment:{python:'python3.12',activation:''}});assert.equal(updated.version,2);assert(fs.readFileSync(firstFile,'utf8').includes('Profile version: 2'));assert.equal(fs.readFileSync(secondFile,'utf8'),secondBefore);
 const firstBefore=fs.readFileSync(firstFile,'utf8');assert.throws(()=>f.profiles.save({id:first.id,expectedVersion:1,...ssh,serviceEnvironment:{python:'python',activation:''}}),/profile_changed/);assert.equal(fs.readFileSync(firstFile,'utf8'),firstBefore);assert.equal(f.profiles.save({id:second.id,expectedVersion:1,...ssh,name:'Second fixture'}).version,1);assert(!Object.hasOwn(f.profiles.read({id:second.id}),'serviceEnvironment'));
});

test('unsafe guide targets fail before profile persistence and do not replace unrelated local files',t=>{
 const f=fixture(t),blocked=path.join(f.root,'must-stay-file');fs.writeFileSync(blocked,'PRESERVE');const profiles=createComputeProfiles({catalog:f.catalog,guideRoot:blocked});assert.throws(()=>profiles.save({expectedVersion:0,...ssh}),/guide_unavailable/);assert.equal(f.catalog.list('compute-profile').length,0);assert.equal(fs.readFileSync(blocked,'utf8'),'PRESERVE');
 const profile={id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',version:1,...ssh};assert.throws(()=>writeSshServiceEnvironmentGuide(f.guideRoot,{...profile,id:'../escape'}),/guide_unavailable/);assert.throws(()=>sshServiceEnvironmentGuide({...profile,serviceEnvironment:{python:'python\nPRIVATE',activation:''}}),/guide_unavailable/);assert(!fs.existsSync(f.guideRoot));
});

test('generated SKILL destination refuses hard links and preserves the existing profile on update failure',t=>{
 const f=fixture(t),saved=f.profiles.save({expectedVersion:0,...ssh}),file=path.join(f.guideRoot,saved.id,'SKILL.md'),other=path.join(f.root,'other-file.md');fs.linkSync(file,other);const before=fs.readFileSync(file,'utf8');assert.throws(()=>f.profiles.save({id:saved.id,expectedVersion:1,...ssh,serviceEnvironment:{python:'python3.12',activation:''}}),/guide_unavailable/);assert.equal(f.profiles.read({id:saved.id}).version,1);assert.equal(fs.readFileSync(other,'utf8'),before);
});
});

await __describe("ssh-live-source-compatibility", async () => {
const test = __node_test;
test('shipped resources attach an existing released SSH runtime and restore its original workflow binding',async t=>{
 const runtimeId='62034ec6cfc1428aaa4d',connectionId='new-authenticated-connection',profileId='existing-owned-profile',host={hostname:'owned-host',uid:1000,machineId:'owned-machine'};
 const health={name:'gpu-sampling-studio',root:'/owned/existing-service',runtime:'/owned/existing-service/runtimes/'+runtimeId,runtimeId,port:25000,execution_policy:'desktop-review-v1',hostIdentity:host,ssh_service:true};
 const identity={kind:'ssh',version:2,profileId,profileVersion:1,hostIdentity:host,root:health.root,runtime:health.runtime,runtimeId};
 const task={id:'existing-flow',provider:'codex',threadId:'existing-thread',authoring:{workerBinding:stableSshWorkerBinding(identity)}};
 const worker=new WorkerClient(),owner={provider:task.provider,threadId:task.threadId,taskId:task.id};worker.bundledRuntimeId=bundledWorkerRuntimeId(path.resolve('backend/worker'));t.after(()=>worker.close());
 let starts=0;const connections={state:async()=>({schemaVersion:2,connectionId,profileId,profileVersion:1,status:'authenticated',authentication:'verified'}),serviceState:async()=>({status:'idle',serviceActive:false}),openService:async(data,bootstrap)=>{starts++;assert.equal(bootstrap.payload.expected_runtime_id,runtimeId,'retain the explicitly selected released worker source identity');return {connectionId,profileId,profileVersion:1,attemptId:data.requestId,status:'connected',serviceActive:true,serviceId:'existing-owned-service',phase:'ready',service:health};},serviceRequest:async p=>p.target==='/api/health'?{status:200,data:health}:{status:200,data:{jsonrpc:'2.0',id:p.data.id,result:{tools:[{name:'present_task',inputSchema:{type:'object'}}]}}}};
 const controller=createSshService({worker,connections,profiles:{read:()=>({kind:'ssh',id:profileId,version:1})},resource:{peek:()=>({schemaVersion:2,kind:'ssh-connection',connectionId,profileId,profileVersion:1}),capture:()=>1,assertCurrent:value=>assert.equal(value,1)},source:path.resolve('backend/worker'),transportSource:path.resolve('desktop/platform/terminal-service/python'),preferredRuntimeId:()=>runtimeId,prepareResources:async(source,options)=>prepareSshServiceResources(source,{...options,reuseOnly:true}),current:()=>owner});
 const attached=await controller.connect({connectionId,profileId,profileVersion:1,requestId:'existing-human-connect'});assert.equal(attached.workflowReady,true);assert.equal(starts,1);
 const restored=await restoreTaskWorker({records:{read:()=>task},worker,settings:()=>({}),selection:()=>owner,selectionEpoch:()=>1},{taskId:task.id});
 assert.equal(restored.status,'connected');assert.equal(restored.serviceVersion,worker.bundledRuntimeId===runtimeId?'current':'different');assert.deepEqual(stableSshWorkerBinding(worker.identity),task.authoring.workerBinding);
});
});

await __describe("resource-preparation-worker", async () => {
const test = __node_test;
test('resource preparation completes when its parent starts paused in an inspector',async()=>{
 const module=new URL('../../backend/main/compute/ssh-service-resources.mjs',import.meta.url).href;
 const script=`import(${JSON.stringify(module)}).then(async m=>{const r=await m.prepareSshServiceResourcesAsync(${JSON.stringify(path.resolve('backend/worker'))},{profileId:'owned-debugger-regression'});console.log('RESOURCE_WORKER_READY '+r.payload.files.length);}).catch(e=>{console.error(e.stack);process.exitCode=1;});`;
 const child=spawn(process.execPath,['--inspect-brk=127.0.0.1:0','-e',script],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',errors='',socket,expired=false;
 const deadline=setTimeout(()=>{expired=true;socket?.close();child.kill();},10000);
 child.stdout.on('data',bytes=>{output+=bytes;if(output.includes('RESOURCE_WORKER_READY'))socket?.close();});
 child.stderr.on('data',bytes=>{errors+=bytes;const endpoint=errors.match(/ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+/)?.[0];if(endpoint&&!socket){socket=new WebSocket(endpoint);socket.addEventListener('error',()=>{});socket.addEventListener('open',()=>socket.send(JSON.stringify({id:1,method:'Runtime.runIfWaitingForDebugger'})));}});
 const expectedCount=prepareSshServiceResources(path.resolve('backend/worker'),{profileId:'owned-debugger-regression'}).payload.files.length;
 try{const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(expired,false,'worker must not inherit the parent debugger pause');assert.equal(code,0,errors);assert.match(output,new RegExp('RESOURCE_WORKER_READY '+expectedCount+'\\b'));}finally{clearTimeout(deadline);socket?.close();if(child.exitCode===null)child.kill();}
});
test('SSH software resources prepare off main, coalesce identical requests and retain exact content identity',async()=>{
 const source=path.resolve('backend/worker'),settings={profileId:'owned-resource-fixture',transportSource:path.resolve('desktop/platform/terminal-service/python')};let ticks=0;
 const timer=setInterval(()=>ticks++,1);try{const first=prepareSshServiceResourcesAsync(source,settings),other=prepareSshServiceResourcesAsync(source,settings);assert.equal(first,other);assert.deepEqual(await first,prepareSshServiceResources(source,settings));assert(ticks>0,'main event loop remains responsive during preparation');}finally{clearInterval(timer);}
 await assert.rejects(prepareSshServiceResourcesAsync('relative-source',settings),/ssh_service_resources_invalid/);
});
});

await __describe("ssh-runtime-preference", async () => {
const test = __node_test;
const previous={kind:'ssh',id:'owned',version:1,host:'unchanged',serviceEnvironment:{python:'python3',activation:''}},next={...previous,version:2,serviceEnvironment:{python:'/owned/conda/python',activation:'source owned'}},binding={kind:'ssh',profileId:'owned',profileVersion:1,runtimeId:'62034ec6cfc1428aaa4d',project:'PRIVATE-GRANT'};
test('explicit environment-only save carries source version while leaving task/project authority unchanged',()=>{const before=structuredClone(binding),proof=carrySshRuntimePreference(previous,next,binding);assert.equal(preferredSshRuntime(next,binding,proof),binding.runtimeId);assert.deepEqual(binding,before);assert(!JSON.stringify(proof).includes('PRIVATE'));assert.deepEqual(proof.previousVersions,[1]);});
test('route changes and other profiles never inherit a runtime preference',()=>{assert.equal(carrySshRuntimePreference(previous,{...next,host:'changed'},binding),null);const proof=carrySshRuntimePreference(previous,next,binding);assert.equal(preferredSshRuntime({...next,id:'other'},binding,proof),undefined);assert.equal(preferredSshRuntime(next,{...binding,profileVersion:9},proof),undefined);assert.equal(preferredSshRuntime(next,{...binding,runtimeId:'f'.repeat(20)},proof),undefined);});
test('successive saved recipes retain exact bounded runtime lineage for reconnection',()=>{const first=carrySshRuntimePreference(previous,next,binding),third={...next,version:3,serviceEnvironment:{python:'python3.9',activation:''}},proof=carrySshRuntimePreference(next,third,binding,first);assert.equal(preferredSshRuntime(third,binding,proof),binding.runtimeId);assert.deepEqual(proof.previousVersions,[1,2]);assert.equal(preferredSshRuntime(third,null,proof),binding.runtimeId);});
test('unrelated global SSH or WSL observations cannot mask or erase the selected saved preference',()=>{const proof=carrySshRuntimePreference(previous,next,binding);for(const observed of [{...binding,profileId:'other'},{kind:'wsl',runtimeId:'f'.repeat(20)}]){const selected=globalSshBindingForProfile(next,observed);assert.equal(selected,null);assert.equal(preferredSshRuntime(next,selected,proof),binding.runtimeId);const updated=carrySshRuntimePreference(next,{...next,version:3,serviceEnvironment:{python:'python3.9',activation:''}},selected,proof);assert.equal(updated.runtimeId,binding.runtimeId);}assert.equal(globalSshBindingForProfile(previous,binding),binding);});
});
