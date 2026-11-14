import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID} from 'node:crypto';
import {createSharedTerminal} from '../../backend/main/compute/shared-terminal.mjs';
import {mockTerminalRuntime} from '../helpers/terminal-runtime-fixture.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const transport='inert transport fixture',bootstrap={source:'inert loader fixture',payload:{expected_runtime_id:'a'.repeat(20)},transport:{source:transport,sha256:createHash('sha256').update(transport).digest('hex')}};
const health={name:'gpu-sampling-studio',execution_policy:'desktop-review-v1',root:'/owned/service',runtime:'/owned/runtime',runtime_id:'a'.repeat(20),hostname:'owned-fixture',uid:1000,machineId:'owned-machine',port:23456,transport_kind:'ssh-terminal'};

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-service-dispatch-proof-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const rows=new Map(),catalog={list:kind=>[...rows].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>structuredClone(value)),get:(kind,id)=>structuredClone(rows.get(kind+':'+id)||null),put:(kind,id,value)=>rows.set(kind+':'+id,structuredClone({...value,id})),remove:(kind,id)=>rows.delete(kind+':'+id)};
 const key=randomBytes(32),encryption={isEncryptionAvailable:()=>true,encryptString(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);},decryptString(bytes){const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');}};
 let profile={id:'owned-profile',version:1,kind:'ssh',mode:'interactive',name:'Owned fixture',host:'example.invalid',username:'fixture-user',port:22,ssh_client:'C:\\Fixture\\ssh.exe'},selected=null,revision=0,context={provider:'codex',threadId:'owned-thread'},config,startHook,stateHook;
 const sessions=new Map(),calls=[],cancelled=new Set();
 const requestApi=async(descriptor,method,route,body)=>{
  calls.push({brokerId:descriptor.instanceId,method,route,body:structuredClone(body)});
  if(route==='/connections')return {connections:[]};
  if(route==='/health')return {instanceId:config.instanceId,pid:4242};
  if(route==='/sessions')return {sessions:[...sessions.values()].map(value=>structuredClone(value))};
  if(route==='/sessions/open'){const value={id:randomUUID(),kind:'ssh',mode:'interactive',name:'SSH fixture',owner:'human',ownerEpoch:1,alive:true,sequence:0,serviceActive:false,serviceStatus:'idle',terminalAccess:'available'};sessions.set(value.id,value);return structuredClone(value);}
  const match=/^\/sessions\/([^/]+)\/(state|owner|close|service\/(start|cancel|stop|state|request))$/.exec(route);assert(match,route);const value=sessions.get(match[1]);assert(value,'exact fixture session must exist');
  if(match[2]==='state'){const result=structuredClone(value);if(stateHook)await stateHook();return result;}
  if(match[2]==='close'){sessions.delete(value.id);return {closed:true};}
  if(match[2]==='owner'){assert.equal(body.ownerEpoch,value.ownerEpoch);value.owner=body.owner;value.ownerEpoch++;value.scope=body.scope;return structuredClone(value);}
  if(match[3]==='state')return structuredClone(value);
  if(match[3]==='start'){
   if(startHook)return startHook(value,body);
   if(cancelled.has(body.requestId)){const error=Error('terminal_service_changed');error.terminalRejected=true;throw error;}
   Object.assign(value,{serviceStatus:'connected',serviceActive:true,terminalAccess:'reserved',serviceId:randomUUID(),startRequestId:body.requestId,servicePhase:'ready',service:health});value.ownerEpoch++;
   return structuredClone(value);
  }
  if(match[3]==='cancel'){cancelled.add(body.requestId);if(value.startRequestId===body.requestId)Object.assign(value,{serviceStatus:'disconnected',serviceActive:false,terminalAccess:'available'});return {...structuredClone(value),cancelled:true,cancelledRequestId:body.requestId};}
  if(match[3]==='stop'){assert.equal(body.serviceId,value.serviceId);Object.assign(value,{serviceStatus:'disconnected',serviceActive:false,terminalAccess:'available'});return structuredClone(value);}
  return {status:200,data:{fixture:true}};
 };
 const spawn=()=>{const child=new EventEmitter();child.pid=4242;child.stdout=new PassThrough();child.unref=()=>{};child.stdin=new Writable({write(bytes,_encoding,done){config=JSON.parse(bytes.toString());queueMicrotask(()=>child.stdout.write(JSON.stringify({origin:'http://127.0.0.1:32123',instanceId:config.instanceId,pid:4242})+'\n'));done();}});return child;};
 const controller=createSharedTerminal({desktopSessionId:'owned-desktop',prepareRuntime:mockTerminalRuntime,profiles:{read:({id,version})=>{if(id!==profile.id||version!==undefined&&version!==profile.version)throw Error('Changed profile fixture');return structuredClone(profile);}},catalog,encryption,root:path.join(root,'credentials'),runtimeRoot:path.join(root,'runtime'),dependencyRoot:path.join(root,'dependencies'),servicePath:path.join(root,'broker.mjs'),nodeExecutable:process.execPath,platform:'win32',settings:()=>({cwd:root}),current:()=>context,getSelectedResource:()=>selected,selectionRevision:()=>revision,spawn,requestApi});
 const open=async()=>{const value=await controller.open({kind:'ssh',mode:'interactive',profileId:profile.id,version:profile.version});selected={kind:'ssh-terminal',sessionId:value.id,profileId:profile.id,profileVersion:profile.version};return value;};
 return {controller,open,calls,sessions,cancelled,profile:()=>structuredClone(profile),saveProfile:value=>profile=structuredClone(value),intent:(session,requestId='owned-attempt')=>({sessionId:session.id,ownerEpoch:session.ownerEpoch,profileId:profile.id,profileVersion:profile.version,requestId}),setStart:hook=>startHook=hook,setState:hook=>stateHook=hook,selectOther:()=>{selected={kind:'ssh-terminal',sessionId:'other-session',profileId:'other-profile',profileVersion:1};revision++;context={provider:'codex',threadId:'other-thread'};},changeProfile:()=>profile={...profile,version:profile.version+1}};
}

