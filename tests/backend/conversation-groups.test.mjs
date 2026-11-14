import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {TaskRecords} from '../../backend/main/workspace/task-records.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-group-')),catalog=new Catalog(root),events=[],records=new TaskRecords(catalog,event=>events.push(event));t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});return {root,catalog,events,records};}
test('group deletion persists while preserving conversations, pins, workflows and protected records',t=>{
 const {catalog,records,events}=fixture(t),group=records.createGroup({name:'metad'}),other=records.createGroup({name:'neb'});
 for(const [provider,id]of [['codex','one'],['qwen','two']]){records.remember({provider,threadId:id,groupId:group.id,name:id});records.organize({id:provider+':'+id,pinned:true,groupId:group.id});}
 records.remember({provider:'codex',threadId:'keep',groupId:other.id,name:'keep'});
 for(const kind of ['agent-task','ssh','compute-profile','project','run','settings','credentials'])catalog.put(kind,'protected',{id:'protected',temperature:310,status:'running'});
 const before=catalog.db.prepare('SELECT kind,id,data FROM records WHERE kind != ? AND kind != ?').all('conversation','conversation-project');events.length=0;
 const result=records.deleteGroup({id:group.id});assert.equal(result.conversations.length,2);assert(!records.groups().some(g=>g.id===group.id));
 for(const c of result.conversations){assert.equal(c.groupId,null);assert.equal(c.pinned,true);assert.equal(records.conversation(c.provider,c.threadId).id,c.id);}
 assert.equal(records.conversation('codex','keep').groupId,other.id);
 for(const record of before)assert.equal(catalog.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(record.kind,record.id).data,record.data);
 assert.equal(new TaskRecords(catalog,()=>{}).conversations().length,3);assert.equal(events.filter(e=>e.method==='studio/conversationGroupDeleted').length,1);
 assert.deepEqual(records.deleteGroup({id:group.id}),{id:group.id,conversations:[]});
});
test('group deletion rolls back reassignment and group removal on a write failure',t=>{
 const {catalog,records,events}=fixture(t),group=records.createGroup({name:'rollback'});records.remember({provider:'codex',threadId:'one',groupId:group.id,name:'one'});events.length=0;
 const put=catalog.put.bind(catalog);catalog.put=(kind,...args)=>{if(kind==='deleted-conversation-project')throw Error('Synthetic disk failure');return put(kind,...args);};
 assert.throws(()=>records.deleteGroup({id:group.id}),/disk failure/);assert.equal(records.conversation('codex','one').groupId,group.id);assert(records.groups().some(g=>g.id===group.id));assert.deepEqual(events,[]);
});
test('late remember cannot restore a deleted group, and explicit stale organization is refused',t=>{
 const {records}=fixture(t),group=records.createGroup({name:'old'});records.remember({provider:'codex',threadId:'existing',groupId:group.id,name:'existing'});records.deleteGroup({id:group.id});
 for(const threadId of ['existing','late'])assert.equal(records.remember({provider:'codex',threadId,groupId:group.id,name:threadId}).groupId,null);
 assert.throws(()=>records.organize({id:'codex:existing',pinned:false,groupId:group.id}),/Unknown conversation project/);
 assert.throws(()=>records.remember({provider:'codex',threadId:'foreign',groupId:'never-existed',name:'foreign'}),/Unknown conversation project/);
});
test('delete-group input validation and unknown IDs never mutate the catalog',t=>{
 const {catalog,records}=fixture(t),before=catalog.db.prepare('SELECT * FROM records').all();
 for(const value of [null,{},[],{id:1},{id:''},{id:'x',deleteConversations:true},{id:'x'.repeat(201)},{id:'unknown'}])assert.throws(()=>records.deleteGroup(value));
 assert.deepEqual(catalog.db.prepare('SELECT * FROM records').all(),before);
});
