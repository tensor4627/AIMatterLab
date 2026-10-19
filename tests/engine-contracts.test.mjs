import test from 'node:test';import assert from 'node:assert/strict';
import {scientificSpec} from '../shared/deployment.mjs';import {engineContracts} from '../shared/engine-contracts.mjs';
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
