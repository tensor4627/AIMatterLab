import {AsyncLocalStorage} from 'node:async_hooks';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {AgentHub} from './agent-hub.mjs';
import {providerId} from './contracts.mjs';
import {DSH_RESOURCE_QUESTION_PREFIX} from './dsh-policy.mjs';
import {providerContext} from '../tools/provider-scope.mjs';
import {serviceHistory} from '../sessions/wake-delivery.mjs';

const inertCodex=Object.freeze({close(){}});
const key=(provider,threadId)=>provider+':'+threadId;
const terminalTurn=turn=>['completed','failed','interrupted','cancelled','canceled'].includes(turn?.status);
const exactThreadId=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\x00-\x1f]/.test(value);
const liveItemTypes=new Set(['userMessage','agentMessage','mcpToolCall','commandExecution','fileChange']);

function rememberLiveTurn(entry,event,params){
 const {turn,turnId,item,itemId,delta}=params,active=entry.liveTurn;
 if(event==='turn/started'&&exactThreadId(turn?.id))entry.liveTurn={...turn,items:[...(turn.items||[])]};
 else if(active&&event==='turn/completed'&&turn?.id===active.id)entry.liveTurn=mergeLiveTurn(active,turn);
 else if(active&&turnId===active.id){
  if(['item/started','item/completed'].includes(event)&&liveItemTypes.has(item?.type)&&exactThreadId(item.id)){
   const index=active.items.findIndex(value=>value.id===item.id);
   if(index===-1)active.items.push(item);else active.items[index]={...active.items[index],...item};
  }else if(event==='item/agentMessage/delta'&&exactThreadId(itemId)&&typeof delta==='string'){
   const index=active.items.findIndex(value=>value.id===itemId),prior=active.items[index];
   if(prior?.type==='agentMessage')active.items[index]={...prior,text:((prior.text||'')+delta).slice(0,2*1024*1024)};
   else if(!prior)active.items.push({id:itemId,type:'agentMessage',text:delta});
  }
 }
}
function mergeLiveTurn(live,history){
 const items=new Map((history.items||[]).map(item=>[item.id,item]));
 for(const item of live.items){
  const current=items.get(item.id);
  if(!current||current.type==='agentMessage'&&typeof current.text==='string'&&typeof item.text==='string'&&item.text.startsWith(current.text))items.set(item.id,item);
 }
 return {...live,...history,items:[...items.values()]};
}

/** Each conversation owns a native transport with a fixed, revocable MCP lease. */
export class ConversationAgentHub extends EventEmitter{
 constructor({authCodex,createCodex,runSession=(_identity,run)=>run(),dropSession=()=>{},initialProvider='codex',createHub=options=>new AgentHub(options),...options}){
  super();Object.assign(this,{options,createCodex,createHub,runSession,dropSession});
  this.scope=new AsyncLocalStorage();this.entries=new Map();this.byThread=new Map();
  this.resourceQuestions=new WeakMap();
  this.auth=createHub({...options,codex:authCodex,worker:()=>null,releaseWorker:()=>{}});
  this.auth.on('event',event=>this.emit('event',event));
  this.foreground=this.create(providerId(initialProvider),null);
 }
 updateInstructions(instructions){
  this.options.instructions=instructions;
  this.auth.updateInstructions(instructions);
  for(const entry of this.entries.values())entry.hub.updateInstructions(instructions);
 }
 get active(){return (this.scope.getStore()||this.foreground).provider;}
 get foregroundProvider(){return this.foreground.provider;}
 get root(){return this.auth.root;}
 get vault(){return this.auth.vault;}
 get modelProfiles(){return this.auth.modelProfiles;}
 get credentialRevisions(){return this.auth.credentialRevisions;}
 get loginStatus(){return this.auth.loginStatus;}
 get bridgeWorkers(){return (this.scope.getStore()||this.foreground).hub.bridgeWorkers;}

