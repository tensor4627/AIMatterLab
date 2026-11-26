import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {deferred} from './agent-hooks.mjs';

const compiled=ts.transpileModule(fs.readFileSync(new URL('../../frontend/features/settings/SettingsPage.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
export function settingsPageHarness(extraProps={}){
 const hooks=[],effects=[],calls=[],saved=[],errors=[],toasts=[],gate=deferred();let cursor=0,tree,dirty=false;
 let settings={distribution:'Fixture Ubuntu',workerRoot:'~/fixture',workerPort:8767,codexPath:'codex',cwd:'',skillRoots:[],theme:'dark'};
 const useState=initial=>{const i=cursor++;hooks[i]??={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{hooks[i].value=typeof value==='function'?value(hooks[i].value):value;dirty=true;}];};
 const useRef=value=>{const i=cursor++;return hooks[i]??(hooks[i]={current:value});};
 const useEffect=(fn,deps)=>{const i=cursor++;if(!hooks[i]){hooks[i]={};effects.push(()=>hooks[i].cleanup=fn());}};
 const module={exports:{}};
 new Function('require','module','exports',compiled)(name=>{
  if(name==='react')return {useState,useRef,useEffect};
  if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name==='../../api/studio')return {invoke:(method,data)=>{calls.push({method,data});return gate.promise;}};
  if(name==='../../ui/i18n')return {t:value=>value,setLanguage(){}};
  if(name==='../../ui/Button')return {default:'button'};
  if(name==='../../ui/Toast')return {useToast:()=>({show:options=>toasts.push(options)})};
  if(name==='./appearance-defaults')return {recommendedMinimumFontSize:13};
  return new Proxy({default:name},{get:(value,key)=>value[key]??key});
 },module,module.exports);
 function render(){cursor=0;dirty=false;tree=module.exports.default({settings,onChange:value=>{settings=value;dirty=true;},onClose(){},onSaved:value=>saved.push(value),onError:value=>errors.push(value),...extraProps});}
 const all=node=>Array.isArray(node)?node.flatMap(all):!node||typeof node!=='object'?[]:[node,...all(node.props?.children)];
 const text=node=>Array.isArray(node)?node.map(text).join(''):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);
 const find=predicate=>{const value=all(tree).find(predicate);assert(value,'Settings fixture node not found');return value;};
 async function flush(){for(let i=0;i<5;i++){while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}}
 function unmount(){for(const hook of hooks)hook?.cleanup?.();}
 render();return {find,text,flush,unmount,calls,saved,errors,toasts,gate,get settings(){return settings;},save:()=>find(node=>node.type==='button'&&text(node)==='保存设置').props.onClick(),external:value=>{settings={...settings,...value};render();}};
}

