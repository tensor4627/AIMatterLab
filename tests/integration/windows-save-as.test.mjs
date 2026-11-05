import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWindowsSaveAs} from "../../desktop/platform/windows-save-as.mjs";

function fixture(t,choose){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-save-as-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const original=path.join(root,'opened.txt'),project=path.join(root,'project-copy.txt'),destination=path.join(root,'chosen.txt');fs.writeFileSync(original,'original Windows bytes');fs.writeFileSync(project,'project copy');
 const grants=new Map([['old-grant',original]]),dialogs=[],writes=[];
 const save=createWindowsSaveAs({grants,choose:async options=>{dialogs.push(options);return choose?choose({destination,root}):{canceled:false,filePath:destination};},write:(file,content)=>{writes.push(file);fs.writeFileSync(file,content,'utf8');},uuid:()=> 'new-grant'});
 return {save,grants,dialogs,writes,original,project,destination};
}
test('old open grant and renamed/project-saved input never choose the original Windows target',async t=>{
 const f=fixture(t),result=await f.save({id:'old-grant',name:'project-copy.txt',content:'new editor content'});
 assert.equal(f.dialogs.length,1);assert.equal(f.dialogs[0].defaultPath,'project-copy.txt');assert.deepEqual(f.writes,[f.destination]);
 assert.equal(fs.readFileSync(f.original,'utf8'),'original Windows bytes');assert.equal(fs.readFileSync(f.project,'utf8'),'project copy');assert.equal(fs.readFileSync(f.destination,'utf8'),'new editor content');
 assert.deepEqual(result,{id:'new-grant',path:f.destination,name:'chosen.txt'});assert.equal(f.grants.get('old-grant'),f.original);assert.equal(f.grants.get('new-grant'),f.destination);
});
test('cancel keeps old grant/files and returns no replacement state',async t=>{
 const f=fixture(t,()=>({canceled:true,filePath:'ignored'})),before=[...f.grants];assert.equal(await f.save({id:'old-grant',name:'copy.txt',content:'not written'}),null);
 assert.deepEqual(f.writes,[]);assert.deepEqual([...f.grants],before);assert.equal(fs.readFileSync(f.original,'utf8'),'original Windows bytes');assert(!fs.existsSync(f.destination));
});
test('actual filesystem write failure returns no grant/success receipt',async t=>{
 const f=fixture(t,({root})=>({canceled:false,filePath:path.join(root,'missing-parent','file.txt')})),before=[...f.grants];
 await assert.rejects(f.save({id:'old-grant',content:'write must fail'}),/ENOENT/);assert.deepEqual([...f.grants],before);assert.equal(fs.readFileSync(f.original,'utf8'),'original Windows bytes');
});
test('invalid content and original 2MiB bound fail before dialog, grant or write',async t=>{
 const f=fixture(t);for(const content of [undefined,null,12,{},'x'.repeat(2*1024*1024+1)])await assert.rejects(f.save({id:'old-grant',content}),/2 MiB/);
 assert.deepEqual(f.dialogs,[]);assert.deepEqual(f.writes,[]);assert.equal(f.grants.size,1);
 const boundary='x'.repeat(2*1024*1024);await f.save({content:boundary});assert.equal(fs.statSync(f.destination).size,boundary.length);
});
test('ungranted editor uses same picker; picker failure/empty destination cannot create a grant',async t=>{
 const f=fixture(t);assert.equal((await f.save({content:'fresh'})).path,f.destination);assert.equal(f.dialogs[0].defaultPath,'workflow.py');
 const grants=new Map();const invalid=createWindowsSaveAs({grants,choose:async()=>({canceled:false}),write:()=>assert.fail('no write')});await assert.rejects(invalid({content:'x'}),/destination/);assert.equal(grants.size,0);
 const rejected=createWindowsSaveAs({grants,choose:async()=>{throw Error('picker failed');},write:()=>assert.fail('no write')});await assert.rejects(rejected({content:'x'}),/picker failed/);assert.equal(grants.size,0);
});
