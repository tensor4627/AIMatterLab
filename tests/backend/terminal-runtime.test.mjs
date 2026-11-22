import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareTerminalRuntime,probeWindowsTerminalRuntimeExecution} from '../../backend/main/compute/terminal-runtime.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-terminal-runtime-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),runtimeRoot=path.join(root,'owned','runtimes'),dependencyRoot=path.join(source,'resources','agent-runtimes'),native='@lydell/node-pty-win32-x64';
 const write=(relative,text)=>{const file=path.join(source,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof text==='string'?text:JSON.stringify(text));return file;};
 const nodeExecutable=write('AIMatterLab.exe','inert executable fixture; never launched');
 write('ffmpeg.dll','inert runtime support');write('icudtl.dat','inert ICU support');write('LICENSE.electron.txt','fixture license');
 const servicePath=write('resources/terminal-service/broker.mjs',"import './session.mjs';");
 write('resources/terminal-service/session.mjs','export const fixture=true;');
 write('resources/agent-runtimes/node_modules/@lydell/node-pty/package.json',{name:'@lydell/node-pty',version:'1.2.0-beta.10',exports:'./index.js',optionalDependencies:{[native]:'1.2.0-beta.10'}});
 write('resources/agent-runtimes/node_modules/@lydell/node-pty/index.js',`module.exports=require('${native}');`);
 write('resources/agent-runtimes/node_modules/'+native+'/package.json',{name:native,version:'1.2.0-beta.10',exports:'./lib/index.js'});
 const nativeFiles=['lib/index.js','lib/windowsTerminal.js','lib/windowsPtyAgent.js','lib/windowsConoutConnection.js','lib/worker/conoutSocketWorker.js','lib/conpty_console_list_agent.js','prebuilds/win32-x64/conpty.node','prebuilds/win32-x64/conpty_console_list.node','prebuilds/win32-x64/conpty/conpty.dll','prebuilds/win32-x64/conpty/OpenConsole.exe'];
 for(const name of nativeFiles)write('resources/agent-runtimes/node_modules/'+native+'/'+name,'inert '+name);
 write('.config/broker.bin','private fixture must never be copied');write('resources/agent-runtimes/.env','fixture private key; never copied');
 const probes=[],options={runtimeRoot,nodeExecutable,servicePath,dependencyRoot,platform:'win32',arch:'x64',probeExecution:async file=>{probes.push(file);return {integrity:'medium_or_higher'};}};
 return {root,source,write,options,native,nativeFiles,probes,prepare:()=>prepareTerminalRuntime(options)};
}

function files(root){
 const names=[];function visit(folder,prefix=''){for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const name=prefix?prefix+'/'+entry.name:entry.name;if(entry.isDirectory())visit(path.join(folder,entry.name),name);else names.push(name);}}visit(root);return names.sort();
}

test('stable runtime includes exact executable, support, broker and lazy PTY closure without credentials',async t=>{
 const f=fixture(t),result=await f.prepare();
 assert.match(result.receipt.id,/^[a-f0-9]{64}$/);
 assert.equal(path.basename(result.directory),result.receipt.id);
 assert.equal(fs.readFileSync(result.nodeExecutable,'utf8'),'inert executable fixture; never launched');
 for(const name of f.nativeFiles)assert(fs.existsSync(path.join(result.dependencyRoot,'node_modules',f.native,name)),name);
 assert.equal(fs.readFileSync(path.join(path.dirname(result.nodeExecutable),'icudtl.dat'),'utf8'),'inert ICU support');
 assert.equal(fs.readFileSync(path.join(path.dirname(result.servicePath),'session.mjs'),'utf8'),'export const fixture=true;');
 assert(!files(result.directory).some(name=>/broker\.bin|\.config|\.env/.test(name)));
 const manifest=JSON.parse(fs.readFileSync(path.join(result.directory,'runtime.json'),'utf8'));
 assert.equal(manifest.receipt.files.length,result.receipt.files);
 for(const entry of manifest.receipt.files){const bytes=fs.readFileSync(path.join(result.directory,entry.path));assert.equal(bytes.length,entry.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);}
 assert.equal(JSON.stringify(manifest).includes(f.source),false,'Manifest never retains ephemeral source paths');
});

test('published resources remain readable after the entire owned source copy is removed',async t=>{
 const f=fixture(t),result=await f.prepare(),before=files(result.directory).map(name=>[name,fs.readFileSync(path.join(result.directory,name))]);
 fs.rmSync(f.source,{recursive:true,force:true});
 for(const [name,bytes]of before)assert.deepEqual(fs.readFileSync(path.join(result.directory,name)),bytes);
});

