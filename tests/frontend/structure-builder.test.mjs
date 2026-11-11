import test from 'node:test';
import assert from 'node:assert/strict';
import {assetHarness,deferred} from '../helpers/asset-hooks.mjs';

const result={path:'/owned/workspace/structures/generated.xyz',formula:'Ag4',n_atoms:4,provenance:{version:'fixture-ase',assumptions:[{field:'a',source:'ASE reference'}]}};
function setup(override){const h=assetHarness({component:'StructureBuilder',override,props:{projectId:'owned',environments:[{id:'registered',name:'Registered'}]}});h.find(node=>node.props?.['aria-label']==='检查环境').props.onChange({target:{value:'registered'}});h.render();return h;}
const build=h=>h.find(node=>node.type==='button'&&h.text(node).includes('生成'));

test('actual structure builder retains recipe and full source while compacting generated result and assumptions',async()=>{
 const h=setup(async()=>result);try{await h.flush();h.find(node=>node.type==='input'&&node.props.value==='Cu').props.onChange({target:{value:'Ag'}});h.render();build(h).props.onClick();await h.flush();
  assert.deepEqual(h.calls,[{method:'worker.request',data:{method:'POST',target:'/api/structures/create',data:{project_id:'owned',environment_id:'registered',recipe:{kind:'bulk',name:'Ag',repeat:[1,1,1]}}}}]);
  assert.equal(h.errors.length,0);const summary=h.find(node=>node.props?.className==='structure-result-summary');assert.match(h.text(summary),/generated.xyz.*Ag4.*4 atoms.*fixture-ase/);assert(!h.text(summary).includes('/owned/'));
  assert(h.all().some(node=>node.type==='Tooltip'&&node.props.content===result.path));const assumptions=h.find(node=>node.type==='details');assert.equal(assumptions.props.open,undefined);assert.match(h.text(assumptions),/a: ASE reference/);
  assert(h.all().some(node=>node.type==='Tooltip'&&node.props.content.includes('尚未进行能量松弛')));
 }finally{h.unmount();}
});

test('structure creation ignores stale results after recipe or worker ownership changes and prevents duplicate writes',async()=>{
 const pending=[];const h=setup(()=>{const gate=deferred();pending.push(gate);return gate.promise;});try{await h.flush();const click=build(h).props.onClick;click();click();assert.equal(h.calls.length,1);
  h.find(node=>node.type==='input'&&node.props.value==='Cu').props.onChange({target:{value:'Ag'}});h.render();pending[0].resolve(result);await h.flush();assert(!h.all().some(node=>node.type==='Structure'));assert.equal(h.saved.length,0);
  build(h).props.onClick();h.render({workerScope:'another-worker'});pending[1].reject(Error('old source'));await h.flush();assert.deepEqual(h.errors,[]);assert.equal(h.saved.length,0);
 }finally{h.unmount();}
});
