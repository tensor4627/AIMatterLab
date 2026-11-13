import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {CodexBridge,PROTOCOL_VERSION} from '../../agent/providers/codex.mjs';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';
import {codexRuntime} from '../../desktop/platform/codex-runtime.mjs';
import {createAgentRequests} from '../../agent/sessions/requests.mjs';
import {createAgentResourceRouting} from '../../agent/sessions/resource-routing.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,{verificationFailure=false}={}){
 const entered=deferred(),ready=deferred(),calls=[],cwd=path.resolve('.studio/bugfix/dev6/codex/synthetic-workspace');let verification=0;
 const isolation={cwd,instructions:path.join(cwd,'instructions.md'),config:{},ambientCount:0};
 const host={...codexRuntime,execute:async()=>({stdout:'codex-cli '+PROTOCOL_VERSION}),prepareIsolation:async()=>isolation,verifyIsolation:async()=>{calls.push('verify');if(++verification===1){entered.resolve();await ready.promise;if(verificationFailure)throw Error('Effective Codex isolation controls do not match');}return {status:'verified'};},spawnProcess:()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  child.stdin={destroyed:false,write:raw=>{const message=JSON.parse(raw);calls.push(message.method);if(message.id!==undefined){const result=message.method==='initialize'?{userAgent:'synthetic',codexHome:path.resolve('.studio/bugfix/dev6/codex/synthetic-home'),platformFamily:'windows',platformOs:'windows'}:message.method==='thread/resume'?{thread:{id:message.params.threadId,turns:[]},cwd,instructionSources:[]}:message.method==='thread/start'?{thread:{id:'fixture-thread',turns:[]},cwd,instructionSources:[]}:message.method==='turn/start'?{turn:{id:'fixture-turn'}}:{};queueMicrotask(()=>child.stdout.write(JSON.stringify({id:message.id,result})+'\n'));}}};return child;
 }};
 let deleted=false;const bridge=new CodexBridge({strictIsolation:true,isolationRoot:cwd,host}),hub=new AgentHub({codex:bridge,root:cwd,catalog:{get:kind=>deleted&&kind==='deleted-conversation'?{}:null,list:()=>[],put:()=>{}},vault:{get:()=>null},settings:()=>({codexPath:'fixture-codex',agent:{}}),worker:()=>null});
 let connection;const connect=()=>{connection=hub.connect('codex');connection.catch(()=>{});return connection;};
 t.after(async()=>{ready.resolve();await connection?.catch(()=>{});hub.close();});
 return {bridge,hub,calls,entered,ready,connect,deleteConversation:()=>{deleted=true;}};
}

test('a send arriving during actual Codex verification waits for that handshake and keeps the isolation gate',async t=>{
 const f=fixture(t),connection=f.connect();await f.entered.promise;assert(f.bridge.process);assert.equal(f.bridge.isolationReady,false);
 const request=f.hub.rpc('codex','turn/start',{threadId:'existing',input:[{type:'text',text:'synthetic fixture'}]});let outcome;request.then(()=>{outcome='fulfilled';},error=>{outcome=error.message;});
 await tick();assert.equal(outcome,undefined);assert.equal(f.calls.some(method=>method==='thread/resume'||method==='turn/start'),false);
 f.ready.resolve();await connection;assert.equal((await request).turn.id,'fixture-turn');assert.equal(f.bridge.isolationReady,true);assert.equal(f.calls.filter(method=>method==='turn/start').length,1);
});

