import test from 'node:test';
import assert from 'node:assert/strict';
import {assetHarness,deferred} from '../helpers/asset-hooks.mjs';

function setup(){const pending=[];const h=assetHarness({override:call=>{const gate=deferred();pending.push({...gate,call});return gate.promise;}});h.change('asset-environment','env-a');h.change('asset-path','/inputs/a.xyz');return {h,pending};}
const result=value=>({n_atoms:value,positions:[[0,0,0]],symbols:['Cu'],cell:[]});

test('asset preview rejects an older response after a newer frame has been requested',async()=>{
 const {h,pending}=setup();try{await h.flush();h.byId('asset-preview').props.onClick();h.render();assert(h.byId('asset-preview').props.disabled);h.change('asset-frame','1');h.byId('asset-preview').props.onClick();h.render();
  assert.equal(pending.length,2);assert.equal(pending[0].call.data.data.frame,0);assert.equal(pending[1].call.data.data.frame,1);
  pending[1].resolve(result(2));await h.flush();assert.equal(h.find(node=>node.type==='Structure').props.data.n_atoms,2);
  pending[0].resolve(result(1));await h.flush();assert.equal(h.find(node=>node.type==='Structure').props.data.n_atoms,2);assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});

for(const changed of ['path','environment','kind','project','worker-scope','connection'])test('asset displayed result is invalidated by '+changed,async()=>{
 const {h,pending}=setup();try{await h.flush();h.byId('asset-preview').props.onClick();pending[0].resolve(result(1));await h.flush();h.byId('asset-preview-result');
  if(changed==='path')h.change('asset-path','/inputs/b.xyz');
  else if(changed==='environment')h.change('asset-environment','env-b');
  else if(changed==='kind'){h.find(node=>node.type==='select'&&node.props.value==='dataset').props.onChange({target:{value:'model'}});h.render();}
  else h.render(changed==='project'?{projectId:'project-b'}:changed==='worker-scope'?{workerScope:'worker-b:1'}:{worker:false});
  assert(!h.all().some(node=>node.props?.['data-testid']==='asset-preview-result'));h.byId('asset-stale-status');
 }finally{h.unmount();}
});

for(const outcome of ['success','failure'])test('registration double click dispatches once and a stale '+outcome+' settles without presenting a result',async()=>{
 const {h,pending}=setup();try{await h.flush();const click=h.byId('asset-register').props.onClick;click();click();assert.equal(pending.length,1);h.render();h.change('asset-path','/inputs/b.xyz');assert.match(h.text(h.byId('asset-stale-status')),/仍可能完成/);
  if(outcome==='success')pending[0].resolve({id:'asset-a'});else pending[0].reject(Error('Old registration failed'));await h.flush();assert(!h.all().some(node=>node.props?.['data-testid']==='asset-register-result'));assert.deepEqual(h.saved,[]);assert.deepEqual(h.errors,[]);assert.match(h.text(h.byId('asset-stale-status')),/旧登记请求已结束/);assert.doesNotMatch(h.text(h.byId('asset-stale-status')),/仍可能完成/);
  h.byId('asset-register').props.onClick();pending[1].resolve({id:'asset-b'});await h.flush();assert.match(h.text(h.byId('asset-register-result')),/asset-b/);assert.equal(h.saved.length,1);
 }finally{h.unmount();}
});

test('settling an old registration cannot clear a newer registration pending state',async()=>{
 const {h,pending}=setup();try{await h.flush();h.byId('asset-register').props.onClick();h.render();h.change('asset-path','/inputs/b.xyz');h.byId('asset-register').props.onClick();await h.flush();assert.equal(pending.length,2);pending[0].resolve({id:'old'});await h.flush();assert.equal(h.byId('asset-register').props.disabled,true);assert(!h.all().some(node=>node.props?.['data-testid']==='asset-register-result'));pending[1].resolve({id:'current'});await h.flush();assert.match(h.text(h.byId('asset-register-result')),/current/);assert.equal(h.saved.length,1);assert.deepEqual(h.errors,[]);}finally{h.unmount();}
});

test('stale errors and unmounted replies cannot affect the current asset form',async()=>{
 const {h,pending}=setup();try{await h.flush();h.byId('asset-preview').props.onClick();h.render({workerScope:'worker-b:2'});pending[0].reject(Error('old worker error'));await h.flush();assert.deepEqual(h.errors,[]);
  h.byId('asset-preview').props.onClick();h.unmount();pending[1].resolve(result(2));await h.flush();assert.deepEqual(h.errors,[]);assert.deepEqual(h.saved,[]);
 }finally{h.unmount();}
});

test('file picker response does not replace a path edited while the picker was open',async()=>{
 const {h,pending}=setup();try{await h.flush();h.find(node=>node.type==='button'&&node.props['aria-label']==='选择').props.onClick();h.change('asset-path','/inputs/manual.xyz');pending[0].resolve('/inputs/chosen.xyz');await h.flush();assert.equal(h.byId('asset-path').props.value,'/inputs/manual.xyz');}finally{h.unmount();}
});

test('returning to the original input identity does not revive its abandoned preview request',async()=>{
 const {h,pending}=setup();try{await h.flush();h.byId('asset-preview').props.onClick();h.change('asset-path','/inputs/b.xyz');h.change('asset-path','/inputs/a.xyz');h.byId('asset-preview').props.onClick();pending[0].resolve(result(1));await h.flush();assert(!h.all().some(node=>node.type==='Structure'));assert(h.byId('asset-preview').props.disabled);pending[1].resolve(result(2));await h.flush();assert.equal(h.find(node=>node.type==='Structure').props.data.n_atoms,2);}finally{h.unmount();}
});

test('current inspection errors are visible and a manual retry can succeed',async()=>{
 const {h,pending}=setup();try{await h.flush();h.byId('asset-preview').props.onClick();pending[0].reject(Error('Fixture inspection rejected'));await h.flush();assert.match(h.text(h.find(node=>node.props?.role==='alert')),/Fixture inspection rejected/);assert.equal(h.errors.length,1);assert(!h.byId('asset-preview').props.disabled);h.byId('asset-preview').props.onClick();pending[1].resolve(result(2));await h.flush();assert.equal(h.find(node=>node.type==='Structure').props.data.n_atoms,2);assert(!h.all().some(node=>node.props?.role==='alert'));}finally{h.unmount();}
});

test('preview requires a current project, path, registered environment and integer frame',async()=>{
 const {h}=setup();try{await h.flush();for(const frame of ['-1','1.5']){h.change('asset-frame',frame);assert(h.byId('asset-preview').props.disabled);h.byId('asset-preview').props.onClick();}h.change('asset-frame','0');h.render({projectId:''});h.byId('asset-preview').props.onClick();h.render({projectId:'project-a',environments:[]});h.byId('asset-preview').props.onClick();assert.deepEqual(h.calls,[]);}finally{h.unmount();}
});