test('unchanged and concurrent preparation reuse one verified generation',async t=>{
 const f=fixture(t),results=await Promise.all([f.prepare(),f.prepare()]);
 assert.deepEqual(results[0],results[1]);assert.deepEqual(await f.prepare(),results[0]);
 assert.deepEqual(fs.readdirSync(f.options.runtimeRoot),[results[0].receipt.id]);
});

test('updated source creates a new generation and preserves any older running runtime',async t=>{
 const f=fixture(t),old=await f.prepare();
 f.write('resources/terminal-service/session.mjs','export const fixture="new";');
 const current=await f.prepare();assert.notEqual(current.receipt.id,old.receipt.id);
 assert.equal(fs.readFileSync(path.join(path.dirname(old.servicePath),'session.mjs'),'utf8'),'export const fixture=true;');
 assert.equal(fs.readdirSync(f.options.runtimeRoot).length,2);
});

test('corrupt existing runtime is rejected without overwriting live files',async t=>{
 const f=fixture(t),result=await f.prepare();
 fs.writeFileSync(result.servicePath,'tampered fixture');
 await assert.rejects(f.prepare,/terminal_runtime_integrity_failed/);
 assert.equal(fs.readFileSync(result.servicePath,'utf8'),'tampered fixture');
 assert.equal(fs.readdirSync(f.options.runtimeRoot).length,1);
});

test('unexpected files cannot be added to an existing verified closure',async t=>{
 const f=fixture(t),result=await f.prepare();fs.writeFileSync(path.join(result.directory,'unexpected.txt'),'extra');
 await assert.rejects(f.prepare,/terminal_runtime_integrity_failed/);
});

test('missing lazy worker and mismatched native package fail before runtime publication',async t=>{
 const f=fixture(t),name='resources/agent-runtimes/node_modules/'+f.native+'/lib/worker/conoutSocketWorker.js';
 fs.unlinkSync(path.join(f.source,name));await assert.rejects(f.prepare,/terminal_runtime_invalid_source/);
 assert.equal(fs.existsSync(f.options.runtimeRoot),false);
 f.write(name,'worker fixture');f.write('resources/agent-runtimes/node_modules/'+f.native+'/package.json',{name:f.native,version:'wrong',exports:'./lib/index.js'});
 await assert.rejects(f.prepare,/terminal_runtime_invalid_source/);assert.equal(fs.existsSync(f.options.runtimeRoot),false);
});

test('source mutation during copying is rejected and leaves no partial published generation',async t=>{
 const f=fixture(t),original=fs.promises.copyFile;let changed=false;
 fs.promises.copyFile=async(...args)=>{const result=await original(...args);if(!changed){changed=true;f.write('resources/terminal-service/session.mjs','changed during copy');}return result;};
 try{await assert.rejects(f.prepare,/terminal_runtime_source_changed/);}finally{fs.promises.copyFile=original;}
 assert.deepEqual(fs.readdirSync(f.options.runtimeRoot),[]);
});

