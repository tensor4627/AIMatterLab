import assert from 'node:assert/strict';
import {EventEmitter,errorMonitor} from 'node:events';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import test from 'node:test';
import {AcpBridge} from '../../agent/providers/acp.mjs';

const profile={args:['acp'],cwd:process.cwd(),env:{}};
const initialized={protocolVersion:1,agentInfo:{version:'2.1.1'}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({automaticInitialize=true}={}){
 const probes=[],children=[];
 const host={version:'fixture',spawnCli(_executable,args){
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.killed=0;child.messages=[];child.kill=()=>{child.killed++;};
  if(args[0]==='--version'){probes.push(child);return child;}
  children.push(child);child.stdin.on('data',bytes=>{const message=JSON.parse(String(bytes));child.messages.push(message);if(automaticInitialize&&message.method==='initialize')child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:initialized})+'\n');});return child;
 }};
 return {bridge:new AcpBridge('kimi',{host,probeTimeoutMs:40}),probes,children,finishProbe(index=0){probes[index].stdout.write('kimi 2.1.1');probes[index].emit('exit',0);}};
}
function historyBridge(provider='qwen'){
 const bridge=new AcpBridge(provider);bridge.profile=profile;bridge.process={stdin:{write(){}},kill(){}};
 const events=[];bridge.on('event',event=>events.push(event));return {bridge,events};
}
function update(bridge,sessionUpdate,values={}){bridge.update({sessionId:'session',update:{sessionUpdate,...values}});}

test('ACP thread/read retains tool input, failure receipts and original turn ordering',async()=>{
 const {bridge,events}=historyBridge();try{
  update(bridge,'user_message_chunk',{content:{type:'text',text:'prepare an input'}});
  update(bridge,'tool_call',{toolCallId:'tool',title:'mcp__gpusampling__prepare_run',status:'in_progress',rawInput:{spec:{engine:'pydyn.md'}}});
  let read=await bridge.request('thread/read',{threadId:'session'});
  assert.deepEqual(read.thread.turns[0].items.map(item=>item.type),['userMessage','mcpToolCall']);
  assert.equal(read.thread.turns[0].items[1].status,'inProgress');
  update(bridge,'agent_message_chunk',{content:{type:'text',text:'checking the input'}});
  // A late completion still belongs to the turn in which the tool began.
  const session=bridge.session('session');session.current={id:'next-turn',items:[]};session.turns.push(session.current);
  update(bridge,'tool_call_update',{toolCallId:'tool',status:'failed',rawOutput:{content:[{type:'text',text:'input file missing'}]}});
  update(bridge,'tool_call_update',{toolCallId:'tool',status:'failed'});
  read=await bridge.request('thread/read',{threadId:'session'});
  const item=read.thread.turns[0].items[1];
  assert.deepEqual(read.thread.turns[0].items.map(item=>item.type),['userMessage','mcpToolCall','agentMessage']);
  assert.deepEqual(read.thread.turns[1].items,[]);
  assert.equal(item.tool,'prepare_run');assert.equal(item.status,'failed');
  assert.deepEqual(item.arguments,{spec:{engine:'pydyn.md'}});
  assert.match(item.result.content[0].text,/input file missing/);
  assert.equal(events.filter(event=>event.method==='item/completed').length,1);
  assert.deepEqual(events.find(event=>event.method==='item/completed').params.item,item);
 }finally{bridge.close();}
});

test('ACP session/load restores tool-only replay into readable history without emitting live activity',async()=>{
 const {bridge,events}=historyBridge('kimi');try{
  bridge.info={agentCapabilities:{loadSession:true}};
  bridge.raw=async method=>{
   assert.equal(method,'session/load');
   update(bridge,'tool_call',{toolCallId:'historical',title:'mcp__gpusampling__prepare_run',status:'pending',rawInput:{spec:{engine:'gpumd.md'}}});
   update(bridge,'tool_call_update',{toolCallId:'historical',status:'completed',rawOutput:{content:[{type:'text',text:JSON.stringify({id:'run-1',engine:'gpumd.md',status:'draft'})}]}});
   return {};
  };
  await bridge.request('thread/resume',{threadId:'session'});
  const read=await bridge.request('thread/read',{threadId:'session'}),items=read.thread.turns.flatMap(turn=>turn.items);
  assert.equal(items.length,1);assert.equal(items[0].type,'mcpToolCall');assert.equal(items[0].status,'completed');
  assert.deepEqual(items[0].arguments,{spec:{engine:'gpumd.md'}});
  assert.equal(JSON.parse(items[0].result.content[0].text).id,'run-1');
  assert.equal(events.filter(event=>['item/started','item/completed'].includes(event.method)).length,0);
 }finally{bridge.close();}
});

