import {sharedTerminalToolAllowed} from '../tools/definition-scope.mjs';
import {ACCOUNT_GUIDANCE} from '../../shared/provider-account.mjs';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {redact} from './contracts.mjs';
import {STUDIO_INSTRUCTIONS} from '../context/agent-settings.mjs';
export const DEEPSEEK_URL='https://api.deepseek.com';
const READ_TOOLS=new Set(['compute_readiness','discover_local_environments','read_project_input','read_pygas_workflow','read_custom_cv','scientific_skill_catalog','read_scientific_skill','diagnose_tools','suggest_parameters','search_materials_project','list_source_projects','inspect_source_project','inspect_pygas_catalog','inspect_environment_api','collect_cluster_artifacts','read_cluster_input','read_cluster_result','read_cluster_skill','cluster_browse','list_clusters','probe_cluster','cluster_run_status','cluster_read_log','list_workflows','list_projects','list_environments','list_runs','probe_environment','read_runtime_guide','run_status','read_log','collect_artifacts','inspect_asset','read_run_input','read_artifact']);
const DRAFT_TOOLS=new Set(['draft_local_environment','propose_custom_cv','import_materials_project','create_structure','render_pygas_workflow','present_task','draft_cluster_setup','prepare_cluster_run','create_workflow','prepare_run','resume_run','write_project_input']);
export function deepseekCredentials(value){
 if(typeof value.apiKey!=='string'||!/^sk-[A-Za-z0-9_-]{8,250}$/.test(value.apiKey))throw Error('Enter a valid DeepSeek API key');
 return {apiKey:value.apiKey,baseUrl:DEEPSEEK_URL};
}
// Parse real SSE events, including split UTF-8, CRLF and multiple data lines.
export async function* sseEvents(body){
 const decoder=new TextDecoder();let buffer='';
 for await(const bytes of body){
  buffer+=typeof bytes==='string'?bytes:decoder.decode(bytes,{stream:true});
  if(buffer.length>4*1024*1024)throw Error('DeepSeek stream event exceeds the size limit');
  let match;while((match=/\r?\n\r?\n/.exec(buffer))){const block=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const data=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(data)yield data;}
 }
 buffer+=decoder.decode();if(buffer.trim())throw Error('DeepSeek stream ended inside an event');
}
function checkValue(value,schema,path='arguments',depth=0){
 if(depth>24)throw Error('Tool arguments are too deeply nested');
 if(schema.oneOf||schema.anyOf){const variants=schema.oneOf||schema.anyOf;const matching=variants.filter(s=>s.type===(Array.isArray(value)?'array':value===null?'null':typeof value));const errors=[];if(!variants.some(s=>{try{checkValue(value,s,path,depth+1);return true;}catch(error){if(matching.includes(s))errors.push(error.message);return false;}}))throw Error(errors[0]||'Invalid '+path+'; expected '+variants.map(s=>s.type).join(' or '));return;}
 const types=Array.isArray(schema.type)?schema.type:[schema.type];
 if(schema.type&&!types.some(type=>type==='null'?value===null:type==='array'?Array.isArray(value):type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):type==='integer'?Number.isSafeInteger(value):typeof value===type))throw Error('Invalid '+path+' type');
 if(schema.enum&&!schema.enum.some(v=>JSON.stringify(v)===JSON.stringify(value)))throw Error('Invalid '+path+' option');
 if(typeof value==='number'&&(!Number.isFinite(value)||schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum))throw Error('Invalid '+path+' range');
 if(Array.isArray(value)&&schema.items)for(const [index,item]of value.entries())checkValue(item,schema.items,path+'['+index+']',depth+1);
 if(value&&typeof value==='object'&&!Array.isArray(value)){
  for(const key of schema.required||[])if(!Object.hasOwn(value,key))throw Error('Missing '+path+'.'+key);
  for(const [key,item] of Object.entries(value)){
   if(['__proto__','prototype','constructor'].includes(key))throw Error('Unsafe tool argument');
   if(schema.properties?.[key])checkValue(item,schema.properties[key],path+'.'+key,depth+1);
   else if(schema.additionalProperties===false)throw Error('Unknown '+path+'.'+key);
   else if(typeof schema.additionalProperties==='object')checkValue(item,schema.additionalProperties,path+'.'+key,depth+1);
  }
 }
}
export function providerToolSchema(tool){const schema=structuredClone(tool.inputSchema);if(tool.name==='present_task'){const items=schema.properties?.steps?.items;if(items?.anyOf){const object=items.anyOf.find(v=>v.type==='object');if(object)schema.properties.steps.items=object;}}return schema;}
function formatCorrection(error,tool){if(tool!=='present_task'||!/^(Invalid|Missing|Unknown) arguments/.test(error.message))return null;return {status:'blocked',code:'invalid_input',automatic_retry:false,message:error.message,instruction:'This is a workflow formatting error, not authentication. Correct the SAME task_id. steps must contain objects {id,title,fields}; fields must contain {key,label,type,required}. Use file/files for input paths. Keep scientific values and missing_fields unchanged unless you have evidence. Retry present_task in this turn; do not create another workflow or execute anything.',example:{steps:[{id:'md',title:'分子动力学',fields:[{key:'temperature',label:'温度',type:'number',required:true,unit:'K'}]}]}};}
export class DeepSeekBridge extends EventEmitter{
 constructor({provider='deepseek',catalog,credential,worker,fetchApi=fetch,fetchMcp=fetch}){super();Object.assign(this,{provider,catalog,getCredential:credential,getWorker:worker,fetchApi,fetchMcp});this.activeTurns=new Map();this.sessions=new Map();this.models=[];this.current=null;}
 event(method,params){this.emit('event',{provider:this.provider,method,params});}
 secrets(){const w=this.getWorker();return [this.getCredential()?.apiKey,w?.tokens?.mcp,w?.tokens?.admin];}
 clean(value){return redact(String(value),this.secrets());}
 async api(route,options={},signal=AbortSignal.timeout(20000)){
  const credential=this.getCredential();if(!credential)throw Error(ACCOUNT_GUIDANCE);
  let response;try{response=await this.fetchApi((this.provider==='deepseek'?DEEPSEEK_URL:credential.baseUrl)+route,{...options,redirect:'error',headers:{...credential.apiKey?{Authorization:'Bearer '+credential.apiKey}:{},'Content-Type':'application/json'},signal});}catch(error){throw Error(this.clean(error.message));}
  if(!response.ok){const labels={401:'API Key 无效或已失效',402:'账户余额不足',403:'账户无权使用此服务',429:'请求过于频繁，请稍后重试',500:'服务暂时出错',503:'服务繁忙'};throw Error('DeepSeek HTTP '+response.status+' · '+(labels[response.status]||'请求失败，请检查模型、参数与账户权限'));}
  return response;
 }
 async start(){this.process={transport:'deepseek-api'};return {transport:'https-sse',agentInfo:{name:this.provider==='deepseek'?'DeepSeek API':'OpenAI 兼容 API'},authRequired:!this.getCredential()};}
 async modelList(){
  if(!this.getCredential())return {data:[],authRequired:true};
  if(this.provider==='compatible'&&this.getCredential().model){this.models=[this.getCredential().model];this.model=this.models[0];return this.modelCatalog();}
  const response=await this.api('/models'),body=await response.json();
  const ids=[...new Set((body.data||[]).map(m=>m.id).filter(id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(id)))];
  if(!ids.length)throw Error('DeepSeek 没有返回可用模型目录');
  this.models=ids;this.model=ids.includes(this.model)?this.model:ids.includes('deepseek-flash')?'deepseek-flash':ids[0];
  return this.modelCatalog();
 }
 modelCatalog(){return {data:this.models.map(model=>({id:model,model,displayName:model,isDefault:model===this.model,supportedReasoningEfforts:this.provider==='compatible'&&this.getCredential()?.reasoningMode==='reasoning_effort'?[{reasoningEffort:this.getCredential().reasoningEffort,description:'自定义'}]:(this.provider==='deepseek'&&/^deepseek-(flash|v4-pro)$/.test(model))?['none','low','high','max'].map(e=>({reasoningEffort:e,description:e==='none'?'快速 · 关闭思考':e})):[],defaultReasoningEffort:this.provider==='compatible'&&this.getCredential()?.reasoningMode==='reasoning_effort'?this.getCredential().reasoningEffort:(this.provider==='deepseek'&&/^deepseek-(flash|v4-pro)$/.test(model))?'none':undefined}))};}
 choose(model){if(model&&!this.models.includes(model))throw Error('Select a model from the authenticated DeepSeek catalog');if(model)this.model=model;if(!this.model)throw Error('Load the DeepSeek model catalog first');return this.model;}
 save(s){this.catalog.put(this.provider+'-history',s.id,s);}
 publicThread(s){return {id:s.id,provider:this.provider,name:s.name,preview:s.name||'',turns:s.turns,updatedAt:s.updatedAt};}
 session(id){
  if(typeof id!=='string'||!id||id.length>200)throw Error('Invalid DeepSeek conversation');
  let s=this.sessions.get(id);if(s)return s;s=this.catalog.get(this.provider+'-history',id);if(!s)throw Error('Unknown DeepSeek conversation');
  // An interrupted request is never replayed. Fill only missing protocol receipts.
  const pending=new Set();for(const m of s.messages){if(m.role==='assistant')for(const call of m.tool_calls||[])pending.add(call.id);if(m.role==='tool')pending.delete(m.tool_call_id);}
  for(const tool_call_id of pending)s.messages.push({role:'tool',tool_call_id,content:JSON.stringify({isError:true,error:'Previous connection ended before a confirmed result. Inspect existing drafts/status; do not repeat an unknown operation.'})});
  for(const turn of s.turns)if(turn.status==='inProgress'){turn.status='failed';turn.error={message:'Previous reply was interrupted; it was not automatically replayed.'};for(const item of turn.items)if(item.type==='mcpToolCall'&&item.status==='inProgress'){item.status='failed';item.result={isError:true,content:[{type:'text',text:'Tool result unconfirmed after connection loss; inspect current state.'}]};}}
  this.sessions.set(id,s);this.save(s);return s;
 }
 assertEndpoint(s){if(!this.getCredential())throw Error(ACCOUNT_GUIDANCE);const endpoint=this.provider==='deepseek'?DEEPSEEK_URL:this.getCredential()?.baseUrl;if(s.apiEndpoint&&s.apiEndpoint!==endpoint||this.provider==='compatible'&&!s.apiEndpoint)throw Error('此对话绑定的 API 地址与当前配置不同。请恢复原地址或新建对话；不会将旧记录发送到新服务。');}
 async mcp(method,params={},signal=AbortSignal.timeout(30000)){
  const w=this.getWorker();if(!w)throw Error('科学工具服务未连接');
  const response=await this.fetchMcp(w.url+'/mcp',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+w.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method,params}),signal});
  if(!response.ok)throw Error('科学工具请求失败 · HTTP '+response.status);
  const body=await response.json();if(body.error)throw Error(this.clean(body.error.message||'Scientific MCP error'));return body.result;
 }
 async tools(mode='chat'){
  if(!this.getWorker())return [];
  const result=await this.mcp('tools/list');return (result.tools||[]).filter(t=>sharedTerminalToolAllowed(t.name)||READ_TOOLS.has(t.name)||['draft_local_environment','draft_cluster_setup'].includes(t.name)||mode==='workflow'&&DRAFT_TOOLS.has(t.name));
 }
 async request(method,params={}){
  if(!this.process)throw Error('Connect DeepSeek first');
  if(method==='model/list')return this.modelList();
  if(method==='model/select'){this.choose(params.model);return this.modelCatalog();}
  if(method==='thread/start'){
   const model=this.choose(params.model),s={id:randomUUID(),name:'',model,effort:'none',apiEndpoint:this.provider==='deepseek'?DEEPSEEK_URL:this.getCredential()?.baseUrl,messages:[],turns:[],updatedAt:Date.now()};this.sessions.set(s.id,s);this.current=s.id;this.save(s);const thread=this.publicThread(s);this.event('thread/started',{thread});return {thread,model,reasoningEffort:s.effort};
  }
  if(method==='thread/resume'){const s=this.session(params.threadId);if(!this.models.length)await this.modelList();this.choose(params.model||s.model);this.current=s.id;return {thread:this.publicThread(s),model:this.model,reasoningEffort:s.effort};}
  if(method==='thread/read')return {thread:this.publicThread(this.session(params.threadId))};
  if(method==='turn/interrupt'){const active=this.activeTurns.get(params.threadId);if(active&&params.turnId&&active.id!==params.turnId)throw Error('Turn no longer active');active?.controller.abort();return {};}
  if(method==='turn/start'){
   if(this.provider==='compatible')this.assertEndpoint(this.session(params.threadId));
   if(this.activeTurns.size)throw Error('A DeepSeek reply is already active');
   const s=this.session(params.threadId),model=this.choose(params.model||s.model),known=(this.provider==='deepseek'&&/^deepseek-(flash|v4-pro)$/.test(model)),effort=params.effort||s.effort||'none';
   if(known&&!['none','low','high','max'].includes(effort)||this.provider==='deepseek'&&!known&&params.effort||this.provider==='compatible'&&params.effort&&params.effort!==this.getCredential()?.reasoningEffort)throw Error('Unsupported DeepSeek thinking effort');
   const input=params.input||[];if(!Array.isArray(input)||!input.length||input.some(i=>i.type!=='text'||typeof i.text!=='string')||JSON.stringify(input).length>1000000)throw Error('Invalid DeepSeek text input');
   const context=params.studioToolContext||{mode:'chat'};if(!['chat','workflow'].includes(context.mode)||context.mode==='workflow'&&!context.taskId)throw Error('Invalid scientific tool context');
   s.model=model;s.effort=effort;if(!s.name)s.name=input[0].text.slice(0,100);s.updatedAt=Date.now();
   const turn={id:randomUUID(),status:'inProgress',items:[{id:randomUUID(),type:'userMessage',content:input,text:input.map(i=>i.text).join('\n')}]};
   s.turns.push(turn);s.messages.push({role:'user',content:input.map(i=>i.text).join('\n')});this.save(s);
   const active={id:turn.id,controller:new AbortController()};this.activeTurns.set(s.id,active);this.event('turn/started',{threadId:s.id,turn:{id:turn.id}});
   // Return immediately; all actual network work is streamed via native Studio events.
   void this.run(s,turn,active,context,known).catch(error=>{turn.status=active.controller.signal.aborted?'cancelled':'failed';turn.error=turn.status==='failed'?{message:this.clean(error.message)}:undefined;}).finally(()=>{
    this.activeTurns.delete(s.id);s.updatedAt=Date.now();this.save(s);this.event('studio/sessionInfo',{thread:this.publicThread(s)});this.event('turn/completed',{threadId:s.id,turn:{id:turn.id,status:turn.status,error:turn.error,stopReason:turn.status==='completed'?'end_turn':turn.status,modelOutputReceived:turn.items.some(i=>i.type==='agentMessage'&&i.text.trim())}});
   });return {turn:{id:turn.id,status:'inProgress'}};
  }
  throw Error('Unsupported DeepSeek operation: '+method);
 }
 async run(s,turn,active,context,known){
  const signal=active.controller.signal;let tools;
  try{tools=await this.tools(context.mode);}catch(error){if(context.mode==='workflow')throw error;tools=[];}
  const inventory=new Map(tools.map(t=>[t.name,t]));
  const terminalOnly=tools.length>0&&tools.every(tool=>sharedTerminalToolAllowed(tool.name));
  if(context.mode==='workflow'&&!inventory.has('present_task')&&!terminalOnly)throw Error('科学工具缺少 present_task；请先修复工具连接');
  for(let round=0;round<24;round++){
   signal.throwIfAborted();const item={id:randomUUID(),type:'agentMessage',text:''};turn.items.push(item);
   const request={...this.provider==='compatible'&&this.getCredential()?.reasoningMode==='reasoning_effort'?{reasoning_effort:this.getCredential().reasoningEffort}:{},model:s.model,messages:[{role:'system',content:STUDIO_INSTRUCTIONS+(tools.length?'':' Scientific tools are currently unavailable. Answer in conversation, state this limitation when relevant, and do not claim any tool action.')},...s.messages.map(message=>this.provider==='compatible'?Object.fromEntries(Object.entries(message).filter(([key])=>key!=='reasoning_content')):message)],stream:true,...this.provider==='deepseek'?{stream_options:{include_usage:true}}:{},max_tokens:known&&s.effort!=='none'?32768:8192,...known?{thinking:{type:s.effort==='none'?'disabled':'enabled'},reasoning_effort:s.effort}:{},...tools.length?{tools:tools.map(t=>({type:'function',function:{name:t.name,description:t.description+(t.name==='present_task'?' Use object steps {id,title,fields:[{key,label,type,required}]}; file paths use file/files, numbers use number/integer. Update the same task_id.':''),parameters:providerToolSchema(t)}})),tool_choice:'auto'}:{}};
   // API and loopback transports deliberately use separate credentials and fetch functions.
   const response=await this.api('/chat/completions',{method:'POST',body:JSON.stringify(request)},AbortSignal.any([signal,AbortSignal.timeout(10*60*1000)]));
   let reasoning='',finish=null,done=false,size=0;const calls=new Map();
   for await(const data of sseEvents(response.body)){
    signal.throwIfAborted();if(data==='[DONE]'){done=true;break;}let chunk;try{chunk=JSON.parse(data);}catch{throw Error('Malformed DeepSeek stream JSON');}
    if(chunk.error)throw Error(this.clean(chunk.error.message||'DeepSeek stream error'));
    const choice=chunk.choices?.[0],delta=choice?.delta||{};
    if(typeof delta.content==='string'){item.text+=delta.content;this.event('item/agentMessage/delta',{threadId:s.id,itemId:item.id,delta:delta.content});}
    if(typeof delta.reasoning_content==='string')reasoning+=delta.reasoning_content;
    for(const tc of delta.tool_calls||[]){if(!Number.isSafeInteger(tc.index)||tc.index<0||tc.index>31)throw Error('Invalid DeepSeek tool index');const call=calls.get(tc.index)||{id:'',type:'function',function:{name:'',arguments:''}};if(tc.id)call.id=tc.id;if(tc.function?.name)call.function.name+=tc.function.name;if(tc.function?.arguments)call.function.arguments+=tc.function.arguments;calls.set(tc.index,call);}
    size+=data.length;if(size>16*1024*1024)throw Error('DeepSeek reply exceeds the size limit');
    if(choice?.finish_reason)finish=choice.finish_reason;
    if(chunk.usage)this.event('thread/tokenUsage/updated',{threadId:s.id,tokenUsage:{last:{totalTokens:chunk.usage.prompt_tokens},modelContextWindow:null}});
   }
   signal.throwIfAborted();if(!done||!finish)throw Error('DeepSeek stream disconnected before completion; no tool was executed');
   if(!['stop','tool_calls'].includes(finish))throw Error('DeepSeek reply stopped: '+finish+'; shorten the request or choose a suitable model');
   const ordered=[...calls.entries()].sort(([a],[b])=>a-b).map(([,c])=>c);
   if(finish==='tool_calls'&&!ordered.length||finish==='stop'&&ordered.length)throw Error('Inconsistent DeepSeek tool response');
   if(ordered.some(c=>!c.id||!c.function.name)||new Set(ordered.map(c=>c.id)).size!==ordered.length)throw Error('Invalid DeepSeek tool call identifiers');
   s.messages.push({role:'assistant',content:item.text||null,reasoning_content:reasoning,...ordered.length?{tool_calls:ordered}:{}});this.save(s);
   if(!ordered.length){if(!item.text.trim())throw Error('DeepSeek returned an empty answer');turn.status='completed';return;}
   for(const call of ordered){
    const activity={id:randomUUID(),type:'mcpToolCall',tool:call.function.name,status:'inProgress'};turn.items.push(activity);this.event('item/started',{threadId:s.id,item:activity});let result;
    try{
     signal.throwIfAborted();const tool=inventory.get(call.function.name);if(!tool)throw Error('Tool is not allowed in the current Studio mode');
     if(call.function.arguments.length>1024*1024)throw Error('Tool arguments exceed the size limit');
     const args=JSON.parse(call.function.arguments);checkValue(args,tool.inputSchema);
     if(call.function.name==='present_task'&&args.task_id!==context.taskId)throw Error('Workflow does not belong to this conversation');
     if(context.projectId&&(args.project_id||args.spec?.project_id)&&(args.project_id||args.spec?.project_id)!==context.projectId)throw Error('Project does not match this conversation');
     result=await this.mcp('tools/call',{name:call.function.name,arguments:args},AbortSignal.any([signal,AbortSignal.timeout(240000)]));
     result=JSON.parse(this.clean(JSON.stringify(result)));
    }catch(error){const correction=formatCorrection(error,call.function.name);result={isError:true,content:[{type:'text',text:this.clean(correction?JSON.stringify(correction):error.message)}],...correction?{structuredContent:correction}:{}};}
    activity.status=result?.isError?'failed':'completed';activity.result=result;this.event('item/completed',{threadId:s.id,item:activity});s.messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});this.save(s);
    if(signal.aborted){for(const remaining of ordered.slice(ordered.indexOf(call)+1))s.messages.push({role:'tool',tool_call_id:remaining.id,content:JSON.stringify({isError:true,error:'Cancelled before execution'})});signal.throwIfAborted();}
   }
  }
  throw Error('DeepSeek tool round limit reached; review existing drafts before continuing');
 }
 close(){for(const active of this.activeTurns.values())active.controller.abort();this.process=null;this.current=null;this.models=[];this.model=null;}
}
