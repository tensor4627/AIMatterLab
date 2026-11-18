import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {ConversationAgentHub} from '../../agent/providers/conversation-agent-hub.mjs';
import {McpProviderScopes} from '../../agent/tools/provider-scope.mjs';
import {createParallelAgentWorkflowContext} from '../../agent/sessions/workflow-context.mjs';
import {selectConversation} from '../../agent/sessions/conversation-selection.mjs';
import {createAgentWakeDelivery,serviceHistory} from '../../agent/sessions/wake-delivery.mjs';
import {TerminalMcp} from '../../agent/tools/terminal-mcp.mjs';
import {createAgentRequests} from '../../agent/sessions/requests.mjs';

class FakeBridge extends EventEmitter{
 constructor(provider){super();this.provider=provider;this.activeTurns=new Set();this.messages=new Map();this.calls=[];this.approvals=new Map();}
 start(_executable,worker){this.process={};this.worker=worker;this.info={transport:'test'};return this.info;}
 close(){if(this.process){this.process=null;this.activeTurns.clear();this.emit('event',{method:'studio/codexDisconnected',params:{}});}}
 async request(method,params){
  const {threadId}=params;this.calls.push([method,threadId]);
  if(method==='thread/start')return {thread:{id:'new-managed',turns:[]},model:'test'};
  if(method==='account/read')return {account:{type:'chatgpt'}};
  if(method==='thread/resume'||method==='thread/read')return {thread:{id:threadId,turns:this.messages.get(threadId)||[]},model:'test'};
  if(method==='turn/start'){
   assert.equal(this.activeTurns.size,0);
   const turn={id:'turn-'+threadId,status:'inProgress',items:[{type:'userMessage',id:'user-'+threadId,content:params.input}]};
   this.activeTurns.add(threadId);this.messages.set(threadId,[turn]);this.emit('event',{method:'turn/started',params:{threadId,turn}});return {turn};
  }
  if(method==='turn/interrupt'){this.finish(threadId,'interrupted');return {};}
  throw Error('Unexpected request '+method);
 }
 finish(threadId,status='completed'){
  const turn=this.messages.get(threadId)[0];turn.status=status;
  this.activeTurns.delete(threadId);this.emit('event',{method:'turn/completed',params:{threadId,turn}});
 }
 prompt(threadId){this.emit('event',{method:'item/tool/requestUserInput',params:{threadId,questions:[]},id:4});}
 respond(id,result){this.approvals.set(id,result);return true;}
}

