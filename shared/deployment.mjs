import {fieldPath} from './task-fields.mjs';
const deploymentKeys=new Set(['project_id','environment_id','cluster_id','workdir','working_directory','remote_directory','remote_root','queue','partition','account','cpus','gpus','gpu','memory_mb','max_seconds','deployment','resources','environment']);
export function deploymentField(key){return fieldPath(key).some(part=>deploymentKeys.has(part));}
export function scienceOnly(parameters,steps=[],missing=[]){
 const hints={};function strip(value,prefix=''){const result={};for(const [key,v] of Object.entries(value||{})){const path=prefix?prefix+'.'+key:key;if(deploymentField(path)){hints[path]=v;continue;}result[key]=v&&typeof v==='object'&&!Array.isArray(v)?strip(v,path):v;}return result;}
 const science=strip(parameters);return {parameters:science,steps:steps.map(s=>typeof s==='string'?s:{...s,fields:s.fields.filter(f=>!deploymentField(f.key))}).filter(s=>typeof s==='string'||s.fields.length||!/部署|队列|集群|提交|deployment|queue|submit/i.test(s.title)),missing:missing.filter(k=>{try{return !deploymentField(k);}catch{return true;}}),hints};
}
const engines=new Set(['gpumd.md','pydyn.md','gpumd.sampling','pydyn.sampling','pygas.build','bias.validate','nep.train','nep.eval','hotpp.train','hotpp.eval','hotpp.export','nep.analyze','pygas.reweight','pygas.opes-reweight']);
export function scientificSpec(task){
 const p=task.parameters||{};if(!engines.has(p.engine))throw Error('请在计算流程中选择已接入的计算引擎');
 if(!Array.isArray(p.files)||!p.files.length||p.files.length>100||p.files.some(f=>typeof f!=='string'||!f||/[\n\r\0]/.test(f)))throw Error('请在计算流程中提供实际输入文件列表');
 const inputs={};for(const file of p.files){const name=file.replaceAll('\\','/').split('/').at(-1);if(!name||name==='.'||name==='..'||Object.hasOwn(inputs,name))throw Error('输入文件名重复或无效');inputs[name]=file;}
 const {engine,files,...parameters}=p;if(engine.endsWith('.sampling')){const walkers=parameters.sampling?.walkers??parameters.walkers??1;if(walkers!==1)throw Error('当前增强采样采用单任务、单 walker；多 walker 尚未接入');parameters.sampling={...parameters.sampling,walkers:1};}
 return {engine,inputs,parameters};
}
export function validDeployment(value){
 if(!value||!['local','cluster'].includes(value.target)||typeof value.projectId!=='string'||!value.projectId||typeof value.targetId!=='string'||!value.targetId)throw Error('请选择项目和计算目标');
 if(!['local','remote'].includes(value.inputSource||'local')||value.target==='local'&&value.inputSource==='remote')throw Error('无效的输入来源');
 if(!Number.isSafeInteger(value.maxSeconds)||value.maxSeconds<1||value.maxSeconds>604800)throw Error('请设置有效的墙钟时长上限');
 if(typeof value.directoryName!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.directoryName))throw Error('工作目录名仅允许字母、数字、下划线和连字符');
 const resources=value.resources||{};for(const [k,min] of [['cpus',1],['gpus',0],['memory_mb',1]])if(!Number.isSafeInteger(resources[k])||resources[k]<min)throw Error('无效的部署资源：'+k);
 if(value.target==='cluster'&&(typeof resources.queue!=='string'||!/^[A-Za-z0-9_.@:/+-]{1,128}$/.test(resources.queue)))throw Error('请选择队列或分区');
 if(resources.account&& !/^[A-Za-z0-9_.@:/+-]{1,128}$/.test(resources.account))throw Error('无效的调度账户');
 return {target:value.target,projectId:value.projectId,targetId:value.targetId,inputSource:value.inputSource||'local',maxSeconds:value.maxSeconds,directoryName:value.directoryName,resources:{cpus:resources.cpus,gpus:resources.gpus,memory_mb:resources.memory_mb,queue:resources.queue||'',account:resources.account||''},gpu:Number.isSafeInteger(value.gpu)&&value.gpu>=0?value.gpu:0};
}
export function deploymentCurrent(task){return task.review?.status==='ready'&&task.review.parameterRevision===task.parameterRevision&&task.deployment?.prepared?.parameterRevision===task.parameterRevision&&task.deployment?.prepared?.deploymentRevision===task.deployment.revision;}
