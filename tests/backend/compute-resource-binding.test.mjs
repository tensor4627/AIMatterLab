import {mockTerminalRuntime} from '../helpers/terminal-runtime-fixture.mjs';
// Actual broker HTTP + provider MCP + controlled stdio child. Never invokes SSH.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {createComputeProfiles} from '../../backend/main/compute/compute-profiles.mjs';
import {createComputeResourceBinding} from '../../backend/main/compute/resource-binding.mjs';
import {createSharedTerminal} from '../../backend/main/compute/shared-terminal.mjs';
import {startBroker} from '../../desktop/platform/terminal-service/broker.mjs';
import {TerminalMcp} from '../../agent/tools/terminal-mcp.mjs';

const repository=fileURLToPath(new URL('../..',import.meta.url)),base=process.env.STUDIO_COMPUTE_FIXTURE_ROOT?path.resolve(process.env.STUDIO_COMPUTE_FIXTURE_ROOT):path.join(os.tmpdir(),'studio-compute-resource-binding-fixtures');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t,{now=Date.now}={}){
 fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'binding-'));
 fs.writeFileSync(path.join(root,'fixture.json'),JSON.stringify({kind:'controlled-stdio-resource-binding',scope:'Real broker/MCP HTTP and child PID; inert node echo protocol substitutes SSH. No authentication, scientific worker, queue or engine.'}));
 const catalog=new Catalog(path.join(root,'catalog')),profiles=createComputeProfiles({catalog}),worker={connection:null},children=[],brokers=[],calls=[];
 let selected={provider:'codex',threadId:'thread-a',taskId:null},contextRevision=0,binding,gate=null;
 const profile=profiles.save({expectedVersion:0,kind:'ssh',name:'Controlled resource',host:'example.invalid',username:'synthetic',port:22,ssh_client:path.join(root,'not-executed-ssh'),mode:'interactive'});
 const key=randomBytes(32),encryption={isEncryptionAvailable:()=>true,encryptString(text){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]);},decryptString(data){const d=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));d.setAuthTag(data.subarray(12,28));return Buffer.concat([d.update(data.subarray(28)),d.final()]).toString('utf8');}};
 const pty={spawn(file,args){
  assert.equal(path.basename(file),'not-executed-ssh');assert(args.includes('example.invalid'));
  const program="const r=require('node:readline').createInterface({input:process.stdin});process.stdout.write('PRIVATE_SYNTHETIC_PROMPT\\n');r.on('line',s=>{try{const v=JSON.parse(s);if(v.op==='echo'&&typeof v.value==='string')process.stdout.write('RESULT '+v.value+'\\n');else if(v.op==='exit')process.exit(0);}catch{process.stdout.write('INVALID FIXTURE INPUT\\n');}});";
  const child=spawn(process.execPath,['-e',program],{stdio:['pipe','pipe','pipe'],windowsHide:true});children.push(child);
  return {pid:child.pid,onData:fn=>{child.stdout.on('data',data=>fn(data.toString()));return{dispose(){}};},onExit:fn=>{child.once('exit',code=>fn({exitCode:code}));return{dispose(){}};},write:data=>child.stdin.write(data),resize(){},kill:()=>child.kill()};
 }};
 const brokerSpawn=()=>{const child=new EventEmitter();child.pid=process.pid;child.stdout=new PassThrough();child.unref=()=>{};child.stdin=new Writable({write(chunk,_encoding,done){startBroker(JSON.parse(chunk.toString()),{pty,now}).then(broker=>{brokers.push(broker);child.stdout.write(JSON.stringify(broker.ready)+'\n');},error=>child.emit('error',error));done();}});return child;};
 const requestApi=async(descriptor,method,route,body)=>{calls.push({method,route});const response=await fetch(descriptor.origin+route,{method,headers:{Authorization:'Bearer '+descriptor.controlToken,...body!==undefined?{'Content-Type':'application/json'}:{}},...body!==undefined?{body:JSON.stringify(body)}:{}});if(response.status!==200)throw Error('fixture broker denied');const result=await response.json();if(gate&&route.endsWith('/state')){const wait=gate;gate=null;await wait;}return result;};
 const terminalOptions={desktopSessionId:'same-desktop-binding-fixture',prepareRuntime:mockTerminalRuntime,worker,profiles,catalog,encryption,root:path.join(root,'credentials'),runtimeRoot:path.join(root,'runtime'),dependencyRoot:root,servicePath:path.join(root,'in-process-broker-fixture.mjs'),nodeExecutable:process.execPath,spawn:brokerSpawn,requestApi,current:()=>selected,settings:()=>({cwd:root}),getSelectedResource:()=>binding?.peek(),selectionRevision:()=>binding?.revision()??0,sourceGuard:()=>{throw Error('No scientific worker exists');}};const terminal=createSharedTerminal(terminalOptions);
 binding=createComputeResourceBinding({catalog,profiles,terminal,current:()=>selected,revision:()=>contextRevision});
 const gateway=new TerminalMcp({terminal});await gateway.start();gateway.bindProviderContext('codex',{threadId:'thread-a',taskId:null});
 const session=await terminal.open({kind:'ssh',mode:'interactive',profileId:profile.id,version:profile.version});
 let owned=session;
 const humanRead=()=>terminal.read({sessionId:session.id,ownerEpoch:owned.ownerEpoch});
 const send=async(name,args={},connection=gateway.providerConnection('codex'))=>{const response=await fetch(connection.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+connection.tokens.mcp,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});const raw=await response.text(),value=raw?JSON.parse(raw):null;return{status:response.status,value,...value?.result?.content?.[0]?.text?{data:JSON.parse(value.result.content[0].text)}:{}};};
 const until=async(read,predicate)=>{for(let i=0;i<100;i++){const value=await read();if(predicate(value))return value;await delay(20);}throw Error('Controlled child output/state was not observed');};
 await until(humanRead,value=>value.output.includes('PRIVATE_SYNTHETIC_PROMPT'));
 t.after(async()=>{gateway.close();for(const broker of brokers)await broker.close();for(const child of children){if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>child.once('exit',resolve));}fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({scope:'Controlled stdio child; not SSH authentication or science',children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode})),owned_children_stopped:children.every(child=>child.exitCode!==null||child.signalCode!==null),worker_connected:worker.connection!==null},null,2)+'\n');catalog.db.close();});
 return {root,catalog,profiles,profile,worker,terminal,terminalOptions,binding,gateway,session,children,calls,send,until,humanRead,get ownerEpoch(){return owned.ownerEpoch;},handoff:async()=>{owned=await terminal.owner({sessionId:session.id,ownerEpoch:owned.ownerEpoch,owner:'agent'});return owned;},takeover:async()=>{owned=await terminal.owner({sessionId:session.id,ownerEpoch:owned.ownerEpoch,owner:'human'});return owned;},activate:()=>binding.activate({kind:'ssh-terminal',profileId:profile.id,profileVersion:profile.version,sessionId:session.id}),select:(threadId)=>{selected={provider:'codex',threadId,taskId:null};contextRevision++;gateway.bindProviderContext('codex',{threadId,taskId:null});},holdState:promise=>{gate=promise;},changeProfile:()=>profiles.save({...profile,expectedVersion:profile.version,id:profile.id,name:'Changed controlled resource',version:undefined})};
}

