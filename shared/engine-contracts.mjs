import contract from '../worker/studio_worker/engine_contracts.json' with {type:'json'};
import {parameterValue} from './task-fields.mjs';
export const engineContracts=contract;
function normalizedPath(value){return value.replaceAll('\\','/').replace(/^([A-Za-z]):\//,(_,drive)=>'/mnt/'+drive.toLowerCase()+'/');}
export function adapterParameters(engine,parameters,inputs){
 const rule=contract.engines[engine];if(!rule)throw Error('Unsupported engine contract');const result=structuredClone(parameters);
 const fileKeys=new Set(rule.input_file_parameters||[]);
 function fileValue(value,key){
  if(typeof value!=='string'||!value)throw Error('Adapter input '+key+' must identify an actual scientific files entry');
  const path=normalizedPath(value),name=path.split('/').at(-1);
  if(!Object.hasOwn(inputs,name)||path!==name&&normalizedPath(inputs[name])!==path)throw Error('Adapter input '+key+' must identify an actual scientific files entry');
  return name;
 }
 const keys=new Set([...Object.keys(rule.aliases||{}),...fileKeys]);
 for(const key of keys){
  const candidates=[result[key],...(rule.aliases?.[key]||[]).filter(path=>path!==key).map(path=>parameterValue(parameters,path))].filter(value=>value!==undefined&&value!==null&&value!=='');
  const values=candidates.map(value=>fileKeys.has(key)?fileValue(value,key):value);
  if(values.some(value=>JSON.stringify(value)!==JSON.stringify(values[0])))throw Error('Conflicting adapter parameter aliases: '+key);
  if(values.length)result[key]=values[0];
  else if(rule.default_input_names?.[key]&&Object.hasOwn(inputs,rule.default_input_names[key]))result[key]=rule.default_input_names[key];
 }
 for(const [key,choices] of Object.entries(rule.choices||{}))if(result[key]!==undefined&&!choices.includes(result[key]))throw Error('Unsupported adapter parameter '+key);
 if(engine.endsWith('.sampling')&&result.walkers!==undefined&&result.walkers!==1)throw Error('当前增强采样采用单任务、单 walker；多 walker 尚未接入');
 if(result.cv_size!==undefined&&(!Number.isSafeInteger(result.cv_size)||result.cv_size<1))throw Error('cv_size must be a positive integer from the actual bias definition');
 if(result.cutoff!==undefined&&(typeof result.cutoff!=='number'||!Number.isFinite(result.cutoff)||result.cutoff<=0))throw Error('cutoff must be a positive number from the actual bias definition');
 for(const [group,schema] of Object.entries(rule.parameter_groups||{})){
  const values=result[group];if(values===undefined)continue;
  if(!values||typeof values!=='object'||Array.isArray(values))throw Error('Adapter parameter group must be an object: '+group);
  for(const key of Object.keys(values))if(!schema.allowed_keys.includes(key))throw Error('Unsupported declared engine control: '+group+'.'+key+'; use describe_engine and keep driver/provenance in files or descriptions');
  for(const [key,choices] of Object.entries(schema.choices||{}))if(values[key]!==undefined&&!choices.includes(values[key]))throw Error('Unsupported declared engine control: '+group+'.'+key);
 }
 const missing=(rule.required_parameters||[]).filter(key=>result[key]===undefined||result[key]===null||result[key]===''||Array.isArray(result[key])&&!result[key].length);
 if(missing.length)throw Error('引擎技术输入尚未补齐（'+engine+'）：'+missing.join(', ')+'；请让 Agent 依据真实输入和 describe_engine 完成映射');
 const absent=(rule.required_inputs||[]).filter(name=>!Object.hasOwn(inputs,name));if(absent.length)throw Error('缺少引擎实际输入文件：'+absent.join(', '));
 return result;
}
