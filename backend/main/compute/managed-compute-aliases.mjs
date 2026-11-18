import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {COMPUTE_ALIASES_SKILL} from '../../../agent/skills/project-skills.mjs';

const START='<!-- AIMatterLab resource aliases -->', END='<!-- End AIMatterLab resource aliases -->';
const EMPTY=`---\nname: ${COMPUTE_ALIASES_SKILL}\ndescription: User-confirmed names for saved AIMatterLab compute resources.\n---\n\n# Compute resource aliases\n\nThese aliases resolve to stable saved profile IDs. Acquire the available resource through AIMatterLab in the current conversation.\n`;
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function normalizeComputeAlias(value){
 if(typeof value!=='string'||value.length>128||/[\r\n\x00-\x1f\x7f]/.test(value))return null;
 const key=value.normalize('NFKC').trim().toLowerCase();
 return /^[\p{L}\p{N}][\p{L}\p{N} ._+-]{0,63}$/u.test(key)?key:null;
}

export function resourceFingerprint(profile){
 if(profile?.kind==='ssh')return hash(['managed-ssh-target-v1',String(profile.host).toLowerCase(),profile.username,profile.port,
  profile.ssh_client,profile.distribution||'',profile.proxy_jump||[],profile.via||[]]);
 if(profile?.kind==='wsl')return hash(['managed-wsl-target-v1',profile.distribution,profile.root,profile.port]);
 throw Error('managed_compute_profile_changed');
}

function parse(body){
 const start=body.indexOf(START),end=body.indexOf(END);
 if(start===-1&&end===-1)return {entries:[],prefix:body,suffix:''};
 if(start<0||end<start||body.indexOf(START,start+START.length)!==-1||body.indexOf(END,end+END.length)!==-1)throw Error('managed_compute_alias_document_invalid');
 const block=/^\s*```json\r?\n([\s\S]+?)\r?\n```\s*$/.exec(body.slice(start+START.length,end));
 let entries;
 try{entries=JSON.parse(block?.[1]||'');}catch{throw Error('managed_compute_alias_document_invalid');}
 if(!Array.isArray(entries)||entries.length>64||entries.some(row=>!row||Object.keys(row).length!==3||normalizeComputeAlias(row.alias)!==row.alias||!id(row.profileId)||!(/^[a-f0-9]{64}$/).test(row.targetFingerprint||''))||new Set(entries.map(row=>row.alias)).size!==entries.length)throw Error('managed_compute_alias_document_invalid');
 return {entries,prefix:body.slice(0,start),suffix:body.slice(end+END.length)};
}

export function createManagedComputeAliases({projectSkills}){
 function load(checkCurrent){
  const skills=typeof projectSkills==='function'?projectSkills():projectSkills;
  const document=skills.confirmedComputeAliases({checkCurrent});
  return {skills,sha256:document?.sha256??null,...parse(document?.body??EMPTY)};
 }
 function read(alias,checkCurrent){return load(checkCurrent).entries.find(row=>row.alias===alias)||null;}
 function remember(alias,resource,expected,checkCurrent){
  const entry={alias,profileId:resource.profileId,targetFingerprint:resource.targetFingerprint};
  for(let attempt=0;attempt<3;attempt++){
   const {entries,prefix,suffix,sha256,skills}=load(checkCurrent),prior=entries.find(row=>row.alias===alias)||null;
   if(equal(prior,entry))return;
   if(!equal(prior,expected))throw Error('managed_compute_alias_changed');
   const merged=[...entries.filter(row=>row.alias!==alias),entry].sort((a,b)=>a.alias.localeCompare(b.alias));
   if(merged.length>64)throw Error('managed_compute_alias_limit');
   const gap=prefix.endsWith('\n\n')||!prefix?'':prefix.endsWith('\n')?'\n':'\n\n';
   const body=prefix+gap+START+'\n```json\n'+JSON.stringify(merged,null,2)+'\n```\n'+END+(suffix||'\n');
   try{skills.confirmedComputeAliases({body,expectedSha256:sha256,checkCurrent});return;}
   catch(error){if(error.message!=='Skill revision changed; read before saving'||attempt===2)throw error;}
  }
 }
 return {read,remember,list:checkCurrent=>load(checkCurrent).entries.map(row=>row.alias)};
}
