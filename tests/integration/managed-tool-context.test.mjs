// Actual Registry snapshots and filesystem checks. No tool program is executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Catalog} from "../../backend/main/workspace/catalog.mjs";
import {createToolPackageRegistry} from "../../backend/main/tools/package-registry.mjs";
import {createCpuReference} from "../../developer/skills/studio-tool-integration/scripts/create-cpu-reference.mjs";
import {managedToolSkillContext} from "../../agent/skills/managed-tool-context.mjs";
import {createReadPolicy,legacyGuidanceFacts} from "../../agent/skills/read-policy.mjs";

const sha=value=>createHash('sha256').update(value).digest('hex'),displayName='cpu-worker-reference-delivery';
const entry=body=>'---\nname: '+displayName+'\ndescription: Actual fixture delivery guidance.\n---\n'+body;
function fixture(t,{linked=false,body,large=false,invalidUtf8=false,linkedEntry='entry.md',parentheses=false}={}){
 let catalog;const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-managed-context-'));t.after(()=>{catalog?.db.close();const relative=path.relative(os.tmpdir(),root);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));unlock(root);fs.rmSync(root,{recursive:true,force:true,maxRetries:3});});
 const packageRoot=path.join(root,'author','cpu-worker-reference-package');createCpuReference({output:packageRoot});const source=path.join(packageRoot,'reference-source');
 const write=(file,text)=>{const target=path.join(packageRoot,...file.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);};
 write('reference-source/docs/guide.md','# Original guide\nGUIDE BODY\n[JSON](../data/values.json#key)\n[Deep][deep]\n[deep]: sub/deep.md\n');write('reference-source/docs/sub/deep.md','# Nested guide\nDEEP BODY\n[cycle](../guide.md)\n');write('reference-source/data/values.json','{"value":7,"scope":"fixture only"}\n');write('reference-source/program.py','DO NOT LOAD OR EXECUTE THIS CODE\n');
 if(invalidUtf8)write('reference-source/docs/guide.md',Buffer.from([0xff,0xfe,0xfd]));
 if(parentheses){write('reference-source/docs/guide(v1).md','BALANCED PARENTHESIS GUIDANCE\n');write('reference-source/docs/angle guide(v1).md','ANGLE PATH GUIDANCE\n');}
 if(large)write('reference-source/docs/large.md','L'.repeat(256*1024+1));
 const bodyText=body??'[Guide](reference-source/docs/guide.md "Original guide")\n[Code](reference-source/program.py)\n[External](https://example.invalid/never.md)\n[Anchor](#nothing)\n```text\n[fenced](../../outside.md)\n```\n'+(large?'[Large](reference-source/docs/large.md)\n':'');
 if(linked){write('reference-source/docs/'+linkedEntry,entry('[Original guide](guide.md)\n'));fs.unlinkSync(path.join(packageRoot,'SKILL.md'));try{fs.symlinkSync('reference-source/docs/'+linkedEntry,path.join(packageRoot,'SKILL.md'),'file');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('Host cannot create real portable relative symlinks; no synthetic native-link claim');return null;}throw error;}}
 else write('SKILL.md',entry(bodyText));
 const nullFile=process.platform==='win32'?'NUL':'/dev/null',env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')&&key!=='NODE_OPTIONS')),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:nullFile};
 const git=args=>execFileSync('git',['-c','core.hooksPath='+nullFile,'-c','core.autocrlf=false','-c','user.name=Managed context fixture','-c','user.email=fixture@example.invalid','-C',source,...args],{env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});git(['add','.']);git(['commit','-m','Add fixture guidance in original source layout']);
 const manifest=JSON.parse(fs.readFileSync(path.join(packageRoot,'tool.json')));manifest.repository.commit=git(['rev-parse','HEAD']).trim();fs.writeFileSync(path.join(packageRoot,'tool.json'),JSON.stringify(manifest,null,2)+'\n');
 catalog=new Catalog(path.join(root,'catalog'));const registry=createToolPackageRegistry({catalog,storeRoot:path.join(root,'store')}),record=registry.register({package_root:packageRoot});
 const scope={provider:'codex',threadId:'thread',taskId:null,serial:1,epoch:3,checkCurrent:()=>true},selection={name:record.delivery_skill.name,path:path.join(record.snapshot_root,record.delivery_skill.path)};
 return {root,packageRoot,record,scope,selection,registry,read:(extra={})=>managedToolSkillContext({selection,record,scope,policy:createReadPolicy(legacyGuidanceFacts(),{scope}),...extra})};
}
function unlock(root){fs.chmodSync(root,0o755);for(const entry of fs.readdirSync(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())unlock(file);else fs.chmodSync(file,0o644);}}
function observe(root,{deny=[]}={}){
 const events=[],restore=[],counts={exists:0,readdir:0,stat:0,open:0,read:0};
 const hit=(file,kind)=>{if(typeof file!=='string'||!(file===root||file.startsWith(root+path.sep)))return;events.push({file,kind});counts[kind]++;if(deny.some(value=>file===value||file.startsWith(value+path.sep)))throw Error('Forbidden fixture IO');};
 for(const api of [fs,promises])for(const [name,kind]of Object.entries({existsSync:'exists',readdirSync:'readdir',statSync:'stat',lstatSync:'stat',realpathSync:'stat',readlinkSync:'stat',openSync:'open',readFileSync:'read',readdir:'readdir',stat:'stat',lstat:'stat',realpath:'stat',readlink:'stat',open:'open',readFile:'read'}))if(typeof api[name]==='function'){
  const original=api[name];api[name]=function(file,...args){hit(file,kind);if(api===promises&&name==='open')return original.call(this,file,...args).then(handle=>{const read=handle.read.bind(handle);handle.read=(...values)=>{hit(file,'read');return read(...values);};return handle;});return original.call(this,file,...args);};restore.push(()=>{api[name]=original;});
 }
 return {events,counts,restore:()=>restore.reverse().forEach(run=>run())};
}
function active(h,resources){const text='Self-contained execution snapshot';return {schemaVersion:1,revision:'authority',state:'active',package:{id:h.record.package_id,version:h.record.package_version,manifestSha256:h.record.manifest_sha256,sourceCommit:h.record.source_commit},workerBinding:{distribution:'Fixture',root:'/worker',port:1},target:{kind:'local',projectId:'project',environmentId:'env',fingerprint:'environment'},activation:{id:'execution',revision:'1',configurationId:'configuration'},archivedResources:resources,executionSkill:{id:'execution',sha256:sha(text),text,resources:[]}};}