function fixture({terminalGateway}={}){
 const values=new Map(),catalog={
  get:(kind,id)=>values.get(kind)?.get(id),list:kind=>[...values.get(kind)?.values()||[]],
  put:(kind,id,value)=>{if(!values.has(kind))values.set(kind,new Map());values.get(kind).set(id,structuredClone(value));}
 };
 const rows=[['codex','alpha'],['codex','beta'],['deepseek','gamma']];
 for(const [provider,threadId]of rows){
  const taskId='task-'+threadId,id=provider+':'+threadId,projectId='project-'+threadId;
  catalog.put('conversation',id,{id,provider,threadId,projectId,taskId});
  catalog.put('agent-task',taskId,{id:taskId,provider,threadId,projectId});
 }
 const records={deleted:()=>false,conversation:(provider,id)=>catalog.get('conversation',provider+':'+id),bound:(provider,id)=>catalog.get('agent-task',records.conversation(provider,id)?.taskId),read:id=>catalog.get('agent-task',id),failedTurn:()=>{},prepareTurnState(_provider,value){const {planningMode,reviewMode,studioTaskId,...params}=value;return {params,interaction:{planningMode,reviewMode,workflow:{private:'unverified workflow metadata'}}};}};
 const context=createParallelAgentWorkflowContext({records,selectedProvider:()=>agents.foregroundProvider});
 const scopes=new McpProviderScopes(),base={url:'http://127.0.0.1:41411',tokens:{mcp:'test-root-bearer'}};scopes.bind(base);
 const agents=new ConversationAgentHub({authCodex:new FakeBridge('codex-auth'),createCodex:()=>new FakeBridge('codex'),root:'.',catalog,vault:{get:()=>null},settings:()=>({codexPath:'test'}),
  apiBridgeFactories:{deepseek:options=>{const bridge=new FakeBridge('deepseek');bridge.start=()=>FakeBridge.prototype.start.call(bridge,null,options.worker());return bridge;}},
  worker:(provider,sessionId)=>terminalGateway?terminalGateway.providerConnection(provider,sessionId):scopes.connection(provider,base,sessionId),
  releaseWorker:(provider,sessionId)=>terminalGateway?terminalGateway.revokeProvider(provider,sessionId):scopes.revoke(provider,sessionId),
  bindWorkerContext:(provider,value,options)=>terminalGateway?terminalGateway.bindProviderContext(provider,value,options):scopes.bindContext(provider,value,options),
  runSession:(identity,run)=>context.runInSession(identity,run),dropSession:id=>context.dropSession(id)
 });
 const events=[];agents.on('event',event=>events.push(event));
 async function activate(provider,threadId){
  await agents.runInConversation(provider,threadId,async()=>{
   const ticket=context.begin(provider,threadId);
   await context.synchronize(ticket,(p,value)=>agents.selectContext(p,value));
   await agents.connect(provider,{threadId});
   await agents.rpc(provider,'thread/resume',{threadId});
  });
  return agents.bridge(provider,threadId);
 }
 const select=(provider,threadId)=>selectConversation({catalog,records,workflowContext:context,agents,assertIdle:()=>{throw Error('Global busy gate');}},{id:provider+':'+threadId});
 const lease=(provider,bridge)=>scopes.authenticate({pathname:'/providers/'+provider+'/mcp',host:'127.0.0.1:41411',authorization:'Bearer '+bridge.worker.tokens.mcp});
 const send=(provider,threadId,text='test turn')=>agents.runInConversation(provider,threadId,()=>agents.rpc(provider,'turn/start',{threadId,input:[{type:'text',text}]}),{claimTurn:true});
 return {agents,catalog,context,records,select,activate,lease,send,events};
}

function productionRequests(f,{acquire=async()=>{},recordUserTurn=()=>{}}={}){
 return createAgentRequests({runtime:()=>({
  agents:f.agents,catalog:f.catalog,taskRecords:f.records,workflowContext:f.context,recordUserTurn,
  privateAccess:{assertTask:()=>assert.fail('No unrelated default worker policy must be consulted')},
  worker:{},sharedTerminal:{},resourceRouting:{capture:()=>({resources:[],assertCurrent(){}}),scopedWorkerConnection:()=>null,turnContext:()=> 'Use list_compute_resources.'},
  conversationTerminals:{acquire,pendingForNewConversation:()=>null},
  scientificSkills:{router:{routes:new Map()},context:{},resolvePolicy:async()=>({state:'legacy_unconfigured'})},
  skillGuidanceScope:()=>({}),emit:(_channel,event)=>f.events.push(event)
 })});
}

