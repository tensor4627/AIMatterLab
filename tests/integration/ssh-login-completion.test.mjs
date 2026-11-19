import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSshConnections} from '../../desktop/platform/terminal-service/ssh-connection.mjs';
import {createTerminalSession,TerminalFault} from '../../desktop/platform/terminal-service/session.mjs';
import {startBroker} from '../../desktop/platform/terminal-service/broker.mjs';

const profile={id:'inert-login-profile',version:1,kind:'ssh',mode:'interactive',host:'fixture.invalid',username:'fixture',port:2222,ssh_client:'/usr/bin/ssh',identity_file:'',proxy_jump:[],distribution:'Fixture Linux'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,{marker=true,frame=value=>[value]}={}){
 const processes=[],sessions=new Map(),calls=[];let phase='trust',readyGate,proofGate,checkGate,broken=false;
 const pty={spawn(file,args){const callbacks={},value={pid:1100+processes.length,file,args,writes:[],onData:f=>callbacks.data=f,onExit:f=>callbacks.exit=f,resize(){},output:value=>callbacks.data?.(value),kill(){callbacks.exit?.({exitCode:0});},write(data){this.writes.push(data);if(file!=='/fixture/inert-master')return;if(phase==='trust'&&data==='yes\r'){phase='password';this.output('Password: ');}else if(phase==='password'&&data==='INERT_PASSWORD\r'){phase='otp';this.output('Verification code: ');}else if(phase==='otp'&&data==='123456\r'){phase='ready';this.output('\r\n');}}};processes.push(value);if(file==='/fixture/inert-master'&&marker)queueMicrotask(()=>{for(const chunk of frame('__STUDIO_MASTER_'+args[0]+'__:'+Buffer.from(JSON.stringify({pid:value.pid,start:'123',boot:'00000000-0000-0000-0000-000000000000'})).toString('base64')+'__STUDIO_MASTER_END_'+args[0]+'__\r\nAre you sure you want to continue connecting? '))value.output(chunk);});return value;}};
 const host={allocate:async()=>{calls.push('allocate');return {socket:'/tmp/inert-login/master.sock'};},masterLaunch:(_profile,_proof,nonce)=>({file:'/fixture/inert-master',args:[nonce],cwd:process.cwd()}),slaveLaunch:()=>({file:'/fixture/inert-shell',args:[],cwd:process.cwd()}),ready:async()=>{calls.push('ready');if(readyGate)await readyGate;if(broken)throw new TerminalFault('ssh_master_identity_changed');return {ready:phase==='ready'};},prove:async()=>{calls.push('prove');assert.equal(phase,'ready','No remote proof before local authentication readiness');if(proofGate)await proofGate;return {socketIdentity:['1','2']};},check:async()=>{calls.push('check');assert.equal(phase,'ready','Owned control proof requires completed local authentication');if(calls.filter(value=>value==='check').length===1&&proofGate)await proofGate;else if(calls.filter(value=>value==='check').length>1&&checkGate)await checkGate;if(broken)throw new TerminalFault('ssh_master_identity_changed');return {socketIdentity:['1','2']};},close:async()=>({closed:true}),observeClosed:async()=>({closed:true}),cleanup:async()=>{}};
 const manager=createSshConnections({pty,sessions,host,sessionFactory:createTerminalSession,closeWaitMs:0});t.after(()=>manager.closeAll());
 const open=async(requestId='login')=>{const value=await manager.open({profileId:profile.id,profileVersion:1,requestId,profile});await tick();return value;};
 function authenticate(connectionId){for(const [requestId,data]of [['trust','yes\r'],['password','INERT_PASSWORD\r'],['otp','123456\r']])manager.authInput({connectionId,requestId,data});}
 return {manager,pty,host,processes,sessions,calls,open,authenticate,phase:()=>phase,readyGate:p=>readyGate=p,proofGate:p=>proofGate=p,checkGate:p=>checkGate=p,broken:v=>broken=v};
}
const count=(f,name)=>f.calls.filter(value=>value===name).length;
test('gateway exec rejection is definite before Python; opening polls stay connecting and preserve the handed-off shell',async t=>{
 const f=fixture(t),pending=await f.open();f.authenticate(pending.connectionId);const completed=await f.manager.completeLogin({connectionId:pending.connectionId,requestId:'login'}),session=f.sessions.get(completed.shell.id);session.owner({owner:'agent',ownerEpoch:session.state().ownerEpoch,scope:{provider:'codex',threadId:'fixture-thread'}});
 const started=f.manager.openService({connectionId:pending.connectionId,profileId:profile.id,profileVersion:1,requestId:'denied-service',bootstrap:{source:'never-executed',payload:{}}});await tick();const opening=await f.manager.serviceState({connectionId:pending.connectionId});assert.equal(opening.status,'connecting');assert.equal(opening.serviceActive,true);
 const servicePty=f.processes.at(-1);servicePty.output('exec request failed, try username/server/account as login name.\r\n');servicePty.kill();const result=await started;assert.equal(result.status,'failed');assert.equal(result.serviceActive,false);assert.equal(result.error.code,'exec_unavailable');assert.equal(result.serviceId,undefined);assert.deepEqual(servicePty.writes,[]);assert.equal(session.state().alive,true);assert.equal(session.state().owner,'agent');assert.equal((await f.manager.serviceState({connectionId:pending.connectionId})).error.code,'exec_unavailable');assert.equal(count(f,'allocate'),1);
 assert.deepEqual(await f.manager.openService({connectionId:pending.connectionId,profileId:profile.id,profileVersion:1,requestId:'denied-service',bootstrap:{source:'never-executed',payload:{}}}),result);assert.equal(f.processes.length,3,'same attempt cannot open another channel');
});
const gate=()=>{let release;return {promise:new Promise(r=>release=r),release:()=>release()};};