test('selected SSH resource binds the same live channel and human→Agent→human without a worker',async t=>{
 const f=await fixture(t),pid=f.children[0].pid;
 assert.deepEqual(f.session.resource,{kind:'ssh-terminal',profileId:f.profile.id,profileVersion:1});
 const active=await f.activate();assert.equal(active.kind,'ssh-terminal');assert.equal(active.alive,true);assert.equal(active.operator,'human');assert.equal(active.agentReady,false);assert.equal(active.authentication,'not_observed');assert.equal(active.managedRuns,false);assert.equal(f.worker.connection,null);assert.equal(f.children.length,1);
 assert.equal((await f.send('read_shared_terminal',{session_id:f.session.id})).value.result.isError,true);
 await f.terminal.input({sessionId:f.session.id,ownerEpoch:f.ownerEpoch,requestId:'human-before',data:JSON.stringify({op:'echo',value:'human-before'})+'\n'});await f.until(f.humanRead,value=>value.output.includes('RESULT human-before'));
 await f.handoff();assert.equal((await f.binding.status({})).agentReady,true);assert.equal(f.terminal.hasCurrentGrant('codex',f.session.id),true);assert.equal(f.terminal.hasCurrentGrant('codex','other-session'),false);
 assert.equal((await f.send('write_shared_terminal',{session_id:f.session.id,request_id:'agent-after',data:JSON.stringify({op:'echo',value:'agent-after'})+'\n'})).value.result.isError,false);
 const output=await f.until(()=>f.send('read_shared_terminal',{session_id:f.session.id}),value=>value.data?.output?.includes('RESULT agent-after'));assert.doesNotMatch(output.data.output,/PRIVATE_SYNTHETIC_PROMPT|human-before/);
 await assert.rejects(f.terminal.input({sessionId:f.session.id,ownerEpoch:f.ownerEpoch,requestId:'human-denied',data:'x'}),/human_owned/);
 await f.takeover();assert.equal((await f.binding.status({})).agentReady,false);assert.equal((await f.send('read_shared_terminal',{session_id:f.session.id})).value.result.isError,true);
 await f.terminal.input({sessionId:f.session.id,ownerEpoch:f.ownerEpoch,requestId:'human-after',data:JSON.stringify({op:'echo',value:'human-after'})+'\n'});await f.until(f.humanRead,value=>value.output.includes('RESULT human-after'));
 const ticket=f.binding.capture();assert.equal(f.binding.peek().sessionId,f.session.id);f.binding.clear({selectionId:active.selectionId});assert.throws(()=>f.binding.assertCurrent(ticket),/selection_changed/);assert.equal((await f.binding.status({})).kind,null);assert.equal(f.children[0].pid,pid);assert.equal(f.children[0].exitCode,null);assert.equal(f.children.length,1);
});

