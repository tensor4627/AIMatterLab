import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {syncToolContracts} from '../scripts/sync-tool-contracts.mjs';
import {engineContracts} from '../shared/engine-contracts.mjs';
import {bundledWorkerRuntimeId} from '../desktop/worker-service-version.mjs';

const checkout=fileURLToPath(new URL('..',import.meta.url));
const canonical=fs.readFileSync(new URL('../contracts/tools/engine-contracts.json',import.meta.url));
const packageSchema=fs.readFileSync(new URL('../contracts/tools/tool-package.schema.json',import.meta.url));
const packageValidator=fs.readFileSync(new URL('../contracts/tools/tool-package.mjs',import.meta.url));
const workerReference=fs.readFileSync(new URL('../installation/examples/worker-smoke.py',import.meta.url));
function temporary(t){
 const base=path.resolve(process.env.STUDIO_RESOURCE_TEST_ROOT||os.tmpdir());fs.mkdirSync(base,{recursive:true});
 const root=fs.mkdtempSync(path.join(base,'studio-tool-contract-'));
 t.after(()=>{assert(path.resolve(root).startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 return root;
}
function put(root,name,bytes){const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);return target;}
function python(args){
 const result=spawnSync(process.env.STUDIO_TEST_PYTHON||'python',['-B','-X','utf8',...args],{encoding:'utf8',windowsHide:true,timeout:20000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 if(result.error)throw result.error;
 return result;
}

test('Node old public interface and standalone worker consume the exact canonical engine contract',()=>{
 assert.deepEqual(engineContracts,JSON.parse(canonical.toString('utf8')));
 assert.deepEqual(fs.readFileSync(new URL('../worker/studio_worker/engine_contracts.json',import.meta.url)),canonical);
 assert.equal(syncToolContracts({root:checkout,check:true}).status,'current');
});

test('build synchronizes resources and distributable files include canonical and standalone copies',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(manifest.scripts.build.split(/\s*&&\s*/)[0],'node scripts/sync-tool-contracts.mjs');
 for(const name of ['dev','start'])assert.equal(manifest.scripts[name].split(/\s*&&\s*/)[0],'node scripts/sync-tool-contracts.mjs --check');
 assert.equal(manifest.scripts['check:contracts'],'node scripts/sync-tool-contracts.mjs --check');
 for(const included of ['contracts/**','worker/**','shared/**'])assert(manifest.build.files.includes(included),included);
 assert(manifest.build.asarUnpack.includes('worker/**'));
});

test('synchronization preserves canonical bytes and check refuses stale output without writing',t=>{
 const root=temporary(t),source=put(root,'contracts/tools/engine-contracts.json',canonical);
 put(root,'contracts/tools/tool-package.schema.json',packageSchema);
 put(root,'contracts/tools/tool-package.mjs',packageValidator);put(root,'installation/examples/worker-smoke.py',workerReference);
 assert.throws(()=>syncToolContracts({root,check:true}),/stale/);
 assert(!fs.existsSync(path.join(root,'worker/studio_worker/engine_contracts.json')));
 assert.equal(syncToolContracts({root}).status,'updated');
 assert.equal(syncToolContracts({root,check:true}).status,'current');
 assert.deepEqual(fs.readFileSync(path.join(root,'developer/skills/studio-tool-integration/references/tool-package.mjs')),packageValidator);
 const developerSchema=path.join(root,'developer/skills/studio-tool-integration/references/tool-package.schema.json');fs.writeFileSync(developerSchema,'stale');assert.throws(()=>syncToolContracts({root,check:true}),/stale/);assert.equal(fs.readFileSync(developerSchema,'utf8'),'stale');syncToolContracts({root});assert.deepEqual(fs.readFileSync(developerSchema),packageSchema);
 const target=path.join(root,'worker/studio_worker/engine_contracts.json'),before=fs.readFileSync(target);
 fs.writeFileSync(source,Buffer.concat([canonical,Buffer.from('\n')]));
 assert.throws(()=>syncToolContracts({root,check:true}),/stale/);
 assert.deepEqual(fs.readFileSync(target),before);
 syncToolContracts({root});assert.deepEqual(fs.readFileSync(target),fs.readFileSync(source));
 fs.writeFileSync(source,'{"schema_version":2,"scope":"fixture","engines":{}}');
 const validTarget=fs.readFileSync(target);assert.throws(()=>syncToolContracts({root}),/Unsupported/);assert.deepEqual(fs.readFileSync(target),validTarget);
});

test('actual installer hash matches Node on a standalone worker under a tests parent and Unicode names',t=>{
 const root=temporary(t),source=path.join(root,'tests','source'),runtimeRoot=path.join(root,'runtimes');
 fs.cpSync(path.join(checkout,'worker'),source,{recursive:true,filter:file=>!['tests','__pycache__'].includes(path.basename(file))});
 put(source,'studio_worker/\ue000.py','# source inventory fixture\n');
 put(source,'studio_worker/\u{10000}.py','# source inventory fixture\n');
 put(source,'studio_worker/private-not-shipped.json','{"private_fixture":true}');
 put(source,'tests/ignored.py','# not distributed\n');
 const result=python([path.join(source,'install.py'),'--source',source,'--root',runtimeRoot]);
 assert.equal(result.status,0,result.stderr);
 const installed=JSON.parse(result.stdout);assert.equal(installed.id,bundledWorkerRuntimeId(source));
 assert.deepEqual(fs.readFileSync(path.join(installed.path,'studio_worker/engine_contracts.json')),canonical);
 assert(!fs.existsSync(path.join(installed.path,'studio_worker/private-not-shipped.json')));
 assert(!fs.existsSync(path.join(installed.path,'tests/ignored.py')));
 const loaded=python(['-I','-c','import json,sys;sys.path.insert(0,sys.argv[1]);from studio_worker.engine_contracts import CONTRACTS;print(json.dumps(CONTRACTS))',installed.path]);
 assert.equal(loaded.status,0,loaded.stderr);assert.deepEqual(JSON.parse(loaded.stdout),engineContracts);
 const again=python([path.join(source,'install.py'),'--source',source,'--root',runtimeRoot]);
 assert.equal(again.status,0,again.stderr);assert.deepEqual(JSON.parse(again.stdout),installed);
});

test('checkout installation refuses a stale generated contract before creating a runtime',t=>{
 const root=temporary(t),source=path.join(root,'worker'),runtimeRoot=path.join(root,'execution-root');
 fs.cpSync(path.join(checkout,'worker'),source,{recursive:true,filter:file=>!['tests','__pycache__'].includes(path.basename(file))});
 put(root,'contracts/tools/engine-contracts.json',Buffer.concat([canonical,Buffer.from('\n')]));
 const result=python([path.join(source,'install.py'),'--source',source,'--root',runtimeRoot]);
 assert.notEqual(result.status,0);assert.match(result.stderr,/Generated worker tool contract is stale/);
 assert(!fs.existsSync(runtimeRoot));assert.deepEqual(fs.readFileSync(path.join(source,'studio_worker/engine_contracts.json')),canonical);
});
