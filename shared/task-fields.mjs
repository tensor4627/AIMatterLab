const forbidden=new Set(['__proto__','prototype','constructor']);
export function fieldPath(key){
 if(typeof key!=='string'||key.length>200)throw Error('Invalid field key');
 const parts=key.split('.');if(parts.length>12||parts.some(p=>!p||forbidden.has(p)||!/^[\w-]+$/.test(p)))throw Error('Invalid field key');return parts;
}
// Older drafts also store natural-language blockers in missingFields. They are
// review requirements, never parameter paths and never silently resolved.
export function isFieldKey(key){try{fieldPath(key);return true;}catch{return false;}}
export function missingRequirements(missing=[]){return missing.filter(key=>!isFieldKey(key));}
export function parameterValue(parameters,key){let value=parameters;for(const part of fieldPath(key))value=value?.[part];return value;}
export function setParameter(parameters,key,value){
 const result=structuredClone(parameters||{}),parts=fieldPath(key);let node=result;
 for(const part of parts.slice(0,-1)){if(node[part]==null||typeof node[part]!=='object')node[part]={};node=node[part];}node[parts.at(-1)]=value;return result;
}
export const fieldNames={temperature:'温度',pressure:'压力',timestep:'时间步长',time_step:'时间步长',steps:'模拟步数',n_steps:'模拟步数',engine:'计算引擎',environment_id:'计算环境',gpu:'GPU',max_seconds:'时长上限',structure:'初始结构',structure_file:'初始结构',model:'势模型',potential:'势模型',model_file:'势模型',potential_file:'势模型',bias_file:'Bias 文件',cutoff:'邻居截断半径',cv_size:'CV 数量',atom_i:'原子 i',atom_j:'原子 j',sigma:'Gaussian 宽度',height:'Gaussian 高度',bias_factor:'Bias factor',train_file:'训练数据',test_file:'测试数据',queue:'队列',cpus:'CPU 数量',gpus:'GPU 数量',memory_mb:'内存',seed:'随机种子',ensemble:'系综',checkpoint:'Checkpoint',center:'中心位置',force_constant:'力常数'};
export function inferField(key,value,required=false){
 const leaf=key.split('.').at(-1),label=fieldNames[leaf]||leaf.replaceAll('_',' ');
 const type=typeof value==='boolean'?'boolean':typeof value==='number'?'number':Array.isArray(value)?'list':value&&typeof value==='object'?'object':/file|path|structure|potential|model|checkpoint/.test(leaf)?'file':'text';
 const unit=leaf==='temperature'?'K':/(?:timestep|time_step)_fs$/.test(leaf)?'fs':leaf==='max_seconds'?'s':leaf==='memory_mb'?'MB':leaf==='cutoff'?'Å':undefined;
 return {key,label,type,required,unit};
}
export function flattenParameters(parameters,prefix=''){
 const result=[];for(const [key,value] of Object.entries(parameters||{})){const path=prefix?prefix+'.'+key:key;fieldPath(path);if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length)result.push(...flattenParameters(value,path));else result.push(inferField(path,value));}return result;
}
export function validField(field){
 fieldPath(field?.key);if(typeof field.label!=='string'||field.label.length>200||!['text','number','integer','boolean','file','files','list','object','select','multiline'].includes(field.type)||typeof field.required!=='boolean')throw Error('Invalid parameter field');
 for(const [key,limit] of [['unit',40],['description',2000]])if(field[key]!==undefined&&(typeof field[key]!=='string'||field[key].length>limit))throw Error('Invalid field text');
 if(field.options!==undefined&&(!Array.isArray(field.options)||field.options.length>100||field.options.some(v=>typeof v!=='string')))throw Error('Invalid field options');return field;
}
export function normalizeSteps(steps,parameters={},missing=[]){
 if(!Array.isArray(steps)||steps.length>80||!Array.isArray(missing)||missing.some(k=>typeof k!=='string'))throw Error('Invalid workflow steps');
 const used=new Set(),ids=new Set();
 const result=steps.map((step,i)=>{
  if(typeof step==='string')return {id:'step-'+i,title:step,description:'',fields:[],optional:false};
  if(!step||typeof step!=='object'||typeof step.id!=='string'||!step.id||ids.has(step.id)||typeof step.title!=='string'||!step.title||!step.title.trim()||!Array.isArray(step.fields))throw Error('Invalid workflow step');ids.add(step.id);
  return {...step,description:step.description||'',fields:step.fields.map(f=>{validField(f);if(used.has(f.key))throw Error('Duplicate field');used.add(f.key);return f;})};
 });
 const leftovers=flattenParameters(parameters).filter(f=>!used.has(f.key));
 for(const key of missing){if(!isFieldKey(key))continue;if(!used.has(key)&&!leftovers.some(f=>f.key===key))leftovers.push(inferField(key,parameterValue(parameters,key),true));}
 if(leftovers.length)result.push({id:'parameters',title:'运行参数与文件',description:'未分组参数可直接编辑；Agent 可在后续更新中归入对应步骤。',fields:leftovers.map(f=>({...f,required:f.required||missing.includes(f.key)}))});
 return result;
}
export function fieldMissing(field,parameters){
 const value=parameterValue(parameters,field.key);
 if(value===undefined||value===null||value===''||(Array.isArray(value)&&!value.length))return !!field.required;
 if(['number','integer'].includes(field.type))return typeof value!=='number'||!Number.isFinite(value)||(field.type==='integer'&&!Number.isInteger(value));
 if(field.type==='boolean')return typeof value!=='boolean';
 if(['file','text','multiline','select'].includes(field.type)&&typeof value!=='string')return true;
 if(field.type==='select'&&field.options?.length)return !field.options.includes(value);
 if(['files','list'].includes(field.type))return !Array.isArray(value)||(field.type==='files'&&value.some(v=>typeof v!=='string'||!v));
 if(field.type==='object')return typeof value!=='object'||Array.isArray(value)||(field.required&&!Object.keys(value).length);
 return false;
}
export function workflowMissing(steps,parameters={},missing=[]){
 const groups=normalizeSteps(steps,parameters,missing),keys=new Set();for(const group of groups)for(const f of group.fields)if(fieldMissing(f,parameters))keys.add(f.key);
 for(const key of missing)if(!isFieldKey(key)||parameterValue(parameters,key)==null||parameterValue(parameters,key)==='')keys.add(key);return [...keys];
}
export function explicitNewWorkflow(text){return typeof text==='string'&&!/不要|别|不需|无需|do not|don't/i.test(text)&&/(?:新建|另建|创建)(?:一个|一份|新的)?(?:新的)?(?:计算)?(?:流程|工作流)|(?:create|start) (?:a |another |new )*(?:new |another )workflow/i.test(text);}
