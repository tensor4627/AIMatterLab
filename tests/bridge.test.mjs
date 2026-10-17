import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CodexBridge} from '../desktop/codex.mjs';
import {Catalog} from '../desktop/catalog.mjs';
import {assertWorkerRoute,assertRpc,linuxPath,quoteShell,sshAlias} from '../desktop/security.mjs';

test('IPC rejects credential and arbitrary process APIs',()=>{
 assert.throws(()=>assertRpc('config/value/write'));
 assert.throws(()=>assertWorkerRoute('POST','http://evil.example/api/projects'));
 assert.throws(()=>assertWorkerRoute('POST','/mcp'));
 assertWorkerRoute('GET','/api/runs');
 assertWorkerRoute('POST','/api/run/submit');
});
test('Windows paths and SSH shell arguments remain literal',()=>{
 assert.equal(linuxPath('D:\\data\\hello.py'),'/mnt/d/data/hello.py');
 assert.throws(()=>sshAlias('-oProxyCommand=attack'));
 assert.throws(()=>sshAlias('a; touch file'));
 assert.equal(quoteShell("x'$(touch y)"),"'x'\\''$(touch y)'");
});
test('Codex results, errors, timeout and server requests are separate',async()=>{
 const bridge=new CodexBridge(),sent=[];
 bridge.process={stdin:{write:value=>sent.push(JSON.parse(value))}};
 const result=bridge.request('model/list');
 bridge.receive({id:sent[0].id,result:{data:[]}});
 assert.deepEqual(await result,{data:[]});
 const error=bridge.request('thread/start');
 bridge.receive({id:sent[1].id,error:{message:'denied'}});
 await assert.rejects(error,/denied/);
 const messages=[];bridge.on('event',m=>messages.push(m));
 bridge.receive({method:'item/commandExecution/requestApproval',id:'server-1',params:{threadId:'t'}});
 bridge.respond('server-1',{decision:'decline'});
 assert.equal(sent.at(-1).id,'server-1');
 assert.throws(()=>bridge.respond('server-1',{}),/resolved/);
 await assert.rejects(bridge.request('slow',{},10),/timed out/);
 assert.equal(messages.length,1);
});
test('disconnect rejects pending requests instead of reporting completion',async()=>{
 const bridge=new CodexBridge();
 bridge.process={stdin:{write:()=>{}}};
 const request=bridge.request('turn/start');
 bridge.fail(new Error('lost connection'));
 await assert.rejects(request,/lost connection/);
});
test('desktop SQLite catalog survives reopening',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-catalog-'));
 try{
  const one=new Catalog(root);one.put('thread','t1',{preview:'science'});one.db.close();
  const two=new Catalog(root);assert.equal(two.get('thread','t1').preview,'science');two.db.close();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Agent context settings are scoped and validated',async()=>{
 const {agentConfig,STUDIO_INSTRUCTIONS}=await import('../desktop/agent-settings.mjs');
 assert.deepEqual(agentConfig({contextWindow:131072,compactLimit:98304}),{
  'features.shell_tool':false,'features.unified_exec':false,model_context_window:131072,model_auto_compact_token_limit:98304});
 assert.throws(()=>agentConfig({contextWindow:8192,compactLimit:8192}));
 assert.throws(()=>agentConfig({contextWindow:'131072'}));
 assert.match(STUDIO_INSTRUCTIONS,/STOP/);
 assertWorkerRoute('POST','/api/run/revise');
 assertWorkerRoute('POST','/api/run/input');
});


test('Account-first connections rebind tools and coalesce concurrent starts without restarting live turns',async()=>{
 const bridge=new CodexBridge();let launches=0,kills=0,release;
 bridge.launch=async()=>{launches++;await new Promise(r=>release=r);bridge.process={stdin:{},kill:()=>kills++};return bridge.info={ready:true};};
 const account=bridge.start('fixture',null);release();await account;
 const worker={url:'http://127.0.0.1:1',tokens:{mcp:'private-test-token'}};
 const first=bridge.start('fixture',worker),second=bridge.start('fixture',worker);release();await Promise.all([first,second]);
 assert.equal(launches,2);assert.equal(kills,1);
 bridge.receive({method:'turn/started',params:{threadId:'t'}});
 await assert.rejects(bridge.start('fixture',{...worker,url:'http://127.0.0.1:2'}),/Stop/);assert.equal(kills,1);
 bridge.receive({method:'turn/completed',params:{threadId:'t'}});const changed=bridge.start('fixture',{...worker,url:'http://127.0.0.1:2'});release();await changed;assert.equal(launches,3);bridge.close();
});
