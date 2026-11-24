import __node_test, {describe as __describe} from 'node:test';
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import path from "node:path";
import os from "node:os";
import {AgentHub} from "../../agent/providers/agent-hub.mjs";
import {DshBridge} from "../../agent/providers/dsh.mjs";
import {ApiModelBridge} from "../../agent/providers/api-model-bridge.mjs";
import fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {PublicRuleEvidence} from "../../agent/skills/public-rule-evidence.mjs";
import {ScientificSkillRouter} from "../../agent/skills/scientific-skill-router.mjs";
import {toolValueResult} from "../../agent/tools/tool-failure.mjs";
import {ScientificSkills, validateScientificConsent, normalizeScientificSharing} from "../../agent/skills/scientific-skills.mjs";
import {PROVIDERS} from "../../agent/providers/contracts.mjs";
import {deliverScientificTurn} from "../../agent/sessions/scientific-turn.mjs";

await __describe("harness-routing", async () => {
const test = __node_test;
function hub(extra={}){
 const codex=new EventEmitter();codex.close=()=>{};const records=new Map(),secrets=new Map([['deepseek',{apiKey:'sk-fixture-deepseek-key'}],['compatible',{apiKey:'synthetic-private-key',baseUrl:'https://vendor.example/v1',model:'vendor-model'}]]);
 return new AgentHub({codex,root:path.join(os.tmpdir(),'studio-harness-routing-fixture'),catalog:{get:(kind,id)=>records.get(kind+id),list:kind=>[...records].filter(([id])=>id.startsWith(kind)).map(([,value])=>value),put:(kind,id,value)=>records.set(kind+id,value)},vault:{get:id=>secrets.get(id),put:(id,value)=>secrets.set(id,value)},settings:()=>({codexPath:'chosen-codex'}),worker:()=>null,...extra});
}
test('production API routing selects official DSH for DeepSeek, custom API and Qwen without a CLI dependency',()=>{
 const h=hub();try{assert(h.createApiBridge('deepseek') instanceof DshBridge);for(const provider of ['compatible','qwen']){const bridge=h.createApiBridge(provider);assert(bridge instanceof ApiModelBridge);assert.notEqual(bridge,h.codex);assert.equal(bridge.executable,undefined);}}finally{h.close();}
});
for(const provider of ['deepseek','compatible'])test(provider+' connection validation uses its selected harness with an isolated empty context',async()=>{
 const calls=[];let options;
 const h=hub({apiBridgeFactories:{[provider]:value=>{options=value;const bridge=new EventEmitter();bridge.start=async()=>calls.push('start');bridge.close=()=>calls.push('close');bridge.request=async(method)=>{calls.push(method);if(method==='thread/start')return {thread:{id:'fixture-thread'},model:'actual-fixture-model'};if(method==='turn/start')queueMicrotask(()=>bridge.emit('event',{method:'turn/completed',params:{turn:{status:'completed',modelOutputReceived:true}}}));return {};};return bridge;}}});
 try{const result=await h.testConnection(provider);assert.equal(result.status,'passed');assert.equal(result.model,'actual-fixture-model');assert.equal(options.provider,provider);assert.equal(options.worker(),null);assert.equal(options.catalog.list().length,0);assert(options.root.startsWith(path.join(h.root,'connection-checks')+path.sep));assert.deepEqual(calls,['start','model/list','thread/start','turn/start','close']);assert.equal(h.bridges.size,0);assert.equal((await h.account(provider)).modelAccess,'passed');}finally{h.close();}
});
test('imported DSH Codex model visibility never advertises models absent from the live native catalog',async()=>{const h=hub();try{h.codex.process={};h.codex.request=async()=>({data:[{model:'visible',displayName:'Native',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'ultra'}]},{model:'hidden',displayName:'Hidden'}]});h.catalog.put('dsh-provider-import','codex',{modelIds:['visible','not-available'],models:[{id:'visible',name:'Imported name',reasoning:{efforts:[{id:'low'},{id:'high'}],defaultEffort:'low'}}]});const result=await h.rpc('codex','model/list');assert.equal(result.data.length,1);assert.equal(result.data[0].model,'visible');assert.equal(result.data[0].displayName,'Imported name');assert.deepEqual(result.data[0].supportedReasoningEfforts,[{reasoningEffort:'low'}]);assert.equal(result.data[0].defaultReasoningEffort,'low');}finally{h.close();}});
test('transport completion without model output cannot certify API model access',async()=>{
 const h=hub({apiBridgeFactories:{compatible:()=>{const bridge=new EventEmitter();bridge.start=async()=>{};bridge.close=()=>{};bridge.request=async method=>{if(method==='thread/start')return {thread:{id:'fixture'}};if(method==='turn/start')queueMicrotask(()=>bridge.emit('event',{method:'turn/completed',params:{turn:{status:'completed',modelOutputReceived:false}}}));return {};};return bridge;}}});
 try{await assert.rejects(h.testConnection('compatible'),/完整模型回复/);assert.equal((await h.account('compatible')).modelAccess,'not_run');}finally{h.close();}
});
});

