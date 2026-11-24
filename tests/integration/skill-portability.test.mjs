import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {localizeSkill,validateProfile} from "../../scripts/localize-skill.mjs";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const command=path.join(repo,'scripts','localize-skill.mjs');
function run(exe,args){return spawnSync(exe,args,{encoding:'utf8',windowsHide:true});}
function cleanupTree(dir){
 if(!fs.existsSync(dir))return;
 const walk=p=>{let s;try{s=fs.lstatSync(p);}catch{return;}if(s.isSymbolicLink()){try{fs.unlinkSync(p);}catch{fs.rmdirSync(p);}return;}if(s.isDirectory()){try{fs.chmodSync(p,0o777);}catch{}for(const n of fs.readdirSync(p))walk(path.join(p,n));}else{try{fs.chmodSync(p,0o666);}catch{}}};
 walk(dir);
 fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:50});
}
function fixture(ignore='.studio/\n'){
 fs.mkdirSync(path.join(repo,'.studio'),{recursive:true});
 const root=fs.mkdtempSync(path.join(repo,'.studio','test-skill-portability-'));
 assert.equal(run('git',['init','--quiet',root]).status,0,'fixture git repository');
 fs.writeFileSync(path.join(root,'.gitignore'),ignore);
 const dest=path.join(root,'agent','builtin-skills','studio-compute-workflow');fs.mkdirSync(dest,{recursive:true});
 fs.copyFileSync(path.join(repo,'agent','builtin-skills','studio-compute-workflow','SKILL.md'),path.join(dest,'SKILL.md'));
 return {root,cleanup:()=>cleanupTree(root)};
}
function profile(id='selected-compute'){
 return {schema_version:1,id,name:'Private deployment',transport:'ssh',connection_ref:'registered-connection',scheduler:'lsf',queue:'selected-queue',run_root:'/opt/private-runs',lsf_memory_scope:'per_job',
 environments:[{id:'registered-sampling',engines:['gpumd.sampling','pydyn.sampling'],version:'user-selected-revision',executables:{python:'/opt/test-runtime/bin/python',gpumd:'/opt/test-runtime/bin/gpumd'},repositories:{pygas:'/opt/test-sources/pygas'}}],
 limits:{cpus:2,gpus:1,memory_mb:4096,max_seconds:120}};
}
function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}

test('Portable localization creates only ignored guidance, preserving exact explicit metadata and not claiming validation',()=>{
 const f=fixture();try{
  const value=profile(),gitignoreHash=hash(path.join(f.root,'.gitignore'));
  const result=localizeSkill({repoRoot:f.root,profile:value});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.directory,'profile.json'),'utf8')),value);
  const evidence=JSON.parse(fs.readFileSync(path.join(result.directory,'provenance.json'),'utf8'));
  assert.equal(evidence.validation_status,'not_run');
  assert.equal(evidence.portable_skill_sha256,hash(path.join(f.root,'agent','builtin-skills','studio-compute-workflow','SKILL.md')));
  assert.deepEqual(fs.readdirSync(result.directory).sort(),['SKILL.md','profile.json','provenance.json']);
  const guide=fs.readFileSync(path.join(result.directory,'SKILL.md'),'utf8');
  const parent=guide.match(/\]\(([^)]+\/SKILL\.md)\)/)?.[1];assert(parent);assert(fs.existsSync(path.resolve(result.directory,parent)),'portable parent link resolves in a relocated checkout');
  assert.equal(hash(path.join(f.root,'.gitignore')),gitignoreHash);
  const status=run('git',['-C',f.root,'status','--porcelain','--untracked-files=all']);assert.equal(status.status,0);assert(!status.stdout.includes('.studio'),'private configuration absent from Git changes');
 }finally{f.cleanup();}
});

test('A registered GPU-Sampling executable survives profile validation and localization unchanged',()=>{
 const f=fixture();try{
  const selected=profile();selected.environments[0].executables['gpu-sampling']='/opt/selected-runtime/bin/gpu-sampling';
  const result=localizeSkill({repoRoot:f.root,profile:selected});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.directory,'profile.json'),'utf8')),selected);
  assert.equal(validateProfile(selected).environments[0].executables['gpu-sampling'],selected.environments[0].executables['gpu-sampling']);
  const schema=JSON.parse(fs.readFileSync(path.join(repo,'agent','builtin-skills','studio-compute-workflow','references','compute-profile.schema.json'),'utf8'));
  assert.deepEqual(schema.properties.environments.items.properties.executables.properties['gpu-sampling'],schema.properties.environments.items.properties.executables.properties.gpumd);
 }finally{f.cleanup();}
});

