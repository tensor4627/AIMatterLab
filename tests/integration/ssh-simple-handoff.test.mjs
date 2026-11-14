import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual as equal} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createTerminalHandoff} from '../../agent/sessions/terminal-handoff.mjs';
import {createSshTerminalHandoff} from '../../agent/sessions/ssh-terminal-handoff.mjs';
import {prepareSshServiceResources} from '../../backend/main/compute/ssh-service-resources.mjs';
import {bundledWorkerRuntimeId} from '../../backend/main/compute/worker-service-version.mjs';
import {connectionServiceFixture} from '../helpers/ssh-connection-service-fixture.mjs';

function fixture(t,{finalResume,prepareResources}={}){
 let context={provider:'codex',threadId:'thread',serial:1},epoch=1,owner='human',grant=null,hint=null;
 const f=connectionServiceFixture(t,{current:()=>context,prepareResources}),calls=[],session=()=>({sessionId:'shell',kind:'ssh',connectionId:'A',owner,ownerEpoch:epoch,alive:true,resource:{kind:'ssh-connection',connectionId:'A',profileId:'profile-A',profileVersion:1}});
 const sameOwner=value=>{const {serial,...owner}=value||{};return owner;};const terminal={list:async()=>({sessions:[session()]}),resourceState:async()=>({sessionId:'shell',resource:session().resource,operator:owner,ownerEpoch:epoch,alive:true,processStatus:'running'}),hasCurrentGrant:(provider,id)=>owner==='agent'&&provider===context.provider&&(!id||id==='shell')&&equal(sameOwner(grant),sameOwner(context)),owner:async(data,{assertCurrent=()=>{}}={})=>{assertCurrent();assert.equal(data.ownerEpoch,epoch);owner=data.owner;epoch++;grant=owner==='agent'?structuredClone(context):null;return session();},close:async()=>({closed:true})};
 const workflowContext={current:()=>context,revision:()=>context.serial},resourceRouting={prepareHandoff(data){calls.push('begin-preparation');const own={...data};hint=own;return {assertCurrent(){assert.equal(hint,own);},release(){calls.push('end-preparation');if(hint===own)hint=null;}};},capture(){const ticket=f.resource.capture();return {selection:ticket.selection,assertCurrent:()=>f.resource.assertCurrent(ticket)};}};
 const agents={active:'codex',connect:async()=>{},selectContext:async()=>{calls.push('bind');}},records={conversation:()=>({provider:'codex',threadId:'thread'})};
 const terminalHandoff=createTerminalHandoff({terminal,workflowContext,agents,records,resourceRouting,assertIdle(){},agentRpc:async value=>{assert.equal(value.method,'thread/resume');calls.push(value.method);context={...context,serial:context.serial+1};return {thread:{id:'thread'}};}});
 const handoff=createSshTerminalHandoff({terminalHandoff,terminal,service:f.service,registration:f.registration,resourceRouting,workflowContext,agents,records,agentRpc:finalResume?async request=>finalResume({request,service:f.service,records,context,replace:next=>{context=next;}}):undefined});
 return {...f,handoff,terminal,agents,records,current:()=>context,providerCalls:calls,handoffHint:()=>hint,session,changeContext:()=>{context={...context,threadId:'other',serial:context.serial+1};},give:()=>handoff.owner({sessionId:'shell',ownerEpoch:epoch,owner:'agent',provider:'codex'}),take:()=>handoff.owner({sessionId:'shell',ownerEpoch:epoch,owner:'human'})};
}
test('one actual handoff sets up and registers the worker, grants both capabilities and sends no model turn',async t=>{
 const f=fixture(t),result=await f.give();assert.equal(result.owner,'agent');assert.equal(result.service.workflowReady,true);assert.equal(result.service.operator,'agent');assert(f.terminal.hasCurrentGrant('codex','shell'));assert(f.service.hasCurrentGrant('codex'));assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'configured');assert.deepEqual(f.providerCalls.filter(c=>c.startsWith('thread/')),['thread/resume']);assert.equal(f.calls.filter(c=>c.open).length,1);
 await f.take();assert.equal(f.session().owner,'human');assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.service.peek().workflowReady,true);assert.equal(f.channels.size,1);
});

