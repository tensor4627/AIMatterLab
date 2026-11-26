import test from 'node:test';
import assert from 'node:assert/strict';
import {agentHarness,conversation,deferred,memoryStorage} from '../helpers/agent-hooks.mjs';

import {createComposerDrafts} from '../../frontend/features/conversations/composer-drafts.mjs';

const rpcCalls=(h,method)=>h.calls.filter(call=>call.method==='agent.rpc'&&call.data.method===method);
const messages=h=>{const values=[];try{h.find(node=>{if(node.type==='./ChatMessage')values.push(node.props.message);return false;});}catch{}return values;};
const stop=h=>h.find(node=>node.props?.['data-testid']==='agent-stop');
async function connected(options={}){const h=agentHarness(options);await h.flush();h.click('agent-connect');await h.flush();return h;}

for(const phase of ['thread/start','conversation.remember','task.create'])test('cancel preparation while awaiting '+phase+' prevents later turn submission and retains draft',async()=>{
 const gate=deferred(),h=await connected({props:{planningMode:phase==='task.create'},override:(method,data,standard)=>method===phase||method==='agent.rpc'&&data.method===phase?gate.promise:standard(method,data)});
 try{h.type('Keep this exact unsent request');h.send();await h.flush();const click=stop(h).props.onClick;click();click();await h.flush();assert.equal(h.textarea().props.value,'Keep this exact unsent request');assert.equal(rpcCalls(h,'turn/interrupt').length,0);
  gate.resolve(phase==='thread/start'?{thread:{id:'late-thread'}}:phase==='task.create'?{id:'late-task'}:conversation('codex','started-thread'));await h.flush();assert.equal(rpcCalls(h,'turn/start').length,0);assert.equal(h.textarea().props.value,'Keep this exact unsent request');assert.equal(h.find(node=>node.props?.['aria-label']==='发送').props.disabled,false);
 }finally{h.unmount();}
});

test('late rejection of cancelled preparation cannot unlock or fail a subsequent reply',async()=>{
 const old=deferred();let attempts=0;const h=await connected({override:(method,data,standard)=>method==='agent.rpc'&&data.method==='thread/start'&&++attempts===1?old.promise:standard(method,data)});
 try{h.type('first');h.send();await h.flush();stop(h).props.onClick();await h.flush();h.type('second');h.send();await h.flush();assert.equal(rpcCalls(h,'turn/start').length,1);old.reject(Error('late cancelled preparation'));await h.flush();assert.deepEqual(h.errors,[]);assert(stop(h));assert.equal(h.textarea().props.value,'');}finally{h.unmount();}
});

test('cancelled automatic discussion is retained as a draft and is not automatically replayed',async()=>{
 const gate=deferred(),h=await connected({override:(method,data,standard)=>method==='agent.rpc'&&data.method==='thread/start'?gate.promise:standard(method,data)});
 try{h.render({intent:{id:'automatic-review',text:'Retain this explicitly requested review',autoSend:true}});await h.flush();stop(h).props.onClick();await h.flush();assert.equal(h.textarea().props.value,'Retain this explicitly requested review');gate.resolve({thread:{id:'cancelled-auto'}});await h.flush();assert.equal(rpcCalls(h,'turn/start').length,0);assert.equal(rpcCalls(h,'thread/start').length,1);}finally{h.unmount();}
});

