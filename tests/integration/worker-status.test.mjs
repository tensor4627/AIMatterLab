import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import ts from 'typescript';
import {readWorkerStatus} from "../../backend/main/compute/worker-status.mjs";
import {WorkerClient} from "../../agent/tools/worker-client.mjs";
import {deferred} from "../helpers/agent-hooks.mjs";

function fixture(){
 let settings={distribution:'Default Ubuntu',workerRoot:'~/default',workerPort:8767};
 const health={name:'gpu-sampling-studio',root:'/bound-worker',runtime:'/bound-runtime',execution_policy:'desktop-review-v1'};
 const calls=[],worker={connectionEpoch:2,connection:{health:{...health},url:'http://secret.invalid',tokens:{admin:'private-admin',mcp:'private-mcp'}},identity:{distribution:'Bound Ubuntu',root:health.root},request:async(method,target)=>{calls.push({method,target});return {...health};},connect(){throw Error('Never connect');},close(){throw Error('Never close');}};
 return {worker,health,calls,current:()=>settings,settings:value=>{settings={...settings,...value};}};
}
test('status verifies the actual existing bound bridge even when default settings target differs, returning only safe status/time',async()=>{
 const f=fixture(),result=await readWorkerStatus(f.worker,f.current,{now:()=>123});assert.deepEqual(result,{status:'connected',checkedAt:123});assert.deepEqual(f.calls,[{method:'GET',target:'/api/health'}]);assert(!/private|secret|url|tokens|root|runtime/.test(JSON.stringify(result)));
});
test('absence of cached transport cannot cause bootstrap or a health request',async()=>{const f=fixture();f.worker.connection=null;assert.equal((await readWorkerStatus(f.worker,f.current)).status,'disconnected');assert.equal(f.calls.length,0);});
for(const mode of ['name','root','runtime','execution_policy','missing-health','missing-identity','identity-root','http-error'])test('bad or unavailable health remains unknown: '+mode,async()=>{
 const f=fixture();if(mode==='missing-identity')f.worker.identity=null;else if(mode==='identity-root')f.worker.identity.root='/wrong';else f.worker.request=async()=>{if(mode==='http-error')throw Error('private-admin http://secret.invalid');if(mode==='missing-health')return null;return {...f.health,[mode]:'wrong'};};
 assert.equal((await readWorkerStatus(f.worker,f.current)).status,'unknown');
});
for(const mode of ['connection','epoch','identity','settings'])test('a health response after '+mode+' changes cannot restore stale status',async()=>{
 const f=fixture(),pending=deferred();f.worker.request=()=>pending.promise;const check=readWorkerStatus(f.worker,f.current);if(mode==='connection')f.worker.connection={...f.worker.connection};if(mode==='epoch')f.worker.connectionEpoch++;if(mode==='identity')f.worker.identity={...f.worker.identity};if(mode==='settings')f.settings({workerRoot:'~/new'});pending.resolve(f.health);assert.equal((await check).status,'unknown');
});
test('health observation has its own bound even when the existing transport never settles',async()=>{const f=fixture();f.worker.request=()=>new Promise(()=>{});const at=Date.now();assert.equal((await readWorkerStatus(f.worker,f.current,{timeoutMs:5})).status,'unknown');assert(Date.now()-at<1000);});

test('actual preload exposes only the new readonly status channel and forwards no private connection object',async()=>{
 const calls=[],exposed={};vm.runInNewContext(fs.readFileSync(new URL("../../desktop/preload.cjs",import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>exposed[name]=value},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return {status:'connected',checkedAt:1};}}})});
 assert.equal((await exposed.studio.invoke('worker.status')).status,'connected');assert.deepEqual(calls,[['studio:worker.status',undefined]]);await assert.rejects(exposed.studio.invoke('worker.connection'),/Unsupported/);await assert.rejects(exposed.studio.invoke('worker.tokens'),/Unsupported/);
});
test('actual main status handler uses the shared sender validation before observing existing worker',async()=>{
 const source=fs.readFileSync(new URL("../../desktop/main.mjs",import.meta.url),'utf8'),parsed=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const functions=parsed.statements.filter(node=>ts.isFunctionDeclaration(node)&&['trusted','handle'].includes(node.name?.text)).map(node=>node.getText(parsed));
 let registration;const visit=node=>{if(ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(parsed)==='handle'&&node.expression.arguments[0]?.text==='worker.status')registration=node;node.forEachChild(visit);};visit(parsed);assert(registration);
 const handlers=new Map(),window={isDestroyed:()=>false,webContents:{id:7,isDestroyed:()=>false,getURL:()=> 'file:///studio/index.html'}},f=fixture();
 new Function('ipcMain','window','shuttingDown','readWorkerStatus','worker','settings',functions.join('\n')+'\n'+registration.getText(parsed))({handle:(name,fn)=>handlers.set(name,fn)},window,false,readWorkerStatus,f.worker,f.current());
 const handler=handlers.get('studio:worker.status'),sender={id:7,isDestroyed:()=>false};for(const event of [{sender:{...sender,id:8},senderFrame:{url:window.webContents.getURL()}},{sender,senderFrame:{url:'https://wrong.invalid'}},{sender,senderFrame:{url:window.webContents.getURL(),parent:{}}}])await assert.rejects(handler(event),/Untrusted/);
 assert.equal(f.calls.length,0);assert.equal((await handler({sender,senderFrame:{url:window.webContents.getURL()}})).status,'connected');assert.deepEqual(f.calls,[{method:'GET',target:'/api/health'}]);
});
test('status uses the actual authenticated WorkerClient health transport without returning its secrets',async()=>{
 const health={name:'gpu-sampling-studio',root:'/fixture/worker',runtime:'/fixture/runtime',execution_policy:'desktop-review-v1'},requests=[];
 const server=http.createServer((request,response)=>{requests.push(request.url);assert.equal(request.method,'GET');assert.equal(request.url,'/api/health');assert.equal(request.headers.authorization,'Bearer private-fixture-admin');response.end(JSON.stringify({...health,tokens:{admin:'private-fixture-admin'},url:'http://private-upstream.invalid'}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const worker=new WorkerClient();worker.connection={health:{...health},tokens:{admin:'private-fixture-admin'},transport:'localhost'};worker.identity={distribution:'Bound fixture',root:health.root};worker.upstream='http://127.0.0.1:'+server.address().port;
 try{const observed=await readWorkerStatus(worker,()=>({distribution:'Different default',workerRoot:'~/default',workerPort:8767}));assert.equal(observed.status,'connected');assert.deepEqual(Object.keys(observed).sort(),['checkedAt','status']);assert(!JSON.stringify(observed).includes('private'));assert.deepEqual(requests,['/api/health']);}finally{worker.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