test('ACP close cancels its pending version probe and never spawns a late CLI',async()=>{
 const f=fixture();try{
  const pending=f.bridge.start('kimi',profile),rejected=assert.rejects(pending,/cancelled|bridge closed/);
  f.bridge.close();await rejected;
  assert.equal(f.probes[0].killed,1);assert.equal(f.probes[0].stdout.listenerCount('data'),0);
  assert.equal(f.probes[0].listenerCount('exit'),0);
  assert.doesNotThrow(()=>f.probes[0].emit('error',Error('late spawn failure')));
  f.probes[0].emit('close');assert.equal(f.probes[0].listenerCount('error'),0);
  f.finishProbe();await tick();
  assert.equal(f.children.length,0);assert.equal(f.bridge.process,null);
 }finally{f.bridge.close();}
});

test('ACP close after probe completion still invalidates the queued startup continuation',async()=>{
 const f=fixture();try{
  const pending=f.bridge.start('kimi',profile),rejected=assert.rejects(pending,/cancelled|bridge closed/);
  f.finishProbe();f.bridge.close();await rejected;
  assert.equal(f.children.length,0);assert.equal(f.bridge.process,null);
 }finally{f.bridge.close();}
});

test('ACP immediate close safely drains a real missing-executable spawn error',{timeout:3000},async()=>{
 let probe,spawns=0;const errors=[];
 const bridge=new AcpBridge('kimi',{host:{version:'fixture',spawnCli(executable,args,options){
  spawns++;probe=spawn(executable,args,{...options,windowsHide:true});
  // errorMonitor observes ENOENT without preventing an unhandled error from failing this test.
  probe.on(errorMonitor,error=>errors.push(error.code));return probe;
 }}});
 try{
  const missing=path.resolve('.studio','review-20261109','missing-acp-'+randomUUID()+'.exe');
  const pending=bridge.start(missing,profile),rejected=assert.rejects(pending,/bridge closed/);
  const closed=new Promise(resolve=>probe.once('close',resolve));
  bridge.close();await Promise.all([rejected,closed]);
  assert.deepEqual(errors,['ENOENT']);assert.equal(spawns,1);assert.equal(probe.pid,undefined);
  assert.equal(probe.listenerCount('error'),0);assert.equal(bridge.process,null);
 }finally{bridge.close();}
});

test('ACP can reconnect immediately after cancelling a version probe without old cleanup clearing the new start',async()=>{
 const f=fixture();try{
  const first=f.bridge.start('kimi',profile),rejected=assert.rejects(first,/cancelled|bridge closed/);
  f.bridge.close();const second=f.bridge.start('kimi',profile);
  assert.equal(f.probes.length,2);f.finishProbe(1);
  await rejected;await second;
  assert.equal(f.children.length,1);assert.equal(f.bridge.process,f.children[0]);
  assert.equal(f.children[0].killed,0);assert.equal(f.bridge.info.protocolVersion,1);
 }finally{f.bridge.close();}
});

test('ACP stale initialization failure cannot close a newly connected process',async()=>{
 const f=fixture();let rejectOld;
 const raw=f.bridge.raw.bind(f.bridge);let initializations=0;
 f.bridge.raw=(method,...args)=>method==='initialize'&&initializations++===0?new Promise((_resolve,reject)=>{rejectOld=reject;}):raw(method,...args);
 try{
  const first=f.bridge.start('kimi',profile),rejected=assert.rejects(first,/old initialization failed/);
  f.finishProbe();await tick();assert.equal(f.children.length,1);
  f.bridge.close();const second=f.bridge.start('kimi',profile);f.finishProbe(1);await second;
  rejectOld(Error('old initialization failed'));await rejected;
  assert.equal(f.bridge.process,f.children[1]);assert.equal(f.children[1].killed,0);
  assert.equal(f.bridge.info.protocolVersion,1);
 }finally{rejectOld?.(Error('old initialization failed'));f.bridge.close();}
});

test('ACP concurrent start waits for initialize even after the child process exists',async()=>{
 const f=fixture({automaticInitialize:false});try{
  const first=f.bridge.start('kimi',profile);f.finishProbe();await tick();
  let secondSettled=false;const second=f.bridge.start('kimi',profile).then(result=>{secondSettled=true;return result;});
  await tick();assert.equal(secondSettled,false);
  const child=f.children[0],message=child.messages.find(message=>message.method==='initialize');
  child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:initialized})+'\n');
  const results=await Promise.all([first,second]);assert.deepEqual(results,[initialized,initialized]);assert.equal(f.children.length,1);
 }finally{f.bridge.close();}
});


