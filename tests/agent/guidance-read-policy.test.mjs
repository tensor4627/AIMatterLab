import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadPolicy,resolveReadPolicy,legacyGuidanceFacts} from "../../agent/skills/read-policy.mjs";
import {ScientificSkills} from "../../agent/skills/scientific-skills.mjs";
import {ScientificSkillRouter} from "../../agent/skills/scientific-skill-router.mjs";
import {ScientificSkillContext} from "../../agent/skills/scientific-context.mjs";
import {selectedSkillContext} from "../../agent/skills/skill-context.mjs";
import {localSkills} from "../../agent/skills/skills.mjs";
import {PublicRuleEvidence} from "../../agent/skills/public-rule-evidence.mjs";
import {loadPygasSkills} from "../../agent/skills/pygas-skills.mjs";

const sha=text=>createHash('sha256').update(text).digest('hex');
const map={schema_version:1,skills:[{id:'bias',source:'pygas',folder:'delivery',files:['SKILL.md']}],functions:[{id:'pygas.bias',phase:'authoring',skills:['bias'],engines:['pygas.build']},{id:'env.install',phase:'installation',skills:['bias']}]};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-guidance-policy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const delivery=path.join(root,'delivery');fs.mkdirSync(delivery);fs.writeFileSync(path.join(delivery,'SKILL.md'),'name: delivery\nLEGACY BODY');fs.writeFileSync(path.join(delivery,'program.py'),'print(1)');
 const text='Operate the configured tool through its registered entry point. Inputs and outputs are documented here.';
 const facts={schemaVersion:1,revision:'authority-1',state:'active',applicableFunctions:['pygas.bias','env.install'],package:{id:'pygas',version:'1',manifestSha256:'a'.repeat(64),sourceCommit:'b'.repeat(40)},workerBinding:{distribution:'Fixture',root:'/worker',port:8888},target:{kind:'local',projectId:'project',environmentId:'env',fingerprint:'c'.repeat(64)},activation:{id:'activation',revision:'1',configurationId:'configuration'},archivedResources:[{id:'delivery',role:'delivery',paths:[path.join(delivery,'SKILL.md')]},{id:'installation',role:'installation',paths:[path.join(root,'install')]},{id:'worker-delivery',role:'configuration',paths:['/worker/package/configuration']}],executionSkill:{id:'pygas-execution',sha256:sha(text),text,resources:[]}};
 return {root,delivery,facts};
}
function archivedTrap(paths){
 const counts=Object.fromEntries(paths.map(file=>[file,{exists:0,readdir:0,stat:0,open:0,read:0}])),restore=[];
 const names={existsSync:'exists',readdirSync:'readdir',realpathSync:'stat',statSync:'stat',lstatSync:'stat',openSync:'open',readFileSync:'read',realpath:'stat',stat:'stat',lstat:'stat',open:'open',readFile:'read',readdir:'readdir'};
 for(const api of [fs,promises])for(const [name,kind]of Object.entries(names))if(typeof api[name]==='function'){
  const original=api[name];api[name]=function(file,...args){if(typeof file==='string')for(const archived of paths)if(file===archived||file.startsWith(archived+path.sep)||file.startsWith(archived+'/')){counts[archived][kind]++;throw Error('Archived filesystem operation '+name);}return original.call(this,file,...args);};restore.push(()=>{api[name]=original;});
 }
 return {counts,restore:()=>restore.reverse().forEach(run=>run()),assertZero:()=>{for(const value of Object.values(counts))assert.deepEqual(value,{exists:0,readdir:0,stat:0,open:0,read:0});}};
}

