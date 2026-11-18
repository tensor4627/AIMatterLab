import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import fixture from '../fixtures/workflow-roadmap.json' with {type:'json'};
import map from '../../agent/skills/scientific-skill-map.json' with {type:'json'};
import {validateRoadmap,analyzeRoadmap,resolveRoadmapInput} from '../../contracts/workflows/roadmap.mjs';
import {TaskRecords} from '../../agent/sessions/task-records.mjs';
import {ScientificSkillRouter} from '../../agent/skills/scientific-skill-router.mjs';
import {selectScientificFunctions} from '../../agent/skills/scientific-context.mjs';

test('requested product traces through a fork and join, preserving repeated invocations and live inputs',()=>{
 const plan=validateRoadmap(fixture),parameters={structure_file:'system.xyz',control_file:'run.in'};
 const result=analyzeRoadmap(plan,parameters);
 assert.deepEqual(result.goals.at(-1),{output:'report',inputs:['structure','model','control'],steps:['md','msd','rdf','report'],unresolved:[]});
 assert.deepEqual(result.depths,{md:1,msd:2,rdf:2,report:3});
 assert.deepEqual(result.findings,[{code:'input_needed',resource:'model'},{code:'confirm',resource:'thermo'}]);
 assert(!analyzeRoadmap(plan,{...parameters,potential_file:'nep.txt'}).findings.some(item=>item.code==='input_needed'));
});

test('partial planning exposes missing sources and unused branches without inventing handoffs',()=>{
 const plan=structuredClone(fixture);
 plan.steps=plan.steps.filter(step=>step.id!=='rdf');
 plan.resources.push({id:'extra',label:'Unused initial selection',basis:'user',field:'extra'});plan.inputs.push('extra');
 plan.steps.push({id:'same_tool',tool:'example.trajectory',label:'Another invocation',inputs:[],outputs:[]});
 const {findings,goals,order}=analyzeRoadmap(validateRoadmap(plan),{extra:0});
 assert(findings.some(item=>item.code==='unused_input'&&item.resource==='extra'));
 assert(findings.some(item=>item.code==='unused_step'&&item.step==='same_tool'));
 assert(!order.includes('same_tool'));
 assert(findings.some(item=>item.code==='no_source'&&item.resource==='rdf'));
 assert(!findings.some(item=>item.code==='input_needed'&&item.resource==='extra'));
 assert.deepEqual(goals.at(-1).unresolved,['rdf']);
});

test('file resources follow exact basenames across list edits and ambiguous matches stay unresolved',()=>{
 const plan=structuredClone(fixture),resource=plan.resources[0];Object.assign(resource,{field:'files',file_name:'model.xyz'});
 validateRoadmap(plan);
 for(const files of [['x/run.in','x/model.xyz'],['x/model.xyz','x/run.in']])assert.equal(resolveRoadmapInput({files},resource).value,'x/model.xyz');
 assert(analyzeRoadmap(plan,{files:['x/model.xyz','y/model.xyz']}).findings.some(item=>item.code==='ambiguous_file'&&item.resource==='structure'));
 assert(analyzeRoadmap(plan,{files:['x/model.xyz.bak']}).findings.some(item=>item.code==='input_needed'&&item.resource==='structure'));
 resource.file_name='../model.xyz';assert.throws(()=>validateRoadmap(plan));
});

test('structural ambiguity is rejected before a plan replaces a draft',()=>{
 for(const change of [
  p=>p.inputs.push('unknown'),p=>p.outputs.push('frames'),p=>p.steps.push(p.steps[0]),
  p=>p.steps[0].inputs.push(p.steps[0].inputs[0]),p=>p.steps[0].outputs[0].resource='model',
  p=>p.steps[0].outputs[0].resource='frames',p=>p.steps[2].inputs[0].resource='report',
  p=>p.resources[0].field='__proto__.secret',p=>p.resources[3].field='temperature',p=>p.schema_version=2,
  p=>p.steps[0].status='passed',p=>p.resources[0].short_label='x'.repeat(17),
  p=>p.steps[0].short_label=' ',p=>p.steps[0].runtime_labels={top:{short_label:'NEP'}}]){
   const plan=structuredClone(fixture);change(plan);assert.throws(()=>validateRoadmap(plan));
 }
});

