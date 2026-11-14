import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {CodexApiBridge} from '../../agent/providers/codex-api.mjs';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createCodexApiRuntime,codexApiHome,prepareApiModelCeiling} from '../../desktop/platform/codex-api-runtime.mjs';
import {assertModelCeiling} from '../../desktop/platform/codex-model-ceiling.mjs';
import {prepareIsolation,ISOLATION_FEATURES} from '../../desktop/platform/codex-isolation.mjs';

const configured={apiKey:'sk-synthetic-custom-secret',baseUrl:'https://vendor.example/v1',model:'vendor/model',reasoningMode:'omit',reasoningEffort:'',label:'Custom'};
test('connection notifications without a thread reach the frontend with a real SQLite catalog',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-api-events-'));
 const catalog=new Catalog(root);
 t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});
 const f=fixture(t,{catalog});
 await f.b.start();
 for(const method of ['studio/codexVersionWarning','studio/toolsWarning','studio/codexDisconnected']){
  f.natives[0].emit('event',{method,params:{}});
  assert.equal(f.events.at(-1).method,method);
 }
 assert.deepEqual(catalog.keys('compatible-codex-thread'),[]);
});
function store(){const values=new Map(),writes=[];return {writes,put:(kind,id,value)=>{writes.push({kind,id});values.set(kind+':'+id,structuredClone(value));},get:(kind,id)=>structuredClone(values.get(kind+':'+id)||null),list:kind=>[...values].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>structuredClone(value))};}
function fixture(t,{catalog=store(),credential={...configured},reject,worker=null}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-codex-api-')),calls=[],events=[],natives=[],gateways=[];
 const b=new CodexApiBridge({root,catalog,credential:()=>credential,worker:()=>worker,executable:()=>'/fixture/codex',gatewayFactory:async value=>{gateways.push(value);return {baseUrl:'http://127.0.0.1:12345/v1',apiKey:'loopback-random-token',close:()=>{}};},bridgeFactory:options=>{
  const native=new EventEmitter();native.activeTurns=new Set();native.start=async(...args)=>{calls.push(['start',args]);native.process={};return {fixture:true};};native.close=()=>{native.process=null;};native.respond=(...args)=>calls.push(['respond',args]);
  native.request=async(method,params)=>{calls.push([method,structuredClone(params)]);if(reject?.method===method)throw reject.error;if(method==='thread/start'){const id='native-'+natives.length;native.emit('event',{method:'thread/started',params:{thread:{id,turns:[]}}});return {thread:{id,turns:[]},model:configured.model};}if(method==='thread/resume'||method==='thread/read')return {thread:{id:params.threadId,turns:[{id:'restored',status:'completed',items:[]}]},model:configured.model};if(method==='turn/start')return {turn:{id:'turn',status:'inProgress'}};return {};};natives.push(native);return native;
 }});b.on('event',event=>events.push(event));t.after(()=>{b.close();fs.rmSync(root,{recursive:true,force:true});});
 return {b,catalog,calls,events,natives,gateways,root,setCredential:value=>{credential=value;},setWorker:value=>{worker=value;}};
}
test('custom API starts a strict Codex harness and advertises only the configured model',async t=>{const f=fixture(t);await f.b.start();assert.equal(f.gateways.length,1);assert.equal(f.gateways[0].credential.apiKey,configured.apiKey);assert.equal(f.calls[0][0],'start');const models=await f.b.request('model/list');assert.deepEqual(models.data.map(value=>value.model),[configured.model]);assert.deepEqual(models.data[0].supportedReasoningEfforts,[]);await assert.rejects(f.b.request('model/select',{model:'other'}),/configured/);});
test('first native empty thread resumes in the same process without asking for a nonexistent rollout',async t=>{const f=fixture(t);await f.b.start();const thread=await f.b.request('thread/start',{}),id=thread.thread.id;await f.b.request('thread/resume',{threadId:id});assert.equal(f.calls.filter(([method])=>method==='thread/resume').length,0);assert.equal((await f.b.request('thread/read',{threadId:id})).thread.id,id);});
test('worker lease rotation restarts the native process and stable context reuses it',async t=>{const first={url:'http://127.0.0.1:12345/providers/compatible',tokens:{mcp:'first-token'}},f=fixture(t,{worker:first});await f.b.start();await f.b.start();assert.equal(f.natives.length,1);f.setWorker({...first,tokens:{mcp:'rotated-token'}});await f.b.start();assert.equal(f.natives.length,2);assert.equal(f.natives[0].process,null);assert.equal(f.calls.filter(([method])=>method==='start')[1][1][1].tokens.mcp,'rotated-token');});
test('closing an in-flight startup disposes its gateway and allows a fresh explicit connection',async t=>{const f=fixture(t),factory=f.b.gatewayFactory;let release,closed=0;const pendingGateway=new Promise(resolve=>release=resolve);f.b.gatewayFactory=async options=>{await pendingGateway;const gateway=await factory(options);return {...gateway,close:()=>{closed++;}};};const old=f.b.start();f.b.close();const fresh=f.b.start();release();await assert.rejects(old,/cancelled/);await fresh;assert.equal(f.natives.length,1);assert.equal(closed,1);assert(f.b.process);});
test('versioned migration preserves legacy identity and injects inert text only on the first authorized new turn',async t=>{
 const catalog=store();catalog.put('compatible-history','old',{id:'old',apiEndpoint:configured.baseUrl,model:configured.model,name:'Existing',messages:[{role:'user',content:'old request'},{role:'assistant',content:'old answer',tool_calls:[{id:'never-repeat'}]},{role:'tool',content:'sensitive tool result'}],turns:[{id:'old-turn',status:'completed',items:[]}]});
 const f=fixture(t,{catalog});await f.b.start();const resumed=await f.b.request('thread/resume',{threadId:'old'});assert.equal(resumed.thread.id,'old');assert.equal(resumed.thread.turns[0].id,'old-turn');assert.equal(f.calls.filter(([method])=>method==='turn/start').length,0);assert.equal(catalog.get('compatible-codex-thread','old').schemaVersion,1);
 await f.b.request('turn/start',{threadId:'old',input:[{type:'text',text:'new request'}],studioToolContext:{mode:'chat'}});
 const first=f.calls.find(([method])=>method==='turn/start')[1];assert.match(first.input[0].text,/historical data/);assert.match(first.input[0].text,/old answer/);assert(!JSON.stringify(first).includes('never-repeat'));assert(!JSON.stringify(first).includes('sensitive tool result'));assert.equal(first.threadId,'native-1');assert.equal(first.studioToolContext,undefined);
 await f.b.request('turn/start',{threadId:'old',input:[{type:'text',text:'second request'}]});assert.equal(f.calls.filter(([method])=>method==='turn/start')[1][1].input.length,1);assert.equal(catalog.get('compatible-history','old').messages.length,3);
 f.natives[0].emit('event',{method:'turn/started',params:{threadId:'native-1',turn:{id:'real-turn'}}});f.natives[0].emit('event',{method:'item/agentMessage/delta',params:{threadId:'native-1',turnId:'real-turn',itemId:'reply',delta:'actual output'}});f.natives[0].emit('event',{method:'turn/completed',params:{threadId:'native-1',turn:{id:'real-turn',status:'completed'}}});assert(f.events.every(event=>event.provider==='compatible'));assert.equal(f.events.at(-1).params.threadId,'old');assert.equal(f.events.at(-1).params.turn.modelOutputReceived,true);
});
test('changed endpoints never receive legacy or native conversation content',async t=>{const f=fixture(t);await f.b.start();const id=(await f.b.request('thread/start')).thread.id;const before=f.calls.length;f.setCredential({...configured,baseUrl:'https://other.example/v1'});await assert.rejects(f.b.request('turn/start',{threadId:id,input:[{type:'text',text:'private'}]}),/API 配置已变化/);assert.equal(f.calls.length,before);assert.equal((await f.b.request('thread/read',{threadId:id})).thread.id,id);});
test('unknown first-turn transport failures never reuse the empty thread receipt',async t=>{const failure={method:'turn/start',error:Error('transport lost')},f=fixture(t,{reject:failure});await f.b.start();const id=(await f.b.request('thread/start')).thread.id;await assert.rejects(f.b.request('turn/start',{threadId:id,input:[{type:'text',text:'new'}]}),/transport lost/);assert.equal(f.catalog.get('compatible-codex-thread',id).state,'unknown');assert.equal(f.b.emptyThreads.has(id),false);});
test('an explicit first-turn rejection preserves the empty native thread for a user retry',async t=>{const failure={method:'turn/start',error:Object.assign(Error('invalid input'),{rpcResponse:true})},f=fixture(t,{reject:failure});await f.b.start();const id=(await f.b.request('thread/start')).thread.id;await assert.rejects(f.b.request('turn/start',{threadId:id,input:[{type:'text',text:'new'}]}),/invalid input/);assert.equal(f.catalog.get('compatible-codex-thread',id).state,'empty');assert.equal(f.b.emptyThreads.has(id),true);});
test('saved custom reasoning remains a gateway parameter without inventing a native Codex effort enum',async t=>{const f=fixture(t,{credential:{...configured,reasoningMode:'reasoning_effort',reasoningEffort:'vendor-specific'}});await f.b.start();assert.equal((await f.b.request('model/list')).data[0].defaultReasoningEffort,'vendor-specific');const id=(await f.b.request('thread/start')).thread.id;await f.b.request('turn/start',{threadId:id,effort:'vendor-specific',input:[{type:'text',text:'test'}]});assert.equal(f.calls.find(([method])=>method==='turn/start')[1].effort,undefined);});
test('custom model usage excludes native estimates and reports only observed upstream counts with unknown context size',async t=>{const f=fixture(t);await f.b.start();const id=(await f.b.request('thread/start')).thread.id;const count=f.events.length;f.natives[0].emit('event',{method:'thread/tokenUsage/updated',params:{threadId:id,tokenUsage:{modelContextWindow:200000,last:{totalTokens:999}}}});assert.equal(f.events.length,count);f.natives[0].activeTurns.add(id);f.gateways[0].onUsage({input_tokens:17,output_tokens:5,total_tokens:22});const event=f.events.at(-1);assert.equal(event.params.tokenUsage.source,'upstream-api');assert.equal(event.params.tokenUsage.last.totalTokens,22);assert.equal(event.params.tokenUsage.modelContextWindow,null);assert.equal(event.params.threadId,id);});
test('streamed token bursts update memory without per-token persistence and completion saves the real receipt',async t=>{const f=fixture(t);await f.b.start();const id=(await f.b.request('thread/start')).thread.id,native=f.natives[0];native.emit('event',{method:'turn/started',params:{threadId:id,turn:{id:'turn-stream'}}});const before=f.catalog.writes.length;for(let n=0;n<25;n++)native.emit('event',{method:'item/agentMessage/delta',params:{threadId:id,turnId:'turn-stream',itemId:'message-stream',delta:'x'}});assert.equal(f.catalog.writes.length,before);native.emit('event',{method:'item/completed',params:{threadId:id,turnId:'turn-stream',item:{id:'message-stream',type:'agentMessage',text:'x'.repeat(25)}}});assert.equal(f.catalog.writes.length,before+1);assert.equal(f.catalog.get('compatible-codex-thread',id).nativeTurns[0].items[0].text,'x'.repeat(25));});
test('custom API process env cannot inherit user Codex login or external provider credentials',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-codex-api-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const home=codexApiHome(root,configured.baseUrl),calls=[];const runtime={execute:async(...args)=>{calls.push(args);return {stdout:''};},spawnProcess:(...args)=>{calls.push(args);return {};}};
 const host=createCodexApiRuntime({home,credential:configured,gateway:{apiKey:'private-loopback',baseUrl:'http://127.0.0.1:1/v1'},runtime});await host.execute('cli',['--version'],{env:{CODEX_HOME:'private-user-home',OPENAI_API_KEY:'user-key'}});host.spawnProcess('cli',['app-server'],{env:{CODEX_HOME:'private-user-home',OPENAI_API_KEY:'user-key',GSS_MCP_TOKEN:'scoped-token'}});
 assert.equal(calls[0][2].env.CODEX_HOME,home);assert.equal(calls[0][2].env.STUDIO_COMPATIBLE_API_KEY,undefined);assert.equal(calls[1][2].env.STUDIO_COMPATIBLE_API_KEY,'private-loopback');assert.equal(calls[1][2].env.GSS_MCP_TOKEN,'scoped-token');assert.equal(calls[1][2].env.OPENAI_API_KEY,undefined);assert(!JSON.stringify(calls).includes(configured.apiKey));assert.equal(codexApiHome(root,configured.baseUrl),home);
});
test('custom model ceiling pins only the configured model and disables native tool families',t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-codex-api-catalog-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const receipt=prepareApiModelCeiling(root,'AIMatterLab instructions',configured);assertModelCeiling(receipt);const {models}=JSON.parse(fs.readFileSync(receipt.path));assert.deepEqual(models.map(model=>model.slug),[configured.model]);assert.equal(models[0].shell_type,'disabled');assert.equal(models[0].node_repl_disabled,true);assert.equal(models[0].tool_mode,'direct');assert.equal(models[0].context_window,undefined);});
test('strict isolation accepts the compatible scope only when explicitly selected by main',async t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-codex-api-scope-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const dependencies={provider:'compatible',prepareModels:()=>({path:path.join(root,'models.json'),models:['custom']}),execute:async(_file,args)=>({stdout:args[0]==='features'?[...ISOLATION_FEATURES,'skip_host_skill_discovery'].map(feature=>feature+' stable false').join('\n'):'[]'}),probe:async()=>[]};const worker={url:'http://127.0.0.1:12345/providers/compatible',tokens:{mcp:'synthetic'}};assert.equal((await prepareIsolation('cli',root,{},worker,dependencies)).worker.url,worker.url);await assert.rejects(prepareIsolation('cli',root,{},worker,{...dependencies,provider:'codex'}),/scoped AIMatterLab loopback/);});