test('human trust, password and MFA stay private; completion waits for owned local control proof and opens one normal shell without remote exec',async t=>{
 const f=fixture(t),pending=await f.open(),value={connectionId:pending.connectionId,requestId:'login'};assert.equal(pending.loginRequestId,'login');assert.equal(f.manager.list().connections[0].loginRequestId,'login');
 for(const [requestId,data,expected]of [['trust','yes\r','password'],['password','INERT_PASSWORD\r','otp'],['otp','123456\r','ready']]){
  const before=await f.manager.completeLogin(value);assert.equal(before.connection.authentication,'pending');assert.equal(before.shell,undefined);assert.equal(count(f,'prove'),0);assert.equal(f.processes.length,1);
  f.manager.authInput({connectionId:pending.connectionId,requestId,data});assert.equal(f.phase(),expected);
 }
 const results=await Promise.all(Array.from({length:8},()=>f.manager.completeLogin(value))),first=results[0];assert.equal(first.connection.status,'authenticated');assert.equal(first.connection.authentication,'verified');assert.equal(first.shell.connectionId,pending.connectionId);assert.equal(first.shell.owner,'human');assert(first.shell.alive);assert(results.every(result=>result.shell.id===first.shell.id));assert.equal(count(f,'prove'),0);assert.equal(f.processes.length,2);assert.equal(f.sessions.size,1);assert.equal(count(f,'allocate'),1);
 assert.equal(f.manager.authRead({connectionId:pending.connectionId}).output,'');assert(!/INERT_PASSWORD|123456|Password:|Verification code/.test(JSON.stringify(results)));assert.equal((await f.manager.completeLogin(value)).shell.id,first.shell.id);assert.equal(count(f,'prove'),0);assert.equal(f.processes.length,2);
 f.processes[1].output('PUBLIC SHELL\r\n');const session=f.sessions.get(first.shell.id),read=session.read({actor:'human',ownerEpoch:first.shell.ownerEpoch,cursor:0,maxBytes:16384});assert.equal(read.chunks.map(value=>value.data).join(''),'PUBLIC SHELL\r\n');session.input({actor:'human',ownerEpoch:first.shell.ownerEpoch,requestId:'normal-shell',data:'inert normal input\r'});assert.deepEqual(f.processes[1].writes,['inert normal input\r']);
 session.close({actor:'human',ownerEpoch:first.shell.ownerEpoch});assert.equal((await f.manager.completeLogin(value)).shell,undefined,'Explicitly closed initial shell is never reopened by login completion');assert.equal(f.processes.length,2);assert.equal(count(f,'prove'),0);
});

