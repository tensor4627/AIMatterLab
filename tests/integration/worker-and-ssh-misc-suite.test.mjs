import __node_test, {describe as __describe} from 'node:test';
import assert from "node:assert/strict";
import {execFile, spawn, spawnSync} from "node:child_process";
import {promisify} from "node:util";
import _imp_0_fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import {fileURLToPath, pathToFileURL} from "node:url";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import {EXISTING_WORKER_COMMON as common, EXISTING_WORKER_READ as _imp_1_read, EXISTING_WORKER_RELAY as relay} from "../../backend/main/compute/existing-worker.mjs";
import {WorkerClient as _imp_2_WorkerClient} from "../../agent/tools/worker-client.mjs";
import _imp_3_fs from "node:fs";
import ts from "typescript";
import {explicitWorkerReceipt, rememberExplicitWorker, workerSettingsSignature, explicitWorkerBindingKey} from "../../backend/main/compute/explicit-worker-binding.mjs";
import {restoreTaskWorker} from "../../backend/main/compute/worker-restore.mjs";
import {deferred as _imp_4_deferred, memoryStorage} from "../helpers/agent-hooks.mjs";
import {appWorkerHarness} from "../helpers/app-worker-hooks.mjs";
import {verifyProviderAccess, providerSentinelObserver} from "../../desktop/platform/verification/install-verification.mjs";
import vm from "node:vm";
import {fixture as _imp_5_fixture, viewed, clone} from "../helpers/local-review-fixture.mjs";
import {registerLocalReview} from "../../backend/main/workspace/local-review-ipc.mjs";
import {localReviewDialog} from "../../desktop/platform/dialogs/local-review-dialog.mjs";
import {createAgentWorkflowContext} from "../../agent/sessions/workflow-context.mjs";
import {TaskRecords} from "../../agent/sessions/task-records.mjs";
import {assertRendererWorkerRoute, assertWorkerRoute} from "../../contracts/transport-policy.mjs";
import {SCIENTIFIC_TOOL_ACCESS} from "../../agent/tools/private-cv-access.mjs";
import {discoverNodeTests, runNodeTests} from "../../scripts/test-node.mjs";
import {runWorkerTests} from "../../scripts/test-worker.mjs";
import {withComputeProject} from "../helpers/deployment-worker-fixture.mjs";
import {prepareDeployment as prepareActualDeployment} from "../../backend/main/workspace/task-deployment.mjs";
import {legacyNebCorrection} from "../../backend/main/workspace/neb-binding.mjs";
import {frontendSource} from "../helpers/frontend-source-paths.mjs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {connectionServiceFixture} from "../helpers/ssh-connection-service-fixture.mjs";
import {verifyDesktop} from "../../desktop/platform/verification/provider-verification.mjs";
import {runDetailHarness as harness} from "../helpers/run-detail-hooks.mjs";
import http from "node:http";
import {createTaskLocalReview} from "../../backend/main/workspace/task-local-review.mjs";
import {randomUUID} from "node:crypto";
import {serviceLaunch, validateServiceEnvironment} from "../../desktop/platform/terminal-service/service-launch.mjs";
import {Catalog} from "../../backend/main/workspace/catalog.mjs";
import {createSshService} from "../../backend/main/compute/ssh-service.mjs";
import {createSshServiceRegistration} from "../../backend/main/compute/ssh-service-registration.mjs";
import {ensureTaskAuthoring} from "../../backend/main/workspace/task-authoring.mjs";
import {registerTaskStage} from "../../backend/main/workspace/task-stage-ipc.mjs";
import {stageFixture} from "../helpers/task-stage-fixture.mjs";
import {createWindowsSaveAs} from "../../desktop/platform/windows-save-as.mjs";

