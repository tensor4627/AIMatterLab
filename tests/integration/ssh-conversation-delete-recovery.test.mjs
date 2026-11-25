import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
import ts from 'typescript';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {TaskRecords} from '../../agent/sessions/task-records.mjs';
import {createParallelAgentWorkflowContext} from '../../agent/sessions/workflow-context.mjs';
import {ConversationAgentHub} from '../../agent/providers/conversation-agent-hub.mjs';
import {createComputeResourceBinding} from '../../backend/main/compute/resource-binding.mjs';
import {createConversationTerminals} from '../../agent/sessions/conversation-terminals.mjs';
import {createSshService} from '../../backend/main/compute/ssh-service.mjs';
import {createSshServiceRegistration} from '../../backend/main/compute/ssh-service-registration.mjs';
import {WorkerClient} from '../../agent/tools/worker-client.mjs';
import {createAgentResourceRouting} from '../../agent/sessions/resource-routing.mjs';
import {createAgentRequests} from '../../agent/sessions/requests.mjs';
import {scientificToolReadiness} from '../../agent/tools/scientific-tool-readiness.mjs';
import {restoreTaskWorker} from '../../backend/main/compute/worker-restore.mjs';

class FakeCodexBridge extends EventEmitter{
 constructor(provider,onStartThread){
  super();
  this.provider=provider;
  this.onStartThread=onStartThread;
  this.calls=[];
 }
 start(_executable,worker){
  this.process={};
  this.worker=worker;
  this.isolationReady=true;
  this.info={transport:'test'};
  return this.info;
 }
 close(){
  if(this.process){
   this.process=null;
   this.emit('event',{method:'studio/codexDisconnected',params:{}});
  }
 }
 async request(method,params={}){
  this.calls.push({method,threadId:params.threadId});
  if(method==='account/read')return {account:{type:'chatgpt'}};
  if(method==='mcpServerStatus/list'){
   return {data:[{name:'gpusampling',tools:{present_task:{name:'present_task'}},resources:[],resourceTemplates:[]}]};
  }
  if(method==='thread/resume'||method==='thread/read'){
   return {thread:{id:params.threadId,turns:[]},model:'test'};
  }
  if(method==='thread/start'){
   return {thread:{id:this.onStartThread(),turns:[]},model:'test'};
  }
  if(method==='turn/start'){
   const turn={id:'turn-'+params.threadId,status:'inProgress',items:[]};
   this.emit('event',{method:'turn/started',params:{threadId:params.threadId,turn}});
   return {turn};
  }
  throw Error('Unexpected request '+method);
 }
}

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-ssh-delete-'));
 const catalog=new Catalog(root);
 const events=[];
 const records=new TaskRecords(catalog,event=>events.push(event));
 const worker=new WorkerClient();
 t.after(()=>{
  worker.close();
  catalog.db.close();
  fs.rmSync(root,{recursive:true,force:true});
 });

 const profile={kind:'ssh',id:'profile-A',version:1,name:'Cluster A',host:'cluster.invalid',username:'user',port:22,mode:'interactive'};
 const profiles={read:({id,version})=>{assert.equal(id,'profile-A');assert.equal(version,1);return structuredClone(profile);},list:()=>[structuredClone(profile)]};
 const selection={schemaVersion:2,selectionId:'sel-A',kind:'ssh-connection',connectionId:'conn-A',profileId:'profile-A',profileVersion:1};
 catalog.put('compute-resource-selection','active',selection);

 records.remember({provider:'codex',threadId:'alpha',name:'Alpha chat'});
 const alphaTask=records.create({workflowVersion:2,planningMode:true,provider:'codex',threadId:'alpha',request:'Run Cu MD'});
 records.remember({provider:'codex',threadId:'beta',name:'Beta chat'});

 const workflowContext=createParallelAgentWorkflowContext({records,selectedProvider:()=>agents.foregroundProvider});
 const health={
  name:'gpu-sampling-studio',root:'/owned/conn-A',runtime:'/owned/conn-A/runtimes/'+'a'.repeat(20),
  runtimeId:'a'.repeat(20),port:25000,execution_policy:'desktop-review-v1',ssh_service:true,
  hostIdentity:{hostname:'owned-conn-A',uid:1000,machineId:'owned-conn-A'}
 };
 const shells=new Map(),grants=new Map(),channels=new Map();
 let shellSeq=0,threadSeq=0,serviceReadyPromise=null;
 const createShell=()=>{
  const s={sessionId:'shell-'+(++shellSeq),connectionId:'conn-A',kind:'ssh',name:'SSH terminal',owner:'human',ownerEpoch:1,alive:true,expired:false,resource:selection};
  shells.set(s.sessionId,s);
  return structuredClone(s);
 };
 const initialShell=createShell();
 const connections={
  state:async({connectionId})=>({schemaVersion:2,status:'authenticated',authentication:'verified',connectionId,profileId:'profile-A',profileVersion:1,terminalSessionIds:[...shells.keys()],capabilities:{multiplex:true}}),
  openShell:async()=>createShell(),
  openService:async data=>{
   const value={connectionId:data.connectionId,profileId:data.profileId,profileVersion:data.profileVersion,attemptId:data.requestId,serviceId:'service-conn-A',status:'connected',serviceActive:true,service:health};
   channels.set(data.connectionId,value);
   return structuredClone(value);
  },
  serviceState:async({connectionId})=>structuredClone(channels.get(connectionId)),
  serviceRequest:async packet=>{
   if(packet.target==='/api/health')return {status:200,data:structuredClone(health)};
   const body=packet.data;
   return {status:200,data:{jsonrpc:'2.0',id:body.id,result:body.method==='tools/list'?{tools:[{name:'present_task',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'ok'}]}}};
  },
  closeService:async({connectionId})=>{
   const value=channels.get(connectionId);
   Object.assign(value,{status:'disconnected',serviceActive:false});
   return structuredClone(value);
  }
 };

 // Simulate shared-terminal.mjs coupling to workflowContext.current() / selectedOwner().
 const ownerScope=value=>value?.threadId?{provider:value.provider,threadId:value.threadId,...value.taskId?{taskId:value.taskId}:{}}:null;
 const safeTerminal=fn=>{
  try{return fn();}catch{throw Error('terminal_unavailable');}
 };
 const sharedTerminal={
  connections,
  list:async()=>safeTerminal(()=>{
   workflowContext.current();
   return {sessions:[...shells.values()].map(s=>{
    const g=grants.get(s.sessionId),cur=ownerScope(workflowContext.current());
    return {...structuredClone(s),agentReady:!!(s.owner==='agent'&&g&&cur&&equal(g.scope,cur))};
   })};
  }),
  resourceState:async({sessionId})=>safeTerminal(()=>{
   workflowContext.selectedOwner();
   const s=shells.get(sessionId);
   const g=grants.get(sessionId),cur=ownerScope(workflowContext.current());
   return {
    sessionId:s.sessionId,connectionId:'conn-A',resource:selection,operator:s.owner,ownerEpoch:s.ownerEpoch,
    processStatus:s.expired?'expired':s.alive?'running':'exited',alive:s.alive,
    agentReady:!!(s.owner==='agent'&&g&&cur&&equal(g.scope,cur)),
    authentication:'verified',managedRuns:false
   };
  }),
  owner:async(data,options={})=>{
   options.assertCurrent?.();
   const s=shells.get(data.sessionId);
   assert.equal(s.ownerEpoch,data.ownerEpoch);
   s.owner=data.owner;s.ownerEpoch++;
   if(data.owner==='agent'){
    const scope=ownerScope(workflowContext.current());
    if(!scope)throw Error('terminal_scope_denied');
    grants.set(s.sessionId,{scope,conversation:options.conversation===true,context:structuredClone(workflowContext.current())});
   }else grants.delete(s.sessionId);
   return structuredClone(s);
  },
  closeConversationShell:async({sessionId,ownerEpoch})=>{
   const s=shells.get(sessionId);
   assert.equal(s.ownerEpoch,ownerEpoch);
   grants.delete(sessionId);
   shells.delete(sessionId);
  },
  discardConversationShell:async({sessionId})=>{grants.delete(sessionId);shells.delete(sessionId);},
  hasCurrentGrant:(provider,sessionId)=>{
   const cur=ownerScope(workflowContext.current());
   if(!cur||cur.provider!==provider)return false;
   for(const [id,g]of grants){
    if(sessionId!==undefined&&sessionId!==id)continue;
    if(equal(g.scope,cur))return true;
   }
   return false;
  },
  reconcileContext:()=>{
   const cur=ownerScope(workflowContext.current());
   for(const [id,g]of grants)if(!cur||!equal(g.scope,cur))grants.delete(id);
  },
  providerConnection:()=>({url:'http://127.0.0.1:41411/terminal',tokens:{mcp:'terminal-token'}}),
  bindProviderContext:()=>({url:'http://127.0.0.1:41411/terminal',tokens:{mcp:'terminal-token'}})
 };

 const registration=createSshServiceRegistration({catalog,profiles});
 const computeResource=createComputeResourceBinding({
  catalog,profiles,terminal:sharedTerminal,connections,
  current:()=>workflowContext.selectedOwner(),
  serviceState:connectionId=>sshService.peek(connectionId?{connectionId}:{})
 });
 const sshService=createSshService({
  worker,connections,profiles,resource:computeResource,registration,
  source:'/inert/source',transportSource:'/inert/transport',
  prepareResources:async(_s,opts)=>({source:'inert',payload:{expected_runtime_id:opts.expectedRuntimeId||'a'.repeat(20)},transport:{source:'inert',sha256:'a'.repeat(64)}}),
  current:()=>workflowContext.current(),
  assertIdle:()=>{}
 });
 const conversationTerminals=createConversationTerminals({
  terminal:sharedTerminal,service:sshService,registration,resource:computeResource,
  current:()=>workflowContext.current(),
  idleMinutes:()=>60
 });
 // Track the deferred service grant promise so tests can wait cleanly.
 const origArm=conversationTerminals.arm;
 const armAndAwaitService=async(shell,provider)=>{
  const handed=await origArm(shell,provider);
  const start=Date.now();
  while(Date.now()-start<2000){
   if(sshService.hasCurrentGrant(provider))break;
   await new Promise(r=>setTimeout(r,5));
  }
  serviceReadyPromise=handed;
  return handed;
 };
 const agents=new ConversationAgentHub({
  authCodex:new FakeCodexBridge('codex-auth',()=>'auth-'+ ++threadSeq),
  createCodex:()=>new FakeCodexBridge('codex',()=>'fresh-'+ ++threadSeq),
  root,catalog,vault:{get:()=>null},settings:()=>({codexPath:'fixture-codex'}),
  worker:(provider,sessionId)=>resourceRouting.sessionConnection(provider,sessionId,workflowContext),
  releaseWorker:(provider)=>{worker.revokeProvider(provider);},
  bindWorkerContext:(provider,value,options)=>resourceRouting.bindWorkerContext(provider,value,options),
  runSession:(identity,run)=>workflowContext.runInSession(identity,run),
  dropSession:id=>workflowContext.dropSession(id)
 });
 const resourceRouting=createAgentResourceRouting({
  worker,terminal:()=>sharedTerminal,resource:()=>computeResource,sharedTerminal:()=>sharedTerminal,
  service:()=>sshService,managed:()=>null,agents:()=>agents
 });
 const requests=createAgentRequests({runtime:()=>({
  agents,catalog,taskRecords:records,workflowContext,worker,sharedTerminal,resourceRouting,conversationTerminals,
  privateAccess:{assertTask:async()=>({definitionOnly:false})},
  scientificSkills:{router:{routes:new Map()},context:{},resolvePolicy:async()=>({state:'legacy_unconfigured'})},
  skillGuidanceScope:()=>({}),assertIdleAgent:()=>{},emit:(_c,e)=>events.push(e),openUrl:()=>{},root,app:{isPackaged:false},
  bundledSkillRoot:root,studioSkillRoots:()=>[],managedSkillRoots:()=>[],managedSkillEntries:()=>[],managedSkillRecords:()=>[]
 })});
 t.after(()=>agents.close());

 const deleteConversation=id=>{
  const result=records.remove(id);
  const clearedForeground=workflowContext.forget(result.provider,result.threadId);
  conversationTerminals.forget(result.provider,result.threadId);
  agents.forget(result.provider,result.threadId);
  if(clearedForeground){
   sharedTerminal.reconcileContext();
   sshService.reconcileContext();
  }
  return {result,clearedForeground};
 };

 return {
  root,catalog,records,alphaTask,workflowContext,worker,sharedTerminal,computeResource,
  sshService,conversationTerminals,agents,resourceRouting,requests,events,
  initialShell,armAndAwaitService,deleteConversation,shells,grants
 };
}

