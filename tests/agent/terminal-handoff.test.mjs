import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
import {EventEmitter} from 'node:events';
import {createTerminalHandoff} from '../../agent/sessions/terminal-handoff.mjs';
import {createServiceHandoff} from '../../agent/sessions/service-handoff.mjs';
import {createAgentResourceRouting} from '../../agent/sessions/resource-routing.mjs';
import {createAgentWorkflowContext} from '../../agent/sessions/workflow-context.mjs';
import {createAgentRequests} from '../../agent/sessions/requests.mjs';
import {TaskRecords} from '../../backend/main/workspace/task-records.mjs';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';
import {McpProviderScopes} from '../../agent/tools/provider-scope.mjs';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createChatAttachments} from '../../agent/sessions/chat-attachments.mjs';

// Actual handoff, request and workflow ownership controllers; synthetic provider and
// terminal ports. No CLI, SSH, model request, authentication or scientific execution.
function fixture(options={}){
 const saved=new Map(),calls=[],catalog={get:(kind,id)=>saved.get(kind+':'+id),put:(kind,id,value)=>{saved.set(kind+':'+id,structuredClone(value));return value;},list:kind=>[...saved.entries()].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>value)};
 const records=new TaskRecords(catalog,()=>{}),resource={schemaVersion:2,kind:'ssh-connection',selectionId:'selection-a',connectionId:'connection-a',profileId:'profile-a',profileVersion:1};
 let selection=structuredClone(resource),connectionGate=null,startGate=null,ownerGate=null,busy=false;
 const session={sessionId:'terminal-a',connectionId:'connection-a',kind:'ssh',mode:'interactive',owner:'human',ownerEpoch:1,alive:true,expired:false,resource:{kind:'ssh-connection',connectionId:'connection-a',profileId:'profile-a',profileVersion:1}};
 const agents={active:'codex',async connect(provider){calls.push({method:'connect',provider});if(connectionGate)await connectionGate;this.active=provider;},async selectContext(provider,context){calls.push({method:'selectContext',provider,context});},async rpc(provider,method,params){calls.push({method,provider,params});assert(['thread/start','thread/resume'].includes(method),'handoff must never send a model turn');if(method==='thread/start'&&startGate)await startGate;return {thread:{id:method==='thread/resume'?params.threadId:'actual-provider-thread',turns:[]}};}};
 const workflowContext=createAgentWorkflowContext({records,activeTasks:new Map(),selectedProvider:()=>agents.active});
 const resourceRouting={capture(){const value=structuredClone(selection);return {selection:value,assertCurrent(){if(!equal(value,selection))throw Error('compute_resource_selection_changed');}};}};
 const terminal={async list(){return {sessions:session.alive?[structuredClone(session)]:[]};},async resourceState(){if(session.resource.profileVersion!==1)throw Error('terminal_saved_connection_changed');return {resource:structuredClone(session.resource),sessionId:session.sessionId,operator:session.owner,ownerEpoch:session.ownerEpoch,alive:session.alive,processStatus:'running'};},async owner(data){calls.push({method:'owner',data});assert.equal(data.ownerEpoch,session.ownerEpoch);assert.equal(Object.hasOwn(data,'provider'),false);assert.equal(Object.hasOwn(data,'attachmentDraftId'),false);if(data.owner==='agent')assert(workflowContext.current()?.threadId);if(ownerGate)await ownerGate;session.owner=data.owner;session.ownerEpoch++;return structuredClone(session);},async close(data){calls.push({method:'close',data});session.alive=false;return {closed:true};}};
 const assertIdle=()=>{if(busy)throw Error('Stop the current reply');};
 const agentRpc=createAgentRequests({runtime:()=>({agents,catalog,taskRecords:records,workflowContext,resourceRouting,assertIdleAgent:assertIdle,emit(){}})});
 const controller=createTerminalHandoff({terminal,workflowContext,agents,records,resourceRouting,agentRpc,assertIdle,...options});
 return {controller,session,agents,records,workflowContext,calls,selection:value=>{selection=value;},gateConnect:value=>{connectionGate=value;},gateStart:value=>{startGate=value;},gateOwner:value=>{ownerGate=value;},busy:value=>{busy=value;}};
}
const handoff={sessionId:'terminal-a',ownerEpoch:1,owner:'agent',provider:'codex'};
const until=async predicate=>{for(let i=0;i<30&&!predicate();i++)await new Promise(resolve=>setImmediate(resolve));assert(predicate());};

