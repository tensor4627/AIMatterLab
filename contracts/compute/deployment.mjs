import {fieldPath} from "../workflows/task-fields.mjs";
import {adapterParameters} from "../tools/engine-contracts.mjs";
import {isLocalGpuId} from './project-policy.mjs';
const deploymentKeys=new Set(['project_id','environment_id','cluster_id','workdir','working_directory','remote_directory','remote_root','queue','queue_target_id','queueSelection','partition','account','qos','cpus','gpus','gpu','memory_mb','max_seconds','deployment','resources','environment']);

export function deploymentField(key){return fieldPath(key).some(part=>deploymentKeys.has(part));}

export function scienceOnly(parameters,steps=[],missing=[]){
 const hints={};function strip(value,prefix=''){const result={};for(const [key,v] of Object.entries(value||{})){const path=prefix?prefix+'.'+key:key;if(deploymentField(path)){hints[path]=v;continue;}result[key]=v&&typeof v==='object'&&!Array.isArray(v)?strip(v,path):v;}return result;}
 const science=strip(parameters);return {parameters:science,steps:steps.map(s=>typeof s==='string'?s:{...s,fields:s.fields.filter(f=>!deploymentField(f.key))}).filter(s=>typeof s==='string'||s.fields.length||!/部署|队列|集群|提交|deployment|queue|submit/i.test(s.title)),missing:missing.filter(k=>{try{return !deploymentField(k);}catch{return true;}}),hints};
}

const engines=new Set(['hotham.datasets','hotham.train','hotham.eval','hotham.export','hotham.diagonalize','trajectory.density','gpumd.neb','gpumd.md','pydyn.md','gpumd.sampling','pydyn.sampling','pygas.build','bias.validate','nep.train','nep.eval','hotpp.train','hotpp.eval','hotpp.export','nep.analyze','pygas.reweight','pygas.opes-reweight']);

export function scientificSpec(task){
 if(task.composition&&(task.composition.status!=='rendered'||task.composition.render_blocked))throw Error('CV/bias组合图尚不能生成；先在原会话补齐、保存并复核当前输入');
 const p=task.parameters||{};if(!engines.has(p.engine))throw Error('请在计算流程中选择已接入的计算引擎');
 if(!Array.isArray(p.files)||!p.files.length||p.files.length>100||p.files.some(f=>typeof f!=='string'||!f||/[\n\r\0]/.test(f)))throw Error('请在计算流程中提供实际输入文件列表');
 const inputs={};for(const file of p.files){const name=file.replaceAll('\\','/').split('/').at(-1);if(!name||name==='.'||name==='..'||Object.hasOwn(inputs,name))throw Error('输入文件名重复或无效');inputs[name]=file;}
 const {engine,files,...parameters}=p;if(engine.endsWith('.sampling')){const walkers=parameters.sampling?.walkers??parameters.walkers??1;if(walkers!==1)throw Error('当前增强采样采用单任务、单 walker；多 walker 尚未接入');parameters.sampling={...parameters.sampling,walkers:1};}
 return {engine,inputs,parameters:adapterParameters(engine,parameters,inputs)};
}

// Protocol-reserved evidence is never an engine control. Unknown controls remain
// in this projection so additions, removals and value changes still fail closed.
const evidenceRoots=new Set(['review','provenance','evidence','derived_inputs','validation']);

const evidenceLeaves=new Set(['source','provenance','settings_source','model_origin','hashes','sha256']);

export function inputControlParameters(parameters){
 function controls(value,depth=0){
  if(Array.isArray(value))return value.map(item=>controls(item,depth+1));
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!(depth===0&&evidenceRoots.has(key))&&!evidenceLeaves.has(key)).map(([key,item])=>[key,controls(item,depth+1)]));
 }
 const canonical=structuredClone(parameters||{}),cv=canonical.cv;
 // The pair journal is a transaction identity, not a scientific control. Graph,
 // source/input hashes and every unknown property remain strictly compared.
 if(canonical.composition?.expected&&typeof canonical.composition.expected==='object'&&!Array.isArray(canonical.composition.expected))delete canonical.composition.expected.journal_sha256;
 if(cv&&typeof cv==='object'&&!Array.isArray(cv)){
  const groups=[canonical.atom_selection,cv.atom_selection,cv.atoms_zero_based].filter(value=>value!==undefined&&value!==null&&value!=='');
  if(groups.length){
   if(groups.some(value=>JSON.stringify(value)!==JSON.stringify(groups[0])))throw Error('Conflicting declared CV atom_selection aliases');
   canonical.atom_selection=groups[0];delete cv.atom_selection;delete cv.atoms_zero_based;
   if(!Object.keys(cv).length)delete canonical.cv;
  }
 }
 return controls(canonical);
}