test('a registered delivery expands bounded Markdown/JSON references from the original layout and relocates unchanged',async t=>{
 const h=fixture(t,{large:true}),trap=observe(h.record.snapshot_root);let result;
 try{result=await h.read();assert(result.text.includes('GUIDE BODY'));assert(result.text.includes('DEEP BODY'));assert(result.text.includes('"value":7'));assert(!result.text.includes('DO NOT LOAD OR EXECUTE THIS CODE'));assert(result.text.includes('Reference not expanded: reference-source/docs/large.md'));assert.equal(result.totalBytes,Buffer.byteLength(result.text));assert.equal(result.attachments.length,4);assert.equal(result.attachments.find(item=>item.label.endsWith('values.json')).kind,'reference-data');assert(!trap.events.some(event=>event.file.endsWith('program.py')||event.file.endsWith('large.md')));}finally{trap.restore();}
 const moved=path.join(h.root,'moved','cpu-worker-reference-package');fs.cpSync(h.record.snapshot_root,moved,{recursive:true,verbatimSymlinks:true,dereference:false});const record={...h.record,snapshot_root:moved},selection={...h.selection,path:path.join(moved,'SKILL.md')},relocated=await h.read({record,selection});assert.deepEqual(relocated,result);
});

test('sealed delivery and mismatched selections perform zero filesystem operations',async t=>{
 const h=fixture(t),file=h.selection.path,facts=active(h,[{id:'delivery',role:'delivery',paths:[file]}]),policy=createReadPolicy(facts,{scope:h.scope}),trap=observe(h.record.snapshot_root);
 try{await assert.rejects(h.read({policy}),/archived/);await assert.rejects(h.read({selection:{...h.selection,name:'other'}}),/unregistered_selection/);await assert.rejects(h.read({selection:{...h.selection,path:path.join(h.packageRoot,'SKILL.md')}}),/unregistered_selection/);assert.deepEqual(trap.counts,{exists:0,readdir:0,stat:0,open:0,read:0});}finally{trap.restore();}
});

