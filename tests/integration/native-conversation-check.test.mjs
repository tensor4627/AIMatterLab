// Launcher and fixture-safety tests only. Real native acceptance is run explicitly by its CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {freshNativeCheckPath,nativeCheckEnvironment,parseNativeCheckArgs,prepareNativeConversationCheck,runNativeConversationCheck,mainPreloadBinding,nativeRendererEvidence,nativeWorkerStatusEvidence} from "../../scripts/native-conversation-check.mjs";

function fixture(run){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-native-check-fixture-'));
 for(const directory of ['.studio','desktop','dist','frontend/app'])fs.mkdirSync(path.join(root,directory),{recursive:true});
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'0.0.0-fixture',main:'desktop/main.mjs'}));
 fs.writeFileSync(path.join(root,'desktop/main.mjs'),"import path from 'node:path';import {fileURLToPath} from 'node:url';import {BrowserWindow} from 'electron';const here=path.dirname(fileURLToPath(import.meta.url));throw Error('Fixture must never start Electron');new BrowserWindow({webPreferences:{preload:path.join(here,'preload.cjs')}});");
 fs.writeFileSync(path.join(root,'desktop/preload.cjs'),'// inert fixture');fs.writeFileSync(path.join(root,'frontend/app/App.tsx'),'// inert source fixture');fs.writeFileSync(path.join(root,'dist/index.html'),'<div>Fixture, not native evidence</div>');
 return Promise.resolve().then(()=>run(root)).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
}

test('native CLI requires an explicit fresh destination and bounded optional timeout',()=>{
 assert.deepEqual(parseNativeCheckArgs(['--out','.studio/explicit-run']),{out:'.studio/explicit-run',timeoutMs:90000});
 assert.deepEqual(parseNativeCheckArgs(['--timeout-ms','30000','--out','.studio/explicit-run']),{out:'.studio/explicit-run',timeoutMs:30000});
 for(const args of [[],['--out'],['--out','x','--unknown','x'],['--out','x','--out','y'],['--out','x','--timeout-ms','0'],['--out','x','--timeout-ms','180001'],['--out','x','--timeout-ms','NaN']])assert.throws(()=>parseNativeCheckArgs(args));
});

test('fresh path guard refuses escapes, .studio itself, occupied outputs and file ancestors',()=>fixture(root=>{
 for(const value of ['.studio','..','.studio-other/run','desktop/run'])assert.throws(()=>freshNativeCheckPath(root,value));
 const out=path.join(root,'.studio','new-run');assert.equal(freshNativeCheckPath(root,out),out);fs.mkdirSync(out);assert.throws(()=>freshNativeCheckPath(root,out),/already exists/);
 fs.writeFileSync(path.join(root,'.studio','file-parent'),'fixture');assert.throws(()=>freshNativeCheckPath(root,'.studio/file-parent/child'),/not a directory/);
}));

test('linked output ancestors are refused without following them outside the fixture',()=>fixture(root=>{
 const outside=path.join(root,'desktop'),linked=path.join(root,'.studio','linked');fs.symlinkSync(outside,linked,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>freshNativeCheckPath(root,'.studio/linked/run'),/Linked/);assert(!fs.existsSync(path.join(outside,'run')));
}));

test('preparation writes an isolated versioned harness and refuses reuse or an outdated renderer build',()=>fixture(root=>{
 const out='.studio/valid-run',prepared=prepareNativeConversationCheck({repoRoot:root,out});
 assert.equal(prepared.config.mainUrl,pathToFileURL(path.join(root,'desktop/main.mjs')).href);assert(!fs.existsSync(prepared.config.profile),'Only the real Electron harness may create its fresh profile');
 const pkg=JSON.parse(fs.readFileSync(path.join(prepared.harness,'package.json'),'utf8'));assert.equal(pkg.version,'0.0.0-fixture');assert.equal(pkg.main,'harness.mjs');
 const script=fs.readFileSync(path.join(prepared.harness,'harness.mjs'),'utf8');assert(script.includes('browser-window-created'));assert(script.includes('did-finish-load'));assert(script.includes('executeJavaScript'));assert(script.includes('handler(event,...args)'));assert(script.includes('contextIsolation,true'));assert(script.includes('nodeIntegration,false'));assert(script.includes('sandbox,true'));
 assert(!script.includes('--no-sandbox'));assert(!script.includes('playwright'));assert(!script.includes('seedConversation'));assert(script.includes('fresh selection ACK'));
 execFileSync(process.execPath,['--check',path.join(prepared.harness,'harness.mjs')],{stdio:'pipe'});
 assert.throws(()=>prepareNativeConversationCheck({repoRoot:root,out}),/already exists/);
 const index=path.join(root,'dist/index.html');fs.utimesSync(index,new Date(0),new Date(0));assert.throws(()=>prepareNativeConversationCheck({repoRoot:root,out:'.studio/stale-build'}),/predates/);assert(!fs.existsSync(path.join(root,'.studio/stale-build')));
}));

