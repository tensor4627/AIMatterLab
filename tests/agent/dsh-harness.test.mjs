import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {DshBridge,dshLegacyContext,dshPublicItemId,normalizeDshPublicTurns} from '../../agent/providers/dsh.mjs';
import {DSH_QUESTION_TOOL,dshToolAllowed,checkDshInventory} from '../../agent/providers/dsh-policy.mjs';
import {dshRuntime,prepareDshProfile,scopedDshWorker} from '../../desktop/platform/dsh-runtime.mjs';
import {baseWorkspaceTool} from '../../backend/main/workspace/base-workspace.mjs';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createChatAttachments} from '../../agent/sessions/chat-attachments.mjs';
import {chatAttachmentRefs} from '../../contracts/agent/chat-attachments.mjs';
import {TerminalMcp} from '../../agent/tools/terminal-mcp.mjs';
import {toolValueResult} from '../../agent/tools/tool-failure.mjs';
import {softwareDocDefinitions,softwareDocs} from '../../backend/main/tools/public-software-docs.mjs';

function catalog(){const values=new Map();return {get:(k,id)=>values.get(k+':'+id),put:(k,id,v)=>values.set(k+':'+id,structuredClone(v)),values};}
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-dsh-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const credential={apiKey:'sk-synthetic-dsh-contract'};
function fixtureBridge(extra={}){return new DshBridge({root:'.',catalog:catalog(),credential:()=>credential,worker:()=>null,fetchApi:async()=>Response.json({data:[{id:'deepseek-flash'}]}),...extra});}

for(const delayed of ['session/prompt','session/wait'])test('late '+delayed+' reconciles only its original DSH turn without resending',async t=>{
 const b=fixtureBridge(),requests=[],events=[];
 b.models=['fixture'];b.model='fixture';b.process={kill(){}};b.launch=async()=>{};
 b.on('event',e=>events.push(e));t.after(()=>b.close());
 const a=(await b.request('thread/start')).thread,other=(await b.request('thread/start')).thread;
 const native=b.session(a.id).nativeId,raw=b.raw.bind(b);
 b.raw=(method,params,timeout,late)=>raw(method,params,method===delayed&&params.sessionId===native?10:timeout,late);
 b.send=request=>{
  requests.push(request);
  if(request.method!==delayed||request.params.sessionId!==native)queueMicrotask(()=>b.receive({id:request.id,result:{}}));
 };
 const prompt=id=>b.request('turn/start',{threadId:id,input:[{type:'text',text:'one fixture message'}]});
 if(delayed==='session/prompt')await assert.rejects(prompt(a.id),/timed out/);else{
  const ended=new Promise(resolve=>b.on('event',e=>{if(e.method==='turn/completed'&&e.params.threadId===a.id)resolve();}));
  await prompt(a.id);await ended;
 }
 const original=b.session(a.id).turns[0];assert.equal(original.operationState,'unconfirmed');
 await assert.rejects(DshBridge.prototype.launch.call(b,'different-model','off'),/待核对/);
 await assert.rejects(prompt(a.id),/待核对/);
 await b.request('thread/resume',{threadId:a.id});
 await prompt(other.id);
 b.receive({method:'studio/dshText',params:{sessionId:native,text:'old partial text'}});
 b.sessionEvent({sessionId:native,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});
 assert(!events.some(e=>e.params?.delta==='old partial text'));
 const done=new Promise(resolve=>b.on('event',e=>{if(e.method==='studio/sessionReady')resolve(e);}));
 b.receive({id:requests.find(r=>r.method===delayed&&r.params.sessionId===native).id,result:{}});
 assert.equal((await done).params.turnId,original.id);
 assert.equal(original.lateReceipt.status,'completed');assert.equal(original.operationState,'reconciled');
 assert.match(original.error.message,/原服务已完成/);
 assert.equal(requests.filter(r=>r.method==='session/prompt'&&r.params.sessionId===native).length,1);
});

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
 for(const name of ['list_resource_tools','discover_resource_tool_scripts','plan_resource_tool_setup','read_resource_tool_setup']){
  assert(dshToolAllowed(name,false));assert(dshToolAllowed(name,true));
 }
 assert(!dshToolAllowed('start_resource_tool_setup',true));
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
  b.sessionEvent({sessionId:s.nativeId,event:{type:'turn/start',data:{turn:index+1}}});
  if(index)b.receive({method:'studio/dshText',params:{sessionId:s.nativeId,turn:index,attemptId:'attempt-1',text:'late previous output'}});
  b.receive({method:'studio/dshText',params:{sessionId:s.nativeId,turn:index+1,attemptId:'attempt-1',text:text.slice(0,8)}});
  b.sessionEvent({sessionId:s.nativeId,event:{type:'assistant/message',data:{stream:{attemptId:'attempt-1'},message:{id:'native-message-1',content:[{type:'text',text},{type:'tool-call',id:'native-call-1',name:'mcp__gpusampling__run_status',arguments:{run_id:'run-'+index}}]}}}});
  b.sessionEvent({sessionId:s.nativeId,event:{type:'tool/result',data:{message:{source:{callId:'native-call-1'},content:[{type:'text',text:'result-'+index}],isError:false}}}});b.finish(s,active,'completed');
 }
 const thread=b.publicThread(s),items=thread.turns.flatMap(turn=>turn.items);assert.equal(new Set(items.map(item=>item.id)).size,items.length);
 for(const [index,turn]of thread.turns.entries()){const answer=turn.items.find(item=>item.type==='agentMessage'),tool=turn.items.find(item=>item.type==='mcpToolCall');assert.equal(answer.text,index?'Second complete answer':'First complete answer');assert.equal(tool.status,'completed');assert.equal(tool.result.content[0].text,'result-'+index);assert.equal(tool.arguments.run_id,'run-'+index);}
 const deltas=events.filter(event=>event.method==='item/agentMessage/delta');assert.equal(deltas.length,2);assert.notEqual(deltas[0].params.itemId,deltas[1].params.itemId);assert.equal(deltas[0].params.turnId,'turn-0');assert.equal(deltas[1].params.turnId,'turn-1');assert.equal(deltas[0].params.itemId,thread.turns[0].items.find(item=>item.type==='agentMessage').id);assert.equal(deltas[1].params.itemId,thread.turns[1].items.find(item=>item.type==='agentMessage').id);b.close();
});

