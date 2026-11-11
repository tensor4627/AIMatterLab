import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {WorkerClient} from '../../backend/main/compute/worker.mjs';
import {EXISTING_WORKER_RELAY} from '../../backend/main/compute/existing-worker.mjs';

const source='D:\\synthetic-worker-source';
const settings={distribution:'Fixture Ubuntu',workerRoot:'~/fixture-worker',workerPort:8767};
const health=()=>({name:'gpu-sampling-studio',root:'/fixture/worker',runtime:'/fixture/runtime',execution_policy:'desktop-review-v1'});
function fixture(){
 const f={health:health(),requests:[],executions:[],children:[],revocations:0,url:'http://127.0.0.1:8767'};
 const host={execute:async(file,args)=>{assert.equal(file,'wsl.exe');f.executions.push(args);return {stdout:JSON.stringify(args.some(value=>value.endsWith('/install.py'))?{path:'/fixture/runtime'}:{url:f.url,tokens:{admin:'synthetic-admin',mcp:'synthetic-mcp'},health:f.health})+'\n'};}};
 const launchRelay=(file,args,options)=>{
  assert.equal(file,'wsl.exe');assert.equal(args[6],EXISTING_WORKER_RELAY);assert.deepEqual(args.slice(0,6),['-d',settings.distribution,'--','python3','-B','-c']);
  assert.deepEqual(args.slice(7),[f.targetRoot??settings.workerRoot,String(settings.workerPort)]);assert.equal(options.windowsHide,true);
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=0;
  child.kill=()=>{child.killed++;};
  child.stdin=new Writable({write(chunk,_encoding,done){const value=JSON.parse(chunk.toString());f.requests.push(value);const reply=()=>child.stdout.write(JSON.stringify({id:value.id,status:f.responseStatus??200,data:value.target==='/api/health'?f.observedHealth??f.health:{target:value.target,received:value.data}})+'\n');if(f.hold)f.held=reply;else queueMicrotask(reply);done();}});
  f.children.push(child);if(f.spawnError)queueMicrotask(()=>child.emit('error',Error('Synthetic relay launch denied')));return child;
 };
 f.worker=new WorkerClient({host,launchRelay,readExisting:async()=>({status:'connected',connection:{url:f.url,tokens:{admin:'synthetic-admin',mcp:'synthetic-mcp'},health:f.health}}),providerScopes:{revokeAll(){f.revocations++;}}});
 f.close=()=>{f.worker.close();for(const child of f.children){child.stdout.end();child.stderr.end();child.stdin.end();}};
 return f;
}
async function eventually(predicate){for(let i=0;i<30&&!predicate();i++)await new Promise(resolve=>setImmediate(resolve));assert(predicate(),'fixture did not reach expected boundary');}

for(const forceRelay of [false,true])test('fresh connect verifies every request through WSL and preserves requested tilde root, forceRelay='+forceRelay,async()=>{
 const f=fixture();try{
  const result=await f.worker.connect({...settings,forceRelay},source);assert.equal(result.transport,'wsl-stdio');assert.equal(f.worker.connection.transport,'wsl-stdio');assert.equal(f.worker.identity.root,f.health.root);assert.equal(f.executions.length,2);
  assert.deepEqual(await f.worker.request('POST','/api/run/status',{run_id:'synthetic-run'}),{target:'/api/run/status',received:{run_id:'synthetic-run'}});
  await f.worker.forward('POST','/mcp',{jsonrpc:'2.0',id:2,method:'tools/list'},true);
  assert.deepEqual(f.requests.map(value=>[value.target,value.mcp]),[['/api/health',false],['/api/run/status',false],['/mcp',true]]);
  assert(!JSON.stringify(f.requests).includes('synthetic-admin'));assert(!JSON.stringify(f.requests).includes('synthetic-mcp'));
 }finally{f.close();}
});

