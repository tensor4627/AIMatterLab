import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {WorkerClient} from '../../agent/tools/worker-client.mjs';

test('scoped MCP discovery stays stable while every tool-call route requires current resource usage',async t=>{
 let granted=false,throwGuard=false,forwarded=0,local=0,scoped=0,authoring=0;
 const upstream=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));if(body.method==='tools/call')forwarded++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.method==='tools/list'?{tools:[{name:'upstream_task'}]}:{content:[{type:'text',text:'synthetic upstream acknowledgement'}]}}));});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const worker=new WorkerClient();worker.upstream='http://127.0.0.1:'+upstream.address().port;worker.connection={tokens:{mcp:'synthetic-base-token',admin:'synthetic-admin-token'},transport:'ssh-terminal'};
 worker.setResourceUseGuard((provider,scope)=>{assert.equal(provider,'codex');assert.equal(scope.threadId,'thread');if(throwGuard)throw Error('private failure detail');return granted;});
 worker.setAuthoringGuard({before:()=>{authoring++;}});
 worker.setLocalTools([{name:'local_task'}],async()=>{local++;return {ok:true};});worker.setScopedTools([{name:'scoped_read'}],async()=>{scoped++;return {ok:true};});
 t.after(async()=>{worker.close();upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));});
 await worker.exposeTools({});worker.bindProviderContext('codex',{threadId:'thread'});const endpoint=worker.providerConnection('codex');
 const request=(method,params,connection=endpoint)=>fetch(connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+connection.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...params?{params}:{}})});
 assert.equal((await request('initialize')).status,200);const inventory=await(await request('tools/list')).json();assert.deepEqual(inventory.result.tools.map(tool=>tool.name),['upstream_task','local_task','scoped_read']);
 for(const name of ['upstream_task','local_task','scoped_read']){const response=await request('tools/call',{name,arguments:{}});assert.equal(response.status,403);assert.equal(await response.text(),'');}
 assert.deepEqual({forwarded,local,scoped,authoring},{forwarded:0,local:0,scoped:0,authoring:0});
 granted=true;for(const name of ['upstream_task','local_task','scoped_read'])assert.equal((await request('tools/call',{name,arguments:{}})).status,200);assert.deepEqual({forwarded,local,scoped,authoring},{forwarded:1,local:1,scoped:1,authoring:3});assert.equal(worker.providerConnection('codex').tokens.mcp,endpoint.tokens.mcp);
 granted=false;for(const name of ['upstream_task','local_task','scoped_read'])assert.equal((await request('tools/call',{name,arguments:{}})).status,403);
 throwGuard=true;const denied=await request('tools/call',{name:'local_task',arguments:{}});assert.equal(denied.status,403);assert.equal(await denied.text(),'');assert.deepEqual({forwarded,local,scoped,authoring},{forwarded:1,local:1,scoped:1,authoring:3});
 // Desktop-owned base access is separate from the provider's usage grant.
 assert.equal((await request('tools/call',{name:'local_task',arguments:{}},worker.connection)).status,200);assert.equal(local,2);
});

test('version3 combined gateway retains shell tools and checks shell and service grants separately by actual tool name',async t=>{
 const calls=[],upstream=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));calls.push(body.method==='tools/call'?body.params.name:body.method);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.method==='tools/list'?{tools:[{name:'list_clusters'}]}:{content:[{type:'text',text:'owned remote'}]}}));});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const worker=new WorkerClient();worker.upstream='http://127.0.0.1:'+upstream.address().port;worker.identity={kind:'ssh',version:3,connectionId:'connection'};worker.connection={tokens:{mcp:'owned-base'},transport:'ssh-connection'};
 let shell=false,service=false,local=0;const names=['list_shared_terminals','read_shared_terminal','write_shared_terminal'];worker.setLocalTools(names.map(name=>({name})),async()=>{local++;return {owned:true};});worker.setResourceUseGuard((_provider,_scope,name)=>names.includes(name)?shell:service);await worker.exposeTools({});worker.bindProviderContext('codex',{threadId:'thread'});const endpoint=worker.providerConnection('codex');
 t.after(async()=>{worker.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));});
 const request=(method,name)=>fetch(endpoint.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+endpoint.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...name?{params:{name,arguments:{}}}:{}})});
 const inventory=await(await request('tools/list')).json();assert.deepEqual(inventory.result.tools.map(v=>v.name),['list_clusters',...names]);
 service=true;assert.equal((await request('tools/call','list_clusters')).status,200);assert.equal((await request('tools/call','read_shared_terminal')).status,403);
 service=false;shell=true;assert.equal((await request('tools/call','list_clusters')).status,403);assert.equal((await request('tools/call','read_shared_terminal')).status,200);assert.equal(local,1);assert.equal(calls.filter(v=>v==='list_clusters').length,1);
});