test('reports SDK todo snapshots and persists only confirmed compaction for the matching native turn',()=>{
 const bridge=fixtureBridge(),events=[],turn={id:'scoped-turn',status:'inProgress',items:[]};
 const session={schemaVersion:1,harness:'dsh',id:'owned-dsh-thread',nativeId:'owned-native-session',turns:[turn],updatedAt:1};
 bridge.sessions.set(session.id,session);
 bridge.activeTurns.set(session.id,{turn});
 bridge.on('event',event=>events.push(event));
 const emit=(type,data)=>bridge.sessionEvent({sessionId:session.nativeId,event:{type,data}});
 emit('turn/start',{turn:2});
 emit('todo/write',{todos:[{content:'Read file',status:'completed'},{content:'Verify target',status:'in_progress'},{content:'Guessed',status:'unknown'}]});
 emit('compaction/end',{turn:1,compactionId:'unrelated'});
 emit('compaction/end',{turn:2,compactionId:'failed',error:'transport unavailable'});
 emit('compaction/end',{turn:2,compactionId:'confirmed'});
 emit('compaction/end',{turn:2,compactionId:'confirmed'});
 assert.deepEqual(events.find(event=>event.method==='turn/plan/updated')?.params,{
  threadId:session.id,turnId:turn.id,plan:[{step:'Read file',status:'completed'},{step:'Verify target',status:'inProgress'}],
 });
 assert.equal(events.filter(event=>event.params.item?.type==='contextCompaction').length,1);
 assert.deepEqual(bridge.publicThread(session).turns[0].items.map(item=>item.type),['contextCompaction']);
 bridge.close();
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

function messagesStream(index,{tool,text='Official harness fixture output',model='deepseek-flash',stopReason=tool?'tool_use':'end_turn'}={}){
 const events=[{type:'message_start',message:{id:'fixture-message-'+index,type:'message',role:'assistant',model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:12,output_tokens:0}}},{type:'content_block_start',index:0,content_block:tool?{type:'tool_use',id:'fixture-call-'+index,name:tool.name,input:{}}:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:tool?{type:'input_json_delta',partial_json:JSON.stringify(tool.args||{})}:{type:'text_delta',text}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:stopReason,stop_sequence:null},usage:{output_tokens:3}},{type:'message_stop'}];
 return events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join('');
}
async function nativeFixture(t,{responses=[{tool:{name:'mcp__gpusampling__run_status',args:{id:'fixture'}}},{}],toolCatalog,allowDiscovery=()=>true,toolsConnected=true,toolCall=()=>({status:'fixture-only'}),confirmResourceChoice,worker,modelListing}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-dsh-native-')),store=catalog(),calls=[],events=[],children=[];let count=0,held;
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const payload=Buffer.concat(chunks);
  if(req.url==='/v1/files'&&req.method==='POST'){
   const form=await new Response(payload,{headers:{'Content-Type':req.headers['content-type']}}).formData(),file=form.get('file');
   const bytes=Buffer.from(await file.arrayBuffer());
   calls.push({url:req.url,apiKey:req.headers['x-api-key'],body:{name:file.name,mime:file.type,expiresSeconds:form.get('expires_after[seconds]'),bytes}});
   res.end(JSON.stringify({type:'file',id:'fixture-image-file',mime_type:file.type,size_bytes:bytes.length,created_at:new Date().toISOString(),filename:file.name}));
   return;
  }
  const body=payload.length?JSON.parse(payload.toString()):{};calls.push({url:req.url,authorization:req.headers.authorization,apiKey:req.headers['x-api-key'],body});
  if(req.url==='/models'){res.end(JSON.stringify({data:modelListing||[{id:'deepseek-flash'}]}));return;}
  if(req.url==='/providers/deepseek/mcp'){
   if(body.method==='tools/list'&&!allowDiscovery()){res.writeHead(403);res.end('private fixture response');return;}
   const tools=toolCatalog||[{name:'run_status',description:'Read fixture saved status',inputSchema:{type:'object',properties:{id:{type:'string'}}}},{name:'submit_run',description:'Forbidden submission',inputSchema:{type:'object'}},{name:'present_task',description:'Save fixture draft',inputSchema:{type:'object',properties:{task_id:{type:'string'}}}}];
   res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.method==='tools/list'?{tools}:{content:[{type:'text',text:JSON.stringify(await toolCall(body.params))}]}}));return;
  }
  if(req.url==='/v1/messages'){
   const response={...responses[count++],model:body.model};res.writeHead(200,{'Content-Type':'text/event-stream'});if(response.hold){held=res;res.write(response.text?messagesStream(count,response).split('event: content_block_stop')[0]:': fixture waiting\n\n');return;}res.end(messagesStream(count,response));return;
  }
  res.writeHead(404);res.end('{}');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const preload=path.join(root,'official-endpoint-fixture.mjs');
 if(modelListing){
  // The SDK only follows the authenticated listing at the official origin.
  // Keep that origin in the adapter and substitute loopback only at fetch.
  fs.writeFileSync(preload,
   'const endpoint = '+JSON.stringify(base)+';\n'+
   'const fetchLoopback = globalThis.fetch;\n'+
   'globalThis.fetch = (input, options) => {\n'+
   ' const url = new URL(input instanceof Request ? input.url : input);\n'+
   ' if (url.origin === "https://api.deepseek.com") {\n'+
   '  const pathname = url.pathname.replace(/^\\/anthropic(?=\\/)/, "");\n'+
   '  return fetchLoopback(endpoint + pathname + url.search, options);\n'+
   ' }\n'+
   ' if (url.origin !== endpoint) throw Error("Unexpected external fixture request");\n'+
   ' return fetchLoopback(input, options);\n'+
   '};\n');
 }
 const host={...dshRuntime,prepare:(...args)=>{const p=dshRuntime.prepare(...args);if(!modelListing)p.env.DEEPSEEK_BASE_URL=base;return p;},spawn:(file,args,options)=>{const child=dshRuntime.spawn(file,modelListing?['--import',pathToFileURL(preload).href,...args]:args,options);children.push(child);child.stderr.on('data',v=>fs.appendFileSync(path.join(root,'stderr.txt'),v));return child;}};
 const b=fixtureBridge({root,catalog:store,worker:worker||(()=>toolsConnected?{url:base+'/providers/deepseek',tokens:{mcp:'fixture-scoped-tool-token',admin:'never-shared'},context:{}}:null),fetchApi:(url,opts)=>fetch(url.replace('https://api.deepseek.com',base),opts),host,confirmResourceChoice});b.on('event',e=>events.push(e));
 t.after(async()=>{b.close();held?.destroy();await Promise.all(children.map(child=>child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(r=>child.once('close',r))));server.closeAllConnections();await new Promise(r=>server.close(r));for(let i=0;i<25;i++){try{fs.rmSync(root,{recursive:true,force:true});break;}catch(error){if(i===24&&(error.code==='EPERM'||error.code==='EBUSY'))break;if(i===24)throw error;await new Promise(r=>setTimeout(r,150));}}});return {b,root,store,calls,events,children,get count(){return count;}};
}
function nextEvent(b,method){return new Promise((resolve,reject)=>{const listener=event=>{if(event.method===method){clearTimeout(timer);b.off('event',listener);resolve(event);}};const timer=setTimeout(()=>{b.off('event',listener);reject(Error('Missing fixture event '+method));},15000);b.on('event',listener);});}
const completion=b=>nextEvent(b,'turn/completed').then(event=>event.params.turn);