test('a proven owner-epoch refusal before POST retains its safe code and serviceNotStarted proof',async t=>{
 const f=fixture(t),session=await f.open();f.sessions.get(session.id).ownerEpoch++;
 await assert.rejects(f.controller.connectService(f.intent(session),bootstrap),error=>{assert.equal(error.message,'terminal_owner_changed');assert.equal(error.serviceNotStarted,true);return true;});
 assert.equal(f.calls.filter(call=>call.route.endsWith('/service/start')).length,0);
 const cancelled=await f.controller.cancelServiceStart({sessionId:session.id,requestId:'owned-attempt'});assert.equal(cancelled.cancelledAttemptId,'owned-attempt');assert.equal(cancelled.terminalAccess,'available');assert.equal(f.calls.filter(call=>call.route.endsWith('/service/stop')).length,0);
});

test('local selection and malformed environment refusals cannot invent a remote Python attempt',async t=>{
 const f=fixture(t),session=await f.open(),intent=f.intent(session);
 for(const serviceEnvironment of [{python:'python3 -c PRIVATE'},{python:'relative/private/python'},{python:'/usr/bin/python\nPRIVATE'},{activation:'PRIVATE\0'},{extra:'PRIVATE'}]){
  await assert.rejects(f.controller.connectService(intent,{...bootstrap,serviceEnvironment}),error=>{assert.equal(error.message,'terminal_invalid_request');assert.equal(error.serviceNotStarted,true);assert(!String(error).includes('PRIVATE'));return true;});
 }
 f.selectOther();await assert.rejects(f.controller.connectService(intent,bootstrap),error=>{assert.equal(error.message,'terminal_scope_denied');assert.equal(error.serviceNotStarted,true);return true;});assert.equal(f.calls.filter(call=>call.route.endsWith('/service/start')).length,0);
});

