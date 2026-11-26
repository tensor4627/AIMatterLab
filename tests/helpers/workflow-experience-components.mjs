import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import assert from 'node:assert/strict';
import * as catalog from '../../frontend/features/workflows/workflow-catalog.mjs';
import * as fields from '../../contracts/workflows/task-fields.mjs';
import * as groups from '../../frontend/ui/task-fields.mjs';
import {fixtureControlModule,fixtureDisclosure,fixtureNotice,loadFrontendI18n} from './frontend-component-loader.mjs';

// Executes current component sources and their session store with deterministic
// hooks; DOM/native interaction is covered separately by the browser cases.
export function workflowExperienceEnvironment(invoke=async()=>{throw Error('Unexpected IPC');}){
 const modules=new Map();let active;
 const toasts=[],dismissedToasts=new Set();
 const toast={show:options=>toasts.push(options),dismiss:id=>dismissedToasts.add(id)};
 const storage=Object.create(null);Object.defineProperties(storage,{getItem:{value:key=>storage[key]??null},setItem:{value:(key,value)=>{storage[key]=String(value);}},removeItem:{value:key=>{delete storage[key];}},key:{value:index=>Object.keys(storage)[index]??null},length:{get:()=>Object.keys(storage).length}});
 const window={addEventListener(){},removeEventListener(){},studio:{onEvent:()=>()=>{}}};
 const react={useState:initial=>{const h=active,i=h.cursor++;h.hooks[i]??={value:typeof initial==='function'?initial():initial};return [h.hooks[i].value,next=>{const value=typeof next==='function'?next(h.hooks[i].value):next;if(!Object.is(value,h.hooks[i].value)){h.hooks[i].value=value;h.dirty=true;}}];},useRef:initial=>{const h=active,i=h.cursor++;return h.hooks[i]??(h.hooks[i]={current:initial});},useEffect:(fn,deps)=>{const h=active,i=h.cursor++,previous=h.hooks[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps?.[index]))){const item={deps,cleanup:previous?.cleanup};h.hooks[i]=item;h.effects.push(()=>{item.cleanup?.();item.cleanup=fn();});}},useSyncExternalStore:(subscribe,snapshot)=>{const h=active;react.useEffect(()=>subscribe(()=>{h.dirty=true;}),[subscribe]);return snapshot();}};
 const field=({children})=>children({id:'fixture-field'});
 const bar=({status,children,...props})=>({type:'div',props:{...props,children:[status,children]}});
 const create=(type,props)=>[fixtureDisclosure,fixtureNotice,field,bar].includes(type)?type(props):({type,props});
 const jsx={jsx:create,jsxs:create,Fragment:'Fragment'};
 const messages=loadFrontendI18n(storage);
 function load(file){const filename=path.resolve(file);if(modules.has(filename))return modules.get(filename).exports;const module={exports:{}};modules.set(filename,module);const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const require=name=>{
   if(name.endsWith('/Field'))return {default:field};
   if(name.endsWith('/ActionBar'))return {default:bar};
   if(name.endsWith('/Disclosure'))return {default:fixtureDisclosure};
   if(name.endsWith('/Notice'))return {default:fixtureNotice};
   if(name.endsWith('/Toast'))return {useToast:()=>toast,UNDO_TOAST_DURATION:8000};
   const control=fixtureControlModule(name);if(control)return control;
   if(name==='react')return react;if(name==='react/jsx-runtime')return jsx;if(name==='lucide-react')return new Proxy({},{get:(_target,key)=>key});
   if(name.endsWith('/studio'))return {invoke};if(name.endsWith('/i18n'))return messages;if(name.endsWith('workflow-catalog.mjs'))return catalog;
   if(name.endsWith('contracts/workflows/task-fields.mjs'))return fields;if(name.endsWith('ui/task-fields.mjs'))return groups;
   if(name.endsWith('useLocalReviewStatus'))return {useLocalReviewStatus:()=>({phase:'resolved',value:null}),currentLocalReview:()=>false,localReviewNotice:()=>null};
   if(name.endsWith('PygasTaskComposer'))return load(path.resolve(path.dirname(filename),name+'.tsx'));
   if(name.endsWith('CustomCvNumericScope'))return {default:'CustomCvNumericScope',numericScopeCurrent:()=>false};
   if(name.endsWith('ParameterFields'))return {ParameterFields:'ParameterFields',GroupedParameterFields:'GroupedParameterFields'};
   if(name.startsWith('.')&&name.endsWith('.json'))return {default:JSON.parse(fs.readFileSync(path.resolve(path.dirname(filename),name),'utf8'))};
   if(name.startsWith('.')){const candidate=path.resolve(path.dirname(filename),name.endsWith('.mjs')?name:name+'.ts');if(fs.existsSync(candidate))return load(candidate);}
   return {default:name};
  };
  new Function('require','module','exports','localStorage','window',compiled)(require,module,module.exports,storage,window);return module.exports;
 }
 const all=node=>Array.isArray(node)?node.flatMap(all):!node||typeof node!=='object'?[]:[node,...all(node.props?.children)];
 const text=node=>Array.isArray(node)?node.map(text).join(''):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);
 function mount(file,props,name='default'){
  const Component=load(file)[name],h={hooks:[],effects:[],cursor:0,dirty:true,tree:null,props,disposed:false};
  function render(){active=h;h.cursor=0;h.dirty=false;h.tree=Component(h.props);active=null;}
  const find=predicate=>{const node=all(h.tree).find(predicate);assert(node,'fixture target exists');return node;};
  async function flush(){for(let i=0;i<15;i++){while(h.effects.length)h.effects.shift()();await new Promise(resolve=>setImmediate(resolve));if(h.dirty&&!h.disposed)render();}}
  function unmount(){h.disposed=true;for(const hook of h.hooks)hook?.cleanup?.();}
  render();return {flush,unmount,find,text,render,props:patch=>{h.props={...h.props,...patch};render();},button:label=>find(node=>node.type==='button'&&text(node)===label),id:id=>find(node=>node.props?.['data-testid']===id),nodes:()=>all(h.tree)};
 }
 return {mount,load,storage,toasts,dismissedToasts};
}
export function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
