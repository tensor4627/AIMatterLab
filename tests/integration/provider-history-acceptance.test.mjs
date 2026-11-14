import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {AgentHub} from '../../agent/providers/agent-hub.mjs';

test('actual SQLite namespaced provider index preserves native routing and history sanitation across reopening',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'studio-provider-history-'));let catalog=new Catalog(directory);t.after(()=>{catalog.db.close();fs.rmSync(directory,{recursive:true,force:true});});
 const codex=new EventEmitter();codex.close=()=>{};const makeHub=()=>new AgentHub({codex,root:directory,catalog,vault:{get:()=>null},settings:()=>({}),worker:()=>null}),hub=makeHub(),id='sk-native-opaque';
 hub.remember('compatible',{id,provider:'compatible',name:'Opaque conversation',turns:[]});catalog.put('compatible-codex-thread',id,{schemaVersion:1,id,nativeId:id,nativeTurns:[{id:'sk-turn-opaque',items:[{id:'sk-item-opaque',type:'mcpToolCall',arguments:{id:'sk-synthetic-secret',temperature_K:300},result:{content:[{type:'text',text:'energy_eV=-123.456789'}]}}]}],legacyTurns:[]});
 assert.equal(hub.threads('compatible')[0].id,id);hub.close();catalog.db.close();catalog=new Catalog(directory);assert.equal(makeHub().threads('compatible')[0].id,id);
 const restored=catalog.get('compatible-codex-thread',id),serialized=JSON.stringify(restored);assert.equal(restored.id,id);assert.equal(restored.nativeId,id);assert.equal(restored.nativeTurns[0].id,'sk-turn-opaque');assert.equal(restored.nativeTurns[0].items[0].id,'sk-item-opaque');assert.equal(restored.nativeTurns[0].items[0].arguments.id,'[redacted]');assert.equal(restored.nativeTurns[0].items[0].arguments.temperature_K,300);assert.match(serialized,/-123\.456789/);assert(!serialized.includes('sk-synthetic-secret'));
});
