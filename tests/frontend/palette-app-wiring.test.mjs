import {conversationSelectionHarness} from "../helpers/conversation-selection-hooks.mjs";
import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import ts from'typescript';
const file=new URL("../../frontend/app/App.tsx",import.meta.url),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),nodes=[];function walk(node){nodes.push(node);ts.forEachChild(node,walk);}walk(ast);const component=nodes.filter(n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText(ast)==='ConversationCommands');assert.equal(component.length,1);const attrs=Object.fromEntries(component[0].attributes.properties.filter(ts.isJsxAttribute).map(a=>[a.name.text,a.initializer?.expression?.getText(ast)]));
test('three ordinary actions are confined to existing secondary command list; R4 generation preserved',()=>{let p=component[0].parent;while(p&&!(ts.isJsxElement(p)&&p.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.text==='className'&&a.initializer?.text==='command-list')))p=p.parent;assert(p);assert.equal(attrs.onNewConversation,'newConversation');const compute=nodes.find(n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText(ast)==='ComputeEnvironments');assert.equal(compute.attributes.properties.find(a=>a.name?.text==='workerGeneration').initializer.expression.getText(ast),'workerHydrationEpoch.current');});
test('App palette permits independent chats during replies and respects pending UI operations',()=>{
 const locks=['deleting','renaming','busy','imageSaving','modal','deleteTarget','renameTarget'];
 const expression=nodes.find(node=>ts.isVariableDeclaration(node)&&node.name.getText(ast)===attrs.blocked)?.initializer?.getText(ast)??attrs.blocked;
 const evaluate=new Function('agentBusy',...locks,'return ('+expression+');');
 const defaults=[false,false,false,false,'',null,null];
 for(const agentBusy of [false,true]){
  assert.equal(evaluate(agentBusy,...defaults),false);
  for(const [index,lock] of locks.entries()){
   const values=[...defaults];values[index]=lock==='modal'?'project-edit':true;
   assert.equal(evaluate(agentBusy,...values),true,lock);
  }
 }
});
test('show-list wiring only reveals existing list and preserves conversation/editor/flow state',()=>{const calls=[],run=new Function('setModal','return ('+attrs.onShowConversations+');')((...a)=>calls.push(['modal',...a]));run();assert.deepEqual(calls,[['modal','history']]);});
function newConversationHarness({agentBusy=false,editorDirty=false,confirm=true,mainAck=Promise.resolve({fresh:true})}={}){
 const calls=[],errors=[],openSeq={current:0},deploymentOpening={current:'original'};
 const h=conversationSelectionHarness({ports:{editorDirty,confirmReplace:()=>{calls.push(['confirm']);return confirm;},
  beforeSelection:()=>{openSeq.current++;deploymentOpening.current=null;calls.push(['beforeSelection']);},
  invoke:(method,data)=>{calls.push(['invoke',method,data]);assert.equal(method,'conversation.select');assert.deepEqual(data,{new:true});return mainAck;},
  observeWorker:async taskId=>{calls.push(['observeWorker',taskId]);return true;},onError:error=>errors.push(error)}});
 h.current().conversationChanged({id:'codex:original',provider:'codex',threadId:'original',taskId:'original-task'});h.current().setAgentBusy(agentBusy);h.render();
 return {h,fn:(...args)=>h.current().newConversation(...args),calls,errors,refs:{openSeq,deploymentOpening,selectedConversationRef:h.current().selectedConversationRef,freshSelectionPending:h.current().freshSelectionPending}};
}
test('production conversation hook preserves the current editor when confirmation is cancelled',async()=>{
 for(const agentBusy of [false,true]){
  const h=newConversationHarness({agentBusy,editorDirty:true,confirm:false});
  await h.fn(true);
  assert.deepEqual(h.calls,[['confirm']]);
  assert.equal(h.refs.selectedConversationRef.current.taskId,'original-task');
  assert.equal(h.refs.openSeq.current,0);
  assert.equal(h.refs.deploymentOpening.current,'original');
  assert.equal(h.refs.freshSelectionPending.current,null);
  assert.deepEqual(h.errors,[]);
 }
});
for(const agentBusy of [false,true])test('production new chat/task awaits main acknowledgement '+(agentBusy?'during a reply':'while idle'),async()=>{
 for(const planning of [false,true]){let acknowledge;const mainAck=new Promise(resolve=>acknowledge=resolve),h=newConversationHarness({agentBusy,editorDirty:true,mainAck}),pending=h.fn(planning);await new Promise(resolve=>setImmediate(resolve));h.h.render();
  assert.deepEqual(h.calls.filter(c=>c[0]==='confirm'),[['confirm']]);assert.deepEqual(h.calls.filter(c=>c[0]==='invoke'),[['invoke','conversation.select',{new:true}]]);assert.deepEqual(h.h.current().sessionSelection,{nonce:'selection-nonce-1',new:true,pending:true});assert.equal(h.h.current().planningMode,false);assert.equal(h.refs.selectedConversationRef.current.taskId,'original-task');assert.equal(h.refs.freshSelectionPending.current.promise,mainAck);assert(!h.calls.some(c=>c[0]==='observeWorker'));
  acknowledge({fresh:true});await pending;h.h.render();
  assert.equal(h.h.current().planningMode,planning);assert.deepEqual(h.h.current().sessionSelection,{nonce:'selection-nonce-2',new:true});assert.equal(h.refs.selectedConversationRef.current,null);assert.equal(h.refs.freshSelectionPending.current,null);assert.equal(h.calls.filter(c=>c[0]==='beforeSelection').length,1);assert.equal(h.calls.filter(c=>c[0]==='observeWorker').length,1);assert(h.calls.every(c=>!/(?:send|prepare|execute|connect)/i.test(c[0])));assert.deepEqual(h.errors,[]);
 }
});
