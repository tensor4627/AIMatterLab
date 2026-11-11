import test from 'node:test';
import assert from 'node:assert/strict';
import {appWorkerHarness} from '../helpers/app-worker-hooks.mjs';
import {agentHarness,memoryStorage,conversation} from '../helpers/agent-hooks.mjs';

const shell=h=>h.find(node=>node.props?.className?.startsWith?.('shell workspace-shell'));
const agent=h=>h.find(node=>node.type==='./Agent');
const terminal=h=>h.find(node=>node.type==='./SharedTerminalPanel');

test('unbound terminal chat distinguishes the connected service without granting worker access',async()=>{
 const h=appWorkerHarness({override:(method,data,standard)=>method==='worker.restore'&&data.conversationId?{status:'disconnected',reason:'project_missing',conversationId:data.conversationId}:standard(method,data)});
 try{await h.flush();const before=h.calls.length;terminal(h).props.onConversationPrepared(conversation('codex','unbound-terminal'));await h.flush();
 assert.equal(agent(h).props.computeConnected,false);assert.match(h.text(h.find(n=>n.props?.['data-testid']==='current-compute-resource-status')),/服务已连接.*未绑定计算项目/);
 assert(!h.calls.slice(before).some(call=>call.method==='worker.request'));
 }finally{h.unmount();}
});

for(const width of [1000,1440])test('empty profile shows sidebar, content and Agent together at width '+width,async()=>{
 const h=appWorkerHarness({width});try{
  await h.flush();assert(!shell(h).props.className.includes('chat-only'));assert(!shell(h).props.className.includes('single-panel'));
  assert.equal(h.find(node=>node.type==='nav'&&node.props.className==='sidebar').props.hidden,false);
  h.find(node=>node.type==='main'&&node.props.className==='main-column');assert.equal(agent(h).props.hidden,false);
  await agent(h).props.onNewConversation();await h.flush();assert.equal(agent(h).props.sessionSelection.pending,undefined);
  h.find(node=>node.type==='button'&&h.text(node)==='本地终端').props.onClick();await h.flush();
  const request=terminal(h).props.request;assert.equal(terminal(h).props.visible,true);assert.equal(agent(h).props.hidden,false);
  h.find(node=>node.props?.['data-testid']==='priority-chat').props.onClick();await h.flush();
  assert.equal(terminal(h).props.visible,true);assert.equal(terminal(h).props.request,request);assert.equal(agent(h).props.hidden,false);
  assert(!h.calls.some(call=>call.method==='agent.rpc'||call.method==='sharedTerminal.open'));
 }finally{h.unmount();}
});

test('StrictMode effect replay restores worker and allows acknowledged fresh chat',async()=>{
 const h=appWorkerHarness();try{
  h.replayStrictEffects();await h.flush();assert.equal(h.calls.filter(call=>call.method==='worker.restore').length,1);
  assert(h.text(h.find(node=>node.props?.className==='statusbar')).includes('WSL 已连接'));
  await agent(h).props.onNewConversation();await h.flush();assert.equal(agent(h).props.sessionSelection.new,true);
  assert.equal(agent(h).props.sessionSelection.pending,undefined);
 }finally{h.unmount();}
});

for(const width of [1440,640])test('prepared terminal conversation focuses Agent and preserves terminal at width '+width,async()=>{
 const h=appWorkerHarness({width});try{
  await h.flush();h.find(node=>node.type==='button'&&h.text(node)==='本地终端').props.onClick();await h.flush();
  const request=terminal(h).props.request,before=h.calls.length,prepared={...conversation('codex','terminal-prepared'),groupId:'terminal-group'};
  assert.equal(terminal(h).props.canShare,true);terminal(h).props.onConversationPrepared(prepared);await h.flush();
  assert.equal(agent(h).props.sessionSelection.conversation.id,prepared.id);assert.equal(agent(h).props.sessionSelection.adoptDraft,true);assert.equal(shell(h).props['data-primary-panel'],'agent');assert.equal(agent(h).props.conversationGroupId,'terminal-group');
  assert.equal(terminal(h).props.request,request);assert.equal(terminal(h).props.visible,width===1440,'narrow handoff focuses Agent while keeping the terminal mounted');assert.equal(agent(h).props.hidden,false);
  assert(!h.calls.slice(before).some(call=>call.method==='conversation.select'||call.method==='agent.rpc'));
 }finally{h.unmount();}
});

test('terminal-created empty thread retains the existing unsent Agent draft without sending',async()=>{
 const storage=memoryStorage(),h=agentHarness({storage});try{
  await h.flush();h.type('Keep my unsent cluster instructions');await h.flush();
  const prepared=conversation('codex','terminal-prepared');
  h.render({sessionSelection:{nonce:'terminal-handoff',conversation:prepared,adoptDraft:true}});await h.flush();
  assert.equal(h.textarea().props.value,'Keep my unsent cluster instructions');
  assert(!h.calls.some(call=>call.method==='agent.rpc'&&call.data.method==='turn/start'));
 }finally{h.unmount();}
});