export function validateDeploymentQos(target,qos){
 if(qos===undefined||qos==='')return;
 if(target!=='cluster'||typeof qos!=='string'||!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(qos))throw Error('Invalid Slurm QoS');
}

export function validDeployment(value){
 if(!value||!['local','cluster'].includes(value.target)||typeof value.projectId!=='string'||!value.projectId||typeof value.targetId!=='string'||!value.targetId)throw Error('请选择项目和计算目标');
 if(!['local','remote'].includes(value.inputSource||'local')||value.target==='local'&&value.inputSource==='remote')throw Error('无效的输入来源');
 if(!Number.isSafeInteger(value.maxSeconds)||value.maxSeconds<1||value.maxSeconds>604800)throw Error('请设置有效的墙钟时长上限');
 if(typeof value.directoryName!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.directoryName))throw Error('工作目录名仅允许字母、数字、下划线和连字符');
 const gpu=value.gpu===undefined?0:value.gpu;
 if(value.target==='local'&&!isLocalGpuId(gpu))throw Error('无效的部署资源：gpu');
 const resources=value.resources||{};for(const [k,min] of [['cpus',1],['gpus',0],['memory_mb',1]])if(!Number.isSafeInteger(resources[k])||resources[k]<min)throw Error('无效的部署资源：'+k);
 if(value.queueSelection!==undefined&&value.queueSelection!=='policy')throw Error('无效的队列选择方式');
 const queuePolicy=value.target==='cluster'&&value.queueSelection==='policy';
 if(value.queueSelection==='policy'&&value.target!=='cluster')throw Error('队列策略仅用于集群');
 if(value.target==='cluster'&&(!queuePolicy||resources.queue!==undefined&&resources.queue!=='')&&(typeof resources.queue!=='string'||!/^[A-Za-z0-9_.@:/+-]{1,128}$/.test(resources.queue)))throw Error('请选择队列或分区');
 if(resources.queue_target_id!==undefined&&resources.queue_target_id!==''&&(!queuePolicy||typeof resources.queue_target_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(resources.queue_target_id)))throw Error('无效的队列环境目标');
 validateDeploymentQos(value.target,resources.qos);
 if(resources.account&& !/^[A-Za-z0-9_.@:/+-]{1,128}$/.test(resources.account))throw Error('无效的调度账户');
 return {target:value.target,projectId:value.projectId,targetId:value.targetId,inputSource:value.inputSource||'local',maxSeconds:value.maxSeconds,directoryName:value.directoryName,...queuePolicy?{queueSelection:'policy'}:{},resources:{cpus:resources.cpus,gpus:resources.gpus,memory_mb:resources.memory_mb,...resources.qos?{qos:resources.qos}:{},...queuePolicy?{...resources.queue?{queue:resources.queue}:{},...resources.account?{account:resources.account}:{},...resources.queue_target_id?{queue_target_id:resources.queue_target_id}:{}}:{queue:resources.queue||'',account:resources.account||''}},gpu:isLocalGpuId(gpu)?gpu:0};
}

// Called only after an explicit target/selection change. Saved drafts are never migrated on read.
export function clusterDeploymentChoice(resources,profile,targetId=''){
 const {queue_target_id,qos,...previous}=resources||{};
 if(profile?.scheduler==='slurm'&&qos)previous.qos=qos;
 if(profile&&Object.hasOwn(profile,'queue_targets'))return {queueSelection:'policy',resources:{...previous,queue:'',account:'',...targetId?{queue_target_id:targetId}:{}}};
 return {queueSelection:undefined,resources:{...previous,queue:profile?.queue||previous.queue||''}};
}

// Preparation identifies immutable inputs. Review evidence is independent of
// project permission and must not invalidate an otherwise current attempt.
export function deploymentCurrent(task,_authority){return !!task.deployment?.prepared&&task.deployment.prepared.parameterRevision===task.parameterRevision&&task.deployment.prepared.deploymentRevision===task.deployment.revision;}


export function snapshotIdentity(task,run){return JSON.stringify({runId:run.id,parameterRevision:task.parameterRevision,deploymentRevision:task.deployment?.revision,files:(run.snapshots||[]).map(s=>({name:s.name,sha256:s.sha256,size:s.size})).sort((a,b)=>a.name.localeCompare(b.name))});}
