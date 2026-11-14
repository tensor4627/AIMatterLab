import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';

test('native activity uses metadata without decoding covered history and keeps a recoverable legacy fallback',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-history-cost-')),catalog=new Catalog(root);
 t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});
 catalog.put('agent-thread','codex:known',{id:'known',provider:'codex',name:'Metadata',updatedAt:5});
 catalog.put('thread','known',{id:'known',turns:[{items:[{text:'large transcript '.repeat(10000)}]}]});
 catalog.put('thread','legacy',{id:'legacy',name:'Legacy kept',turns:[{items:[{text:'private body'}]}]});
 catalog.put('thread','deleted',{id:'deleted',turns:[]});catalog.put('deleted-conversation','codex:deleted',{id:'codex:deleted'});
 catalog.db.prepare('INSERT INTO records VALUES(?,?,?)').run('thread','damaged','{invalid');
 const decoded=[],decode=catalog.decode.bind(catalog);catalog.decode=(kind,id,data)=>{if(kind==='thread')decoded.push(id);return decode(kind,id,data);};
 const receiver={catalog,deleted:AgentHub.prototype.deleted};
 const result=AgentHub.prototype.threads.call(receiver,'codex');
 assert.deepEqual(result.map(value=>value.id),['known','legacy']);assert.equal(result[0].name,'Metadata');assert.equal(result[1].name,'Legacy kept');
 assert(result.every(value=>!Object.hasOwn(value,'turns')));assert(!decoded.includes('known'));assert(!decoded.includes('deleted'));assert(decoded.includes('legacy'));assert(decoded.includes('damaged'));assert.equal(catalog.recovery().length,1);
});