test('a not-yet-observed master marker remains pending without any local helper, remote proof or extra SSH launch',async t=>{
 const f=fixture(t,{marker:false}),connection=await f.open(),result=await f.manager.completeLogin({connectionId:connection.connectionId,requestId:'login'});assert.equal(result.connection.status,'authenticating');assert.equal(result.shell,undefined);assert.deepEqual(f.calls,['allocate']);assert.equal(f.processes.length,1);
});

for(const width of [10,56,80,120])test('ConPTY '+width+' column startup wrapping preserves the complete local nonce frame before authentication',async t=>{
 const f=fixture(t,{frame:value=>{const end=value.indexOf('\r\n'),identity=value.slice(0,end),wrapped=identity.match(new RegExp('.{1,'+width+'}','g')).join('\r\n')+'\x1b[K\r\n'+value.slice(end+2);return ['wsl: inert local startup notice\r\n',...wrapped.match(/.{1,7}/gs)];}}),connection=await f.open(),ref={connectionId:connection.connectionId,requestId:'login'};
 assert.equal((await f.manager.state({connectionId:connection.connectionId})).status,'authenticating');assert.equal((await f.manager.completeLogin(ref)).login.status,'waiting_authentication');assert.equal(f.processes.length,1);assert.equal(count(f,'check'),0);
 const output=f.manager.authRead({connectionId:connection.connectionId}).output;assert(output.endsWith('Are you sure you want to continue connecting? '));assert(!/STUDIO_MASTER|startup notice/.test(output));
 f.authenticate(connection.connectionId);const completed=await f.manager.completeLogin(ref);assert.equal(completed.connection.authentication,'verified');assert.equal(completed.shell.owner,'human');assert.equal(f.processes.length,2);assert.equal(count(f,'allocate'),1);
});

test('a long authentication screen batched with the local frame is replayed with its terminal controls',async t=>{
 const screen='\x1b[2J\x1b[H'+('认证网关说明🙂\r\n'.repeat(1050))+'\x1b[1mPassword: \x1b[0m';
 const f=fixture(t,{frame:value=>[value.split('\r\n',1)[0]+'\r\n'+screen]}),connection=await f.open(),ref={connectionId:connection.connectionId,requestId:'login'};
 assert.equal(f.manager.loginStatus(ref).connection.status,'authenticating');
 assert.equal((await f.manager.completeLogin(ref)).login.status,'waiting_authentication');
 assert.equal(f.manager.authRead({connectionId:ref.connectionId}).output,screen);
 let cursor=0,replayed='';while(replayed.length<screen.length){
  const part=f.manager.authRead({connectionId:ref.connectionId,cursor,maxBytes:16384});
  assert(part.cursor>cursor);assert.equal(part.dropped,false);assert(Buffer.byteLength(part.output)<=16384);
  replayed+=part.output;cursor=part.cursor;
 }
 assert.equal(replayed,screen);assert.equal(count(f,'check'),0);assert.equal(f.processes.length,1);
 f.authenticate(ref.connectionId);assert.equal((await f.manager.completeLogin(ref)).connection.authentication,'verified');
 assert.equal(f.manager.authRead({connectionId:ref.connectionId}).output,'');
});

