import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {createSharedTerminal} from '../../backend/main/compute/shared-terminal.mjs';
import {startBroker} from '../../desktop/platform/terminal-service/broker.mjs';
import {mockTerminalRuntime} from '../helpers/terminal-runtime-fixture.mjs';
import {TERMINAL_RUNTIME_SCHEMA} from '../../backend/main/compute/terminal-runtime.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-terminal-recovery-')),rows=new Map(),brokers=[],terminals=[],spawns=[],requests=[];
 t.after(async()=>{await Promise.all(brokers.map(b=>b.close()));fs.rmSync(root,{recursive:true,force:true});});
 const key=randomBytes(32),encryption={isEncryptionAvailable:()=>true,encryptString(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]);},decryptString(bytes){const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');}};
 const catalog={list:kind=>[...rows].filter(([name])=>name.startsWith(kind+':')).map(([,value])=>structuredClone(value)),put(kind,id,value){rows.set(kind+':'+id,structuredClone({...value,id}));return value;},remove:(kind,id)=>rows.delete(kind+':'+id)};
 const profile={id:'saved-fixture',version:1,kind:'ssh',mode:'interactive',host:'fixture.invalid',username:'fixture-user',port:22,ssh_client:process.execPath};
 const pty={spawn(){let output,exit;const terminal={pid:1000+terminals.length,writes:[],onData:callback=>output=callback,onExit:callback=>exit=callback,write(value){terminal.writes.push(value);output(value);},resize(){},kill(){exit({exitCode:0});}};terminals.push(terminal);return terminal;}};
 const spawn=(file,args,options)=>{const child=new EventEmitter();child.pid=process.pid;child.stdout=new PassThrough();child.unref=()=>{};child.kill=()=>{};child.stdin=new Writable({write(chunk,_encoding,done){const config=JSON.parse(chunk.toString());requests.push(config);startBroker(config,{pty}).then(b=>{brokers.push(b);child.stdout.write(JSON.stringify(b.ready)+'\n');},error=>child.emit('error',error));done();}});spawns.push({file,args,options,child});return child;};
 const options={desktopSessionId:'same-desktop-fixture',root:path.join(root,'private'),catalog,encryption,prepareRuntime:mockTerminalRuntime,runtimeRoot:path.join(root,'runtime'),dependencyRoot:root,servicePath:path.join(root,'fake-broker.mjs'),nodeExecutable:process.execPath,spawn,profiles:{read:()=>structuredClone(profile)},settings:()=>({cwd:root}),current:()=>({provider:'codex',threadId:'synthetic-thread'})};
 const make=(overrides={})=>createSharedTerminal({...options,...overrides}),local={kind:'local',mode:'interactive'},ssh={kind:'ssh',mode:'interactive',profileId:profile.id,version:1};
 const registryFile=path.join(options.root,'brokers-v2-'+options.desktopSessionId+'.bin');
 const descriptor=()=>{const index=JSON.parse(encryption.decryptString(fs.readFileSync(registryFile)));return index.brokers.find(d=>d.instanceId===index.active_instance_id);};
 function legacy(){const index=JSON.parse(encryption.decryptString(fs.readFileSync(registryFile))),d=index.brokers.find(d=>d.instanceId===index.active_instance_id);delete d.runtime;fs.writeFileSync(path.join(options.root,'broker.bin'),encryption.encryptString(JSON.stringify(d)));fs.writeFileSync(registryFile,encryption.encryptString(JSON.stringify(index)));return fs.readFileSync(path.join(options.root,'broker.bin'));}
 return {root,options,make,local,ssh,brokers,spawns,requests,terminals,rows,catalog,encryption,legacy,descriptor,registryFile};
}
async function rawApi(d,method,route,body){const response=await fetch(d.origin+route,{method,headers:{Authorization:'Bearer '+d.controlToken,...body?{'Content-Type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{}});const value=await response.json();if(response.status!==200)throw Error('Synthetic request refused');return value;}

test('fresh broker uses the prepared stable paths and persists a versioned encrypted registry',async t=>{
 const f=fixture(t),bridge=f.make({prepareRuntime:async options=>({...await mockTerminalRuntime(options),nodeExecutable:path.join(f.root,'stable.exe'),servicePath:path.join(f.root,'stable','broker.mjs'),dependencyRoot:path.join(f.root,'stable','dependencies')})});
 const session=await bridge.open(f.local);assert.equal(session.alive,true);assert.equal(f.spawns[0].file,path.join(f.root,'stable.exe'));assert.equal(f.spawns[0].args[0],path.join(f.root,'stable','broker.mjs'));assert.equal(f.requests[0].dependencyRoot,path.join(f.root,'stable','dependencies'));
 const bytes=fs.readFileSync(f.registryFile),index=JSON.parse(f.encryption.decryptString(bytes));assert.equal(index.schema_version,2);assert.equal(index.desktop_session_id,f.options.desktopSessionId);assert.equal(index.brokers.length,1);assert.equal(index.brokers[0].runtime.schema,TERMINAL_RUNTIME_SCHEMA);assert(!bytes.includes(Buffer.from(f.requests[0].controlToken)));assert.equal(JSON.stringify(session).includes(f.requests[0].controlToken),false);
});

test('same-desktop nondurable sessions remain readable while explicit new intent creates a durable broker',async t=>{
 const f=fixture(t),old=f.make(),session=await old.open(f.local),original=f.legacy(),bridge=f.make();
 assert.equal((await bridge.list({})).sessions[0].sessionId,session.sessionId);await assert.rejects(bridge.open(f.ssh),/terminal_recovery_required/);assert.equal(f.spawns.length,1);
 const created=await bridge.open({...f.ssh,newConnection:true,requestId:'explicit-new-ssh'});assert.notEqual(created.sessionId,session.sessionId);assert.equal(f.spawns.length,2);assert(fs.readFileSync(path.join(f.options.root,'broker.bin')).equals(original));
 await bridge.input({sessionId:session.sessionId,ownerEpoch:session.ownerEpoch,requestId:'old-shell-input',data:'old-session-marker'});assert.match((await bridge.read({sessionId:session.sessionId,ownerEpoch:session.ownerEpoch})).output,/old-session-marker/);
 await bridge.input({sessionId:created.sessionId,ownerEpoch:created.ownerEpoch,requestId:'new-shell-input',data:'new-session-marker'});assert.match((await bridge.read({sessionId:created.sessionId,ownerEpoch:created.ownerEpoch})).output,/new-session-marker/);
 const restarted=f.make(),listed=(await restarted.list({})).sessions;assert.equal(listed.length,2);assert(listed.every(s=>s.alive));assert.equal((await restarted.open(f.ssh)).sessionId,created.sessionId);assert.equal(f.spawns.length,2);
});

test('same-desktop dead broker and unknown rows retain replay protection until explicit new request',async t=>{
 const f=fixture(t),old=f.make(),session=await old.open(f.local),original=f.legacy();await f.brokers[0].close();const bridge=f.make();
 assert.equal((await bridge.list({})).sessions[0].status,'unknown');await assert.rejects(bridge.open(f.local),/terminal_recovery_required/);assert.equal(f.spawns.length,1);
 const request={...f.local,newConnection:true,requestId:'explicit-new-local'},[one,two]=await Promise.all([bridge.open(request),bridge.open(request)]);assert.equal(one.sessionId,two.sessionId);assert.equal(f.spawns.length,2);
 const listed=(await bridge.list({})).sessions;assert.equal(listed.find(s=>s.sessionId===session.sessionId).status,'unknown');assert.equal(listed.find(s=>s.sessionId===one.sessionId).alive,true);assert(fs.readFileSync(path.join(f.options.root,'broker.bin')).equals(original));assert.equal(f.rows.size>=2,true);
});

test('explicit list retries a transient restore observation without reopening any terminal',async t=>{
 const f=fixture(t),first=f.make(),session=await first.open(f.local);let refuse=true,probes=0;
 const bridge=f.make({requestApi:async(d,method,route,body)=>{if(route==='/health'){probes++;if(refuse){refuse=false;throw Error('Synthetic transient health failure');}}return rawApi(d,method,route,body);}});
 assert.equal((await bridge.list({})).sessions[0].status,'unknown');assert.equal((await bridge.list({})).sessions[0].sessionId,session.sessionId);assert.equal((await bridge.list({})).sessions[0].alive,true);assert.equal(probes,2);assert.equal(f.spawns.length,1);assert.equal(f.terminals.length,1);
});

test('actual broker semantic ownership rejection preserves service health and other session state',async t=>{
 const f=fixture(t),bridge=f.make(),session=await bridge.open(f.local);await assert.rejects(bridge.input({sessionId:session.sessionId,ownerEpoch:session.ownerEpoch+1,requestId:'wrong-epoch',data:'never sent'}),/terminal_owner_changed/);
 assert.equal((await bridge.list({})).sessions[0].alive,true);assert.equal(f.spawns.length,1);assert.equal(f.terminals[0].writes.length,0);await bridge.input({sessionId:session.sessionId,ownerEpoch:session.ownerEpoch,requestId:'right-epoch',data:'accepted'});assert.equal(f.terminals[0].writes[0],'accepted');
});

test('one unavailable retained broker does not revoke handoff for a different healthy broker',async t=>{
 const f=fixture(t),original=f.make(),old=await original.open(f.local);f.legacy();const bridge=f.make(),fresh=await bridge.open({...f.ssh,newConnection:true,requestId:'separate-broker'});const owned=await bridge.owner({sessionId:fresh.sessionId,ownerEpoch:fresh.ownerEpoch,owner:'agent'});assert.equal(bridge.hasCurrentGrant('codex',fresh.sessionId),true);
 await f.brokers[0].close();await assert.rejects(bridge.read({sessionId:old.sessionId,ownerEpoch:old.ownerEpoch}),/terminal_unavailable/);assert.equal(bridge.hasCurrentGrant('codex',fresh.sessionId),true);assert.equal((await bridge.read({sessionId:fresh.sessionId,ownerEpoch:owned.ownerEpoch})).alive,true);
});

test('delayed open stays pinned to its own broker while a concurrent read recovers another one',async t=>{
 const f=fixture(t),oldBridge=f.make(),old=await oldBridge.open(f.local);f.legacy();let activeBroker,hold=false,refuseActive=false,release,arrived;
 const waiting=new Promise(resolve=>arrived=resolve),bridge=f.make({requestApi:async(d,method,route,body)=>{if(refuseActive&&d.instanceId===activeBroker)throw Error('Synthetic transient active broker failure');const result=await rawApi(d,method,route,body);if(route==='/sessions/open'){activeBroker=d.instanceId;if(hold){arrived();await new Promise(resolve=>release=resolve);}}return result;}});
 const first=await bridge.open({...f.ssh,newConnection:true,requestId:'first-stable'});hold=true;const pending=bridge.open({...f.ssh,newConnection:true,requestId:'delayed-open'});await waiting;refuseActive=true;await assert.rejects(bridge.read({sessionId:first.sessionId,ownerEpoch:first.ownerEpoch}),/terminal_unavailable/);assert.equal((await bridge.read({sessionId:old.sessionId,ownerEpoch:old.ownerEpoch})).alive,true);refuseActive=false;release();const created=await pending;
 assert.equal(f.rows.get('shared-terminal:'+created.sessionId).brokerId,activeBroker);assert.equal((await bridge.read({sessionId:created.sessionId,ownerEpoch:created.ownerEpoch})).alive,true);assert.equal(f.spawns.length,2);
});

test('new connection intent rejects injected fields and never becomes a model tool',async t=>{
 const f=fixture(t),bridge=f.make();for(const extra of [{newConnection:false},{newConnection:true},{newConnection:true,requestId:''},{requestId:'injected'},{newConnection:true,requestId:'x',launch:{file:'no'}}])await assert.rejects(bridge.open({...f.local,...extra}),/terminal_invalid_request/);
 assert.deepEqual(bridge.tools().map(s=>s.name),['list_shared_terminals','read_shared_terminal','write_shared_terminal']);assert.equal(f.spawns.length,0);
});

test('replaying a completed explicit intent returns the same exited session instead of spawning again',async t=>{
 const f=fixture(t),bridge=f.make(),intent={...f.local,newConnection:true,requestId:'one-deliberate-attempt'},first=await bridge.open(intent);await bridge.close({sessionId:first.sessionId});
 // Closing removes an intentionally disposed row; use actual process exit rather than close for replay.
 const secondIntent={...f.local,newConnection:true,requestId:'fast-exiting-attempt'},second=await bridge.open(secondIntent);f.terminals.at(-1).kill();const total=f.terminals.length,replayed=await bridge.open(secondIntent);assert.equal(replayed.sessionId,second.sessionId);assert.equal(replayed.alive,false);assert.equal(f.terminals.length,total);
});

test('unknown registry schema fails closed without overwriting legacy or creating a broker',async t=>{
 const f=fixture(t),old=f.make();await old.open(f.local);const legacy=f.legacy(),file=f.registryFile,malformed=f.encryption.encryptString(JSON.stringify({schema_version:999,brokers:[]}));fs.writeFileSync(file,malformed);
 const bridge=f.make();await assert.rejects(bridge.list({}),/terminal_unavailable/);await assert.rejects(bridge.open({...f.local,newConnection:true,requestId:'never-start'}),/terminal_unavailable/);assert(fs.readFileSync(file).equals(malformed));assert(fs.readFileSync(path.join(f.options.root,'broker.bin')).equals(legacy));assert.equal(f.spawns.length,1);
});

test('failed bootstrap cleans only its owned empty child and does not publish a connection attempt',async t=>{
 const f=fixture(t);let kills=0;const bridge=f.make({readyTimeoutMs:10,spawn(){const child=new EventEmitter();child.pid=process.pid;child.stdout=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{kills++;};child.unref=()=>{};return child;}});
 await assert.rejects(bridge.open(f.ssh),/terminal_start_failed/);assert.equal(kills,1);assert.equal(f.terminals.length,0);assert.equal(f.catalog.list('shared-terminal-pending').length,0);assert.equal(fs.existsSync(f.registryFile),false);
});
