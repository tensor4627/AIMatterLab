import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {findInstalledCodex,resolveCodexExecutable} from '../../desktop/platform/codex-executable.mjs';

function fixture(t,parent=os.tmpdir()){
 const directory=fs.mkdtempSync(path.join(parent,'studio-codex-executable-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const root=path.join(directory,'OpenAI','Codex','bin');
 fs.mkdirSync(root,{recursive:true});
 const options={localAppData:directory,platform:'win32'};
 const candidate=(name,mtime=1000)=>{
  const file=path.join(root,name,'codex.exe');
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'inert test fixture');
  fs.utimesSync(file,mtime,mtime);return file;
 };
 return {directory,root,options,candidate};
}

test('installed discovery chooses newest actual regular executable in one official version directory',t=>{
 const f=fixture(t),old=f.candidate('old',1000),latest=f.candidate('latest',2000);
 const directory=path.join(f.root,'not-a-file','codex.exe');fs.mkdirSync(directory,{recursive:true});
 fs.utimesSync(directory,3000,3000);
 fs.mkdirSync(path.join(f.root,'nested','inner'),{recursive:true});
 fs.writeFileSync(path.join(f.root,'nested','inner','codex.exe'),'not a direct version candidate');
 assert.equal(findInstalledCodex(f.options),latest);
 assert.notEqual(latest,old);
});

test('missing official version relocates to current installed executable without mutating caller options',t=>{
 const f=fixture(t),latest=f.candidate('latest',2000),stored=path.join(f.root,'removed','codex.exe');
 const before={...f.options};assert.equal(resolveCodexExecutable(stored,f.options),latest);
 assert.deepEqual(f.options,before);
});

test('valid explicitly pinned official version stays pinned even when a newer version exists',t=>{
 const f=fixture(t),pinned=f.candidate('pinned',1000);f.candidate('newer',2000);
 assert.equal(resolveCodexExecutable(pinned,f.options),pinned);
});

test('valid custom executable and missing custom executable are both preserved',t=>{
 const f=fixture(t);f.candidate('official',2000);
 const custom=path.join(f.directory,'Custom Client','codex.exe');fs.mkdirSync(path.dirname(custom));fs.writeFileSync(custom,'inert');
 const missing=path.join(f.directory,'Custom Client','missing.exe');
 for(const value of [custom,missing,'codex'])assert.equal(resolveCodexExecutable(value,f.options),value);
});

test('official shape requires exactly one version directory and has no prefix sibling escape',t=>{
 const f=fixture(t);f.candidate('official',2000);
 for(const value of [path.join(f.root,'codex.exe'),path.join(f.root,'nested','inner','codex.exe'),path.join(f.root+'-other','removed','codex.exe')]){
  assert.equal(resolveCodexExecutable(value,f.options),value);
 }
});

test('missing official path remains the original failure when no executable candidate exists',t=>{
 const f=fixture(t),stored=path.join(f.root,'removed','codex.exe');
 assert.equal(findInstalledCodex(f.options),'codex');
 assert.equal(resolveCodexExecutable(stored,f.options),stored);
});

test('discovery skips candidates that vanish or cannot be statted and ignores root read failures',t=>{
 const f=fixture(t),latest=f.candidate('latest',2000);f.candidate('vanished',3000);f.candidate('denied',4000);
 const fileSystem={...fs,lstatSync(file){if(file.includes(path.sep+'vanished'+path.sep)||file.includes(path.sep+'denied'+path.sep))throw Object.assign(Error('synthetic race'),{code:'ENOENT'});return fs.lstatSync(file);}};
 assert.equal(findInstalledCodex({...f.options,fileSystem}),latest);
 assert.equal(findInstalledCodex({...f.options,fileSystem:{...fs,readdirSync(){throw Error('synthetic inaccessible root');}}}),'codex');
});

test('non-Windows discovery and missing or relative LOCALAPPDATA never consult the filesystem',()=>{
 const fileSystem=new Proxy({}, {get(){assert.fail('No filesystem access expected');}});
 for(const options of [{platform:'linux',localAppData:'/synthetic'},{platform:'darwin',localAppData:'/synthetic'},{platform:'win32',localAppData:''},{platform:'win32',localAppData:'relative-localappdata'}]){
  assert.equal(findInstalledCodex({...options,fileSystem}),'codex');
  assert.equal(resolveCodexExecutable('codex',{...options,fileSystem}),'codex');
 }
 assert.equal(resolveCodexExecutable('/missing/pinned/codex',{platform:'linux',localAppData:'/synthetic',fileSystem}),'/missing/pinned/codex');
});

test('shell wrappers and control characters are rejected without filesystem access',()=>{
 const fileSystem=new Proxy({}, {get(){assert.fail('No filesystem access expected');}});
 for(const value of ['',null,'codex.cmd','codex.bat','codex.ps1','codex\nother','codex\0other']){
  assert.throws(()=>resolveCodexExecutable(value,{platform:'win32',localAppData:'',fileSystem}),/Invalid Codex executable|shell wrapper/);
 }
});

test('special characters and spaces in explicit custom executable paths are preserved as literal paths',t=>{
 const f=fixture(t);
 const fileSystem=new Proxy({}, {get(){assert.fail('Custom paths must not trigger filesystem discovery');}});
 for(const name of ['Program Files',"Author's $tools & helpers; `test`"]){
  const value=path.join(f.directory,name,'codex.exe');fs.mkdirSync(path.dirname(value));fs.writeFileSync(value,'inert');
  assert.equal(resolveCodexExecutable(value,{...f.options,fileSystem}),value);
 }
});

test('shell-looking strings stay literal executable values and are never parsed or scanned',()=>{
 const fileSystem=new Proxy({}, {get(){assert.fail('No filesystem access expected');}});
 for(const value of ['cmd.exe /c codex','codex --version','codex.exe & whoami','codex.exe | other','"C:/Program Files/codex.exe"','codex;other']){
  assert.equal(resolveCodexExecutable(value,{platform:'win32',localAppData:process.cwd(),fileSystem}),value);
 }
});

test('relative custom paths are never resolved against cwd to discover an official replacement',t=>{
 const parent=path.join(process.cwd(),'.studio','bugfix','dev6','codex-executable');fs.mkdirSync(parent,{recursive:true});
 const f=fixture(t,parent);f.candidate('latest',2000);
 const stored=path.relative(process.cwd(),path.join(f.root,'removed','codex.exe'));
 assert(!path.isAbsolute(stored));
 const fileSystem=new Proxy({}, {get(){assert.fail('Relative custom paths must not trigger filesystem discovery');}});
 assert.equal(resolveCodexExecutable(stored,{...f.options,fileSystem}),stored);
});

test('unreadable official pins and existing directories or symlinks preserve the original probe failure',t=>{
 const f=fixture(t);f.candidate('latest',2000);
 const stored=path.join(f.root,'pinned','codex.exe');
 for(const code of ['EACCES','EPERM','ENOTDIR']){
  const fail=file=>{if(file===stored)throw Object.assign(Error('synthetic permission/type failure'),{code});return fs.lstatSync(file);};
  assert.equal(resolveCodexExecutable(stored,{...f.options,fileSystem:{...fs,lstatSync:fail,statSync:fail}}),stored);
 }
 fs.mkdirSync(stored,{recursive:true});assert.equal(resolveCodexExecutable(stored,f.options),stored);
 const fileSystem={...fs,lstatSync:file=>file===stored?{isFile:()=>false,isSymbolicLink:()=>true}:fs.lstatSync(file),statSync:file=>{if(file===stored)throw Object.assign(Error('dangling symlink'),{code:'ENOENT'});return fs.statSync(file);}};
 assert.equal(resolveCodexExecutable(stored,{...f.options,fileSystem}),stored);
});
