import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {ScientificSkillRouter} from '../desktop/scientific-skill-router.mjs';import {PublicRuleEvidence} from '../desktop/public-rule-evidence.mjs';
const reference='references/gpumd-native-input.json',skillId='studio-md-workflow',sha=data=>createHash('sha256').update(data).digest('hex');
const map=JSON.parse(await fs.readFile(new URL('../desktop/scientific-skill-map.json',import.meta.url),'utf8')),document=JSON.parse(await fs.readFile(new URL('../agents/skills/studio-md-workflow/'+reference,import.meta.url),'utf8'));
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-native-contract-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const route=map.functions.find(f=>f.id==='sampling.gpumd'),doc=structuredClone(document),publicRoots={},registered={};
 for(const item of doc.source_receipt.local_files){const folder=registered[item.source_id]??=path.join(root,'registered',item.source_id),file=path.join(folder,item.path);await fs.mkdir(path.dirname(file),{recursive:true});const body='RAW_SOURCE_MUST_NOT_BE_SHARED '+item.source_id+' '+item.path;await fs.writeFile(file,body);item.sha256=sha(body);}
 for(const id of route.skills){const skill=map.skills.find(s=>s.id===id),folder=publicRoots[skill.source]??=path.join(root,'public',skill.source);for(const file of [...skill.files,...route.reference_files?.[id]||[]]){const target=path.join(folder,skill.folder,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,id===skillId&&file===reference?JSON.stringify(doc,null,2)+'\n':file.endsWith('.json')?'{}':'# PUBLIC_SKILL_ONLY '+id);}}
 const evidence=new PublicRuleEvidence(id=>registered[id]);let granted=true;const router=new ScientificSkillRouter({map,sourceRoot:id=>publicRoots[id],consent:()=>granted,ruleEvidence:d=>evidence.inspect(d)});return{root,doc,registered,publicRoots,evidence,router,revoke:()=>{granted=false;}};
}
const native=result=>result.attachments.find(a=>a.name==='studio-md-workflow/'+reference);

import {toolValueResult} from '../desktop/tool-failure.mjs';
import {ScientificSkills} from '../desktop/scientific-skills.mjs';
const documentId=skillId+'/'+reference;
test('focused native document crosses real MCP serialization intact for all four providers',async t=>{
 const f=await fixture(t);for(const provider of ['codex','kimi','qwen','deepseek']){
 const tools=Object.create(ScientificSkills.prototype);tools.map=map;tools.router=f.router;assert(tools.tools().find(tool=>tool.name==='read_scientific_skill').inputSchema.properties.document_id);const result=await tools.call('read_scientific_skill',{function_id:'sampling.gpumd',document_id:documentId},{provider}),wire=JSON.stringify(toolValueResult(result)),decoded=JSON.parse(JSON.parse(wire).content[0].text);
 assert.equal(decoded.status,'passed');assert.equal(decoded.attachments.length,1);assert.equal(decoded.attachments[0].source_evidence.status,'source_matched_reference');assert.deepEqual(JSON.parse(decoded.text),f.doc);assert.equal(sha(decoded.text),decoded.attachments[0].sha256);assert.equal(Buffer.byteLength(decoded.text),decoded.bytes);assert(Buffer.byteLength(wire)<=24*1024);assert(!wire.includes('RAW_SOURCE_MUST_NOT_BE_SHARED'));assert(!wire.includes(f.root));
 }
 const full=await f.router.read('codex','sampling.gpumd');assert.equal(full.status,'passed');assert(full.attachments.length>1);assert(full.text.includes('PUBLIC_SKILL_ONLY'));assert(full.document_ids.includes(documentId));assert(!full.text.startsWith('{'));
});
test('exact function membership rejects unknown, traversal and encoded aliases before any source access',async t=>{
 const f=await fixture(t);let reads=0;f.router.sourceRoot=()=>{reads++;throw Error('must not read');};
 for(const id of ['unknown','../'+documentId,documentId.replace('/','%2f'),'C:/private',documentId+' '])await assert.rejects(f.router.read('codex','sampling.gpumd',id),/exact document_id/);
 await assert.rejects(f.router.read('codex','md.gpumd',documentId),/exact document_id/);assert.equal(reads,0);
 const skills=Object.create(ScientificSkills.prototype);skills.router=f.router;await assert.rejects(skills.call('read_scientific_skill',{function_id:'sampling.gpumd',document_id:documentId,path:'private'},{provider:'codex'}),/Invalid/);
});
test('focused route keeps revocation, source rebind, and source mismatch semantics',async t=>{
 const f=await fixture(t);let granted=true,bodyRead=false;const evidence=f.router.ruleEvidence;f.router.ruleEvidence=async doc=>{bodyRead=true;const result=await evidence(doc);granted=false;return result;};f.router.consent=()=>granted;let result=await f.router.read('codex','sampling.gpumd',documentId);assert.equal(result.status,'permission_required');assert(bodyRead);assert.equal(result.text,undefined);f.router.ruleEvidence=evidence;
 f.router.consent=()=>true;const original=f.router.sourceRoot;let calls=0;f.router.sourceRoot=id=>++calls>3?path.dirname(original(id)):original(id);result=await f.router.read('codex','sampling.gpumd',documentId);assert.equal(result.status,'blocked');assert.equal(result.text,undefined);
 f.router.sourceRoot=original;const item=f.doc.source_receipt.local_files[0];await fs.appendFile(path.join(f.registered[item.source_id],item.path),'changed');result=await f.router.read('codex','sampling.gpumd',documentId);assert.equal(result.status,'passed');assert.equal(result.attachments[0].source_evidence.status,'reference_only');
});
test('focused oversized serialized payload is explicitly blocked without partial body',async t=>{
 const f=await fixture(t),target=path.join(f.publicRoots.studio,documentId);await fs.writeFile(target,JSON.stringify({public:'x'.repeat(25000)}));const result=await f.router.read('codex','sampling.gpumd',documentId);assert.equal(result.status,'blocked');assert.match(result.reason,/serialized MCP 24 KiB/);assert.equal(result.text,undefined);assert.deepEqual(result.attachments,[]);
});
test('focused document preserves file and route byte budgets',async t=>{
 const f=await fixture(t);for(const limits of [{fileBytes:100},{totalBytes:100}]){const router=new ScientificSkillRouter({map,sourceRoot:id=>f.publicRoots[id],consent:()=>true,limits}),result=await router.read('codex','sampling.gpumd',documentId);assert.equal(result.status,'blocked');assert.equal(result.text,undefined);}
});
test('focused document refuses linked reference directory',async t=>{
 const f=await fixture(t),folder=path.join(f.publicRoots.studio,skillId,'references'),real=folder+'-real';await fs.rename(folder,real);await fs.symlink(real,folder,process.platform==='win32'?'junction':'dir');const result=await f.router.read('codex','sampling.gpumd',documentId);assert.equal(result.status,'blocked');assert.equal(result.text,undefined);
});
