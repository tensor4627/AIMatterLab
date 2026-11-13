import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ScientificSkills} from '../../agent/skills/scientific-skills.mjs';
import {managedToolSkillContext} from '../../agent/skills/managed-tool-context.mjs';
import {legacyGuidanceFacts} from '../../agent/skills/read-policy.mjs';
import {createAgentRequests} from '../../agent/sessions/requests.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t,{large=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-selected-managed-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const texts={'SKILL.md':'---\nname: selected-managed-fixture\ndescription: Selected delivery fixture.\n---\nRead [Guide](docs/guide.md) only when needed.\n','docs/guide.md':'GUIDE BODY\n[Deep](deep.md)\n[Values](../values.json)\n'+(large?'x'.repeat(30*1024):''),'docs/deep.md':'DEEP BODY\n','values.json':'{"measured":7}\n','unrelated.md':'UNSELECTED BODY\n','program.py':'MUST NOT EXECUTE\n'};
 for(const [name,text]of Object.entries(texts)){const file=path.join(root,...name.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);}
 const record={package_id:'selected-fixture',package_version:'fixture-v1',manifest_sha256:sha('manifest'),source_commit:sha('source'),snapshot_root:root,delivery_skill:{name:'selected-managed-fixture',path:'SKILL.md',sha256:sha(texts['SKILL.md'])},files:Object.entries(texts).map(([name,text])=>({path:name,kind:'file',target:null,size:Buffer.byteLength(text),sha256:sha(text)}))};
 let current=true,serial=1,currentRecord=structuredClone(record),facts=legacyGuidanceFacts();
 const scope={provider:'compatible',threadId:'selected-thread',taskId:null,projectId:'project',environmentId:null,inputRoot:null,serial:1,checkCurrent:()=>current};
 const skills=new ScientificSkills({map:{schema_version:1,skills:[],functions:[]},bundledRoot:root,studioRoot:root,sources:()=>[],settings:()=>({}),resolveGuidance:async()=>facts,assertScope:value=>{if(value.checkCurrent?.()!==true)throw Error('scope changed');return value;}});
 const selection={name:record.delivery_skill.name,path:path.join(root,'SKILL.md')},policy=await skills.resolvePolicy(scope);
 let opens=[];const original=fsp.open;fsp.open=async function(file,...args){if(typeof file==='string'&&file.startsWith(root+path.sep))opens.push(file);return original.call(this,file,...args);};t.after(()=>{fsp.open=original;});
 const context=await managedToolSkillContext({selection,record,scope,policy}),bound=skills.bindManagedSelection({selection,record,scope,policy,context,assertCurrent:()=>{if(serial!==1)throw Error('selected turn changed');},currentRecord:()=>currentRecord});
 const idFor=(ids,name)=>ids.find(id=>id.endsWith(':'+encodeURIComponent(name)));
 const read=(documentId,owner=scope)=>skills.call('read_scientific_skill',{function_id:'selected.managed',document_id:documentId},owner);
 return {root,texts,record,skills,scope,bound,opens,idFor,read,setCurrent:value=>{current=value;},setSerial:value=>{serial=value;},setRecord:value=>{currentRecord=value;},revoke:()=>{facts={schemaVersion:1,revision:'revoked-v2',state:'revoked',archivedResources:[],package:{id:'fixture',version:'1',manifestSha256:sha('manifest'),sourceCommit:sha('source')},workerBinding:{distribution:'Fixture',root:'/worker',port:1},target:{kind:'local',projectId:'p',environmentId:'env',fingerprint:'fp'}};}};
}

