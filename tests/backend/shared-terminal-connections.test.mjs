import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';import {PassThrough,Writable} from 'node:stream';import {randomUUID} from 'node:crypto';
import {createSharedTerminal} from '../../backend/main/compute/shared-terminal.mjs';
import {createConversationTerminals} from '../../agent/sessions/conversation-terminals.mjs';
import {createComputeProfiles} from '../../backend/main/compute/compute-profiles.mjs';
import {createSshConnections} from '../../desktop/platform/terminal-service/ssh-connection.mjs';
import {mockTerminalRuntime} from '../helpers/terminal-runtime-fixture.mjs';

function fixture(t,{unsupported=false,dropLoginAck=false,dropPrepareAck=false,dropAbort='none',leaseMs=30000,workspaceCommands=()=>null}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-connection-bridge-')),rows=new Map(),catalog={list:k=>[...rows].filter(([key])=>key.startsWith(k+':')).map(([,v])=>structuredClone(v)),get:(k,id)=>structuredClone(rows.get(k+':'+id)||null),put:(k,id,v)=>rows.set(k+':'+id,structuredClone({...v,id})),remove:(k,id)=>rows.delete(k+':'+id)},profiles=createComputeProfiles({catalog}),draft={kind:'ssh',name:'Fixture',host:'fixture.invalid',username:'fixture',port:2222,mode:'interactive',ssh_client:'/usr/bin/ssh',distribution:'Fixture Linux'},profile=profiles.save({expectedVersion:0,...draft}),sessions=new Map(),processes=[],requests=[];let config,resource=null,resourceRevision=0,context={provider:'codex',threadId:'owned-thread',taskId:'owned-task',projectId:'owned-project',environmentId:'owned-environment',inputRoot:'owned-input'},confirmGate,stateHook,ownerHook;
 const pty={spawn(file,args){let data,exit;const process={pid:1000+processes.length,writes:[],onData:fn=>data=fn,onExit:fn=>exit=fn,write(value){this.writes.push(value);},resize(){},kill(){exit?.({exitCode:0});},emit:value=>data?.(value)};processes.push(process);if(file==='/fixture/master')queueMicrotask(()=>data?.('\x1b[2J\x1b]0;owned title\x07__STUDIO_MASTER_'+args[0]+'__:'+Buffer.from(JSON.stringify({pid:process.pid,start:'123',boot:'00000000-0000-0000-0000-000000000000'})).toString('base64')+'__STUDIO_MASTER_END_'+args[0]+'__\r\nPRIVATE_AUTH_PROMPT'));return process;}};
 const host={allocate:async()=>{if(unsupported)throw Object.assign(Error('ssh_multiplex_unsupported'),{code:'ssh_multiplex_unsupported'});return {socket:'/tmp/fixture/master.sock'};},masterLaunch:(_p,_proof,nonce)=>({file:'/fixture/master',args:[nonce],cwd:root}),slaveLaunch:()=>({file:'/fixture/slave',args:[],cwd:root}),check:async()=>{if(confirmGate)await confirmGate;return {socketIdentity:[1,2]};},ready:async()=>({ready:true}),prove:async()=>{if(confirmGate)await confirmGate;return {socketIdentity:[1,2]};},close:async()=>{},cleanup:async()=>{}};
 const manager=createSshConnections({pty,sessions,host,profileUpdateLeaseMs:leaseMs});
 const rawRequestApi=async(_broker,method,route,body)=>{requests.push({method,route,body:structuredClone(body)});if(route==='/health')return {instanceId:config.instanceId,pid:12345};if(route==='/connections')return manager.list();if(route==='/connections/open')return manager.open(body);if(route==='/sessions')return {sessions:[...sessions.values()].map(s=>s.state())};if(route.startsWith('/connections/profile/')){const operation=route.split('/').at(-1);if(operation==='abort'&&dropAbort==='before')throw Error('lost_abort_request');const result=manager[{prepare:'prepareProfileUpdate',commit:'commitProfileUpdate',abort:'abortProfileUpdate'}[operation]](body);if(operation==='prepare'&&dropPrepareAck||operation==='abort'&&dropAbort==='after')throw Error('lost_transaction_receipt');return result;}const connection=/^\/connections\/([^/]+)\/(.+)$/.exec(route);if(connection){if(connection[2].startsWith('login/status/'))return manager.loginStatus({connectionId:connection[1],requestId:connection[2].slice(13)});if(connection[2]==='login/complete'){const result=await manager.completeLogin({connectionId:connection[1],...body});if(dropLoginAck)throw Object.assign(Error('terminal_login_unknown'),{terminalRejected:true});return result;}const name={state:'state',confirm:'confirm','login/complete':'completeLogin','auth/read':'authRead','auth/input':'authInput','auth/resize':'authResize','shell/open':'openShell',close:'close'}[connection[2]];return manager[name]({connectionId:connection[1],...body});}const session=/^\/sessions\/([^/]+)\/(.+)$/.exec(route);assert(session,route);const s=sessions.get(session[1]);assert(s);if(session[2]==='state'){const value=s.state();if(stateHook)await stateHook();return value;}if(session[2]==='service/state')return s.serviceState();const result=s[session[2]](body);if(session[2]==='owner'&&ownerHook)await ownerHook();if(session[2]==='close')sessions.delete(session[1]);return result;};
 const requestApi=async(...args)=>{try{const service=/^\/connections\/([^/]+)\/service\/(start|state|request)$/.exec(args[2]);if(service)return await manager[{start:'openService',state:'serviceState',request:'serviceRequest'}[service[2]]]({connectionId:service[1],...args[3]});return await rawRequestApi(...args);}catch(error){if(error.code){const e=Error(error.code==='service_active'?'terminal_service_active':error.code);e.terminalRejected=true;throw e;}throw error;}};
 const spawn=()=>{const child=new EventEmitter();child.pid=12345;child.stdout=new PassThrough();child.unref=()=>{};child.stdin=new Writable({write(bytes,_e,done){config=JSON.parse(bytes);queueMicrotask(()=>child.stdout.write(JSON.stringify({origin:'http://127.0.0.1:33222',instanceId:config.instanceId,pid:12345})+'\n'));done();}});return child;};
 const worker={connection:null,connectionEpoch:0},bridge=createSharedTerminal({profiles,catalog,worker,root,dependencyRoot:path.join(root,'deps'),runtimeRoot:path.join(root,'runtime'),servicePath:path.join(root,'broker.mjs'),nodeExecutable:process.execPath,prepareRuntime:mockTerminalRuntime,spawn,requestApi,encryption:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()},current:()=>context,getSelectedResource:()=>resource,selectionRevision:()=>resourceRevision,workspaceCommands,desktopSessionId:'owned-desktop'});
 t.after(async()=>{await manager.closeAll();fs.rmSync(root,{recursive:true,force:true});});
 const open=async requestId=>{const v=await bridge.connections.open({profileId:profile.id,profileVersion:1,requestId:requestId||randomUUID()});await new Promise(r=>setImmediate(r));return v;};
 async function ready(){const v=await open();return bridge.connections.confirm({connectionId:v.connectionId});}
 function select(c){resource={schemaVersion:2,kind:'ssh-connection',connectionId:c.connectionId,profileId:profile.id,profileVersion:c.profileVersion};resourceRevision++;}
 return {bridge,profiles,profile,draft,manager,processes,sessions,requests,worker,open,ready,select,scope:()=>({...context,checkCurrent:()=>true}),context:()=>context,change:v=>{context={...context,...v};},gate:v=>confirmGate=v,onState:v=>stateHook=v,onOwner:v=>ownerHook=v};
}