test('active automatic routes, repeated context, MCP and both catalogs never consult archived bodies or source discovery',async t=>{
 const f=fixture(t),scope={provider:'codex',threadId:'thread',taskId:'task',checkCurrent:()=>true};let sourceCalls=0,allowed=true;
 const service=new ScientificSkills({map,bundledRoot:f.root,studioRoot:f.root,sources:()=>{sourceCalls++;throw Error('No source discovery in active mode');},settings:()=>({pygasSkillProviders:allowed?['codex']:[]}),resolveGuidance:async actual=>{assert.equal(actual,scope);return f.facts;},assertScope:actual=>assert.equal(actual,scope)});
 const trap=archivedTrap(f.facts.archivedResources.flatMap(resource=>resource.paths));
 try{
  const policy=await service.resolvePolicy(scope),first=await service.context.prepare('thread','codex',{text:'WTMetaD',scope,policy});assert.equal(first.status,'passed');assert(first.text.includes(f.facts.executionSkill.text));service.context.accept('thread',first);
  assert.equal((await service.context.prepare('thread','codex',{text:'WTMetaD',scope,policy})).status,'already_loaded');
  assert.equal((await service.call('read_scientific_skill',{function_id:'pygas.bias'},scope)).phase,'execution');
  assert.equal((await service.call('read_scientific_skill',{function_id:'pygas.bias',document_id:f.facts.executionSkill.id},scope)).text,f.facts.executionSkill.text);
  assert.equal((await service.call('scientific_skill_catalog',{},scope)).execution.name,f.facts.executionSkill.id);
  const catalog=localSkills([f.delivery,path.join(f.root,'install')],{policy});assert.equal(catalog.length,1);assert.equal(catalog[0].source,'execution snapshot');
  assert.equal((await selectedSkillContext({selection:catalog[0],registered:catalog,policy,scope})).text.includes(f.facts.executionSkill.text),true);
  assert.equal((await loadPygasSkills({text:'WTMetaD',sources:[],consented:true,policy})).phase,'execution');
  allowed=false;assert.equal((await service.call('read_scientific_skill',{function_id:'pygas.bias'},scope)).status,'permission_required');
  assert.equal(sourceCalls,0);trap.assertZero();t.diagnostic('archived operations '+JSON.stringify(trap.counts));
 }finally{trap.restore();}
});

test('manual archived entries, recursive references and source receipts are denied before their first file operation',async t=>{
 const f=fixture(t),bundle=path.join(f.root,'bundle'),entry=path.join(bundle,'studio-compute-workflow','SKILL.md'),reference=path.join(bundle,'studio-compute-workflow','references','sealed.md');fs.mkdirSync(path.dirname(reference),{recursive:true});fs.writeFileSync(entry,'name: studio-compute-workflow\n[sealed](references/sealed.md)');fs.writeFileSync(reference,'ARCHIVED REFERENCE');
 f.facts.archivedResources.push({id:'reference',role:'configuration',paths:[reference]});const policy=createReadPolicy(f.facts),trap=archivedTrap(f.facts.archivedResources.flatMap(resource=>resource.paths));
 try{
  await assert.rejects(selectedSkillContext({selection:{path:path.join(f.delivery,'SKILL.md'),name:'delivery'},registered:[{path:path.join(f.delivery,'SKILL.md'),name:'delivery'}],registeredRoots:[f.delivery],bundledRoot:bundle,policy}),/archived/);
  await assert.rejects(selectedSkillContext({selection:{path:entry,name:'studio-compute-workflow'},registered:[{path:entry,name:'studio-compute-workflow'}],registeredRoots:[bundle],bundledRoot:bundle,policy}),/attachment_unavailable/);
  const evidence=await new PublicRuleEvidence(()=>f.root).inspect({source_receipt:{local_files:[{source_id:'pygas',path:'delivery/SKILL.md',sha256:'d'.repeat(64)}]}},{policy});assert.equal(evidence.files[0].status,'blocked');
  assert.equal(policy.allowsPath(path.join(f.delivery,'program.py')),true);trap.assertZero();t.diagnostic('manual/reference/source operations '+JSON.stringify(trap.counts));
 }finally{trap.restore();}
});

test('stale and revoked activation cannot use the legacy route or the old setup gate',async t=>{
 const f=fixture(t),trap=archivedTrap(f.facts.archivedResources.flatMap(resource=>resource.paths));
 try{for(const state of ['stale','revoked']){
  const facts={...f.facts,state},policy=createReadPolicy(facts),router=new ScientificSkillRouter({map,sourceRoot:()=>{throw Error('No legacy fallback');},consent:()=>true,setupAllowed:()=>true,resolveGuidance:async()=>facts});
  for(const route of map.functions)assert.equal((await router.read('codex',route.id)).status,'blocked');
  assert.deepEqual(localSkills([f.delivery],{policy}),[]);assert.equal(loadPygasSkills({text:'WTMetaD',sources:[],consented:true,policy}).status,'blocked');
 }trap.assertZero();}finally{trap.restore();}
});

test('legacy tools retain existing source reads and explicit setup behavior',async t=>{
 const f=fixture(t),router=new ScientificSkillRouter({map,sourceRoot:()=>f.root,consent:()=>true,setupAllowed:()=>true,resolveGuidance:async()=>legacyGuidanceFacts()});
 assert((await router.read('codex','pygas.bias')).text.includes('LEGACY BODY'));assert.equal((await router.read('codex','env.install')).status,'passed');assert.equal(localSkills([f.delivery])[0].name,'delivery');
});

