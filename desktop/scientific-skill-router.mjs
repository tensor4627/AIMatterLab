import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const PROVIDERS=new Set(['codex','kimi','qwen','deepseek','compatible']);
const sha=value=>createHash('sha256').update(value).digest('hex');
const safeRelative=value=>typeof value==='string'&&value.length>0&&/^[A-Za-z0-9_./-]+$/.test(value)&&!value.includes('\\')&&!path.posix.isAbsolute(value)&&value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
const inside=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
async function boundedText(target,maximum){
 const before=await fs.lstat(target,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.size>BigInt(maximum))throw Error('Public skill context exceeds the bounded file budget');
 const handle=await fs.open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const opened=await handle.stat({bigint:true});
  if(['dev','ino','size','mtimeNs','ctimeNs'].some(key=>opened[key]!==before[key]))throw Error('Public skill file changed while opening');
  const buffer=Buffer.alloc(Number(before.size)+1);let total=0;
  for(;;){const {bytesRead}=await handle.read(buffer,total,buffer.length-total,null);total+=bytesRead;if(!bytesRead||total===buffer.length)break;}
  const after=await handle.stat({bigint:true});
  if(total!==Number(before.size)||['dev','ino','size','mtimeNs','ctimeNs'].some(key=>after[key]!==before[key]))throw Error('Public skill file changed while reading');
  return buffer.subarray(0,total);
 }finally{await handle.close();}
}
export class ScientificSkillRouter {
 constructor({map,sourceRoot,consent,setupAllowed=()=>false,ruleEvidence,limits={}}){
  this.map=structuredClone(map);this.sourceRoot=sourceRoot;this.consent=consent;this.setupAllowed=setupAllowed;this.ruleEvidence=ruleEvidence;this.limits={fileBytes:64*1024,totalBytes:192*1024,...limits};
  this.definitions=new Map();this.routes=new Map();
  if(this.map.schema_version!==1)throw Error('Unsupported skill map');
  for(const skill of this.map.skills){
   if(this.definitions.has(skill.id)||!safeRelative(skill.folder)||!Array.isArray(skill.files)||!skill.files.length||[...skill.files,...skill.reference_files||[]].some(file=>!safeRelative(file)))throw Error('Invalid public skill definition');
   this.definitions.set(skill.id,skill);
  }
  for(const route of this.map.functions){
   if(this.routes.has(route.id)||!Array.isArray(route.skills)||route.skills.some(id=>!this.definitions.has(id)))throw Error('Invalid function route');
   for(const [id,files] of Object.entries(route.reference_files||{}))if(!route.skills.includes(id)||!Array.isArray(files)||files.some(file=>!(this.definitions.get(id).reference_files||[]).includes(file)))throw Error('Invalid bounded route reference');
   this.routes.set(route.id,route);
  }
 }
 async allowed(provider,skill){
  if(!PROVIDERS.has(provider))throw Error('Unsupported authenticated provider');
  // Legacy pyGAS consent is resolved by the owner callback; it never grants other families.
  return skill.source==='studio'||await this.consent(provider,skill.source)===true;
 }
 async catalog(provider){
  if(!PROVIDERS.has(provider))throw Error('Unsupported authenticated provider');
  const functions=[];
  for(const route of this.routes.values()){
   const sources=[...new Set(route.skills.map(id=>this.definitions.get(id).source))],permissions={};
   for(const id of route.skills){const skill=this.definitions.get(id);permissions[skill.source]=await this.allowed(provider,skill);}
   functions.push({id:route.id,phase:route.phase,engines:route.engines||[],tools:route.tools||[],status:route.status,sources,permission:sources.every(source=>permissions[source])?'allowed':'permission_required'});
  }
  return {schema_version:1,scope:'Guidance routing only; source registration is not an available or scientifically validated engine.',functions};
 }
 async read(provider,functionId){
  if(!PROVIDERS.has(provider))throw Error('Unsupported authenticated provider');
  const route=this.routes.get(functionId);if(!route)throw Error('Choose a listed function_id');
  if(['installation','setup','toolchain'].includes(route.phase)&&await this.setupAllowed(provider,route)!==true)return {status:'blocked',function_id:functionId,reason:'Setup guidance is not loaded in an ordinary calculation. Select the environment setup or explicit repair stage first.',attachments:[]};
  const files=[];let bytes=0;const roots=new Map();
  const check=async()=>{
   for(const id of route.skills){const skill=this.definitions.get(id);if(!await this.allowed(provider,skill))return false;}
   return true;
  };
  if(!await check())return {status:'permission_required',function_id:functionId,attachments:[]};
  try{
   for(const id of route.skills){
    const skill=this.definitions.get(id),configured=await this.sourceRoot(skill.source);
    if(typeof configured!=='string'||!path.isAbsolute(configured))throw Error('Public source is not registered: '+skill.source);
    const root=await fs.realpath(configured),folder=path.join(root,...skill.folder.split('/'));
    if(!inside(root,folder)||await fs.realpath(folder)!==folder)throw Error('Linked or out-of-root skill folder refused');
    roots.set(skill.source,{configured,root});
    for(const relative of [...skill.files,...route.reference_files?.[id]||[]]){
     const target=path.join(folder,...relative.split('/'));if(!inside(folder,target)||await fs.realpath(target)!==target)throw Error('Linked or out-of-root skill file refused');
     const stat=await fs.stat(target);if(!stat.isFile()||stat.size>this.limits.fileBytes||bytes+stat.size>this.limits.totalBytes)throw Error('Public skill context exceeds the bounded file budget');
     const data=await boundedText(target,Math.min(this.limits.fileBytes,this.limits.totalBytes-bytes));if(data.length!==stat.size||await fs.realpath(target)!==target||data.includes(0))throw Error('Public skill file changed or is not text');
     bytes+=data.length;const content=new TextDecoder('utf-8',{fatal:true}).decode(data);let source_evidence;if(skill.source==='studio'&&relative.endsWith('.json')&&this.ruleEvidence)source_evidence=await this.ruleEvidence(JSON.parse(content));files.push({skill:id,source:skill.source,name:skill.folder+'/'+relative,sha256:sha(data),bytes:data.length,content,...source_evidence?{source_evidence}:{}});
    }
   }
   // Authorization is never cached with text. Recheck revocation and source rebind before returning.
   if(!await check())return {status:'permission_required',function_id:functionId,attachments:[]};
   for(const [source,observed] of roots){const configured=await this.sourceRoot(source);if(configured!==observed.configured||await fs.realpath(configured)!==observed.root)throw Error('Public source changed while the route was being read');}
   if(!await check())return {status:'permission_required',function_id:functionId,attachments:[]};
   const digest=sha(files.map(file=>file.name+':'+file.sha256+':'+JSON.stringify(file.source_evidence||null)).join('\n'));
   return {status:'passed',function_id:functionId,phase:route.phase,capability_status:route.status,scope:'Actual bounded public instructions only; no artifact, installation, engine capability or scientific validation is implied.',digest,bytes,attachments:files.map(({content,...receipt})=>receipt),text:'[Studio scientific function: '+functionId+']\n'+(route.adaptation||'')+'\n'+files.map(file=>'['+file.name+'; SHA256 '+file.sha256+']\n'+(file.source_evidence?'Current source applicability: '+JSON.stringify(file.source_evidence)+'\n':'')+file.content).join('\n')};
  }catch(error){return {status:'blocked',function_id:functionId,reason:error.message,attachments:[]};}
 }
}