test('unrelated Windows loopback listener receives no initial or later HTTP/auth request',async()=>{
 let received=0;const server=http.createServer((_request,response)=>{received++;response.end(JSON.stringify(health()));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const f=fixture();f.url='http://127.0.0.1:'+server.address().port;
 try{await f.worker.connect(settings,source);await f.worker.request('GET','/api/projects');assert.equal(received,0);assert.equal(f.requests.length,2);}
 finally{f.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

for(const [field,value] of [['name','unrelated-listener'],['root','relative/root'],['runtime','relative/runtime'],['execution_policy','unreviewed']])test('invalid bootstrap identity is rejected before launching transport: '+field,async()=>{
 const f=fixture();f.health[field]=value;try{await assert.rejects(f.worker.connect(settings,source),/identity unavailable/);assert.equal(f.children.length,0);assert.equal(f.worker.connection,null);}finally{f.close();}
});

for(const [field,value] of [['name','unrelated-listener'],['root','/another/worker'],['runtime','/another/runtime'],['execution_policy','unreviewed']])test('changed verified health is rejected with no alternate transport: '+field,async()=>{
 const f=fixture();f.observedHealth={...f.health,[field]:value};try{await assert.rejects(f.worker.connect(settings,source),/identity unavailable/);assert.equal(f.children.length,1);assert.equal(f.children[0].killed,1);assert.equal(f.worker.connection,null);assert.equal(f.requests.length,1);}finally{f.close();}
});

test('failed verified relay cannot fall back to Windows HTTP or leave a connected bridge',async()=>{
 const f=fixture();f.spawnError=true;try{await assert.rejects(f.worker.connect(settings,source),/Synthetic relay launch denied/);assert.equal(f.worker.connection,null);assert.equal(f.children.length,1);assert.equal(f.children[0].killed,1);assert.equal(f.worker.pending.size,0);}finally{f.close();}
});

test('closing during initial health revokes attachment and ignores the late reply',async()=>{
 const f=fixture();f.hold=true;try{const pending=f.worker.connect(settings,source);const rejected=assert.rejects(pending,/bridge closed|superseded/);await eventually(()=>!!f.held);f.worker.close();f.held();await rejected;assert.equal(f.worker.connection,null);assert.equal(f.worker.pending.size,0);assert.equal(f.executions.length,2);}finally{f.close();}
});

for(const event of ['exit','error','stdin-error'])test('verified relay '+event+' invalidates readiness without resubmission',async()=>{
  const f=fixture();try{await f.worker.connect(settings,source);const child=f.children[0],before=f.revocations;f.hold=true;const pending=f.worker.request('GET','/api/runs'),rejected=assert.rejects(pending,/disconnected|unavailable|Synthetic/);if(event==='stdin-error')child.stdin.emit('error',Error('Synthetic pipe error'));else child.emit(event,event==='error'?Error('Synthetic relay error'):1);await rejected;assert.equal(f.worker.connection,null);assert.equal(f.worker.relay,null);assert.equal(f.worker.identity,null);assert.equal(child.killed,1);assert.equal(f.worker.pending.size,0);assert.equal(f.revocations,before+1);assert.equal(f.executions.length,2);}finally{f.close();}
});

for(const event of ['exit','error','stdin-error'])test('failed passive restore '+event+' cleans its attachment without starting a service',async()=>{
 const f=fixture();f.targetRoot=f.health.root;f.hold=true;try{const pending=f.worker.restore({...settings,workerRoot:f.targetRoot});await eventually(()=>!!f.held);const child=f.children[0];if(event==='stdin-error')child.stdin.emit('error',Error('Synthetic restore pipe error'));else child.emit(event,event==='error'?Error('Synthetic restore error'):1);assert.equal((await pending).status,'unknown');assert.equal(child.killed,1);assert.equal(f.worker.connection,null);assert.equal(f.worker.relay,null);assert.equal(f.worker.identity,null);assert.equal(f.worker.connectionTarget,null);assert.equal(f.worker.pending.size,0);assert.equal(f.executions.length,0);f.held();assert.equal(f.worker.connection,null);}finally{f.close();}
});

test('relay close clears ownership before synchronous child exit callbacks',async()=>{
 const f=fixture();try{await f.worker.connect(settings,source);const child=f.children[0],before=f.revocations;child.kill=()=>{child.killed++;child.emit('exit',0);};f.worker.close();assert.equal(child.killed,1);assert.equal(f.revocations,before+1);assert.equal(f.worker.relay,null);}finally{f.close();}
});

test('late exit or pipe error from an old relay cannot clear a newer explicit connection',async()=>{
 const f=fixture();try{await f.worker.connect(settings,source);const old=f.children[0];f.health={...f.health,root:'/fixture/new-worker'};f.targetRoot='/fixture/new-worker';await f.worker.connect({...settings,workerRoot:f.targetRoot},source);const connection=f.worker.connection,before=f.revocations;old.emit('exit',0);old.stdin.emit('error',Error('Synthetic stale pipe'));assert.equal(f.worker.connection,connection);assert.equal(f.revocations,before);assert.equal((await f.worker.request('GET','/api/health')).root,f.targetRoot);}finally{f.close();}
});
