import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';import {PassThrough,Writable} from 'node:stream';import {randomUUID} from 'node:crypto';
import {createSharedTerminal} from '../../backend/main/compute/shared-terminal.mjs';
import {createComputeProfiles} from '../../backend/main/compute/compute-profiles.mjs';
import {createSshConnections} from '../../desktop/platform/terminal-service/ssh-connection.mjs';
import {mockTerminalRuntime} from '../helpers/terminal-runtime-fixture.mjs';

function fixture(t,{unsupported=false,dropLoginAck=false,dropPrepareAck=false,dropAbort='none',leaseMs=30000}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-connection-bridge-')),rows=new Map(),catalog={list:k=>[...rows].filter(([key])=>key.startsWith(k+':')).map(([,v])=>structuredClone(v)),get:(k,id)=>structuredClone(rows.get(k+':'+id)||null),put:(k,id,v)=>rows.set(k+':'+id,structuredClone({...v,id})),remove:(k,id)=>rows.delete(k+':'+id)},profiles=createComputeProfiles({catalog}),draft={kind:'ssh',name:'Fixture',host:'fixture.invalid',username:'fixture',port:2222,mode:'interactive',ssh_client:'/usr/bin/ssh',distribution:'Fixture Linux'},profile=profiles.save({expectedVersion:0,...draft}),sessions=new Map(),processes=[],requests=[];let config,resource=null,resourceRevision=0,context={provider:'codex',threadId:'owned-thread',taskId:'owned-task',projectId:'owned-project',environmentId:'owned-environment',inputRoot:'owned-input'},confirmGate,stateHook,ownerHook;
 const pty={spawn(file,args){let data,exit;const process={pid:1000+processes.length,writes:[],onData:fn=>data=fn,onExit:fn=>exit=fn,write(value){this.writes.push(value);},resize(){},kill(){exit?.({exitCode:0});},emit:value=>data?.(value)};processes.push(process);if(file==='/fixture/master')queueMicrotask(()=>data?.('\x1b[2J\x1b]0;owned title\x07__STUDIO_MASTER_'+args[0]+'__:'+Buffer.from(JSON.stringify({pid:process.pid,start:'123',boot:'00000000-0000-0000-0000-000000000000'})).toString('base64')+'\r\nPRIVATE_AUTH_PROMPT'));return process;}};
 const host={allocate:async()=>{if(unsupported)throw Object.assign(Error('ssh_multiplex_unsupported'),{code:'ssh_multiplex_unsupported'});return {socket:'/tmp/fixture/master.sock'};},masterLaunch:(_p,_proof,nonce)=>({file:'/fixture/master',args:[nonce],cwd:root}),slaveLaunch:()=>({file:'/fixture/slave',args:[],cwd:root}),check:async()=>{if(confirmGate)await confirmGate;return {socketIdentity:[1,2]};},ready:async()=>({ready:true}),prove:async()=>{if(confirmGate)await confirmGate;return {socketIdentity:[1,2]};},close:async()=>{},cleanup:async()=>{}};
 const manager=createSshConnections({pty,sessions,host,profileUpdateLeaseMs:leaseMs});
 const rawRequestApi=async(_broker,method,route,body)=>{requests.push({method,route,body:structuredClone(body)});if(route==='/health')return {instanceId:config.instanceId,pid:12345};if(route==='/connections')return manager.list();if(route==='/connections/open')return manager.open(body);if(route==='/sessions')return {sessions:[...sessions.values()].map(s=>s.state())};if(route.startsWith('/connections/profile/')){const operation=route.split('/').at(-1);if(operation==='abort'&&dropAbort==='before')throw Error('lost_abort_request');const result=manager[{prepare:'prepareProfileUpdate',commit:'commitProfileUpdate',abort:'abortProfileUpdate'}[operation]](body);if(operation==='prepare'&&dropPrepareAck||operation==='abort'&&dropAbort==='after')throw Error('lost_transaction_receipt');return result;}const connection=/^\/connections\/([^/]+)\/(.+)$/.exec(route);if(connection){if(connection[2].startsWith('login/status/'))return manager.loginStatus({connectionId:connection[1],requestId:connection[2].slice(13)});if(connection[2]==='login/complete'){const result=await manager.completeLogin({connectionId:connection[1],...body});if(dropLoginAck)throw Object.assign(Error('terminal_login_unknown'),{terminalRejected:true});return result;}const name={state:'state',confirm:'confirm','login/complete':'completeLogin','auth/read':'authRead','auth/input':'authInput','auth/resize':'authResize','shell/open':'openShell',close:'close'}[connection[2]];return manager[name]({connectionId:connection[1],...body});}const session=/^\/sessions\/([^/]+)\/(.+)$/.exec(route);assert(session,route);const s=sessions.get(session[1]);assert(s);if(session[2]==='state'){const value=s.state();if(stateHook)await stateHook();return value;}if(session[2]==='service/state')return s.serviceState();const result=s[session[2]](body);if(session[2]==='owner'&&ownerHook)await ownerHook();if(session[2]==='close')sessions.delete(session[1]);return result;};
 const requestApi=async(...args)=>{try{return await rawRequestApi(...args);}catch(error){if(error.code){const e=Error(error.code==='service_active'?'terminal_service_active':error.code);e.terminalRejected=true;throw e;}throw error;}};
 const spawn=()=>{const child=new EventEmitter();child.pid=12345;child.stdout=new PassThrough();child.unref=()=>{};child.stdin=new Writable({write(bytes,_e,done){config=JSON.parse(bytes);queueMicrotask(()=>child.stdout.write(JSON.stringify({origin:'http://127.0.0.1:33222',instanceId:config.instanceId,pid:12345})+'\n'));done();}});return child;};
 const worker={connection:null,connectionEpoch:0},bridge=createSharedTerminal({profiles,catalog,worker,root,dependencyRoot:path.join(root,'deps'),runtimeRoot:path.join(root,'runtime'),servicePath:path.join(root,'broker.mjs'),nodeExecutable:process.execPath,prepareRuntime:mockTerminalRuntime,spawn,requestApi,encryption:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()},current:()=>context,getSelectedResource:()=>resource,selectionRevision:()=>resourceRevision,desktopSessionId:'owned-desktop'});
 t.after(async()=>{await manager.closeAll();fs.rmSync(root,{recursive:true,force:true});});
 const open=async requestId=>{const v=await bridge.connections.open({profileId:profile.id,profileVersion:1,requestId:requestId||randomUUID()});await new Promise(r=>setImmediate(r));return v;};
 async function ready(){const v=await open();return bridge.connections.confirm({connectionId:v.connectionId});}
 function select(c){resource={schemaVersion:2,kind:'ssh-connection',connectionId:c.connectionId,profileId:profile.id,profileVersion:c.profileVersion};resourceRevision++;}
 return {bridge,profiles,profile,draft,manager,processes,sessions,requests,worker,open,ready,select,scope:()=>({...context,checkCurrent:()=>true}),context:()=>context,change:v=>{context={...context,...v};},gate:v=>confirmGate=v,onState:v=>stateHook=v,onOwner:v=>ownerHook=v};
}

