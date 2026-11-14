import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationTerminals} from '../../agent/sessions/conversation-terminals.mjs';

function fixture(){
 const ref={kind:'ssh-connection',schemaVersion:2,selectionId:'selection',connectionId:'connection',profileId:'profile',profileVersion:1};
 const sessions=new Map(),owners=new Map(),closed=[],calls=[];let time=0,context={provider:'codex',threadId:null},sequence=0,granted=null,serviceState={status:'disconnected'},waiting=Promise.resolve(),active=null;
 function shell(){
  const s={connectionId:ref.connectionId,sessionId:'shell-'+ ++sequence,kind:'ssh',owner:'human',ownerEpoch:1,alive:true};
  sessions.set(s.sessionId,s);return s;
 }
 const terminal={connections:{openShell:async()=>shell()},resourceState:async({sessionId})=>{const s=sessions.get(sessionId);return {resource:ref,operator:s.owner,ownerEpoch:s.ownerEpoch,alive:true,processStatus:'running'};},
  owner:async(data,options)=>{options.assertCurrent();const s=sessions.get(data.sessionId);assert.equal(s.ownerEpoch,data.ownerEpoch);owners.set(s.sessionId,context.threadId);s.owner=data.owner;s.ownerEpoch++;return {...s};},
  hasCurrentGrant:(p,id)=>p===context.provider&&owners.get(id)===context.threadId,
  closeConversationShell:async({sessionId,ownerEpoch})=>{assert.equal(sessions.get(sessionId).ownerEpoch,ownerEpoch);sessions.delete(sessionId);closed.push(sessionId);},
  discardConversationShell:async({sessionId})=>sessions.delete(sessionId)};
 const service={peek:()=>serviceState,hasCurrentGrant:()=>granted===context.threadId,
  connectForConversations:async value=>{calls.push(value);await waiting;return serviceState={...ref,workflowReady:true,status:'connected',attemptId:'attempt'};},
  owner:({scope})=>{granted=scope.threadId;},markTerminalHandoff(){},reclaimTerminalHandoff(){}};
 const pool=createConversationTerminals({terminal,service,resource:{peek:()=>ref,capture:()=>ref,assertCurrent:ticket=>assert.equal(ticket,ref)},registration:{read:()=>({status:'configured'})},
  current:()=>context,idleMinutes:()=>1,busy:scope=>active===scope.threadId,now:()=>time});
 return {pool,sessions,closed,calls,shell,scope:()=>context,change:id=>{context={provider:'codex',threadId:id};},
  advance:ms=>{time+=ms;},active:id=>{active=id;},gate:promise=>{waiting=promise;},grant:()=>granted};
}
test('reserve without creating a conversation, capture, park, return, expire and wake separate PTYs',async()=>{
 const f=fixture(),a=f.shell(),provider='codex',choose=async id=>{f.change(id);await f.pool.acquire(provider,f.scope());};
 assert.equal((await f.pool.arm(a,provider)).awaitingConversation,true);assert.equal(f.calls.length,0);
 await choose('A');assert.equal(f.grant(),'A');assert(f.pool.describe(a).currentConversation);
 f.advance(30000);await choose('B');const b=[...f.sessions.values()][1];assert.notEqual(b.sessionId,a.sessionId);assert(!f.pool.describe(a).currentConversation);assert(f.pool.describe(b).currentConversation);
 await choose('A');assert.equal(f.sessions.size,2);assert.equal(f.calls.length,1);assert.equal(f.calls[0].mode,'reuse');
 f.active('A');f.advance(61000);await f.pool.sweep();assert.deepEqual(f.closed,[b.sessionId]);await choose('B');
 assert.equal(f.sessions.size,2);assert(!f.sessions.has(b.sessionId));assert.equal(f.calls.length,1);
 f.pool.stop();await choose('C');assert.equal(f.sessions.size,2);
});
test('two conversations arriving during a cached attach share the attempt and only the current one gets its grant',async()=>{
 const f=fixture();await f.pool.arm(f.shell(),'codex');let resolve;f.gate(new Promise(r=>resolve=r));
 f.change('A');const first=f.pool.acquire('codex',f.scope());await new Promise(setImmediate);
 f.change('B');const second=f.pool.acquire('codex',f.scope());await new Promise(setImmediate);resolve();
 await assert.rejects(first,/context_changed/);await second;assert.equal(f.calls.length,1);assert.equal(f.grant(),'B');assert.equal(f.sessions.size,2);
});
test('human reclaim disables new captures and expiry also handles an unclaimed handoff',async()=>{
 const f=fixture(),a=f.shell();await f.pool.arm(a,'codex');f.advance(60001);await f.pool.sweep();assert.deepEqual(f.closed,[a.sessionId]);
 f.change('A');await f.pool.acquire('codex',f.scope());const [b]=f.sessions.values();f.pool.releaseShell(b.sessionId);f.change('B');await f.pool.acquire('codex',f.scope());assert.equal(f.sessions.size,1);
});