test('the official DeepSeek vision route sends selected image bytes and a Files reference to its original endpoint',{timeout:60000},async t=>{
 const f=await nativeFixture(t,{toolsConnected:false,responses:[{}]}),bridge=f.b;
 await bridge.start();
 const catalog=await bridge.request('model/list');
 assert.deepEqual(catalog.data[0].inputModalities,['text','image']);
 const {thread}=await bridge.request('thread/start'),owner={provider:'deepseek',threadId:thread.id};
 const require=createRequire(dshRuntime.resolve().args[1]),sharp=createRequire(require.resolve('@deepseek-ai/dsh-attachment-local'))('sharp');
 const png=await sharp({create:{width:3,height:2,channels:3,background:{r:58,g:108,b:187}}}).png().toBuffer();
 const db=new Catalog(f.root),attachments=createChatAttachments({catalog:db});
 let file,input;
 try{
  [file]=attachments.stage({...owner,files:[{name:'image-fixture.png',size:png.length,mimeType:'image/png',bytes:png}]});
  input=[{type:'text',text:'Describe the original fixture.'},...attachments.inputs(owner,[file.id])];
 }finally{db.db.close();}
 const done=completion(bridge);done.catch(()=>{});
 await bridge.request('turn/start',{threadId:thread.id,input});
 assert.equal((await done).status,'completed');
 const upload=f.calls.find(call=>call.url==='/v1/files'),model=f.calls.find(call=>call.url==='/v1/messages');
 assert(upload,'one selected image must reach the trusted Files route');
 assert.equal(upload.apiKey,credential.apiKey);
 assert.equal(upload.body.expiresSeconds,'604800');
 const {data,info}=await sharp(upload.body.bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
 assert.deepEqual([info.width,info.height,info.channels],[3,2,3]);
 for(let index=0;index<data.length;index++)assert(Math.abs(data[index]-[58,108,187][index%3])<=8,'uploaded color must match the selected image');
 const blocks=model.body.messages.filter(message=>message.role==='user').flatMap(message=>message.content);
 assert(blocks.some(block=>block.type==='text'&&block.text===input[0].text));
 assert.deepEqual(blocks.find(block=>block.type==='image').source,{type:'file',file_id:'fixture-image-file'});
 assert.deepEqual(chatAttachmentRefs((await bridge.request('thread/read',{threadId:thread.id})).thread.turns[0].items[0].content),[file]);
});

test('the pinned SDK consumes steering at the next step of the same turn and saves it once',{timeout:60000},async t=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();
 const f=await nativeFixture(t,{toolCall:async()=>{entered.resolve();await release.promise;return {status:'fixture-only'};}});
 await f.b.start();
 const {thread}=await f.b.request('thread/start'),done=completion(f.b);
 const {turn}=await f.b.request('turn/start',{threadId:thread.id,input:[{type:'text',text:'Read the fixture status'}]});
 const correction='Include the fixture units in the answer';
 const params={threadId:thread.id,expectedTurnId:turn.id,clientUserMessageId:'fixture-steer',input:[{type:'text',text:correction}]};
 try{
  await entered.promise;
  await assert.rejects(f.b.request('turn/steer',{...params,expectedTurnId:'old-turn'}),/未发送/);
  const replies=await Promise.all([f.b.request('turn/steer',params),f.b.request('turn/steer',params)]);
  assert.deepEqual(replies,[{turnId:turn.id},{turnId:turn.id}]);
  assert.equal(f.count,1,'The in-flight tool and its model request have not been restarted');
 }finally{release.resolve();}
 assert.equal((await done).status,'completed');
 const requests=f.calls.filter(call=>call.url==='/v1/messages');
 assert.equal(requests.length,2);
 assert(!JSON.stringify(requests[0].body.messages).includes(correction));
 assert.equal(JSON.stringify(requests[1].body.messages).split(correction).length,2);
 assert.equal(f.calls.filter(call=>call.body.method==='tools/call').length,1);
 const history=(await f.b.request('thread/read',{threadId:thread.id})).thread;
 assert.equal(history.turns.length,1);
 assert.equal(history.turns[0].id,turn.id);
 assert.deepEqual(history.turns[0].items.filter(item=>item.type==='userMessage').map(item=>item.text),['Read the fixture status',correction]);
});

