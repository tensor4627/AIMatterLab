// Actual workflow navigation + actual C5 conversation selection hooks, controlled transports only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
import {conversationSelectionHarness} from "../helpers/conversation-selection-hooks.mjs";

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const conversation=(thread,taskId)=>({id:'codex:'+thread,provider:'codex',threadId:thread,name:thread,projectId:null,taskId});
const original=conversation('original','original-task'),other=conversation('other','other-task'),third=conversation('third','third-task');
const location=(run_id='run',target=original,step_id='first')=>({run_id,task_id:target.taskId,provider:target.provider,thread_id:target.threadId,conversation_id:target.id,workspace_id:'workspace',workflow_id:'workflow',execution_id:'execution',step_id});
const compiled=ts.transpileModule(fs.readFileSync(new URL("../../frontend/features/workflows/useToolWorkflowNavigation.ts",import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const apiCompiled=ts.transpileModule(fs.readFileSync(new URL("../../frontend/api/tool-workflows.ts",import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

function harness({selected=other,rows=[original,other,third],locate=async id=>location(id),select,observeWorker=async()=>true}={}){
 const navigationSequence={current:0},opened=[],errors=[],selectedErrors=[],chooseCalls=[],transportCalls=[],hooks=[];let cursor=0,dirty=false,navigation,overrides={},selection;
 const react={useState(initial){const index=cursor++;hooks[index]??={value:typeof initial==='function'?initial():initial};return [hooks[index].value,value=>{hooks[index].value=typeof value==='function'?value(hooks[index].value):value;dirty=true;}];},useRef(initial){const index=cursor++;return hooks[index]??={current:initial};}};
 selection=conversationSelectionHarness({ports:{beforeSelection:()=>{navigationSequence.current++;},observeWorker,onSelectionError:error=>selectedErrors.push(error),onError:error=>selectedErrors.push(error),invoke:async(method,value)=>{transportCalls.push({method,value});assert.equal(method,'conversation.select');assert.equal(typeof value.id,'string');if(select)return select(value.id);const found=selection.current().conversations.find(row=>row.id===value.id);assert(found);return found;}}});
 selection.current().setConversations(rows);selection.current().conversationChanged(selected);selection.render();
 const apiModule={exports:{}};new Function('require','module','exports',apiCompiled)(name=>{assert.equal(name,'./studio');return {invoke:async(method,value)=>{transportCalls.push({method,value});assert.equal(method,'tools.workflows.locateRun');return locate(value.run_id);}};},apiModule,apiModule.exports);
 const module={exports:{}};new Function('require','module','exports','crypto',compiled)(name=>name==='react'?react:name==='../../api/tool-workflows'?apiModule.exports:(()=>{throw Error('Unexpected navigation dependency '+name);})(),module,module.exports,{randomUUID});
 const choose=async value=>{chooseCalls.push(value);const promise=selection.current().chooseConversation(value);selection.render();render();await promise;selection.render();render();};
 function render(changes={}){overrides={...overrides,...changes};cursor=0;dirty=false;navigation=module.exports.useToolWorkflowNavigation({mounted:selection.mounted,selected:selection.current().selectedConversationRef,selectionSequence:selection.current().conversationSelectionSeq,navigationSequence,busy:false,conversations:selection.current().conversations,chooseConversation:choose,onOpen:value=>opened.push(value),onError:error=>errors.push(error),...overrides});return navigation;}
 async function flush(){for(let i=0;i<8;i++){await new Promise(done=>setImmediate(done));if(dirty)render();}}
 render();return {selection,navigationSequence,opened,errors,selectedErrors,chooseCalls,transportCalls,render,flush,current:()=>navigation,open:id=>navigation.open(id),rows:value=>{selection.current().setConversations(value);selection.render();render();},unmount:()=>{selection.unmount();},externalChoose:async value=>{await selection.current().chooseConversation(value);selection.render();render();}};
}

test('same-conversation location uses the real typed readonly client, avoids choose, and publishes a fresh step nonce',async()=>{
 const h=harness({selected:original});await h.open('run');await h.flush();assert.deepEqual(h.transportCalls,[{method:'tools.workflows.locateRun',value:{run_id:'run'}}]);assert.equal(h.chooseCalls.length,0);assert.equal(h.opened.length,1);assert.deepEqual({...h.current().focus,nonce:'nonce'},{task_id:'original-task',execution_id:'execution',step_id:'first',nonce:'nonce'});const nonce=h.current().focus.nonce;await h.open('run');await h.flush();assert.notEqual(h.current().focus.nonce,nonce);assert.equal(h.chooseCalls.length,0);
});

for(const agentBusy of [false,true])test('another conversation waits for the actual selection ACK '+(agentBusy?'during a reply':'while idle'),async()=>{
 const ack=deferred(),entered=deferred(),h=harness({select:async()=>{entered.resolve();return ack.promise;}});
 h.selection.current().setAgentBusy(agentBusy);h.selection.render();h.render();
 const pending=h.open('run');await entered.promise;assert.equal(h.opened.length,0);assert.equal(h.current().focus,undefined);assert.equal(h.selection.current().conversationSelectionSeq.current,1);assert.equal(h.navigationSequence.current,2);ack.resolve(original);await pending;await h.flush();assert.equal(h.opened.length,1);assert.equal(h.selection.current().selectedConversationRef.current.id,original.id);assert.equal(h.current().focus.task_id,original.taskId);
});

for(const mode of ['cancel','failed'])test('actual '+(mode==='cancel'?'editor cancellation':'rejected selection')+' preserves the current workflow view',async()=>{
 const failure=Error('Select failed'),h=harness({select:async()=>{throw failure;}});
 if(mode==='cancel')h.selection.render({editorDirty:true,confirmReplace:()=>false});
 await h.open('run');await h.flush();
 assert.equal(h.opened.length,0);
 assert.equal(h.current().focus,undefined);
 assert.equal(h.selection.current().selectedConversationRef.current.id,other.id);
 assert.equal(h.chooseCalls.length,1);
 assert.equal(h.transportCalls.filter(call=>call.method==='conversation.select').length,mode==='failed'?1:0);
 assert.deepEqual(h.selectedErrors,mode==='failed'?[failure]:[]);
 assert.deepEqual(h.errors,[]);
});

test('missing or changed original task/provider/thread binding never falls back to another conversation',async()=>{
 for(const rows of [[other,third],[{...original,taskId:'new-task'},other],[{...original,provider:'deepseek'},other],[{...original,threadId:'new-thread'},other]]){const h=harness({rows});await h.open('run');await h.flush();assert.equal(h.opened.length,0);assert.equal(h.chooseCalls.length,0);assert.equal(h.errors.length,1);assert.match(String(h.errors[0]),/original workflow conversation/);assert.equal(h.selection.current().selectedConversationRef.current.id,other.id);}
 const h=harness({select:async()=>({...original,taskId:'changed-after-select'})});await h.open('run');await h.flush();assert.equal(h.opened.length,0);assert.equal(h.current().focus,undefined);assert.equal(h.chooseCalls.length,1);
});

for(const transition of ['selection','navigation','unmount','busy'])test('a '+transition+' transition during locate suppresses late focus/error',async()=>{
 const gate=deferred(),h=harness({locate:()=>gate.promise}),pending=h.open('run');if(transition==='selection')await h.externalChoose(third);if(transition==='navigation')h.navigationSequence.current++;if(transition==='unmount')h.unmount();if(transition==='busy')h.render({busy:true});gate.resolve(location());await pending;await h.flush();assert.equal(h.opened.length,0);assert.equal(h.current().focus,undefined);assert.equal(h.errors.length,0);
});

for(const transition of ['selection','navigation','unmount','busy'])test('a '+transition+' transition during acknowledged selection suppresses late focus',async()=>{
 const ack=deferred(),entered=deferred(),h=harness({select:async id=>{if(id===original.id){entered.resolve();return ack.promise;}return third;}}),pending=h.open('run');await entered.promise;if(transition==='selection')await h.externalChoose(third);if(transition==='navigation')h.navigationSequence.current++;if(transition==='unmount')h.unmount();if(transition==='busy')h.render({busy:true});ack.resolve(original);await pending;await h.flush();assert.equal(h.opened.length,0);assert.equal(h.current().focus,undefined);assert.equal(h.errors.length,0);
});

test('rapid location clicks and rapid real selections let only the last request publish focus',async()=>{
 const one=deferred(),two=deferred(),h=harness({selected:original,locate:id=>id==='one'?one.promise:two.promise}),first=h.open('one'),second=h.open('two');two.resolve(location('two',original,'second'));await second;one.reject(Error('Late old read'));await first;await h.flush();assert.equal(h.opened.length,1);assert.equal(h.current().focus.step_id,'second');assert.equal(h.errors.length,0);
 const a=deferred(),b=deferred(),enteredA=deferred(),enteredB=deferred(),g=harness({selected:third,locate:async id=>location(id,id==='one'?original:other,id),select:async id=>{if(id===original.id){enteredA.resolve();return a.promise;}enteredB.resolve();return b.promise;}}),p1=g.open('one');await enteredA.promise;const p2=g.open('two');await enteredB.promise;a.resolve(original);await p1;assert.equal(g.opened.length,0);b.resolve(other);await p2;await g.flush();assert.equal(g.opened.length,1);assert.equal(g.opened[0].run_id,'two');assert.equal(g.current().focus.task_id,other.taskId);
});

test('read failure is reported only to its current scope and busy start performs no read or selection',async()=>{
 const error=Error('Current readonly lookup failed'),current=harness({locate:async()=>{throw error;}});await current.open('run');assert.deepEqual(current.errors,[error]);assert.equal(current.chooseCalls.length,0);
 for(const transition of ['navigation','selection','unmount','busy']){const gate=deferred(),h=harness({locate:()=>gate.promise}),pending=h.open('run');if(transition==='navigation')h.navigationSequence.current++;if(transition==='selection')await h.externalChoose(third);if(transition==='unmount')h.unmount();if(transition==='busy')h.render({busy:true});gate.reject(Error('Late readonly failure'));await pending;assert.equal(h.errors.length,0);}
 const busy=harness();busy.render({busy:true});await busy.open('run');assert.equal(busy.transportCalls.length,0);assert.equal(busy.chooseCalls.length,0);assert.equal(busy.navigationSequence.current,0);
});

test('a binding changed in current conversation metadata while worker observation waits cannot focus the old task',async()=>{
 const observing=deferred(),entered=deferred(),h=harness({observeWorker:async()=>{entered.resolve();return observing.promise;}}),pending=h.open('run');await entered.promise;assert.equal(h.selection.current().selectedConversationRef.current.taskId,original.taskId);h.rows([{...original,taskId:'replacement-task'},other,third]);observing.resolve(true);await pending;await h.flush();assert.equal(h.opened.length,0);assert.equal(h.current().focus,undefined);
});
