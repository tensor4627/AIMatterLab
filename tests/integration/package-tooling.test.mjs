import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import beforeBuild,{validatePackageRuntime,packageRuntimeCLI} from '../../scripts/package-runtime.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-package-runtime-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(name,content)=>{const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof content==='string'?content:JSON.stringify(content));return target;};
 for(const dir of ['desktop','backend/main','agent','contracts'])fs.mkdirSync(path.join(root,dir),{recursive:true});
 write('package.json',{name:'studio-package-fixture',version:'1.0.2-dev.2',devDependencies:{'@moonshot-ai/kimi-code':'2.1.1','@qwen-code/qwen-code':'0.24.7','@lydell/node-pty':'1.2.0-beta.10'}});
 write('installation/manifest.json',{schema_version:1,version:'1.0.2-dev.2',release_revision:'v1.0.2-dev.2'});
 write('desktop/main.mjs',"import fs from 'node:fs'; import {app} from 'electron'; export const ready=true;");
 write('scripts/localize-skill.mjs',"import fs from 'node:fs';");
 write('scripts/cluster-reconcile.mjs',"import path from 'node:path';");
 write('dist/index.html','<script type="module" src="./assets/app.js"></script><link rel="stylesheet" href="./assets/app.css">');
 write('dist/assets/app.js','export const ready=true;');write('dist/assets/app.css','body{color:white}');
 const prefix='.studio/agent-runtimes/node_modules/',packages={};
 function pkg(name,metadata,files){packages[name]=metadata.version;write(prefix+name+'/package.json',{name,...metadata});for(const [name2,text]of Object.entries(files))write(prefix+name+'/'+name2,text);}
 pkg('@moonshot-ai/kimi-code',{version:'2.1.1',dependencies:{ws:'^8.18.0'}},{'dist/main.mjs':"import WebSocket from 'ws';"});
 pkg('@qwen-code/qwen-code',{version:'0.24.7'},{'cli-entry.js':"import './cli.js';",'cli.js':'export const cli=true;'});
 pkg('@lydell/node-pty',{version:'1.2.0-beta.10',exports:'./index.js',optionalDependencies:{'@lydell/node-pty-win32-x64':'1.2.0-beta.10','@lydell/node-pty-linux-x64':'1.2.0-beta.10'}},{'index.js':'module.exports={};'});
 pkg('@lydell/node-pty-win32-x64',{version:'1.2.0-beta.10',os:['win32'],cpu:['x64'],exports:'./lib/index.js'},Object.fromEntries(['lib/index.js','lib/windowsTerminal.js','lib/windowsPtyAgent.js','lib/windowsConoutConnection.js','lib/worker/conoutSocketWorker.js','lib/conpty_console_list_agent.js','prebuilds/win32-x64/conpty.node','prebuilds/win32-x64/conpty_console_list.node','prebuilds/win32-x64/conpty/conpty.dll','prebuilds/win32-x64/conpty/OpenConsole.exe'].map(file=>[file,'test fixture only; never executed'])));
 pkg('ws',{version:'8.22.0',exports:{'.':{import:'./wrapper.mjs',require:'./index.cjs'}}},{'wrapper.mjs':'export default {};','index.cjs':'module.exports={};'});
 const manifest='.studio/agent-runtimes/manifest.json';write(manifest,{scope:'test-only runtime',packages});
 return {root,write,prefix,packages,manifest,validate:()=>validatePackageRuntime({appDir:root,platform:{nodeName:'win32'},arch:'x64'})};
}

test('public beforeBuild hook validates explicit target and leaves package/install inputs unchanged',t=>{
 const f=fixture(t);f.write('pnpm-lock.yaml','lockfile sentinel');f.write('node_modules/.modules.yaml','installed metadata sentinel');
 const inputs=['package.json','installation/manifest.json','pnpm-lock.yaml','node_modules/.modules.yaml'],before=inputs.map(p=>fs.readFileSync(path.join(f.root,p),'utf8'));
 const result=f.validate();assert.equal(result.runtimePackages,5);assert.equal(result.dependencyEdges,1);assert.equal(result.nativePackage,'@lydell/node-pty-win32-x64');assert.equal(result.omittedOptional,1);
 assert.equal(beforeBuild({appDir:f.root,platform:{nodeName:'win32'},arch:'x64'}),false);
 assert.deepEqual(inputs.map(p=>fs.readFileSync(path.join(f.root,p),'utf8')),before);
});

