import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {createCliRuntimeManager,migrateBundledCliPaths} from '../../desktop/platform/cli-runtimes.mjs';

const integrity=bytes=>'sha512-'+createHash('sha512').update(bytes).digest('base64');
function fixture(t,overrides={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'studio-cli-manager-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const bytes=Buffer.from('synthetic authenticated archive fixture; never executed'),calls=[],events=[],settings={kimiPath:'',qwenPath:''};
 const lock={schema_version:1,providers:{},packages:{}};
 for(const [provider,name,entry,version]of [['kimi','@moonshot-ai/kimi-code','dist/main.mjs','2.1.1'],['qwen','@qwen-code/qwen-code','cli-entry.js','0.24.7']]){
  lock.providers[provider]={package:name,entry,version,packages:[name]};lock.packages[name]={name,version,dependencies:{},integrity:integrity(bytes),url:'https://registry.npmjs.org/'+name+'/-/'+name.split('/').at(-1)+'-'+version+'.tgz'};
 }
 const write=(name,value)=>{const file=path.join(directory,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));return file;};
 const versions=new Map();
 const spawnCli=(file,args,options)=>{
  calls.push({kind:'spawn',file,args,options});const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.stdin.destroyed=false;
  child.stdin.write=line=>{const value=JSON.parse(line);calls.push({kind:'acp',provider:options.provider,method:value.method});queueMicrotask(()=>child.stdout.emit('data',Buffer.from(JSON.stringify({jsonrpc:'2.0',id:value.id,result:{protocolVersion:1,agentInfo:{version:lock.providers[options.provider].version}}})+'\n')));};
  child.kill=()=>{child.emit('exit',null);child.emit('close',null);};
  if(args.includes('--version'))queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(versions.get(file)||lock.providers[options.provider].version));child.emit('exit',0);child.emit('close',0);});
  return child;
 };
 const fetchApi=async(url,options)=>{calls.push({kind:'fetch',url,options});return new Response(bytes,{headers:{'content-length':String(bytes.length)}});};
 const extractArchive=async({directory,signal})=>{signal.throwIfAborted();const provider=directory.includes('kimi-code')?'kimi':'qwen',record=lock.providers[provider];fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name:record.package,version:record.version,bin:{[provider]:record.entry}}));fs.mkdirSync(path.dirname(path.join(directory,record.entry)),{recursive:true});fs.writeFileSync(path.join(directory,record.entry),'inert fixture only');};
 const options={root:path.join(directory,'cache'),settings:()=>settings,env:{PATH:''},publish:event=>events.push(event),lock,spawnCli,fetchApi,extractArchive,platform:'win32',arch:'x64',...overrides};
 const manager=createCliRuntimeManager(options);
 return {directory,write,settings,bytes,calls,events,versions,lock,options,manager};
}

test('missing inspection and resolution do not download or install a provider',async t=>{
 const f=fixture(t);assert.equal((await f.manager.inspect({provider:'kimi'})).status,'missing');
 await assert.rejects(f.manager.resolve('kimi'),error=>error.code==='CLI_RUNTIME_MISSING'&&error.readiness.provider==='kimi');
 assert.equal(f.calls.length,0);assert.equal(fs.existsSync(f.options.root),false);
});

test('manual, environment and PATH candidates use exact-version bounded probes without shell wrappers',async t=>{
 const f=fixture(t),manual=f.write('manual/kimi.mjs','fixture'),environment=f.write('environment/kimi.exe','fixture'),bin=path.join(f.directory,'bin'),local=f.write('bin/kimi.exe','fixture');
 f.settings.kimiPath=manual;
 let manager=createCliRuntimeManager({...f.options,env:{STUDIO_KIMI_CLI:environment,PATH:bin}});
 assert.equal((await manager.inspect({provider:'kimi'})).executable,manual);assert.equal(f.calls.filter(v=>v.kind==='spawn').length,1);
 assert.equal((await manager.inspect({provider:'kimi'})).source,'manual');assert.equal(f.calls.length,1,'Unchanged entry reuses the version probe');
 f.settings.kimiPath='';manager=createCliRuntimeManager({...f.options,env:{STUDIO_KIMI_CLI:environment,PATH:bin}});assert.equal((await manager.inspect({provider:'kimi'})).source,'environment');
 manager=createCliRuntimeManager({...f.options,env:{PATH:bin}});assert.equal((await manager.inspect({provider:'kimi'})).executable,local);
 for(const call of f.calls)assert.deepEqual(call.args,['--version']);
});