await __describe("existing-worker-security", async () => {
const test = __node_test;
const fs = _imp_0_fs;
const read = _imp_1_read;
const WorkerClient = _imp_2_WorkerClient;
const exec=promisify(execFile),python=process.env.STUDIO_TEST_PYTHON||'python';
function fixture(mode,source=read,requests=[]){return new Promise((resolve,reject)=>{const child=spawn(python,['-B',fileURLToPath(new URL("../helpers/existing-worker-python-fixture.py",import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']}),out=[],err=[];child.stdout.on('data',data=>out.push(data));child.stderr.on('data',data=>err.push(data));child.on('error',reject);child.on('exit',code=>{if(code)reject(Error(Buffer.concat(err).toString()));else try{resolve(JSON.parse(Buffer.concat(out).toString()));}catch(error){reject(error);}});child.stdin.end(JSON.stringify({common,body:source.slice(common.length),mode,requests}));});}
test('current helper verifies exact controller argv, uid, accepted reverse tuple/fd/starttime before sending auth on that same stream',async()=>{const value=await fixture('good');assert.equal(JSON.parse(value.output).status,'connected');assert.deepEqual(value.events.filter(item=>item.kind==='request'),[{kind:'request',target:'/api/health',auth:'Bearer fixture-admin'}]);assert.equal(value.counts.connect,1);assert(value.counts.start>=2);assert(value.counts.argv>=2);});
for(const mode of ['missing-descriptor','symlink','uid','argv-substring','argv-extra','root','port','changed-argv','pid-exit','pid-reuse','fd-denied','tuple','no-inode','inode'])test('unproven existing controller sends zero HTTP/auth bytes: '+mode,async()=>{const value=await fixture(mode);assert.notEqual(JSON.parse(value.output).status,'connected');assert.deepEqual(value.events.filter(item=>item.kind==='request'),[]);});
for(const mode of ['name','root','runtime','execution_policy'])test('verified socket with incompatible current health stays unknown: '+mode,async()=>{const value=await fixture('health-'+mode);assert.equal(JSON.parse(value.output).status,'unknown');});
test('relay independently verifies every fresh stream and keeps admin/MCP token privilege unchanged',async()=>{const requests=[{id:1,method:'GET',target:'/api/health'},{id:2,method:'POST',target:'/mcp',mcp:true,data:{jsonrpc:'2.0',method:'tools/list',id:2}}],value=await fixture('good',relay,requests);assert.equal(value.counts.connect,2);assert.equal(value.counts.tcp,2);assert.deepEqual(value.events.filter(item=>item.kind==='request').map(item=>item.auth).sort(),['Bearer fixture-admin','Bearer fixture-mcp']);assert.deepEqual(value.output.trim().split('\n').map(line=>JSON.parse(line).status),[200,200]);});
test('relay does not reuse the earlier observation for a later unowned listener',async()=>{const value=await fixture('fd-denied',relay,[{id:1,method:'GET',target:'/api/health'},{id:2,method:'POST',target:'/mcp',mcp:true}]);assert.equal(value.counts.connect,2);assert.deepEqual(value.events.filter(item=>item.kind==='request'),[]);assert(value.output.trim().split('\n').every(line=>JSON.parse(line).status===502));});
test('a later replacement listener receives no request even after the first verified relay request succeeded',async()=>{const value=await fixture('later-owner',relay,[{id:1,method:'GET',target:'/api/health'},{id:2,method:'POST',target:'/mcp',mcp:true}]);assert.equal(value.counts.connect,2);assert.equal(value.events.filter(item=>item.kind==='request').length,1);assert.deepEqual(value.output.trim().split('\n').map(line=>JSON.parse(line).status),[200,502]);});
test('actual unrelated TCP listener receives no HTTP/auth bytes from the production readonly Python helper',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'studio-existing-security-')),bytes=[],sockets=new Set();let accepted=0;const server=net.createServer(socket=>{accepted++;sockets.add(socket);socket.on('data',data=>bytes.push(data));socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await fs.writeFile(path.join(directory,'connection.json'),JSON.stringify({admin:'synthetic-never-send',mcp:'synthetic-never-send-mcp'}));
 try{const result=await exec(python,['-B','-c',read,directory,String(server.address().port)],{windowsHide:true,timeout:7000});assert.equal(JSON.parse(result.stdout).status,'unknown');assert.equal(accepted,1);assert.equal(Buffer.concat(bytes).length,0);}finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});}
});
test('existing-only transport never uses Windows fetch, forwards scoped MCP without admin upgrade, and relay exit invalidates readiness',async()=>{
 const health={name:'gpu-sampling-studio',root:'/fixture/worker',runtime:'/fixture/runtime',execution_policy:'desktop-review-v1'},requests=[];let child;const worker=new WorkerClient({readExisting:async()=>({status:'connected',connection:{url:'http://127.0.0.1:8767',tokens:{admin:'fixture-admin',mcp:'fixture-mcp'},health}}),launchRelay:(_binary,args)=>{assert.equal(args[6],relay);child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};child.stdin={write:text=>{const value=JSON.parse(text);requests.push(value);queueMicrotask(()=>child.stdout.write(JSON.stringify({id:value.id,status:200,data:health})+'\n'));}};return child;}});const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Windows fetch forbidden');};try{assert.equal((await worker.restore({distribution:'Fixture Ubuntu',workerRoot:health.root,workerPort:8767})).status,'connected');assert.equal(requests[0].mcp,false);const scoped=worker.providerConnection('codex');assert.deepEqual(Object.keys(scoped.tokens),['mcp']);assert.notEqual(scoped.tokens.mcp,'fixture-mcp');let response=await originalFetch(scoped.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer fixture-admin','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})});assert.equal(response.status,403);await response.text();assert.equal(requests.length,1);response=await originalFetch(scoped.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+scoped.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})});assert.equal(response.status,200);await response.text();assert.equal(requests[1].mcp,true);child.emit('exit');assert.equal(worker.connection,null);assert.equal(worker.providerScopes.scopes.size,0);}finally{worker.close();globalThis.fetch=originalFetch;child.stdout.end();child.stderr.end();}
});
});

await __describe("explicit-worker-binding", async () => {
const test = __node_test;
const fs = _imp_3_fs;
const deferred = _imp_4_deferred;
const target={distribution:'Fixture Ubuntu',workerRoot:'~/selected',workerPort:8767},identity={distribution:target.distribution,root:'/fixture/selected'},health={name:'gpu-sampling-studio',root:identity.root,runtime:'/fixture/runtime',execution_policy:'desktop-review-v1'};
function fixture(){let settings={...target},owner={serial:1,provider:'codex',threadId:'saved',taskId:null};const saved=new Map(),calls=[],catalog={get:(kind,id)=>saved.get(kind+':'+id)||null,put:(kind,id,value)=>{saved.set(kind+':'+id,structuredClone(value));return value;}},conversation={id:'codex:saved',provider:'codex',threadId:'saved',projectId:'project',taskId:null},project={id:'project',name:'Saved project',policy:{engines:['pydyn.md'],environments:['env']}};
 catalog.put('conversation',conversation.id,conversation);catalog.put('projects',project.id,project);
 const worker={connection:{health:{...health},tokens:{admin:'synthetic-private-admin',mcp:'synthetic-private-mcp'}},identity:{...identity},connectionEpoch:1,connectionTarget:{port:target.workerPort},request:async(method,path)=>{calls.push({method,path});if(path==='/api/health')return {...health};if(path==='/api/projects')return [structuredClone(project)];throw Error('Unexpected request');},restore:async(value,{current})=>{calls.push({restore:value});return {status:current()?'connected':'unknown',reason:'fixture'};}};
 const records={conversation:(provider,thread)=>catalog.get('conversation',provider+':'+thread),deleted:()=>false,read:()=>({id:'task',provider:'codex',threadId:'saved'})},context={catalog,worker,records,settings:()=>settings,selection:()=>owner};
 return {context,catalog,worker,calls,conversation,project,settings:value=>settings=value,selection:value=>owner=value,close:()=>{worker.connection=null;worker.identity=null;worker.connectionEpoch++;},binding:()=>catalog.get('worker-binding',explicitWorkerBindingKey),remember:()=>rememberExplicitWorker(context,explicitWorkerReceipt(worker,settings)),restore:()=>restoreTaskWorker(context,{conversationId:conversation.id})};
}
test('successful explicit receipt persists only verified noncredential identity, exact settings signature and observation time',async()=>{const f=fixture();assert.equal(await f.remember(),true);const value=f.binding();assert.deepEqual(Object.keys(value).sort(),['checkedAt','distribution','port','root','settingsSignature','version']);assert.equal(value.root,identity.root);assert.deepEqual(value.settingsSignature,workerSettingsSignature(target));assert(!/private|tokens|url|runtime/.test(JSON.stringify(value)));assert.deepEqual(f.calls,[{method:'GET',path:'/api/health'}]);});
for(const mode of ['health-error','health-root','settings','close','connection','epoch','identity','port'])test('no durable binding after failed or late explicit health receipt: '+mode,async()=>{const f=fixture(),pending=deferred(),receipt=explicitWorkerReceipt(f.worker,target);f.worker.request=()=>pending.promise;const result=rememberExplicitWorker(f.context,receipt);if(mode==='settings')f.settings({...target,workerRoot:'/new'});if(mode==='close')f.close();if(mode==='connection')f.worker.connection={...f.worker.connection};if(mode==='epoch')f.worker.connectionEpoch++;if(mode==='identity')f.worker.identity={...f.worker.identity};if(mode==='port')f.worker.connectionTarget.port++;if(mode==='health-error')pending.reject(Error('Synthetic private failure'));else pending.resolve({...health,...mode==='health-root'?{root:'/wrong'}:{}});assert.equal(await result,false);assert.equal(f.binding(),null);});
test('current selected no-task conversation restores only the last explicit target then confirms the exact saved project on that service',async()=>{const f=fixture();await f.remember();f.calls.length=0;const result=await f.restore();assert.equal(result.status,'connected');assert.equal(result.conversationId,'codex:saved');assert.equal(f.calls[0].restore.workerRoot,identity.root);assert.equal(f.calls[0].restore.workerPort,target.workerPort);assert.deepEqual(f.calls[1],{method:'GET',path:'/api/projects'});assert(!JSON.stringify(result).includes('private'));});
for(const mode of ['missing-record','settings-root','settings-port','settings-distribution','no-project','removed-project','unknown-owner','deleted'])test('no-task automatic recovery does not guess a target or project: '+mode,async()=>{const f=fixture();if(mode!=='missing-record')await f.remember();f.calls.length=0;if(mode==='settings-root')f.settings({...target,workerRoot:'/other'});if(mode==='settings-port')f.settings({...target,workerPort:8768});if(mode==='settings-distribution')f.settings({...target,distribution:'Other'});if(mode==='no-project')f.catalog.put('conversation',f.conversation.id,{...f.conversation,projectId:null});if(mode==='removed-project')f.catalog.put('projects',f.project.id,null);if(mode==='unknown-owner')f.selection({serial:2,provider:'kimi',threadId:'other',taskId:null});if(mode==='deleted')f.context.records.deleted=()=>true;assert.notEqual((await f.restore()).status,'connected');assert.deepEqual(f.calls,[]);});
test('authoritative project metadata may change without blocking its immutable service-local ID or overwriting policy during restore',async()=>{const f=fixture();await f.remember();f.worker.request=async()=>[{id:f.project.id,name:'Renamed on service',policy:{engines:['nep.train']},updated_at:12}];assert.equal((await f.restore()).status,'connected');assert.deepEqual(f.catalog.get('projects',f.project.id),f.project);});
for(const mode of ['missing','wrong-id','read-error','close','selection','settings','conversation','project-cache','new-binding'])test('actual project read cannot create a wrong fallback or publish late restored scope: '+mode,async()=>{const f=fixture();await f.remember();const pending=deferred();f.worker.request=()=>pending.promise;const result=f.restore();await new Promise(resolve=>setImmediate(resolve));if(mode==='close')f.close();if(mode==='selection')f.selection({serial:2,provider:'codex',threadId:'other',taskId:null});if(mode==='settings')f.settings({...target,workerRoot:'/new'});if(mode==='conversation')f.catalog.put('conversation',f.conversation.id,{...f.conversation,projectId:'other'});if(mode==='project-cache')f.catalog.put('projects',f.project.id,{...f.project,name:'Changed'});if(mode==='new-binding')f.catalog.put('worker-binding',explicitWorkerBindingKey,{...f.binding(),checkedAt:0});if(mode==='read-error')pending.reject(Error('Unavailable'));else pending.resolve(mode==='missing'?[]:mode==='wrong-id'?[{...f.project,id:'unrelated-project'}]:[f.project]);assert.equal((await result).status,'unknown');});
for(const mode of ['missing','legacy-port-missing','explicit-port'])test('conversation with a task uses only its original binding, never the last global port: '+mode,async()=>{const f=fixture();await f.remember();f.calls.length=0;f.catalog.put('conversation',f.conversation.id,{...f.conversation,taskId:'task'});f.selection({serial:1,provider:'codex',threadId:'saved',taskId:'task'});f.context.records.read=()=>({id:'task',provider:'codex',threadId:'saved',...(mode!=='missing'?{deployment:{workerBinding:{distribution:'Original bound distro',root:'/original-task',...mode==='explicit-port'?{port:8999}:{}}}}:{})});const result=await f.restore();if(mode==='explicit-port'){assert.equal(f.calls[0].restore.workerRoot,'/original-task');assert.equal(f.calls[0].restore.workerPort,8999);assert.equal(result.taskId,'task');}else{assert.equal(result.status,'disconnected');if(mode==='legacy-port-missing')assert.equal(result.reason,'legacy_port_unknown');assert.deepEqual(f.calls,[]);}});
test('typed conversation restoration rejects renderer endpoints and mixed identities',async()=>{const f=fixture();for(const args of [{conversationId:'codex:saved',url:'http://other.invalid'},{conversationId:'codex:saved',taskId:'task'},{conversationId:''}])await assert.rejects(restoreTaskWorker(f.context,args),/Invalid typed/);assert.deepEqual(f.calls,[]);});
test('actual explicit-connect main handler never remembers a rejected connect and does not record a late/closed bridge',async()=>{
 const source=fs.readFileSync(new URL("../../desktop/main.mjs",import.meta.url),'utf8'),parsed=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let registration;const visit=node=>{if(ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(parsed)==='handle'&&node.expression.arguments[0]?.text==='worker.connect')registration=node;node.forEachChild(visit);};visit(parsed);
 for(const mode of ['failed','closed','settings','epoch','identity','connection','success']){const f=fixture(),handlers=new Map(),config={...target};f.worker.connect=async()=>{if(mode==='failed')throw Error('Connect failed');return health;};new Function('handle','assertIdleAgent','assertLegacyWorkerIdle','agents','worker','settings','workerSource','explicitWorkerReceipt','bindSources','rememberExplicitWorker','catalog','discoverCompute','managedWorkbench','emit','sshService','computeResource',registration.getText(parsed))((name,fn)=>handlers.set(name,fn),()=>{},()=>{},{close(){}},f.worker,config,'/fixture/source',explicitWorkerReceipt,async()=>{if(mode==='closed')f.close();if(mode==='settings')config.workerPort++;if(mode==='epoch')f.worker.connectionEpoch++;if(mode==='identity')f.worker.identity={...f.worker.identity};if(mode==='connection')f.worker.connection={...f.worker.connection};},rememberExplicitWorker,f.catalog,()=>{},{publishLocal:async()=>{}},()=>{},{peek:()=>({status:'disconnected'}),disconnect:async()=>{},resourceChanged:async()=>{}},{peek:()=>null});const result=handlers.get('worker.connect')();if(mode==='failed')await assert.rejects(result,/Connect failed/);else await result;assert.equal(!!f.binding(),mode==='success');}
});
});

await __describe("frontend-compute-attempt-fence", async () => {
const test = __node_test;
const deferred = _imp_4_deferred;
function fixture(){
 const old=deferred(),h=appWorkerHarness({override:(method,data,standard)=>method==='worker.restore'&&data.scope==='global'?old.promise:method==='worker.status'?{status:'connected',serviceVersion:'current',sourceId:'c'.repeat(64),checkedAt:2}:standard(method,data)});
 return {h,old,guide:()=>h.find(n=>n.type==='./ComputeConnectionGuide').props,connected:()=>h.find(n=>n.type==='./Agent').props.computeConnected,reads:()=>h.calls.filter(c=>c.method==='worker.request').length};
}
test('opening a read-only connection plan leaves an original global restore eligible',async()=>{const f=fixture();try{await f.h.flush();f.h.connect();await f.h.flush();f.old.resolve({status:'connected',serviceVersion:'different',checkedAt:1});await f.h.flush();assert.equal(f.connected(),true);assert(f.reads()>0);assert(!f.h.calls.some(c=>['worker.connect','compute.connection.connect'].includes(c.method)));}finally{f.h.unmount();}});
test('an explicit connection start invalidates old global success even after failed or abandoned completion',async()=>{const f=fixture();try{await f.h.flush();f.h.connect();await f.h.flush();const guide=f.guide();guide.onConnectStart();guide.onClose(false);await f.h.flush();f.old.resolve({status:'connected',serviceVersion:'different',checkedAt:1});await f.h.flush();assert.equal(f.connected(),false);assert.equal(f.reads(),0);}finally{f.h.unmount();}});
test('a newer successful connection retains its state when older global success arrives',async()=>{const f=fixture();try{await f.h.flush();f.h.connect();await f.h.flush();const guide=f.guide();guide.onConnectStart();f.h.emit({method:'studio/workerConnected',params:{}});await f.h.flush();guide.onClose(true);await f.h.flush();assert.equal(f.connected(),true);const reads=f.reads();f.old.resolve({status:'connected',serviceVersion:'different',checkedAt:1});await f.h.flush();assert.equal(f.connected(),true);assert.equal(f.reads(),reads);assert.throws(()=>f.h.find(n=>n.props?.['data-testid']==='worker-service-version'));}finally{f.h.unmount();}});
test('an abandoned guide callback cannot invalidate a later current service',async()=>{const f=fixture();try{await f.h.flush();f.h.connect();await f.h.flush();const oldGuide=f.guide();oldGuide.onClose(false);f.h.emit({method:'studio/workerConnected',params:{}});await f.h.flush();assert.equal(f.connected(),true);oldGuide.onConnectStart();await f.h.flush();assert.equal(f.connected(),true);f.old.resolve({status:'connected',serviceVersion:'different',checkedAt:1});await f.h.flush();assert.equal(f.connected(),true);}finally{f.h.unmount();}});
});

await __describe("install-verification", async () => {
const test = __node_test;
function fixture({models=[{model:'fixture-model',isDefault:true}],account=null,auth=true}={}){const calls=[];return {calls,invoke:async(method,data)=>{calls.push({method,data});if(method==='agent.connect')return {};if(method==='agent.account')return {account,requiresOpenaiAuth:auth};if(data.method==='model/list')return {data:models,authRequired:auth};if(data.method==='thread/start')return {thread:{id:'actual-thread'}};throw Error('Unexpected RPC');}};}
test('Unavailable account metadata cannot replace a real successful provider turn',async()=>{
 const {calls,invoke}=fixture();let turns=0;const result=await verifyProviderAccess('codex',invoke,async payload=>{turns++;assert.equal(payload.params.threadId,'actual-thread');assert.equal(payload.params.planningMode,false);assert.equal(payload.params.input.length,1);return {status:'passed',toolCalls:0};});
 assert.equal(turns,1);assert.equal(result.status,'passed');assert.equal(result.modelAccess,'passed');assert.deepEqual(result.accountMetadata,{available:false,requiresOpenaiAuth:true,catalogAuthRequired:true});assert.equal(calls.filter(call=>call.data?.method==='thread/start').length,1);assert.equal(result.account,undefined);
});
test('Account records and model catalogs never replace an unsuccessful real provider call',async()=>{
 for(const status of ['blocked','failed']){const {invoke}=fixture({account:{type:'chatgpt'},auth:false});const result=await verifyProviderAccess('codex',invoke,async()=>({status,reason:'actual request rejected or timed out'}));assert.equal(result.status,status);assert.notEqual(result.modelAccess,'passed');}
});
test('Empty model catalog stops with an identified stage without fabricating a reply',async()=>{
 const {invoke,calls}=fixture({models:[]});const stages=[];await assert.rejects(()=>verifyProviderAccess('codex',invoke,async()=>{throw Error('must not run');},stage=>stages.push(stage)),/No callable model catalog/);assert.equal(stages.at(-1),'model_list');assert(!calls.some(call=>call.data?.method==='thread/start'));
});

test('Installer sentinel rejects all native, MCP and unknown executable items, including completed-only items',()=>{
 for(const type of ['mcpToolCall','commandExecution','fileChange','dynamicToolCall','collabAgentToolCall','webSearch','imageView','imageGeneration','functionCallOutput','futureUnknownTool']){
  const observe=providerSentinelObserver('codex','t');observe({provider:'codex',method:'item/completed',params:{threadId:'t',item:{id:'native',type}}});observe({provider:'codex',method:'item/agentMessage/delta',params:{threadId:'t',itemId:'a',delta:'STUDIO_INSTALL_AGENT_OK'}});const result=observe({provider:'codex',method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}});assert.equal(result.status,'failed',type);assert.equal(result.toolCalls,1);assert.deepEqual(result.toolItems,[{id:'native',type}]);
 }
});
test('Installer observer accepts exact completed replies, deduplicates item lifecycle and ignores other threads/providers',()=>{
 const observe=providerSentinelObserver('codex','t');for(const [provider,threadId] of [['kimi','t'],['codex','other']])observe({provider,method:'item/started',params:{threadId,item:{id:'elsewhere',type:'commandExecution'}}});for(const method of ['item/started','item/completed'])observe({provider:'codex',method,params:{threadId:'t',item:{id:'a',type:'agentMessage',text:'STUDIO_INSTALL_AGENT_OK'}}});const result=observe({provider:'codex',method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}});assert.equal(result.status,'passed');assert.deepEqual(result.itemTypes,['agentMessage']);assert.equal(result.toolCalls,0);
 const wrong=providerSentinelObserver('codex','t');wrong({provider:'codex',method:'item/agentMessage/delta',params:{threadId:'t',delta:'extra STUDIO_INSTALL_AGENT_OK'}});assert.equal(wrong({provider:'codex',method:'turn/completed',params:{threadId:'t',turn:{status:'completed'}}}).status,'failed');
});
});

