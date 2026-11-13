import {compatibleCredentials} from './compatible-api.mjs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {deepseekCredentials} from './deepseek.mjs';
import {DshBridge} from './dsh.mjs';
import {CodexApiBridge} from './codex-api.mjs';
import {AcpBridge} from './acp.mjs';
import {providerId,qwenCredentials,redact,CLI_VERSIONS} from './contracts.mjs';
import {providerRuntime} from '../../desktop/platform/provider-runtime.mjs';
import {agentConfig,STUDIO_INSTRUCTIONS} from '../context/agent-settings.mjs';
import {providerContext,MCP_CONTEXT_KEYS} from '../tools/provider-scope.mjs';
export function loginUrl(provider,url){
 const target=new URL(url);const hosts=provider==='kimi'?['kimi.com','kimi.ai']:['chatgpt.com','auth.openai.com','login.openai.com'];
 if(target.protocol!=='https:'||target.username||target.password||!hosts.some(h=>target.hostname===h||provider==='kimi'&&target.hostname.endsWith('.'+h)))throw Error('Unsupported provider login URL');
 return target.href;
}
export class AgentHub extends EventEmitter{
 constructor({codex,root,catalog,vault,settings,worker,releaseWorker=()=>{},bindWorkerContext,resourceScope=()=>null,fetchApi,host=providerRuntime,resolveCli,apiBridgeFactories={}}){
  super();Object.assign(this,{codex,root,catalog,vault,getSettings:settings,getWorker:worker});this.releaseWorker=releaseWorker;this.bindWorkerContext=bindWorkerContext;this.contexts=new Map();this.contextGeneration=0;this.contextPending=0;this.contextQueue=Promise.resolve();this.pristineThreads=new Set();this.attemptedThreads=new Set();this.contextResume=new Map();this.pendingTurnDispatches=new Set();this.contextClosing=new Set();this.bridgeWorkers=new Map();this.fetchApi=fetchApi;this.host=host;this.active='codex';this.bridges=new Map();this.loginStatus={};this.codexOutput=new Set();this.blankThreads=new Map();this.pendingBlankTurns=new Set();
  this.resourceScope=resourceScope;this.resolveCli=resolveCli;this.credentialRevisions=new Map();this.apiBridgeFactories=apiBridgeFactories;
  this.codex.on?.('event',event=>{
   if(event.method==='studio/codexDisconnected')this.release('codex');
   const thread=event.params?.threadId;
   if(event.method==='turn/started'){this.codexOutput.delete(thread);this.blankThreads.delete(thread);this.pendingBlankTurns.delete(thread);this.recordCodexThread(thread,'has_turns');}
   if(event.method==='item/agentMessage/delta'&&event.params?.delta?.trim())this.codexOutput.add(thread);
   if(event.method==='turn/completed'&&event.params?.turn?.status==='completed'&&this.codexOutput.has(thread)){this.loginStatus.codex={...this.loginStatus.codex,modelAccess:'passed'};this.emit('event',{method:'studio/accountUpdated',provider:'codex',params:{}});}

   if(event.method==='account/login/completed'){
    this.loginStatus.codex={phase:event.params?.success?'completed':'failed',message:event.params?.error||'',modelAccess:'not_run'};
    this.emit('event',{method:'studio/login',provider:'codex',params:{provider:'codex',...this.loginStatus.codex}});
    this.emit('event',{method:'studio/accountUpdated',provider:'codex',params:{}});
   }
   if(event.method==='account/updated')this.emit('event',{method:'studio/accountUpdated',provider:'codex',params:{}});
  });
 }
 release(provider){this.bridgeWorkers.delete(provider);this.releaseWorker(provider);}
 disconnect(provider,{preserveConnectIntent=false}={}){if(!preserveConnectIntent&&this.connectIntentProvider===provider){this.connectIntentProvider=null;this.connectEpoch=(this.connectEpoch||0)+1;}if(provider==='kimi')this.cliLoginGeneration=(this.cliLoginGeneration||0)+1;this.bridge(provider)?.close();this.release(provider);}
 workerFor(provider){const worker=this.getWorker(provider);if(worker)this.bridgeWorkers.set(provider,worker);else this.bridgeWorkers.delete(provider);return worker;}
 async startCodex(config=agentConfig(this.preferences('codex'))){
  const executable=this.path('codex');let worker=this.workerFor('codex');
  const key=createHash('sha256').update(JSON.stringify([executable,worker?.url,worker?.tokens?.mcp,config])).digest('hex');
  if(this.codex.process&&this.codex.contextKey&&this.codex.contextKey!==key){this.disconnect('codex',{preserveConnectIntent:true});worker=this.workerFor('codex');}
  try{return await this.codex.start(executable,worker,config);}catch(error){this.release('codex');throw error;}
 }
 isContextTransition(provider){return this.contextClosing.has(provider);}
 closeForContext(provider){this.contextClosing.add(provider);try{this.disconnect(provider);}finally{this.contextClosing.delete(provider);}}
 contextKey(provider,threadId){return provider+':'+threadId;}
 assertContextIdle(){
  if(this.pendingTurnDispatches.size||this.codex.activeTurns?.size||[...this.bridges.values()].some(b=>b.activeTurns?.size))throw Error('Stop the current reply before switching conversation context');
 }
 selectContext(provider,value={}){
  providerId(provider);this.assertContextIdle();const context=providerContext(value);
  if(typeof this.bindWorkerContext!=='function')throw Error('Trusted worker context binding is unavailable');
  const previous=this.contexts.get(provider)||providerContext(),key=this.contextKey(provider,context.threadId);
  const changed=MCP_CONTEXT_KEYS.some(k=>previous[k]!==context[k]);
  const initialFill=changed&&context.threadId!==null&&this.pristineThreads.has(key)&&!this.attemptedThreads.has(key)&&MCP_CONTEXT_KEYS.every(k=>previous[k]===context[k]||previous[k]===null&&context[k]!==null);
  const generation=++this.contextGeneration,wasConnected=!!(this.bridge(provider)?.process||this.bridge(provider)?.starting);
  // Invalidate the old credential immediately, before waiting for any earlier connect.
  const first=this.bindWorkerContext(provider,context,{allowInitialFill:initialFill});
  this.contextPending=generation;
  this.contexts.set(provider,context);
  const current=()=>this.contextGeneration===generation&&this.contexts.get(provider)===context;
  const work=this.contextQueue.catch(()=>{}).then(async()=>{
   if(!current())throw Error('Conversation context selection was superseded');
   let binding=first;
   if(first.rotated&&wasConnected){
    const bridge=this.bridge(provider),models=['deepseek','compatible'].includes(provider)?{models:[...(bridge.models||[])],model:bridge.model}:null;
    this.closeForContext(provider); // close may revoke; only mint the new process lease after close.
    binding=this.bindWorkerContext(provider,context,{allowInitialFill:false});
    try{await this.connect(provider);}catch(error){if(current()){this.contextResume.delete(provider);this.emit('event',{provider,method:'studio/codexDisconnected',params:{reason:'Conversation context reconnection failed',message:error.message}});}throw error;}
    if(!current()){this.closeForContext(provider);throw Error('Conversation context selection was superseded');}
    if(models){bridge.models=models.models;bridge.model=models.model;}
    if(context.threadId)this.contextResume.set(provider,context.threadId);else this.contextResume.delete(provider);
   }else if(wasConnected&&!this.bridge(provider)?.process){
    binding=this.bindWorkerContext(provider,context,{allowInitialFill:false});
    try{await this.connect(provider);}catch(error){if(current()){this.contextResume.delete(provider);this.emit('event',{provider,method:'studio/codexDisconnected',params:{reason:'Conversation context reconnection failed',message:error.message}});}throw error;}
    if(!current()){this.closeForContext(provider);throw Error('Conversation context selection was superseded');}
    if(context.threadId)this.contextResume.set(provider,context.threadId);
   }else if(changed&&!initialFill){
    if(context.threadId)this.contextResume.set(provider,context.threadId);else this.contextResume.delete(provider);
   }
   if(!current())throw Error('Conversation context selection was superseded');
   return {...binding,context,connected:!!this.bridge(provider)?.process};
  });
  const settled=work.finally(()=>{if(this.contextPending===generation)this.contextPending=0;});this.contextQueue=settled.catch(()=>{});return settled;
 }
 preferences(provider){const settings=this.getSettings();return provider==='codex'?settings.agent||{}:settings.agentProviders?.[provider]||{};}
 path(provider){const settings=this.getSettings();return provider==='codex'?settings.codexPath:settings[provider+'Path'];}
 bridge(provider){return provider==='codex'?this.codex:this.bridges.get(provider);}
 createApiBridge(provider,overrides={}){
  const options={provider,root:this.root,catalog:this.catalog,credential:()=>this.vault.get(provider),worker:()=>this.bridgeWorkers.get(provider),...provider==='compatible'?{executable:()=>this.path('codex')}:{},...this.fetchApi?{fetchApi:this.fetchApi}:{},...overrides};
  return this.apiBridgeFactories[provider]?this.apiBridgeFactories[provider](options):provider==='deepseek'?new DshBridge(options):new CodexApiBridge(options);
 }
 deleted(provider,id){return !!(this.catalog.get?.('deleted-conversation',provider+':'+id)||this.catalog.get?.('retired-conversation-context',provider+':'+id));}
 forget(provider,id){const bridge=this.bridge(provider);bridge?.sessions?.delete(id);if(bridge?.current===id)bridge.current=null;if(provider==='codex'){this.blankThreads.delete(id);this.pendingBlankTurns.delete(id);this.readyThreads?.delete(id);this.codexOutput.delete(id);}}
 threads(provider){const saved=this.catalog.list('agent-thread').filter(t=>t.provider===provider&&!this.deleted(provider,t.id));return provider==='codex'?[...saved,...this.catalog.list('thread').filter(t=>!this.deleted(provider,t.id)&&!saved.some(s=>s.id===t.id)).map(t=>({...t,provider:'codex'}))]:saved;}
 remember(provider,thread){if(this.deleted(provider,thread.id))return;const value={...thread,provider};delete value.turns;this.catalog.put('agent-thread',provider+':'+thread.id,value);}
 codexThreadState(id){return this.catalog.get?.('codex-thread-lifecycle',id)||this.codexThreadStates?.get(id)||null;}
 recordCodexThread(id,state,metadata={}){if(typeof id!=='string'||!id)return;const previous=this.codexThreadState(id);if(previous?.state==='has_turns'&&state!=='has_turns')return;const value={...previous,...metadata,id,state,updatedAt:Date.now()};(this.codexThreadStates??=new Map()).set(id,value);this.catalog.put?.('codex-thread-lifecycle',id,value);}
 threadReady(id){return this.threadProcess===this.codex.process&&this.readyThreads?.has(id)&&this.contextResume.get('codex')!==id;}
 async connect(provider){
  providerId(provider);
  const generation=this.contextGeneration,connectEpoch=this.connectEpoch||0;this.connectIntentProvider=provider;
  if(provider!=='kimi')this.cliLoginGeneration=(this.cliLoginGeneration||0)+1;
  let executable;try{executable=['kimi','qwen'].includes(provider)&&this.resolveCli?await this.resolveCli(provider):this.path(provider);}catch(error){if(this.connectIntentProvider!==provider||this.contextGeneration!==generation||(this.connectEpoch||0)!==connectEpoch)throw Error('Provider selection changed during CLI discovery');throw error;}
  if(this.connectIntentProvider!==provider||this.contextGeneration!==generation||(this.connectEpoch||0)!==connectEpoch)throw Error('Provider selection changed during CLI discovery');
  if(this.active!==provider){this.disconnect(this.active);this.active=provider;}
  if(provider==='codex')return this.startCodex();
  let bridge=this.bridges.get(provider);
  if(!bridge){
   bridge=['deepseek','compatible'].includes(provider)?this.createApiBridge(provider):new AcpBridge(provider,{host:this.host});
   bridge.on('event',event=>{
    if(event.method==='studio/codexDisconnected'){this.release(provider);if(this.isContextTransition(provider))return;}
    if(event.method==='thread/started'||event.method==='studio/sessionInfo')this.remember(provider,event.params.thread);
    if(event.method==='turn/completed'&&event.params.turn?.status==='completed'&&event.params.turn?.stopReason==='end_turn'&&event.params.turn?.modelOutputReceived){this.loginStatus[provider]={...this.loginStatus[provider],modelAccess:'passed'};this.emit('event',{method:'studio/accountUpdated',provider,params:{provider}});}
    this.emit('event',event);
   });
   bridge.on('diagnostic',text=>this.emit('event',{method:'studio/diagnostic',provider,params:{provider,text}}));this.bridges.set(provider,bridge);
  }
  if(['deepseek','compatible'].includes(provider)){this.workerFor(provider);try{return await bridge.start();}catch(error){this.release(provider);throw error;}}
  const credential=['qwen','deepseek','compatible'].includes(provider)?this.vault.get(provider):null;
  const profile=this.host.prepareProfile(this.root,provider,credential);
  const previous=this.bridgeWorkers.get(provider);let scoped=this.workerFor(provider);
  if(bridge.process&&(bridge.executable!==executable||previous?.url!==scoped?.url||previous?.tokens?.mcp!==scoped?.tokens?.mcp)){this.disconnect(provider,{preserveConnectIntent:true});scoped=this.workerFor(provider);}
  try{return await bridge.start(executable,profile,scoped);}catch(error){this.release(provider);throw error;}
 }
 async account(provider){
  providerId(provider);
  if(provider==='codex'){
   // Account observers must never reconfigure a connection captured before tools attached.
   if(this.codex.starting)await this.codex.starting;
   else if(!this.codex.process)await this.startCodex();
   let result;try{result=await this.codex.request('account/read',{refreshToken:false});}
   catch(error){if(error.message!=='Codex bridge closed'||!this.codex.starting)throw error;await this.codex.starting;result=await this.codex.request('account/read',{refreshToken:false});}
   return {...result,provider,...this.loginStatus.codex,login:'chatgpt',modelAccess:this.loginStatus.codex?.modelAccess||'not_run'};
  }
  const status=this.loginStatus[provider]||{},credential=['qwen','deepseek','compatible'].includes(provider)?this.vault.get(provider):null;
  return {provider,login:provider==='codex'?'chatgpt':provider==='kimi'?'device':'api-key',...status,...credential?{credentialStored:true,model:credential.model,plan:credential.plan,...provider==='compatible'?{baseUrl:credential.baseUrl,label:credential.label,reasoningMode:credential.reasoningMode||'omit',reasoningEffort:credential.reasoningEffort||'',publicGuidesAllowed:['pygas','pydyn','gpumd','hotpp','torchnep'].every(source=>(source==='pygas'?this.getSettings().pygasSkillProviders||[]:this.getSettings().scientificSkillProviders?.[source]||[]).includes('compatible'))}:{}}:{},modelAccess:status.modelAccess||'not_run'};
 }
 async rpc(provider,method,params={}){
  providerId(provider);this.host.assertRpc(method);if(this.contextPending&&!['turn/interrupt','account/read'].includes(method))throw Error('Wait for conversation context selection to finish');if(params.threadId&&this.deleted(provider,params.threadId))throw Error('Conversation was deleted');if(provider!==this.active)throw Error('Connect the selected provider first');
  const bridge=this.bridge(provider);
  const generation=this.contextGeneration,selected=this.contexts.get(provider),resource=this.resourceScope(provider,method);
  const assertSelected=()=>{resource?.assertCurrent();if(provider!==this.active||this.bridge(provider)!==bridge||generation!==this.contextGeneration||selected!==this.contexts.get(provider))throw Error('Conversation context selection was superseded');if(params.threadId&&this.deleted(provider,params.threadId))throw Error('Conversation was deleted');};
  // A spawned app-server is only a transport until initialize and isolation readbacks finish.
  if(bridge?.starting){const lifecycle=bridge.lifecycle;await bridge.starting;assertSelected();if(lifecycle!==bridge.lifecycle)throw Error('Agent context changed while connecting');}
  if(!bridge?.process)throw Error('Connect '+provider+' first');
  if(selected&&params.threadId&&selected.threadId!==params.threadId)throw Error('Select the trusted conversation context first');
  if(selected?.threadId&&method==='thread/start')throw Error('Select an empty conversation context before starting a new thread');
  const resume=this.contextResume.get(provider);
  if(resume&&(provider==='codex'?['thread/read','turn/start','turn/steer'].includes(method):!['model/list','model/select','thread/start','thread/resume','thread/list','account/read','turn/interrupt'].includes(method))){
   await this.rpc(provider,'thread/resume',{threadId:resume,model:params.model});assertSelected();
  }

  if(provider==='codex'&&['thread/start','thread/resume'].includes(method))params={...params,cwd:this.getSettings().cwd,approvalPolicy:'on-request',sandbox:'read-only',config:{...params.config,...agentConfig(this.preferences('codex'))},developerInstructions:STUDIO_INSTRUCTIONS};
  if(provider!=='codex'&&method==='account/read')return {...await this.account(provider),transportConnected:true};
  if(provider!=='codex'&&method==='thread/list')return {data:this.threads(provider)};
  if(provider!=='codex'&&method==='turn/start'){
   const input=[];
   for(const item of params.input||[]){
    if(item.type==='text')input.push(item);
    // Skills are added by main after checking the registered source.
   }
   params={...params,input};
  }
  if(provider==='codex'){
   if(this.threadProcess!==bridge.process){this.threadProcess=bridge.process;this.readyThreads=new Set();this.blankThreads.clear();this.pendingBlankTurns.clear();}
   // A newly started zero-turn thread has no rollout yet. Its native start response
   // is authoritative only while this exact app-server process remains alive.
   const blank=this.blankThreads.get(params.threadId);
   if(blank&&this.pendingBlankTurns.has(params.threadId)&&['thread/resume','thread/read'].includes(method))throw Error('首条回复尚未确认，请等待服务回报后再恢复会话');
   if(blank&&method==='thread/resume'){if(this.contextResume.get(provider)===params.threadId)this.contextResume.delete(provider);return structuredClone(blank);}
   if(blank&&method==='thread/read')return {thread:structuredClone(blank.thread)};
   if(method==='turn/start'&&!this.readyThreads.has(params.threadId)){
    await this.rpc(provider,'thread/resume',{threadId:params.threadId,model:params.model});assertSelected();
   }
  }
  const blankStart=provider==='codex'&&method==='turn/start'&&this.blankThreads.has(params.threadId);
  if(blankStart){if(this.pendingBlankTurns.has(params.threadId))throw Error('首条回复尚未确认，请等待服务回报');this.pendingBlankTurns.add(params.threadId);}
  const attemptedKey=params.threadId?this.contextKey(provider,params.threadId):null;
  if(method==='turn/start'){this.pristineThreads.delete(attemptedKey);this.attemptedThreads.add(attemptedKey);this.pendingTurnDispatches.add(attemptedKey);}
  const emptyDispatch=provider==='codex'&&method==='turn/start'&&this.codexThreadState(params.threadId)?.state==='empty';
  let result;try{if(emptyDispatch)this.recordCodexThread(params.threadId,'pending');assertSelected();result=await bridge.request(method,params,undefined,{assertCurrent:assertSelected});assertSelected();}catch(error){
   if(blankStart){this.pendingBlankTurns.delete(params.threadId);if(error.rpcResponse!==true)this.blankThreads.delete(params.threadId);}
   if(emptyDispatch)this.recordCodexThread(params.threadId,error.rpcResponse===true?'empty':'unknown');
   if(provider==='codex'&&method==='thread/resume'&&/no rollout found for thread/i.test(error.message)){const missing=Error('暂时无法读取此对话的聊天记录。计算流程和作业记录仍保留，可重新建立对话连接。',{cause:error});missing.code='STUDIO_CODEX_ROLLOUT_MISSING';throw missing;}
   throw error;
  }finally{if(method==='turn/start')this.pendingTurnDispatches.delete(attemptedKey);}
  if(method==='thread/start'&&result.thread){const key=this.contextKey(provider,result.thread.id);if(!result.thread.turns?.length&&!this.attemptedThreads.has(key))this.pristineThreads.add(key);}
  if(method==='thread/resume'&&result.thread?.id===this.contextResume.get(provider))this.contextResume.delete(provider);
  if(params.threadId&&this.deleted(provider,params.threadId))throw Error('Conversation was deleted');
  if(method==='thread/list'&&result.data)result={...result,data:result.data.filter(t=>!this.deleted(provider,t.id))};
  if(provider==='codex'&&method==='turn/start'){this.pendingBlankTurns.delete(params.threadId);this.blankThreads.delete(params.threadId);}
  if(provider==='codex'&&method==='turn/start')this.recordCodexThread(params.threadId,'has_turns');
  if(provider==='codex'&&method==='thread/start'&&result.thread&&Array.isArray(result.thread.turns)&&result.thread.turns.length===0)this.recordCodexThread(result.thread.id,'empty',{model:result.model||null});
  if(provider==='codex'&&['thread/read','thread/resume'].includes(method)&&result.thread?.turns?.length)this.recordCodexThread(result.thread.id,'has_turns');
  if(provider==='codex'&&method==='thread/start'&&result.thread&&!result.thread.turns?.length)this.blankThreads.set(result.thread.id,structuredClone(result));
  if(provider==='codex'&&['thread/start','thread/resume'].includes(method)&&result.thread)this.readyThreads.add(result.thread.id);
  if(['thread/start','thread/resume'].includes(method)&&result.thread)this.remember(provider,result.thread);
  return result;
 }
 respond(provider,id,result){if(provider!==this.active)throw Error('Provider switched');return this.bridge(provider).respond(id,result);}
 async login(provider,value={}){
  providerId(provider);
  if(provider==='codex'){
   if(!['chatgpt','chatgptDeviceCode','apiKey'].includes(value.type||'chatgpt'))throw Error('Unsupported Codex login');
   if(value.type==='apiKey'&&(typeof value.apiKey!=='string'||value.apiKey.length<8||/\s/.test(value.apiKey)))throw Error('Invalid API key');
   await this.connect(provider);const result=await this.codex.request('account/login/start',{type:value.type||'chatgpt',...value.type==='apiKey'?{apiKey:value.apiKey}:{}});
   this.loginStatus.codex={phase:result.type==='apiKey'?'completed':'authorizing',loginId:result.loginId,url:result.authUrl||result.verificationUrl,userCode:result.userCode,modelAccess:'not_run'};
   return {provider,...this.loginStatus.codex};
  }
  if(['qwen','deepseek','compatible'].includes(provider)){
   if(this.bridge(provider)?.activeTurns?.size)throw Error('Stop the current reply before replacing API credentials');
   if(provider==='compatible'&&value.apiKey===''){const old=this.vault.get(provider);let same=false;try{same=new URL(value.baseUrl).href.replace(/\/$/,'')===old?.baseUrl;}catch{}if(same&&old?.apiKey)value={...value,apiKey:old.apiKey};}
   const credential=provider==='deepseek'?deepseekCredentials(value):provider==='compatible'?compatibleCredentials(value):qwenCredentials(value);this.vault.put(provider,credential);this.credentialRevisions.set(provider,(this.credentialRevisions.get(provider)||0)+1);this.disconnect(provider);
   this.loginStatus[provider]={phase:'configured',modelAccess:'not_run'};return this.account(provider);
  }
  if(this.loginChild)throw Error('A provider login is already in progress');
  if(!['mainland-cn','global'].includes(value.region||'mainland-cn'))throw Error('Unsupported Kimi login region');
  const loginGeneration=this.cliLoginGeneration||0,executable=this.resolveCli?await this.resolveCli('kimi'):this.path('kimi');
  if(loginGeneration!==(this.cliLoginGeneration||0))throw Error('Kimi login was cancelled');
  if(this.loginChild)throw Error('A provider login is already in progress');
  const profile=this.host.prepareProfile(this.root,'kimi');const child=this.host.spawnCli(executable,['acp','--login','--region',value.region||'mainland-cn'],{provider:'kimi',cwd:profile.cwd,env:profile.env});
  this.loginChild=child;this.loginStatus.kimi={phase:'starting',modelAccess:'not_run'};
  let buffer='';
  const publish=()=>{
   this.emit('event',{method:'studio/login',provider:'kimi',params:{provider:'kimi',...this.loginStatus.kimi}});
  };
  const output=data=>{
   if(this.loginChild!==child)return;
   buffer=(buffer+data.toString().replace(/\x1b\[[0-9;]*m/g,'')).slice(-8000);
   const urls=buffer.match(/https:\/\/[^\s<>"'\x1b]+/g)||[];
   for(const value of urls)try{this.loginStatus.kimi.url=loginUrl('kimi',value.replace(/[),.;]+$/,''));}catch{}
   this.loginStatus.kimi.phase='authorizing';this.loginStatus.kimi.message=redact(buffer).slice(-3000);publish();
  };
  child.stdout.on('data',output);child.stderr.on('data',output);
  const timer=setTimeout(()=>this.cancelLogin(),10*60*1000);
  const settle=(error,code)=>{
   clearTimeout(timer);if(this.loginChild!==child)return;this.loginChild=null;
   this.loginStatus.kimi={phase:error||code!==0?'failed':'completed',message:error?.message||(code!==0?'Login exited with '+code:'Login completed'),modelAccess:'not_run'};this.disconnect('kimi');publish();
  };
  child.on('error',error=>settle(error));child.on('exit',code=>settle(null,code));publish();return {provider:'kimi',phase:'starting'};
 }
 cancelLogin(){
  this.cliLoginGeneration=(this.cliLoginGeneration||0)+1;
  if(this.loginStatus.codex?.phase==='authorizing'&&this.codex.process){void this.codex.request('account/login/cancel',{loginId:this.loginStatus.codex.loginId}).catch(()=>{});}
  const child=this.loginChild;if(!child)return;this.loginChild=null;child.kill();this.loginStatus.kimi={phase:'cancelled',modelAccess:'not_run'};this.emit('event',{method:'studio/login',provider:'kimi',params:{provider:'kimi',phase:'cancelled'}});
 }
 async logout(provider){providerId(provider);if(provider==='codex'){await this.account(provider);await this.codex.request('account/logout',{});}else if(['qwen','deepseek','compatible'].includes(provider))this.vault.remove(provider);else throw Error('Kimi 账户请使用重新授权更新。');this.disconnect(provider);this.loginStatus[provider]={phase:'signed_out',modelAccess:'not_run'};return this.account(provider);}
 async testConnection(provider){
  providerId(provider);if(!['deepseek','compatible'].includes(provider))throw Error('请使用此服务商的登录状态与会话连接检查');
  const credential=structuredClone(this.vault.get(provider));if(!credential)throw Error('请先保存 API 凭据后再验证连接');
  // Keep a private immutable snapshot: a running test must never follow a newly saved endpoint/key.
  const revision=this.credentialRevisions.get(provider)||0,identity=JSON.stringify(credential),current=()=>revision===(this.credentialRevisions.get(provider)||0)&&JSON.stringify(this.vault.get(provider))===identity;
  const values=new Map(),catalog={put:(kind,id,value)=>values.set(kind+id,value),get:(kind,id)=>values.get(kind+id),list:()=>[]};
  const bridge=this.createApiBridge(provider,{root:path.join(this.root,'connection-checks',randomUUID()),catalog,credential:()=>credential,worker:()=>null});let timer;
  try{await bridge.start();await bridge.request('model/list');const thread=await bridge.request('thread/start',{});const completion=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('连接测试超时；没有提交计算。')),45000);bridge.on('event',event=>{if(event.method==='turn/completed'){event.params.turn.status==='completed'&&event.params.turn.modelOutputReceived===true?resolve(event.params.turn):reject(Error(event.params.turn.error?.message||'API 测试未收到完整模型回复'));}});});await Promise.all([completion,bridge.request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Connection test. Reply exactly OK. Do not call tools.'}]})]);if(!current())throw Error('API 配置已变化；请重新验证当前配置');this.loginStatus[provider]={...this.loginStatus[provider],modelAccess:'passed'};this.emit('event',{method:'studio/accountUpdated',provider,params:{}});return {status:'passed',model:thread.model,scope:'One harness-streamed test reply; no conversation inputs or scientific files shared'};}finally{clearTimeout(timer);bridge.close();}
 }
 async configure(provider,preferences,threadId,model){
  if(this.codex.activeTurns?.size)throw Error('Stop the current reply before changing context settings');
  if(provider!=='codex')throw Error('This ACP provider does not expose editable context budgets; use its server-reported context and model settings');
  const config=agentConfig(preferences);this.disconnect('codex');await this.startCodex(config);
  if(!threadId)return {configured:true};return this.rpc('codex','thread/resume',{threadId,model});
 }
 close(){++this.contextGeneration;this.contextPending=0;this.contexts.clear();this.contextResume.clear();this.cancelLogin();this.disconnect('codex');for(const provider of this.bridges.keys())this.disconnect(provider);}
}
