import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {stageDshRuntime,validateStagedDshRuntime} from '../../scripts/stage-dsh-runtime.mjs';
import {stageCoreRuntimes} from '../../scripts/stage-agents.mjs';

const roots=['@deepseek-ai/dsh','@deepseek-ai/dsh-sdk-minimal','@deepseek-ai/dsh-mcp-client'],version='0.2.2-rc.1';
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-stage-dsh-')),modules=path.join(root,'node_modules'),target=path.join(root,'.studio/agent-runtimes/dsh');fs.mkdirSync(modules,{recursive:true});
 const app={name:'gpu-sampling-studio',devDependencies:Object.fromEntries(roots.map(name=>[name,version]))};
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(app));
 const pkg=(name,values={},location=path.join(modules,name))=>{fs.mkdirSync(path.join(location,'lib'),{recursive:true});fs.writeFileSync(path.join(location,'package.json'),JSON.stringify({name,version:'1.0.0',main:'lib/index.js',...values}));fs.writeFileSync(path.join(location,'lib/index.js'),'module.exports = '+JSON.stringify(values.version||'1.0.0')+';');return location;};
 for(const name of roots)pkg(name,{version});fs.writeFileSync(path.join(modules,roots[0],'lib/bin.js'),'// synthetic fixture CLI: never executed');
 const change=(name,values)=>{const file=path.join(modules,name,'package.json');fs.writeFileSync(file,JSON.stringify({...JSON.parse(fs.readFileSync(file,'utf8')),...values}));};
 return {root,modules,target,app,pkg,change,stage:()=>stageDshRuntime({root,platform:'win32',arch:'x64',profile:'full'}),validate:()=>validateStagedDshRuntime(target,{expectedVersion:version,platform:'win32',arch:'x64',profile:'full'}),close:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('offline DSH staging preserves conflicting dependency versions and required peer resolution in a symlink-free portable tree',()=>{
 const f=fixture();try{
  f.change(roots[0],{dependencies:{'branch-a':'1.0.0','branch-b':'1.0.0'}});f.pkg('branch-a',{dependencies:{shared:'^1.0.0'},peerDependencies:{peer:'^1.0.0'}});const b=f.pkg('branch-b',{dependencies:{shared:'^2.0.0'}});f.pkg('shared');f.pkg('peer');f.pkg('shared',{version:'2.1.0'},path.join(b,'node_modules/shared'));fs.writeFileSync(path.join(f.modules,'branch-a','lib/index.js.map'),'excluded');
  const manifest=f.stage(),report=f.validate();assert.equal(report.version,version);assert.equal(manifest.packages.filter(pkg=>pkg.name==='shared').length,2);assert(!manifest.files.some(file=>file.path.endsWith('.map')));assert.equal(createRequire(path.join(f.target,'node_modules/branch-a/package.json'))('shared'),'1.0.0');assert.equal(createRequire(path.join(f.target,'node_modules/branch-b/package.json'))('shared'),'2.1.0');assert(manifest.resolutions.some(link=>link.name==='peer'&&link.kind==='peer'));assert.equal(fs.lstatSync(path.join(f.target,'node_modules/shared')).isSymbolicLink(),false);
 }finally{f.close();}
});

test('staging records missing optional dependencies and excludes optional packages for other target platforms',()=>{
 const f=fixture();try{f.change(roots[0],{optionalDependencies:{absent:'^1.0.0','linux-only':'^1.0.0'},peerDependencies:{'optional-peer':'^1.0.0'},peerDependenciesMeta:{'optional-peer':{optional:true}}});f.pkg('linux-only',{os:['linux']});const manifest=f.stage();assert.deepEqual(manifest.skippedOptional.map(value=>[value.name,value.reason]),[['absent','missing'],['linux-only','platform'],['optional-peer','missing']]);assert(!manifest.packages.some(pkg=>pkg.name==='linux-only'));f.validate();}finally{f.close();}
});

for(const [name,setup,pattern]of [
 ['missing dependency',f=>f.change(roots[0],{dependencies:{absent:'^1.0.0'}}),/Missing required DSH dependency/],
 ['missing peer',f=>f.change(roots[0],{peerDependencies:{absent:'^1.0.0'}}),/Missing required DSH dependency/],
 ['wrong dependency version',f=>{f.change(roots[0],{dependencies:{shared:'^2.0.0'}});f.pkg('shared');},/version\/name mismatch/],
 ['wrong dependency name',f=>{f.change(roots[0],{dependencies:{shared:'^1.0.0'}});f.pkg('shared',{name:'foreign'});},/version\/name mismatch/],
 ['unpinned root',f=>{f.app.devDependencies[roots[0]]='^0.2.2-rc.1';fs.writeFileSync(path.join(f.root,'package.json'),JSON.stringify(f.app));},/same exact version pin/],
])test('DSH staging refuses '+name+' and preserves the prior runtime',()=>{
 const f=fixture();try{f.stage();const before=fs.readFileSync(path.join(f.target,'runtime.json'));setup(f);assert.throws(f.stage,pattern);assert.deepEqual(fs.readFileSync(path.join(f.target,'runtime.json')),before);assert(!fs.readdirSync(path.dirname(f.target)).some(name=>name.startsWith('dsh-staging-')));}finally{f.close();}
});

test('DSH package links resolving outside the checkout are rejected',()=>{
 const f=fixture(),outside=fs.mkdtempSync(path.join(os.tmpdir(),'studio-dsh-outside-'));try{f.change(roots[0],{dependencies:{foreign:'1.0.0'}});f.pkg('foreign',{},outside);fs.symlinkSync(outside,path.join(f.modules,'foreign'),'junction');assert.throws(f.stage,/outside this checkout/);}finally{f.close();fs.rmSync(outside,{recursive:true,force:true});}
});

test('DSH package data links cannot copy unrelated files outside their own package',()=>{
 const f=fixture(),outside=fs.mkdtempSync(path.join(os.tmpdir(),'studio-dsh-data-outside-'));try{fs.writeFileSync(path.join(outside,'private.txt'),'must remain outside');fs.symlinkSync(outside,path.join(f.modules,roots[0],'linked-data'),'junction');assert.throws(f.stage,/file link escapes its package/);assert.equal(fs.readFileSync(path.join(outside,'private.txt'),'utf8'),'must remain outside');}finally{f.close();fs.rmSync(outside,{recursive:true,force:true});}
});

test('linked DSH staging destinations cannot replace outside directories',()=>{
 const f=fixture(),outside=fs.mkdtempSync(path.join(os.tmpdir(),'studio-dsh-target-outside-'));try{fs.mkdirSync(path.dirname(f.target),{recursive:true});fs.writeFileSync(path.join(outside,'sentinel'),'preserve');fs.symlinkSync(outside,f.target,'junction');assert.throws(f.stage,/Linked DSH staging target/);assert.equal(fs.readFileSync(path.join(outside,'sentinel'),'utf8'),'preserve');}finally{f.close();fs.rmSync(outside,{recursive:true,force:true});}
});

for(const [name,change,pattern]of [
 ['changed bytes',f=>fs.appendFileSync(path.join(f.target,'node_modules',roots[0],'lib/bin.js'),'changed'),/differs from integrity receipt/],
 ['unrecorded files',f=>fs.writeFileSync(path.join(f.target,'unexpected.txt'),'extra'),/Unrecorded files/],
 ['wrong target version',f=>{const file=path.join(f.target,'runtime.json'),manifest=JSON.parse(fs.readFileSync(file));manifest.version='9.0.0';fs.writeFileSync(file,JSON.stringify(manifest));},/Invalid staged DSH/],
 ['escaped receipt path',f=>{const file=path.join(f.target,'runtime.json'),manifest=JSON.parse(fs.readFileSync(file));manifest.files[0].path='../outside';fs.writeFileSync(file,JSON.stringify(manifest));},/escapes runtime/],
])test('DSH integrity validation refuses '+name,()=>{const f=fixture();try{f.stage();change(f);assert.throws(f.validate,pattern);}finally{f.close();}});

test('runtime file bounds fail before replacing an intact DSH runtime',()=>{const f=fixture();try{f.stage();const before=fs.readFileSync(path.join(f.target,'runtime.json'));assert.throws(()=>stageDshRuntime({root:f.root,platform:'win32',arch:'x64',profile:'full',maxFiles:2}),/file\/byte bound/);assert.deepEqual(fs.readFileSync(path.join(f.target,'runtime.json')),before);}finally{f.close();}});

test('verified DSH cache preserves staged bytes without recopying when exact root pins and source lock remain identical',()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.root,'pnpm-lock.yaml'),'fixture lock v1');const first=f.stage(),entry=path.join(f.target,first.entry),before=fs.readFileSync(entry),manifestBefore=fs.readFileSync(path.join(f.target,'runtime.json'));fs.writeFileSync(path.join(f.modules,roots[0],'lib/bin.js'),'source changed without a new lock; cached pinned runtime remains immutable');const cached=f.stage();assert.equal(cached.sourceLockSha256,first.sourceLockSha256);assert.deepEqual(fs.readFileSync(entry),before);assert.deepEqual(fs.readFileSync(path.join(f.target,'runtime.json')),manifestBefore);assert.equal(cached.rootPins[roots[0]],version);}finally{f.close();}
});

