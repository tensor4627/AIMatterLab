// Execute the production conversation hook with controlled React state and shell ports.
import fs from 'node:fs';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';

const sources=new Map(['useConversationSelection','selection-preference'].map(name=>[name,ts.transpileModule(fs.readFileSync(new URL('../../frontend/features/conversations/'+name+'.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText]));
export function loadConversationSelection({react,storage,crypto={randomUUID}}){
 const modules=new Map();
 function load(name){
  if(modules.has(name))return modules.get(name).exports;
  if(!sources.has(name))throw Error('Unexpected conversation hook dependency '+name);
  const module={exports:{}};modules.set(name,module);
  const require=specifier=>specifier==='react'?react:load(specifier.replace(/^\.\//,''));
  new Function('require','module','exports','localStorage','crypto',sources.get(name))(require,module,module.exports,storage,crypto);
  return module.exports;
 }
 return load('useConversationSelection');
}

export function conversationSelectionHarness({storage,ports:initialPorts={}}={}){
 const values=new Map();storage??={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const hooks=[],calls=[],errors=[],mounted={current:true};let cursor=0,selection,nonce=0;
 const useState=initial=>{const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};return [hooks[index].value,next=>{hooks[index].value=typeof next==='function'?next(hooks[index].value):next;}];};
 const useRef=initial=>{const index=cursor++;return hooks[index]??(hooks[index]={current:initial});};
 const module=loadConversationSelection({react:{useState,useRef},storage,crypto:{randomUUID:()=> 'selection-nonce-'+(++nonce)}});
 let ports={mounted,settingsReady:{current:Promise.resolve()},editorDirty:false,confirmReplace:()=>true,
  invoke:async(method,data)=>{calls.push(['invoke',method,data]);throw Error('Unexpected conversation call '+method);},
  beforeSelection:()=>calls.push(['beforeSelection']),clearIntent:()=>calls.push(['clearIntent']),beginWorkerGate:()=>calls.push(['beginWorkerGate']),
  observeWorker:async taskId=>{calls.push(['observeWorker',taskId]);return true;},
  onSelected:value=>calls.push(['onSelected',value]),onFreshSelected:()=>calls.push(['onFreshSelected']),
  onSelectionError:error=>errors.push(error),onError:error=>errors.push(error),...initialPorts};
 function render(changes={}){ports={...ports,...changes};cursor=0;selection=module.useConversationSelection(ports);return selection;}
 render();return {current:()=>selection,render,calls,errors,storage,mounted,unmount:()=>{mounted.current=false;}};
}
