import {engineContracts} from '../tools/engine-contracts.mjs';
import {parameterValue, setParameter} from './task-fields.mjs';

const absolute = value => typeof value==='string' && /^(?:[a-z]:[\\/]|\/|~\/)/i.test(value);
const basename = value => value.split(/[\\/]/).at(-1);
const fileValues = value => (Array.isArray(value)?value:[value]).filter(item=>typeof item==='string'&&item);
const equal = (left,right) => JSON.stringify(left)===JSON.stringify(right);

function inputFields(steps, engine){
 const fields=new Set();
 for(const step of steps||[])for(const field of step?.fields||[]){
  if((field.type==='file'||field.type==='files')&&field.key!=='files'&&!['output','output_file','output_path'].includes(field.key.split('.').at(-1)))fields.add(field.key);
 }
 const contract=engineContracts.engines[engine];
 for(const key of contract?.input_file_parameters||[]){
  fields.add(key);
  for(const alias of contract.aliases?.[key]||[])fields.add(alias);
 }
 for(const [group,schema] of Object.entries(contract?.parameter_groups||{})){
  for(const key of [...(schema.input_file_parameters||[]), ...(schema.input_file_list_parameters||[])])fields.add(group+'.'+key);
 }
 return [...fields];
}

function resolveFile(value,files){
 if(absolute(value)||typeof value!=='string'||!value||basename(value)!==value)return value;
 const matches=files.filter(file=>basename(file)===value);
 return matches.length===1?matches[0]:value;
}

/** Keep named input fields and the engine's input list on the same saved paths. */
export function bindWorkflowInputFields(steps,parameters,{previous,changes}={}){
 if(parameters.files!==undefined&&(!Array.isArray(parameters.files)||parameters.files.some(file=>typeof file!=='string')))return parameters;
 let result=parameters;
 const fields=inputFields(steps,parameters.engine), oldFiles=fileValues(previous?.files);
 const original=parameters.files||[], explicitlyChanged=Object.hasOwn(changes||{},'files');
 const files=[...new Set(original)];
 const edited=new Set(Object.keys(changes||{}));
 const contract=engineContracts.engines[parameters.engine];
 if(previous?.engine===parameters.engine&&edited.size){
  for(const [canonical,paths] of Object.entries(contract?.aliases||{})){
   const aliases=[...new Set([canonical,...paths])], changed=aliases.filter(key=>edited.has(key));
   if(changed.length!==1)continue;
   const key=changed[0], file=(contract.input_file_parameters||[]).includes(canonical);
   const compare=value=>file?resolveFile(value,oldFiles):value;
   const previousValue=compare(parameterValue(previous,key));
   if(previousValue==null||previousValue==='')continue;
   for(const alias of aliases){
    if(alias===key||!equal(compare(parameterValue(previous,alias)),previousValue))continue;
    result=setParameter(result,alias,parameterValue(result,key));
    edited.add(alias);
   }
  }
 }
 const resolved=new Map();
 for(const key of fields){
  const value=parameterValue(result,key);
  if(value==null&&!edited.has(key))continue;
  const normalized=Array.isArray(value)?value.map(item=>resolveFile(item,files)):resolveFile(value,files);
  if(explicitlyChanged&&!edited.has(key)){
   const removed=item=>oldFiles.includes(resolveFile(item,oldFiles))&&!files.includes(resolveFile(item,oldFiles));
   const next=Array.isArray(normalized)?normalized.filter(item=>!removed(item)):removed(normalized)?null:normalized;
   resolved.set(key,next);
  }else resolved.set(key,normalized);
 }
 const selected=new Set([...resolved.values()].flatMap(fileValues).filter(absolute));
 const replaced=new Set();
 if(previous)for(const [key,next] of resolved){
  if(!edited.has(key))continue;
  const previousValues=fileValues(parameterValue(previous,key)).map(item=>resolveFile(item,oldFiles));
  for(const item of previousValues)if(!fileValues(next).includes(item)&&!selected.has(item))replaced.add(item);
 }
 for(const [key,value] of resolved)if(!equal(value,parameterValue(result,key)))result=setParameter(result,key,value);
 const combined=[...new Set([...files.filter(file=>!replaced.has(file)),...selected])];
 if(combined.length!==original.length||combined.some((item,index)=>item!==original[index]))result={...result,files:combined};
 return result;
}