test('normal request admission overlaps same- and cross-provider preparation with no default worker and hides unverified workspace data',async t=>{
 const f=fixture();t.after(()=>f.agents.close());
 await f.select('codex','alpha');const a=await f.activate('codex','alpha');
 let release,entered;
 const held=new Promise(resolve=>entered=resolve),userTurns=[];
 const request=productionRequests(f,{acquire:async(_provider,owner)=>{
  if(owner.threadId==='alpha'){entered();await new Promise(resolve=>release=resolve);}
 },recordUserTurn:value=>userTurns.push([value.provider,value.params.threadId])});
 const start=(provider,threadId)=>request({provider,method:'turn/start',params:{threadId,input:[{type:'text',text:'Inspect the authorized managed service'},{type:'text',text:'[Studio workspace context]\nunverified private context'}]}});
 const preparing=start('codex','alpha');await held;
 try{
  await assert.rejects(start('codex','alpha'),/already has a reply/);
  await f.select('codex','beta');await f.activate('codex','beta');await start('codex','beta');
  await f.select('deepseek','gamma');await f.activate('deepseek','gamma');await start('deepseek','gamma');
  assert.deepEqual(f.agents.turnStates().map(({threadId,phase})=>[threadId,phase]),[['alpha','preparing'],['beta','working'],['gamma','working']]);
 }finally{release();}
 await preparing;
 assert.deepEqual(userTurns,[['codex','alpha'],['codex','beta'],['deepseek','gamma']]);
 const wire=JSON.stringify(a.messages.get('alpha'));
 assert.match(wire,/list_compute_resources/);assert.doesNotMatch(wire,/unverified private context|unverified workflow metadata/);
 await request({provider:'codex',method:'turn/interrupt',params:{threadId:'alpha',turnId:'turn-alpha'}});
 assert(f.agents.isBusy('codex','beta'));assert(f.agents.isBusy('deepseek','gamma'));
 const account=await request({provider:'codex',method:'account/read',params:{}});
 assert.equal(account.account.type,'chatgpt');assert.equal(f.agents.bridge('codex','beta').process!==null,true);
});

test('a plain fresh conversation opens and prompts without a selected resource or local worker',async t=>{
 const f=fixture();t.after(()=>f.agents.close());
 const request=productionRequests(f);
 await f.agents.connect('codex');
 const started=await request({provider:'codex',method:'thread/start',params:{}});
 assert.equal(started.thread.id,'new-managed');
 await request({provider:'codex',method:'turn/start',params:{threadId:started.thread.id,input:[{type:'text',text:'Which compute resources are available?'}]}});
 const bridge=f.agents.bridge('codex',started.thread.id);
 assert.match(JSON.stringify(bridge.messages.get(started.thread.id)),/Use list_compute_resources/);
});

test('same-provider and cross-provider turns keep independent processes, scope, questions and interrupt ownership',async t=>{
 const f=fixture();t.after(()=>f.agents.close());
 await f.select('codex','alpha');
 const a=await f.activate('codex','alpha');await f.send('codex','alpha');
 const aScope=f.lease('codex',a);
 await f.select('codex','beta');
 const b=await f.activate('codex','beta');await f.send('codex','beta');
 await f.select('deepseek','gamma');
 const c=await f.activate('deepseek','gamma');await f.send('deepseek','gamma');
 const bScope=f.lease('codex',b);
 assert.notEqual(a,b);assert.notEqual(a.worker.tokens.mcp,b.worker.tokens.mcp);
 assert.equal(aScope.checkCurrent(),true);assert.equal(bScope.checkCurrent(),true);
 assert.equal(f.context.current().threadId,'gamma');
 assert.equal(f.agents.runForScope(aScope,()=>f.context.runForScope(aScope,()=>f.context.assertScope(aScope).id)),'task-alpha');
 assert.equal(f.agents.runForScope(bScope,()=>f.context.runForScope(bScope,()=>f.context.assertScope(bScope).id)),'task-beta');
 assert.throws(()=>f.context.assertScope({...bScope,taskId:'task-alpha'}),/no longer owns/);
 assert.deepEqual(f.agents.turnStates().map(({threadId})=>threadId),['alpha','beta','gamma']);
 a.prompt('alpha');b.prompt('beta');
 const view=await f.agents.rpc('codex','thread/read',{threadId:'alpha',includeTurns:true});
 assert.equal(view.studioSession.requests[0].params.threadId,'alpha');
 f.agents.respond('codex','beta',4,{answer:'only beta'});
 assert.deepEqual(a.approvals.size,0);assert.deepEqual(b.approvals.get(4),{answer:'only beta'});
 await assert.rejects(f.agents.rpc('codex','turn/interrupt',{threadId:'alpha',turnId:'turn-beta'}),/no longer active/);
 await f.agents.rpc('codex','turn/interrupt',{threadId:'alpha',turnId:'turn-alpha'});
 assert.equal(f.agents.isBusy('codex','alpha'),false);assert.equal(f.agents.isBusy('codex','beta'),true);assert.equal(f.agents.isBusy('deepseek','gamma'),true);
 assert.equal(c.calls.some(call=>call[0]==='turn/interrupt'),false);
 assert.equal(f.events.findLast(event=>event.method==='turn/completed').params.threadId,'alpha');
});