for(const dispatched of [true,false])test('explicit retry of an unconfirmed open uses one broker master, dispatched='+dispatched,async t=>{
 const f=fixture(t),open=f.manager.open;let attempts=0;
 f.manager.open=async data=>{
  if(++attempts===1){
   if(dispatched)await open(data);
   throw Object.assign(Error('terminal_open_unknown'),{terminalRejected:true});
  }
  return open(data);
 };
 const key='same-open';
 await assert.rejects(f.open(key),/terminal_open_unknown/);
 const before=await f.bridge.connections.list({});
 assert.equal(before.connections.length,dispatched?1:0);
 const [first,second]=await Promise.all([f.open(key),f.open(key)]);
 assert.equal(first.connectionId,second.connectionId);
 if(dispatched)assert.equal(first.connectionId,before.connections[0].connectionId);
 assert.equal(first.loginRequestId,key);
 assert.equal(f.processes.length,1);assert.equal(attempts,2);
 await assert.rejects(f.bridge.connections.open({profileId:'other-profile',profileVersion:1,requestId:key}),/terminal_invalid_request/);
});

test('main human ports hide master authentication from shell inventory, safe state and MCP and return exact schema2 shell metadata',async t=>{
 const f=fixture(t),pending=await f.open(),ref={connectionId:pending.connectionId};assert.equal((await f.bridge.list({})).sessions.length,0);assert((await f.bridge.connections.authRead(ref)).output.includes('PRIVATE_AUTH_PROMPT'));assert(!(JSON.stringify(await f.bridge.connections.list({}))).includes('PRIVATE_AUTH_PROMPT'));await assert.rejects(f.bridge.callTool('compute.sshConnection.authRead',ref,f.scope()),/unknown_operation/);const c=await f.bridge.connections.confirm(ref);assert.equal((await f.bridge.connections.authRead(ref)).output,'');f.select(c);const shell=await f.bridge.connections.openShell({...ref,requestId:'shell'});assert.equal(shell.connectionId,c.connectionId);assert.deepEqual(shell.resource,{kind:'ssh-connection',connectionId:c.connectionId,profileId:f.profile.id,profileVersion:1});assert.equal((await f.bridge.resourceState({sessionId:shell.id})).authentication,'verified');await f.bridge.owner({sessionId:shell.id,ownerEpoch:1,owner:'agent'});assert.equal(f.bridge.hasCurrentGrant('codex',shell.id),true);f.worker.connection={changed:true};f.worker.connectionEpoch++;assert.equal((await f.bridge.callTool('list_shared_terminals',{},f.scope())).sessions[0].id,shell.id);await f.bridge.close({sessionId:shell.id});assert.equal((await f.bridge.connections.state(ref)).authentication,'verified');assert.equal((await f.bridge.connections.list({})).connections.length,1);
});

test('the manual shared-terminal Agent route enters the workspace boundary and fences a reclaimed PTY',async t=>{
 const requests=[];
 const f=fixture(t,{workspaceCommands:()=>({input:value=>{requests.push(value);value.assertCurrent();return {accepted:true,execution_status:'staged'};}})});
 const connection=await f.ready();f.select(connection);
 const shell=await f.bridge.connections.openShell({connectionId:connection.connectionId,requestId:'workspace-share'});
 const shared=await f.bridge.owner({sessionId:shell.id,ownerEpoch:shell.ownerEpoch,owner:'agent'});
 const value=await f.bridge.callTool('write_shared_terminal',{session_id:shell.id,request_id:'1',data:'printf test > /external'},f.scope());
 assert.equal(value.execution_status,'staged');
 assert.equal(requests[0].ref.connectionId,connection.connectionId);
 assert.equal(requests[0].ownerEpoch,shared.ownerEpoch);
 assert.deepEqual(f.processes.at(-1).writes,[]);
 await f.bridge.owner({sessionId:shell.id,ownerEpoch:shared.ownerEpoch,owner:'human'});
 assert.throws(()=>requests[0].assertCurrent(),/scope_denied/);
 await assert.rejects(f.bridge.callTool('write_shared_terminal',{session_id:shell.id,request_id:'2',action:'enter'},f.scope()),/scope_denied/);
 assert.equal(requests.length,1);
});
test('a listed master with a timed-out state read is identified separately from a missing master',async t=>{
 const f=fixture(t),a=await f.ready();
 const readState=f.manager.state.bind(f.manager);
 f.manager.state=async()=>{throw Error('ssh_control_timeout');};
 const waiting=await f.bridge.consoleInventory();
 assert.equal(waiting.complete,true);
 assert.equal(waiting.connections[0].connectionId,a.connectionId);
 assert.equal(waiting.connections[0].verified,false);
 assert.equal(waiting.connections[0].verificationPending,true);
 assert.equal(waiting.connections[0].service,null);
 f.manager.state=readState;
 const restored=await f.bridge.consoleInventory();
 assert.equal(restored.connections[0].verified,true);
 assert.equal(restored.connections[0].verificationPending,undefined);
});