test('changed scope, changed authority and invalid execution snapshots fail before source access',async t=>{
 const f=fixture(t);let current=true,revision='authority-1';const scope={checkCurrent:()=>current};
 const policy=await resolveReadPolicy({resolveGuidance:async()=>({...f.facts,revision})},scope);current=false;assert.throws(()=>policy.allowsPath(f.root),/scope changed/);current=true;revision='authority-2';await assert.rejects(policy.revalidate(),/activation changed/);
 await assert.rejects(resolveReadPolicy({resolveGuidance:async()=>({...f.facts,executionSkill:{...f.facts.executionSkill,text:'tampered'}})}),/snapshot/);
 assert.throws(()=>{policy.facts.state='legacy_unconfigured';},TypeError);
});

test('sharing revoked during execution snapshot preparation is rechecked before returning any text',async t=>{
 const f=fixture(t);let granted=true,resolutions=0;
 const router=new ScientificSkillRouter({map,sourceRoot:()=>{throw Error('No source read');},consent:()=>granted,resolveGuidance:async()=>{if(++resolutions===3)granted=false;return f.facts;}});
 const result=await router.read('codex','pygas.bias');assert.equal(result.status,'permission_required');assert.equal(result.text,undefined);assert.deepEqual(result.attachments,[]);
});

test('activation during a legacy stat prevents the following descriptor open and returns no partial body',async t=>{
 const f=fixture(t);let activated=false,opens=0;
 const originalStat=promises.stat,originalOpen=promises.open;
 promises.stat=async function(file,...args){const result=await originalStat.call(this,file,...args);if(file===path.join(f.delivery,'SKILL.md'))activated=true;return result;};
 promises.open=async function(...args){opens++;return originalOpen.apply(this,args);};
 try{
  const router=new ScientificSkillRouter({map,sourceRoot:()=>f.root,consent:()=>true,resolveGuidance:async()=>activated?f.facts:legacyGuidanceFacts()});
  const result=await router.read('codex','pygas.bias');assert.equal(result.status,'blocked');assert.equal(result.text,undefined);assert.deepEqual(result.attachments,[]);assert.equal(opens,0);
 }finally{promises.stat=originalStat;promises.open=originalOpen;}
});

test('path policy preserves Windows case aliases, Linux case distinctions and program siblings',async t=>{
 const f=fixture(t);f.facts.archivedResources.push({id:'windows',role:'delivery',paths:['D:\\Package\\Delivery\\SKILL.md']},{id:'linux',role:'configuration',paths:['/worker/Config']});
 const policy=createReadPolicy(f.facts);assert.equal(policy.allowsPath('d:/package/delivery/SKILL.md'),false);assert.equal(policy.allowsPath('/worker/Config/setup.md'),false);assert.equal(policy.allowsPath('/worker/config/setup.md'),true);assert.equal(policy.allowsPath('D:/Package/Delivery/program.py'),true);
});

test('one configured package does not replace unrelated tools, and an empty applicability set never captures scientific routes',async t=>{
 const f=fixture(t),otherRoot=path.join(f.root,'other-source'),other=path.join(otherRoot,'agents','skills','nep');fs.mkdirSync(other,{recursive:true});fs.writeFileSync(path.join(other,'SKILL.md'),'name: other-nep\nOTHER TOOL GUIDANCE');
 const extended=structuredClone(map);extended.skills.push({id:'nep',source:'gpumd',folder:'nep',files:['SKILL.md']});extended.functions.push({id:'training.nep',phase:'authoring',skills:['nep'],engines:['nep.train']});
 const scope={provider:'codex'},service=new ScientificSkills({map:extended,bundledRoot:f.root,sources:()=>{throw Error('Use registered metadata');},registeredSources:()=>[{id:'gpumd',root:otherRoot}],settings:()=>({pygasSkillProviders:['codex'],scientificSkillProviders:{gpumd:['codex']}}),resolveGuidance:async()=>f.facts});
 const trap=archivedTrap(f.facts.archivedResources.flatMap(resource=>resource.paths));
 try{
  for(const state of ['active','stale','revoked']){f.facts.state=state;const result=await service.call('read_scientific_skill',{function_id:'training.nep'},scope);assert(result.text.includes('OTHER TOOL GUIDANCE'));assert(!result.text.includes(f.facts.executionSkill.text));}
  f.facts.state='active';f.facts.applicableFunctions=[];
  const catalog=await service.catalog('codex',scope);assert.equal(catalog.functions.find(route=>route.id==='training.nep').guidanceState,'legacy_unconfigured');assert.deepEqual(catalog.functions.find(route=>route.id==='training.nep').document_ids,['nep/SKILL.md']);
  const policy=await service.resolvePolicy(scope),local=localSkills([path.dirname(other)],{policy});assert.deepEqual(local.map(item=>item.name).sort(),['other-nep','pygas-execution']);
  assert.equal((await selectedSkillContext({selection:local[0],registered:local,policy})).text.includes(f.facts.executionSkill.text),true);
  assert.equal(policy.appliesTo({id:'pygas.bias',engines:['pygas.build']}),false);
  const byEngine=createReadPolicy({...f.facts,engines:['pygas.build']});assert.equal(byEngine.appliesTo({id:'pygas.bias',engines:['pygas.build']}),true);assert.equal(byEngine.appliesTo({id:'training.nep',engines:['nep.train']}),false);trap.assertZero();
 }finally{trap.restore();}
});