await __describe("public-rule-evidence", async () => {
const test = __node_test;
const sha=value=>createHash('sha256').update(value).digest('hex');
test('Rule source match is bounded metadata only; changes and missing registrations downgrade defaults to reference',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-rules-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'base'));await fs.writeFile(path.join(root,'base/cv.py'),'# actual source');
 const service=new PublicRuleEvidence(id=>id==='pygas'?root:undefined),document={source_receipt:{local_files:[{source_id:'pygas',path:'base/cv.py',sha256:sha('# actual source')}]}};
 const first=await service.inspect(document);assert.equal(first.status,'source_matched_reference');assert.match(first.scope,/runtime.*not established/);assert.equal(first.files[0].actual_sha256,sha('# actual source'));assert(!JSON.stringify(first).includes(root));
 await fs.writeFile(path.join(root,'base/cv.py'),'# changed implementation');const next=await service.inspect(document);assert.equal(next.status,'reference_only');assert.equal(next.files[0].status,'stale');
 assert.equal((await new PublicRuleEvidence(()=>undefined).inspect(document)).files[0].status,'unregistered');
 await assert.rejects(service.inspect({source_receipt:{local_files:[{source_id:'pygas',path:'../secret',sha256:'0'.repeat(64)}]}}),/Invalid/);
});
});

