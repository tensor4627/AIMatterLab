// A protocol adapter only: Codex owns every agent/tool turn. One Responses
// request maps to one Chat Completions request at the saved custom endpoint.
import {createServer} from 'node:http';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {compatibleCredentials} from '../../agent/providers/compatible-api.mjs';

const MAX_BODY=8*1024*1024,MAX_OUTPUT=16*1024*1024;
const TOOL_NAMES=Symbol('native Responses tool names');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
class GatewayError extends Error{constructor(message,status=400){super(message);this.status=status;}}
function textContent(value){
 if(typeof value==='string')return value;
 if(!Array.isArray(value))throw new GatewayError('Only text messages are supported by this custom API connection.');
 return value.map(part=>{if(!object(part)||!['input_text','output_text','text'].includes(part.type)||typeof part.text!=='string')throw new GatewayError('Only text messages are supported by this custom API connection.');return part.text;}).join('');
}
function named(value,label){if(typeof value!=='string'||!value||value.length>256||/[\r\n\0]/.test(value))throw new GatewayError('Invalid '+label+'.');return value;}
function toolArguments(value){if(typeof value!=='string')throw new GatewayError('Invalid function arguments.');return value;}
function chatToolName(name,namespace){
 named(name,'function name');if(namespace!==undefined)named(namespace,'function namespace');
 const combined=namespace===undefined?name:namespace+'__'+name;
 return combined.length<=64?combined:'gss_'+createHash('sha256').update((namespace||'')+'\0'+name).digest('hex').slice(0,40);
}

export function chatCompletionRequest(value,credential){
 if(!object(value)||value.model!==credential.model)throw new GatewayError('The requested model differs from the saved custom API model.');
 if(value.stream!==true)throw new GatewayError('This Codex connection requires streamed responses.');
 if(value.previous_response_id||value.conversation)throw new GatewayError('This connection requires explicit conversation history.');
 const messages=[];
 if(value.instructions!==undefined){if(typeof value.instructions!=='string')throw new GatewayError('Invalid instructions.');if(value.instructions)messages.push({role:'system',content:value.instructions});}
 const input=typeof value.input==='string'?[{role:'user',content:value.input}]:value.input;
 if(!Array.isArray(input))throw new GatewayError('Invalid conversation input.');
 for(const item of input){
  if(!object(item))throw new GatewayError('Invalid conversation item.');
  if(item.type==='reasoning')continue; // Private reasoning is not user text or a new instruction.
  if(item.type==='function_call'){
   const call={id:named(item.call_id,'function call ID'),type:'function',function:{name:chatToolName(item.name,item.namespace),arguments:toolArguments(item.arguments)}};
   const last=messages.at(-1);if(last?.role==='assistant'&&last.tool_calls)last.tool_calls.push(call);else messages.push({role:'assistant',content:null,tool_calls:[call]});
  }else if(item.type==='function_call_output'){
   messages.push({role:'tool',tool_call_id:named(item.call_id,'function call ID'),content:textContent(item.output)});
  }else if(item.type===undefined||item.type==='message'){
   if(!['system','developer','user','assistant'].includes(item.role))throw new GatewayError('Invalid message role.');
   messages.push({role:item.role==='developer'?'system':item.role,content:textContent(item.content)});
  }else throw new GatewayError('Unsupported Responses input item.');
 }
 const body={model:credential.model,messages,stream:true,max_tokens:8192},toolNames=new Map();Object.defineProperty(body,TOOL_NAMES,{value:toolNames});
 if(value.tools!==undefined){
  if(!Array.isArray(value.tools)||value.tools.length>256)throw new GatewayError('Invalid function tools.');
  const functions=[];
  for(const tool of value.tools){
   if(object(tool)&&tool.type==='namespace'){
    const namespace=named(tool.name,'function namespace');if(!Array.isArray(tool.tools)||!tool.tools.length)throw new GatewayError('Invalid function namespace.');
    for(const child of tool.tools)functions.push({tool:child,namespace});
   }else functions.push({tool});
  }
  if(functions.length>256)throw new GatewayError('Too many function tools.');
  body.tools=functions.map(({tool,namespace})=>{
   if(!object(tool)||tool.type!=='function'||!object(tool.parameters))throw new GatewayError('Only function tools are supported by this custom API connection.');
   const nativeName=named(tool.name,'function name'),name=chatToolName(nativeName,namespace);if(toolNames.has(name))throw new GatewayError('Ambiguous function tool names.');toolNames.set(name,{name:nativeName,...namespace!==undefined?{namespace}:{}});if(tool.description!==undefined&&typeof tool.description!=='string')throw new GatewayError('Invalid tool description.');
   return {type:'function',function:{name,...tool.description!==undefined?{description:tool.description}:{},parameters:tool.parameters,...typeof tool.strict==='boolean'?{strict:tool.strict}:{}}};
  });
  if(!body.tools.length)delete body.tools;
 }
 if(value.tool_choice!==undefined){
  if(['auto','none','required'].includes(value.tool_choice))body.tool_choice=value.tool_choice;
  else if(object(value.tool_choice)&&value.tool_choice.type==='function')body.tool_choice={type:'function',function:{name:chatToolName(value.tool_choice.name,value.tool_choice.namespace)}};
  else throw new GatewayError('Unsupported function tool choice.');
 }
 if(value.parallel_tool_calls!==undefined){if(typeof value.parallel_tool_calls!=='boolean')throw new GatewayError('Invalid parallel tool setting.');body.parallel_tool_calls=value.parallel_tool_calls;}
 if(value.max_output_tokens!==undefined){if(!Number.isSafeInteger(value.max_output_tokens)||value.max_output_tokens<1)throw new GatewayError('Invalid output token limit.');body.max_tokens=value.max_output_tokens;}
 // The saved setting is authoritative. Codex defaults must not enable thinking
 // or send vendor-specific effort values the user has not configured.
 if(credential.reasoningMode==='reasoning_effort')body.reasoning_effort=credential.reasoningEffort;
 return body;
}