test('console reads multiple broker masters without selecting a conversation or exposing authentication, output or PID',async t=>{
 const f=fixture(t),a=await f.ready(),b=await f.ready();f.select(b);
 const shell=await f.bridge.connections.openShell({connectionId:a.connectionId,requestId:'original-human'});
 await f.open('pending-authentication');f.change({provider:'deepseek',threadId:null});
 const inventory=await f.bridge.consoleInventory();
 assert.equal(inventory.complete,true);
 assert.deepEqual(inventory.connections.map(row=>[row.status,row.authentication,row.verified]),[['authenticated','verified',true],['authenticated','verified',true],['authenticating','pending',true]]);
 assert.deepEqual(inventory.connections[0].capacity,{total:4,occupied:0});
 assert.deepEqual(inventory.sessions.map(row=>[row.connectionId,row.sessionId,row.owner,row.alive]),[[a.connectionId,shell.id,'human',true]]);
 assert.doesNotMatch(JSON.stringify(inventory),/PRIVATE_AUTH_PROMPT|"pid"|"output"|identity_file/);
 assert.equal(f.requests.filter(row=>row.route.includes('/owner')).length,0);
 const original={connectionId:a.connectionId,profileId:f.profile.id,profileVersion:1};
 await assert.rejects(f.bridge.connections.closeExact({...original,profileVersion:2}),/ssh_connection_changed/);
 assert.equal(f.requests.filter(row=>row.route.endsWith('/close')).length,0);
 assert.equal((await f.bridge.connections.closeExact(original)).closed,true);
 assert.deepEqual(f.requests.find(row=>row.route.endsWith('/close')).body,{profileId:f.profile.id,profileVersion:1});
 assert.equal((await f.bridge.connections.state({connectionId:b.connectionId})).authentication,'verified');
});

test('human terminal observation rechecks a harmless message revision without suppressing a real conversation switch',async t=>{const f=fixture(t),c=await f.ready();f.select(c);const shell=await f.bridge.connections.openShell({connectionId:c.connectionId,requestId:'shell'});let once=true;f.onState(()=>{if(once){once=false;f.change({serial:1});}});assert.equal((await f.bridge.read({sessionId:shell.id,ownerEpoch:1})).sessionId,shell.id);once=true;f.onState(()=>{if(once){once=false;f.change({threadId:'other-thread',serial:2});}});await assert.rejects(f.bridge.read({sessionId:shell.id,ownerEpoch:1}),/terminal_context_changed/);});

test('listing the authenticated SSH terminals during first send survives thread creation and worker attachment',async t=>{
 const f=fixture(t),connection=await f.ready();f.select(connection);
 const shell=await f.bridge.connections.openShell({connectionId:connection.connectionId,requestId:'first-send'});
 f.change({threadId:null,taskId:null});const session=f.sessions.get(shell.id),state=session.state;
 session.state=()=>{
  session.state=state;f.change({threadId:'first-message',serial:1});
  f.worker.connection={};f.worker.connectionEpoch++;
  return state();
 };
 const list=await f.bridge.list({});
 assert.deepEqual(list.sessions.map(s=>[s.id,s.owner,s.ownerEpoch]),[[shell.id,'human',1]]);
 assert.equal(f.bridge.hasCurrentGrant('codex',shell.id),false);
 session.state=()=>{session.state=state;f.select(connection);return state();};
 await assert.rejects(f.bridge.list({}),/terminal_context_changed/);
});

test('late shell state cannot roll a completed handoff back to the previous owner',async t=>{
 const f=fixture(t),connection=await f.ready();f.select(connection);
 const shell=await f.bridge.connections.openShell({connectionId:connection.connectionId,requestId:'owner-race'});
 let release,observed;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>observed=resolve);
 f.onState(async()=>{f.onState(null);observed();await gate;});
 const old=f.bridge.resourceState({sessionId:shell.id});await entered;
 const handed=await f.bridge.owner({sessionId:shell.id,ownerEpoch:1,owner:'agent'},{conversation:true});
 release();await assert.rejects(old,/terminal_owner_changed/);
 assert.equal(f.bridge.hasCurrentGrant('codex',shell.id),true);
 const row=(await f.bridge.list({})).sessions[0];assert.equal(row.ownerEpoch,handed.ownerEpoch);
 const input=await f.bridge.callTool('write_shared_terminal',{session_id:shell.id,request_id:'once',data:'marker'},f.scope());
 assert.equal(input.accepted,true);assert.deepEqual(f.processes.at(-1).writes,['marker']);
});

test('a read result for a different owner epoch cannot publish output or replace the current owner',async t=>{
 const f=fixture(t),connection=await f.ready();f.select(connection);
 const shell=await f.bridge.connections.openShell({connectionId:connection.connectionId,requestId:'read-epoch'});
 const {ownerEpoch}=await f.bridge.owner({sessionId:shell.id,ownerEpoch:1,owner:'agent'});
 const session=f.sessions.get(shell.id),read=session.read.bind(session);
 session.read=request=>{const page=read(request);return {...page,state:{...page.state,ownerEpoch:ownerEpoch+1}};};
 await assert.rejects(f.bridge.read({sessionId:shell.id,ownerEpoch}),/terminal_owner_changed/);
 await assert.rejects(f.bridge.callTool('read_shared_terminal',{session_id:shell.id},f.scope()),/terminal_owner_changed/);
 assert.equal((await f.bridge.resourceState({sessionId:shell.id})).ownerEpoch,ownerEpoch);
 assert(f.bridge.hasCurrentGrant('codex',shell.id));
});

test('layout during a message on the same handed-off SSH shell does not report a context switch',async t=>{
 const f=fixture(t),connection=await f.ready();f.select(connection);
 const shell=await f.bridge.connections.openShell({connectionId:connection.connectionId,requestId:'layout'});
 await f.bridge.owner({sessionId:shell.id,ownerEpoch:1,owner:'agent'},{conversation:true});
 f.onState(()=>{f.onState(null);f.change({serial:2});});
 // Payload from the 0.1.5 renderer's ResizeObserver.
 assert.deepEqual(await f.bridge.resize({sessionId:shell.id,cols:110,rows:32}),{accepted:true});
 assert.equal(f.bridge.hasCurrentGrant('codex',shell.id),true);
});

test('SSH resize follows the displayed PTY epoch through a normal message and refuses a stale display',async t=>{
 const f=fixture(t),connection=await f.ready();f.select(connection);
 const shell=await f.bridge.connections.openShell({connectionId:connection.connectionId,requestId:'resize'});
 const handoff=await f.bridge.owner({sessionId:shell.id,ownerEpoch:1,owner:'agent'},{conversation:true});
 const size={sessionId:shell.id,ownerEpoch:handoff.ownerEpoch,cols:110,rows:32};
 f.onState(()=>{f.onState(null);f.change({serial:1});f.worker.connection={};f.worker.connectionEpoch++;});
 assert.deepEqual(await f.bridge.resize(size),{accepted:true});
 assert.equal(f.bridge.hasCurrentGrant('codex',shell.id),true);
 const resizes=()=>f.requests.filter(r=>r.route.endsWith('/resize')).length;
 await f.bridge.owner({sessionId:shell.id,ownerEpoch:size.ownerEpoch,owner:'human'});
 await assert.rejects(f.bridge.resize(size),/terminal_owner_changed/);
 assert.equal(resizes(),1);assert.equal(f.bridge.hasCurrentGrant('codex',shell.id),false);
});

