import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {ScientificSkillRouter} from '../desktop/scientific-skill-router.mjs';
import {fileURLToPath} from 'node:url';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-route-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'public-cv'));await fs.writeFile(path.join(root,'public-cv','SKILL.md'),'actual public CV instructions');const map={schema_version:1,skills:[{id:'cv',source:'pygas',folder:'public-cv',files:['SKILL.md']}],functions:[{id:'cv.compose',phase:'authoring',skills:['cv'],engines:['pygas.build'],status:'source_guidance'},{id:'env.install',phase:'installation',skills:['cv'],status:'setup_only'}]};return {root,map};}
test('All four authenticated providers load only their consented bounded route with hash receipts',async t=>{
 const {root,map}=await fixture(t),router=new ScientificSkillRouter({map,sourceRoot:()=>root,consent:(provider,source)=>provider==='codex'&&source==='pygas'});
 for(const provider of ['codex','kimi','qwen','deepseek']){const result=await router.read(provider,'cv.compose');assert.equal(result.status,provider==='codex'?'passed':'permission_required');if(provider==='codex'){assert.match(result.text,/actual public CV/);assert.equal(result.attachments.length,1);assert.match(result.attachments[0].sha256,/^[a-f0-9]{64}$/);}else assert.deepEqual(result.attachments,[]);}
 assert.equal((await router.catalog('kimi')).functions[0].permission,'permission_required');await assert.rejects(router.read('other','cv.compose'),/authenticated/);await assert.rejects(router.read('codex','../../private'),/listed/);
});
test('Revoked permission is rechecked even after body reads and no partial source leaks',async t=>{
 const {root,map}=await fixture(t);let checks=0;const router=new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>++checks===1});const result=await router.read('codex','cv.compose');assert.equal(result.status,'permission_required');assert.deepEqual(result.attachments,[]);assert.equal(result.text,undefined);
});
test('Ordinary calculation cannot read installation text; explicit setup allows it',async t=>{
 const {root,map}=await fixture(t);let setup=false,reads=0;const router=new ScientificSkillRouter({map,sourceRoot:()=>{reads++;return root;},consent:()=>true,setupAllowed:()=>setup});assert.equal((await router.read('codex','env.install')).status,'blocked');assert.equal(reads,0);setup=true;assert.equal((await router.read('codex','env.install')).status,'passed');
});
test('Missing attachments and oversized content fail closed instead of reporting a partial loaded route',async t=>{
 const {root,map}=await fixture(t);map.skills[0].files.push('missing.md');let router=new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>true});const result=await router.read('codex','cv.compose');assert.equal(result.status,'blocked');assert.deepEqual(result.attachments,[]);router=new ScientificSkillRouter({map:{...map,skills:[{...map.skills[0],files:['SKILL.md']}]},sourceRoot:()=>root,consent:()=>true,limits:{fileBytes:2}});assert.equal((await router.read('codex','cv.compose')).status,'blocked');
});
test('Map is cloned, paths are bounded and rebind during read is rejected',async t=>{
 const {root,map}=await fixture(t);const router=new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>true});map.skills[0].files=['../private'];assert.equal((await router.read('codex','cv.compose')).status,'passed');assert.throws(()=>new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>true}),/definition/);
 let count=0;const rebind=new ScientificSkillRouter({map:{...map,skills:[{...map.skills[0],files:['SKILL.md']}]},sourceRoot:()=>++count===1?root:path.dirname(root),consent:()=>true});assert.equal((await rebind.read('codex','cv.compose')).status,'blocked');
});

