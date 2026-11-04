import test from 'node:test';
import assert from 'node:assert/strict';

for(const name of ['compute-profiles','compute-connection','worker-restore','worker-status','explicit-worker-binding','task-authoring-binding']){
 test('legacy compute entry retains the actual domain exports: '+name,async()=>{
  const [old,current]=await Promise.all([
   import('../desktop/'+name+'.mjs'),
   import('../backend/main/compute/'+name+'.mjs')
  ]);
  assert.deepEqual(Object.keys(old),Object.keys(current));
  assert(Object.keys(current).length>0);
  for(const key of Object.keys(current))assert.equal(old[key],current[key],key);
 });
}