test('configured environment is included in the exact dispatched attempt signature',async t=>{
 const f=fixture(t),session=await f.open(),intent=f.intent(session),configured={...bootstrap,serviceEnvironment:{python:'/owned/env with spaces/bin/python',activation:'module load python\nsource /owned/env/bin/activate'}};
 await f.controller.connectService(intent,configured);const sent=f.calls.find(call=>call.route.endsWith('/service/start'));assert.deepEqual(sent.body.bootstrap.serviceEnvironment,configured.serviceEnvironment);
 await assert.rejects(f.controller.connectService(intent,{...configured,serviceEnvironment:{...configured.serviceEnvironment,python:'python3'}}),error=>{assert.equal(error.message,'terminal_invalid_request');assert.equal(error.serviceNotStarted,undefined);return true;});assert.equal(f.calls.filter(call=>call.route.endsWith('/service/start')).length,1);
});

test('a lost POST reply and same-attempt later local refusal can never acquire not-started proof',async t=>{
 const f=fixture(t),session=await f.open(),intent=f.intent(session);
 f.setStart(()=>{const error=Error('terminal_service_unknown');error.terminalRejected=true;error.serviceNotStarted=true;throw error;});
 await assert.rejects(f.controller.connectService(intent,bootstrap),error=>{assert.equal(error.message,'terminal_service_unknown');assert.equal(error.serviceNotStarted,undefined);return true;});
 f.selectOther();await assert.rejects(f.controller.connectService(intent,bootstrap),error=>{assert.equal(error.message,'terminal_scope_denied');assert.equal(error.serviceNotStarted,undefined);return true;});
 await assert.rejects(f.controller.connectService({...intent,requestId:'different-attempt'},bootstrap),error=>{assert.equal(error.serviceNotStarted,undefined);return true;});
 assert.equal(f.calls.filter(call=>call.route.endsWith('/service/start')).length,1);
});

test('exact cancel-start capability survives selection changes and never targets the new resource',async t=>{
 const f=fixture(t),session=await f.open(),intent=f.intent(session),entered=deferred(),release=deferred();
 f.setStart(async()=>{entered.resolve();await release.promise;const error=Error('terminal_service_changed');error.terminalRejected=true;throw error;});
 const pending=f.controller.connectService(intent,bootstrap);pending.catch(()=>{});await entered.promise;f.selectOther();
 const result=await f.controller.cancelServiceStart({sessionId:session.id,requestId:intent.requestId});assert.equal(result.cancelledAttemptId,intent.requestId);assert.equal(result.serviceActive,false);assert.equal(result.terminalAccess,'available');
 const cancelCall=f.calls.find(call=>call.route.endsWith('/service/cancel'));assert.equal(cancelCall.route,'/sessions/'+session.id+'/service/cancel');assert.deepEqual(cancelCall.body,{requestId:intent.requestId});
 release.resolve();await assert.rejects(pending,error=>{assert.equal(error.serviceNotStarted,undefined);return true;});
 const count=f.calls.length;await assert.rejects(f.controller.cancelServiceStart({sessionId:'other-session',requestId:intent.requestId}),/terminal_service_changed/);await assert.rejects(f.controller.cancelServiceStart({sessionId:session.id,requestId:'forged-attempt'}),/terminal_service_changed/);assert.equal(f.calls.length,count);
});

test('exact established-service teardown survives profile and selection changes while requests remain guarded',async t=>{
 const f=fixture(t),session=await f.open(),intent=f.intent(session),ready=await f.controller.connectService(intent,bootstrap);f.selectOther();f.changeProfile();
 const count=f.calls.length;await assert.rejects(f.controller.serviceRequest({sessionId:session.id,serviceId:ready.serviceId,requestId:'guarded-request',method:'GET',target:'/api/health',mcp:false}),/terminal_saved_connection_changed/);assert.equal(f.calls.length,count);
 const stopped=await f.controller.disconnectService({sessionId:session.id,serviceId:ready.serviceId});assert.equal(stopped.serviceActive,false);assert.equal(stopped.terminalAccess,'available');assert.equal(f.calls.at(-1).route,'/sessions/'+session.id+'/service/stop');
 const stoppedCount=f.calls.length;await assert.rejects(f.controller.disconnectService({sessionId:session.id,serviceId:'forged-lease'}),/terminal_service_changed/);assert.equal(f.calls.length,stoppedCount);
});

