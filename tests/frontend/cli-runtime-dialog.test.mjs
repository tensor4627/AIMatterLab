import test from 'node:test';
import assert from 'node:assert/strict';
import {experienceHarness,deferred} from '../helpers/settings-experience-hooks.mjs';
import {appWorkerHarness} from '../helpers/app-worker-hooks.mjs';
import {agentHarness,memoryStorage} from '../helpers/agent-hooks.mjs';

const missing=provider=>({provider,status:'missing',expectedVersion:'1.2.3',message:'Missing local runtime'});
const ready=provider=>({...missing(provider),status:'ready',source:'path',version:'1.2.3',executable:'C:/fixture/cli.exe',message:'Local runtime ready'});
function setup(override){const completed=[],closed=[];const h=experienceHarness({component:'CliRuntimeDialog',props:{provider:'kimi',readiness:missing('kimi'),onReady:value=>completed.push(value),onClose:()=>closed.push(true)},invoke:async(method,data)=>override?.(method,data)??(method==='agent.cli.inspect'?missing(data.provider):method==='agent.cli.choose'?null:method==='agent.cli.cancel'?{cancelled:true}:Promise.reject(Error('Unexpected CLI action '+method)))});return {...h,completed,closed};}
const emit=(h,value)=>{for(const callback of h.events)callback({method:'studio/cliInstallProgress',provider:value.provider,params:value});};

test('a missing runtime presents choices without downloading, choosing a file is explicit and cancellation is harmless',async()=>{
 const h=setup();try{await h.flush();assert.match(h.text(),/本机未找到对应 CLI/);assert.equal(h.calls.length,0);h.byId('cli-choose').props.onClick();await h.flush();assert.deepEqual(h.calls,[{method:'agent.cli.choose',data:{provider:'kimi'}}]);assert.equal(h.byId('cli-download').props.disabled,false);assert.deepEqual(h.completed,[]);assert.deepEqual(h.closed,[]);}finally{h.unmount();}
});

test('explicit installation is single flight and displays only its real progress before readiness',async()=>{
 const gate=deferred(),h=setup(method=>method==='agent.cli.install'?gate.promise:undefined);
 try{await h.flush();const click=h.byId('cli-download').props.onClick;click();click();await h.flush();assert.equal(h.calls.filter(call=>call.method==='agent.cli.install').length,1);assert(h.byId('cli-download').props.disabled);const ticket=h.calls[0].data;
  const progress=()=>h.find(node=>node.type==='span'&&node.props.busy);
  emit(h,{...ticket,requestId:'other',phase:'downloading',receivedBytes:999,totalBytes:1000,packageIndex:1,packageCount:1});await h.flush();assert.equal(progress().props.progress,undefined);
  emit(h,{...ticket,phase:'downloading',receivedBytes:30,totalBytes:100,packageIndex:1,packageCount:2});await h.flush();assert.deepEqual(progress().props.progress,{completed:30,total:100});assert.match(h.text(),/1 \/ 2/);assert.deepEqual(h.completed,[]);
  emit(h,{...ticket,phase:'verifying',receivedBytes:100,totalBytes:100,packageIndex:1,packageCount:2});await h.flush();assert.equal(progress().props.label,'正在校验下载内容');gate.resolve(ready('kimi'));await h.flush();assert.deepEqual(h.completed,[ready('kimi')]);assert.equal(h.byId('cli-download').props.disabled,false);
 }finally{h.unmount();}
});

test('a compatible local runtime completes inspection without any installation',async()=>{
 const h=setup(method=>method==='agent.cli.inspect'?ready('kimi'):undefined);try{await h.flush();h.byId('cli-recheck').props.onClick();await h.flush();assert.deepEqual(h.completed,[ready('kimi')]);assert(!h.calls.some(call=>call.method==='agent.cli.install'));}finally{h.unmount();}
});

test('cancelling one installation is single flight and its late completion cannot report readiness',async()=>{
 const install=deferred(),cancel=deferred(),h=setup(method=>method==='agent.cli.install'?install.promise:method==='agent.cli.cancel'?cancel.promise:undefined);
 try{await h.flush();h.byId('cli-download').props.onClick();await h.flush();const click=h.byId('cli-cancel').props.onClick;click();click();await h.flush();assert.equal(h.calls.filter(call=>call.method==='agent.cli.cancel').length,1);cancel.resolve({cancelled:true});await h.flush();assert.equal(h.closed.length,1);install.resolve(ready('kimi'));await h.flush();assert.deepEqual(h.completed,[]);}finally{h.unmount();}
});