test('a repair grant for the entry cannot silently read independently sealed references',async t=>{
 const h=fixture(t),guide=path.join(h.record.snapshot_root,'reference-source/docs/guide.md'),values=path.join(h.record.snapshot_root,'reference-source/data/values.json'),deep=path.join(h.record.snapshot_root,'reference-source/docs/sub/deep.md'),facts=active(h,[{id:'delivery',role:'delivery',paths:[h.selection.path]},{id:'reference',role:'configuration',paths:[guide,values,deep]}]);
 facts.readGrant={id:'human-repair',purpose:'repair',resourceIds:['delivery'],owner:{provider:'codex',threadId:'thread',taskId:null,leaseEpoch:3},authorityRevision:facts.revision,activationId:facts.activation.id,expiresAt:Date.now()+60000};
 const trap=observe(h.record.snapshot_root,{deny:[guide,values,deep]});try{await assert.rejects(h.read({policy:createReadPolicy(facts,{scope:h.scope})}),/archived/);assert(!trap.events.some(event=>[guide,values,deep].includes(event.file)));}finally{trap.restore();}
 facts.readGrant.resourceIds.push('reference');assert((await h.read({policy:createReadPolicy(facts,{scope:h.scope})})).text.includes('DEEP BODY'));
});

test('actual snapshot content tampering fails the bound size or SHA instead of returning changed guidance',async t=>{
 const h=fixture(t),file=path.join(h.record.snapshot_root,'reference-source/docs/guide.md'),original=fs.readFileSync(file);fs.chmodSync(file,0o644);fs.writeFileSync(file,Buffer.from(original.toString().replace('GUIDE BODY','WRONG BODY')));await assert.rejects(h.read(),/registered_hash_changed/);
 fs.writeFileSync(file,'short');await assert.rejects(h.read(),/registered_file_changed/);
});

test('missing, undeclared and out-of-package document references fail without opening an unversioned target',async t=>{
 for(const [body,expected]of [['[Missing](reference-source/docs/missing.md)',/resource_not_in_version/],['[Outside](../outside.md)',/reference_outside_package/],['[Encoded outside](..%2Foutside.md)',/reference_outside_package/]]){
  const h=fixture(t,{body}),trap=observe(h.record.snapshot_root);try{await assert.rejects(h.read(),expected);assert.equal(trap.events.filter(event=>event.kind==='open').length,1);}finally{trap.restore();}
 }
 const h=fixture(t),file=path.join(h.record.snapshot_root,'reference-source/docs/guide.md');fs.chmodSync(path.dirname(file),0o755);fs.unlinkSync(file);await assert.rejects(h.read(),/ENOENT/);
});

test('scope changes during an asynchronous stat or open return no body and close an already opened handle',async t=>{
 for(const stage of ['lstat','open']){
  const h=fixture(t);let current=true,closed=false;const original=promises[stage],scope={...h.scope,checkCurrent:()=>current},policy=createReadPolicy(legacyGuidanceFacts(),{scope});
  promises[stage]=async function(file,...args){const result=await original.call(this,file,...args);if(file===h.selection.path){current=false;if(stage==='open'){const close=result.close.bind(result);result.close=async()=>{closed=true;return close();};}}return result;};
  try{await assert.rejects(h.read({scope,policy}),/scope.changed/i);if(stage==='open')assert.equal(closed,true);}finally{promises[stage]=original;}
 }
});

test('file budgets, invalid UTF8 and unused reference definitions cannot silently broaden the attachment set',async t=>{
 const h=fixture(t),trap=observe(h.record.snapshot_root);try{await assert.rejects(h.read({limits:{maxFiles:1}}),/context_byte_limit/);assert.equal(trap.events.filter(event=>event.kind==='open').length,1);}finally{trap.restore();}
 const invalid=fixture(t,{invalidUtf8:true});await assert.rejects(invalid.read(),TypeError);
 const unused=fixture(t,{body:'[Guide](reference-source/docs/guide.md)\n[unused]: ../../not-requested.md\n'});assert((await unused.read()).text.includes('DEEP BODY'));
});

