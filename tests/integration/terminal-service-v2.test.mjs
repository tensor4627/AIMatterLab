import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createTerminalSession} from '../../desktop/platform/terminal-service/session.mjs';
import {startBroker} from '../../desktop/platform/terminal-service/broker.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const health={name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',root:'/owned/worker',runtime:'/owned/worker/runtimes/fixed',runtime_id:'',hostname:'fixture-host',uid:1000,machineId:'f'.repeat(32),port:28761,transport_kind:'ssh-pty'};
function bootstrap({transport='print("fixed transport")\n',source='print("fixed loader")\n',content='fixed worker source\n'.repeat(3000)}={}){
 const bytes=Buffer.from(content),files=[{path:'worker.py',size:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')}],runtime=createHash('sha256').update('worker.py').update(bytes).digest('hex');
 return {source,payload:{schema_version:1,profile_id:'owned-profile',port:28761,expected_runtime_id:runtime.slice(0,20),files},transport:{source:transport,sha256:hash(transport)}};
}
function fixture({transportCached=true,workerCached=true,auto=true,ack=true,resume=true,stop=true,failAt,sourceOptions,timeouts={}}={}){
 const trusted=bootstrap(sourceOptions),writes=[],uploads=[],resizes=[];let output,exit,nonce,hello,parts=[];
 const frame=(kind,id,value,n=nonce)=>'__STUDIO_SERVICE_V1__:'+n+':'+kind+':'+id+':'+Buffer.from(JSON.stringify(value)).toString('base64')+'\r\n';
 const send=(kind,id,value,n)=>output(frame(kind,id,value,n));
 const emitFailure=()=>{send('ERROR','-',{code:'permission_denied',phase:'checking_cache',errno:13,python:[3,11,9],sqlite:[3,37,2]});send('EXITED','-',{reason:'failed'});};
 const workerCheck=()=>{if(workerCached){send('WORKER_READY','-',{cached:true});send('PHASE','-',{phase:'starting_worker'});send('READY','-',{...health,runtime_id:trusted.payload.expected_runtime_id});}else{parts=[];send('WORKER_NEEDED','-',{});}};
 const child={pid:7123,kills:0,onData:fn=>output=fn,onExit:fn=>exit=fn,resize:(...size)=>resizes.push(size),kill(){child.kills++;exit({exitCode:0});},write(text){
  writes.push(text);
  if(text.startsWith('python3 ')){nonce=/'([a-f0-9]{64})'\r$/.exec(text)?.[1];assert(nonce);if(auto)queueMicrotask(()=>{if(failAt==='preflight'){send('ERROR','-',{code:'python_unsupported',phase:'waiting_python',python:[3,9,18]});send('EXITED','-',{reason:'failed'});}else send('BOOTSTRAP_READY','-',{protocol:2,python:[3,11,9],sqlite:[3,37,2]});});return;}
  if(text.startsWith('printf ')){const marker=/'(STUDIO_TERMINAL_RESUMED_[a-f0-9]{32})'\r$/.exec(text)?.[1];assert(marker);if(resume)queueMicrotask(()=>output('\x1b[2J\x1b[3J\x1b[H'+marker+'\r\nrestored shell'));return;}
  const [prefix,n,kind,id,encoded]=text.trimEnd().split(':');assert.equal(prefix,'__STUDIO_SERVICE_V1__');assert.equal(n,nonce);const value=JSON.parse(Buffer.from(encoded,'base64'));
  if(kind==='HELLO'){hello=value;if(auto)queueMicrotask(()=>{if(failAt==='cache')emitFailure();else if(transportCached){send('HELPER_READY','-',{cached:true});workerCheck();}else{parts=[];send('TRANSPORT_NEEDED','-',{});}});}
  if(kind==='INSTALL'){parts.push({id,bytes:Buffer.from(value.chunk,'base64')});if(ack)queueMicrotask(()=>send('ACK',id,{accepted:Number(id)}));}
  if(kind==='TRANSPORT_END'){const bytes=Buffer.concat(parts.map(p=>p.bytes));assert.equal(value.size,bytes.length);assert.equal(value.sha256,hash(bytes));assert.equal(bytes.toString(),trusted.transport.source);uploads.push({kind:'transport',bytes});queueMicrotask(()=>{send('HELPER_READY','-',{cached:false});workerCheck();});}
  if(kind==='INSTALL_END'){const bytes=Buffer.concat(parts.map(p=>p.bytes));assert.equal(value.encoding,'gzip');assert.equal(value.size,bytes.length);assert.equal(value.sha256,hash(bytes));const raw=gunzipSync(bytes);assert.equal(value.uncompressed_size,raw.length);assert.equal(value.uncompressed_sha256,hash(raw));assert.deepEqual(JSON.parse(raw),trusted.payload);uploads.push({kind:'worker',bytes,raw});queueMicrotask(()=>{send('WORKER_READY','-',{cached:false});send('PHASE','-',{phase:'checking_health'});send('READY','-',{...health,runtime_id:trusted.payload.expected_runtime_id});});}
  if(kind==='STOP'&&stop)queueMicrotask(()=>send('STOPPED',id,{}));
 }};
 const pty={spawn:()=>child},plan={kind:'ssh',mode:'interactive',name:'Owned fake SSH',launch:{file:path.resolve('inert-shell'),args:[],cwd:process.cwd()}},session=createTerminalSession({pty,plan,serviceTimeouts:{start:250,stop:250,request:250,...timeouts}});
 return {trusted,child,pty,plan,session,writes,uploads,resizes,send,output:text=>output(text),get hello(){return hello;},get nonce(){return nonce;},start:(requestId='owned-start')=>session.serviceStart({ownerEpoch:1,requestId,bootstrap:trusted})};
}

test('V2 single-line ASCII bootstrap validates both caches before sending any source bundle',async()=>{
 const f=fixture();try{f.output('previous human history\r\n');const pending=f.start(),ready=await pending;
  assert.equal(ready.serviceStatus,'connected');assert.equal(ready.servicePhase,'ready');assert.equal(ready.terminalAccess,'reserved');assert.equal(f.uploads.length,0);assert(!f.writes.some(v=>v.includes(':INSTALL:')));
  const command=f.writes[0];assert.match(command,/^python3 -I -u -c /);assert(Buffer.byteLength(command)<4096);assert(!command.slice(0,-1).includes('\n'));assert.match(command.slice(0,-1),/^[\x20-\x7e]+$/);const encoded=/b64decode\("([A-Za-z0-9+/=]+)"\)/.exec(command)[1];assert.equal(gunzipSync(Buffer.from(encoded,'base64')).toString(),f.trusted.source);
  assert.equal(f.hello.worker_manifest_sha256.slice(0,20),f.trusted.payload.expected_runtime_id);assert.equal(f.hello.transport_sha256,f.trusted.transport.sha256);assert.equal(f.hello.worker_sha256,hash(Buffer.from(JSON.stringify(f.trusted.payload))));assert.equal(f.session.read({actor:'human',ownerEpoch:2}).chunks.map(c=>c.data).join(''),'previous human history\r\n');
 }finally{f.session.dispose();}
});

test('the shipped V2 loader fits one canonical terminal line after compression and is not typed as multiline Python',async()=>{
 const source=fs.readFileSync(new URL('../../desktop/platform/terminal-service/python/bootstrap.py',import.meta.url),'utf8'),f=fixture({auto:false,sourceOptions:{source}});try{const pending=f.start();pending.catch(()=>{});assert.equal(f.writes.length,1);const command=f.writes[0];assert(Buffer.byteLength(command)<4096);assert.match(command.slice(0,-1),/^[\x20-\x7e]+$/);assert(!command.includes('\n'));assert.equal(gunzipSync(Buffer.from(/b64decode\("([A-Za-z0-9+/=]+)"\)/.exec(command)[1],'base64')).toString(),source);f.session.dispose();await assert.rejects(pending,/service_disconnected/);}finally{f.session.dispose();}
});

test('V2 cold connection uploads separately verified transport then gzip worker and resets ACK indices',async()=>{
 const f=fixture({transportCached:false,workerCached:false});try{const ready=await f.start();assert.equal(ready.serviceStatus,'connected');assert.deepEqual(f.uploads.map(u=>u.kind),['transport','worker']);assert(f.uploads[1].bytes.length<f.uploads[1].raw.length/2);const initialIndices=f.writes.filter(v=>v.includes(':INSTALL:0:'));assert.equal(initialIndices.length,2);assert.equal(f.session.serviceState().progress,undefined);assert.equal(f.session.read({actor:'human',ownerEpoch:2}).chunks.length,0);}finally{f.session.dispose();}
});

test('V2 helper hit with worker miss sends only gzip worker and retains original worker payload identity',async()=>{
 const f=fixture({workerCached:false});try{await f.start();assert.deepEqual(f.uploads.map(u=>u.kind),['worker']);assert.equal(JSON.parse(f.uploads[0].raw).expected_runtime_id,f.trusted.payload.expected_runtime_id);assert(!f.writes.some(v=>v.includes(':TRANSPORT_END:')));}finally{f.session.dispose();}
});

test('V2 transfer progress counts ACKed bytes only and never exceeds a 16-frame outstanding window',async()=>{
 const f=fixture({transportCached:false,ack:false,sourceOptions:{transport:'x'.repeat(50000)}});try{const pending=f.start();pending.catch(()=>{});await tick();let packets=f.writes.filter(v=>v.includes(':INSTALL:'));assert.equal(packets.length,16);assert.deepEqual(f.session.serviceState().progress,{kind:'transfer',completedBytes:0,totalBytes:50000});assert.equal(f.session.serviceState().servicePhase,'transferring_transport');
  f.send('ACK','0',{accepted:0});await tick();packets=f.writes.filter(v=>v.includes(':INSTALL:'));assert.equal(packets.length,17);assert.equal(f.session.serviceState().progress.completedBytes,2048);
  for(let i=1;i<25;i++){f.send('ACK',String(i),{accepted:i});await tick();}await pending;assert.equal(f.uploads[0].bytes.length,50000);
 }finally{f.session.dispose();}
});

test('V2 known preflight failure resumes shell only after EXITED plus fresh output proof and retains safe actual version',async()=>{
 const f=fixture({auto:false,resume:false});try{const pending=f.start();let settled=false;pending.then(()=>settled=true);f.output('\x1b[?2004l\r');f.send('ERROR','-',{code:'python_unsupported',phase:'waiting_python',python:[3,9,18]});await tick();assert.equal(settled,false);assert.equal(f.session.state().serviceActive,true);assert.throws(()=>f.session.input({actor:'human',ownerEpoch:2,requestId:'no-interleave',data:'x'}),/service_active/);
  f.send('EXITED','-',{reason:'failed'});await tick();const command=f.writes.find(v=>v.startsWith('printf ')),marker=/'(STUDIO_TERMINAL_RESUMED_[a-f0-9]{32})'\r$/.exec(command)[1];f.output(command+'\n');await tick();assert.equal(settled,false);f.output('\x1b[2J\x1b[3J\x1b[H'+marker+'\r\nnormal shell');const failed=await pending;assert.equal(failed.serviceStatus,'failed');assert.equal(failed.serviceActive,false);assert.equal(failed.terminalAccess,'available');assert.deepEqual(failed.error,{code:'python_unsupported',phase:'waiting_python',python:[3,9,18]});assert(!f.session.read({actor:'human',ownerEpoch:3}).chunks.some(c=>c.data.includes('__STUDIO_SERVICE')));assert.equal(await f.start(),failed);
 }finally{f.session.dispose();}
});

test('V2 known cache failure reports bounded errno without leaking path or private bytes',async()=>{
 const f=fixture({failAt:'cache'});try{const result=await f.start();assert.equal(result.serviceStatus,'failed');assert.equal(result.terminalAccess,'available');assert.equal(result.error.code,'permission_denied');assert.equal(result.error.errno,13);assert.deepEqual(result.error.sqlite,[3,37,2]);assert(!JSON.stringify(result).includes(f.nonce));assert(!f.writes.some(v=>v.includes(':INSTALL:')));}finally{f.session.dispose();}
});

test('V2 missing EXITED or missing resume proof remains unknown/private and cannot replay',async()=>{
 for(const withExited of [false,true]){const f=fixture({auto:false,resume:false,timeouts:{start:25,stop:25}});try{const pending=f.start();f.send('ERROR','-',{code:'storage_unavailable',phase:'checking_cache',errno:28});if(withExited)f.send('EXITED','-',{reason:'failed'});await assert.rejects(pending,/service_(start|stop)_unknown/);const count=f.writes.length;await assert.rejects(f.start(),/service_(start|stop)_unknown/);assert.equal(f.writes.length,count);f.output('PRIVATE_TOKEN_AFTER_UNKNOWN\n');assert.equal(f.session.serviceState().terminalAccess,'unknown');assert.equal(f.session.serviceState().serviceActive,true);assert.deepEqual(f.session.read({actor:'human',ownerEpoch:2}).chunks,[]);}finally{f.session.dispose();}}
});

test('V2 an observed remote failure without final EXITED has a bounded unknown deadline and preserves actual version',async()=>{
 const f=fixture({auto:false,timeouts:{start:1000,stop:20}});try{const pending=f.start();f.send('ERROR','-',{code:'python_unsupported',phase:'waiting_python',python:[3,9,18]});await assert.rejects(pending,/service_transport_unknown/);assert.deepEqual(f.session.serviceState().error,{code:'service_transport_unknown',phase:'waiting_python',python:[3,9,18]});assert.equal(f.session.serviceState().terminalAccess,'unknown');assert.equal(f.session.state().serviceActive,true);}finally{f.session.dispose();}
});

test('V2 rejects forged diagnostics and changed bootstrap identity rather than interpreting raw output as safe error',async()=>{
 for(const extra of [{path:'/private/path'},{code:'untrusted_remote_text'},{python:[3,'9',0]},{errno:999999}]){const f=fixture({auto:false});try{const pending=f.start();f.send('ERROR','-',{code:'worker_cache_invalid',phase:'checking_cache',...extra});await assert.rejects(pending,/service_protocol_failed/);assert.equal(f.session.serviceState().terminalAccess,'unknown');assert.equal(f.session.read({actor:'human',ownerEpoch:2}).chunks.length,0);}finally{f.session.dispose();}}
 const f=fixture();try{await f.start();assert.throws(()=>f.session.serviceStart({ownerEpoch:1,requestId:'owned-start',bootstrap:{...f.trusted,transport:{source:'changed',sha256:hash('changed')}}}),/request_changed/);assert.equal(f.writes.filter(v=>v.startsWith('python3 ')).length,1);}finally{f.session.dispose();}
});

test('V2 no Python response fails quickly with an accurate unknown code, and a real handshake clears that watchdog',async()=>{
 const a=fixture({auto:false,timeouts:{start:20}});try{await assert.rejects(a.start(),/python_response_timeout/);assert.equal(a.session.serviceState().error.phase,'waiting_python');assert.equal(a.session.serviceState().terminalAccess,'unknown');const count=a.writes.length;await assert.rejects(a.start(),/python_response_timeout/);assert.equal(a.writes.length,count);}finally{a.session.dispose();}
 const b=fixture({auto:false,timeouts:{start:25}});try{const pending=b.start();b.send('BOOTSTRAP_READY','-',{protocol:2,python:[3,11,9],sqlite:[3,37,2]});await assert.rejects(pending,/service_start_unknown/);assert.equal(b.session.serviceState().error.phase,'checking_cache');assert.equal(b.session.serviceState().terminalAccess,'unknown');}finally{b.session.dispose();}
});

test('V2 ERROR immediately fences new RPC and rejects existing pending calls before waiting for EXITED',async()=>{
 const f=fixture();try{const ready=await f.start(),args={serviceId:ready.serviceId,requestId:'pending-rpc',method:'POST',target:'/api/authoring/context',mcp:false},pending=f.session.serviceRequest(args);f.send('ERROR','-',{code:'service_request_unconfirmed',phase:'request'});await assert.rejects(pending,/service_remote_failed/);const before=f.writes.length;assert.throws(()=>f.session.serviceRequest({...args,requestId:'must-not-send'}),/service_unavailable/);assert.equal(f.writes.length,before);assert.equal(f.session.state().serviceActive,true);f.send('EXITED','-',{reason:'failed'});await tick();assert.equal(f.session.serviceState().serviceStatus,'failed');assert.equal(f.session.serviceState().terminalAccess,'available');}finally{f.session.dispose();}
});

test('V2 startup cancellation privately consumes an in-flight handshake and does not send HELLO or resume before STOPPED',async()=>{
 const f=fixture({auto:false,stop:false});try{const pending=f.start();pending.catch(()=>{});const stopped=f.session.serviceStop({serviceId:f.session.serviceState().serviceId});f.send('BOOTSTRAP_READY','-',{protocol:2,python:[3,11,9],sqlite:[3,37,2]});assert(!f.writes.some(v=>v.includes(':HELLO:')));assert.equal(f.session.state().serviceActive,true);const id=f.writes.find(v=>v.includes(':STOP:')).split(':')[3];f.send('STOPPED',id,{});await stopped;await assert.rejects(pending,/service_disconnected/);assert.equal(f.session.state().serviceActive,false);assert(!f.session.read({actor:'human',ownerEpoch:3}).chunks.some(v=>v.data.includes('__STUDIO_SERVICE')));}finally{f.session.dispose();}
});

test('V2 startup cancellation discards only already sent upload ACKs without pumping more source bytes',async()=>{
 const f=fixture({transportCached:false,ack:false,stop:false,sourceOptions:{transport:'x'.repeat(50000)}});try{const pending=f.start();pending.catch(()=>{});await tick();assert.equal(f.writes.filter(v=>v.includes(':INSTALL:')).length,16);const stopped=f.session.serviceStop({serviceId:f.session.serviceState().serviceId});for(let i=0;i<16;i++)f.send('ACK',String(i),{accepted:i});await tick();assert.equal(f.writes.filter(v=>v.includes(':INSTALL:')).length,16);assert.equal(f.session.serviceState().servicePhase,'stopping');const id=f.writes.find(v=>v.includes(':STOP:')).split(':')[3];f.send('STOPPED',id,{});await stopped;await assert.rejects(pending,/service_disconnected/);assert.equal(f.session.state().serviceActive,false);}finally{f.session.dispose();}
});

test('V2 startup cancellation handles already streaming READY fragments privately before its final STOPPED barrier',async()=>{
 const f=fixture({auto:false,stop:false});try{const pending=f.start();pending.catch(()=>{});f.send('BOOTSTRAP_READY','-',{protocol:2,python:[3,11,9],sqlite:[3,37,2]});f.send('HELPER_READY','-',{cached:true});f.send('WORKER_READY','-',{cached:true});const bytes=Buffer.from(JSON.stringify({...health,runtime_id:f.trusted.payload.expected_runtime_id}));f.send('FRAGMENT','-',{kind:'READY',index:0,last:false,chunk:bytes.subarray(0,96).toString('base64')});const stopped=f.session.serviceStop({serviceId:f.session.serviceState().serviceId});for(let at=96;at<bytes.length;at+=96)f.send('FRAGMENT','-',{kind:'READY',index:at/96,last:at+96>=bytes.length,chunk:bytes.subarray(at,at+96).toString('base64')});assert.equal(f.session.state().serviceActive,true);const id=f.writes.find(v=>v.includes(':STOP:')).split(':')[3];f.send('STOPPED',id,{});await stopped;await assert.rejects(pending,/service_disconnected/);assert.equal(f.session.state().serviceActive,false);}finally{f.session.dispose();}
});

test('exact owned STOPPED and EXITED barriers tolerate the observed Readline suffix while preserving the fresh shell proof',async()=>{
 const f=fixture({stop:false,resume:false});try{const ready=await f.start(),stopped=f.session.serviceStop({serviceId:ready.serviceId});const stopId=f.writes.find(v=>v.includes(':STOP:')).split(':')[3];f.output('__STUDIO_SERVICE_V1__:'+f.nonce+':STOPPED:'+stopId+':e30=\r\x1b[?2004h\n');await tick();assert.equal(f.session.state().serviceActive,true);const command=f.writes.find(v=>v.startsWith('printf ')),marker=/'(STUDIO_TERMINAL_RESUMED_[a-f0-9]{32})'\r$/.exec(command)[1];f.output(marker+'\r\n');await stopped;assert.equal(f.session.state().serviceActive,false);}finally{f.session.dispose();}
 const b=fixture({auto:false});try{const pending=b.start();b.send('ERROR','-',{code:'python_unsupported',phase:'waiting_python',python:[3,9,18]});b.output('__STUDIO_SERVICE_V1__:'+b.nonce+':EXITED:-:'+Buffer.from('{"reason":"failed"}').toString('base64')+'\r\x1b[?2004h\n');const failed=await pending;assert.equal(failed.serviceActive,false);assert.equal(failed.error.code,'python_unsupported');}finally{b.session.dispose();}
});

test('unexpected printable or CSI tails on a barrier remain private protocol failures',async()=>{
 for(const tail of ['\r\x1b[?2004hUNEXPECTED','\r\x1b[31m']){const f=fixture({stop:false});try{const ready=await f.start(),stopped=f.session.serviceStop({serviceId:ready.serviceId}),stopId=f.writes.find(v=>v.includes(':STOP:')).split(':')[3];f.output('__STUDIO_SERVICE_V1__:'+f.nonce+':STOPPED:'+stopId+':e30='+tail+'\n');await assert.rejects(stopped,/service_protocol_failed/);assert.equal(f.session.state().serviceActive,true);assert.deepEqual(f.session.read({actor:'human',ownerEpoch:2}).chunks,[]);}finally{f.session.dispose();}}
});

test('the exact final barrier may arrive byte by byte, and the same suffix is never stripped from an ordinary RPC response',async()=>{
 for(const final of ['STOPPED','EXITED']){const f=fixture({auto:final==='STOPPED',stop:false});try{let pending,barrier;if(final==='STOPPED'){const ready=await f.start();pending=f.session.serviceStop({serviceId:ready.serviceId});const id=f.writes.find(v=>v.includes(':STOP:')).split(':')[3];barrier='__STUDIO_SERVICE_V1__:'+f.nonce+':STOPPED:'+id+':e30=\r\x1b[?2004h\n';}else{pending=f.start();f.send('ERROR','-',{code:'python_unsupported',phase:'waiting_python',python:[3,9,18]});barrier='__STUDIO_SERVICE_V1__:'+f.nonce+':EXITED:-:'+Buffer.from('{"reason":"failed"}').toString('base64')+'\r\x1b[?2004h\n';}for(const byte of barrier)f.output(byte);await pending;assert.equal(f.session.state().serviceActive,false);}finally{f.session.dispose();}}
 const g=fixture();try{const ready=await g.start(),pending=g.session.serviceRequest({serviceId:ready.serviceId,requestId:'ordinary-response',method:'GET',target:'/api/health',mcp:false});g.output('__STUDIO_SERVICE_V1__:'+g.nonce+':RESPONSE:ordinary-response:'+Buffer.from('{"status":200,"data":{}}').toString('base64')+'\r\x1b[?2004h\n');await assert.rejects(pending,/service_protocol_failed/);assert.equal(g.session.state().serviceActive,true);assert.equal(g.session.serviceState().terminalAccess,'unknown');}finally{g.session.dispose();}
});

test('bounded VT normalization handles the actual cold clear and warm short-line screen updates at every byte boundary',async()=>{
 for(const split of [false,true]){const f=fixture({auto:false});try{const pending=f.start(),frame=(kind,value)=>'__STUDIO_SERVICE_V1__:'+f.nonce+':'+kind+':-:'+Buffer.from(JSON.stringify(value)).toString('base64');
  let stream='\x1b[?2004l\x1b[25l\x1b[H'+frame('BOOTSTRAP_READY',{protocol:2,python:[3,12,3],sqlite:[3,45,1]})+'\x1b[K\r\n'+'\x1b[K\r\n'.repeat(29)+'\x1b[2;1H\x1b[?25h'+frame('HELPER_READY',{cached:true})+'\r\n'+frame('WORKER_READY',{cached:true})+'\x1b[13X\r\n'+frame('PHASE',{phase:'preparing_runtime'})+'\x1b[0K\r\n';
  const raw=Buffer.from(JSON.stringify({...health,runtime_id:f.trusted.payload.expected_runtime_id}));for(let at=0;at<raw.length;at+=96)stream+='\x1b[3;1H'+frame('FRAGMENT',{kind:'READY',index:at/96,last:at+96>=raw.length,chunk:raw.subarray(at,at+96).toString('base64')})+'\x1b[2X\r\n';
  if(split)for(const byte of stream)f.output(byte);else f.output(stream);const result=await pending;assert.equal(result.serviceStatus,'connected');assert.equal(result.servicePhase,'ready');assert.equal(f.uploads.length,0);assert.equal(f.session.read({actor:'human',ownerEpoch:2}).chunks.length,0);
 }finally{f.session.dispose();}}
});

test('VT normalization refuses printable prefixes, unknown or excessive controls, and controls inside encoded payload',async()=>{
 const cases=[{pre:'printable '},{pre:'\x1b[301;1H'},{pre:'\x1b[1;501H'},{pre:'\x1b[0;1H'},{pre:'\x1b[9999H'},{pre:'\x1b]0;title\x07'},{pre:'\x1b[H'.repeat(33)},{pre:'\x1b[?25h'.repeat(90)},{tail:'\x1b[1K'},{tail:'\x1b[2K'},{tail:'\x1b[501X'},{tail:'\x1b[0X'},{tail:'\x1b[9999X'},{tail:'\x1b[H'},{tail:'\x1b[31m'},{tail:'\x1b[KPRINT'},{tail:'\x1b[K'.repeat(9)},{tail:'\x1b[?25h'},{interior:'\x1b[K'}];
 for(const entry of cases){const f=fixture({auto:false});try{const pending=f.start(),encoded=Buffer.from(JSON.stringify({protocol:2,python:[3,12,3],sqlite:[3,45,1]})).toString('base64'),body=entry.interior?encoded.slice(0,10)+entry.interior+encoded.slice(10):encoded;f.output((entry.pre||'')+'__STUDIO_SERVICE_V1__:'+f.nonce+':BOOTSTRAP_READY:-:'+body+(entry.tail||'')+'\r\n');await assert.rejects(pending,/service_protocol_failed/);assert.equal(f.session.state().serviceActive,true);assert.equal(f.session.serviceState().terminalAccess,'unknown');assert.equal(f.session.read({actor:'human',ownerEpoch:2}).chunks.length,0);}finally{f.session.dispose();}}
});

test('V2 invalid source hashes and oversized one-line loader fail before reserving or writing to the SSH PTY',()=>{
 const f=fixture();try{for(const change of [b=>b.transport.sha256='0'.repeat(64),b=>b.payload.files[0].sha256='0'.repeat(64),b=>b.payload.expected_runtime_id='0'.repeat(20),b=>b.source=Array.from({length:6000},(_,i)=>hash(String(i))).join('')]){const bad=structuredClone(f.trusted);change(bad);assert.throws(()=>f.session.serviceStart({ownerEpoch:1,requestId:'bad',bootstrap:bad}),/invalid_request/);assert.equal(f.writes.length,0);assert.equal(f.session.state().ownerEpoch,1);assert.equal(f.session.state().serviceActive,false);}}finally{f.session.dispose();}
});

test('V2 broker HTTP returns safe known and unknown startup states',async()=>{
 for(const failure of ['preflight','unknown']){const f=fixture({auto:failure!=='unknown',failAt:failure}),token='c'.repeat(64),broker=await startBroker({controlToken:token,instanceId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',runtimeRoot:process.cwd(),dependencyRoot:process.cwd()},{pty:f.pty,serviceTimeouts:{start:25,stop:25}});const call=async(route,body)=>{const r=await fetch(broker.ready.origin+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};};try{const opened=await call('/sessions/open',f.plan),r=await call('/sessions/'+opened.value.id+'/service/start',{ownerEpoch:1,requestId:'http-start',bootstrap:f.trusted});assert.equal(r.status,200);assert.equal(r.value.serviceStatus,'failed');assert.equal(r.value.serviceActive,failure==='unknown');assert.equal(r.value.terminalAccess,failure==='unknown'?'unknown':'available');assert.equal(r.value.error.code,failure==='unknown'?'python_response_timeout':'python_unsupported');}finally{await broker.close();f.session.dispose();}}
});

test('cancel-before-start is a bounded durable-in-session tombstone, and cannot stop a different active attempt',async()=>{
 const f=fixture();try{const canceled=await f.session.serviceCancelStart({requestId:'never-dispatch'});assert.equal(canceled.serviceActive,false);assert.throws(()=>f.session.serviceStart({ownerEpoch:1,requestId:'never-dispatch',bootstrap:f.trusted}),/service_start_cancelled/);assert.equal(f.writes.length,0);const ready=await f.start();const before=f.writes.length,other=await f.session.serviceCancelStart({requestId:'old-other-attempt'});assert.equal(other.startRequestId,'owned-start');assert.equal(other.serviceActive,true);assert.equal(f.writes.length,before);assert.equal(other.serviceId,ready.serviceId);await f.session.serviceCancelStart({requestId:'old-other-attempt'});assert.equal(f.writes.length,before);}finally{f.session.dispose();}
 const b=fixture();try{for(let i=0;i<32;i++)await b.session.serviceCancelStart({requestId:'bounded-'+i});assert.throws(()=>b.session.serviceCancelStart({requestId:'cannot-evict'}),/request_limit/);assert.throws(()=>b.session.serviceStart({ownerEpoch:1,requestId:'bounded-0',bootstrap:b.trusted}),/service_start_cancelled/);assert.equal(b.writes.length,0);}finally{b.session.dispose();}
});

test('cancel-after-start stops only that request once and still waits for the shell-resume proof',async()=>{
 const f=fixture({auto:false,resume:false});try{const pending=f.start();pending.catch(()=>{});const stopped=f.session.serviceCancelStart({requestId:'owned-start'});await tick();assert.equal(f.session.state().serviceActive,true);assert.equal(f.writes.filter(v=>v.includes(':STOP:')).length,1);const command=f.writes.find(v=>v.startsWith('printf ')),marker=/'(STUDIO_TERMINAL_RESUMED_[a-f0-9]{32})'\r$/.exec(command)[1];f.output(marker+'\r\n');await stopped;await assert.rejects(pending,/service_disconnected/);await f.session.serviceCancelStart({requestId:'owned-start'});assert.equal(f.writes.filter(v=>v.includes(':STOP:')).length,1);assert.throws(()=>f.start(),/service_start_cancelled/);}finally{f.session.dispose();}
});

test('broker cancellation fences an already accepted but incomplete start POST body before PTY dispatch',async()=>{
 const f=fixture({auto:false}),token='d'.repeat(64),broker=await startBroker({controlToken:token,instanceId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',runtimeRoot:process.cwd(),dependencyRoot:process.cwd()},{pty:f.pty});const call=async(route,body)=>{const r=await fetch(broker.ready.origin+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};};let partial;
 try{const opened=await call('/sessions/open',f.plan),base='/sessions/'+opened.value.id,body=Buffer.from(JSON.stringify({ownerEpoch:1,requestId:'body-in-flight',bootstrap:f.trusted}));let response;const completed=new Promise((resolve,reject)=>{partial=http.request(broker.ready.origin+base+'/service/start',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':body.length}},r=>{const parts=[];r.on('data',b=>parts.push(b));r.on('end',()=>resolve({status:r.statusCode,value:JSON.parse(Buffer.concat(parts))}));});partial.on('error',reject);});partial.write(body.subarray(0,100));await tick();const cancelled=await call(base+'/service/cancel',{requestId:'body-in-flight'});assert.equal(cancelled.status,200);assert.equal(cancelled.value.cancelled,true);assert.equal(cancelled.value.cancelledRequestId,'body-in-flight');assert.equal(cancelled.value.serviceActive,false);partial.end(body.subarray(100));response=await completed;assert.equal(response.status,409);assert.equal(response.value.error,'service_start_cancelled');assert.equal(f.writes.length,0);
 }finally{partial?.destroy();await broker.close();f.session.dispose();}
});
