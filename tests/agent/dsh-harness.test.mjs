import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {DshBridge,dshLegacyContext,dshPublicItemId,normalizeDshPublicTurns} from '../../agent/providers/dsh.mjs';
import {dshToolAllowed,checkDshInventory} from '../../agent/providers/dsh-policy.mjs';
import {dshRuntime,prepareDshProfile,scopedDshWorker} from '../../desktop/platform/dsh-runtime.mjs';

function catalog(){const values=new Map();return {get:(k,id)=>values.get(k+':'+id),put:(k,id,v)=>values.set(k+':'+id,structuredClone(v)),values};}
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-dsh-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const credential={apiKey:'sk-synthetic-dsh-contract'};
function fixtureBridge(extra={}){return new DshBridge({root:'.',catalog:catalog(),credential:()=>credential,worker:()=>null,fetchApi:async()=>Response.json({data:[{id:'deepseek-flash'}]}),...extra});}

test('DSH uses an affirmative official kernel and only its explicit credential environment',t=>{
 const root=temporary(t),token='synthetic-tool-token',worker={url:'http://127.0.0.1:31415/providers/deepseek',tokens:{mcp:token,admin:'never-shared'},context:{taskId:'task'}};
 const p=prepareDshProfile(root,{mcpModule:'file:///official/mcp.js',toolsModule:'file:///official/tools.js'},worker,'AIMatterLab instructions',{models:['deepseek-flash']});
 const text=fs.readFileSync(path.join(p.home,'profiles','studio','cordis.patch.yml'),'utf8'),entries=JSON.parse(text)[0].insert;
 assert(entries.some(v=>v.name==='@deepseek-ai/dsh-agent-loop'));assert(entries.some(v=>v.name==='@deepseek-ai/dsh-sdk-jsonrpc-server'));
 assert(entries.every(v=>!/@deepseek-ai\/dsh-(tool-(?:fs|bash|pwsh|subagent|working-directory)|skill-|web-|subagent|ptc)/.test(v.name)));
 assert(!text.includes(token));assert(!text.includes('never-shared'));assert.equal(p.env.GSS_MCP_TOKEN,token);assert.equal(p.env.DEEPSEEK_BASE_URL,'https://api.deepseek.com/anthropic');assert.equal(p.env.DEEPSEEK_API_KEY,'');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(p.home,'profiles','studio','package.json'),'utf8')).dsh.profile.bundles,[]);
 for(const url of ['http://127.0.0.1:31415/mcp','http://127.0.0.1:31415/providers/codex','https://remote.invalid/providers/deepseek'])assert.throws(()=>scopedDshWorker({...worker,url}));
});
test('DSH inventory rejects native tools, duplicates and missing tools; setup exceptions remain bounded',()=>{
 const names=new Set(['mcp__gpusampling__run_status','mcp__gpusampling__present_task']);
 for(const list of [['bash'],['mcp__gpusampling__run_status'],['mcp__gpusampling__run_status','mcp__gpusampling__run_status']])assert.throws(()=>checkDshInventory(list,names));
 assert.deepEqual(checkDshInventory([...names],names),[...names]);assert(dshToolAllowed('describe_engine',false));assert(dshToolAllowed('draft_cluster_setup',false));assert(dshToolAllowed('draft_local_environment',false));assert(!dshToolAllowed('present_task',false));assert(dshToolAllowed('present_task',true));
 for(const name of ['submit_run','validate_run','cancel_run','validate_cluster_run','submit_cluster_run','cancel_cluster_run','reconcile_run']){assert(dshToolAllowed(name,true));assert(!dshToolAllowed(name,false));}
 for(const name of ['bash','run_shell_command','spawn_agent'])assert(!dshToolAllowed(name,true));
});
for(const action of ['close','replace'])test('A pending DSH model catalog cannot launch or mutate state after '+action,async()=>{
 let release,spawns=0,current=credential;const response=new Promise(r=>release=r),b=fixtureBridge({credential:()=>current,fetchApi:()=>response,host:{resolve:()=>{spawns++;throw Error('late spawn');}}});
 const pending=b.start();if(action==='close')b.close();else current={apiKey:'sk-replacement-dsh-contract'};release(Response.json({data:[{id:'stale-catalog-model'}]}));await assert.rejects(pending,/selection changed/);assert.equal(spawns,0);assert.equal(b.models.length,0);assert(!b.process);b.close();
});
test('A cancelled DSH launch cannot clear the readiness waiter of an immediate reconnect',async()=>{
 let spawns=0;const host={resolve:()=>({file:'fixture-dsh',args:[],version:'fixture'}),prepare:()=>({cwd:process.cwd(),args:[],env:{}}),spawn:()=>{
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};const sequence=++spawns;
  child.stdin.on('data',data=>{const request=JSON.parse(String(data));if(sequence!==2)return;setImmediate(()=>{child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{serverInfo:{name:'deepseek-harness-sdk-runtime'}}})+'\n');child.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'studio/dshIsolation',params:{status:'verified',tools:[],nativeTools:0}})+'\n');});});return child;
 }};
 const b=fixtureBridge({host}),first=b.start(),rejected=assert.rejects(first,/closed/);await new Promise(r=>setImmediate(r));assert.equal(spawns,1);b.close();const second=b.start();await rejected;assert.equal((await second).studioIsolation.status,'verified');assert.equal(spawns,2);assert(b.process);b.close();
});
test('Legacy DSH migration preserves public history and never replays tool calls or private reasoning',()=>{
 const store=catalog(),old={id:'old-public-id',name:'Kept conversation',model:'deepseek-flash',effort:'none',messages:[{role:'assistant',reasoning_content:'PRIVATE_CHAIN',tool_calls:[{id:'UNKNOWN_OPERATION'}]}],turns:[{id:'old-turn',status:'inProgress',items:[{type:'userMessage',text:'Original user question'},{type:'agentMessage',text:'Original answer'},{id:'UNKNOWN_OPERATION',type:'mcpToolCall',status:'inProgress',arguments:{secret:'PRIVATE_TOOL_DATA'}}]}]};store.put('deepseek-history',old.id,old);
 const b=fixtureBridge({catalog:store}),s=b.session(old.id);assert.equal(s.id,old.id);assert.notEqual(s.nativeId,old.id);assert.equal(s.schemaVersion,1);assert.equal(s.effort,'off');assert.equal(s.turns[0].status,'failed');assert.equal(s.turns[0].items[2].status,'failed');assert.deepEqual(store.get('deepseek-history',old.id),old);
 const reference=dshLegacyContext(s.turns);assert(reference.includes('Original user question'));assert(reference.includes('Original answer'));assert(!reference.includes('PRIVATE_CHAIN'));assert(!reference.includes('PRIVATE_TOOL_DATA'));assert(!reference.includes('UNKNOWN_OPERATION'));assert.equal(s.nativeStarted,false);b.close();
});

