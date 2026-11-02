// Actual App source under a deterministic hook harness; children and IPC are fixtures.
import fs from 'node:fs';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
import * as shell from '../../src/workspace-shell.mjs';
import * as navigation from '../../src/workspace-navigation.mjs';
import * as workflows from '../../shared/workflows.mjs';
import * as diagnostics from '../../shared/ui-diagnostics.mjs';
import * as computeCommand from '../../shared/compute-connection-command.mjs';
import {memoryStorage} from './agent-hooks.mjs';
const source=fs.readFileSync(new URL('../../src/App.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
// App tests explicitly acknowledge the child guide result; no automatic completion.
export async function completeComputeGuide(h,connected){const guide=h.find(node=>node.type==='./ComputeConnectionGuide');guide.props.onClose(connected);await h.flush();return guide.props;}
export function appWorkerHarness({override,storage=memoryStorage(),width=1440}={}){
 const hooks=[],pending=[],listeners=[],calls=[],settings={distribution:'Saved Ubuntu',workerRoot:'~/saved',workerPort:8767,theme:'dark',skillRoots:[]};let cursor=0,dirty=false,tree,disposed=false;
 const useState=initial=>{const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{const value=typeof next==='function'?next(hooks[index].value):next;if(!Object.is(value,hooks[index].value)){hooks[index].value=value;dirty=true;}}];};
 const useRef=initial=>{const index=cursor++;return hooks[index]??(hooks[index]={current:initial});};
 const useEffect=(fn,deps)=>{const index=cursor++,previous=hooks[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps?.[i]))){const record={deps,cleanup:previous?.cleanup};hooks[index]=record;pending.push(()=>{record.cleanup?.();record.cleanup=fn();});}};
 const standard=async(method,data)=>{
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
 const require=name=>{
  if(name==='react')return {useState,useRef,useEffect};
  if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
  if(name==='lucide-react')return new Proxy({},{get:(_target,key)=>String(key)});
  if(name==='./workspace-shell.mjs')return shell;
  if(name==='./workspace-navigation.mjs')return navigation;
  if(name==='../shared/workflows.mjs')return workflows;
  if(name==='../shared/ui-diagnostics.mjs')return diagnostics;
  if(name==='../shared/compute-connection-command.mjs')return computeCommand;
  if(name==='../package.json')return {version:'source-fixture'};
  if(name==='./types')return {invoke,api:(method,target,data)=>invoke('worker.request',{method,target,data}),readWorkerStatus:()=>invoke('worker.status'),restoreWorker:owner=>invoke('worker.restore',typeof owner==='string'?{taskId:owner}:owner),engines:[],wslPath:value=>value};
  if(name==='./i18n')return {t:value=>value,tr:value=>value,setLanguage:()=>{}};
  return new Proxy({default:name},{get:(target,key)=>target[key]??String(key)});
 };
 const module={exports:{}},document={documentElement:{dataset:{},style:{setProperty(){}}},addEventListener(){},removeEventListener(){},querySelector(){return null;}};
 const window={innerWidth:width,dispatchEvent(){},addEventListener(){},removeEventListener(){},studio:{onEvent:fn=>{listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1);}}};
 new Function('require','module','exports','localStorage','window','document','crypto','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame',compiled)(require,module,module.exports,storage,window,document,{randomUUID},()=>1,()=>{},()=>1,()=>{});
 function render(){cursor=0;dirty=false;tree=module.exports.default();}
 async function flush(){for(let i=0;i<20;i++){while(pending.length)pending.shift()();await new Promise(resolve=>setImmediate(resolve));if(dirty&&!disposed)render();}}
 function all(node){if(Array.isArray(node))return node.flatMap(all);if(!node||typeof node!=='object')return [];return [node,...all(node.props?.children)];}
 function find(predicate){const node=all(tree).find(predicate);if(!node)throw Error('App fixture node not found');return node;}
 function text(node){if(Array.isArray(node))return node.map(text).join('');if(node===null||node===undefined||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);return text(node.props?.children);}
 function emit(event){for(const listener of [...listeners])listener(event);}
 function connect(){find(node=>node.props?.['data-testid']==='unified-compute-entry').props.onClick();render();find(node=>node.type==='./ComputeConnectionChooser').props.onLocal();}
 function openSettings(){find(node=>node.type==='button'&&node.props?.['aria-label']==='设置').props.onClick();render();return find(node=>node.type==='./SettingsPage').props;}
 function unmount(){disposed=true;for(const hook of hooks)hook?.cleanup?.();}
 render();return {calls,settings,find,text,flush,emit,connect,openSettings,unmount,storage,render};
}
