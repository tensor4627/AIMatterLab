import test from 'node:test';
import assert from 'node:assert/strict';
import {tools,tasks,createPlan,planPrompt} from "../../frontend/features/workflows/workflow-catalog.mjs";
import {validatePlan} from "../../contracts/workflows/plan.mjs";

test('Every task step resolves a declared tool and core unavailable capabilities remain explicit',()=>{
 for(const task of tasks){assert.equal(new Set(task.steps.map(s=>s.id)).size,task.steps.length);for(const step of task.steps)assert(tools.find(t=>t.id===step.tool));for(const tool of task.tools)assert(tools.find(t=>t.id===tool));}
 assert(!tasks.find(t=>t.id==='neb').steps.some(s=>s.required&&s.planned));
 assert(tools.find(t=>t.id==='md').engines.includes('gpumd.neb'));
 assert.match(planPrompt(createPlan('neb')),/gpumd.neb/);
 assert(tasks.find(t=>t.id==='learning').steps.find(s=>s.id==='dft').planned);
 assert.equal(tools.find(t=>t.id==='activelearning').status,'planned');
});
test('Core steps cannot be skipped; optional steps and user inputs round-trip independently',()=>{
 const plan=createPlan('sampling');assert(!plan.steps.find(s=>s.id==='learning').enabled);
 plan.steps.find(s=>s.id==='structure').source='user';plan.steps.find(s=>s.id==='structure').value='/data/initial.xyz';
 assert.deepEqual(validatePlan(plan),plan);
 const corrupted=structuredClone(plan);corrupted.steps.find(s=>s.id==='md').enabled=false;assert.throws(()=>validatePlan(corrupted));
 const duplicate=structuredClone(plan);duplicate.steps[0]=duplicate.steps[1];assert.throws(()=>validatePlan(duplicate));
 assert.throws(()=>validatePlan({...plan,steps:[...plan.steps,{id:'submit-shell',enabled:true,source:'agent',value:'x'}]}));
});
test('Plan prompts retain human inputs, unavailable tools and the review gate without asserting job status',()=>{
 const plan=createPlan('sampling');plan.steps.find(s=>s.id==='model').source='user';plan.steps.find(s=>s.id==='model').value='asset-verified-model';
 plan.steps.find(s=>s.id==='learning').enabled=true;
 const prompt=planPrompt({...plan,id:'workflow-fixture'});assert.match(prompt,/asset-verified-model/);assert.match(prompt,/workflow-fixture/);assert.match(prompt,/blocked/);assert.match(prompt,/停止等待/);
 assert.equal('status' in validatePlan({...plan,status:'succeeded'}),false);
 assert.throws(()=>createPlan('unknown'));
});

test('Hamiltonian entry is discoverable but exposes no backend execution action',()=>{
 const entry=tools.find(tool=>tool.id==='hamiltonian');assert.equal(entry.name,'机器学习哈密顿量');assert.equal(entry.status,'planned');assert.deepEqual(entry.engines,[]);assert.equal(entry.page,entry.id);assert.match(entry.description,/后端待接入/);
});