test('missing required staged package fails even if development node_modules could satisfy it',t=>{
 const f=fixture(t);delete f.packages.ws;f.write(f.manifest,{packages:f.packages});
 f.write('node_modules/ws/package.json',{name:'ws',version:'8.22.0',main:'index.cjs'});f.write('node_modules/ws/index.cjs','module.exports={};');
 assert.throws(f.validate,/Required staged dependency missing/);
});

test('package declarations cannot hide a missing ESM conditional entry',t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.root,f.prefix,'ws/wrapper.mjs'));
 assert.throws(f.validate,/Staged package entry missing: ws/);
});

test('staged package and dependency versions must match their real manifests and required ranges',t=>{
 const f=fixture(t);f.write(f.prefix+'ws/package.json',{name:'ws',version:'7.0.0',main:'index.cjs'});f.packages.ws='7.0.0';f.write(f.manifest,{packages:f.packages});
 assert.throws(f.validate,/Required staged dependency missing or version mismatch/);
});

test('manifest identity disagreement fails before externally handled status is returned',t=>{
 const f=fixture(t);f.packages.ws='8.21.0';f.write(f.manifest,{packages:f.packages});
 assert.throws(f.validate,/Staged package identity mismatch/);
});

test('cross-target native package and missing native helper are rejected without loading binaries',t=>{
 const f=fixture(t);assert.throws(()=>validatePackageRuntime({appDir:f.root,platform:{nodeName:'linux'},arch:'x64'}),/Staged PTY platform package missing/);
 fs.unlinkSync(path.join(f.root,f.prefix,'@lydell/node-pty-win32-x64/prebuilds/win32-x64/conpty/OpenConsole.exe'));
 assert.throws(f.validate,/Package runtime file missing/);
});

test('Qwen bootstrap is insufficient when its actual CLI module is absent',t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.root,f.prefix,'@qwen-code/qwen-code/cli.js'));
 assert.throws(f.validate,/Package runtime file missing/);
});

test('packaged main, contract, and studio-tool modules cannot acquire unstaged bare imports',t=>{
 const f=fixture(t);
 for(const source of ['desktop/main.mjs','contracts/new-runtime.mjs','scripts/localize-skill.mjs']){
  f.write(source,"import absent from 'unexpected-runtime-package';");assert.throws(f.validate,/unstaged bare module unexpected-runtime-package/);f.write(source,'export const valid=true;');
 }
});

test('new dynamic bare imports and aliased createRequire calls are audited',t=>{
 const f=fixture(t);
 for(const source of ["const value=import('unstaged-dynamic-package');","import {createRequire as factory} from 'node:module'; const load=factory(import.meta.url); load('unstaged-dynamic-package');","const moduleName='unstaged-dynamic-package'; const value=import(moduleName);",...[
  "import {createRequire} from 'node:module'; createRequire(import.meta.url)('unstaged-dynamic-package');",
  "import {createRequire as factory} from 'node:module'; factory(import.meta.url).resolve('unstaged-dynamic-package');",
  "import * as mod from 'node:module'; mod.createRequire(import.meta.url)('unstaged-dynamic-package');",
  "import mod from 'module'; const load=mod['createRequire'](import.meta.url); load('unstaged-dynamic-package');",
  "import * as mod from 'node:module'; const factory=mod.createRequire,load=factory(import.meta.url); load.resolve('unstaged-dynamic-package');",
 ]]){
  f.write('desktop/main.mjs',source);assert.throws(f.validate,/unstaged bare module|Cannot audit dynamic/);
 }
});