test('provider changes release old controls and cannot adopt the old install or progress',async()=>{
 const old=deferred(),current=deferred(),h=setup((method,data)=>method==='agent.cli.install'?(data.provider==='kimi'?old.promise:current.promise):undefined);
 try{await h.flush();h.byId('cli-download').props.onClick();await h.flush();const oldTicket=h.calls[0].data;h.render({provider:'qwen',readiness:missing('qwen')});await h.flush();assert.equal(h.byId('cli-download').props.disabled,false);h.byId('cli-download').props.onClick();await h.flush();assert.equal(h.calls.filter(call=>call.method==='agent.cli.install').length,2);emit(h,{...oldTicket,phase:'completed',receivedBytes:100,totalBytes:100,packageIndex:1,packageCount:1});old.resolve(ready('kimi'));await h.flush();assert(h.byId('cli-download').props.disabled);assert.deepEqual(h.completed,[]);current.resolve(ready('qwen'));await h.flush();assert.deepEqual(h.completed,[ready('qwen')]);}finally{h.unmount();}
});

test('an old cancellation response cannot close a newer provider dialog',async()=>{
 const install=deferred(),cancel=deferred(),h=setup(method=>method==='agent.cli.install'?install.promise:method==='agent.cli.cancel'?cancel.promise:undefined);
 try{await h.flush();h.byId('cli-download').props.onClick();await h.flush();h.byId('cli-cancel').props.onClick();await h.flush();h.render({provider:'qwen',readiness:missing('qwen')});await h.flush();cancel.resolve({cancelled:true});await h.flush();assert.equal(h.closed.length,0);assert.equal(h.byId('cli-choose').props.disabled,false);install.resolve(ready('kimi'));await h.flush();assert.deepEqual(h.completed,[]);}finally{h.unmount();}
});

test('late unmounted installation responses cannot complete or close another view',async()=>{
 const gate=deferred(),h=setup(method=>method==='agent.cli.install'?gate.promise:undefined);await h.flush();h.byId('cli-download').props.onClick();await h.flush();h.unmount();gate.resolve(ready('kimi'));await h.flush();assert.deepEqual(h.completed,[]);assert.deepEqual(h.closed,[]);
});

test('Agent missing-runtime connection stops before model discovery and never starts installation',async()=>{
 const storage=memoryStorage();storage.setItem('studio.agent.provider','kimi');const h=agentHarness({storage,override:(method,data,standard)=>method==='agent.connect'?{cliRequired:missing(data.provider)}:standard(method,data)});
 try{await h.flush();const before=h.calls.length;h.click('agent-connect');await h.flush();const calls=h.calls.slice(before);assert.equal(calls.filter(call=>call.method==='agent.connect').length,1);assert(!calls.some(call=>call.method==='agent.rpc'||call.method==='agent.cli.install'));assert.deepEqual(h.errors,[]);assert(h.find(node=>node.props?.['data-testid']==='agent-connect'));}finally{h.unmount();}
});

test('Agent connection blocks the same pending Connect click before rendering',async()=>{
 const gate=deferred(),h=agentHarness({override:(method,data,standard)=>method==='agent.connect'?gate.promise:standard(method,data)});
 try{await h.flush();const click=h.find(node=>node.props?.['data-testid']==='agent-connect').props.onClick;click();click();await h.flush();assert.equal(h.calls.filter(call=>call.method==='agent.connect').length,1);gate.resolve({cliRequired:missing('kimi')});await h.flush();assert.deepEqual(h.errors,[]);}finally{h.unmount();}
});


test('App presents the public missing-runtime event as a choice and never downloads automatically',async()=>{
 const h=appWorkerHarness();try{await h.flush();h.emit({method:'studio/cliRuntimeRequired',provider:'codex',params:missing('kimi')});await h.flush();assert.throws(()=>h.find(node=>node.type==='./CliRuntimeDialog'));h.emit({method:'studio/cliRuntimeRequired',provider:'kimi',params:missing('qwen')});await h.flush();assert.throws(()=>h.find(node=>node.type==='./CliRuntimeDialog'));h.emit({method:'studio/cliRuntimeRequired',provider:'kimi',params:missing('kimi')});await h.flush();const dialog=h.find(node=>node.type==='./CliRuntimeDialog');assert.equal(dialog.props.provider,'kimi');assert.deepEqual(dialog.props.readiness,missing('kimi'));assert(!h.calls.some(call=>call.method==='agent.cli.install'));dialog.props.onReady(ready('kimi'));await h.flush();assert.throws(()=>h.find(node=>node.type==='./CliRuntimeDialog'));assert.equal(h.find(node=>node.type==='./AccountCenter').props.provider,'kimi');assert(!h.calls.some(call=>call.method==='agent.cli.install'));}finally{h.unmount();}
});
