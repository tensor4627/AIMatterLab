import {legacyApiBridgeFactories} from '../helpers/legacy-api-bridge.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {AgentHub} from "../../agent/providers/agent-hub.mjs";import {McpProviderScopes} from "../../agent/tools/provider-scope.mjs";
const context=(threadId=null,taskId=null,extra={})=>({threadId,taskId,projectId:taskId?'project-a':null,environmentId:taskId?'env-a':null,inputRoot:taskId?'/owned/'+taskId:null,...extra});
class Bridge extends EventEmitter{
 constructor(){super();this.activeTurns=new Set();this.starts=[];this.calls=[];this.next=0;}
 async start(executable,worker,config){const key=createHash('sha256').update(JSON.stringify([executable,worker?.url,worker?.tokens?.mcp,config])).digest('hex');if(this.process&&this.contextKey===key)return {};this.contextKey=key;this.starts.push(worker);this.worker=worker;const launch=async()=>{if(this.startGate)await this.startGate;this.process={};return {};};this.starting=launch();try{return await this.starting;}finally{this.starting=null;}}
 close(){const old=this.process;this.process=null;if(old)this.emit('event',{method:'studio/codexDisconnected',params:{}});}
 async request(method,params){this.calls.push({method,params});if(method==='thread/start')return {thread:{id:'fresh-'+(++this.next),turns:[]}};if(method==='thread/resume')return {thread:{id:params.threadId,turns:[{id:'historical'}]}};if(method==='turn/start'){if(this.turnGate)await this.turnGate;if(this.rejectTurn)throw Object.assign(Error('Rejected before reply'),{rpcResponse:true});return {turn:{id:'turn-a'}};}return {};}
}
async function setup(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-context-lifecycle-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const scopes=new McpProviderScopes(),base={url:'http://127.0.0.1:32123',tokens:{mcp:'base',admin:'not-shared'}};scopes.bind(base);const stored=new Map(),codex=new Bridge();
 const catalog={list:()=>[],get:(kind,id)=>stored.get(kind+':'+id),put:(kind,id,v)=>stored.set(kind+':'+id,v)};
 const hub=new AgentHub({apiBridgeFactories:legacyApiBridgeFactories,codex,root,catalog,vault:{get:()=>null},settings:()=>({codexPath:'fixture-codex',kimiPath:'fixture-kimi',qwenPath:'fixture-qwen',agent:{}}),worker:p=>scopes.connection(p,base),releaseWorker:p=>scopes.revoke(p),bindWorkerContext:(p,c,o)=>{scopes.bind(base);return scopes.bindContext(p,c,o);}});t.after(()=>hub.close());
 const auth=c=>scopes.authenticate({pathname:new URL(c.url).pathname+'/mcp',authorization:'Bearer '+c.tokens.mcp,host:'127.0.0.1:32123'});return {hub,codex,scopes,base,auth};
}
async function fresh(f){await f.hub.connect('codex');await f.hub.selectContext('codex',context());const response=await f.hub.rpc('codex','thread/start');await f.hub.selectContext('codex',context(response.thread.id));return response.thread.id;}
test('Selecting a context before connection never starts login or network',async t=>{const {hub,codex}=await setup(t);const r=await hub.selectContext('codex',context('existing','task-a'));assert.equal(r.connected,false);assert.equal(codex.starts.length,0);assert.equal(codex.process,undefined);});
test('Real zero-turn thread and pristine first task bind without restarting or changing MCP token',async t=>{
 const f=await setup(t);await f.hub.connect('codex');const first=f.codex.worker,thread=await fresh(f);assert.equal(f.codex.starts.length,1);assert.equal(f.auth(first).threadId,thread);await f.hub.selectContext('codex',context(thread,'task-a'));assert.equal(f.codex.starts.length,1);assert.equal(f.auth(first).taskId,'task-a');await f.hub.rpc('codex','turn/start',{threadId:thread,input:[]});await f.hub.selectContext('codex',context(thread,'task-a'));assert.equal(f.codex.starts.length,1);assert.equal(f.codex.calls.filter(x=>x.method==='thread/resume').length,0);
});
test('A failed attempted ordinary chat prevents later first-task privilege inheritance',async t=>{
 const f=await setup(t),thread=await fresh(f),old=f.codex.worker;f.codex.rejectTurn=true;await assert.rejects(f.hub.rpc('codex','turn/start',{threadId:thread,input:[]}),/Rejected/);await f.hub.selectContext('codex',context(thread,'task-a'));assert.equal(f.auth(old),null);assert.equal(f.codex.starts.length,2);assert.equal(f.auth(f.codex.worker).taskId,'task-a');f.codex.rejectTurn=false;await f.hub.rpc('codex','turn/start',{threadId:thread,input:[]});assert.equal(f.codex.calls.filter(x=>x.method==='thread/resume').length,1);
});
for(const key of ['threadId','taskId','projectId','environmentId','inputRoot'])test('Bound '+key+' change revokes old process and resumes exactly once',async t=>{
 const f=await setup(t),thread=await fresh(f);await f.hub.selectContext('codex',context(thread,'task-a'));const old=f.codex.worker,next={...context(thread,'task-a'),[key]:key==='inputRoot'?'/owned/new':'changed-'+key};await f.hub.selectContext('codex',next);assert.equal(f.auth(old),null);assert.equal(f.auth(f.codex.worker)[key],next[key]);assert.equal(f.codex.starts.length,2);await f.hub.rpc('codex','turn/start',{threadId:next.threadId,input:[]});await f.hub.selectContext('codex',next);await f.hub.rpc('codex','turn/start',{threadId:next.threadId,input:[]});assert.equal(f.codex.starts.length,2);assert.equal(f.codex.calls.filter(x=>x.method==='thread/resume').length,1);
});
test('Attempt marking precedes await ack and rejects switching while dispatch is in flight',async t=>{
 const f=await setup(t),thread=await fresh(f);let release;f.codex.turnGate=new Promise(r=>release=r);const pending=f.hub.rpc('codex','turn/start',{threadId:thread,input:[]});assert.throws(()=>f.hub.selectContext('codex',context('other')),/Stop the current reply/);release();await pending;
});
test('Superseded asynchronous connect never overwrites a newer desired context',async t=>{
 const f=await setup(t);await fresh(f);let release;f.codex.startGate=new Promise(r=>release=r);const a=f.hub.selectContext('codex',context('a','task-a'));await new Promise(r=>setImmediate(r));const b=f.hub.selectContext('codex',context('b','task-b'));f.codex.startGate=null;release();await assert.rejects(a,/superseded/);await b;assert.equal(f.auth(f.codex.worker).threadId,'b');assert.equal(f.auth(f.codex.worker).taskId,'task-b');await f.hub.rpc('codex','turn/start',{threadId:'b',input:[]});assert.equal(f.codex.calls.at(-2).params.threadId,'b');
});
test('Superseding a pending reconnect with the same target still produces a live new lease',async t=>{
 const f=await setup(t);await fresh(f);let release;f.codex.startGate=new Promise(r=>release=r);const a=f.hub.selectContext('codex',context('a','task-a'));await new Promise(r=>setImmediate(r));const b=f.hub.selectContext('codex',context('a','task-a'));f.codex.startGate=null;release();await assert.rejects(a,/superseded/);await b;assert.equal(f.auth(f.codex.worker).threadId,'a');assert(f.codex.process);
});
test('DeepSeek exact-context reconnect keeps authenticated models and restores existing session',async t=>{
 const f=await setup(t);await f.hub.connect('deepseek');const b=f.hub.bridge('deepseek');b.models=['catalog-model'];b.model='catalog-model';await f.hub.selectContext('deepseek',context());const started=await f.hub.rpc('deepseek','thread/start',{model:'catalog-model'});await f.hub.selectContext('deepseek',context(started.thread.id));await assert.rejects(f.hub.rpc('deepseek','turn/start',{threadId:started.thread.id,input:[]}),/Invalid DeepSeek text input/);const old=b.getWorker();await f.hub.selectContext('deepseek',context(started.thread.id,'task-a'));assert.equal(f.auth(old),null);assert.deepEqual(b.models,['catalog-model']);assert.equal(b.model,'catalog-model');const read=await f.hub.rpc('deepseek','thread/read',{threadId:started.thread.id});assert.equal(read.thread.id,started.thread.id);assert.equal(b.current,started.thread.id);
});
for(const provider of ['kimi','qwen'])test(provider+' reconnect uses real thread/resume contract and preserves unsupported errors',async t=>{
 const f=await setup(t),bridge=new Bridge();bridge.sessions=new Map();bridge.close=()=>{bridge.process=null;bridge.sessions.clear();};let supported=true;bridge.start=async(executable,profile,worker)=>{bridge.process={};bridge.worker=worker;bridge.starts.push(worker);return {};};bridge.request=async(method,params)=>{bridge.calls.push({method,params});if(method==='thread/resume'){if(!supported)throw Error('Session restoration is unsupported by this CLI');bridge.current=params.threadId;return {thread:{id:params.threadId,turns:[]}};}return {};};f.hub.bridges.set(provider,bridge);await f.hub.connect(provider);await f.hub.selectContext(provider,context('existing','task-a'));await f.hub.rpc(provider,'thread/read',{threadId:'existing'});assert.equal(bridge.calls[0].method,'thread/resume');assert.equal(bridge.current,'existing');supported=false;await f.hub.selectContext(provider,context('other','task-b'));await assert.rejects(f.hub.rpc(provider,'thread/read',{threadId:'other'}),/unsupported/);assert.equal(bridge.calls.at(-1).method,'thread/resume');
});
test('A thread argument cannot bypass the selected main-owned context',async t=>{const f=await setup(t);await fresh(f);await assert.rejects(f.hub.rpc('codex','turn/start',{threadId:'forged'}),/trusted conversation context/);assert.equal(f.codex.calls.filter(x=>x.method==='turn/start').length,0);});

