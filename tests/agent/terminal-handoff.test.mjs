import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual as equal} from 'node:util';
import {EventEmitter} from 'node:events';
import {createTerminalHandoff} from '../../agent/sessions/terminal-handoff.mjs';
import {createAgentWorkflowContext} from '../../agent/sessions/workflow-context.mjs';
import {createAgentRequests} from '../../agent/sessions/requests.mjs';
import {TaskRecords} from '../../backend/main/workspace/task-records.mjs';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';
import {McpProviderScopes} from '../../agent/tools/provider-scope.mjs';

// Actual handoff, request and workflow ownership controllers; synthetic provider and
// terminal ports. No CLI, SSH, model request, authentication or scientific execution.
function fixture(){
 const saved=new Map(),calls=[],catalog={get:(kind,id)=>saved.get(kind+':'+id),put:(kind,id,value)=>{saved.set(kind+':'+id,structuredClone(value));return value;},list:kind=>[...saved.entries()].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>value)};
 const records=new TaskRecords(catalog,()=>{}),resource={kind:'ssh-terminal',selectionId:'selection-a',sessionId:'terminal-a',profileId:'profile-a',profileVersion:1};
 let selection=structuredClone(resource),connectionGate=null,startGate=null,busy=false;
 const session={sessionId:'terminal-a',kind:'ssh',mode:'interactive',owner:'human',ownerEpoch:1,alive:true,expired:false,resource:{kind:'ssh-terminal',profileId:'profile-a',profileVersion:1}};
 const agents={active:'codex',async connect(provider){calls.push({method:'connect',provider});if(connectionGate)await connectionGate;this.active=provider;},async selectContext(provider,context){calls.push({method:'selectContext',provider,context});},async rpc(provider,method,params){calls.push({method,provider,params});assert.equal(method,'thread/start','handoff must never send a model turn');if(startGate)await startGate;return {thread:{id:'actual-provider-thread',turns:[]}};}};
 const workflowContext=createAgentWorkflowContext({records,activeTasks:new Map(),selectedProvider:()=>agents.active});
 const resourceRouting={capture(){const value=structuredClone(selection);return {selection:value,assertCurrent(){if(!equal(value,selection))throw Error('compute_resource_selection_changed');}};}};
 const terminal={async list(){return {sessions:session.alive?[structuredClone(session)]:[]};},async resourceState(){if(session.resource.profileVersion!==1)throw Error('terminal_saved_connection_changed');return {resource:structuredClone(session.resource),sessionId:session.sessionId,operator:session.owner,ownerEpoch:session.ownerEpoch,alive:session.alive,processStatus:'running'};},async owner(data){calls.push({method:'owner',data});assert.equal(data.ownerEpoch,session.ownerEpoch);assert.equal(Object.hasOwn(data,'provider'),false);if(data.owner==='agent')assert(workflowContext.current()?.threadId);session.owner=data.owner;session.ownerEpoch++;return structuredClone(session);},async close(data){calls.push({method:'close',data});session.alive=false;return {closed:true};}};
 const assertIdle=()=>{if(busy)throw Error('Stop the current reply');};
 const agentRpc=createAgentRequests({runtime:()=>({agents,catalog,taskRecords:records,workflowContext,resourceRouting,assertIdleAgent:assertIdle,emit(){}})});
 const controller=createTerminalHandoff({terminal,workflowContext,agents,records,resourceRouting,agentRpc,assertIdle});
 return {controller,session,agents,records,workflowContext,calls,selection:value=>{selection=value;},gateConnect:value=>{connectionGate=value;},gateStart:value=>{startGate=value;},busy:value=>{busy=value;}};
}
const handoff={sessionId:'terminal-a',ownerEpoch:1,owner:'agent',provider:'codex'};
const until=async predicate=>{for(let i=0;i<30&&!predicate();i++)await new Promise(resolve=>setImmediate(resolve));assert(predicate());};