async function readBody(request){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>MAX_BODY)throw new GatewayError('Request exceeds the custom API connection limit.',413);chunks.push(chunk);}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new GatewayError('Invalid JSON request.');}}
async function* events(body){
 if(!body)throw new GatewayError('The custom API returned an empty stream.',502);
 const decoder=new TextDecoder();let buffer='';
 for await(const bytes of body){buffer+=typeof bytes==='string'?bytes:decoder.decode(bytes,{stream:true});if(buffer.length>MAX_BODY)throw new GatewayError('The custom API stream event exceeds its size limit.',502);let match;while((match=/\r?\n\r?\n/.exec(buffer))){const block=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(data)yield data;}}
 buffer+=decoder.decode();if(buffer.trim())throw new GatewayError('The custom API stream ended inside an event.',502);
}
function usageFor(value){
 if(!object(value)||!Number.isSafeInteger(value.prompt_tokens)||value.prompt_tokens<0||!Number.isSafeInteger(value.completion_tokens)||value.completion_tokens<0)return undefined;
 const usage={input_tokens:value.prompt_tokens,output_tokens:value.completion_tokens,total_tokens:value.prompt_tokens+value.completion_tokens};
 const cached=value.prompt_tokens_details?.cached_tokens,reasoning=value.completion_tokens_details?.reasoning_tokens;
 if(Number.isSafeInteger(cached)&&cached>=0)usage.input_tokens_details={cached_tokens:cached};
 if(Number.isSafeInteger(reasoning)&&reasoning>=0)usage.output_tokens_details={reasoning_tokens:reasoning};return usage;
}
async function relay(response,upstream,body,signal,onUsage){
 const id='resp_'+randomUUID().replaceAll('-',''),created_at=Math.floor(Date.now()/1000),output=[];let sequence=0,done=false,finish=null,usage,size=0,message=null;
 const calls=new Map(),allowed=new Set((body.tools||[]).map(tool=>tool.function.name));
 const send=(type,fields={})=>{if(signal.aborted||response.destroyed)throw new GatewayError('The custom API request was cancelled.',499);response.write('event: '+type+'\ndata: '+JSON.stringify({type,sequence_number:sequence++,...fields})+'\n\n');};
 const snapshot=status=>({id,object:'response',created_at,status,model:body.model,output,...usage?{usage}:{}});
 const beginMessage=()=>{if(message)return;message={id:'msg_'+randomUUID().replaceAll('-',''),type:'message',status:'in_progress',role:'assistant',content:[{type:'output_text',text:'',annotations:[]}]};output.push(message);send('response.output_item.added',{output_index:output.length-1,item:{...message,content:[]}});send('response.content_part.added',{item_id:message.id,output_index:output.length-1,content_index:0,part:{type:'output_text',text:'',annotations:[]}});};
 response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'});
 send('response.created',{response:snapshot('in_progress')});send('response.in_progress',{response:snapshot('in_progress')});
 try{
  for await(const data of events(upstream.body)){
   if(data==='[DONE]'){done=true;break;}
   let chunk;try{chunk=JSON.parse(data);}catch{throw new GatewayError('The custom API returned invalid stream JSON.',502);}
   if(!object(chunk)||chunk.error)throw new GatewayError('The custom API reported a stream error.',502);
   if(chunk.usage)usage=usageFor(chunk.usage);
   if(!Array.isArray(chunk.choices))throw new GatewayError('The custom API returned invalid stream choices.',502);
   const choice=chunk.choices.find(value=>value.index===0||value.index===undefined);if(!choice)continue;
   const delta=choice.delta;if(!object(delta))throw new GatewayError('The custom API returned an invalid stream delta.',502);
   if(finish&&((typeof delta.content==='string'&&delta.content)||delta.tool_calls?.length))throw new GatewayError('The custom API continued after its final stream receipt.',502);
   if(delta.refusal)throw new GatewayError('The custom API declined this response.',502);
   if(delta.content!==undefined&&delta.content!==null){if(typeof delta.content!=='string')throw new GatewayError('The custom API returned non-text content.',502);size+=Buffer.byteLength(delta.content);if(size>MAX_OUTPUT)throw new GatewayError('The custom API output exceeds its size limit.',502);if(delta.content){beginMessage();message.content[0].text+=delta.content;send('response.output_text.delta',{item_id:message.id,output_index:output.indexOf(message),content_index:0,delta:delta.content});}}
   if(delta.tool_calls!==undefined){
    if(!Array.isArray(delta.tool_calls))throw new GatewayError('The custom API returned invalid function calls.',502);
    for(const part of delta.tool_calls){
     if(!object(part)||!Number.isSafeInteger(part.index)||part.index<0||part.index>255||part.type!==undefined&&part.type!=='function')throw new GatewayError('The custom API returned an invalid function call.',502);
     let call=calls.get(part.index);if(!call){call={id:'',name:'',arguments:''};calls.set(part.index,call);}
     if(part.id!==undefined){const callId=named(part.id,'function call ID');if(call.id&&call.id!==callId)throw new GatewayError('The custom API changed a function call identity.',502);call.id=callId;}
     if(part.function!==undefined){if(!object(part.function))throw new GatewayError('The custom API returned an invalid function.',502);if(part.function.name!==undefined){if(typeof part.function.name!=='string')throw new GatewayError('Invalid function name.',502);call.name+=part.function.name;}if(part.function.arguments!==undefined){if(typeof part.function.arguments!=='string')throw new GatewayError('Invalid function arguments.',502);call.arguments+=part.function.arguments;}}
     if(call.name.length>256)throw new GatewayError('Invalid function name.',502);size+=Buffer.byteLength(JSON.stringify(part));if(size>MAX_OUTPUT)throw new GatewayError('The custom API output exceeds its size limit.',502);
    }
   }
   if(choice.finish_reason!==undefined&&choice.finish_reason!==null){if(finish&&finish!==choice.finish_reason)throw new GatewayError('The custom API changed its final stream receipt.',502);finish=choice.finish_reason;}
  }
  if(!done||!finish)throw new GatewayError('The custom API stream ended without a confirmed completion.',502);
  if(!['stop','tool_calls','length'].includes(finish))throw new GatewayError('The custom API did not complete this response.',502);
  if(calls.size&&finish!=='tool_calls')throw new GatewayError('The custom API did not confirm its function calls.',502);
  if(finish==='tool_calls'&&!calls.size)throw new GatewayError('The custom API returned no confirmed function calls.',502);
  if(message){message.status='completed';const output_index=output.indexOf(message),part=message.content[0];send('response.output_text.done',{item_id:message.id,output_index,content_index:0,text:part.text});send('response.content_part.done',{item_id:message.id,output_index,content_index:0,part});send('response.output_item.done',{output_index,item:message});}
  for(const [,call]of [...calls].sort(([a],[b])=>a-b)){
   if(!call.id||!allowed.has(call.name))throw new GatewayError('The custom API returned an undeclared function call.',502);
   const native=body[TOOL_NAMES].get(call.name),item={id:'fc_'+randomUUID().replaceAll('-',''),type:'function_call',call_id:call.id,...native,arguments:call.arguments,status:'completed'},output_index=output.length;output.push(item);
   send('response.output_item.added',{output_index,item:{...item,status:'in_progress',arguments:''}});send('response.function_call_arguments.delta',{item_id:item.id,output_index,delta:call.arguments});send('response.function_call_arguments.done',{item_id:item.id,output_index,arguments:call.arguments});send('response.output_item.done',{output_index,item});
  }
  if(finish==='length')send('response.incomplete',{response:{...snapshot('incomplete'),incomplete_details:{reason:'max_output_tokens'}}});
  else send('response.completed',{response:snapshot('completed')});
 }catch(error){if(!signal.aborted&&!response.destroyed)send('response.failed',{response:{...snapshot('failed'),error:{code:'custom_api_stream_failed',message:error instanceof GatewayError?error.message:'The custom API stream failed.'}}});}
 finally{if(usage&&typeof onUsage==='function'){try{Promise.resolve(onUsage(structuredClone(usage),{responseId:id})).catch(()=>{});}catch{}}response.end();await upstream.body?.cancel().catch(()=>{});}
}