test('parallel loopback calls hold exact same-provider leases when the visible chat changes',async t=>{
 let f,finish,entered;
 const started=new Promise(resolve=>entered=resolve);
 const terminal=new TerminalMcp({terminal:{tools:()=>[]},captureScope:scope=>f.agents.captureToolScope(scope),runScope:(scope,run)=>f.agents.runForScope(scope,()=>f.context.runForScope(scope,run)),desktopTools:{
  owns:name=>name==='fixture_scope',tools:()=>[],async call(_name,_args,scope){
   const before=f.context.assertScope(scope).id;
   if(scope.threadId==='alpha'){entered();await new Promise(resolve=>finish=resolve);}
   return {task:f.context.assertScope(scope).id,before};
  }
 }});
 await terminal.start();t.after(()=>terminal.close());
 f=fixture({terminalGateway:terminal});t.after(()=>f.agents.close());
 const call=async bridge=>{
  const result=await fetch(bridge.worker.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+bridge.worker.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'fixture_scope',arguments:{}}})});
  assert.equal(result.status,200);return JSON.parse((await result.json()).result.content[0].text);
 };
 await f.select('codex','alpha');const a=await f.activate('codex','alpha');await f.send('codex','alpha');
 const delayed=call(a);await started;
 try{
  await f.select('codex','beta');const b=await f.activate('codex','beta');await f.send('codex','beta');
  assert.deepEqual(await call(b),{task:'task-beta',before:'task-beta'});
 }finally{finish();}
 assert.deepEqual(await delayed,{task:'task-alpha',before:'task-alpha'});
});

test('one wake is admitted in its own idle conversation and reconciled with native history once',async t=>{
 const f=fixture();t.after(()=>f.agents.close());
 await f.select('codex','beta');
 const a=await f.activate('codex','alpha');await f.send('codex','alpha');
 let dispatched=0;
 const wake=createAgentWakeDelivery({agents:f.agents,catalog:f.catalog,dispatch:async({provider,method,params},authority)=>{
  assert.equal(authority.notification.threadId,'alpha');assert.equal(f.context.current().threadId,'alpha');
  dispatched++;
  return f.agents.rpc(provider,method,params);
 }});
 const delivery={id:'delivery-1',scheduleId:'schedule-1',scope:{provider:'codex',threadId:'alpha',taskId:'task-alpha',projectId:'project-alpha'},text:'Check the scheduled observation.'};
 assert.equal(await wake(delivery),false);
 assert.equal(dispatched,0);
 a.finish('alpha');
 assert.equal(await wake(delivery),true);assert.equal(await wake(delivery),true);
 assert.equal(dispatched,1);assert.equal(f.context.current().threadId,'beta');
 const history=serviceHistory(f.catalog,'codex','alpha',a.messages.get('alpha'));
 assert.deepEqual(history.flatMap(turn=>turn.items).map(({id,text,type})=>[id,text,type]),[['service:delivery-1',delivery.text,'serviceMessage']]);
 assert.equal(f.events.filter(event=>event.method==='studio/serviceNotification').length,1);
 assert.equal(serviceHistory(f.catalog,'codex','beta').length,0);
});