await __describe("scientific-focused-document", async () => {
const test = __node_test;
const reference='references/gpumd-native-input.json',skillId='studio-md-workflow',sha=data=>createHash('sha256').update(data).digest('hex');
const map=JSON.parse(await fs.readFile(new URL("../../agent/skills/scientific-skill-map.json",import.meta.url),'utf8')),document=JSON.parse(await fs.readFile(new URL("../../agent/builtin-skills/studio-md-workflow/"+reference,import.meta.url),'utf8'));
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-native-contract-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const route=map.functions.find(f=>f.id==='sampling.gpumd'),doc=structuredClone(document),publicRoots={},registered={};
 for(const item of doc.source_receipt.local_files){const folder=registered[item.source_id]??=path.join(root,'registered',item.source_id),file=path.join(folder,item.path);await fs.mkdir(path.dirname(file),{recursive:true});const body='RAW_SOURCE_MUST_NOT_BE_SHARED '+item.source_id+' '+item.path;await fs.writeFile(file,body);item.sha256=sha(body);}
 for(const id of route.skills){const skill=map.skills.find(s=>s.id===id),folder=publicRoots[skill.source]??=path.join(root,'public',skill.source);for(const file of [...skill.files,...route.reference_files?.[id]||[]]){const target=path.join(folder,skill.folder,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,id===skillId&&file===reference?JSON.stringify(doc,null,2)+'\n':file.endsWith('.json')?'{}':'# PUBLIC_SKILL_ONLY '+id);}}
 const evidence=new PublicRuleEvidence(id=>registered[id]);let granted=true;const router=new ScientificSkillRouter({map,sourceRoot:id=>publicRoots[id],consent:()=>granted,ruleEvidence:d=>evidence.inspect(d)});return{root,doc,registered,publicRoots,evidence,router,revoke:()=>{granted=false;}};
}
const native=result=>result.attachments.find(a=>a.name==='studio-md-workflow/'+reference);



const documentId=skillId+'/'+reference;
test('focused native document crosses real MCP serialization intact for all five providers',async t=>{
 const f=await fixture(t);for(const provider of ['codex','kimi','qwen','deepseek','compatible']){
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
});

await __describe("scientific-gpumd-native-output", async () => {
const test = __node_test;
const reference='references/gpumd-native-output.json',skillId='studio-md-workflow',sha=data=>createHash('sha256').update(data).digest('hex');
const map=JSON.parse(await fs.readFile(new URL("../../agent/skills/scientific-skill-map.json",import.meta.url),'utf8')),document=JSON.parse(await fs.readFile(new URL("../../agent/builtin-skills/studio-md-workflow/"+reference,import.meta.url),'utf8'));
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-native-contract-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const route=map.functions.find(f=>f.id==='sampling.gpumd'),doc=structuredClone(document),publicRoots={},registered={};
 for(const item of doc.source_receipt.local_files){const folder=registered[item.source_id]??=path.join(root,'registered',item.source_id),file=path.join(folder,item.path);await fs.mkdir(path.dirname(file),{recursive:true});const body='RAW_SOURCE_MUST_NOT_BE_SHARED '+item.source_id+' '+item.path;await fs.writeFile(file,body);item.sha256=sha(body);}
 for(const id of route.skills){const skill=map.skills.find(s=>s.id===id),folder=publicRoots[skill.source]??=path.join(root,'public',skill.source);for(const file of [...skill.files,...route.reference_files?.[id]||[]]){const target=path.join(folder,skill.folder,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,id===skillId&&file===reference?JSON.stringify(doc,null,2)+'\n':file.endsWith('.json')?'{}':'# PUBLIC_SKILL_ONLY '+id);}}
 const evidence=new PublicRuleEvidence(id=>registered[id]);let granted=true;const router=new ScientificSkillRouter({map,sourceRoot:id=>publicRoots[id],consent:()=>granted,ruleEvidence:d=>evidence.inspect(d)});return{root,doc,registered,publicRoots,evidence,router,revoke:()=>{granted=false;}};
}
const native=result=>result.attachments.find(a=>a.name==='studio-md-workflow/'+reference);


const documentId=skillId+'/'+reference;
test('output companion is attached only to sampling.gpumd, never changes input reference route',()=>{
 assert.deepEqual(map.functions.filter(f=>(f.reference_files?.[skillId]||[]).includes(reference)).map(f=>f.id),['sampling.gpumd']);assert(map.functions.find(f=>f.id==='sampling.gpumd').reference_files[skillId].includes('references/gpumd-native-input.json'));
});
test('each provider receives the complete output contract through real MCP serialization with one body and receipt',async t=>{
 const f=await fixture(t);for(const provider of PROVIDERS){const result=await f.router.read(provider,'sampling.gpumd',documentId),wire=JSON.stringify(toolValueResult(result)),decoded=JSON.parse(JSON.parse(wire).content[0].text);assert.equal(decoded.status,'passed');assert.deepEqual(JSON.parse(decoded.text),f.doc);assert.equal(decoded.attachments.length,1);assert.equal(decoded.attachments[0].sha256,sha(decoded.text));assert.equal(decoded.attachments[0].source_evidence.status,'source_matched_reference');assert(Buffer.byteLength(wire)<=24*1024);assert(!wire.includes('RAW_SOURCE_MUST_NOT_BE_SHARED'));assert(!wire.includes(f.root));}
 await assert.rejects(f.router.read('codex','md.gpumd',documentId),/exact document_id/);f.revoke();const denied=await f.router.read('codex','sampling.gpumd',documentId);assert.equal(denied.status,'permission_required');assert.equal(denied.text,undefined);
});
test('source mismatch or missing source preserves reference_only without claiming target capability',async t=>{
 const f=await fixture(t),item=f.doc.source_receipt.local_files[0],file=path.join(f.registered[item.source_id],item.path);await fs.appendFile(file,'stale');let result=await f.router.read('codex','sampling.gpumd',documentId);assert.equal(result.status,'passed');assert.equal(result.attachments[0].source_evidence.status,'reference_only');await fs.unlink(file);result=await f.router.read('codex','sampling.gpumd',documentId);assert.equal(result.attachments[0].source_evidence.status,'reference_only');assert(!JSON.stringify(result).includes('RAW_SOURCE_MUST_NOT_BE_SHARED'));
});
test('output plan preserves science and encodes total energy/force/cell/step/state distinctions',()=>{
 assert.deepEqual(document.authoring.place_before_run,['dump_thermo 1','dump_exyz 1 1 1 1']);assert.match(document.energy.U,/U=U_NEP\+bias/);assert.match(document.energy.instantaneous_total,/Do not add bias a second time/);assert.match(document.energy.atomic_energy,/bookkeeping/);assert.match(document.atomic_and_cell.forces,/total per-atom/);assert.match(document.atomic_and_cell.Lattice,/Current runtime/);assert.match(document.alignment.fresh_run,/j=1..N/);assert.match(document.alignment.join,/do not zip/);assert.match(document.state.current_policy,/Keep existing opes_state_interval: 0/);assert.match(document.state.zero_semantics,/destructor attempts/);assert.match(document.state.zero_semantics,/failure is caught/);assert.match(document.state.optional_user_request,/If separately requested/);assert.match(document.state.optional_user_request,/do not establish/);
});
test('serialized oversize is blocked rather than truncated',async t=>{const f=await fixture(t);await fs.writeFile(path.join(f.publicRoots.studio,documentId),JSON.stringify({...f.doc,extra:'x'.repeat(25000)}));const result=await f.router.read('codex','sampling.gpumd',documentId);assert.equal(result.status,'blocked');assert.equal(result.text,undefined);assert.match(result.reason,/24 KiB/);});
test('public receipt is bounded fixed relative paths and contains no private runtime paths',()=>{assert(document.source_receipt.local_files.length<=16);for(const file of document.source_receipt.local_files){assert.equal(file.source_id,'gpumd');assert(!path.posix.isAbsolute(file.path));assert(!file.path.split('/').includes('..'));assert.match(file.sha256,/^[a-f0-9]{64}$/);}assert(!/C:|D:|\/home\/|button-audit|fc3eb249/.test(JSON.stringify(document)));});
});

await __describe("scientific-gpumd-native-planning", async () => {
const test = __node_test;
const reference='references/gpumd-native-input.json',skillId='studio-md-workflow',sha=data=>createHash('sha256').update(data).digest('hex');
const map=JSON.parse(await fs.readFile(new URL("../../agent/skills/scientific-skill-map.json",import.meta.url),'utf8')),document=JSON.parse(await fs.readFile(new URL("../../agent/builtin-skills/studio-md-workflow/"+reference,import.meta.url),'utf8'));
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-native-contract-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const route=map.functions.find(f=>f.id==='sampling.gpumd'),doc=structuredClone(document),publicRoots={},registered={};
 for(const item of doc.source_receipt.local_files){const folder=registered[item.source_id]??=path.join(root,'registered',item.source_id),file=path.join(folder,item.path);await fs.mkdir(path.dirname(file),{recursive:true});const body='RAW_SOURCE_MUST_NOT_BE_SHARED '+item.source_id+' '+item.path;await fs.writeFile(file,body);item.sha256=sha(body);}
 for(const id of route.skills){const skill=map.skills.find(s=>s.id===id),folder=publicRoots[skill.source]??=path.join(root,'public',skill.source);for(const file of [...skill.files,...route.reference_files?.[id]||[]]){const target=path.join(folder,skill.folder,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,id===skillId&&file===reference?JSON.stringify(doc,null,2)+'\n':file.endsWith('.json')?'{}':'# PUBLIC_SKILL_ONLY '+id);}}
 const evidence=new PublicRuleEvidence(id=>registered[id]);let granted=true;const router=new ScientificSkillRouter({map,sourceRoot:id=>publicRoots[id],consent:()=>granted,ruleEvidence:d=>evidence.inspect(d)});return{root,doc,registered,publicRoots,evidence,router,revoke:()=>{granted=false;}};
}
const native=result=>result.attachments.find(a=>a.name==='studio-md-workflow/'+reference);
test('reference attaches only to actual sampling.gpumd route, with closed relative hash receipts',()=>{assert(map.skills.find(s=>s.id===skillId).reference_files.includes(reference));assert.deepEqual(map.functions.filter(f=>(f.reference_files?.[skillId]||[]).includes(reference)).map(f=>f.id),['sampling.gpumd']);assert(Buffer.byteLength(JSON.stringify(document))<24*1024);assert(document.source_receipt.local_files.length>0&&document.source_receipt.local_files.length<=64);for(const f of document.source_receipt.local_files){assert(['gpumd','pygas'].includes(f.source_id));assert(!path.posix.isAbsolute(f.path)&&!f.path.split('/').includes('..'));assert.match(f.sha256,/^[a-f0-9]{64}$/);}});
test('five consented providers explicitly read authored grammar and matched metadata without raw bodies/roots',async t=>{const f=await fixture(t);for(const provider of ['codex','kimi','qwen','deepseek','compatible']){const result=await f.router.read(provider,'sampling.gpumd',skillId+'/'+reference);assert.equal(result.status,'passed');assert.equal(native(result).source_evidence.status,'source_matched_reference');assert.match(result.text,/planned seed line/);assert.match(result.text,/selected executable support\/build relation not_run/);assert(!result.text.includes('RAW_SOURCE_MUST_NOT_BE_SHARED'));assert(!result.text.includes(f.root));assert.equal(native(result).sha256,sha(JSON.stringify(f.doc,null,2)+'\n'));}});
test('changed or missing parser downgrades applicability without inferring target support',async t=>{const f=await fixture(t),item=f.doc.source_receipt.local_files[0],file=path.join(f.registered[item.source_id],item.path);await fs.appendFile(file,' changed parser');let result=await f.router.read('codex','sampling.gpumd',skillId+'/'+reference);assert.equal(native(result).source_evidence.status,'reference_only');assert.equal(native(result).source_evidence.files.find(x=>x.path===item.path).status,'stale');await fs.unlink(file);result=await f.router.read('codex','sampling.gpumd',skillId+'/'+reference);assert.equal(native(result).source_evidence.status,'reference_only');assert.equal(native(result).source_evidence.files.find(x=>x.path===item.path).status,'blocked');assert(!result.text.includes('RAW_SOURCE_MUST_NOT_BE_SHARED'));assert.equal(document.source_receipt.applicability.selected_executable_support,'not_run unless separately evidenced; no source/build equality inferred');});
test('existing sibling skill consent denies whole route without partial native context',async t=>{const f=await fixture(t);f.revoke();for(const provider of ['codex','kimi','qwen','deepseek','compatible']){const result=await f.router.read(provider,'sampling.gpumd',skillId+'/'+reference);assert.equal(result.status,'permission_required');assert.deepEqual(result.attachments,[]);assert.equal(result.text,undefined);}});
test('new reference respects byte budget and adds no caller-selected source reader',async t=>{const f=await fixture(t),router=new ScientificSkillRouter({map,sourceRoot:id=>f.publicRoots[id],consent:()=>true,ruleEvidence:d=>f.evidence.inspect(d),limits:{fileBytes:64,totalBytes:192*1024}}),result=await router.read('codex','sampling.gpumd',skillId+'/'+reference);assert.equal(result.status,'blocked');assert.deepEqual(result.attachments,[]);await assert.rejects(f.router.read('codex','../../private'),/listed/);assert.equal(map.functions.find(x=>x.id==='sampling.gpumd').tools?.includes('read_source_file'),undefined);});
});

