// Actual workflow panel/controller and typed transports. Only bridge responses and timers are controlled.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {compileToolGroup,toolGroupIdentityText} from '../../contracts/tools/tool-group.mjs';
import {packageRecord} from './tool-packages-components.mjs';

const workspace=path.resolve(import.meta.dirname,'../..'),compiled=new Map(),clone=value=>structuredClone(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
function code(file){if(!compiled.has(file))compiled.set(file,ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText);return compiled.get(file);}
export function groupRecord({id='cpu-sequence',revision=1,record=packageRecord(),count=2,frozen=true}={}){
 const definition={schema_version:1,id,name:'Actual CPU sequence',inputs:[],steps:Array.from({length:count},(_,index)=>({id:'step-'+(index+1),tool_id:record.package_id,package_version:record.package_version,function_id:record.manifest.functions[0].id,inputs:{},parameters:{},depends_on:index?['step-'+index]:[]})),outputs:[{id:'result',step_id:'step-'+count,port_id:'result',required:true}]},definition_text=JSON.stringify(definition),value=compileToolGroup(definition,()=>({version:record.package_version,manifest:record.manifest}));
 return {schema_version:1,id,name:definition.name,revision,version:frozen?sha(toolGroupIdentityText(definition_text)):null,has_frozen_version:frozen,definition_text:frozen?definition_text:null,definition,compiled:value,created_at:1,updated_at:1,status:'definition_checked',execution_status:'not_run'};
}
export function executionConfiguration(record=packageRecord(),id='configuration-A',environment='environment-A'){
 return {schema_version:1,status:'active',configuration_id:id,revision:3,package_id:record.package_id,package_version:record.package_version,manifest_sha256:record.manifest_sha256,source_commit:record.source_commit,target:{target:'local',project_id:'compute-project',environment_id:environment},environment_sha256:'e'.repeat(64),functions:clone(record.manifest.functions),archived_resources:[],guidance_resources:[],archive_revision:1,execution_skill:{id:'execution-skill-'+id,body:'Self-contained fixture execution instructions',sha256:'d'.repeat(64),facts:{}},scope:'Engineering fixture'};
}
export function workflowRead({group=groupRecord(),configuration=executionConfiguration(),id='execution-A',taskId='task-A',workspaceId='workspace-A'}={}){
 const root='/fixture/projects/'+workspaceId+'/workflows/cpu-'+id,steps=group.compiled.execution_order.map((stepId,index)=>{const feature=group.compiled.steps.find(item=>item.id===stepId);return {id:stepId,tool_id:feature.tool_id,package_version:feature.package_version,function_id:feature.function_id,configuration_id:configuration.configuration_id,execution_skill_id:configuration.execution_skill.id,status:'pending',reason:index?'Previous step has not independently passed':null,run_id:null,run_status:null,eligible:index===0,review:null};});
 return {workflow:{schema_version:2,id:'workflow-'+id,project_id:configuration.target.project_id,name:'Saved CPU workflow '+id,workspace_id:workspaceId,revision:1,root,execution_mode:'manual_step_review',tool_group_refs:[{id:group.id,version:group.version}],execution_ids:[id],steps:[],run_ids:[]},execution:{schema_version:1,id,workflow_id:'workflow-'+id,revision:1,status:'pending',execution_mode:'manual_step_review',workspace_id:workspaceId,target:clone(configuration.target),group:{id:group.id,version:group.version},root:root+'/executions/'+id,snapshot_sha256:'8'.repeat(64),steps,reason:null}};
}
function preparedReview(value,step){const directory=value.execution.root+'/steps/001-'+step.tool_id+'-'+step.id+'/'+step.run_id;return {review_sha256:'a'.repeat(64),run_id:step.run_id,request_hash:'b'.repeat(64),argv:['/fixture/python','/fixture/installed/worker.py'],inputs:[{name:'run.py',sha256:'c'.repeat(64),size:329,source:'/fixture/installed/worker.py'}],target:clone(value.execution.target),directory,working_directory:directory+'/results',criteria:{expected_outputs:[{path:'smoke-result.json',format:'json'}],pass_criteria:['Actual JSON, child PID, supervisor exit and console marker']},configuration_id:step.configuration_id,execution_skill_id:step.execution_skill_id,execution_skill_sha256:'d'.repeat(64),package_id:step.tool_id,package_version:step.package_version,function_id:step.function_id,group_id:value.execution.group.id,group_version:value.execution.group.version,environment_sha256:'e'.repeat(64),authorization_sha256:'f'.repeat(64),python:{path:'/fixture/python'},install_files:[{path:'worker.py',sha256:'c'.repeat(64)}],max_seconds:30};}

export function toolWorkflowsHarness({override,properties={},withWorkflow=false,focus}={}){
 const hooks=[],effects=[],calls=[],timers=new Map(),listeners=new Set(),modules=new Map();let cursor=0,dirty=false,tree,disposed=false,timerId=0;
 const record=packageRecord(),group=groupRecord({record}),configuration=executionConfiguration(record),binding={distribution:'Fixture',root:'/fixture',port:8888};
 const task={id:'task-A',provider:'codex',threadId:'thread-A',workflowVersion:2,workspaceChoice:'workspace',workspace:{id:'workspace-A',root:'/fixture/projects/workspace-A',workerBinding:binding},authoring:{workerBinding:binding}};
 const data={record,groups:new Map([[group.id,group]]),versions:new Map([[group.version,group]]),configurations:new Map([[configuration.configuration_id,configuration]]),executions:new Map(),creations:[],owner_key:'owner-A',binding,task};if(withWorkflow){const value=workflowRead({group,configuration});data.executions.set(value.execution.id,value);}
 const props={task,worker:true,busy:false,...focus?{toolWorkflowFocus:focus}:{},...properties};
 const useState=initial=>{const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{const value=typeof next==='function'?next(hooks[index].value):next;if(!Object.is(value,hooks[index].value)){hooks[index].value=value;dirty=true;}}];};
 const useRef=initial=>{const index=cursor++;return hooks[index]??(hooks[index]={current:initial});};
 const useEffect=(fn,deps)=>{const index=cursor++,old=hooks[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps?.[i]))){const item={deps,cleanup:old?.cleanup};hooks[index]=item;effects.push(()=>{item.cleanup?.();item.cleanup=fn();});}};
 const context=()=>({task_id:data.task.id,workspace_id:data.task.workspace?.id,owner_key:data.owner_key,worker_binding:clone(binding),groups:[...data.groups.values()].map(({definition,compiled,...value})=>value),configurations:[...data.configurations.values()].map(value=>({schema_version:1,configuration_id:value.configuration_id,package_id:value.package_id,package_version:value.package_version,worker_binding:clone(binding),project_id:value.target.project_id,environment_id:value.target.environment_id,created_at:1})),workflows:[...data.executions.values()].map(value=>({schema_version:1,execution_id:value.execution.id,workflow_id:value.workflow.id,task_id:data.task.id,workspace_id:value.workflow.workspace_id,name:value.workflow.name,group_id:value.execution.group.id,group_version:value.execution.group.version,target:clone(value.execution.target),worker_binding:clone(binding),created_at:1,last_revision:value.execution.revision})),creations:clone(data.creations)});
 const standard=async(method,value)=>{
  if(method==='tools.workflows.context')return context();
  if(method==='tools.groups.read'){const found=value.version?data.versions.get(value.version):data.groups.get(value.id);if(!found||found.id!==value.id)throw Error('Unknown exact group version');return clone(found);}
  if(method==='tools.configurations.read'){const found=data.configurations.get(value.configuration_id);if(!found)throw Error('Unknown configuration');return clone(found);}
  if(method==='tools.groups.compile')return compileToolGroup(value.definition,()=>({version:record.package_version,manifest:record.manifest}));
  if(method==='tools.groups.save'){const previous=data.groups.get(value.definition.id);assert.equal(value.expected_revision,previous?.revision||0);const definition_text=JSON.stringify(value.definition),version=sha(toolGroupIdentityText(definition_text)),saved={schema_version:1,id:value.definition.id,name:value.definition.name,revision:(previous?.revision||0)+1,version,has_frozen_version:true,definition_text,definition:clone(value.definition),compiled:compileToolGroup(value.definition,()=>({version:record.package_version,manifest:record.manifest})),created_at:1,updated_at:2,status:'definition_checked',execution_status:'not_run'};data.groups.set(saved.id,saved);data.versions.set(version,saved);return clone(saved);}
  if(method==='tools.workflows.create'||method==='tools.workflows.retryCreate'){
   const selectedGroup=method.endsWith('create')?data.versions.get(value.group_version):group,selectedConfig=method.endsWith('create')?data.configurations.get(value.configurations[0].configuration_id):configuration,result=workflowRead({group:selectedGroup,configuration:selectedConfig,id:'execution-created',taskId:data.task.id,workspaceId:data.task.workspace.id});data.executions.set(result.execution.id,result);return clone(result);
  }
  if(['tools.workflows.read','tools.workflows.status'].includes(method)){const found=data.executions.get(value.execution_id);if(!found)throw Error('Unknown execution');return clone(found);}
  if(method==='tools.workflows.prepareStep'){
   const found=data.executions.get(value.execution_id),step=found.execution.steps.find(item=>item.id===value.step_id);assert.equal(value.expected_revision,found.execution.revision);assert.equal(step.status,'pending');assert.equal(step.eligible,true);step.status='prepared';step.eligible=false;step.run_id='original-run-'+step.id;step.run_status='draft';step.review=preparedReview(found,step);found.execution.revision++;found.execution.status='prepared';found.workflow.run_ids.push(step.run_id);return clone(found);
  }
  if(method==='tools.workflows.executeStep'){
   const found=data.executions.get(value.execution_id),step=found.execution.steps.find(item=>item.id===value.step_id);assert.equal(value.expected_revision,found.execution.revision);assert.equal(value.review_sha256,step.review.review_sha256);step.status='running';step.run_status='running';found.execution.status='running';found.execution.revision++;return clone(found);
  }
  throw Error('Unexpected workflow fixture IPC '+method);
 };
 const invoke=async(method,value)=>{calls.push({method,data:clone(value)});return override?override(method,value,standard,data):standard(method,value);};
 const bridge={studio:{invoke,onEvent:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}}};
 function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);const require=name=>{if(name==='react')return {useState,useEffect,useRef};if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};if(name.endsWith('/i18n'))return {t:value=>value};if(name.endsWith('.css'))return {};if(name.startsWith('.')){const target=path.resolve(path.dirname(file),name);return load(['.ts','.tsx'].map(ext=>target+ext).find(candidate=>fs.existsSync(candidate))||target);}throw Error('Unexpected workflow component dependency '+name);};new Function('require','module','exports','window','setTimeout','clearTimeout',code(file))(require,module,module.exports,bridge,(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},id=>timers.delete(id));return module.exports;}
 const component=load(path.join(workspace,'frontend/features/workflows/ToolWorkflowsPanel.tsx')).default;
 const all=node=>Array.isArray(node)?node.flatMap(all):node&&typeof node==='object'?[node,...all(node.props?.children)]:[];
 const text=node=>Array.isArray(node)?node.map(text).join(''):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);
 function find(predicate){const node=all(tree).find(predicate);if(!node)throw Error('Workflow fixture node not found');return node;}
 function render(){cursor=0;dirty=false;tree=component(props);}
 async function flush(){for(let i=0;i<30;i++){while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));if(dirty&&!disposed)render();}}
 function click(id){const node=find(node=>node.type==='button'&&(node.props['data-testid']===id||text(node)===id));if(node.props.disabled)throw Error('Disabled workflow button '+id);node.props.onClick();render();}
 function change(label,value){const node=find(node=>node.props?.['aria-label']===label);if(node.props.disabled)throw Error('Disabled workflow field '+label);node.props.onChange({target:{value}});render();}
 function update(value){Object.assign(props,value);render();}
 function tick(){const pending=[...timers.values()];timers.clear();pending.forEach(timer=>timer.fn());render();}
 function event(method){listeners.forEach(listener=>listener({method}));render();}
 function unmount(){disposed=true;hooks.forEach(hook=>hook?.cleanup?.());}
 render();return {data,props,calls,timers,flush,click,change,update,tick,event,unmount,find,text,tree:()=>tree,all:()=>all(tree)};
}