test('custom API sanitizes split stream, tool receipts, errors and persisted/read/export history before storage',async t=>{
 const token='fixture-private-loopback-capability',f=fixture(t,{worker:{url:'http://127.0.0.1:12345/providers/compatible',tokens:{mcp:token}}});await f.b.start();
 const id=(await f.b.request('thread/start')).thread.id,native=f.natives[0],send=(method,params)=>native.emit('event',{method,params:{threadId:id,...params}});
 send('turn/started',{turn:{id:'safe-turn'}});
 const split=Math.floor(token.length/2);send('item/agentMessage/delta',{turnId:'safe-turn',itemId:'reply',delta:'Echo '+token.slice(0,split)});
 send('item/started',{turnId:'safe-turn',item:{id:'tool',type:'mcpToolCall',arguments:{apiKey:configured.apiKey},result:{error:{message:'Bearer '+token}}}});
 const interim=JSON.stringify(f.catalog.get('compatible-codex-thread',id));assert(!interim.includes(token.slice(0,split)));
 send('item/agentMessage/delta',{turnId:'safe-turn',itemId:'reply',delta:token.slice(split)+' and '+configured.apiKey+' done'});
 send('turn/completed',{turn:{id:'safe-turn',status:'failed',error:{message:configured.apiKey+' '+token}}});
 const saved=JSON.stringify(f.catalog.get('compatible-codex-thread',id)),events=JSON.stringify(f.events),listed=JSON.stringify(await f.b.request('thread/list'));
 for(const secret of [configured.apiKey,token])for(const text of [saved,events,listed])assert(!text.includes(secret));
 assert.match(saved,/redacted/);assert.match(saved,/done/);
 const original=native.request;native.request=async(method,...args)=>{if(method==='thread/read')throw Error('error '+configured.apiKey+' '+token);return original(method,...args);};
 f.b.emptyThreads.delete(id);await assert.rejects(f.b.request('thread/read',{threadId:id}),error=>!error.message.includes(configured.apiKey)&&!error.message.includes(token));
});

