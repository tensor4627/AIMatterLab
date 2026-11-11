import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {appWorkerHarness} from "../helpers/app-worker-hooks.mjs";
import {agentHarness,memoryStorage} from "../helpers/agent-hooks.mjs";
const ssh={id:'fixture-saved-ssh',version:3,kind:'ssh',name:'Fixture saved SSH',mode:'interactive'};
const shell=h=>h.find(n=>n.props?.className?.startsWith?.('shell workspace-shell'));
const agent=h=>h.find(n=>n.type==='./Agent');
for(const width of [1440,640])test('saved SSH reveals main terminal from fresh ordinary Agent-primary chat at width '+width,async()=>{
 const storage=memoryStorage(),h=appWorkerHarness({storage,width});await h.flush();await agent(h).props.onNewConversation();await h.flush();const selected=agent(h).props.sessionSelection;assert.equal(selected.new,true);assert.equal(agent(h).props.planningMode,false);assert.equal(shell(h).props['data-primary-panel'],'agent');assert(!shell(h).props.className.includes('chat-only'));assert.equal(agent(h).props.hidden,false);if(width===640)assert(shell(h).props.className.includes('single-panel'));
 const a=agentHarness({storage,props:agent(h).props});await a.flush();a.type('Keep this unsent terminal-navigation draft');const before=storage.getItem('studio.conversation');const callStart=h.calls.length;
 agent(h).props.onConnectCompute();await h.flush();h.find(n=>n.type==='./ComputeConnectionChooser').props.onSsh(ssh);await h.flush();
 assert.equal(shell(h).props['data-primary-panel'],'workspace','terminal parent must be the visible primary panel');h.find(n=>n.type==='main'&&n.props.className==='main-column');const bottom=h.find(n=>n.props?.['data-testid']==='bottom-panel');assert(!bottom.props.className.includes('is-collapsed'));assert(bottom.props.style.height>=300);const terminal=h.find(n=>n.type==='./SharedTerminalPanel');assert.equal(terminal.props.visible,true);assert.deepEqual({...terminal.props.request,nonce:undefined},{nonce:undefined,kind:'ssh',mode:'interactive',profileId:ssh.id,version:ssh.version});assert(terminal.props.request.nonce);assert.equal(agent(h).props.sessionSelection,selected);assert.equal(storage.getItem('studio.conversation'),before);a.render(agent(h).props);await a.flush();assert.equal(a.textarea().props.value,'Keep this unsent terminal-navigation draft');assert(!h.calls.slice(callStart).some(c=>['conversation.select','worker.connect','sharedTerminal.open','agent.connect','task.edit'].includes(c.method)));assert(!h.calls.some(c=>c.method==='agent.rpc'&&c.data.method==='turn/start'));a.unmount();h.unmount();
});
