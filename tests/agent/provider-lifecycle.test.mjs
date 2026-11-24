import __node_test, {describe as __describe} from 'node:test';
import assert from "node:assert/strict";
import {createAgentRequests} from "../../agent/sessions/requests.mjs";
import _imp_0_fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createServer} from "node:http";
import {validateModelProfile, apiModelKey, splitApiModelKey} from "../../contracts/agent/model-profiles.mjs";
import {ModelProfileStore} from "../../agent/providers/model-profile-store.mjs";
import {discoverProfileModels, installedModelCatalog} from "../../agent/providers/model-discovery.mjs";
import {ApiModelBridge} from "../../agent/providers/api-model-bridge.mjs";
import {dshRuntime} from "../../desktop/platform/dsh-runtime.mjs";
import {registerModelProfileRoutes} from "../../desktop/platform/model-profile-routes.mjs";
import {EventEmitter} from "node:events";
import {AgentHub} from "../../agent/providers/agent-hub.mjs";
import {deepseekCredentials, DEEPSEEK_URL} from "../../agent/providers/contracts.mjs";
import {deferred} from "../helpers/settings-experience-hooks.mjs";
import {createHash} from "node:crypto";
import _imp_1_fs from "node:fs/promises";
import {McpProviderScopes} from "../../agent/tools/provider-scope.mjs";

await __describe("api-turn-selection", async () => {
const test = __node_test;
for(const provider of ['qwen','compatible'])test(provider+' resolves its exact model profile before public guidance assembly',async()=>{
 const calls=[],runtime={agents:{selectContext:async()=>{calls.push('synchronize');},bridge:value=>{assert.equal(value,provider);return {prepareTurnModel:params=>{assert.equal(params.model,'api:fixture:model-a');calls.push('profile');return ()=>calls.push('current');}};}},scientificSkills:{clearManagedSelection:()=>calls.push('clear')},assertIdleAgent(){},workflowContext:{begin:()=>({}),current:()=>({}),assert(){},synchronize:async(_ticket,bind)=>bind(provider,{})},worker:{providerConnection:()=>{calls.push('guidance-boundary');throw Error('fixture stopped before reading any guidance');}}};
 const rpc=createAgentRequests({runtime:()=>runtime});await assert.rejects(rpc({provider,method:'turn/start',params:{threadId:'fixture-thread',model:'api:fixture:model-a',input:[{type:'text',text:'Fixture'}]}}),/stopped before reading/);
 assert(calls.indexOf('synchronize')<calls.indexOf('profile'));assert(calls.indexOf('profile')<calls.indexOf('guidance-boundary'));
});

test('a model profile rejected during selection never reaches workspace or guidance reads',async()=>{
 let reads=0;const rpc=createAgentRequests({runtime:()=>({agents:{selectContext:async()=>{},bridge:()=>({prepareTurnModel:()=>{throw Error('Foreign API profile');}})},scientificSkills:{clearManagedSelection(){}},assertIdleAgent(){},workflowContext:{begin:()=>({}),current:()=>({}),assert(){},synchronize:async(_ticket,bind)=>bind('qwen',{})},worker:{providerConnection:()=>reads++}})});
 await assert.rejects(rpc({provider:'qwen',method:'turn/start',params:{threadId:'fixture-thread',model:'api:foreign:model',input:[{type:'text',text:'Fixture'}]}}),/Foreign API profile/);assert.equal(reads,0);
});
});

