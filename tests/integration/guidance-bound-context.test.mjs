import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {ScientificSkills} from "../../agent/skills/scientific-skills.mjs";
import {createReadPolicy,legacyGuidanceFacts} from "../../agent/skills/read-policy.mjs";

const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-bound-guidance-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const archived=path.join(root,'SKILL.md');fs.writeFileSync(archived,'SEALED DELIVERY');const text='Self-contained actual bound CPU reference execution instructions';
 const facts={schemaVersion:1,revision:'authority-1',state:'active',package:{id:'cpu-reference',version:'v1',manifestSha256:'a'.repeat(64),sourceCommit:'b'.repeat(40)},workerBinding:{distribution:'Fixture',root:'/worker',port:1},target:{kind:'local',projectId:'project',environmentId:'env',fingerprint:'fingerprint'},activation:{id:'execution',revision:'1',configurationId:'configured'},applicableFunctions:[],engines:['installation.check'],archivedResources:[{id:'delivery',role:'delivery',paths:[archived]}],executionSkill:{id:'execution',sha256:sha(text),text,resources:[]}};
 const map={schema_version:1,skills:[{id:'nep',source:'gpumd',folder:'nep',files:['SKILL.md']},{id:'bias',source:'pygas',folder:'bias',files:['SKILL.md']}],functions:[{id:'training.nep',phase:'authoring',status:'source_guidance_only',engines:['nep.train'],skills:['nep']},{id:'pygas.bias',phase:'authoring',status:'source_guidance_only',engines:['pygas.build'],skills:['bias']},{id:'env.install',phase:'installation',status:'source_guidance_only',skills:['bias']}]};
 const scope={provider:'codex',threadId:'thread',taskId:null,serial:1,epoch:1,checkCurrent:()=>true},service=new ScientificSkills({map,bundledRoot:root,studioRoot:root,sources:()=>{throw Error('Bound guidance must use metadata, not discovery');},registeredSources:()=>[{id:'gpumd',root:path.join(root,'source')}],settings:()=>({pygasSkillProviders:['codex'],scientificSkillProviders:{gpumd:['codex']}}),resolveGuidance:async()=>facts});
 const methods={existsSync:'exists',readdirSync:'readdir',statSync:'stat',lstatSync:'stat',realpathSync:'stat',openSync:'open',readFileSync:'read',readdir:'readdir',stat:'stat',lstat:'stat',realpath:'stat',open:'open',readFile:'read'},counts={exists:0,readdir:0,stat:0,open:0,read:0},restore=[];
 for(const api of [fs,promises])for(const [key,kind]of Object.entries(methods))if(typeof api[key]==='function'){const original=api[key];api[key]=function(file,...args){if(file===archived){counts[kind]++;throw Error('No archived file operation');}return original.call(this,file,...args);};restore.push(()=>{api[key]=original;});}t.after(()=>restore.reverse().forEach(run=>run()));
 return {root,archived,facts,map,scope,service,counts,policy:()=>createReadPolicy(facts,{scope}),prepare:(options={})=>service.context.prepare('thread','codex',{text:'继续',parameters:{engine:'installation.check'},hasWorkflow:false,scope,policy:createReadPolicy(facts,{scope}),...options})};
}
function actualCatalogBoundary(){const source=fs.readFileSync(new URL("../../frontend/features/tools/SkillsWorkbench.tsx",import.meta.url),'utf8'),ast=ts.createSourceFile('SkillsWorkbench.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),node=ast.statements.find(item=>ts.isFunctionDeclaration(item)&&item.name?.text==='boundedCatalog');assert(node);const compiled=ts.transpileModule(node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;return new Function('t',compiled+';return boundedCatalog;')(value=>value);}

test('real active/stale/revoked catalogs pass the actual SkillsWorkbench boundary with honest source metadata',async t=>{
 const h=fixture(t),bounded=actualCatalogBoundary();h.facts.applicableFunctions=['pygas.bias'];for(const state of ['active','stale','revoked']){h.facts.state=state;const catalog=await h.service.catalog('codex',h.scope);assert.equal(bounded(catalog),catalog);assert.equal(catalog.functions.find(item=>item.id==='pygas.bias').source_status,'unregistered');assert.equal(catalog.functions.find(item=>item.id==='training.nep').source_status,'registered');}
 const catalog=await h.service.catalog('codex',h.scope),missing=structuredClone(catalog);delete missing.functions[0].source_status;assert.throws(()=>bounded(missing),/功能目录格式无效/);assert.deepEqual(h.counts,{exists:0,readdir:0,stat:0,open:0,read:0});
});

test('an actually bound ordinary chat gets the execution snapshot once after ACK and reloads changed/forgotten authority',async t=>{
 const h=fixture(t);let first=await h.prepare();assert.equal(first.guidanceKind,'execution');assert(first.text.includes(h.facts.executionSkill.text));assert.equal(first.attach,true);assert.equal((await h.prepare()).attach,true);h.service.context.accept('thread',first);assert.equal((await h.prepare()).status,'already_loaded');assert.equal((await h.prepare()).text,'');
 h.facts.revision='authority-2';assert.equal((await h.prepare()).attach,true);h.service.context.forget('thread');assert.equal((await h.prepare()).attach,true);assert.equal((await h.prepare({hasWorkflow:true})).guidanceKind,'execution');assert.deepEqual(h.counts,{exists:0,readdir:0,stat:0,open:0,read:0});
});

test('bound stale evidence retains verified guidance while revoked authority blocks',async t=>{
 const h=fixture(t);h.facts.state='stale';const stale=await h.prepare();assert.equal(stale.status,'passed');assert.equal(stale.guidanceKind,'execution');assert(stale.text.includes(h.facts.executionSkill.text));h.facts.state='revoked';const result=await h.prepare();assert.equal(result.status,'blocked');assert.equal(result.guidanceKind,'sealed');assert.equal(result.attach,false);assert(!result.text.includes(h.facts.executionSkill.text));assert.deepEqual(result.attachments,[]);assert.deepEqual(h.counts,{exists:0,readdir:0,stat:0,open:0,read:0});
});

test('explicit other-tool/manual routes, repair scopes and unbound legacy chats keep their existing paths',async t=>{
 const h=fixture(t),calls=[];h.service.router.read=async(_provider,id)=>{calls.push(id);return {status:'passed',function_id:id,digest:id,phase:'authoring',attachments:[],text:'OTHER ROUTE '+id};};
 const other=await h.prepare({text:'train NEP'});assert(other.text.includes('OTHER ROUTE training.nep'));assert(!other.text.includes(h.facts.executionSkill.text));assert.equal(other.guidanceKind,undefined);const manual=await h.prepare({manualFunction:'env.install'});assert(manual.text.includes('OTHER ROUTE env.install'));assert(!manual.text.includes(h.facts.executionSkill.text));
 h.facts.readGrant={id:'human-repair',purpose:'repair',resourceIds:['delivery'],owner:{provider:'codex',threadId:'thread',taskId:null,leaseEpoch:1},authorityRevision:h.facts.revision,activationId:h.facts.activation.id,expiresAt:Date.now()+60000};assert.equal((await h.prepare()).status,'not_run');assert.deepEqual(calls,['training.nep','env.install']);
 assert.equal((await h.prepare({policy:createReadPolicy(legacyGuidanceFacts(),{scope:h.scope})})).status,'not_run');assert.deepEqual(h.counts,{exists:0,readdir:0,stat:0,open:0,read:0});
});