for(const independent of [false,true])test('returning original shell after update revokes only its linked service lineage; independent grant='+independent,async t=>{
 const f=fixture(t);await f.give();const before=f.service.peek();f.connections.prepareServiceUpdate=async()=>({sessionId:'shell',assertCurrent(){}});const updated=await f.service.connect({connectionId:'A',profileId:'profile-A',profileVersion:1,requestId:'update-linked-origin',mode:'update',expectedAttemptId:before.attemptId});assert.equal(updated.operator,'agent');if(independent){f.service.owner({connectionId:'A',attemptId:updated.attemptId,owner:'human'});f.service.owner({connectionId:'A',attemptId:updated.attemptId,owner:'agent',scope:f.current()});}await f.take();assert.equal(f.terminal.hasCurrentGrant('codex'),false);assert.equal(f.service.hasCurrentGrant('codex'),independent);assert.equal(f.service.peek().workflowReady,true);
});
test('subsequent handoffs keep the same live worker; a new channel requests cached reuse only',async t=>{
 const f=fixture(t);await f.give();await f.take();await f.give();assert.equal(f.calls.filter(c=>c.open).length,1);await f.take();const s=f.service.peek();await f.service.disconnect({connectionId:'A',attemptId:s.attemptId});const result=await f.give();assert(result.service.workflowReady);const opens=f.calls.filter(c=>c.open);assert.equal(opens.length,2);assert.equal(opens[1].bootstrap.reuseOnly,true);assert.equal(opens[1].bootstrap.payload.expected_runtime_id,opens[0].bootstrap.payload.expected_runtime_id);
});
test('worker environment failure retains a usable shared shell and a safe service diagnosis',async t=>{
 const f=fixture(t);f.connections.openService=async data=>({...data,attemptId:data.requestId,status:'failed',serviceActive:false,error:{code:'python_unsupported',python:[3,8,0]}});const result=await f.give();assert.equal(result.owner,'agent');assert(f.terminal.hasCurrentGrant('codex'));assert.equal(result.service.error.code,'python_unsupported');assert.equal(f.service.hasCurrentGrant('codex'),false);
});
test('unknown dispatch is observed on the original attempt and never reopens service on another handoff',async t=>{
 const f=fixture(t);let opens=0;f.connections.openService=async data=>{opens++;return {...data,attemptId:data.requestId,status:'unknown',serviceActive:true};};await f.give();await f.take();await f.give();assert.equal(opens,1);assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.service.peek().status,'unknown');
});
test('human reclaim during pending setup prevents a late service grant',async t=>{
 const f=fixture(t),original=f.connections.openService;let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);f.connections.openService=async(...args)=>{entered();await gate;return original(...args);};const pending=f.give();await started;await f.take();release();await assert.rejects(pending,/terminal_context_changed/);assert.equal(f.session().owner,'human');assert.equal(f.service.hasCurrentGrant('codex'),false);
});
test('conversation change while preparing cannot authorize the worker for another conversation',async t=>{
 const f=fixture(t),original=f.connections.openService;f.connections.openService=async(...args)=>{const result=await original(...args);f.changeContext();return result;};await assert.rejects(f.give(),/terminal_context_changed/);assert.equal(f.service.hasCurrentGrant('codex'),false);
});
test('failed provider rebinding revokes the service grant but preserves terminal control',async t=>{
 const f=fixture(t);let n=0;f.agents.selectContext=async()=>{if(++n===2)throw Error('synthetic_bind_failed');};const result=await f.give();assert.equal(result.owner,'agent');assert.equal(f.service.hasCurrentGrant('codex'),false);assert(f.terminal.hasCurrentGrant('codex'));
});


test('before handoff the connection opens no worker channel and records no setup',async t=>{const f=fixture(t);assert.equal(f.calls.length,0);assert.equal(f.preparations.length,0);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'unconfigured');assert.equal(f.session().owner,'human');});
test('preparation starts only after the original terminal and conversation have been handed to Agent',async t=>{const f=fixture(t),original=f.connections.openService;let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);f.connections.openService=async(...args)=>{assert.equal(f.session().owner,'agent');assert(f.terminal.hasCurrentGrant('codex'));assert.equal(f.providerCalls.filter(c=>c==='thread/resume').length,1);entered();await gate;return original(...args);};const pending=f.give();await started;assert.equal(f.service.peek().status,'connecting');assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'unconfigured');release();const result=await pending;assert.equal(result.service.operator,'agent');assert.equal(result.service.workflowReady,true);assert.equal(f.calls.filter(c=>c.open).length,1);});
test('a later explicit handoff can retry a definitively failed setup, never an unknown attempt',async t=>{const f=fixture(t),original=f.connections.openService;let attempts=0;f.connections.openService=async(...args)=>++attempts===1?{...args[0],attemptId:args[0].requestId,status:'failed',serviceActive:false,error:{code:'python_unsupported'}}:original(...args);const failed=await f.give();assert.equal(failed.service.status,'failed');assert.equal(attempts,1);await f.take();const next=await f.give();assert.equal(next.service.workflowReady,true);assert.equal(attempts,2);});