await __describe("deepseek-account-profile", async () => {
const test = __node_test;
const fs = _imp_0_fs;
const profile={id:'account',provider:'compatible',name:'DeepSeek Account',baseUrl:'https://api.deepseek.com/anthropic',api:'anthropic-messages',authMode:'deepseek-account',models:[{id:'deepseek-flash',reasoningEfforts:{off:null,low:'low',high:'high',max:'max'}}]};
test('account tokens are confined to exact official address, protocol and auth mode',()=>{assert.equal(validateModelProfile(profile).authMode,'deepseek-account');for(const patch of [{baseUrl:'https://other.invalid/anthropic'},{api:'openai-completions'},{provider:'qwen'},{authMode:'arbitrary'}])assert.throws(()=>validateModelProfile({...profile,...patch}));const rows=new Map(),keys=new Map(),store=new ModelProfileStore({catalog:{get:(k,id)=>rows.get(k+id),put:(k,id,v)=>rows.set(k+id,v),list:k=>[...rows].filter(([id])=>id.startsWith(k)).map(([,v])=>v)},vault:{get:id=>keys.get(id),put:(id,v)=>keys.set(id,v)}});const first=store.save({profile,apiKey:'synthetic-account-token'});assert.throws(()=>store.save({profile:{...first,authMode:'api-key'},expectedRevision:first.revision}),/重新输入/);assert(!JSON.stringify([...rows]).includes('synthetic-account-token'));});
test('DeepSeek account discovery uses its native auth header without treating it as an API key',async()=>{let call;await discoverProfileModels(profile,{apiKey:'synthetic-account-token',fetchApi:async(url,options)=>{call={url,options};return Response.json({data:[{id:'deepseek-flash'}]});}});assert.equal(call.url,'https://api.deepseek.com/models');assert.deepEqual(call.options.headers,{'x-dsh-auth-token':'synthetic-account-token'});assert.equal(call.options.redirect,'error');});
test('official DeepSeek Messages adapter sends account header and reasoning while profile files remain secret-free',{timeout:60000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-account-')),calls=[],server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;calls.push({url:req.url,headers:req.headers,body:JSON.parse(raw)});const message={id:'account-fixture',type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,usage:{input_tokens:10,output_tokens:0}},events=[{type:'message_start',message},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'OK'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:2}},{type:'message_stop'}];res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const children=[],records=new Map(),config={...profile,revision:1,apiKey:'synthetic-account-token'},profiles={list:()=>[config],read:()=>config,identity:()=>JSON.stringify(config),resolve:(_provider,key)=>({profile:config,credential:config,model:config.models[0],key:key||'api:account:deepseek-flash'})},bridge=new ApiModelBridge({provider:'compatible',root,profiles,catalog:{get:(k,id)=>records.get(k+id),put:(k,id,v)=>records.set(k+id,v)},credential:()=>config,worker:()=>null,host:{...dshRuntime,spawn:(file,args,options)=>{const patch=path.join(options.env.DSH_HOME,'profiles/studio/cordis.patch.yml'),doc=JSON.parse(fs.readFileSync(patch,'utf8')),adapter=doc[0].insert.find(e=>e.id==='models');assert(!JSON.stringify(doc).includes(config.apiKey));adapter.config.baseUrl='http://127.0.0.1:'+server.address().port+'/anthropic';fs.writeFileSync(patch,JSON.stringify(doc));const child=dshRuntime.spawn(file,args,options);children.push(child);return child;}}});
 t.after(async()=>{bridge.close();await Promise.all(children.filter(c=>c.exitCode===null&&c.signalCode===null).map(c=>new Promise(resolve=>c.once('close',resolve))));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 await bridge.start();const {thread}=await bridge.request('thread/start'),done=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Account fixture timed out')),30000);bridge.on('event',event=>{if(event.method==='turn/completed'){clearTimeout(timeout);resolve(event.params.turn);}});});done.catch(()=>{});await bridge.request('turn/start',{threadId:thread.id,effort:'high',input:[{type:'text',text:'Account fixture'}]});assert.equal((await done).status,'completed');assert.equal(calls.length,1);assert.equal(calls[0].url,'/anthropic/v1/messages');assert.equal(calls[0].headers['x-dsh-auth-token'],config.apiKey);assert.equal(calls[0].headers.authorization,undefined);assert.equal(calls[0].headers['x-api-key'],undefined);assert.equal(calls[0].body.output_config.effort,'high');assert.deepEqual(bridge.info.studioIsolation.tools,[]);
});
});

await __describe("model-profiles", async () => {
const test = __node_test;
function fixture(){const records=new Map(),secrets=new Map(),catalog={get:(k,id)=>records.get(k+':'+id)||null,put:(k,id,value)=>{records.set(k+':'+id,structuredClone(value));return value;},list:k=>[...records].filter(([id])=>id.startsWith(k+':')).map(([,value])=>structuredClone(value)),remove:(k,id)=>records.delete(k+':'+id)},vault={get:id=>secrets.get(id)||null,put:(id,value)=>secrets.set(id,structuredClone(value)),remove:id=>secrets.delete(id)};return {store:new ModelProfileStore({catalog,vault}),catalog,vault,records,secrets};}
const profile=(extra={})=>({id:'gateway-a',provider:'compatible',name:'Gateway A',preset:'custom',api:'openai-completions',baseUrl:'https://fixture.invalid/v1',models:[{id:'model-a',reasoningEfforts:{off:null,high:'vendor-high'}}],defaultModel:'model-a',...extra});

test('legacy keyless loopback profiles migrate once and retain endpoint ownership',()=>{
 const f=fixture();f.vault.put('compatible',{apiKey:'',model:'local-model',baseUrl:'http://127.0.0.1:11434/v1'});
 const [saved]=f.store.list('compatible');assert(saved);assert.equal(saved.requiresApiKey,false);assert.equal(saved.credentialStored,false);
 assert.equal(f.store.resolve('compatible').credential.apiKey,'');assert.equal(f.store.resolve('compatible').model.id,'local-model');
 f.store.remove({id:saved.id,expectedRevision:saved.revision});assert.deepEqual(f.store.list('compatible'),[]);
 assert.throws(()=>f.store.save({profile:profile(),apiKey:''}),/API Key/);
});
test('model-scoped configuration validates offered reasoning values without accepting secrets or unsafe endpoint shapes',()=>{const value=validateModelProfile({...profile(),apiKey:'must-not-persist'});assert(!JSON.stringify(value).includes('must-not-persist'));for(const baseUrl of ['http://remote.invalid/v1','https://u:p@remote.invalid','https://remote.invalid/v1/chat/completions','https://remote.invalid/v1?key=secret'])assert.throws(()=>validateModelProfile(profile({baseUrl})));for(const models of [[{id:'a',reasoningEfforts:{}}],[{id:'a',reasoningEfforts:{off:null}}],[{id:'a',reasoningEfforts:{high:null}}],[{id:'a'},{id:'a'}]])assert.throws(()=>validateModelProfile(profile({models})));assert.deepEqual(splitApiModelKey(apiModelKey('gateway-a','vendor/model:v2')),{profileId:'gateway-a',modelId:'vendor/model:v2'});});
test('legacy Qwen key migrates once, without putting it in public model documents or changing the endpoint',()=>{const f=fixture();f.vault.put('qwen',{apiKey:'synthetic-qwen-key',plan:'coding-cn',model:'legacy-model',baseUrl:'https://coding.dashscope.aliyuncs.com/v1'});const list=f.store.list('qwen');assert.equal(list.length,1);assert.equal(list[0].baseUrl,'https://coding.dashscope.aliyuncs.com/v1');assert.equal(f.store.credential(list[0].id).apiKey,'synthetic-qwen-key');assert(!JSON.stringify([...f.records]).includes('synthetic-qwen-key'));assert.equal(f.vault.get('qwen').apiKey,'synthetic-qwen-key');f.store.remove({id:list[0].id,expectedRevision:1});assert.equal(f.store.list('qwen').length,0,'Removing a migrated profile must not recreate it from legacy credentials');});
test('saved key remains write-only and follows only its own exact endpoint/protocol; stale drafts cannot overwrite changes',()=>{const f=fixture(),saved=f.store.save({profile:profile(),apiKey:'synthetic-private-key'});assert(saved.credentialStored);assert(!JSON.stringify(saved).includes('synthetic-private-key'));const next=f.store.save({profile:{...saved,name:'Renamed'},apiKey:'',expectedRevision:saved.revision});assert.equal(f.store.credential(next.id).apiKey,'synthetic-private-key');assert.throws(()=>f.store.save({profile:{...next,baseUrl:'https://another.invalid/v1'},apiKey:'',expectedRevision:next.revision}),/重新输入/);assert.throws(()=>f.store.save({profile:next,apiKey:'',expectedRevision:1}),/已变化/);});
test('multiple providers retain separate keys and qualified model identities',()=>{const f=fixture();f.store.save({profile:profile(),apiKey:'synthetic-key-a'});f.store.save({profile:profile({id:'gateway-b',baseUrl:'https://b.invalid/v1'}),apiKey:'synthetic-key-b'});const a=f.store.resolve('compatible',apiModelKey('gateway-a','model-a')),b=f.store.resolve('compatible',apiModelKey('gateway-b','model-a'));assert.notEqual(a.key,b.key);assert.equal(a.credential.apiKey,'synthetic-key-a');assert.equal(b.credential.apiKey,'synthetic-key-b');});
test('OpenAI and Anthropic discovery use their own protocol routes and never certify model capabilities from IDs alone',async()=>{for(const api of ['openai-completions','openai-responses','anthropic-messages']){let call;const result=await discoverProfileModels(profile({api}),{apiKey:'synthetic-key',catalog:()=>[],fetchApi:async(url,options)=>{call={url,options};return Response.json({data:[{id:'model-a',context_window:12000},{id:'model-a'},{id:'model-b'}]});}});assert.equal(result.source,'endpoint');assert.equal(result.models.length,2);assert.equal(result.models[1].reasoningEfforts,undefined);assert.equal(call.options.redirect,'error');assert.equal(call.url,api==='anthropic-messages'?'https://fixture.invalid/v1/models?limit=1000':'https://fixture.invalid/v1/models');assert.equal(call.options.headers[api==='anthropic-messages'?'x-api-key':'Authorization'],api==='anthropic-messages'?'synthetic-key':'Bearer synthetic-key');}});
test('unsupported listing has an explicit catalog fallback but auth failure never becomes an empty success',async()=>{const qwen=profile({provider:'qwen',preset:'token-cn',baseUrl:'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'});const result=await discoverProfileModels(qwen,{apiKey:'synthetic-key',catalog:()=>[{id:'official-model'}],fetchApi:async()=>new Response('',{status:404})});assert.equal(result.source,'catalog');assert.match(result.notice,/实际可用性/);await assert.rejects(discoverProfileModels(qwen,{catalog:()=>[{id:'model'}],fetchApi:async()=>new Response('',{status:401})}),/HTTP 401/);await assert.rejects(discoverProfileModels(profile(),{catalog:()=>[],fetchApi:async()=>Response.json({wrong:[]})}),/data 数组/);});
test('discovery bounds the body and rejects a 4 MiB overflow',async()=>{await assert.rejects(discoverProfileModels(profile(),{catalog:()=>[],fetchApi:async()=>new Response('x'.repeat(4*1024*1024+1))}),/4 MiB/);});
test('main routes reject arbitrary requests and guard stale connection-test success',async()=>{const f=fixture(),saved=f.store.save({profile:profile(),apiKey:'synthetic-key'}),handlers={},agents={modelProfiles:f.store,loginStatus:{},disconnect(){}},events=[];let complete;registerModelProfileRoutes({handle:(name,fn)=>handlers[name]=fn,agents,assertIdle(){},emit:event=>events.push(event),checkConnection:()=>new Promise(resolve=>complete=resolve)});assert.throws(()=>handlers['models.profiles.list']({apiKey:'forbidden'}),/Invalid typed/);const pending=handlers['models.profiles.test']({id:saved.id,model:'model-a'});f.store.save({profile:{...saved,name:'Changed'},apiKey:'',expectedRevision:1});complete({status:'passed'});await assert.rejects(pending,/配置已变化/);assert.equal(events.length,0);});
test('ambiguous or missing plain model IDs cannot silently choose another provider',()=>{const f=fixture();f.store.save({profile:profile(),apiKey:'synthetic-key-a'});f.store.save({profile:profile({id:'gateway-b'}),apiKey:'synthetic-key-b'});assert.throws(()=>f.store.resolve('compatible','model-a'),/不明确/);assert.throws(()=>f.store.resolve('compatible','missing-model'),/不明确/);f.store.setDefault('gateway-b');assert.equal(f.store.resolve('compatible').profile.id,'gateway-b');});
test('removed drafts cannot recreate a deleted provider and sharing never follows a changed address',()=>{const f=fixture(),saved=f.store.save({profile:profile({sharePublicGuides:true}),apiKey:'synthetic-key'});assert.throws(()=>f.store.save({profile:{...saved,baseUrl:'https://b.invalid/v1'},apiKey:'replacement-key',expectedRevision:1}),/取消公开指导/);f.store.remove({id:saved.id,expectedRevision:1});assert.throws(()=>f.store.save({profile:saved,apiKey:'synthetic-key',expectedRevision:1}),/已移除/);});
test('pinned staged DSH catalog provides real Qwen Token Plan metadata without reading user DSH profiles',()=>{const models=installedModelCatalog('qwen-token-plan-cn');assert(models.length>1);assert(models.some(v=>v.reasoningEfforts));assert(models.every(v=>v.contextWindow>0));});
});

await __describe("provider-connection-validation", async () => {
const test = __node_test;
const original={apiKey:'synthetic-private-key-a',baseUrl:'https://fixture-a.invalid/v1',model:'fixture-model-a'},replacement={apiKey:'synthetic-private-key-b',baseUrl:'https://fixture-b.invalid/v1',model:'fixture-model-b'};
const answer=()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'OK'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
function fakeApiBridgeFactory({credential,fetchApi}){
 const bridge=new EventEmitter();
 Object.assign(bridge,{
  start:async()=>{bridge.process={};return {};},
  close:()=>{bridge.process=null;},
  request:async(method,params={})=>{
   const c=credential();
   if(method==='model/list')return {data:[{id:c.model,model:c.model}]};
   if(method==='thread/start'){bridge.model=c.model;return {thread:{id:'fixture-thread',turns:[]},model:c.model};}
   if(method==='turn/start'){
    const response=await fetchApi(c.baseUrl+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+c.apiKey,'Content-Type':'application/json'},body:JSON.stringify({model:c.model,messages:params.input})});
    const text=await response.text();
    bridge.emit('event',{method:'turn/completed',params:{threadId:params.threadId,turn:{id:'fixture-turn',status:response.ok?'completed':'failed',stopReason:'end_turn',modelOutputReceived:text.includes('OK')}}});
    return {turn:{id:'fixture-turn'}};
   }
   return {};
  }
 });
 return bridge;
}
function setup(){const credentials=new Map(),codex=new EventEmitter(),calls=[],events=[],entered=deferred(),release=deferred();codex.close=()=>{};const hub=new AgentHub({apiBridgeFactories:{compatible:fakeApiBridgeFactory},codex,root:'.',catalog:{get:()=>null,put:()=>{},list:()=>[]},vault:{get:key=>credentials.get(key),put:(key,value)=>credentials.set(key,value),remove:key=>credentials.delete(key)},settings:()=>({}),worker:()=>null,fetchApi:async(url,options)=>{calls.push({url,options});entered.resolve();await release.promise;return answer();}});hub.on('event',event=>events.push(event));return {hub,calls,events,entered,release};}
test('DeepSeek credentials pin the official endpoint and reject malformed keys',()=>{
 assert.equal(deepseekCredentials({apiKey:'sk-fixture-deepseek-key',baseUrl:'https://attacker.invalid'}).baseUrl,DEEPSEEK_URL);
 for(const apiKey of ['abc','sk-abc\n123456','sk-12345678 secret','sk-'+'.'.repeat(30)])assert.throws(()=>deepseekCredentials({apiKey}));
});
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
});