test('a rejected tool list fails DSH startup with the HTTP status and permits an explicit reconnect',async t=>{
 let allowed=false;
 const f=await nativeFixture(t,{allowDiscovery:()=>allowed});
 await assert.rejects(f.b.start(),{message:'科研助手无法加载当前对话的工具清单（HTTP 403），请重新连接此对话。'});
 assert.equal(f.b.process,null);
 assert.equal(f.b.pending.size,0);
 assert.equal(f.calls.filter(call=>call.body.method==='tools/list').length,1);
 allowed=true;
 const {studioIsolation}=await f.b.start();
 assert.equal(studioIsolation.status,'verified');
 assert.equal(studioIsolation.nativeTools,0);
 assert.equal(f.count,0);
});

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
 const info=await f.b.start();assert.equal(info.agentInfo.version,'0.2.2-rc.1');assert.deepEqual(info.studioIsolation.tools,[DSH_QUESTION_TOOL,'mcp__gpusampling__run_status']);
 const models=await f.b.request('model/list');assert.deepEqual(models.data[0].supportedReasoningEfforts.map(v=>v.reasoningEffort),['none','low','high','max']);assert.equal(models.data[0].defaultReasoningEffort,'none');
 const thread=await f.b.request('thread/start'),done=completion(f.b);await f.b.request('turn/start',{threadId:thread.thread.id,effort:'none',input:[{type:'text',text:'Read the fixture saved status'}]});assert.equal((await done).status,'completed');
 const api=f.calls.filter(c=>c.url==='/v1/messages'),tools=f.calls.filter(c=>c.body.method==='tools/call');assert.equal(api.length,3);assert.equal(tools.length,1);assert.equal(tools[0].body.params.name,'run_status');assert.equal(tools[0].authorization,'Bearer fixture-scoped-tool-token');assert(api.every(c=>c.apiKey===credential.apiKey));assert(api.every(c=>JSON.stringify(c.body.tools).includes('mcp__gpusampling__run_status')&&!JSON.stringify(c.body.tools).includes('submit_run')));assert.equal(api[0].body.thinking.type,'disabled');
 assert(f.events.some(e=>e.method==='item/agentMessage/delta'&&e.params.delta.includes('Official harness fixture output')));assert(!JSON.stringify(f.events).includes('fixture-scoped-tool-token'));
 const before=f.count;f.b.close();await f.b.start();const restored=await f.b.request('thread/resume',{threadId:thread.thread.id});assert.equal(restored.thread.id,thread.thread.id);assert.equal(restored.thread.turns.length,1);assert.equal(f.count,before,'resume must not start a model turn');
 const highDone=completion(f.b);await f.b.request('turn/start',{threadId:thread.thread.id,effort:'high',input:[{type:'text',text:'Continue the same saved fixture session'}]});assert.equal((await highDone).status,'completed');const high=f.calls.filter(c=>c.url==='/v1/messages').at(-1).body;assert.equal(high.max_tokens,f.b.info.studioIsolation.models.find(v=>v.id===high.model).defaultMaxTokens);assert.equal(high.thinking.type,'enabled');
});

