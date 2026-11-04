import {validateToolPackage,validateToolPorts,toolParameterValues,validateToolJson} from './tool-package.mjs';

const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value)&&value.length<=96;
const fail=message=>{throw Error('Tool group: '+message);};
const exact=(value,allowed,required=allowed)=>{if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))fail('invalid fields');};
const unique=values=>{if(new Set(values).size!==values.length)fail('duplicate identifier');};
function compatible(source,target){if(source.type!==target.type||source.format!==target.format)fail('resource type or format does not match: '+source.id+' → '+target.id);if(target.required&&!source.required)fail('optional output/input cannot guarantee a required downstream input');}

/** Resolve a portable definition against exact registered versions, without executing it. */
export function compileToolGroup(definition,lookup){
 validateToolJson(definition);if(typeof lookup!=='function')fail('registered package resolver required');
 exact(definition,['schema_version','id','name','inputs','steps','outputs']);
 if(definition.schema_version!==1||!id(definition.id)||typeof definition.name!=='string'||!definition.name.trim()||definition.name.length>200||!Array.isArray(definition.steps)||!definition.steps.length||definition.steps.length>128||!Array.isArray(definition.outputs)||!definition.outputs.length||definition.outputs.length>128)fail('invalid definition');
 const inputs=validateToolPorts(definition.inputs,'group.inputs'),steps=new Map(),groups=new Map();
 for(const step of definition.steps){
  exact(step,['id','tool_id','package_version','function_id','inputs','parameters','depends_on'],['id','tool_id','package_version','function_id','inputs']);
  if(!id(step.id)||!id(step.tool_id)||!id(step.function_id)||! /^[0-9a-f]{64}$/.test(step.package_version)||!object(step.inputs)||steps.has(step.id))fail('invalid or duplicate step');
  const registered=lookup({id:step.tool_id,version:step.package_version});
  if(!registered||registered.version!==step.package_version)fail('exact package version is unavailable');
  const manifest=validateToolPackage(registered.manifest);if(manifest.id!==step.tool_id)fail('registered package identity differs');
  const feature=manifest.functions.find(item=>item.id===step.function_id);if(!feature)fail('unknown function');
  if(Object.keys(step.inputs).some(key=>!feature.inputs.some(port=>port.id===key)))fail('unknown function input');
  const depends=step.depends_on??[];if(!Array.isArray(depends)||depends.some(value=>!id(value)))fail('invalid dependencies');unique(depends);
  steps.set(step.id,{id:step.id,tool_id:step.tool_id,package_version:step.package_version,function_id:step.function_id,parameters:toolParameterValues(feature.parameters,step.parameters??{}),inputs:{},depends_on:[...depends],feature});groups.set(step.id,step.inputs);
 }
 const initialUsers=new Map(inputs.map(input=>[input.id,new Set()]));
 for(const step of steps.values()){
  for(const dependency of step.depends_on)if(!steps.has(dependency)||dependency===step.id)fail('unknown or self dependency');
  for(const target of step.feature.inputs){
   const binding=groups.get(step.id)[target.id];
   if(binding===undefined){if(target.required)fail('required input is unbound: '+step.id+'.'+target.id);step.inputs[target.id]={kind:'default',value:structuredClone(target.default),behavior:target.default_behavior};continue;}
   if(!object(binding))fail('invalid input source');
   if(Object.hasOwn(binding,'input_id')){
    exact(binding,['input_id']);const source=inputs.find(input=>input.id===binding.input_id);if(!source)fail('unknown initial input');compatible(source,target);initialUsers.get(source.id).add(step.id);step.inputs[target.id]={kind:'input',input_id:source.id};
   }else if(Object.hasOwn(binding,'step_id')){
    exact(binding,['step_id','port_id']);const upstream=steps.get(binding.step_id),source=upstream?.feature.outputs.find(output=>output.id===binding.port_id);if(!source||upstream.id===step.id)fail('unknown or self output');compatible(source,target);step.inputs[target.id]={kind:'output',step_id:upstream.id,port_id:source.id,...!source.required?{fallback:structuredClone(target.default)}:{}};if(!step.depends_on.includes(upstream.id))step.depends_on.push(upstream.id);
   }else if(Object.hasOwn(binding,'value')){
    exact(binding,['value']);if(target.type!=='value')fail('portable file inputs must reference a managed initial input or upstream output');const value=structuredClone(binding.value);if(value===undefined||new TextEncoder().encode(JSON.stringify(value)).length>65536)fail('invalid literal value');step.inputs[target.id]={kind:'literal',value};
   }else fail('input source is not defined');
  }
 }
 const outputs=definition.outputs.map(output=>{
  exact(output,['id','step_id','port_id','required'],['id','step_id','port_id']);if(!id(output.id)||output.required!==undefined&&typeof output.required!=='boolean')fail('invalid final output');
  const step=steps.get(output.step_id),port=step?.feature.outputs.find(port=>port.id===output.port_id);if(!port)fail('unknown final output');const required=output.required??true;if(required&&!port.required)fail('final required product is optional');return {...output,required,type:port.type,format:port.format};
 });unique(outputs.map(output=>output.id));
 const order=[],temporary=new Set(),visited=new Set();
 function visit(key){if(temporary.has(key))fail('cyclic dependency');if(visited.has(key))return;temporary.add(key);for(const dependency of steps.get(key).depends_on)visit(dependency);temporary.delete(key);visited.add(key);order.push(key);}
 for(const output of outputs)visit(output.step_id);
 if(visited.size!==steps.size)fail('a step does not lead to any final product');
 for(const input of inputs)if(![...initialUsers.get(input.id)].some(key=>visited.has(key)))fail('an initial input does not reach a final product');
 return {schema_version:1,id:definition.id,name:definition.name.trim(),inputs,steps:order.map(key=>{const {feature,...value}=steps.get(key);return {...value,outputs:feature.outputs,engine:feature.engine};}),outputs,execution_order:order,status:'definition_checked',execution_status:'not_run'};
}
