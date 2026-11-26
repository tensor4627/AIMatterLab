import {fixtureControlModule} from './frontend-component-loader.mjs';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import * as modelProfiles from '../../contracts/agent/model-profiles.mjs';
import * as transcript from '../../contracts/agent/transcript-sanitizer.mjs';
export function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
export function experienceHarness({component,props:initial={},invoke:dispatch=async()=>({})}){
 const hooks=[],effects=[],calls=[],errors=[],configured=[],toasts=[],events=new Set(),modules=new Map();let cursor=0,dirty=false,disposed=false,tree,nextToastId=0;
 let props={provider:'compatible',embedded:true,onClose(){},onConfigured:()=>configured.push(true),onError:error=>errors.push(error),projectId:'project-a',clusterId:'cluster-a',scope:'project-a:cluster-a:1',roots:['~/runs','~/inputs'],enabled:true,...initial};
 const useState=initial=>{const i=cursor++;hooks[i]??={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{hooks[i].value=typeof value==='function'?value(hooks[i].value):value;dirty=true;}];};
 const useRef=value=>{const i=cursor++;return hooks[i]??(hooks[i]={current:value});};
 const useId=()=>{const i=cursor++;return 'fixture-field-'+i;};
 const useEffect=(fn,deps)=>{const i=cursor++,old=hooks[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j]))){hooks[i]={deps};effects.push(()=>{old?.cleanup?.();if(!disposed)hooks[i].cleanup=fn();});}};
 const invoke=(method,data)=>{calls.push({method,data});return dispatch(method,data);},window={studio:{invoke,onEvent:fn=>{events.add(fn);return()=>events.delete(fn);}}};
 function load(file){if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);const require=name=>{
  const control=fixtureControlModule(name);if(control)return control;
  if(name==='../../ui/Toast')return {useToast:()=>({show:options=>{const id=++nextToastId;toasts.push({...options,id});return id;},
   dismiss:id=>{const index=toasts.findIndex(toast=>toast.id===id);if(index>=0)toasts.splice(index,1);}})};
  if(name==='../../ui/ConfirmDialog')return {ConfirmDialog:'ConfirmDialog'};
  if(name==='react')return {useState,useRef,useEffect,useId};
   if(name.endsWith('.css'))return {};
   if(name==='../../../contracts/agent/model-profiles.mjs')return modelProfiles;
   if(name==='../../../contracts/agent/transcript-sanitizer.mjs')return transcript;
  if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
  if(name==='../../api/studio')return {invoke};
  if(name==='../../api/worker')return {api:(method,target,data)=>invoke('worker.request',{method,target,data})};
  if(name==='../../ui/i18n'||name==='./i18n')return {t:value=>value};
  if(name==='../diagnostics/DiagnosticNotice')return {InlineDiagnostic:'InlineDiagnostic'};
  if(name==='../../ui/Dialogs')return {Modal:'Modal',statusNames:{not_run:'未验证'}};
  if(name==='../../ui/Tooltip')return {default:'Tooltip',HelpTip:'HelpTip'};
  if(name.endsWith('/LoadingFeedback'))return {default:'LoadingFeedback',LoadingFeedback:'LoadingFeedback'};
  if(name==='lucide-react')return new Proxy({},{get:(_,key)=>key});
  if(name.startsWith('.')){const base=path.resolve(path.dirname(file),name),resolved=['.ts','.tsx','.mjs'].map(ext=>base+ext).find(candidate=>fs.existsSync(candidate));if(resolved)return load(resolved);}
  throw Error('Unexpected experience dependency '+name);
 };const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports','window',compiled)(require,module,module.exports,window);return module.exports;}
 const Component=load(path.resolve('frontend/features/'+(component==='ModelProviders'?'settings/ModelProviders':component==='ProviderLogin'?'settings/ProviderLogin':component==='CliRuntimeDialog'?'settings/CliRuntimeDialog':'cluster/ClusterFiles')+'.tsx')).default;
 const all=node=>Array.isArray(node)?node.flatMap(all):!node||typeof node!=='object'?[]:[node,...all(node.props?.children),...all(node.props?.action)];
 const text=node=>Array.isArray(node)?node.map(text).join(''):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);
 function render(next){if(next)props={...props,...next};cursor=0;dirty=false;tree=Component(props);}
 const find=predicate=>{const node=all(tree).find(predicate);if(!node)throw Error('Experience fixture node not found');return node;};
 const button=label=>find(node=>node.type==='button'&&text(node)===label);
 const byId=id=>find(node=>node.props?.['data-testid']===id);
 async function flush(){for(let i=0;i<8;i++){if(dirty&&!disposed)render();while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));}if(dirty&&!disposed)render();}
 function change(node,value){all(tree).find(item=>item.props?.onChangeCapture)?.props.onChangeCapture();node.props.onChange({target:{value}});render();}
 function unmount(){disposed=true;for(const hook of hooks)hook?.cleanup?.();}
 render();return {render,flush,find,button,byId,change,text:()=>text(tree),all:()=>all(tree),calls,errors,configured,events,toasts,unmount};
}