test('trusted repair grant opens only exact resource IDs for its live owner and revision',async t=>{
 const f=fixture(t),scope={provider:'codex',threadId:'thread',taskId:'task',serial:7,epoch:4,checkCurrent:()=>true};
 const grant={id:'human-repair',purpose:'repair',resourceIds:['delivery'],owner:{provider:'codex',threadId:'thread',taskId:'task',serial:7},authorityRevision:f.facts.revision,activationId:f.facts.activation.id,expiresAt:Date.now()+60000};
 f.facts.readGrant=grant;const policy=await resolveReadPolicy({resolveGuidance:async()=>f.facts},scope),file=path.join(f.delivery,'SKILL.md');assert.equal(policy.isGrantedPath(file),true);assert.equal(policy.isGrantedPath(path.join(f.delivery,'program.py')),false);assert.equal(policy.allowsPath(path.join(f.root,'install','SKILL.md')),false);
 const router=new ScientificSkillRouter({map,sourceRoot:()=>f.root,consent:()=>true,resolveGuidance:async()=>f.facts});
 const result=await router.read('codex','env.install',undefined,{scope});assert.equal(result.status,'passed');assert(result.text.includes('LEGACY BODY'));assert.equal(result.phase,'installation');
 for(const change of [
  {expiresAt:Date.now()-1},{authorityRevision:'old'},{activationId:'old'},
  {resourceIds:['unknown']},{owner:{...grant.owner,serial:8}},
  {owner:{...grant.owner,threadId:'other'}},{owner:{...grant.owner,taskId:'other'}},
  {owner:{...grant.owner,provider:'kimi'}},
 ]){const denied=createReadPolicy({...f.facts,readGrant:{...grant,...change}},{scope});assert.equal(denied.allowsPath(file),false);}
 const lease=createReadPolicy({...f.facts,readGrant:{...grant,owner:{provider:'codex',threadId:'thread',taskId:'task',leaseEpoch:4}}},{scope});assert.equal(lease.allowsPath(file),true);
 const normalized=createReadPolicy(f.facts,{scope:{provider:'codex',threadId:'thread',taskId:'task'},assertScope:()=>scope});assert.equal(normalized.allowsPath(file),true);
 assert.equal(policy.isGrantedPath(path.join(f.delivery,'..','install','SKILL.md')),false);
});

test('expired or changed-scope grants perform zero archived file operations, including after revalidation',async t=>{
 const f=fixture(t),scope={provider:'codex',threadId:'thread',taskId:'task',serial:1};let now=Date.now(),current=true;
 f.facts.readGrant={id:'human-configure',purpose:'configure',resourceIds:['delivery'],owner:{...scope},authorityRevision:f.facts.revision,activationId:f.facts.activation.id,expiresAt:now+1000};
 const originalNow=Date.now;Date.now=()=>now;
 const policy=await resolveReadPolicy({resolveGuidance:async()=>f.facts,assertScope:()=>{if(!current)throw Error('Owner changed');}},scope),trap=archivedTrap(f.facts.archivedResources.flatMap(resource=>resource.paths));
 try{
  now+=1001;await policy.revalidate();assert.equal(policy.hasReadGrant(),false);
  await assert.rejects(selectedSkillContext({selection:{path:path.join(f.delivery,'SKILL.md'),name:'delivery'},registered:[{path:path.join(f.delivery,'SKILL.md'),name:'delivery'}],registeredRoots:[f.delivery],bundledRoot:f.root,policy}),/archived/);
  current=false;assert.throws(()=>policy.allowsPath(path.join(f.delivery,'SKILL.md')),/Owner changed/);trap.assertZero();
 }finally{trap.restore();Date.now=originalNow;}
});

