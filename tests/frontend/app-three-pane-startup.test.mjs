import test from 'node:test';
import assert from 'node:assert/strict';
import {appWorkerHarness} from '../helpers/app-worker-hooks.mjs';
import {agentHarness,memoryStorage,conversation} from '../helpers/agent-hooks.mjs';

const shell=h=>h.find(node=>node.props?.className?.startsWith?.('shell workspace-shell'));
const agent=h=>h.find(node=>node.type==='./Agent');
const terminal=h=>h.find(node=>node.type==='./SharedTerminalPanel');

test('unbound terminal chat distinguishes the connected service without granting worker access',async()=>{
 const h=appWorkerHarness({override:(method,data,standard)=>method==='worker.restore'&&data.conversationId?{status:'disconnected',reason:'project_missing',conversationId:data.conversationId}:standard(method,data)});
 try{await h.flush();assert.throws(()=>terminal(h));h.find(node=>node.type==='button'&&h.text(node)==='本地终端').props.onClick();await h.flush();const before=h.calls.length;terminal(h).props.onConversationPrepared(conversation('codex','unbound-terminal'));await h.flush();
 assert.equal(agent(h).props.computeConnected,false);assert.match(h.text(h.find(n=>n.props?.['data-testid']==='current-compute-resource-status')),/服务已连接.*未绑定计算项目/);
 assert(!h.calls.slice(before).some(call=>call.method==='worker.request'));
 }finally{h.unmount();}
});

for(const width of [1000,1440])test('empty profile shows sidebar, content and Agent together at width '+width,async()=>{
 const h=appWorkerHarness({width});try{
  await h.flush();assert(!shell(h).props.className.includes('chat-only'));assert(!shell(h).props.className.includes('single-panel'));
  assert.equal(h.find(node=>node.type==='nav'&&node.props.className==='sidebar').props.hidden,width<1180);
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
  const draftId='75722118-f594-49e2-9e4c-ca2ba7357dc9';
  agent(h).props.terminalDraft.current=provider=>provider==='codex'?draftId:undefined;
  assert.equal(terminal(h).props.canShare,true);
  assert.equal(terminal(h).props.draftForHandoff('codex'),draftId);
  terminal(h).props.onConversationPrepared(prepared,draftId);await h.flush();
  assert.equal(agent(h).props.sessionSelection.conversation.id,prepared.id);assert.equal(agent(h).props.sessionSelection.adoptedDraftId,draftId);assert.equal(shell(h).props['data-primary-panel'],'agent');assert.equal(agent(h).props.conversationGroupId,'terminal-group');
  assert.equal(terminal(h).props.request,request);assert.equal(terminal(h).props.visible,width===1440,'narrow handoff focuses Agent while keeping the terminal mounted');assert.equal(agent(h).props.hidden,false);
  assert(!h.calls.slice(before).some(call=>call.method==='conversation.select'||call.method==='agent.rpc'));
 }finally{h.unmount();}
});

for(const matches of [true,false])test('terminal-created chat transfers only the explicitly adopted blank draft, same draft='+matches,async()=>{
 const storage=memoryStorage(),terminalDraft={current:null},h=agentHarness({storage,props:{terminalDraft}});try{
  await h.flush();h.type('Keep my unsent cluster instructions');await h.flush();
  const draftId=terminalDraft.current('codex');assert.equal(draftId,storage.getItem('studio.composer.v1.new.codex'));
  assert.equal(terminalDraft.current('kimi'),undefined);
  const prepared=conversation('codex','terminal-prepared');
  h.render({sessionSelection:{nonce:'terminal-handoff',conversation:prepared,adoptedDraftId:matches?draftId:'different-blank-draft'}});await h.flush();
  assert.equal(h.textarea().props.value,matches?'Keep my unsent cluster instructions':'');
  if(!matches){const retained=storage.getItem('studio.composer.v1.'+JSON.stringify(['codex','new',draftId]));assert.equal(JSON.parse(retained).text,'Keep my unsent cluster instructions');}
  assert(!h.calls.some(call=>call.method==='agent.rpc'&&call.data.method==='turn/start'));
 }finally{h.unmount();}
});