await __describe("local-review-ipc", async () => {
const test = __node_test;
const fs = _imp_3_fs;
const fixture = _imp_5_fixture;
async function setup(){const f=fixture(),handlers=new Map(),store=new Map(),activeTasks=new Map(),context=createAgentWorkflowContext({records:f.records,activeTasks,selectedProvider:()=> 'codex'});await context.synchronize(context.begin('codex','thread'),async()=>{});const api=registerLocalReview({handle:(name,fn)=>handlers.set(name,fn),records:f.records,worker:f.worker,current:()=>context.current(),assertHuman:event=>event?.trusted===true,confirm:async()=>false,receiptStore:{get:id=>store.get(id),put:(id,value)=>store.set(id,value)}});return {f,handlers,store,context,api};}
test('Actual candidate IPC registry exposes only four exact typed human channels',async()=>{const {handlers}=await setup();assert.deepEqual([...handlers.keys()],['task.localReview.inspect','task.localReview.read','task.localReview.confirm','task.localReview.status']);for(const name of handlers.keys())assert.equal(Object.hasOwn(SCIENTIFIC_TOOL_ACCESS,name),false);assert.throws(()=>assertRendererWorkerRoute('POST','/api/local-review/confirm'),/Unsupported/);});
for(const name of ['inspect','read','confirm','status'])test('Untrusted sender cannot dispatch '+name,async()=>{const {handlers,store}=await setup();await assert.rejects(async()=>handlers.get('task.localReview.'+name)({taskId:'task',...name==='read'?{snapshotId:'invented',entryId:'invented'}:name==='confirm'?{snapshotId:'invented'}:{}},{trusted:false}),/trusted human/);assert.equal(store.size,0);});
for(const extra of ['authority','receipt','provider','projectId','path','definitionOnly'])test('Status request rejects forged '+extra+' authority data',async()=>{const {handlers}=await setup();await assert.rejects(async()=>handlers.get('task.localReview.status')({taskId:'task',[extra]:'forged'},{trusted:true}),/typed local/);});
test('Status cannot expose current authority after worker disconnect or owner switch',async()=>{const {api,context,f}=await setup();assert.equal(api.status({taskId:'task'},{trusted:true}).status,'not_run');context.begin('codex',null);assert.throws(()=>api.status({taskId:'task'},{trusted:true}),/Select this current/);f.worker.connection=null;assert.throws(()=>api.status({taskId:'task'},{trusted:true}));});
test('Status rechecks selection after the final synchronous receipt lookup',async()=>{const {f,context}=await setup(),handlers=new Map();const api=registerLocalReview({handle:(n,fn)=>handlers.set(n,fn),records:f.records,worker:f.worker,current:()=>context.current(),assertHuman:()=>true,confirm:async()=>false,receiptStore:{get:()=>{context.begin('codex',null);return null;},put(){}}});f.mutate(t=>t.localInputReview={receiptId:'forged'});assert.throws(()=>api.status({taskId:'task'},{}),/Select this current|changed/);});
test('Actual preload allowlist accepts typed human actions and rejects nonlisted methods',async()=>{const calls=[];let bridge;const source=fs.readFileSync(new URL("../../desktop/preload.cjs",import.meta.url),'utf8');vm.runInNewContext(source,{require:id=>{assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'studio');bridge=value;}},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return {status:'not_run'};},on(){},removeListener(){}}};}});for(const name of ['inspect','read','confirm','status'])await bridge.invoke('task.localReview.'+name,{taskId:'task'});assert.deepEqual(calls.map(c=>c[0]),['studio:task.localReview.inspect','studio:task.localReview.read','studio:task.localReview.confirm','studio:task.localReview.status']);await assert.rejects(bridge.invoke('task.localReview.override',{}),/Unsupported/);});
test('Actual TaskRecords generic edit and present_task cannot mint/overwrite the main receipt store',()=>{const f=fixture(),values=new Map(),catalog={get:(kind,id)=>values.get(kind+':'+id),put:(kind,id,value)=>{values.set(kind+':'+id,clone(value));return value;},list:kind=>[...values.entries()].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>clone(value))};catalog.put('agent-task','task',f.task());catalog.put('conversation','codex:thread',{id:'codex:thread',provider:'codex',threadId:'thread',taskId:'task'});const records=new TaskRecords(catalog,()=>{});records.edit({id:'task',changes:{localInputReview:{status:'confirmed',receiptId:'invented'}}});assert.equal(records.read('task').localInputReview,undefined);records.active.set('codex:thread','task');records.event({provider:'codex',method:'item/completed',params:{threadId:'thread',item:{tool:'present_task',result:{kind:'task-parameters',id:'task',name:'Untrusted model metadata',steps:[],parameters:{...f.task().parameters},missing_fields:[],localInputReview:{status:'confirmed',receiptId:'invented'}}}}});assert.equal(records.read('task').localInputReview,undefined);assert.equal(catalog.list('local-input-review').length,0);});
for(const language of ['zh-CN','en'])test('Native '+language+' dialog is default-cancel and displays every exact local identity',()=>{const scope={taskId:'task',projectId:'project',environmentId:'env',inputRoot:'/owned',parameterRevision:4,parametersSha:'p'.repeat(64),runtimeInterpreter:'/env/python',runtimeConfiguredInvocation:'/configured/python-alias',runtimeReceiptSha:'r'.repeat(64),runtimeConfigurationSha:'c'.repeat(64),entries:[{name:'build_bias.py',path:'/owned/build_bias.py',sha256:'s'.repeat(64),size:123,role:'generated-source'}],privateBindings:[{id:'entry',code_sha256:'x'.repeat(64)}],composition:{expected:{journal_sha256:'j'.repeat(64)}}};const value=localReviewDialog(scope,language);assert.equal(value.defaultId,0);assert.equal(value.cancelId,0);assert.equal(value.noLink,true);assert.ok(value.detail.includes('\n'));for(const token of ['task','project','env','/owned',scope.parametersSha,scope.runtimeInterpreter,scope.runtimeConfiguredInvocation,scope.runtimeReceiptSha,scope.runtimeConfigurationSha,'123',scope.entries[0].sha256,scope.privateBindings[0].code_sha256,scope.composition.expected.journal_sha256])assert.ok(value.detail.includes(token));assert.equal(value.buttons[0],language==='en'?'Cancel':'取消');});
});

