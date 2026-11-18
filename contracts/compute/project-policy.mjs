export const FIELDS=['engines','gpus','max_seconds','max_concurrent','input_roots','environments','clusters'];

export const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
export const isLocalGpuId=value=>Number.isSafeInteger(value)&&value>=0;
export const validLocalGpuIds=value=>Array.isArray(value)&&[...value].every(isLocalGpuId);

export function validateProjectSpec(spec,engines){
 if(!object(spec)||Object.keys(spec).some(key=>!['name','policy'].includes(key))||typeof spec.name!=='string'||!spec.name.trim()||!object(spec.policy)||Object.keys(spec.policy).some(key=>!FIELDS.includes(key)))throw Error('project_edit_invalid_fields');
 const p=spec.policy,strings=v=>Array.isArray(v)&&v.every(x=>typeof x==='string'&&x.trim());
 if(!strings(p.engines)||!p.engines.length||p.engines.some(id=>!engines.includes(id))||!validLocalGpuIds(p.gpus)||!Number.isSafeInteger(p.max_seconds)||p.max_seconds<1||!Number.isSafeInteger(p.max_concurrent)||p.max_concurrent<1||!strings(p.input_roots)||!p.input_roots.length||p.input_roots.some(root=>!root.startsWith('/')||/[\r\n\0]/.test(root)||root.split('/').includes('..'))||!strings(p.environments)||p.clusters!==undefined&&!strings(p.clusters)||!p.environments.length&&!p.clusters?.length)throw Error('project_edit_invalid_fields');
}
