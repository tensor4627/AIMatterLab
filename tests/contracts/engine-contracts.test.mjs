import test from 'node:test';import assert from 'node:assert/strict';
import {scientificSpec} from "../../contracts/compute/deployment.mjs";
import {engineContracts,adapterParameters} from "../../contracts/tools/engine-contracts.mjs";

test('Nested human sampling parameters map to actual adapter keys without changing the task',()=>{
 const task={parameters:{engine:'pydyn.sampling',files:['/fixture/model.xyz','/fixture/ase-infer.pt','/fixture/bias.pt','/fixture/run.py'],bias:{input:'/fixture/bias.pt',mode:'static',cv:{size:1},cutoff_A:3}}};const before=structuredClone(task);
 const p=scientificSpec(task).parameters;assert.equal(p.bias_file,'bias.pt');assert.equal(p.structure_file,'model.xyz');assert.equal(p.cv_size,1);assert.equal(p.cutoff,3);assert.equal(p.mode,'static');assert.deepEqual(task,before);
});
test('Conflicting aliases, nonexistent files and invalid metadata never become a runnable spec',()=>{
 const base={engine:'gpumd.sampling',files:['/fixture/run.in','/fixture/model.xyz','/fixture/bias.pt'],bias:{input:'/fixture/bias.pt',mode:'static',cv:{size:1},cutoff_A:3}};
 for(const patch of [{cutoff:4},{bias_file:'/private/bias.pt'},{cv_size:2},{mode:'unsupported'},{bias_file:{path:'bias.pt'}}])assert.throws(()=>scientificSpec({parameters:{...base,...patch}}),/Conflicting|actual scientific files|Unsupported/);
 assert.throws(()=>scientificSpec({parameters:{...base,bias:{...base.bias,cv:{size:0}}}}),/positive integer/);
});
test('Build and evaluator contracts expose real required fields and preserve explicit AOTI selection',()=>{
 const p=scientificSpec({parameters:{engine:'pygas.build',files:['/f/build_bias.py'],bias:{family:'wtmetad',cutoff_A:3},cv:{definition:'distance',unit:'Angstrom',atoms_zero_based:[0,1],pbc_convention:'full periodic MIC'},technical:{output_file:'bias.pt'}}}).parameters;
 for(const key of engineContracts.engines['pygas.build'].required_parameters)assert.notEqual(p[key],undefined,key);
 const sampling=scientificSpec({parameters:{engine:'gpumd.sampling',files:['/f/run.in','/f/model.xyz','/f/bias.pt2','/f/GAScfg.yaml'],bias:{input:'/f/bias.pt2',mode:'wtmetad',cv:{size:1},cutoff_A:3}}});assert.equal(sampling.parameters.bias_file,'bias.pt2');assert(!Object.values(sampling.inputs).some(p=>p.endsWith('.pt')));
});

test('Review cannot become ready with missing adapter facts or required input basenames',()=>{
 assert.throws(()=>scientificSpec({parameters:{engine:'pydyn.sampling',files:['/f/run.py','/f/model.xyz','/f/bias.pt']}}),/引擎技术输入尚未补齐/);
 assert.throws(()=>scientificSpec({parameters:{engine:'gpumd.md',files:['/f/model.xyz']}}),/缺少引擎实际输入文件/);
});

test('Native NEB exposes and checks actual declared controls, never silently drops an unknown driver key',()=>{
 const task={parameters:{engine:'gpumd.neb',files:['/f/run.in'],neb:{optimizer:'fire',max_steps:30,force_tolerance:0.01}}};assert.equal(scientificSpec(task).parameters.neb.max_steps,30);
 task.parameters.neb.driver='run.in';assert.throws(()=>scientificSpec(task),/Unsupported declared engine control: neb.driver/);
 assert(!engineContracts.engines['gpumd.neb'].parameter_groups.neb.allowed_keys.includes('driver'));
});

test('Representative history maps as validation input, while nested multiple walkers cannot bypass the single-walker contract',()=>{
 const task={parameters:{engine:'gpumd.sampling',files:['/f/run.in','/f/model.xyz','/f/GAScfg.yaml','/f/bias.pt','/f/history.txt'],bias:{input:'/f/bias.pt',mode:'wtmetad',cv:{size:1},cutoff_A:3},history:{validation_file:'/f/history.txt',restart:false},dynamics:{walkers:1}}};
 const p=scientificSpec(task).parameters;assert.equal(p.validation_history,'history.txt');assert.equal(p.walkers,1);assert.equal(p.history.restart,false);
 task.parameters.dynamics.walkers=2;assert.throws(()=>scientificSpec(task),/Conflicting|多 walker/);
});