test('incompatible PATH candidates are skipped until a compatible local CLI is found',async t=>{
 const f=fixture(t),old=f.write('old/qwen.exe','fixture'),current=f.write('current/qwen.exe','fixture');f.versions.set(old,'0.1.0');
 const manager=createCliRuntimeManager({...f.options,env:{PATH:path.dirname(old)+';'+path.dirname(current)}}),result=await manager.inspect({provider:'qwen'});
 assert.equal(result.status,'ready');assert.equal(result.executable,current);assert.equal(f.calls.filter(v=>v.kind==='fetch').length,0);
});

test('Windows quoted PATH and case-insensitive PATHEXT prioritize only safely supported entries',{skip:process.platform!=='win32'},async t=>{
 const f=fixture(t),folder=path.join(f.directory,'Quoted Bin'),exe=f.write('Quoted Bin/qwen.exe','inert native fixture'),js=f.write('Quoted Bin/qwen.js','inert JavaScript fixture');
 f.write('Quoted Bin/qwen.vbs','must never run');
 const manager=createCliRuntimeManager({...f.options,env:{pAtH:'"'+folder.toUpperCase()+'"',pAtHeXt:'.VBS;.jS;.eXe;.JS'}}),result=await manager.inspect({provider:'qwen'});
 assert.equal(result.status,'ready');assert.equal(result.executable.toLowerCase(),js.toLowerCase());assert.equal(f.calls.filter(call=>call.kind==='spawn').length,1);assert(!f.calls.some(call=>call.file===exe||call.file?.endsWith('.vbs')));
});

test('Windows PATHEXT omissions retain safe fallback discovery and environment names ignore case',{skip:process.platform!=='win32'},async t=>{
 const f=fixture(t),file=f.write('Fallback Bin/kimi.cjs','inert CommonJS fixture');
 let manager=createCliRuntimeManager({...f.options,env:{path:' "'+path.dirname(file)+'" ',pathext:'.VBS;.COM'}});assert.equal((await manager.inspect({provider:'kimi'})).executable,file);
 manager=createCliRuntimeManager({...f.options,env:{studio_kimi_cli:file.toUpperCase(),path:''}});const result=await manager.inspect({provider:'kimi'});assert.equal(result.source,'environment');assert.equal(result.executable.toLowerCase(),file.toLowerCase());
});

test('npm and pnpm launchers resolve only known package layout and never execute the launcher text',async t=>{
 for(const prefix of ['global','project/node_modules/.bin']){
  const f=fixture(t),shim=f.write(prefix+'/kimi.cmd','@echo MALICIOUS_WRAPPER_MUST_NEVER_RUN'),folder=path.dirname(shim),base=prefix==='global'?path.join(folder,'node_modules/@moonshot-ai/kimi-code'):path.join(folder,'../@moonshot-ai/kimi-code');
  fs.mkdirSync(path.join(base,'dist'),{recursive:true});fs.writeFileSync(path.join(base,'package.json'),JSON.stringify({name:'@moonshot-ai/kimi-code',version:'2.1.1',bin:{kimi:'dist/main.mjs'}}));fs.writeFileSync(path.join(base,'dist/main.mjs'),'inert fixture');
  const result=await f.manager.inspect({provider:'kimi',executable:shim});assert.equal(result.status,'ready');assert.equal(result.executable,fs.realpathSync(path.join(base,'dist/main.mjs')));assert(!f.calls.some(call=>call.file===shim));
 }
});

