import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {WorkerClient} from '../../agent/tools/worker-client.mjs';
import {createSshService} from '../../backend/main/compute/ssh-service.mjs';

const health={name:'gpu-sampling-studio',root:'/owned/service',runtime:'/owned/runtimes/'+ 'a'.repeat(20),runtimeId:'a'.repeat(20),port:23456,execution_policy:'desktop-review-v1',hostIdentity:{hostname:'owned-fixture',uid:1000,machineId:'owned-fixture-machine'}};
const intent=which=>({sessionId:'session-'+which,ownerEpoch:1,profileId:'profile-'+which,profileVersion:1,requestId:'connect-'+which});
const selection=value=>({kind:'ssh-terminal',sessionId:value.sessionId,profileId:value.profileId,profileVersion:value.profileVersion});
function fixture(t){
 const worker=new WorkerClient(),calls=[];t.after(()=>worker.close());let selected=selection(intent('A')),revision=0,available=true;
 const terminal={connectService:async value=>{calls.push({operation:'connect',value});return {serviceId:'lease-'+value.sessionId,service:health};},
  serviceRequest:async value=>{calls.push({operation:'request',value});return value.target==='/api/health'?{status:200,data:health}:{status:200,data:{jsonrpc:'2.0',id:value.data?.id,result:{tools:[{name:'present_task',inputSchema:{type:'object'}}]}}};},
  disconnectService:async value=>{calls.push({operation:'disconnect',value});return {};},serviceState:async()=>({serviceActive:false})};
 const controller=createSshService({worker,terminal,profiles:{read:()=>({kind:'ssh'})},resource:{peek:()=>selected,capture:()=>revision,assertCurrent:value=>assert.equal(value,revision)},source:'/owned/worker-source',prepareResources:()=>{if(!available)throw Error('owned resources unavailable');return {source:'inert source',payload:{expected_runtime_id:health.runtimeId}};}});
 return {worker,terminal,controller,calls,select:which=>{selected=selection(intent(which));revision++;},resources:value=>available=value};
}
test('connected A cannot be overwritten by B and only explicit original disconnect permits the next lease',async t=>{
 const f=fixture(t);await f.controller.connect(intent('A'));const original=f.worker.connection;f.select('B');
 await assert.rejects(f.controller.connect(intent('B')),/原 SSH 连接返回交互终端/);
 assert.equal(f.worker.connection,original);assert.equal(f.controller.peek().sessionId,'session-A');assert.equal(f.calls.filter(v=>v.operation==='connect').length,1);
 f.select('A');await f.controller.disconnect({});assert.deepEqual(f.calls.find(v=>v.operation==='disconnect').value,{sessionId:'session-A',serviceId:'lease-session-A'});
 f.select('B');const result=await f.controller.connect(intent('B'));assert.equal(result.sessionId,'session-B');assert.equal(result.workflowReady,true);
});
test('local proxy detach leaves an unknown active lease rather than authorizing same-session or cross-session reconnect',async t=>{
 const f=fixture(t);await f.controller.connect(intent('A'));f.worker.close();assert.equal(f.controller.peek().status,'unknown');
 await assert.rejects(f.controller.connect({...intent('A'),requestId:'fresh-A'}),/原 SSH 连接返回交互终端/);
 f.select('B');await assert.rejects(f.controller.connect(intent('B')),/原 SSH 连接返回交互终端/);assert.equal(f.calls.filter(v=>v.operation==='connect').length,1);
 f.select('A');await f.controller.disconnect({});assert.equal(f.controller.peek().status,'disconnected');
 await f.controller.connect({...intent('A'),requestId:'after-cleanup'});assert.equal(f.controller.peek().workflowReady,true);
});
test('a predispatch resource failure clears its empty attempt and an inactive failed bootstrap can be explicitly retired',async t=>{
 const f=fixture(t);f.resources(false);await assert.rejects(f.controller.connect(intent('A')),/resources unavailable/);assert.equal(f.controller.peek().status,'disconnected');assert.equal(f.calls.length,0);
 f.resources(true);f.terminal.connectService=async()=>{throw Error('owned bootstrap failed before a broker lane existed');};
 await assert.rejects(f.controller.connect(intent('A')),/owned bootstrap failed/);assert.equal(f.controller.peek().status,'unknown');await f.controller.disconnect({});assert.equal(f.controller.peek().status,'disconnected');
});
test('acknowledged close of the exact terminal retires its service reference without issuing a stale stop',async t=>{
 const f=fixture(t);await f.controller.connect(intent('A'));f.controller.terminalClosed('session-A');
 assert.equal(f.worker.connection,null);assert.equal(f.controller.peek().status,'disconnected');assert.equal(f.calls.filter(v=>v.operation==='disconnect').length,0);
 f.select('B');await f.controller.connect(intent('B'));assert.equal(f.controller.peek().sessionId,'session-B');
});
test('a close acknowledgement for another terminal cannot detach the active service',async t=>{
 const f=fixture(t);await f.controller.connect(intent('A'));const connection=f.worker.connection;
 f.controller.terminalClosed('session-B');assert.equal(f.worker.connection,connection);assert.equal(f.controller.peek().status,'connected');assert.equal(f.controller.peek().sessionId,'session-A');
});
test('closing a terminal during bootstrap prevents its late acknowledgement from reviving a service record',async t=>{
 const f=fixture(t),original=f.terminal.connectService;let release;f.terminal.connectService=()=>new Promise(resolve=>release=resolve);
 const pending=f.controller.connect(intent('A'));pending.catch(()=>{});f.controller.terminalClosed('session-A');
 assert.equal(f.controller.peek().status,'disconnected');release({serviceId:'late-closed-lease',service:health});await assert.rejects(pending,/context_changed/);
 assert.equal(f.worker.connection??null,null);assert.equal(f.controller.peek().status,'disconnected');
 f.terminal.connectService=original;f.select('B');await f.controller.connect(intent('B'));assert.equal(f.controller.peek().sessionId,'session-B');
});