await __describe("provider-scope-lifecycle", async () => {
const test = __node_test;
const fs = _imp_1_fs;
const fakeApiFactories={deepseek:options=>Object.assign(new EventEmitter(),{start(){this.process={};return {};},close(){this.process=null;},getWorker:options.worker})};
const key=(executable,worker,config,options={})=>createHash('sha256').update(JSON.stringify([executable,worker?.url,worker?.tokens?.mcp,config,...options.authenticationOnly?['authentication-only']:[]])).digest('hex');
class FakeCodex extends EventEmitter{constructor(){super();this.activeTurns=new Set();this.starts=[];}async start(executable,worker,config,options={}){this.contextKey=key(executable,worker,config,options);this.isolation={authenticationOnly:options.authenticationOnly};this.worker=worker;this.process={};this.starts.push(worker);return {ok:true};}close(){const active=this.process;this.process=null;if(active)this.emit('event',{method:'studio/codexDisconnected',params:{reason:'fixture-close'}});}async request(){return {account:{}};}}
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-hub-scope-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const scopes=new McpProviderScopes(),base={url:'http://127.0.0.1:12345',tokens:{mcp:'fixture-base',admin:'never-agent'}};scopes.bind(base);const codex=new FakeCodex(),settings={codexPath:'fixture-codex',agent:{}};const hub=new AgentHub({apiBridgeFactories:fakeApiFactories,codex,root,catalog:{get:()=>null,list:()=>[],put:()=>{}},vault:{get:()=>null},settings:()=>settings,worker:provider=>scopes.connection(provider,base),releaseWorker:provider=>scopes.revoke(provider)});t.after(()=>hub.close());return {scopes,hub,codex,settings};}
function authenticate(scopes,connection){return scopes.authenticate({pathname:new URL(connection.url).pathname+'/mcp',authorization:'Bearer '+connection.tokens.mcp,host:'127.0.0.1:12345'});}
test('Codex account, explicit connect, context reconfigure and unexpected disconnect use live distinct process leases',async t=>{
 const {scopes,hub,codex,settings}=await fixture(t);await hub.account('codex');assert.equal(codex.worker,null);assert.equal(scopes.scopes.has('codex'),false);await hub.connect('codex');const first=codex.worker;assert.equal(authenticate(scopes,first).provider,'codex');assert.deepEqual(Object.keys(first.tokens),['mcp']);settings.codexPath='different-fixture-codex';await hub.connect('codex');const second=codex.worker;assert.notEqual(second.tokens.mcp,first.tokens.mcp);assert.equal(authenticate(scopes,first),null);assert.equal(authenticate(scopes,second).provider,'codex');
 await hub.configure('codex',{contextWindow:8192});const third=codex.worker;assert.notEqual(third.tokens.mcp,second.tokens.mcp);assert.equal(authenticate(scopes,second),null);assert.equal(authenticate(scopes,third).provider,'codex');codex.process=null;codex.emit('event',{method:'studio/codexDisconnected',params:{reason:'fixture-crash'}});assert.equal(authenticate(scopes,third),null);
});
test('Provider switch revokes old child access, deepseek lease stays provider-fixed and disconnect cannot recreate it',async t=>{
 const {scopes,hub,codex}=await fixture(t);await hub.connect('codex');const old=codex.worker;await hub.connect('deepseek');assert.equal(authenticate(scopes,old),null);const bridge=hub.bridge('deepseek'),connection=bridge.getWorker();assert.equal(authenticate(scopes,connection).provider,'deepseek');assert.equal(hub.bridgeWorkers.get('codex'),undefined);hub.disconnect('deepseek');assert.equal(authenticate(scopes,connection),null);assert.equal(bridge.getWorker(),undefined);assert.equal(scopes.scopes.has('deepseek'),false);
});
});
