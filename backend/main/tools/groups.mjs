import {compileToolGroup} from '../../../contracts/tools/tool-group.mjs';

const exact=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('Exact typed tool group request required');};
export function createToolGroupRecords({catalog,packages,now=Date.now}){
 const compile=({definition})=>compileToolGroup(definition,({id,version})=>{const value=packages.read({package_id:id,package_version:version});return {version:value.package_version,manifest:value.manifest};});
 function read(value){exact(value,['id']);if(typeof value.id!=='string'||! /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value.id))throw Error('Invalid tool group ID');const found=catalog.get('tool-group',value.id);if(!found||found.schema_version!==1)throw Error('Unknown tool group');return structuredClone(found);}
 return {
  compile(value){exact(value,['definition']);return compile(value);},
  list(value={}){exact(value,[]);return catalog.list('tool-group').map(({id,name,revision,updated_at,status,execution_status})=>({id,name,revision,updated_at,status,execution_status}));},
  read,
  save(value){
   exact(value,['definition','expected_revision']);if(!Number.isSafeInteger(value.expected_revision)||value.expected_revision<0)throw Error('Invalid group revision');const compiled=compile(value);
   return catalog.transaction(()=>{
    const old=catalog.get('tool-group',compiled.id);if((old?.revision??0)!==value.expected_revision)throw Error('Tool group changed; reload before saving');
    if(old&&JSON.stringify(old.compiled)===JSON.stringify(compiled))return structuredClone(old);
    const record={schema_version:1,id:compiled.id,name:compiled.name,revision:(old?.revision??0)+1,definition:structuredClone(value.definition),compiled,created_at:old?.created_at??now(),updated_at:now(),status:'definition_checked',execution_status:'not_run'};
    catalog.put('tool-group',record.id,record);return structuredClone(record);
   });
  }
 };
}
