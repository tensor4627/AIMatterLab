import path from 'node:path';
import {createHash} from 'node:crypto';

const states=new Set(['legacy_unconfigured','active','stale','revoked']);
const roles=new Set(['delivery','installation','configuration']);
const sha=text=>createHash('sha256').update(text).digest('hex');
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const text=value=>typeof value==='string'&&value.length>0;
const absolute=value=>typeof value==='string'&&(path.isAbsolute(value)||path.win32.isAbsolute(value));
const normalized=value=>{const windows=/^[A-Za-z]:[\\/]|^\\\\/.test(value);return (windows?path.win32.normalize(value).replaceAll('\\','/').toLowerCase():path.posix.normalize(value)).replace(/\/$/,'');};
const within=(file,root)=>file===root||file.startsWith(root+'/');

export const legacyGuidanceFacts=()=>({schemaVersion:1,revision:'legacy_unconfigured',state:'legacy_unconfigured',archivedResources:[]});

function stableJson(value){
 if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableJson(value[key])).join(',')+'}';
 return JSON.stringify(value);
}

function checkedFacts(value){
 if(!plain(value)||value.schemaVersion!==1||!text(value.revision)||!states.has(value.state))throw Error('Invalid guidance authority facts');
 const facts=structuredClone(value);
 if(!Array.isArray(facts.archivedResources??[]))throw Error('Invalid archived guidance resources');
 facts.archivedResources??=[];
 for(const key of ['applicableFunctions','engines'])if(facts[key]!==undefined&&(!Array.isArray(facts[key])||facts[key].some(value=>!text(value))))throw Error('Invalid guidance route applicability');
 for(const resource of facts.archivedResources)if(!plain(resource)||!text(resource.id)||!roles.has(resource.role)||!Array.isArray(resource.paths)||resource.paths.some(file=>!absolute(file)))throw Error('Invalid archived guidance resource');
 if(facts.state!=='legacy_unconfigured'){
  if(!plain(facts.package)||!['id','version','manifestSha256','sourceCommit'].every(key=>text(facts.package[key]))||!plain(facts.workerBinding)||!text(facts.workerBinding.distribution)||!text(facts.workerBinding.root)||!Number.isInteger(facts.workerBinding.port)||!plain(facts.target)||facts.target.kind!=='local'||!['projectId','environmentId','fingerprint'].every(key=>text(facts.target[key])))throw Error('Incomplete guidance authority binding');
 }
 if(facts.state==='active'){
  if(!plain(facts.activation)||!['id','revision','configurationId'].every(key=>text(facts.activation[key])))throw Error('Missing authoritative guidance activation');
  const execution=facts.executionSkill;
  if(!plain(execution)||!text(execution.id)||!text(execution.text)||execution.sha256!==sha(execution.text)||!Array.isArray(execution.resources))throw Error('Invalid execution skill snapshot');
  for(const resource of execution.resources)if(!plain(resource)||!text(resource.id)||!text(resource.text)||resource.sha256!==sha(resource.text))throw Error('Execution skill resources must be self-contained snapshots');
 }
 return freeze(facts);
}

/** Resolve backend facts before consulting any guidance filesystem or root resolver. */
export async function resolveReadPolicy({resolveGuidance=async()=>legacyGuidanceFacts(),assertScope=()=>{}}={},scope={}){
 assertScope(scope);const facts=checkedFacts(await resolveGuidance(scope));assertScope(scope);
 return createReadPolicy(facts,{scope,assertScope,reload:resolveGuidance});
}