test('official DSH reads public Crossref metadata in an ordinary chat through TerminalMcp',{timeout:60000},async t=>{
 const query='Cubic silicon phonon dispersion',doi='10.5555/fixture-phonon';
 const requests=[];
 const read=async url=>{
  requests.push(url.href);
  return {text:JSON.stringify({status:'ok','message-type':'work-list',message:{items:[{DOI:doi,title:['Fixture phonon paper']}]}})};
 };
 const endpoint=new TerminalMcp({terminal:{tools:()=>[]},publicDocs:{definitions:softwareDocDefinitions,call:(name,args)=>softwareDocs(name,args,read)}});
 await endpoint.start();t.after(()=>endpoint.close());
 const name='mcp__gpusampling__search_scientific_literature';
 const f=await nativeFixture(t,{worker:()=>endpoint.providerConnection('deepseek'),responses:[{tool:{name,args:{query,limit:1}}},{}]});
 const info=await f.b.start();
 assert(info.studioIsolation.tools.includes(name));
 const {thread}=await f.b.request('thread/start');
 endpoint.bindProviderContext('deepseek',{threadId:thread.id});
 assert.deepEqual(requests,[]);
 const done=completion(f.b);
 await f.b.request('turn/start',{threadId:thread.id,input:[{type:'text',text:'Find public papers about cubic silicon phonons.'}]});
 assert.equal((await done).status,'completed');
 assert.equal(requests.length,1);
 assert.equal(new URL(requests[0]).searchParams.get('query.bibliographic'),query);
 const turns=f.calls.filter(call=>call.url==='/v1/messages');
 assert(turns[0].body.tools.some(tool=>tool.name===name));
 assert(!turns[0].body.tools.some(tool=>tool.name.endsWith('submit_run')));
 const receipt=f.b.session(thread.id).turns[0].items.find(item=>item.type==='mcpToolCall'&&item.tool==='search_scientific_literature');
 assert.equal(receipt.status,'completed');
 assert.equal(receipt.result.isError,false);
 const value=JSON.parse(receipt.result.content[0].text);
 assert.equal(value.scope,'bibliographic_metadata');
 assert.equal(value.results[0].url,'https://doi.org/'+doi);
});

test('Official DSH output budgets follow the adapter for every effort and respect authenticated model limits',{timeout:90000},async t=>{
 const limitedModel='deepseek-v4-pro',limitedTokens=4096,partial='Partial reply at the authenticated model limit';
 const modelListing=[{id:'deepseek-flash',input_modalities:['text','image'],api_capabilities:{anthropic_messages:{}}},{id:limitedModel,max_output_tokens:limitedTokens,api_capabilities:{anthropic_messages:{}}}];
 const f=await nativeFixture(t,{toolsConnected:false,modelListing,responses:[{},{},{},{},{text:partial,stopReason:'max_tokens'}]});
 const info=await f.b.start();
 assert(f.calls.some(call=>call.url==='/models'&&call.apiKey===credential.apiKey),'The official SDK must fetch its own authenticated catalog');
 const defaults=Object.fromEntries(info.studioIsolation.models.map(model=>[model.id,model.defaultMaxTokens]));
 assert(Number.isSafeInteger(defaults['deepseek-flash'])&&defaults['deepseek-flash']>limitedTokens);
 assert.equal(defaults[limitedModel],limitedTokens);
 const {thread:{id:flashThread}}=await f.b.request('thread/start');
 const run=async(threadId,effort)=>{
  const done=completion(f.b);
  await f.b.request('turn/start',{threadId,effort,input:[{type:'text',text:'Check the official output budget'}]});
  const turn=await done,request=f.calls.filter(call=>call.url==='/v1/messages').at(-1).body;
  return {turn,request};
 };
 const wire=[];
 for(const effort of ['none','low','high','max']){
  const {turn,request}=await run(flashThread,effort);
  assert.equal(request.model,'deepseek-flash');
  assert.equal(request.max_tokens,defaults[request.model]);
  assert.deepEqual(request.thinking,{type:effort==='none'?'disabled':'enabled'});
  assert.deepEqual(request.output_config,effort==='none'?undefined:{effort});
  assert.equal(turn.status,'completed');
  wire.push({model:request.model,effort,maxTokens:request.max_tokens,status:turn.status});
 }
 const {thread:{id:limitedThread}}=await f.b.request('thread/start',{model:limitedModel});
 const {turn,request}=await run(limitedThread,'max');
 assert.equal(request.model,limitedModel);
 assert.equal(request.max_tokens,limitedTokens);
 assert.deepEqual(request.output_config,{effort:'max'});
 assert.equal(turn.status,'failed');
 assert.match(turn.error.message,/max-tokens/);
 const {thread}=await f.b.request('thread/read',{threadId:limitedThread});
 assert.equal(thread.turns[0].items.find(item=>item.type==='agentMessage')?.text,partial);
 assert.equal(f.count,5,'Truncation must not resubmit the model request');
 wire.push({model:request.model,effort:'max',maxTokens:request.max_tokens,status:turn.status,partialRetained:true});
 t.diagnostic(JSON.stringify({sdk:info.agentInfo.version,authenticatedListing:true,defaults,wire}));
});

