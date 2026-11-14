import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {startCodexChatGateway,chatCompletionRequest} from '../../desktop/platform/codex-chat-gateway.mjs';

const credential={apiKey:'sk-fixture-custom-key',baseUrl:'https://fixture.invalid/v1',model:'vendor/custom-model',reasoningMode:'omit',reasoningEffort:''};
const requestBody={model:credential.model,input:[{role:'user',content:[{type:'input_text',text:'中文 input'}]}],stream:true};
function stream(chunks,{done=true,fragment=7}={}){const raw=chunks.map(value=>'data: '+JSON.stringify(value)+'\r\n\r\n').join('')+(done?'data: [DONE]\r\n\r\n':''),bytes=new TextEncoder().encode(raw);return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=fragment)controller.enqueue(bytes.slice(i,i+fragment));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
const delta=(value,finish=null)=>({choices:[{index:0,delta:value,finish_reason:finish}]});
const decode=raw=>raw.split(/\r?\n\r?\n/).filter(Boolean).map(block=>JSON.parse(block.split('\n').find(line=>line.startsWith('data: ')).slice(6)));
async function post(gateway,body=requestBody,options={}){return fetch(gateway.baseUrl+'/responses',{method:'POST',headers:{Authorization:'Bearer '+gateway.apiKey,'Content-Type':'application/json',...options.headers},body:JSON.stringify(body),...options});}

test('custom API protocol gateway streams split Unicode and actual usage without exposing keys or reasoning',async()=>{
 const calls=[];let original={...credential};const gateway=await startCodexChatGateway({credential:original,fetchApi:async(url,options)=>{calls.push({url,...options,body:JSON.parse(options.body)});return stream([delta({reasoning_content:'PRIVATE_REASONING'}),delta({content:'中文 actual'}),delta({},'stop'),{choices:[],usage:{prompt_tokens:17,completion_tokens:3,prompt_tokens_details:{cached_tokens:4}}}]);}});
 try{original.baseUrl='https://changed.invalid';original.apiKey='changed-key';const response=await post(gateway),raw=await response.text(),events=decode(raw);assert.equal(response.status,200);assert.equal(calls.length,1);assert.equal(calls[0].url,credential.baseUrl+'/chat/completions');assert.equal(calls[0].headers.Authorization,'Bearer '+credential.apiKey);assert.equal(calls[0].redirect,'error');assert.equal(calls[0].body.reasoning_effort,undefined);assert.equal(calls[0].body.thinking,undefined);assert.equal(calls[0].body.stream_options,undefined);assert.deepEqual(events.map(event=>event.sequence_number),events.map((_,index)=>index));assert.equal(events.find(event=>event.type==='response.output_text.delta').delta,'中文 actual');assert.equal(events.at(-1).type,'response.completed');assert.deepEqual(events.at(-1).response.usage,{input_tokens:17,output_tokens:3,total_tokens:20,input_tokens_details:{cached_tokens:4}});for(const secret of [credential.apiKey,gateway.apiKey,'PRIVATE_REASONING'])assert(!raw.includes(secret));}finally{await gateway.close();}
});

