import schema from './tool-package.schema.json' with {type:'json'};

const own=(value,key)=>Object.hasOwn(value,key);
const fail=(where,message)=>{throw Error(where+': '+message);};
const json=value=>{
 let nodes=0;
 function visit(item,depth){
  if(++nodes>12000||depth>24)fail('manifest','JSON complexity exceeds the supported bound');
  if(item===null||typeof item==='boolean'||typeof item==='string')return;
  if(typeof item==='number'&&Number.isFinite(item))return;
  if(Array.isArray(item)){for(const child of item)visit(child,depth+1);return;}
  if(item&&typeof item==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(item))){for(const child of Object.values(item))visit(child,depth+1);return;}
  fail('manifest','plain finite JSON values required');
 }
 visit(value,0);if(new TextEncoder().encode(JSON.stringify(value)).length>512*1024)fail('manifest','definition exceeds 512 KiB');
};
export const validateToolJson=json;
function matches(value,type){return type==='null'?value===null:type==='object'?!!value&&typeof value==='object'&&!Array.isArray(value):type==='array'?Array.isArray(value):type==='integer'?Number.isSafeInteger(value):typeof value===type;}
function normalize(value,rule,where){
 if(rule.$ref)return normalize(value,schema.$defs[rule.$ref.split('/').at(-1)],where);
 if(own(rule,'const')&&value!==rule.const)fail(where,'expected '+JSON.stringify(rule.const));
 if(rule.enum&&!rule.enum.includes(value))fail(where,'unsupported value');
 if(rule.type&&!(Array.isArray(rule.type)?rule.type:[rule.type]).some(type=>matches(value,type)))fail(where,'expected '+rule.type);
 if(typeof value==='string'){
  const length=Array.from(value).length;if(rule.minLength!==undefined&&length<rule.minLength||rule.maxLength!==undefined&&length>rule.maxLength||rule.pattern&&!new RegExp(rule.pattern).test(value))fail(where,'invalid text');
 }
 if(typeof value==='number'&&(rule.minimum!==undefined&&value<rule.minimum||rule.maximum!==undefined&&value>rule.maximum))fail(where,'out of range');
 if(Array.isArray(value)){
  if(rule.minItems!==undefined&&value.length<rule.minItems||rule.maxItems!==undefined&&value.length>rule.maxItems)fail(where,'invalid number of entries');
  return value.map((item,index)=>rule.items?normalize(item,rule.items,where+'['+index+']'):structuredClone(item));
 }
 if(value&&typeof value==='object'){
  if(!rule.properties)return structuredClone(value);
  if(rule.additionalProperties===false&&Object.keys(value).some(key=>!own(rule.properties,key)))fail(where,'unknown field');
  for(const key of rule.required||[])if(!own(value,key))fail(where+'.'+key,'required');
  return Object.fromEntries(Object.entries(rule.properties).flatMap(([key,child])=>own(value,key)?[[key,normalize(value[key],child,where+'.'+key)]]:own(child,'default')?[[key,structuredClone(child.default)]]:[]));
 }
 return value;
}
// Other portable contracts can use the same schema subset with fully inline rules.
export {normalize as normalizeInlineSchema};
export function portableResourcePath(value,{workingDirectory=false}={}){
 if(workingDirectory&&value==='.')return value;
 if(typeof value!=='string'||!value||Array.from(value).length>512||/[\\<>:"|?*\x00-\x1f\x7f]/.test(value)||value.startsWith('/')||value.split('/').some(part=>!part||part==='.'||part==='..'||part.toLowerCase()==='.git')||new TextDecoder('utf-8',{fatal:true}).decode(new TextEncoder().encode(value))!==value)fail('resource path','canonical package-relative path required');
 return value;
}
function unique(items,where){const ids=items.map(item=>typeof item==='string'?item:item.id);if(new Set(ids).size!==ids.length)fail(where,'duplicate identifier');}
function defaults(item,where){
 if(!item.required&&(!own(item,'default')||!item.default_behavior?.trim()||!item.default_source?.trim()))fail(where,'optional input/output/parameter requires a default, default_behavior and default_source');
 if(item.required&&own(item,'default'))fail(where,'required items cannot silently supply a default');
 if(item.type==='value'||['file','files','directory'].includes(item.type))return;
 if(own(item,'default')&&item.default!==null&&!matches(item.default,item.type))fail(where+'.default','does not match the declared parameter type');
}
export function validateToolPorts(value,where='ports'){
 json(value);const ports=normalize(value,{type:'array',items:schema.$defs.port,minItems:0,maxItems:128},where);unique(ports,where);for(const port of ports)defaults(port,where+'.'+port.id);return ports;
}
export function toolParameterValues(parameters,value={}){
 json(value);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!parameters.some(parameter=>parameter.id===key)))fail('parameters','unknown parameter');
 return Object.fromEntries(parameters.flatMap(parameter=>{
  if(!own(value,parameter.id)){if(parameter.required)fail('parameters.'+parameter.id,'required');return [[parameter.id,structuredClone(parameter.default)]];}
  const supplied=value[parameter.id];if(!matches(supplied,parameter.type)&&!(!parameter.required&&supplied===null&&parameter.default===null))fail('parameters.'+parameter.id,'wrong type');return [[parameter.id,structuredClone(supplied)]];
 }));
}
/** Pure declaration validation. This never claims installation or tests passed. */
export function validateToolPackage(value){
 json(value);const result=normalize(value,schema,'manifest');
 portableResourcePath(result.repository.path);portableResourcePath(result.manual);
 for(const group of ['installation','configuration'])for(const file of result.guidance[group])portableResourcePath(file);
 if(result.tests.directory!==result.id+'-tests')fail('manifest.tests.directory','expected '+result.id+'-tests');
 const inTests=file=>{portableResourcePath(file);if(!file.startsWith(result.tests.directory+'/'))fail('manifest.tests','test entry must be within its standard test directory');return file;};
 inTests(result.tests.introduction);if(!result.tests.introduction.endsWith('.md'))fail('manifest.tests.introduction','Markdown required');
 unique(result.environment.parallelism.supported,'parallelism.supported');unique(result.functions,'functions');unique(result.tests.cases,'tests.cases');
 for(const item of result.functions){
  portableResourcePath(item.entrypoint);unique(item.inputs,'inputs');unique(item.outputs,'outputs');unique(item.parameters,'parameters');unique(item.tests,'function.tests');
  for(const port of [...item.inputs,...item.outputs,...item.parameters])defaults(port,item.id+'.'+port.id);
  for(const token of item.operation.command)if(/[\r\n\0]/.test(token))fail(item.id+'.command','argv entries cannot contain control characters');
 }
 for(const item of result.tests.cases){
  inTests(item.directory);inTests(item.instructions);if(!item.instructions.startsWith(item.directory+'/')||!item.instructions.endsWith('.md'))fail(item.id+'.instructions','Markdown must belong to its case directory');
  portableResourcePath(item.entrypoint);for(const file of item.resources)portableResourcePath(file);for(const output of item.expected_outputs)portableResourcePath(output.path);
  const feature=result.functions.find(feature=>feature.id===item.function_id);if(!feature||!feature.tests.includes(item.id))fail(item.id,'test/function coverage disagrees');
 }
 for(const feature of result.functions)for(const test of feature.tests)if(!result.tests.cases.some(item=>item.id===test&&item.function_id===feature.id))fail(feature.id,'declared functional test missing');
 if(result.environment.hardware==='cpu'&&result.environment.parallelism.gpus!==0)fail('environment','CPU tool cannot default to GPU use');
 return result;
}
export function toolPackageResources(manifest){
 const value=validateToolPackage(manifest);
 return [...new Set(['tool.json',value.manual,value.guidance.delivery,...value.guidance.installation,...value.guidance.configuration,...value.functions.map(item=>item.entrypoint),value.tests.introduction,...value.tests.cases.flatMap(item=>[item.instructions,item.entrypoint,...item.resources])])].sort();
}
export function toolGuidanceResources(manifest){
 const value=validateToolPackage(manifest);
 return [{path:value.guidance.delivery,role:'delivery'},...value.guidance.installation.map(path=>({path,role:'installation'})),...value.guidance.configuration.map(path=>({path,role:'configuration'}))];
}