// Execute the owning main handler with inert ports; Electron or real connections
// are never loaded. This protects the actual IPC guard, not a copied condition.
function resourceHandler(method,service,calls){
 const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8'),tree=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let callback;
 function visit(node){if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='handle'){const route=node.arguments[0];if(route&&ts.isBinaryExpression(route)&&ts.isStringLiteral(route.left)&&route.left.text==='compute.resource.'&&ts.isIdentifier(route.right)&&route.right.text==='method')callback=node.arguments[1].getText(tree);}ts.forEachChild(node,visit);}visit(tree);assert(callback,'actual main resource handler exists');
 const computeResource={peek:()=>selection(intent('A')),activate:async value=>{calls.push(['activate',value]);return value;},clear:async value=>{calls.push(['clear',value]);return value;}};
 return new Function('method','assertIdleAgent','agents','sshService','computeResource','worker','emit','scientificTools','return ('+callback+');')(method,()=>{}, {assertContextIdle(){},active:'codex'}, {peek:()=>service},computeResource,{revokeProvider(){}},()=>{},async()=>({}));
}
for(const status of ['connecting','connected','unknown'])test('actual main IPC forbids switching/clearing '+status+' SSH service and permits only exact same activation',async()=>{
 const service={status,...selection(intent('A'))},calls=[];
 await assert.rejects(resourceHandler('activate',service,calls)(selection(intent('B'))),/原 SSH 连接返回交互终端/);
 await assert.rejects(resourceHandler('activate',service,calls)({...selection(intent('A')),profileVersion:2}),/原 SSH 连接返回交互终端/);
 await assert.rejects(resourceHandler('clear',service,calls)({selectionId:'old-selection'}),/原 SSH 连接返回交互终端/);assert.equal(calls.length,0);
 await resourceHandler('activate',service,calls)(selection(intent('A')));assert.equal(calls.length,1);
});
test('actual main IPC permits a new resource only when no SSH service lease remains',async()=>{
 for(const service of [null,{status:'disconnected'}]){const calls=[];await resourceHandler('activate',service,calls)(selection(intent('B')));assert.equal(calls.length,1);}
});