 create(provider,threadId){
  const id=randomUUID(),entry={id,provider,threadId,requests:new Map(),turnId:null,settledTurnId:null,preparing:false,closed:false};
  const opts=this.options,context=()=>entry.hub.contexts.get(provider)||providerContext();
  const hub=this.createHub({...opts,codex:provider==='codex'?this.createCodex():inertCodex,sessionProfileId:id,
   worker:p=>p===provider?opts.worker?.(p,id,context()):null,releaseWorker:p=>{if(p===provider)opts.releaseWorker?.(p,id);},
   bindWorkerContext:(p,value,binding)=>opts.bindWorkerContext?.(p,value,{...binding,sessionId:id}),
   confirmResourceChoice:({threadId,turnId},choice)=>{
    const scope=this.questionScope(entry,threadId,turnId);
    if(!scope.checkCurrent())throw Error('The resource choice no longer belongs to the active conversation');
    return opts.confirmResourceChoice?.(scope,choice);
   },
   resourceScope:(p,method)=>opts.resourceScope?.(p,method,context(),id)});
  hub.active=provider;
  hub.on('event',event=>this.receive(entry,event));
  if(provider==='codex'){
   hub.codex.on?.('event',event=>{
    if(event.method==='studio/codexDisconnected'&&hub.isContextTransition(provider))return;
    this.receive(entry,event);
   });
   hub.codex.on?.('diagnostic',text=>this.receive(entry,{method:'studio/diagnostic',params:{text}}));
  }
  entry.hub=hub;this.entries.set(id,entry);
  if(threadId!==null)this.byThread.set(key(provider,threadId),entry);
  return entry;
 }

 questionScope(entry,threadId,turnId){
  const {provider}=entry,owner=entry.hub.contexts.get(provider);
  const checkCurrent=()=>!!owner&&!entry.closed&&entry.threadId===threadId&&entry.turnId===turnId&&
   owner.threadId===threadId&&entry.hub.contexts.get(provider)===owner;
  return {...owner,provider,threadId,sessionId:entry.id,checkCurrent};
 }
 bindQuestion(entry,event){
  const {threadId,turnId,questions}=event.params;
  if(!turnId||!Array.isArray(questions)||!this.options.bindResourceQuestion)return;
  const scope=this.questionScope(entry,threadId,turnId);
  if(!scope.checkCurrent())return;
  const bindings=[];
  for(const q of questions){
   // The dedicated DeepSeek resource picker confirms its typed candidate IDs in DshBridge.
   if(!q||typeof q.id!=='string'||typeof q.question!=='string'||q.isSecret||q.multiSelect||
    entry.provider==='deepseek'&&q.id.startsWith(DSH_RESOURCE_QUESTION_PREFIX)||!Array.isArray(q.options)||
    !q.options.length||!q.options.every(option=>typeof option?.label==='string'))continue;
   const confirm=this.options.bindResourceQuestion(scope,{question:q.question,labels:q.options.map(option=>option.label)});
   if(confirm)bindings.push({id:q.id,confirm});
  }
  // Several independent resource selections need separate actions and scopes.
  if(bindings.length===1)this.resourceQuestions.set(event,bindings[0]);
 }

 entry(provider,threadId){
  providerId(provider);
  if(threadId!==undefined&&threadId!==null&&!exactThreadId(threadId))throw Error('Invalid conversation identity');
  const current=this.scope.getStore();
  if(current?.provider===provider&&(threadId===undefined||threadId===current.threadId))return current;
  if(this.foreground.provider===provider&&(threadId===undefined||threadId===this.foreground.threadId))return this.foreground;
  if(threadId===undefined||threadId===null)return this.create(provider,null);
  if(this.auth.deleted(provider,threadId))throw Error('Conversation was deleted');
  return this.byThread.get(key(provider,threadId))||this.create(provider,threadId);
 }

 identity(entry){return {id:entry.id,provider:entry.provider,threadId:entry.threadId,isForeground:()=>this.foreground===entry};}
 sessionIdentity(provider,threadId){
  const entry=threadId===undefined?(this.scope.getStore()||this.foreground):this.byThread.get(key(provider,threadId));
  return entry?.provider===provider&&!entry.closed?this.identity(entry):null;
 }
 selectForeground(provider,threadId){
  providerId(provider);
  const previous=this.foreground;
  this.foreground=threadId===null?this.create(provider,null):this.entry(provider,threadId);
  this.retireDraft(previous);
  return this.identity(this.foreground);
 }
 retireDraft(entry){if(entry!==this.foreground&&entry.threadId===null&&!entry.operations&&!this.busy(entry))this.retire(entry);}
 retire(entry){
  if(entry.closed)return;
  entry.closed=true;this.entries.delete(entry.id);
  if(this.byThread.get(key(entry.provider,entry.threadId))===entry)this.byThread.delete(key(entry.provider,entry.threadId));
  entry.hub.close();this.dropSession(entry.id);
 }
 adopt(entry,threadId){
  if(!exactThreadId(threadId))throw Error('Invalid native conversation identity');
  const existing=this.byThread.get(key(entry.provider,threadId));
  if(existing&&existing!==entry)throw Error('Native conversation already belongs to another transport');
  if(entry.threadId&&entry.threadId!==threadId){this.byThread.delete(key(entry.provider,entry.threadId));entry.liveTurn=null;}
  entry.threadId=threadId;this.byThread.set(key(entry.provider,threadId),entry);this.publishState(entry);
 }

