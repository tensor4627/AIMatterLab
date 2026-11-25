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
import {toolValueResult} from '../../agent/tools/tool-failure.mjs';
import {toolPackageResources,validateToolPackage} from '../../contracts/tools/tool-package.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const assertBudget=result=>assert(Buffer.byteLength(JSON.stringify(toolValueResult(result)))<=24*1024);

function toolManifest(count=1){
 const id='selected-fixture',directory=id+'-tests';
 const display={priority:100,advanced:false,reason:'Used in the reference test case'};
 const port=(id,description)=>({id,type:'file',format:'json',description,required:true,display});
 const functions=Array.from({length:count},(_,index)=>({
  id:'smoke-'+index,name:'Smoke function '+index,description:'Read fixture input and write the reference result.',entrypoint:'src/run.py',
  inputs:[port('structure','Input structure to inspect')],outputs:[port('result','Checked reference output')],
  parameters:[{id:'steps',type:'integer',description:'Iteration count',required:false,default:index+1,
   default_behavior:'Use the declared iteration count.',default_source:'Reference test case',display}],
  operation:{command:['{python}','{entrypoint}','--structure','{structure}','--steps','{steps}','--output','{result}'],failure_handling:'Record the failure and its exit status.'},
  tests:['case-'+index]
 }));
 const cases=functions.map(item=>{
  const caseDirectory=directory+'/'+item.tests[0];
  return {id:item.tests[0],function_id:item.id,directory:caseDirectory,instructions:caseDirectory+'/README.md',entrypoint:'src/case.py',
   resources:['src/input.json'],expected_outputs:[{path:'result.json',format:'json',description:'Reference measurement'}],
   pass_criteria:['The output contains a finite measurement.']};
 });
 return {schema_version:1,id,name:'Selected package fixture',repository:{path:'src',commit:'a'.repeat(40)},manual:'docs/guide.md',
  guidance:{delivery:'SKILL.md'},environment:{hardware:'cpu',requirements:['Python'],parallelism:{supported:['serial']}},
  functions,tests:{directory,introduction:directory+'/README.md',cases}};
}

