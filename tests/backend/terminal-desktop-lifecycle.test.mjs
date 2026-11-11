// Real broker HTTP, inert PTY/process fixtures. Never contacts SSH or a worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {createSharedTerminal} from '../../backend/main/compute/shared-terminal.mjs';
import {startBroker} from '../../desktop/platform/terminal-service/broker.mjs';
import {mockTerminalRuntime} from '../helpers/terminal-runtime-fixture.mjs';

async function raw(descriptor,method,route,body){
 const response=await fetch(descriptor.origin+route,{method,headers:{Authorization:'Bearer '+descriptor.controlToken,...body===undefined?{}:{'Content-Type':'application/json'}},...body===undefined?{}:{body:JSON.stringify(body)}});
 if(response.status!==200)throw Error('inert broker refused');return response.json();
}
function gate(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
const wait=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-desktop-terminals-')),rows=new Map(),brokers=[],children=[],terminals=[],calls=[];
 t.after(async()=>{await Promise.all(brokers.map(item=>item.close()));fs.rmSync(root,{recursive:true,force:true});});
 const catalog={list:kind=>[...rows].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>structuredClone(value)),put(kind,id,value){rows.set(kind+':'+id,structuredClone({...value,id}));},remove:(kind,id)=>rows.delete(kind+':'+id)};
 const key=randomBytes(32),encryption={isEncryptionAvailable:()=>true};
 encryption.encryptString=text=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]);};
 encryption.decryptString=bytes=>{const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');};
 const profile={id:'saved-ssh',version:1,kind:'ssh',mode:'interactive',host:'fixture.invalid',username:'fixture',port:22,ssh_client:process.execPath};
 const pty={spawn(){let onExit;const terminal={pid:9000+terminals.length,kills:0,onData(){},onExit:callback=>onExit=callback,write(){},resize(){},kill(){terminal.kills++;onExit({exitCode:0});}};terminals.push(terminal);return terminal;}};
 const spawn=()=>{
  const child=new EventEmitter();child.pid=process.pid;child.stdout=new PassThrough();child.unref=()=>{};child.kills=0;let broker;
  const exited=()=>{if(child.exitCode===0)return;child.exitCode=0;child.emit('exit',0,null);};
  child.kill=()=>{child.kills++;void broker?.close().then(exited);if(!broker)exited();};
  child.stdin=new Writable({write(chunk,_encoding,done){startBroker(JSON.parse(chunk.toString()),{pty,onShutdown:exited}).then(value=>{broker=value;brokers.push(value);child.stdout.write(JSON.stringify(value.ready)+'\n');},error=>child.emit('error',error));done();}});
  children.push(child);return child;
 };
 const options={desktopSessionId:'desktop-A',root:path.join(root,'private'),catalog,encryption,runtimeRoot:path.join(root,'runtime'),dependencyRoot:root,servicePath:path.join(root,'inert-broker.mjs'),nodeExecutable:process.execPath,prepareRuntime:mockTerminalRuntime,spawn,profiles:{read:()=>structuredClone(profile)},settings:()=>({cwd:root}),current:()=>({provider:'codex',threadId:'inert-thread'}),worker:{request(){throw Error('A terminal lifecycle must never contact a worker');}},requestApi:async(d,method,route,body)=>{calls.push({instanceId:d.instanceId,method,route});return raw(d,method,route,body);}};
 return {root,rows,catalog,encryption,brokers,children,terminals,calls,options,make:(changes={})=>createSharedTerminal({...options,...changes}),local:{kind:'local',mode:'interactive'},ssh:{kind:'ssh',mode:'interactive',profileId:profile.id,version:1},scope:{provider:'codex',threadId:'inert-thread',checkCurrent:()=>true},registry:id=>path.join(options.root,'brokers-v2-'+id+'.bin')};
}

test('quit closes this desktop local and SSH PTYs/broker, revokes grants immediately and is idempotent',async t=>{
 const f=fixture(t),bridge=f.make(),local=await bridge.open(f.local),ssh=await bridge.open(f.ssh);
 await bridge.owner({sessionId:ssh.id,ownerEpoch:ssh.ownerEpoch,owner:'agent'});assert(bridge.hasCurrentGrant('codex'));
 f.catalog.put('compute-profile','saved',{credentialRef:'fixture-reference'});f.catalog.put('worker-run','submitted',{status:'running'});const preserved=f.catalog.list('worker-run');
 const first=bridge.shutdown({timeoutMs:1000}),second=bridge.shutdown();assert.equal(first,second);assert.equal(bridge.hasCurrentGrant('codex'),false);
 await assert.rejects(bridge.open(f.ssh),/terminal_context_changed/);await assert.rejects(bridge.list({}),/terminal_context_changed/);
 assert.deepEqual(await first,{status:'closed',brokers:1,unconfirmed:0});
 assert(f.terminals.every(item=>item.kills===1));assert.equal(f.children[0].exitCode,0);assert.equal(f.children[0].kills,0);
 assert.deepEqual(f.catalog.list('shared-terminal'),[]);assert.equal(f.catalog.list('shared-terminal-archive').length,2);
 assert.deepEqual(f.catalog.list('worker-run'),preserved);assert.equal(f.catalog.list('compute-profile')[0].credentialRef,'fixture-reference');
 assert.deepEqual(bridge.inUseProfileIds(),[]);assert.equal(bridge.ownsSession(local.id),false);
 const index=JSON.parse(f.encryption.decryptString(fs.readFileSync(f.registry('desktop-A'))));assert.equal(index.closed,true);assert.equal(index.desktop_session_id,'desktop-A');
});

