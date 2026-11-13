import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual as equal} from 'node:util';
import {createTerminalHandoff} from '../../agent/sessions/terminal-handoff.mjs';
import {createSshTerminalHandoff} from '../../agent/sessions/ssh-terminal-handoff.mjs';
import {connectionServiceFixture} from '../helpers/ssh-connection-service-fixture.mjs';

function fixture(t){
 let context={provider:'codex',threadId:'thread',serial:1},epoch=1,owner='human',grant=null;
 const f=connectionServiceFixture(t,{current:()=>context}),calls=[],session=()=>({sessionId:'shell',kind:'ssh',connectionId:'A',owner,ownerEpoch:epoch,alive:true,resource:{kind:'ssh-connection',connectionId:'A',profileId:'profile-A',profileVersion:1}});
 const terminal={list:async()=>({sessions:[session()]}),resourceState:async()=>({sessionId:'shell',resource:session().resource,operator:owner,ownerEpoch:epoch,alive:true,processStatus:'running'}),hasCurrentGrant:(provider,id)=>owner==='agent'&&provider===context.provider&&(!id||id==='shell')&&equal(grant,context),owner:async(data,{assertCurrent=()=>{}}={})=>{assertCurrent();assert.equal(data.ownerEpoch,epoch);owner=data.owner;epoch++;grant=owner==='agent'?structuredClone(context):null;return session();},close:async()=>({closed:true})};
 const workflowContext={current:()=>context,revision:()=>context.serial},resourceRouting={capture(){const ticket=f.resource.capture();return {selection:ticket.selection,assertCurrent:()=>f.resource.assertCurrent(ticket)};}};
 const agents={active:'codex',connect:async()=>{},selectContext:async()=>{calls.push('bind');}},records={conversation:()=>({provider:'codex',threadId:'thread'})};
 const terminalHandoff=createTerminalHandoff({terminal,workflowContext,agents,records,resourceRouting,assertIdle(){},agentRpc:async value=>{assert.equal(value.method,'thread/resume');calls.push(value.method);context={...context,serial:context.serial+1};return {thread:{id:'thread'}};}});
 const handoff=createSshTerminalHandoff({terminalHandoff,terminal,service:f.service,registration:f.registration,resourceRouting,workflowContext,agents});
 return {...f,handoff,terminal,agents,providerCalls:calls,session,changeContext:()=>{context={...context,threadId:'other',serial:context.serial+1};},give:()=>handoff.owner({sessionId:'shell',ownerEpoch:epoch,owner:'agent',provider:'codex'}),take:()=>handoff.owner({sessionId:'shell',ownerEpoch:epoch,owner:'human'})};
}
test('one actual handoff sets up and registers the worker, grants both capabilities and sends no model turn',async t=>{
 const f=fixture(t),result=await f.give();assert.equal(result.owner,'agent');assert.equal(result.service.workflowReady,true);assert.equal(result.service.operator,'agent');assert(f.terminal.hasCurrentGrant('codex','shell'));assert(f.service.hasCurrentGrant('codex'));assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'configured');assert.deepEqual(f.providerCalls.filter(c=>c.startsWith('thread/')),['thread/resume']);assert.equal(f.calls.filter(c=>c.open).length,1);
 await f.take();assert.equal(f.session().owner,'human');assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.service.peek().workflowReady,true);assert.equal(f.channels.size,1);
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

test('login preparation deploys and registers without Agent grant; subsequent login preparation reuses its cache',async t=>{
 const f=fixture(t),selected=f.resource.peek();const first=await f.service.prepareForConnection(selected);
 assert(first.workflowReady);assert.equal(first.operator,'human');assert.equal(f.service.hasCurrentGrant('codex'),false);assert.equal(f.session().owner,'human');
 assert.equal(f.registration.read({profileId:'profile-A',profileVersion:1}).status,'configured');
 await f.service.disconnect({connectionId:'A',attemptId:first.attemptId});await f.service.prepareForConnection(selected);
 const opens=f.calls.filter(c=>c.open);assert.equal(opens.length,2);assert.equal(opens[1].bootstrap.reuseOnly,true);assert.equal(opens[1].bootstrap.startCached,true);
});

test('handoff during automatic login preparation waits for that one attempt before preparing the conversation',async t=>{
 const f=fixture(t),original=f.connections.openService;let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);f.connections.openService=async(...args)=>{entered();await gate;return original(...args);};
 const preparing=f.service.prepareForConnection(f.resource.peek());await started;const pending=f.give();await new Promise(r=>setImmediate(r));assert.equal(f.providerCalls.length,0);assert.equal(f.session().owner,'human');release();await preparing;
 const handed=await pending;assert(handed.service.workflowReady);assert.equal(handed.service.operator,'agent');assert.equal(f.calls.filter(c=>c.open).length,1);assert.equal(f.providerCalls.filter(c=>c==='thread/resume').length,1);
});

test('failed automatic preparation is not repeated just because the human hands over the terminal',async t=>{
 const f=fixture(t);let opens=0;f.connections.openService=async data=>{opens++;return {...data,attemptId:data.requestId,status:'failed',serviceActive:false,error:{code:'python_unsupported'}};};await f.service.prepareForConnection(f.resource.peek());
 const result=await f.give();assert.equal(result.owner,'agent');assert.equal(result.service.error.code,'python_unsupported');assert.equal(opens,1);
});