test('a granted parent entry does not silently grant an archived reference in its subtree',async t=>{
 const f=fixture(t),bundle=path.join(f.root,'bundle'),entry=path.join(bundle,'studio-compute-workflow','SKILL.md'),reference=path.join(bundle,'studio-compute-workflow','references','sealed.md');fs.mkdirSync(path.dirname(reference),{recursive:true});fs.writeFileSync(entry,'name: studio-compute-workflow\n[sealed](references/sealed.md)');fs.writeFileSync(reference,'SEALED REF');
 const scope={provider:'codex',threadId:'thread',taskId:null,serial:1};f.facts.archivedResources.push({id:'parent',role:'delivery',paths:[entry]},{id:'reference',role:'configuration',paths:[reference]});
 f.facts.readGrant={id:'human-update',purpose:'update',resourceIds:['parent'],owner:{...scope},authorityRevision:f.facts.revision,activationId:f.facts.activation.id,expiresAt:Date.now()+60000};
 const policy=createReadPolicy(f.facts,{scope}),trap=archivedTrap([reference]);
 try{await assert.rejects(selectedSkillContext({selection:{path:entry,name:'studio-compute-workflow'},registered:[{path:entry,name:'studio-compute-workflow'}],registeredRoots:[bundle],bundledRoot:bundle,policy}),/attachment_unavailable/);trap.assertZero();}finally{trap.restore();}
});

test('global archives with no selected configuration use registered metadata in catalog, routes and source receipts',async t=>{
 const f=fixture(t),otherRoot=path.join(f.root,'other-source'),nep=path.join(otherRoot,'agents','skills','nep');fs.mkdirSync(nep,{recursive:true});fs.writeFileSync(path.join(nep,'SKILL.md'),'name: other-nep\nUNCONFIGURED OTHER TOOL');
 const extended=structuredClone(map);extended.skills.push({id:'nep',source:'gpumd',folder:'nep',files:['SKILL.md']});extended.functions.push({id:'training.nep',phase:'authoring',skills:['nep'],engines:['nep.train']});
 const facts={...legacyGuidanceFacts(),revision:'global-archive',archivedResources:f.facts.archivedResources},scope={provider:'codex'};let discoveries=0;
 const service=new ScientificSkills({map:extended,bundledRoot:f.root,studioRoot:f.root,sources:()=>{discoveries++;throw Error('No discovery or Git scan after any archive exists');},registeredSources:()=>[{id:'gpumd',root:otherRoot},{id:'pygas',root:f.root}],settings:()=>({pygasSkillProviders:['codex'],scientificSkillProviders:{gpumd:['codex']}}),resolveGuidance:async()=>facts});
 const trap=archivedTrap(facts.archivedResources.flatMap(resource=>resource.paths));
 try{
  const catalog=await service.catalog('codex',scope);assert.equal(catalog.functions.find(route=>route.id==='training.nep').source_status,'registered');
  const result=await service.call('read_scientific_skill',{function_id:'training.nep'},scope);assert.equal(result.status,'passed');assert(result.text.includes('UNCONFIGURED OTHER TOOL'));
  const policy=await service.resolvePolicy(scope),evidence=await service.ruleEvidence.inspect({source_receipt:{local_files:[{source_id:'pygas',path:'delivery/SKILL.md',sha256:'a'.repeat(64)}]}},{policy});assert.equal(evidence.files[0].status,'blocked');
  assert.equal(discoveries,0);trap.assertZero();t.diagnostic('global archive operations '+JSON.stringify(trap.counts));
  const unregistered=new ScientificSkills({map:extended,bundledRoot:f.root,sources:()=>{throw Error('No fallback discovery');},settings:()=>({}),resolveGuidance:async()=>facts});assert.deepEqual(unregistered.sourcesForPolicy(policy),[]);
 }finally{trap.restore();}
});

test('revalidate compares authority facts independent of key order but rejects real changes',async t=>{
 const f=fixture(t);
 const reverseKeys=value=>{if(Array.isArray(value))return value.map(reverseKeys);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).reverse())out[key]=reverseKeys(value[key]);return out;}return value;};
 const policy=createReadPolicy(f.facts,{reload:async()=>reverseKeys(f.facts)});
 await policy.revalidate();
 const changed=createReadPolicy(f.facts,{reload:async()=>reverseKeys({...f.facts,revision:'authority-2'})});
 await assert.rejects(()=>changed.revalidate(),/activation changed/);
});