test('a new desktop archives old sessions/pending but never probes or shuts down previous brokers',async t=>{
 const f=fixture(t),first=f.make(),old=await first.open(f.ssh);
 f.catalog.put('shared-terminal-pending','old-pending',{desktopSessionId:'desktop-A',status:'unknown',profileId:'saved-ssh'});
 fs.writeFileSync(path.join(f.options.root,'broker.bin'),'legacy encrypted fixture remains untouched');fs.writeFileSync(path.join(f.options.root,'brokers-v1.bin'),'malformed previous registry is not startup authority');
 const previous=fs.readFileSync(f.registry('desktop-A')),callCount=f.calls.length,next=f.make({desktopSessionId:'desktop-B'});
 assert.deepEqual(await next.list({}),{sessions:[]});assert.equal(f.calls.length,callCount);assert.deepEqual(next.inUseProfileIds(),[]);assert.equal(next.ownsSession(old.id),false);
 const fresh=await next.open(f.ssh);assert.notEqual(fresh.id,old.id);assert.equal(f.children.length,2);assert.equal((await next.open(f.ssh)).id,fresh.id);
 assert(!f.calls.slice(callCount).some(item=>item.instanceId===f.calls[0].instanceId));assert.equal(f.terminals[0].kills,0);
 assert(fs.readFileSync(f.registry('desktop-A')).equals(previous));assert.equal(f.catalog.list('shared-terminal-pending-archive').length,1);assert.equal(f.catalog.list('shared-terminal-archive')[0].id,old.id);
 assert.equal(fs.readFileSync(path.join(f.options.root,'broker.bin'),'utf8'),'legacy encrypted fixture remains untouched');
 await next.shutdown({timeoutMs:1000});assert.equal(f.terminals[0].kills,0,'New desktop never kills a prior desktop PTY');await first.shutdown({timeoutMs:1000});
});

test('unconfirmed open remains unreplayable within one desktop, but cannot block fresh next-launch selection',async t=>{
 const f=fixture(t);let lost=true;const bridge=f.make({requestApi:async(d,method,route,body)=>{const value=await raw(d,method,route,body);if(route==='/sessions/open'&&lost){lost=false;throw Error('lost inert receipt');}return value;}});
 await assert.rejects(bridge.open(f.ssh),/terminal_unavailable/);assert.deepEqual(bridge.inUseProfileIds(),['saved-ssh']);assert.equal(f.terminals.length,1);
 await assert.rejects(bridge.open(f.ssh),/terminal_recovery_required/);assert.equal(f.terminals.length,1);
 const reattached=f.make();await assert.rejects(reattached.open(f.ssh),/terminal_recovery_required/);assert.equal(f.terminals.length,1);assert.deepEqual(reattached.inUseProfileIds(),['saved-ssh']);
 const next=f.make({desktopSessionId:'desktop-B'});assert.deepEqual(await next.list({}),{sessions:[]});assert.deepEqual(next.inUseProfileIds(),[]);assert.equal((await next.open(f.ssh)).alive,true);assert.equal(f.terminals.length,2);
 await next.shutdown({timeoutMs:1000});await bridge.shutdown({timeoutMs:1000});
});

test('shutdown during runtime preparation prevents spawn/save and protects in-flight profile deletion',async t=>{
 const f=fixture(t),held=gate();let preparing=false;const bridge=f.make({prepareRuntime:async options=>{preparing=true;await held.promise;return mockTerminalRuntime(options);}});
 const opening=bridge.open(f.ssh).then(()=>null,error=>error);while(!preparing)await wait();assert.deepEqual(bridge.inUseProfileIds(),['saved-ssh']);
 const closing=bridge.shutdown({timeoutMs:1000});held.resolve();assert.match(String(await opening),/terminal_context_changed/);assert.deepEqual(await closing,{status:'closed',brokers:0,unconfirmed:0});
 assert.equal(f.children.length,0);assert.equal(f.terminals.length,0);assert.equal(fs.existsSync(f.registry('desktop-A')),false);assert.deepEqual(bridge.inUseProfileIds(),[]);
});

test('shutdown fences an already dispatched open reply and closes its actual created PTY',async t=>{
 const f=fixture(t),held=gate();let dispatched=false;const bridge=f.make({requestApi:async(d,method,route,body)=>{const value=await raw(d,method,route,body);if(route==='/sessions/open'){dispatched=true;await held.promise;}return value;}});
 const opening=bridge.open(f.ssh).then(()=>null,error=>error);while(!dispatched)await wait();
 const closing=bridge.shutdown({timeoutMs:1000});held.resolve();assert.match(String(await opening),/terminal_context_changed/);assert.equal((await closing).status,'closed');
 assert.equal(f.terminals[0].kills,1);assert.deepEqual(f.catalog.list('shared-terminal'),[]);assert.equal(bridge.hasCurrentGrant('codex'),false);
});

