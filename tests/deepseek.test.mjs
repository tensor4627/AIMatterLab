import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:http';
import {DeepSeekBridge,deepseekCredentials,sseEvents,DEEPSEEK_URL} from '../desktop/deepseek.mjs';
import {AgentHub} from '../desktop/agent-hub.mjs';
import {TaskRecords} from '../desktop/task-records.mjs';
const key='sk-fixture-deepseek-key',mcpKey='fixture-mcp-secret',adminKey='fixture-admin-secret';
const tools=[{name:'list_projects',inputSchema:{type:'object',properties:{}}},{name:'present_task',inputSchema:{type:'object',required:['task_id','parameters'],properties:{task_id:{type:'string'},parameters:{type:'object'}}}},{name:'prepare_run',inputSchema:{type:'object',required:['spec'],properties:{spec:{type:'object'}}}},{name:'submit_run',inputSchema:{type:'object'}},{name:'cancel_run',inputSchema:{type:'object'}}];
function catalog(){const values=new Map();return {get:(k,id)=>structuredClone(values.get(k+':'+id)||null),put:(k,id,v)=>{values.set(k+':'+id,structuredClone(v));return v;},list:k=>[...values.entries()].filter(([id])=>id.startsWith(k+':')).map(([,v])=>structuredClone(v))};}
function stream(chunks,{done=true,fragment=3}={}){const text=chunks.map(c=>'data: '+JSON.stringify(c)+'\r\n\r\n').join('')+(done?'data: [DONE]\r\n\r\n':''),bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=fragment)c.enqueue(bytes.slice(i,i+fragment));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
const delta=(value,finish=null)=>({choices:[{delta:value,finish_reason:finish}]});
const answer=(text='实际回复')=>stream([delta({content:text}),delta({},'stop')]);
function toolReply(name='present_task',args={task_id:'task',parameters:{temperature:300}}){return stream([delta({reasoning_content:'fixture private reasoning'}),delta({tool_calls:[{index:0,id:'call-1',function:{name,arguments:JSON.stringify(args).slice(0,8)}}]}),delta({tool_calls:[{index:0,function:{arguments:JSON.stringify(args).slice(8)}}]},'tool_calls')]);}
function fixture({store=catalog(),responses=[answer()],credential=deepseekCredentials({apiKey:key}),withWorker=true}={}){
 const api=[],mcp=[],events=[];const b=new DeepSeekBridge({catalog:store,credential:()=>credential,worker:()=>withWorker?{url:'http://127.0.0.1:12345',tokens:{mcp:mcpKey,admin:adminKey}}:null,fetchApi:async(url,opts)=>{api.push({url,...opts,body:opts.body?JSON.parse(opts.body):undefined});if(url.endsWith('/models'))return Response.json({data:[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]});const response=responses.shift();if(typeof response==='function')return response(url,opts);if(!response)throw Error('Unexpected fixture API request');return response;},fetchMcp:async(url,opts)=>{const request=JSON.parse(opts.body);mcp.push({url,...opts,request});return Response.json({result:request.method==='tools/list'?{tools}:{content:[{type:'text',text:JSON.stringify({kind:'task-parameters',id:'task',name:'MD',steps:[],parameters:request.params.arguments.parameters,missing_fields:[]})}]}});}});
 b.on('event',e=>events.push(e));return {b,api,mcp,events,store};
}
async function start(b){await b.start();await b.request('model/list');return (await b.request('thread/start')).thread.id;}
async function turn(b,id,extra={}){const complete=new Promise(resolve=>{const handler=e=>{if(e.method==='turn/completed'){b.off('event',handler);resolve(e.params.turn);}};b.on('event',handler);});await b.request('turn/start',{threadId:id,input:[{type:'text',text:'填写当前流程'}],...extra});return complete;}
test('DeepSeek credentials use the fixed official endpoint and reject malformed secrets',()=>{
 assert.equal(deepseekCredentials({apiKey:key,baseUrl:'https://attacker.invalid'}).baseUrl,DEEPSEEK_URL);
 for(const apiKey of ['abc','sk-abc\n123456','sk-12345678 secret','sk-'+'.'.repeat(30)])assert.throws(()=>deepseekCredentials({apiKey}));
});
test('SSE parser preserves split Unicode, CRLF and multiline events',async()=>{
 const bytes=new TextEncoder().encode(': ping\r\n\r\ndata: {"value":\r\ndata: "中文"}\r\n\r\n');const chunks=(async function*(){for(const byte of bytes)yield Uint8Array.of(byte);})();const values=[];for await(const v of sseEvents(chunks))values.push(JSON.parse(v));assert.deepEqual(values,[{value:'中文'}]);
});
test('No key means explicit sign-in required and no invented model access',async()=>{
 const {b,api}=fixture({credential:null});await b.start();assert.deepEqual(await b.request('model/list'),{data:[],authRequired:true});assert.equal(api.length,0);b.close();
});
test('Catalog is authenticated; fast mode is explicit and context capacity is never fabricated',async()=>{
 const {b,api,events}=fixture();try{const id=await start(b),result=await turn(b,id);assert.equal(result.status,'completed');assert.equal(api[0].headers.Authorization,'Bearer '+key);assert.equal(api[1].body.thinking.type,'disabled');assert.equal(api[1].body.reasoning_effort,'none');assert.equal(api[1].url,DEEPSEEK_URL+'/chat/completions');assert.equal(b.session(id).messages.at(-1).reasoning_content,'');assert(!JSON.stringify(api.map(v=>v.body)).includes(mcpKey));assert(!JSON.stringify(events).includes(key));assert(!JSON.stringify(events).includes(adminKey));await assert.rejects(b.request('model/select',{model:'made-up'}),/catalog/);}finally{b.close();}
});
test('Native tools update the same conversation workflow and private reasoning survives tool rounds and restart',async()=>{
 const {b,api,mcp,events,store}=fixture({responses:[toolReply(),answer('草稿已填写'),answer('修改已收到')]});const records=new TaskRecords(store,()=>{});const id=await start(b);const task=records.create({planningMode:true,provider:'deepseek',threadId:id,request:'MD'});
 // Use the actual Studio task ID for this conversation.
 b.fetchApi=async(url,opts)=>{api.push({url,...opts,body:opts.body?JSON.parse(opts.body):undefined});const index=api.filter(v=>v.url.endsWith('/chat/completions')).length;return index===1?toolReply('present_task',{task_id:task.id,parameters:{temperature:300}}):answer('草稿已填写');};
 b.fetchMcp=async(url,opts)=>{const request=JSON.parse(opts.body);mcp.push({url,...opts,request});return Response.json({result:request.method==='tools/list'?{tools}:{content:[{type:'text',text:JSON.stringify({id:task.id,kind:'task-parameters',name:'MD',steps:['输入'],parameters:{temperature:300},missing_fields:[]})}]}});};
 b.on('event',event=>records.event(event));records.prepareTurn('deepseek',{threadId:id,planningMode:true,studioTaskId:task.id});
 const result=await turn(b,id,{effort:'high',studioToolContext:{mode:'workflow',taskId:task.id}});assert.equal(result.status,'completed');assert.equal(records.read(task.id).parameters.temperature,300);
 const calls=api.filter(v=>v.body);assert.equal(calls[0].body.thinking.type,'enabled');assert.equal(calls[1].body.messages.find(m=>m.role==='assistant').reasoning_content,'fixture private reasoning');assert(mcp.filter(v=>v.request.method==='tools/call').every(v=>v.headers.Authorization==='Bearer '+mcpKey));assert(!JSON.stringify(events).includes('fixture private reasoning'));
 b.close();const restored=fixture({store,responses:[answer('继续原会话')]});await restored.b.start();await restored.b.request('model/list');await restored.b.request('thread/resume',{threadId:id});const read=await restored.b.request('thread/read',{threadId:id});assert(read.thread.turns[0].items.some(i=>i.type==='mcpToolCall'));assert(!JSON.stringify(read).includes('reasoning_content'));await turn(restored.b,id,{effort:'high'});assert.equal(restored.api.at(-1).body.messages.find(m=>m.role==='assistant').reasoning_content,'fixture private reasoning');restored.b.close();
});
test('Chat mode rejects a forged draft tool and all submission tools before MCP execution',async()=>{
 for(const name of ['present_task','submit_run','cancel_run','run_shell_command']){const {b,mcp,api}=fixture({responses:[toolReply(name),answer('需要审阅')]});const id=await start(b);await turn(b,id);assert.equal(mcp.filter(v=>v.request.method==='tools/call').length,0);assert(api.at(-1).body.messages.some(m=>m.role==='tool'&&m.content.includes('not allowed')));b.close();}
});
test('Workflow tool schemas, project and task ownership are checked outside model instructions',async()=>{
 for(const [name,args] of [['present_task',{task_id:'another',parameters:{}}],['present_task',{task_id:'task',parameters:3}],['prepare_run',{spec:{project_id:'another'}}]]){const {b,mcp}=fixture({responses:[toolReply(name,args),answer()]});const id=await start(b);await turn(b,id,{studioToolContext:{mode:'workflow',taskId:'task',projectId:'project'}});assert.equal(mcp.filter(v=>v.request.method==='tools/call').length,0);b.close();}
});
test('Truncated streams never execute tool calls or claim success',async()=>{
 const response=stream([delta({tool_calls:[{index:0,id:'call',function:{name:'present_task',arguments:'{}'}}]},'tool_calls')],{done:false});const {b,mcp}=fixture({responses:[response]});const id=await start(b),result=await turn(b,id,{studioToolContext:{mode:'workflow',taskId:'task'}});assert.equal(result.status,'failed');assert.match(result.error.message,/disconnected/);assert.equal(mcp.filter(v=>v.request.method==='tools/call').length,0);b.close();
});
test('API auth errors do not echo secrets and cancellation aborts active requests',async()=>{
 const bad=fixture();await bad.b.start();bad.b.fetchApi=async()=>new Response('echo '+key,{status:401});await assert.rejects(bad.b.request('model/list'),/HTTP 401/);bad.b.close();
 let entered;const ready=new Promise(resolve=>entered=resolve);const {b}=fixture({responses:[async(url,opts)=>{entered();await new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}]});const id=await start(b),pending=turn(b,id);await ready;await b.request('turn/interrupt',{threadId:id});assert.equal((await pending).status,'cancelled');assert.equal(b.activeTurns.size,0);b.close();
});
test('Crash recovery retains drafts and does not replay an unconfirmed native tool',async()=>{
 const f=fixture(),id=await start(f.b),s=f.b.session(id);s.messages=[{role:'assistant',content:null,reasoning_content:'private',tool_calls:[{id:'unconfirmed',type:'function',function:{name:'prepare_run',arguments:'{}'}}]}];s.turns=[{id:'old',status:'inProgress',items:[{type:'mcpToolCall',status:'inProgress'}]}];f.b.save(s);f.b.close();const restored=fixture({store:f.store});await restored.b.start();const read=await restored.b.request('thread/read',{threadId:id});assert.equal(read.thread.turns[0].status,'failed');assert.equal(restored.mcp.length,0);assert.match(restored.b.session(id).messages.at(-1).content,/do not repeat/);restored.b.close();
});
test('AgentHub stores only encrypted-vault credentials and reports actual output separately',async()=>{
 const store=catalog(),credentials=new Map(),codex=new EventEmitter();codex.close=()=>{};const hub=new AgentHub({codex,root:'.',catalog:store,vault:{get:k=>credentials.get(k),put:(k,v)=>credentials.set(k,v)},settings:()=>({}),worker:()=>null,fetchApi:async url=>url.endsWith('/models')?Response.json({data:[{id:'deepseek-flash'}]}):answer('actual fixture output')});
 const login=await hub.login('deepseek',{apiKey:key});assert.equal(login.modelAccess,'not_run');assert(!JSON.stringify(login).includes(key));await hub.connect('deepseek');await hub.rpc('deepseek','model/list');const id=(await hub.rpc('deepseek','thread/start')).thread.id;const complete=new Promise(resolve=>hub.on('event',e=>{if(e.method==='turn/completed')resolve();}));await hub.rpc('deepseek','turn/start',{threadId:id,input:[{type:'text',text:'test'}]});await complete;assert.equal((await hub.account('deepseek')).modelAccess,'passed');hub.close();
});
test('Real loopback HTTP/SSE transport keeps API and MCP authorization separate',async()=>{
 const receipts=[];const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;receipts.push({url:req.url,auth:req.headers.authorization,body:text?JSON.parse(text):null});if(req.url==='/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'deepseek-flash'}]}));}else if(req.url==='/mcp'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result:{tools}}));}else{res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify(delta({content:'HTTP 测试'},'stop'))+'\n\ndata: [DONE]\n\n');}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const b=new DeepSeekBridge({catalog:catalog(),credential:()=>({apiKey:key}),worker:()=>({url:origin,tokens:{mcp:mcpKey,admin:adminKey}}),fetchApi:(url,opts)=>{assert(url.startsWith(DEEPSEEK_URL));return fetch(url.replace(DEEPSEEK_URL,origin),opts);}});
 try{const id=await start(b);assert.equal((await turn(b,id)).status,'completed');assert(receipts.filter(r=>r.url==='/mcp').every(r=>r.auth==='Bearer '+mcpKey));assert(receipts.filter(r=>r.url!=='/mcp').every(r=>r.auth==='Bearer '+key));assert(!JSON.stringify(receipts.map(r=>r.body)).includes(mcpKey));}finally{b.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('A lost worker does not prevent plain API chat, but blocks planning',async()=>{
 for(const mode of ['chat','workflow']){const {b}=fixture();b.fetchMcp=async()=>{throw Error('Worker offline');};const id=await start(b);const result=await turn(b,id,{studioToolContext:mode==='chat'?{mode}:{mode,taskId:'task'}});assert.equal(result.status,mode==='chat'?'completed':'failed');b.close();}
});