test('ACP timeout quarantines only the old session until its actual terminal receipt, with no replay',async()=>{
 const {bridge,events}=historyBridge('kimi'),sent=[];bridge.promptTimeoutMs=15;bridge.info={agentCapabilities:{loadSession:true}};
 bridge.process.stdin.write=text=>sent.push(JSON.parse(text));
 update(bridge,'user_message_chunk',{content:{type:'text',text:'original history'}});
 bridge.update({sessionId:'independent',update:{sessionUpdate:'user_message_chunk',content:{type:'text',text:'independent history'}}});
 const complete=new Promise(resolve=>bridge.on('event',event=>{if(event.method==='turn/completed')resolve(event);}));
 try{
  const first=await bridge.request('turn/start',{threadId:'session',input:[{type:'text',text:'current request'}]});
  const oldPrompt=sent.find(message=>message.method==='session/prompt'),failure=await complete;await tick();
  assert.equal(failure.params.turn.id,first.turn.id);assert.equal(failure.params.turn.cancellationPending,true);
  assert(sent.some(message=>message.method==='session/cancel'));assert.equal(bridge.activeTurns.size,0);
  await assert.rejects(bridge.request('turn/start',{threadId:'session',input:[{type:'text',text:'must not send'}]}),/awaiting cancellation/);
  await assert.rejects(bridge.request('thread/resume',{threadId:'session'}),/awaiting cancellation/);
  const before=JSON.stringify((await bridge.request('thread/read',{threadId:'session'})).thread);
  update(bridge,'agent_message_chunk',{content:{type:'text',text:'late secret reply'}});
  update(bridge,'tool_call',{toolCallId:'late-tool',title:'mcp__gpusampling__submit_run',status:'completed'});
  bridge.receive({id:900,method:'session/request_permission',params:{sessionId:'session',toolCall:{title:'mcp__gpusampling__submit_run',kind:'execute'},options:[{kind:'allow_once',optionId:'yes'}]}});
  assert.equal(sent.at(-1).result.outcome.outcome,'cancelled');
  assert.equal(JSON.stringify((await bridge.request('thread/read',{threadId:'session'})).thread),before);
  const other=await bridge.request('turn/start',{threadId:'independent',input:[{type:'text',text:'other work'}]});
  assert.equal(other.turn.status,'inProgress');const otherPrompt=sent.filter(message=>message.method==='session/prompt').at(-1);
  bridge.receive({id:otherPrompt.id,result:{stopReason:'end_turn'}});await tick();
  bridge.receive({id:oldPrompt.id,result:{stopReason:'cancelled'}});await tick();
  assert.equal(bridge.isolatedSessions.size,0);assert.equal(events.filter(event=>event.method==='turn/completed'&&event.params.turn.id===first.turn.id).length,1);
  const next=await bridge.request('turn/start',{threadId:'session',input:[{type:'text',text:'explicit next request'}]});
  update(bridge,'agent_message_chunk',{content:{type:'text',text:'new reply'}});
  bridge.receive({id:oldPrompt.id,result:{stopReason:'end_turn'}});
  assert.equal(bridge.activeTurns.get('session'),next.turn.id);
  assert.equal(sent.filter(message=>message.method==='session/prompt').length,3);
  assert.equal(bridge.session('session').turns.at(-1).items.at(-1).text,'new reply');
 }finally{bridge.close();}
});


test('ACP reserves the session before asynchronous model choices so concurrent starts cannot overlap',async()=>{
 const {bridge}=historyBridge('kimi'),sent=[];bridge.process.stdin.write=text=>sent.push(JSON.parse(text));update(bridge,'user_message_chunk',{content:{type:'text',text:'history'}});
 let release,entered;const choosing=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);bridge.setChoice=async()=>{entered();await gate;};
 try{const first=bridge.request('turn/start',{threadId:'session',input:[{type:'text',text:'first'}]});await choosing;await assert.rejects(bridge.request('turn/start',{threadId:'session',input:[{type:'text',text:'second'}]}),/already active/);release();await first;assert.equal(sent.filter(value=>value.method==='session/prompt').length,1);}finally{release?.();bridge.close();}
});


test('ACP approves an exact registered MCP execution request and denies a forged native name',()=>{
 const {bridge}=historyBridge(),sent=[];bridge.process.stdin.write=text=>sent.push(JSON.parse(text));
 try{for(const name of ['submit_run','bash']){bridge.receive({id:name,method:'session/request_permission',params:{sessionId:'session',toolCall:{title:name,kind:'execute',_meta:{serverId:'gpusampling',toolName:name}},options:[{kind:'allow_once',optionId:'once'}]}});assert.equal(sent.at(-1).result.outcome.outcome,name==='submit_run'?'selected':'cancelled');}}finally{bridge.close();}
});