for(const variant of ['foreign nonce','malformed identity','duplicate frame','incomplete frame','oversized prelude'])test('startup '+variant+' cannot authenticate or launch a slave',async t=>{
 const f=fixture(t,{frame:value=>{const end=value.indexOf('\r\n'),frame=value.slice(0,end);if(variant==='foreign nonce')return [value.replaceAll(/(?<=__STUDIO_MASTER_(?:END_)?)[a-f0-9]{48}/g,'0'.repeat(48))];if(variant==='malformed identity')return [value.replace(/:[A-Za-z0-9+/=]+__STUDIO_MASTER_END_/,':bm90LWpzb24=__STUDIO_MASTER_END_')];if(variant==='duplicate frame')return [frame+'\r\n'+value];if(variant==='oversized prelude')return ['x'.repeat(4097),value];return [value.slice(0,value.indexOf('__STUDIO_MASTER_END_'))];}}),connection=await f.open(),ref={connectionId:connection.connectionId,requestId:'login'},observed=await f.manager.completeLogin(ref);
 assert.equal(observed.shell,undefined);assert.equal(observed.connection.authentication,variant==='incomplete frame'?'pending':'lost');assert.equal(observed.login.status,variant==='incomplete frame'?'waiting_authentication':'failed');assert.equal(count(f,'ready'),0);assert.equal(count(f,'check'),0);assert.equal(f.processes.length,1);
});

test('a second local nonce frame in a later chunk revokes the original master without creating a shell',async t=>{
 let original;const f=fixture(t,{frame:value=>{original=value;return [value];}}),connection=await f.open();f.processes[0].output(original);
 const result=await f.manager.completeLogin({connectionId:connection.connectionId,requestId:'login'});assert.equal(result.login.code,'ssh_master_identity_changed');assert.equal(result.shell,undefined);assert.equal(count(f,'check'),0);assert.equal(f.processes.length,1);
});

for(const split of [false,true])test('a second foreign identity frame after an owned frame is rejected'+(split?' across chunks':''),async t=>{
 const f=fixture(t,{frame:value=>{
  const match=value.match(/__STUDIO_MASTER_([a-f0-9]{48})__:/),nonce=match[1],other=(nonce[0]==='0'?'1':'0').repeat(48),foreign=value.replaceAll(nonce,other);
  return split?[value+foreign.slice(0,21)+'\x1b[', 'K\r\n'+foreign.slice(21)]:[value+foreign];
 }}),connection=await f.open();
 const observed=f.manager.loginStatus({connectionId:connection.connectionId,requestId:'login'});
 assert.equal(observed.login.code,'ssh_master_identity_changed');assert.equal(observed.shell,undefined);
 assert.equal(f.manager.authRead({connectionId:connection.connectionId}).output,'');assert.equal(count(f,'check'),0);assert.equal(f.processes.length,1);
});

test('completion shares an already pending explicit confirmation instead of repeating local confirmation or opening another shell',async t=>{
 const f=fixture(t),connection=await f.open(),value={connectionId:connection.connectionId,requestId:'login'},held=gate();f.authenticate(connection.connectionId);f.proofGate(held.promise);const explicit=f.manager.confirm({connectionId:connection.connectionId});while(!count(f,'check'))await tick();const completion=f.manager.completeLogin(value);while(!count(f,'ready'))await tick();held.release();assert.equal((await explicit).authentication,'verified');const ready=await completion;assert.equal(ready.shell.owner,'human');assert.equal(count(f,'prove'),0);assert.equal(count(f,'allocate'),1);assert.equal(f.processes.length,2);
});

