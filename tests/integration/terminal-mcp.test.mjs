import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {AsyncLocalStorage} from 'node:async_hooks';
import {TerminalMcp} from "../../agent/tools/terminal-mcp.mjs";import {sharedTerminalTools} from "../../backend/main/compute/shared-terminal.mjs";import {createPrivateCvAccess} from "../../agent/tools/private-cv-access.mjs";
import {toolFailure} from '../../agent/tools/tool-failure.mjs';
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
async function fixture(t,{threadId='fixture-thread',override,scientificSkills}={}){const calls=[],records={bound:()=>null},guard=createPrivateCvAccess({records,activeTasks:new Map(),worker:{request(){throw Error('No worker allowed');}}}),terminal={tools:()=>[...sharedTerminalTools,{name:'present_task'}],callTool:async(name,args,scope)=>{calls.push({name,args,provider:scope.provider,threadId:scope.threadId});return override?override(name,args,scope):{sessions:[]};}},endpoint=new TerminalMcp({terminal,scientificSkills,guard:()=>guard});await endpoint.start();endpoint.bindProviderContext('codex',{threadId});const connection=endpoint.providerConnection('codex');t.after(()=>endpoint.close());
 const request=(body,{token=connection.tokens.mcp,origin,host,method='POST',pathname=new URL(connection.url).pathname+'/mcp',contentType='application/json'}={})=>new Promise((resolve,reject)=>{const url=new URL(connection.url),req=http.request({hostname:url.hostname,port:url.port,path:pathname,method,headers:{Authorization:'Bearer '+token,'Content-Type':contentType,...origin?{Origin:origin}:{},...host?{Host:host}:{}}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,body:text?JSON.parse(text):null});});});req.on('error',reject);req.end(typeof body==='string'?body:JSON.stringify(body));});return{endpoint,connection,calls,request};}
const rpc=(method,params={},id=1)=>({jsonrpc:'2.0',id,method,params});
test('terminal MCP advertises only public terminal definitions before a thread exists, without a worker or execution',async t=>{const f=await fixture(t,{threadId:null}),r=await f.request(rpc('tools/list'));assert.equal(r.status,200);assert.deepEqual(r.body.result.tools.map(v=>v.name).sort(),sharedTerminalTools.map(v=>v.name).sort());assert.deepEqual(f.calls,[]);const denied=await f.request(rpc('tools/call',{name:'list_shared_terminals',arguments:{}}));assert(denied.body.result.isError);assert.deepEqual(f.calls,[]);});
test('terminal MCP supports bounded initialization/empty resources and rejects foreign capabilities or unscoped requests',async t=>{const f=await fixture(t);for(const method of ['initialize','ping','resources/list','resources/templates/list']){const r=await f.request(rpc(method));assert.equal(r.status,200);}const list=await f.request(rpc('tools/list'));assert.equal(list.body.result.tools.length,3);for(const options of [{token:'invalid'},{origin:'https://example.invalid'},{host:'example.invalid'},{pathname:'/mcp'}])assert.equal((await f.request(rpc('tools/list'),options)).status,403);assert.equal((await f.request(rpc('tools/list'),{method:'GET'})).status,405);assert.equal((await f.request(rpc('tools/list'),{contentType:'text/plain'})).status,415);assert.equal((await f.request('{')).status,400);const denied=await f.request(rpc('tools/call',{name:'present_task',arguments:{}}));assert(denied.body.result.isError);assert.deepEqual(f.calls,[]);});
test('terminal MCP dispatch is current provider-scoped and revocation suppresses late results',async t=>{const gate=deferred(),f=await fixture(t,{override:()=>gate.promise}),pending=f.request(rpc('tools/call',{name:'read_shared_terminal',arguments:{session_id:'fixture-session'}}));while(!f.calls.length)await new Promise(r=>setImmediate(r));assert.equal(f.calls[0].provider,'codex');assert.equal(f.calls[0].threadId,'fixture-thread');f.endpoint.revokeProvider('codex');gate.resolve({output:'PUBLIC FIXTURE LATE'});const r=await pending;assert.equal(r.status,403);assert.equal(r.body,null);});

test('desktop scientific guides require a current thread and discard a revoked read',async t=>{
 const reading=deferred(),release=deferred();
 const scientificSkills={tools:()=>[{name:'read_scientific_skill',annotations:{readOnlyHint:true}}],call:async(_name,_args,scope)=>{reading.resolve(scope);return release.promise;}};
 const unbound=await fixture(t,{threadId:null,scientificSkills});
 const request=rpc('tools/call',{name:'read_scientific_skill',arguments:{function_id:'environment.probe'}});
 assert((await unbound.request(request)).body.result.isError);
 const f=await fixture(t,{scientificSkills}),pending=f.request(request);
 const scope=await reading.promise;assert.equal(scope.threadId,'fixture-thread');assert.equal(scope.provider,'codex');
 f.endpoint.revokeProvider('codex');release.resolve({text:'former guidance'});assert.equal((await pending).status,403);
});