test('conversation PTYs keep their original shell and deny cross-thread reads after a switch',async t=>{
 const f=fixture(t),connection=await f.ready();f.select(connection);
 const a=await f.bridge.connections.openShell({connectionId:connection.connectionId,requestId:'A'});
 const grant=s=>f.bridge.owner({sessionId:s.sessionId,owner:'agent',ownerEpoch:s.ownerEpoch},{conversation:true});
 await grant(a);const original=f.context();f.change({threadId:'B'});f.bridge.reconcileContext();
 const b=await f.bridge.connections.openShell({connectionId:connection.connectionId,requestId:'B'});const handed=await grant(b);
 assert.deepEqual((await f.bridge.callTool('list_shared_terminals',{},f.scope())).sessions.map(s=>s.sessionId),[b.sessionId]);
 await assert.rejects(f.bridge.callTool('read_shared_terminal',{session_id:a.sessionId},f.scope()),/scope_denied/);
 f.change(original);f.bridge.reconcileContext();assert.equal(f.bridge.hasCurrentGrant('codex',a.sessionId),true);
 await f.bridge.closeConversationShell({connectionId:connection.connectionId,sessionId:b.sessionId,ownerEpoch:handed.ownerEpoch});
 assert.equal(f.sessions.has(b.sessionId),false);assert.equal(f.sessions.has(a.sessionId),true);
 f.change({projectId:'changed-project'});f.bridge.reconcileContext();f.change(original);assert.equal(f.bridge.hasCurrentGrant('codex',a.sessionId),false);
});

async function planningShell(t){
 const f=fixture(t),connection=await f.ready();f.select(connection);
 f.change({provider:'deepseek',taskId:null,projectId:null,environmentId:null,inputRoot:null,serial:1});
 const ref={kind:'ssh-connection',connectionId:connection.connectionId,profileId:f.profile.id,profileVersion:f.profile.version};
 const service={peek:()=>({...ref,workflowReady:true,status:'connected',attemptId:'attempt'}),hasCurrentGrant:()=>true,reclaimTerminalHandoff(){}};
 const pool=createConversationTerminals({terminal:f.bridge,service,resource:{peek:()=>ref,capture:()=>ref,assertCurrent:v=>assert.equal(v,ref)},
  current:f.context,idleMinutes:()=>60});
 const shell=await f.bridge.connections.openShell({connectionId:connection.connectionId,requestId:'chat'});
 const owned=await pool.arm(shell,'deepseek');
 return {...f,pool,shell:owned,read:scope=>f.bridge.callTool('read_shared_terminal',{session_id:shell.sessionId},scope)};
}

test('DeepSeek chat, task creation and first workspace binding retain the same PTY, read cursor and input ledger',async t=>{
 const f=await planningShell(t),id=f.shell.sessionId,chat=f.scope(),pty=f.processes.at(-1);
 const write=scope=>f.bridge.callTool('write_shared_terminal',{session_id:id,request_id:'one-input',data:'pwd\r'},scope);
 await write(chat);pty.emit('first output\r\n');
 const initial=await f.read(chat);assert.match(initial.output,/first output/);
 const task=f.pool.prepareAuthoringGrant();f.change({taskId:'real-task'});f.bridge.reconcileContext();
 assert.equal(f.bridge.hasCurrentGrant('deepseek',id),false);task(true);
 assert(f.pool.describe(f.shell).currentConversation);const unbound=f.scope();
 const workspace=f.pool.prepareAuthoringGrant();f.change({projectId:'project',environmentId:'environment',inputRoot:'/project/input'});workspace(true);
 const bound=f.scope();await f.pool.acquire('deepseek',f.context());
 const listed=await f.bridge.callTool('list_shared_terminals',{},bound);
 assert.deepEqual(listed.sessions.map(s=>[s.sessionId,s.ownerEpoch]),[[id,f.shell.ownerEpoch]]);
 await assert.rejects(f.read(chat),/scope_denied/);await assert.rejects(f.read(unbound),/scope_denied/);
 await write(bound);assert.deepEqual(pty.writes,['pwd\r']);assert.match((await f.read(bound)).output,/first output/);
 pty.emit('next output\r\n');const page=await f.bridge.callTool('read_shared_terminal',{session_id:id,cursor:initial.cursor},bound);
 assert.match(page.output,/next output/);assert.doesNotMatch(page.output,/first output/);
});

test('pending authoring cannot recreate a reclaimed shell, change projects or cross a selection',async t=>{
 for(const reason of ['reclaim','project','selection','aborted']){
  const f=await planningShell(t),id=f.shell.sessionId;
  const first=f.pool.prepareAuthoringGrant();f.change({taskId:'owned',projectId:'initial'});first(true);
  const second=f.pool.prepareAuthoringGrant();
  if(reason==='reclaim')await f.bridge.owner({sessionId:id,owner:'human',ownerEpoch:f.shell.ownerEpoch});
  if(reason==='selection')f.change({serial:2});
  f.change({environmentId:'env',...reason==='project'?{projectId:'other'}:{}});
  second(reason!=='aborted');f.bridge.reconcileContext();assert.equal(f.bridge.hasCurrentGrant('deepseek',id),false,reason);
  await assert.rejects(f.read(f.scope()),/scope_denied/);
 }
});

function emulateByteOnlyBrokerRead(session){
 const currentRead=session.read.bind(session);
 session.read=request=>{
  const max=request.maxBytes??65536,first=currentRead({...request,maxBytes:262144}),output=[];let bytes=0,page=first;
  while(page.chunks.length){for(const chunk of page.chunks){const size=Buffer.byteLength(chunk.data);if(bytes+size>max)return {...first,chunks:output,cursor:output.at(-1)?.sequence??first.cursor};output.push(chunk);bytes+=size;}page=currentRead({...request,cursor:output.at(-1).sequence,maxBytes:262144});}
  return {...first,chunks:output,cursor:output.at(-1)?.sequence??first.cursor};
 };
}