test('main human ports hide master authentication from shell inventory, safe state and MCP and return exact schema2 shell metadata',async t=>{
 const f=fixture(t),pending=await f.open(),ref={connectionId:pending.connectionId};assert.equal((await f.bridge.list({})).sessions.length,0);assert((await f.bridge.connections.authRead(ref)).output.includes('PRIVATE_AUTH_PROMPT'));assert(!(JSON.stringify(await f.bridge.connections.list({}))).includes('PRIVATE_AUTH_PROMPT'));await assert.rejects(f.bridge.callTool('compute.sshConnection.authRead',ref,f.scope()),/unknown_operation/);const c=await f.bridge.connections.confirm(ref);assert.equal((await f.bridge.connections.authRead(ref)).output,'');f.select(c);const shell=await f.bridge.connections.openShell({...ref,requestId:'shell'});assert.equal(shell.connectionId,c.connectionId);assert.deepEqual(shell.resource,{kind:'ssh-connection',connectionId:c.connectionId,profileId:f.profile.id,profileVersion:1});assert.equal((await f.bridge.resourceState({sessionId:shell.id})).authentication,'verified');await f.bridge.owner({sessionId:shell.id,ownerEpoch:1,owner:'agent'});assert.equal(f.bridge.hasCurrentGrant('codex',shell.id),true);f.worker.connection={changed:true};f.worker.connectionEpoch++;assert.equal((await f.bridge.callTool('list_shared_terminals',{},f.scope())).sessions[0].id,shell.id);await f.bridge.close({sessionId:shell.id});assert.equal((await f.bridge.connections.state(ref)).authentication,'verified');assert.equal((await f.bridge.connections.list({})).connections.length,1);
});
test('viewport resize after Agent handoff keeps its owner and grant and cannot write terminal input',async t=>{
 const f=fixture(t),c=await f.open('resize-login'),result=await f.bridge.connections.completeLogin({connectionId:c.connectionId,requestId:'resize-login'}),shell=result.shell;f.select(c);
 await f.bridge.owner({sessionId:shell.sessionId,ownerEpoch:shell.ownerEpoch,owner:'agent'});
 assert.equal((await f.bridge.resize({sessionId:shell.sessionId,cols:120,rows:36})).accepted,true);
 assert.equal(f.bridge.hasCurrentGrant('codex',shell.sessionId),true);
 const state=(await f.bridge.list({})).sessions.find(s=>s.sessionId===shell.sessionId);assert.equal(state.owner,'agent');
 await assert.rejects(f.bridge.input({sessionId:shell.sessionId,ownerEpoch:state.ownerEpoch,requestId:'blocked-human',data:'must-not-run\r'}),/human_owned/);
 assert.equal(f.processes.length,2);
});

