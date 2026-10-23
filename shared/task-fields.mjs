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
const primaryOrder=['engine','files','family','mode','structure_file','structure','model_file','potential_file','bias_file','cv_definition','cv','cvs','atom_selection','atom_i','atom_j','pbc_convention','cutoff','cv_size','ensemble','temperature','temperature_K','sigma','sigmas','height','hill_height','pace','deposition_stride','interval','bias_factor','center','force_constant','time_step_fs','steps','n_steps'];
export function partitionFields(fields){
 const primary=[],advanced=[];
 for(const field of fields){const leaf=field.key.split('.').at(-1),essential=primaryOrder.includes(leaf)||['file','files'].includes(field.type);const detail=field.advanced===true||field.advanced!==false&&!essential&&!field.required; (detail?advanced:primary).push(field);}
 const rank=f=>{const index=primaryOrder.indexOf(f.key.split('.').at(-1));return index<0?100:index;};
 primary.sort((a,b)=>rank(a)-rank(b));return {primary,advanced};
}
export function validField(field){
 fieldPath(field?.key);if(typeof field.label!=='string'||field.label.length>200||!['text','number','integer','boolean','file','files','list','object','select','multiline'].includes(field.type)||typeof field.required!=='boolean')throw Error('Invalid parameter field');
 if(field.advanced!==undefined&&typeof field.advanced!=='boolean')throw Error('Invalid advanced field flag');
 if(Object.hasOwn(field,'default')){const value=field.default;if(value!==null&&!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)||typeof value==='string'&&value.length>4000||typeof field.default_source!=='string'||!field.default_source.trim())throw Error('Default needs a scalar value and traceable source');if(value!==null&&fieldMissing({...field,required:true},setParameter({},field.key,value)))throw Error('Default does not match field type');}
 for(const [key,limit] of [['unit',40],['description',2000],['default_source',2000]])if(field[key]!==undefined&&(typeof field[key]!=='string'||field[key].length>limit))throw Error('Invalid field text');
 if(field.options!==undefined&&(!Array.isArray(field.options)||field.options.length>100||field.options.some(v=>typeof v!=='string')))throw Error('Invalid field options');return field;
}
export function normalizeSteps(steps,parameters={},missing=[]){
 if(!Array.isArray(steps)||steps.length>80||!Array.isArray(missing)||missing.some(k=>typeof k!=='string'))throw Error('Invalid workflow steps');
 const used=new Set(),ids=new Set();
 const result=steps.map((step,i)=>{
  if(typeof step==='string')return {id:'step-'+i,title:step,description:'',fields:[],optional:false};
  if(!step||typeof step!=='object'||typeof step.id!=='string'||!step.id||ids.has(step.id)||typeof step.title!=='string'||!step.title||!step.title.trim()||!Array.isArray(step.fields))throw Error('Invalid workflow step');ids.add(step.id);
  return {...step,description:step.description||'',fields:step.fields.map(f=>{validField(f);if(used.has(f.key))throw Error('Duplicate field');used.add(f.key);return {...f,required:f.required||missing.includes(f.key)};})};
 });
 const leftovers=flattenParameters(parameters).filter(f=>!used.has(f.key));
 for(const key of missing){if(!isFieldKey(key))continue;if(!used.has(key)&&!leftovers.some(f=>f.key===key))leftovers.push(inferField(key,parameterValue(parameters,key),true));}
 if(leftovers.length){
  // A saved/user-owned group may already use this name. Generated groups must
  // remain valid when the result is normalized again (for example by missing checks).
  let id='parameters',suffix=1;while(ids.has(id))id='parameters-'+suffix++;
  result.push({id,title:'运行参数与文件',description:'未分组参数可直接编辑；Agent 可在后续更新中归入对应步骤。',fields:leftovers.map(f=>({...f,required:f.required||missing.includes(f.key)}))});
 }
 return result;
}
function missingListValue(items){
 const pending=[...items];while(pending.length){const value=pending.pop();if(value===undefined||value===null||value===''||typeof value==='number'&&!Number.isFinite(value))return true;if(Array.isArray(value)){if(!value.length)return true;pending.push(...value);}}return false;
}
export function fieldMissing(field,parameters){
 const value=parameterValue(parameters,field.key);
 if(value===undefined||value===null||value===''||(Array.isArray(value)&&!value.length))return !!field.required;
 if(['number','integer'].includes(field.type))return typeof value!=='number'||!Number.isFinite(value)||(field.type==='integer'&&!Number.isInteger(value));
 if(field.type==='boolean')return typeof value!=='boolean';
 if(['file','text','multiline','select'].includes(field.type)&&typeof value!=='string')return true;
 if(field.type==='select'&&field.options?.length)return !field.options.includes(value);
 if(['files','list'].includes(field.type))return !Array.isArray(value)||(field.type==='files'&&value.some(v=>typeof v!=='string'||!v))||(field.type==='list'&&field.required&&missingListValue(value));
 if(field.type==='object')return typeof value!=='object'||Array.isArray(value)||(field.required&&!Object.keys(value).length);
 return false;
}
export function workflowMissing(steps,parameters={},missing=[]){
 const groups=normalizeSteps(steps,parameters,missing),keys=new Set();for(const group of groups)for(const f of group.fields)if(fieldMissing(f,parameters))keys.add(f.key);
 for(const key of missing)if(!isFieldKey(key)||parameterValue(parameters,key)==null||parameterValue(parameters,key)==='')keys.add(key);return [...keys];
}
export function explicitNewWorkflow(text){
 if(typeof text!=='string')return false;
 // Quoted examples are content, not instructions. Contractions remain intact.
 const plain=text.replace(/```[\s\S]*?```|`[^`\n]*`|"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|「[^」\n]*」|(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu,' ');
 const actions=/(?:新建|另建|创建)(?:一个|一份|新的)?(?:新的)?(?:计算)?(?:工作流|流程)|(?:create|start)\s+(?:a\s+)?(?:(?:new|another)\s+){1,2}workflow/gi;
 for(const match of plain.matchAll(actions)){
  const prefix=plain.slice(0,match.index).split(/[，,。.;；!?！？\n]|但是|不过|然后|\b(?:but|however|then)\b/i).at(-1)||'';
  if(/不|别|勿|无需|无须|禁止|没有|没必要|停止|避免|取消|撤销|暂停|\b(?:not|never|without|avoid|no|stop|cancel|don['’]?t|cannot|can['’]?t|isn['’]?t|wasn['’]?t|didn['’]?t|wouldn['’]?t)\b/i.test(prefix))continue;
  if(/解释|举例|说明|含义|意思|如何|怎么|是否|讨论|提到|字符串|文本|命令|按钮|复述|引用|回复|翻译|之前|此前|原先|曾经|已经|上次|\b(?:explain|describe|example|quote|repeat|translate|meaning|phrase|button|command|text|how|whether|what)\b/i.test(prefix))continue;
  const suffix=plain.slice(match.index+match[0].length).split(/[，,。.;；!?！？\n]|但是|不过|然后|\b(?:but|however|then)\b/i)[0];
  if(/^\s*(?:(?:这个|按钮|功能|操作|选项)?(?:是(?:什么|啥|何)|指(?:的)?是)|的(?:含义|意思|作用)|意味着)/.test(suffix)||/^\s*(?:mean|means|meaning|definition)\b/i.test(suffix))continue;
  return true;
 }
 return false;
}
