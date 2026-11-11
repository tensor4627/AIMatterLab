import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {stageCoreRuntimes} from '../../scripts/stage-agents.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-pty-stage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'gpu-sampling-studio'}));
 const native='@lydell/node-pty-win32-x64',wrapperRoot=path.join(root,'node_modules/.pnpm/wrapper/node_modules/@lydell/node-pty'),nativeRoot=path.join(root,'node_modules/.pnpm/native/node_modules',native);
 const pkg=(directory,value,entry)=>{fs.mkdirSync(path.dirname(path.join(directory,entry)),{recursive:true});fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify(value));fs.writeFileSync(path.join(directory,entry),'inert staging fixture; never executed');};
 pkg(wrapperRoot,{name:'@lydell/node-pty',version:'1.2.0-beta.10',exports:'./index.js',optionalDependencies:{[native]:'1.2.0-beta.10'}},'index.js');
 pkg(nativeRoot,{name:native,version:'1.2.0-beta.10',exports:'./lib/index.js'},'lib/index.js');
 fs.writeFileSync(path.join(nativeRoot,'debug.pdb'),'not part of the product');fs.writeFileSync(path.join(nativeRoot,'source.js.map'),'not part of the product');
 const link=(target,destination)=>{fs.mkdirSync(path.dirname(destination),{recursive:true});fs.symlinkSync(target,destination,process.platform==='win32'?'junction':'dir');};
 link(wrapperRoot,path.join(root,'node_modules/@lydell/node-pty'));
 link(nativeRoot,path.join(wrapperRoot,'..','node-pty-win32-x64'));
 return {root,native,nativeRoot,wrapperRoot,link};
}

test('standalone pnpm layout stages the wrapper-scoped native dependency without a root-level native link',t=>{
 const f=fixture(t);assert.equal(fs.existsSync(path.join(f.root,'node_modules',f.native)),false);
 const manifest=stageCoreRuntimes({root:f.root,platform:'win32',arch:'x64'}),target=path.join(f.root,'.studio/agent-runtimes/node_modules');
 assert.deepEqual(Object.keys(manifest.packages),['@lydell/node-pty',f.native]);
 assert.equal(fs.lstatSync(path.join(target,f.native)).isSymbolicLink(),false);assert(fs.existsSync(path.join(target,f.native,'lib/index.js')));assert.equal(fs.existsSync(path.join(target,f.native,'debug.pdb')),false);assert.equal(fs.existsSync(path.join(target,f.native,'source.js.map')),false);
});

test('staging refuses a dependency resolved outside its checkout instead of silently borrowing an ancestor',t=>{
 const f=fixture(t),external=fs.mkdtempSync(path.join(os.tmpdir(),'studio-external-pty-'));t.after(()=>fs.rmSync(external,{recursive:true,force:true}));
 fs.cpSync(f.nativeRoot,external,{recursive:true});fs.rmSync(path.join(f.wrapperRoot,'..','node-pty-win32-x64'));f.link(external,path.join(f.wrapperRoot,'..','node-pty-win32-x64'));
 assert.throws(()=>stageCoreRuntimes({root:f.root,platform:'win32',arch:'x64'}),/inside this checkout/);
});

test('staging refuses a linked target before removing or copying any external files',t=>{
 const f=fixture(t),outside=fs.mkdtempSync(path.join(os.tmpdir(),'studio-stage-target-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));fs.writeFileSync(path.join(outside,'sentinel'),'preserve');
 f.link(outside,path.join(f.root,'.studio/agent-runtimes'));assert.throws(()=>stageCoreRuntimes({root:f.root,platform:'win32',arch:'x64'}),/Linked runtime staging target/);assert.equal(fs.readFileSync(path.join(outside,'sentinel'),'utf8'),'preserve');
});