test('Only explicit route reference files are read, invalid reference selections and linked files fail closed',async t=>{
 const {root,map}=await fixture(t);map.skills[0].reference_files=['references/parameters.json','references/install.md'];map.functions[0].reference_files={[map.skills[0].id]:['references/parameters.json']};
 const folder=path.join(root,map.skills[0].folder);await fs.mkdir(path.join(folder,'references'),{recursive:true});await fs.writeFile(path.join(folder,'references/parameters.json'),'actual route parameter rules');await fs.writeFile(path.join(folder,'references/install.md'),'UNRELATED_INSTALL_BODY');
 let router=new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>true});let result=await router.read('codex','cv.compose');assert.equal(result.status,'passed');assert.equal(result.attachments.length,2);assert(!result.text.includes('UNRELATED_INSTALL_BODY'));
 const bad=structuredClone(map);bad.functions[0].reference_files[map.skills[0].id]=['../private'];assert.throws(()=>new ScientificSkillRouter({map:bad,sourceRoot:()=>root,consent:()=>true}),/reference/);
 const outside=path.join(root,'outside.txt');await fs.writeFile(outside,'PRIVATE');await fs.unlink(path.join(folder,'references/parameters.json'));try{await fs.symlink(outside,path.join(folder,'references/parameters.json'));}catch(e){if(e.code==='EPERM'){t.diagnostic('Windows symlink privilege unavailable; linked-file subcase not run');return;}throw e;}
 result=await router.read('codex','cv.compose');assert.equal(result.status,'blocked');assert.deepEqual(result.attachments,[]);assert.equal(result.text,undefined);
});

test('Linked reference directory is refused on Windows junctions as well as POSIX symlinks',async t=>{const {root,map}=await fixture(t),outside=await fs.mkdtemp(path.join(os.tmpdir(),'studio-not-public-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));await fs.writeFile(path.join(outside,'secret.md'),'MUST NOT READ');map.skills[0].reference_files=['references/secret.md'];map.functions[0].reference_files={[map.skills[0].id]:['references/secret.md']};await fs.symlink(outside,path.join(root,map.skills[0].folder,'references'),process.platform==='win32'?'junction':'dir');const router=new ScientificSkillRouter({map,sourceRoot:()=>root,consent:()=>true});const result=await router.read('codex','cv.compose');assert.equal(result.status,'blocked');assert.deepEqual(result.attachments,[]);assert.equal(result.text,undefined);});


test('Custom-CV intent reaches the implemented draft tools and current public guide without granting human actions',async()=>{
 const map=JSON.parse(await fs.readFile(new URL('../desktop/scientific-skill-map.json',import.meta.url),'utf8'));
 const {selectScientificFunctions}=await import('../desktop/scientific-context.mjs');
 assert.deepEqual(selectScientificFunctions({text:'请讨论一个自定义 CV 的公式',parameters:{engine:'gpumd.sampling'}}),['pygas.custom-cv']);
 const router=new ScientificSkillRouter({map,sourceRoot:source=>source==='studio'?fileURLToPath(new URL('../agents/skills/',import.meta.url)):undefined,consent:()=>false});
 const route=(await router.catalog('codex')).functions.find(r=>r.id==='pygas.custom-cv');
 assert.equal(route.phase,'authoring');assert.equal(route.permission,'allowed');
 assert.equal(route.status,'implemented_private_draft_registry_and_human_numeric_gate');
 assert.deepEqual(route.tools,['inspect_pygas_catalog','read_pygas_workflow','propose_custom_cv','read_custom_cv','present_task']);
 const result=await router.read('codex',route.id);assert.equal(result.status,'passed');
 assert.equal(result.capability_status,route.status);
 assert.deepEqual(result.attachments.map(file=>file.name).sort(),['studio-cv-bias-planning/SKILL.md','studio-cv-bias-planning/references/pygas.json']);
 assert(!result.attachments.some(file=>file.name.endsWith('/plumed.json')));
 for(const id of ['pygas.cv','pygas.bias']){const composition=map.functions.find(item=>item.id===id);assert(composition.reference_files['studio-cv-bias-planning'].includes('references/plumed.json'),'Concrete '+id+' retains its explicit PLUMED equivalence reference');}
 assert.match(result.text,/current conversation/);assert.match(result.text,/Human|human/);
 assert.match(result.text,/requires explicit current-version sharing/);assert.match(result.text,/not a passed numerical report/);
 assert.match(result.text,/This tool never approves, generates implementation code, checks numerics or executes/);
 for(const forbidden of ['approve_formula','approve_code','customCv.validate','customCv.sharing','submit_run'])assert(!route.tools.includes(forbidden));
});