test('linked source inputs, package contents and destination ancestors are refused',async t=>{
 const f=fixture(t),linked=path.join(f.root,'linked-source');fs.symlinkSync(f.source,linked,process.platform==='win32'?'junction':'dir');
 await assert.rejects(()=>prepareTerminalRuntime({...f.options,nodeExecutable:path.join(linked,'AIMatterLab.exe')}),/terminal_runtime_invalid_source/);
 const external=path.join(f.root,'external');fs.mkdirSync(external);
 fs.symlinkSync(external,path.join(f.options.dependencyRoot,'node_modules',f.native,'linked'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(f.prepare,/terminal_runtime_invalid_source/);
 fs.rmSync(path.join(f.options.dependencyRoot,'node_modules',f.native,'linked'));
 const destination=path.join(f.root,'linked-destination');fs.symlinkSync(external,destination,process.platform==='win32'?'junction':'dir');
 await assert.rejects(()=>prepareTerminalRuntime({...f.options,runtimeRoot:path.join(destination,'not-created')}),/terminal_runtime_invalid_source/);
 assert.equal(fs.existsSync(path.join(external,'not-created')),false);
});

test('platform and absolute source requirements fail closed without invoking any runtime',async t=>{
 const f=fixture(t);
 await assert.rejects(()=>prepareTerminalRuntime({...f.options,nodeExecutable:'relative.exe'}),/terminal_runtime_invalid_source/);
 await assert.rejects(()=>prepareTerminalRuntime({...f.options,platform:'linux'}),/terminal_runtime_platform_unsupported/);
 assert.equal(fs.existsSync(f.options.runtimeRoot),false);
});


test('runtime checks the source and copied executable actual integrity before publication without changing permissions',async t=>{
 const f=fixture(t),result=await f.prepare();assert.equal(f.probes[0],f.options.nodeExecutable);assert(f.probes.some(file=>file.includes('staging-')&&path.basename(file)==='AIMatterLab.exe'));assert.equal(fs.readFileSync(result.nodeExecutable,'utf8'),'inert executable fixture; never launched');
});
test('a Low source execution context fails before creating an execution cache',async t=>{
 const f=fixture(t);f.options.probeExecution=async()=>{throw Error('terminal_runtime_low_integrity');};await assert.rejects(f.prepare,/terminal_runtime_low_integrity/);assert.equal(fs.existsSync(f.options.runtimeRoot),false);
});
test('a copied executable inheriting Low integrity is never published or silently elevated',async t=>{
 const f=fixture(t);f.options.probeExecution=async file=>{if(file!==f.options.nodeExecutable)throw Error('terminal_runtime_low_integrity');};await assert.rejects(f.prepare,/terminal_runtime_low_integrity/);assert.deepEqual(fs.readdirSync(f.options.runtimeRoot),[]);
});
test('an existing Low runtime is refused without changing its files or ACL',async t=>{
 const f=fixture(t),result=await f.prepare(),before=fs.readFileSync(result.nodeExecutable);f.options.probeExecution=async file=>{if(file!==f.options.nodeExecutable)throw Error('terminal_runtime_low_integrity');};await assert.rejects(f.prepare,/terminal_runtime_low_integrity/);assert.deepEqual(fs.readFileSync(result.nodeExecutable),before);assert.equal(fs.readdirSync(f.options.runtimeRoot).length,1);
});
test('execution probe exposes only a fixed integrity receipt and strips injected environment flags and secrets',async()=>{
 let called;const result=await probeWindowsTerminalRuntimeExecution(path.resolve('fixture.exe'),{env:{SystemRoot:'C:\\Windows',PATH:'fixture',NODE_OPTIONS:'PRIVATE_INJECTED_FLAGS',API_KEY:'PRIVATE_SECRET'},run:async(...args)=>{called=args;return {stdout:JSON.stringify({schemaVersion:1,integrityRid:8192})};}});assert.deepEqual(result,{integrity:'medium_or_higher'});assert.equal(called[1][0],'-e');assert(called[1][1].includes('whoami.exe'));assert(called[1][1].includes('S-1-16-'));assert(!JSON.stringify(called).includes('PRIVATE'));assert.equal(called[2].env.ELECTRON_RUN_AS_NODE,'1');assert.equal(called[2].windowsHide,true);
 for(const integrityRid of [0,4096])await assert.rejects(probeWindowsTerminalRuntimeExecution(path.resolve('fixture.exe'),{run:async()=>({stdout:JSON.stringify({schemaVersion:1,integrityRid})})}),/terminal_runtime_low_integrity/);
 await assert.rejects(probeWindowsTerminalRuntimeExecution(path.resolve('fixture.exe'),{run:async()=>({stdout:'unrecognized output'})}),/terminal_runtime_execution_unavailable/);
});
import {pathToFileURL} from 'node:url';
test('published real session can load delta and location helpers after the owned source copy is removed',async t=>{
 const f=fixture(t),directory=new URL('../../desktop/platform/terminal-service/',import.meta.url);
 for(const name of ['session.mjs','response-codec.mjs','service-launch.mjs','worker-delta.mjs','ssh-service-locations.mjs','ssh-connection.mjs','shared-shell-service.mjs','native-ssh.mjs','native-ssh-relay.py','managed-ssh-shells.mjs','workspace-probe.mjs','workspace-command.mjs'])f.write('resources/terminal-service/'+name,fs.readFileSync(new URL(name,directory),'utf8'));
 const canonical=fs.readFileSync(new URL('../../backend/worker/studio_worker/compute/workspace_confinement.py',import.meta.url));
 f.options.workspaceConfinementPath=f.write('resources/app.asar.unpacked/worker/workspace_confinement.py',canonical.toString('utf8'));
 const runtime=await f.prepare();for(const name of ['worker-delta.mjs','ssh-service-locations.mjs','native-ssh-relay.py','managed-ssh-shells.mjs'])assert(fs.existsSync(path.join(path.dirname(runtime.servicePath),name)));
 fs.rmSync(f.source,{recursive:true,force:true});
 assert.deepEqual(fs.readFileSync(path.join(path.dirname(runtime.servicePath),'workspace-confinement.py')),canonical);
 const loaded=await import(pathToFileURL(path.join(path.dirname(runtime.servicePath),'session.mjs')).href);assert.equal(typeof loaded.createTerminalSession,'function');
 const delta=await import(pathToFileURL(path.join(path.dirname(runtime.servicePath),'worker-delta.mjs')).href);assert.equal(delta.deltaBundle({files:[]},[]).sourceBytes,0);
 const connection=await import(pathToFileURL(path.join(path.dirname(runtime.servicePath),'ssh-connection.mjs')).href);assert.equal(typeof connection.createSshConnections,'function');
});
