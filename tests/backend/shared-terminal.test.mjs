import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {createSharedTerminal,buildTerminalLaunch,terminalChildEnvironment,sharedTerminalTools} from "../../backend/main/compute/shared-terminal.mjs";

const profile={id:'fixture-cluster',version:3,host:'example.invalid',username:'fixture-user',port:22,ssh_client:'/usr/bin/ssh',identity_file:'',proxy_jump:[],via:[]};
function harness(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'studio-shared-terminal-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const key=randomBytes(32),encryption={isEncryptionAvailable:()=>true,encryptString(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([c.update(value,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]);},decryptString(bytes){const d=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));d.setAuthTag(bytes.subarray(12,28));return Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString('utf8');}};
 const store=new Map(),catalog={list(kind){return [...store].filter(([k])=>k.startsWith(kind+':')).map(([,v])=>structuredClone(v));},put(kind,id,value){store.set(kind+':'+id,{...structuredClone(value),id});},remove(kind,id){store.delete(kind+':'+id);}};
 let selected={provider:'codex',threadId:'fixture-thread',taskId:'fixture-task'},up=true,counter=0,configured;
 const sessions=new Map(),requests=[],spawns=[],worker={connection:{health:{root:'/fixture/worker'}},connectionEpoch:1,identity:{distribution:'Fixture Linux',root:'/fixture/worker'},connectionTarget:{distribution:'Fixture Linux',root:'/fixture/worker',port:19000},connectedSource:'fixture-source',request:async()=>structuredClone(profile)};
 const state=s=>({...s,host:'never-render.invalid',controlToken:'never-render-token',argv:['never-render-argv'],pid:123});
 const requestApi=async(d,method,route,body)=>{
  requests.push({method,route,body:structuredClone(body)});if(!up)throw Error('PRIVATE endpoint and key detail must not leak');
  if(route==='/health')return {instanceId:configured.instanceId,pid:4242};
  if(route==='/sessions'&&method==='GET')return {sessions:[...sessions.values()].map(state)};
  if(route==='/sessions/open'){const s={id:'session-'+(++counter),kind:body.kind,mode:body.mode,name:body.name,alive:true,owner:'human',ownerEpoch:0,sequence:1,chunks:[{sequence:1,data:'TEST secret authentication output'}],floor:0};sessions.set(s.id,s);return state(s);}
  const m=route.match(/^\/sessions\/([^/]+)\/(state|read|input|owner|resize|close)$/);assert(m);const s=sessions.get(m[1]);if(!s)throw Error('missing private session');
  if(m[2]==='state')return state(s);
  if(m[2]==='close'){sessions.delete(s.id);return {closed:true};}
  if(m[2]==='resize')return {accepted:true};
  assert.equal(body.ownerEpoch,s.ownerEpoch);
  if(m[2]==='owner'){s.owner=body.owner;s.ownerEpoch++;s.scope=body.scope;s.floor=s.sequence;return state(s);}
  if(body.actor==='agent'){assert.equal(s.owner,'agent');assert.deepEqual(body.scope,s.scope);}
  if(m[2]==='read'){const floor=body.actor==='agent'?s.floor:0;return {state:state(s),chunks:s.chunks.filter(x=>x.sequence>Math.max(body.cursor||0,floor)),cursor:s.sequence,dropped:false};}
  if(m[2]==='input'){s.writes??=[];if(!s.writes.some(x=>x.requestId===body.requestId))s.writes.push(body);return {accepted:true};}
 };
 function spawn(file,args,options){const child=new EventEmitter();child.pid=4242;child.stdout=new PassThrough();child.unref=()=>{child.detached=true;};child.stdin=new Writable({write(chunk,_encoding,callback){configured=JSON.parse(chunk.toString());queueMicrotask(()=>child.stdout.write(JSON.stringify({origin:'http://127.0.0.1:32123',instanceId:configured.instanceId,pid:4242})+'\n'));callback();}});spawns.push({file,args,options,child});return child;}
 const options={worker,encryption,root:path.join(base,'credentials'),catalog,current:()=>selected,settings:()=>({cwd:base}),runtimeRoot:path.join(base,'runtime'),dependencyRoot:path.join(base,'read-only-dependencies'),servicePath:path.join(base,'broker.mjs'),nodeExecutable:process.execPath,spawn,requestApi,env:{...process.env,MP_API_KEY:'TEST_ONLY_NOT_A_REAL_KEY',NODE_OPTIONS:'TEST_ONLY_REFUSED',HTTPS_PROXY:'http://example.invalid'}};
 const bridge=createSharedTerminal(options),scope=()=>({...selected,checkCurrent:()=>true});
 return {base,bridge,options,sessions,requests,spawns,worker,catalog,scope,get configured(){return configured;},select:v=>{selected=v;},disconnect:()=>{up=false;},reconnect:()=>{up=true;}};
}

