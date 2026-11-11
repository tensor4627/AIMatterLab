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
  ack.resolve({turn:{id:'exact-turn'}});await h.flush();assert.deepEqual(rpcCalls(h,'turn/interrupt').map(call=>call.data.params),[{threadId:'started-thread',turnId:'exact-turn'}]);assert.equal(h.textarea().props.value,'Keep while stopping');
  h.emit({provider:'codex',method:'turn/started',params:{threadId:'started-thread',turn:{id:'exact-turn'}}});click();await h.flush();assert.equal(rpcCalls(h,'turn/interrupt').length,1);interrupt.resolve({});await h.flush();h.emit({provider:'codex',method:'turn/completed',params:{threadId:'started-thread',turn:{id:'exact-turn',status:'interrupted'}}});await h.flush();assert.equal(rpcCalls(h,'turn/start').length,1);assert.equal(h.textarea().props.value,'Keep while stopping');
 }finally{h.unmount();}
});

for(const newer of [false,true])test('unconfirmed interrupt preserves '+(newer?'newer typing':'accepted draft')+' and retries only explicitly',async()=>{
 let attempts=0;const h=await connected({override:(method,data,standard)=>{if(method==='agent.rpc'&&data.method==='turn/interrupt'){if(++attempts===1)throw Error('interrupt acknowledgement missing');return {};}return standard(method,data);}});
 try{h.type('Original accepted request');h.send();await h.flush();assert.equal(h.textarea().props.value,'');if(newer)h.type('New unsent work');stop(h).props.onClick();await h.flush();assert.equal(h.textarea().props.value,newer?'New unsent work':'Original accepted request');assert.equal(rpcCalls(h,'turn/interrupt').length,1);assert.equal(stop(h).props['aria-label'],'再次请求停止');assert.equal(rpcCalls(h,'turn/start').length,1);stop(h).props.onClick();await h.flush();assert.equal(rpcCalls(h,'turn/interrupt').length,2);assert.equal(rpcCalls(h,'turn/start').length,1);
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

test('retry after provider-switch failure selects the intended provider before reading its history',async()=>{
 let failed=false;const h=agentHarness({props:{sessionSelection:{nonce:'A',conversation:conversation('codex','A')}},override:(method,data,standard)=>{if(method==='agent.disconnect'&&!failed){failed=true;throw Error('switch acknowledgement missing');}return standard(method,data);}});
 try{await h.flush();h.render({sessionSelection:{nonce:'B',conversation:conversation('qwen','B')}});await h.flush();assert(h.find(node=>node.props?.['data-testid']==='agent-history-retry'));h.click('agent-history-retry');await h.flush();assert.equal(rpcCalls(h,'thread/read').at(-1).data.provider,'qwen');assert.equal(rpcCalls(h,'thread/read').at(-1).data.params.threadId,'B');assert.equal(rpcCalls(h,'turn/start').length,0);}finally{h.unmount();}
});

test('long discussion begins collapsed with an explicit primary append action',async()=>{
 const h=agentHarness();try{await h.flush();h.type('Retain original');h.render({intent:{id:'long',text:'Long discussion '.repeat(50)}});await h.flush();assert.equal(h.find(node=>node.props?.['data-testid']==='agent-prompt-preview').props.open,false);assert.match(h.find(node=>node.props?.['data-testid']==='agent-prompt-append').props.className,/primary/);assert.equal(h.textarea().props.value,'Retain original');assert.equal(rpcCalls(h,'turn/start').length,0);}finally{h.unmount();}
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
for(const phase of ['thread/start','turn/start'])test('selection queued before '+phase+' acknowledgement preserves both drafts and never replays',async()=>{
 const storage=memoryStorage(),late=deferred();seed(storage,'other','other original');const h=agentHarness({storage,override:(m,d,standard)=>m==='agent.rpc'&&d.method===phase?late.promise:m==='agent.rpc'&&d.method==='turn/interrupt'?{}:standard(m,d)});await h.flush();h.click('agent-connect');await h.flush();h.type('old request');h.send();await h.flush();h.render({sessionSelection:{nonce:'switch-'+phase,conversation:conversation('codex','other')}});await h.flush();late.resolve(phase==='thread/start'?{thread:{id:'started-thread'}}:{turn:{id:'late-turn'}});await h.flush();if(phase==='turn/start'){assert.notEqual(h.textarea().props.value,'other original');h.find(n=>n.type==='button'&&n.props?.['aria-label']==='中断 Agent，计算作业继续').props.onClick();await h.flush();const interrupts=h.calls.filter(c=>c.method==='agent.rpc'&&c.data.method==='turn/interrupt');assert.equal(interrupts.length,0,'never interrupt a request after its selection identity changed');assert(h.find(n=>typeof n.props?.children==='string'&&n.props.children.includes('请求归属已变化')));h.emit({method:'turn/completed',provider:'codex',params:{threadId:'started-thread',turn:{id:'late-turn',status:'completed'}}});await h.flush();}assert.equal(h.textarea().props.value,'other original');h.type('other newest');await h.flush();assert.equal(h.textarea().props.value,'other newest');assert.equal(starts(h).length,phase==='turn/start'?1:0);const d=createComposerDrafts(()=>storage);d.activate('codex',phase==='turn/start'?'started-thread':null);assert.equal(d.text(),'old request');h.unmount();
});
test('selection queued during acknowledged turn activates only after completion',async()=>{
 const storage=memoryStorage();seed(storage,'other','other original');const h=agentHarness({storage});await h.flush();h.click('agent-connect');await h.flush();h.type('old request');h.send();await h.flush();assert.equal(starts(h).length,1);h.render({sessionSelection:{nonce:'queued-after-ack',conversation:conversation('codex','other')}});await h.flush();assert.notEqual(h.textarea().props.value,'other original');h.emit({method:'turn/completed',provider:'codex',params:{threadId:'started-thread',turn:{id:'accepted-turn',status:'completed'}}});await h.flush();assert.equal(h.textarea().props.value,'other original');assert.equal(starts(h).length,1);h.unmount();
});

// Both history-fetch failure modes share one recovery contract, without duplicate setup.
for(const phase of ['thread/resume','thread/read'])test(phase+' failure offers one explicit recovery and preserves the exact bound draft',async()=>{
 let failed=false;const bound={...conversation('codex','failed-history'),taskId:'owned-fixture-task'};
 const h=agentHarness({props:{sessionSelection:{nonce:'failed',conversation:bound}},override:(method,data,standard)=>{if(method==='agent.rpc'&&data.method===phase&&!failed){failed=true;throw Error('read diagnostic');}if(method==='conversation.remember')return bound;return standard(method,data);}});
 try{await h.flush();assert(h.find(n=>n.props?.['data-testid']==='agent-history-retry'));assert.throws(()=>h.find(n=>n.props?.['data-testid']==='agent-restore-draft'));assert.equal(h.find(n=>n.props?.['data-testid']==='agent-history-error-details').props.open,undefined);
 h.type('Retained editable draft');assert.equal(sendButton(h).props.disabled,true);assert.equal(starts(h).length,0);h.click('agent-history-retry');await h.flush();assert.equal(h.textarea().props.value,'Retained editable draft');assert.equal(sendButton(h).props.disabled,false);assert.equal(starts(h).length,0);h.send();await h.flush();assert.equal(starts(h).length,1);assert.equal(starts(h)[0].data.params.threadId,'failed-history');
 }finally{h.unmount();}
});
