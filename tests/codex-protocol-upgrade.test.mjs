import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import path from 'node:path';
import {CodexBridge,PROTOCOL_VERSION,verifyProtocolVersion} from '../desktop/codex.mjs';
import {STUDIO_VERSION} from '../desktop/studio-version.mjs';
import {bootstrapSkills} from '../desktop/codex-isolation.mjs';

test('the bridge and generated app-server protocol identify the same exact tested CLI',()=>{
 const version=JSON.parse(fs.readFileSync(new URL('../desktop/generated/version.json',import.meta.url),'utf8'));
 assert.equal(version.version,PROTOCOL_VERSION);
 const client=fs.readFileSync(new URL('../desktop/generated/ClientRequest.ts',import.meta.url),'utf8');
 for(const method of ['initialize','account/read','model/list','thread/start','thread/resume','thread/read','turn/start','turn/steer','turn/interrupt','config/read','skills/list','mcpServerStatus/list'])assert(client.includes('"method": "'+method+'"'));
});

test('an unverified CLI stays blocked with actionable installed/expected version diagnostics',()=>{
 assert.doesNotThrow(()=>verifyProtocolVersion(PROTOCOL_VERSION));
 for(const installed of ['0.163.0-alpha.11.2',PROTOCOL_VERSION+'.unverified','future-version'])assert.throws(()=>verifyProtocolVersion(installed),error=>error.code==='STUDIO_CODEX_PROTOCOL_MISMATCH'&&error.expectedVersion===PROTOCOL_VERSION&&error.installedVersion===installed&&error.message.includes('会话和计算流程仍保留'));
});

test('legacy native skill path strings do not authorize relative or plugin paths in Studio isolation',async()=>{
 for(const skillPath of ['relative/SKILL.md','plugin://unscoped/skills/SKILL.md']){
  const calls=[],initializers=[],child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  child.stdin={write:value=>{const m=JSON.parse(value);calls.push(m.method);if(m.method==='initialize')initializers.push(m.params);if(m.id)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:m.id,result:m.method==='skills/list'?{data:[{skills:[{path:skillPath,enabled:false}]}]}:{}})+'\n'));}};
  await assert.rejects(bootstrapSkills('fixture',[],path.resolve('synthetic-empty'),{spawnProcess:()=>child}),/Ambiguous native skill path/);
  assert.deepEqual(calls,['initialize','initialized','skills/list']);
  assert.equal(initializers[0].clientInfo.version,STUDIO_VERSION);assert.equal(initializers[0].capabilities,undefined);
 }
});

test('subagent model and reasoning metadata cannot make native subagent activity available',()=>{
 const bridge=new CodexBridge({strictIsolation:true});let killed=0;const events=[];
 bridge.process={kill(){killed++;}};bridge.on('event',value=>events.push(value));
 bridge.receive({method:'item/started',params:{threadId:'synthetic',item:{type:'subAgentActivity',id:'activity',kind:'spawn',agentThreadId:'child',agentPath:'/child',model:'ungranted-model',reasoningEffort:'high'}}});
 assert.equal(killed,1);assert.equal(bridge.process,null);assert.equal(bridge.isolationReady,false);assert.equal(bridge.activeTurns.size,0);
 assert(events.length>0);assert(events.every(event=>event.method==='studio/codexDisconnected'));assert.equal(events.some(event=>event.method==='item/started'),false);
});

test('read-state notifications cannot be mistaken for execution completion or server approvals',()=>{
 const bridge=new CodexBridge({strictIsolation:true}),events=[];const process={kill(){throw Error('informational read-state must not kill bridge');}};
 bridge.process=process;bridge.activeTurns.add('active');bridge.on('event',value=>events.push(value));
 const message={method:'thread/readState/changed',params:{threadId:'other',readState:{firstUnread:null,revision:'opaque'}}};bridge.receive(message);
 assert.equal(bridge.process,process);assert.deepEqual([...bridge.activeTurns],['active']);assert.equal(bridge.requests.size,0);assert.deepEqual(events,[message]);
});
