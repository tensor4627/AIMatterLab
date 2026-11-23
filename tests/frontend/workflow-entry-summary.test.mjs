import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSteps} from '../../contracts/workflows/task-fields.mjs';
import {keyWorkflowFields,workflowMissingTargets,workflowOutputLabels} from '../../frontend/features/workflows/workflow-entry-summary.mjs';

test('summary prioritizes already recorded structure, elements, atom count, potential and sampling fields',()=>{
 const parameters={engine:'gpumd.sampling',seed:15,structure:{file:'/fixture/atoms.xyz',elements:['Cu','Ni'],atom_count:128},potential:{file:'/fixture/nep.txt'},dynamics:{temperature_K:300}};
 const steps=normalizeSteps([{id:'other',title:'Earlier controls',fields:[{key:'engine',label:'Engine',type:'text',required:true},{key:'seed',label:'Seed',type:'integer',required:true}]}],parameters);
 const before=structuredClone(parameters),selected=keyWorkflowFields(steps,parameters);
 assert.deepEqual(selected.map(item=>item.field.key),['structure.file','structure.elements','structure.atom_count','potential.file','dynamics.temperature_K']);
 assert.deepEqual(parameters,before);
 const uninspected={structure_file:'/owned/Cu128.xyz',atom_selection:[0,1,2]};
 const keys=keyWorkflowFields(normalizeSteps([],uninspected),uninspected).map(item=>item.field.key);
 assert(!keys.some(key=>/elements|symbols|atom_count/.test(key)));
});

test('missing links target only real normalized fields and keep required object drafts separate from review notes',()=>{
 const parameters={temperature:310},requirements=['Queue owner needs to confirm the target'];
 const steps=normalizeSteps([{id:'a',title:'Existing workflow',fields:[{key:'advanced.engine_config',label:'Native options',type:'object',required:true,advanced:true},{key:'temperature',label:'Temperature',type:'number',required:true},{key:'structure_file',label:'Structure',type:'file',required:true}]}],parameters,requirements);
 const targets=workflowMissingTargets(steps,parameters);
 assert.deepEqual(targets.map(({step,field})=>[step.id,field.key]),[['a','structure_file'],['a','advanced.engine_config']]);
 assert(!targets.some(({field})=>requirements.includes(field.key)));
});

test('goal labels only come from saved output references and preserve inference status',()=>{
 const roadmap={outputs:['traj','report','unlisted'],resources:[{id:'structure',label:'Input only'},{id:'traj',label:'Sampled trajectory',basis:'user'},{id:'report',label:'Temperature report',basis:'inferred'}]};
 assert.deepEqual(workflowOutputLabels(roadmap),[{id:'traj',label:'Sampled trajectory',inferred:false},{id:'report',label:'Temperature report',inferred:true}]);
 assert.deepEqual(workflowOutputLabels(undefined),[]);
});