for(const legacy of [false,true])for(const actor of ['human','agent'])test((legacy?'already-running byte-only broker':'new broker')+' pages many small chunks for '+actor+' without loss or replay',async t=>{
 const f=fixture(t),connection=await f.ready();f.select(connection);const shell=await f.bridge.connections.openShell({connectionId:connection.connectionId,requestId:'small-output-shell'}),session=f.sessions.get(shell.id),terminal=f.processes.at(-1);let ownerEpoch=shell.ownerEpoch;
 if(actor==='agent'){terminal.emit('PRIVATE_AUTH_HISTORY\r\n');ownerEpoch=(await f.bridge.owner({sessionId:shell.id,ownerEpoch,owner:'agent'})).ownerEpoch;}
 const expected=Array.from({length:1800},(_,index)=>'line-'+index+' 中文🙂\r\n');for(const text of expected)terminal.emit(text);if(legacy)emulateByteOnlyBrokerRead(session);
 let cursor=0,received=[];for(let page=0;page<10;page++){const value=actor==='human'?await f.bridge.read({sessionId:shell.id,ownerEpoch,cursor,maxBytes:65536}):await f.bridge.callTool('read_shared_terminal',{session_id:shell.id,cursor,max_bytes:65536},f.scope());assert(value.chunks.length<=512);assert(Buffer.byteLength(value.output)<=65536);assert.equal(value.dropped,false);assert(!value.output.includes('PRIVATE_AUTH_HISTORY'));if(!value.chunks.length){assert.equal(value.cursor,cursor);break;}assert.equal(value.cursor,value.chunks.at(-1).sequence);for(const chunk of value.chunks){assert(chunk.sequence>cursor);cursor=chunk.sequence;received.push(chunk.data);}}
 assert.deepEqual(received,expected);assert.equal(cursor,session.state().sequence);assert.equal(f.processes.length,2);assert(f.processes.every(process=>process.writes.length===0));
 if(actor==='agent'){await f.bridge.owner({sessionId:shell.id,ownerEpoch,owner:'human'});await assert.rejects(f.bridge.callTool('read_shared_terminal',{session_id:shell.id,cursor},f.scope()),/scope_denied/);}
});

for(const legacy of [false,true])test((legacy?'legacy':'new')+' small-chunk pagination preserves actual ring overflow and subsequent Agent cursors',async t=>{
 const f=fixture(t),connection=await f.ready();f.select(connection);const shell=await f.bridge.connections.openShell({connectionId:connection.connectionId,requestId:'overflow-pages'}),session=f.sessions.get(shell.id),terminal=f.processes.at(-1);
 terminal.emit('PRIVATE_AUTH_HISTORY\r\n');await f.bridge.owner({sessionId:shell.id,ownerEpoch:shell.ownerEpoch,owner:'agent'});
 const expected=Array.from({length:9000},(_,index)=>('overflow-'+index).padEnd(58,'x')+'🙂\r\n');for(const text of expected)terminal.emit(text);assert.equal(session.bufferedBytes(),512*1024);if(legacy)emulateByteOnlyBrokerRead(session);
 let cursor=0,received=[];for(let page=0;page<20;page++){const value=await f.bridge.callTool('read_shared_terminal',{session_id:shell.id,cursor,max_bytes:65536},f.scope());assert(value.chunks.length<=512);assert.equal(value.dropped,page===0);assert(!value.output.includes('PRIVATE_AUTH_HISTORY'));if(!value.chunks.length){assert.equal(value.cursor,cursor);break;}assert.equal(value.cursor,value.chunks.at(-1).sequence);assert(value.cursor>cursor);cursor=value.cursor;received.push(...value.chunks.map(chunk=>chunk.data));}
 assert.deepEqual(received,expected.slice(-8192));assert.equal(cursor,session.state().sequence);assert.equal(cursor,9001);assert(f.processes.every(process=>process.writes.length===0));
});

for(const malformed of ['tail sequence rollback','tail invalid data','cursor before returned chunks','reply beyond byte bound'])test('legacy pagination still rejects '+malformed+' before returning a prefix',async t=>{
 const f=fixture(t),connection=await f.ready();f.select(connection);const shell=await f.bridge.connections.openShell({connectionId:connection.connectionId,requestId:'malformed-read-shell'}),session=f.sessions.get(shell.id),terminal=f.processes.at(-1);
 for(let index=0;index<1000;index++)terminal.emit('x');const original=session.read.bind(session);
 session.read=request=>{const observed=original(request),chunks=Array.from({length:1000},(_,index)=>({sequence:index+1,data:'x'}));let cursor=1000;if(malformed==='tail sequence rollback')chunks[700].sequence=2;else if(malformed==='tail invalid data')chunks[700].data=null;else if(malformed==='cursor before returned chunks')cursor=1;else chunks[700].data='x'.repeat(262145);return {...observed,chunks,cursor};};
 await assert.rejects(f.bridge.read({sessionId:shell.id,ownerEpoch:shell.ownerEpoch,cursor:0,maxBytes:65536}),/terminal_unavailable/);
});

test('trusted service update origin keeps the exact original shell and refuses a revoked or foreign owner without changing ownership',async t=>{
 const f=fixture(t),connection=await f.ready();f.select(connection);const shell=await f.bridge.connections.openShell({connectionId:connection.connectionId,requestId:'update-shell'}),owned=await f.bridge.owner({sessionId:shell.id,ownerEpoch:shell.ownerEpoch,owner:'agent'});let view;
 f.manager.openService=async value=>(view={connectionId:value.connectionId,profileId:f.profile.id,profileVersion:1,status:'connected',serviceId:'owned-service',serviceActive:true,terminalSessionId:value.terminalSessionId});f.manager.serviceState=async()=>view;
 await f.bridge.connections.openService({connectionId:connection.connectionId,profileId:f.profile.id,profileVersion:1,requestId:'service-start'},{source:'inert'}, {sessionId:shell.id});const count=f.processes.length,ref={connectionId:connection.connectionId,serviceId:'owned-service'},ticket=await f.bridge.connections.prepareServiceUpdate(ref);assert.equal(ticket.sessionId,shell.id);ticket.assertCurrent();assert.equal(f.processes.length,count);
 const owners=f.requests.filter(value=>value.route.endsWith('/owner')).length;await f.bridge.owner({sessionId:shell.id,ownerEpoch:owned.ownerEpoch,owner:'human'});assert.throws(ticket.assertCurrent,/scope_denied/);await assert.rejects(f.bridge.connections.prepareServiceUpdate(ref),/scope_denied/);assert.equal(f.requests.filter(value=>value.route.endsWith('/owner')).length,owners+1);assert.equal(f.processes.length,count);
});

