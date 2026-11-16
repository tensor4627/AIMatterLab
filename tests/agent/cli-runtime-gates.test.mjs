import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const unavailable=provider=>Object.assign(Error('CLI is missing'),{readiness:{provider,status:'missing',expectedVersion:'fixture',message:'CLI is missing'}});
function fixture(t,resolveCli){
 const calls=[],credentials=new Map(),records=new Map(),children=[],codex=new EventEmitter();codex.close=()=>calls.push({method:'codex.close'});codex.activeTurns=new Map();
 const host={prepareProfile:(root,provider)=>{calls.push({method:'profile',provider});return {cwd:root,args:['acp'],env:{}};},spawnCli:(file,args,options)=>{calls.push({method:'spawn',file,args,options});const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>child.emit('exit',null);children.push(child);return child;}};
 const hub=new AgentHub({codex,root:'.',catalog:{list:kind=>[...records].filter(([id])=>id.startsWith(kind+':')).map(([,value])=>value),get:(kind,id)=>records.get(kind+':'+id),put:(kind,id,value)=>records.set(kind+':'+id,value)},vault:{get:key=>credentials.get(key),put:(key,value)=>credentials.set(key,value)},settings:()=>({kimiPath:'stored-kimi',qwenPath:'stored-qwen'}),worker:()=>null,resolveCli,host});
 for(const provider of ['kimi','qwen'])hub.bridges.set(provider,{activeTurns:new Map(),start:async file=>{calls.push({method:'start',provider,file});return {protocolVersion:1};},close:()=>calls.push({method:'close',provider})});
 t.after(()=>{hub.close();for(const child of children)child.emit('exit',null);});return {hub,calls,credentials};
}
test('missing local CLI fails before private profile, process or provider selection changes',async t=>{
 const f=fixture(t,async provider=>{throw unavailable(provider);});await assert.rejects(f.hub.connect('kimi'),error=>error.readiness.status==='missing');assert.equal(f.hub.active,'codex');assert.deepEqual(f.calls,[]);
});
test('Kimi login is gated by runtime readiness and explicit cancel before discovery completes',async t=>{
 const gate=deferred(),f=fixture(t,()=>gate.promise),pending=f.hub.login('kimi',{region:'global'}),rejected=assert.rejects(pending,/cancelled/);f.hub.cancelLogin();gate.resolve('ready-kimi.mjs');await rejected;assert.equal(f.calls.filter(value=>value.method==='spawn').length,0);
});
test('different-provider selection prevents a late successful old discovery from starting',async t=>{
 const gate=deferred(),f=fixture(t,provider=>provider==='kimi'?gate.promise:Promise.resolve('ready-qwen.js')),pending=f.hub.connect('kimi'),rejected=assert.rejects(pending,/selection changed/);
 await f.hub.connect('qwen');gate.resolve('late-kimi.js');await rejected;assert.equal(f.hub.active,'qwen');assert(!f.calls.some(value=>value.method==='start'&&value.provider==='kimi'));
});
test('different-provider selection strips a late old CLI readiness failure',async t=>{
 const gate=deferred(),f=fixture(t,provider=>provider==='kimi'?gate.promise:Promise.resolve('ready-qwen.js')),pending=f.hub.connect('kimi'),rejected=assert.rejects(pending,error=>!error.readiness&&/selection changed/.test(error.message));
 await f.hub.connect('qwen');gate.reject(unavailable('kimi'));await rejected;
});
test('explicit disconnect invalidates an in-flight CLI discovery before it can spawn',async t=>{
 const gate=deferred(),f=fixture(t,()=>gate.promise),pending=f.hub.connect('kimi'),rejected=assert.rejects(pending,/selection changed|cancelled/);
 f.hub.disconnect('kimi');gate.resolve('late-kimi.js');await rejected;assert(!f.calls.some(value=>value.method==='start'));
});
for(const action of ['switch','disconnect'])test('pending Kimi login does not spawn after '+action,async t=>{
 const gate=deferred(),f=fixture(t,provider=>provider==='kimi'?gate.promise:Promise.resolve('ready-qwen.js')),pending=f.hub.login('kimi'),rejected=assert.rejects(pending,/cancelled|selection changed/);
 if(action==='switch')await f.hub.connect('qwen');else f.hub.disconnect('kimi');gate.resolve('late-kimi.js');await rejected;assert(!f.calls.some(value=>value.method==='spawn'));
});
test('ready Kimi login uses resolved real entry and selected region',async t=>{
 const f=fixture(t,async()=>'/fixture/real-kimi.mjs');assert.equal((await f.hub.login('kimi',{region:'global'})).phase,'starting');
 const spawn=f.calls.find(value=>value.method==='spawn');assert.equal(spawn.file,'/fixture/real-kimi.mjs');assert.deepEqual(spawn.args,['acp','--login','--region','global']);
});
test('Qwen API credential saving is independent of CLI presence and does not call a model',async t=>{
 let resolved=false;const f=fixture(t,async()=>{resolved=true;throw unavailable('qwen');});
 const account=await f.hub.login('qwen',{apiKey:'sk-sp-isolated-fixture-key',plan:'coding-cn',model:'fixture-model'});
 assert.equal(account.credentialStored,true);assert.equal(account.modelAccess,'not_run');assert.equal(f.credentials.get('qwen').model,'fixture-model');assert.equal(resolved,false);assert(!f.calls.some(value=>value.method==='spawn'||value.method==='start'));
});