test('changed source lock or exact official root version invalidates the DSH cache',()=>{
 const f=fixture();try{const lock=path.join(f.root,'pnpm-lock.yaml');fs.writeFileSync(lock,'fixture lock v1');const first=f.stage();fs.writeFileSync(path.join(f.modules,roots[0],'lib/bin.js'),'fixture lock v2 contents');fs.writeFileSync(lock,'fixture lock v2');const changed=f.stage();assert.notEqual(changed.sourceLockSha256,first.sourceLockSha256);assert.equal(fs.readFileSync(path.join(f.target,changed.entry),'utf8'),'fixture lock v2 contents');const newer='0.2.2-rc.2';for(const name of roots){f.app.devDependencies[name]=newer;f.change(name,{version:newer});}fs.writeFileSync(path.join(f.root,'package.json'),JSON.stringify(f.app));assert.equal(f.stage().version,newer);}finally{f.close();}
});

test('tampered matching DSH cache fails explicitly and only a forced rebuild replaces it',()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.root,'pnpm-lock.yaml'),'fixture lock');const first=f.stage(),entry=path.join(f.target,first.entry);fs.writeFileSync(entry,'tampered');assert.throws(f.stage,/differs from integrity receipt/);assert.equal(fs.readFileSync(entry,'utf8'),'tampered');stageDshRuntime({root:f.root,platform:'win32',arch:'x64',profile:'full',force:true});assert.notEqual(fs.readFileSync(entry,'utf8'),'tampered');f.validate();}finally{f.close();}
});