test('closing the exact session revokes its saved cancellation capability',async t=>{
 const f=fixture(t),session=await f.open();f.sessions.get(session.id).ownerEpoch++;
 await assert.rejects(f.controller.connectService(f.intent(session),bootstrap),error=>error.serviceNotStarted===true);
 await f.controller.close({sessionId:session.id});const count=f.calls.length;
 await assert.rejects(f.controller.cancelServiceStart({sessionId:session.id,requestId:'owned-attempt'}),/terminal_service_changed/);assert.equal(f.calls.length,count);
});

test('an exact failed-start lease remains eligible for teardown without granting service requests',async t=>{
 const f=fixture(t),session=await f.open(),intent=f.intent(session);
 f.setStart((value,body)=>{Object.assign(value,{serviceStatus:'failed',serviceActive:true,terminalAccess:'unknown',serviceId:randomUUID(),startRequestId:body.requestId,servicePhase:'waiting_python',error:{code:'python_response_timeout',phase:'waiting_python'}});return structuredClone(value);});
 const failed=await f.controller.connectService(intent,bootstrap);assert.equal(failed.status,'failed');assert.equal(failed.serviceActive,true);
 await assert.rejects(f.controller.serviceRequest({sessionId:session.id,serviceId:failed.serviceId,requestId:'not-authorized',method:'GET',target:'/api/health',mcp:false}),/terminal_service_changed/);
 f.selectOther();const stopped=await f.controller.disconnectService({sessionId:session.id,serviceId:failed.serviceId});assert.equal(stopped.terminalAccess,'available');
});

test('a lost receipt can capture only its exact attempt lease from a later checked state for cleanup',async t=>{
 const f=fixture(t),session=await f.open(),intent=f.intent(session);
 f.setStart((value,body)=>{Object.assign(value,{serviceStatus:'failed',serviceActive:true,terminalAccess:'unknown',serviceId:randomUUID(),startRequestId:body.requestId,servicePhase:'waiting_python'});const error=Error('terminal_service_unknown');error.terminalRejected=true;throw error;});
 await assert.rejects(f.controller.connectService(intent,bootstrap));const observed=await f.controller.serviceState({sessionId:session.id});assert.equal(observed.attemptId,intent.requestId);
 f.selectOther();const stopped=await f.controller.disconnectService({sessionId:session.id,serviceId:observed.serviceId});assert.equal(stopped.serviceActive,false);assert.equal(stopped.terminalAccess,'available');
});

const environmentNext=previous=>({...previous,version:previous.version+1,serviceEnvironment:{python:'/owned/env/bin/python',activation:'source /owned/env/bin/activate'}});

test('an explicit environment-only save adopts an idle SSH login with acknowledged local metadata and ordinary open reuses it',async t=>{
 const f=fixture(t),session=await f.open(),previous=f.profile(),next=environmentNext(previous),receipt=await f.controller.prepareProfileEnvironmentUpdate({previous,next});
 assert.deepEqual(receipt.sessionIds,[session.id]);assert(Object.isFrozen(receipt));assert(Object.isFrozen(receipt.sessionIds));assert.equal(f.controller.assertProfileEnvironmentUpdate(receipt),true);
 const before=f.calls.length,epoch=f.sessions.get(session.id).ownerEpoch;f.saveProfile(next);const adopted=await f.controller.commitProfileEnvironmentUpdate(receipt,next);assert.deepEqual(adopted,{sessionIds:[session.id],connectionIds:[]});assert.equal(f.calls.length,before);assert.equal(f.sessions.get(session.id).ownerEpoch,epoch);
 assert.equal((await f.open()).id,session.id);assert.equal(f.calls.filter(call=>call.route==='/sessions/open').length,1);assert.equal(f.calls.filter(call=>call.route.includes('/service/')&&call.method!=='GET').length,0);
 await assert.rejects(f.controller.prepareProfileEnvironmentUpdate({previous:next,next:{...environmentNext(next),host:'changed.invalid'}}),/terminal_invalid_request/);
 await assert.rejects(f.controller.commitProfileEnvironmentUpdate(receipt,next),/terminal_invalid_request/);
});