 /** Capture origin before asynchronous preparation. Nested calls inherit that origin. */
 runInConversation(provider,threadId,run,{claimTurn=false,ifBusy,origin='human'}={}){
  const entry=this.entry(provider,threadId);
  return this.runEntry(entry,run,{claimTurn,ifBusy,origin});
 }
 runEntry(entry,run,{claimTurn=false,ifBusy,origin='human'}={}){
  if(this.scope.getStore()===entry)return run();
  if(claimTurn&&this.busy(entry)){
   if(ifBusy)return ifBusy();
   throw Error('This conversation already has a reply in progress');
  }
  return this.scope.run(entry,()=>this.runSession(this.identity(entry),async()=>{
   entry.operations=(entry.operations||0)+1;
   if(claimTurn){entry.preparing=true;entry.turnOrigin=origin;entry.turnGeneration=(entry.turnGeneration||0)+1;this.publishState(entry);}
   try{return await run();}finally{
    entry.operations--;
    if(claimTurn){entry.preparing=false;this.publishState(entry);}
    this.retireDraft(entry);
   }
  }));
 }
 runForScope(scope,run){
  if(scope?.sessionId===undefined)return run();
  const entry=this.entries.get(scope.sessionId);
  if(!entry||entry.provider!==scope.provider||scope.checkCurrent?.()!==true)throw Error('Invalid conversation tool scope');
  return this.scope.run(entry,run);
 }
 captureToolScope(scope){
  if(scope.sessionId===undefined)return scope;
  const entry=this.entries.get(scope.sessionId),generation=entry?.turnGeneration;
  return Object.freeze({...scope,checkCurrent:()=>!!entry&&!entry.closed&&entry.provider===scope.provider&&entry.turnGeneration===generation&&scope.checkCurrent()===true});
 }

 busy(entry){return !!(entry?.preparing||entry?.turnId||entry?.hub.contextBusy());}
 isBusy(provider,threadId){return this.busy(this.byThread.get(key(provider,threadId)));}
 turnOrigin(provider,threadId){return this.byThread.get(key(provider,threadId))?.turnOrigin;}
 contextBusy(){return [...this.entries.values()].some(entry=>this.busy(entry));}
 assertContextIdle(){
  const origin=this.scope.getStore();
  if(origin?origin.turnId||origin.hub.contextBusy():this.contextBusy())throw Error('Stop the current reply before changing its connection or authorization');
 }
 turnState(entry){return {provider:entry.provider,threadId:entry.threadId,busy:this.busy(entry),turnId:entry.turnId,phase:entry.turnId?'working':entry.preparing?'preparing':'idle'};}
 turnStates(){return [...this.byThread.values()].filter(entry=>this.busy(entry)).map(entry=>this.turnState(entry));}
 publishState(entry){
  if(!entry.threadId||entry.closed)return;
  const state=this.turnState(entry),stamp=JSON.stringify(state);
  if(stamp!==entry.stateStamp){entry.stateStamp=stamp;this.emit('event',{method:'studio/agentTurnState',provider:entry.provider,params:state});}
 }
 receive(entry,event){
  if(entry.closed)return;
  const params=event.params||{},threadId=params.threadId||params.thread?.id||entry.threadId;
  if(threadId&&entry.threadId&&threadId!==entry.threadId&&!(entry.replacing&&event.method==='thread/started'))return;
  if(event.method==='turn/completed'&&entry.turnId&&params.turn?.id!==entry.turnId)return;
  rememberLiveTurn(entry,event.method,params);
  const tagged={...event,provider:entry.provider,params:{...params,...threadId?{threadId}:{}}};
  if(event.method==='studio/accountUpdated'&&entry.hub.loginStatus[entry.provider]?.modelAccess==='passed')this.auth.loginStatus[entry.provider]={...this.auth.loginStatus[entry.provider],modelAccess:'passed'};
  if(event.method==='turn/started'&&exactThreadId(params.turn?.id))entry.turnId=params.turn.id;
  if(event.method==='turn/completed'&&params.turn?.id){
   entry.settledTurnId=params.turn.id;
   if(entry.turnId===params.turn.id)entry.turnId=null;
   entry.requests.clear();
  }
  if(event.method==='studio/codexDisconnected'){entry.turnId=null;entry.requests.clear();}
  if(event.id!==undefined&&threadId){
   entry.requests.set(String(event.id),tagged);
   if(event.method==='item/tool/requestUserInput')this.bindQuestion(entry,tagged);
  }
  if(event.method==='serverRequest/resolved')entry.requests.delete(String(params.requestId));
  this.emit('event',tagged);this.publishState(entry);
 }

