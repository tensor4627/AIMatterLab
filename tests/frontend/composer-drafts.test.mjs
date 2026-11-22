import test from 'node:test';
import assert from 'node:assert/strict';
import {createComposerDrafts} from "../../frontend/features/conversations/composer-drafts.mjs";


function fixture(){const values=new Map();let next=0;const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};return {values,storage,create:()=>createComposerDrafts(()=>storage,()=>String(++next))};}

test('file selections stay with the original draft and a late receipt preserves subsequent files and text',()=>{
 const env=fixture(),drafts=env.create();
 const file=(last,name)=>({id:'00000000-0000-4000-8000-00000000000'+last,name,kind:'text',mimeType:'text/plain',size:8});
 const a=file(1,'a.in'),b=file(2,'b.csv'),c=file(3,'c.log');
 const pending=drafts.capture(),scope=drafts.attachmentOwner();drafts.activate('kimi');
 drafts.addToSnapshot(pending,[a]);assert.deepEqual(drafts.files(),[]);
 drafts.activate('codex');assert.deepEqual(drafts.attachmentOwner(),scope);
 drafts.edit('Read A');const sent=drafts.capture();drafts.rebind(sent,'first');
 drafts.edit('A new instruction');drafts.addFiles([b]);assert.equal(drafts.acknowledge(sent),false);
 assert.deepEqual(drafts.files(),[b]);assert.equal(drafts.text(),'A new instruction');
 drafts.appendToDraft('kimi',null,'',[c]);assert.deepEqual(drafts.files(),[b]);
 env.storage.setItem('studio.conversation','codex:first');const restored=env.create();
 assert.deepEqual(restored.files(),[b]);restored.activate('kimi');assert.deepEqual(restored.files(),[c]);
 assert(![...env.values.values()].some(value=>value.includes('base64')));
});

