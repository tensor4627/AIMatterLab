import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareTerminalRuntime} from '../../backend/main/compute/terminal-runtime.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-terminal-runtime-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),runtimeRoot=path.join(root,'owned','runtimes'),dependencyRoot=path.join(source,'resources','agent-runtimes'),native='@lydell/node-pty-win32-x64';
 const write=(relative,text)=>{const file=path.join(source,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof text==='string'?text:JSON.stringify(text));return file;};
 const nodeExecutable=write('Studio.exe','inert executable fixture; never launched');
 write('ffmpeg.dll','inert runtime support');write('icudtl.dat','inert ICU support');write('LICENSE.electron.txt','fixture license');
 const servicePath=write('resources/terminal-service/broker.mjs',"import './session.mjs';");
 write('resources/terminal-service/session.mjs','export const fixture=true;');
 write('resources/agent-runtimes/node_modules/@lydell/node-pty/package.json',{name:'@lydell/node-pty',version:'1.2.0-beta.10',exports:'./index.js',optionalDependencies:{[native]:'1.2.0-beta.10'}});
 write('resources/agent-runtimes/node_modules/@lydell/node-pty/index.js',`module.exports=require('${native}');`);
 write('resources/agent-runtimes/node_modules/'+native+'/package.json',{name:native,version:'1.2.0-beta.10',exports:'./lib/index.js'});
 const nativeFiles=['lib/index.js','lib/windowsTerminal.js','lib/windowsPtyAgent.js','lib/windowsConoutConnection.js','lib/worker/conoutSocketWorker.js','lib/conpty_console_list_agent.js','prebuilds/win32-x64/conpty.node','prebuilds/win32-x64/conpty_console_list.node','prebuilds/win32-x64/conpty/conpty.dll','prebuilds/win32-x64/conpty/OpenConsole.exe'];
 for(const name of nativeFiles)write('resources/agent-runtimes/node_modules/'+native+'/'+name,'inert '+name);
 write('.config/broker.bin','private fixture must never be copied');write('resources/agent-runtimes/.env','fixture private key; never copied');
 const options={runtimeRoot,nodeExecutable,servicePath,dependencyRoot,platform:'win32',arch:'x64'};
 return {root,source,write,options,native,nativeFiles,prepare:()=>prepareTerminalRuntime(options)};
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
 await assert.rejects(()=>prepareTerminalRuntime({...f.options,nodeExecutable:path.join(linked,'Studio.exe')}),/terminal_runtime_invalid_source/);
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