await __describe("local-test-entry", async () => {
const test = __node_test;
const fs = _imp_3_fs;
function fixture(t){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'studio-local-tests-'));
 t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
 for(const name of ['tests/frontend/ui.test.mjs','tests/backend/api.test.mjs','tests/helpers/not-a-test.mjs','backend/worker/tests/test_worker_a.py']){fs.mkdirSync(path.dirname(path.join(cwd,name)),{recursive:true});fs.writeFileSync(path.join(cwd,name),'// fixture, never executed');}
 const calls=[],lines=[],options={cwd,testsRoot:path.join(cwd,'tests'),spawnTarget:(...args)=>{calls.push(args);return {status:0};},write:value=>lines.push(value)};
 return {cwd,calls,lines,options};
}
test('default Node entry discovers every local test once; suites and files intersect without duplicate invocation',t=>{
 const f=fixture(t);assert.equal(discoverNodeTests(f.options.testsRoot).length,2);
 assert.equal(runNodeTests([],f.options),0);assert.equal(f.calls[0][1].filter(arg=>arg.endsWith('.test.mjs')).length,2);
 runNodeTests(['--suite=frontend,frontend','--file=tests/frontend/ui.test.mjs','--test-name-pattern','some behavior'],f.options);
 assert.deepEqual(f.calls[1][1],['--test','--test-name-pattern','some behavior',path.join(f.cwd,'tests/frontend/ui.test.mjs')]);
});
test('Node list does not execute; unknown suites, external paths and empty selections fail visibly',t=>{
 const f=fixture(t);runNodeTests(['--suite=backend','--list'],f.options);assert.deepEqual(f.lines,['tests/backend/api.test.mjs\n']);assert.equal(f.calls.length,0);
 for(const args of [['--suite=typo'],['--file=../engine/tests/tool.test.mjs'],['--suite=agent'],['--suite=frontend','--file=tests/backend/api.test.mjs']])assert.throws(()=>runNodeTests(args,f.options));
});
test('Node runner preserves child failure instead of reporting a selected suite as passed',t=>{
 const f=fixture(t);assert.equal(runNodeTests(['--suite=frontend'],{...f.options,spawnTarget:()=>({status:7})}),7);
});
test('worker inventory is read-only and scoped pattern selects only AIMatterLab tests before spawning',t=>{
 const f=fixture(t),calls=[],messages=[],child={},options={cwd:f.cwd,platform:'linux',env:{},preflight:()=>({status:'allowed'}),spawnTarget:(...args)=>{calls.push(args);return child;},write:value=>messages.push(value)};
 assert.equal(runWorkerTests({...options,args:['--list']}).exitCode,0);assert.equal(calls.length,0);
 assert.deepEqual(messages[0].files,['test_worker_a.py']);assert.equal(runWorkerTests({...options,args:['--pattern=test_worker_*.py']}).child,child);assert(calls[0][1].includes('test_worker_*.py'));
 for(const pattern of ['test_missing.py','../../engine/test_tool.py'])assert.equal(runWorkerTests({...options,args:['--pattern='+pattern]}).exitCode,2);
 assert.equal(calls.length,1);
});
});

await __describe("neb-binding", async () => {
const test = __node_test;
function fixture(){const snapshots=['run.in','is.xyz','fs.xyz','nep.txt'].map(name=>({name,source:'/owned/'+name,sha256:name+'hash'}));const task={parameters:{engine:'gpumd.neb'},inputBinding:{parameters:{structure:{initial:'/owned/is.xyz',final:'/owned/fs.xyz',atom_count:32,pbc:[true,true,true],cell_A:[[7,0,0],[0,7,0],[0,0,7]]},potential:{file:'/owned/nep.txt'},neb:{driver:'/owned/run.in',fixed_cell:true,intermediate_images:3,total_images:5,optimizer:'fire',max_steps:30,force_tolerance:0.05,ina:false}},hashes:snapshots.map(({name,sha256})=>({name,sha256})).sort((a,b)=>a.name.localeCompare(b.name)),parameterRevision:1},manualEdits:{}};const prior={id:'old-invalid',engine:'gpumd.neb',status:'draft',validation:{status:'failed',message:'Declared NEB parameter differs from run.in or is unsupported: driver'},identity:null,snapshots};const next={neb:{optimizer:'fire',max_steps:30,force_tolerance:0.05,ina:false,cell_mode:'fixed',interpolate:3}};return {task,prior,next};}
test('Only an exact invalid unstarted NEB draft can correct equivalent legacy aliases with identical recorded file pointers',()=>{const {task,prior,next}=fixture();assert.equal(legacyNebCorrection(task,prior,next),true);assert.equal(prior.status,'draft');});
test('True control changes, unknown metadata, other engines and any previously started or validated run cannot use schema correction',()=>{
 const changes=[f=>delete f.task.inputBinding,f=>f.next.neb.max_steps=32,f=>f.next.neb.force_tolerance=0.01,f=>f.next.neb.pressure_gpa=1,f=>f.next.bias_file='bias.pt2',f=>f.next.unregistered=1,f=>f.task.parameters.engine='pydyn.md',f=>f.prior.validation.status='passed',f=>f.prior.status='running',f=>f.prior.identity={pid:3},f=>f.prior.started_at=1,f=>f.prior.exit_code=0,f=>f.prior.snapshots[0].sha256='changed',f=>f.task.inputBinding.parameters.neb.driver='/other/run.in',f=>f.task.inputBinding.parameters.neb.total_images=6,f=>f.task.inputBinding.parameters.neb.unknown=1,f=>f.task.manualEdits={'neb.max_steps':2},f=>f.task.inputBinding.contractVersion=2];
 for(const change of changes){const f=fixture();change(f);assert.equal(legacyNebCorrection(f.task,f.prior,f.next),false,change.toString());}
});


test('Changing deployment directory can recover the proven legacy execution anchor without treating obsolete prepared inputs as current',async()=>{
 const {TaskRecords}=await import("../../agent/sessions/task-records.mjs");const {saveDeployment}=await import("../../backend/main/workspace/task-deployment.mjs");
 const data=new Map(),catalog={get:(k,id)=>structuredClone(data.get(k+id)),put:(k,id,v)=>{data.set(k+id,structuredClone(v));return v;},list:k=>[...data.entries()].filter(([key])=>key.startsWith(k)).map(([,v])=>structuredClone(v))},records=new TaskRecords(catalog,()=>{}),f=fixture();
 const task=records.create({workflowVersion:2,planningMode:true,provider:'codex',threadId:'thread',request:'NEB',projectId:'p'});Object.assign(task,{parameters:{engine:'gpumd.neb',files:f.prior.snapshots.map(file=>file.source),...f.next},parameterRevision:4,inputBinding:f.task.inputBinding,review:{status:'ready',parameterRevision:4},execution:{phase:'blocked',artifactId:f.prior.id},artifacts:[{id:f.prior.id,engine:'gpumd.neb',kind:'run',preparedRevision:1}]});records.save(task);
 const cfg={target:'local',targetId:'e',projectId:'p',directoryName:'second',maxSeconds:30,resources:{cpus:1,gpus:1,memory_mb:1000}};saveDeployment(records,{taskId:task.id,value:cfg});assert.equal(records.read(task.id).deployment.prepared,undefined);
 const calls=[],worker={request:async(_method,route,value)=>{calls.push(route);if(route==='/api/run/status')return {...f.prior,project_id:'p'};return {id:'corrected',engine:'gpumd.neb',project_id:'p',status:'draft',snapshots:f.prior.snapshots,input_contract:{status:'passed'}};}};
 await prepareDeployment(records,worker,{taskId:task.id});const saved=records.read(task.id);assert.equal(saved.inputBinding.artifactId,'corrected');assert.equal(saved.inputBinding.correction.previousArtifactId,f.prior.id);assert.equal(saved.deployment.prepared.artifactId,'corrected');assert.equal(saved.inputBinding.semanticStatus,'not_run');assert(!calls.some(route=>/validate|submit/.test(route)));
});

function prepareDeployment(records,worker,args,localReview){return prepareActualDeployment(records,withComputeProject(worker,records.read(args.taskId)),args,localReview);}
});

await __describe("no-graph-planning-entry", async () => {
const test = __node_test;
const fs = _imp_3_fs;
const read=name=>fs.readFileSync(frontendSource(name),'utf8');
const source=read('AgentTaskPage.tsx'),ast=ts.createSourceFile('AgentTaskPage.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let condition,entry;
function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='noGraphPlanning')condition=n.initializer.getText(ast);if(ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(a=>a.name?.getText(ast)==='data-testid'&&a.initializer?.text==='no-graph-planning-entry')){let parent=n;while(parent&&!ts.isJsxExpression(parent))parent=parent.parent;entry=parent.expression.getText(ast);}ts.forEachChild(n,walk);}walk(ast);
const composerAst=ts.createSourceFile('composer.tsx',read('PygasTaskComposer.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const hasDeclaration=composerAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='taskHasComposition');const has=ts.transpileModule(hasDeclaration.getText(composerAst).replace('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const taskHasComposition=new Function(has+';return taskHasComposition;')();
function render(task,locked=false){assert(condition&&entry,'actual no-graph JSX must exist');const before=structuredClone(task),calls=[];const noGraphPlanning=new Function('task','hasComposition','return '+condition)(task,taskHasComposition(task));const code=ts.transpileModule('return ('+entry+');',{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;const element=new Function('React','noGraphPlanning','t','onAgent','navigationBusy','busy','saving','saveError','state',code)(React,noGraphPlanning,x=>x,text=>calls.push(text),false,false,false,false,{locked});return {element,calls,before,html:renderToStaticMarkup(element)};}
const bare={id:'real-fixture-task',provider:'codex',threadId:'real-empty-thread',workflowVersion:2,parameters:{engine:'pygas.build',files:[]},review:{status:'not_run'},artifacts:[]};
test('actual bare-build JSX exposes only same-conversation prefill, preserving real task/thread and absent graph',()=>{
 const value=structuredClone(bare),f=render(value);assert.match(f.html,/在当前会话准备组合图/);assert.doesNotMatch(f.html,/PygasComposer|创建空白|读取|保存/);const button=React.Children.toArray(f.element.props.children).find(n=>n.type==='button');button.props.onClick();assert.equal(f.calls.length,1);assert.match(f.calls[0],/当前会话.*同一流程/);assert.match(f.calls[0],/不构建、不运行/);assert.deepEqual(value,f.before);assert.equal(value.id,bare.id);assert.equal(value.threadId,bare.threadId);assert.equal(value.composition,undefined);
});
test('actual entry excludes MD, native source, existing graph, input lineage, prior artifact and legacy tasks',()=>{
 for(const changes of [{parameters:{engine:'gpumd.md',files:[]}},{parameters:{engine:'pygas.build',files:['/owned/build_bias.py']}},{composition:{status:'draft',graphPath:'/owned/workflow.json'}},{inputBinding:{parameters:{}}},{artifacts:[{kind:'run',engine:'pygas.build',id:'producer'}]},{workflowVersion:1},{threadId:''}])assert.equal(render({...bare,...changes}).html,'');
 assert.match(render(bare,true).html,/disabled=""/);
});
});

await __describe("progressive-service-setup", async () => {
const test = __node_test;
test('incomplete remote inventory keeps verified service and grants available, persists cache identity, and refreshes later',async t=>{
 const f=connectionServiceFixture(t),original=f.connections.serviceRequest;let unavailable=true;
 f.connections.serviceRequest=async packet=>packet.data?.method==='tools/list'&&unavailable?{status:200,data:{jsonrpc:'2.0',id:packet.data.id,error:{code:-32603,message:'catalog not configured'}}}:original(packet);
 f.worker.setLocalTools([{name:'list_shared_terminals'}],async()=>({sessions:[]}));
 const connected=await f.connect();assert.equal(connected.status,'connected');assert.equal(connected.workflowReady,true);assert.deepEqual(connected.warnings,['tools_unavailable']);assert.equal(connected.tools.count,1);
 f.grant();assert.equal(f.service.hasCurrentGrant('codex'),true);
 const saved=f.registration.read({profileId:'profile-A',profileVersion:1});assert.equal(saved.status,'configured');assert.deepEqual(saved.registration.toolWarnings,['tools_unavailable']);
 const endpoint=f.worker.providerConnection('codex'),send=async(method,params)=>fetch(endpoint.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+endpoint.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...params?{params}:{}})});
 const before=f.calls.length;assert.equal((await(await send('initialize')).json()).result.serverInfo.name,'aimatterlab');
 const list=await(await send('tools/list')).json();assert.deepEqual(list.result.tools.map(t=>t.name),['list_shared_terminals']);assert.deepEqual(list.result._meta.studioWarnings,['tools_unavailable']);assert.equal(f.calls.length,before);
 assert.equal((await send('tools/call',{name:'list_shared_terminals',arguments:{}})).status,200);
 unavailable=false;assert.equal((await f.service.check({connectionId:'A',attemptId:connected.attemptId})).workflowReady,true);assert.equal(f.service.peek().warnings,undefined);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).registration.toolWarnings,undefined);
 assert.equal((await(await send('tools/list')).json()).result.tools.some(t=>t.name==='present_task'),true);
 assert.equal(f.calls.filter(c=>c.open).length,1);
});