test('Expected close is observable only synchronously; failed reconnect remains explicitly disconnected',async t=>{
 const f=await setup(t);await fresh(f);const seen=[],failures=[];f.codex.on('event',e=>{if(e.method==='studio/codexDisconnected')seen.push(f.hub.isContextTransition('codex'));});f.hub.on('event',e=>{if(e.method==='studio/codexDisconnected')failures.push(e);});
 await f.hub.selectContext('codex',context('existing','task-a'));assert.deepEqual(seen,[true]);assert.equal(f.hub.isContextTransition('codex'),false);assert.equal(failures.length,0);
 f.codex.start=async()=>{assert.equal(f.hub.isContextTransition('codex'),false);throw Error('Native reconnect failed');};await assert.rejects(f.hub.selectContext('codex',context('other','task-b')),/Native reconnect failed/);assert.equal(failures.length,1);assert.equal(failures[0].params.message,'Native reconnect failed');assert.equal(f.hub.isContextTransition('codex'),false);
});
test('ACP forwards genuine disconnect but filters only its expected context close',async t=>{
 const f=await setup(t);await f.hub.connect('deepseek');const b=f.hub.bridge('deepseek'),events=[];f.hub.on('event',e=>events.push(e));const original=b.close.bind(b);b.close=()=>{original();b.emit('event',{provider:'deepseek',method:'studio/codexDisconnected',params:{reason:'closed'}});};await f.hub.selectContext('deepseek',context('existing','task-a'));assert.equal(events.filter(e=>e.method==='studio/codexDisconnected').length,0);b.emit('event',{provider:'deepseek',method:'studio/codexDisconnected',params:{reason:'unexpected'}});assert.equal(events.filter(e=>e.method==='studio/codexDisconnected').length,1);assert.equal(f.hub.bridgeWorkers.has('deepseek'),false);
});

