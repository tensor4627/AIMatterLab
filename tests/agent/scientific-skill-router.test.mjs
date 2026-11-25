import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {ScientificSkillRouter} from "../../agent/skills/scientific-skill-router.mjs";
import {ScientificSkillContext} from '../../agent/skills/scientific-context.mjs';
import {PROVIDERS} from '../../agent/providers/contracts.mjs';
import {fileURLToPath} from 'node:url';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-route-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'public-cv'));await fs.writeFile(path.join(root,'public-cv','SKILL.md'),'actual public CV instructions');const map={schema_version:1,skills:[{id:'cv',source:'pygas',folder:'public-cv',files:['SKILL.md']}],functions:[{id:'cv.compose',phase:'authoring',skills:['cv'],engines:['pygas.build'],status:'source_guidance'},{id:'env.install',phase:'installation',skills:['cv'],status:'setup_only'}]};return {root,map};}
test('Each authenticated provider needs its own consent before receiving bounded text and a hash receipt',async t=>{
 const {root,map}=await fixture(t);
 let granted;
 const router=new ScientificSkillRouter({map,sourceRoot:()=>root,consent:(provider,source)=>provider===granted&&source==='pygas'});
 for(const provider of PROVIDERS){
  granted=provider;
  const result=await router.read(provider,'cv.compose');
  assert.equal(result.status,'passed');assert.match(result.text,/actual public CV/);
  assert.equal(result.attachments.length,1);assert.match(result.attachments[0].sha256,/^[a-f0-9]{64}$/);
  granted=undefined;
  const denied=await router.read(provider,'cv.compose');
  assert.equal(denied.status,'permission_required');assert.deepEqual(denied.attachments,[]);assert.equal(denied.text,undefined);
 }
 assert.equal((await router.catalog('kimi')).functions[0].permission,'permission_required');await assert.rejects(router.read('other','cv.compose'),/authenticated/);await assert.rejects(router.read('codex','../../private'),/listed/);
});
test('Revoked permission is rechecked even after body reads and no partial source leaks',async t=>{
 const {root,map}=await fixture(t);let checks=0;const router=new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>++checks===1});const result=await router.read('codex','cv.compose');assert.equal(result.status,'permission_required');assert.deepEqual(result.attachments,[]);assert.equal(result.text,undefined);
});
test('a plain HotHam question can reach the bundled scientific reference with no setup selection or external skill grant',async()=>{
 const map=JSON.parse(await fs.readFile(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
 const root=fileURLToPath(new URL('../../agent/builtin-skills/',import.meta.url));
 const router=new ScientificSkillRouter({map,sourceRoot:source=>source==='studio'?root:undefined,consent:()=>false});
 for(const provider of PROVIDERS){
  const context=new ScientificSkillContext(router);
  const entry=await context.prepare('ordinary-chat',provider,{text:'查一下hotham'});
  assert.deepEqual(entry.routes,['software.catalog']);
  assert.equal(entry.status,'passed');
  assert.deepEqual(entry.attachments.map(file=>file.name),['studio-tool-discovery/SKILL.md']);
  const id=router.documentIds('software.catalog').find(name=>name.endsWith('/references/hotham.md'));
  assert(entry.text.includes(id));
  const focused=await router.read(provider,'software.catalog',id);
  assert.equal(focused.status,'passed');
  assert.equal(focused.text,await fs.readFile(path.join(root,id),'utf8'));
 }
});
test('A bound workflow delivers the requested structure guide and offers only its focused reference',async()=>{
 const map=JSON.parse(await fs.readFile(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8'));
 const root=fileURLToPath(new URL('../../agent/builtin-skills/',import.meta.url));
 const router=new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>false});
 const context=new ScientificSkillContext(router);
 for(const [prompt,route,reference] of [
  ['从 Materials Project 导入 mp-30','structure.materials-project','materials-project.json'],
  ['用 ASE 生成一个铜晶胞','structure.ase','ase.json'],
 ]){
  const entry=await context.prepare('workflow','compatible',{text:prompt,hasWorkflow:true,parameters:{engine:'gpumd.md'}});
  assert.equal(entry.status,'passed');assert.deepEqual(entry.routes,['workflow.orchestrate',route]);
  const document='studio-data-workflow/references/'+reference;
  assert.deepEqual(router.documentIds(route).filter(name=>name.includes('/references/')),[document]);
  assert(!entry.attachments.some(file=>file.name===document));
  const focused=await router.read('compatible',route,document);
  assert.equal(focused.status,'passed');assert.equal(focused.text,await fs.readFile(path.join(root,document),'utf8'));
  context.accept('workflow',entry);
 }
});
test('A change to the rendered route instruction invalidates guidance delivery even with identical skill bytes',async t=>{
 const {root,map}=await fixture(t);
 const read=()=>new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>true}).read('codex','cv.compose');
 const before=await read();
 map.functions[0].adaptation='Current route instruction';
 const after=await read();
 assert.equal(after.status,'passed');assert.equal(after.attachments[0].sha256,before.attachments[0].sha256);
 assert.match(after.text,/Current route instruction/);assert.notEqual(after.digest,before.digest);
});
test('Ordinary calculation cannot read installation text; explicit setup allows it',async t=>{
 const {root,map}=await fixture(t);let setup=false,reads=0;const router=new ScientificSkillRouter({map,sourceRoot:()=>{reads++;return root;},consent:()=>true,setupAllowed:()=>setup});assert.equal((await router.read('codex','env.install')).status,'blocked');assert.equal(reads,0);setup=true;assert.equal((await router.read('codex','env.install')).status,'passed');
});
test('Unloaded missing references stay undisclosed; requested missing and oversized entries fail closed',async t=>{
 const {root,map}=await fixture(t);map.skills[0].files.push('missing.md');let router=new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>true});const entry=await router.read('codex','cv.compose');assert.equal(entry.status,'passed');assert.equal(entry.attachments.length,1);assert(entry.document_ids.includes('public-cv/missing.md'));const result=await router.read('codex','cv.compose','public-cv/missing.md');assert.equal(result.status,'blocked');assert.deepEqual(result.attachments,[]);router=new ScientificSkillRouter({map:{...map,skills:[{...map.skills[0],files:['SKILL.md']}]},sourceRoot:()=>root,consent:()=>true,limits:{fileBytes:2}});assert.equal((await router.read('codex','cv.compose')).status,'blocked');
});
test('Map is cloned, paths are bounded and rebind during read is rejected',async t=>{
 const {root,map}=await fixture(t);const router=new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>true});map.skills[0].files=['../private'];assert.equal((await router.read('codex','cv.compose')).status,'passed');assert.throws(()=>new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>true}),/definition/);
 let count=0;const rebind=new ScientificSkillRouter({map:{...map,skills:[{...map.skills[0],files:['SKILL.md']}]},sourceRoot:()=>++count===1?root:path.dirname(root),consent:()=>true});assert.equal((await rebind.read('codex','cv.compose')).status,'blocked');
});