test('stop before turn acknowledgement waits for exact identity and sends only one interrupt',async()=>{
 const ack=deferred(),interrupt=deferred(),h=await connected({override:(method,data,standard)=>method==='agent.rpc'&&data.method==='turn/start'?ack.promise:method==='agent.rpc'&&data.method==='turn/interrupt'?interrupt.promise:standard(method,data)});
 try{h.type('Keep while stopping');h.send();await h.flush();const click=stop(h).props.onClick;click();click();await h.flush();assert.equal(rpcCalls(h,'turn/interrupt').length,0);assert.equal(stop(h).props.disabled,true);
  assert.equal(h.textarea().props.value,'Keep while stopping');
  ack.resolve({turn:{id:'exact-turn'}});await h.flush();assert.deepEqual(rpcCalls(h,'turn/interrupt').map(call=>call.data.params),[{threadId:'started-thread',turnId:'exact-turn'}]);assert.equal(h.textarea().props.value,'');
  h.emit({provider:'codex',method:'turn/started',params:{threadId:'started-thread',turn:{id:'exact-turn'}}});click();await h.flush();assert.equal(rpcCalls(h,'turn/interrupt').length,1);interrupt.resolve({});await h.flush();h.emit({provider:'codex',method:'turn/completed',params:{threadId:'started-thread',turn:{id:'exact-turn',status:'interrupted'}}});await h.flush();assert.equal(rpcCalls(h,'turn/start').length,1);assert.equal(h.textarea().props.value,'');
 }finally{h.unmount();}
});

for(const newer of [false,true])test('unconfirmed interrupt retries explicitly '+(newer?'and preserves newer typing':'while sent text stays in history'),async()=>{
 let attempts=0;const h=await connected({override:(method,data,standard)=>{if(method==='agent.rpc'&&data.method==='turn/interrupt'){if(++attempts===1)throw Error('interrupt acknowledgement missing');return {};}return standard(method,data);}});
 try{h.type('Original accepted request');h.send();await h.flush();assert.equal(h.textarea().props.value,'');if(newer)h.type('New unsent work');stop(h).props.onClick();await h.flush();assert.equal(h.textarea().props.value,newer?'New unsent work':'');assert.equal(rpcCalls(h,'turn/interrupt').length,1);assert.equal(stop(h).props['aria-label'],'再次请求停止');assert.equal(rpcCalls(h,'turn/start').length,1);stop(h).props.onClick();await h.flush();assert.equal(rpcCalls(h,'turn/interrupt').length,2);assert.equal(rpcCalls(h,'turn/start').length,1);
 }finally{h.unmount();}
});

test('a confirmed interrupt keeps partial output and permits a new send before the original IPC receipts arrive',async()=>{
 const ack=deferred(),interrupt=deferred();
 let turns=0;
 const h=await connected({override:(method,data,standard)=>{
  if(method==='agent.rpc'&&data.method==='turn/start')return ++turns===1?ack.promise:{turn:{id:'next-turn'}};
  if(method==='agent.rpc'&&data.method==='turn/interrupt')return interrupt.promise;
  return standard(method,data);
 }});
 const emit=(method,params)=>h.emit({provider:'codex',method,params:{threadId:'started-thread',...params}});
 try{
  h.type('Original submitted request');h.send();await h.flush();
  emit('turn/started',{turn:{id:'first-turn'}});
  emit('item/agentMessage/delta',{turnId:'first-turn',itemId:'partial',delta:'Partial reply before stop.'});
  await h.flush();
  h.click('agent-stop');h.type('Continue the same conversation.');
  emit('turn/completed',{turn:{id:'first-turn',status:'interrupted',error:{message:'cancelled'}}});
  await h.flush();
  assert.deepEqual(h.errors,[]);
  assert.equal(h.textarea().props.value,'Continue the same conversation.');
  assert.equal(h.find(node=>node.props?.className==='agent-send-notice').props.children,'已停止当前回复。');
  assert(messages(h).some(message=>message.text==='Partial reply before stop.'));
  h.send();await h.flush();
  assert.deepEqual(rpcCalls(h,'turn/start').map(call=>call.data.params.threadId),['started-thread','started-thread']);
  assert.deepEqual(rpcCalls(h,'turn/interrupt').map(call=>call.data.params),[{threadId:'started-thread',turnId:'first-turn'}]);
  ack.resolve({turn:{id:'first-turn'}});interrupt.reject(Error('Old interrupt acknowledgement lost'));
  emit('turn/started',{turn:{id:'first-turn'}});
  emit('studio/agentTurnState',{busy:false,turnId:null});
  emit('turn/completed',{turn:{id:'first-turn',status:'failed',error:{message:'Late previous failure'}}});
  emit('item/agentMessage/delta',{turnId:'first-turn',itemId:'partial',delta:' Late previous output'});
  emit('error',{turnId:'first-turn',error:{message:'Late previous diagnostic'}});
  await h.flush();
  assert(stop(h));
  assert(messages(h).some(message=>message.text==='Partial reply before stop.'));
  assert.deepEqual(h.errors,[]);
  emit('turn/completed',{turn:{id:'next-turn',status:'failed',error:{message:'Current model failed'}}});
  await h.flush();
  assert.deepEqual(h.errors,['Current model failed']);
  assert.throws(()=>stop(h));
 }finally{h.unmount();}
});

