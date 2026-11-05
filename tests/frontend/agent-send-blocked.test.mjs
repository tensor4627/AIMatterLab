import test from 'node:test';
import assert from 'node:assert/strict';
import {agentHarness,conversation,memoryStorage,deferred} from "../helpers/agent-hooks.mjs";
import {createComposerDrafts} from "../../frontend/features/conversations/composer-drafts.mjs";

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
test('failed bound-thread resume offers explicit recovery; retained text sends only after recovery',async()=>{
 const bound={...conversation('codex','resume-failed'),taskId:'owned-fixture-task'};let fail=true;
 const h=agentHarness({props:{sessionSelection:{nonce:'bound-failure',conversation:bound}},override:(m,d,standard)=>{if(m==='agent.rpc'&&d.method==='thread/resume'&&fail){fail=false;throw Error('TEST ONLY resume failed');}if(m==='conversation.remember')return bound;return standard(m,d);}});
 await h.flush();h.type('PUBLIC TEST preserved draft');await h.flush();assert.equal(sendButton(h).props.disabled,true);h.click('agent-restore-draft');await h.flush();assert.equal(h.textarea().props.value,'PUBLIC TEST preserved draft');assert.equal(sendButton(h).props.disabled,false);h.send();await h.flush();assert.equal(starts(h).length,1);assert.equal(starts(h)[0].data.params.threadId,'resume-failed');h.unmount();
});
test('stored thread draft without initial selection is explicitly restored before send',async()=>{
 const storage=memoryStorage();storage.setItem('studio.conversation','codex:fixture-existing');seed(storage,'fixture-existing','PUBLIC TEST stored draft');
 const h=agentHarness({storage});await h.flush();h.click('agent-connect');await h.flush();assert.equal(sendButton(h).props.disabled,true);h.click('agent-restore-draft');await h.flush();assert.equal(h.textarea().props.value,'PUBLIC TEST stored draft');assert.equal(sendButton(h).props.disabled,false);h.send();await h.flush();assert.equal(starts(h).length,1);assert.equal(starts(h)[0].data.params.threadId,'fixture-existing');h.unmount();
});
for(const phase of ['thread/start','turn/start'])test('selection queued before '+phase+' acknowledgement preserves both drafts and never replays',async()=>{
 const storage=memoryStorage(),late=deferred();seed(storage,'other','other original');const h=agentHarness({storage,override:(m,d,standard)=>m==='agent.rpc'&&d.method===phase?late.promise:m==='agent.rpc'&&d.method==='turn/interrupt'?{}:standard(m,d)});await h.flush();h.click('agent-connect');await h.flush();h.type('old request');h.send();await h.flush();h.render({sessionSelection:{nonce:'switch-'+phase,conversation:conversation('codex','other')}});await h.flush();late.resolve(phase==='thread/start'?{thread:{id:'started-thread'}}:{turn:{id:'late-turn'}});await h.flush();if(phase==='turn/start'){assert.notEqual(h.textarea().props.value,'other original');h.find(n=>n.type==='button'&&n.props?.['aria-label']==='中断 Agent，计算作业继续').props.onClick();await h.flush();const interrupts=h.calls.filter(c=>c.method==='agent.rpc'&&c.data.method==='turn/interrupt');assert.equal(interrupts.length,1);assert.equal(interrupts[0].data.params.turnId,'late-turn');h.emit({method:'turn/completed',provider:'codex',params:{threadId:'started-thread',turn:{id:'late-turn',status:'completed'}}});await h.flush();}assert.equal(h.textarea().props.value,'other original');h.type('other newest');await h.flush();assert.equal(h.textarea().props.value,'other newest');assert.equal(starts(h).length,phase==='turn/start'?1:0);const d=createComposerDrafts(()=>storage);d.activate('codex',phase==='turn/start'?'started-thread':null);assert.equal(d.text(),'old request');h.unmount();
});
test('selection queued during acknowledged turn activates only after completion',async()=>{
 const storage=memoryStorage();seed(storage,'other','other original');const h=agentHarness({storage});await h.flush();h.click('agent-connect');await h.flush();h.type('old request');h.send();await h.flush();assert.equal(starts(h).length,1);h.render({sessionSelection:{nonce:'queued-after-ack',conversation:conversation('codex','other')}});await h.flush();assert.notEqual(h.textarea().props.value,'other original');h.emit({method:'turn/completed',provider:'codex',params:{threadId:'started-thread',turn:{id:'accepted-turn',status:'completed'}}});await h.flush();assert.equal(h.textarea().props.value,'other original');assert.equal(starts(h).length,1);h.unmount();
});
