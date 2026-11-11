import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {create,Header} from 'tar';
import {gzipSync} from 'node:zlib';
import {extractNpmArchive} from '../../scripts/cli-archive-source.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-cli-archive-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),directory=path.join(root,'target'),file=path.join(root,'package.tgz');fs.mkdirSync(path.join(source,'package/dist'),{recursive:true});
 fs.writeFileSync(path.join(source,'package/package.json'),JSON.stringify({name:'fixture',version:'1.0.0'}));fs.writeFileSync(path.join(source,'package/dist/main.mjs'),'inert runtime fixture');
 return {root,source,directory,file,archive:()=>create({gzip:true,file,cwd:source},['package'])};
}
test('real npm-shaped gzip tar extracts regular files under one owned root',async t=>{
 const f=fixture(t);await f.archive();const result=await extractNpmArchive(f);
 assert.equal(fs.readFileSync(path.join(f.directory,'dist/main.mjs'),'utf8'),'inert runtime fixture');assert(result.files>=2);assert(result.bytes>0);assert.equal(fs.existsSync(path.join(f.directory,'package')),false);
});
test('archive link entries are rejected before any external write',async t=>{
 const f=fixture(t),external=path.join(f.root,'outside');fs.mkdirSync(external);fs.symlinkSync(external,path.join(f.source,'package','linked'),'junction');await f.archive();
 await assert.rejects(extractNpmArchive(f),/links_refused|TAR_ENTRY_ERROR/);assert.deepEqual(fs.readdirSync(external),[]);
});
test('file count and expanded byte limits reject oversized content',async t=>{
 const f=fixture(t);await f.archive();await assert.rejects(extractNpmArchive({...f,maxFiles:1}),/size_limit|TAR_ENTRY_ERROR/);
 const other=path.join(f.root,'bounded');await assert.rejects(extractNpmArchive({...f,directory:other,maxBytes:4}),/size_limit|TAR_ENTRY_ERROR/);
});
test('aborted extraction does not accept further archive entries',async t=>{
 const f=fixture(t);await f.archive();const controller=new AbortController();controller.abort(Error('cancelled fixture'));
 await assert.rejects(extractNpmArchive({...f,signal:controller.signal}),/cancelled fixture/);
});
test('parent traversal, Windows drive, case collision and hardlinks are rejected',async t=>{
 for(const names of [['package/../escape'],['package/C:/escape'],['package/A.txt','package/a.txt'],['package/link']]){
  const f=fixture(t),blocks=[];
  for(const name of names){const hardlink=name==='package/link',header=new Header({path:name,type:hardlink?'Link':'File',linkpath:hardlink?'outside':'',size:0,mode:0o644});header.encode();blocks.push(header.block);}
  fs.writeFileSync(f.file,gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)])));
  await assert.rejects(extractNpmArchive(f),/invalid_path|duplicate_path|links_refused/);
  assert.equal(fs.existsSync(path.join(f.root,'escape')),false);
 }
});