test('a chat with a historical cancelled provider receipt still loads and continues its original thread',async()=>{
 const selected=conversation('deepseek','previously-cancelled');
 const h=agentHarness({props:{sessionSelection:{nonce:'saved-cancelled',conversation:selected}},override:(method,data,standard)=>{
  if(method==='agent.rpc'&&data.method==='thread/read')return {thread:{
   id:selected.threadId,turns:[{id:'old-turn',status:'cancelled',error:{message:'DeepSeek Harness cancelled; reconnect explicitly.'},items:[
    {id:'old-question',type:'userMessage',content:[{type:'text',text:'Saved question'}]},
    {id:'old-partial',type:'agentMessage',text:'Saved partial reply'}
   ]}]
  }};
  return standard(method,data);
 }});
 try{
  await h.flush();
  assert.deepEqual(messages(h).map(message=>message.text),['Saved question','Saved partial reply']);
  assert.deepEqual(h.errors,[]);
  h.type('Continue from the saved partial reply');h.send();await h.flush();
  assert.equal(rpcCalls(h,'thread/start').length,0);
  assert.deepEqual(rpcCalls(h,'turn/start').map(call=>call.data.params.threadId),[selected.threadId]);
 }finally{h.unmount();}
});

for(const choice of ['append','replace','cancel'])test('discussion suggestion '+choice+' protects existing and subsequently edited draft',async()=>{
 const h=agentHarness();try{await h.flush();h.type('Original draft');h.render({intent:{id:'proposal',text:'New discussion'}});await h.flush();assert.equal(h.textarea().props.value,'Original draft');h.type('Original draft with latest edits');h.click('agent-prompt-'+choice);await h.flush();assert.equal(h.textarea().props.value,choice==='append'?'Original draft with latest edits\n\nNew discussion':choice==='replace'?'New discussion':'Original draft with latest edits');assert.equal(rpcCalls(h,'turn/start').length,0);assert.throws(()=>h.find(node=>node.props?.['data-testid']==='agent-prompt-proposal'));}finally{h.unmount();}
});

test('a suggestion cannot alter the next conversation draft',async()=>{
 const h=agentHarness();try{await h.flush();h.type('A original');h.render({intent:{id:'proposal',text:'A discussion'}});await h.flush();const stale=h.find(node=>node.props?.['data-testid']==='agent-prompt-replace').props.onClick;h.render({sessionSelection:{nonce:'B',conversation:conversation('codex','B')}});await h.flush();h.type('B original');stale();await h.flush();assert.equal(h.textarea().props.value,'B original');assert.equal(rpcCalls(h,'turn/start').length,0);}finally{h.unmount();}
});

