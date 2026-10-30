// Actual DeploymentPanel hooks with controlled promises; no worker/model/UI process.
import fs from 'node:fs';
import ts from 'typescript';
import * as deployment from '../../shared/deployment.mjs';
import * as drafts from '../../shared/deployment-draft.mjs';
import * as scienceDrafts from '../../shared/draft-outbox.mjs';
import * as authorization from '../../shared/deployment-authorization.mjs';
import * as setup from '../../src/project-setup-defaults.mjs';
import * as diagnostics from '../../shared/ui-diagnostics.mjs';
import {memoryStorage} from './agent-hooks.mjs';
const source=fs.readFileSync(new URL('../../src/DeploymentPanel.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
export function deploymentFixture(id='workflow-A'){
 const config={target:'local',projectId:'project',targetId:'env-A',inputSource:'local',directoryName:'run-'+id,maxSeconds:60,gpu:0,resources:{cpus:1,gpus:1,memory_mb:4096,queue:'',account:''}},run={id:'run-'+id,engine:'pydyn.md',status:'draft',snapshots:[{name:'run.py',sha256:'s'.repeat(64),size:42}]};
 const task={id,name:'Readable '+id,updatedAt:1,workflowVersion:2,parameterRevision:3,parameters:{engine:'pydyn.md'},review:{status:'ready',parameterRevision:3},artifacts:[{id:run.id,kind:'run'}],deployment:{revision:2,config,prepared:{artifactId:run.id,parameterRevision:3,deploymentRevision:2}}};task.deployment.prepared.inputIdentity=deployment.snapshotIdentity(task,run);return {task,run};
}
export function deploymentHarness({initial=deploymentFixture(),override,properties={},storage=memoryStorage(),journal=diagnostics.createDiagnosticJournal()}={}){
 const hooks=[],effects=[],calls=[],externalErrors=[],servers=new Map([[initial.task.id,structuredClone(initial.task)]]),runs=new Map([[initial.run.id,structuredClone(initial.run)]]);let cursor=0,dirty=false,tree,disposed=false,refreshes=0;
 const environments=[{id:'env-A',name:'Research environment A',executables:{python:'/fixture/A'}},{id:'env-B',name:'Research environment B',executables:{python:'/fixture/B'}}],project={id:'project',name:'Compute project',policy:{engines:['pydyn.md'],environments:['env-A','env-B'],gpus:[0],max_seconds:3600}};
 const props={task:structuredClone(initial.task),worker:true,projects:[project],environments,onTask(){},onRun(){},onError:error=>externalErrors.push(error),onRefresh:async()=>{refreshes++;if(servers.has(props.task.id)){props.task=structuredClone(servers.get(props.task.id));dirty=true;}}};
 Object.assign(props,properties);
 const useState=initial=>{const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,next=>{const value=typeof next==='function'?next(hooks[i].value):next;if(!Object.is(value,hooks[i].value)){hooks[i].value=value;dirty=true;}}];};
 const useRef=initial=>{const i=cursor++;return hooks[i]??(hooks[i]={current:initial});};
 const useMemo=(fn,deps)=>{const i=cursor++;if(!hooks[i]||deps.some((v,j)=>!Object.is(v,hooks[i].deps[j])))hooks[i]={value:fn(),deps};return hooks[i].value;};
 const useEffect=(fn,deps)=>{const i=cursor++,previous=hooks[i];if(!previous||!deps||deps.some((v,j)=>!Object.is(v,previous.deps?.[j]))){const value={deps,cleanup:previous?.cleanup};hooks[i]=value;effects.push(()=>{value.cleanup?.();value.cleanup=fn();});}};
 const standard=async(method,data)=>{
  if(method==='task.deployment.context')return {taskId:data.taskId,projects:[project],environments,clusters:[]};
  if(method==='task.deployment.draft'){const task=structuredClone(servers.get(data.taskId));task.deploymentDraft={revision:data.expectedRevision+1,config:structuredClone(data.value),lastMutationId:data.mutationId};servers.set(task.id,task);return structuredClone(task);}
  if(method==='task.deployment.save'){const task=structuredClone(servers.get(data.taskId));task.deployment={...task.deployment,revision:task.deployment.revision+(drafts.sameDeploymentConfig(task.deployment.config,data.value)?0:1),config:structuredClone(data.value)};servers.set(task.id,task);return structuredClone(task);}
  if(method==='task.deployment.prepare')return structuredClone(runs.get(servers.get(data.taskId).deployment.prepared.artifactId));
  if(method==='task.linkRun')return structuredClone(servers.get(data.taskId));
  if(method==='worker.request'&&data.target==='/api/run/status')return structuredClone(runs.get(data.data.run_id));
  throw Error('Unexpected deployment fixture request '+method);
 };
 const invoke=async(method,data)=>{calls.push({method,data});return override?override(method,data,standard):standard(method,data);};
 const require=name=>{
  if(name==='react')return {useState,useRef,useEffect,useMemo};
  if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name==='../shared/ui-diagnostics.mjs')return {...diagnostics,deploymentDiagnosticJournal:journal};
  if(name==='./DiagnosticNotice')return {DeploymentDiagnostics:'DeploymentDiagnostics',InlineDiagnostic:'InlineDiagnostic'};
  if(name==='./types')return {invoke,api:(method,target,data)=>invoke('worker.request',{method,target,data}),engines:[['pydyn.md','PyDyn MD']]};
  if(name==='./deployment-client')return {deploymentApi:{read:taskId=>invoke('task.deployment.context',{taskId}),saveDraft:data=>invoke('task.deployment.draft',data)}};
  if(name==='../shared/deployment.mjs')return deployment;
  if(name==='../shared/deployment-draft.mjs')return drafts;
  if(name==='../shared/draft-outbox.mjs')return scienceDrafts;
  if(name==='../shared/deployment-authorization.mjs')return authorization;
  if(name==='./project-setup-defaults.mjs')return setup;
  if(name==='./useLocalReviewStatus')return {useLocalReviewStatus:()=>null,currentLocalReview:()=>false};
  if(name==='./useConsumerTargetStatus')return {useConsumerTargetStatus:()=>false};
  if(name==='./pygas-local-draft')return {useTaskPygasDirty:()=>false,isTaskPygasDirty:()=>false};
  if(name==='./i18n')return {t:value=>value};
  return new Proxy({},{get:(_target,key)=>String(key)});
 };
 const module={exports:{}};new Function('require','module','exports','localStorage',compiled)(require,module,module.exports,storage);
 function render(){cursor=0;dirty=false;tree=module.exports.default(props);}
 async function flush(){for(let i=0;i<20;i++){while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));if(dirty&&!disposed)render();}}
 function all(node){if(Array.isArray(node))return node.flatMap(all);return !node||typeof node!=='object'?[]:[node,...all(node.props?.children)];}
 function find(predicate){const node=all(tree).find(predicate);if(!node)throw Error('Deployment fixture node not found');return node;}
 function text(node){if(Array.isArray(node))return node.map(text).join('');return node===null||node===undefined||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);}
 function click(id){const node=find(node=>node.props?.['data-testid']===id);if(node.props.disabled)throw Error('Cannot activate disabled fixture button '+id);node.props.onClick();render();}
 function target(id){find(node=>node.type==='select'&&node.props['aria-label']==='部署环境').props.onChange({target:{value:id}});render();}
 function review(){const node=find(node=>node.props?.['data-testid']==='review-input-snapshots');if(node.props.disabled)throw Error('Cannot activate disabled fixture input review');node.props.onChange({target:{checked:true}});render();}
 function setTask(task,run){servers.set(task.id,structuredClone(task));if(run)runs.set(run.id,structuredClone(run));props.task=structuredClone(task);render();}
 function update(value){Object.assign(props,value);render();}
 function unmount(){disposed=true;for(const hook of hooks)hook?.cleanup?.();}
 render();return {flush,click,target,review,setTask,update,unmount,find,text,props,calls,journal,storage,servers,runs,externalErrors,refreshes:()=>refreshes,diagnosticProps:()=>find(node=>node.type==='DeploymentDiagnostics').props};
}