test('Overlay generation uses the new checkout and new profile without copying another installation',()=>{
 const a=fixture(),b=fixture();try{
  const first=localizeSkill({repoRoot:a.root,profile:profile('origin')});
  const next=profile('recipient');next.connection_ref='recipient-connection';next.run_root='/opt/recipient-runs';next.environments[0].executables.gpumd='/opt/recipient/bin/gpumd';
  const second=localizeSkill({repoRoot:b.root,profile:next});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(second.directory,'profile.json'),'utf8')),next);
  assert(!fs.readFileSync(path.join(second.directory,'profile.json'),'utf8').includes('/opt/private-runs'));
  assert.equal(fs.readdirSync(path.join(b.root,'.studio','local-skills')).length,1);
  assert.notEqual(first.directory,second.directory);
 }finally{a.cleanup();b.cleanup();}
});

test('No user skill contents are read or copied, even when explicitly referenced',()=>{
 const f=fixture();try{
  const privateFile=path.join(f.root,'selected-user-skill','SKILL.md');fs.mkdirSync(path.dirname(privateFile));fs.writeFileSync(privateFile,'PRIVATE_SENTINEL_NOT_FOR_DISTRIBUTION');
  const value=profile();value.local_skill_refs=[privateFile];
  const original=fs.readFileSync;let reads=0;
  fs.readFileSync=function(file,...args){if(path.resolve(String(file))===privateFile){reads++;throw Error('Referenced skills must not be read');}return original.call(this,file,...args);};
  let result;try{result=localizeSkill({repoRoot:f.root,profile:value});}finally{fs.readFileSync=original;}
  assert.equal(reads,0);
  for(const name of result.files)assert(!fs.readFileSync(path.join(result.directory,name),'utf8').includes('PRIVATE_SENTINEL_NOT_FOR_DISTRIBUTION'));
 }finally{f.cleanup();}
});

test('Profile validation rejects traversal, credentials, executable recipes and invalid resource or scheduler choices before writing',()=>{
 const f=fixture();try{
  const mutations=[
   p=>p.id='../outside',p=>p.id='nested/name',p=>p.id='.',p=>p.connection_ref='../../outside',p=>p.host='private-host',p=>p.port=2222,p=>p.username='some-user',
   p=>p.apiKey='not-allowed',p=>p.activation='source arbitrary.sh',p=>p.password='not-allowed',p=>p.name='Bearer forbidden-token',p=>p.name='sk-test-secret-value',p=>p.name='-----BEGIN OPENSSH PRIVATE KEY-----',
   p=>p.environments[0].executables.python='/opt/runtime/../../bin/python',p=>p.environments[0].executables.python='/opt/$(touch sentinel)/python',p=>p.run_root='/',p=>p.run_root='/opt/runs\ncommand',
   p=>p.limits.gpus=-1,p=>p.limits.max_seconds=Infinity,p=>p.limits.cpus=1.5,p=>p.scheduler='slurm',p=>p.transport='local-wsl',p=>p.environments[0].engines=['imaginary.engine'],
   p=>p.local_skill_refs=['../SKILL.md'],p=>p.environments.push(structuredClone(p.environments[0])),p=>p.environments[0].executables.token='credential',
  ];
  for(const change of mutations){const p=profile();change(p);assert.throws(()=>localizeSkill({repoRoot:f.root,profile:p}));}
  assert(!fs.existsSync(path.join(f.root,'.studio')),'invalid profiles cause no private output writes');
 }finally{f.cleanup();}
});

