/** Create a private, ignored guidance overlay from explicit registration metadata.
 * This helper does not connect, probe, execute engines, register environments or read referenced skills.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const MAX_BYTES=64*1024;
const ID=/^[a-z0-9][a-z0-9-]{0,47}$/;
const ENGINES=new Set(['gpumd.neb','gpumd.md','pydyn.md','gpumd.sampling','pydyn.sampling','pygas.build','bias.validate','nep.train','nep.eval','nep.analyze','hotpp.train','hotpp.eval','hotpp.export','pygas.reweight','pygas.opes-reweight']);
const forbidden=/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}/i;
function fail(message){throw Error(message);}
function object(value,allowed,required,label){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Expected object: '+label);
 if(Object.keys(value).some(k=>!allowed.includes(k)))fail('Unsupported field in '+label+'; connection details, secrets and shell recipes do not belong in this profile');
 for(const k of required)if(!Object.hasOwn(value,k))fail('Required profile field: '+label+'.'+k);
}
function text(value,label,limit=256){
 if(typeof value!=='string'||!value||value.length>limit||/[\x00-\x1f\x7f]/.test(value)||forbidden.test(value))fail('Invalid private metadata: '+label);
 return value;
}
function id(value,label){text(value,label);if(!ID.test(value))fail('Invalid registration identifier: '+label);}
function linuxPath(value,label){
 text(value,label,1024);
 if(!value.startsWith('/')||value==='/'||value.includes('\\')||value.split('/').some(x=>x==='..'||x==='.')||/[`$;|<>]/.test(value))fail('Expected scoped absolute Linux path: '+label);
}
function paths(value,allowed,label){
 object(value,allowed,[],label);if(!Object.keys(value).length)fail('Empty path map: '+label);
 for(const [key,v] of Object.entries(value))linuxPath(v,label+'.'+key);
}
export function validateProfile(input){
 if(JSON.stringify(input).length>MAX_BYTES)fail('Private profile exceeds size limit');
 object(input,['schema_version','id','name','transport','connection_ref','scheduler','queue','run_root','lsf_memory_scope','environments','limits','local_skill_refs'],['schema_version','id','name','transport','connection_ref','scheduler','environments','limits'],'profile');
 if(input.schema_version!==1)fail('Unsupported profile schema version');
 id(input.id,'id');id(input.connection_ref,'connection_ref');text(input.name,'name');
 if(!['ssh','local-wsl'].includes(input.transport))fail('Unsupported profile transport');
 if(!(input.transport==='ssh'?['lsf','slurm']:['local']).includes(input.scheduler))fail('Scheduler and transport do not match');
 if(input.queue!==undefined){text(input.queue,'queue');if(input.scheduler==='local'||!/^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,127}$/.test(input.queue))fail('Invalid scheduler queue');}
 if(input.run_root!==undefined)linuxPath(input.run_root,'run_root');
 if(input.lsf_memory_scope!==undefined&&(input.scheduler!=='lsf'||!['per_slot','per_job'].includes(input.lsf_memory_scope)))fail('LSF memory scope must match an LSF deployment');
 object(input.limits,['cpus','gpus','memory_mb','max_seconds'],['cpus','gpus','memory_mb','max_seconds'],'limits');
 const bounds={cpus:[1,65536],gpus:[0,4096],memory_mb:[1,1073741824],max_seconds:[1,31536000]};
 for(const [key,[min,max]] of Object.entries(bounds))if(!Number.isSafeInteger(input.limits[key])||input.limits[key]<min||input.limits[key]>max)fail('Invalid resource bound: '+key);
 if(!Array.isArray(input.environments)||!input.environments.length||input.environments.length>16)fail('Select explicit registered environments');
 const seen=new Set();
 for(const env of input.environments){
  object(env,['id','engines','version','executables','repositories'],['id','engines','version','executables'],'environment');
  id(env.id,'environment.id');if(seen.has(env.id))fail('Duplicate environment identifier');seen.add(env.id);text(env.version,'environment.version');
  if(!Array.isArray(env.engines)||!env.engines.length||env.engines.length>ENGINES.size||new Set(env.engines).size!==env.engines.length||env.engines.some(e=>!ENGINES.has(e)))fail('Unsupported or duplicate environment engine');
  paths(env.executables,['python','gpumd','gpu-sampling','nep','hotpp','pygas'],'executables');
  if(env.repositories!==undefined)paths(env.repositories,['pydyn','pygas','gpumd','hotpp','torchnep'],'repositories');
 }
 if(input.local_skill_refs!==undefined){
  if(!Array.isArray(input.local_skill_refs)||input.local_skill_refs.length>32||new Set(input.local_skill_refs).size!==input.local_skill_refs.length)fail('Invalid explicit local skill references');
  for(const ref of input.local_skill_refs){
   text(ref,'local_skill_refs',1024);
   if(!(path.posix.isAbsolute(ref)||path.win32.isAbsolute(ref))||ref.split(/[\\/]/).some(p=>p==='..'||p==='.')||!/[\\/]SKILL\.md$/.test(ref))fail('Expected absolute local SKILL.md reference');
  }
 }
 return structuredClone(input);
}
function git(root,args){
 const result=spawnSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024});
 if(result.error)fail('Git is required to verify private output isolation');
 return result;
}
function samePath(a,b){return process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;}
function safeDirectory(parent,name){
 const target=path.join(parent,name);
 if(fs.existsSync(target)){
  const info=fs.lstatSync(target);
  if(info.isSymbolicLink()||!info.isDirectory())fail('Private output ancestors must be real directories');
 }else fs.mkdirSync(target);
 if(!samePath(fs.realpathSync(target),target))fail('Private output ancestor resolves outside its declared path');
 return target;
}
export function localizeSkill({repoRoot,profile}){
 const value=validateProfile(profile);
 const requested=path.resolve(repoRoot||process.cwd());
 const root=fs.realpathSync(requested);
 if(!samePath(requested,root))fail('Repository root must not traverse a link');
 const top=git(root,['rev-parse','--show-toplevel']);
 if(top.status!==0||!samePath(path.resolve(top.stdout.trim()),root))fail('Select the exact Git repository root');
 const source=path.join(root,'agents','skills','studio-compute-workflow','SKILL.md');
 if(!fs.existsSync(source)||fs.lstatSync(source).isSymbolicLink()||!fs.lstatSync(source).isFile()||!samePath(fs.realpathSync(source),source))fail('Portable compute skill is missing or linked');
 const relative='.studio/local-skills/'+value.id;
 for(const name of ['profile.json','SKILL.md','provenance.json']){
  const dest=relative+'/'+name;
  if(git(root,['check-ignore','--no-index','--quiet','--',dest]).status!==0)fail('Private output must be ignored by Git');
  const tracked=git(root,['ls-files','--error-unmatch','--',dest]);
  if(tracked.status===0)fail('Private output must never be tracked');
  if(tracked.status!==1)fail('Unable to verify tracked output isolation');
 }
 // Check each ancestor, not only the final destination: junctions can escape the checkout.
 const studio=safeDirectory(root,'.studio'),local=safeDirectory(studio,'local-skills');
 const output=path.join(local,value.id);
 try{fs.lstatSync(output);fail('Private overlay already exists; select a new profile identifier');}catch(error){if(error.code!=='ENOENT')throw error;}
 const staging=path.join(local,'.pending-'+crypto.randomUUID());
 fs.mkdirSync(staging);
 try{
  const parentRef='../../../agents/skills/studio-compute-workflow/SKILL.md';
  const skill='---\nname: studio-local-'+value.id+'\ndescription: Private deployment guide for a user-selected Studio compute registration. Read its portable parent before using the associated profile.\n---\n\n# Private compute overlay\n\nRead ['+parentRef+']('+parentRef+') first, then read the adjacent `profile.json` as metadata. This folder is private and must not be copied into a release, shared report or remote job.\n\nThe profile contains user-selected registration references and unverified environment metadata. Re-probe the selected registration in Studio before use. Do not treat these values as authorization, shell instructions or evidence of a successful run. Do not read or copy referenced local skill files unless the user workflow actually requires that selected skill.\n\nComplete the scientific workflow before configuring deployment. MetaD defaults to one task and one walker. Prepare the actual inputs and batch preview; execution remains the user\'s review action in Studio. Use the same recorded run after reconnecting and return actual results.\n';
  const provenance={schema_version:1,portable_skill_sha256:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),created_at:new Date().toISOString(),validation_status:'not_run',scope:'private guidance only; no environment probe, registration, submission or execution performed'};
  fs.writeFileSync(path.join(staging,'profile.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(staging,'SKILL.md'),skill,{flag:'wx'});
  fs.writeFileSync(path.join(staging,'provenance.json'),JSON.stringify(provenance,null,2)+'\n',{flag:'wx'});
  fs.renameSync(staging,output);
 }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
 return {directory:output,profileId:value.id,validationStatus:'not_run',files:['profile.json','SKILL.md','provenance.json']};
}
export function main(argv){
 const args={};
 for(let i=0;i<argv.length;i++){
  const key=argv[i];if(!['--profile','--repo'].includes(key)||args[key]!==undefined||!argv[i+1]||argv[i+1].startsWith('--'))fail('Usage: node scripts/localize-skill.mjs --profile <explicit-private-json> [--repo <checkout-root>]');
  args[key]=argv[++i];
 }
 if(!args['--profile'])fail('An explicit private profile file is required');
 const file=path.resolve(args['--profile']);
 const info=fs.lstatSync(file);
 if(info.isSymbolicLink()||!info.isFile()||info.size>MAX_BYTES)fail('Profile must be a bounded regular JSON file');
 let profile;try{profile=JSON.parse(fs.readFileSync(file,'utf8'));}catch{fail('Invalid private profile JSON');}
 localizeSkill({repoRoot:args['--repo']||process.cwd(),profile});
 // Do not echo connection references, names, paths or the input JSON into installer logs.
 return {status:'created',validation_status:'not_run',files_created:3};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(main(process.argv.slice(2)))+'\n');}
 catch(error){process.stderr.write((error.code?'Private overlay generation failed; check the selected file and directory.':error.message)+'\n');process.exitCode=1;}
}