await __describe("scientific-skills", async () => {
const test = __node_test;
test('Legacy pyGAS consent does not broaden other public sources or private skill roots',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-scientific-facade-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const folder of ['builtin','pygas/agents/skills/cv','gpumd/agents/skills/runtime'])await fs.mkdir(path.join(root,folder),{recursive:true});
 await fs.writeFile(path.join(root,'builtin/SKILL.md'),'AIMatterLab-owned public guide');await fs.writeFile(path.join(root,'pygas/agents/skills/cv/SKILL.md'),'Public actual pyGAS entry');await fs.writeFile(path.join(root,'gpumd/agents/skills/runtime/SKILL.md'),'Public actual GPUMD entry');
 const settings={pygasSkillProviders:['codex','kimi','qwen','deepseek']},map={schema_version:1,skills:[{id:'builtin',source:'studio',folder:'builtin',files:['SKILL.md']},{id:'cv',source:'pygas',folder:'cv',files:['SKILL.md']},{id:'runtime',source:'gpumd',folder:'runtime',files:['SKILL.md']}],functions:[{id:'workflow.orchestrate',phase:'orchestration',skills:['builtin']},{id:'pygas.cv',phase:'authoring',skills:['cv']},{id:'environment.runtime',phase:'discovery',skills:['runtime']}]};
 // Bundle root has a child directory just as the packaged physical skill bundle.
 await fs.mkdir(path.join(root,'studio'),{recursive:true});await fs.rename(path.join(root,'builtin'),path.join(root,'studio/builtin'));
 let endpointGranted=true;const service=new ScientificSkills({providerConsent:()=>endpointGranted,map,bundledRoot:path.join(root,'studio'),sources:()=>['pygas','gpumd'].map(id=>({id,root:path.join(root,id)})),settings:()=>settings});
 for(const provider of ['codex','kimi','qwen','deepseek']){const catalog=await service.call('scientific_skill_catalog',{}, {provider});assert.equal(catalog.functions.find(r=>r.id==='pygas.cv').permission,'allowed');assert.equal(catalog.functions.find(r=>r.id==='environment.runtime').permission,'permission_required');assert.equal((await service.call('read_scientific_skill',{function_id:'pygas.cv'},{provider})).status,'passed');assert.equal((await service.call('read_scientific_skill',{function_id:'environment.runtime'},{provider})).status,'permission_required');}
 settings.scientificSkillProviders={gpumd:['qwen']};assert.equal((await service.call('read_scientific_skill',{function_id:'environment.runtime'},{provider:'qwen'})).status,'passed');assert.equal((await service.call('read_scientific_skill',{function_id:'environment.runtime'},{provider:'codex'})).status,'permission_required');settings.pygasSkillProviders=[];assert.equal((await service.call('read_scientific_skill',{function_id:'pygas.cv'},{provider:'qwen'})).status,'permission_required');
 endpointGranted=false;settings.pygasSkillProviders=['qwen'];assert.equal((await service.call('read_scientific_skill',{function_id:'pygas.cv'},{provider:'qwen'})).status,'permission_required','Provider-wide sharing cannot bypass the selected endpoint consent');
 assert.equal(service.tools().length,2);assert(service.tools().every(t=>t.inputSchema.additionalProperties===false));assert(service.tools().every(t=>t.annotations.readOnlyHint===true&&t.annotations.destructiveHint===false&&t.annotations.idempotentHint===true&&t.annotations.openWorldHint===false));
});
test('Sharing settings reject unsupported sources, duplicate providers, malformed values and arbitrary private root keys',()=>{for(const value of [null,[],{pygas:['codex']},{private:['codex']},{gpumd:['other']},{gpumd:['codex','codex']},{gpumd:'codex'}])assert.throws(()=>validateScientificConsent(value));validateScientificConsent(undefined);validateScientificConsent({gpumd:['codex']});});