test('continuing exact login after a terminal slot opens launches one human shell',async t=>{
 const f=fixture(t),connection=await f.open(),target={connectionId:connection.connectionId},ref={...target,requestId:connection.loginRequestId};
 f.authenticate(target.connectionId);await f.manager.confirm(target);
 const existing=await Promise.all(Array.from({length:4},(_,i)=>f.manager.openShell({...target,requestId:'occupied-slot-'+i})));
 await assert.rejects(f.manager.completeLogin(ref),/session_limit/);
 assert.equal(f.manager.loginStatus(ref).login.code,'terminal_session_limit');assert.equal(f.processes.length,5);
 f.sessions.get(existing[0].id).close({actor:'human',ownerEpoch:existing[0].ownerEpoch});
 assert.equal(f.manager.loginStatus(ref).shell,undefined);assert.equal(f.processes.length,5);
 const [first,second]=await Promise.all([f.manager.completeLogin(ref),f.manager.completeLogin(ref)]);
 assert.equal(first.connection.connectionId,target.connectionId);assert.equal(first.connection.loginRequestId,ref.requestId);
 assert.equal(first.shell.owner,'human');assert.equal(second.shell.id,first.shell.id);
 assert.equal(f.manager.loginStatus(ref).shell.id,first.shell.id);assert.equal(f.processes.length,6);assert.equal(count(f,'allocate'),1);
});

test('completion rejects changed request identity, wrong connection and arbitrary fields without probing',async t=>{
 const f=fixture(t),connection=await f.open(),value={connectionId:connection.connectionId,requestId:'login'};for(const request of [{...value,requestId:'other'},{...value,connectionId:randomUUID()},{...value,command:'not allowed'},{...value,requestId:'../bad'}])await assert.rejects(f.manager.completeLogin(request));assert.equal(count(f,'ready'),0);assert.equal(count(f,'prove'),0);assert.equal(f.processes.length,1);
 const other=await f.open('other-login');await assert.rejects(f.manager.completeLogin({...value,connectionId:other.connectionId}),/request_changed/);assert.equal(f.processes.length,2);
});

for(const stage of ['ready','proof','shell'])test('closing the exact connection during awaited '+stage+' observation cannot publish readiness or open a shell',async t=>{
 const f=fixture(t),connection=await f.open(),value={connectionId:connection.connectionId,requestId:'login'},held=gate();f.authenticate(connection.connectionId);if(stage==='ready')f.readyGate(held.promise);else if(stage==='proof')f.proofGate(held.promise);else f.checkGate(held.promise);const pending=f.manager.completeLogin(value),rejected=assert.rejects(pending,/connection_changed/);while(stage==='shell'?count(f,'check')<2:!count(f,stage==='proof'?'check':'ready'))await tick();await f.manager.close({connectionId:connection.connectionId});held.release();await rejected;assert.equal(f.sessions.size,0);assert.equal(f.processes.length,1);assert.equal(count(f,'allocate'),1);assert.equal((await f.manager.state({connectionId:connection.connectionId})).status,'closed');
});

test('environment profile generation changed while shell verification waits refuses the stale shell creation',async t=>{
 const f=fixture(t),connection=await f.open(),value={connectionId:connection.connectionId,requestId:'login'},held=gate();f.authenticate(connection.connectionId);f.checkGate(held.promise);const pending=f.manager.completeLogin(value),rejected=assert.rejects(pending,/connection_changed/);while(count(f,'check')<2)await tick();f.manager.updateProfile({connectionIds:[connection.connectionId],previousVersion:1,profile:{...profile,version:2,serviceEnvironment:{python:'python3.9'}}});held.release();await rejected;assert.equal(f.sessions.size,0);assert.equal(f.processes.length,1);assert.equal(count(f,'prove'),0);
});

test('a lost original master fails closed and completion never starts replacement authentication',async t=>{
 const f=fixture(t),connection=await f.open(),value={connectionId:connection.connectionId,requestId:'login'};f.broken(true);await assert.rejects(f.manager.completeLogin(value),/identity_changed/);const failed=await f.manager.completeLogin(value);assert.equal(failed.login.status,'failed');assert.equal(failed.login.code,'ssh_master_identity_changed');assert.equal(failed.shell,undefined);assert.equal((await f.manager.state({connectionId:connection.connectionId})).status,'unavailable');assert.equal(count(f,'prove'),0);assert.equal(count(f,'allocate'),1);assert.equal(f.processes.length,1);
});