test('Responses conversation and split tool calls round-trip through one chat completion per native Codex request',async()=>{
 const calls=[],tool={type:'function',name:'mcp__gpusampling__list_projects',description:'Read projects',parameters:{type:'object',properties:{}}},input=[{role:'developer',content:'Studio policy'},{role:'user',content:'Projects?'},{type:'function_call',call_id:'old-call',name:tool.name,arguments:'{}'},{type:'function_call_output',call_id:'old-call',output:[{type:'input_text',text:'{"projects":[]}'}]},{role:'assistant',content:[{type:'output_text',text:'No projects'}]},{role:'user',content:'Read again'}];
 const gateway=await startCodexChatGateway({credential:{...credential,reasoningMode:'reasoning_effort',reasoningEffort:'vendor_high'},fetchApi:async(_url,options)=>{calls.push(JSON.parse(options.body));return stream([delta({tool_calls:[{index:0,id:'actual-call',type:'function',function:{name:tool.name,arguments:'{"a":'}}]}),delta({tool_calls:[{index:0,function:{arguments:'1}'}}]},'tool_calls')]);}});
 try{const events=decode(await (await post(gateway,{...requestBody,instructions:'Outer policy',input,tools:[tool],reasoning:{effort:'unconfigured'}})).text()),item=events.find(event=>event.type==='response.output_item.done').item;assert.equal(calls.length,1);assert.equal(calls[0].reasoning_effort,'vendor_high');assert.equal(calls[0].thinking,undefined);assert.deepEqual(calls[0].tools,[{type:'function',function:{name:tool.name,description:tool.description,parameters:tool.parameters}}]);assert.deepEqual(calls[0].messages,[{role:'system',content:'Outer policy'},{role:'system',content:'Studio policy'},{role:'user',content:'Projects?'},{role:'assistant',content:null,tool_calls:[{id:'old-call',type:'function',function:{name:tool.name,arguments:'{}'}}]},{role:'tool',tool_call_id:'old-call',content:'{"projects":[]}'},{role:'assistant',content:'No projects'},{role:'user',content:'Read again'}]);assert.equal(item.call_id,'actual-call');assert.equal(item.name,tool.name);assert.equal(item.arguments,'{"a":1}');assert.equal(events.find(event=>event.type==='response.function_call_arguments.delta').delta,'{"a":1}');assert.equal(events.at(-1).type,'response.completed');assert.equal(events.at(-1).response.usage,undefined);}finally{await gateway.close();}
});

test('gateway rejects unauthorized, cross-model, unsupported media and undeclared native tools before any API request',async()=>{
 let count=0;const gateway=await startCodexChatGateway({credential,fetchApi:async()=>{count++;throw Error('must not fetch');}});
 try{assert.equal((await fetch(gateway.baseUrl+'/responses',{method:'POST',body:'{}'})).status,401);assert.equal((await fetch(gateway.baseUrl+'/other',{headers:{Authorization:'Bearer '+gateway.apiKey}})).status,404);assert.equal((await fetch(gateway.baseUrl+'/responses',{headers:{Authorization:'Bearer '+gateway.apiKey}})).status,405);for(const change of [{model:'foreign-model'},{input:[{role:'user',content:[{type:'input_image',image_url:'file://private'}]}]},{tools:[{type:'local_shell'}]},{previous_response_id:'unknown'},{conversation:'unknown'},{stream:false}]){const response=await post(gateway,{...requestBody,...change});assert.equal(response.status,400);}assert.equal(count,0);}finally{await gateway.close();}
});

for(const [name,result,options]of [
 ['truncated stream',[delta({content:'partial'})],{}],
 ['missing DONE',[delta({content:'partial'}),delta({},'stop')],{done:false}],
 ['vendor stream error',[delta({content:'partial'}),{error:{message:credential.apiKey}}],{}],
 ['undeclared tool',[delta({tool_calls:[{index:0,id:'evil',function:{name:'run_shell_command',arguments:'{}'}}]},'tool_calls')],{}],
 ['unconfirmed calls',[delta({tool_calls:[{index:0,id:'call',function:{name:'list_projects',arguments:'{}'}}]},'stop')],{}],
])test('gateway never reports completion for '+name,async()=>{
 const gateway=await startCodexChatGateway({credential,fetchApi:async()=>stream(result,options)});
 try{const raw=await (await post(gateway)).text(),events=decode(raw);assert.equal(events.at(-1).type,'response.failed');assert(!events.some(event=>event.type==='response.completed'));assert(!raw.includes(credential.apiKey));}finally{await gateway.close();}
});

test('token limit reports incomplete rather than a completed response',async()=>{
 const gateway=await startCodexChatGateway({credential,fetchApi:async()=>stream([delta({content:'partial'},'length')])});
 try{const events=decode(await (await post(gateway)).text());assert.equal(events.at(-1).type,'response.incomplete');assert.equal(events.at(-1).response.incomplete_details.reason,'max_output_tokens');}finally{await gateway.close();}
});

test('upstream HTTP errors redact vendor bodies and do not produce successful SSE receipts',async()=>{
 const gateway=await startCodexChatGateway({credential,fetchApi:async()=>new Response(credential.apiKey,{status:403})});
 try{const response=await post(gateway),raw=await response.text();assert.equal(response.status,502);assert.match(raw,/HTTP 403/);assert(!raw.includes(credential.apiKey));}finally{await gateway.close();}
});