test('an actual dispatched transport failure remains unknown and cannot be turned into inventory warning',async t=>{
 const f=connectionServiceFixture(t),original=f.connections.serviceRequest;
 f.connections.serviceRequest=async packet=>{if(packet.data?.method==='tools/list')throw Error('terminal_service_unknown');return original(packet);};
 const connected=await f.connect();assert.equal(connected.status,'unknown');assert.equal(connected.workflowReady,false);assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'unconfigured');assert.equal(f.calls.filter(c=>c.open).length,1);
});
});

await __describe("provider-cli-readiness", async () => {
const test = __node_test;
const fs = _imp_3_fs;
test('one-prompt provider verification reports a missing CLI before account/model/turn requests',async()=>{
 const calls=[],stages=[];
 await assert.rejects(verifyProviderAccess('kimi',async(method,data)=>{calls.push({method,data});return {cliRequired:{provider:'kimi',status:'missing'}};},()=>assert.fail('No model turn is authorized'),stage=>stages.push(stage)),/Selected CLI is not ready/);
 assert.deepEqual(calls,[{method:'agent.connect',data:{provider:'kimi'}}]);
 assert.deepEqual(stages,['provider_connect','provider_cli']);
});

test('optional all-provider check accepts missing bundled CLIs as blocked without downloading',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-cli-verifier-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const expressions=[],window={webContents:{executeJavaScript:async code=>{expressions.push(code);return [{provider:'kimi',status:'missing'},{provider:'qwen',status:'incompatible'}];}}};
 assert.equal(await verifyDesktop(window,root,[],{packaged:true,agentPaths:{kimi:'',qwen:''}}),false);
 const report=JSON.parse(fs.readFileSync(path.join(root,'.studio/validation/providers-desktop.json'),'utf8'));
 assert.equal(report.status,'blocked');assert.match(report.reason,/No download was started/);assert.equal(expressions.length,1);assert.match(expressions[0],/agent\.cli\.inspect/);
});
});

await __describe("run-results-recovery", async () => {
const test = __node_test;
const deferred = _imp_4_deferred;
const run={id:'r',project_id:'p',environment_id:'e',directory:'/owned/r',engine:'gpumd.md',status:'draft',name:'review',gpu:0,max_seconds:60,parameters:{},validation:{status:'not_run'},command:[],inputs:{},created_at:1};
const collect=h=>h.calls.filter(c=>c.target==='/api/run/collect');
test('review pins progress across parent cancellation and same-event double click submits only the revised run once',async()=>{
 const gate=deferred(),replaced=[],revised={...run,id:'revision'},h=harness({component:'RunReview',props:{run,onReplace:r=>replaced.push(r)},request:async target=>target.endsWith('/revise')?revised:target.endsWith('/submit')?gate.promise:{...revised,status:'queued'}});await h.flush();const button=h.button('确认并执行');button.props.onClick();button.props.onClick();await h.flush();h.render({run:{...run,status:'cancelled',superseded_by:'revision'}});await h.flush();assert(h.text().includes('正在核对输入并提交…'));assert(h.nodes().find(n=>n.props?.['data-testid']==='execute-reviewed').props.disabled);assert.equal(h.calls.filter(c=>c.target.endsWith('/revise')).length,1);gate.resolve({...revised,status:'queued',validation:{status:'not_run'}});await h.flush();assert.deepEqual(h.calls.filter(c=>c.target.endsWith('/submit')).map(c=>c.data.run_id),['revision']);assert.equal(replaced.at(-1).id,'revision');h.unmount();
});
test('leaving review while revising never starts submit or overwrites the new owner',async()=>{
 const gate=deferred(),replaced=[],h=harness({component:'RunReview',props:{run,onReplace:r=>replaced.push(r)},request:async target=>target.endsWith('/revise')?gate.promise:{...run,id:'revision',status:'queued'}});await h.flush();h.click('确认并执行');await h.flush();h.unmount();gate.resolve({...run,id:'revision',status:'ready',validation:{status:'passed'}});await h.flush();assert(!h.calls.some(c=>c.target.endsWith('/submit')));assert.equal(h.lateWrites(),0);assert.equal(replaced.length,0);
});
test('unknown submit transport keeps the revised identity available without another revision or submission',async()=>{
 const h=harness({component:'RunReview',props:{run},request:async target=>{if(target.endsWith('/revise'))return{...run,id:'revision'};throw Error('observation unavailable');}});await h.flush();h.click('确认并执行');await h.flush();assert(h.text().includes('保留原修订任务'));assert(h.nodes().some(n=>n.props?.run?.id==='revision'));assert.equal(h.calls.filter(c=>c.target.endsWith('/submit')).length,1);assert.equal(h.calls.filter(c=>c.target.endsWith('/revise')).length,1);h.unmount();
});
test('completed run refreshes an already-open empty artifact observation once',async()=>{
 let n=0;const h=harness({props:{run:{...run,status:'running'}},request:async()=>({run:'r',artifacts:n++?[{name:'final.out',size:20}]:[]})});await h.flush();h.click('结果');await h.flush();assert(h.text().includes('当前结果目录为空'));h.render({run:{...run,status:'succeeded'}});await h.flush();assert(h.text().includes('final.out'));h.render({run:{...run,status:'succeeded',updated_at:99}});await h.flush();assert.equal(collect(h).length,2);h.unmount();
});
test('terminal transition defers artifact listing until the user opens the results tab',async()=>{
 const h=harness({props:{run:{...run,status:'running'}}});await h.flush();h.render({run:{...run,status:'succeeded'}});await h.flush();assert.equal(collect(h).length,0);h.click('结果');await h.flush();assert.equal(collect(h).length,1);h.unmount();
});
test('byte-limited preview stays visibly partial in raw text and curves even below the chart row limit',async()=>{
 const h=harness({request:async target=>target.endsWith('/collect')?{run:'r',artifacts:[{name:'thermo.out',size:400000}]}:{name:'thermo.out',text:'0 300\n1 310',offset:262144,size:400000}});await h.flush();h.click('结果');await h.flush();h.nodes().find(n=>n.type==='button'&&h.text(n).startsWith('thermo.out')).props.onClick();await h.flush();assert(h.text().includes('曲线不代表完整结果'));h.click('曲线');await h.flush();assert(h.text().includes('曲线不代表完整结果'));assert(h.text().includes('400,000'));h.unmount();
});
test('terminal logs drain several chunks through EOF then stop; active logs retain bounded scheduling',async()=>{
 const offsets=[],size=3*262144+12;const h=harness({observeLogs:true,props:{run:{...run,status:'succeeded'}},request:async(target,{offset})=>{assert.equal(target,'/api/run/log');offsets.push(offset);const count=Math.min(262144,size-offset);return{offset:offset+count,text:'x'.repeat(count)};}});await h.flush();assert.deepEqual(offsets,[0,262144,524288,786432,size]);assert.equal(h.timers.size,0);assert(h.text().includes('xxx'));h.unmount();
 const active=harness({observeLogs:true,props:{run:{...run,status:'running'}},request:async(target,{offset})=>({offset:offset+262144,text:'x'.repeat(262144)})});await active.flush();assert.equal(active.calls.length,8);assert.equal(active.timers.size,1);active.unmount();assert.equal(active.timers.size,0);
});
test('pending log reads do not continue chasing an unmounted run',async()=>{
 const gate=deferred(),h=harness({observeLogs:true,request:()=>gate.promise});await h.flush();h.unmount();gate.resolve({offset:262144,text:'x'.repeat(262144)});await h.flush();assert.equal(h.calls.length,1);assert.equal(h.lateWrites(),0);
});
test('corrupt continuation record remains visible until explicit acknowledgement and never creates a request while clearing',async()=>{
 const storage=memoryStorage();storage.setItem('studio.resume.r','corrupt-original');const h=harness({storage});await h.flush();assert(h.button('续算').props.disabled);assert(h.text().includes('corrupt-original'));h.click('已核对，清除损坏记录');await h.flush();assert(h.text().includes('我已核对现有作业和草稿'));h.nodes().find(n=>n.type==='button'&&n.props?.className==='button'&&h.text(n)==='取消').props.onClick();await h.flush();assert.equal(storage.getItem('studio.resume.r'),'corrupt-original');h.click('已核对，清除损坏记录');await h.flush();h.nodes().find(n=>n.type==='button'&&n.props?.className==='button danger'&&h.text(n)==='已核对，清除损坏记录').props.onClick();await h.flush();assert.equal(storage.getItem('studio.resume.r'),null);assert(!h.button('续算').props.disabled);assert(!h.calls.some(c=>c.target==='/api/run/resume'));h.unmount();
});
test('unknown runs expose only an explicit reconciliation request and show worker cancellation feedback',async()=>{
 const h=harness({props:{run:{...run,status:'unknown'}},request:async target=>target.endsWith('/reconcile')?{...run,status:'unknown',reconciliation:{status:'blocked',message:'Launch evidence is insufficient'}}:{...run,status:'unknown',cancellation:{status:'unconfirmed',message:'Cancellation preserved; no signal sent'}}});await h.flush();assert.equal(h.calls.length,0);h.click('核对停止状态');await h.flush();assert(h.text().includes('Launch evidence is insufficient'));h.click('取消');await h.flush();assert(h.text().includes('Cancellation preserved; no signal sent'));assert(!h.calls.some(c=>/submit|resume|revise/.test(c.target)));h.unmount();
});
});