test('native environment preserves ordinary OS environment while dropping inherited AIMatterLab modes and Node injection',()=>{
 const env={PATH:'fixture-path',STUDIO_PROFILE_DIR:'old-private-profile',STUDIO_DEV_URL:'http://fixture',STUDIO_INSTALL_CONFIG:'private-input',ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--require unsafe',SAMPLE:'kept'};
 assert.deepEqual(nativeCheckEnvironment(env,'new-owned-profile'),{PATH:'fixture-path',SAMPLE:'kept',STUDIO_PROFILE_DIR:'new-owned-profile'});assert.equal(env.STUDIO_PROFILE_DIR,'old-private-profile');
});

test('Electron 44 absent preload preference remains explicitly unobserved while artifact and sandbox gates stay required',()=>{
 const baseline={preferences:{contextIsolation:true,nodeIntegration:false,sandbox:true},configuredPreload:path.resolve('fixture-preload.cjs'),expectedHash:'fixture-hash',actualHash:'fixture-hash',sessionPreloads:[]};
 const value=nativeRendererEvidence(baseline);assert.equal(value.preloadPathReportedByWebPreferences,null);assert.equal(value.configuredPreload,baseline.configuredPreload);assert.equal(value.preloadSha256,'fixture-hash');
 assert.equal(nativeRendererEvidence({...baseline,preferences:{...baseline.preferences,preload:baseline.configuredPreload}}).preloadPathReportedByWebPreferences,baseline.configuredPreload);
 for(const key of ['contextIsolation','sandbox'])assert.throws(()=>nativeRendererEvidence({...baseline,preferences:{...baseline.preferences,[key]:false}}));
 assert.throws(()=>nativeRendererEvidence({...baseline,preferences:{...baseline.preferences,nodeIntegration:true}}));assert.throws(()=>nativeRendererEvidence({...baseline,actualHash:'changed'}));assert.throws(()=>nativeRendererEvidence({...baseline,sessionPreloads:[{id:'unexpected',filePath:'other'}]}));assert.throws(()=>nativeRendererEvidence({...baseline,preferences:{...baseline.preferences,preload:'other-preload.cjs'}}));
});

test('preload source binding must come from the actual single main BrowserWindow constructor',()=>fixture(root=>{
 const source=fs.readFileSync(path.join(root,'desktop/main.mjs'),'utf8');assert.equal(mainPreloadBinding(source).expression,"path.join(here,'preload.cjs')");
 assert.throws(()=>mainPreloadBinding(source.replace("path.join(here,'preload.cjs')","path.join(here,'other.cjs')")));assert.throws(()=>mainPreloadBinding(source.replace("new BrowserWindow({webPreferences:","new BrowserWindow({...unreviewed,webPreferences:")));assert.throws(()=>mainPreloadBinding(source.replace('path.dirname(fileURLToPath(import.meta.url))','injectedDirectory')));
}));

test('real readonly worker observation must be disconnected and cannot include credentials or connection details',()=>{
 const reply=Object.freeze({status:'disconnected',checkedAt:123});assert.deepEqual(nativeWorkerStatusEvidence(reply),reply);
 for(const value of [null,[],{status:'connected',checkedAt:123},{status:'disconnected',checkedAt:NaN},{status:'disconnected'},{...reply,tokens:{mcp:'synthetic-token'}},{...reply,connection:{url:'http://fixture'}},{...reply,root:'private-fixture-path'}])assert.throws(()=>nativeWorkerStatusEvidence(value));
});

test('restricted launch context stops before binary resolution, output creation or native spawning',()=>fixture(async root=>{
 let effects=0;const failure=Object.assign(Error('restricted fixture context'),{preflight:{reason:'restricted_token'}});
 await assert.rejects(runNativeConversationCheck({repoRoot:root,args:['--out','.studio/blocked'],preflight:()=>{throw failure;},resolveBinary:()=>{effects++;},spawnTarget:()=>{effects++;}}),error=>error===failure);
 assert.equal(effects,0);assert(!fs.existsSync(path.join(root,'.studio/blocked')));
}));

test('a clean child exit without a real native receipt cannot fabricate acceptance',()=>fixture(async root=>{
 let invocation;const result=await runNativeConversationCheck({repoRoot:root,args:['--out','.studio/absent-receipt'],env:{ELECTRON_RUN_AS_NODE:'1',STUDIO_PROFILE_DIR:'private',PATH:'fixture'},preflight:()=>({status:'allowed',reason:'synthetic-unit-fixture'}),resolveBinary:()=> 'fixture-electron-not-executed',spawnTarget:(binary,args,options)=>{
  invocation={binary,args,options};const child=Object.assign(new EventEmitter(),{pid:99999999,stdout:new PassThrough(),stderr:new PassThrough(),kill(){}});queueMicrotask(()=>{child.stdout.write('Synthetic launcher unit fixture only\n');child.emit('close',0,null);});return child;
 }});
 assert.equal(result.status,'failed');assert.equal(result.checks,0);assert.equal(invocation.args.length,1);assert.equal(invocation.args[0],path.join(root,'.studio/absent-receipt/harness'));assert.equal(invocation.options.cwd,root);assert.equal(invocation.options.windowsHide,true);assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE,undefined);assert.equal(invocation.options.env.STUDIO_PROFILE_DIR,path.join(root,'.studio/absent-receipt/profile'));
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'.studio/absent-receipt/launch.json'),'utf8'));assert.equal(manifest.status,'failed');assert.equal(manifest.exit.code,0);assert(fs.readFileSync(path.join(root,'.studio/absent-receipt/stdout.log'),'utf8').includes('Synthetic launcher'));
}));

test('synchronous spawn failure preserves a failed launch receipt and owned logs',()=>fixture(async root=>{
 const result=await runNativeConversationCheck({repoRoot:root,args:['--out','.studio/spawn-failed'],preflight:()=>({status:'allowed',reason:'synthetic-unit-fixture'}),resolveBinary:()=> 'fixture-not-launched',spawnTarget:()=>{throw Error('synthetic spawn refused');}});
 assert.equal(result.status,'failed');assert.match(result.exit.failure,/synthetic spawn refused/);const manifest=JSON.parse(fs.readFileSync(path.join(root,'.studio/spawn-failed/launch.json'),'utf8'));assert.equal(manifest.status,'failed');assert(fs.existsSync(path.join(root,'.studio/spawn-failed/stderr.log')));
}));