test('repeated SDK attempt and tool-call IDs in two turns preserve both replies and match each original native result',()=>{
 const b=fixtureBridge(),events=[],s={schemaVersion:1,harness:'dsh',id:'owned-dsh-thread',nativeId:'owned-native-session',turns:[],updatedAt:1};b.sessions.set(s.id,s);b.on('event',event=>events.push(event));
 for(const [index,text]of ['First complete answer','Second complete answer'].entries()){
  const turn={id:'turn-'+index,status:'inProgress',items:[{id:'user-'+index,type:'userMessage',text:'Question '+index}]},active={turn,output:false};s.turns.push(turn);b.activeTurns.set(s.id,active);
  b.receive({method:'studio/dshText',params:{sessionId:s.nativeId,attemptId:'attempt-1',text:text.slice(0,8)}});
  b.sessionEvent({sessionId:s.nativeId,event:{type:'assistant/message',data:{stream:{attemptId:'attempt-1'},message:{id:'native-message-1',content:[{type:'text',text},{type:'tool-call',id:'native-call-1',name:'mcp__gpusampling__run_status',arguments:{run_id:'run-'+index}}]}}}});
  b.sessionEvent({sessionId:s.nativeId,event:{type:'tool/result',data:{message:{source:{callId:'native-call-1'},content:[{type:'text',text:'result-'+index}],isError:false}}}});b.finish(s,active,'completed');
 }
 const thread=b.publicThread(s),items=thread.turns.flatMap(turn=>turn.items);assert.equal(new Set(items.map(item=>item.id)).size,items.length);
 for(const [index,turn]of thread.turns.entries()){const answer=turn.items.find(item=>item.type==='agentMessage'),tool=turn.items.find(item=>item.type==='mcpToolCall');assert.equal(answer.text,index?'Second complete answer':'First complete answer');assert.equal(tool.status,'completed');assert.equal(tool.result.content[0].text,'result-'+index);assert.equal(tool.arguments.run_id,'run-'+index);}
 const deltas=events.filter(event=>event.method==='item/agentMessage/delta');assert.equal(deltas.length,2);assert.notEqual(deltas[0].params.itemId,deltas[1].params.itemId);assert.equal(deltas[0].params.turnId,'turn-0');assert.equal(deltas[1].params.turnId,'turn-1');assert.equal(deltas[0].params.itemId,thread.turns[0].items.find(item=>item.type==='agentMessage').id);assert.equal(deltas[1].params.itemId,thread.turns[1].items.find(item=>item.type==='agentMessage').id);b.close();
});