test('the discovery guard targets service tools before enabling their usage grant',async t=>{const f=fixture(t);let serviceBinding=false;f.agents.selectContext=async()=>{if(f.handoffHint()?.capability==='service'){assert.equal(f.service.hasCurrentGrant('codex'),false);serviceBinding=true;}};const result=await f.give();assert.equal(result.service.operator,'agent');assert(serviceBinding);assert.equal(f.providerCalls.filter(c=>c==='begin-preparation').length,f.providerCalls.filter(c=>c==='end-preparation').length);});
test('final native resume completes under the service discovery fence before the handoff grant is minted',async t=>{const f=fixture(t,{finalResume:({context,replace,service})=>{assert.equal(service.hasCurrentGrant('codex'),false);replace({...context,serial:context.serial+1});return {thread:{id:context.threadId}};}});const r=await f.give();assert.equal(r.service.operator,'agent');assert(f.terminal.hasCurrentGrant('codex'));assert(f.service.hasCurrentGrant('codex'));});
test('a verified empty native replacement rebinds the exact terminal and grants only the canonical conversation',async t=>{const original={id:'codex:thread',provider:'codex',threadId:'thread',taskId:null,projectId:null,name:'owned'},saved={...original,id:'codex:canonical',threadId:'canonical',updatedAt:1},f=fixture(t,{finalResume:({context,replace,records,service})=>{assert.equal(service.hasCurrentGrant('codex'),false);records.conversation=(_p,id)=>id==='thread'?original:saved;records.catalog={get:()=>({replacementThreadId:'canonical',reason:'verified-empty-recovery'})};replace({...context,threadId:'canonical',serial:context.serial+2});return {thread:{id:'canonical'},studioRecovery:{status:'recovered',oldThreadId:'thread',conversation:saved}};}});f.records.conversation=()=>original;const r=await f.give();assert.equal(r.conversation.threadId,'canonical');assert.equal(r.ownerEpoch,3);assert.equal(r.sessionId,'shell');assert.equal(r.connectionId,'A');assert(f.terminal.hasCurrentGrant('codex'));assert(f.service.hasCurrentGrant('codex',{threadId:'canonical',provider:'codex'}));assert.equal(f.service.hasCurrentGrant('codex',{threadId:'thread',provider:'codex'}),false);});
test('unverified native thread replacement never inherits a handoff grant',async t=>{const f=fixture(t,{finalResume:({context,replace})=>{replace({...context,threadId:'foreign',serial:context.serial+2});return {thread:{id:'foreign'}};}});await assert.rejects(f.give(),/terminal_context_changed/);assert.equal(f.service.hasCurrentGrant('codex'),false);});

async function inactiveRegistration(f,reason){
 await f.connect();const state=f.service.peek();await f.service.disconnect({connectionId:'A',attemptId:state.attemptId});
 if(reason)f.registration.markMaintenance(f.profile('A'),reason);
}

function reconciliationFixture(t,{previousHealthy=false}={}){
 const manifest='b'.repeat(64),runtimeId=manifest.slice(0,20),f=fixture(t,{prepareResources:async(_source,options)=>({source:'inert',payload:{expected_runtime_id:options.verifiedCacheOnly?runtimeId:options.expectedRuntimeId||'a'.repeat(20),files:[],...options.verifiedCacheOnly?{runtime_manifest_sha256:manifest}:{}},transport:{source:'inert',sha256:'a'.repeat(64)}})}),open=f.connections.openService,request=f.connections.serviceRequest;
 let beforeReconcile=async()=>{};
 f.connections.openService=async(data,bootstrap,origin)=>{
  if(bootstrap.payload.expected_runtime_id!==runtimeId){
   if(bootstrap.reuseOnly&&bootstrap.startCached===false&&!previousHealthy){f.calls.push({open:data,bootstrap});return {...data,attemptId:data.requestId,status:'failed',serviceActive:false,error:{code:'worker_health_invalid',phase:'checking_health'}};}
   return open(data,bootstrap,origin);
  }
  assert.equal(bootstrap.reuseOnly,true);assert.notEqual(bootstrap.startCached,true);assert.deepEqual(bootstrap.payload.files,[]);assert.deepEqual(origin,{sessionId:'shell'});assert(f.terminal.hasCurrentGrant('codex','shell'));assert.equal(f.service.hasCurrentGrant('codex'),false);await beforeReconcile();
  const value=await open(data,bootstrap,origin),health=f.health(data.connectionId);value.service={...health,runtime:health.root+'/runtimes/'+runtimeId,runtimeId,runtimeManifestSha256:manifest,runtimeSourceScope:'verified-cached-manifest'};f.channels.set(data.connectionId,structuredClone(value));return value;
 };
 f.connections.serviceRequest=packet=>packet.target==='/api/health'&&f.channels.get(packet.connectionId)?.service?.runtimeId===runtimeId?Promise.resolve({status:200,data:structuredClone(f.channels.get(packet.connectionId).service)}):request(packet);
 return {...f,manifest,runtimeId,beforeReconcile:value=>{beforeReconcile=value;}};
}

