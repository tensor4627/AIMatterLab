import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

for(const name of ['compute-profiles','compute-connection','worker-restore','worker-status','explicit-worker-binding','task-authoring-binding']){
 test('compute domain exports operate directly after removing the disposable facade: '+name,async()=>{
  assert.equal(fs.existsSync(new URL("../../desktop/"+name+'.mjs',import.meta.url)),false);
  const current=await import('../../backend/main/compute/'+name+'.mjs');
  assert(Object.keys(current).length>0);
 });
}