test('Only explicit route reference files are read, invalid reference selections and linked files fail closed',async t=>{
 const {root,map}=await fixture(t);map.skills[0].reference_files=['references/parameters.json','references/install.md'];map.functions[0].reference_files={[map.skills[0].id]:['references/parameters.json']};
 const folder=path.join(root,map.skills[0].folder);await fs.mkdir(path.join(folder,'references'),{recursive:true});await fs.writeFile(path.join(folder,'references/parameters.json'),'actual route parameter rules');await fs.writeFile(path.join(folder,'references/install.md'),'UNRELATED_INSTALL_BODY');
 let router=new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>true});let result=await router.read('codex','cv.compose');assert.equal(result.status,'passed');assert.equal(result.attachments.length,1);assert(!result.text.includes('actual route parameter rules'));assert(!result.text.includes('UNRELATED_INSTALL_BODY'));const detail=await router.read('codex','cv.compose','public-cv/references/parameters.json');assert.equal(detail.status,'passed');assert.equal(detail.text,'actual route parameter rules');
 const bad=structuredClone(map);bad.functions[0].reference_files[map.skills[0].id]=['../private'];assert.throws(()=>new ScientificSkillRouter({map:bad,sourceRoot:()=>root,consent:()=>true}),/reference/);
 const outside=path.join(root,'outside.txt');await fs.writeFile(outside,'PRIVATE');await fs.unlink(path.join(folder,'references/parameters.json'));try{await fs.symlink(outside,path.join(folder,'references/parameters.json'));}catch(e){if(e.code==='EPERM'){t.diagnostic('Windows symlink privilege unavailable; linked-file subcase not run');return;}throw e;}
 result=await router.read('codex','cv.compose','public-cv/references/parameters.json');assert.equal(result.status,'blocked');assert.deepEqual(result.attachments,[]);assert.equal(result.text,undefined);
});

