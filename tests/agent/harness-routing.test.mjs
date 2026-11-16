import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import path from 'node:path';
import os from 'node:os';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';
import {DshBridge} from '../../agent/providers/dsh.mjs';
import {ApiModelBridge} from '../../agent/providers/api-model-bridge.mjs';

function hub(extra={}){
 const codex=new EventEmitter();codex.close=()=>{};const records=new Map(),secrets=new Map([['deepseek',{apiKey:'sk-fixture-deepseek-key'}],['compatible',{apiKey:'synthetic-private-key',baseUrl:'https://vendor.example/v1',model:'vendor-model'}]]);
 return new AgentHub({codex,root:path.join(os.tmpdir(),'studio-harness-routing-fixture'),catalog:{get:(kind,id)=>records.get(kind+id),list:kind=>[...records].filter(([id])=>id.startsWith(kind)).map(([,value])=>value),put:(kind,id,value)=>records.set(kind+id,value)},vault:{get:id=>secrets.get(id),put:(id,value)=>secrets.set(id,value)},settings:()=>({codexPath:'chosen-codex'}),worker:()=>null,...extra});
}
test('production API routing selects official DSH for DeepSeek, custom API and Qwen without a CLI dependency',()=>{
 const h=hub();try{assert(h.createApiBridge('deepseek') instanceof DshBridge);for(const provider of ['compatible','qwen']){const bridge=h.createApiBridge(provider);assert(bridge instanceof ApiModelBridge);assert.notEqual(bridge,h.codex);assert.equal(bridge.executable,undefined);}}finally{h.close();}
});
for(const provider of ['deepseek','compatible'])test(provider+' connection validation uses its selected harness with an isolated empty context',async()=>{
 const calls=[];let options;
 const h=hub({apiBridgeFactories:{[provider]:value=>{options=value;const bridge=new EventEmitter();bridge.start=async()=>calls.push('start');bridge.close=()=>calls.push('close');bridge.request=async(method)=>{calls.push(method);if(method==='thread/start')return {thread:{id:'fixture-thread'},model:'actual-fixture-model'};if(method==='turn/start')queueMicrotask(()=>bridge.emit('event',{method:'turn/completed',params:{turn:{status:'completed',modelOutputReceived:true}}}));return {};};return bridge;}}});
 try{const result=await h.testConnection(provider);assert.equal(result.status,'passed');assert.equal(result.model,'actual-fixture-model');assert.equal(options.provider,provider);assert.equal(options.worker(),null);assert.equal(options.catalog.list().length,0);assert(options.root.startsWith(path.join(h.root,'connection-checks')+path.sep));assert.deepEqual(calls,['start','model/list','thread/start','turn/start','close']);assert.equal(h.bridges.size,0);assert.equal((await h.account(provider)).modelAccess,'passed');}finally{h.close();}
});
test('transport completion without model output cannot certify API model access',async()=>{
 const h=hub({apiBridgeFactories:{compatible:()=>{const bridge=new EventEmitter();bridge.start=async()=>{};bridge.close=()=>{};bridge.request=async method=>{if(method==='thread/start')return {thread:{id:'fixture'}};if(method==='turn/start')queueMicrotask(()=>bridge.emit('event',{method:'turn/completed',params:{turn:{status:'completed',modelOutputReceived:false}}}));return {};};return bridge;}}});
 try{await assert.rejects(h.testConnection('compatible'),/完整模型回复/);assert.equal((await h.account('compatible')).modelAccess,'not_run');}finally{h.close();}
});
