// Portable developer-kit behavior only. Never runs the example or any scientific program.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Catalog} from "../../backend/main/workspace/catalog.mjs";
import {createToolPackageRegistry} from "../../backend/main/tools/package-registry.mjs";
import {managedToolSkillContext} from "../../agent/skills/managed-tool-context.mjs";
import {createReadPolicy,legacyGuidanceFacts} from "../../agent/skills/read-policy.mjs";

const skill=fileURLToPath(new URL("../../developer/skills/studio-tool-integration",import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const python=process.env.STUDIO_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
function fixture(t,{fromZip=false}={}){
 let catalog;const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-developer-kit-'));t.after(()=>{
  catalog?.db.close();
  const relative=path.relative(os.tmpdir(),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  function unlock(directory){fs.chmodSync(directory,0o755);for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())unlock(file);else fs.chmodSync(file,0o644);}}unlock(root);fs.rmSync(root,{recursive:true,force:true,maxRetries:3});
 });
 const copied=path.join(root,'external','studio-tool-integration'),cwd=path.join(root,'unrelated-cwd');fs.mkdirSync(cwd);
 if(fromZip)execFileSync(python,['-m','zipfile','-e',skill+'.zip',path.dirname(copied)],{windowsHide:true});
 else fs.cpSync(skill,copied,{recursive:true});
 const output=path.join(root,'author-workspace','cpu-worker-reference-package');
 const run=(script,...args)=>spawnSync(process.execPath,[path.join(copied,'scripts',script),...args],{cwd,encoding:'utf8',windowsHide:true,env:{...process.env,NODE_OPTIONS:''}});
 const create=()=>{const result=run('create-cpu-reference.mjs','--output',output);assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
 catalog=new Catalog(path.join(root,'catalog'));const registry=createToolPackageRegistry({catalog,storeRoot:path.join(root,'registry')});
 return {root,copied,cwd,output,run,create,registry};
}

test('the portable schema, pure validator and fixed reference asset match their canonical sources',()=>{
 for(const [copy,canonical]of [['references/tool-package.schema.json','contracts/tools/tool-package.schema.json'],['references/tool-package.mjs','contracts/tools/tool-package.mjs'],['assets/worker-smoke.py','installation/examples/worker-smoke.py']])assert.equal(sha(fs.readFileSync(path.join(skill,copy))),sha(fs.readFileSync(new URL("../../"+canonical,import.meta.url))));
});

test('the downloaded skill creates and validates a Git delivery package outside the AIMatterLab checkout',async t=>{
 const h=fixture(t,{fromZip:true});
 const {normalizeInlineSchema}=await import(pathToFileURL(path.join(h.copied,'references/tool-package.mjs')).href);
 assert.equal(typeof normalizeInlineSchema,'function');
 assert(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(h.copied,'references/engine-contracts.json'),'utf8')).engines,'trajectory.density'));
 const generated=h.create();assert.equal(generated.scope,'generated_only');assert.equal(generated.installation.status,'not_run');assert.equal(generated.tests.status,'not_run');
 const generatedInstall=fs.readFileSync(path.join(h.output,'install.md'),'utf8');assert.match(generatedInstall,/\n\nAIMatterLab currently supports/);assert.doesNotMatch(generatedInstall,/\n\nStudio currently supports/);
 const checked=h.run('check-manifest.mjs',path.join(h.output,'tool.json'));assert.equal(checked.status,0,checked.stderr);const declaration=JSON.parse(checked.stdout);assert.equal(declaration.scope,'schema_checked');assert.equal(declaration.tests.status,'not_run');assert.equal(declaration.manifest.environment.parallelism.threads,1);assert.equal(declaration.manifest.environment.parallelism.gpus,0);
 const repo=path.join(h.output,'reference-source'),config=sha(fs.readFileSync(path.join(repo,'.git/config'))),index=sha(fs.readFileSync(path.join(repo,'.git/index'))),inspected=h.registry.inspect({package_root:h.output});assert.equal(inspected.scope,'definition_checked');assert.equal(inspected.installation.status,'not_run');assert.equal(inspected.tests.status,'not_run');assert.equal(inspected.source_commit,generated.source_commit);assert.equal(inspected.manifest.repository.commit,generated.source_commit);assert.equal(inspected.delivery_skill.name,'cpu-worker-reference-delivery');
 for(const resource of ['manual.md','install.md','SKILL.md','cpu-worker-reference-tests/smoke/run-test.py','reference-source/worker.py'])assert(inspected.files.some(file=>file.path===resource));
 assert.equal(sha(fs.readFileSync(path.join(repo,'.git/config'))),config);assert.equal(sha(fs.readFileSync(path.join(repo,'.git/index'))),index);assert.equal(execFileSync('git',['-C',repo,'status','--porcelain'],{encoding:'utf8',windowsHide:true}).trim(),'');
 assert(!fs.existsSync(path.join(h.output,'smoke-result.json')));assert(!fs.existsSync(path.join(h.cwd,'smoke-result.json')));assert.equal(h.registry.list({}).length,0);
});

