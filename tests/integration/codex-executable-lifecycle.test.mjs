import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {inspect} from 'node:util';
import {CodexBridge,PROTOCOL_VERSION} from '../../agent/providers/codex.mjs';
import {codexRuntime} from '../../desktop/platform/codex-runtime.mjs';
import {ISOLATION_FEATURES} from '../../desktop/platform/codex-isolation.mjs';

const evidenceRoot=path.resolve('.studio/bugfix/dev7/codex-executable');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
function fixture(t,{resolveExecutable,versionError,version='0.167.0-alpha.3.2',missingFeature=false}={}){
 fs.mkdirSync(evidenceRoot,{recursive:true});
 const root=fs.mkdtempSync(path.join(evidenceRoot,'controlled-')),calls=[],children=[];
 const host={...codexRuntime,resolveExecutable,
  execute:async(executable,args)=>{calls.push({kind:'version',executable,args});if(versionError)throw versionError;return {stdout:'codex-cli '+version};},
  spawnProcess:(executable,args,options)=>{
   calls.push({kind:'spawn',executable});
   const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kills=0;child.kill=()=>{child.kills++;};
   const config={mcp_servers:{},model:'synthetic-model'};
   for(let index=0;index<args.length;index++)if(args[index]==='-c'){
    const assignment=args[++index],equals=assignment.indexOf('='),keys=assignment.slice(0,equals).split('.');let target=config;
    for(const key of keys.slice(0,-1))target=target[key]??={};target[keys.at(-1)]=JSON.parse(assignment.slice(equals+1));
   }
   const replies={initialize:{userAgent:'controlled-cli',codexHome:path.join(root,'public-home'),platformFamily:'windows',platformOs:'windows'},'config/read':{config},'skills/list':{data:[{cwd:options.cwd,skills:[]}]},'mcpServerStatus/list':{data:[],nextCursor:null}};
   child.stdin={destroyed:false,write:raw=>{const message=JSON.parse(raw);calls.push({kind:'rpc',method:message.method});if(message.id!==undefined)queueMicrotask(()=>child.stdout.write(JSON.stringify({id:message.id,result:structuredClone(replies[message.method])})+'\n'));}};
   children.push(child);return child;
  }
 };
 const bridge=new CodexBridge({host,strictIsolation:true,isolationRoot:root,isolationDependencies:{
  execute:async(executable,args)=>{calls.push({kind:args[0],executable});return {stdout:args[0]==='features'?[...ISOLATION_FEATURES.filter(key=>!missingFeature||key!=='shell_tool'),'skip_host_skill_discovery'].map(key=>key+' stable true').join('\n'):'[]'};},
  probe:async executable=>{calls.push({kind:'bootstrap',executable});return [];},
  prepareModels:directory=>{const file=path.join(directory,'public-model-ceiling.json'),bytes=Buffer.from('{"models":[]}');fs.writeFileSync(file,bytes);return {path:file,sha256:createHash('sha256').update(bytes).digest('hex'),models:['synthetic-model']};}
 }});
 t.after(()=>{bridge.close();fs.rmSync(root,{recursive:true,force:true});});
 return {bridge,calls,children};
}
function assertUnverified(f){assert.equal(f.bridge.isolationReady,false);assert.equal(f.bridge.compatibility,null);assert.equal(f.bridge.process??null,null);assert.equal(f.children.length,0);assert.equal(f.calls.some(call=>call.kind==='rpc'),false);}

test('a fresh launch resolves once and uses that exact executable for version, isolation probes and app-server',async t=>{
 const resolutions=[],requested='managed-old-cli',resolved='managed-current-cli',config={model_context_window:8192};
 const f=fixture(t,{resolveExecutable:async executable=>{resolutions.push(executable);return resolved;}});
 const result=await f.bridge.start(requested,undefined,config);
 assert.deepEqual(resolutions,[requested]);
 assert.deepEqual(f.calls.filter(call=>call.executable).map(call=>[call.kind,call.executable]),['version','features','mcp','bootstrap','spawn'].map(kind=>[kind,resolved]));
 assert.equal(result.studioCompatibility.installedVersion,'0.167.0-alpha.3.2');assert.equal(result.studioCompatibility.status,'capabilities_verified');assert.equal(f.bridge.isolationReady,true);
 assert.deepEqual(f.calls.filter(call=>call.kind==='rpc').map(call=>call.method),['initialize','initialized','config/read','skills/list','mcpServerStatus/list']);
 const child=f.bridge.process;await f.bridge.start(requested,undefined,config);assert.equal(f.bridge.process,child);assert.equal(resolutions.length,1);assert.equal(f.children.length,1);assert.deepEqual(config,{model_context_window:8192});
});

