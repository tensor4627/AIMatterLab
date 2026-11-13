import {legacyApiBridgeFactories} from '../helpers/legacy-api-bridge.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';
import {deferred} from '../helpers/settings-experience-hooks.mjs';
const original={apiKey:'synthetic-private-key-a',baseUrl:'https://fixture-a.invalid/v1',model:'fixture-model-a'},replacement={apiKey:'synthetic-private-key-b',baseUrl:'https://fixture-b.invalid/v1',model:'fixture-model-b'};
const answer=()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'OK'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
function setup(){const credentials=new Map(),codex=new EventEmitter(),calls=[],events=[],entered=deferred(),release=deferred();codex.close=()=>{};const hub=new AgentHub({apiBridgeFactories:legacyApiBridgeFactories,codex,root:'.',catalog:{list:()=>[]},vault:{get:key=>credentials.get(key),put:(key,value)=>credentials.set(key,value),remove:key=>credentials.delete(key)},settings:()=>({}),worker:()=>null,fetchApi:async(url,options)=>{calls.push({url,options});entered.resolve();await release.promise;return answer();}});hub.on('event',event=>events.push(event));return {hub,calls,events,entered,release};}
test('connection validation marks only the unchanged actual configuration as passed',async()=>{
 const f=setup();try{await f.hub.login('compatible',original);const promise=f.hub.testConnection('compatible');await f.entered.promise;f.release.resolve();const result=await promise;assert.equal(result.status,'passed');assert.equal(result.model,original.model);assert.equal((await f.hub.account('compatible')).modelAccess,'passed');assert(!JSON.stringify([result,...f.events]).includes(original.apiKey));assert.equal(f.calls.length,1);}finally{f.hub.close();}
});
for(const change of ['replace','replace-and-restore','logout'])test('late API validation cannot certify credentials after '+change,async()=>{
 const f=setup();try{await f.hub.login('compatible',original);const promise=f.hub.testConnection('compatible'),rejected=assert.rejects(promise,/API 配置已变化/);await f.entered.promise;
  if(change==='logout')await f.hub.logout('compatible');else{await f.hub.login('compatible',replacement);if(change==='replace-and-restore')await f.hub.login('compatible',original);}
  f.release.resolve();await rejected;assert.equal((await f.hub.account('compatible')).modelAccess,'not_run');assert.equal(f.calls[0].url,original.baseUrl+'/chat/completions');assert.equal(f.calls[0].options.headers.Authorization,'Bearer '+original.apiKey);assert(!JSON.stringify(f.events).includes(original.apiKey));assert(!f.events.some(event=>event.method==='studio/accountUpdated'));assert.equal(f.hub.bridges.size,0);
 }finally{f.hub.close();}
});
test('missing credentials cannot start a connection validation request',async()=>{const f=setup();try{await assert.rejects(f.hub.testConnection('compatible'),/先保存 API 凭据/);assert.equal(f.calls.length,0);}finally{f.hub.close();}});
