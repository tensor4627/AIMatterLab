import test from 'node:test';
import assert from 'node:assert/strict';
import {missingResumeInput,parseResumeParameters,replaceResumeParameter} from '../../frontend/features/runs/resume-parameters.mjs';

test('a structured edit changes only the effective JSON member, preserving other raw source',()=>{
 const raw=String.raw`{"checkpoint_files":["prior"],"controls":{"escaped":"\"}:,[]","value":12345678901234567890}, "checkpoint_\u0066iles" : [ "current" ] }`;
 const changed=replaceResumeParameter(raw,'checkpoint_files',['generation/checkpoint 1.pt','generation/checkpoint 2.pt']);
 assert.equal(changed,raw.replace('[ "current" ]','["generation/checkpoint 1.pt","generation/checkpoint 2.pt"]'));
 const added=replaceResumeParameter(changed,'continuation_script','/owned/continue.py');
 assert.equal(parseResumeParameters(added).continuation_script,'/owned/continue.py');
 assert.deepEqual(parseResumeParameters(added).checkpoint_files,['generation/checkpoint 1.pt','generation/checkpoint 2.pt']);
 assert(added.includes('12345678901234567890'));
});

test('sparse writes add into empty or nested JSON and never replace invalid user source',()=>{
 for(const source of ['{}',' {\r\n } ','{"other":[true,{"name":"checkpoint_files"}]}']){
  const result=replaceResumeParameter(source,'checkpoint_files',['step/restart.xyz']);
  assert.deepEqual(parseResumeParameters(result),{...parseResumeParameters(source),checkpoint_files:['step/restart.xyz']});
 }
 assert.throws(()=>replaceResumeParameter('[]','checkpoint_files',['x']),/JSON 对象/);
 assert.throws(()=>replaceResumeParameter('{bad JSON','checkpoint_files',['x']),SyntaxError);
});

test('new-attempt guidance follows each engine’s required names without rejecting extra data',()=>{
 const scenarios=[
  ['gpumd.md',{checkpoint_files:['restart.xyz'],continuation_run_in:'/owned/continue.in'},'continuation_run_in',/run.in/],
  ['gpumd.sampling',{checkpoint_files:['restart.xyz'],continuation_run_in:'/owned/continue.in'},'checkpoint_files',/checkpoint_files/],
  ['hotpp.train',{checkpoint_files:['saved/model.ckpt'],checkpoint:'saved/model.ckpt',continuation_config:'/owned/continue.yaml'},'checkpoint',/HotPP checkpoint/],
  ['pydyn.md',{checkpoint_files:['step/md.json'],continuation_script:'/owned/continue.py'},'continuation_script',/脚本/],
  ['pydyn.sampling',{checkpoint_files:['step/pair.json'],continuation_script:'/owned/continue.py',paired_manifest:'step/pair.json'},'paired_manifest',/配对清单/],
 ];
 for(const [engine,parameters,key,reason] of scenarios){
  assert.equal(missingResumeInput(engine,{...parameters,extension:{temperature:500}}),null);
  assert.match(missingResumeInput(engine,{...parameters,[key]:undefined}),reason);
 }
 assert.match(missingResumeInput('gpumd.md',{checkpoint_files:['unrelated.xyz']}),/restart\.xyz/);
 assert.match(missingResumeInput('pydyn.sampling',{...scenarios[4][1],paired_manifest:'another.json'}),/配对清单/);
 assert.equal(missingResumeInput('pydyn.md',{checkpoint_files:{'older-state.json':true},continuation_script:'/owned/continue.py'}),null);
});