test('first handoff creates/selects one real empty provider thread and returns it without sending a turn',async()=>{
 const f=fixture(),result=await f.controller.owner(handoff);
 assert.equal(result.owner,'agent');assert.equal(result.conversation.threadId,'actual-provider-thread');assert.equal(result.conversation.taskId,null);assert.equal(f.workflowContext.current().threadId,result.conversation.threadId);
 assert.equal(f.calls.filter(call=>call.method==='thread/start').length,1);assert.equal(f.calls.filter(call=>call.method==='owner').length,1);assert.equal(f.records.conversation('codex',result.conversation.threadId).id,'codex:actual-provider-thread');
});
test('an explicitly chosen fresh provider is respected and its provider field is not sent to the PTY owner API',async()=>{
 const f=fixture(),result=await f.controller.owner({...handoff,provider:'qwen'});assert.equal(result.conversation.provider,'qwen');assert.equal(f.agents.active,'qwen');assert.equal(f.calls.find(call=>call.method==='owner').data.provider,undefined);
});
test('existing selected conversation handoff preserves its task and does not connect or create another chat',async()=>{
 const f=fixture();f.records.remember({provider:'codex',threadId:'existing-thread',projectId:null});f.workflowContext.begin('codex','existing-thread');
 const result=await f.controller.owner(handoff);assert.equal(result.conversation,undefined);assert.equal(f.workflowContext.current().threadId,'existing-thread');assert.deepEqual(f.calls.map(call=>call.method),['owner']);
});
test('missing or stale terminal, profile and resource fail before any provider connection',async()=>{
 for(const change of [f=>{f.session.alive=false;},f=>{f.session.ownerEpoch=2;},f=>{f.session.resource.profileVersion=2;},f=>f.selection({kind:'ssh-terminal',selectionId:'other',sessionId:'other',profileId:'profile-a',profileVersion:1})]){
  const f=fixture();change(f);await assert.rejects(f.controller.owner(handoff));assert.equal(f.calls.length,0);
 }
});
test('failed provider connection leaves the terminal human-owned and creates no chat or grant',async()=>{
 const f=fixture();f.agents.connect=async()=>{throw Error('Connect provider first');};await assert.rejects(f.controller.owner(handoff),/Connect provider/);assert.equal(f.session.owner,'human');assert.equal(f.calls.length,0);
});
test('human takeover during slow provider connection invalidates pending handoff immediately',async()=>{
 const f=fixture();let release;f.gateConnect(new Promise(resolve=>release=resolve));const pending=f.controller.owner(handoff);await until(()=>f.calls.some(call=>call.method==='connect'));
 await f.controller.owner({sessionId:'terminal-a',ownerEpoch:1,owner:'human'});release();await assert.rejects(pending,/terminal_context_changed/);
 assert.equal(f.session.owner,'human');assert.equal(f.calls.filter(call=>call.method==='thread/start').length,0);assert.equal(f.calls.filter(call=>call.method==='owner'&&call.data.owner==='agent').length,0);
});
test('closing a terminal while empty-thread preparation is pending never grants the late result',async()=>{
 const f=fixture();let release;f.gateStart(new Promise(resolve=>release=resolve));const pending=f.controller.owner(handoff);await until(()=>f.calls.some(call=>call.method==='thread/start'));
 await f.controller.close({sessionId:'terminal-a'});release();await assert.rejects(pending,/terminal_context_changed/);assert.equal(f.calls.filter(call=>call.method==='owner').length,0);
});
test('resource or conversation switch during preparation prevents thread creation or handoff',async()=>{
 for(const change of [f=>f.selection(null),f=>f.workflowContext.begin('codex',null)]){
  const f=fixture();let release;f.gateConnect(new Promise(resolve=>release=resolve));const pending=f.controller.owner(handoff);await until(()=>f.calls.some(call=>call.method==='connect'));change(f);release();await assert.rejects(pending);assert.equal(f.calls.filter(call=>call.method==='thread/start').length,0);assert.equal(f.session.owner,'human');
 }
});
test('a late thread/start cannot bind handoff to a superseding conversation',async()=>{
 const f=fixture();let release;f.gateStart(new Promise(resolve=>release=resolve));const pending=f.controller.owner(handoff);await until(()=>f.calls.some(call=>call.method==='thread/start'));f.workflowContext.begin('codex','other-thread');release();await assert.rejects(pending,/Selected conversation changed/);assert.equal(f.session.owner,'human');
});
test('human takeover remains available during a model reply; preparing a new chat does not',async()=>{
 const f=fixture();f.busy(true);await assert.rejects(f.controller.owner(handoff),/Stop the current reply/);assert.equal(f.calls.length,0);await f.controller.owner({sessionId:'terminal-a',ownerEpoch:1,owner:'human'});assert.equal(f.session.owner,'human');
});
test('untyped provider, spoofed scope and malformed identities never reach terminal or provider ports',async()=>{
 for(const value of [{...handoff,provider:'foreign'},{...handoff,scope:{threadId:'forged'}},{...handoff,ownerEpoch:-1},{...handoff,sessionId:'../private'},null]){const f=fixture();await assert.rejects(f.controller.owner(value));assert.equal(f.calls.length,0);}
});
test('actual AgentHub starts one empty thread and same-thread UI resume retains the handoff lease',async t=>{
 const f=fixture(),scopes=new McpProviderScopes(),base={url:'http://127.0.0.1:32123',tokens:{mcp:'synthetic-base-token'},transport:'desktop-terminal'},calls=[],values=new Map(),catalog={get:(kind,id)=>values.get(kind+':'+id),put:(kind,id,value)=>{values.set(kind+':'+id,value);return value;},list:kind=>[...values.entries()].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>value)};
 scopes.bind(base);
 class Bridge extends EventEmitter{
  constructor(){super();this.activeTurns=new Set();this.starts=0;}
  async start(){this.starts++;this.process={};return {};}
  async request(method){calls.push(method);assert.equal(method,'thread/start');return {thread:{id:'real-zero-turn-thread',turns:[]}};}
  close(){this.process=null;}
 }
 const codex=new Bridge(),hub=new AgentHub({codex,root:process.cwd(),catalog,vault:{get:()=>null},settings:()=>({codexPath:'not-executed',cwd:process.cwd(),agent:{}}),worker:provider=>scopes.connection(provider,base),releaseWorker:provider=>scopes.revoke(provider),bindWorkerContext:(provider,context,options)=>{scopes.bind(base);return scopes.bindContext(provider,context,options);}});t.after(()=>hub.close());
 const records=new TaskRecords(catalog,()=>{}),workflowContext=createAgentWorkflowContext({records,activeTasks:new Map(),selectedProvider:()=>hub.active}),resourceRouting={capture:()=>({selection:{kind:'ssh-terminal',sessionId:f.session.sessionId,profileId:'profile-a',profileVersion:1},assertCurrent(){}})};
 const terminal={list:async()=>({sessions:[structuredClone(f.session)]}),resourceState:async()=>({resource:f.session.resource,sessionId:f.session.sessionId,operator:'human',ownerEpoch:1,alive:true,processStatus:'running'}),owner:async value=>({...f.session,...value})};
 const agentRpc=createAgentRequests({runtime:()=>({agents:hub,catalog,taskRecords:records,workflowContext,resourceRouting,assertIdleAgent(){},emit(){}})}),controller=createTerminalHandoff({terminal,workflowContext,agents:hub,records,resourceRouting,agentRpc,assertIdle(){}});
 const result=await controller.owner(handoff),lease=scopes.connection('codex',base),grantOwner=workflowContext.current().threadId;
 assert.equal(result.conversation.threadId,'real-zero-turn-thread');
 await agentRpc({provider:'codex',method:'thread/resume',params:{threadId:grantOwner}});
 await agentRpc({provider:'codex',method:'thread/read',params:{threadId:grantOwner}});
 assert.equal(scopes.connection('codex',base).tokens.mcp,lease.tokens.mcp);assert.equal(workflowContext.current().threadId,grantOwner);assert.equal(codex.starts,1);assert.deepEqual(calls,['thread/start']);
});