test('actual loopback HTTP endpoint receives only the saved API secret and closing the gateway aborts active requests',async()=>{
 const receipts=[],server=createServer(async(request,response)=>{let raw='';for await(const chunk of request)raw+=chunk;receipts.push({url:request.url,authorization:request.headers.authorization,body:JSON.parse(raw)});response.writeHead(200,{'Content-Type':'text/event-stream'});response.write('data: '+JSON.stringify(delta({content:'waiting'}))+'\n\n');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let notified;const started=new Promise(resolve=>notified=resolve);const gateway=await startCodexChatGateway({credential:{...credential,baseUrl:'http://127.0.0.1:'+server.address().port+'/v1'},fetchApi:async(...args)=>{const result=await fetch(...args);notified();return result;}});
 try{const pending=post(gateway);await started;const response=await pending,raw=response.text().catch(()=>null);await gateway.close();await raw;assert.equal(receipts.length,1);assert.equal(receipts[0].url,'/v1/chat/completions');assert.equal(receipts[0].authorization,'Bearer '+credential.apiKey);assert(!JSON.stringify(receipts).includes(gateway.apiKey));await assert.rejects(fetch(gateway.baseUrl+'/responses'));}finally{await gateway.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('tool-call input grouping preserves parallel assistant calls and tool result order',()=>{
 const value=chatCompletionRequest({...requestBody,input:[{type:'function_call',call_id:'one',name:'tool1',arguments:'{}'},{type:'function_call',call_id:'two',name:'tool2',arguments:'{}'},{type:'function_call_output',call_id:'one',output:'one result'},{type:'function_call_output',call_id:'two',output:'two result'}]},credential);assert.equal(value.messages.length,3);assert.deepEqual(value.messages[0].tool_calls.map(call=>call.id),['one','two']);assert.deepEqual(value.messages.slice(1).map(message=>message.tool_call_id),['one','two']);
});

test('native Codex namespace tools flatten for chat and restore the exact Responses namespace on calls and history',async()=>{
 const name='read_scientific_skill',namespace='mcp__gpusampling',flat=namespace+'__'+name,calls=[],gateway=await startCodexChatGateway({credential,fetchApi:async(_url,options)=>{calls.push(JSON.parse(options.body));return stream([delta({tool_calls:[{index:0,id:'namespaced-call',function:{name:flat,arguments:'{"id":"fixture"}'}}]},'tool_calls')]);}});
 try{const events=decode(await (await post(gateway,{...requestBody,input:[{type:'function_call',call_id:'old',namespace,name,arguments:'{}'},{type:'function_call_output',call_id:'old',output:'actual fixture result'}],tools:[{type:'namespace',name:namespace,tools:[{type:'function',name,parameters:{type:'object',properties:{}}}]}]})).text());assert.equal(calls[0].tools[0].function.name,flat);assert.equal(calls[0].messages[0].tool_calls[0].function.name,flat);assert.equal(calls[0].max_tokens,8192);const item=events.find(event=>event.type==='response.output_item.done').item;assert.equal(item.namespace,namespace);assert.equal(item.name,name);assert.equal(events.at(-1).type,'response.completed');}finally{await gateway.close();}
});

test('usage callback observes only validated upstream counts and listener failures cannot interrupt the stream',async()=>{
 const receipts=[],gateway=await startCodexChatGateway({credential,onUsage:(usage,context)=>{receipts.push({usage,context});throw Error('listener fixture');},fetchApi:async()=>stream([delta({content:'actual'},'stop'),{choices:[],usage:{prompt_tokens:7,completion_tokens:2}}])});
 try{const events=decode(await (await post(gateway)).text());assert.equal(events.at(-1).type,'response.completed');assert.equal(receipts.length,1);assert.deepEqual(receipts[0].usage,{input_tokens:7,output_tokens:2,total_tokens:9});assert.match(receipts[0].context.responseId,/^resp_/);}finally{await gateway.close();}
 const noUsage=await startCodexChatGateway({credential,onUsage:()=>assert.fail('Missing or malformed usage is not measured'),fetchApi:async()=>stream([delta({content:'actual'},'stop'),{choices:[],usage:{prompt_tokens:'7',completion_tokens:2}}])});try{assert.equal(decode(await (await post(noUsage)).text()).at(-1).type,'response.completed');}finally{await noUsage.close();}
});