test('unrecognized launcher cannot redirect to an arbitrary script by embedding shell commands',async t=>{
 const f=fixture(t),shim=f.write('untrusted/qwen.cmd','node "C:\\unrelated\\program.js" %*');
 assert.equal((await f.manager.inspect({provider:'qwen',executable:shim})).status,'invalid');assert.equal(f.calls.length,0);
});

test('explicit download verifies, publishes, reuses offline and preserves a configured incompatible CLI',async t=>{
 const f=fixture(t),manual=f.write('local/kimi.mjs','fixture');f.settings.kimiPath=manual;f.versions.set(manual,'9.9.9');
 assert.equal((await f.manager.inspect({provider:'kimi'})).status,'incompatible');
 const installed=await f.manager.install({provider:'kimi',requestId:'install-1'});assert.equal(installed.status,'ready');assert.equal(f.settings.kimiPath,manual);
 assert.deepEqual(f.calls.filter(call=>call.kind==='acp').map(call=>call.method),['initialize'],'Installation may initialize ACP but never access an account or model');
 assert.equal((await f.manager.inspect({provider:'kimi'})).source,'managed');
 assert(f.events.some(value=>value.phase==='downloading'));assert(f.events.some(value=>value.phase==='completed'));
 assert(f.events.every(value=>value.provider==='kimi'&&value.requestId==='install-1'&&Number.isFinite(value.receivedBytes)&&Number.isInteger(value.packageCount)));
 const offline=createCliRuntimeManager({...f.options,fetchApi:()=>{throw Error('Must not fetch cached package');}});assert.equal((await offline.resolve('kimi')),installed.executable);
 f.versions.set(manual,'2.1.1');fs.appendFileSync(manual,'changed');assert.equal((await offline.inspect({provider:'kimi'})).source,'manual');
});

test('archive integrity failure never extracts or publishes a runtime and leaves prior state untouched',async t=>{
 const f=fixture(t,{fetchApi:async()=>new Response('tampered fixture')});let extracted=false;
 const manager=createCliRuntimeManager({...f.options,extractArchive:async()=>{extracted=true;}});
 await assert.rejects(manager.install({provider:'qwen',requestId:'bad-hash'}),/integrity_failed/);assert.equal(extracted,false);
 assert.deepEqual(fs.readdirSync(path.join(f.options.root,'staging')),[]);assert.equal(fs.existsSync(path.join(f.options.root,'selections/qwen.json')),false);
 assert.equal(f.events.at(-1).phase,'failed');
});

