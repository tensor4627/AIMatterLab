import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {AcpBridge} from './acp.mjs';
import {providerId,prepareProfile,qwenCredentials,spawnCli,redact,CLI_VERSIONS} from './providers.mjs';
import {agentConfig,STUDIO_INSTRUCTIONS} from './agent-settings.mjs';
import {assertRpc} from './security.mjs';
export function loginUrl(provider,url){
 const target=new URL(url);const hosts=provider==='kimi'?['kimi.com','kimi.ai']:['chatgpt.com','auth.openai.com','login.openai.com'];
 if(target.protocol!=='https:'||target.username||target.password||!hosts.some(h=>target.hostname===h||provider==='kimi'&&target.hostname.endsWith('.'+h)))throw Error('Unsupported provider login URL');
 return target.href;
}
export class AgentHub extends EventEmitter{
 constructor({codex,root,catalog,vault,settings,worker}){
  super();Object.assign(this,{codex,root,catalog,vault,getSettings:settings,getWorker:worker});this.active='codex';this.bridges=new Map();this.loginStatus={};this.codexOutput=new Set();
  this.codex.on?.('event',event=>{
   const thread=event.params?.threadId;
   if(event.method==='turn/started')this.codexOutput.delete(thread);
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
 preferences(provider){const settings=this.getSettings();return provider==='codex'?settings.agent||{}:settings.agentProviders?.[provider]||{};}
 path(provider){const settings=this.getSettings();return provider==='codex'?settings.codexPath:settings[provider+'Path'];}
 bridge(provider){return provider==='codex'?this.codex:this.bridges.get(provider);}
 threads(provider){const saved=this.catalog.list('agent-thread').filter(t=>t.provider===provider);return provider==='codex'?[...saved,...this.catalog.list('thread').filter(t=>!saved.some(s=>s.id===t.id)).map(t=>({...t,provider:'codex'}))]:saved;}
 remember(provider,thread){const value={...thread,provider};delete value.turns;this.catalog.put('agent-thread',provider+':'+thread.id,value);}
 async connect(provider){
  providerId(provider);
  if(this.active!==provider){this.cancelLogin();this.bridge(this.active)?.close();this.active=provider;}
  if(provider==='codex')return this.codex.start(this.path(provider),this.getWorker(),agentConfig(this.preferences(provider)));
  let bridge=this.bridges.get(provider);
  if(!bridge){
   bridge=new AcpBridge(provider);
   bridge.on('event',event=>{
    if(event.method==='thread/started'||event.method==='studio/sessionInfo')this.remember(provider,event.params.thread);
    if(event.method==='turn/completed'&&event.params.turn?.status==='completed'&&event.params.turn?.stopReason==='end_turn'&&event.params.turn?.modelOutputReceived){this.loginStatus[provider]={...this.loginStatus[provider],modelAccess:'passed'};this.emit('event',{method:'studio/accountUpdated',provider,params:{provider}});}
    this.emit('event',event);
   });
   bridge.on('diagnostic',text=>this.emit('event',{method:'studio/diagnostic',provider,params:{provider,text}}));this.bridges.set(provider,bridge);
  }
  const credential=provider==='qwen'?this.vault.get('qwen'):null;
  const profile=prepareProfile(this.root,provider,credential);
  return bridge.start(this.path(provider),profile,this.getWorker());
 }
 async account(provider){
  providerId(provider);
  if(provider==='codex'){
   // Account observers must never reconfigure a connection captured before tools attached.
   if(this.codex.starting)await this.codex.starting;
   else if(!this.codex.process)await this.codex.start(this.path('codex'),this.getWorker(),agentConfig(this.preferences('codex')));
   let result;try{result=await this.codex.request('account/read',{refreshToken:true});}
   catch(error){if(error.message!=='Codex bridge closed'||!this.codex.starting)throw error;await this.codex.starting;result=await this.codex.request('account/read',{refreshToken:true});}
   return {...result,provider,...this.loginStatus.codex,login:'chatgpt',modelAccess:this.loginStatus.codex?.modelAccess||'not_run'};
  }
  const status=this.loginStatus[provider]||{},credential=provider==='qwen'?this.vault.get('qwen'):null;
  return {provider,login:provider==='codex'?'chatgpt':provider==='kimi'?'device':'api-key',...status,...credential?{credentialStored:true,model:credential.model,plan:credential.plan}:{},modelAccess:status.modelAccess||'not_run'};
 }
 async rpc(provider,method,params={}){
  providerId(provider);assertRpc(method);if(provider!==this.active)throw Error('Connect the selected provider first');
  const bridge=this.bridge(provider);if(!bridge?.process)throw Error('Connect '+provider+' first');
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
   if(this.threadProcess!==bridge.process){this.threadProcess=bridge.process;this.readyThreads=new Set();}
   if(method==='turn/start'&&!this.readyThreads.has(params.threadId)){
    await this.rpc(provider,'thread/resume',{threadId:params.threadId,model:params.model});
   }
  }
  const result=await bridge.request(method,params);
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
  if(provider==='qwen'){
   const credential=qwenCredentials(value);this.vault.put('qwen',credential);this.bridges.get(provider)?.close();
   this.loginStatus[provider]={phase:'configured',modelAccess:'not_run'};return this.account(provider);
  }
  if(this.loginChild)throw Error('A provider login is already in progress');
  if(!['mainland-cn','global'].includes(value.region||'mainland-cn'))throw Error('Unsupported Kimi login region');
  const profile=prepareProfile(this.root,'kimi');const child=spawnCli(this.path('kimi'),['acp','--login','--region',value.region||'mainland-cn'],{cwd:profile.cwd,env:profile.env});
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
   this.loginStatus.kimi={phase:error||code!==0?'failed':'completed',message:error?.message||(code!==0?'Login exited with '+code:'Login completed'),modelAccess:'not_run'};this.bridges.get('kimi')?.close();publish();
  };
  child.on('error',error=>settle(error));child.on('exit',code=>settle(null,code));publish();return {provider:'kimi',phase:'starting'};
 }
 cancelLogin(){
  if(this.loginStatus.codex?.phase==='authorizing'&&this.codex.process){void this.codex.request('account/login/cancel',{loginId:this.loginStatus.codex.loginId}).catch(()=>{});}
  const child=this.loginChild;if(!child)return;this.loginChild=null;child.kill();this.loginStatus.kimi={phase:'cancelled',modelAccess:'not_run'};this.emit('event',{method:'studio/login',provider:'kimi',params:{provider:'kimi',phase:'cancelled'}});
 }
 async configure(provider,preferences,threadId,model){
  if(this.codex.activeTurns?.size)throw Error('Stop the current reply before changing context settings');
  if(provider!=='codex')throw Error('This ACP provider does not expose editable context budgets; use its server-reported context and model settings');
  const config=agentConfig(preferences);this.codex.close();await this.codex.start(this.path('codex'),this.getWorker(),config);
  if(!threadId)return {configured:true};return this.rpc('codex','thread/resume',{threadId,model});
 }
 close(){this.cancelLogin();this.codex.close();for(const bridge of this.bridges.values())bridge.close();}
}
