import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {policyIo} from "../../agent/skills/policy-io.mjs";

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-policy-io-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const allowed=path.join(root,'allowed.txt'),archived=path.join(root,'archived.txt');
 fs.writeFileSync(allowed,'allowed\n');fs.writeFileSync(archived,'archived\n');
 const checked=[];
 const policy={
  blocked:new Set([archived]),
  assertCurrent(){},
  assertReadable(file){checked.push(file);const value=typeof file==='string'&&file.startsWith('fd:')?file.slice(3):file;if(this.blocked.has(value))throw Error('Archived resource read refused');},
  async revalidate(){}
 };
 return {root,allowed,archived,checked,policy};
}

test('asynchronous wrapper rejects an archived path before any filesystem call',async t=>{
 const f=fixture(t),io=policyIo(promises,f.policy,{asynchronous:true});
 assert.equal(await io.readFile(f.allowed,'utf8'),'allowed\n');
 await assert.rejects(()=>io.readFile(f.archived,'utf8'),/Archived resource read refused/);
});

test('nested fs.promises namespace is wrapped as asynchronous operations',async t=>{
 const f=fixture(t),io=policyIo(fs,f.policy);
 assert.equal(await io.promises.readFile(f.allowed,'utf8'),'allowed\n');
 await assert.rejects(()=>io.promises.readFile(f.archived,'utf8'),/Archived resource read refused/);
 assert.equal(typeof io.constants,'object','non-function namespaces pass through unchanged');
});

test('function properties such as realpathSync.native are intercepted',t=>{
 const f=fixture(t),io=policyIo(fs,f.policy);
 assert.throws(()=>io.realpathSync.native(f.archived),/Archived resource read refused/);
 assert.equal(io.realpathSync.native(f.allowed),fs.realpathSync.native(f.allowed));
});

test('descriptor reads are checked against the path opened earlier',t=>{
 const f=fixture(t),io=policyIo(fs,f.policy);
 const fd=io.openSync(f.allowed,'r');
 try{assert.equal(io.readFileSync(fd,'utf8'),'allowed\n');}finally{io.closeSync(fd);}
 f.policy.blocked.clear();
 const archivedFd=io.openSync(f.archived,'r');
 try{
  f.policy.blocked.add(f.archived);
  assert.throws(()=>io.readFileSync(archivedFd,'utf8'),/Archived resource read refused/);
 }finally{f.policy.blocked.clear();io.closeSync(archivedFd);}
});
