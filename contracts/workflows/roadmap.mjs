import schema from './roadmap.schema.json' with {type:'json'};
import {normalizeInlineSchema} from '../tools/tool-package.mjs';
import {fieldPath} from './task-fields.mjs';

function unique(values,where){
 if(new Set(values).size!==values.length)throw Error('Duplicate roadmap '+where);
}

// Build dependencies from resource identity. Array order and form steps carry no data lineage.
function indexRoadmap(plan){
 const resources=new Set(plan.resources.map(resource=>resource.id)),initial=new Set(plan.inputs);
 unique(plan.resources.map(resource=>resource.id),'resource');
 unique(plan.steps.map(step=>step.id),'step');
 unique(plan.inputs,'initial input');
 unique(plan.outputs,'final output');
 const producer=new Map(),byStep=new Map(plan.steps.map(step=>[step.id,step]));
 for(const resource of plan.resources){
  if(resource.checks?.some(check=>!resource.requirements?.includes(check.requirement)))throw Error('Roadmap check must refer to an original requirement');
  if(resource.field!==undefined){
   fieldPath(resource.field);
   if(!initial.has(resource.id))throw Error('Only initial roadmap inputs can bind a parameter');
  }
  if(resource.file_name!==undefined&&(!resource.field||['.','..'].includes(resource.file_name)))throw Error('Roadmap file_name requires an initial file binding');
 }
 function known(id){if(!resources.has(id))throw Error('Unknown roadmap resource '+id);}
 for(const id of [...plan.inputs,...plan.outputs])known(id);
 for(const step of plan.steps){
  if(step.parameter_field!==undefined)fieldPath(step.parameter_field);
  if(Object.keys(step.runtime_labels||{}).some(side=>!step.runtime?.[side]))throw Error('A runtime label needs a component on the same port');
  for(const side of [step.inputs,step.outputs]){
   unique(side.map(binding=>binding.port),'port on '+step.id);
   for(const binding of side)known(binding.resource);
  }
  for(const {resource} of step.outputs){
   if(initial.has(resource)||producer.has(resource))throw Error('Multiple roadmap sources for '+resource);
   producer.set(resource,step.id);
  }
 }
 const depths=new Map(),visiting=new Set(),order=[];
 function visit(id){
  if(depths.has(id))return depths.get(id);
  if(visiting.has(id))throw Error('Cyclic roadmap at '+id);
  visiting.add(id);
  let depth=1;
  for(const {resource} of byStep.get(id).inputs){
   if(producer.has(resource))depth=Math.max(depth,visit(producer.get(resource))+1);
  }
  visiting.delete(id);
  depths.set(id,depth);
  order.push(id);
  return depth;
 }
 for(const step of plan.steps)visit(step.id);
 return {initial,producer,byStep,depths,order};
}

export function validateRoadmap(value){
 if(new TextEncoder().encode(JSON.stringify(value)).length>131072)throw Error('Roadmap exceeds 128 KiB');
 const plan=normalizeInlineSchema(value,schema,'roadmap');
 indexRoadmap(plan);
 return plan;
}

export function resolveRoadmapInput(parameters,{field,file_name:fileName}){
 if(!field)return {value:undefined};
 let value=parameters;
 for(const part of fieldPath(field)){
  if(!value||typeof value!=='object'||!Object.hasOwn(value,part))return {value:undefined};
  value=value[part];
 }
 if(!fileName)return {value};
 const matches=(Array.isArray(value)?value:[value]).filter(file=>typeof file==='string'&&file.split(/[\\/]/).at(-1)===fileName);
 return {value:matches.length===1?matches[0]:undefined,ambiguous:matches.length>1};
}

function supplied(value){
 if(value==null)return false;
 if(typeof value==='string')return !!value.trim();
 if(Array.isArray(value))return value.length>0&&value.every(supplied);
 return typeof value!=='object'||Object.keys(value).length>0;
}

/** Project an already validated plan onto the current (possibly manually edited) draft. */
export function analyzeRoadmap(plan,parameters={}){
 const {initial,producer,byStep,depths,order}=indexRoadmap(plan);
 const reachedSteps=new Set(),reachedResources=new Set(),findings=[];
 const goals=plan.outputs.map(output=>{
  const inputs=new Set(),steps=new Set(),unresolved=new Set();
  function trace(resource){
   reachedResources.add(resource);
   if(initial.has(resource)){inputs.add(resource);return;}
   const stepId=producer.get(resource);
   if(!stepId){unresolved.add(resource);return;}
   if(steps.has(stepId))return;
   steps.add(stepId);reachedSteps.add(stepId);
   for(const binding of byStep.get(stepId).inputs)trace(binding.resource);
  }
  trace(output);
  return {output,inputs:[...inputs],steps:order.filter(id=>steps.has(id)),unresolved:[...unresolved]};
 });
 const final=new Set(plan.outputs);
 const consumed=new Set(plan.steps.flatMap(step=>step.inputs.map(port=>port.resource)));
 if(!final.size)findings.push({code:'no_outputs'});
 for(const resource of plan.resources){
  const id=resource.id;
  if(initial.has(id)){
   const binding=resolveRoadmapInput(parameters,resource);
   if(!supplied(binding.value))findings.push({code:binding.ambiguous?'ambiguous_file':'input_needed',resource:id});
  }
  if((initial.has(id)||final.has(id))&&resource.basis!=='user')findings.push({code:'confirm',resource:id});
  if(!initial.has(id)&&!producer.has(id)&&(final.has(id)||consumed.has(id)))findings.push({code:'no_source',resource:id});
  if(!initial.has(id)&&!producer.has(id)&&!final.has(id)&&!consumed.has(id))findings.push({code:'unused_resource',resource:id});
  if(initial.has(id)&&!reachedResources.has(id))findings.push({code:'unused_input',resource:id});
 }
 for(const step of plan.steps)if(!reachedSteps.has(step.id))findings.push({code:'unused_step',step:step.id});
 return {order:order.filter(id=>reachedSteps.has(id)),depths:Object.fromEntries(depths),goals,findings};
}