test('only a new explicit launch resolves again; an active process is left unchanged',async t=>{
 let current='managed-release-a',resolutions=0;const f=fixture(t,{resolveExecutable:async()=>{resolutions++;return current;}});
 await f.bridge.start('managed-configured');const first=f.bridge.process;current='managed-release-b';await f.bridge.start('managed-configured');assert.equal(resolutions,1);assert.equal(f.bridge.process,first);assert.equal(first.kills,0);
 f.bridge.close();await f.bridge.start('managed-configured');assert.equal(resolutions,2);assert.notEqual(f.bridge.process,first);assert.equal(first.kills,1);
 assert.deepEqual(f.calls.filter(call=>call.kind==='spawn').map(call=>call.executable),['managed-release-a','managed-release-b']);
});

test('a host without an executable resolver preserves the configured executable and strict readbacks',async t=>{
 const f=fixture(t);await f.bridge.start('explicit-custom-cli');assert(f.calls.filter(call=>call.executable).every(call=>call.executable==='explicit-custom-cli'));assert.equal(f.bridge.isolationReady,true);
});

const privateSentinel='private-path-command-and-output-sentinel';
for(const [label,details,failure]of [
 ['missing',{code:'ENOENT'},'cli_not_found'],
 ['denied',{code:'EACCES'},'cli_permission_denied'],
 ['policy denied',{code:'EPERM'},'cli_permission_denied'],
 ['timeout code',{code:'ETIMEDOUT'},'cli_version_timeout'],
 ['execFile timeout',{code:null,killed:true,signal:'SIGTERM'},'cli_version_timeout'],
 ['nonzero exit',{code:17},'cli_version_exit_failed'],
 ['generic launch failure',{code:'UNKNOWN'},'cli_version_failed']
])test('version probe '+label+' has a safe actionable classification without retry or sensitive cause',async t=>{
 const error=Object.assign(Error(privateSentinel),details,{path:privateSentinel,stdout:privateSentinel,stderr:privateSentinel}),f=fixture(t,{versionError:error});
 await assert.rejects(f.bridge.start('configured-'+privateSentinel),result=>{
  assert.equal(result.code,'STUDIO_CODEX_COMPATIBILITY_FAILED');assert.equal(result.stage,'version');assert.equal(result.failure,failure);assert.equal(result.installedVersion,'unrecognized');assert.equal(result.expectedVersion,PROTOCOL_VERSION);
  assert.match(result.message,/CLI/);assert.match(result.message,/明确重连/);assert.match(result.message,/会话和计算流程仍保留/);assert.equal(result.cause,undefined);assert.equal(inspect(result).includes(privateSentinel),false);assert.equal(JSON.stringify(result).includes(privateSentinel),false);return true;
 });
 assert.equal(f.calls.filter(call=>call.kind==='version').length,1);assertUnverified(f);
});

test('resolver failure is classified before any version, isolation or process call',async t=>{
 let resolutions=0;const f=fixture(t,{resolveExecutable:async()=>{resolutions++;throw Object.assign(Error(privateSentinel),{code:'ENOENT'});}});
 await assert.rejects(f.bridge.start('missing-managed-cli'),error=>error.stage==='version'&&error.failure==='cli_not_found'&&!inspect(error).includes(privateSentinel));
 assert.equal(resolutions,1);assert.deepEqual(f.calls,[]);assertUnverified(f);
});

test('closing while executable resolution is pending prevents any later probe or child launch',async t=>{
 const gate=deferred();let resolutions=0;const f=fixture(t,{resolveExecutable:async()=>{resolutions++;await gate.promise;return 'current-cli';}}),work=f.bridge.start('stale-cli');work.catch(()=>{});t.after(()=>gate.resolve());
 await tick();assert.equal(resolutions,1);f.bridge.close();gate.resolve();await assert.rejects(work,error=>error.stage==='lifecycle');assert.deepEqual(f.calls,[]);assertUnverified(f);
});

test('a successfully resolved new CLI still fails required isolation controls at their original gate',async t=>{
 const f=fixture(t,{resolveExecutable:async()=> 'current-cli',missingFeature:true});
 await assert.rejects(f.bridge.start('stale-cli'),error=>error.stage==='isolation_prepare'&&error.failure==='required_isolation_controls_missing'&&error.installedVersion==='0.167.0-alpha.3.2');assertUnverified(f);
});

test('unrecognized version output remains a protocol rejection and cannot establish isolation',async t=>{
 const f=fixture(t,{version:'unrecognized-'+privateSentinel});
 await assert.rejects(f.bridge.start('custom-cli'),error=>error.code==='STUDIO_CODEX_PROTOCOL_MISMATCH'&&error.installedVersion==='unrecognized'&&!inspect(error).includes(privateSentinel));assertUnverified(f);
});