test('Destinations must be truly ignored, including ignore exceptions and already tracked outputs',()=>{
 for(const kind of ['missing','exception','tracked']){
  const ignore=kind==='missing'?'':'/.studio/*\n!/.studio/local-skills/\n';
  const f=fixture(kind==='tracked'?'.studio/\n':ignore);try{
   if(kind==='tracked'){
    const tracked=path.join(f.root,'.studio','local-skills','selected-compute');fs.mkdirSync(tracked,{recursive:true});fs.writeFileSync(path.join(tracked,'profile.json'),'{}');
    assert.equal(run('git',['-C',f.root,'add','-f','.studio/local-skills/selected-compute/profile.json']).status,0);
   }
   assert.throws(()=>localizeSkill({repoRoot:f.root,profile:profile()}),/ignored|tracked/);
  }finally{f.cleanup();}
 }
});

test('Linked output ancestors cannot redirect private metadata outside its checkout',()=>{
 for(const level of ['.studio','local-skills']){
  const f=fixture(),outside=fs.mkdtempSync(path.join(repo,'.studio','skill-external-'));try{
   let target=path.join(f.root,'.studio');if(level==='local-skills'){fs.mkdirSync(target);target=path.join(target,'local-skills');}
   fs.symlinkSync(outside,target,process.platform==='win32'?'junction':'dir');
   assert.throws(()=>localizeSkill({repoRoot:f.root,profile:profile()}));
   assert.deepEqual(fs.readdirSync(outside),[],'no files escaped into linked directory');
   fs.unlinkSync(target);
  }finally{f.cleanup();fs.rmSync(outside,{recursive:true,force:true});}
 }
});

test('Existing private overlays are immutable to this helper',()=>{
 const f=fixture();try{
  const first=localizeSkill({repoRoot:f.root,profile:profile()}),before=Object.fromEntries(first.files.map(name=>[name,hash(path.join(first.directory,name))]));
  const changed=profile();changed.queue='different-queue';
  assert.throws(()=>localizeSkill({repoRoot:f.root,profile:changed}),/already exists/);
  assert.deepEqual(Object.fromEntries(first.files.map(name=>[name,hash(path.join(first.directory,name))])),before);
 }finally{f.cleanup();}
});

test('CLI requires explicit bounded JSON, reports no private fields, and never runs metadata paths',()=>{
 const f=fixture();try{
  const missing=run(process.execPath,[command,'--repo',f.root]);assert.notEqual(missing.status,0);
  const file=path.join(f.root,'input.json'),value=profile();value.name='sensitive-name-marker';value.connection_ref='private-connection-marker';
  fs.writeFileSync(file,JSON.stringify(value));
  const created=run(process.execPath,[command,'--repo',f.root,'--profile',file]);assert.equal(created.status,0,created.stderr);
  assert.deepEqual(JSON.parse(created.stdout),{status:'created',validation_status:'not_run',files_created:3});
  for(const secret of [value.name,value.connection_ref,value.run_root,...Object.values(value.environments[0].executables)])assert(!(created.stdout+created.stderr).includes(secret));
  fs.writeFileSync(file,'x'.repeat(65*1024));assert.notEqual(run(process.execPath,[command,'--repo',f.root,'--profile',file]).status,0);
  fs.writeFileSync(file,'{this is not json}');const bad=run(process.execPath,[command,'--repo',f.root,'--profile',file]);assert.notEqual(bad.status,0);assert(!bad.stderr.includes(file));
 }finally{f.cleanup();}
});

test('Public skill distribution contains no concrete machine paths, IP endpoints, SSH commands with ports or embedded secrets',()=>{
 const root=path.join(repo,'agent','builtin-skills');
 function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
 const files=walk(root);assert(files.length>=4);
 for(const file of files){
  const source=fs.readFileSync(file,'utf8');
  assert(!/(?:[A-Z]:\\(?:Users|data)\\|\/home\/[^\s/]+\/|\/mnt\/[a-z]\/|\b(?:\d{1,3}\.){3}\d{1,3}\b|ssh\s+-p\s+\d+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(source),'public file contains machine-specific material: '+path.relative(root,file));
 }
 const schema=JSON.parse(fs.readFileSync(path.join(root,'studio-compute-workflow','references','compute-profile.schema.json'),'utf8'));
 assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.environments.items.additionalProperties,false);
 const p=profile();p.transport='local-wsl';p.scheduler='local';delete p.queue;delete p.lsf_memory_scope;assert.equal(validateProfile(p).scheduler,'local');
});