test('metadata-only redirects enforce physical archive policy and reject cycles/escapes before any IO',async t=>{
 const h=fixture(t),target='reference-source/docs/guide.md',physical=path.join(h.record.snapshot_root,...target.split('/')),record=structuredClone(h.record),leaf=record.files.find(row=>row.path===target);record.files=record.files.filter(row=>row.path!=='SKILL.md');record.files.push({path:'SKILL.md',kind:'symlink',target,size:Buffer.byteLength(target),sha256:sha(target)});record.delivery_skill.sha256=leaf.sha256;
 const facts=active(h,[{id:'physical',role:'delivery',paths:[physical]}]),trap=observe(h.record.snapshot_root);try{
  await assert.rejects(h.read({record,policy:createReadPolicy(facts,{scope:h.scope})}),/archived/);
  for(const [destination,error]of [['SKILL.md',/link_cycle/],['../outside.md',/reference_outside_package/]]){const altered=structuredClone(record),link=altered.files.find(row=>row.path==='SKILL.md');Object.assign(link,{target:destination,size:Buffer.byteLength(destination),sha256:sha(destination)});await assert.rejects(h.read({record:altered}),error);}
  assert.deepEqual(trap.counts,{exists:0,readdir:0,stat:0,open:0,read:0});
 }finally{trap.restore();}
});

test('actual versioned destinations support balanced/escaped parentheses, angle paths and ignored external URLs',async t=>{
 const body=String.raw`[Raw](reference-source/docs/guide(v1).md)
[Escaped](reference-source/docs/guide\(v1\).md)
[Encoded](reference-source/docs/guide%28v1%29.md)
[Angle](<reference-source/docs/angle guide(v1).md> "angle title")
[External](https://example.invalid/guide(v1).md)
`,h=fixture(t,{body,parentheses:true}),result=await h.read();assert(result.text.includes('BALANCED PARENTHESIS GUIDANCE'));assert(result.text.includes('ANGLE PATH GUIDANCE'));assert.equal(result.attachments.length,3);assert.equal(result.attachments.filter(item=>item.label.endsWith('guide(v1).md')).length,2);
});

test('malformed destination parentheses fail clearly instead of silently omitting a guidance document',async t=>{
 for(const body of ['[Guide](reference-source/docs/guide(v1).md','[Guide](<reference-source/docs/guide(v1).md)']){const h=fixture(t,{body,parentheses:true});await assert.rejects(h.read(),/invalid_markdown_destination/);}
});

test('registered relative delivery symlinks preserve the original content-directory references and relocation',async t=>{
 const h=fixture(t,{linked:true,linkedEntry:'original-guide.txt'});if(!h)return;assert.equal(h.record.files.find(item=>item.path==='SKILL.md').kind,'symlink');const result=await h.read();assert(result.text.includes('GUIDE BODY'));assert(result.text.includes('"value":7'));assert.equal(result.attachments[0].kind,'instructions');
 const moved=path.join(h.root,'linked-moved','cpu-worker-reference-package');fs.cpSync(h.record.snapshot_root,moved,{recursive:true,verbatimSymlinks:true,dereference:false});assert.deepEqual(await h.read({record:{...h.record,snapshot_root:moved},selection:{...h.selection,path:path.join(moved,'SKILL.md')}}),result);
});

test('logical and physical symlink targets are both policy-gated before IO; changed and escaping mappings fail closed',async t=>{
 const h=fixture(t,{linked:true});if(!h)return;const physical=path.join(h.record.snapshot_root,'reference-source/docs/entry.md'),facts=active(h,[{id:'physical',role:'delivery',paths:[physical]}]),trap=observe(h.record.snapshot_root);
 try{await assert.rejects(h.read({policy:createReadPolicy(facts,{scope:h.scope})}),/archived/);assert.deepEqual(trap.counts,{exists:0,readdir:0,stat:0,open:0,read:0});}finally{trap.restore();}
 fs.chmodSync(h.record.snapshot_root,0o755);fs.unlinkSync(h.selection.path);fs.symlinkSync('manual.md',h.selection.path,'file');await assert.rejects(h.read(),/link_mapping_changed/);
 fs.unlinkSync(h.selection.path);fs.symlinkSync('../outside.md',h.selection.path,'file');await assert.rejects(h.read(),/link_mapping_changed/);
});