test('failed startup is observed with its original cause and an explicit fresh login gets a new connection',async t=>{
 const f=fixture(t),allocate=f.host.allocate;f.host.allocate=async()=>{f.calls.push('allocate');throw new TerminalFault('ssh_control_unavailable');};
 const original=await f.open('failed-login'),value={connectionId:original.connectionId,requestId:'failed-login'};
 assert.equal(original.status,'unavailable');const calls=[...f.calls];
 for(let i=0;i<3;i++){const result=await f.manager.completeLogin(value);assert.equal(result.connection.connectionId,original.connectionId);assert.deepEqual(result.login,{status:'failed',code:'ssh_control_unavailable'});assert.equal(result.shell,undefined);}
 assert.deepEqual(f.calls,calls);assert.equal(f.processes.length,0);await assert.rejects(f.manager.completeLogin({...value,requestId:'foreign'}),/request_changed/);
 f.host.allocate=allocate;const next=await f.open('explicit-relogin');assert.notEqual(next.connectionId,original.connectionId);assert.equal(next.loginRequestId,'explicit-relogin');assert.equal(next.status,'authenticating');assert.equal(f.processes.length,1);assert.equal(f.manager.loginStatus(value).login.code,'ssh_control_unavailable');
 await f.manager.close({connectionId:next.connectionId});await assert.rejects(f.manager.completeLogin({connectionId:next.connectionId,requestId:'explicit-relogin'}),/connection_changed/);
});

test('broker completion route is human-control only, typed and idempotent across password/MFA pending states',async t=>{
 const f=fixture(t),token='a'.repeat(64),broker=await startBroker({controlToken:token,instanceId:randomUUID(),runtimeRoot:process.cwd(),dependencyRoot:process.cwd()},{pty:f.pty,multiplexHost:f.host});t.after(()=>broker.close());
 const request=async(route,data,authorization='Bearer '+token)=>{const response=await fetch(broker.ready.origin+route,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:response.status,value:await response.json()};};
 const connection=(await request('/connections/open',{profileId:profile.id,profileVersion:1,requestId:'broker-login',profile})).value,base='/connections/'+connection.connectionId;await tick();assert.equal((await request(base+'/login/complete',{requestId:'broker-login'},'Bearer '+ 'b'.repeat(64))).status,403);assert.equal((await request(base+'/login/complete',{requestId:'broker-login',connectionId:connection.connectionId})).status,400);assert.equal((await request(base+'/login/complete',{requestId:'broker-login'})).value.connection.authentication,'pending');assert.equal(count(f,'prove'),0);
 for(const [requestId,data]of [['trust','yes\r'],['password','INERT_PASSWORD\r'],['otp','123456\r']])assert.equal((await request(base+'/auth/input',{requestId,data})).status,200);
 const ready=await request(base+'/login/complete',{requestId:'broker-login'});assert.equal(ready.status,200);assert.equal(ready.value.connection.authentication,'verified');const repeat=await request(base+'/login/complete',{requestId:'broker-login'});assert.equal(repeat.value.shell.id,ready.value.shell.id);assert.equal(count(f,'prove'),0);assert.equal(f.processes.length,2);assert(!/INERT_PASSWORD|123456|Password:/.test(JSON.stringify(ready)));
});