test('production scientific reader binds one selected entry and discloses each exact supporting document only on demand',async t=>{
 const f=await fixture(t);assert.equal(f.opens.length,1);assert(!f.bound.text.includes('GUIDE BODY'));assert(f.bound.text.includes('selected.managed'));assert(!f.bound.document_ids.some(id=>id.includes('unrelated')));
 const catalog=await f.skills.call('scientific_skill_catalog',{},f.scope);assert.equal(catalog.functions.length,0);assert.equal(catalog.selected_skill.function_id,'selected.managed');assert(f.skills.tools().find(tool=>tool.name==='read_scientific_skill').inputSchema.properties.function_id.enum.includes('selected.managed'));
 const guide=await f.read(f.idFor(f.bound.document_ids,'docs/guide.md'));assert(guide.text.includes('GUIDE BODY'));assert(!guide.text.includes('DEEP BODY'));assert(!guide.text.includes('"measured":7'));assert.equal(guide.attachments.length,1);assert.equal(guide.attachments[0].label,'docs/guide.md');assert(!f.opens.some(file=>file.endsWith('deep.md')||file.endsWith('values.json')));
 const deep=await f.read(f.idFor(guide.document_ids,'docs/deep.md'));assert(deep.text.includes('DEEP BODY'));assert.equal(deep.attachments.length,1);const values=await f.read(f.idFor(guide.document_ids,'values.json'));assert(values.text.includes('"measured":7'));assert.equal(values.attachments[0].kind,'reference-data');
});

test('unknown IDs, caller paths, unrelated registered documents, other providers and foreign conversations fail before IO',async t=>{
 const f=await fixture(t),document=f.idFor(f.bound.document_ids,'docs/guide.md'),before=f.opens.length;
 for(const id of ['docs/guide.md',path.join(f.root,'docs/guide.md'),document.replace(encodeURIComponent('docs/guide.md'),encodeURIComponent('unrelated.md'))])await assert.rejects(f.read(id),/exact document_id/);
 for(const owner of [{...f.scope,provider:'qwen'},{...f.scope,threadId:'foreign'},{...f.scope,taskId:'foreign'}])await assert.rejects(f.read(document,owner),/current conversation/);
 assert.equal(f.opens.length,before);assert.equal((await f.skills.catalog('qwen',{...f.scope,provider:'qwen'})).selected_skill,undefined);
});

test('selection tickets, lease revocation and new turns without an explicit skill invalidate the production binding',async t=>{
 for(const mode of ['serial','lease','new-turn']){
  const f=await fixture(t),document=f.idFor(f.bound.document_ids,'docs/guide.md'),before=f.opens.length;
  if(mode==='serial')f.setSerial(2);else if(mode==='lease')f.setCurrent(false);else{
   const rpc=createAgentRequests({runtime:()=>({scientificSkills:f.skills,assertIdleAgent:()=>{},workflowContext:{begin:()=>{throw Error('fixture stopped after trusted turn invalidation');}}})});
   await assert.rejects(rpc({provider:'compatible',method:'turn/start',params:{threadId:'selected-thread',planningMode:false,input:[{type:'text',text:'No selected skill'}]}}),/trusted turn invalidation/);
  }
  await assert.rejects(f.read(document),/current conversation/);assert.equal(f.opens.length,before);
 }
});

test('policy authority and registered version revocation prevent selected document reads',async t=>{
 const policy=await fixture(t),policyId=policy.idFor(policy.bound.document_ids,'docs/guide.md');policy.revoke();const before=policy.opens.length;await assert.rejects(policy.read(policyId),/activation changed/);assert.equal(policy.opens.length,before);assert.equal((await policy.skills.catalog('compatible',policy.scope)).selected_skill,undefined);
 const version=await fixture(t),versionId=version.idFor(version.bound.document_ids,'docs/guide.md');version.setRecord({...version.record,package_version:'fixture-v2'});const beforeVersion=version.opens.length;await assert.rejects(version.read(versionId),/current conversation/);assert.equal(version.opens.length,beforeVersion);assert.equal((await version.skills.catalog('compatible',version.scope)).selected_skill,undefined);
});

test('selected source tampering and oversized MCP documents return no body or new disclosure authority',async t=>{
 const changed=await fixture(t),document=changed.idFor(changed.bound.document_ids,'docs/guide.md');fs.writeFileSync(path.join(changed.root,'docs/guide.md'),changed.texts['docs/guide.md'].replace('GUIDE BODY','WRONG BODY'));await assert.rejects(changed.read(document),/registered_hash_changed/);
 const large=await fixture(t,{large:true}),largeId=large.idFor(large.bound.document_ids,'docs/guide.md');await assert.rejects(large.read(largeId),/24 KiB/);const catalog=await large.skills.catalog('compatible',large.scope);assert(!catalog.selected_skill.document_ids.some(id=>id.endsWith(':'+encodeURIComponent('docs/deep.md'))));
});
