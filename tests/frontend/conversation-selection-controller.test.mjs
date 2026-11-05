import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationSelectionHarness} from "../helpers/conversation-selection-hooks.mjs";
import {conversation,deferred,memoryStorage} from "../helpers/agent-hooks.mjs";

test('conversation hook reads only the saved preference before explicit selection',()=>{
 const storage=memoryStorage();storage.setItem('studio.conversation','codex:previous');
 const h=conversationSelectionHarness({storage});
 assert.equal(h.current().selectedConversationId,'codex:previous');
 assert.equal(h.current().selectedConversationRef.current,null);
 assert.equal(h.current().sessionSelection,undefined);assert.deepEqual(h.calls,[]);
});

test('saved selection waits for settings, main ownership and worker observation before publishing Agent selection',async()=>{
 const ready=deferred(),ack=deferred(),worker=deferred(),selected={...conversation('codex','owned'),taskId:'owned-task'},calls=[];
 const h=conversationSelectionHarness({ports:{settingsReady:{current:ready.promise},
  invoke:(method,data)=>{calls.push({method,data});return ack.promise;},
  observeWorker:taskId=>{calls.push({observe:taskId});return worker.promise;}}});
 const action=h.current().chooseConversation(selected);h.render();assert.deepEqual(calls,[]);assert.equal(h.current().sessionSelection,undefined);
 ready.resolve();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[{method:'conversation.select',data:{id:selected.id}}]);assert.equal(h.current().selectedConversationRef.current,null);
 ack.resolve(selected);await new Promise(resolve=>setImmediate(resolve));h.render();assert.equal(h.current().selectedConversationRef.current,selected);assert.equal(h.storage.getItem('studio.conversation'),selected.id);assert.equal(h.current().sessionSelection,undefined);assert.deepEqual(calls.at(-1),{observe:'owned-task'});
 worker.resolve(true);await action;h.render();assert.equal(h.current().sessionSelection.conversation,selected);assert.equal(h.current().sessionSelection.pending,undefined);
 assert.deepEqual(h.calls.map(call=>call[0]),['beforeSelection','clearIntent','beginWorkerGate','onSelected']);
});

test('navigation or unmount while settings are pending prevents a main-process selection',async()=>{
 for(const invalidate of [h=>h.current().conversationSelectionSeq.current++,h=>h.unmount()]){
  const ready=deferred(),h=conversationSelectionHarness({ports:{settingsReady:{current:ready.promise}}});
  const action=h.current().chooseConversation(conversation('codex','old'));invalidate(h);ready.resolve();await action;h.render();
  assert.equal(h.current().selectedConversationRef.current,null);assert.equal(h.current().sessionSelection,undefined);assert(!h.calls.some(call=>call[0]==='invoke'));assert.deepEqual(h.errors,[]);
 }
});

test('late saved selection acknowledgement cannot replace a newer selected owner',async()=>{
 const ack=deferred(),old=conversation('codex','old'),latest=conversation('qwen','latest'),calls=[];
 const h=conversationSelectionHarness({ports:{invoke:(method,data)=>{calls.push({method,data});return data.id===old.id?ack.promise:Promise.resolve(latest);}}});
 const stale=h.current().chooseConversation(old);await new Promise(resolve=>setImmediate(resolve));
 await h.current().chooseConversation(latest);h.render();ack.resolve(old);await stale;h.render();
 assert.equal(h.current().selectedConversationRef.current,latest);assert.equal(h.current().sessionSelection.conversation,latest);assert.equal(h.storage.getItem('studio.conversation'),latest.id);
 assert.deepEqual(h.calls.filter(call=>call[0]==='onSelected').map(call=>call[1]),[latest]);assert.equal(calls.length,2);
});

test('busy and rejected editor replacement guard both saved and fresh selection without changing ownership',async()=>{
 for(const mode of ['busy','dirty']){
  let confirmations=0;const h=conversationSelectionHarness({ports:{editorDirty:mode==='dirty',confirmReplace:()=>{confirmations++;return false;}}}),original=conversation('codex','kept');
  h.current().conversationChanged(original);h.current().setAgentBusy(mode==='busy');h.render();
  await h.current().chooseConversation(conversation('qwen','other'));await h.current().newConversation(true,'seed');h.render();
  assert.equal(h.current().selectedConversationRef.current,original);assert.equal(h.current().freshSelectionPending.current,null);assert.equal(h.current().conversationSelectionSeq.current,0);assert.deepEqual(h.calls,[]);assert.equal(confirmations,mode==='busy'?0:2);
 }
});

