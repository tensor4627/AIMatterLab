import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const source=fs.readFileSync(new URL('../../frontend/features/terminal/SshConnectionPanel.tsx',import.meta.url),'utf8');
const types={exports:{}};
new Function('module','exports',compile(fs.readFileSync(new URL('../../frontend/features/compute/ssh-connection-types.ts',import.meta.url),'utf8')))(types,types.exports);
const connection={connectionId:'connection',status:'authenticated'},shell={sessionId:'shell',owner:'human',ownerEpoch:1,alive:true};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

// Execute the actual child component and its effects; no duplicated read loop.
function fixture(t,invoke,initial={}){
 const hooks=[],effects=[],timers=new Set(),timeouts=[],views=[],calls=[],errors=[],states=[],writes=[];let cursor=0,props,resize;
 const inputState={pending:Promise.resolve(),locked:false,observationEpoch:0};
 const useRef=value=>hooks[cursor++]??=( {current:value} );
 const useEffect=(fn,deps)=>{const id=cursor++,old=hooks[id];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i]))){hooks[id]={deps,cleanup:old?.cleanup};effects.push(()=>{hooks[id].cleanup?.();hooks[id].cleanup=fn();});}};
 class Terminal{cols=80;rows=24;options={};element={remove:()=>{this.detached=true;}};constructor(){views.push(this);}loadAddon(addon){this.addon=addon;}open(){timeouts.push(()=>assert(!this.disposed,'Queued xterm viewport initialization requires a live renderer'));}onData(fn){this.input=fn;return {dispose(){}};}write(data){writes.push(data);}dispose(){this.disposed=true;this.addon?.dispose?.();}}
 class ResizeObserver{constructor(fn){resize=fn;}observe(){}disconnect(){}}
 const jsx=(type,props)=>({type,props}),module={exports:{}},require=name=>{
  if(name==='react')return {useRef,useEffect};
  if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
  if(name==='@xterm/xterm')return {Terminal};
  if(name==='@xterm/addon-fit')return {FitAddon:class {active=true;fit(){assert(this.active,'Fit cannot run after disposal');}dispose(){this.active=false;}}};
  if(name==='../../api/studio')return {invoke:async(method,data)=>{calls.push({method,data});return invoke(method,data);}};
  if(name.endsWith('ssh-connection-types'))return types.exports;
  if(name==='../../ui/i18n')return {t:value=>value};
  return {};
 };
 new Function('require','module','exports','ResizeObserver','setInterval','clearInterval','setTimeout',compile(source+'\nexport {ChannelTerminal};'))(require,module,module.exports,ResizeObserver,fn=>{timers.add(fn);return fn;},fn=>timers.delete(fn),fn=>timeouts.push(fn));
 function render(next={}){props={connection,shell,visible:true,inputState,onShell:s=>states.push(s),onConnection(){},onError:e=>errors.push(e),...initial,...props,...next};cursor=0;const tree=module.exports.ChannelTerminal(props);tree.props.ref.current={clientWidth:700,clientHeight:500};while(effects.length)effects.shift()();}
 const drainTimeouts=()=>{while(timeouts.length)timeouts.shift()();};
 render();t.after(()=>{for(const hook of hooks)hook?.cleanup?.();drainTimeouts();});
 return {inputState,calls,errors,states,writes,views,render,drainTimeouts,unmount(){for(const hook of hooks)hook?.cleanup?.();},resize:()=>resize(),lock(){inputState.locked=true;inputState.observationEpoch++;},unlock(){inputState.locked=false;},async tick(){for(const fn of timers)fn();await flush();}};
}

for(const code of ['terminal_context_changed','terminal_owner_changed'])test('handoff suspends polling and discards an old '+code+' before the owner response',async t=>{
 let rejectOld,reads=0;
 const f=fixture(t,async(method)=>{if(method==='sharedTerminal.resize')return {};if(++reads===1)return new Promise((_r,reject)=>rejectOld=reject);return {...shell,output:'fresh output',cursor:2};});
 f.lock();await f.tick();assert.equal(reads,1);rejectOld(Error(code));await flush();assert.deepEqual(f.errors,[]);assert.deepEqual(f.states,[]);
 f.unlock();f.render({shell:{...shell,owner:'agent',ownerEpoch:2}});await f.tick();assert.equal(reads,2);assert.deepEqual(f.writes,['fresh output']);
});