test('confirmed private maintenance channel clears only the previous borrowed transport lease, preserving raw shell ownership',async t=>{
 const f=fixture(t),connection=await f.ready();f.select(connection);const shell=await f.bridge.connections.openShell({connectionId:connection.connectionId,requestId:'maintenance-shell'});await f.bridge.owner({sessionId:shell.id,ownerEpoch:shell.ownerEpoch,owner:'agent'});let service,packet;
 f.manager.openService=async value=>(service={connectionId:value.connectionId,profileId:f.profile.id,profileVersion:1,status:'connected',serviceId:value.requestId,serviceActive:true,...value.terminalSessionId?{terminalSessionId:value.terminalSessionId}:{}});f.manager.serviceState=async()=>service;f.manager.serviceRequest=async value=>{packet=value;return {status:200,data:{}};};const base={connectionId:connection.connectionId,profileId:f.profile.id,profileVersion:1};await f.bridge.connections.openService({...base,requestId:'shared-service'},{source:'inert'},{sessionId:shell.id});await f.bridge.connections.serviceRequest({connectionId:connection.connectionId,serviceId:'shared-service',requestId:'before-private',method:'GET',target:'/api/health',mcp:false});assert(packet.terminalScope);
 await f.bridge.connections.openService({...base,requestId:'private-maintenance'},{source:'inert'});await f.bridge.connections.serviceRequest({connectionId:connection.connectionId,serviceId:'private-maintenance',requestId:'after-private',method:'GET',target:'/api/health',mcp:false});assert.equal(packet.terminalScope,undefined);assert.equal(packet.terminalOwnerEpoch,undefined);assert.equal(f.bridge.hasCurrentGrant('codex',shell.id),true);assert.equal((await f.bridge.resourceState({sessionId:shell.id})).operator,'agent');
});
test('viewport resize after Agent handoff keeps its owner and grant and cannot write terminal input',async t=>{
 const f=fixture(t),c=await f.open('resize-login');
 await f.bridge.connections.completeLogin({connectionId:c.connectionId,requestId:'resize-login'});f.select(c);
 const shell=await f.bridge.connections.openShell({connectionId:c.connectionId,requestId:'resize-shell'});
 await f.bridge.owner({sessionId:shell.sessionId,ownerEpoch:shell.ownerEpoch,owner:'agent'});
 assert.equal((await f.bridge.resize({sessionId:shell.sessionId,cols:120,rows:36})).accepted,true);
 assert.equal(f.bridge.hasCurrentGrant('codex',shell.sessionId),true);
 const state=(await f.bridge.list({})).sessions.find(s=>s.sessionId===shell.sessionId);assert.equal(state.owner,'agent');
 await assert.rejects(f.bridge.input({sessionId:shell.sessionId,ownerEpoch:state.ownerEpoch,requestId:'blocked-human',data:'must-not-run\r'}),/human_owned/);
 assert.equal(f.processes.length,2);
});

test('human login completion leaves the exact shell for an explicit open and does not grant it to any Agent',async t=>{
 const f=fixture(t),requestId='one-human-login',c=await f.open(requestId),ref={connectionId:c.connectionId,requestId};
 const completed=await f.bridge.connections.completeLogin(ref);
 assert.equal(completed.connection.authentication,'verified');assert.equal(completed.shell,undefined);
 const repeated=await f.bridge.connections.completeLogin(ref);assert.equal(repeated.shell,undefined);assert.equal(f.processes.length,1);
 const shellRequest={connectionId:c.connectionId,requestId:'human-shell'};
 const shell=await f.bridge.connections.openShell(shellRequest);assert.equal(shell.connectionId,c.connectionId);assert.equal(shell.owner,'human');
 assert.equal((await f.bridge.connections.openShell(shellRequest)).sessionId,shell.sessionId);assert.equal(f.processes.length,2);
 assert.equal((await f.bridge.list({})).sessions.length,1);assert.equal(f.bridge.hasCurrentGrant('codex',shell.sessionId),false);
 await assert.rejects(f.bridge.connections.completeLogin({...ref,requestId:'foreign-login'}),/terminal_unavailable/);assert.equal(f.processes.length,2);assert.equal((await f.bridge.connections.state({connectionId:c.connectionId})).authentication,'verified');
 await assert.rejects(f.bridge.callTool('compute.sshConnection.completeLogin',ref,f.scope()),/unknown_operation/);
});

test('a delayed connection observation keeps the newest exact broker state without reporting a changed connection',async t=>{
 const f=fixture(t),connection=await f.open('ordered-login'),ref={connectionId:connection.connectionId};
 const state=f.manager.state.bind(f.manager);let release,observed;
 f.manager.state=async value=>{const snapshot=await state(value);observed?.();await new Promise(resolve=>{release=resolve;});return snapshot;};
 const captured=new Promise(resolve=>{observed=resolve;}),pending=f.bridge.connections.state(ref);await captured;
 const completed=await f.bridge.connections.completeLogin({...ref,requestId:'ordered-login'});assert.equal(completed.connection.status,'authenticated');
 release();const delayed=await pending;
 assert.equal(delayed.connectionId,connection.connectionId);assert.equal(delayed.revision,completed.connection.revision);assert.equal(delayed.status,'authenticated');assert.deepEqual(delayed.terminalSessionIds,[]);
 assert.equal(f.processes.length,1);assert.equal(f.requests.filter(value=>value.route==='/connections/open').length,1);
});