test('standalone validation reuses the public gate without modifying package inputs or running staged files',t=>{
 const f=fixture(t),script=fileURLToPath(new URL('../../scripts/package-runtime.mjs',import.meta.url)),args=['--validate','--app-dir',f.root,'--platform','win32','--arch','x64'];
 const names=['package.json','installation/manifest.json','dist/index.html',f.manifest],before=names.map(name=>fs.readFileSync(path.join(f.root,name),'utf8'));
 const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),f.validate());assert.deepEqual(names.map(name=>fs.readFileSync(path.join(f.root,name),'utf8')),before);
 for(const invalid of [[],['--validate','--unknown','x'],['--validate','--app-dir'],['--validate','--platform','win32','--platform','linux']])assert.throws(()=>packageRuntimeCLI(invalid),/Usage|Invalid package runtime/);
});

test('release metadata mismatches fail before package validation can report success',t=>{
 const f=fixture(t);
 for(const manifest of [{version:'old',release_revision:'v1.0.2-dev.2'},{version:'1.0.2-dev.2',release_revision:'old'},{}]){f.write('installation/manifest.json',manifest);assert.throws(f.validate,/release versions disagree/);}
 f.write('installation/manifest.json',{version:'1.0.2-dev.2',release_revision:'v1.0.2-dev.2'});assert.equal(f.validate().packageVersion,'1.0.2-dev.2');
});

test('ordinary source comments and strings do not become false dependency requirements',t=>{
 const f=fixture(t);f.write('agent/example.mjs',"// import x from 'absent';\nconst prose=\"require('missing')\"; /* import('fake'); */ export {prose};");
 assert.equal(f.validate().runtimePackages,5);
});

test('linked application directories cannot evade the bare dependency audit',t=>{
 const f=fixture(t),target=path.join(f.root,'.studio','linked-source');
 f.write('.studio/linked-source/extra.mjs',"import absent from 'unstaged-linked-package';");
 fs.symlinkSync(target,path.join(f.root,'desktop','linked-source'),'junction');
 assert.throws(f.validate,/Linked application module input cannot be audited/);
});

test('renderer build references must point to actual packaged files',t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.root,'dist/assets/app.js'));
 assert.throws(f.validate,/Package runtime file missing/);
 f.write('dist/index.html','<script src="https://example.invalid/runtime.js"></script>');
 assert.throws(f.validate,/Renderer package uses an external asset/);
});

test('staged package entry traversal is rejected',t=>{
 const f=fixture(t);f.write(f.prefix+'ws/package.json',{name:'ws',version:'8.22.0',main:'../../../../../../desktop/main.mjs'});
 assert.throws(f.validate,/Package runtime file missing or outside|Staged package entry missing/);
});

test('terminal runtime file resolution is scoped to its exact independently staged PTY resolver chain',t=>{
 const f=fixture(t),source=fs.readFileSync(new URL('../../backend/main/compute/terminal-runtime.mjs',import.meta.url),'utf8');
 const location='backend/main/compute/terminal-runtime.mjs';f.write(location,source);
 assert.equal(f.validate().nativePackage,'@lydell/node-pty-win32-x64');
 for(const addition of ["import pty from '@lydell/node-pty';","const forbidden=require('@lydell/node-pty');","const unrelated=createRequire(import.meta.url); unrelated.resolve('@lydell/node-pty');"]){
  f.write(location,source+'\n'+addition);assert.throws(f.validate,/unstaged bare module/);
 }
 for(const changed of [
  source.replace("createRequire(path.join(dependencyRoot,'runtime.cjs'))","createRequire(import.meta.url)"),
  source.replace("'@lydell/node-pty-'+platform+'-'+arch","'arbitrary-runtime-package'"),
  source.replace('.resolve(nativeName)','.resolve(unverifiedName)'),
 ]){f.write(location,changed);assert.throws(f.validate,/unstaged bare module|Cannot audit package require/);}
 f.write(location,'export const fixture=true;');f.write('backend/main/compute/unrelated.mjs',source);
 assert.throws(f.validate,/unstaged bare module/);
});

test('missing lazy native PTY worker or console agent fails package validation without executing binaries',t=>{
 for(const name of ['lib/worker/conoutSocketWorker.js','lib/conpty_console_list_agent.js']){
  const f=fixture(t);fs.unlinkSync(path.join(f.root,f.prefix,'@lydell/node-pty-win32-x64',name));
  assert.throws(f.validate,/Package runtime file missing/);
 }
});