test('an old successful read after lock and unlock cannot overwrite output, cursor or shell state',async t=>{
 let finish;const f=fixture(t,async(method)=>method==='sharedTerminal.resize'?{}:new Promise(resolve=>finish=resolve));
 f.lock();f.unlock();finish({...shell,output:'stale output',cursor:99});await flush();assert.deepEqual(f.writes,[]);assert.deepEqual(f.states,[]);
 await f.tick();assert.equal(f.calls.filter(c=>c.method==='sharedTerminal.read').at(-1).data.cursor,0);
 finish({...shell,output:'current output',cursor:1});await flush();assert.deepEqual(f.writes,['current output']);
});

test('a current read failure remains visible rather than suppressing context errors globally',async t=>{
 const f=fixture(t,async method=>{if(method==='sharedTerminal.resize')return {};throw Error('terminal_context_changed');});
 await flush();assert.equal(f.errors.length,1);assert.equal(f.errors[0].code,'terminal_context_changed');
});

test('an in-flight resize is invalidated even when it returns after handoff unlocks',async t=>{
 let rejectResize;const f=fixture(t,async method=>method==='sharedTerminal.resize'?new Promise((_r,reject)=>rejectResize=reject):{...shell,output:'',cursor:0});
 f.lock();f.unlock();rejectResize(Error('terminal_context_changed'));await flush();assert.deepEqual(f.errors,[]);
 f.resize();rejectResize(Error('terminal_context_changed'));await flush();assert.equal(f.errors.length,1);assert.equal(f.errors[0].code,'terminal_context_changed');
});


test('queued resize observer delivery after cleanup cannot access the disposed fit addon',async t=>{
 const f=fixture(t,async method=>method==='sharedTerminal.resize'?{}:{...shell,output:'',cursor:0});await flush();f.unmount();f.drainTimeouts();const before=f.calls.length;assert.doesNotThrow(()=>f.resize());assert.equal(f.calls.length,before);
});

test('immediate cleanup detaches and stops channel input before queued xterm initialization then disposal',async t=>{
 const f=fixture(t,async method=>method==='sharedTerminal.resize'?{}:{...shell,output:'',cursor:0});
 f.unmount();const view=f.views[0],before=f.calls.length;assert.equal(view.detached,true);assert.notEqual(view.disposed,true);
 view.input('must not send');f.resize();await f.tick();assert.equal(f.calls.length,before);
 assert.doesNotThrow(f.drainTimeouts);assert.equal(view.disposed,true);assert.doesNotThrow(()=>f.resize());assert.equal(f.calls.length,before);
});

test('actual reader binds local errors to its request epoch and reports recovery only for a matching live channel',async t=>{
 const failures=[],recovered=[];let mode='error';
 const f=fixture(t,async(method,data)=>{if(method==='sharedTerminal.resize')return {};if(mode==='error')throw Error('terminal_owner_changed');return {...shell,connectionId:mode==='foreign'?'foreign':'connection',ownerEpoch:data.ownerEpoch,alive:mode==='unknown'?null:true,output:'',cursor:0};},{onReadError:(error,identity)=>failures.push({error,identity}),onReadSuccess:identity=>recovered.push(identity)});
 await flush();assert.equal(f.errors.length,0);assert.equal(failures[0].error.code,'terminal_owner_changed');assert.deepEqual(failures[0].identity,{connectionId:'connection',sessionId:'shell',ownerEpoch:1});
 mode='foreign';await f.tick();mode='unknown';await f.tick();assert.deepEqual(recovered,[]);mode='current';f.render({shell:{...shell,ownerEpoch:2}});await f.tick();assert.deepEqual(recovered,[{connectionId:'connection',sessionId:'shell',ownerEpoch:2}]);
});