test('Resuming a native DeepSeek conversation created with the old app cap uses the adapter default',{timeout:60000},async t=>{
 const f=await nativeFixture(t,{toolsConnected:false,responses:[{},{}]});
 const raw=f.b.raw.bind(f.b),oldCap=32768;
 f.b.raw=(method,params,...rest)=>raw(method,method==='initialize'?{...params,maxTokens:oldCap}:params,...rest);
 await f.b.start();
 const {thread:{id:threadId}}=await f.b.request('thread/start');
 const run=async text=>{
  const done=completion(f.b);
  await f.b.request('turn/start',{threadId,effort:'max',input:[{type:'text',text}]});
  assert.equal((await done).status,'completed');
 };
 await run('Seed a conversation with the pre-upgrade override');
 const nativeId=f.b.session(threadId).nativeId;
 assert.equal(f.calls.filter(call=>call.url==='/v1/messages')[0].body.max_tokens,oldCap);
 f.b.close();
 f.b.sessions.clear();
 delete f.b.raw;
 const info=await f.b.start();
 const {thread}=await f.b.request('thread/resume',{threadId});
 assert.equal(thread.turns.length,1);
 assert.equal(f.b.session(threadId).nativeId,nativeId);
 assert.equal(f.count,1,'Resuming does not retransmit the prior prompt');
 await run('Continue with the official adapter budget');
 const next=f.calls.filter(call=>call.url==='/v1/messages')[1].body;
 assert.equal(next.max_tokens,info.studioIsolation.models.find(model=>model.id===next.model).defaultMaxTokens);
 assert.notEqual(next.max_tokens,oldCap);
 t.diagnostic(JSON.stringify({sdk:info.agentInfo.version,priorMaxTokens:oldCap,resumedMaxTokens:next.max_tokens,modelRequests:f.count}));
});
async function scopedDraftTool(t){
 const provider='deepseek',sessionId='scoped-dsh-draft-fixture',calls=[];
 const presentTask={name:'present_task',description:'Save the current fixture draft',inputSchema:{type:'object',properties:{task_id:{type:'string'}},required:['task_id']}};
 const endpoint=new TerminalMcp({terminal:{tools:()=>[]},workerTools:{
  list:scope=>scope.taskId?{tools:[presentTask]}:null,
  call(name,args,scope){
   assert.equal(name,presentTask.name);assert.equal(scope.sessionId,sessionId);assert.equal(scope.checkCurrent(),true);
   assert.equal(args.task_id,scope.taskId);calls.push(scope.taskId);return toolValueResult({status:'draft'});
  },
 }});
 await endpoint.start();t.after(()=>endpoint.close());
 return {calls,bind:(context,allowInitialFill=false)=>endpoint.bindProviderContext(provider,context,{sessionId,allowInitialFill}),
  connection:()=>endpoint.providerConnection(provider,sessionId)};
}
const presentName='mcp__gpusampling__present_task';
const draftTurn=(bridge,threadId,params={})=>bridge.request('turn/start',{threadId,input:[{type:'text',text:'Save the reviewed fixture draft'}],...params});

test('A first task appears in the DeepSeek model inventory after the existing lease receives its trusted scope',{timeout:60000},async t=>{
 const tools=await scopedDraftTool(t),lease=tools.connection();
 const f=await nativeFixture(t,{worker:()=>lease,responses:[{tool:{name:presentName,args:{task_id:'owned-task'}}},{}]});
 await f.b.start();
 const {thread:{id:threadId}}=await f.b.request('thread/start'),originalProcess=f.b.process;
 assert(!f.b.info.studioIsolation.tools.includes(presentName));
 tools.bind({threadId,taskId:'owned-task',projectId:'owned-project'},true);
 assert.equal(lease.tokens.mcp,tools.connection().tokens.mcp);
 const done=completion(f.b);await draftTurn(f.b,threadId);assert.equal((await done).status,'completed');
 assert(f.calls.find(c=>c.url==='/v1/messages').body.tools.some(tool=>tool.name===presentName));
 assert(f.b.process!==originalProcess);
 assert.deepEqual(tools.calls,['owned-task']);
});

