// Shared execution mechanics for AIMatterLab's two tool-panel component fixtures.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const sources=new Map();
function compiled(file){if(!sources.has(file))sources.set(file,ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText);return sources.get(file);}

export function toolPanelRuntime({file,props,bridge,flushCycles,external}){
 const hooks=[],effects=[],timers=new Map(),modules=new Map();let cursor=0,dirty=false,tree,disposed=false,timerSequence=0;
 const useState=initial=>{const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{const value=typeof next==='function'?next(hooks[index].value):next;if(!Object.is(value,hooks[index].value)){hooks[index].value=value;dirty=true;}}];};
 const useRef=initial=>{const index=cursor++;return hooks[index]??(hooks[index]={current:initial});};
 const useEffect=(fn,deps)=>{const index=cursor++,old=hooks[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps?.[i]))){const record={deps,cleanup:old?.cleanup};hooks[index]=record;effects.push(()=>{record.cleanup?.();record.cleanup=fn();});}};
 function load(file){
  if(file.endsWith('.json'))return {default:JSON.parse(fs.readFileSync(file,'utf8'))};
  file=path.resolve(file);if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);
  const require=name=>{if(name==='react')return {useState,useRef,useEffect};if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};if(name.endsWith('/i18n')||name==='./i18n')return {t:value=>value};if(name.endsWith('.css'))return {};if(name.startsWith('.')){const target=path.resolve(path.dirname(file),name);return load(['.ts','.tsx'].map(ext=>target+ext).find(candidate=>fs.existsSync(candidate))||target);}return external(name);};
  new Function('require','module','exports','window','setTimeout','clearTimeout',compiled(file))(require,module,module.exports,bridge,(fn,delay)=>{const id=++timerSequence;timers.set(id,{fn,delay});return id;},id=>timers.delete(id));return module.exports;
 }
 const component=load(file).default;
 const nodes=node=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[];
 const text=node=>Array.isArray(node)?node.map(text).join(''):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);
 function find(predicate){const node=nodes(tree).find(predicate);if(!node)throw Error('Panel fixture node not found');return node;}
 function render(){cursor=0;dirty=false;tree=component(props);}
 async function flush(){for(let i=0;i<flushCycles;i++){while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));if(dirty&&!disposed)render();}}
 function click(label){const node=find(node=>node.type==='button'&&(node.props['data-testid']===label||text(node)===label));if(node.props.disabled)throw Error('Cannot activate disabled fixture button '+label);node.props.onClick();render();}
 function change(label,value){const node=find(node=>node.props?.['aria-label']===label);if(node.props.disabled)throw Error('Cannot change disabled fixture field '+label);node.props.onChange({target:{value}});render();}
 function update(values){Object.assign(props,values);render();}
 function tick(){const pending=[...timers.values()];timers.clear();for(const timer of pending)timer.fn();render();}
 function unmount(){disposed=true;hooks.forEach(hook=>hook?.cleanup?.());}
 render();return {timers,flush,render,click,change,update,tick,unmount,find,text,nodes,all:()=>nodes(tree),tree:()=>tree,load};
}
