import test from 'node:test';
import assert from 'node:assert/strict';
import * as legacy from '../desktop/source-projects.mjs';
import {discoverSources,toolInventory} from '../backend/main/tools/source-projects.mjs';
import {sourceContext} from '../agent/context/source-context.mjs';

test('legacy source exports compose the actual tools owner and pure Agent presentation',()=>{
 assert.deepEqual(Object.keys(legacy).sort(),['discoverSources','sourceContext','toolInventory']);
 assert.equal(legacy.discoverSources,discoverSources);
 assert.equal(legacy.toolInventory,toolInventory);
 assert.equal(legacy.sourceContext,sourceContext);
 const sources=[{id:'pygas',root:'/fixture/source',commit:'a'.repeat(40),dirty:false,files:[{name:'base/colvar.py',sha256:'b'.repeat(64)}]}];
 const before=structuredClone(sources),inventory=toolInventory(sources),text=sourceContext(sources);
 assert.equal(inventory.find(item=>item.id==='pygas').source_status,'passed');
 assert(inventory.every(item=>item.runtime_status==='not_run'));
 assert.equal(inventory.find(item=>item.id==='torchnep').adapter_status,'planned');
 assert(text.includes(JSON.stringify(sources)));
 assert(text.includes('Sources are independent of compute-environment registrations.'));
 assert.deepEqual(sources,before);
 assert.deepEqual(discoverSources({roots:[],ids:[]}),[]);
});