test('first handoff creates/selects one real empty provider thread and returns it without sending a turn',async()=>{
 const f=fixture(),result=await f.controller.owner(handoff);
 assert.equal(result.owner,'agent');assert.equal(result.conversation.threadId,'actual-provider-thread');assert.equal(result.conversation.taskId,null);assert.equal(f.workflowContext.current().threadId,result.conversation.threadId);
 assert.equal(f.calls.filter(call=>call.method==='thread/start').length,1);assert.equal(f.calls.filter(call=>call.method==='owner').length,1);assert.equal(f.records.conversation('codex',result.conversation.threadId).id,'codex:actual-provider-thread');
});
test('successful terminal handoff adopts only the exact provider and blank draft into a verified new thread',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-terminal-attachments-')),catalog=new Catalog(root);
 t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});
 const attachments=createChatAttachments({catalog}),f=fixture({adoptDraft:attachments.adopt});
 const draftId='75722118-f594-49e2-9e4c-ca2ba7357dc9',otherDraft='d98afbaa-57e7-4a3a-87d2-39d6ee71de39';
 const blank={provider:'codex',threadId:null,draftId},otherProvider={...blank,provider:'kimi'},otherBlank={...blank,draftId:otherDraft};
 const file={name:'input.log',size:9,text:'example\n',mimeType:'text/plain'};
 const [selected]=attachments.stage({...blank,files:[file]});
 const [differentProvider]=attachments.stage({...otherProvider,files:[file]});
 const [differentDraft]=attachments.stage({...otherBlank,files:[file]});
 const result=await f.controller.owner({...handoff,attachmentDraftId:draftId});
 assert.equal(result.adoptedDraftId,draftId);
 const thread={provider:'codex',threadId:result.conversation.threadId};
 assert.equal(attachments.preview({...thread,id:selected.id}).text,file.text);
 assert.throws(()=>attachments.preview({...blank,id:selected.id}),/原对话/);
 assert.deepEqual(attachments.refsFor(otherProvider,[differentProvider.id]),[differentProvider]);
 assert.deepEqual(attachments.refsFor(otherBlank,[differentDraft.id]),[differentDraft]);
 assert.throws(()=>attachments.refsFor(thread,[differentDraft.id]),/原对话/);
});
test('a late terminal owner receipt after selection changes leaves the originating draft untouched',async()=>{
 const f=fixture({adoptDraft:()=>assert.fail('A stale handoff may not reassign draft ownership')});
 let release;f.gateOwner(new Promise(resolve=>release=resolve));
 const pending=f.controller.owner({...handoff,attachmentDraftId:'75722118-f594-49e2-9e4c-ca2ba7357dc9'});
 await until(()=>f.calls.some(call=>call.method==='owner'));
 f.workflowContext.begin('codex','superseding-conversation');release();
 await assert.rejects(pending,/terminal_context_changed/);
 assert.equal(f.workflowContext.current().threadId,'superseding-conversation');
});
test('an explicitly chosen fresh provider is respected and its provider field is not sent to the PTY owner API',async()=>{
 const f=fixture(),result=await f.controller.owner({...handoff,provider:'qwen'});assert.equal(result.conversation.provider,'qwen');assert.equal(f.agents.active,'qwen');assert.equal(f.calls.find(call=>call.method==='owner').data.provider,undefined);
});
test('existing selected conversation handoff reconnects its provider context without creating another chat',async()=>{
 const f=fixture();f.records.remember({provider:'codex',threadId:'existing-thread',projectId:null});f.workflowContext.begin('codex','existing-thread');
 const result=await f.controller.owner(handoff);assert.equal(result.conversation,undefined);assert.equal(f.workflowContext.current().threadId,'existing-thread');assert.deepEqual(f.calls.map(call=>call.method),['selectContext','connect','selectContext','thread/resume','owner']);assert.equal(f.calls[0].context.threadId,'existing-thread');assert.equal(Object.hasOwn(f.calls[0].context,'provider'),false);assert.equal(f.calls.filter(call=>call.method==='thread/start').length,0);
});
test('shell handoff and reclaim never call separate service ownership or lifecycle ports',async()=>{
 const f=fixture({service:{peek:()=>({status:'connected'}),owner:()=>assert.fail('Shell must not change service')}}),result=await f.controller.owner(handoff);assert.equal(result.owner,'agent');assert.equal(result.handoffKind,undefined);const reclaimed=await f.controller.owner({sessionId:'terminal-a',ownerEpoch:2,owner:'human'});assert.equal(reclaimed.owner,'human');
});
test('a legacy occupied protocol terminal cannot be promoted to an independent shell',async()=>{const f=fixture();f.session.serviceActive=true;await assert.rejects(f.controller.owner(handoff),/reauthentication_required/);assert.equal(f.calls.length,0);});
test('a different thread cannot receive handoff without exact persisted same-conversation recovery evidence',async()=>{
 for(const changed of ['old-thread','missing-retirement','conversation-body','project','taskId','environmentId','inputRoot']){
  let f;f=fixture({agentRpc:async()=>{
   const old=f.records.conversation('codex','existing-thread'),next={...old,id:'codex:replacement-thread',threadId:'replacement-thread',...(changed==='conversation-body'?{name:'Unrelated conversation'}:{}),...(changed==='project'?{projectId:'another-project'}:{})};f.records.catalog.put('conversation',next.id,next);
   if(changed!=='missing-retirement')f.records.catalog.put('retired-conversation-context','codex:existing-thread',{replacementThreadId:next.threadId,taskId:null});
   f.workflowContext.begin('codex',null);f.workflowContext.begin('codex',next.threadId);
   if(['taskId','environmentId','inputRoot'].includes(changed)){const current=f.workflowContext.current;f.workflowContext.current=()=>({...current(),[changed]:'unrelated-value'});}
   return {thread:{id:next.threadId},studioRecovery:{status:'recovered',oldThreadId:changed==='old-thread'?'unrelated-thread':'existing-thread',conversation:next}};
  }});f.records.remember({provider:'codex',threadId:'existing-thread',projectId:null,name:'Original conversation'});f.workflowContext.begin('codex','existing-thread');await assert.rejects(f.controller.owner(handoff),/terminal_context_changed/);assert.equal(f.calls.filter(call=>call.method==='owner').length,0,changed);assert.equal(f.session.owner,'human',changed);
 }
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
 const records=new TaskRecords(catalog,()=>{}),workflowContext=createAgentWorkflowContext({records,activeTasks:new Map(),selectedProvider:()=>hub.active}),resourceRouting={capture:()=>({selection:{schemaVersion:2,kind:'ssh-connection',connectionId:'connection-a',profileId:'profile-a',profileVersion:1},assertCurrent(){}})};
 const terminal={list:async()=>({sessions:[structuredClone(f.session)]}),resourceState:async()=>({resource:f.session.resource,sessionId:f.session.sessionId,operator:'human',ownerEpoch:1,alive:true,processStatus:'running'}),owner:async value=>({...f.session,...value})};
 const agentRpc=createAgentRequests({runtime:()=>({agents:hub,catalog,taskRecords:records,workflowContext,resourceRouting,assertIdleAgent(){},emit(){}})}),controller=createTerminalHandoff({terminal,workflowContext,agents:hub,records,resourceRouting,agentRpc,assertIdle(){}});
 const result=await controller.owner(handoff),lease=scopes.connection('codex',base),grantOwner=workflowContext.current().threadId;
 assert.equal(result.conversation.threadId,'real-zero-turn-thread');
 await agentRpc({provider:'codex',method:'thread/resume',params:{threadId:grantOwner}});
 await agentRpc({provider:'codex',method:'thread/read',params:{threadId:grantOwner}});
 assert.equal(scopes.connection('codex',base).tokens.mcp,lease.tokens.mcp);assert.equal(workflowContext.current().threadId,grantOwner);assert.equal(codex.starts,1);assert.deepEqual(calls,['thread/start']);
});
test('ready-service handoff keeps the actual AgentHub native zero-turn chat on its original process and endpoint',async t=>{
 const f=fixture(),scopes=new McpProviderScopes(),base={url:'http://127.0.0.1:32124',tokens:{mcp:'synthetic-service-token'},transport:'ssh-terminal'},calls=[],values=new Map(),catalog={get:(kind,id)=>values.get(kind+':'+id),put:(kind,id,value)=>{values.set(kind+':'+id,value);return value;},list:kind=>[...values.entries()].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>value)};
 scopes.bind(base);f.session.ownerEpoch=2;
 class Bridge extends EventEmitter{constructor(){super();this.activeTurns=new Set();this.starts=0;}async start(){if(!this.process){this.starts++;this.process={};}return {};}async request(method){calls.push(method);assert.equal(method,'thread/start');return {thread:{id:'native-service-empty-thread',turns:[]}};}close(){this.process=null;}}
 const codex=new Bridge(),selection={schemaVersion:2,kind:'ssh-connection',connectionId:'connection-a',profileId:'profile-a',profileVersion:1},resource={peek:()=>selection,capture:()=>({selection}),assertCurrent(){}};
 let hub,workflowContext,granted=false;const serviceState={...selection,status:'connected',workflowReady:true,attemptId:'attempt-a',serviceId:'service-a'},service={peek:()=>serviceState,hasCurrentGrant:provider=>granted&&provider==='codex',owner:data=>{if(data.owner==='agent')assert.equal(data.scope.threadId,workflowContext.current().threadId);granted=data.owner==='agent';Object.assign(serviceState,{operator:data.owner});return {...serviceState,handoffKind:'service'};}};
 const worker={connection:base,identity:{kind:'ssh',version:3,connectionId:'connection-a',profileId:'profile-a',profileVersion:1},connectionTarget:{connectionId:'connection-a',serviceId:'service-a'},bindProviderContext:(_provider,context,options)=>scopes.bindContext('codex',context,options),providerConnection:provider=>scopes.connection(provider,base)};
 const resourceRouting=createAgentResourceRouting({worker,terminal:()=>null,resource:()=>resource,sharedTerminal:()=>null,agents:()=>hub,service:()=>service});
 hub=new AgentHub({codex,root:process.cwd(),catalog,vault:{get:()=>null},settings:()=>({codexPath:'not-executed',cwd:process.cwd(),agent:{}}),worker:provider=>resourceRouting.providerConnection(provider),releaseWorker:provider=>scopes.revoke(provider),bindWorkerContext:(provider,context,options)=>resourceRouting.bindWorkerContext(provider,context,options)});t.after(()=>hub.close());
 const records=new TaskRecords(catalog,()=>{});workflowContext=createAgentWorkflowContext({records,activeTasks:new Map(),selectedProvider:()=>hub.active});
 const terminal={list:async()=>({sessions:[structuredClone(f.session)]}),resourceState:async()=>({resource:f.session.resource,sessionId:f.session.sessionId,operator:'human',ownerEpoch:2,alive:true,processStatus:'running'}),owner:()=>assert.fail('Ready service must never transfer protocol PTY ownership')};
 const agentRpc=createAgentRequests({runtime:()=>({agents:hub,catalog,taskRecords:records,workflowContext,resourceRouting,assertIdleAgent(){},emit(){}})}),controller=createServiceHandoff({workflowContext,agents:hub,records,resourceRouting,agentRpc,assertIdle(){},service});
 const result=await controller.owner({connectionId:'connection-a',attemptId:'attempt-a',owner:'agent',provider:'codex'}),bridgeProcess=codex.process,lease=resourceRouting.providerConnection('codex');assert.equal(result.conversation.threadId,'native-service-empty-thread');assert.equal(result.operator,'agent');assert.equal(f.session.owner,'human');assert.equal(codex.starts,1);
 await agentRpc({provider:'codex',method:'thread/resume',params:{threadId:result.conversation.threadId}});await agentRpc({provider:'codex',method:'thread/read',params:{threadId:result.conversation.threadId}});assert.equal(codex.process,bridgeProcess);assert.equal(codex.starts,1);assert.equal(resourceRouting.providerConnection('codex').tokens.mcp,lease.tokens.mcp);assert.deepEqual(calls,['thread/start']);
});
