import * as humanInput from '../../frontend/features/terminal/human-input.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const source=fs.readFileSync(new URL('../../frontend/features/terminal/SshConnectionPanel.tsx',import.meta.url),'utf8');
const types={exports:{}};
new Function('module','exports',compile(fs.readFileSync(new URL('../../frontend/features/compute/ssh-connection-types.ts',import.meta.url),'utf8')))(types,types.exports);
const connection={connectionId:'connection',status:'authenticated'},shell={sessionId:'shell',connectionId:'connection',owner:'human',ownerEpoch:1,alive:true};
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
  if(name==='./human-input.mjs')return humanInput;
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
 const f=fixture(t,async(method,data)=>{if(method==='sharedTerminal.resize')return {};if(++reads===1)return new Promise((_r,reject)=>rejectOld=reject);return {...shell,ownerEpoch:data.ownerEpoch,output:'fresh output',cursor:2};});
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

test('resize is addressed to the displayed ownership epoch and stays a local geometry diagnostic',async t=>{
 const geometry=[],pending=[];const f=fixture(t,(method,data)=>method==='sharedTerminal.resize'?new Promise((resolve,reject)=>pending.push({data,resolve,reject})):{...shell,output:'',cursor:0},{onGeometry:value=>geometry.push(value),resourceScope:'blank'});
 assert.equal(pending[0].data.ownerEpoch,1);
 f.render({shell:{...shell,awaitingConversation:true}});f.resize();assert.equal(pending.length,1);
 pending[0].reject(Error('terminal_context_changed'));await flush();assert.deepEqual(geometry,[]);
 f.render({resourceScope:'bound',shell:{...shell,owner:'agent',ownerEpoch:2}});assert.equal(pending[1].data.ownerEpoch,2);
 pending[1].reject(Error('terminal_unavailable'));await flush();assert.equal(geometry.at(-1).code,'terminal_unavailable');assert.deepEqual(f.errors,[]);
 f.resize();pending[2].resolve({accepted:true});await flush();assert.equal(geometry.at(-1),null);
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
 const f=fixture(t,async(method,data)=>{if(method==='sharedTerminal.resize')return {};if(mode==='error')throw Error('terminal_owner_changed');return {...shell,connectionId:mode==='foreign'?'foreign':'connection',ownerEpoch:data.ownerEpoch,alive:mode==='unknown'?null:true,output:mode==='foreign'?'foreign output':'',cursor:mode==='foreign'?17:0};},{onReadError:(error,identity)=>failures.push({error,identity}),onReadSuccess:identity=>recovered.push(identity)});
 await flush();assert.equal(f.errors.length,0);assert.equal(failures[0].error.code,'terminal_owner_changed');assert.deepEqual(failures[0].identity,{connectionId:'connection',sessionId:'shell',ownerEpoch:1});
 mode='foreign';await f.tick();assert.deepEqual(f.writes,[]);mode='unknown';await f.tick();assert.deepEqual(recovered,[]);mode='current';f.render({shell:{...shell,ownerEpoch:2}});await f.tick();assert.deepEqual(recovered,[{connectionId:'connection',sessionId:'shell',ownerEpoch:2}]);
 assert(f.calls.filter(call=>call.method==='sharedTerminal.read').every(call=>call.data.cursor===0));
});

test('showing the same terminal replays from the last accepted cursor after an obsolete hidden read',async t=>{
 let finishOld;let reads=0;
 const f=fixture(t,async(method,data)=>{
  if(method==='sharedTerminal.resize')return {};
  if(++reads===1)return {...shell,output:'first page',cursor:1};
  if(reads===2)return new Promise(resolve=>finishOld=resolve);
  assert.equal(data.cursor,1);
  return {...shell,output:'replayed page',cursor:2};
 });
 await flush();await f.tick();assert(finishOld);
 f.render({visible:false});f.render({visible:true});
 finishOld({...shell,output:'obsolete page',cursor:19});await flush();
 f.drainTimeouts();await flush();
 assert.deepEqual(f.writes,['first page','replayed page']);
 assert.equal(f.views.length,1);
});

test('unsubmitted private input queued before the authentication panel was hidden cannot be replayed',async t=>{
 const pending={...connection,schemaVersion:2,status:'authenticating',authentication:'pending',profileId:'profile',profileVersion:1,loginRequestId:'original-login',capabilities:{multiplex:false},terminalSessionIds:[],serviceIds:[],revision:1};
 let finishFirst;
 const f=fixture(t,async(method)=>{
  if(method==='compute.sshConnection.authResize')return {resized:true};
  if(method==='compute.sshConnection.authRead')return {connectionId:pending.connectionId,state:pending,output:'',cursor:0,dropped:false};
  if(!finishFirst)return new Promise(resolve=>finishFirst=resolve);
  return {accepted:true};
 },{connection:pending,shell:undefined});
 const send=data=>f.views[0].input(data);
 const inputCalls=()=>f.calls.filter(call=>call.method==='compute.sshConnection.authInput').map(call=>call.data.data);
 send('synthetic sent input');await flush();
 send('synthetic queued input');
 f.render({visible:false});f.render({visible:true});
 finishFirst({accepted:true});await f.inputState.pending;
 assert.deepEqual(inputCalls(),['synthetic sent input']);
 send('synthetic newly typed input');await f.inputState.pending;
 assert.deepEqual(inputCalls(),['synthetic sent input','synthetic newly typed input']);
 assert(!f.calls.some(call=>call.method==='sharedTerminal.input'));
});
