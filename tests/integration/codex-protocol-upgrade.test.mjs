import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {inspect} from 'node:util';
import {CodexBridge,PROTOCOL_VERSION,verifyProtocolVersion} from "../../agent/providers/codex.mjs";
import {STUDIO_VERSION} from "../../desktop/platform/studio-version.mjs";
import {bootstrapSkills,ISOLATION_FEATURES} from "../../desktop/platform/codex-isolation.mjs";

test('the bridge identifies the generated app-server protocol reference version',()=>{
 const version=JSON.parse(fs.readFileSync(new URL("../../desktop/generated/version.json",import.meta.url),'utf8'));
 assert.equal(version.version,PROTOCOL_VERSION);
 const client=fs.readFileSync(new URL("../../desktop/generated/ClientRequest.ts",import.meta.url),'utf8');
 for(const method of ['initialize','account/read','model/list','thread/start','thread/resume','thread/read','turn/start','turn/steer','turn/interrupt','config/read','skills/list','mcpServerStatus/list'])assert(client.includes('"method": "'+method+'"'));
});

test('older and newer valid CLI versions warn without blocking either isolation mode',()=>{
 assert.equal(verifyProtocolVersion(PROTOCOL_VERSION).versionWarning,undefined);
 for(const installed of ['0.163.0-alpha.11.2','0.166.0-alpha.5.1',PROTOCOL_VERSION+'.unverified','1.0.0+0123.build','0.0.0-0','1.2.3-alpha-beta.1']){
  for(const strictIsolation of [false,true])assert.deepEqual(verifyProtocolVersion(installed,{strictIsolation}),{baselineVersion:PROTOCOL_VERSION,installedVersion:installed,baselineMatch:false,status:'pending_capability_verification',versionWarning:{code:'STUDIO_CODEX_VERSION_DIFFERENCE',severity:'warning'}});
 }
 for(const installed of ['',null,'future-version','0.166.0\nprivate-token','x'.repeat(129),'01.2.3','1.2.3-01','1.2.3-..','1.2.3+build..metadata'])for(const strictIsolation of [false,true])assert.throws(()=>verifyProtocolVersion(installed,{strictIsolation}),error=>error.code==='STUDIO_CODEX_PROTOCOL_MISMATCH'&&!error.message.includes('private-token'));
});

function launchFixture(t,{version='0.166.0-alpha.5.1',strictIsolation=true,alter=()=>{},prepareGate,replyGate,missingFeature=false,spawnError}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-protocol-compat-')),calls=[],children=[];let bridge;
 const spawnProcess=(_executable,args,options)=>{
  if(spawnError)throw spawnError;
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kills=0;child.kill=()=>{child.kills++;};
  const config={mcp_servers:{},model:'synthetic-model'};
  for(let index=0;index<args.length;index++)if(args[index]==='-c'){
   const assignment=args[++index],equals=assignment.indexOf('='),keys=assignment.slice(0,equals).split('.');let target=config;
   for(const key of keys.slice(0,-1))target=target[key]??={};target[keys.at(-1)]=JSON.parse(assignment.slice(equals+1));
  }
  const values={initialize:{userAgent:'synthetic-cli',codexHome:path.join(root,'public-home'),platformFamily:'windows',platformOs:'windows'},'config/read':{config},'skills/list':{data:[{cwd:options.cwd,skills:[]}]},'mcpServerStatus/list':{data:[],nextCursor:null}};
  child.stdin={destroyed:false,write:raw=>{const message=JSON.parse(raw);calls.push(message.method);if(message.id!==undefined)void(async()=>{if(replyGate&&replyGate.method===message.method){replyGate.enter();await replyGate.promise;}let result=structuredClone(values[message.method]);alter(message.method,result);child.stdout.write(JSON.stringify({id:message.id,result})+'\n');})();}};
  assert.equal(args.includes('--strict-config'),false,'external host config is not a AIMatterLab-owned schema');children.push(child);return child;
 };
 bridge=new CodexBridge({strictIsolation,isolationRoot:root,launchDependencies:{execute:async()=>({stdout:'codex-cli '+version}),spawnProcess},isolationDependencies:{execute:async(_exe,args)=>{if(prepareGate){prepareGate.enter();await prepareGate.promise;}return {stdout:args[0]==='features'?[...ISOLATION_FEATURES.filter(key=>!missingFeature||key!=='shell_tool'),'skip_host_skill_discovery'].map(key=>key+' stable true').join('\n'):'[]'};},probe:async()=>[],prepareModels:directory=>{const file=path.join(directory,'public-model-ceiling.json'),bytes=Buffer.from('{"models":[]}');fs.writeFileSync(file,bytes);return {path:file,sha256:createHash('sha256').update(bytes).digest('hex'),models:['synthetic-model']};}}});
 t.after(()=>{bridge.close();fs.rmSync(root,{recursive:true,force:true});});return {bridge,calls,children};
}
function gate(method){let enter,release;return {method,entered:new Promise(resolve=>{enter=resolve;}),promise:new Promise(resolve=>{release=resolve;}),enter:()=>enter(),release:()=>release()};}
function assertCleared(bridge){assert.equal(bridge.isolationReady,false);assert.equal(bridge.info,null);assert.equal(bridge.compatibility,null);assert.equal(bridge.isolationSummary,null);}