test('SSH plans use explicit identity, strict modes, no default user or shell wrapper',()=>{
 const cwd=process.cwd(),interactive=buildTerminalLaunch(profile,'interactive',{platform:'linux',cwd}),key=buildTerminalLaunch(profile,'key',{platform:'linux',cwd});
 assert.equal(interactive.file,'/usr/bin/ssh');assert.equal(interactive.args[0],'-tt');assert(interactive.args.includes('StrictHostKeyChecking=ask'));assert(interactive.args.includes('BatchMode=no'));assert(key.args.includes('StrictHostKeyChecking=yes'));assert(key.args.includes('BatchMode=yes'));assert(!key.args.includes('-i'));assert.equal(key.args.at(-1),'example.invalid');assert.equal(key.args[key.args.indexOf('-l')+1],'fixture-user');
 assert.throws(()=>buildTerminalLaunch({...profile,username:''},'key',{cwd}),/saved_connection_changed/);assert.throws(()=>buildTerminalLaunch({...profile,import_review:{requires_review:true}},'interactive',{cwd}),/route_review_required/);
});
test('SSH client/key namespace and existing route are explicit',()=>{
 const cwd=process.cwd(),linux=buildTerminalLaunch({...profile,identity_file:'/fixture/key',proxy_jump:['jump-user@jump.invalid:22']},'interactive',{platform:'win32',distribution:'Fixture Linux',cwd});assert.match(linux.file,/wsl\.exe$/);assert.deepEqual(linux.args.slice(0,4),['--distribution','Fixture Linux','--exec','/usr/bin/ssh']);assert(linux.args.includes('/fixture/key'));assert(linux.args.includes('jump-user@jump.invalid:22'));
 const win=buildTerminalLaunch({...profile,ssh_client:'/mnt/c/Windows/System32/OpenSSH/ssh.exe',identity_file:'C:\\fixture\\key'},'key',{platform:'win32',cwd});assert.equal(win.file,'C:\\Windows\\System32\\OpenSSH\\ssh.exe');assert(win.args.includes('C:\\fixture\\key'));
 assert.throws(()=>buildTerminalLaunch({...profile,ssh_client:'/mnt/c/Windows/System32/OpenSSH/ssh.exe',identity_file:'/home/fixture/key'},'key',{platform:'win32',cwd}),/namespace/);
 const via=buildTerminalLaunch({...profile,via:['hop.invalid']},'key',{platform:'linux',cwd});assert.match(via.args.at(-1),/^ssh -tt /);assert.throws(()=>buildTerminalLaunch({...profile,via:['bad; command']},'key',{cwd}),/route_review_required/);
});
test('daemon environment excludes secrets and injection flags',()=>{const e=terminalChildEnvironment({PATH:'fixture',SystemRoot:'C:\\Windows',SSH_AUTH_SOCK:'/fixture/agent',MP_API_KEY:'secret',NODE_OPTIONS:'--import=x',ELECTRON_RUN_AS_NODE:'0',HTTPS_PROXY:'secret'});assert.deepEqual(e,{PATH:'fixture',SystemRoot:'C:\\Windows',SSH_AUTH_SOCK:'/fixture/agent',ELECTRON_RUN_AS_NODE:'1'});});
test('human open launches detached once, encrypts descriptor, reuses route and returns safe opaque state',async t=>{
 const h=harness(t),[a,b]=await Promise.all([h.bridge.open({kind:'local',mode:'interactive'}),h.bridge.open({kind:'local',mode:'interactive'})]);assert.equal(a.sessionId,b.sessionId);assert.equal(h.spawns.length,1);assert.equal(h.requests.filter(x=>x.route==='/sessions/open').length,1);assert.equal(h.spawns[0].options.detached,true);assert.equal(h.spawns[0].options.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(h.spawns[0].options.env.MP_API_KEY,undefined);assert.equal(h.spawns[0].options.env.NODE_OPTIONS,undefined);assert.equal(h.spawns[0].child.detached,true);
 assert.deepEqual(Object.keys(h.configured).sort(),['controlToken','dependencyRoot','instanceId','runtimeRoot']);assert.equal(h.configured.dependencyRoot,h.options.dependencyRoot);assert(h.configured.runtimeRoot.startsWith(h.options.runtimeRoot+path.sep));assert.equal(fs.existsSync(h.options.dependencyRoot),false);assert(!fs.readFileSync(path.join(h.options.root,'broker.bin')).includes(Buffer.from(h.configured.controlToken)));assert.equal(JSON.stringify(a).includes('never-render'),false);assert(!Object.hasOwn(a,'pid'));assert.equal(h.bridge.detach(),undefined);
 assert.equal((await h.bridge.open({kind:'local',mode:'interactive'})).sessionId,a.sessionId);assert.equal(h.requests.filter(x=>x.route.endsWith('/close')).length,0);await h.bridge.close({sessionId:a.sessionId});const c=await h.bridge.open({kind:'local',mode:'interactive'});assert.notEqual(c.sessionId,a.sessionId);assert.equal(h.spawns.length,1);
});
test('Windows local plan uses system PowerShell modules without outer SSH shell',async t=>{const h=harness(t),b=createSharedTerminal({...h.options,platform:'win32',env:{SystemRoot:'C:\\Windows',PATH:'fixture'}});await b.open({kind:'local',mode:'interactive'});const launch=h.requests.find(x=>x.route==='/sessions/open').body.launch;assert.match(launch.file,/powershell\.exe$/);assert.deepEqual(launch.args,['-NoLogo','-NoProfile','-NoExit']);assert.equal(launch.env.PSModulePath,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');assert(!Object.hasOwn(launch.env,'ELECTRON_RUN_AS_NODE'));});
test('existing descriptor reuses daemon and PTY, resets stale Agent ownership without SSH restart',async t=>{
 const h=harness(t),s=await h.bridge.open({kind:'local',mode:'interactive'});await h.bridge.owner({sessionId:s.id,ownerEpoch:0,owner:'agent'});const second=createSharedTerminal(h.options),list=await second.list({});assert.equal(list.sessions[0].sessionId,s.id);assert.equal(list.sessions[0].owner,'human');assert.equal(h.spawns.length,1);assert.equal(h.requests.filter(x=>x.route==='/sessions/open').length,1);await assert.rejects(second.callTool('read_shared_terminal',{session_id:s.id},h.scope()),/scope_denied/);
 assert.equal((await second.open({kind:'local',mode:'interactive'})).sessionId,s.id);
});
test('exited and expired Agent-owned sessions do not prevent restoring other live PTYs',async t=>{
 const h=harness(t),dead=await h.bridge.open({kind:'local',mode:'interactive'});await h.bridge.owner({sessionId:dead.id,ownerEpoch:0,owner:'agent'});const actual=h.sessions.get(dead.id);actual.alive=false;actual.exitCode=7;const expired=await h.bridge.open({kind:'local',mode:'interactive'});await h.bridge.owner({sessionId:expired.id,ownerEpoch:0,owner:'agent'});h.sessions.get(expired.id).expired=true;const live=await h.bridge.open({kind:'local',mode:'key'}),original=h.options.requestApi;
 const b=createSharedTerminal({...h.options,requestApi:async(...args)=>{if([`/sessions/${dead.id}/owner`,`/sessions/${expired.id}/owner`].includes(args[2]))throw Error('Core correctly rejects ownership changes after exit/expiry');return original(...args);}}),items=(await b.list({})).sessions;assert.equal(items.find(x=>x.id===dead.id).status,'exited');assert.equal(items.find(x=>x.id===dead.id).exitCode,7);assert.equal(items.find(x=>x.id===expired.id).status,'expired');assert.equal(items.find(x=>x.id===expired.id).alive,true);assert.equal(items.find(x=>x.id===live.id).status,'running');assert.equal((await b.open({kind:'local',mode:'key'})).id,live.id);assert.equal(h.spawns.length,1);for(const id of [dead.id,expired.id])await assert.rejects(b.callTool('read_shared_terminal',{session_id:id},h.scope()),/scope_denied/);assert.match((await b.read({sessionId:dead.id,ownerEpoch:1})).output,/authentication/);
});
test('unavailable daemon leaves old index unknown and never restarts same SSH/local route',async t=>{
 const h=harness(t),s=await h.bridge.open({kind:'local',mode:'interactive'});h.disconnect();const second=createSharedTerminal(h.options),list=await second.list({});assert.equal(list.sessions[0].sessionId,s.id);assert.equal(list.sessions[0].status,'unknown');await assert.rejects(second.open({kind:'local',mode:'interactive'}),/terminal_unavailable/);assert.equal(h.spawns.length,1);assert.equal(h.requests.filter(x=>x.route.endsWith('/close')).length,0);
});
test('MCP cannot create, grant owner or read authentication; only explicit current handoff',async t=>{
 const h=harness(t),s=await h.bridge.open({kind:'local',mode:'interactive'});assert.deepEqual(sharedTerminalTools.map(x=>x.name),['list_shared_terminals','read_shared_terminal','write_shared_terminal']);assert.deepEqual((await h.bridge.callTool('list_shared_terminals',{},h.scope())).sessions,[]);await assert.rejects(h.bridge.callTool('read_shared_terminal',{session_id:s.id},h.scope()),/scope_denied/);await assert.rejects(h.bridge.callTool('sharedTerminal.open',{},h.scope()),/unknown_operation/);
 const owned=await h.bridge.owner({sessionId:s.id,ownerEpoch:0,owner:'agent'});const actual=h.sessions.get(s.id);actual.chunks.push({sequence:++actual.sequence,data:'public post-handoff output'});const r=await h.bridge.callTool('read_shared_terminal',{session_id:s.id},h.scope());assert.equal(r.output,'public post-handoff output');assert.equal(r.output.includes('authentication'),false);assert(!Object.hasOwn(r,'pid'));assert.equal(owned.ownerEpoch,1);const human=await h.bridge.read({sessionId:s.id,ownerEpoch:1});assert.match(human.output,/authentication/);
 await h.bridge.callTool('write_shared_terminal',{session_id:s.id,request_id:'request-1',data:'echo test\r'},h.scope());assert.equal(actual.writes[0].actor,'agent');assert.deepEqual(actual.writes[0].scope,{provider:'codex',threadId:'fixture-thread',taskId:'fixture-task'});assert.equal(actual.writes[0].ownerEpoch,1);
});
test('wrong provider/thread, expired lease, unknown keys and injected actor are refused',async t=>{
 const h=harness(t),s=await h.bridge.open({kind:'local',mode:'interactive'});await h.bridge.owner({sessionId:s.id,ownerEpoch:0,owner:'agent'});
 for(const scope of [{...h.scope(),provider:'deepseek'},{...h.scope(),threadId:'other'},{...h.scope(),checkCurrent:()=>false}])await assert.rejects(h.bridge.callTool('read_shared_terminal',{session_id:s.id},scope),/scope_denied/);
 await assert.rejects(h.bridge.callTool('write_shared_terminal',{session_id:s.id,request_id:'request-1',data:'x',actor:'human'},h.scope()),/invalid_request/);await assert.rejects(h.bridge.owner({sessionId:s.id,ownerEpoch:1,owner:'agent',scope:{provider:'other'}}),/invalid_request/);await assert.rejects(h.bridge.open({kind:'local',mode:'interactive',launch:{file:'bad'}}),/invalid_request/);
});
test('human takeover revokes access immediately and new handoff uses new epoch/floor',async t=>{
 const h=harness(t),s=await h.bridge.open({kind:'local',mode:'interactive'});await h.bridge.owner({sessionId:s.id,ownerEpoch:0,owner:'agent'});await h.bridge.owner({sessionId:s.id,ownerEpoch:1,owner:'human'});await assert.rejects(h.bridge.callTool('write_shared_terminal',{session_id:s.id,request_id:'request-1',data:'x'},h.scope()),/scope_denied/);const again=await h.bridge.owner({sessionId:s.id,ownerEpoch:2,owner:'agent'});assert.equal(again.ownerEpoch,3);assert.equal((await h.bridge.callTool('read_shared_terminal',{session_id:s.id},h.scope())).output,'');
});
test('takeover revokes the local grant before awaiting daemon state',async t=>{
 const h=harness(t),s=await h.bridge.open({kind:'local',mode:'interactive'}),original=h.options.requestApi;let pause=false,release;
 const b=createSharedTerminal({...h.options,requestApi:async(...args)=>{const value=await original(...args);if(pause&&args[2].endsWith('/state'))await new Promise(r=>{release=r;});return value;}});await b.list({});await b.owner({sessionId:s.id,ownerEpoch:0,owner:'agent'});pause=true;const takeover=b.owner({sessionId:s.id,ownerEpoch:1,owner:'human'});while(!release)await new Promise(r=>setImmediate(r));await assert.rejects(b.callTool('write_shared_terminal',{session_id:s.id,request_id:'pending-human',data:'x'},h.scope()),/scope_denied/);release();await takeover;
});
test('a late agent read is suppressed after human takes ownership',async t=>{
 const h=harness(t),s=await h.bridge.open({kind:'local',mode:'interactive'});await h.bridge.owner({sessionId:s.id,ownerEpoch:0,owner:'agent'});const original=h.options.requestApi;let release;
 const b=createSharedTerminal({...h.options,requestApi:async(...args)=>{const value=await original(...args);if(args[2].endsWith('/read'))await new Promise(r=>{release=r;});return value;}});await b.list({});await b.owner({sessionId:s.id,ownerEpoch:2,owner:'agent'});const reading=b.callTool('read_shared_terminal',{session_id:s.id},h.scope());while(!release)await new Promise(r=>setImmediate(r));await b.owner({sessionId:s.id,ownerEpoch:3,owner:'human'});release();await assert.rejects(reading,/scope_denied/);
});
test('a late Agent read is suppressed after selecting another conversation',async t=>{
 const h=harness(t),s=await h.bridge.open({kind:'local',mode:'interactive'}),original=h.options.requestApi;let release;
 const b=createSharedTerminal({...h.options,requestApi:async(...args)=>{const value=await original(...args);if(args[2].endsWith('/read'))await new Promise(r=>{release=r;});return value;}});await b.list({});await b.owner({sessionId:s.id,ownerEpoch:0,owner:'agent'});const reading=b.callTool('read_shared_terminal',{session_id:s.id},h.scope());while(!release)await new Promise(r=>setImmediate(r));h.select({provider:'codex',threadId:'other-thread',taskId:'other-task'});release();await assert.rejects(reading,/context_changed/);
});
test('Agent listing filters handoffs belonging to another conversation',async t=>{
 const h=harness(t),a=await h.bridge.open({kind:'local',mode:'interactive'});await h.bridge.owner({sessionId:a.id,ownerEpoch:0,owner:'agent'});h.select({provider:'codex',threadId:'other-thread',taskId:'other-task'});assert.deepEqual((await h.bridge.callTool('list_shared_terminals',{},h.scope())).sessions,[]);const b=await h.bridge.open({kind:'local',mode:'key'});await h.bridge.owner({sessionId:b.id,ownerEpoch:0,owner:'agent'});assert.deepEqual((await h.bridge.callTool('list_shared_terminals',{},h.scope())).sessions.map(x=>x.id),[b.id]);
});
test('SSH saved profile/version/current worker are authoritative and do not expose the launch',async t=>{
 const h=harness(t),b=createSharedTerminal({...h.options,platform:'win32'});const s=await b.open({kind:'ssh',mode:'interactive',clusterId:'fixture-cluster',version:3});const launch=h.requests.find(x=>x.route==='/sessions/open').body.launch;assert.match(launch.file,/wsl\.exe$/);assert.equal(JSON.stringify(s).includes('example.invalid'),false);assert.equal(JSON.stringify(s).includes('fixture-user'),false);await assert.rejects(b.open({kind:'ssh',mode:'key',clusterId:'fixture-cluster',version:2}),/saved_connection_changed/);
 await b.owner({sessionId:s.id,ownerEpoch:0,owner:'agent'});h.worker.identity={...h.worker.identity,root:'/fixture/other-worker'};await assert.rejects(b.callTool('read_shared_terminal',{session_id:s.id},h.scope()),/context_changed/);
});
test('profile response arriving after source change cannot launch any PTY',async t=>{
 const h=harness(t);h.worker.request=async()=>{h.worker.connectionEpoch++;return profile;};await assert.rejects(h.bridge.open({kind:'ssh',mode:'interactive',clusterId:'fixture-cluster',version:3}),/context_changed/);assert.equal(h.spawns.length,0);assert.equal(h.requests.length,0);
});
test('profile changed while daemon startup was pending is rejected before creating an SSH PTY',async t=>{
 const h=harness(t);let version=3,release,reads=0,spawned=0;h.worker.request=async()=>{reads++;return {...profile,version};};
 const b=createSharedTerminal({...h.options,spawn:()=>{spawned++;const child=new EventEmitter();child.pid=4242;child.stdout=new PassThrough();child.unref=()=>{};child.stdin=new Writable({write(chunk,_encoding,callback){const c=JSON.parse(chunk.toString());release=()=>child.stdout.write(JSON.stringify({origin:'http://127.0.0.1:32123',instanceId:c.instanceId,pid:4242})+'\n');callback();}});return child;}}),opening=b.open({kind:'ssh',mode:'interactive',clusterId:'fixture-cluster',version:3});while(!release)await new Promise(r=>setImmediate(r));version=4;release();await assert.rejects(opening,/saved_connection_changed/);assert.equal(spawned,1);assert.equal(reads,2);assert.equal(h.requests.filter(x=>x.route==='/sessions/open').length,0);assert.equal(h.sessions.size,0);
});
test('unconfirmed open is not automatically replayed; fixed errors suppress private daemon text',async t=>{
 const h=harness(t),original=h.options.requestApi,b=createSharedTerminal({...h.options,requestApi:async(...args)=>{if(args[2]==='/sessions/open'){await original(...args);throw Error('PRIVATE host/account/argv');}return original(...args);}});await assert.rejects(b.open({kind:'local',mode:'interactive'}),/^Error: terminal_unavailable$/);await assert.rejects(b.open({kind:'local',mode:'interactive'}),/^Error: terminal_unavailable$/);assert.equal(h.requests.filter(x=>x.route==='/sessions/open').length,1);
});
test('encryption unavailable or linked runtime refuses before daemon spawn',async t=>{
 const h=harness(t),b=createSharedTerminal({...h.options,encryption:{isEncryptionAvailable:()=>false}});await assert.rejects(b.open({kind:'local',mode:'interactive'}),/encryption_unavailable/);assert.equal(h.spawns.length,0);
 const target=path.join(h.base,'owned-target'),link=path.join(h.base,'owned-link');fs.mkdirSync(target);fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');const c=createSharedTerminal({...h.options,runtimeRoot:path.join(link,'not-created')});await assert.rejects(c.open({kind:'local',mode:'interactive'}),/terminal_unavailable/);assert.equal(fs.existsSync(path.join(target,'not-created')),false);
});


test('ProgramData reaches daemon and PTY launch environment while secrets and injection variables remain excluded',async t=>{
 const env={SystemRoot:'C:\\Windows',ProgramData:'C:\\fixture\\ProgramData',PATH:'fixture',MP_API_KEY:'TEST_ONLY_SECRET',API_TOKEN:'TEST_ONLY_TOKEN',NODE_OPTIONS:'--import=forbidden',ELECTRON_RUN_AS_NODE:'0'};
 const child=terminalChildEnvironment(env);assert.equal(child.ProgramData,env.ProgramData);assert.equal(child.MP_API_KEY,undefined);assert.equal(child.API_TOKEN,undefined);assert.equal(child.NODE_OPTIONS,undefined);assert.equal(child.ELECTRON_RUN_AS_NODE,'1');
 const h=harness(t),b=createSharedTerminal({...h.options,platform:'win32',env});await b.open({kind:'local',mode:'interactive'});assert.equal(h.spawns[0].options.env.ProgramData,env.ProgramData);const launch=h.requests.find(r=>r.route==='/sessions/open').body.launch;assert.equal(launch.env.ProgramData,env.ProgramData);assert.equal(launch.env.MP_API_KEY,undefined);assert.equal(launch.env.API_TOKEN,undefined);assert.equal(launch.env.NODE_OPTIONS,undefined);assert.equal(launch.env.ELECTRON_RUN_AS_NODE,undefined);
});