await __describe("runtime-guide-privacy", async () => {
const test = __node_test;
const {WorkerClient}=await import(pathToFileURL(path.resolve("agent/tools/worker-client.mjs"))),{createPrivateCvAccess}=await import(pathToFileURL(path.resolve("agent/tools/private-cv-access.mjs")));
function facts(){return{schema_version:1,environment_id:'selected',engine:'pydyn.sampling',configuration_sha256:'c'.repeat(64),state:'observed',observed_at:1,python:{executable:'/registered/python',version:'3.synthetic',registration_match:true},executables:{python:'/registered/python'},modules:{pydyn:{file:'/public/.codex/worktrees/synthetic/pydyn/pydyn/__init__.py',version:'0.1',source_sha256:'a'.repeat(64),status:'passed',registration_match:true}},repositories:{pydyn:{path:'/public/.codex/worktrees/synthetic/pydyn',commit:null,dirty:null,status:'not_run'}},capabilities:{pygas:{},pydyn_sampling:{available:true,origin:'/public/.codex/worktrees/synthetic/pydyn/pydyn/sampling/__init__.py',upstream:{commit:'b'.repeat(40),version:'v1'}}},native_runtime:{status:'not_run',scope:'No native check'},scientific_status:'not_run'};}
function projected(value){const p=process.env.STUDIO_PROJECTION_MODULE||'backend/worker/studio_worker/transport/runtime_projection.py';const code=`import sys,json,hashlib,importlib.util,copy\np=${JSON.stringify(p)}\nspec=importlib.util.spec_from_file_location('owned_projection',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nf=json.load(sys.stdin);raw={'status':f['state'],'facts':f,'receipt':hashlib.sha256((json.dumps(f,ensure_ascii=False,indent=2)+'\\n').encode()).hexdigest(),'skill_sha256':'e'*64};before=copy.deepcopy(raw)\nv=m.result_for_agent('read_runtime_guide',raw,{'environment_id':'selected','engine':'pydyn.sampling'})\nassert raw==before\nprint(json.dumps(v))`;const r=spawnSync('python',['-B','-c',code],{input:JSON.stringify(value),encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
async function throughMain(value,{provider='codex',name='read_runtime_guide',policy={blocked_project_ids:[],blocked_run_ids:[],blocked_paths:[],bindings:[]}}={}){const task={id:'task',provider,threadId:'thread',projectId:'project',authoring:{projectId:'project',environmentId:'author',inputRoot:'/owned/inputs'},parameters:{engine:'pydyn.sampling',files:[]},artifacts:[]},before=structuredClone(task),forwarded=[],writes=[];const upstream=http.createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw||'{}');res.setHeader('Content-Type','application/json');if(req.url==='/api/custom-cv/access')return res.end(JSON.stringify(policy));forwarded.push({path:req.url,body});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{isError:false,content:[{type:'text',text:JSON.stringify(value)}]}}));});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const w=new WorkerClient();w.upstream='http://127.0.0.1:'+upstream.address().port;w.connection={url:w.upstream,tokens:{admin:'synthetic-admin',mcp:'synthetic-mcp'}};w.setAuthoringGuard(createPrivateCvAccess({records:{read:()=>structuredClone(task),bound:()=>({id:'task'}),deleted:()=>false,save:()=>writes.push('task')},worker:w,activeTasks:new Map([[provider,'task']])}));await w.exposeTools({});try{const scope=w.providerConnection(provider),response=await fetch(scope.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+scope.tokens.mcp},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:name==='read_runtime_guide'?{environment_id:'selected',engine:'pydyn.sampling'}:{project_id:'project',name:'/owned/inputs/ordinary.txt'}}})});const envelope=await response.json();assert.deepEqual(task,before);assert.deepEqual(writes,[]);return{result:JSON.parse(envelope.result.content[0].text),isError:envelope.result.isError,forwarded};}finally{w.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}}
await test('unprojected protected source metadata remains rejected by actual main guard',async()=>{const r=await throughMain({status:'observed',facts:facts(),receipt:'f'.repeat(64)});assert.equal(r.isError,true);assert.match(r.result.message,/protected private paths/);assert.equal(r.forwarded.length,1);});
await test('candidate projection traverses actual main MCP afterguard without path exemption or task writes',async()=>{const value=projected(facts()),r=await throughMain(value);assert.equal(r.isError,false);assert.equal(r.result.status,'observed');assert.equal(r.result.receipt,value.receipt);assert.equal(r.result.facts.repositories.pydyn.commit,null);assert(!JSON.stringify(r.result).includes('.codex'));assert.equal(r.forwarded.length,1);});
for(const change of[f=>f.executables.python='/protected/.ssh/key',f=>f.native_runtime.scope='/protected/custom-cv-library/entry'])await test('other known protected guide fields remain rejected '+String(change),async()=>{const f=facts();change(f);const r=await throughMain(projected(f));assert.equal(r.isError,true);assert.match(r.result.message,/protected private paths/);});
await test('other scientific tools retain protected-path rejection',async()=>{const r=await throughMain({path:'/protected/custom-cv-library/entry/value.json'},{name:'read_project_input'});assert.equal(r.isError,true);assert.match(r.result.message,/protected private paths/);});
await test('unshared current project rejects before forwarding even sanitized view',async()=>{const r=await throughMain(projected(facts()),{policy:{blocked_project_ids:['project'],blocked_run_ids:[],blocked_paths:[],bindings:[]}});assert.equal(r.isError,true);assert.match(r.result.message,/sharing/);assert.equal(r.forwarded.length,0);});
await test('DeepSeek target differing from authoring stays denied before forward',async()=>{const r=await throughMain(projected(facts()),{provider:'deepseek'});assert.equal(r.isError,true);assert.match(r.result.message,/current workflow environment/);assert.equal(r.forwarded.length,0);});
});

await __describe("runtime-transport", async () => {
const test = __node_test;
const WorkerClient = _imp_2_WorkerClient;
const fixture = _imp_5_fixture;
const route='/api/run/environment-identity';
test('Internal exact POST allowed; generic renderer variants and non-POST are denied',()=>{assert.doesNotThrow(()=>assertWorkerRoute('POST',route));for(const path of [route,route+'?run_id=foreign',route+'/',route+'#hash'])assert.throws(()=>assertRendererWorkerRoute('POST',path),/main-owned|Unsupported|Ambiguous/);assert.throws(()=>assertWorkerRoute('GET',route),/Unsupported/);});
async function connected(t){const f=fixture(),calls=[],w=new WorkerClient(),state={serial:1},receipts=new Map();const server=http.createServer(async(req,res)=>{try{assert.equal(req.headers.authorization,'Bearer synthetic-admin');let bytes='';for await(const part of req)bytes+=part;const data=JSON.parse(bytes||'{}');calls.push({method:req.method,path:req.url,data});const result=await f.worker.request(req.method,req.url,data);if(req.url===route&&state.switchOnIdentity)state.serial++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));}catch(e){res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:String(e)}));}});await new Promise(r=>server.listen(0,'127.0.0.1',r));w.upstream='http://127.0.0.1:'+server.address().port;w.connection={url:w.upstream,tokens:{admin:'synthetic-admin',mcp:'synthetic-unused'}};t.after(async()=>{w.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 const api=createTaskLocalReview({records:f.records,worker:w,current:()=>({provider:'codex',threadId:'thread',taskId:'task',projectId:'authoring',environmentId:'env',inputRoot:'/worker/projects/authoring/inputs',serial:state.serial}),assertHuman:()=>true,confirm:async()=>true,receiptStore:{get:id=>clone(receipts.get(id)),put:(id,v)=>receipts.set(id,clone(v))}});return {f,w,api,calls,state};}
test('Actual WorkerClient request reaches localhost admin identity route with only opaque run_id',async t=>{const {f,w,calls}=await connected(t),value=await w.request('POST',route,{run_id:'synthetic-run'});assert.equal(value.configuration_sha256,f.runtime.facts.configuration_sha256);assert.deepEqual(calls,[{method:'POST',path:route,data:{run_id:'synthetic-run'}}]);});
async function approved(f,api){const view=await api.inspect({taskId:'task'},{});for(const e of view.entries)await api.read({taskId:'task',snapshotId:view.snapshotId,entryId:e.id},{});await api.confirm({taskId:'task',snapshotId:view.snapshotId},{});const {data}=await api.verify('task'),config={target:'local',targetId:'env',projectId:'authoring',inputSource:'local'},run={id:'run',engine:data.engine,project_id:'authoring',environment_id:'env',environment_snapshot:clone(f.environment),status:'draft',validation:{status:'not_run'},parameters:data.spec.parameters,inputs:data.spec.inputs,snapshots:data.entries.map(e=>({name:e.name,source:e.path,size:e.size,sha256:e.sha256})),private_cv_versions:[]};return {data,config,run};}
test('Actual review factory + real WorkerClient guarded verifyPrepared completes through internal allowlist',async t=>{const {f,api,calls}=await connected(t),{data,config,run}=await approved(f,api),value=await api.verifyPrepared('task',run,config,data.spec.inputs);assert.equal(value.authority.kind,'local-human');assert.deepEqual(calls.filter(c=>c.path===route),[{method:'POST',path:route,data:{run_id:'run'}}]);});
test('Real transport final owner change holds the prepared result after identity response',async t=>{const {f,api,state,calls}=await connected(t),{data,config,run}=await approved(f,api);state.switchOnIdentity=true;await assert.rejects(api.verifyPrepared('task',run,config,data.spec.inputs),/changed/);assert.equal(calls.filter(c=>c.path===route).length,1);assert.equal(f.task().deployment?.prepared,undefined);});
});

await __describe("service-environment-launch", async () => {
const test = __node_test;
const nonce='a'.repeat(64),command="python3 -I -u -c 'fixed fixture' '"+nonce+"'";
const shell=process.platform==='win32'?process.env.STUDIO_TEST_WSL?script=>spawnSync((process.env.SystemRoot||'C:\\Windows')+'\\System32\\wsl.exe',['--distribution',process.env.STUDIO_TEST_WSL,'--exec','/bin/sh','-s'],{input:script,encoding:'utf8',windowsHide:true,timeout:15000}):null:script=>spawnSync('/bin/sh',['-s'],{input:script,encoding:'utf8',timeout:15000});
test('default profiles retain their existing exact launch command',()=>assert.equal(serviceLaunch(command,nonce),command+'\r'));
test('saved recipe inputs are bounded and never become unquoted executable selectors',()=>{
 for(const value of [null,{python:'python3',activation:'x\0y'},{python:'python3\nother',activation:''},{python:'python3',activation:'x'.repeat(8193)},{python:'relative/path',activation:''}])assert.throws(()=>validateServiceEnvironment(value));
 const lines=serviceLaunch(command,nonce,{python:'/owned/environment with space/bin/python',activation:('# line\n'.repeat(900))}).split('\r');assert(lines.length>10);assert(lines.every(line=>Buffer.byteLength(line)<2048));assert(!lines.some(line=>line.includes('__STUDIO_SERVICE_V1__:'+nonce+':')));
 const quotes=serviceLaunch(command,nonce,{python:'python3',activation:"'".repeat(8000)});assert(quotes.split('\r').every(line=>Buffer.byteLength(line)<2048));
});
function run(script){const result=shell(script);assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);return result.stdout;}
function errors(text){return text.replaceAll('\x1b[2J\x1b[3J\x1b[H','').split(/\r?\n/).filter(line=>line.startsWith('__STUDIO_SERVICE_V1__:'+nonce+':')).map(line=>{const fields=line.split(':');return {kind:fields[2],value:JSON.parse(Buffer.from(fields[4],'base64'))};});}
test('real POSIX shell activates long multiline recipe and selects the exact spaced interpreter',{skip:!shell},()=>{
 const dir='/tmp/studio-service-launch-'+randomUUID(),python=dir+'/selected python';
 const setup='task_dir='+JSON.stringify(dir)+'\nmkdir "$task_dir"\ntrap \'rm -rf -- "$task_dir"\' EXIT\ncat > "$task_dir/selected python" <<\'PY\'\n#!/bin/sh\nprintf "ACTIVATED:%s\\n" "$STUDIO_TEST_MARKER"\nPY\nchmod 700 "$task_dir/selected python"\n';
 const script=serviceLaunch(command,nonce,{python,activation:'# unchanged fixture\n'.repeat(300)+'export STUDIO_TEST_MARKER=expected_中文_😀'}).replaceAll('\r','\n');
 assert.equal(run(setup+script).trim(),'ACTIVATED:expected_中文_😀');
});
test('real shell activation failure returns exact authenticated error and exit barriers',{skip:!shell},()=>{
 const text=run(serviceLaunch(command,nonce,{python:'/missing/python',activation:'false'}).replaceAll('\r','\n'));
 assert.deepEqual(errors(text),[{kind:'ERROR',value:{code:'environment_activation_failed',phase:'preparing_environment'}},{kind:'EXITED',value:{reason:'failed'}}]);
});
test('real shell missing interpreter reports Python startup failure without evaluating its path',{skip:!shell},()=>{
 const text=run(serviceLaunch(command,nonce,{python:'/missing/$(printf INJECTED)',activation:''}).replaceAll('\r','\n'));
 assert(!text.includes('INJECTED'));assert.deepEqual(errors(text),[{kind:'ERROR',value:{code:'python_start_failed',phase:'waiting_python'}},{kind:'EXITED',value:{reason:'failed'}}]);
});
});

