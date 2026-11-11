import test from 'node:test';
import assert from 'node:assert/strict';
import {assetHarness,deferred} from '../helpers/asset-hooks.mjs';

const documents=id=>({documents:[{material_id:id,formula:'Cu',symmetry:{symbol:'Fm-3m'},n_atoms:1}]});
function setup(){const pending=[];const h=assetHarness({component:'MaterialsProjectSearch',override:call=>{const gate=deferred();pending.push({...gate,call});return gate.promise;}});h.find(node=>node.type==='input').props.onChange({target:{value:'Cu'}});h.find(node=>node.type==='select').props.onChange({target:{value:'env-a'}});h.render();return {h,pending};}
const search=h=>h.find(node=>node.type==='button'&&h.text(node)==='搜索结构');
const load=h=>h.find(node=>node.type==='button'&&h.text(node)==='导入并校验');

test('searching before choosing an environment retains candidates through target changes',async()=>{
 const {h,pending}=setup();try{
  h.find(node=>node.type==='select').props.onChange({target:{value:''}});h.render();search(h).props.onClick();pending[0].resolve(documents('mp-cu'));await h.flush();
  assert.equal(load(h).props.disabled,true);
  for(const environment of ['env-a','env-b']){h.find(node=>node.type==='select').props.onChange({target:{value:environment}});h.render();assert.match(h.text(h.find(node=>node.props?.className==='asset-list')),/mp-cu/);assert.equal(load(h).props.disabled,false);}
  load(h).props.onClick();assert.equal(pending[1].call.data.environment_id,'env-b');
  h.render({projectId:'project-b',workerScope:'new-worker'});assert.match(h.text(h.find(node=>node.props?.className==='asset-list')),/mp-cu/);
  pending[1].resolve({path:'/project-a/cu.xyz',sha256:'a'.repeat(64),provenance:{external:{material_id:'mp-cu'}}});await h.flush();assert(!h.all().some(node=>node.type==='Structure'));assert.equal(h.saved.length,0);assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});

test('Materials Project query edits hide old candidates and ignore late search responses',async()=>{
 const {h,pending}=setup();try{await h.flush();search(h).props.onClick();h.find(node=>node.type==='input').props.onChange({target:{value:'Ag'}});h.render();search(h).props.onClick();pending[1].resolve(documents('mp-ag'));await h.flush();assert.match(h.text(h.find(node=>node.props?.className==='asset-list')),/mp-ag/);
  pending[0].resolve(documents('mp-cu'));await h.flush();assert.match(h.text(h.find(node=>node.props?.className==='asset-list')),/mp-ag/);assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});

test('Materials Project import reply is scoped to the project, environment and worker that initiated it',async()=>{
 const {h,pending}=setup();try{await h.flush();search(h).props.onClick();pending[0].resolve(documents('mp-cu'));await h.flush();const click=load(h).props.onClick;click();click();assert.equal(pending.length,2);h.render({projectId:'project-b'});
  pending[1].resolve({path:'/project-a/cu.xyz',sha256:'a'.repeat(64),provenance:{external:{material_id:'mp-cu'}}});await h.flush();assert(!h.all().some(node=>node.type==='Structure'));assert.equal(h.saved.length,0);assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});
