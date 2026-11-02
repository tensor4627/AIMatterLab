import {validDeployment} from './deployment.mjs';
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>JSON.stringify(value,(_k,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
export function sameDeploymentConfig(a,b){try{return canonical(validDeployment(a))===canonical(validDeployment(b));}catch{return false;}}
export function deploymentConfig(task){const defaults={target:'local',projectId:'',targetId:task.authoring?.environmentId||'',inputSource:'local',directoryName:'run-'+task.id.slice(0,8),maxSeconds:300,gpu:0,resources:{queue:'',cpus:1,gpus:1,memory_mb:4096,account:''}},value=task.deploymentDraft?.config||task.deployment?.config||{};return structuredClone({...defaults,...value,resources:{...defaults.resources,...value.resources}});}
/** A persisted settings draft never grants science review, preparation or execution. */
export function validDeploymentDraft(value){
 if(!object(value)||Object.keys(value).some(key=>!['target','projectId','targetId','inputSource','directoryName','maxSeconds','gpu','resources','queueSelection'].includes(key))||!['local','cluster'].includes(value.target)||!['local','remote'].includes(value.inputSource))throw Error('部署草稿字段无效');
 if(value.queueSelection!==undefined&&(value.queueSelection!=='policy'||value.target!=='cluster'))throw Error('部署草稿队列选择方式无效');
 for(const [key,limit]of [['projectId',200],['targetId',200],['directoryName',128]])if(typeof value[key]!=='string'||value[key].length>limit||/[\0\r\n]/.test(value[key]))throw Error('部署草稿字段无效：'+key);
 for(const key of ['gpu','maxSeconds'])if(!Number.isSafeInteger(value[key])||Math.abs(value[key])>1e9)throw Error('部署草稿数值无效：'+key);
 const resources=value.resources;if(!object(resources)||Object.keys(resources).some(key=>!['queue','account','cpus','gpus','memory_mb','queue_target_id'].includes(key)))throw Error('部署草稿资源字段无效');
 if(resources.queue_target_id!==undefined&&(value.queueSelection!=='policy'||typeof resources.queue_target_id!=='string'||resources.queue_target_id!==''&&!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(resources.queue_target_id)))throw Error('部署草稿队列环境目标无效');
 for(const key of ['cpus','gpus','memory_mb'])if(!Number.isSafeInteger(resources[key])||Math.abs(resources[key])>1e9)throw Error('部署草稿数值无效：'+key);
 for(const key of ['queue','account'])if(!(resources[key]===undefined&&value.queueSelection==='policy')&&(typeof resources[key]!=='string'||resources[key].length>128||/[\0\r\n]/.test(resources[key])))throw Error('部署草稿字段无效：'+key);
 return structuredClone(value);
}
const boxes=new WeakMap();
export function deploymentOutbox(id,storage){let map=boxes.get(storage);if(!map){map=new Map();boxes.set(storage,map);}if(!map.has(id))map.set(id,new DeploymentOutbox(id,storage));return map.get(id);}
export class DeploymentOutbox{
 constructor(id,storage){this.id=id;this.storage=storage;this.key='studio.deployment.pending.'+id;this.pending=null;this.seq=0;const raw=storage.getItem(this.key);if(raw){try{const entry=JSON.parse(raw);if(!object(entry)||entry.schema!==1||!Number.isSafeInteger(entry.seq)||entry.seq<1||!Number.isSafeInteger(entry.expectedRevision)||entry.expectedRevision<0||typeof entry.mutationId!=='string')throw Error('Invalid deployment outbox');validDeploymentDraft(entry.value);this.pending=entry;this.seq=entry.seq;}catch{this.error='部署草稿缓存无法读取，请保留并检查本机草稿。';}}}
 get activeSave(){return this.flight||null;}
 current(task){if(this.pending)return structuredClone(this.pending.value);return deploymentConfig(this.ack&&this.ack.deploymentDraft?.revision>(task.deploymentDraft?.revision||0)?this.ack:task);}
 stage(value,task){if(this.error)throw Error(this.error);const entry={schema:1,seq:++this.seq,value:validDeploymentDraft(value),expectedRevision:this.pending?.expectedRevision??Math.max(task.deploymentDraft?.revision||0,this.ack?.deploymentDraft?.revision||0),mutationId:crypto.randomUUID()};this.storage.setItem(this.key,JSON.stringify(entry));this.pending=entry;}
 flush(save){if(this.flight)return this.flight;if(this.error)return Promise.reject(Error(this.error));this.flight=(async()=>{let saved=this.ack;while(this.pending){const entry=structuredClone(this.pending);saved=await save({taskId:this.id,value:entry.value,expectedRevision:entry.expectedRevision,mutationId:entry.mutationId});const draft=saved?.deploymentDraft;if(saved?.id!==this.id||draft?.lastMutationId!==entry.mutationId||!Number.isSafeInteger(draft.revision)||JSON.stringify(draft.config)!==JSON.stringify(entry.value))throw Error('部署草稿保存未确认；本机修改已保留。');this.ack=saved;if(this.pending.seq===entry.seq){this.storage.removeItem(this.key);this.pending=null;}else{const next={...this.pending,expectedRevision:draft.revision};this.storage.setItem(this.key,JSON.stringify(next));this.pending=next;}}return saved;})().finally(()=>{this.flight=null;});return this.flight;}
}
