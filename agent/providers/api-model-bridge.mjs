import {createHash,randomUUID} from 'node:crypto';
import {DshBridge} from './dsh.mjs';
import {prepareApiDshProfile} from '../../desktop/platform/dsh-runtime.mjs';
import {apiModelKey} from '../../contracts/agent/model-profiles.mjs';
import {createJsonlFramer} from './jsonl-frames.mjs';
import {sanitizeTranscript,sanitizeProtocolTranscript} from '../../contracts/agent/transcript-sanitizer.mjs';
const KIND='api-dsh-history';
/** DSH owns protocol adaptation, reasoning dispatch and the native tool loop. */
export class ApiModelBridge extends DshBridge{
 constructor({provider,profiles,...options}){super(options);this.provider=provider;this.profiles=profiles;this.selection=null;this.boundCredentials=new Map();}
 cleanValue(value){return sanitizeTranscript(value,[...this.boundCredentials.values(),this.getCredential()?.apiKey,this.getWorker()?.tokens?.mcp]);}
 cleanProtocol(value,options){return sanitizeProtocolTranscript(value,[...this.boundCredentials.values(),this.getCredential()?.apiKey,this.getWorker()?.tokens?.mcp],options);}
 event(method,params){this.emit('event',this.cleanProtocol({provider:this.provider,method,params}));}
 choose(key){const selected=this.profiles.resolve(this.provider,key||this.model);if(this.selection&&this.selection.profile.id!==selected.profile.id)this.modelInfos=[];this.selection=selected;this.model=selected.key;return this.model;}
 modelCatalog(){return {data:this.profiles.list(this.provider).flatMap(profile=>profile.models.map(model=>{
  const efforts=model.reasoningEfforts&&Object.entries(model.reasoningEfforts).map(([id])=>({reasoningEffort:id,description:id}))||[];
  const info=profile.id===this.selection?.profile.id?this.modelInfos?.find(v=>v.id===model.id):null;
  const available=profile.authMode==='deepseek-account'?efforts:info?.reasoning?.efforts?.map(v=>({reasoningEffort:v.id,description:v.name||v.id}))||efforts;
  return {id:apiModelKey(profile.id,model.id),model:apiModelKey(profile.id,model.id),displayName:model.name||model.id,providerName:profile.name,profileId:profile.id,isDefault:apiModelKey(profile.id,model.id)===this.model,supportedReasoningEfforts:available,defaultReasoningEffort:available.find(v=>v.reasoningEffort==='off')?.reasoningEffort||info?.reasoning?.defaultEffort||available[0]?.reasoningEffort,...model.contextWindow?{contextWindow:model.contextWindow}:{},...model.maxTokens?{maxTokens:model.maxTokens}:{}};
 }))};}
 async start(){if(this.starting)return this.starting;if(this.process)return this.info;if(!this.profiles.list(this.provider).length)throw Error('请先保存 API Key 和服务商模型配置');this.choose(this.model);const promise=this.launch(this.model).finally(()=>{if(this.starting===promise)this.starting=null;});this.starting=promise;return promise;}
 async launch(key,effort,toolContext){
  this.choose(key);const selected=this.selection,identity=this.profiles.identity(selected.profile.id),credential=selected.credential;this.boundCredentials.set(identity,credential.apiKey);
  const capabilities=selected.model.reasoningEfforts,levels=capabilities&&Object.keys(capabilities)||[];
  if(effort&&(!levels.length||!levels.includes(effort))&&!this.modelInfos?.find(v=>v.id===selected.model.id)?.reasoning?.efforts?.some(v=>v.id===effort))throw Error('此模型不支持所选推理等级');
  effort=effort||levels.find(v=>v==='off')||levels[0];
  let worker=this.getWorker();if(worker&&toolContext)worker={...worker,context:{...worker.context,taskId:toolContext.mode==='workflow'?toolContext.taskId:null,projectId:toolContext.mode==='workflow'?toolContext.projectId:null}};
  const contextKey=createHash('sha256').update(JSON.stringify([selected.key,effort,identity,worker?.url,worker?.tokens?.mcp,worker?.context,this.instructions])).digest('hex');
  if(this.process&&this.contextKey===contextKey)return this.info;if(this.activeTurns.size)throw Error('请先停止当前回复再切换模型');
  if(this.unconfirmedTurns.size)throw Error('上一轮回复的结果仍待核对。请等待原回执，或明确断开并重连服务。');
  if(this.process||this.pending.size||this.isolationWaiter)this.stop({notify:false,preserveStart:true});
  const generation=this.lifecycle,runtime=this.host.resolve({executable:this.executable}),profile=prepareApiDshProfile(this.root,runtime,worker,this.instructions,{profile:credential,provider:this.provider});
  let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;}),waiter={resolve:readyResolve,reject:readyReject};this.isolationWaiter=waiter;
  const child=this.host.spawn(runtime.file,[...runtime.args,...profile.args],{cwd:profile.cwd,env:profile.env});this.process=child;this.contextKey=contextKey;this.loaded.clear();
  child.stdin?.on('error',()=>{if(this.process===child)this.stop({reason:'transport_error'});});child.stderr.on('data',()=>this.emit('diagnostic','DSH API adapter diagnostic (private contents withheld)'));child.on('error',()=>{if(this.process===child)this.stop({reason:'transport_error'});});child.on('exit',()=>{if(this.process===child)this.stop({reason:'transport_closed'});});
  this.framer=createJsonlFramer({maxBytes:4*1024*1024,onFrame:line=>{if(this.process===child)try{this.receive(JSON.parse(line));}catch{this.emit('diagnostic','Invalid DSH protocol frame (private contents withheld)');this.stop({reason:'malformed_protocol'});}},onOversize:()=>this.stop({reason:'oversized_frame'})});child.stdout.on('data',chunk=>{if(this.process===child)this.framer.feed(chunk);});
  const timer=setTimeout(()=>readyReject(Error('模型运行组件隔离检查超时')),30000);
  try{const [info,isolation]=await Promise.all([this.raw('initialize',{cwd:profile.cwd,provider:profile.route,model:selected.model.id,...effort?{reasoningEffort:effort}:{},maxTokens:Math.min(selected.model.maxTokens||8192,32768),approvalRequests:true}),ready]);
   if(info?.serverInfo?.name!=='deepseek-harness-sdk-runtime'||generation!==this.lifecycle||this.process!==child||isolation?.status!=='verified'||this.profiles.identity(selected.profile.id)!==identity)throw Error('服务商配置已变化或模型隔离检查失败');
   this.modelInfos=isolation.models||[];this.launchIdentity=identity;this.launchProfileId=selected.profile.id;this.effort=effort;this.info={transport:'dsh-sdk-jsonl',agentInfo:{name:'DeepSeek Harness · API',version:runtime.version},studioIsolation:isolation};return this.info;
  }catch(error){if(this.process===child)this.stop({notify:false});throw Error(this.cleanValue(error.message));}finally{clearTimeout(timer);if(this.isolationWaiter===waiter)this.isolationWaiter=null;}
 }
 receive(message){if(message?.method==='studio/dshIsolation'&&message.params?.status==='failed'){this.isolationWaiter?.reject(Error(message.params.message||'模型运行组件隔离检查失败'));return;}return super.receive(message);}
 save(session){this.catalog.put(KIND,session.id,this.cleanProtocol(session));}
 publicThread(session){return {...super.publicThread(session),provider:this.provider};}
 session(id){
  if(typeof id!=='string'||!id||id.length>200||/[\x00-\x1f]/.test(id))throw Error('Invalid API conversation');
  let session=this.sessions.get(id);if(session){this.assertBinding(session);return session;}
  session=this.catalog.get(KIND,id);if(session){if(session.id!==id||session.schemaVersion!==1||session.harness!=='dsh'||session.provider!==this.provider)throw Error('Unsupported API conversation record');this.assertBinding(session);return this.restoreSession(session);}
  if(this.provider!=='compatible')throw Error('旧 Qwen CLI 会话不能在 API 模式恢复；请新建 API 对话，原会话数据和计算记录保留');
  const binding=this.catalog.get('compatible-codex-thread',id),legacy=binding||this.catalog.get('compatible-history',id);if(!legacy)throw Error('Unknown API conversation');
  const profile=this.profiles.list(this.provider).find(p=>p.baseUrl===legacy.apiEndpoint&&p.api==='openai-completions'&&p.models.some(v=>v.id===legacy.model));if(!profile)throw Error('请恢复旧对话的原 API 地址；不会将历史发送到新服务');
  const turns=binding?[...(binding.legacyTurns||[]),...(binding.nativeTurns||[])]:legacy.turns||[];
  session={schemaVersion:1,harness:'dsh',provider:this.provider,id,nativeId:randomUUID(),nativeStarted:false,legacyContextPending:true,name:legacy.name||'',model:apiModelKey(profile.id,legacy.model),profileId:profile.id,apiEndpoint:profile.baseUrl,apiProtocol:profile.api,turns:structuredClone(turns),updatedAt:legacy.updatedAt||Date.now()};return this.restoreSession(session);
 }
 assertBinding(session){const profile=this.profiles.read(session.profileId);if(profile.provider!==this.provider||profile.baseUrl!==session.apiEndpoint||profile.api!==session.apiProtocol||(profile.authMode||'api-key')!==(session.authMode||'api-key'))throw Error('此对话绑定的 API 地址或协议已变化；请恢复原配置或新建对话，不会发送旧历史');}
 prepareTurnModel(params){
  const session=this.session(params.threadId),selected=this.profiles.resolve(this.provider,params.model||session.model);
  if(selected.profile.id!==session.profileId)throw Error('不能在现有对话中切换 API 服务商；请新建对话，防止历史被发送到其他服务');
  this.choose(selected.key);const identity=this.profiles.identity(selected.profile.id);
  return ()=>{this.assertBinding(session);if(this.model!==selected.key||this.profiles.identity(selected.profile.id)!==identity)throw Error('服务商或模型配置已变化，请重新发送；本次内容未发送');};
 }
 async request(method,params={},timeout,options={}){
  options.assertCurrent?.();if(method==='model/list')return this.modelCatalog();if(method==='model/select'){if(this.activeTurns.size)throw Error('请先停止当前回复再切换模型');this.choose(params.model);return this.modelCatalog();}
  if(method==='thread/start'){
   this.choose(params.model);const selected=this.selection,effort=this.modelCatalog().data.find(v=>v.model===this.model)?.defaultReasoningEffort;
   const session={schemaVersion:1,harness:'dsh',provider:this.provider,id:randomUUID(),nativeId:randomUUID(),nativeStarted:false,legacyContextPending:false,name:'',model:this.model,effort,profileId:selected.profile.id,apiEndpoint:selected.profile.baseUrl,apiProtocol:selected.profile.api,...selected.profile.authMode?{authMode:selected.profile.authMode}:{},turns:[],updatedAt:Date.now()};this.sessions.set(session.id,session);this.current=session.id;this.save(session);const thread=this.publicThread(session);this.event('thread/started',{thread});return {thread,model:this.model,reasoningEffort:effort};
  }
  if(['thread/resume','turn/start'].includes(method)){
   const session=this.session(params.threadId),selected=this.profiles.resolve(this.provider,params.model||session.model);
   if(selected.profile.id!==session.profileId)throw Error('不能在现有对话中切换 API 服务商；请新建对话，防止历史被发送到其他服务');
   if(method==='turn/start'&&this.process&&this.launchIdentity&&selected.profile.id===this.launchProfileId&&this.profiles.identity(selected.profile.id)!==this.launchIdentity)throw Error('服务商配置已变化，请重新连接后继续；不会自动发送历史');
   const row=this.modelCatalog().data.find(v=>v.model===selected.key),effort=params.effort??(session.model===selected.key?session.effort:row?.defaultReasoningEffort);
   if(effort&&!row?.supportedReasoningEfforts.some(v=>v.reasoningEffort===effort))throw Error('此模型不支持所选推理等级');
   if(selected.key!==session.model)session.effort=effort;
   params={...params,model:selected.key,effort};
  }
  return super.request(method,params,timeout,options);
 }
}
