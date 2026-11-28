import {validDeployment,validateDeploymentQos} from "./deployment.mjs";
export const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);

const canonical=value=>JSON.stringify(value,(_k,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);

export function sameDeploymentConfig(a,b){try{return canonical(validDeployment(a))===canonical(validDeployment(b));}catch{return false;}}

/** A persisted settings draft never grants science review, preparation or execution. */
export function validDeploymentDraft(value){
 if(!object(value)||Object.keys(value).some(key=>!['target','projectId','targetId','inputSource','directoryName','maxSeconds','gpu','resources','queueSelection'].includes(key))||!['local','cluster'].includes(value.target)||!['local','remote'].includes(value.inputSource))throw Error('部署草稿字段无效');
 if(value.queueSelection!==undefined&&(value.queueSelection!=='policy'||value.target!=='cluster'))throw Error('部署草稿队列选择方式无效');
 for(const [key,limit]of [['projectId',200],['targetId',200],['directoryName',128]])if((key!=='projectId'||value[key]!==undefined)&&(typeof value[key]!=='string'||value[key].length>limit||/[\0\r\n]/.test(value[key])))throw Error('部署草稿字段无效：'+key);
 for(const key of ['gpu','maxSeconds'])if(!Number.isSafeInteger(value[key])||Math.abs(value[key])>1e9)throw Error('部署草稿数值无效：'+key);
 const resources=value.resources;if(!object(resources)||Object.keys(resources).some(key=>!['queue','account','cpus','gpus','memory_mb','qos','queue_target_id'].includes(key)))throw Error('部署草稿资源字段无效');
 validateDeploymentQos(value.target,resources.qos);
 if(resources.queue_target_id!==undefined&&(value.queueSelection!=='policy'||typeof resources.queue_target_id!=='string'||resources.queue_target_id!==''&&!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(resources.queue_target_id)))throw Error('部署草稿队列环境目标无效');
 for(const key of ['cpus','gpus','memory_mb'])if(!Number.isSafeInteger(resources[key])||Math.abs(resources[key])>1e9)throw Error('部署草稿数值无效：'+key);
 for(const key of ['queue','account'])if(!(resources[key]===undefined&&value.queueSelection==='policy')&&(typeof resources[key]!=='string'||resources[key].length>128||/[\0\r\n]/.test(resources[key])))throw Error('部署草稿字段无效：'+key);
 return structuredClone(value);
}