test('Restored DeepSeek sessions use the live workflow lease and ignore historical or obsolete tool scope',{timeout:60000},async t=>{
 const tools=await scopedDraftTool(t);let lease=tools.connection();
 const f=await nativeFixture(t,{worker:()=>lease,responses:[{},{tool:{name:presentName,args:{task_id:'current-task'}}},{},{},{}]});
 await f.b.start();
 const {thread:{id:threadId}}=await f.b.request('thread/start');tools.bind({threadId},true);
 const initial=completion(f.b);await draftTurn(f.b,threadId);assert.equal((await initial).status,'completed');
 const kind='deepseek-dsh-history',saved=f.store.get(kind,threadId),nativeId=saved.nativeId;
 f.b.close();f.b.sessions.clear();f.store.put(kind,threadId,{...saved,toolContext:{mode:'chat'}});
 tools.bind({threadId,taskId:'current-task',projectId:'current-project'});lease=tools.connection();
 await f.b.start();
 const initialProcess=f.b.process,priorRequests=f.count;
 const {thread}=await f.b.request('thread/resume',{threadId});
 assert.equal(thread.id,threadId);assert.equal(thread.turns.length,1);assert.equal(f.b.session(threadId).nativeId,nativeId);
 assert.equal(f.count,priorRequests,'Resuming must make no model request');
 assert(f.b.info.studioIsolation.tools.includes(presentName),'Keep the workflow tools verified by the current lease');
 assert.equal(f.b.process,initialProcess);
 const updated=completion(f.b);await draftTurn(f.b,threadId,{studioToolContext:{mode:'workflow',taskId:'old-task',projectId:'old-project'}});
 assert.equal((await updated).status,'completed');assert.deepEqual(tools.calls,['current-task']);
 const terminal=completion(f.b);await draftTurn(f.b,threadId,{studioToolContext:{mode:'chat'}});
 assert.equal((await terminal).status,'completed');
 assert(!f.calls.filter(c=>c.url==='/v1/messages').at(-1).body.tools.some(tool=>tool.name===presentName));
 f.b.close();f.b.sessions.clear();f.store.put(kind,threadId,{...f.store.get(kind,threadId),toolContext:{mode:'workflow',taskId:'current-task',projectId:'current-project'}});
 tools.bind({threadId});lease=tools.connection();await f.b.start();
 const chatProcess=f.b.process;
 await f.b.request('thread/resume',{threadId});
 assert.equal(f.b.process,chatProcess);
 const next=completion(f.b);await draftTurn(f.b,threadId);assert.equal((await next).status,'completed');
 assert(!f.calls.filter(c=>c.url==='/v1/messages').at(-1).body.tools.some(tool=>tool.name===presentName));
 assert.equal(f.b.session(threadId).nativeId,nativeId);
});
test('Official DSH interrupts one turn and continues the same native session with its partial reply',{timeout:60000},async t=>{
 const partial='Partial fixture reply.';
 const f=await nativeFixture(t,{responses:[{hold:true,text:partial},{text:'Same fixture session continued.'}]});
 await f.b.start();
 const {thread}=await f.b.request('thread/start'),threadId=thread.id,nativeId=f.b.session(threadId).nativeId,process=f.b.process;
 const first=completion(f.b),streamed=nextEvent(f.b,'item/agentMessage/delta');
 const {turn}=await f.b.request('turn/start',{threadId,input:[{type:'text',text:'Remember the local fixture named amber.'}]});
 assert.equal((await streamed).params.delta,partial);
 await f.b.request('turn/interrupt',{threadId,turnId:turn.id});
 const interrupted=await first;
 assert.equal(interrupted.id,turn.id);
 assert.equal(interrupted.status,'cancelled');
 assert.equal(interrupted.error,undefined);
 assert.equal(f.b.activeTurns.size,0);
 assert.equal(f.b.process,process);
 assert.equal(f.count,1);
 assert(!f.events.some(event=>event.method==='studio/codexDisconnected'));
 const second=completion(f.b);
 await f.b.request('turn/start',{threadId,input:[{type:'text',text:'Continue our fixture conversation.'}]});
 assert.equal((await second).status,'completed');
 assert.equal(f.b.session(threadId).nativeId,nativeId);
 assert.equal(f.b.process,process);
 assert.equal(f.children.length,1);
 const saved=(await f.b.request('thread/read',{threadId})).thread.turns;
 assert.deepEqual(saved.map(turn=>turn.status),['cancelled','completed']);
 assert.equal(saved[0].items.find(item=>item.type==='agentMessage').text,partial);
 const model=f.calls.filter(call=>call.url==='/v1/messages');
 assert.equal(model.length,2);
 assert.match(JSON.stringify(model[1].body.messages),/Remember the local fixture named amber/);
 assert.match(JSON.stringify(model[1].body.messages),/Partial fixture reply\./);
});

test('actual official DSH chat runtime registers project skills and base workspace setup and forwards model tool calls',{timeout:60000},async t=>{
 const {ProjectSkills}=await import('../../agent/skills/project-skills.mjs');
 const tools=[...new ProjectSkills({root:'.',current:()=>null}).tools(),baseWorkspaceTool];
 const f=await nativeFixture(t,{toolCatalog:tools,responses:[{tool:{name:'mcp__gpusampling__read_project_skill',args:{name:'local-analysis'}}},{tool:{name:'mcp__gpusampling__setup_base_workspace',args:{action:'ensure'}}},{}]});
 const info=await f.b.start();
 assert.deepEqual([...info.studioIsolation.tools].sort(),[DSH_QUESTION_TOOL,...tools.map(tool=>'mcp__gpusampling__'+tool.name)].sort());
 const thread=await f.b.request('thread/start'),done=completion(f.b);
 await f.b.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Read the project skill'}]});
 assert.equal((await done).status,'completed');
 const request=f.calls.find(call=>call.url==='/v1/messages').body;
 assert.match(JSON.stringify(request.system),/project_skill_catalog/);
 assert(request.tools.some(tool=>tool.name==='mcp__gpusampling__write_project_skill'));
 assert.equal(f.calls.find(call=>call.body.method==='tools/call').body.params.name,'read_project_skill');
 assert(f.calls.some(call=>call.body.method==='tools/call'&&call.body.params.name==='setup_base_workspace'&&call.body.params.arguments.action==='ensure'));
});