test('legacy repeated public item IDs normalize for replay without rewriting stored history or native routing IDs',()=>{
 const b=fixtureBridge(),session={id:'old-thread',nativeId:'original-sdk-session',turns:[{id:'old-turn-1',items:[{id:'assistant',type:'agentMessage',text:'Original first final'}]},{id:'old-turn-2',items:[{id:'assistant',type:'agentMessage',text:'Original second final'}]}]},before=structuredClone(session),catalogBefore=JSON.stringify([...b.catalog.values]);
 const first=b.publicThread(session),second=b.publicThread(session);assert.notEqual(first.turns[0].items[0].id,first.turns[1].items[0].id);assert.deepEqual(second,first);assert.deepEqual(session,before);assert.equal(JSON.stringify([...b.catalog.values]),catalogBefore);assert.equal(first.turns[0].items[0].text,'Original first final');assert.equal(session.nativeId,'original-sdk-session');b.close();
});

test('public item normalization is deterministic and preserves native request correlation outside display identities',()=>{
 const original=[{id:'turn',items:[{id:'native-call',type:'mcpToolCall',arguments:{id:'unchanged-native-argument'}},{id:'native-message',type:'agentMessage',text:'Kept answer'}]}],copy=structuredClone(original),normalized=normalizeDshPublicTurns('thread',original);
 assert.deepEqual(original,copy);assert.deepEqual(normalizeDshPublicTurns('thread',normalized),normalized);assert.equal(normalized[0].items[0].arguments.id,'unchanged-native-argument');assert.equal(normalized[0].items[0].id,dshPublicItemId('thread','turn','mcpToolCall','native-call'));assert.notEqual(normalized[0].items[0].id,dshPublicItemId('other-thread','turn','mcpToolCall','native-call'));
 const b=fixtureBridge(),sent=[];b.process={stdin:{destroyed:false,write:value=>sent.push(JSON.parse(value))},kill(){}};b.receive({id:'native-request-id',method:'approval/request',params:{toolCallId:'native-call'}});assert.equal(sent[0].id,'native-request-id');assert.deepEqual(sent[0].result,{outcome:'rejected'});b.close();
});