test('same-profile worker health maintenance reaches backend read-only reconciliation without a service grant',async t=>{
 const f=fixture(t);await inactiveRegistration(f,'worker_health_invalid');let request,options;
 f.service.connectForAgent=async(data,value)=>{request=data;options=value;assert(f.terminal.hasCurrentGrant('codex','shell'));assert.equal(f.service.hasCurrentGrant('codex'),false);throw Error('worker_health_invalid');};
 const before=f.session(),result=await f.give();assert(request,'same-profile health maintenance must reach the backend reconciliation boundary');assert.equal(request.mode,'reuse');assert.equal(request.connectionId,'A');assert.equal(request.profileId,'profile-A');assert.equal(request.profileVersion,1);assert.deepEqual(options,{sessionId:'shell'});assert.equal(result.service.error.code,'worker_health_invalid');assert.equal(result.sessionId,before.sessionId);assert.equal(result.connectionId,before.connectionId);assert.equal(f.service.hasCurrentGrant('codex'),false);assert(f.terminal.hasCurrentGrant('codex','shell'));assert.equal(f.calls.filter(call=>call.open).length,1);
});

for(const reason of ['worker_cache_invalid','identity_unconfirmed','python_unsupported','namespace_unsafe'])test('handoff does not route '+reason+' maintenance into reconciliation',async t=>{
 const f=fixture(t);await inactiveRegistration(f,reason);let requests=0;f.service.connectForAgent=async()=>{requests++;throw Error('unexpected_reconciliation');};const result=await f.give();assert.equal(requests,0);assert.equal(result.service.error.code,'maintenance_required');assert.equal(f.service.hasCurrentGrant('codex'),false);assert(f.terminal.hasCurrentGrant('codex','shell'));
});

for(const changed of [{profileId:'profile-B'},{profileVersion:2}])test('health-maintenance exception requires exact registration profile '+JSON.stringify(changed),async t=>{
 const f=fixture(t);await inactiveRegistration(f,'worker_health_invalid');const read=f.registration.read;f.registration.read=value=>({...read(value),...changed});let requests=0;f.service.connectForAgent=async()=>{requests++;throw Error('unexpected_reconciliation');};const result=await f.give();assert.equal(requests,0);assert.equal(result.service.error.code,'maintenance_required');assert.equal(f.service.hasCurrentGrant('codex'),false);
});

for(const status of ['unknown','connecting','disconnecting'])test('health-maintenance exception never bypasses '+status+' service isolation',async t=>{
 const f=fixture(t);await inactiveRegistration(f,'worker_health_invalid');const peek=f.service.peek;f.service.peek=value=>({...peek(value),status,serviceActive:true});let requests=0;f.service.connectForAgent=async()=>{requests++;throw Error('unexpected_reconciliation');};await f.give();assert.equal(requests,0);assert.equal(f.service.hasCurrentGrant('codex'),false);
});

test('configuration changes retain the separate existing setup route rather than health reconciliation',async t=>{
 const f=fixture(t);await inactiveRegistration(f);const read=f.registration.read;f.registration.read=value=>({...read(value),status:'maintenance_required',reason:'configuration_changed'});let mode;f.service.connectForAgent=async data=>{mode=data.mode;throw Error('python_unsupported');};await f.give();assert.equal(mode,'setup');assert.equal(f.service.hasCurrentGrant('codex'),false);
});

