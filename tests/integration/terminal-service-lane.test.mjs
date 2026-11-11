import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createHash,randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {createTerminalSession} from '../../desktop/platform/terminal-service/session.mjs';
import {startBroker} from '../../desktop/platform/terminal-service/broker.mjs';
import {createSharedTerminal} from '../../backend/main/compute/shared-terminal.mjs';
import {mockTerminalRuntime} from '../helpers/terminal-runtime-fixture.mjs';

const PREFIX='__STUDIO_SERVICE_V1__:';
const health={name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',root:'/owned/worker',runtime:'/owned/worker/runtimes/fixed',runtime_id:'a'.repeat(20),hostname:'fixture-host',uid:1000,machineId:'f'.repeat(32),port:8767,transport_kind:'ssh-pty'};
const bootstrap={source:'print("inert source, never executed by this fixture")',payload:{files:[],fixture:'x'.repeat(10000)}};
const plan=(kind='ssh')=>({kind,mode:'interactive',name:'Owned inert SSH route',launch:{file:path.resolve('inert-shell'),args:[],cwd:process.cwd()}});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function ptyFixture({auto=true,reply=true,stop=true,resume=true,replyBytes=20000}={}){
 let output,exit,nonce;const requests=[],writes=[],resizes=[];
 const frame=(kind,id,value,n=nonce)=>PREFIX+n+':'+kind+':'+id+':'+Buffer.from(JSON.stringify(value)).toString('base64')+'\n';
 const send=(kind,id,value,n)=>output(frame(kind,id,value,n));
 const fragmented=(kind,id,value)=>{const bytes=Buffer.from(JSON.stringify(value));for(let i=0;i<bytes.length;i+=96)send('FRAGMENT',id,{kind,index:i/96,last:i+96>=bytes.length,chunk:bytes.subarray(i,i+96).toString('base64')});};
 const child={pid:8123,kills:0,onData:f=>output=f,onExit:f=>exit=f,resize:(...v)=>resizes.push(v),kill(){child.kills++;exit({exitCode:0});},write(text){
  writes.push(text);if(text.startsWith('python3 ')){nonce=/'([a-f0-9]{64})'\r$/.exec(text)?.[1];assert(nonce);if(auto)queueMicrotask(()=>send('BOOTSTRAP_READY','-',{protocol:1}));return;}
  if(text.startsWith('printf ')){const marker=/'(STUDIO_TERMINAL_RESUMED_[a-f0-9]{32})'\r$/.exec(text)?.[1];assert(marker);if(resume)queueMicrotask(()=>output('\x1b[2J\x1b[3J\x1b[H'+marker+'\r\nnormal restored prompt'));return;}
  const [marker,n,kind,id,encoded]=text.trimEnd().split(':');assert.equal(marker,PREFIX.slice(0,-1));assert.equal(n,nonce);const value=JSON.parse(Buffer.from(encoded,'base64'));
  if(kind==='INSTALL'){requests.push({kind,id,value});queueMicrotask(()=>send('ACK',id,{accepted:Number(id)}));}
  if(kind==='INSTALL_END'){const installed=Buffer.concat(requests.filter(v=>v.kind==='INSTALL').map(v=>Buffer.from(v.value.chunk,'base64')));assert.equal(value.size,installed.length);assert.equal(value.sha256,createHash('sha256').update(installed).digest('hex'));assert.deepEqual(JSON.parse(installed),bootstrap.payload);queueMicrotask(()=>{output('PRIVATE_BOOTSTRAP_TOKEN\r\n');fragmented('READY','-',health);});}
  if(kind==='REQUEST'){requests.push({kind,id,value});if(reply)queueMicrotask(()=>fragmented('RESPONSE',id,{status:200,data:{echo:value.target,private:'PRIVATE_WORKER_RESPONSE',large:'z'.repeat(replyBytes)}}));}
  if(kind==='STOP'&&stop)queueMicrotask(()=>send('STOPPED',id,{}));
 }};
 const pty={spawn:()=>child};
 return {pty,child,writes,requests,resizes,send,fragmented,output:text=>output(text),get nonce(){return nonce;},setReply:value=>reply=value};
}
function fixture(options={}){const f=ptyFixture(options);const session=createTerminalSession({pty:f.pty,plan:plan(),serviceTimeouts:{start:50,request:50,stop:50,...options.timeouts}});return {...f,session};}
const start=f=>f.session.serviceStart({ownerEpoch:1,requestId:'owned-start',bootstrap});
const request=(f,serviceId,requestId='owned-request')=>f.session.serviceRequest({serviceId,requestId,method:'POST',target:'/api/authoring/context',data:{workspace_id:'owned'},mcp:false});

test('same PTY service handshake/upload/reply stays private, reserves input and restores shell only after STOPPED',async()=>{
 const f=fixture();try{
  f.output('human authentication history\r\n');const initial=f.session.state(),pending=start(f);assert.equal(f.session.state().serviceActive,true);assert.equal(f.session.state().ownerEpoch,2);
  assert.throws(()=>f.session.input({actor:'human',ownerEpoch:2,requestId:'interleave',data:'do not send'}),/service_active/);assert.throws(()=>f.session.owner({owner:'agent',ownerEpoch:2,scope:{provider:'codex',threadId:'thread'}}),/service_active/);assert.throws(()=>f.session.resize({actor:'human',ownerEpoch:2,cols:80,rows:24}),/service_active/);
  const connected=await pending;assert.equal(connected.serviceStatus,'connected');assert.deepEqual(connected.service,health);assert.deepEqual(f.resizes[0],[500,30]);assert.equal(f.session.state().sequence,initial.sequence);
  const result=await request(f,connected.serviceId);assert.equal(result.data.large.length,20000);assert.equal(result.data.echo,'/api/authoring/context');assert.equal(f.requests.filter(v=>v.kind==='REQUEST').length,1);
  const visible=f.session.read({actor:'human',ownerEpoch:2}).chunks.map(v=>v.data).join('');assert.equal(visible,'human authentication history\r\n');assert(!JSON.stringify(f.session.state()).includes('PRIVATE_'));assert(!JSON.stringify(f.session.state()).includes(f.nonce));
  const disconnected=await f.session.serviceStop({serviceId:connected.serviceId});assert.equal(disconnected.serviceStatus,'disconnected');assert.equal(f.session.state().serviceActive,false);assert.deepEqual(f.resizes.at(-1),[100,30]);f.output('normal shell prompt');assert(f.session.read({actor:'human',ownerEpoch:3}).chunks.some(v=>v.data==='normal shell prompt'));
 }finally{f.session.dispose();}
});

test('duplicate connect and identical mutation retry do not send a second bootstrap or request',async()=>{
 const f=fixture();try{const one=start(f),two=start(f);assert.equal(one,two);const ready=await one;assert.equal(f.writes.filter(v=>v.startsWith('python3 ')).length,1);const a=request(f,ready.serviceId),b=request(f,ready.serviceId);assert.equal(a,b);assert.deepEqual(await a,await b);await assert.rejects(async()=>f.session.serviceRequest({serviceId:ready.serviceId,requestId:'owned-request',method:'POST',target:'/api/authoring/context',data:{changed:true},mcp:false}),/request_changed/);assert.equal(f.requests.filter(v=>v.kind==='REQUEST').length,1);}finally{f.session.dispose();}
});

test('unknown bootstrap and mutation never replay and keep subsequent private output out of the public ring',async()=>{
 const a=fixture({auto:false});try{await assert.rejects(start(a),/service_start_unknown/);const count=a.writes.length;await assert.rejects(start(a),/service_start_unknown/);assert.equal(a.writes.length,count);a.output('PRIVATE_AFTER_UNKNOWN\n');assert.equal(a.session.state().serviceActive,true);assert.deepEqual(a.session.read({actor:'human',ownerEpoch:2}).chunks,[]);}finally{a.session.dispose();}
 const b=fixture({reply:false});try{const ready=await start(b);await assert.rejects(request(b,ready.serviceId),/service_request_unknown/);assert.throws(()=>request(b,ready.serviceId),/service_unavailable/);assert.equal(b.requests.filter(v=>v.kind==='REQUEST').length,1);b.output('PRIVATE_LATE_TOKEN\n');assert.deepEqual(b.session.read({actor:'human',ownerEpoch:2}).chunks,[]);}finally{b.session.dispose();}
});

test('bad nonce, reordered fragments and unconfirmed stop cannot expose output or release input',async()=>{
 const f=fixture({auto:false,stop:false});try{const pending=start(f);f.send('READY','-',health,'b'.repeat(64));assert.equal(f.session.serviceState().serviceStatus,'connecting');f.send('BOOTSTRAP_READY','-',{protocol:1});await pending;f.send('FRAGMENT','unknown',{kind:'RESPONSE',index:1,last:true,chunk:Buffer.from('{}').toString('base64')});assert.equal(f.session.serviceState().serviceStatus,'failed');await assert.rejects(f.session.serviceStop({serviceId:f.session.serviceState().serviceId}),/service_stop_unknown/);f.output('PRIVATE_STOP_FAILURE\n');assert.equal(f.session.state().serviceActive,true);assert.deepEqual(f.session.read({actor:'human',ownerEpoch:2}).chunks,[]);}finally{f.session.dispose();}
});

test('shell startup control prefix and CRLF translation cannot hide the nonce-bearing bootstrap handshake',async()=>{
 const f=fixture({auto:false});try{const pending=start(f);f.output('\x1b[?2004l\r');f.send('BOOTSTRAP_READY','-',{protocol:1});const ready=await pending;assert.equal(ready.serviceStatus,'connected');const stopping=f.session.serviceStop({serviceId:ready.serviceId});await stopping;assert.equal(f.session.state().serviceActive,false);}finally{f.session.dispose();}
});

test('STOPPED alone and echoed resume command cannot release privacy before screen redraw and exact shell output fence',async()=>{
 const f=fixture({resume:false,timeouts:{stop:500}});try{
  const ready=await start(f),stopping=f.session.serviceStop({serviceId:ready.serviceId});let outcome;stopping.then(()=>outcome='done',()=>outcome='failed');
  while(!f.writes.some(text=>text.startsWith('printf ')))await turn();assert.equal(f.session.state().serviceActive,true);assert.equal(outcome,undefined);
  f.send('FRAGMENT','old-repainted-request',{kind:'RESPONSE',index:0,last:true,chunk:Buffer.from('{"data":"PRIVATE_SCREEN_REPAINT"}').toString('base64')});
  const command=f.writes.find(text=>text.startsWith('printf ')),marker=/'(STUDIO_TERMINAL_RESUMED_[a-f0-9]{32})'\r$/.exec(command)[1];f.output(command+'\n');await turn();assert.equal(outcome,undefined);assert.equal(f.session.state().serviceActive,true);
  assert.throws(()=>f.session.input({actor:'human',ownerEpoch:2,requestId:'too-soon',data:'x'}),/service_active/);assert.deepEqual(f.session.read({actor:'human',ownerEpoch:2}).chunks,[]);
  f.output('\x1b[2J\x1b[3J\x1b[H'+marker+'\r\nPUBLIC_RESTORED_PROMPT');await stopping;assert.equal(f.session.state().serviceActive,false);assert.equal(f.session.read({actor:'human',ownerEpoch:3}).chunks.map(v=>v.data).join(''),'PUBLIC_RESTORED_PROMPT');
 }finally{f.session.dispose();}
});

test('stop discards remaining fragments of its already canceled request and preserves the original stop promise',async()=>{
 const f=fixture({reply:false,stop:false});try{
  const ready=await start(f),pending=request(f,ready.serviceId);pending.catch(()=>{});f.send('FRAGMENT','owned-request',{kind:'RESPONSE',index:0,last:false,chunk:Buffer.from('{"status":200,"data":"').toString('base64')});
  const stopping=f.session.serviceStop({serviceId:ready.serviceId});f.send('FRAGMENT','owned-request',{kind:'RESPONSE',index:1,last:true,chunk:Buffer.from('PRIVATE_CANCELED_TAIL"}').toString('base64')});f.send('RESPONSE','owned-request',{status:200,data:'PRIVATE_CANCELED_DUPLICATE'});
  const stopId=f.writes.find(text=>text.includes(':STOP:')).split(':')[3];f.send('STOPPED',stopId,{});await stopping;await assert.rejects(pending,/service_disconnected/);assert.equal(f.session.state().serviceActive,false);assert(!f.session.read({actor:'human',ownerEpoch:3}).chunks.some(chunk=>chunk.data.includes('PRIVATE_')));
 }finally{f.session.dispose();}
});

test('public redraw hides only this session exact resume marker across chunks and preserves other text',async()=>{
 const f=fixture();try{const ready=await start(f);await f.session.serviceStop({serviceId:ready.serviceId});const marker=/'(STUDIO_TERMINAL_RESUMED_[a-f0-9]{32})'\r$/.exec(f.writes.find(text=>text.startsWith('printf ')))[1],before=f.session.state().sequence;
  f.output('前文 '+marker.slice(0,19));f.output(marker.slice(19,43));f.output(marker.slice(43)+' 后文 🌱\r\nSTUDIO_TERMINAL_RESUMED_user-output\r\n');
  const output=f.session.read({actor:'human',ownerEpoch:3,cursor:before}).chunks.map(v=>v.data).join('');assert.equal(output,'前文  后文 🌱\r\nSTUDIO_TERMINAL_RESUMED_user-output\r\n');assert(!output.includes(marker));
 }finally{f.session.dispose();}
});

test('ordinary marker-prefix text is flushed promptly and before human input, without being removed',async()=>{
 const f=fixture();try{const ready=await start(f);await f.session.serviceStop({serviceId:ready.serviceId});const before=f.session.state().sequence;f.output('S');await new Promise(resolve=>setTimeout(resolve,120));assert.equal(f.session.read({actor:'human',ownerEpoch:3,cursor:before}).chunks.map(v=>v.data).join(''),'S');
  const next=f.session.state().sequence;f.output('STUDIO_');f.child.write=text=>f.writes.push(text);f.session.input({actor:'human',ownerEpoch:3,requestId:'ordinary-input',data:'x'});assert.equal(f.session.read({actor:'human',ownerEpoch:3,cursor:next}).chunks.map(v=>v.data).join(''),'STUDIO_');
 }finally{f.session.dispose();}
});

test('a natural terminal exit flushes a short ordinary output prefix rather than dropping it',async()=>{
 const f=fixture();try{const ready=await start(f);await f.session.serviceStop({serviceId:ready.serviceId});const before=f.session.state().sequence;f.output('STUDIO_');f.child.kill();assert.equal(f.session.read({actor:'human',ownerEpoch:3,cursor:before}).chunks.map(v=>v.data).join(''),'STUDIO_');}finally{f.session.dispose();}
});

test('held human output is flushed below the new Agent handoff floor before its display timer fires',async()=>{
 const f=fixture();try{const ready=await start(f);await f.session.serviceStop({serviceId:ready.serviceId});f.output('S');const scope={provider:'codex',threadId:'new-owned-conversation'},handed=f.session.owner({owner:'agent',ownerEpoch:3,scope});assert.equal(handed.ownerEpoch,4);assert.deepEqual(f.session.read({actor:'agent',ownerEpoch:4,scope}).chunks,[]);await new Promise(resolve=>setTimeout(resolve,120));assert.deepEqual(f.session.read({actor:'agent',ownerEpoch:4,scope}).chunks,[]);assert(f.session.read({actor:'human',ownerEpoch:4}).chunks.map(v=>v.data).join('').endsWith('S'));}finally{f.session.dispose();}
});

test('stale service id, non-human owner, non-SSH kind and malformed targets cannot dispatch',async()=>{
 const f=fixture();try{f.session.owner({owner:'agent',ownerEpoch:1,scope:{provider:'codex',threadId:'owned'}});assert.throws(()=>f.session.serviceStart({ownerEpoch:2,requestId:'bad-owner',bootstrap}),/agent_owns_session/);assert.equal(f.writes.length,0);f.session.owner({owner:'human',ownerEpoch:2});const ready=await f.session.serviceStart({ownerEpoch:3,requestId:'current-owner',bootstrap});for(const target of ['https://remote.invalid/api/test','//evil/api/test','/api/test#fragment','/mcp'])assert.throws(()=>f.session.serviceRequest({serviceId:ready.serviceId,requestId:'bad-target',method:'POST',target,mcp:false}),/invalid_request/);assert.throws(()=>request(f,'stale-service'),/service_changed/);assert.equal(f.requests.filter(v=>v.kind==='REQUEST').length,0);}finally{f.session.dispose();}
 const local=ptyFixture(),session=createTerminalSession({pty:local.pty,plan:plan('local')});try{assert.throws(()=>session.serviceStart({ownerEpoch:1,requestId:'not-ssh',bootstrap}),/service_requires_ssh/);assert.equal(local.writes.length,0);}finally{session.dispose();}
});

test('normal terminal close rejects pending service requests and kills only the owned SSH PTY',async()=>{
 const f=fixture({reply:false});const ready=await start(f),pending=request(f,ready.serviceId);f.session.close({actor:'human',ownerEpoch:2});await assert.rejects(pending,/service_disconnected/);assert.equal(f.child.kills,1);assert.equal(f.session.state().serviceActive,false);assert.equal(f.session.state().alive,false);
});

test('real broker HTTP protects service routes with its control token and exposes only safe terminal state',async()=>{
 const f=ptyFixture(),token='c'.repeat(64),broker=await startBroker({controlToken:token,instanceId:randomUUID(),runtimeRoot:process.cwd(),dependencyRoot:process.cwd()},{pty:f.pty});
 const call=async(route,body,auth=token)=>{const response=await fetch(broker.ready.origin+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+auth,...body===undefined?{}:{'Content-Type':'application/json'}},...body===undefined?{}:{body:JSON.stringify(body)}});return {status:response.status,value:await response.json()};};
 try{const opened=(await call('/sessions/open',plan())).value,base='/sessions/'+opened.id;assert.equal((await call(base+'/service/start',{ownerEpoch:1,requestId:'denied',bootstrap},'wrong')).status,403);assert.equal(f.writes.length,0);const ready=await call(base+'/service/start',{ownerEpoch:1,requestId:'http-start',bootstrap});assert.equal(ready.status,200);assert.equal(ready.value.serviceStatus,'connected');assert.equal((await call(base+'/input',{actor:'human',ownerEpoch:2,requestId:'raw',data:'x'})).status,423);const result=await call(base+'/service/request',{serviceId:ready.value.serviceId,requestId:'http-request',method:'GET',target:'/api/health',mcp:false});assert.equal(result.status,200);assert.equal(result.value.data.large.length,20000);const listed=(await call('/sessions')).value.sessions;assert.equal(listed[0].serviceActive,true);assert(!JSON.stringify(listed).includes('PRIVATE_'));const read=(await call(base+'/read',{actor:'human',ownerEpoch:2})).value;assert.deepEqual(read.chunks,[]);assert.equal((await call(base+'/service/stop',{serviceId:ready.value.serviceId})).value.serviceActive,false);}finally{await broker.close();}
});