test('current conversation and saved profile changes revoke readiness without closing or reopening SSH',async t=>{
 const f=await fixture(t);await f.activate();await f.handoff();assert.equal((await f.binding.status({})).agentReady,true);
 const lease=f.gateway.providerConnection('codex');f.select('thread-b');assert.equal((await f.binding.status({})).agentReady,false);assert.equal((await f.send('read_shared_terminal',{session_id:f.session.id},lease)).status,403);
 f.select('thread-a');await f.takeover();await f.handoff();assert.equal((await f.binding.status({})).agentReady,true);
 const {version,...saved}=f.profile;f.profiles.save({...saved,expectedVersion:version,id:f.profile.id,name:'Changed controlled resource'});const state=await f.binding.status({});assert.equal(state.status,'stale');assert.equal(state.agentReady,false);assert.equal(state.reason,'profile_changed');assert.equal(f.children[0].exitCode,null);assert.equal(f.children.length,1);assert.equal(f.worker.connection,null);
});

test('resource selection revision prevents an older grant from reviving on clear/reselect',async t=>{
 const f=await fixture(t);const active=await f.activate();await f.handoff();assert.equal((await f.binding.status({})).agentReady,true);const ticket=f.binding.capture();
 f.binding.clear({selectionId:active.selectionId});await f.activate();assert.throws(()=>f.binding.assertCurrent(ticket),/selection_changed/);assert.equal((await f.binding.status({})).agentReady,false);assert.equal((await f.send('read_shared_terminal',{session_id:f.session.id})).value.result.isError,true);
 await f.takeover();await f.handoff();assert.equal((await f.binding.status({})).agentReady,true);assert.equal(f.children.length,1);
});

test('activation/status reject session mismatch, context ABA and caller-provided readiness',async t=>{
 const f=await fixture(t);await assert.rejects(f.binding.activate({kind:'ssh-terminal',profileId:f.profile.id,profileVersion:1,sessionId:f.session.id,agentReady:true}),/invalid_request/);
 let release;const pending=new Promise(resolve=>release=resolve);f.holdState(pending);const action=f.activate();await new Promise(resolve=>setImmediate(resolve));f.select('thread-b');f.select('thread-a');release();await assert.rejects(action,/context_changed/);assert.equal(f.binding.peek(),null);
 const other=createComputeResourceBinding({catalog:f.catalog,profiles:f.profiles,terminal:{resourceState:async()=>({...await f.terminal.resourceState({sessionId:f.session.id}),sessionId:'different'})}});await assert.rejects(other.activate({kind:'ssh-terminal',profileId:f.profile.id,profileVersion:1,sessionId:f.session.id}),/session_mismatch/);assert.equal(f.children.length,1);assert.equal(f.children[0].exitCode,null);
});