test('managed MCP advertises legacy tools only for a current manual share and refreshes just that conversation',async t=>{
 const current=new AsyncLocalStorage(),grants=new Set(),legacyCalls=[];
 const terminal={
  tools:()=>sharedTerminalTools,
  hasCurrentGrant:provider=>current.getStore()?.provider===provider&&grants.has(current.getStore().threadId),
  callTool:async(name,_args,scope)=>{legacyCalls.push([name,scope.threadId]);return {sessions:[]};},
 };
 const managedTool={name:'list_compute_resources'},desktopTools={tools:()=>[managedTool],owns:name=>name===managedTool.name,call:()=>({resources:[]})};
 const endpoint=new TerminalMcp({terminal,desktopTools,runScope:(scope,run)=>current.run(scope,run),
  workerTools:{list:async()=>({tools:[sharedTerminalTools[0]]})}});
 t.after(()=>endpoint.close());
 await endpoint.start();
 const first={provider:'deepseek',threadId:'original-saved-chat',sessionId:'original-fixture-session'};
 const other={provider:'deepseek',threadId:'parallel-saved-chat',sessionId:'parallel-fixture-session'};
 const bind=scope=>current.run(scope,()=>endpoint.bindProviderContext(scope.provider,{threadId:scope.threadId},{sessionId:scope.sessionId}));
 const connection=scope=>endpoint.providerConnection(scope.provider,scope.sessionId);
 const invoke=async(connection,method,params)=>fetch(connection.url+'/mcp',{method:'POST',
  headers:{Authorization:'Bearer '+connection.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify(rpc(method,params))});
 const tools=async value=>(await (await invoke(value,'tools/list')).json()).result.tools.map(tool=>tool.name).sort();
 const legacy=connection=>invoke(connection,'tools/call',{name:'list_shared_terminals',arguments:{}});
 grants.add(other.threadId);
 bind(first);bind(other);
 const firstToken=connection(first),otherToken=connection(other);
 assert.deepEqual(await tools(firstToken),[managedTool.name]);
 assert((await tools(otherToken)).includes('list_shared_terminals'));

 grants.add(first.threadId);
 assert.equal(bind(first).rotated,true);
 const granted=connection(first);
 assert.equal((await invoke(firstToken,'tools/list')).status,403);
 assert((await tools(granted)).includes('list_shared_terminals'));
 assert.equal((await (await legacy(granted)).json()).result.isError,false);

 grants.delete(first.threadId);
 assert.deepEqual(await tools(granted),[managedTool.name]);
 const stale=await (await legacy(granted)).json();
 assert.equal(JSON.parse(stale.result.content[0].text).operation_state,'not_started');
 assert.equal(bind(first).rotated,true);
 assert.equal((await invoke(granted,'tools/list')).status,403);
 assert.deepEqual(await tools(connection(first)),[managedTool.name]);
 assert.equal(connection(other).tokens.mcp,otherToken.tokens.mcp);
 assert((await tools(otherToken)).includes('list_shared_terminals'));
 assert.deepEqual(legacyCalls,[['list_shared_terminals',first.threadId]]);
});

test('hosted shell recovery text applies to an acquisition error with preserved dispatch status',()=>{
 const failure=(message,options={})=>JSON.parse(toolFailure(Error(message),options).content[0].text);
 const uncertain=failure('ssh_channel_unavailable',{toolName:'acquire_compute_resource',dispatched:true});
 assert.equal(uncertain.code,'terminal_channel_unavailable');
 assert.equal(uncertain.operation_state,'unconfirmed');
 assert.equal(uncertain.automatic_retry,false);
 assert.match(uncertain.next_step,/same resource’s service-only path/);
 assert.equal(failure('ssh_shell_readiness_timeout',{toolName:'acquire_compute_resource'}).operation_state,'not_started');
 assert.notEqual(failure('ssh_channel_unavailable',{toolName:'read_shared_terminal'}).code,'terminal_channel_unavailable');
});

test('SSH recovery receipts preserve a pending login and require verified loss before explicit sign-in',()=>{
 const failure=(message,dispatched=false)=>JSON.parse(toolFailure(Error(message),{toolName:'acquire_compute_resource',dispatched}).content[0].text);
 const pending=failure('ssh_control_timeout');
 assert.equal(pending.code,'connection_unconfirmed');
 assert.match(pending.next_step,/Resume a pending login.*private terminal/);
 assert.doesNotMatch(pending.next_step,/sign in again/);
 const lost=failure('ssh_master_unavailable',true);
 assert.equal(lost.operation_state,'unconfirmed');
 assert.equal(lost.automatic_retry,false);
 assert.match(lost.next_step,/loss is confirmed.*user can explicitly sign in again on that profile/);
 assert.match(lost.next_step,/Reconcile unknown operations by their original identity/);
 assert.match(failure('managed_compute_resource_unavailable').next_step,/missing entry alone leaves the reason unconfirmed/);
});

test('missing resource selection is resolved in the same chat using the listed ID',()=>{
 const error=Object.assign(Error('managed_compute_user_instruction_required'),{operationNotStarted:true});
 const reply=JSON.parse(toolFailure(error,{toolName:'acquire_compute_resource',dispatched:true}).content[0].text);
 assert.equal(reply.code,'resource_selection_required');
 assert.equal(reply.operation_state,'not_started');
 assert.match(reply.next_step,/in this chat/i);
 assert.match(reply.next_step,/submitted resource option.*directly named target/i);
 assert.match(reply.next_step,/current resource_id.*requested access/i);
 assert.match(reply.next_step,/ambiguous.*picker/i);
 assert.match(reply.next_step,/project or login refusal only when its own receipt/i);
});