for(const revoke of ['terminal','conversation'])test('pending read-only reconciliation cannot outlive '+revoke+' ownership',async t=>{
 const f=reconciliationFixture(t);await inactiveRegistration(f,'worker_health_invalid');let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);f.beforeReconcile(async()=>{entered();await gate;});const pending=f.give();await started;assert.equal(f.service.hasCurrentGrant('codex'),false);if(revoke==='terminal')await f.take();else f.changeContext();release();await assert.rejects(pending,/terminal_context_changed/);assert.equal(f.service.hasCurrentGrant('codex'),false);if(revoke==='terminal')assert.equal(f.session().owner,'human');assert.equal(f.calls.filter(call=>call.open).length,3);
});

test('a trusted saved worker remains the handoff target without implicit source update',async t=>{
 const source=fileURLToPath(new URL('../../backend/worker',import.meta.url)),transportSource=fileURLToPath(new URL('../../desktop/platform/terminal-service/python',import.meta.url)),f=fixture(t,{prepareResources:async(_source,options)=>prepareSshServiceResources(source,{...options,transportSource})});
 f.registration.remember(f.profile('A'),f.health('A'),{status:'ready',count:1});const registration=f.registration.read({profileId:'profile-A',profileVersion:1}).registration,connect=f.service.connectForAgent;assert.notEqual(bundledWorkerRuntimeId(source),registration.runtimeId);let mode;
 f.service.connectForAgent=(data,options)=>{mode=data.mode;return connect(data,options);};const before=f.session(),result=await f.give();assert.equal(mode,'reuse');assert.equal(result.service.workflowReady,true);assert.equal(result.service.health.runtimeId,registration.runtimeId);assert.equal(result.sessionId,before.sessionId);assert.equal(result.connectionId,before.connectionId);const open=f.calls.filter(call=>call.open).at(-1);assert.equal(open.bootstrap.reuseOnly,true);assert.equal(open.bootstrap.startCached,true);assert.equal(open.bootstrap.payload.expected_runtime_id,registration.runtimeId);assert.deepEqual(open.bootstrap.payload.files,[]);assert.equal(f.calls.filter(call=>call.open).length,1);assert(!f.calls.some(call=>call.open?.mode==='update'));assert(!f.preparations.some(value=>value.verifiedCacheOnly));
});

test('backend-verified already-running replacement is granted only after read-only reconciliation on the original shell',async t=>{
 const f=reconciliationFixture(t);await inactiveRegistration(f,'worker_health_invalid');const before=f.session(),result=await f.give();assert.equal(result.service.workflowReady,true);assert.equal(result.service.operator,'agent');assert.equal(result.service.health.runtimeId,f.runtimeId);assert.equal(result.service.health.runtimeManifestSha256,f.manifest);assert.equal(result.sessionId,before.sessionId);assert.equal(result.connectionId,before.connectionId);assert.equal(result.ownerEpoch,before.ownerEpoch+1);assert(f.service.hasCurrentGrant('codex'));const saved=f.registration.read({profileId:'profile-A',profileVersion:1});assert.equal(saved.status,'configured');assert.equal(saved.registration.runtimeManifestSha256,f.manifest);assert.equal(f.preparations.at(-1).verifiedCacheOnly,true);assert.equal(f.preparations.at(-1).reuseOnly,true);assert.equal(f.calls.filter(call=>call.open).length,3);assert.equal(f.calls.filter(call=>call.close).length,1);assert(!f.calls.some(call=>call.request?.method==='POST'&&!call.request?.mcp));await f.take();assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.session().owner,'human');assert.equal(f.service.peek().workflowReady,true);
});

test('a recovered registered worker clears health maintenance and keeps the same shell without probing the shipped replacement',async t=>{
 const f=reconciliationFixture(t,{previousHealthy:true});await inactiveRegistration(f,'worker_health_invalid');const before=f.session(),result=await f.give();assert.equal(result.service.workflowReady,true);assert.equal(result.service.operator,'agent');assert.equal(result.service.health.runtimeId,'a'.repeat(20));assert.equal(result.sessionId,before.sessionId);assert.equal(result.connectionId,before.connectionId);assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'configured');assert(f.service.hasCurrentGrant('codex'));assert.equal(f.preparations.length,2);assert(!f.preparations.some(value=>value.verifiedCacheOnly));const opens=f.calls.filter(call=>call.open);assert.equal(opens.length,2);assert.equal(opens[1].bootstrap.startCached,false);assert.deepEqual(opens[1].bootstrap.payload.files,[]);assert.equal(opens[1].bootstrap.payload.expected_runtime_id,'a'.repeat(20));
});