test('Compatible legacy duplicate pyGAS scope is removed without changing authoritative grants',()=>{
 const old={pygasSkillProviders:['codex'],scientificSkillProviders:{pygas:['compatible'],gpumd:['qwen']},ssh:[{id:'protected'}]};const fixed=normalizeScientificSharing(old);validateScientificConsent(fixed.scientificSkillProviders);assert.deepEqual(fixed.pygasSkillProviders,['codex']);assert.deepEqual(fixed.scientificSkillProviders,{gpumd:['qwen']});assert.equal(fixed.ssh,old.ssh);assert.equal(normalizeScientificSharing(fixed),fixed);assert(old.scientificSkillProviders.pygas);assert.equal(normalizeScientificSharing({scientificSkillProviders:{pygas:['compatible']}}).pygasSkillProviders,undefined);assert.throws(()=>validateScientificConsent(normalizeScientificSharing({scientificSkillProviders:{unknown:[]}}).scientificSkillProviders));
});
});

await __describe("scientific-turn", async () => {
const test = __node_test;
function fixture(){const events=[],accepted=[],context={status:'passed',attach:true,provider:'codex',routes:['pygas.cv'],attachments:[{name:'actual/SKILL.md',sha256:'actualhash'}]};return {provider:'codex',key:'codex:t',threadId:'t',requestId:'request-current',context,manager:{accept:(...args)=>accepted.push(args)},emit:e=>events.push(e),events,accepted};}
test('Guidance is prepared before dispatch and loaded only after a valid acknowledged turn',async()=>{const f=fixture();await deliverScientificTurn({...f,dispatch:async()=>{assert.deepEqual(f.events.map(e=>e.params.status),['prepared']);assert.equal(f.accepted.length,0);return {turn:{id:'actual-ack'}};}});assert.deepEqual(f.events.map(e=>e.params.status),['prepared','passed']);assert.equal(f.events[1].params.delivery,'acknowledged');assert.equal(f.accepted.length,1);assert(f.events.every(e=>e.params.requestId==='request-current'));});
test('Explicit rejection, uncertain transport and malformed acknowledgment never acquire a loaded receipt',async()=>{for(const [kind,error] of [['rejected',Object.assign(Error('server reject'),{rpcResponse:true})],['transport',Error('lost response')],['malformed',null]]){const f=fixture();await assert.rejects(deliverScientificTurn({...f,dispatch:async()=>{if(error)throw error;return {};}}));assert.equal(f.accepted.length,0);assert.equal(f.events.at(-1).params.status,kind==='rejected'?'failed':'unknown');assert(!f.events.some(e=>e.params.status==='passed'));}});
test('Permission-denied preparation remains denied after an acknowledged ordinary conversation',async()=>{const f=fixture();f.context={...f.context,status:'permission_required',attach:false,text:'No public source permission',attachments:[]};await deliverScientificTurn({...f,dispatch:async()=>({turn:{id:'actual-ack'}})});assert(f.events.every(e=>e.params.status==='permission_required'));assert(f.events.every(e=>e.provider==='codex'&&e.params.threadId==='t'));assert.equal(f.accepted.length,0);});
});