test('loading and failed conversation never display previous messages; explicit retry restores selected history',async()=>{
 const gate=deferred();let failed=false;const h=agentHarness({props:{sessionSelection:{nonce:'A',conversation:conversation('codex','A')}},override:(method,data,standard)=>{if(method==='agent.rpc'&&data.method==='thread/read'){if(data.params.threadId==='B'&&!failed)return gate.promise;return {thread:{id:data.params.threadId,turns:[{items:[{id:data.params.threadId+'-message',type:'agentMessage',text:'History '+data.params.threadId}]}]}};}return standard(method,data);}});
 try{await h.flush();assert.deepEqual(messages(h).map(message=>message.text),['History A']);h.type('A exact draft');h.render({sessionSelection:{nonce:'B',conversation:conversation('codex','B')}});assert.equal(messages(h).length,0,'even the pre-effect render must hide the previous owner');await h.flush();h.type('B exact draft');assert.equal(messages(h).length,0);assert(h.find(node=>node.props?.['data-testid']==='agent-history-state'));failed=true;gate.reject(Error('selected history unavailable'));await h.flush();assert.equal(messages(h).length,0);assert.equal(h.textarea().props.value,'B exact draft');h.click('agent-history-retry');await h.flush();assert.deepEqual(messages(h).map(message=>message.text),['History B']);assert.equal(h.textarea().props.value,'B exact draft');h.render({sessionSelection:{nonce:'A-return',conversation:conversation('codex','A')}});await h.flush();assert.equal(h.textarea().props.value,'A exact draft');assert.equal(rpcCalls(h,'turn/start').length,0);}finally{h.unmount();}
});

test('retry after a cross-provider local history failure reads only the selected API conversation',async()=>{
 let failed=false;const h=agentHarness({props:{sessionSelection:{nonce:'A',conversation:conversation('codex','A')}},override:(method,data,standard)=>{if(method==='agent.rpc'&&data.method==='thread/read'&&data.provider==='qwen'&&!failed){failed=true;throw Error('local record unavailable');}return standard(method,data);}});
 try{await h.flush();const before=h.calls.length;h.render({sessionSelection:{nonce:'B',conversation:conversation('qwen','B')}});await h.flush();h.click('agent-history-retry');await h.flush();assert.deepEqual(h.calls.slice(before).map(({method,data})=>[method,data.method||data.action,data.provider,data.params?.threadId??data.threadId]),[['agent.rpc','thread/read','qwen','B'],['agent.rpc','thread/read','qwen','B'],['agent.queue','read','qwen','B']]);}finally{h.unmount();}
});

