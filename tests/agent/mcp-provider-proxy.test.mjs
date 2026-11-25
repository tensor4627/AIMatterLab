import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {WorkerClient} from "../../agent/tools/worker-client.mjs";
async function setup(t){
 const calls=[];const upstream=http.createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer worker-mcp');assert.equal(req.url,'/mcp');const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));calls.push(body);res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.method==='tools/list'?{tools:[{name:'present_task'}]}:{content:[{type:'text',text:'upstream-science'}]}}));});await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));const w=new WorkerClient();w.upstream='http://127.0.0.1:'+upstream.address().port;w.connection={tokens:{mcp:'worker-mcp',admin:'worker-admin'},transport:'fixture-only'};
 const seen=[];w.setScopedTools([{name:'read_skill_route'}],async(name,args,scope)=>{seen.push({name,args,scope});return {provider:scope.provider};});await w.exposeTools({});
 t.after(async()=>{w.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));});
 const call=(connection,body,extra={})=>fetch(connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+connection.tokens.mcp,...extra},body:JSON.stringify({jsonrpc:'2.0',...body})});
 return {w,call,seen,calls};
}
test('Real loopback HTTP fixes provider identity for all four scopes, excludes reader from base and never sends admin upstream',async t=>{
 const {w,call,seen,calls}=await setup(t);const base=await(await call(w.connection,{id:1,method:'tools/list'})).json();assert.deepEqual(base.result.tools.map(t=>t.name),['present_task']);assert.equal((await call(w.connection,{id:2,method:'tools/call',params:{name:'read_skill_route'}})).status,403);
 for(const provider of ['codex','kimi','qwen','deepseek']){const scoped=w.providerConnection(provider);assert.deepEqual(Object.keys(scoped.tokens),['mcp']);const list=await(await call(scoped,{id:3,method:'tools/list'})).json();assert.deepEqual(list.result.tools.map(t=>t.name),['present_task','read_skill_route']);const result=await(await call(scoped,{id:4,method:'tools/call',params:{name:'read_skill_route',arguments:{function_id:'cv.compose',provider:'attacker'}}})).json();assert.equal(JSON.parse(result.result.content[0].text).provider,provider);assert.equal((await call({...scoped,tokens:{mcp:'worker-mcp'}},{id:5,method:'tools/list'})).status,403);}
 assert.deepEqual(seen.map(r=>r.scope.provider),['codex','kimi','qwen','deepseek']);assert.equal(calls.length,5);
});
test('Provider revoke and wrong-origin/path/token are denied through HTTP while independent scientific scopes remain live',async t=>{
 const {w,call}=await setup(t),codex=w.providerConnection('codex'),kimi=w.providerConnection('kimi');const body={id:1,method:'tools/list'};
 assert.equal((await call(codex,body,{Origin:'https://untrusted.example'})).status,403);
 assert.equal((await call({...codex,url:codex.url+'/../qwen'},body)).status,403);
 assert.equal((await call({...codex,tokens:kimi.tokens},body)).status,403);
 assert.equal((await fetch(codex.url+'/mcp?provider=kimi',{headers:{Authorization:'Bearer '+codex.tokens.mcp}})).status,403);
 w.revokeProvider('codex');assert.equal((await call(codex,body)).status,403);assert.equal((await call(kimi,body)).status,200);assert.equal((await call(w.connection,body)).status,200);const replacement=w.providerConnection('codex');assert.notEqual(replacement.tokens.mcp,codex.tokens.mcp);assert.equal((await call(replacement,body)).status,200);
});

test('Revocation during a pending privileged read suppresses its result instead of delivering stale permission',async t=>{
 const {w,call}=await setup(t),connection=w.providerConnection('codex');let release,entered;const arrived=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 w.setScopedTools([{name:'read_skill_route'}],async()=>{entered();await gate;return {private_text:'must not leave after revoke'};});
 const pending=call(connection,{id:8,method:'tools/call',params:{name:'read_skill_route',arguments:{function_id:'cv.compose'}}});await arrived;w.revokeProvider('codex');release();const response=await pending;assert.equal(response.status,403);assert.equal(await response.text(),'');
});

test('Denied public guidance retains its structured status and cannot report successful loading',async t=>{const {w,call}=await setup(t);for(const status of ['blocked','permission_required']){w.setScopedTools([{name:'read_skill_route'}],async()=>({status,reason:'explicit unchanged permission boundary',attachments:[]}));const r=await(await call(w.providerConnection('deepseek'),{id:9,method:'tools/call',params:{name:'read_skill_route'}})).json();assert.equal(r.result.isError,true);assert.equal(JSON.parse(r.result.content[0].text).status,status);}});

