import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url);
const electronBuilderRequire=createRequire(require.resolve('electron-builder/package.json'));
const appBuilderRequire=createRequire(electronBuilderRequire.resolve('app-builder-lib/package.json'));
const semverRoot=path.dirname(appBuilderRequire.resolve('semver/package.json'));
const typescriptRoot=path.dirname(require.resolve('typescript/package.json'));

function fixture(t,layout){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aimatterlab-build-resolution-'));
 const junctions=[];
 function linkDir(target,location){fs.symlinkSync(target,location,'junction');junctions.push(location);}
 t.after(()=>{
  for(const location of junctions.reverse())try{fs.unlinkSync(location);}catch{try{fs.rmdirSync(location);}catch{}}
  fs.rmSync(root,{recursive:true,force:true});
 });
 function write(name,value){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);return file;}
 function pkg(directory,name){
  write(path.join(directory,'package.json'),JSON.stringify({name,version:'1.0.0',main:'index.cjs'}));
  // Resolving package metadata must not execute the Electron builder entry points.
  write(path.join(directory,'index.cjs'),"throw Error('Build tool entry must not execute during validation');");
  return path.join(root,directory);
 }
 write('package.json',JSON.stringify({name:'aimatterlab',type:'module',version:'0.1.1'}));
 write('installation/manifest.json',JSON.stringify({version:'0.1.1',release_revision:'v0.1.1'}));
 for(const name of ['stage-dsh-runtime.mjs','package-runtime.mjs']){
  const target=path.join(root,'scripts',name);fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(new URL('../../scripts/'+name,import.meta.url),target);
 }
 write('contracts/agent/dsh-runtime-layout.mjs',fs.readFileSync(new URL('../../contracts/agent/dsh-runtime-layout.mjs',import.meta.url),'utf8'));
 // This test covers build-tool loading only; runtime auditing has its own suite.
 write('backend/main/compute/cli-runtime.mjs','export const validateCliRuntimeLock=value=>value;');
 const modules=path.join(root,'node_modules');fs.mkdirSync(modules,{recursive:true});
 const builder=pkg(layout==='isolated'?'node_modules/.pnpm/electron-builder-fixture/node_modules/electron-builder':'node_modules/electron-builder','electron-builder');
 const app=pkg(layout==='isolated'?'node_modules/.pnpm/app-builder-lib-fixture/node_modules/app-builder-lib':'node_modules/app-builder-lib','app-builder-lib');
 if(layout==='isolated'){
  linkDir(builder,path.join(modules,'electron-builder'));
  linkDir(app,path.join(path.dirname(builder),'app-builder-lib'));
 }
 linkDir(semverRoot,path.join(path.dirname(app),'semver'));
 linkDir(typescriptRoot,path.join(modules,'typescript'));
 return root;
}

for(const layout of ['isolated','hoisted'])for(const script of ['stage-dsh-runtime.mjs','package-runtime.mjs']){
 test(script+' resolves build-only semver through electron-builder in '+layout+' dependency layout',async t=>{
  const root=fixture(t,layout),entry=path.join(root,'scripts',script),fromScript=createRequire(entry);
  if(layout==='isolated')assert.throws(()=>fromScript.resolve('app-builder-lib/package.json'),{code:'MODULE_NOT_FOUND'});
  const module=await import(pathToFileURL(entry).href);
  if(script==='stage-dsh-runtime.mjs'){
   assert.equal(typeof module.stageDshRuntime,'function');
   assert.equal(typeof module.validateStagedDshRuntime,'function');
  }else{
   assert.deepEqual(module.validateReleaseMetadata(root),{packageVersion:'0.1.1',releaseRevision:'v0.1.1'});
   assert.throws(()=>module.validateReleaseMetadata(root,{version:'invalid-version'}),/release versions disagree/);
  }
 });
}