function mainFixture(t,ptyOptions={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-service-lane-')),rows=new Map(),brokers=[],children=[],f=ptyFixture(ptyOptions),key=randomBytes(32);
 const catalog={get:(kind,id)=>structuredClone(rows.get(kind+':'+id)),list:kind=>[...rows].filter(([name])=>name.startsWith(kind+':')).map(([,value])=>structuredClone(value)),put:(kind,id,value)=>rows.set(kind+':'+id,structuredClone(value)),remove:(kind,id)=>rows.delete(kind+':'+id)};
 const encryption={isEncryptionAvailable:()=>true,encryptString(text){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]);},decryptString(bytes){const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');}};
 let profile={id:'saved-fixture',version:1,kind:'ssh',mode:'interactive',host:'fixture.invalid',username:'fixture',port:22,ssh_client:process.execPath},connection;
 const options={desktopSessionId:'owned-desktop',root:path.join(root,'private'),runtimeRoot:path.join(root,'runtime'),dependencyRoot:root,servicePath:path.join(root,'inert-broker.mjs'),nodeExecutable:process.execPath,prepareRuntime:mockTerminalRuntime,catalog,encryption,settings:()=>({cwd:root}),profiles:{read:()=>structuredClone(profile)},current:()=>({provider:'codex',threadId:'owned-thread'}),worker:{request:()=>assert.fail('No WSL worker or second SSH')},spawn:()=>{
  const child=new EventEmitter();child.pid=process.pid;child.stdout=new PassThrough();child.unref=()=>{};let broker;const exited=()=>{child.exitCode=0;child.emit('exit',0);};
  child.kill=()=>{void broker?.close().then(exited);};child.stdin=new Writable({write(bytes,_encoding,done){startBroker(JSON.parse(bytes.toString()),{pty:f.pty,onShutdown:exited,serviceTimeouts:{start:1000,request:1000,stop:1000}}).then(value=>{broker=value;brokers.push(value);child.stdout.write(JSON.stringify(value.ready)+'\n');});done();}});children.push(child);return child;
 }};
 const make=changes=>{connection=createSharedTerminal({...options,...changes});return connection;};
 t.after(async()=>{await connection?.shutdown({timeoutMs:1000});await Promise.all(brokers.map(value=>value.close()));fs.rmSync(root,{recursive:true,force:true});});
 return {...f,rows,options,make,children,setProfile:value=>profile={...profile,...value},open:bridge=>bridge.open({kind:'ssh',mode:'interactive',profileId:profile.id,version:profile.version}),connect:(bridge,session,requestId='main-start')=>bridge.connectService({sessionId:session.id,ownerEpoch:session.ownerEpoch,profileId:profile.id,profileVersion:profile.version,requestId},bootstrap)};
}

test('main-only bridge connects saved SSH and carries a >1MiB private reply without leaking to terminal/catalog/MCP',async t=>{
 const f=mainFixture(t,{replyBytes:1100000}),bridge=f.make(),session=await f.open(bridge),ready=await f.connect(bridge,session);
 assert.equal(ready.status,'connected');assert.equal(ready.profileId,'saved-fixture');assert.equal(ready.ownerEpoch,2);assert(ready.serviceId);assert.equal(f.children.length,1);assert.equal(f.writes.filter(value=>value.startsWith('python3 ')).length,1);
 const result=await bridge.serviceRequest({sessionId:session.id,serviceId:ready.serviceId,requestId:'large-private',method:'GET',target:'/api/health'});assert.equal(result.data.large.length,1100000);
 const state=await bridge.serviceState({sessionId:session.id});assert.equal(state.service.runtime_id,health.runtime_id);assert.equal(state.status,'connected');assert.equal((await bridge.list({})).sessions[0].serviceActive,true);
 const read=await bridge.read({sessionId:session.id,ownerEpoch:2});assert.equal(read.output,'');assert(!JSON.stringify([...f.rows.values()]).includes('PRIVATE_'));assert(!JSON.stringify([...f.rows.values()]).includes('owned/worker'));
 await assert.rejects(bridge.callTool('connectService',{}, {provider:'codex',threadId:'owned-thread',checkCurrent:()=>true}),/unknown_operation/);await assert.rejects(bridge.input({sessionId:session.id,ownerEpoch:2,requestId:'raw-input',data:'x'}),/terminal_service_active/);
 const stopped=await bridge.disconnectService({sessionId:session.id,serviceId:ready.serviceId});assert.equal(stopped.status,'disconnected');assert.equal(stopped.serviceActive,false);
 await assert.rejects(bridge.serviceRequest({sessionId:session.id,serviceId:ready.serviceId,requestId:'after-disconnect',method:'GET',target:'/api/health'}),/terminal_service_changed/);
});

test('main reservation fences raw input before its first async read and never grants an Agent service bootstrap',async t=>{
 const f=mainFixture(t,{auto:false}),bridge=f.make(),session=await f.open(bridge),pending=f.connect(bridge,session);await assert.rejects(bridge.input({sessionId:session.id,ownerEpoch:1,requestId:'race-input',data:'x'}),/terminal_service_active/);
 while(!f.writes.some(value=>value.startsWith('python3 ')))await turn();f.send('BOOTSTRAP_READY','-',{protocol:1});const ready=await pending;assert.equal(ready.status,'connected');
 await bridge.disconnectService({sessionId:session.id,serviceId:ready.serviceId});const handed=await bridge.owner({sessionId:session.id,ownerEpoch:3,owner:'agent'});assert(bridge.hasCurrentGrant('codex'));const count=f.writes.length;
 await assert.rejects(f.connect(bridge,handed,'no-agent-bootstrap'),/terminal_human_owned/);assert.equal(bridge.hasCurrentGrant('codex'),false);assert.equal(f.writes.length,count);
});

test('lost start receipt accepts only the same explicit identity without another bootstrap or epoch reset',async t=>{
 const f=mainFixture(t);let lose=true;
 const bridge=f.make({requestApi:async(d,method,route,body)=>{const response=await fetch(d.origin+route,{method,headers:{Authorization:'Bearer '+d.controlToken,...body===undefined?{}:{'Content-Type':'application/json'}},...body===undefined?{}:{body:JSON.stringify(body)}});const value=await response.json();if(response.status!==200)throw Error('terminal_service_unknown');if(route.endsWith('/service/start')&&lose){lose=false;const error=Error('terminal_service_unknown');error.terminalRejected=true;throw error;}return value;}}),session=await f.open(bridge);
 await assert.rejects(f.connect(bridge,session),/terminal_service_unknown/);const ready=await f.connect(bridge,session);assert.equal(ready.status,'connected');assert.equal(ready.ownerEpoch,2);assert.equal(f.writes.filter(value=>value.startsWith('python3 ')).length,1);
 await assert.rejects(bridge.connectService({sessionId:session.id,ownerEpoch:1,profileId:'saved-fixture',profileVersion:1,requestId:'main-start'},{...bootstrap,payload:{changed:true}}),/terminal_invalid_request/);
});

test('late connection completion cannot publish after profile change or normal desktop quit',async t=>{
 const f=mainFixture(t,{auto:false}),bridge=f.make(),session=await f.open(bridge),pending=f.connect(bridge,session);pending.catch(()=>{});while(!f.writes.some(value=>value.startsWith('python3 ')))await turn();f.setProfile({version:2});f.send('BOOTSTRAP_READY','-',{protocol:1});await assert.rejects(pending,/terminal_saved_connection_changed/);assert.equal(f.child.kills,0);
 const result=await bridge.shutdown({timeoutMs:1000});assert.equal(result.status,'closed');assert.equal(f.child.kills,1);assert.deepEqual(bridge.inUseProfileIds(),[]);await assert.rejects(bridge.serviceState({sessionId:session.id}),/terminal_context_changed/);
});

test('main V2 startup returns confirmed failure diagnostics and recovered shell instead of losing them in a generic exception',async t=>{
 const f=mainFixture(t,{auto:false}),bridge=f.make(),session=await f.open(bridge),content=Buffer.from('owned worker fixture\n'),manifest=createHash('sha256').update('worker.py').update(content).digest('hex'),transport='fixed transport source\n';
 const v2={source:'fixed loader source\n',payload:{schema_version:1,profile_id:'saved-fixture',port:28761,expected_runtime_id:manifest.slice(0,20),files:[{path:'worker.py',size:content.length,sha256:createHash('sha256').update(content).digest('hex'),base64:content.toString('base64')}]},transport:{source:transport,sha256:createHash('sha256').update(transport).digest('hex')}};
 const args={sessionId:session.id,ownerEpoch:1,profileId:'saved-fixture',profileVersion:1,requestId:'safe-v2-failure'},pending=bridge.connectService(args,v2);while(!f.writes.some(value=>value.startsWith('python3 ')))await turn();
 f.send('ERROR','-',{code:'python_unsupported',phase:'waiting_python',python:[3,9,18]});f.send('EXITED','-',{reason:'failed'});const failed=await pending;
 assert.equal(failed.status,'failed');assert.equal(failed.serviceActive,false);assert.equal(failed.terminalAccess,'available');assert.deepEqual(failed.error,{code:'python_unsupported',phase:'waiting_python',python:[3,9,18]});assert.equal(failed.ownerEpoch,3);assert.equal(failed.phase,'returning_terminal');assert.equal((await bridge.serviceState({sessionId:session.id})).error.code,'python_unsupported');
 assert(!JSON.stringify(failed).includes(f.nonce));assert.equal(f.writes.filter(value=>value.startsWith('python3 ')).length,1);const repeated=await bridge.connectService(args,v2);assert.deepEqual(repeated,failed);assert.equal(f.writes.filter(value=>value.startsWith('python3 ')).length,1);
 f.child.write=text=>f.writes.push(text);const input=await bridge.input({sessionId:session.id,ownerEpoch:3,requestId:'human-after-confirmed-failure',data:'x'});assert.equal(input.accepted,true);
});

test('main cancel-start fences both the pre-state await and a delayed start POST before any bootstrap dispatch',async t=>{
 for(const at of ['state','post']){
  const f=mainFixture(t,{auto:false});let hold=false,release;
  const bridge=f.make({requestApi:async(d,method,route,body)=>{if(hold&&(at==='state'&&method==='GET'&&/\/[^/]+\/state$/.test(route)&&!route.includes('/service/')||at==='post'&&route.endsWith('/service/start'))){hold=false;await new Promise(resolve=>release=resolve);}const r=await fetch(d.origin+route,{method,headers:{Authorization:'Bearer '+d.controlToken,...body===undefined?{}:{'Content-Type':'application/json'}},...body===undefined?{}:{body:JSON.stringify(body)}}),value=await r.json();if(r.status!==200){const e=Error(value.error==='service_start_cancelled'?'terminal_service_changed':'terminal_service_unknown');e.terminalRejected=true;throw e;}return value;}}),opened=await f.open(bridge);hold=true;const pending=f.connect(bridge,opened,'cancel-'+at);pending.catch(()=>{});while(!release)await turn();
  const cancelled=await bridge.cancelServiceStart({sessionId:opened.id,requestId:'cancel-'+at});assert.equal(cancelled.cancelled,true);assert.equal(cancelled.cancelledAttemptId,'cancel-'+at);assert.equal(cancelled.serviceActive,false);assert.equal(cancelled.terminalAccess,'available');assert.equal(f.writes.length,0);release();await assert.rejects(pending,/terminal_(context|service)_changed/);assert.equal(f.writes.length,0);const repeated=await bridge.cancelServiceStart({sessionId:opened.id,requestId:'cancel-'+at});assert.deepEqual(repeated,cancelled);await assert.rejects(f.connect(bridge,opened,'cancel-'+at),/terminal_service_changed/);await bridge.shutdown({timeoutMs:1000});
 }
});

test('main cancel-start after dispatch stops that attempt and cannot stop a newer active attempt',async t=>{
 const f=mainFixture(t,{auto:false}),bridge=f.make(),opened=await f.open(bridge),pending=f.connect(bridge,opened,'started-cancel');pending.catch(()=>{});while(!f.writes.some(v=>v.startsWith('python3 ')))await turn();const cancelled=await bridge.cancelServiceStart({sessionId:opened.id,requestId:'started-cancel'});await assert.rejects(pending,/terminal_(service_unavailable|context_changed)/);assert.equal(cancelled.cancelledAttemptId,'started-cancel');assert.equal(cancelled.attemptId,'started-cancel');assert.equal(cancelled.serviceActive,false);
 const newState=(await bridge.list({})).sessions.find(v=>v.id===opened.id),reconnect=f.connect(bridge,newState,'newer-current');while(f.writes.filter(v=>v.startsWith('python3 ')).length<2)await turn();f.send('BOOTSTRAP_READY','-',{protocol:1});const ready=await reconnect,stopCount=f.writes.filter(v=>v.includes(':STOP:')).length;
 const old=await bridge.cancelServiceStart({sessionId:opened.id,requestId:'started-cancel'});assert.equal(old.cancelledAttemptId,'started-cancel');assert.equal(f.writes.filter(v=>v.includes(':STOP:')).length,stopCount);const current=await bridge.serviceState({sessionId:opened.id});assert.equal(current.attemptId,'newer-current');assert.equal(current.serviceId,ready.serviceId);assert.equal(current.serviceActive,true);
});