test('ACP terminal prompt errors flush withheld text into their original turn before a new prompt starts',async()=>{
 const {bridge}=historyBridge('kimi'),sent=[];bridge.process.stdin.write=text=>sent.push(JSON.parse(text));update(bridge,'user_message_chunk',{content:{type:'text',text:'history'}});
 try{await bridge.request('turn/start',{threadId:'session',input:[{type:'text',text:'first'}]});update(bridge,'agent_message_chunk',{content:{type:'text',text:'help'}});const first=sent.find(value=>value.method==='session/prompt');bridge.receive({id:first.id,error:{code:-1,message:'synthetic prompt failure'}});await tick();assert.equal(bridge.session('session').turns.at(-1).items.at(-1).text,'help');assert.equal(bridge.streams.size,0);await bridge.request('turn/start',{threadId:'session',input:[{type:'text',text:'next'}]});update(bridge,'agent_message_chunk',{content:{type:'text',text:'next reply'}});const next=sent.filter(value=>value.method==='session/prompt').at(-1);bridge.receive({id:next.id,result:{stopReason:'end_turn'}});await tick();assert.equal(bridge.session('session').turns.at(-1).items.at(-1).text,'next reply');}finally{bridge.close();}
});

test('ACP timeout cancels outstanding questions and late error receipts release only that quarantine',async()=>{
 const {bridge}=historyBridge('kimi'),sent=[];bridge.promptTimeoutMs=10;bridge.process.stdin.write=text=>sent.push(JSON.parse(text));update(bridge,'user_message_chunk',{content:{type:'text',text:'history'}});
 const failed=new Promise(resolve=>bridge.on('event',event=>{if(event.method==='turn/completed')resolve(event);}));
 try{await bridge.request('turn/start',{threadId:'session',input:[{type:'text',text:'first'}]});const prompt=sent.find(value=>value.method==='session/prompt');bridge.receive({id:777,method:'elicitation/create',params:{sessionId:'session',message:'Synthetic question'}});assert.equal(bridge.interactions.size,1);await failed;await tick();assert.equal(bridge.interactions.size,0);assert.equal(sent.find(value=>value.id===777).result.action,'cancel');assert.throws(()=>bridge.respond(777,{action:'accept'}),/already resolved/);assert(bridge.isolatedSessions.has('session'));bridge.receive({id:prompt.id,error:{code:-1,message:'cancelled after timeout'}});assert.equal(bridge.isolatedSessions.size,0);assert.equal(bridge.session('session').turns.at(-1).cancellationPending,false);bridge.close();assert.equal(bridge.pending.size,0);}finally{bridge.close();}
});


test('ACP diagnostic chunks redact a split configured credential before publishing',async()=>{
 const f=fixture(),diagnostics=[],secret='fixture-bare-diagnostic-token';f.bridge.on('diagnostic',text=>diagnostics.push(text));
 try{const started=f.bridge.start('kimi',{...profile,env:{OPENAI_API_KEY:secret}});f.finishProbe();await started;f.children[0].stderr.write('warning '+secret.slice(0,15));f.children[0].stderr.write(secret.slice(15)+' done');f.children[0].stderr.end();await tick();assert(!diagnostics.join('').includes(secret));assert.match(diagnostics.join(''),/redacted/);}finally{f.bridge.close();}
});


test('an old ACP interrupt cannot cancel the following active turn',async()=>{
 const {bridge}=historyBridge(),sent=[];bridge.process.stdin.write=text=>sent.push(JSON.parse(text));update(bridge,'user_message_chunk',{content:{type:'text',text:'history'}});
 try{const first=await bridge.request('turn/start',{threadId:'session',input:[{type:'text',text:'one'}]}),request=sent.find(value=>value.method==='session/prompt');bridge.receive({id:request.id,result:{stopReason:'end_turn'}});await tick();const next=await bridge.request('turn/start',{threadId:'session',input:[{type:'text',text:'two'}]}),before=sent.length;await assert.rejects(bridge.request('turn/interrupt',{threadId:'session',turnId:first.turn.id}),/no longer active/);assert.equal(sent.length,before);await bridge.request('turn/interrupt',{threadId:'session',turnId:next.turn.id});assert.equal(sent.at(-1).method,'session/cancel');}finally{bridge.close();}
});
