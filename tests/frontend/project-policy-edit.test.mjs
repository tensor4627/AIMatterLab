import test from 'node:test';import assert from 'node:assert/strict';import {createProjectPolicyEditor,editableProjectSpec,projectPolicyChanges} from "../../frontend/features/compute/project-policy-edit.mjs";

const clone=structuredClone;
function fixture(){let current=true,rows=[{id:'original',name:'Compute',unknown_top:{keep:[1,2]},policy:{engines:['pygas.build'],gpus:[0],max_seconds:60,max_concurrent:1,input_roots:['/old'],environments:['env'],future_policy:{keep:true}}}],reads=0,writes=[],hooks={};const api=createProjectPolicyEditor({projectId:'original',engines:['pygas.build','gpumd.sampling'],current:()=>current,read:async()=>{reads++;await hooks.read?.(reads);return clone(rows);},write:async value=>{writes.push(clone(value));await hooks.write?.();rows=[clone(value)];return clone(value);}});return {api,hooks,writes,rows:()=>clone(rows),mutate:fn=>fn(rows),switch:()=>current=false,reads:()=>reads};}
async function draft(f){return (await f.api.open()).spec;}
test('Same parent ID edited;unknown top-level and policy survive exact readback without clone/create',async()=>{const f=fixture(),spec=await draft(f);spec.policy.engines.push('gpumd.sampling');spec.policy.input_roots.push('/new');const result=await f.api.save(spec);assert.equal(result.id,'original');assert.equal(f.writes.length,1);assert.deepEqual(result.unknown_top,{keep:[1,2]});assert.deepEqual(result.policy.future_policy,{keep:true});assert.deepEqual(result.policy.engines,['pygas.build','gpumd.sampling']);assert.deepEqual(result.policy.input_roots,['/old','/new']);assert.equal(f.reads(),3);});
test('Cancel after local changes has zero POST and leaves original untouched',async()=>{const f=fixture(),before=f.rows(),spec=await draft(f);spec.name='Changed';f.api.cancel();await assert.rejects(f.api.save(spec),/unavailable/);assert.equal(f.writes.length,0);assert.deepEqual(f.rows(),before);});
test('Cancel while latest-record read awaits prevents POST',async()=>{const f=fixture(),spec=await draft(f);spec.name='Changed';f.hooks.read=async n=>{if(n===2)f.api.cancel();};await assert.rejects(f.api.save(spec),/unavailable/);assert.equal(f.writes.length,0);});
for(const change of [rows=>rows[0].policy.gpus.push(1),rows=>rows[0].unknown_top.keep.push(3),rows=>rows[0].policy.future_policy.keep=false,rows=>rows.splice(0,1)])test('Any current complete-record conflict blocks before POST '+String(change),async()=>{const f=fixture(),spec=await draft(f);spec.name='Changed';f.mutate(change);await assert.rejects(f.api.save(spec),/conflict/);assert.equal(f.writes.length,0);});
for(const phase of ['open','save'])test('Authoring-only refused at '+phase+' without upgrade',async()=>{const f=fixture();if(phase==='save'){const spec=await draft(f);spec.name='Changed';f.mutate(rows=>rows[0].authoring_only=true);await assert.rejects(f.api.save(spec),/authoring_only/);}else{f.mutate(rows=>rows[0].authoring_only=true);await assert.rejects(f.api.open(),/authoring_only/);}assert.equal(f.writes.length,0);});
for(const property of ['id','authoring_only','unknown_top'])test('Editable JSON cannot supply '+property,async()=>{const f=fixture(),spec=await draft(f);spec.name='Changed';spec[property]=property==='id'?'other':true;await assert.rejects(f.api.save(spec),/invalid_fields/);assert.equal(f.writes.length,0);});
test('Unknown policy JSON cannot replace preserved future fields',async()=>{const f=fixture(),spec=await draft(f);spec.policy.future_policy={keep:false};await assert.rejects(f.api.save(spec),/invalid_fields/);assert.equal(f.writes.length,0);});
test('An explicit zero-GPU edit retains the same project, environments and other policy fields',async()=>{
 const f=fixture(),spec=await draft(f),before=f.rows()[0];
 spec.policy.gpus=[];
 assert.deepEqual(await f.api.save(spec),{...before,policy:{...before.policy,gpus:[]}});
 assert.equal(f.writes.length,1);
});
test('Malformed local GPU lists never issue a project edit request',async()=>{
 const f=fixture(),spec=await draft(f);
 for(const gpus of ['0',null,[true],['1'],[2**53],Array(1)]){
  await assert.rejects(f.api.save({...spec,policy:{...spec.policy,gpus}}),/invalid_fields/);
 }
 assert.equal(f.writes.length,0);
});
test('Dedicated installation grants can be retained while editing GPU IDs in the same project',async()=>{
 const repair=fixture();repair.mutate(rows=>{rows[0].policy.engines=['installation.check'];});
 const spec=await draft(repair);spec.policy.gpus=[];
 const saved=await repair.api.save(spec);
 assert.deepEqual(saved.policy.engines,['installation.check']);
 assert.deepEqual(saved.policy.gpus,[]);
 const generic=fixture(),before=await draft(generic);
 before.policy.engines=['installation.check'];
 await assert.rejects(generic.api.save(before),/invalid_fields/);
 assert.equal(generic.writes.length,0);
});
test('Changed worker/selection during latest read causes zero POST',async()=>{const f=fixture(),spec=await draft(f);spec.name='Changed';f.hooks.read=async n=>{if(n===2)f.switch();};await assert.rejects(f.api.save(spec),/unavailable/);assert.equal(f.writes.length,0);});
test('Late changed owner after dispatched save reports unconfirmed,never claims cancellation',async()=>{const f=fixture(),spec=await draft(f);spec.name='Changed';f.hooks.write=async()=>f.switch();await assert.rejects(f.api.save(spec),/save_unconfirmed/);assert.equal(f.writes.length,1);assert.equal(f.rows()[0].name,'Changed');});
test('No changes or optional absent clusters do not POST',async()=>{const f=fixture(),spec=await draft(f);spec.policy.clusters=[];await assert.rejects(f.api.save(spec),/no_changes/);assert.equal(f.writes.length,0);assert.deepEqual(projectPolicyChanges(editableProjectSpec(f.rows()[0]),spec),[]);});
test('Projection diff explicitly identifies only changed native editable fields',async()=>{const f=fixture(),before=await draft(f),next=clone(before);next.name='New';next.policy.input_roots.push('/new');assert.deepEqual(projectPolicyChanges(before,next).map(row=>row.key),['name','policy.input_roots']);assert.equal('unknown_top'in before,false);assert.equal('future_policy'in before.policy,false);});
test('Concurrent saves cannot issue duplicate POST',async()=>{const f=fixture(),spec=await draft(f);spec.name='Changed';let release;f.hooks.read=n=>n===2?new Promise(r=>release=r):undefined;const first=f.api.save(spec);await new Promise(r=>setTimeout(r,0));await assert.rejects(f.api.save(spec),/busy/);release();await first;assert.equal(f.writes.length,1);});

test('server revision advances without false save mismatch and remains part of the readback check',async()=>{
 let row={...fixture().rows()[0],revision:4},sent;
 const editor=createProjectPolicyEditor({projectId:row.id,engines:['pygas.build'],current:()=>true,read:async()=>[clone(row)],write:async value=>{sent=clone(value);row={...value,revision:5};return clone(row);}});
 const {spec}=await editor.open();spec.name='Approved change';const result=await editor.save(spec);assert.equal(sent.revision,4);assert.equal(result.revision,5);assert.equal(result.name,'Approved change');
});
test('atomic server conflict after the last read is visible and never automatically replayed',async()=>{
 const f=fixture(),spec=await draft(f);spec.name='Changed';f.hooks.write=()=>{throw Error('project_edit_conflict: reload current revision');};await assert.rejects(f.api.save(spec),/^Error: project_edit_conflict$/);assert.equal(f.writes.length,1);assert.equal(f.rows()[0].name,'Compute');
});