for(const [provider,valid]of [['qwen',false],['compatible',true]])test(provider+' history is offline and Send checks the original profile before continuing',async()=>{
 const saved=conversation(provider,'historic'),original='api:original:fixture',other='api:other:fixture',storage=memoryStorage();
 storage.setItem('studio.model.'+provider,other);
 const h=agentHarness({storage,props:{sessionSelection:{nonce:'historic',conversation:saved}},override:(method,data,standard)=>{
  if(method==='agent.connect'&&!valid)throw Error('服务商配置不存在或已移除');
  if(method==='agent.rpc'&&data.method==='thread/read')return {thread:{id:'historic',provider,turns:[{items:[{id:'answer',type:'agentMessage',text:'Saved answer [redacted]'}]}]}};
  if(method==='agent.rpc'&&data.method==='thread/resume')return {thread:{id:'historic'},model:original};
  if(method==='agent.rpc'&&data.method==='model/list')return {data:[{model:other,profileId:'other',isDefault:true},{model:original,profileId:'original'}]};
  return standard(method,data);
 }});
 try{
  await h.flush();assert.deepEqual(messages(h).map(v=>v.text),['Saved answer [redacted]']);
  assert(h.find(node=>node.props?.['data-testid']==='agent-local-history'));
  assert(!h.calls.some(call=>['agent.connect','agent.account'].includes(call.method)||call.method==='agent.rpc'&&call.data.method!=='thread/read'));
  h.type('Continue the same conversation');assert.equal(sendButton(h).props.disabled,false);h.send();await h.flush();
  assert.deepEqual(h.calls.filter(call=>call.method==='agent.connect').map(call=>call.data),[{provider,repairTools:false,threadId:'historic'}]);
  if(valid){assert.deepEqual(starts(h).map(call=>[call.data.params.threadId,call.data.params.model]),[['historic',original]]);assert.equal(h.textarea().props.value,'');}
  else{assert.equal(starts(h).length,0);assert.equal(h.textarea().props.value,'Continue the same conversation');assert.match(JSON.stringify(h.find(node=>node.props?.className==='agent-send-notice')),/配置不存在或已移除/);}
  assert.equal(messages(h)[0].text,'Saved answer [redacted]');assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});

test('a late local API history read cannot replace a different selected provider or its draft',async()=>{
 const original=deferred(),h=agentHarness({props:{sessionSelection:{nonce:'qwen',conversation:conversation('qwen','same-id')}},override:(method,data,standard)=>{
  if(method==='agent.rpc'&&data.method==='thread/read')return data.provider==='qwen'?original.promise:{thread:{id:'same-id',provider:'compatible',turns:[{items:[{id:'second',type:'agentMessage',text:'Second provider history'}]}]}};
  return standard(method,data);
 }});
 try{
  await h.flush();h.render({sessionSelection:{nonce:'compatible',conversation:conversation('compatible','same-id')}});await h.flush();h.type('Second provider draft');
  original.resolve({thread:{id:'same-id',provider:'qwen',turns:[{items:[{id:'first',type:'agentMessage',text:'Stale provider history'}]}]}});await h.flush();
  assert.deepEqual(messages(h).map(v=>v.text),['Second provider history']);assert.equal(h.textarea().props.value,'Second provider draft');assert.equal(starts(h).length,0);
 }finally{h.unmount();}
});

test('switching chats during on-demand API connection preserves the draft and cancels the pending send',async()=>{
 const connection=deferred(),first=conversation('qwen','first'),second=conversation('qwen','second');
 const h=agentHarness({props:{sessionSelection:{nonce:'first',conversation:first}},override:(method,data,standard)=>method==='agent.connect'?connection.promise:standard(method,data)});
 try{
  await h.flush();h.type('Original draft');h.send();await h.flush();
  h.render({sessionSelection:{nonce:'second',conversation:second}});await h.flush();h.type('Second draft');
  connection.resolve({tools:{status:'ready',count:0}});await h.flush();assert.equal(h.textarea().props.value,'Second draft');
  h.render({sessionSelection:{nonce:'first-return',conversation:first}});await h.flush();assert.equal(h.textarea().props.value,'Original draft');
  assert.equal(rpcCalls(h,'thread/resume').length,0);assert.equal(starts(h).length,0);
 }finally{h.unmount();}
});

test('long discussion begins collapsed with an explicit primary append action',async()=>{
 const h=agentHarness();try{await h.flush();h.type('Retain original');h.render({intent:{id:'long',text:'Long discussion '.repeat(50)}});await h.flush();assert.equal(h.find(node=>node.props?.['data-testid']==='agent-prompt-preview').props.open,false);assert.equal(h.find(node=>node.props?.['data-testid']==='agent-prompt-append').props.variant,'primary');assert.equal(h.textarea().props.value,'Retain original');assert.equal(rpcCalls(h,'turn/start').length,0);}finally{h.unmount();}
});

test('stream update preserves completed message objects and stable actions for memoized rows',async()=>{
 const h=agentHarness({props:{sessionSelection:{nonce:'history',conversation:conversation('codex','history')}}});try{await h.flush();for(let i=0;i<250;i++)h.emit({provider:'codex',method:'item/agentMessage/delta',params:{threadId:'history',itemId:'message-'+i,delta:'Completed history '+i}});await h.flush();const before=messages(h),actions=h.find(node=>node.type==='./ChatMessage').props.actions;h.emit({provider:'codex',method:'item/agentMessage/delta',params:{threadId:'history',itemId:'message-249',delta:' more'}});await h.flush();const after=messages(h);assert.equal(after.length,250);for(let i=0;i<249;i++)assert.equal(after[i],before[i]);assert.notEqual(after[249],before[249]);assert.equal(h.find(node=>node.type==='./ChatMessage').props.actions,actions);}finally{h.unmount();}
});

const starts=h=>h.calls.filter(c=>c.method==='agent.rpc'&&c.data.method==='turn/start');
const sendButton=h=>h.find(n=>n.type==='button'&&n.props?.['aria-label']==='发送');
function seed(storage,id,text){const d=createComposerDrafts(()=>storage);d.activate('codex',id);d.edit(text);}

test('blocked scientific tools reject workflow send with visible actionable error, retain draft',async()=>{
 const bound={...conversation('codex','bound-blocked'),taskId:'owned-fixture-task'};
 const h=agentHarness({props:{sessionSelection:{nonce:'bound',conversation:bound}},override:(m,d,standard)=>m==='agent.connect'?{tools:{status:'blocked',message:'TEST ONLY scientific tools blocked'}}:m==='conversation.remember'?bound:standard(m,d)});
 await h.flush();h.type('PUBLIC TEST request');await h.flush();h.send();await h.flush();
 assert.equal(starts(h).length,0);assert.equal(h.textarea().props.value,'PUBLIC TEST request');assert.ok(h.errors.some(e=>e.includes('TEST ONLY scientific tools blocked')));h.unmount();
});
test('ordinary chat remains usable when scientific tools are blocked',async()=>{
 const h=agentHarness({override:(m,d,standard)=>m==='agent.connect'?{tools:{status:'blocked',message:'TEST ONLY tools blocked'}}:standard(m,d)});await h.flush();h.click('agent-connect');await h.flush();h.type('PUBLIC TEST ordinary chat');h.send();await h.flush();assert.equal(starts(h).length,1);assert.equal(h.errors.length,0);h.unmount();
});
test('stored thread draft without initial selection is explicitly restored before send',async()=>{
 const storage=memoryStorage();storage.setItem('studio.conversation','codex:fixture-existing');seed(storage,'fixture-existing','PUBLIC TEST stored draft');
 const h=agentHarness({storage});await h.flush();h.click('agent-connect');await h.flush();assert.equal(sendButton(h).props.disabled,true);h.click('agent-restore-draft');await h.flush();assert.equal(h.textarea().props.value,'PUBLIC TEST stored draft');assert.equal(sendButton(h).props.disabled,false);h.send();await h.flush();assert.equal(starts(h).length,1);assert.equal(starts(h)[0].data.params.threadId,'fixture-existing');h.unmount();
});
for(const phase of ['thread/start','turn/start'])test('selection before '+phase+' acknowledgement leaves both conversations independent',async()=>{
 const storage=memoryStorage(),late=deferred();seed(storage,'other','other original');
 const h=agentHarness({storage,override:(m,d,standard)=>m==='agent.rpc'&&d.method===phase?late.promise:standard(m,d)});
 try{await h.flush();h.click('agent-connect');await h.flush();h.type('old request');h.send();await h.flush();
  h.render({sessionSelection:{nonce:'switch-'+phase,conversation:conversation('codex','other')}});await h.flush();
  assert.equal(h.textarea().props.value,'other original');assert.throws(()=>stop(h));
  late.resolve(phase==='thread/start'?{thread:{id:'started-thread'}}:{turn:{id:'late-turn'}});await h.flush();
  assert.equal(h.textarea().props.value,'other original');assert.equal(starts(h).length,phase==='turn/start'?1:0);
  const draft=createComposerDrafts(()=>storage);draft.activate('codex',phase==='turn/start'?'started-thread':null);
  assert.equal(draft.text(),phase==='thread/start'?'old request':'');
 }finally{h.unmount();}
});

test('a second same-provider conversation sends immediately and a returned in-flight turn stops by exact identity',async()=>{
 const storage=memoryStorage(),a=conversation('codex','a'),b=conversation('codex','b');seed(storage,'a','first');seed(storage,'b','second');
 const h=agentHarness({storage,props:{sessionSelection:{nonce:'a',conversation:a}},override:(method,data,standard)=>{
  const id=data?.params?.threadId;
  if(method==='agent.rpc'&&data.method==='thread/read'&&id==='a')return {thread:{id,turns:[]},...starts(h).some(call=>call.data.params.threadId==='a')?{studioSession:{threadId:'a',busy:true,turnId:'turn-a',requests:[]}}:{}};
  if(method==='agent.rpc'&&data.method==='turn/start')return {turn:{id:'turn-'+id}};
  if(method==='agent.rpc'&&data.method==='turn/interrupt')return {};
  return standard(method,data);
 }});
 try{await h.flush();h.send();await h.flush();h.render({sessionSelection:{nonce:'b',conversation:b}});await h.flush();
  assert.equal(h.textarea().props.value,'second');h.send();await h.flush();
  assert.deepEqual(starts(h).map(call=>call.data.params.threadId),['a','b']);assert.equal(h.calls.some(call=>call.method==='agent.disconnect'),false);
  h.emit({method:'studio/codexDisconnected',provider:'codex',params:{threadId:'a'}});await h.flush();assert(stop(h));
  h.render({sessionSelection:{nonce:'return-a',conversation:a}});await h.flush();h.click('agent-stop');await h.flush();
  assert.deepEqual(rpcCalls(h,'turn/interrupt').map(call=>call.data.params),[{threadId:'a',turnId:'turn-a'}]);
 }finally{h.unmount();}
});

test('stop requested before acknowledgment still targets its origin when the response arrives in the background',async()=>{
 const ack=deferred(),a=conversation('codex','a'),b=conversation('codex','b');
 const h=agentHarness({props:{sessionSelection:{nonce:'a',conversation:a}},override:(method,data,standard)=>{
  if(method==='agent.rpc'&&data.method==='turn/start')return ack.promise;
  if(method==='agent.rpc'&&data.method==='turn/interrupt')return {};
  return standard(method,data);
 }});
 try{await h.flush();h.type('Stop this first reply');h.send();await h.flush();h.click('agent-stop');await h.flush();
  h.render({sessionSelection:{nonce:'b',conversation:b}});await h.flush();
  ack.resolve({turn:{id:'turn-a'}});await h.flush();
  assert.deepEqual(rpcCalls(h,'turn/interrupt').map(call=>call.data.params),[{threadId:'a',turnId:'turn-a'}]);
  assert.throws(()=>stop(h));assert.equal(h.textarea().props.value,'');
 }finally{h.unmount();}
});

test('Codex willRetry is transient progress, not failed model access or a persistent error',async()=>{
 const h=await connected();try{h.type('one harmless request');h.send();await h.flush();h.emit({method:'error',provider:'codex',params:{threadId:'started-thread',turnId:'accepted-turn',willRetry:true,error:{message:'Reconnecting... 2/5'}}});await h.flush();assert.deepEqual(h.errors,[]);assert.match(JSON.stringify(h.find(n=>n.props?.['data-testid']==='agent-work-state')),/正在重新连接模型服务/);assert.equal(starts(h).length,1);
 h.emit({method:'item/agentMessage/delta',provider:'codex',params:{threadId:'started-thread',turnId:'accepted-turn',itemId:'reply',delta:'actual reply'}});h.emit({method:'turn/completed',provider:'codex',params:{threadId:'started-thread',turn:{id:'accepted-turn',status:'completed'}}});await h.flush();assert.deepEqual(h.errors,[]);assert.throws(()=>stop(h));assert.equal(starts(h).length,1);
 }finally{h.unmount();}
});
test('nonretryable Codex errors remain visible',async()=>{const h=await connected();try{h.type('one');h.send();await h.flush();h.emit({method:'error',provider:'codex',params:{threadId:'started-thread',turnId:'accepted-turn',willRetry:false,error:{message:'definitive failure'}}});await h.flush();assert.deepEqual(h.errors,['definitive failure']);assert.equal(starts(h).length,1);}finally{h.unmount();}});
// Both history-fetch failure modes share one recovery contract, without duplicate setup.
for(const phase of ['thread/resume','thread/read'])test(phase+' failure offers one explicit recovery and preserves the exact bound draft',async()=>{
 let failed=false;const bound={...conversation('codex','failed-history'),taskId:'owned-fixture-task'};
 const h=agentHarness({props:{sessionSelection:{nonce:'failed',conversation:bound}},override:(method,data,standard)=>{if(method==='agent.rpc'&&data.method===phase&&!failed){failed=true;throw Error('read diagnostic');}if(method==='conversation.remember')return bound;return standard(method,data);}});
 try{await h.flush();assert(h.find(n=>n.props?.['data-testid']==='agent-history-retry'));assert.throws(()=>h.find(n=>n.props?.['data-testid']==='agent-restore-draft'));assert.equal(h.find(n=>n.props?.['data-testid']==='agent-history-error-details').props.open,undefined);
 h.type('Retained editable draft');assert.equal(sendButton(h).props.disabled,true);assert.equal(starts(h).length,0);h.click('agent-history-retry');await h.flush();assert.equal(h.textarea().props.value,'Retained editable draft');assert.equal(sendButton(h).props.disabled,false);assert.equal(starts(h).length,0);h.send();await h.flush();assert.equal(starts(h).length,1);assert.equal(starts(h)[0].data.params.threadId,'failed-history');
 }finally{h.unmount();}
});

test('live and resumed shared terminal sequences form one group across empty assistant messages',async()=>{
 const terminalTools=['list_shared_terminals','read_shared_terminal','write_shared_terminal','read_shared_terminal','write_shared_terminal','read_shared_terminal','write_shared_terminal'];
 const items=terminalTools.flatMap((tool,i)=>[
  {id:'assistant-'+i,type:'agentMessage',text:i%2?' \n\t':''},
  {id:'call-'+i,type:'mcpToolCall',tool,status:'completed',result:{content:[{type:'text',text:'terminal result '+i}]}}
 ]);
 const id='terminal-thread';
 const treeNodes=node=>Array.isArray(node)?node.flatMap(treeNodes):node&&typeof node==='object'?[node,...treeNodes(node.props?.children)]:[];
 for(const history of [false,true]){
  const h=agentHarness({
   props:{sessionSelection:{nonce:'terminal',conversation:conversation('codex',id)}},
   override:(method,data,standard)=>history&&method==='agent.rpc'&&data.method==='thread/read'?{thread:{id,turns:[{items}]}}:standard(method,data)
  });
  try{
   await h.flush();
   const emit=(method,params)=>h.emit({provider:'codex',method,params:{threadId:id,...params}});
   if(!history){
    for(const item of items){
     if(item.type==='mcpToolCall')emit('item/started',{item:{...item,status:'inProgress',result:null}});
     emit('item/completed',{item});
    }
    await h.flush();
   }
   const rendered=()=>treeNodes(h.find(node=>node.props?.className==='chat-scroll'));
   const groups=()=>rendered().filter(node=>node.props?.['data-testid']==='tool-group');
   assert.equal(groups().length,1,history?'history':'live');
   assert.deepEqual(messages(h).map(row=>row.toolName),terminalTools);
   assert.equal(groups()[0].props.open,undefined);
   // The empty item retains its transcript position if a later delta gives it real text.
   emit('item/agentMessage/delta',{itemId:'assistant-3',delta:'继续检查输出'});
   await h.flush();
   assert.deepEqual(groups().map(group=>treeNodes(group).filter(node=>node.type==='./ChatMessage').length),[3,4]);
   assert.equal(messages(h)[3].text.trim(),'继续检查输出');
  }finally{h.unmount();}
 }
});