test('cancel only matches active request, rejects cleanly, and permits an explicit retry',async t=>{
 const f=fixture(t);let began;
 const started=new Promise(resolve=>{began=resolve;});
 const manager=createCliRuntimeManager({...f.options,fetchApi:async(url,{signal})=>{began();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
 const pending=manager.install({provider:'qwen',requestId:'owned'});await started;
 assert.deepEqual(manager.cancel({provider:'qwen',requestId:'stale'}),{cancelled:false});assert.deepEqual(manager.cancel({provider:'qwen',requestId:'owned'}),{cancelled:true});
 await assert.rejects(pending,error=>error.code==='CLI_RUNTIME_CANCELLED');assert.equal(f.events.at(-1).phase,'cancelled');
 assert.equal((await f.manager.install({provider:'qwen',requestId:'retry'})).status,'ready');
});

test('corrupt cached runtime is refused and explicit reinstall publishes a new immutable generation',async t=>{
 const f=fixture(t),installed=await f.manager.install({provider:'qwen',requestId:'first'});fs.appendFileSync(installed.executable,'corrupted');
 assert.equal((await f.manager.inspect({provider:'qwen'})).status,'failed');
 const repaired=await f.manager.install({provider:'qwen',requestId:'repair'});assert.equal(repaired.status,'ready');assert.notEqual(repaired.executable,installed.executable);assert(fs.readFileSync(installed.executable,'utf8').includes('corrupted'));
});

test('only missing historical bundled defaults migrate, preserving all live and other manual paths',t=>{
 const f=fixture(t),live=f.write('resources/agent-runtimes/node_modules/@moonshot-ai/kimi-code/dist/main.mjs','live'),missing=path.join(f.directory,'old/resources/agent-runtimes/node_modules/@qwen-code/qwen-code/cli-entry.js');
 const current={kimiPath:live,qwenPath:missing,credential:'sentinel'},next=migrateBundledCliPaths(current);assert.equal(next.kimiPath,live);assert.equal(next.qwenPath,'');assert.equal(next.credential,'sentinel');assert.equal(current.qwenPath,missing);
 const manual={kimiPath:path.join(f.directory,'manual/nonexistent.mjs')};assert.strictEqual(migrateBundledCliPaths(manual),manual);
});

test('manager rejects arbitrary providers, malformed requests and remote lock sources',async t=>{
 const f=fixture(t);await assert.rejects(f.manager.inspect({provider:'codex'}),/invalid_provider/);await assert.rejects(f.manager.inspect({provider:'kimi',url:'https://example.com'}),/invalid_request/);await assert.rejects(f.manager.install({provider:'kimi',requestId:'../escape'}),/invalid_request/);
 f.lock.packages['@moonshot-ai/kimi-code'].url='https://example.com/runtime.tgz';assert.throws(()=>createCliRuntimeManager(f.options),/invalid_lock/);
});

test('a stalled local probe times out without starting an installer or blocking the event loop',async t=>{
 const f=fixture(t),file=f.write('stalled/kimi.exe','fixture');let killed=false;
 const manager=createCliRuntimeManager({...f.options,probeTimeoutMs:15,spawnCli:()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.kill=()=>{killed=true;child.emit('exit',null);};return child;}});
 const pending=manager.inspect({provider:'kimi',executable:file});let responsive=false;await new Promise(resolve=>setTimeout(()=>{responsive=true;resolve();},1));
 assert(responsive);assert.equal((await pending).status,'failed');assert(killed);assert.equal(f.calls.filter(v=>v.kind==='fetch').length,0);
});

test('concurrent same-request installs join one download, and another request is rejected',async t=>{
 const f=fixture(t);let started,finish,downloads=0;const began=new Promise(resolve=>{started=resolve;});
 const manager=createCliRuntimeManager({...f.options,fetchApi:async()=>{downloads++;started();return new Promise(resolve=>{finish=()=>resolve(new Response(f.bytes));});}});
 const first=manager.install({provider:'qwen',requestId:'same'}),joined=manager.install({provider:'qwen',requestId:'same'});await began;
 await assert.rejects(manager.install({provider:'qwen',requestId:'other'}),/install_in_progress/);finish();
 assert.equal((await first).executable,(await joined).executable);assert.equal(downloads,1);
});

test('cancelling the version-check phase terminates its owned child and publishes no runtime',async t=>{
 const f=fixture(t);let began,killed=false;const started=new Promise(resolve=>{began=resolve;});
 const manager=createCliRuntimeManager({...f.options,spawnCli:()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.kill=()=>{killed=true;child.emit('exit',null);};began();return child;}});
 const pending=manager.install({provider:'qwen',requestId:'checking'});await started;assert.deepEqual(manager.cancel({provider:'qwen',requestId:'checking'}),{cancelled:true});
 await assert.rejects(pending,error=>error.code==='CLI_RUNTIME_CANCELLED');assert(killed);assert.equal(fs.existsSync(path.join(f.options.root,'selections/qwen.json')),false);
});

for(const [provider,reply,pattern]of [
 ['qwen',{error:{code:-32601,message:'initialize API is absent'}},/initialize API is absent/],
 ['qwen',{result:{protocolVersion:2}},/Unsupported ACP protocol/],
 ['kimi',{result:{protocolVersion:1,agentInfo:{version:'0.0.0'}}},/Kimi CLI version mismatch/],
])test('install refuses unavailable or incompatible ACP API for '+provider+' '+JSON.stringify(reply),async t=>{
 const f=fixture(t);const manager=createCliRuntimeManager({...f.options,spawnCli:(file,args,options)=>{
  const child=f.options.spawnCli(file,args,options);if(!args.includes('--version'))child.stdin.write=line=>{const value=JSON.parse(line);queueMicrotask(()=>child.stdout.emit('data',Buffer.from(JSON.stringify({jsonrpc:'2.0',id:value.id,...reply})+'\n')));};return child;
 }});
 await assert.rejects(manager.install({provider,requestId:'bad-interface'}),pattern);
 assert.equal(fs.existsSync(path.join(f.options.root,'selections',provider+'.json')),false);assert.equal(f.events.at(-1).phase,'failed');assert.deepEqual(fs.readdirSync(path.join(f.options.root,'staging')),[]);
});

test('ACP initialize timeout closes its child and never publishes a ready runtime',async t=>{
 const f=fixture(t);let killed=0;
 const manager=createCliRuntimeManager({...f.options,interfaceTimeoutMs:20,spawnCli:(file,args,options)=>{
  const child=f.options.spawnCli(file,args,options);if(!args.includes('--version')){child.stdin.write=()=>{};const kill=child.kill;child.kill=()=>{killed++;kill();queueMicrotask(()=>child.emit('error',Error('late owned-child error')));};}return child;
 }});
 await assert.rejects(manager.install({provider:'qwen',requestId:'timeout'}),/ACP initialization timed out/);assert(killed);assert.equal(fs.existsSync(path.join(f.options.root,'selections/qwen.json')),false);
});

test('cancelling during actual ACP initialize kills and drains the owned process',async t=>{
 const f=fixture(t);let begin,killed=0;const started=new Promise(resolve=>{begin=resolve;});
 const manager=createCliRuntimeManager({...f.options,spawnCli:(file,args,options)=>{
  const child=f.options.spawnCli(file,args,options);if(!args.includes('--version')){child.stdin.write=()=>begin();const kill=child.kill;child.kill=()=>{killed++;kill();};}return child;
 }});
 const pending=manager.install({provider:'kimi',requestId:'initializing'});await started;assert.deepEqual(manager.cancel({provider:'kimi',requestId:'initializing'}),{cancelled:true});await assert.rejects(pending,error=>error.code==='CLI_RUNTIME_CANCELLED');assert(killed);assert.equal(f.events.at(-1).phase,'cancelled');assert.equal(fs.existsSync(path.join(f.options.root,'selections/kimi.json')),false);
});

test('Qwen install requires a physical core PTY stage, not linked package-manager directories',async t=>{
 const f=fixture(t),core=path.join(f.directory,'physical-core'),linked=path.join(f.directory,'linked-checkout');
 for(const name of ['@lydell/node-pty','@lydell/node-pty-win32-x64']){
  const base=path.join(core,'node_modules',name);fs.mkdirSync(base,{recursive:true});fs.writeFileSync(path.join(base,'package.json'),JSON.stringify({name,version:'1.2.0-beta.10'}));fs.writeFileSync(path.join(base,'fixture.js'),'inert physical core fixture; never imported');
  const target=path.join(linked,'node_modules',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.symlinkSync(base,target,process.platform==='win32'?'junction':'dir');
 }
 const unsafe=createCliRuntimeManager({...f.options,dependencyRoot:linked});await assert.rejects(unsafe.install({provider:'qwen',requestId:'linked-core'}),/unsafe_directory/);
 assert.equal(fs.existsSync(path.join(f.options.root,'selections/qwen.json')),false);
 const safe=createCliRuntimeManager({...f.options,dependencyRoot:core}),ready=await safe.install({provider:'qwen',requestId:'physical-core'});
 assert.equal(ready.status,'ready');const runtime=path.dirname(path.dirname(path.dirname(path.dirname(ready.executable))));
 assert.equal(JSON.parse(fs.readFileSync(path.join(runtime,'node_modules/@lydell/node-pty/package.json'),'utf8')).version,'1.2.0-beta.10');
});