test('a different strict CLI publishes only startup-scoped capability proof after all actual readbacks',async t=>{
 const x=launchFixture(t),events=[];x.bridge.on('event',event=>events.push(event));const info=await x.bridge.start('fixture-cli');
 assert.equal(info.studioCompatibility.status,'capabilities_verified');assert.equal(info.studioCompatibility.installedVersion,'0.166.0-alpha.5.1');assert.equal(info.studioCompatibility.baselineMatch,false);assert.match(info.studioCompatibility.scope,/no thread, model reply or scientific workflow verified/);
 assert.equal(info.studioCompatibility.versionWarning.severity,'warning');assert.equal(events[0].method,'studio/codexVersionWarning');assert.equal(events[0].params.status,'pending_capability_verification');
 assert.deepEqual(x.calls,['initialize','initialized','config/read','skills/list','mcpServerStatus/list']);assert.equal(x.bridge.isolationReady,true);
 assert.equal(x.calls.some(method=>/^(thread|turn|account)\//.test(method)),false);x.bridge.close();assertCleared(x.bridge);
});
for(const version of ['0.163.0-alpha.11.2','0.167.0-alpha.3.2'])test('non-isolated legacy bridge observes '+version+' with warning and no false capability proof',async t=>{
 const x=launchFixture(t,{version,strictIsolation:false}),info=await x.bridge.start('fixture-cli');
 assert.equal(info.studioCompatibility.installedVersion,version);assert.equal(info.studioCompatibility.versionWarning.severity,'warning');assert.equal(info.studioCompatibility.status,'version_observed');assert.equal(x.bridge.isolationReady,false);assert.deepEqual(x.calls,['initialize','initialized']);
});
test('unrelated external config fields do not block verified AIMatterLab capability isolation',async t=>{
 const x=launchFixture(t,{alter:(method,value)=>{if(method==='config/read'){value.config.computer_use={windows:{always_allowed_app_ids:['inert-public-fixture']}};assert.equal(value.config.features.computer_use,false);assert.equal(value.config.features.shell_tool,false);}}});
 assert.equal((await x.bridge.start('fixture-cli')).studioCompatibility.status,'capabilities_verified');assert.equal(x.calls.some(method=>/^(thread|turn)\//.test(method)),false);
});
for(const field of ['userAgent','codexHome','platformFamily','platformOs'])test('malformed initialize '+field+' cannot publish compatibility',async t=>{
 const x=launchFixture(t,{alter:(method,value)=>{if(method==='initialize')value[field]=field==='codexHome'?'relative-home':null;}});
 await assert.rejects(x.bridge.start('fixture-cli'),error=>error.code==='STUDIO_CODEX_COMPATIBILITY_FAILED'&&error.stage==='initialize');assertCleared(x.bridge);assert.equal(x.children[0].kills,1);assert.deepEqual(x.calls,['initialize']);
});
for(const problem of ['missing_feature','effective_config','native_skill','ambient_mcp','model_ceiling'])test('new CLI fails closed at actual required gate '+problem,async t=>{
 const x=launchFixture(t,{missingFeature:problem==='missing_feature',alter:(method,value)=>{
  if(method==='config/read'&&problem==='effective_config')value.config.features.shell_tool=true;
  if(method==='config/read'&&problem==='model_ceiling')value.config.model_catalog_json=path.resolve('unverified-models.json');
  if(method==='skills/list'&&problem==='native_skill')value.data[0].skills=[{path:path.resolve('ungranted/SKILL.md'),enabled:true}];
  if(method==='mcpServerStatus/list'&&problem==='ambient_mcp')value.data=[{name:'outside',tools:{ungranted:{}}}];
 }});
 await assert.rejects(x.bridge.start('fixture-cli'),error=>error.code==='STUDIO_CODEX_COMPATIBILITY_FAILED'&&error.stage===(problem==='missing_feature'?'isolation_prepare':'effective_isolation')&&error.installedVersion==='0.166.0-alpha.5.1');assertCleared(x.bridge);
});
test('cancel during preparation cannot spawn a child or publish stale compatibility',async t=>{
 const pending=gate(),x=launchFixture(t,{prepareGate:pending}),work=x.bridge.start('fixture-cli');await pending.entered;x.bridge.close();pending.release();await assert.rejects(work,error=>error.stage==='lifecycle');assert.equal(x.children.length,0);assertCleared(x.bridge);
});
for(const method of ['initialize','mcpServerStatus/list'])test('cancel during '+method+' cannot publish a late handshake',async t=>{
 const pending=gate(method),x=launchFixture(t,{replyGate:pending}),work=x.bridge.start('fixture-cli');await pending.entered;assert.equal(x.bridge.compatibility,null);x.bridge.close();pending.release();await assert.rejects(work,/会话和计算流程仍保留/);assertCleared(x.bridge);
});
test('old cancelled verification cannot clear a newer owner capability receipt',async t=>{
 const pending=gate('mcpServerStatus/list'),x=launchFixture(t,{replyGate:pending}),work=x.bridge.start('fixture-cli');await pending.entered;x.bridge.close();const newer={kill(){throw Error('newer owner must survive');}};x.bridge.process=newer;x.bridge.info={newer:true};x.bridge.compatibility={newer:true};x.bridge.isolationReady=true;pending.release();await assert.rejects(work);assert.equal(x.bridge.process,newer);assert.deepEqual(x.bridge.compatibility,{newer:true});x.bridge.process=null;
});
for(const event of ['exit','error','malformed'])test('transport '+event+' clears a previously verified receipt',async t=>{
 const x=launchFixture(t);await x.bridge.start('fixture-cli');const child=x.children[0];if(event==='exit')child.emit('exit',1,null);else if(event==='error')child.emit('error',Error('private-command private-token'));else child.stdout.write('not-json\n');assertCleared(x.bridge);assert.equal(x.bridge.process,null);
});
for(const envelope of [null,[],true,'text',42,{method:3},{id:{}},{id:1,result:{},error:{}}])test('valid JSON with invalid RPC envelope closes safely '+JSON.stringify(envelope),async t=>{
 const x=launchFixture(t);await x.bridge.start('fixture-cli');assert.doesNotThrow(()=>x.children[0].stdout.write(JSON.stringify(envelope)+'\n'));assertCleared(x.bridge);assert.equal(x.bridge.process,null);
});
test('direct invalid receive also clears capability state without an uncaught exception',async t=>{
 const x=launchFixture(t);await x.bridge.start('fixture-cli');assert.doesNotThrow(()=>x.bridge.receive(null));assertCleared(x.bridge);assert.equal(x.bridge.process,null);
});
test('spawn failure diagnostics identify the stage without retaining raw sensitive cause',async t=>{
 const secret='private-token-and-command-sentinel',x=launchFixture(t,{spawnError:Error(secret)});await assert.rejects(x.bridge.start('fixture-cli'),error=>{assert.equal(error.stage,'spawn');assert.equal(error.cause,undefined);assert.equal(inspect(error).includes(secret),false);assert.equal(JSON.stringify(error).includes(secret),false);return error.code==='STUDIO_CODEX_COMPATIBILITY_FAILED';});assertCleared(x.bridge);
});
test('additive notification fields remain compatible after structural envelope validation',async t=>{
 const x=launchFixture(t),events=[];await x.bridge.start('fixture-cli');x.bridge.on('event',value=>events.push(value));const event={method:'thread/readState/changed',params:{threadId:'synthetic',readState:{revision:'future'}},future:{opaque:true}};x.children[0].stdout.write(JSON.stringify(event)+'\n');assert.deepEqual(events,[event]);assert.equal(x.bridge.isolationReady,true);
});

test('legacy native skill path strings do not authorize relative or plugin paths in AIMatterLab isolation',async()=>{
 for(const skillPath of ['relative/SKILL.md','plugin://unscoped/skills/SKILL.md']){
  const calls=[],initializers=[],child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  child.stdin={write:value=>{const m=JSON.parse(value);calls.push(m.method);if(m.method==='initialize')initializers.push(m.params);if(m.id)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:m.id,result:m.method==='skills/list'?{data:[{skills:[{path:skillPath,enabled:false}]}]}:{}})+'\n'));}};
  await assert.rejects(bootstrapSkills('fixture',[],path.resolve('synthetic-empty'),{spawnProcess:(_exe,args)=>{assert.equal(args.includes('--strict-config'),false);return child;}}),/Ambiguous native skill path/);
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