 bridge(provider,threadId){return (threadId!==undefined?this.byThread.get(key(provider,threadId)):this.scope.getStore()||this.foreground)?.hub.bridge(provider);}
 toolConnection(provider,threadId){return (threadId!==undefined?this.byThread.get(key(provider,threadId)):this.scope.getStore()||this.foreground)?.hub.bridgeWorkers.get(provider);}
 preferences(provider){return this.auth.preferences(provider);}
 path(provider){return this.auth.path(provider);}
 threads(provider){return this.auth.threads(provider);}
 codexThreadState(threadId){return this.auth.codexThreadState(threadId);}
 threadReady(threadId){return this.byThread.get(key('codex',threadId))?.hub.threadReady(threadId)===true;}

 selectContext(provider,value={}){
  const context=providerContext(value),origin=this.scope.getStore(),entry=origin?.provider===provider?origin:this.entry(provider,context.threadId);
  if(origin&&context.threadId&&context.threadId!==entry.threadId)throw Error('Trusted provider binding belongs to another conversation');
  return this.withEntry(entry,()=>{
   entry.replacing=context.threadId===null&&!!entry.threadId;
   return entry.hub.selectContext(provider,context);
  });
 }
 withEntry(entry,run){
  if(this.scope.getStore()===entry)return run();
  return this.runEntry(entry,run);
 }
 connect(provider,{threadId,...options}={}){
  if(threadId===undefined&&!this.scope.getStore()&&provider!==this.foreground.provider)this.selectForeground(provider,null);
  const entry=this.entry(provider,threadId);
  return this.withEntry(entry,async()=>{
   const bridge=entry.hub.bridge(provider);
   if(this.busy(entry)&&bridge?.process){options.assertCurrent?.();return bridge.starting||bridge.info;}
   return entry.hub.connect(provider,options);
  });
 }
 async readActive(provider,threadId,method,params){
  const entry=this.byThread.get(key(provider,threadId));
  if(!entry||entry.closed)throw Error('Conversation transport is unavailable');
  const bridge=entry.hub.bridge(provider),thread=async()=>{
   if(bridge?.process){
    try{const result=await bridge.request('thread/read',{threadId,includeTurns:true});if(result?.thread?.id===threadId)return result;}
    catch(error){if(!this.busy(entry))throw error;}
   }
   const saved=this.options.catalog.get('thread',threadId);
   if(saved?.id===threadId&&provider==='codex')return {thread:saved};
   return {thread:{id:threadId,...this.options.catalog.get('agent-thread',key(provider,threadId)),turns:[]}};
  };
  const result=await thread();
  if(method==='thread/resume'){
   const session=bridge?.sessions?.get(threadId),model=bridge?.threadModels?.get(threadId)||session?.model||bridge?.model||params.model;
   return {...result,model,reasoningEffort:session?.effort};
  }
  return this.decorateRead(entry,result);
 }
 decorateRead(entry,result){
  const native=result.thread?.turns||[],live=entry.liveTurn,index=live?native.findIndex(turn=>turn.id===live.id):-1;
  const turns=live&&index>=0?native.map((turn,item)=>item===index?mergeLiveTurn(live,turn):turn):live?[...native,live]:native;
  const history=serviceHistory(this.options.catalog,entry.provider,entry.threadId,turns);
  return {...result,thread:result.thread?{...result.thread,turns:history}:result.thread,studioSession:{...this.turnState(entry),requests:[...entry.requests.values()]}};
 }
 rpc(provider,method,params={}){
  if(method.startsWith('account/'))return this.accountRpc(provider,method,params);
  const entry=this.entry(provider,params.threadId);
  return this.withEntry(entry,async()=>{
   if(entry.closed||params.threadId&&this.auth.deleted(provider,params.threadId))throw Error('Conversation was deleted');
   const hub=entry.hub;
   if(method==='turn/interrupt'||method==='turn/steer'){
    const turnId=method==='turn/interrupt'?params.turnId:params.expectedTurnId;
    if(!turnId||turnId!==entry.turnId)throw Error('The specified reply is no longer active in this conversation');
   }
   if(['thread/read','thread/resume'].includes(method)&&this.busy(entry)&&params.threadId)return this.readActive(provider,params.threadId,method,params);
   if(!hub.bridge(provider)?.process&&!hub.bridge(provider)?.starting){
    if(!['thread/read','thread/resume','turn/start','model/list','thread/start'].includes(method))throw Error('Connect '+provider+' first');
    const connected=await hub.connect(provider,{checkLogin:true});
    if(connected?.loginRequired||connected?.authRequired)throw Error('Provider authentication is required');
   }
   const result=await hub.rpc(provider,method,params);
   if(method==='thread/start'&&result.thread?.id)this.adopt(entry,result.thread.id);
   if(method==='turn/start'&&result.turn?.id&&result.turn.id!==entry.settledTurnId&&!terminalTurn(result.turn)){
    entry.turnId=result.turn.id;this.publishState(entry);
   }
   if(method==='thread/read')return this.decorateRead(entry,result);
   return result;
  });
 }
 async accountRpc(provider,method,params){
  if(method==='account/read')return this.account(provider);
  if(method==='account/logout')return this.logout(provider);
  if(method==='account/login/start')return this.login(provider,params);
  if(method==='account/login/cancel')return this.cancelCodexLogin(params.loginId);
  if(provider!=='codex')throw Error('Unsupported provider account operation');
  await this.auth.startCodexAuthentication();return this.auth.codex.request(method,params);
 }
 respond(provider,threadId,id,result){
  const entry=this.byThread.get(key(provider,threadId));
  const request=entry?.requests.get(String(id));
  if(!request)throw Error('Agent request no longer belongs to this conversation');
  const binding=this.resourceQuestions.get(request),answer=binding&&result?.answers?.[binding.id]?.answers;
  const value=entry.hub.respond(provider,id,result);
  entry.requests.delete(String(id));
  if(binding&&Array.isArray(answer)&&answer.length===1)binding.confirm(answer[0]);
  return value;
 }
 account(provider){
  const entry=this.scope.getStore()||this.foreground,bridge=entry?.hub.codex;
  // A reused ChatGPT subscription can be held in the conversation process only.
  if(provider==='codex'&&entry.provider==='codex'&&bridge?.process&&bridge.isolationReady&&
     !bridge.isolation?.authenticationOnly&&!this.auth.loginStatus?.codex?.phase)return entry.hub.account(provider);
  return this.auth.account(provider);
 }
 async login(provider,value){
  this.assertProviderIdle(provider);
  const result=await this.auth.login(provider,value);
  if(['deepseek','qwen','compatible'].includes(provider))this.resetProvider(provider);
  return result;
 }
 async logout(provider){this.assertProviderIdle(provider);this.resetProvider(provider);return this.auth.logout(provider);}
 cancelLogin(provider){return this.auth.cancelLogin(provider);}
 cancelCodexLogin(id){return this.auth.cancelCodexLogin(id);}
 testConnection(provider){return this.auth.testConnection(provider);}
 createApiBridge(provider,options){return this.auth.createApiBridge(provider,options);}
 assertProviderIdle(provider){if([...this.entries.values()].some(entry=>entry.provider===provider&&this.busy(entry)))throw Error('Stop this provider’s active replies before changing its credentials');}
 resetProvider(provider,{clearModels=false}={}){
  for(const entry of this.entries.values()){
   if(entry.provider!==provider)continue;
   entry.hub.disconnect(provider);
   const bridge=entry.hub.bridge(provider);
   if(clearModels&&bridge){bridge.sessions?.clear();bridge.model=undefined;bridge.modelInfos=[];}
  }
 }
 configure(provider,preferences,threadId,model){
  const entry=this.entry(provider,threadId);
  return this.withEntry(entry,()=>entry.hub.configure(provider,preferences,threadId,model));
 }
 disconnect(provider,threadId){
  const entry=threadId!==undefined?this.byThread.get(key(provider,threadId)):(this.scope.getStore()||this.foreground);
  if(entry?.provider!==provider)return;
  if(this.busy(entry))throw Error('Stop this conversation’s reply before disconnecting its provider');
  entry.hub.disconnect(provider);
 }
 forget(provider,threadId){
  const entry=this.byThread.get(key(provider,threadId));
  if(!entry)return;
  if(entry===this.foreground)this.foreground=this.create(provider,null);
  this.retire(entry);
 }
 close(){
  const provider=this.foreground.provider;
  for(const entry of this.entries.values())this.retire(entry);
  this.auth.close();this.foreground=this.create(provider,null);
 }
}
