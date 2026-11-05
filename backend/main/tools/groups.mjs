import {createHash} from 'node:crypto';
import {compileToolGroup,toolGroupIdentityText} from '../../../contracts/tools/tool-group.mjs';

const exact=(value,keys,required=keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||required.some(key=>!Object.hasOwn(value,key)))throw Error('Exact typed tool group request required');};
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const versionId=(id,version)=>hash(id+'\0'+version);
const versionPattern=/^[a-f0-9]{64}$/;
const clone=value=>structuredClone(value);
export function createToolGroupRecords({catalog,packages,now=Date.now}){
 const compile=({definition})=>compileToolGroup(definition,({id,version})=>{const value=packages.read({package_id:id,package_version:version});return {version:value.package_version,manifest:value.manifest};});
 function frozen(id,version){
  if(typeof version!=='string'||!versionPattern.test(version))throw Error('Invalid tool group version');const recordId=versionId(id,version),found=catalog.get('tool-group-version',recordId);if(!found)throw Error('Unknown frozen tool group version');
  if(found.schema_version!==1||found.id!==recordId||found.group_id!==id||found.group_version!==version||typeof found.definition_text!=='string'||hash(toolGroupIdentityText(found.definition_text))!==version||JSON.stringify(found.definition)!==found.definition_text||found.definition?.id!==id||found.compiled?.schema_version!==1||found.compiled.id!==id||found.compiled.status!=='definition_checked'||found.compiled.execution_status!=='not_run')throw Error('Frozen tool group version identity changed');
  return found;
 }
 function projection(latest,version,{historical=false}={}){
  if(!historical&&(version===undefined||version===null))return clone({...latest,version:null,has_frozen_version:false,definition_text:null});
  const record=frozen(latest.id,version);return clone({...latest,name:record.compiled.name,version,has_frozen_version:true,definition_text:record.definition_text,definition:record.definition,compiled:record.compiled,...historical?{created_at:record.created_at}:{},status:'definition_checked',execution_status:'not_run'});
 }
 function read(value){exact(value,['id','version'],['id']);if(typeof value.id!=='string'||! /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value.id))throw Error('Invalid tool group ID');const found=catalog.get('tool-group',value.id);if(!found||found.schema_version!==1||found.id!==value.id)throw Error('Unknown tool group');return projection(found,Object.hasOwn(value,'version')?value.version:found.version,{historical:Object.hasOwn(value,'version')});}
 return {
  compile(value){exact(value,['definition']);return compile(value);},
  list(value={}){exact(value,[]);return catalog.list('tool-group').map(latest=>projection(latest,latest.version)).map(({id,name,revision,updated_at,status,execution_status,version,has_frozen_version})=>({id,name,revision,updated_at,status,execution_status,version,has_frozen_version}));},
  read,
  save(value){
   exact(value,['definition','expected_revision']);if(!Number.isSafeInteger(value.expected_revision)||value.expected_revision<0)throw Error('Invalid group revision');const definition=clone(value.definition),compiled=compile({definition}),definition_text=JSON.stringify(definition),version=hash(toolGroupIdentityText(definition_text)),recordId=versionId(compiled.id,version);
   return catalog.transaction(()=>{
    const old=catalog.get('tool-group',compiled.id);if((old?.revision??0)!==value.expected_revision)throw Error('Tool group changed; reload before saving');
    if(old?.version!==undefined&&old.version!==null)frozen(old.id,old.version);
    const existing=catalog.get('tool-group-version',recordId);if(existing){const verified=frozen(compiled.id,version);if(verified.definition_text!==definition_text||JSON.stringify(verified.compiled)!==JSON.stringify(compiled))throw Error('Frozen tool group version content changed');}
    if(old?.version===version)return projection(old,version);
    const timestamp=now();if(!existing)catalog.put('tool-group-version',recordId,{schema_version:1,id:recordId,group_id:compiled.id,group_version:version,definition_text,definition:clone(definition),compiled:clone(compiled),created_at:timestamp});
    const record={schema_version:1,id:compiled.id,name:compiled.name,revision:(old?.revision??0)+1,version,has_frozen_version:true,definition_text,definition,compiled:clone(compiled),created_at:old?.created_at??timestamp,updated_at:timestamp,status:'definition_checked',execution_status:'not_run'};
    catalog.put('tool-group',record.id,record);return projection(record,version);
   });
  }
 };
}
