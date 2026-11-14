import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeTranscript,sanitizeProtocolTranscript,createTranscriptStream} from '../../contracts/agent/transcript-sanitizer.mjs';

test('the shared transcript projection redacts nested tool JSON, error data and credential fields',()=>{
 const secret='fixture-private-loopback-capability',value={name:'safe',turns:[{error:{message:'failed '+secret},items:[{arguments:{apiKey:'plain-field-secret'},result:{content:[{type:'text',text:JSON.stringify({password:'plain-json-secret',output:'Bearer synthetic-bearer-token'})}]}}]}]};
 const clean=sanitizeTranscript(value,[secret]),text=JSON.stringify(clean);
 for(const token of [secret,'plain-field-secret','plain-json-secret','synthetic-bearer-token'])assert(!text.includes(token));
 assert.equal(value.turns[0].items[0].arguments.apiKey,'plain-field-secret');assert.equal(clean.name,'safe');
});

test('split streamed explicit secrets, API keys and Bearer values never enter the emitted transcript',()=>{
 for(const secret of ['fixture-private-loopback-capability','sk-fake-api-credential','Bearer fake-bearer-credential'])for(let index=1;index<secret.length;index++){
  const stream=createTranscriptStream(()=>['fixture-private-loopback-capability']);
  const first=stream.push('Before '+secret.slice(0,index)),second=stream.push(secret.slice(index)+' after'),last=stream.push('',{final:true});
  assert(!(first+second+last).includes(secret),secret+' at '+index);assert.match(first+second+last,/Before .*after/);
 }
});


test('interrupted possible-secret suffix stays redacted when a stream flushes',()=>{
 const stream=createTranscriptStream(()=>['fixture-private-loopback-capability']);
 const first=stream.push('Error fixture-private-loop');assert.equal(first,'Error ');
 assert.equal(stream.push('',{final:true}),'[redacted]');
});

test('the native Codex boundary sanitizes actual protocol stream, tool and restored history events',async()=>{
 const {CodexBridge}=await import('../../agent/providers/codex.mjs'),bridge=new CodexBridge(),events=[],key='fixture-native-private-token';bridge.transcriptSecrets=[key];bridge.on('event',event=>events.push(event));
 bridge.receive({method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}});
 for(const delta of ['Echo fixture-native-','private-token and sk-fixture-','key done'])bridge.receive({method:'item/agentMessage/delta',params:{threadId:'thread',turnId:'turn',itemId:'reply',delta}});
 bridge.receive({method:'item/completed',params:{threadId:'thread',item:{id:'tool',type:'mcpToolCall',arguments:{apiKey:'plain-object-secret'},result:{content:[{type:'text',text:'Bearer '+key}]}}}});
 bridge.receive({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'failed',error:{message:key}}}});
 const text=JSON.stringify(events);for(const secret of [key,'sk-fixture-key','plain-object-secret'])assert(!text.includes(secret));assert.match(text,/redacted/);
 bridge.process={stdin:{destroyed:false,write(){}},kill(){}};const pending=bridge.request('thread/read',{threadId:'thread'}),id=bridge.next-1;bridge.receive({id,result:{thread:{id:'thread',turns:[{error:{message:key}}]}}});assert(!JSON.stringify(await pending).includes(key));bridge.close();
});


test('an oversized unterminated secret keeps suppressing its continuation until a delimiter',()=>{
 const stream=createTranscriptStream(),first=stream.push('Before sk-'+ 'x'.repeat(8300)),second=stream.push('DO_NOT_LEAK_SECRET_TAIL'),third=stream.push(' after');
 assert.equal(first,'Before [redacted]');assert.equal(second,'');assert.equal(third+stream.push('',{final:true}),' after');
});


test('trusted protocol identities are preserved without exempting arbitrary nested tool identifiers',()=>{
 const known='fixture-known-token',value={method:'item/completed',params:{threadId:'sk-native-opaque',item:{id:'sk-item-opaque',type:'mcpToolCall',arguments:{id:'sk-synthetic-secret',nested:{id:'sk-other-secret',turns:[]}},result:{id:known},energy_eV:-123.456789,temperature_K:300}}};const clean=sanitizeProtocolTranscript(value,[known]);
 assert.equal(clean.params.threadId,'sk-native-opaque');assert.equal(clean.params.item.id,'sk-item-opaque');assert.equal(clean.params.item.arguments.id,'[redacted]');assert.equal(clean.params.item.arguments.nested.id,'[redacted]');assert.equal(clean.params.item.result.id,'[redacted]');assert.equal(clean.params.item.energy_eV,-123.456789);assert.equal(clean.params.item.temperature_K,300);
 assert.equal(sanitizeProtocolTranscript({thread:{id:known,turns:[]}},[known]).thread.id,'[redacted]');
});

test('native reasoning and progress delta streams redact split secrets before event delivery',async()=>{
 const {CodexBridge}=await import('../../agent/providers/codex.mjs'),bridge=new CodexBridge(),events=[],secret='fixture-private-reasoning-token';bridge.transcriptSecrets=[secret];bridge.on('event',event=>events.push(event));
 for(const method of ['item/reasoning/textDelta','item/reasoning/summaryTextDelta','item/mcpToolCall/progressDelta'])for(const delta of ['prefix '+secret.slice(0,16),secret.slice(16)+' suffix'])bridge.receive({method,params:{threadId:'thread',turnId:'turn',itemId:method,delta}});
 bridge.receive({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});assert.equal(bridge.transcriptStreams.size,0);assert(!JSON.stringify(events).includes(secret));assert(events.some(event=>event.method==='item/reasoning/textDelta'&&event.params.delta.includes('redacted')));bridge.close();
});