test('RPC cannot dispatch a new context prompt into the old process during asynchronous reconnect',async t=>{
 const f=await setup(t);await fresh(f);let release;f.codex.startGate=new Promise(r=>release=r);const transition=f.hub.selectContext('codex',context('next','task-b'));await new Promise(r=>setImmediate(r));const calls=f.codex.calls.length;await assert.rejects(f.hub.rpc('codex','turn/start',{threadId:'next',input:[{type:'text',text:'must not reach old history'}]}),/selection to finish/);assert.equal(f.codex.calls.length,calls);f.codex.startGate=null;release();await transition;await f.hub.rpc('codex','turn/start',{threadId:'next',input:[]});assert.equal(f.codex.calls.at(-1).method,'turn/start');
});

test('Pending selection retains account metadata and explicit interrupt RPCs without dispatching a prompt',async t=>{
 const f=await setup(t),thread=await fresh(f);const transition=f.hub.selectContext('codex',context(thread));await f.hub.rpc('codex','account/read');await f.hub.rpc('codex','turn/interrupt',{threadId:thread,turnId:'only-existing-turn'});await transition;assert.equal(f.codex.calls.filter(x=>x.method==='turn/start').length,0);assert.equal(f.codex.calls.at(-1).method,'turn/interrupt');
});

test('Hub close invalidates a pending selection and closes its late process instead of restoring it',async t=>{
 const f=await setup(t);await fresh(f);let release;f.codex.startGate=new Promise(r=>release=r);const transition=f.hub.selectContext('codex',context('late','task-b'));await new Promise(r=>setImmediate(r));f.hub.close();assert.equal(f.hub.contextPending,0);assert.equal(f.hub.contexts.size,0);f.codex.startGate=null;release();await assert.rejects(transition,/superseded/);assert.equal(f.codex.process,null);assert.equal(f.scopes.scopes.size,0);assert.equal(f.hub.contextResume.size,0);assert.equal(f.codex.calls.some(c=>c.params?.threadId==='late'),false);
});