await __describe("ssh-service-grant-races", async () => {
const test = __node_test;
const fs = _imp_3_fs;
const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8'),tree=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function guard(ports){let callback;function visit(node){if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='setResourceUseGuard')callback=node.arguments[0].getText(tree);ts.forEachChild(node,visit);}visit(tree);assert(callback);return new Function(...Object.keys(ports),'return ('+callback+');')(...Object.values(ports));}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const callerContext=v=>Object.fromEntries(['threadId','taskId','projectId','environmentId','inputRoot'].map(k=>[k,v[k]??null]));
async function fixture(t){
 const f=connectionServiceFixture(t);let local=0,shellCalls=0,shellGrant=false;await f.connect();
 const computeResource={peek:()=>({schemaVersion:2,kind:'ssh-connection',connectionId:'A',profileId:'profile-A',profileVersion:1})};
 f.worker.setResourceUseGuard(guard({computeResource,sshService:f.service,worker:f.worker,sharedTerminal:{connections:f.connections,hasCurrentGrant:()=>shellGrant}}));
 f.worker.setLocalTools([{name:'fixture_local'},{name:'read_shared_terminal'}],async name=>{if(name==='read_shared_terminal')shellCalls++;else local++;return {owned:true};});
 const bind=()=>{f.worker.bindProviderContext('codex',callerContext(f.current()));return f.worker.providerConnection('codex');};let endpoint=bind();
 const request=async(name='fixture_local',connection=endpoint)=>{const r=await fetch(connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+connection.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}})});await r.text();return r.status;};
 return {...f,request,endpoint:()=>endpoint,bind:()=>{endpoint=bind();return endpoint;},grant:()=>{const v=f.grant();endpoint=bind();return v;},shellGrant:v=>{shellGrant=v;},counts:()=>({local,shellCalls})};
}
test('actual main guard denies science before service grant and denies shell before its independent grant',async t=>{const f=await fixture(t);assert.equal(await f.request(),403);f.grant();assert.equal(await f.request(),200);assert.equal(await f.request('read_shared_terminal'),403);f.shellGrant(true);assert.equal(await f.request('read_shared_terminal'),200);assert.deepEqual(f.counts(),{local:1,shellCalls:1});});
test('human service reclaim leaves shell grant intact while old combined caller lease is expired',async t=>{const f=await fixture(t);f.grant();f.shellGrant(true);const old=f.endpoint();f.service.owner({connectionId:'A',attemptId:'attempt-A',owner:'human'});assert.equal(await f.request('fixture_local',old),403);f.bind();assert.equal(await f.request(),403);assert.equal(await f.request('read_shared_terminal'),200);});
test('a late remote tool response after service reclaim is discarded and cannot restore authority',async t=>{const f=await fixture(t);f.grant();const gate=deferred(),entered=deferred(),request=f.connections.serviceRequest;f.connections.serviceRequest=async packet=>{if(packet.data?.method==='tools/call'){entered.resolve();await gate.promise;}return request(packet);};const pending=f.request('remote_read');await entered.promise;f.service.owner({connectionId:'A',attemptId:'attempt-A',owner:'human'});gate.resolve();assert.equal(await pending,403);assert.equal(f.service.hasCurrentGrant('codex'),false);});
test('another thread or authoring context cannot borrow the selected service grant',async t=>{const f=await fixture(t);f.grant();const original=f.current();for(const patch of [{threadId:'other'},{taskId:'other'},{projectId:'other'},{environmentId:'other'},{inputRoot:'/other'}]){f.worker.bindProviderContext('codex',callerContext({...original,...patch}));assert.equal(await f.request('fixture_local',f.worker.providerConnection('codex')),403);}assert.equal(f.counts().local,0);});
test('base authentication loss rejects the tool before dispatch and reports service unknown without a close',async t=>{const f=await fixture(t);f.grant();f.bases.get('A').authentication='lost';f.bases.get('A').status='unavailable';assert.equal(await f.request(),403);assert.equal(f.service.peek().status,'unknown');assert.equal(f.worker.connection,null);assert(!f.calls.some(v=>v.close));assert.equal(f.counts().local,0);});
test('async base proof cannot outlive a human service reclaim',async t=>{const f=await fixture(t);f.grant();const gate=deferred(),entered=deferred(),state=f.connections.state;f.connections.state=async packet=>{entered.resolve();await gate.promise;return state(packet);};const pending=f.request();await entered.promise;f.service.owner({connectionId:'A',attemptId:'attempt-A',owner:'human'});gate.resolve();assert.equal(await pending,403);assert.equal(f.counts().local,0);});

test('a cancelled status observation during conversation replacement cannot mark the live service unknown or restore a grant',async t=>{
 const f=await fixture(t);const gate=deferred(),entered=deferred(),state=f.connections.serviceState,connection=f.worker.connection;
 f.connections.serviceState=async()=>{entered.resolve();await gate.promise;throw Error('terminal_context_changed');};
 const pending=f.service.status();await entered.promise;f.setCurrent({...f.current(),threadId:'replacement'});f.service.reconcileContext();gate.resolve();await pending;
 assert.equal(f.service.peek().status,'connected');assert.equal(f.service.peek().workflowReady,true);assert.equal(f.worker.connection,connection);assert.equal(f.service.hasCurrentGrant('codex'),false);
 f.connections.serviceState=state;assert.equal((await f.service.status()).status,'connected');assert.equal(await f.request(),403);
});

for(const code of ['terminal_scope_denied','terminal_context_changed'])test('a local read refusal does not fabricate remote service failure: '+code,async t=>{
 const f=await fixture(t),connection=f.worker.connection,request=f.connections.serviceRequest;
 f.connections.serviceRequest=async()=>{throw Error(code);};
 await assert.rejects(f.worker.request('GET','/api/health'),new RegExp(code));assert.equal(f.service.peek().status,'connected');assert.equal(f.service.peek().workflowReady,true);assert.equal(f.worker.connection,connection);assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(await f.request(),403);
 f.connections.serviceRequest=request;await f.worker.request('GET','/api/health');assert.equal(f.service.peek().status,'connected');
});
test('a late health check after service disconnect does not update registration or revive the old grant',async t=>{const f=await fixture(t);f.grant();const saved=f.registration.read({profileId:'profile-A',profileVersion:1}).registration,gate=f.delayHealth(),pending=f.service.check({connectionId:'A',attemptId:'attempt-A'});await gate.started;await f.service.disconnect({connectionId:'A',attemptId:'attempt-A'});gate.release();await pending;assert.equal(f.service.peek().status,'disconnected');assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).registration.revision,saved.revision);assert.equal(f.service.hasCurrentGrant('codex'),false);});
test('a late old check cannot revoke a replacement service instance on the same authenticated connection',async t=>{const f=await fixture(t);f.grant();const gate=f.delayHealth(),pending=f.service.check({connectionId:'A',attemptId:'attempt-A'});await gate.started;await f.service.disconnect({connectionId:'A',attemptId:'attempt-A'});await f.connect('A','reuse','replacement');f.grant();const active=f.worker.connection;gate.release();await pending;assert.equal(f.service.peek().attemptId,'replacement');assert.equal(f.worker.connection,active);assert.equal(f.service.hasCurrentGrant('codex'),true);assert.equal(await f.request(),200);});
});

await __describe("ssh-service-registration-flow", async () => {
const test = __node_test;
const fs = _imp_3_fs;
const WorkerClient = _imp_2_WorkerClient;
test('disk registration survives a new authenticated connection without copying any old service grant or bootstrap intent',async t=>{
 const base=path.resolve('.studio/ssh-connection-registration-tests');fs.mkdirSync(base,{recursive:true});const folder=fs.mkdtempSync(path.join(base,'owned-'));
 const profile={id:'profile',version:1,kind:'ssh',mode:'interactive',host:'fixture.invalid',username:'fixture',port:22,ssh_client:'/inert/ssh'},profiles={read:()=>structuredClone(profile),list:()=>[profile]},health={name:'gpu-sampling-studio',root:'/inert/service',runtime:'/inert/runtime/'+'a'.repeat(20),runtimeId:'a'.repeat(20),port:23456,execution_policy:'desktop-review-v1',hostIdentity:{hostname:'inert-host',uid:1000,machineId:'inert-machine'}};
 const calls=[],prepared=[],channels=new Map(),worker=new WorkerClient(),context={provider:'codex',threadId:'chat',taskId:'task',projectId:'project',environmentId:'environment',inputRoot:'/inert/input'};
 let selection={schemaVersion:2,kind:'ssh-connection',connectionId:'login-one',selectionId:'selection-one',profileId:profile.id,profileVersion:1},revision=1,catalog=new Catalog(folder),failNext=false;
 const resource={peek:()=>structuredClone(selection),capture:()=>({revision,selection:structuredClone(selection)}),assertCurrent:ticket=>{assert.equal(ticket.revision,revision);assert.deepEqual(ticket.selection,selection);}};
 const connections={state:async({connectionId})=>({schemaVersion:2,status:'authenticated',authentication:'verified',connectionId,profileId:'profile',profileVersion:1}),openService:async(data,bootstrap)=>{calls.push({data,bootstrap});const view={...data,attemptId:data.requestId,serviceId:'service-'+data.requestId,status:'connected',serviceActive:true,service:health};channels.set(data.connectionId,view);return view;},serviceState:async({connectionId})=>structuredClone(channels.get(connectionId)),closeService:async({connectionId})=>({...channels.get(connectionId),status:'disconnected',serviceActive:false}),serviceRequest:async packet=>{assert.equal(packet.serviceId,channels.get(packet.connectionId).serviceId);if(failNext){failNext=false;throw Error('service_response_unknown');}return {status:200,data:packet.target==='/api/health'?health:{jsonrpc:'2.0',id:packet.data?.id,result:{tools:[{name:'present_task',inputSchema:{type:'object'}}]}}};}};
 const registry=()=>createSshServiceRegistration({catalog,profiles}),make=registration=>createSshService({worker,connections,profiles,resource,registration,current:()=>context,source:'/inert/source',transportSource:'/inert/transport',prepareResources:async(_source,options)=>{prepared.push(options);return {source:'inert',transport:{source:'inert'},payload:{expected_runtime_id:options.expectedRuntimeId||health.runtimeId}};}});
 let registration=registry(),service=make(registration);t.after(()=>{worker.close();catalog.db.close();});
 const connect=(requestId,mode)=>service.connect({connectionId:selection.connectionId,profileId:'profile',profileVersion:1,requestId,mode}),grant=()=>{const s=service.peek();service.owner({connectionId:s.connectionId,attemptId:s.attemptId,owner:'agent',scope:context});};
 await connect('first-setup','setup');assert.equal(service.peek().operator,'human');grant();assert.equal(service.hasCurrentGrant('codex'),true);const saved=registration.read({profileId:'profile',profileVersion:1}).registration;
 for(const text of ['login-one','first-setup','service-first-setup','chat'])assert(!JSON.stringify(saved).includes(text));
 service.connectionClosed('login-one');worker.close();catalog.db.close();catalog=new Catalog(folder);selection={...selection,connectionId:'login-two',selectionId:'selection-two'};revision++;
 registration=registry();service=make(registration);assert.equal(registration.read({profileId:'profile',profileVersion:1}).status,'configured');assert.equal(service.peek().status,'disconnected');
 await connect('daily-explicit-attach','reuse');assert.equal(service.peek().workflowReady,true);assert.equal(service.hasCurrentGrant('codex'),false);assert.equal(calls.length,2);assert.equal(calls[1].bootstrap.reuseOnly,true);assert.equal(prepared[1].expectedRuntimeId,saved.runtimeId);assert.equal(prepared[1].port,saved.port);assert.equal(calls[1].data.connectionId,'login-two');grant();
 let attempts=0;const request=connections.serviceRequest;connections.serviceRequest=async packet=>{if(packet.target==='/api/workspace/read')attempts++;return request(packet);};failNext=true;await assert.rejects(worker.request('POST','/api/workspace/read',{fixture:true}),/response_unknown/);assert.equal(attempts,1);assert.equal(service.peek().status,'unknown');assert.equal(service.hasCurrentGrant('codex'),false);await assert.rejects(connect('unsafe-auto-repeat','reuse'),/channel_in_use/);assert.equal(calls.length,2);assert.equal(registration.read({profileId:'profile',profileVersion:1}).status,'configured');
});
});

