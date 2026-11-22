import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function mount(file,initial,dispatch=async()=>{}){
 const hooks=[],effects=[],timers=new Map(),calls=[],errors=[];let cursor=0,dirty=false,tree,props=initial,disposed=false,now=100000,timerId=0;
 const useState=initial=>{const i=cursor++;hooks[i]??={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{const next=typeof value==='function'?value(hooks[i].value):value;if(!Object.is(next,hooks[i].value)){hooks[i].value=next;dirty=true;}}];};
 const useRef=initial=>{const i=cursor++;return hooks[i]??(hooks[i]={current:initial});};
 const useEffect=(fn,deps)=>{const i=cursor++,old=hooks[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j]))){hooks[i]={deps,cleanup:old?.cleanup};effects.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=fn();});}};
 const jsx=(type,props)=>({type,props});
 const api=(method,target,data)=>{calls.push({method,target,data});return dispatch(target,data);};
 const require=name=>name==='react'?{useState,useRef,useEffect}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='lucide-react'?new Proxy({},{get:(_,key)=>key}):name.endsWith('/i18n')||name==='./i18n'?{t:value=>value}:name.endsWith('/worker')?{api}:name.endsWith('/LoadingFeedback')?{default:'LoadingFeedback'}:{};
 const compiled=ts.transpileModule(fs.readFileSync(new URL('../../frontend/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,module={exports:{}};
 const FakeDate=new Proxy(Date,{get:(target,key)=>key==='now'?()=>now:Reflect.get(target,key)});
 new Function('require','module','exports','Date','setInterval','clearInterval',compiled)(require,module,module.exports,FakeDate,fn=>{timers.set(++timerId,fn);return timerId;},id=>timers.delete(id));
 function render(next={}){props={...props,...next,onError:error=>errors.push(error)};cursor=0;dirty=false;tree=module.exports.default(props);}
 async function flush(){for(let i=0;i<10;i++){while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));if(dirty&&!disposed)render();}}
 const nodes=node=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.children)]:[];
 const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node==null||typeof node==='boolean'?'':String(node);
 const find=predicate=>{const value=nodes(tree).find(predicate);assert(value,'component node exists');return value;};
 const button=label=>find(node=>node.type==='button'&&(typeof label==='string'?text(node)===label:label.test(text(node))));
 function unmount(){disposed=true;for(const hook of hooks)hook?.cleanup?.();}
 render();return {render,flush,find,button,calls,errors,timers,text:()=>text(tree),nodes:()=>nodes(tree),advance:async ms=>{now+=ms;for(const fn of timers.values())fn();await flush();},unmount};
}

test('loading feedback acknowledges immediately, preserves real elapsed time across stages, and clears timers',async()=>{
 const h=mount('ui/LoadingFeedback.tsx',{busy:true,label:'Connecting',phase:'Checking identity'});
 try{await h.flush();assert.match(h.text(),/Connecting · Checking identity/);assert.equal(h.find(node=>node.props?.['aria-busy']).props['aria-busy'],'true');assert.equal(h.find(node=>node.props?.role==='status').props['aria-live'],'polite');assert(!h.nodes().some(node=>node.type==='progress'));
  await h.advance(2300);assert.match(h.text(),/2 秒/);h.render({phase:'Reading environments'});await h.flush();await h.advance(2100);assert.match(h.text(),/4 秒/);
  h.render({busy:false});await h.flush();assert.equal(h.text(),'');assert.equal(h.timers.size,0);
  h.render({busy:true});await h.flush();assert.doesNotMatch(h.text(),/4 秒/);
 }finally{h.unmount();}assert.equal(h.timers.size,0);
});

test('measured progress uses confirmed counters only and backend start time remains authoritative',async()=>{
 const h=mount('ui/LoadingFeedback.tsx',{busy:true,label:'Transfer',startedAt:93000,progress:{completed:5,total:20}});
 try{await h.flush();assert.match(h.text(),/7 秒/);assert.equal(h.find(node=>node.type==='progress').props.value,5);assert.equal(h.find(node=>node.type==='progress').props.max,20);
  for(const progress of [{completed:2,total:0},{completed:-1,total:20},{completed:21,total:20},{completed:NaN,total:20}]){h.render({progress});await h.flush();assert(!h.nodes().some(node=>node.type==='progress'));}
 }finally{h.unmount();}
});

const collection={files:[{id:'a',name:'a.txt',size:3,sha256:'a'.repeat(64)},{id:'b',name:'b.txt',size:3,sha256:'b'.repeat(64)}],manifest:{transfer_status:'passed'}};
test('result collection gives immediate feedback and blocks repeated clicks before rerender',async()=>{
 const gate=deferred(),h=mount('features/cluster/ClusterResults.tsx',{run:{id:'run-a',status:'succeeded'}},()=>gate.promise);
 try{await h.flush();const click=h.button('回收结果').props.onClick;click();click();await h.flush();assert.equal(h.calls.length,1);assert(h.button('回收中…').props.disabled);assert(h.find(node=>node.type==='LoadingFeedback'&&node.props.label==='正在回收并校验结果…').props.busy);
  gate.resolve(collection);await h.flush();assert.match(h.text(),/回收完成/);assert.equal(h.button('回收结果').props.disabled,false);
 }finally{h.unmount();}
});

for(const outcome of ['success','failure'])test('a superseded result preview '+outcome+' cannot replace the selected file or report an old error',async()=>{
 const a=deferred(),b=deferred(),h=mount('features/cluster/ClusterResults.tsx',{run:{id:'run-a',status:'succeeded'}},(target,data)=>target.endsWith('/collect')?Promise.resolve(collection):data.name==='a.txt'?a.promise:b.promise);
 try{await h.flush();h.button('回收结果').props.onClick();await h.flush();const inspectA=h.button(/^a\.txt/).props.onClick;inspectA();inspectA();await h.flush();assert.equal(h.calls.filter(call=>call.target.endsWith('/result')).length,1);
  h.button(/^b\.txt/).props.onClick();await h.flush();assert(h.find(node=>node.type==='LoadingFeedback'&&node.props.label==='正在读取结果预览…').props.busy);
  b.resolve({name:'b.txt',text:'CURRENT PREVIEW'});await h.flush();if(outcome==='success')a.resolve({name:'a.txt',text:'STALE PREVIEW'});else a.reject(Error('STALE ERROR'));await h.flush();assert.match(h.text(),/CURRENT PREVIEW/);assert.doesNotMatch(h.text(),/STALE/);assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});

test('old-run collection cannot replace a new run or clear its pending feedback',async()=>{
 const a=deferred(),b=deferred(),h=mount('features/cluster/ClusterResults.tsx',{run:{id:'run-a',status:'succeeded'}},(_target,data)=>data.run_id==='run-a'?a.promise:b.promise);
 try{await h.flush();h.button('回收结果').props.onClick();await h.flush();h.render({run:{id:'run-b',status:'succeeded'}});await h.flush();h.button('回收结果').props.onClick();await h.flush();a.resolve(collection);await h.flush();assert(h.button('回收中…').props.disabled);assert.doesNotMatch(h.text(),/回收完成/);b.resolve({...collection,files:[]});await h.flush();assert.match(h.text(),/回收完成/);assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});

test('unmounted result requests never report late errors',async()=>{
 const gate=deferred(),h=mount('features/cluster/ClusterResults.tsx',{run:{id:'run-a',status:'succeeded'}},()=>gate.promise);await h.flush();h.button('回收结果').props.onClick();await h.flush();h.unmount();gate.reject(Error('LATE ERROR'));await h.flush();assert.deepEqual(h.errors,[]);
});