test('relocation preserves content identity while outer test wrappers and non-Git resource directories are versioned',t=>{
 const h=fixture(t);h.create();const first=h.registry.register({package_root:h.output});assert.equal(first.scope,'definition_checked');assert.equal(first.tests.status,'not_run');
 const moved=path.join(h.root,'relocated','cpu-worker-reference-package');fs.cpSync(h.output,moved,{recursive:true});assert.equal(h.registry.inspect({package_root:moved}).package_version,first.package_version);
 const resource=path.join(moved,'fixture-data');fs.mkdirSync(resource);fs.writeFileSync(path.join(resource,'small-input.txt'),'Included outside author Git\n');const manifestPath=path.join(moved,'tool.json'),manifest=JSON.parse(fs.readFileSync(manifestPath));manifest.tests.cases[0].resources=['fixture-data'];fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 const changed=h.registry.inspect({package_root:moved});assert.notEqual(changed.package_version,first.package_version);assert.equal(changed.source_commit,first.source_commit);assert(changed.files.some(file=>file.path==='fixture-data/small-input.txt'));assert.equal(changed.installation.status,'not_run');
 fs.appendFileSync(path.join(moved,'cpu-worker-reference-tests/smoke/run-test.py'),'\n# Changed wrapper, same source commit.\n');assert.notEqual(h.registry.inspect({package_root:moved}).package_version,changed.package_version);assert.equal(h.registry.read({package_id:first.package_id,package_version:first.package_version}).package_version,first.package_version);
});

test('standalone validation enforces optional defaults and actual inspection checks the pinned Git commit',t=>{
 const h=fixture(t);h.create();const manifestPath=path.join(h.output,'tool.json'),original=JSON.parse(fs.readFileSync(manifestPath));
 const invalid=structuredClone(original);invalid.functions[0].parameters=[{id:'label',type:'string',description:'Optional example label',required:false,display:{priority:10,advanced:true,reason:'Rarely changed'}}];fs.writeFileSync(manifestPath,JSON.stringify(invalid));const rejected=h.run('check-manifest.mjs',manifestPath);assert.equal(rejected.status,1);assert.match(rejected.stderr,/requires a default, default_behavior and default_source/);
 const wrong=structuredClone(original);wrong.repository.commit='a'.repeat(40);fs.writeFileSync(manifestPath,JSON.stringify(wrong));assert.equal(h.run('check-manifest.mjs',manifestPath).status,0);assert.throws(()=>h.registry.inspect({package_root:h.output}),/commit_mismatch/);
});

test('the generator refuses an existing destination without modifying author files',t=>{
 const h=fixture(t);h.create();const before=sha(fs.readFileSync(path.join(h.output,'tool.json'))),rejected=h.run('create-cpu-reference.mjs','--output',h.output);assert.equal(rejected.status,1);assert.match(rejected.stderr,/already exists/);assert.equal(sha(fs.readFileSync(path.join(h.output,'tool.json'))),before);
});

test('generated delivery Markdown links connect the registered snapshot to complete bounded manual/test context',async t=>{
 const h=fixture(t);h.create();const record=h.registry.register({package_root:h.output}),context=await managedToolSkillContext({selection:{name:record.delivery_skill.name,path:path.join(record.snapshot_root,record.delivery_skill.path)},record,policy:createReadPolicy(legacyGuidanceFacts())});
 assert.deepEqual(context.attachments.map(item=>item.label),['SKILL.md']);
 // The entry exposes a bounded document index; supporting files are read on demand.
 const expected=['SKILL.md','manual.md','install.md','tool.json','cpu-worker-reference-tests/README.md','cpu-worker-reference-tests/smoke/README.md'];
 const visited=new Set(),pending=[...context.document_ids],texts=[];
 while(pending.length){
  const documentId=pending.shift();if(visited.has(documentId))continue;visited.add(documentId);
  const document=await managedToolSkillContext({selection:{name:record.delivery_skill.name,path:path.join(record.snapshot_root,record.delivery_skill.path)},record,policy:createReadPolicy(legacyGuidanceFacts()),documentId});
  assert.deepEqual(document.attachments.map(item=>item.label),[documentId]);texts.push(document.text);pending.push(...document.document_ids.filter(id=>!visited.has(id)));
 }
 assert.deepEqual([...visited].sort(),expected.sort());const text=texts.join('\n');
 assert(text.includes('--workdir <ABSOLUTE_NEW_OUTPUT_DIR>'));assert(text.includes('Pass requires a real exit code 0'));assert(text.includes('No scientific computation'));assert(!text.includes('time.sleep(.15)'));assert.equal(record.scope,'definition_checked');assert.equal(record.installation.status,'not_run');assert.equal(record.tests.status,'not_run');assert(!fs.existsSync(path.join(record.snapshot_root,'smoke-result.json')));
});

test('the published zip includes every current skill file with identical bytes',()=>{
 const script=fileURLToPath(new URL('../../scripts/package-developer-kit.py',import.meta.url));
 const result=spawnSync(python,['-X','utf8',script,'--check'],{encoding:'utf8',windowsHide:true});
 assert.ifError(result.error);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,'checked');
});