test('Linked reference directory is refused on Windows junctions as well as POSIX symlinks',async t=>{const {root,map}=await fixture(t),outside=await fs.mkdtemp(path.join(os.tmpdir(),'studio-not-public-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));await fs.writeFile(path.join(outside,'secret.md'),'MUST NOT READ');map.skills[0].reference_files=['references/secret.md'];map.functions[0].reference_files={[map.skills[0].id]:['references/secret.md']};await fs.symlink(outside,path.join(root,map.skills[0].folder,'references'),process.platform==='win32'?'junction':'dir');const router=new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>true});const result=await router.read('codex','cv.compose','public-cv/references/secret.md');assert.equal(result.status,'blocked');assert.deepEqual(result.attachments,[]);assert.equal(result.text,undefined);});


test('Custom-CV intent reaches the implemented draft tools and current public guide without granting human actions',async()=>{
 const map=JSON.parse(await fs.readFile(new URL("../../agent/skills/scientific-skill-map.json",import.meta.url),'utf8'));
 const {selectScientificFunctions}=await import("../../agent/skills/scientific-context.mjs");
 assert.deepEqual(selectScientificFunctions({text:'请讨论一个自定义 CV 的公式',parameters:{engine:'gpumd.sampling'}}),['pygas.custom-cv']);
 const router=new ScientificSkillRouter({map,sourceRoot:source=>source==='studio'?fileURLToPath(new URL("../../agent/builtin-skills/",import.meta.url)):undefined,consent:()=>false});
 const route=(await router.catalog('codex')).functions.find(r=>r.id==='pygas.custom-cv');
 assert.equal(route.phase,'authoring');assert.equal(route.permission,'allowed');
 assert.equal(route.status,'implemented_private_draft_registry_and_human_numeric_gate');
 assert.deepEqual(route.tools,['inspect_pygas_catalog','read_pygas_workflow','propose_custom_cv','read_custom_cv','present_task']);
 const result=await router.read('codex',route.id);assert.equal(result.status,'passed');
 assert.equal(result.capability_status,route.status);
 assert.deepEqual(result.attachments.map(file=>file.name).sort(),['studio-cv-bias-planning/SKILL.md']);
 assert(result.document_ids.includes('studio-cv-bias-planning/references/pygas.json'));assert(!result.attachments.some(file=>file.name.endsWith('/plumed.json')));
 for(const id of ['pygas.cv','pygas.bias']){const composition=map.functions.find(item=>item.id===id);assert(composition.reference_files['studio-cv-bias-planning'].includes('references/plumed.json'),'Concrete '+id+' retains its explicit PLUMED equivalence reference');}
 assert.match(result.text,/current conversation/);assert.match(result.text,/Human|human/);
 assert.match(result.text,/requires explicit current-version sharing/);assert.match(result.text,/not a passed numerical report/);
 assert.match(result.text,/This tool never approves, generates implementation code, checks numerics or executes/);
 for(const forbidden of ['approve_formula','approve_code','customCv.validate','customCv.sharing','submit_run'])assert(!route.tools.includes(forbidden));
});

test('GPUMD pyGAS handoff recipe is offered only by sampling and read only on focused request',async t=>{
 const map=JSON.parse(await fs.readFile(new URL('../../agent/skills/scientific-skill-map.json',import.meta.url),'utf8')),document='studio-md-workflow/references/gpumd-pygas-recipe.md',root=fileURLToPath(new URL('../../agent/builtin-skills/',import.meta.url)),recipe=path.join(root,...document.split('/'));
 const inventory=new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>true});
 assert(inventory.documentIds('sampling.gpumd').includes(document));for(const route of map.functions.filter(route=>route.id!=='sampling.gpumd'))assert(!inventory.documentIds(route.id).includes(document));
 const route=structuredClone(map.functions.find(route=>route.id==='sampling.gpumd'));route.skills=['studio-md-workflow'];route.reference_files={'studio-md-workflow':route.reference_files['studio-md-workflow']};const router=new ScientificSkillRouter({map:{schema_version:1,skills:map.skills.filter(skill=>skill.id==='studio-md-workflow'),functions:[route]},sourceRoot:()=>root,consent:()=>true});
 let reads=0;const open=fs.open;fs.open=async function(file,...args){if(path.resolve(file)===recipe)reads++;return open.call(this,file,...args);};t.after(()=>{fs.open=open;});
 const entry=await router.read('codex','sampling.gpumd');assert.equal(entry.status,'passed',entry.reason);assert(entry.document_ids.includes(document));assert(!entry.attachments.some(file=>file.name===document));assert.equal(reads,0);
 const focused=await router.read('codex','sampling.gpumd',document);assert.equal(focused.status,'passed',focused.reason);assert.deepEqual(focused.attachments.map(file=>file.name),[document]);assert.equal(reads,1);assert.equal(focused.text,await fs.readFile(recipe,'utf8'));
});

test('native NEB guidance keeps the reviewed workflow and the delegated independent-job routes reachable', async () => {
 const map = JSON.parse(await fs.readFile(new URL('../../agent/skills/scientific-skill-map.json', import.meta.url), 'utf8'));
 const bundled = fileURLToPath(new URL('../../agent/builtin-skills/', import.meta.url));
 const router = new ScientificSkillRouter({map, sourceRoot: () => bundled, consent: () => false});
 const neb = await router.read('deepseek', 'neb.gpumd');
 assert.equal(neb.status, 'passed');
 assert.match(neb.text, /present_task/);
 assert.match(neb.text, /independent job in ordinary chat/i);
 assert.match(neb.text, /cluster\.lsf-slurm-deployment/);
 assert.doesNotMatch(neb.text, /Execute remain(?:s)? mandatory/i);
 const jobs = await router.read('deepseek', 'cluster.lsf-slurm-deployment');
 assert.equal(jobs.status, 'passed');
 for (const name of ['prepare_compute_run', 'validate_compute_run', 'submit_compute_run']) {
  assert(map.functions.find(route => route.id === jobs.function_id).tools.includes(name));
  assert(jobs.text.includes(name));
 }
});