test('provider and exact thread IDs isolate drafts and selected empty local threads restore before hydration',()=>{
 const f=fixture(),drafts=f.create();
 for(const [provider,id,text] of [['codex','same','中文未发送'],['qwen','same','other provider'],['codex','other','other thread']]){drafts.activate(provider,id);drafts.edit(text);}
 f.storage.setItem('studio.conversation','qwen:same');const reload=f.create();assert.deepEqual(reload.owner(),{provider:'qwen',threadId:'same'});assert.equal(reload.text(),'other provider');
 reload.activate('codex','same');assert.equal(reload.text(),'中文未发送');reload.activate('codex','other');assert.equal(reload.text(),'other thread');
});
test('a deliberate new conversation has a fresh identity and per-provider blank drafts survive switching and reload',()=>{
 const f=fixture(),drafts=f.create();drafts.edit('blank codex');drafts.activate('qwen');assert.equal(drafts.text(),'');drafts.edit('blank qwen');drafts.activate('codex');assert.equal(drafts.text(),'blank codex');
 assert.equal(f.create().text(),'blank codex');drafts.activate('codex',null,true);assert.equal(drafts.text(),'');drafts.edit('fresh blank');assert.equal(f.create().text(),'fresh blank');
});
test('only the captured unchanged draft clears on acknowledgement; identical retyping and newer owner text survive',()=>{
 const f=fixture(),drafts=f.create();drafts.activate('codex','first');drafts.edit('submitted');const sent=drafts.capture();drafts.edit('newer text');assert.equal(drafts.acknowledge(sent),false);assert.equal(drafts.text(),'newer text');
 drafts.edit('submitted');assert.equal(drafts.acknowledge(sent),false);const current=drafts.capture();drafts.activate('qwen','second');drafts.edit('another owner');assert.equal(drafts.acknowledge(current),true);assert.equal(drafts.text(),'another owner');drafts.activate('codex','first');assert.equal(drafts.text(),'');
});
test('failed or unknown sends keep their text durable without automatic replay or destructive hydration',()=>{
 const f=fixture(),drafts=f.create();drafts.activate('codex','first');drafts.edit('lost response');drafts.capture();drafts.activate('codex','first');assert.equal(drafts.text(),'lost response');f.storage.setItem('studio.conversation','codex:first');assert.equal(f.create().text(),'lost response');
 drafts.edit('new typing during resume');drafts.activate('codex','first');assert.equal(drafts.text(),'new typing during resume');
});
test('new thread creation and duplicate recovery notifications move the same draft and pending acknowledgement',()=>{
 const f=fixture(),drafts=f.create();drafts.edit('sending');const sent=drafts.capture();drafts.edit('typing during thread/start');drafts.rebind(sent,'old');assert.deepEqual(drafts.owner(),{provider:'codex',threadId:'old'});assert.equal(drafts.text(),'typing during thread/start');
 drafts.rekey('codex','old','fresh');drafts.rekey('codex','old','fresh');assert.equal(drafts.text(),'typing during thread/start');assert.equal(drafts.acknowledge(sent),false);f.storage.setItem('studio.conversation','codex:fresh');assert.equal(f.create().text(),'typing during thread/start');
 drafts.discard('codex','old');assert.equal(drafts.text(),'typing during thread/start');assert.equal(f.create().text(),'typing during thread/start');
});
test('deletion removes only the exact conversation, invalidates pending acknowledgements and opens an empty fresh draft',()=>{
 const f=fixture(),drafts=f.create();drafts.activate('qwen','same');drafts.edit('other provider');drafts.activate('codex','same');drafts.edit('delete me');const pending=drafts.capture();drafts.discard('codex','same');assert.equal(drafts.text(),'');assert.equal(drafts.acknowledge(pending),false);drafts.activate('codex','same');assert.equal(drafts.text(),'');drafts.activate('qwen','same');assert.equal(drafts.text(),'other provider');
});
test('a rekey never overwrites an already edited target draft and preserves the original source separately',()=>{
 const f=fixture(),drafts=f.create();drafts.activate('codex','target');drafts.edit('newer target');drafts.activate('codex','source');drafts.edit('source retained');drafts.rekey('codex','source','target');assert.equal(drafts.text(),'newer target');drafts.activate('codex','source');assert.equal(drafts.text(),'source retained');
});
test('an upload finishes in its original switched draft, and only plain uploads follow a verified replacement',()=>{
 const f=fixture(),drafts=f.create();
 const upload={id:'901ae621-2c29-426b-ad70-0e313208dffc',name:'notes.txt',kind:'text',mimeType:'text/plain',size:9};
 const evidence={...upload,id:'0ffa63b4-5f27-4cde-b457-5b629a2a4b4a',source:{kind:'log',label:'log',revision:'a'.repeat(64),firstLine:1,lastLine:1}};
 drafts.activate('codex','old');
 drafts.edit('original request');
 const pending=drafts.capture();
 drafts.activate('codex','other');
 assert.equal(drafts.addToSnapshot(pending,[upload,evidence]),true);
 assert.deepEqual(drafts.files(),[]);
 drafts.activate('codex','old');
 assert.deepEqual(drafts.files(),[upload,evidence]);
 assert.deepEqual(drafts.rekey('codex','old','recovered',true),{text:'original request',attachmentReview:true});
 assert.deepEqual(drafts.files(),[upload]);
 assert.equal(drafts.addToSnapshot(pending,[upload,evidence]),false);
 assert.deepEqual(drafts.rekey('codex','old','recovered',true),{text:'original request',attachmentReview:false});
 assert.deepEqual(drafts.rekey('codex','recovered','definition-only'),{text:'original request',attachmentReview:true});
 assert.deepEqual(drafts.files(),[]);
});
test('unavailable storage and quota failures keep edits, blank identities and switches usable in memory',()=>{
 for(const storage of [()=>{throw Error('disabled');},()=>({getItem(){return null;},setItem(){throw Error('quota');},removeItem(){throw Error('disabled');}})]){
  let id=0;const drafts=createComposerDrafts(storage,()=>String(++id));drafts.edit('in memory');drafts.activate('qwen');drafts.edit('qwen memory');drafts.activate('codex');assert.equal(drafts.text(),'in memory');drafts.activate('qwen');assert.equal(drafts.text(),'qwen memory');const sent=drafts.capture();assert.equal(drafts.acknowledge(sent),true);assert.equal(drafts.text(),'');
 }
});
test('malformed stored drafts are ignored without interpreting their contents',()=>{
 const f=fixture();f.storage.setItem('studio.conversation','codex:thread');f.storage.setItem('studio.composer.v1.'+JSON.stringify(['codex','thread','thread']),'{broken');assert.equal(f.create().text(),'');
 f.storage.setItem('studio.composer.v1.'+JSON.stringify(['codex','thread','thread']),JSON.stringify({version:2,text:'unsupported'}));assert.equal(f.create().text(),'');
});
test('quota failure while rebinding preserves the only durable source key until the target saves',()=>{
 const f=fixture(),drafts=f.create();drafts.edit('durable blank');const sourceKey=[...f.values.keys()].find(key=>key.includes('["codex","new"')),original=f.storage.setItem;f.storage.setItem=(key,value)=>{if(!f.values.has(key))throw Error('quota for new keys');return original(key,value);};
 const snapshot=drafts.capture();drafts.rebind(snapshot,'new-thread');assert.equal(drafts.text(),'durable blank');assert.equal(JSON.parse(f.values.get(sourceKey)).text,'durable blank');assert.equal(JSON.parse(f.values.get(sourceKey)).migratedTo,'new-thread');drafts.edit('new in-memory text');assert.equal(drafts.text(),'new in-memory text');assert.equal(JSON.parse(f.values.get(sourceKey)).text,'new in-memory text');
});
for(const quota of [false,true])test('migrated new-draft pointers never alias a thread or revive acknowledged text, quota='+quota,()=>{
 const f=fixture(),drafts=f.create();drafts.edit('submitted text');const snapshot=drafts.capture(),oldPointer=f.storage.getItem('studio.composer.v1.new.codex');
 if(quota){const original=f.storage.setItem;f.storage.setItem=(key,value)=>{if(!f.values.has(key))throw Error('quota for new keys');return original(key,value);};}
 drafts.rebind(snapshot,'threadT');assert.equal(drafts.owner().threadId,'threadT');assert.equal(drafts.acknowledge(snapshot),true);drafts.activate('qwen');drafts.activate('codex');assert.deepEqual(drafts.owner(),{provider:'codex',threadId:null});assert.equal(drafts.text(),'');
 const reload=f.create();assert.deepEqual(reload.owner(),{provider:'codex',threadId:null});assert.equal(reload.text(),'');
 // A stale provider pointer can still occur when its write failed: migrated backup is never a new conversation.
 if(quota){f.storage.setItem('studio.composer.v1.new.codex',oldPointer);const stale=f.create();assert.equal(stale.owner().threadId,null);assert.equal(stale.text(),'');}
});
test('deletion after a quota-limited new-to-thread migration removes its backup without touching another owner',()=>{
 const f=fixture(),drafts=f.create();drafts.activate('qwen','keep');drafts.edit('unrelated text');drafts.activate('codex');drafts.edit('delete migrated text');const snapshot=drafts.capture(),backup=[...f.values.keys()].find(key=>key.includes('["codex","new"')),other=[...f.values.keys()].find(key=>key.includes('["qwen","thread","keep"]')),otherValue=f.values.get(other),original=f.storage.setItem;
 f.storage.setItem=(key,value)=>{if(!f.values.has(key))throw Error('quota');return original(key,value);};drafts.rebind(snapshot,'delete-thread');assert(f.values.has(backup));drafts.discard('codex','delete-thread');assert.equal(f.values.has(backup),false);assert.equal(f.values.get(other),otherValue);assert.equal(drafts.text(),'');assert.equal(drafts.acknowledge(snapshot),false);drafts.activate('qwen','keep');assert.equal(drafts.text(),'unrelated text');
});