async function fixture(t,{large=false,manifest}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-selected-managed-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const texts={'SKILL.md':'---\nname: selected-managed-fixture\ndescription: Selected delivery fixture.\n---\nRead [Guide](docs/guide.md) only when needed.\n','docs/guide.md':'GUIDE BODY\n[Deep](deep.md)\n[Values](../values.json)\n'+(large?'x'.repeat(30*1024):''),'docs/deep.md':'DEEP BODY\n','values.json':'{"measured":7}\n','unrelated.md':'UNSELECTED BODY\n','program.py':'MUST NOT EXECUTE\n'};
 const registeredManifest=manifest&&validateToolPackage(manifest);
 if(registeredManifest){
  for(const resource of toolPackageResources(registeredManifest))texts[resource]??='Fixture resource\n';
  texts['tool.json']=JSON.stringify(manifest,null,2)+'\n';
 }
 for(const [name,text]of Object.entries(texts)){const file=path.join(root,...name.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);}
 const record={package_id:'selected-fixture',package_version:'fixture-v1',manifest_sha256:sha(texts['tool.json']??'manifest'),source_commit:manifest?.repository.commit??sha('source'),snapshot_root:root,delivery_skill:{name:'selected-managed-fixture',path:'SKILL.md',sha256:sha(texts['SKILL.md'])},files:Object.entries(texts).map(([name,text])=>({path:name,kind:'file',target:null,size:Buffer.byteLength(text),sha256:sha(text)})),...registeredManifest&&{immutable:true,manifest:registeredManifest}};
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

test('small tool.json reads keep the original manifest body and receipt',async t=>{
 const f=await fixture(t,{manifest:toolManifest()});
 const catalog=await f.skills.call('scientific_skill_catalog',{},f.scope);
 const result=await f.read(catalog.selected_skill.definitions[0].document_id);
 assertBudget(result);
 const body='[Selected skill document: '+f.record.delivery_skill.name+'; tool.json]\n'+f.texts['tool.json'];
 assert(result.text.startsWith(body+'\n\nSupporting document IDs'));
 assert.deepEqual(result.attachments,[{label:'tool.json',kind:'reference-data',sha256:f.record.manifest_sha256,bytes:Buffer.byteLength(f.texts['tool.json'])}]);
});

test('large tool.json reads advertise an index and focused views of the exact registered definition',async t=>{
 const manifest=toolManifest(16),f=await fixture(t,{manifest});
 const bytes=Buffer.byteLength(f.texts['tool.json']);
 assert(bytes>=34*1024&&bytes<=40*1024,'Fixture manifest size: '+bytes);
 const catalog=await f.skills.call('scientific_skill_catalog',{},f.scope);
 const [definition]=catalog.selected_skill.definitions;
 const unadvertised=definition.package_ref+':'+encodeURIComponent('tool.json#function/'+manifest.functions[0].id);
 const before=f.opens.length;
 await assert.rejects(f.read(unadvertised),/exact document_id/);
 assert.equal(f.opens.length,before);

 const result=await f.read(definition.document_id),index=JSON.parse(result.text);
 assertBudget(result);
 assert.equal(index.manifest_view,'index');
 assert.equal(index.id,manifest.id);
 assert.equal(index.name,manifest.name);
 assert.equal(index.version,f.record.package_version);
 for(const key of ['repository','environment','manual','guidance'])assert.deepEqual(index[key],manifest[key]);
 assert.equal(index.functions.length,manifest.functions.length);
 assert.equal(index.tests.directory,manifest.tests.directory);
 assert.equal(index.tests.introduction,manifest.tests.introduction);
 assert.equal(index.tests.cases.length,manifest.tests.cases.length);
 const [{id,name,entrypoint,tests}]=manifest.functions;
 const [functionRow]=index.functions,[testRow]=index.tests.cases;
 assert.deepEqual(functionRow,{id,name,entrypoint,tests,document_id:unadvertised});
 assert.deepEqual(testRow,{id:manifest.tests.cases[0].id,function_id:id,document_id:f.idFor(result.document_ids,'tool.json#test/'+tests[0])});

 const functionResult=await f.read(functionRow.document_id),testResult=await f.read(testRow.document_id);
 assert.deepEqual(JSON.parse(functionResult.text),manifest.functions[0]);
 assert.deepEqual(JSON.parse(testResult.text),manifest.tests.cases[0]);
 for(const read of [result,functionResult,testResult]){
  assertBudget(read);
  assert.deepEqual(read.attachments,[{label:'tool.json',kind:'reference-data',sha256:f.record.manifest_sha256,bytes}]);
 }
 fs.writeFileSync(path.join(f.root,'tool.json'),f.texts['tool.json'].replace('Selected package fixture','Tampered package fixture'));
 for(const document of [definition.document_id,functionRow.document_id,testRow.document_id]){
  await assert.rejects(f.read(document),/registered_hash_changed/);
 }
});

test('a many-function manifest can advertise focused views and chunk oversized functions and test cases',async t=>{
 const manifest=toolManifest(50);
 const escaped='Quoted \\" argument with Unicode 😀 '.repeat(90);
 manifest.functions[0].operation.command.push(...Array(7).fill(escaped));
 manifest.tests.cases[0].pass_criteria=Array(7).fill(escaped);
 const f=await fixture(t,{manifest});
 const catalog=await f.skills.call('scientific_skill_catalog',{},f.scope);
 const result=await f.read(catalog.selected_skill.definitions[0].document_id),index=JSON.parse(result.text);
 assertBudget(result);
 assert.equal(index.functions.length,50);
 assert.equal(index.tests.cases.length,50);
 for(const [row,original] of [[index.functions[0],manifest.functions[0]],[index.tests.cases[0],manifest.tests.cases[0]]]){
  const result=await f.read(row.document_id),view=JSON.parse(result.text);
  assertBudget(result);
  assert.equal(view.manifest_view,'chunks');
  assert(view.chunks.length>1);
  const reads=await Promise.all(view.chunks.map(({document_id})=>f.read(document_id)));
  for(const [index,chunk] of reads.entries()){
   assertBudget(chunk);
   assert.equal(chunk.manifest_view,'chunk');
   assert.equal(chunk.chunk_index,index);
   assert.deepEqual(chunk.attachments,result.attachments);
  }
  assert.deepEqual(JSON.parse(reads.map(chunk=>chunk.text).join('')),original);
 }
});

test('an oversized manifest index links to bounded chunks of the original tool.json',async t=>{
 const manifest=toolManifest();
 manifest.environment.requirements=Array(10).fill('Fixed runtime prerequisite 😀 '.repeat(120));
 const f=await fixture(t,{manifest});
 const catalog=await f.skills.call('scientific_skill_catalog',{},f.scope);
 const [definition]=catalog.selected_skill.definitions;
 const result=await f.read(definition.document_id),index=JSON.parse(result.text);
 assertBudget(result);
 assert.equal(index.manifest_view,'index');
 assert.equal(index.id,manifest.id);
 assert(index.chunks.length>1);
 const before=f.opens.length;
 await assert.rejects(f.read(definition.package_ref+':'+encodeURIComponent('tool.json#function/'+manifest.functions[0].id)),/exact document_id/);
 assert.equal(f.opens.length,before);
 const reads=await Promise.all(index.chunks.map(({document_id})=>f.read(document_id)));
 for(const chunk of reads)assertBudget(chunk);
 assert.equal(reads.map(chunk=>chunk.text).join(''),f.texts['tool.json']);
 fs.writeFileSync(path.join(f.root,'tool.json'),f.texts['tool.json'].replace('Selected package fixture','Tampered package fixture'));
 await assert.rejects(f.read(index.chunks[0].document_id),/registered_hash_changed/);
});
