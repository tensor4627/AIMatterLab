import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {discoverNodeTests,runNodeTests} from '../../scripts/test-node.mjs';
import {runWorkerTests} from '../../scripts/test-worker.mjs';

function fixture(t){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'studio-local-tests-'));
 t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
 for(const name of ['tests/frontend/ui.test.mjs','tests/backend/api.test.mjs','tests/helpers/not-a-test.mjs','backend/worker/tests/test_worker_a.py']){fs.mkdirSync(path.dirname(path.join(cwd,name)),{recursive:true});fs.writeFileSync(path.join(cwd,name),'// fixture, never executed');}
 const calls=[],lines=[],options={cwd,testsRoot:path.join(cwd,'tests'),spawnTarget:(...args)=>{calls.push(args);return {status:0};},write:value=>lines.push(value)};
 return {cwd,calls,lines,options};
}
test('default Node entry discovers every local test once; suites and files intersect without duplicate invocation',t=>{
 const f=fixture(t);assert.equal(discoverNodeTests(f.options.testsRoot).length,2);
 assert.equal(runNodeTests([],f.options),0);assert.equal(f.calls[0][1].filter(arg=>arg.endsWith('.test.mjs')).length,2);
 runNodeTests(['--suite=frontend,frontend','--file=tests/frontend/ui.test.mjs','--test-name-pattern','some behavior'],f.options);
 assert.deepEqual(f.calls[1][1],['--test','--test-name-pattern','some behavior',path.join(f.cwd,'tests/frontend/ui.test.mjs')]);
});
test('Node list does not execute; unknown suites, external paths and empty selections fail visibly',t=>{
 const f=fixture(t);runNodeTests(['--suite=backend','--list'],f.options);assert.deepEqual(f.lines,['tests/backend/api.test.mjs\n']);assert.equal(f.calls.length,0);
 for(const args of [['--suite=typo'],['--file=../engine/tests/tool.test.mjs'],['--suite=agent'],['--suite=frontend','--file=tests/backend/api.test.mjs']])assert.throws(()=>runNodeTests(args,f.options));
});
test('Node runner preserves child failure instead of reporting a selected suite as passed',t=>{
 const f=fixture(t);assert.equal(runNodeTests(['--suite=frontend'],{...f.options,spawnTarget:()=>({status:7})}),7);
});
test('worker inventory is read-only and scoped pattern selects only Studio tests before spawning',t=>{
 const f=fixture(t),calls=[],messages=[],child={},options={cwd:f.cwd,platform:'linux',env:{},preflight:()=>({status:'allowed'}),spawnTarget:(...args)=>{calls.push(args);return child;},write:value=>messages.push(value)};
 assert.equal(runWorkerTests({...options,args:['--list']}).exitCode,0);assert.equal(calls.length,0);
 assert.deepEqual(messages[0].files,['test_worker_a.py']);assert.equal(runWorkerTests({...options,args:['--pattern=test_worker_*.py']}).child,child);assert(calls[0][1].includes('test_worker_*.py'));
 for(const pattern of ['test_missing.py','../../engine/test_tool.py'])assert.equal(runWorkerTests({...options,args:['--pattern='+pattern]}).exitCode,2);
 assert.equal(calls.length,1);
});
