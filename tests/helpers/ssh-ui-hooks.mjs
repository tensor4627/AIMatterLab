import fs from 'node:fs';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const helper={exports:{}};new Function('module','exports',compile(new URL('../../frontend/features/compute/ssh-connection-types.ts',import.meta.url)))(helper,helper.exports);
const presentation={exports:{}};new Function('module','exports',compile(new URL('../../frontend/features/terminal/ssh-service-presentation.ts',import.meta.url)))(presentation,presentation.exports);
export function sshUiHarness(file,{props={},invoke}={}){
 const hooks=[],effects=[],calls=[],events=[],errors=[],timers=new Map();let nextTimer=0,cursor=0,dirty=false,disposed=false,tree,currentProps=props;
 const useState=initial=>{const id=cursor++;hooks[id]??={value:typeof initial==='function'?initial():initial};return [hooks[id].value,next=>{const value=typeof next==='function'?next(hooks[id].value):next;if(!Object.is(value,hooks[id].value)){hooks[id].value=value;dirty=true;}}];};
 const useRef=initial=>{const id=cursor++;return hooks[id]??={current:initial};};
 const useEffect=(fn,deps)=>{const id=cursor++,old=hooks[id];if(!old||!deps||deps.some((value,index)=>!Object.is(value,old.deps[index]))){const entry={deps,cleanup:old?.cleanup};hooks[id]=entry;effects.push(()=>{entry.cleanup?.();entry.cleanup=fn();});}};
 const jsx=(type,props)=>({type,props}),module={exports:{}};
 const call=async(method,data)=>{calls.push({method,data});return invoke(method,data);};
 const require=name=>{
  if(name.endsWith('ResourceWorkspaceReview'))return {default:'ResourceWorkspaceReview',sameWorkspaceTarget:(a,b)=>['connectionId','profileId','profileVersion'].every(key=>a[key]===b[key]),previewResourceWorkspace:async({connectionId,profileId,profileVersion})=>{
    const ref={connectionId,profileId,profileVersion};calls.push({method:'compute.resourceWorkspace.preview',data:ref});
    return currentProps.workspacePreview||{...ref,status:'confirmed',account:'worker',hostname:'fixture',root:'/fixture/AIMatterLab'};
  }};
  if(name==='../../api/compute-resources')return {managedSshServices:{status:async data=>{
    calls.push({method:'compute.managed.serviceStatus',data});return currentProps.managedService||invoke('compute.sshService.status',{connectionId:data.connectionId});
  }}};
  return name.endsWith('useManagedResources')?{useManagedResources:()=>currentProps.managed||{resources:[],conversations:[],sources:[]}}:name==='react'?{useState,useRef,useEffect}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='../../api/studio'?{invoke:call}:name.endsWith('ssh-connection-types')?helper.exports:name.endsWith('ssh-service-presentation')?presentation.exports:name==='../../ui/i18n'?{t:value=>value}:new Proxy({},{get:(_target,key)=>String(key)});
 };
 new Function('require','module','exports','window','crypto','setInterval','clearInterval',compile(file))(require,module,module.exports,{confirm:()=>true,studio:{onEvent:fn=>{events.push(fn);return()=>events.splice(events.indexOf(fn),1);}}},{randomUUID},(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},id=>timers.delete(id));
 const all=node=>Array.isArray(node)?node.flatMap(all):node&&typeof node==='object'?[node,...all(node.props?.children)]:[];
 const find=predicate=>all(tree).find(predicate),id=value=>{const node=find(node=>node.props?.['data-testid']===value);if(!node)throw Error('Missing UI node '+value);return node;};
 function render(next={}){currentProps={onError:error=>errors.push(String(error)),...currentProps,...next};cursor=0;dirty=false;tree=module.exports.default(currentProps);}
 async function flush(){for(let index=0;index<15;index++){while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));if(dirty&&!disposed)render();}}
 render();return {calls,errors,id,find,all:()=>all(tree),render,flush,tick:async ms=>{for(const timer of [...timers.values()])if(ms===undefined||timer.ms===ms)timer.fn();await flush();},click:name=>{id(name).props.onClick();render();},change:(name,value)=>{id(name).props.onChange({target:{value}});render();},event:event=>events.forEach(fn=>fn(event)),unmount:()=>{disposed=true;for(const hook of hooks)hook?.cleanup?.();}};
}