test('official DeepSeek SDK waits for a listed choice or a custom answer with no scientific tool connection',{timeout:60000},async t=>{
 const ask={tool:{name:DSH_QUESTION_TOOL,args:{question:'Which approach should we use?',options:[{label:'Read the queue',description:'Inspect only'},{label:'Plan a draft'}]}}};
 const f=await nativeFixture(t,{responses:[ask,{text:'Continuing after listed choice'},ask,{text:'Continuing after custom answer'},ask],toolsConnected:false});
 const info=await f.b.start();assert.deepEqual(info.studioIsolation.tools,[DSH_QUESTION_TOOL]);
 const {thread}=await f.b.request('thread/start');
 for(const [index,answer]of ['Read the queue','My own bounded next step'].entries()){
  const question=nextEvent(f.b,'item/tool/requestUserInput'),done=completion(f.b);
  const {turn}=await f.b.request('turn/start',{threadId:thread.id,input:[{type:'text',text:'Start the same task'}]});
  const shown=await question,id=shown.params.questions[0].id;
  assert.equal(shown.params.turnId,turn.id);assert.equal(shown.params.threadId,thread.id);assert.equal(shown.params.questions[0].options[0].description,'Inspect only');
  assert.equal(f.count,2*index+1);
  assert.throws(()=>f.b.respond(shown.id,{answers:{[id]:{answers:[' ','Second choice']}}}),/Submit one answer/);
  assert(f.b.questions.has(shown.id));
  f.b.respond(shown.id,{answers:{[id]:{answers:[answer]}}});
  assert.throws(()=>f.b.respond(shown.id,{answers:{[id]:{answers:[answer]}}}),/no longer active/);
  assert.equal((await done).id,turn.id);assert.equal(f.count,2*index+2);
  assert(f.events.some(event=>event.method==='serverRequest/resolved'&&event.params.requestId===shown.id));
  const nextModel=f.calls.filter(call=>call.url==='/v1/messages').at(-1).body;
  assert(JSON.stringify(nextModel.messages).includes(answer));
 }
 const question=nextEvent(f.b,'item/tool/requestUserInput'),done=completion(f.b);
 const {turn}=await f.b.request('turn/start',{threadId:thread.id,input:[{type:'text',text:'An interruptible task'}]});const shown=await question;
 await f.b.request('turn/interrupt',{threadId:thread.id,turnId:turn.id});assert.equal((await done).status,'cancelled');assert(!f.b.questions.has(shown.id));assert.equal(f.count,5);
 assert.equal(f.calls.filter(call=>call.body.method==='tools/call').length,0);
});

test('official DeepSeek SDK surfaces a hosted choice and continues the original acquisition after desktop confirmation',{timeout:60000},async t=>{
 const resources=[{name:'示例甲',resourceId:'ssh:a'},{name:'示例乙',resourceId:'ssh:b'}],acquire='mcp__gpusampling__acquire_compute_resource';
 const tool=(name,args)=>({tool:{name,args}});let confirmed=null;
 const f=await nativeFixture(t,{
  toolCatalog:['acquire_compute_resource','inspect_compute_service'].map(name=>({name,inputSchema:{type:'object'}})),
  responses:[tool(acquire,{alias:'集群',access:'service'}),tool(acquire,{resource_id:'ssh:b',access:'service'}),
   tool('mcp__gpusampling__inspect_compute_service',{resource_id:'ssh:b',probe_scheduler:true}),{text:'Fixture queue probe complete'}],
  confirmResourceChoice:(owner,choice)=>{assert(owner.turnId);assert.deepEqual(choice.offered,['ssh:a','ssh:b']);assert.equal(choice.resourceId,'ssh:b');confirmed=choice.resourceId;return confirmed;},
  toolCall:({name,arguments:args})=>{
   if(args.alias)return {status:'choice_required',candidates:resources};
   if(args.resource_id!==confirmed)return {status:'permission_required'};
   return {status:name==='acquire_compute_resource'?'acquired':'observed',resource_id:confirmed};
  }
 });
 await f.b.start();const {thread}=await f.b.request('thread/start');const question=nextEvent(f.b,'item/tool/requestUserInput'),done=completion(f.b);
 const {turn}=await f.b.request('turn/start',{threadId:thread.id,input:[{type:'text',text:'请探测集群队列'}]});const shown=await question;
 const q=shown.params.questions[0];assert.deepEqual(q.options.map(option=>option.label),resources.map(resource=>resource.name));assert.equal(f.count,1);assert.equal(confirmed,null);
 f.b.respond(shown.id,{answers:{[q.id]:{answers:['示例乙']}}});
 assert.equal((await done).id,turn.id);assert.equal(confirmed,'ssh:b');
 assert.deepEqual(f.calls.filter(call=>call.body.method==='tools/call').map(call=>call.body.params.arguments),[
  {alias:'集群',access:'service'},{resource_id:'ssh:b',access:'service'},{resource_id:'ssh:b',probe_scheduler:true}
 ]);
 assert(JSON.stringify(f.calls.filter(call=>call.url==='/v1/messages')[1].body.messages).includes('target_selected'));
});