await __describe("ssh-task-authoring", async () => {
const test = __node_test;
const identity={kind:'ssh',version:2,profileId:'owned-profile',profileVersion:1,hostIdentity:{hostname:'fixture',uid:1000,machineId:'fixture'},root:'/owned',runtime:'/owned/runtime',runtimeId:'a'.repeat(20)};
function fixture(){const task={id:'task',provider:'codex',threadId:'thread',name:'Owned input review',parameters:{},steps:[]},calls=[];const worker={identity,connection:{health:{ssh_service:true,root:identity.root,runtime:identity.runtime,hostIdentity:identity.hostIdentity}},connectionTarget:{sessionId:'fixture'},request:async(...args)=>{calls.push(args);throw Error('owned remote input reached');}};return {task,calls,worker,records:{read:()=>task,bound:()=>task,deleted:()=>false,conversation:()=>({})}};}
 for(const name of ['model.XYZ','model.ckpt','energy.out','POSCAR'])test('SSH authoring keeps explicit Windows '+name+' out of the remote read request',async()=>{const f=fixture();await assert.rejects(ensureTaskAuthoring(f.records,f.worker,{provider:'codex',threadId:'thread',text:'使用 "C:\\owned inputs\\'+name+'"'}),/owned remote input reached/);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0][2].structure_paths,[]);assert.deepEqual(f.calls[0][2].selected_paths,[]);});
test('SSH authoring keeps a server path for the actual remote workspace request',async()=>{const f=fixture();await assert.rejects(ensureTaskAuthoring(f.records,f.worker,{provider:'codex',threadId:'thread',text:'使用 /home/owned/model.xyz'}),/owned remote input reached/);assert.deepEqual(f.calls[0][2].structure_paths,['/home/owned/model.xyz']);assert.deepEqual(f.calls[0][2].selected_paths,['/home/owned/model.xyz']);});
});

await __describe("task-stage-ipc", async () => {
const test = __node_test;
const fs = _imp_3_fs;
function handlers(){const f=stageFixture(),map=new Map();registerTaskStage({records:f.records,worker:f.worker,current:f.current,assertHuman:e=>e?.trusted===true,handle:(name,fn)=>map.set(name,fn)});return {f,map};}
test('Exact typed stage channels are human-only and absent from MCP/renderer worker namespace',()=>{const {map}=handlers();assert.deepEqual([...map.keys()],['task.stage.inspect','task.stage.save']);for(const n of map.keys())assert.equal(Object.hasOwn(SCIENTIFIC_TOOL_ACCESS,n),false);for(const route of ['/api/task/stage/save','/api/stage/inspect'])assert.throws(()=>assertRendererWorkerRoute('POST',route),/Unsupported/);});
for(const method of ['inspect','save'])test('Actual registry rejects untrusted '+method+' before worker dispatch',async()=>{const {f,map}=handlers();await assert.rejects(map.get('task.stage.'+method)({taskId:'task',...(method==='save'?{inspectionId:'fake',engine:'pygas.build',values:{}}:{})},{trusted:false}),/Trusted human/);assert.equal(f.calls.length,0);});
test('Actual preload exposes stage inspect/save only; preserves exact request envelope',async()=>{let api;const calls=[];vm.runInNewContext(fs.readFileSync(new URL("../../desktop/preload.cjs",import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_,v)=>api=v},ipcRenderer:{invoke:async(...args)=>calls.push(args),on(){},removeListener(){}}})});for(const name of ['inspect','save'])await api.invoke('task.stage.'+name,{taskId:'task'});assert.deepEqual(calls.map(x=>x[0]),['studio:task.stage.inspect','studio:task.stage.save']);await assert.rejects(api.invoke('task.stage.execute',{}),/Unsupported/);});
test('Generic edit cannot forge main-owned stage or local-review metadata',()=>{const {f}=handlers(),values=new Map(),catalog={get:(kind,id)=>values.get(kind+':'+id),put:(kind,id,v)=>values.set(kind+':'+id,structuredClone(v)),list:kind=>[...values].filter(([k])=>k.startsWith(kind+':')).map(([,v])=>structuredClone(v))};catalog.put('agent-task','task',f.task());const records=new TaskRecords(catalog,()=>{});records.edit({id:'task',changes:{stageConfiguration:{origin:'human-source-contract',engine:'pygas.build'},localInputReview:{status:'confirmed',receiptId:'forged'}}});assert.equal(records.read('task').stageConfiguration,undefined);assert.equal(records.read('task').localInputReview,undefined);assert.equal(records.read('task').parameters.stageConfiguration.origin,'human-source-contract');assert.equal(f.receipts.size,0);});
for(const field of ['engine','files','review','authoring','deployment','receiptId','provider','path'])test('Stage save never accepts undeclared top-level '+field+' mutation',async()=>{const {f,map}=handlers(),v=await map.get('task.stage.inspect')({taskId:'task'},{trusted:true}),args={taskId:'task',inspectionId:v.inspectionId,engine:'pygas.build',values:v.values};if(field==='engine')args.engine='gpumd.sampling';else args[field]='forged';await assert.rejects(map.get('task.stage.save')(args,{trusted:true}),/typed stage|declared canonical/);assert.equal(f.task().parameters.engine,'');});
});

await __describe("windows-save-as", async () => {
const test = __node_test;
const fs = _imp_3_fs;
function fixture(t,choose){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-save-as-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const original=path.join(root,'opened.txt'),project=path.join(root,'project-copy.txt'),destination=path.join(root,'chosen.txt');fs.writeFileSync(original,'original Windows bytes');fs.writeFileSync(project,'project copy');
 const grants=new Map([['old-grant',original]]),dialogs=[],writes=[];
 const save=createWindowsSaveAs({grants,choose:async options=>{dialogs.push(options);return choose?choose({destination,root}):{canceled:false,filePath:destination};},write:(file,content)=>{writes.push(file);fs.writeFileSync(file,content,'utf8');},uuid:()=> 'new-grant'});
 return {save,grants,dialogs,writes,original,project,destination};
}
test('old open grant and renamed/project-saved input never choose the original Windows target',async t=>{
 const f=fixture(t),result=await f.save({id:'old-grant',name:'project-copy.txt',content:'new editor content'});
 assert.equal(f.dialogs.length,1);assert.equal(f.dialogs[0].defaultPath,'project-copy.txt');assert.deepEqual(f.writes,[f.destination]);
 assert.equal(fs.readFileSync(f.original,'utf8'),'original Windows bytes');assert.equal(fs.readFileSync(f.project,'utf8'),'project copy');assert.equal(fs.readFileSync(f.destination,'utf8'),'new editor content');
 assert.deepEqual(result,{id:'new-grant',path:f.destination,name:'chosen.txt'});assert.equal(f.grants.get('old-grant'),f.original);assert.equal(f.grants.get('new-grant'),f.destination);
});
test('cancel keeps old grant/files and returns no replacement state',async t=>{
 const f=fixture(t,()=>({canceled:true,filePath:'ignored'})),before=[...f.grants];assert.equal(await f.save({id:'old-grant',name:'copy.txt',content:'not written'}),null);
 assert.deepEqual(f.writes,[]);assert.deepEqual([...f.grants],before);assert.equal(fs.readFileSync(f.original,'utf8'),'original Windows bytes');assert(!fs.existsSync(f.destination));
});
test('actual filesystem write failure returns no grant/success receipt',async t=>{
 const f=fixture(t,({root})=>({canceled:false,filePath:path.join(root,'missing-parent','file.txt')})),before=[...f.grants];
 await assert.rejects(f.save({id:'old-grant',content:'write must fail'}),/ENOENT/);assert.deepEqual([...f.grants],before);assert.equal(fs.readFileSync(f.original,'utf8'),'original Windows bytes');
});
test('invalid content and original 2MiB bound fail before dialog, grant or write',async t=>{
 const f=fixture(t);for(const content of [undefined,null,12,{},'x'.repeat(2*1024*1024+1)])await assert.rejects(f.save({id:'old-grant',content}),/2 MiB/);
 assert.deepEqual(f.dialogs,[]);assert.deepEqual(f.writes,[]);assert.equal(f.grants.size,1);
 const boundary='x'.repeat(2*1024*1024);await f.save({content:boundary});assert.equal(fs.statSync(f.destination).size,boundary.length);
});
test('ungranted editor uses same picker; picker failure/empty destination cannot create a grant',async t=>{
 const f=fixture(t);assert.equal((await f.save({content:'fresh'})).path,f.destination);assert.equal(f.dialogs[0].defaultPath,'workflow.py');
 const grants=new Map();const invalid=createWindowsSaveAs({grants,choose:async()=>({canceled:false}),write:()=>assert.fail('no write')});await assert.rejects(invalid({content:'x'}),/destination/);assert.equal(grants.size,0);
 const rejected=createWindowsSaveAs({grants,choose:async()=>{throw Error('picker failed');},write:()=>assert.fail('no write')});await assert.rejects(rejected({content:'x'}),/picker failed/);assert.equal(grants.size,0);
});
});