/** Stable UTF-8 preimage shared with the standalone worker; no JSON float encoding. */
export function packageIdentityText({id,commit,manifestSha256,files}){
 if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)||! /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)||! /^[0-9a-f]{64}$/.test(manifestSha256)||!Array.isArray(files)||!files.length)fail('package identity','invalid identity');
 const encoded=value=>new TextEncoder().encode(value);
 const compare=(a,b)=>{const left=encoded(a.path),right=encoded(b.path);for(let i=0;i<Math.min(left.length,right.length);i++)if(left[i]!==right[i])return left[i]-right[i];return left.length-right.length;};
 const entries=files.map(item=>{
  portableResourcePath(item.path);if(!['file','symlink'].includes(item.kind)||item.kind==='file'&&item.target!==null||item.kind==='symlink'&&(typeof item.target!=='string'||!item.target||/[\\\r\n\0]/.test(item.target)||item.target.startsWith('/')||/^[A-Za-z]:/.test(item.target))||!Number.isSafeInteger(item.size)||item.size<0||! /^[0-9a-f]{64}$/.test(item.sha256))fail('package identity','invalid file observation');return item;
 }).sort(compare);
 if(new Set(entries.map(item=>item.path)).size!==entries.length)fail('package identity','duplicate file');
 return 'studio.tool-package/1\0'+id+'\0'+commit+'\0'+manifestSha256+'\0'+entries.map(item=>item.path+'\0'+item.kind+'\0'+(item.target||'')+'\0'+item.size+'\0'+item.sha256+'\n').join('');
}