test('rebuilding the native terminal core preserves the independently verified DSH cache',()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.root,'pnpm-lock.yaml'),'fixture native+DSH lock');f.pkg('@lydell/node-pty');f.pkg('@lydell/node-pty-win32-x64');stageCoreRuntimes({root:f.root,platform:'win32',arch:'x64',dshProfile:'full'});const dshReceipt=fs.readFileSync(path.join(f.target,'runtime.json')),native=path.join(f.root,'.studio/agent-runtimes/node_modules/@lydell/node-pty/lib/index.js');fs.writeFileSync(native,'stale native runtime');fs.writeFileSync(path.join(f.modules,roots[0],'lib/bin.js'),'source mutation must not recopy the immutable cached DSH');stageCoreRuntimes({root:f.root,platform:'win32',arch:'x64',dshProfile:'full'});assert.deepEqual(fs.readFileSync(path.join(f.target,'runtime.json')),dshReceipt);assert.notEqual(fs.readFileSync(native,'utf8'),'stale native runtime');f.validate();}finally{f.close();}
});

test('native staging rejects a linked deletion target before modifying external files or DSH',()=>{
 const f=fixture(),outside=fs.mkdtempSync(path.join(os.tmpdir(),'studio-native-linked-'));try{f.stage();const receipt=fs.readFileSync(path.join(f.target,'runtime.json'));fs.writeFileSync(path.join(outside,'sentinel'),'preserve');fs.symlinkSync(outside,path.join(f.root,'.studio/agent-runtimes/node_modules'),'junction');assert.throws(()=>stageCoreRuntimes({root:f.root,platform:'win32',arch:'x64',dshProfile:'full'}),/Linked native runtime staging target/);assert.equal(fs.readFileSync(path.join(outside,'sentinel'),'utf8'),'preserve');assert.deepEqual(fs.readFileSync(path.join(f.target,'runtime.json')),receipt);}finally{f.close();fs.rmSync(outside,{recursive:true,force:true});}
});


test('Studio profile projects only audited carrier edges, retaining implementation dependencies and peers unchanged',()=>{
 const f=fixture();try{
  f.change(roots[0],{dependencies:{commander:'1.0.0','@deepseek-ai/dsh-sdk-app':version,'unused-web-bundle':'1.0.0'}});
  f.change(roots[1],{dependencies:{'@deepseek-ai/dsh-sdk-app':version}});
  f.pkg('commander');f.pkg('@deepseek-ai/dsh-sdk-app',{version,dependencies:{'@deepseek-ai/dsh-cmdline':version,'unused-office-bundle':'1.0.0'},peerDependencies:{'required-peer':'1.0.0'}});
  f.pkg('@deepseek-ai/dsh-cmdline',{version,dependencies:{'required-implementation':'1.0.0'}});f.pkg('required-peer');f.pkg('required-implementation');
  f.pkg('unused-web-bundle');f.pkg('unused-office-bundle');
  const original=fs.readFileSync(path.join(f.modules,roots[0],'package.json'));
  const manifest=stageDshRuntime({root:f.root,platform:'win32',arch:'x64'});
  assert.equal(manifest.profile,'studio-sdk-v2');
  assert.deepEqual(fs.readFileSync(path.join(f.target,'node_modules',roots[0],'package.json')),original);
  for(const name of ['commander','required-peer','required-implementation'])assert(manifest.packages.some(record=>record.name===name));
  for(const name of ['unused-web-bundle','unused-office-bundle'])assert(!manifest.packages.some(record=>record.name===name));
  f.validate();
  fs.rmSync(path.join(f.target,'node_modules/required-peer'),{recursive:true});assert.throws(f.validate,/integrity receipt/);
 }finally{f.close();}
});

test('a changed official carrier version cannot silently reuse the audited Studio dependency projection',()=>{
 const f=fixture();try{for(const name of roots){f.app.devDependencies[name]='0.2.2-rc.2';f.change(name,{version:'0.2.2-rc.2'});}fs.writeFileSync(path.join(f.root,'package.json'),JSON.stringify(f.app));assert.throws(()=>stageDshRuntime({root:f.root,platform:'win32',arch:'x64'}),/new dependency audit/);}finally{f.close();}
});