function messagesStream(index,{tool,text='Official harness fixture output'}={}){
 const events=[{type:'message_start',message:{id:'fixture-message-'+index,type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:12,output_tokens:0}}},{type:'content_block_start',index:0,content_block:tool?{type:'tool_use',id:'fixture-call-'+index,name:tool.name,input:{}}:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:tool?{type:'input_json_delta',partial_json:JSON.stringify(tool.args||{})}:{type:'text_delta',text}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:3}},{type:'message_stop'}];
 return events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join('');
}
async function nativeFixture(t,{responses=[{tool:{name:'mcp__gpusampling__run_status',args:{id:'fixture'}}},{}],toolCatalog}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-dsh-native-')),store=catalog(),calls=[],events=[],children=[];let count=0,held;
 const server=createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;const body=text?JSON.parse(text):{};calls.push({url:req.url,authorization:req.headers.authorization,apiKey:req.headers['x-api-key'],body});
  res.setHeader('Content-Type','application/json');
  if(req.url==='/models'){res.end(JSON.stringify({data:[{id:'deepseek-flash'}]}));return;}
  if(req.url==='/providers/deepseek/mcp'){
   const tools=toolCatalog||[{name:'run_status',description:'Read fixture saved status',inputSchema:{type:'object',properties:{id:{type:'string'}}}},{name:'submit_run',description:'Forbidden submission',inputSchema:{type:'object'}},{name:'present_task',description:'Save fixture draft',inputSchema:{type:'object',properties:{task_id:{type:'string'}}}}];
   res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.method==='tools/list'?{tools}:{content:[{type:'text',text:JSON.stringify({status:'fixture-only'})}]}}));return;
  }
  if(req.url==='/v1/messages'){
   const response=responses[count++]||{};res.writeHead(200,{'Content-Type':'text/event-stream'});if(response.hold){held=res;res.write(': fixture waiting\n\n');return;}res.end(messagesStream(count,response));return;
  }
  res.writeHead(404);res.end('{}');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const host={...dshRuntime,prepare:(...args)=>{const p=dshRuntime.prepare(...args);p.env.DEEPSEEK_BASE_URL=base;return p;},spawn:(...args)=>{const child=dshRuntime.spawn(...args);children.push(child);child.stderr.on('data',v=>fs.appendFileSync(path.join(root,'stderr.txt'),v));return child;}};
 const b=fixtureBridge({root,catalog:store,worker:()=>({url:base+'/providers/deepseek',tokens:{mcp:'fixture-scoped-tool-token',admin:'never-shared'},context:{}}),fetchApi:(url,opts)=>fetch(url.replace('https://api.deepseek.com',base),opts),host});b.on('event',e=>events.push(e));
 t.after(async()=>{b.close();held?.destroy();await Promise.all(children.map(child=>child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(r=>child.once('close',r))));server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {b,root,store,calls,events,children,get count(){return count;}};
}
function completion(b){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture turn did not finish')),20000);const listener=e=>{if(e.method==='turn/completed'){clearTimeout(timer);b.off('event',listener);resolve(e.params.turn);}};b.on('event',listener);});}

test('real official SDK two-turn attempt reuse keeps the first final intact in live events and saved replay',{timeout:60000},async t=>{
 const f=await nativeFixture(t,{responses:[{text:'First official SDK complete reply'},{text:'Second official SDK complete reply'}]});await f.b.start();const thread=await f.b.request('thread/start');
 const firstDone=completion(f.b);await f.b.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'First local fixture question'}]});assert.equal((await firstDone).status,'completed');
 const first=(await f.b.request('thread/read',{threadId:thread.thread.id})).thread,firstIds=new Set(first.turns[0].items.map(item=>item.id)),boundary=f.events.length;
 const secondDone=completion(f.b);await f.b.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Second local fixture question'}]});assert.equal((await secondDone).status,'completed');
 const replay=(await f.b.request('thread/read',{threadId:thread.thread.id})).thread;assert.equal(replay.turns.length,2);assert.deepEqual(replay.turns[0],first.turns[0]);assert.equal(replay.turns[0].items.find(item=>item.type==='agentMessage').text,'First official SDK complete reply');assert.equal(replay.turns[1].items.find(item=>item.type==='agentMessage').text,'Second official SDK complete reply');
 const allItems=replay.turns.flatMap(turn=>turn.items);assert.equal(new Set(allItems.map(item=>item.id)).size,allItems.length);
 for(const event of f.events.slice(boundary).filter(event=>['item/agentMessage/delta','item/started','item/completed'].includes(event.method))){const itemId=event.params.itemId||event.params.item.id;assert(!firstIds.has(itemId));assert.equal(event.params.turnId,replay.turns[1].id);}
 assert.equal(f.calls.filter(call=>call.url==='/v1/messages').length,2,'Exactly the intended two local fixture model requests');
});