test('legacy migration removes credentials from source history and inert model context without replay',async t=>{
 const catalog=store();catalog.put('compatible-history','legacy-secret',{id:'legacy-secret',apiEndpoint:configured.baseUrl,model:configured.model,name:configured.apiKey,messages:[{role:'user',content:'old '+configured.apiKey}],turns:[{id:'old',status:'failed',error:{message:configured.apiKey},items:[]}]});
 const f=fixture(t,{catalog});await f.b.start();await f.b.request('thread/resume',{threadId:'legacy-secret'});
 assert(!JSON.stringify(catalog.get('compatible-history','legacy-secret')).includes(configured.apiKey));
 await f.b.request('turn/start',{threadId:'legacy-secret',input:[{type:'text',text:'continue safely'}]});
 assert(!JSON.stringify(f.calls.find(([method])=>method==='turn/start')).includes(configured.apiKey));
 assert.equal(f.calls.filter(([method])=>method==='turn/start').length,1);
});


test('history reads and lists do not rewrite unchanged records, reorder recency or discard an unsaved live delta',async t=>{
 const f=fixture(t);await f.b.start();const id=(await f.b.request('thread/start')).thread.id,native=f.natives[0];f.b.sessions.get(id).updatedAt=123;f.b.save(f.b.sessions.get(id),{touch:false});const before=f.catalog.writes.length;
 await f.b.request('thread/read',{threadId:id});await f.b.request('thread/list');await f.b.request('thread/read',{threadId:id});assert.equal(f.catalog.writes.length,before);assert.equal(f.catalog.get('compatible-codex-thread',id).updatedAt,123);
 native.emit('event',{method:'turn/started',params:{threadId:id,turn:{id:'live-turn'}}});native.emit('event',{method:'item/agentMessage/delta',params:{threadId:id,turnId:'live-turn',itemId:'live-message',delta:'live unsaved text'}});
 const writes=f.catalog.writes.length;await f.b.request('thread/list');const read=await f.b.request('thread/read',{threadId:id});assert.equal(f.catalog.writes.length,writes);assert.equal(read.thread.turns[0].items[0].text,'live unsaved text');
});