test('failed startup verification rejects a queued send without resuming or dispatching any turn',async t=>{
 const f=fixture(t,{verificationFailure:true}),connection=f.connect();await f.entered.promise;const request=f.hub.rpc('codex','turn/start',{threadId:'existing',input:[{type:'text',text:'synthetic'}]});request.catch(()=>{});f.ready.resolve();
 await assert.rejects(connection,error=>error.code==='STUDIO_CODEX_COMPATIBILITY_FAILED');await assert.rejects(request,error=>error.code==='STUDIO_CODEX_COMPATIBILITY_FAILED');assert.equal(f.calls.some(method=>/^(thread|turn)\//.test(method)),false);assert.equal(f.bridge.isolationReady,false);
});

test('queued startup work cannot dispatch after its provider conversation changes',async t=>{
 const f=fixture(t),connection=f.connect();await f.entered.promise;const request=f.hub.rpc('codex','turn/start',{threadId:'existing',input:[{type:'text',text:'synthetic'}]});request.catch(()=>{});f.hub.contextGeneration++;f.hub.contexts.set('codex',{threadId:'different'});f.ready.resolve();await connection;
 await assert.rejects(request,/context.*superseded|context.*changed/i);assert.equal(f.calls.some(method=>/^(thread|turn)\//.test(method)),false);
});

test('closing the starting bridge rejects queued sends without silently launching a replacement',async t=>{
 const f=fixture(t),connection=f.connect();await f.entered.promise;const request=f.hub.rpc('codex','turn/start',{threadId:'existing',input:[{type:'text',text:'synthetic'}]});request.catch(()=>{});f.bridge.close();f.ready.resolve();
 await assert.rejects(connection);await assert.rejects(request);assert.equal(f.calls.some(method=>/^(thread|turn)\//.test(method)),false);assert.equal(f.calls.filter(method=>method==='initialize').length,1);assert.equal(f.bridge.process,null);
});

test('a provider switch alone invalidates a queued handshake request',async t=>{
 const f=fixture(t),connection=f.connect();await f.entered.promise;const request=f.hub.rpc('codex','turn/start',{threadId:'existing',input:[{type:'text',text:'synthetic'}]});request.catch(()=>{});f.hub.active='qwen';f.ready.resolve();await connection;
 await assert.rejects(request,/context.*superseded/i);assert.equal(f.calls.some(method=>/^(thread|turn)\//.test(method)),false);
});

test('a conversation deleted while startup is pending never reaches the native thread or turn API',async t=>{
 const f=fixture(t),connection=f.connect();await f.entered.promise;const request=f.hub.rpc('codex','thread/resume',{threadId:'existing'});request.catch(()=>{});f.deleteConversation();f.ready.resolve();await connection;
 await assert.rejects(request,/Conversation was deleted/);assert.equal(f.calls.some(method=>/^(thread|turn)\//.test(method)),false);
});

test('an unverified bridge without a pending handshake still fails closed',async()=>{
 const bridge=new CodexBridge({strictIsolation:true});bridge.process={stdin:{write:()=>assert.fail('No dispatch')},kill:()=>{}};try{await assert.rejects(bridge.request('turn/start',{threadId:'existing',input:[]}),/isolation has not been verified/);}finally{bridge.close();}
});

function actualRequestFactory({failure=false}={}){
 const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8'),ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true);let initializer;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='agentRequests')initializer=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert(initializer);
 const cache=[],calls=[],ports={authoringAuthorization:null,createAgentRequests,agents:{selectContext:async()=>{},rpc:async(provider,method,params)=>{calls.push({provider,method,params});if(failure)throw Error('Controlled read failed');return {thread:{id:method==='thread/start'?'cold-start':params.threadId,turns:[]}};}},catalog:{put:(kind,id,value)=>cache.push({kind,id,value:structuredClone(value)})},taskRecords:{bound:()=>null},workflowContext:{begin:(provider,threadId)=>({provider,threadId}),assert:()=>{},synchronize:async(ticket,bind)=>bind(ticket.provider,{threadId:ticket.threadId}),started:(ticket,id)=>{ticket.threadId=id;}},assertIdleAgent:()=>{},emit:()=>{},openUrl:()=>{},root:process.cwd(),app:{isPackaged:false}};
 for(const name of ['privateAccess','worker','sharedTerminal','scientificSkills','setupInstructions'])ports[name]={};for(const name of ['studioSkillRoots','managedSkillRoots','managedSkillEntries','managedSkillRecords','skillGuidanceScope'])ports[name]=()=>[];ports.bundledSkillRoot=process.cwd();
 ports.resourceRouting=createAgentResourceRouting({resource:()=>null});
 return {request:vm.runInNewContext(initializer,ports),cache,calls};
}
for(const method of ['thread/start','thread/resume'])test('actual main Agent request factory caches an acknowledged Codex '+method,async()=>{
 const f=actualRequestFactory(),result=await f.request({provider:'codex',method,params:method==='thread/resume'?{threadId:'saved-thread'}:{}});
 assert.equal(result.thread.id,method==='thread/start'?'cold-start':'saved-thread');assert.deepEqual(f.cache,[{kind:'thread',id:result.thread.id,value:result.thread}]);assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,method);
});
test('failed cold conversation read does not cache invented thread metadata',async()=>{
 const f=actualRequestFactory({failure:true});await assert.rejects(f.request({provider:'codex',method:'thread/resume',params:{threadId:'saved-thread'}}),/Controlled read failed/);assert.deepEqual(f.cache,[]);
});
