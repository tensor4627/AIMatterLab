// Actual component, controller hook and typed clients. Only the renderer bridge and clock are fixtures.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {validateToolPackage} from '../../contracts/tools/tool-package.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const sources=new Map();
function compiled(file){if(!sources.has(file))sources.set(file,ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText);return sources.get(file);}
export function packageRecord(id='worker-reference',version='1'.repeat(64)){
 const manifest=validateToolPackage({schema_version:1,id,name:id+' reference',repository:{path:'source',commit:'a'.repeat(40)},manual:'manual.md',guidance:{delivery:'SKILL.md',installation:['install.md'],configuration:['configure.md']},environment:{hardware:'cpu',requirements:['Python standard library'],parallelism:{supported:['serial']}},functions:[{id:'process',name:'Worker process',description:'Engineering process lifecycle',engine:'installation.check',entrypoint:'source/worker.py',inputs:[],outputs:[{id:'result',type:'file',format:'json',description:'Process receipt',required:true,display:{priority:100,advanced:false,reason:'Main result'}}],parameters:[],operation:{command:['{python}','{entrypoint}'],failure_handling:'Inspect the original attempt'},tests:['smoke']}],tests:{directory:id+'-tests',introduction:id+'-tests/README.md',cases:[{id:'smoke',function_id:'process',directory:id+'-tests/smoke',instructions:id+'-tests/smoke/README.md',entrypoint:id+'-tests/smoke/run.py',resources:[],expected_outputs:[{path:'smoke-result.json',format:'json',description:'Receipt'}],pass_criteria:['Real child PID and supervisor receipt']}]}});
 return {schema_version:1,package_id:id,package_version:version,source_commit:manifest.repository.commit,manifest_sha256:'b'.repeat(64),manifest,files:[],guidance:[{path:'SKILL.md',role:'delivery',sha256:'c'.repeat(64)}],delivery_skill:{name:id,description:'Actual delivery metadata',path:'SKILL.md',sha256:'c'.repeat(64)},scope:'definition_checked',installation:{status:'not_run'},tests:{status:'not_run'},record_id:'record-'+id,snapshot_root:'/fixture/store/'+id+'-package',immutable:true,registered_at:1,revision:2,package_root:'/fixture/source/'+id+'-package',package_roots:['/fixture/source/'+id+'-package'],versions:[version],delivery_attachment:{name:id,path:'D:\\managed-snapshots\\'+id+'-package\\SKILL.md'}};
}
export function configurationRecord(record=packageRecord(),status='planned'){
 return {schema_version:1,id:'configuration-01',configuration_id:'configuration-01',package_id:record.package_id,package_version:record.package_version,revision:1,status,plan_sha256:'d'.repeat(64),target:{target:'local',project_id:'project-A',environment_id:'environment-A'},environment_sha256:'e'.repeat(64),python:{path:'/fixture/python',resolved:'/fixture/python',size:10,sha256:'f'.repeat(64)},installed_prefix:'/fixture/installed/'+record.package_id,tests:[{id:'smoke',function_id:'process',entrypoint:record.manifest.tests.cases[0].entrypoint,status:status==='tested'||status==='active'?'passed':'not_run',run_id:null,reason:null}],install:{status:'not_run'},scope:'CPU engineering reference',scientific_status:'not_run'};
}
function executionRecord(record,configuration){return {schema_version:1,status:configuration.status,configuration_id:configuration.configuration_id,revision:configuration.revision,package_id:record.package_id,package_version:record.package_version,manifest_sha256:record.manifest_sha256,source_commit:record.source_commit,target:configuration.target,environment_sha256:configuration.environment_sha256,functions:record.manifest.functions,archived_resources:[],guidance_resources:[{id:record.package_id+':'+record.package_version+':delivery:SKILL.md',role:'delivery',paths:[record.delivery_attachment.path]},{id:record.package_id+':'+record.package_version+':installation:install.md',role:'installation',paths:['/managed/install.md']}],archive_revision:1,execution_skill:configuration.status==='active'?{id:'execution-01',body:'Real environment execution instructions from fixture bridge',sha256:'9'.repeat(64),facts:{scientific_status:'not_run'}}:undefined,scope:'CPU engineering reference'};}
export function toolPackagesHarness({records=[packageRecord()],override,provider='codex',properties={},context={},configuration}={}){
 const hooks=[],effects=[],calls=[],attachments=[],timers=new Map(),modules=new Map();let cursor=0,dirty=false,tree,disposed=false,timerSequence=0;
 const data={records:new Map(records.map(record=>[record.package_id,structuredClone(record)])),candidate:structuredClone(records[0]||packageRecord()),configuration:configuration?structuredClone(configuration):null,context:{provider,providers:[],hasConversation:true,configuration_id:null,owner_key:'scope-A',...context},projects:[{id:'project-A',name:'Existing authorized CPU project',policy:{engines:['installation.check'],gpus:[0],max_seconds:30,max_concurrent:1,input_roots:['/fixture/input'],environments:['environment-A']}}],environments:[{id:'environment-A',name:'Registered CPU environment',executables:{python:'/fixture/python'}}]};
 const props={provider,onSelect:value=>attachments.push(value),...properties};
 const useState=initial=>{const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{const value=typeof next==='function'?next(hooks[index].value):next;if(!Object.is(value,hooks[index].value)){hooks[index].value=value;dirty=true;}}];};
 const useRef=initial=>{const index=cursor++;return hooks[index]??(hooks[index]={current:initial});};
 const useEffect=(fn,deps)=>{const index=cursor++,old=hooks[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps?.[i]))){const value={deps,cleanup:old?.cleanup};hooks[index]=value;effects.push(()=>{value.cleanup?.();value.cleanup=fn();});}};
 const summary=record=>{const {manifest,files,guidance,delivery_attachment,...value}=record;return {...value,name:manifest.name,updated_at:1};};
 const standard=async(method,value)=>{
  if(method==='tools.packages.list')return [...data.records.values()].map(summary);
  if(method==='tools.packages.choose')return {package_root:data.candidate.package_root};
  if(method==='tools.packages.inspect')return structuredClone(data.candidate);
  if(method==='tools.packages.read'){const record=data.records.get(value.package_id);if(!record)throw Error('Package not registered');return {...structuredClone(record),package_version:value.package_version||record.package_version};}
  if(['tools.packages.register','tools.packages.update','tools.packages.relocate'].includes(method)){const record={...structuredClone(data.candidate),revision:(data.records.get(data.candidate.package_id)?.revision||0)+1};data.records.set(record.package_id,record);return structuredClone(record);}
  if(method==='tools.configurations.context')return structuredClone(data.context);
  if(method==='tools.configurations.list')return data.configuration?[{schema_version:1,configuration_id:data.configuration.configuration_id,package_id:data.configuration.package_id,package_version:data.configuration.package_version,worker_binding:{distribution:'fixture',root:'/fixture',port:1},project_id:data.configuration.target.project_id,environment_id:data.configuration.target.environment_id,created_at:1}]:[];
  if(method==='worker.request'){if(value.method!=='GET')throw Error('Fixture forbids generic worker writes');if(value.target==='/api/projects')return structuredClone(data.projects);if(value.target==='/api/environments')return structuredClone(data.environments);}
  if(method==='tools.configurations.createProject'){const project={...structuredClone(data.projects[0]),id:'created-project',name:value.name,policy:{...structuredClone(data.projects[0].policy),environments:[value.environment_id]}};data.projects.push(project);return structuredClone(project);}
  if(method==='tools.configurations.plan'){const record=data.records.get(value.package_id);data.configuration={...configurationRecord(record),target:{target:'local',project_id:value.project_id,environment_id:value.environment_id}};return structuredClone(data.configuration);}
  if(method==='tools.configurations.execute'){data.configuration={...data.configuration,revision:data.configuration.revision+1,status:'testing',install:{status:'passed'},tests:data.configuration.tests.map(test=>({...test,status:'running',run_id:'original-run-01'}))};return structuredClone(data.configuration);}
  if(method==='tools.configurations.status')return structuredClone(data.configuration);
  if(method==='tools.configurations.activate'){data.configuration={...data.configuration,status:'active',revision:data.configuration.revision+1};return executionRecord(data.records.get(data.configuration.package_id),data.configuration);}
  if(method==='tools.configurations.read')return executionRecord(data.records.get(data.configuration.package_id),data.configuration);
  if(method==='tools.configurations.bind'){data.context.configuration_id=value.configuration_id;data.context.providers=[...value.providers];return {status:'bound',configuration_id:value.configuration_id};}
  if(method==='tools.configurations.grant')return {status:'granted',expires_at:Date.now()+600000};
  throw Error('Unexpected tool package fixture IPC '+method);
 };
 const invoke=async(method,value)=>{calls.push({method,data:structuredClone(value)});return override?override(method,value,standard,data):standard(method,value);};
 const bridge={studio:{invoke}};
 function load(file){
  file=path.resolve(file);if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);
  const require=name=>{if(name==='react')return {useState,useRef,useEffect};if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};if(name.endsWith('/i18n')||name==='./i18n')return {t:value=>value};if(name.endsWith('.css'))return {};if(name.startsWith('.')){const target=path.resolve(path.dirname(file),name);return load(['.ts','.tsx'].map(ext=>target+ext).find(candidate=>fs.existsSync(candidate))||target);}return new Proxy({},{get:(_target,key)=>String(key)});};
  new Function('require','module','exports','window','setTimeout','clearTimeout',compiled(file))(require,module,module.exports,bridge,(fn,delay)=>{const id=++timerSequence;timers.set(id,{fn,delay});return id;},id=>timers.delete(id));return module.exports;
 }
 const component=load(path.join(root,'frontend/features/tools/ToolPackagesPanel.tsx')).default;
 const all=node=>Array.isArray(node)?node.flatMap(all):node&&typeof node==='object'?[node,...all(node.props?.children)]:[];
 const text=node=>Array.isArray(node)?node.map(text).join(''):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);
 function find(predicate){const value=all(tree).find(predicate);if(!value)throw Error('Tool packages fixture node not found');return value;}
 function render(){cursor=0;dirty=false;tree=component(props);}
 async function flush(){for(let i=0;i<20;i++){while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));if(dirty&&!disposed)render();}}
 function click(label){const node=find(node=>node.type==='button'&&(node.props['data-testid']===label||text(node)===label));if(node.props.disabled)throw Error('Cannot activate disabled fixture button '+label);node.props.onClick();render();}
 function change(label,value){const node=find(node=>node.props?.['aria-label']===label);if(node.props.disabled)throw Error('Cannot change disabled fixture field '+label);node.props.onChange({target:{value}});render();}
 function resource(role,checked=true){const label=find(node=>node.type==='label'&&node.props.className==='tool-guidance-resource'&&text(node).startsWith(role+' · ')),node=all(label).find(node=>node.type==='input');if(node.props.disabled)throw Error('Cannot change disabled fixture resource');node.props.onChange({target:{checked}});render();}
 function update(values){Object.assign(props,values);render();}
 function tick(){const pending=[...timers.values()];timers.clear();for(const timer of pending)timer.fn();render();}
 function unmount(){disposed=true;hooks.forEach(hook=>hook?.cleanup?.());}
 render();return {props,data,calls,attachments,timers,flush,render,click,change,resource,update,tick,unmount,find,text,all:()=>all(tree),tree:()=>tree,load};
}
