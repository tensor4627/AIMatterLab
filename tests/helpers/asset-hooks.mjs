import {fixtureControlModule,fixtureStateNode,fixtureStates} from './frontend-component-loader.mjs';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
export function assetHarness({component='AssetInspector',override,props:initialProps={}}={}){
 const hooks=[],effects=[],calls=[],errors=[],saved=[],toasts=[];let cursor=0,dirty=false,disposed=false,tree;
 let props={worker:true,workerScope:'worker-a:1',projectId:'project-a',environments:[{id:'env-a',name:'Environment A'},{id:'env-b',name:'Environment B'}],onSaved:()=>saved.push(true),onError:error=>errors.push(error),...initialProps};
 const useState=initial=>{const index=cursor++;hooks[index]??={value:typeof initial==='function'?initial():initial};return [hooks[index].value,value=>{hooks[index].value=typeof value==='function'?value(hooks[index].value):value;dirty=true;}];};
 const useRef=value=>{const index=cursor++;return hooks[index]??(hooks[index]={current:value});};
 const useEffect=(fn,deps)=>{const index=cursor++,previous=hooks[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i]))){hooks[index]={deps};effects.push(()=>{previous?.cleanup?.();if(!disposed)hooks[index].cleanup=fn();});}};
 const react={useState,useRef,useEffect},modules=new Map();
 const invoke=(method,data)=>{const call={method,data};calls.push(call);return override?override(call):Promise.resolve({});};
 function load(file){
  if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);
  const require=name=>{
   if(name==='../../ui/States')return fixtureStates;
   if(name==='../../ui/Toast')return {useToast:()=>({show:value=>toasts.push(value)})};
   const control=fixtureControlModule(name);if(control)return control;
   if(name==='react')return react;
   if(name.endsWith('/LoadingFeedback'))return {default:'LoadingFeedback',LoadingFeedback:'LoadingFeedback'};
   if(name==='react/jsx-runtime')return {jsx:fixtureStateNode,jsxs:fixtureStateNode,Fragment:'fragment'};
   if(name==='../../api/worker')return {api:(method,target,data)=>invoke('worker.request',{method,target,data})};
   if(name==='../../api/studio')return {invoke};
   if(name==='../../ui/i18n')return {t:value=>value};
   if(name==='../../ui/widgets')return {Structure:'Structure'};
   if(name==='../../ui/Tooltip')return {default:'Tooltip'};
   if(name==='../../ui/presentation/paths')return {wslPath:value=>value};
   if(name==='lucide-react')return {Folder:'Folder'};
   if(name.endsWith('.css'))return {};
   if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name+'.ts'));
   throw Error('Unexpected asset test dependency '+name);
  };
  const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',compiled)(require,module,module.exports);return module.exports;
 }
 const file=component.startsWith('MaterialsProject')?'MaterialsProject':component;
 const module=load(path.resolve('frontend/features/assets/'+file+'.tsx')),Component=module[component]??module.default;
 function render(next){if(next)props={...props,...next};cursor=0;dirty=false;tree=Component(props);}
 const all=node=>Array.isArray(node)?node.flatMap(all):!node||typeof node!=='object'?[]:[node,...all(node.props?.children)];
 const text=node=>Array.isArray(node)?node.map(text).join(''):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);
 const find=predicate=>{const found=all(tree).find(predicate);if(!found)throw Error('Asset fixture node not found');return found;};
 const byId=id=>find(node=>node.props?.['data-testid']===id);
 async function flush(){for(let i=0;i<8;i++){while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));if(dirty&&!disposed)render();}}
 function unmount(){disposed=true;for(const hook of hooks)hook?.cleanup?.();}
 render();return {render,flush,find,byId,text,all:()=>all(tree),calls,errors,saved,toasts,unmount,change(id,value){byId(id).props.onChange({target:{value}});render();}};
}