test('environment adoption cannot use a forged receipt or save before the registry owns the predicted version',async t=>{
 const f=fixture(t),session=await f.open(),previous=f.profile(),next=environmentNext(previous),receipt=await f.controller.prepareProfileEnvironmentUpdate({previous,next});
 assert.throws(()=>f.controller.assertProfileEnvironmentUpdate({...receipt}),/terminal_invalid_request/);await assert.rejects(f.controller.commitProfileEnvironmentUpdate(receipt,next),/terminal_(unavailable|saved_connection_changed)/);
 assert.equal((await f.controller.resourceState({sessionId:session.id})).resource.profileVersion,1);assert.equal(f.profile().version,1);
});

test('broker-active and unconfirmed local POST states both block environment adoption without sending service commands',async t=>{
 const f=fixture(t),session=await f.open(),previous=f.profile(),next=environmentNext(previous),state=f.sessions.get(session.id);
 state.serviceActive=true;state.serviceStatus='connecting';state.terminalAccess='reserved';await assert.rejects(f.controller.prepareProfileEnvironmentUpdate({previous,next}),/terminal_service_active/);Object.assign(state,{serviceActive:false,serviceStatus:'idle',terminalAccess:'available'});
 f.setStart(()=>{const error=Error('terminal_service_unknown');error.terminalRejected=true;throw error;});await assert.rejects(f.controller.connectService(f.intent(session),bootstrap));
 const before=f.calls.length;await assert.rejects(f.controller.prepareProfileEnvironmentUpdate({previous,next}),/terminal_service_active/);assert.equal(f.calls.length,before);assert.equal(f.profile().version,1);
});

test('prepared environment adoption is fenced by later context, ownership and session changes',async t=>{
 for(const change of ['context','owner','close']){
  const f=fixture(t),session=await f.open(),previous=f.profile(),next=environmentNext(previous),receipt=await f.controller.prepareProfileEnvironmentUpdate({previous,next});
  if(change==='context')f.selectOther();else if(change==='owner')await f.controller.owner({sessionId:session.id,ownerEpoch:session.ownerEpoch,owner:'agent'});else await f.controller.close({sessionId:session.id});
  assert.throws(()=>f.controller.assertProfileEnvironmentUpdate(receipt),/terminal_(context_changed|service_changed)/,change);assert.equal(f.profile().version,1);
 }
});

test('environment adoption revokes an old Agent grant without changing remote ownership or granting a new one',async t=>{
 const f=fixture(t),session=await f.open(),handed=await f.controller.owner({sessionId:session.id,ownerEpoch:session.ownerEpoch,owner:'agent'});assert.equal(f.controller.hasCurrentGrant('codex',session.id),true);
 const previous=f.profile(),next=environmentNext(previous),receipt=await f.controller.prepareProfileEnvironmentUpdate({previous,next});f.controller.assertProfileEnvironmentUpdate(receipt);const count=f.calls.length;f.saveProfile(next);await f.controller.commitProfileEnvironmentUpdate(receipt,next);
 assert.equal(f.calls.length,count);assert.equal(f.sessions.get(session.id).owner,'agent');assert.equal(f.sessions.get(session.id).ownerEpoch,handed.ownerEpoch);assert.equal(f.controller.hasCurrentGrant('codex',session.id),false);
});

test('a remote ownership change discovered during the idle read cannot be adopted',async t=>{
 const f=fixture(t),session=await f.open(),previous=f.profile(),next=environmentNext(previous);f.sessions.get(session.id).ownerEpoch++;
 await assert.rejects(f.controller.prepareProfileEnvironmentUpdate({previous,next}),/terminal_service_active/);assert.equal(f.profile().version,1);assert.equal(f.calls.filter(call=>call.method==='POST'&&call.route.includes('/service/')).length,0);
});