test('login status reads original progress and late completion without checking, input replay or another shell',async t=>{
 const f=fixture(t),connection=await f.open(),value={connectionId:connection.connectionId,requestId:'login'},auth=gate(),shell=gate();
 const before=[...f.calls];assert.deepEqual(f.manager.loginStatus(value).login,{status:'waiting_authentication'});assert.deepEqual(f.calls,before);
 f.authenticate(connection.connectionId);f.readyGate(auth.promise);f.checkGate(shell.promise);const completion=f.manager.completeLogin(value);while(!count(f,'ready'))await tick();
 for(let i=0;i<3;i++){const calls=[...f.calls];assert.deepEqual(f.manager.loginStatus(value).login,{status:'checking',phase:'checking_authentication'});assert.deepEqual(f.calls,calls);}
 auth.release();while(count(f,'check')<2)await tick();assert.deepEqual(f.manager.loginStatus(value).login,{status:'checking',phase:'opening_shell'});assert.equal(f.processes.length,1);
 shell.release();await completion;const calls=[...f.calls],ready=f.manager.loginStatus(value);assert.deepEqual(ready.login,{status:'complete'});assert(ready.shell?.alive);assert.equal(ready.shell.connectionId,connection.connectionId);
 for(let i=0;i<3;i++)assert.equal(f.manager.loginStatus(value).shell.id,ready.shell.id);assert.deepEqual(f.calls,calls);assert.equal(f.processes.length,2);assert.equal(count(f,'prove'),0);
 assert.throws(()=>f.manager.loginStatus({...value,requestId:'other'}),/request_changed/);assert.throws(()=>f.manager.loginStatus({...value,input:'secret'}),/invalid_request/);
 await f.manager.close({connectionId:connection.connectionId});assert.equal(f.manager.loginStatus(value).login.status,'failed');assert.equal(f.manager.loginStatus(value).shell,undefined);
});

test('canonical account names, shell banners and exec-disabled servers do not add a remote command prerequisite',async t=>{
 const f=fixture(t),connection=await f.open(),value={connectionId:connection.connectionId,requestId:'login'};f.host.prove=()=>assert.fail('Server forbids exec channels; ordinary login must not request one');f.authenticate(connection.connectionId);
 const ready=await f.manager.completeLogin(value);f.processes[1].output('Welcome\r\ncanonical-account$ ');const shell=f.sessions.get(ready.shell.id),read=shell.read({actor:'human',ownerEpoch:ready.shell.ownerEpoch,cursor:0,maxBytes:16384});assert.equal(read.chunks.map(part=>part.data).join(''),'Welcome\r\ncanonical-account$ ');assert.equal(f.manager.loginStatus(value).login.status,'complete');assert.equal(count(f,'prove'),0);assert.equal(count(f,'allocate'),1);
});

test('failed local ownership observation remains a safe read-only outcome without retrying SSH',async t=>{
 const f=fixture(t),connection=await f.open(),value={connectionId:connection.connectionId,requestId:'login'};f.authenticate(connection.connectionId);f.broken(true);await assert.rejects(f.manager.completeLogin(value),/ssh_master_identity_changed/);const calls=[...f.calls],result=f.manager.loginStatus(value);assert.equal(result.login.status,'failed');assert.equal(result.login.code,'ssh_master_identity_changed');assert.equal(result.shell,undefined);assert.deepEqual(f.calls,calls);assert.equal(count(f,'allocate'),1);assert.equal(f.processes.length,1);
});

test('broker login status is authenticated, GET-only, exact-rid and cannot complete a pending login',async t=>{
 const f=fixture(t),token='c'.repeat(64),broker=await startBroker({controlToken:token,instanceId:randomUUID(),runtimeRoot:process.cwd(),dependencyRoot:process.cwd()},{pty:f.pty,multiplexHost:f.host});t.after(()=>broker.close());
 const request=async(route,{method='GET',body,auth=token}={})=>{const response=await fetch(broker.ready.origin+route,{method,headers:{Authorization:'Bearer '+auth,...body?{'Content-Type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{}});return {status:response.status,value:await response.json()};};
 const connection=(await request('/connections/open',{method:'POST',body:{profileId:profile.id,profileVersion:1,requestId:'status-login',profile}})).value,route='/connections/'+connection.connectionId+'/login/status/status-login';await tick();const calls=[...f.calls];
 const read=await request(route);assert.equal(read.status,200);assert.deepEqual(read.value.login,{status:'waiting_authentication'});assert.deepEqual(f.calls,calls);assert.equal(f.processes.length,1);
 assert.equal((await request(route,{auth:'d'.repeat(64)})).status,403);assert.equal((await request(route,{method:'POST',body:{}})).status,405);assert.equal((await request(route+'?extra=1')).status,400);assert.equal((await request(route.replace('status-login','other'))).status,409);assert.deepEqual(f.calls,calls);
});