export async function startCodexChatGateway({credential,fetchApi=fetch,timeoutMs=120000,onUsage}={}){
 const saved=Object.freeze(compatibleCredentials(structuredClone(credential))),apiKey=randomBytes(32).toString('hex'),authorization=Buffer.from('Bearer '+apiKey),active=new Set();let closed=false,origin;
 const server=createServer(async(request,response)=>{
  const expected=Buffer.from(request.headers.authorization||'');
  const reply=(status,message)=>{if(response.destroyed)return;response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({error:{message}}));};
  if(closed)return reply(503,'This custom API connection is closed.');
  if(request.headers.host!==origin||request.headers.origin||expected.length!==authorization.length||!timingSafeEqual(expected,authorization))return reply(401,'Unauthorized custom API connection.');
  if(request.url!=='/v1/responses')return reply(404,'Unknown custom API connection endpoint.');
  if(request.method!=='POST')return reply(405,'Only POST is supported.');
  if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']||'')||request.headers['content-encoding'])return reply(415,'Only uncompressed JSON is supported.');
  if(active.size>=8)return reply(429,'Too many active custom API requests.');
  const abort=new AbortController();active.add(abort);const cancel=()=>abort.abort();request.on('aborted',cancel);response.on('close',cancel);const timer=setTimeout(cancel,timeoutMs);
  try{
   const body=chatCompletionRequest(await readBody(request),saved);if(closed||abort.signal.aborted)throw new GatewayError('The custom API request was cancelled.',499);
   const upstream=await fetchApi(saved.baseUrl+'/chat/completions',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...saved.apiKey?{Authorization:'Bearer '+saved.apiKey}:{}},body:JSON.stringify(body),signal:abort.signal});
   if(!upstream.ok){await upstream.body?.cancel().catch(()=>{});throw new GatewayError('The custom API request failed (HTTP '+upstream.status+').',502);}
   if(!/^text\/event-stream(?:;|$)/i.test(upstream.headers.get('content-type')||'')){await upstream.body?.cancel().catch(()=>{});throw new GatewayError('The custom API did not return a streamed chat completion.',502);}
   await relay(response,upstream,body,abort.signal,onUsage);
  }catch(error){if(!response.headersSent)reply(error instanceof GatewayError?error.status:502,error instanceof GatewayError?error.message:'The custom API connection failed.');else response.end();}
  finally{clearTimeout(timer);active.delete(abort);request.off('aborted',cancel);response.off('close',cancel);}
 });
 server.headersTimeout=10000;server.requestTimeout=15000;server.keepAliveTimeout=1000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});origin='127.0.0.1:'+server.address().port;
 return {baseUrl:'http://'+origin+'/v1',apiKey,close(){if(closed)return Promise.resolve();closed=true;for(const abort of active)abort.abort();const completion=new Promise(resolve=>server.close(resolve));server.closeAllConnections();return completion;}};
}