test('late Agent ownership reply after quit cannot restore a handoff grant or active row',async t=>{
 const f=fixture(t),held=gate();let changing=false;const bridge=f.make({requestApi:async(d,method,route,body)=>{const value=await raw(d,method,route,body);if(route.endsWith('/owner')&&body.owner==='agent'){changing=true;await held.promise;}return value;}}),session=await bridge.open(f.ssh);
 const owning=bridge.owner({sessionId:session.id,ownerEpoch:session.ownerEpoch,owner:'agent'}).then(()=>null,error=>error);while(!changing)await wait();
 const closing=bridge.shutdown({timeoutMs:1000});held.resolve();assert.match(String(await owning),/terminal_context_changed/);assert.equal((await closing).status,'closed');assert.equal(bridge.hasCurrentGrant('codex'),false);assert.deepEqual(f.catalog.list('shared-terminal'),[]);
});

test('bounded quit uses only its own process handle fallback and reports unconfirmed shutdown honestly',async t=>{
 const f=fixture(t),never=new Promise(()=>{}),bridge=f.make({requestApi:(d,method,route,body)=>route==='/shutdown'?never:raw(d,method,route,body)});
 await bridge.open(f.ssh);const started=Date.now(),result=await bridge.shutdown({timeoutMs:300});assert(Date.now()-started<1000);assert.equal(result.status,'unconfirmed');assert.equal(f.children[0].kills,1);assert.equal(f.terminals[0].kills,1);
 assert.deepEqual(f.catalog.list('shared-terminal'),[]);assert.equal(f.catalog.list('shared-terminal-archive')[0].shutdownStatus,'unconfirmed');
});

test('identity mismatch never sends shutdown or PID kill to a restored same-desktop descriptor',async t=>{
 const f=fixture(t),first=f.make();await first.open(f.ssh);let shutdowns=0;
 const bridge=f.make({requestApi:async(d,method,route,body)=>{if(route==='/health')return {instanceId:'different',pid:d.pid};if(route==='/shutdown')shutdowns++;return raw(d,method,route,body);}});
 const result=await bridge.shutdown({timeoutMs:300});assert.equal(result.status,'unconfirmed');assert.equal(shutdowns,0);assert.equal(f.children[0].kills,0);assert.equal(f.terminals[0].kills,0);await first.shutdown({timeoutMs:1000});
});

test('quit during a child readiness handshake discards only that empty owned broker before publication',async t=>{
 const f=fixture(t);let releaseReady;
 const bridge=f.make({spawn:(...args)=>{const child=f.options.spawn(...args),write=child.stdout.write.bind(child.stdout);child.stdout.write=bytes=>{releaseReady=()=>write(bytes);return true;};return child;}});
 const opening=bridge.open(f.ssh).then(()=>null,error=>error);while(!releaseReady)await wait();assert.deepEqual(bridge.inUseProfileIds(),['saved-ssh']);
 const closing=bridge.shutdown({timeoutMs:1000});releaseReady();assert.match(String(await opening),/terminal_context_changed/);assert.equal((await closing).status,'closed');
 assert.equal(f.children[0].exitCode,0);assert(f.children[0].kills>=1);assert.equal(f.terminals.length,0);assert.equal(fs.existsSync(f.registry('desktop-A')),false);assert.deepEqual(f.catalog.list('shared-terminal'),[]);
});

test('a read reply that arrives after quit cannot republish closed session state',async t=>{
 const f=fixture(t),held=gate();let reading=false;
 const bridge=f.make({requestApi:async(d,method,route,body)=>{const value=await raw(d,method,route,body);if(route.endsWith('/read')){reading=true;await held.promise;}return value;}}),session=await bridge.open(f.ssh);
 const read=bridge.read({sessionId:session.id,ownerEpoch:session.ownerEpoch}).then(()=>null,error=>error);while(!reading)await wait();
 assert.equal((await bridge.shutdown({timeoutMs:1000})).status,'closed');held.resolve();assert.match(String(await read),/terminal_context_changed/);assert.deepEqual(f.catalog.list('shared-terminal'),[]);assert.equal(bridge.ownsSession(session.id),false);
});

test('expired access never releases deletion protection for a current-desktop live or unknown process',t=>{
 const f=fixture(t);f.catalog.put('shared-terminal','expired-current',{desktopSessionId:'desktop-A',kind:'ssh',mode:'interactive',owner:'human',ownerEpoch:1,alive:true,expired:true,profile:{profileId:'saved-ssh',version:1}});
 f.catalog.put('shared-terminal','other-desktop',{desktopSessionId:'desktop-B',kind:'ssh',mode:'interactive',owner:'human',ownerEpoch:1,alive:true,profile:{profileId:'unrelated-old-profile',version:1}});
 const bridge=f.make();assert.deepEqual(bridge.inUseProfileIds(),['saved-ssh']);assert.equal(bridge.ownsSession('other-desktop'),false);
});