test('human login completion records one exact shell and does not grant it to any Agent',async t=>{
 const f=fixture(t),requestId='one-human-login',c=await f.open(requestId),ref={connectionId:c.connectionId,requestId};
 const completed=await f.bridge.connections.completeLogin(ref);
 assert.equal(completed.connection.authentication,'verified');assert.equal(completed.shell.connectionId,c.connectionId);assert.equal(completed.shell.owner,'human');
 const repeated=await f.bridge.connections.completeLogin(ref);assert.equal(repeated.shell.sessionId,completed.shell.sessionId);assert.equal(f.processes.length,2);
 assert.equal((await f.bridge.list({})).sessions.length,1);assert.equal(f.bridge.hasCurrentGrant('codex',completed.shell.sessionId),false);
 await assert.rejects(f.bridge.connections.completeLogin({...ref,requestId:'foreign-login'}),/terminal_unavailable/);assert.equal(f.processes.length,2);assert.equal((await f.bridge.connections.state({connectionId:c.connectionId})).authentication,'verified');
 await assert.rejects(f.bridge.callTool('compute.sshConnection.completeLogin',ref,f.scope()),/unknown_operation/);
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
 assert.equal(recovered.login.status,'complete');assert.equal(recovered.connection.authentication,'verified');assert.equal(recovered.shell.connectionId,c.connectionId);assert.equal(recovered.shell.owner,'human');
 assert.equal(f.requests.filter(value=>value.method==='POST'&&value.route.endsWith('/login/complete')).length,before);assert.equal(f.processes.length,2);
 assert.equal(f.bridge.hasCurrentGrant('codex',recovered.shell.sessionId),false);assert.equal((await f.bridge.list({})).sessions.length,1);
 await assert.rejects(f.bridge.connections.loginStatus({...ref,requestId:'wrong-attempt'}),/terminal_invalid_request|terminal_unavailable/);assert.equal(f.processes.length,2);
 await assert.rejects(f.bridge.callTool('compute.sshConnection.loginStatus',ref,f.scope()),/unknown_operation/);
});
test('observing a pending login creates no shell and a closed login shell is never reopened by observation',async t=>{
 const f=fixture(t),requestId='observe-only',c=await f.open(requestId),ref={connectionId:c.connectionId,requestId};
 const pending=await f.bridge.connections.loginStatus(ref);assert.equal(pending.login.status,'waiting_authentication');assert.equal(pending.shell,undefined);assert.equal(f.processes.length,1);
 const completed=await f.bridge.connections.completeLogin(ref);await f.bridge.close({sessionId:completed.shell.sessionId});
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