test('an opaque sk-prefixed native thread and item retain routing identity while tool data stays redacted',async t=>{
 const f=fixture(t);await f.b.start();const catalog=f.catalog,id='sk-native-opaque-thread';catalog.put('compatible-codex-thread',id,{schemaVersion:1,id,nativeId:null,apiEndpoint:configured.baseUrl,model:configured.model,name:'Opaque history',nativeTurns:[{id:'sk-turn-opaque',status:'completed',items:[{id:'sk-item-opaque',type:'mcpToolCall',arguments:{id:'sk-synthetic-payload-secret'},result:{content:[{type:'text',text:'safe'}]}}]}],legacyTurns:[],state:'has_turns',updatedAt:123});
 const before=(await f.b.request('thread/read',{threadId:id})).thread;assert.equal(before.id,id);assert.equal(before.turns[0].id,'sk-turn-opaque');assert.equal(before.turns[0].items[0].id,'sk-item-opaque');assert.equal(before.turns[0].items[0].arguments.id,'[redacted]');
 f.b.sessions.get(id).nativeId=id;await f.b.request('thread/resume',{threadId:id});assert.equal(f.calls.filter(([method])=>method==='thread/resume').at(-1)[1].threadId,id);
});


test('custom API reasoning deltas also buffer a split configured credential outside agent-message text',async t=>{
 const key='fixture-bare-api-credential',f=fixture(t,{credential:{...configured,apiKey:key}});await f.b.start();const id=(await f.b.request('thread/start')).thread.id,native=f.natives[0];native.emit('event',{method:'turn/started',params:{threadId:id,turn:{id:'turn'}}});
 for(const delta of ['reason '+key.slice(0,12),key.slice(12)+' done'])native.emit('event',{method:'item/reasoning/textDelta',params:{threadId:id,turnId:'turn',itemId:'reason',delta}});
 native.emit('event',{method:'turn/completed',params:{threadId:id,turn:{id:'turn',status:'completed'}}});assert(!JSON.stringify(f.events).includes(key));assert.equal(f.b.streams.size,0);
});

test('custom API native thread receives project skill instructions without a scientific worker',async t=>{
 const f=fixture(t);
 await f.b.start();
 await f.b.request('thread/start');
 const start=f.calls.find(([method])=>method==='thread/start');
 assert.match(start[1].developerInstructions,/project_skill_catalog/);
 assert.match(start[1].developerInstructions,/write_project_skill/);
 assert.equal(start[1].sandbox,'read-only');
});
