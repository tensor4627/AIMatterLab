// Actual App source under a deterministic hook harness; children and IPC are fixtures.
import fs from 'node:fs';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
import * as taskWorkerBinding from '../../contracts/compute/task-worker-binding.mjs';
import * as shell from '../../frontend/app/workspace-shell.mjs';
import * as navigation from '../../frontend/app/workspace-navigation.mjs';
import * as workflowsOwner0 from "../../frontend/features/workflows/workflow-catalog.mjs";
import * as workflowsOwner1 from "../../contracts/workflows/plan.mjs";
const workflows={...workflowsOwner0,...workflowsOwner1};

import * as diagnostics from "../../frontend/features/diagnostics/ui-diagnostics.mjs";

import * as computeCommand from "../../frontend/features/compute/compute-connection-command.mjs";
import * as sshGuideQueue from "../../frontend/app/ssh-guide-queue.mjs";
import * as selectedServiceRecords from '../../frontend/features/runs/selected-service-records.mjs';

import {memoryStorage} from './agent-hooks.mjs';
import {loadConversationSelection} from './conversation-selection-hooks.mjs';
const source=fs.readFileSync(new URL('../../frontend/app/App.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const connectionUi={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync(new URL('../../frontend/features/compute/ssh-connection-types.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(connectionUi,connectionUi.exports);
const reviewSource=ts.createSourceFile('RunReview.tsx',fs.readFileSync(new URL('../../frontend/features/runs/RunReview.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const taskModuleSource=reviewSource.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='taskModule').getText(reviewSource).replace(/^export /,'');
const taskModule=new Function('t',ts.transpileModule(taskModuleSource,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+'; return taskModule;')(value=>value);
const navigationModules=Object.fromEntries(['frontend/features/workflows/useToolWorkflowNavigation.ts','frontend/api/tool-workflows.ts','frontend/api/compute-resources.ts','frontend/api/studio.ts'].map(file=>[file,ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText]));
// App tests explicitly acknowledge the child guide result; no automatic completion.
export async function completeComputeGuide(h,connected){const guide=h.find(node=>node.type==='./ComputeConnectionGuide');guide.props.onClose(connected);await h.flush();return guide.props;}
export function appWorkerHarness({override,storage=memoryStorage(),width=1440,managedResources=[]}={}){
 const hooks=[],pending=[],listeners=[],calls=[],settings={distribution:'Saved Ubuntu',workerRoot:'~/saved',workerPort:8767,theme:'dark',skillRoots:[]};let cursor=0,dirty=false,tree,disposed=false;
 const useState=initial=>{const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{const value=typeof next==='function'?next(hooks[index].value):next;if(!Object.is(value,hooks[index].value)){hooks[index].value=value;dirty=true;}}];};
 const useRef=initial=>{const index=cursor++;return hooks[index]??(hooks[index]={current:initial});};
 const useEffect=(fn,deps)=>{const index=cursor++,previous=hooks[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps?.[i]))){const record={deps,cleanup:previous?.cleanup,fn};hooks[index]=record;pending.push(()=>{record.cleanup?.();record.cleanup=fn();});}};
 const standard=async(method,data)=>{
  if(method==='compute.resource.status')return {schemaVersion:1,selectionId:null,kind:null,profileId:null,profileVersion:null,sessionId:null,status:'none',operator:'unknown',processStatus:'unknown',alive:null,agentReady:false,reason:null,authentication:'not_observed',managedRuns:false};
  if(method==='state')return {settings};
  if(['conversation.list','conversation.groups','task.list','workflow.list'].includes(method))return [];
  if(method==='worker.status')return {status:'connected',checkedAt:1};
  if(method==='worker.restore')return {status:'connected',...data,checkedAt:1};
  if(method==='conversation.select'&&data?.new===true)return {fresh:true};
  if(method==='worker.connect')return {};
  if(method==='settings')return {...settings,...data};
  if(method==='worker.request')return [];
  throw Error('Unexpected App fixture call '+method+' '+JSON.stringify(data));
 };
 const invoke=async(method,data)=>{calls.push({method,data});return override?override(method,data,standard):standard(method,data);};
 const conversationSelection=loadConversationSelection({react:{useState,useRef,useEffect},storage});
 const loadedNavigation=new Map();
 function loadNavigation(file){
  if(loadedNavigation.has(file))return loadedNavigation.get(file).exports;const module={exports:{}};loadedNavigation.set(file,module);
  new Function('require','module','exports','window','crypto',navigationModules[file])(name=>{
  if(name==='react')return {useState,useRef,useEffect};
   if(file==='frontend/features/workflows/useToolWorkflowNavigation.ts'&&name==='../../api/tool-workflows')return loadNavigation('frontend/api/tool-workflows.ts');
   if(['frontend/api/tool-workflows.ts','frontend/api/compute-resources.ts'].includes(file)&&name==='./studio')return loadNavigation('frontend/api/studio.ts');
   throw Error('Unexpected workflow-navigation dependency '+file+': '+name);
  },module,module.exports,window,{randomUUID});return module.exports;
 }
 const require=name=>{
  if(name.endsWith('/SoftwareUpdate'))return {useWorkspaceUpdate:()=>({state:{phase:'disabled'}})};
  if(name==='../features/compute/ssh-connection-types')return connectionUi.exports;
  if(name==='../../contracts/compute/task-worker-binding.mjs')return taskWorkerBinding;
  if(name==='../ui/lazy-panel')return {lazyPanel:(name)=>'./'+name};
  if(name==='../features/workflows/task-drafts')return {clearTaskDrafts:id=>calls.push({method:'fixture.clearTaskDrafts',data:{id}})};
  if(name==='./ssh-guide-queue.mjs')return sshGuideQueue;
  if(name==='../features/runs/selected-service-records.mjs')return selectedServiceRecords;
  if(name==='react')return {useState,useRef,useEffect};
  if(name==='../api/compute-resources')return loadNavigation('frontend/api/compute-resources.ts');
  if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
  if(name==="../features/compute/useManagedResources")return {useManagedResources:()=>({resources:managedResources,conversations:[],sources:[]})};
  if(name==="../features/conversations/ConversationResourceStatus")return {__esModule:true,default:'ConversationResourceStatus'};
  if(name==="../features/conversations/useConversationSelection")return conversationSelection;
  if(name==="../features/workflows/useToolWorkflowNavigation")return loadNavigation('frontend/features/workflows/useToolWorkflowNavigation.ts');
  if(name==="../features/runs/RunReview")return {__esModule:true,default:'./RunReview',taskModule};
  if(name==='lucide-react')return new Proxy({},{get:(_target,key)=>String(key)});
  if(name==='./workspace-shell.mjs')return shell;
  if(name==='./workspace-navigation.mjs')return navigation;
  if(["../features/workflows/workflow-catalog.mjs","../../contracts/workflows/plan.mjs"].includes(name))return workflows;
  if(["../features/diagnostics/ui-diagnostics.mjs"].includes(name))return diagnostics;
  if(["../features/compute/compute-connection-command.mjs"].includes(name))return computeCommand;
  if(name==="../../package.json")return {version:'source-fixture'};
  if(["../api/worker","../api/studio","../ui/presentation/paths","../ui/presentation/engines","../../api/worker"].includes(name))return {invoke,api:(method,target,data)=>invoke('worker.request',{method,target,data}),readWorkerStatus:()=>invoke('worker.status'),restoreWorker:owner=>invoke('worker.restore',typeof owner==='string'?{taskId:owner}:owner),engines:[],wslPath:value=>value};
  if(["../ui/i18n","../../ui/i18n"].includes(name))return {t:value=>value,tr:value=>value,setLanguage:()=>{}};
  return new Proxy({default:'./'+name.split('/').pop()},{get:(target,key)=>target[key]??String(key)});
 };
 const module={exports:{}},document={documentElement:{dataset:{},style:{setProperty(){}}},addEventListener(){},removeEventListener(){},querySelector(){return null;}};
 const window={innerWidth:width,dispatchEvent(){},addEventListener(){},removeEventListener(){},studio:{invoke,onEvent:fn=>{listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1);}}};
 new Function('require','module','exports','localStorage','window','document','crypto','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame',compiled)(require,module,module.exports,storage,window,document,{randomUUID},()=>1,()=>{},()=>1,()=>{});
 function render(){cursor=0;dirty=false;tree=module.exports.default();}
 async function flush(){for(let i=0;i<20;i++){while(pending.length)pending.shift()();await new Promise(resolve=>setImmediate(resolve));if(dirty&&!disposed)render();}}
 function all(node){if(Array.isArray(node))return node.flatMap(all);if(!node||typeof node!=='object')return [];return [node,...all(node.props?.children)];}
 function find(predicate){const node=all(tree).find(predicate);if(!node)throw Error('App fixture node not found');return node;}
 function text(node){if(Array.isArray(node))return node.map(text).join('');if(node===null||node===undefined||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);return text(node.props?.children);}
 function emit(event){for(const listener of [...listeners])listener(event);}
 // Existing worker-recovery cases exercise the unchanged task-specific review entry.
 function connect(){find(node=>node.type==='./Agent').props.onReviewWorker();render();}
 function openSettings(){find(node=>node.type==='button'&&node.props?.['aria-label']==='设置').props.onClick();render();return find(node=>node.type==='./SettingsPage').props;}
 function unmount(){disposed=true;for(const hook of hooks)hook?.cleanup?.();}
 function replayStrictEffects(){while(pending.length)pending.shift()();for(const hook of hooks)if(hook?.fn)hook.cleanup?.();for(const hook of hooks)if(hook?.fn)hook.cleanup=hook.fn();}
 render();return {calls,settings,find,text,flush,emit,connect,openSettings,unmount,storage,render,replayStrictEffects};
}
