import {EventEmitter} from 'node:events';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {spawnCli,CLI_VERSIONS,redact} from './providers.mjs';
const safeTool=/^(?:mcp__)?gpusampling(?:__|[.:/])([a-z_]+)$/;
export function toolName(value){const match=String(value||'').match(safeTool);return match?match[1]:String(value||'');}
export function toolResult(update){
 const texts=[];let artifact;
 const visit=(value,depth=0)=>{
  if(depth>8||value==null)return;
  if(typeof value==='string'){try{visit(JSON.parse(value),depth+1);}catch{texts.push(value);}return;}
  if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return;}
  if(typeof value==='object'){
   if(value.id&&value.engine)artifact=value;
   if(value.type==='text'&&typeof value.text==='string')visit(value.text,depth+1);
   else for(const key of ['content','structuredContent','output','result','return_value','data','text'])if(key in value)visit(value[key],depth+1);
  }
 };
 visit(update.rawOutput);visit(update.content);
 if(artifact)return {content:[{type:'text',text:JSON.stringify(artifact)}]};
 return {content:[{type:'text',text:texts.join('\n')||JSON.stringify(update.rawOutput??update.content??update.status)}]};
}
function optionsOf(option){return (option?.options||[]).flatMap(value=>Array.isArray(value.options)?value.options:[value]);}
export class AcpBridge extends EventEmitter{
 constructor(provider){super();this.provider=provider;this.pending=new Map();this.interactions=new Map();this.sessions=new Map();this.next=1;this.activeTurns=new Map();}
 event(method,params,id){this.emit('event',{method,params:{...params,provider:this.provider},provider:this.provider,...id!==undefined?{id}: {}});}
 async start(executable,profile,worker){
  if(this.process)return this.info;
  const version=await new Promise((resolve,reject)=>{
   const probe=spawnCli(executable,['--version'],{env:profile.env});let output='';
   const timer=setTimeout(()=>{probe.kill();reject(Error('CLI version probe timed out'));},15000);
   probe.stdout.on('data',data=>output+=data.toString());probe.on('error',error=>{clearTimeout(timer);reject(error);});
   probe.on('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error('CLI version probe failed'));else resolve(output.trim().split(/\s+/).at(-1));});
  });
  if(version!==CLI_VERSIONS[this.provider])throw Error(this.provider+' CLI version mismatch: expected '+CLI_VERSIONS[this.provider]+', got '+version);
  this.executable=executable;this.profile=profile;this.worker=worker;
  const child=spawnCli(executable,profile.args,{cwd:profile.cwd,env:profile.env});this.process=child;
  const secrets=[profile.env.OPENAI_API_KEY,worker?.tokens?.mcp];
  child.stderr.on('data',data=>{if(this.process===child)this.emit('diagnostic',redact(data.toString().slice(-4000),secrets));});
  child.on('error',error=>{if(this.process===child)this.disconnect(error);});
  child.on('exit',(code,signal)=>{if(this.process===child)this.disconnect(Error(this.provider+' disconnected ('+(signal||code)+')'));});
  this.reader=createInterface({input:child.stdout});
  this.reader.on('line',line=>{if(this.process!==child)return;try{this.receive(JSON.parse(line));}catch(error){this.disconnect(Error('Malformed '+this.provider+' ACP JSONL'));}});
  try{
   this.info=await this.raw('initialize',{protocolVersion:1,clientInfo:{name:'gpu-sampling-studio',version:'0.9.0'},clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false,elicitation:{form:{}},session:{configOptions:{boolean:{}}}}},30000);
   if(this.info.protocolVersion!==1)throw Error('Unsupported ACP protocol version');
   const version=this.info.agentInfo?.version;
   // Kimi advertises product version; Qwen may advertise a separate kernel version.
   if(this.provider==='kimi'&&version&&version!==CLI_VERSIONS.kimi)throw Error('Kimi CLI version mismatch: expected '+CLI_VERSIONS.kimi+', got '+version);
   return this.info;
  }catch(error){this.close();throw error;}
 }
 send(value){if(!this.process||this.process.stdin.destroyed)throw Error('Connect '+this.provider+' first');this.process.stdin.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');}
 raw(method,params={},timeout=120000){
  const id=this.next++;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(method+' timed out'));},timeout);
   this.pending.set(id,{resolve,reject,timer});
   try{this.send({id,method,params});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
  });
 }
 notify(method,params){this.send({method,params});}
 receive(message){
  if(message.method){
   if(message.id!==undefined){this.serverRequest(message);return;}
   if(message.method==='session/update')this.update(message.params);
   return;
  }
  const pending=this.pending.get(message.id);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(message.id);
  if(message.error){const error=Error(message.error.message||'ACP request failed');error.code=message.error.code;error.data=message.error.data;pending.reject(error);}else pending.resolve(message.result??{});
 }
 serverRequest(message){
  const {method,params:p={},id}=message;
  if(method==='session/request_permission'){
   const call=p.toolCall||{},name=call._meta?.toolName||call._meta?.claudeCode?.toolName||call.title;
   const science=safeTool.test(String(name||''))||call._meta?.serverId==='gpusampling';
   const option=(p.options||[]).find(o=>o.kind==='allow_once');
   if(science&&option&&call.kind!=='execute'){
    this.send({id,result:{outcome:{outcome:'selected',optionId:option.optionId}}});return;
   }
   // A question is the only non-MCP permission that can be shown to the user.
   if(/ask.?user.?question/i.test(String(name||''))&&call.kind!=='execute'){
    this.interactions.set(String(id),message);
    this.event('studio/question',{threadId:p.sessionId,message:call.title,questionOptions:p.options||[],rawInput:call.rawInput},id);return;
   }
   this.send({id,result:{outcome:{outcome:'cancelled'}}});
   this.event('studio/policyDenied',{threadId:p.sessionId,message:'Scientific jobs require task-page review; built-in file and shell tools are disabled.'});return;
  }
  if(method==='elicitation/create'&&(!p.mode||p.mode==='form')){
   this.interactions.set(String(id),message);
   this.event('mcpServer/elicitation/request',{threadId:p.sessionId,message:p.message,requestedSchema:p.requestedSchema},id);return;
  }
  this.send({id,error:{code:-32601,message:'Studio does not expose filesystem, terminal, or arbitrary client actions'}});
 }
 respond(id,result){
  const key=String(id),request=this.interactions.get(key);if(!request)throw Error('Request already resolved');
  if(request.method==='session/request_permission'){
   const option=request.params.options?.find(o=>o.optionId===result.optionId);
   this.send({id:request.id,result:{outcome:option?{outcome:'selected',optionId:option.optionId}:{outcome:'cancelled'}}});
  }else{
   if(!['accept','decline','cancel'].includes(result.action))throw Error('Invalid elicitation response');
   this.send({id:request.id,result:{action:result.action,...result.action==='accept'?{content:result.content}:{}}});
  }
  this.interactions.delete(key);this.event('serverRequest/resolved',{requestId:id});
 }
 session(id){const session=this.sessions.get(id);if(!session)throw Error('Load this provider session first');return session;}
 update({sessionId,update:u}={}){
  if(!u||!sessionId)return;
  let session=this.sessions.get(sessionId);
  if(!session){session={id:sessionId,turns:[],tools:new Map(),configOptions:[],models:{}};this.sessions.set(sessionId,session);}
  const threadId=sessionId,type=u.sessionUpdate;
  if(type==='agent_message_chunk'||type==='user_message_chunk'){
   if(u.content?.type!=='text')return;
   const role=type==='agent_message_chunk'?'agentMessage':'userMessage',turn=session.current||{id:'history',items:[]};
   if(!session.current){session.current=turn;session.turns.push(turn);}
   const last=turn.items.at(-1),itemId=u.messageId||((last?.type===role)?last.id:randomUUID());
   let item=turn.items.find(v=>v.id===itemId);
   if(!item){item={id:itemId,type:role,text:'',content:[]};turn.items.push(item);}
   item.text+=u.content.text;
   if(role==='userMessage')item.content=[{type:'text',text:item.text}];
   if(!session.replaying&&role==='agentMessage')this.event('item/agentMessage/delta',{threadId,itemId,delta:u.content.text});
  }
  if(type==='tool_call'||type==='tool_call_update'){
   const previous=session.tools.get(u.toolCallId),merged={...previous,...u};
   if(!previous){
    const name=toolName(u._meta?.toolName||u._meta?.claudeCode?.toolName||u.title);
    merged.name=name;session.tools.set(u.toolCallId,merged);
    if(!session.replaying)this.event('item/started',{threadId,item:{id:u.toolCallId,type:'mcpToolCall',tool:name}});
   }else{merged.name=previous.name;session.tools.set(u.toolCallId,merged);}
   if(['completed','failed'].includes(u.status)&&!previous?.finished){
    merged.finished=true;
    if(!session.replaying)this.event('item/completed',{threadId,item:{id:u.toolCallId,type:'mcpToolCall',tool:merged.name,status:u.status,result:toolResult(merged)}});
   }
  }
  if(type==='config_option_update'){session.configOptions=u.configOptions||[];this.event('studio/configUpdated',{threadId});}
  if(type==='current_model_update'){session.models.currentModelId=u.currentModelId;this.event('studio/configUpdated',{threadId});}
  if(type==='usage_update'){
   const used=u.used??u.contextTokens,total=u.size??u.maxContextTokens;
   if(Number.isFinite(used)||Number.isFinite(total))this.event('thread/tokenUsage/updated',{threadId,tokenUsage:{last:Number.isFinite(used)?{totalTokens:used}:null,modelContextWindow:Number.isFinite(total)?total:null}});
  }
  if(type==='session_info_update'&&u.title){session.name=u.title;this.event('studio/sessionInfo',{thread: this.thread(session)});}
 }
 mcpServers(){if(!this.worker)return [];if(!this.info.agentCapabilities?.mcpCapabilities?.http)throw Error('This CLI does not support the worker HTTP MCP transport');return [{type:'http',name:'gpusampling',url:this.worker.url+'/mcp',headers:[{name:'Authorization',value:'Bearer '+this.worker.tokens.mcp}]}];}
 thread(session){return {id:session.id,provider:this.provider,cwd:this.profile.cwd,name:session.name,preview:session.turns.flatMap(t=>t.items).find(i=>i.type==='userMessage')?.text?.slice(0,80)||'',turns:session.turns};}
 async waitMcp(session){
  if(this.provider!=='qwen'||!this.worker)return;
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
   const state=await this.raw('qwen/status/session/resources',{sessionId:session.id},10000);
   const mcp=state.mcp,server=mcp?.servers?.find(s=>s.name==='gpusampling');
   if(mcp?.discoveryState==='completed'){
    if(server?.mcpStatus!=='connected'||server.disabled)throw Error('Qwen could not connect to the scientific MCP service; no turn was started');
    return;
   }
   await new Promise(resolve=>setTimeout(resolve,150));
  }
  throw Error('Qwen scientific MCP discovery timed out; no turn was started');
 }
 async create(){
  const result=await this.raw('session/new',{cwd:this.profile.cwd,mcpServers:this.mcpServers()});
  const session=this.sessions.get(result.sessionId)||{id:result.sessionId,turns:[],tools:new Map()};
  Object.assign(session,{configOptions:result.configOptions||[],models:result.models||{},modes:result.modes});this.sessions.set(session.id,session);await this.waitMcp(session);this.current=session.id;
  this.event('thread/started',{thread:this.thread(session)});return session;
 }
 async ensure(){return this.current?this.session(this.current):this.create();}
 catalog(session){
  const option=session.configOptions?.find(o=>o.category==='model'||o.id==='model'),thought=session.configOptions?.find(o=>o.category==='thought_level');
  const values=optionsOf(option),fallback=session.models?.availableModels||[],current=option?.currentValue||session.models?.currentModelId;
  return {data:(values.length?values.map(v=>({id:v.value,model:v.value,displayName:v.name})):fallback.map(v=>({id:v.modelId,model:v.modelId,displayName:v.name}))).map(model=>({...model,isDefault:model.model===current,supportedReasoningEfforts:model.model===current?optionsOf(thought).map(o=>({reasoningEffort:o.value,description:o.name})):[],defaultReasoningEffort:model.model===current?thought?.currentValue:undefined}))};
 }
 async setChoice(session,category,value){
  if(!value)return;
  const option=session.configOptions?.find(o=>o.category===category||(category==='model'&&o.id==='model'));
  if(option&&optionsOf(option).some(o=>o.value===value)){
   if(option.currentValue===value)return;
   const result=await this.raw('session/set_config_option',{sessionId:session.id,configId:option.id,value});
   if(result.configOptions)session.configOptions=result.configOptions;
   return;
  }
  if(category==='model'&&session.models?.availableModels?.some(m=>m.modelId===value)){
   await this.raw('session/set_model',{sessionId:session.id,modelId:value});session.models.currentModelId=value;return;
  }
  throw Error('This provider/model does not support the selected '+category);
 }
 async request(method,params={}){
  if(method==='account/read')return {provider:this.provider,requiresOpenaiAuth:false,authMethods:this.info.authMethods||[],account:null};
  if(method==='model/list'){
   try{return this.catalog(await this.ensure());}catch(error){if(error.code===-32000)return {data:[],authRequired:true,message:error.message};throw error;}
  }
  if(method==='model/select'){const s=await this.ensure();await this.setChoice(s,'model',params.model);return this.catalog(s);}
  if(method==='thread/list')return {data:[...this.sessions.values()].map(s=>this.thread(s))};
  if(method==='thread/start'){
   const s=this.current&&this.session(this.current).turns.length===0?this.session(this.current):await this.create();
   await this.setChoice(s,'model',params.model);this.current=s.id;
   return {thread:this.thread(s),model:this.catalog(s).data.find(m=>m.isDefault)?.model,reasoningEffort:s.configOptions?.find(o=>o.category==='thought_level')?.currentValue};
  }
  if(method==='thread/resume'){
   if(!this.info.agentCapabilities?.loadSession)throw Error('Session restoration is unsupported by this CLI');
   const s={id:params.threadId,turns:[],tools:new Map(),configOptions:[],models:{},replaying:true};this.sessions.set(s.id,s);
   try{const result=await this.raw('session/load',{sessionId:s.id,cwd:this.profile.cwd,mcpServers:this.mcpServers()});Object.assign(s,{configOptions:result.configOptions||[],models:result.models||{},replaying:false,current:null});await this.waitMcp(s);this.current=s.id;await this.setChoice(s,'model',params.model);return {thread:this.thread(s),model:this.catalog(s).data.find(m=>m.isDefault)?.model,reasoningEffort:s.configOptions?.find(o=>o.category==='thought_level')?.currentValue};}catch(error){this.sessions.delete(s.id);throw error;}
  }
  if(method==='thread/read')return {thread:this.thread(this.session(params.threadId))};
  if(method==='turn/interrupt'){this.notify('session/cancel',{sessionId:params.threadId});return {};}
  if(method==='turn/start'){
   const s=this.session(params.threadId);if(this.activeTurns.has(s.id))throw Error('A turn is already active');
   await this.setChoice(s,'model',params.model);await this.setChoice(s,'thought_level',params.effort);
   const id=randomUUID(),turn={id,items:[]};s.current=turn;s.turns.push(turn);
   const prompt=(params.input||[]).filter(i=>i.type==='text').map(i=>({type:'text',text:i.text}));
   turn.items.push({id:randomUUID(),type:'userMessage',content:prompt,text:prompt.map(c=>c.text).join('\n')});
   this.activeTurns.set(s.id,id);this.event('turn/started',{threadId:s.id,turn:{id}});
   this.raw('session/prompt',{sessionId:s.id,prompt},30*60*1000).then(result=>{
    this.event('turn/completed',{threadId:s.id,turn:{id,status:result.stopReason==='cancelled'?'cancelled':'completed',stopReason:result.stopReason,modelOutputReceived:turn.items.some(item=>item.type==='agentMessage'&&item.text.trim())}});
   }).catch(error=>this.event('turn/completed',{threadId:s.id,turn:{id,status:'failed',error:{message:error.message}}})).finally(()=>{this.activeTurns.delete(s.id);s.current=null;});
   return {turn:{id,status:'inProgress'}};
  }
  throw Error('Unsupported '+this.provider+' operation: '+method);
 }
 disconnect(error){
  for(const value of this.pending.values()){clearTimeout(value.timer);value.reject(error);}this.pending.clear();this.interactions.clear();
  const child=this.process;this.process=null;this.reader?.close();child?.kill();
  this.event('studio/codexDisconnected',{reason:error.message});this.activeTurns.clear();
 }
 close(){this.disconnect(Error(this.provider+' bridge closed'));this.current=null;this.sessions.clear();}
}