test('NEB owned file fields map exactly to immutable names and leave reviewed parameters unchanged',()=>{
 const task={parameters:{engine:'gpumd.neb',files:['/owned/run.in','/owned/is.xyz','/owned/fs.xyz','/owned/nep.txt'],neb:{initial_file:'/owned/is.xyz',final_file:'/owned/fs.xyz',potential_file:'/owned/nep.txt',structure_files:['/owned/is.xyz','fs.xyz'],potential_files:['nep.txt'],max_steps:31}}};
 const before=structuredClone(task),result=scientificSpec(task);
 assert.deepEqual(result.parameters.neb,{initial_file:'is.xyz',final_file:'fs.xyz',potential_file:'nep.txt',structure_files:['is.xyz','fs.xyz'],potential_files:['nep.txt'],max_steps:31});assert.deepEqual(task,before);
 task.parameters.files=['D:\\owned\\run.in','D:\\owned\\is.xyz','D:\\owned\\fs.xyz','D:\\owned\\nep.txt'];
 task.parameters.neb={initial_file:'/mnt/d/owned/is.xyz',final_file:'D:\\owned\\fs.xyz',potential_file:'nep.txt'};
 assert.deepEqual(scientificSpec(task).parameters.neb,{initial_file:'is.xyz',final_file:'fs.xyz',potential_file:'nep.txt'});
});
test('NEB nested file mapping rejects foreign sources, traversal, mixed invalid lists and wrong types',()=>{
 const task={parameters:{engine:'gpumd.neb',files:['/owned/run.in','/owned/is.xyz','/owned/fs.xyz','/owned/nep.txt'],neb:{}}};
 for(const patch of [{initial_file:'/foreign/is.xyz'},{final_file:'missing.xyz'},{potential_file:'../nep.txt'},{initial_file:{path:'is.xyz'}},{initial_file:''},{structure_files:['is.xyz','/foreign/fs.xyz']},{potential_files:'nep.txt'},{structure_files:[null]}]){
  task.parameters.neb=patch;assert.throws(()=>scientificSpec(task),/actual scientific files/);
 }
 task.parameters.neb={final_file:null,trajectory_input:true,initial_file:'is.xyz'};
 assert.equal(scientificSpec(task).parameters.neb.final_file,null);
});


test('Numerical force-check subset preserves complete CV provenance and rejects hidden science',()=>{
 const task={parameters:{engine:'pydyn.sampling',files:['/f/run.py','/f/model.xyz','/f/bias.pt'],bias_file:'bias.pt',structure_file:'model.xyz',mode:'static',cutoff:4,cv_size:1,atom_selection:Array.from({length:108},(_,i)=>i),validation:{atom_selection:[0,15,31,46,61,76,92,107],fd_step:1e-5,fd_atol:1e-4}}};const before=structuredClone(task);
 const spec=scientificSpec(task);assert.deepEqual(task,before);assert.equal(spec.parameters.atom_selection.length,108);assert.equal(spec.parameters.validation.atom_selection.length,8);
 for(const value of [null,[],{temperature:300},{atom_selection:[]},{atom_selection:[0,0]},{atom_selection:[true]},{atom_selection:[-1]},{atom_selection:Array.from({length:33},(_,i)=>i)},{fd_step:0},{fd_step:.01},{fd_atol:NaN}]){task.parameters.validation=value;assert.throws(()=>scientificSpec(task),/validation|numerical/);}
 task.parameters.validation={fd_step:1e-5};task.parameters.fd_step=1e-4;assert.throws(()=>scientificSpec(task),/conflicting/);
 assert.throws(()=>scientificSpec({parameters:{engine:'gpumd.md',files:['/f/run.in','/f/model.xyz'],validation:{atom_selection:[0]}}}),/numerical/);
});


test('Nested CV atom-group aliases preserve complete provenance and conflict closed',()=>{
 for(const engine of ['gpumd.sampling','pydyn.sampling','bias.validate']){
  const full=Array.from({length:108},(_,i)=>i),p={bias_file:'bias.pt',structure_file:'model.xyz',mode:'static',cutoff:3,cv_size:1,cv:{atom_selection:full},validation:{atom_selection:[0,107]}};
  const result=adapterParameters(engine,p,{'bias.pt':'/f/bias.pt','model.xyz':'/f/model.xyz','run.in':'/f/run.in','GAScfg.yaml':'/f/GAScfg.yaml','run.py':'/f/run.py'});
  assert.deepEqual(result.atom_selection,full);assert.deepEqual(result.validation.atom_selection,[0,107]);assert.equal(p.atom_selection,undefined);
  assert.throws(()=>adapterParameters(engine,{...p,atom_selection:[0,1]},{'bias.pt':'/f/bias.pt','model.xyz':'/f/model.xyz','run.in':'/f/run.in','GAScfg.yaml':'/f/GAScfg.yaml','run.py':'/f/run.py'}),/Conflicting/);
 }
});
