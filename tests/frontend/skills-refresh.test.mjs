import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function harness(override){
 const hooks=[],effects=[],calls=[];let cursor=0,dirty=false,tree;
 const props={provider:'codex',settings:{},onSaved(){},onSelect(){},onError(){}};
 const useState=initial=>{const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{hooks[i].value=typeof value==='function'?value(hooks[i].value):value;dirty=true;}];};
 const useRef=value=>{const i=cursor++;return hooks[i]??(hooks[i]={current:value});};
 const useEffect=(fn,deps)=>{const i=cursor++,old=hooks[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){hooks[i]={deps,cleanup:old?.cleanup};effects.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=fn();});}};
 const jsx=(type,props)=>({type,props});
 const invoke=async(method,data)=>{calls.push({method,data});const v=override?.(method,data);if(v!==undefined)return await v;if(method==='scientific.skills')return {schema_version:1,functions:[]};if(method==='skills.catalog')return [];if(method==='state')return {settings:{}};throw Error('Unexpected write');};
 const require=name=>name==='react'?{useState,useEffect,useRef}:name==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'fragment'}:name==="../../api/studio"?{invoke}:name==="../../ui/i18n"?{t:x=>x}:new Proxy({},{get:(_t,key)=>String(key)});
 const code=ts.transpileModule(fs.readFileSync(new URL("../../frontend/features/tools/SkillsWorkbench.tsx",import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};new Function('require','module','exports',code)(require,module,module.exports);
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];
 const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):n==null||typeof n==='boolean'?'':String(n);
 function render(){cursor=0;dirty=false;tree=module.exports.default(props);}
 async function flush(){for(let i=0;i<15;i++){while(effects.length)effects.shift()();await new Promise(r=>setImmediate(r));if(dirty)render();}}
 const find=fn=>{const n=all(tree).find(fn);assert(n);return n;};render();
 return {props,calls,render,flush,text,find,status:()=>find(n=>n.props?.['data-testid']==='resource-refresh-status'),refresh:()=>find(n=>n.type==='button'&&text(n)==='刷新资源').props.onClick(),unmount:()=>hooks.forEach(h=>h?.cleanup?.())};
}
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
test('real resources component reports refresh completion for empty catalogs without claiming availability',async()=>{
 const h=harness();await h.flush();assert.match(h.text(h.status()),/已刷新/);assert.equal(h.status().props['aria-live'],'polite');
 h.refresh();await h.flush();assert.match(h.text(h.status()),/已刷新/);assert(!h.calls.some(c=>c.method==='settings'));h.unmount();
});
test('partial catalog results retain errors and do not announce success',async()=>{
 const h=harness(m=>m==='scientific.skills'?Promise.reject(Error('catalog unavailable')):undefined);await h.flush();assert.equal(h.text(h.status()),'');assert.match(h.text(h.find(n=>n.props?.role==='alert')),/功能目录读取失败/);h.unmount();
});
test('late old-provider refresh cannot announce completion in the new provider',async()=>{
 const old=deferred(),next=deferred();const h=harness((m,d)=>m==='scientific.skills'?(d.provider==='codex'?old.promise:next.promise):undefined);await h.flush();h.props.provider='kimi';h.render();await h.flush();old.resolve({schema_version:1,functions:[]});await h.flush();assert.equal(h.text(h.status()),'');next.resolve({schema_version:1,functions:[]});await h.flush();assert.match(h.text(h.status()),/已刷新/);h.unmount();
});