test('aliases survive validation without changing scientific dependencies',()=>{
 const legacy=structuredClone(fixture);
 for(const item of [...legacy.resources,...legacy.steps]){delete item.short_label;delete item.runtime_labels;}
 const plain=validateRoadmap(legacy),named=validateRoadmap(fixture);
 assert.deepEqual(analyzeRoadmap(named),analyzeRoadmap(plain));
 assert.equal(named.resources[4].short_label,'热力学');assert.deepEqual(named.steps[2].runtime_labels,fixture.steps[2].runtime_labels);
 assert.equal(named.steps[2].runtime.top,'potential');
});

test('task tool results, parameter edits and full subsequent turns retain the same planning context',()=>{
 const values=new Map(),catalog={get:(kind,id)=>values.get(kind+id),put:(kind,id,value)=>values.set(kind+id,structuredClone(value)),
  list:kind=>[...values].filter(([key])=>key.startsWith(kind)).map(([,value])=>value)};
 const records=new TaskRecords(catalog,()=>{});
 const task=records.create({provider:'codex',planningMode:true,request:'Plan MD'});records.attach(task.id,'codex','thread');
 const base={id:task.id,kind:'task-parameters',name:'MD',parameters:{engine:'gpumd.md',potential_file:null},steps:['MD'],missing_fields:['potential_file']};
 const present=(patch,threadId='thread')=>records.event({provider:'codex',method:'item/completed',params:{threadId,item:{tool:'present_task',result:{content:[{type:'text',text:JSON.stringify({...base,...patch})}]}}}});
 present({roadmap:fixture});const revision=records.read(task.id).parameterRevision;
 const changed=structuredClone(fixture);changed.resources[4].basis='user';present({roadmap:changed});assert.equal(records.read(task.id).parameterRevision,revision);
 present({});present({roadmap:{...fixture,inputs:['other']}});
 present({roadmap:fixture},'unrelated');assert.deepEqual(records.read(task.id).roadmap,changed);
 records.edit({id:task.id,changes:{potential_file:'nep.txt'}});
 const observation={execution_id:'observed',snapshot_sha256:'a'.repeat(64),status:'needs_review',observed_at:1000,goals:[{resource:'frames',status:'needs_review'}]};
 catalog.put('roadmap-execution-index','historical',{id:'historical',task_id:task.id,confirmed_at:1,observation});
 const turn=records.prepareTurn('codex',{threadId:'thread',input:[],studioTaskId:task.id});
 const text=turn.input.at(-1).text;assert(text.includes('"tool":"example.trajectory"'));assert(!text.includes('"code":"input_needed","resource":"model"'));
 assert(text.includes(JSON.stringify(observation)));assert.deepEqual(records.read(task.id).artifacts,[]);
});

test('bundled roadmap routing and the example actually read through the scientific skill tool',async()=>{
 const routes=selectScientificFunctions({text:'更新此流程图',hasWorkflow:true});
 assert(routes.includes('workflow.roadmap'));assert(!selectScientificFunctions({text:'解释流程图'}).includes('workflow.roadmap'));
 const router=new ScientificSkillRouter({map,sourceRoot:()=>fileURLToPath(new URL('../../agent/builtin-skills/',import.meta.url)),consent:()=>false});
 const doc=await router.read('deepseek','workflow.roadmap','studio-workflow-roadmap/SKILL.md');
 assert.equal(doc.status,'passed');const example=JSON.parse(doc.text.split('```json')[1].split('```')[0]);
 assert.deepEqual(analyzeRoadmap(validateRoadmap(example)).goals.map(goal=>goal.steps),[['md-1'],['md-1']]);
});