test('Agent owner callbacks require the current nonce and cannot escape a pending fresh selection',async()=>{
 const ack=deferred(),original=conversation('codex','original'),next=conversation('codex','next');
 const h=conversationSelectionHarness({ports:{invoke:()=>ack.promise}});h.current().conversationChanged(original);h.current().setSessionSelection({nonce:'old-nonce',conversation:original});h.render();
 const oldCallback=h.current().acceptAgentConversation,action=h.current().newConversation();
 oldCallback(next,'old-nonce');assert.equal(h.current().selectedConversationRef.current,original);h.render();
 h.current().acceptAgentConversation(next,h.current().sessionSelection.nonce);assert.equal(h.current().selectedConversationRef.current,original);
 ack.resolve({fresh:true});await action;h.render();oldCallback(original,'old-nonce');assert.equal(h.current().selectedConversationRef.current,null);
 h.current().acceptAgentConversation(next,h.current().sessionSelection.nonce);h.render();assert.equal(h.current().selectedConversationRef.current,next);assert.equal(h.storage.getItem('studio.conversation'),next.id);assert.equal(h.current().conversations[0],next);
});

test('fresh acknowledgement after unmount cannot clear the original selection or publish a seed',async()=>{
 const ack=deferred(),original=conversation('codex','kept'),h=conversationSelectionHarness({ports:{invoke:()=>ack.promise}});
 h.current().conversationChanged(original);h.render();const action=h.current().newConversation(true,'seed');h.render();h.unmount();ack.resolve({fresh:true});await action;h.render();
 assert.equal(h.current().selectedConversationRef.current,original);assert.equal(h.storage.getItem('studio.conversation'),original.id);assert.equal(h.current().sessionSelection.pending,true);assert.equal(h.current().sessionSelection.initialPrompt,undefined);assert(!h.calls.some(call=>call[0]==='observeWorker'||call[0]==='onFreshSelected'));
});

test('fresh failure and failed rollback retain the exact retry mode and seed without sending',async()=>{
 const original=conversation('codex','original'),calls=[];let attempts=0;
 const h=conversationSelectionHarness({ports:{language:'en',invoke:(method,data)=>{calls.push({method,data});if(data.new&&++attempts===2)return Promise.resolve({fresh:true});return Promise.reject(Error(data.new?'fresh failed':'rollback failed'));}}});
 h.current().conversationChanged(original);h.render();await h.current().newConversation(true,'Exact retry seed');h.render();
 assert.equal(h.current().sessionSelection.pending,true);assert.equal(h.current().sessionSelection.error,'The new chat is not ready. Try again.');assert.equal(h.current().sessionSelection.initialPrompt,undefined);assert.equal(h.current().selectedConversationRef.current,original);assert.equal(h.errors.length,2);
 h.current().setAgentBusy(true);h.render();await h.current().retryNewConversation();h.render();
 assert.equal(h.current().planningMode,true);assert.equal(h.current().sessionSelection.initialPrompt,'Exact retry seed');assert.equal(h.current().sessionSelection.pending,undefined);assert.deepEqual(calls.map(call=>call.data),[{new:true},{id:original.id},{new:true}]);assert(calls.every(call=>call.method==='conversation.select'));
});

test('saved selection failures report through the shell gate while storage failures never block owner changes',async()=>{
 const failure=Error('selection rejected'),errors=[],h=conversationSelectionHarness({ports:{invoke:()=>Promise.reject(failure),onSelectionError:error=>errors.push(error)}});
 await h.current().chooseConversation(conversation('codex','rejected'));assert.deepEqual(errors,[failure]);assert.deepEqual(h.errors,[]);assert.equal(h.current().sessionSelection,undefined);
 const storage={getItem(){throw Error('unavailable');},setItem(){throw Error('quota');},removeItem(){throw Error('unavailable');}},local=conversationSelectionHarness({storage}),selected=conversation('qwen','local');
 local.current().conversationChanged(selected);local.render();assert.equal(local.current().selectedConversationRef.current,selected);assert.equal(local.current().selectedConversationId,selected.id);local.current().conversationChanged(null);local.render();assert.equal(local.current().selectedConversationRef.current,null);assert.deepEqual(local.errors,[]);
});