/** Synchronous readers consume an already resolved authority snapshot. */
export function createReadPolicy(value,{scope={},assertScope=()=>{},reload}={}){
 const facts=checkedFacts(value),stamp=stableJson(facts),archived=facts.archivedResources.flatMap(resource=>resource.paths.map(file=>({id:resource.id,path:normalized(file)})));let grantUsed=false;
 const assertCurrent=()=>{const owner=assertScope(scope);if(scope.checkCurrent&&scope.checkCurrent()!==true)throw Error('Guidance scope changed');return plain(owner)?owner:scope;};
 const hasReadGrant=()=>{
  const owner=assertCurrent(),grant=facts.readGrant,known=new Set(facts.archivedResources.map(resource=>resource.id));
  if(!plain(grant)||!text(grant.id)||!['configure','repair','update'].includes(grant.purpose)||grant.authorityRevision!==facts.revision||grant.activationId!==(facts.activation?.id??null)||!Number.isFinite(grant.expiresAt)||grant.expiresAt<=Date.now()||!Array.isArray(grant.resourceIds)||!grant.resourceIds.length||new Set(grant.resourceIds).size!==grant.resourceIds.length||grant.resourceIds.some(id=>!known.has(id))||!plain(grant.owner))return false;
  const expected=grant.owner;if(Object.keys(expected).some(key=>!['provider','threadId','taskId','serial','leaseEpoch'].includes(key))||!text(expected.provider)||!text(expected.threadId)||expected.taskId!==null&&!text(expected.taskId)||!['provider','threadId','taskId'].every(key=>(scope[key]??null)===(expected[key]??null)))return false;
  if(expected.serial===undefined&&expected.leaseEpoch===undefined)return false;
  if(expected.serial!==undefined&&(!Number.isSafeInteger(expected.serial)||expected.serial<0||(scope.serial??owner.serial)!==expected.serial))return false;
  if(expected.leaseEpoch!==undefined&&(!Number.isSafeInteger(expected.leaseEpoch)||expected.leaseEpoch<0||(owner.epoch??scope.epoch)!==expected.leaseEpoch))return false;
  return true;
 };
 const matches=file=>archived.filter(resource=>within(normalized(file),resource.path));
 const policy={facts,scope,state:facts.state,
  assertCurrent,
  hasReadGrant,
  assertReadsCurrent(){assertCurrent();if(grantUsed&&!hasReadGrant())throw Error('Configuration read grant changed or expired');},
  isGrantedPath(file){assertCurrent();const resources=typeof file==='string'?matches(file):[],allowed=hasReadGrant()&&resources.length>0&&resources.every(resource=>facts.readGrant.resourceIds.includes(resource.id));if(allowed)grantUsed=true;return allowed;},
  assertGrantReadable(file){if(!policy.isGrantedPath(file))throw Error('Guidance resource is outside the explicit configuration read grant');},
  appliesTo(route){assertCurrent();return facts.state!=='legacy_unconfigured'&&((facts.applicableFunctions||[]).includes(route.id)||(route.engines||[]).some(engine=>(facts.engines||[]).includes(engine)));},
  async revalidate(){policy.assertReadsCurrent();if(reload&&stableJson(checkedFacts(await reload(scope)))!==stamp)throw Error('Guidance activation changed');policy.assertReadsCurrent();},
  allowsPath(file){assertCurrent();return typeof file==='string'&&(!matches(file).length||policy.isGrantedPath(file));},
  assertReadable(file){if(!policy.allowsPath(file))throw Error('Guidance resource is archived; use the active execution skill or explicit configuration');},
  blocksAll(){assertCurrent();return facts.state==='stale'||facts.state==='revoked';},
  catalogEntry(){assertCurrent();if(facts.state!=='active')return null;return {name:facts.executionSkill.id,description:'Active execution skill for '+facts.package.id,path:'studio-execution:'+encodeURIComponent(facts.executionSkill.id),source:'execution snapshot',enabled:true};},
  executionResult(functionId){
   assertCurrent();if(facts.state!=='active')return {status:'blocked',function_id:functionId,reason:'Execution guidance is '+facts.state+'; explicit configuration is required. Legacy guidance remains sealed.',attachments:[]};
   const execution=facts.executionSkill,resources=[execution,...execution.resources],digest=sha(facts.revision+'\0'+facts.activation.id+'\0'+resources.map(resource=>resource.sha256).join('\0'));
   return {status:'passed',function_id:functionId,phase:'execution',digest,document_ids:resources.map(resource=>resource.id),attachments:[{source:'execution',skill:execution.id,name:execution.id,sha256:execution.sha256,bytes:Buffer.byteLength(execution.text)}],text:'[Studio active execution skill]\n['+execution.id+']\n'+execution.text+'\nSupporting document IDs (read only when needed): '+JSON.stringify(execution.resources.map(resource=>resource.id)),bytes:Buffer.byteLength(execution.text),scope:'Backend-activated execution skill entry; supporting resources require focused reads. No archived guidance files were accessed.'};
  },
 };
 return Object.freeze(policy);
}
