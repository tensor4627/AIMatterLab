import {fieldMissing,inferField,parameterValue} from '../../../contracts/workflows/task-fields.mjs';
import {partitionFields} from '../../ui/task-fields.mjs';

const isText=value=>typeof value==='string'&&!!value.trim();
const semanticFields=[
 {keys:['structure_file','structure.file','structure.initial','structure'],matches:isText,label:'初始结构'},
 {keys:['structure.symbols','structure.elements'],matches:value=>Array.isArray(value)&&value.length>0&&value.every(name=>typeof name==='string'&&/^[A-Z][a-z]?$/.test(name)),label:'元素'},
 {keys:['structure.atom_count'],matches:value=>Number.isSafeInteger(value)&&value>0,label:'原子数'},
 {keys:['potential_file','potential.file','model_file','model.file','potential','model'],matches:isText,label:'势模型'},
 {keys:['mode','sampling.mode','dynamics.temperature_K','temperature_K','dynamics.temperature','temperature','dynamics.steps','steps'],matches:value=>isText(value)||typeof value==='number'&&Number.isFinite(value)},
];

export function keyWorkflowFields(steps,parameters){
 const all=new Map(steps.flatMap(step=>step.fields.map(field=>[field.key,{step,field}])));
 const known=semanticFields.flatMap(({keys,matches,label})=>{
  const key=keys.find(key=>all.has(key)&&matches(parameterValue(parameters,key))&&!fieldMissing(all.get(key).field,parameters));
  if(!key)return [];
  const value=all.get(key),field=value.field;
  const kelvin=key==='temperature_K'||key==='dynamics.temperature_K';
  const name=field.label===inferField(key,parameterValue(parameters,key)).label?(label||(kelvin?'温度':field.label)):field.label;
  return [{...value,field:{...field,label:name,unit:field.unit||(kelvin?'K':undefined)}}];
 });
 const selected=new Set(known.map(item=>item.field.key));
 const other=steps.flatMap(step=>partitionFields(step.fields).primary.filter(field=>{
  const value=parameterValue(parameters,field.key);
  return !selected.has(field.key)&&!fieldMissing(field,parameters)&&value!=null&&value!==''&&(!Array.isArray(value)||value.length>0);
 }).map(field=>({step,field})));
 return [...known,...other.slice(0,Math.max(0,4-known.length))];
}

export function workflowMissingTargets(steps,parameters){
 return steps.flatMap(step=>{
  const {primary,advanced}=partitionFields(step.fields);
  return [...primary,...advanced].filter(field=>fieldMissing(field,parameters)).map(field=>({step,field}));
 });
}

export function workflowOutputLabels(roadmap){
 if(!Array.isArray(roadmap?.outputs)||!Array.isArray(roadmap.resources))return [];
 const resources=new Map(roadmap.resources.map(resource=>[resource.id,resource]));
 return roadmap.outputs.flatMap(id=>{
  const resource=resources.get(id);
  return isText(resource?.label)?[{id,label:resource.label,inferred:resource.basis==='inferred'}]:[];
 });
}