test('deleting the active SSH conversation clears foreground workflow state without errors and allows starting a new conversation',async t=>{
 const f=fixture(t);

 // 1. Connect SSH service and bind active foreground conversation codex:alpha.
 await f.sshService.connect({connectionId:'conn-A',profileId:'profile-A',profileVersion:1,requestId:'attempt-1',mode:'setup'});
 const ticketA=f.workflowContext.begin('codex','alpha');
 await f.workflowContext.synchronize(ticketA,(p,scope)=>f.agents.selectContext(p,scope));
 f.agents.selectForeground('codex','alpha');
 await f.armAndAwaitService({sessionId:f.initialShell.sessionId,ownerEpoch:f.initialShell.ownerEpoch},'codex');
 await f.agents.connect('codex');

 const before=await f.computeResource.status({});
 assert.equal(before.status,'selected');
 assert.equal(before.authentication,'verified');
 assert.equal(before.agentReady,true);
 assert(f.sharedTerminal.hasCurrentGrant('codex'));
 assert(f.sshService.hasCurrentGrant('codex'));

 // 2. Delete the active conversation codex:alpha.
 const {result,clearedForeground}=f.deleteConversation('codex:alpha');
 assert.equal(clearedForeground,true);
 assert.deepEqual(result.taskIds,[f.alphaTask.id]);
 assert.equal(f.workflowContext.current(),null);
 assert.deepEqual(f.workflowContext.selectedOwner().context,null);

 // 3. Resource status, terminal listing, sweep, worker restore, and readiness must work without "Conversation was deleted" / "terminal_unavailable".
 const statusAfterDelete=await f.computeResource.status({});
 assert.equal(statusAfterDelete.status,'selected');
 assert.equal(statusAfterDelete.authentication,'verified');
 assert.equal(statusAfterDelete.workflowReady,true);
 assert.equal(statusAfterDelete.agentReady,false);
 assert.equal(f.conversationTerminals.canAcquire('codex'),true);
 assert.equal(f.sshService.hasCurrentGrant('codex'),false);
 assert.equal(f.sharedTerminal.hasCurrentGrant('codex'),false);

 const listed=await f.sharedTerminal.list({});
 assert(Array.isArray(listed.sessions));
 await f.conversationTerminals.sweep();
 const captured=f.resourceRouting.capture('codex',undefined);
 assert.equal(captured.selection.connectionId,'conn-A');

 const restored=await restoreTaskWorker({
  records:f.records,catalog:f.catalog,worker:f.worker,settings:()=>({}),
  selection:()=>f.workflowContext.current(),selectionEpoch:()=>f.workflowContext.revision(),
  selectedResource:()=>f.computeResource.peek()
 },{scope:'global'});
 assert.notEqual(restored.reason,'selection_changed');

 // 4. Renderer resets to fresh chat and calls agent.connect without error.
 await f.agents.connect('codex');
 const readiness=await scientificToolReadiness({
  worker:f.worker,codex:f.agents.bridge('codex'),workflowContext:f.workflowContext,
  records:f.records,privateAccess:{assertTask:async()=>({definitionOnly:false})},
  selectedProvider:()=>f.agents.active
 },'codex');
 assert.equal(readiness.status,'ready');

 // 5. User can immediately start and send a brand-new conversation on the preserved SSH connection.
 const started=await f.requests({provider:'codex',method:'thread/start',params:{}});
 const newThreadId=started.thread.id;
 assert.equal(f.workflowContext.current().threadId,newThreadId);
 assert.equal(f.conversationTerminals.canAcquire('codex'),false,'new chat acquired its own terminal');
 assert(f.sharedTerminal.hasCurrentGrant('codex'),'new chat holds terminal grant');
 f.records.remember({provider:'codex',threadId:newThreadId,name:'New chat'});
 const turnResult=await f.requests({provider:'codex',method:'turn/start',params:{threadId:newThreadId,input:[{type:'text',text:'hello'}],studioTurnRequestId:'req_after_delete_1'}});
 assert.equal(turnResult.turn.id,'turn-'+newThreadId);

 // 6. Deleting an unrelated background conversation preserves the new foreground conversation.
 const bg=f.deleteConversation('codex:beta');
 assert.equal(bg.clearedForeground,false);
 assert.equal(f.workflowContext.current().threadId,newThreadId);
 assert(f.sharedTerminal.hasCurrentGrant('codex'));

 // 7. Direct access to the deleted thread still fails closed.
 assert.throws(()=>f.workflowContext.currentFor('codex','alpha'),/Conversation was deleted/);
 assert.throws(()=>f.workflowContext.begin('codex','alpha'),/Conversation was deleted/);
 assert.throws(()=>f.records.prepareTurn('codex',{threadId:'alpha',input:[]}),/Conversation was deleted/);
 await assert.rejects(f.requests({provider:'codex',method:'turn/start',params:{threadId:'alpha',input:[{type:'text',text:'hi'}]}}),/Conversation was deleted/);
});

test('desktop/main conversation.delete forgets workflowContext and reconciles SSH terminal/service state when foreground cleared',()=>{
 const source=fs.readFileSync(new URL('../../desktop/main.mjs',import.meta.url),'utf8');
 const ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true);
 let deleteHandler='';
 function visit(node){
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='handle'&&node.arguments[0]?.text==='conversation.delete'){
   deleteHandler=node.arguments[1].getText(ast);
  }
  ts.forEachChild(node,visit);
 }
 visit(ast);
 assert(deleteHandler,'conversation.delete handler must exist in desktop/main.mjs');
 assert.match(deleteHandler,/const\s+result\s*=\s*taskRecords\.remove\(id\)/);
 assert.match(deleteHandler,/workflowContext\.forget\(result\.provider,\s*result\.threadId\)/);
 assert.match(deleteHandler,/sharedTerminal\?\.reconcileContext\?\.\(\)/);
 assert.match(deleteHandler,/sshService\?\.reconcileContext\?\.\(\)/);
 assert.match(deleteHandler,/studio\/conversationTerminalChanged/);
 assert.match(deleteHandler,/studio\/computeResourceChanged/);
});