test('a delayed observation cannot restore authentication after the exact original master was closed',async t=>{
 const f=fixture(t),connection=await f.ready(),ref={connectionId:connection.connectionId};
 const state=f.manager.state.bind(f.manager);let release,observed;
 f.manager.state=async value=>{const snapshot=await state(value);observed?.();await new Promise(resolve=>{release=resolve;});return snapshot;};
 const captured=new Promise(resolve=>{observed=resolve;}),pending=f.bridge.connections.state(ref);await captured;
 const closed=await f.bridge.connections.close(ref);assert.equal(closed.closed,true);
 release();const delayed=await pending;assert.equal(delayed.status,'closed');assert.equal(delayed.authentication,'lost');assert.equal(delayed.revision,closed.revision);assert.equal(f.processes.length,1);
});
test('a profile edit while completing human login cannot create or attach a stale shell',async t=>{
 const f=fixture(t),requestId='stale-login',c=await f.open(requestId);f.profiles.save({id:f.profile.id,expectedVersion:1,...f.draft,host:'new.invalid'});
 await assert.rejects(f.bridge.connections.completeLogin({connectionId:c.connectionId,requestId}),/saved_connection_changed/);assert.equal((await f.bridge.list({})).sessions.length,0);
});
test('a lost completion receipt is recovered by GET status without replaying login or granting Agent use',async t=>{
 const f=fixture(t,{dropLoginAck:true}),requestId='lost-completion',c=await f.open(requestId),ref={connectionId:c.connectionId,requestId};
 await assert.rejects(f.bridge.connections.completeLogin(ref),/terminal_login_unknown/);
 const before=f.requests.filter(value=>value.method==='POST'&&value.route.endsWith('/login/complete')).length;
 const recovered=await f.bridge.connections.loginStatus(ref);
 assert.equal(recovered.login.status,'complete');assert.equal(recovered.connection.authentication,'verified');assert.equal(recovered.shell,undefined);
 assert.equal(f.requests.filter(value=>value.method==='POST'&&value.route.endsWith('/login/complete')).length,before);assert.equal(f.processes.length,1);
 assert.equal(f.bridge.hasCurrentGrant('codex'),false);assert.equal((await f.bridge.list({})).sessions.length,0);
 await assert.rejects(f.bridge.connections.loginStatus({...ref,requestId:'wrong-attempt'}),/terminal_invalid_request|terminal_unavailable/);assert.equal(f.processes.length,1);
 await assert.rejects(f.bridge.callTool('compute.sshConnection.loginStatus',ref,f.scope()),/unknown_operation/);
});
test('observing a pending login creates no shell and a closed login shell is never reopened by observation',async t=>{
 const f=fixture(t),requestId='observe-only',c=await f.open(requestId),ref={connectionId:c.connectionId,requestId};
 const pending=await f.bridge.connections.loginStatus(ref);assert.equal(pending.login.status,'waiting_authentication');assert.equal(pending.shell,undefined);assert.equal(f.processes.length,1);
 await f.bridge.connections.completeLogin(ref);
 const shell=await f.bridge.connections.openShell({connectionId:c.connectionId,requestId:'close-after-login'});
 await f.bridge.close({sessionId:shell.sessionId});
 const after=await f.bridge.connections.loginStatus(ref);assert.equal(after.login.status,'complete');assert.equal(after.shell,undefined);assert.equal(f.processes.length,2);
});
test('current project/environment/input-root changes permanently revoke shell grant even when same chat and task return',async t=>{
 const f=fixture(t),c=await f.ready();f.select(c);const shell=await f.bridge.connections.openShell({connectionId:c.connectionId,requestId:'shell'});await f.bridge.owner({sessionId:shell.id,ownerEpoch:1,owner:'agent'});const before=f.context();f.change({environmentId:'other-env'});f.bridge.reconcileContext();f.change(before);assert.equal(f.bridge.hasCurrentGrant('codex',shell.id),false);await assert.rejects(f.bridge.callTool('read_shared_terminal',{session_id:shell.id},f.scope()),/scope_denied/);
});
test('new login must use latest profile while an authenticated old connection keeps its immutable route',async t=>{
 const f=fixture(t),c=await f.ready();f.select(c);const saved=f.profiles.save({id:f.profile.id,expectedVersion:1,...f.draft,host:'new.invalid'});assert.equal(saved.version,2);await assert.rejects(f.bridge.connections.open({profileId:f.profile.id,profileVersion:1,requestId:'stale-login'}),/saved_connection_changed/);assert.equal(f.processes.length,1);const shell=await f.bridge.connections.openShell({connectionId:c.connectionId,requestId:'same-master'});assert.equal(shell.resource.profileVersion,1);assert.equal((await f.bridge.connections.state({connectionId:c.connectionId})).authentication,'verified');
});
test('profile edit during authentication prevents confirmation and closes only its own master',async t=>{
 const f=fixture(t),c=await f.open();f.profiles.save({id:f.profile.id,expectedVersion:1,...f.draft,host:'changed-before-auth.invalid'});await assert.rejects(f.bridge.connections.confirm({connectionId:c.connectionId}),/saved_connection_changed/);assert.equal((await f.manager.state({connectionId:c.connectionId})).status,'closed');assert.equal(f.processes.length,1);
});
test('environment-only update locks and adopts master and exact shell profile versions without new SSH processes',async t=>{
 const f=fixture(t),c=await f.ready();f.select(c);const shell=await f.bridge.connections.openShell({connectionId:c.connectionId,requestId:'shell'}),next={...f.profile,version:2,serviceEnvironment:{python:'python3.9',activation:''}};const receipt=await f.bridge.prepareProfileEnvironmentUpdate({previous:f.profile,next});assert.deepEqual(receipt.connectionIds,[c.connectionId]);assert.deepEqual(receipt.sessionIds,[shell.id]);await assert.rejects(f.bridge.connections.openShell({connectionId:c.connectionId,requestId:'while-saving'}),/terminal_service_active/);f.bridge.assertProfileEnvironmentUpdate(receipt);const saved=f.profiles.save({id:f.profile.id,expectedVersion:1,...f.draft,serviceEnvironment:{python:'python3.9'}});const result=await f.bridge.commitProfileEnvironmentUpdate(receipt,saved);assert.deepEqual(result,{sessionIds:[shell.id],connectionIds:[c.connectionId]});assert.equal((await f.bridge.connections.state({connectionId:c.connectionId})).profileVersion,2);assert.equal((await f.bridge.resourceState({sessionId:shell.id})).resource.profileVersion,2);assert.equal(f.processes.length,2);
});