test('Real official DSH loop uses scoped tools, rejects forged native tools, reports real efforts and resumes exact state',{timeout:60000},async t=>{
 const f=await nativeFixture(t,{responses:[{tool:{name:'bash',args:{command:'must never execute'}}},{tool:{name:'mcp__gpusampling__run_status',args:{id:'fixture'}}},{}]});
 const info=await f.b.start();assert.equal(info.agentInfo.version,'0.2.2-rc.1');assert.deepEqual(info.studioIsolation.tools,['mcp__gpusampling__run_status']);
 const models=await f.b.request('model/list');assert.deepEqual(models.data[0].supportedReasoningEfforts.map(v=>v.reasoningEffort),['none','low','high','max']);assert.equal(models.data[0].defaultReasoningEffort,'none');
 const thread=await f.b.request('thread/start'),done=completion(f.b);await f.b.request('turn/start',{threadId:thread.thread.id,effort:'none',input:[{type:'text',text:'Read the fixture saved status'}]});assert.equal((await done).status,'completed');
 const api=f.calls.filter(c=>c.url==='/v1/messages'),tools=f.calls.filter(c=>c.body.method==='tools/call');assert.equal(api.length,3);assert.equal(tools.length,1);assert.equal(tools[0].body.params.name,'run_status');assert.equal(tools[0].authorization,'Bearer fixture-scoped-tool-token');assert(api.every(c=>c.apiKey===credential.apiKey));assert(api.every(c=>JSON.stringify(c.body.tools).includes('mcp__gpusampling__run_status')&&!JSON.stringify(c.body.tools).includes('submit_run')));assert.equal(api[0].body.thinking.type,'disabled');
 assert(f.events.some(e=>e.method==='item/agentMessage/delta'&&e.params.delta.includes('Official harness fixture output')));assert(!JSON.stringify(f.events).includes('fixture-scoped-tool-token'));
 const before=f.count;f.b.close();await f.b.start();const restored=await f.b.request('thread/resume',{threadId:thread.thread.id});assert.equal(restored.thread.id,thread.thread.id);assert.equal(restored.thread.turns.length,1);assert.equal(f.count,before,'resume must not start a model turn');
 const highDone=completion(f.b);await f.b.request('turn/start',{threadId:thread.thread.id,effort:'high',input:[{type:'text',text:'Continue the same saved fixture session'}]});assert.equal((await highDone).status,'completed');const high=f.calls.filter(c=>c.url==='/v1/messages').at(-1).body;assert.equal(high.max_tokens,32768);assert.equal(high.thinking.type,'enabled');
});
test('First-task scope can expand only through a new DSH profile and an explicit main-authored workflow turn',{timeout:60000},async t=>{
 const f=await nativeFixture(t,{responses:[{tool:{name:'mcp__gpusampling__present_task',args:{task_id:'owned-task'}}},{}]});await f.b.start();const before=f.children.length,thread=await f.b.request('thread/start'),done=completion(f.b);
 await f.b.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Save the reviewed fixture draft'}],studioToolContext:{mode:'workflow',taskId:'owned-task',projectId:'owned-project'}});assert.equal((await done).status,'completed');assert(f.children.length>before);assert.equal(f.calls.find(c=>c.body.method==='tools/call').body.params.name,'present_task');
 assert(f.b.info.studioIsolation.tools.includes('mcp__gpusampling__present_task'));
});
test('Interrupting an official DSH runtime marks the existing turn cancelled and never resends it',{timeout:60000},async t=>{
 const f=await nativeFixture(t,{responses:[{hold:true}]});await f.b.start();const thread=await f.b.request('thread/start'),done=completion(f.b);await f.b.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Wait in the local fixture'}]});
 for(let i=0;i<100&&!f.count;i++)await new Promise(r=>setTimeout(r,10));assert.equal(f.count,1);await f.b.request('turn/interrupt',{threadId:thread.thread.id});assert.equal((await done).status,'cancelled');assert.equal(f.b.activeTurns.size,0);assert.equal(f.b.process,null);assert.equal(f.count,1);
});

test('actual official DSH chat runtime registers project skills and forwards model tool calls',{timeout:60000},async t=>{
 const {ProjectSkills}=await import('../../agent/skills/project-skills.mjs');
 const tools=new ProjectSkills({root:'.',current:()=>null}).tools();
 const f=await nativeFixture(t,{toolCatalog:tools,responses:[{tool:{name:'mcp__gpusampling__read_project_skill',args:{name:'local-analysis'}}},{}]});
 const info=await f.b.start();
 assert.deepEqual(info.studioIsolation.tools,[...tools.map(tool=>'mcp__gpusampling__'+tool.name)].sort());
 const thread=await f.b.request('thread/start'),done=completion(f.b);
 await f.b.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Read the project skill'}]});
 assert.equal((await done).status,'completed');
 const request=f.calls.find(call=>call.url==='/v1/messages').body;
 assert.match(JSON.stringify(request.system),/project_skill_catalog/);
 assert(request.tools.some(tool=>tool.name==='mcp__gpusampling__write_project_skill'));
 assert.equal(f.calls.find(call=>call.body.method==='tools/call').body.params.name,'read_project_skill');
});