test('actual controlled child exit remains selected but never Agent-ready or authenticated',async t=>{
 const f=await fixture(t);await f.activate();await f.handoff();await f.send('write_shared_terminal',{session_id:f.session.id,request_id:'owned-exit',data:JSON.stringify({op:'exit'})+'\n'});const state=await f.until(()=>f.binding.status({}),value=>value.processStatus==='exited');assert.equal(state.status,'selected');assert.equal(state.alive,false);assert.equal(state.agentReady,false);assert.equal(state.authentication,'not_observed');assert.equal(f.worker.connection,null);assert.equal(f.children.length,1);
});

test('active resource permits only its exact session, preserving other logged-in channels',async t=>{
 const f=await fixture(t);await f.handoff();const {id,version,...content}=f.profile;
 const other=f.profiles.save({...content,name:'Second controlled resource',expectedVersion:0});
 const session=await f.terminal.open({kind:'ssh',mode:'interactive',profileId:other.id,version:other.version});await f.until(()=>f.terminal.read({sessionId:session.id,ownerEpoch:session.ownerEpoch}),value=>value.output.includes('PRIVATE_SYNTHETIC_PROMPT'));
 const active=await f.binding.activate({kind:'ssh-terminal',profileId:other.id,profileVersion:other.version,sessionId:session.id});assert.equal(active.agentReady,false);
 await f.terminal.owner({sessionId:session.id,ownerEpoch:session.ownerEpoch,owner:'agent'});
 assert.equal((await f.binding.status({})).agentReady,true);assert.equal((await f.terminal.resourceState({sessionId:f.session.id})).agentReady,false);
 assert.equal(f.terminal.hasCurrentGrant('codex',f.session.id),false);assert.equal(f.terminal.hasCurrentGrant('codex',session.id),true);
 assert.equal((await f.send('read_shared_terminal',{session_id:f.session.id})).value.result.isError,true);
 const list=await f.send('list_shared_terminals');assert.deepEqual(list.data.sessions.map(value=>value.sessionId),[session.id]);
 assert.equal(f.children.length,2);assert(f.children.every(child=>child.exitCode===null));assert.equal(f.calls.filter(call=>call.route.endsWith('/close')).length,0);
});

test('same-desktop reconstructed selected reference restores its channel without restoring an old Agent grant',async t=>{
 const f=await fixture(t);const active=await f.activate();await f.handoff();const pid=f.children[0].pid;
 const restoredTerminal=createSharedTerminal(f.terminalOptions),restored=createComputeResourceBinding({catalog:f.catalog,profiles:f.profiles,terminal:restoredTerminal});
 assert.equal(restored.peek().selectionId,active.selectionId);const before=f.calls.length,state=await restored.status({});
 assert.equal(state.sessionId,f.session.id);assert.equal(state.alive,true);assert.equal(state.operator,'human');assert.equal(state.agentReady,false);assert.equal(state.authentication,'not_observed');
 assert.equal(f.children.length,1);assert.equal(f.children[0].pid,pid);assert.equal(f.children[0].exitCode,null);assert(f.calls.slice(before).every(call=>!call.route.endsWith('/read')&&call.route!=='/sessions/open'&&!call.route.endsWith('/close')));
});

test('actual broker expiry revokes Agent readiness while retaining the existing live process',async t=>{
 let clock=Date.now();const f=await fixture(t,{now:()=>clock});await f.activate();await f.handoff();assert.equal((await f.binding.status({})).agentReady,true);
 clock+=86400001;const state=await f.binding.status({});assert.equal(state.processStatus,'expired');assert.equal(state.alive,true);assert.equal(state.agentReady,false);assert.equal(state.authentication,'not_observed');assert.equal(f.children[0].exitCode,null);assert.equal((await f.send('read_shared_terminal',{session_id:f.session.id})).value.result.isError,true);
});