test('more than eight closed connections remain listable and preserve exact identity without another broker',async t=>{
 const f=fixture(t),ids=[];for(let index=0;index<9;index++){const c=await f.ready();ids.push(c.connectionId);const closed=await f.bridge.connections.close({connectionId:c.connectionId});assert.equal(closed.closed,true);}
 const listed=await f.bridge.connections.list({});assert.deepEqual(listed.connections.map(c=>c.connectionId),ids);assert(listed.connections.every(c=>c.status==='closed'&&c.profileId===f.profile.id&&c.profileVersion===1));assert.equal(f.processes.length,9);assert.equal((await f.bridge.connections.state({connectionId:ids[0]})).status,'closed');assert.equal(f.profiles.read({id:f.profile.id}).version,1);
});
test('all sixty-four unsupported broker records remain listable while a sixty-fifth request is refused',async t=>{
 const f=fixture(t,{unsupported:true}),ids=[];for(let index=0;index<64;index++){const c=await f.open();assert.equal(c.status,'unsupported');ids.push(c.connectionId);}
 const listed=await f.bridge.connections.list({});assert.deepEqual(listed.connections.map(c=>c.connectionId),ids);assert.equal(f.processes.length,0);await assert.rejects(f.open(),/ssh_connection_limit/);assert.equal((await f.bridge.connections.list({})).connections.length,64);
});
test('connection listing rejects duplicate ids, changed fixed profile identity and more than sixty-four broker rows',async t=>{
 const f=fixture(t),c=await f.ready(),original=f.manager.list.bind(f.manager),row=original().connections[0];
 f.manager.list=()=>({connections:[row,row]});await assert.rejects(f.bridge.connections.list({}),/terminal_unavailable/);
 f.manager.list=()=>({connections:[{...row,profileId:'different-profile'}]});await assert.rejects(f.bridge.connections.list({}),/ssh_connection_changed/);
 f.manager.list=()=>({connections:[{...row,terminalSessionIds:['same-shell','same-shell']}]});await assert.rejects(f.bridge.connections.list({}),/terminal_unavailable/);
 f.manager.list=()=>({connections:Array.from({length:65},()=>({...row,connectionId:randomUUID()}))});await assert.rejects(f.bridge.connections.list({}),/terminal_unavailable/);
 f.manager.list=original;assert.equal((await f.bridge.connections.state({connectionId:c.connectionId})).authentication,'verified');
});

test('older revisions never excuse foreign profile or login identities and safe failure causes remain visible',async t=>{
 const f=fixture(t),c=await f.ready(),row=f.manager.list().connections[0];
 for(const patch of [{profileId:'foreign-profile'},{loginRequestId:'foreign-login'}]){f.manager.list=()=>({connections:[{...row,...patch,revision:row.revision-1}]});await assert.rejects(f.bridge.connections.list({}),/ssh_connection_changed/);}
 for(const [index,code]of ['terminal_start_failed','terminal_runtime_low_integrity','PRIVATE_UNTRUSTED_ERROR'].entries()){
  f.manager.list=()=>({connections:[{...row,revision:row.revision+index+1,status:'unavailable',authentication:'not_observed',error:{code,message:'PRIVATE_ERROR_DETAIL'}}]});
  const observed=(await f.bridge.connections.list({})).connections[0];assert.equal(observed.error?.code,code==='PRIVATE_UNTRUSTED_ERROR'?undefined:code);assert(!JSON.stringify(observed).includes('PRIVATE_'));
 }
 assert.equal(f.processes.length,1);
});


for(const dropAbort of ['none','after','before'])test('main knows the exact preparation token before a lost receipt and bounds abort loss '+dropAbort,async t=>{
 const f=fixture(t,{dropPrepareAck:true,dropAbort,leaseMs:60}),c=await f.ready(),next={...f.profile,version:2,serviceEnvironment:{python:'python3.9',activation:''}};await assert.rejects(f.bridge.prepareProfileEnvironmentUpdate({previous:f.profile,next}),/terminal_unavailable/);const prepares=f.requests.filter(x=>x.route==='/connections/profile/prepare'),aborts=f.requests.filter(x=>x.route==='/connections/profile/abort');assert.equal(prepares.length,1);assert.equal(aborts.length,1);assert.equal(typeof prepares[0].body.token,'string');assert.equal(aborts[0].body.token,prepares[0].body.token);assert.equal(f.requests.filter(x=>x.route==='/connections/profile/commit').length,0);assert.equal(f.profiles.read({id:f.profile.id}).version,1);
 if(dropAbort==='before'){await assert.rejects(f.manager.openShell({connectionId:c.connectionId,requestId:'before-expiry'}),/service_active/);await new Promise(resolve=>setTimeout(resolve,90));}
 assert.throws(()=>f.manager.commitProfileUpdate({token:prepares[0].body.token,profile:next}),/connection_changed/);await f.manager.openShell({connectionId:c.connectionId,requestId:'after-abort-or-expiry'});assert.equal((await f.manager.state({connectionId:c.connectionId})).profileVersion,1);assert.equal(f.processes.length,2);
});


test('an already stale handoff callback cannot clear a newer exact shell grant before any RPC',async t=>{
 const f=fixture(t),c=await f.ready();f.select(c);const shell=await f.bridge.connections.openShell({connectionId:c.connectionId,requestId:'shell'});await f.bridge.owner({sessionId:shell.id,ownerEpoch:1,owner:'agent'});const count=f.requests.length;await assert.rejects(f.bridge.owner({sessionId:shell.id,ownerEpoch:2,owner:'agent'},{assertCurrent:()=>{throw Error('stale_hint');}}),/terminal_context_changed/);assert.equal(f.requests.length,count);assert.equal(f.bridge.hasCurrentGrant('codex',shell.id),true);
});
test('handoff freshness changing during state read prevents the remote owner RPC',async t=>{
 const f=fixture(t),c=await f.ready();f.select(c);const shell=await f.bridge.connections.openShell({connectionId:c.connectionId,requestId:'shell'});let stale=false;f.onState(()=>{stale=true;});const count=f.requests.filter(x=>x.route.endsWith('/owner')).length;await assert.rejects(f.bridge.owner({sessionId:shell.id,ownerEpoch:1,owner:'agent'},{assertCurrent:()=>{if(stale)throw Error('stale_hint');}}),/terminal_context_changed/);assert.equal(f.requests.filter(x=>x.route.endsWith('/owner')).length,count);assert.equal(f.sessions.get(shell.id).state().owner,'human');assert.equal(f.bridge.hasCurrentGrant('codex',shell.id),false);
});
test('a handoff superseded during the owner RPC installs no grant and sends no compensating ownership command',async t=>{
 const f=fixture(t),c=await f.ready();f.select(c);const shell=await f.bridge.connections.openShell({connectionId:c.connectionId,requestId:'shell'});let stale=false;f.onOwner(()=>{stale=true;});const count=f.requests.filter(x=>x.route.endsWith('/owner')).length;await assert.rejects(f.bridge.owner({sessionId:shell.id,ownerEpoch:1,owner:'agent'},{assertCurrent:()=>{if(stale)throw Error('stale_hint');}}),/terminal_context_changed/);assert.equal(f.requests.filter(x=>x.route.endsWith('/owner')).length,count+1);assert.equal(f.bridge.hasCurrentGrant('codex',shell.id),false);const observed=await f.bridge.resourceState({sessionId:shell.id});assert.equal(observed.ownerEpoch,2);assert.equal(observed.operator,'agent');assert.equal(observed.agentReady,false);
});