const scopedContext=(threadId,taskId=null)=>({threadId,taskId,projectId:taskId?'project-a':null,environmentId:taskId?'env-a':null,inputRoot:taskId?'/owned/a':null});
const toolBody=name=>({jsonrpc:'2.0',id:42,method:'tools/call',params:{name,arguments:{threadId:'forged',taskId:'forged'}}});
test('A missing workflow returns actionable MCP content without dispatch or reconnect',async t=>{
 const {w,call,calls}=await setup(t);let writes=0;w.setAuthoringGuard({before(){throw Error('Prepare a conversation-owned workflow before composing a bias');}});w.setScopedTools([{name:'read_skill_route'}],async()=>{writes++;return {};});
 const response=await call(w.providerConnection('codex'),toolBody('read_skill_route'));assert.equal(response.status,200);const body=await response.json(),failure=JSON.parse(body.result.content[0].text);
 assert.equal(body.id,42);assert.equal(body.result.isError,true);assert.equal(failure.code,'context_required');assert.equal(failure.status,'blocked');assert.equal(failure.automatic_retry,false);assert.equal(writes,0);assert.equal(calls.length,0);
});
test('Invalid argument shape never reaches guards or a local tool',async t=>{
 const {w,call}=await setup(t);let entered=0;w.setAuthoringGuard({before(){entered++;}});
 for(const args of [null,[],2,'bad']){const response=await call(w.providerConnection('codex'),{...toolBody('read_skill_route'),params:{name:'read_skill_route',arguments:args}});const result=(await response.json()).result;assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).code,'invalid_input');}
 assert.equal(entered,0);
});
test('Local tools reporting blocked do not become successful activity cards',async t=>{
 const {w,call}=await setup(t);w.setLocalTools([{name:'search_materials_project'}],async()=>({status:'blocked',message:'No API key',candidates:[]}));
 const result=(await(await call(w.providerConnection('codex'),toolBody('search_materials_project'))).json()).result;assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).status,'blocked');
});
test('Entering a local handler does not make a validation rejection unconfirmed',async t=>{
 const {w,call,calls}=await setup(t);
 w.setLocalTools([{name:'fixture_local'}],async()=>{throw Error('Invalid local tool request');});
 const result=(await(await call(w.providerConnection('codex'),toolBody('fixture_local'))).json()).result;
 const failure=JSON.parse(result.content[0].text);assert.equal(failure.status,'blocked');assert.equal(failure.operation_state,'not_started');assert.equal(calls.length,0);
});
test('A failure after dispatch is unconfirmed and the completed operation is never replayed',async t=>{
 const {w,call}=await setup(t);let writes=0;w.setScopedTools([{name:'read_skill_route'}],async()=>{writes++;return {saved:true};});w.setAuthoringGuard({before:()=>({}),after(){throw Error('Result identity changed before acknowledgement');},cancel(){}});
 const result=(await(await call(w.providerConnection('codex'),toolBody('read_skill_route'))).json()).result,failure=JSON.parse(result.content[0].text);assert.equal(result.isError,true);assert.equal(failure.status,'unknown');assert.equal(failure.operation_state,'unconfirmed');assert.equal(failure.automatic_retry,false);assert.equal(writes,1);
});
test('An upstream failure remains MCP data with unknown effects and no replay',async t=>{
 const {w,call}=await setup(t);let attempts=0;w.relay={kill(){}};w.forward=async()=>{attempts++;return {status:500,data:{error:'internal'}};};
 const response=await call(w.providerConnection('codex'),toolBody('read_log'));assert.equal(response.status,200);const failure=JSON.parse((await response.json()).result.content[0].text);assert.equal(failure.status,'unknown');assert.equal(attempts,1);
});
test('Malformed tool request envelopes cannot enter the authoring guard',async t=>{
 const {w,call}=await setup(t);let entered=0;w.setAuthoringGuard({before(){entered++;}});
 for(const body of [{method:'tools/call',params:{name:'read_skill_route'}},{...toolBody('read_skill_route'),jsonrpc:'1.0'},{...toolBody('read_skill_route'),id:{bad:true}}]){const response=await call(w.providerConnection('codex'),body);const value=await response.json();assert.equal(value.error.code,-32600);assert.equal(value.result,undefined);}
 assert.equal(entered,0);
});
for(const variant of ['wrong-id','wrong-version','empty-result','both-result-error'])test('Malformed upstream '+variant+' is unconfirmed without delivering an artifact',async t=>{
 const {w,call}=await setup(t);let attempts=0;const reply={jsonrpc:'2.0',id:42,result:{content:[{type:'text',text:'{"id":"not-verified","engine":"pydyn.md"}'}]}};
 if(variant==='wrong-id')reply.id=41;if(variant==='wrong-version')reply.jsonrpc='1.0';if(variant==='empty-result')reply.result={};if(variant==='both-result-error')reply.error={code:-1,message:'bad'};
 w.relay={kill(){}};w.forward=async()=>{attempts++;return {status:200,data:reply};};const response=await call(w.providerConnection('codex'),toolBody('read_log')),body=await response.json();assert.equal(body.id,42);assert.equal(body.result.isError,true);assert.equal(JSON.parse(body.result.content[0].text).status,'unknown');assert.equal(JSON.stringify(body).includes('not-verified'),false);assert.equal(attempts,1);
});
test('Scoped dispatch receives only trusted bound identity and a live boolean lease check',async t=>{
 const {w,call,seen}=await setup(t);w.bindProviderContext('codex',scopedContext('real-thread','real-task'));const c=w.providerConnection('codex');await call(c,toolBody('read_skill_route'));assert.equal(seen[0].scope.threadId,'real-thread');assert.equal(seen[0].scope.taskId,'real-task');assert.equal(seen[0].scope.checkCurrent(),true);w.bindProviderContext('codex',scopedContext('next-thread','real-task'));assert.equal(seen[0].scope.checkCurrent(),false);assert.equal((await call(c,toolBody('read_skill_route'))).status,403);assert.equal(seen.length,1);
});
for(const route of ['scoped','local','upstream','relay'])test('A context switch during authoring.before dispatches zero '+route+' writes',async t=>{
 const {w,call,calls}=await setup(t);w.bindProviderContext('codex',scopedContext('a'));const c=w.providerConnection('codex');let release,entered;const gate=new Promise(r=>release=r),arrived=new Promise(r=>entered=r);let writes=0,cancelled=0;
 w.setAuthoringGuard({before:async(_name,_args,_provider,scope)=>{assert.equal(scope.threadId,'a');entered();await gate;return 'guard-token';},after:()=>{throw Error('must not complete');},cancel:token=>{assert.equal(token,'guard-token');cancelled++;}});
 w.setScopedTools([{name:'scoped-write'}],async()=>{writes++;return {};});w.setLocalTools([{name:'local-write'}],async()=>{writes++;return {};});
 if(route==='relay'){w.relay={stdin:{write(){writes++;}},kill(){}};w.forward=async()=>{writes++;return {status:200,data:{}};};}
 const name=route==='scoped'?'scoped-write':route==='local'?'local-write':'upstream-write';const pending=call(c,toolBody(name));await arrived;w.bindProviderContext('codex',scopedContext('b'));release();const response=await pending;assert.equal(response.status,403);assert.equal(await response.text(),'');assert.equal(writes,0);assert.equal(calls.length,0);assert.equal(cancelled,1);
});
test('Authenticated slow-body request cannot dispatch after context selection changes',async t=>{
 const {w,calls}=await setup(t);w.bindProviderContext('codex',scopedContext('a'));const c=w.providerConnection('codex');let guards=0,writes=0;w.setAuthoringGuard({before(){guards++;}});w.setScopedTools([{name:'scoped-write'}],async()=>{writes++;});
 let authenticated;const arrived=new Promise(r=>authenticated=r),original=w.providerScopes.authenticate.bind(w.providerScopes);w.providerScopes.authenticate=(args)=>{const scope=original(args);if(scope)authenticated();return scope;};
 const body=JSON.stringify(toolBody('scoped-write')),url=new URL(c.url+'/mcp');let request;const pending=new Promise((resolve,reject)=>{request=http.request(url,{method:'POST',headers:{Authorization:'Bearer '+c.tokens.mcp,'Content-Length':Buffer.byteLength(body)}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,text}));});request.on('error',reject);request.write(body.slice(0,10));});await arrived;w.bindProviderContext('codex',scopedContext('b'));request.end(body.slice(10));assert.deepEqual(await pending,{status:403,text:''});assert.equal(guards,0);assert.equal(writes,0);assert.equal(calls.length,0);
});
test('Initial fill with the same token also invalidates requests waiting in guard.before',async t=>{
 const {w,call}=await setup(t),c=w.providerConnection('kimi');let release,entered,writes=0;const gate=new Promise(r=>release=r),arrived=new Promise(r=>entered=r);w.setAuthoringGuard({before:async()=>{entered();await gate;},cancel(){}});w.setScopedTools([{name:'read_skill_route'}],async()=>{writes++;return {};});const pending=call(c,toolBody('read_skill_route'));await arrived;w.bindProviderContext('kimi',scopedContext('first'),{allowInitialFill:true});assert.equal(w.providerConnection('kimi').tokens.mcp,c.tokens.mcp);release();assert.equal((await pending).status,403);assert.equal(writes,0);
});
test('Context revoked during guard.after suppresses a completed body',async t=>{
 const {w,call}=await setup(t);w.bindProviderContext('deepseek',scopedContext('a'));const c=w.providerConnection('deepseek');let release,entered;const gate=new Promise(r=>release=r),arrived=new Promise(r=>entered=r);w.setAuthoringGuard({before:()=>({}),after:async()=>{entered();await gate;},cancel(){}});const pending=call(c,toolBody('read_skill_route'));await arrived;w.bindProviderContext('deepseek',scopedContext('b'));release();const result=await pending;assert.equal(result.status,403);assert.equal(await result.text(),'');
});
