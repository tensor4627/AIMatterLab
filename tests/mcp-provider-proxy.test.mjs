import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {WorkerClient} from '../desktop/worker.mjs';
async function setup(t){
 const calls=[];const upstream=http.createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer worker-mcp');assert.equal(req.url,'/mcp');const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));calls.push(body);res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.method==='tools/list'?{tools:[{name:'present_task'}]}:{content:[{type:'text',text:'upstream-science'}]}}));});await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));const w=new WorkerClient();w.upstream='http://127.0.0.1:'+upstream.address().port;w.connection={tokens:{mcp:'worker-mcp',admin:'worker-admin'},transport:'fixture-only'};
 const seen=[];w.setScopedTools([{name:'read_skill_route'}],async(name,args,scope)=>{seen.push({name,args,scope});return {provider:scope.provider};});await w.exposeTools({});
 t.after(async()=>{w.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));});
 const call=(connection,body,extra={})=>fetch(connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+connection.tokens.mcp,...extra},body:JSON.stringify(body)});
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
