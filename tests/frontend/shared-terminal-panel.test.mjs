import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import {randomUUID}from'node:crypto';
const compiled=ts.transpileModule(fs.readFileSync(new URL("../../frontend/features/terminal/SharedTerminalPanel.tsx",import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const presentation={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync(new URL('../../frontend/features/terminal/ssh-service-presentation.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(presentation,presentation.exports);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const session=(id='owned')=>({sessionId:id,name:id,kind:'local',mode:'interactive',owner:'human',ownerEpoch:1,alive:true,status:'running',sequence:0});
function harness({request={nonce:'first',kind:'local',mode:'interactive'},override}={}){
 const hooks=[],effects=[],calls=[],errors=[],views=[],timers=new Map(),events=new Map(),sessions=new Map();let cursor=0,tree,dirty=false,disposed=false,font=13,fits=0,nextTimer=0;
 const props={visible:true,canShare:true,request,onError:e=>errors.push(e)};
 const useState=initial=>{const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return[hooks[i].value,next=>{const value=typeof next==='function'?next(hooks[i].value):next;if(!Object.is(value,hooks[i].value)){hooks[i].value=value;dirty=true;}}];};
 const useRef=initial=>{const i=cursor++;return hooks[i]??(hooks[i]={current:initial});};
 const useEffect=(fn,deps)=>{const i=cursor++,prior=hooks[i];if(!prior||deps.some((v,j)=>!Object.is(v,prior.deps[j]))){const slot={deps,cleanup:prior?.cleanup};hooks[i]=slot;effects.push(()=>{slot.cleanup?.();slot.cleanup=fn();});}};
 class Terminal{constructor(value){this.options=value;this.writes=[];this.cols=100;this.rows=30;views.push(this);}loadAddon(){}open(){}focus(){}write(v){this.writes.push(v);}onData(fn){this.input=fn;return{dispose(){}};}dispose(){this.disposed=true;}}
 class FitAddon{fit(){fits++;}}
 class ResizeObserver{constructor(fn){this.fn=fn;}observe(){this.fn();}disconnect(){}}
 let resource={schemaVersion:1,selectionId:null,kind:null,profileId:null,profileVersion:null,sessionId:null,status:'none',operator:'unknown',processStatus:'unknown',alive:null,agentReady:false,reason:null,authentication:'not_observed',managedRuns:false};
 const standard=async(method,data)=>{if(method==='compute.sshService.status')return {status:'disconnected'};if(method==='compute.resource.activate'){const value=sessions.get(data.sessionId);resource={...resource,...data,selectionId:'selection-'+data.sessionId,status:'selected',operator:value.owner,processStatus:value.alive?'running':'exited',alive:value.alive,agentReady:value.owner==='agent'};return structuredClone(resource);}if(method==='compute.resource.status'){const selected=sessions.get(resource.sessionId);return {...resource,...selected?{operator:selected.owner,agentReady:selected.owner==='agent',alive:selected.alive}:{}};}if(method==='sharedTerminal.open'){const value=session('session-'+(sessions.size+1));sessions.set(value.sessionId,value);return structuredClone(value);}if(method==='sharedTerminal.list')return{sessions:[...sessions.values()].map(value=>structuredClone(value))};const current=sessions.get(data.sessionId);if(!current)throw Error('fixture missing session');if(method==='sharedTerminal.read')return{...structuredClone(current),output:'',cursor:data.cursor??0,dropped:false};if(method==='sharedTerminal.owner'){const next={...current,owner:data.owner,ownerEpoch:current.ownerEpoch+1};sessions.set(next.sessionId,next);return structuredClone(next);}if(method==='sharedTerminal.input'||method==='sharedTerminal.resize')return{accepted:true};if(method==='sharedTerminal.close'){sessions.delete(data.sessionId);return{closed:true};}throw Error('Unexpected test IPC '+method);};
 const invoke=async(method,data)=>{calls.push({method,data});return override?override(method,data,standard,{sessions}):standard(method,data);};const jsx=(type,props)=>({type,props}),module={exports:{}};
 const window={studio:{onEvent:fn=>{events.set('studio:event',fn);return()=>events.delete('studio:event');}},addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n)},document={documentElement:{style:{getPropertyValue:k=>k==='--terminal-font-size'?String(font):'11'}}};
 new Function('require','module','exports','window','document','ResizeObserver','crypto','setInterval','clearInterval',compiled)(name=>name==='react'?{useState,useRef,useEffect}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='@xterm/xterm'?{Terminal}:name==='@xterm/addon-fit'?{FitAddon}:name==="../../api/studio"?{invoke}:name==='../../api/compute-resources'?(()=>{const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(new URL('../../frontend/api/compute-resources.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>{assert.equal(n,'./studio');return {invoke};},m,m.exports);return m.exports;})():name==='./ssh-service-presentation'?presentation.exports:name==="../../ui/i18n"?{t:x=>x}:{},module,module.exports,window,document,ResizeObserver,{randomUUID},fn=>{const id=++nextTimer;timers.set(id,fn);return id;},id=>timers.delete(id));
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[],text=n=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):'';
 function render(){cursor=0;dirty=false;tree=module.exports.default(props);for(const node of all(tree))if(node.props?.ref)node.props.ref.current={clientWidth:800,clientHeight:300};}
 async function flush(){for(let i=0;i<25;i++){while(effects.length)effects.shift()();await new Promise(r=>setImmediate(r));if(dirty&&!disposed)render();}}
 const find=p=>{const value=all(tree).find(p);assert(value,'actual panel node missing');return value;};const click=label=>{const n=find(n=>n.type==='button'&&text(n)===label);assert(!n.props.disabled,'button disabled');n.props.onClick();render();};
 render();return{calls,errors,views,sessions,events,flush,find,click,text,update:v=>{Object.assign(props,v);render();},appearance:v=>{font=v;events.get('studio:appearance')?.();},fits:()=>fits,tick:()=>{for(const f of timers.values())f();},unmount:()=>{disposed=true;for(const h of hooks)h?.cleanup?.();}};
}

test('same SSH session becomes a service only after an explicit post-login click; private lane blocks raw input and duplicate requests',async()=>{
 const gate=deferred(),profile={kind:'ssh-terminal',profileId:'saved-ssh',profileVersion:3};let calls=0;
 const h=harness({request:{nonce:'ssh-login',kind:'ssh',mode:'interactive',profileId:profile.profileId,version:3},override:(method,data,standard,{sessions})=>{if(method==='sharedTerminal.open'){const value={...session('ssh-existing'),kind:'ssh',resource:profile};sessions.set(value.sessionId,value);return value;}if(method==='compute.sshService.connect'){calls++;return gate.promise.then(()=>{sessions.set('ssh-existing',{...sessions.get('ssh-existing'),serviceActive:true,serviceStatus:'connected'});return {status:'connected'};});}return standard(method,data);}});await h.flush();assert.equal(calls,0);const connect=h.find(n=>n.props?.['data-testid']==='ssh-service-connect');connect.props.onClick();connect.props.onClick();await h.flush();assert.equal(calls,1);const request=h.calls.find(call=>call.method==='compute.sshService.connect').data;assert.equal(request.sessionId,'ssh-existing');assert.equal(request.ownerEpoch,1);assert.equal(request.profileId,'saved-ssh');assert.equal(request.profileVersion,3);const inputs=h.calls.filter(call=>call.method==='sharedTerminal.input').length;h.views.at(-1).input('MUST_NOT_ENTER_PRIVATE_LANE');await h.flush();assert.equal(h.calls.filter(call=>call.method==='sharedTerminal.input').length,inputs);gate.resolve();await h.flush();h.tick();await h.flush();assert.equal(h.find(n=>n.props?.['data-testid']==='shared-terminal-handoff').props.disabled,true);assert(h.find(n=>n.props?.['data-testid']==='ssh-service-reserved'));assert.equal(h.calls.filter(call=>call.method==='sharedTerminal.open').length,1);h.unmount();
});

test('active service A blocks dropdown, detached view and external open B without changing the visible session',async()=>{
 let opened=false;const h=harness({request:{nonce:'A',kind:'ssh',mode:'interactive',profileId:'profile-A',version:1},override:(method,data,standard,{sessions})=>{if(method==='compute.sshService.status')return opened?{status:'connected',sessionId:'A',profileId:'profile-A',profileVersion:1}:{status:'disconnected'};if(method==='sharedTerminal.open'){opened=true;const a={...session('A'),kind:'ssh',serviceActive:true,serviceStatus:'connected',resource:{kind:'ssh-terminal',profileId:'profile-A',profileVersion:1}};sessions.set('A',a);sessions.set('B',{...session('B'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'profile-B',profileVersion:1}});return a;}return standard(method,data);}});await h.flush();const dropdown=h.find(node=>node.type==='select');assert.equal(dropdown.props.disabled,true);dropdown.props.onChange({target:{value:'B'}});await h.flush();assert.equal(h.find(node=>node.type==='select').props.value,'A');assert.equal(h.calls.some(call=>call.method==='compute.resource.activate'&&call.data.sessionId==='B'),false);h.update({request:{nonce:'B',kind:'ssh',mode:'interactive',profileId:'profile-B',version:1}});await h.flush();assert.equal(h.calls.filter(call=>call.method==='sharedTerminal.open').length,1);assert.equal(h.find(node=>node.type==='select').props.value,'A');assert(h.text(h.find(node=>node.props?.className==='shared-terminal-notice'&&h.text(node).includes('返回交互终端'))));assert.equal(h.calls.some(call=>call.method==='compute.sshService.disconnect'),false);h.unmount();
});

test('resource activation refusal never commits B to the visible terminal even if the local service hint was stale',async()=>{
 const h=harness({override:(method,data,standard,{sessions})=>{if(method==='sharedTerminal.open'){const a={...session('A'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'profile-A',profileVersion:1}};sessions.set('A',a);sessions.set('B',{...session('B'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'profile-B',profileVersion:1}});return a;}if(method==='compute.resource.activate'&&data.sessionId==='B')throw Error('请先在原 SSH 连接返回交互终端，再切换计算资源。');return standard(method,data);}});await h.flush();h.find(node=>node.type==='select').props.onChange({target:{value:'B'}});await h.flush();assert.equal(h.find(node=>node.type==='select').props.value,'A');assert.equal(h.calls.some(call=>call.method==='compute.sshService.disconnect'),false);h.unmount();
});

test('a stale visible B return action cannot disconnect the globally reserved service A',async()=>{
 let opened=false;const h=harness({override:(method,data,standard,{sessions})=>{if(method==='compute.sshService.status')return opened?{status:'connected',sessionId:'A'}:{status:'disconnected'};if(method==='sharedTerminal.open'){opened=true;const b={...session('B'),kind:'ssh',serviceActive:true,serviceStatus:'unknown',resource:{kind:'ssh-terminal',profileId:'profile-B',profileVersion:1}};sessions.set('B',b);return b;}if(method==='compute.sshService.disconnect')throw Error('Must not stop A');return standard(method,data);}});await h.flush();h.find(node=>node.props?.['data-testid']==='ssh-service-disconnect').props.onClick();await h.flush();assert.equal(h.calls.some(call=>call.method==='compute.sshService.disconnect'),false);assert.equal(h.find(node=>node.type==='select').props.value,'B');h.unmount();
});
test('busy open retains the second external request and opens it once after the first finishes',async()=>{const pending=deferred();let opens=0;const h=harness({override:(method,data,standard,{sessions})=>{if(method==='sharedTerminal.open'&&opens++===0)return pending.promise.then(()=>{const s=session('first');sessions.set(s.sessionId,s);return s;});return standard(method,data);}});await h.flush();assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);h.update({request:{nonce:'second',kind:'ssh',mode:'interactive',clusterId:'saved',version:1}});await h.flush();assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);pending.resolve();await h.flush();const calls=h.calls.filter(c=>c.method==='sharedTerminal.open');assert.equal(calls.length,2);assert.equal(calls[1].data.kind,'ssh');assert.deepEqual(h.errors,[]);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));h.unmount();});
test('detach and reattach use the same session without close/open, and appearance changes refit actual terminal',async()=>{const h=harness();await h.flush();const original=h.calls.filter(c=>c.method==='sharedTerminal.open').length,id=[...h.sessions.keys()][0];h.click('分离视图');await h.flush();const select=h.find(n=>n.type==='select');select.props.onChange({target:{value:id}});await h.flush();assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,original);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));const before=h.fits();h.appearance(20);assert(h.fits()>before,JSON.stringify({before,after:h.fits(),views:h.views.length,events:[...h.events.keys()],selected:h.find(n=>n.type==='select').props.value,errors:h.errors.map(String)}));assert.equal(h.views.at(-1).options.fontSize,20);assert.deepEqual(h.errors,[]);h.unmount();});
test('late human read cannot overwrite a newer handoff or paint stale output',async()=>{const pending=deferred();let hold=true;const h=harness({override:(method,data,standard)=>method==='sharedTerminal.read'&&hold?(hold=false,pending.promise):standard(method,data)});await h.flush();h.click('交给 Agent');await h.flush();assert.equal(h.find(n=>n.props?.['data-testid']==='shared-terminal-handoff').props.children,'我来操作');pending.resolve({...session([...h.sessions.keys()][0]),output:'STALE HUMAN OUTPUT',cursor:9,dropped:false});await h.flush();assert.equal(h.find(n=>n.props?.['data-testid']==='shared-terminal-handoff').props.children,'我来操作');assert(!h.views.some(v=>v.writes.some(x=>x.includes('STALE HUMAN OUTPUT'))));h.tick();await h.flush();const reads=h.calls.filter(c=>c.method==='sharedTerminal.read');assert.equal(reads.at(-1).data.ownerEpoch,2);assert.deepEqual(h.errors,[]);h.unmount();});

test('settled human terminal input forwards whole data with current session and epoch',async()=>{const h=harness();await h.flush();const view=h.views.at(-1);assert.equal(view.options.disableStdin,false);view.input('public fixture\r');await h.flush();const writes=h.calls.filter(c=>c.method==='sharedTerminal.input');assert.equal(writes.length,1);assert.equal(writes[0].data.sessionId,[...h.sessions.keys()][0]);assert.equal(writes[0].data.ownerEpoch,1);assert.equal(writes[0].data.data,'public fixture\r');assert(writes[0].data.requestId);assert.deepEqual(h.errors,[]);h.unmount();});

test('terminal visibly accepting input must not silently drop keys while post-open list is pending',async()=>{const gate=deferred();let hold=true;const h=harness({override:(method,data,standard,{sessions})=>method==='sharedTerminal.list'&&hold&&sessions.size?gate.promise:standard(method,data)});try{await h.flush();const view=h.views.at(-1);assert(view,'opened session should mount actual terminal');assert.equal(view.options.disableStdin,false,'current UI presents an editable terminal');view.input('x');await h.flush();assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.input').length,1,'editable human terminal input must be delivered, not silently dropped');}finally{hold=false;gate.resolve({sessions:[...h.sessions.values()]});await h.flush();h.unmount();}});

test('fast exited open response still paints buffered error tail and disables terminal input',async()=>{const h=harness({override:(method,data,standard,{sessions})=>{if(method==='sharedTerminal.open'){const s={...session('fast-exit'),alive:false,status:'exited',exitCode:255};sessions.set(s.sessionId,s);return s;}if(method==='sharedTerminal.read')return {...sessions.get(data.sessionId),output:'PUBLIC FIXTURE: stderr before exit',cursor:1,dropped:false};return standard(method,data);}});await h.flush();assert(h.views.at(-1).writes.some(v=>v.includes('PUBLIC FIXTURE: stderr before exit')));assert.equal(h.views.at(-1).options.disableStdin,true);assert(h.text(h.find(n=>n.props?.className==='shared-terminal-caption')).includes('255'));assert.deepEqual(h.errors,[]);h.unmount();});

test('visible one-click close affects only the selected terminal, without confirmation',async()=>{const h=harness();await h.flush();const first=[...h.sessions.keys()][0];h.update({request:{nonce:'second',kind:'local',mode:'interactive'}});await h.flush();const second=[...h.sessions.keys()].find(id=>id!==first);assert(second);const button=h.find(n=>n.props?.['data-testid']==='shared-terminal-disconnect');assert.equal(h.text(button),'关闭终端');button.props.onClick();await h.flush();assert.deepEqual(h.calls.filter(c=>c.method==='sharedTerminal.close').map(c=>c.data.sessionId),[second]);assert(h.sessions.has(first));assert(!h.sessions.has(second));assert.deepEqual(h.errors,[]);h.unmount();});

test('SSH close is prominently labelled disconnect',async()=>{const h=harness({override:(method,data,standard,{sessions})=>{if(method==='sharedTerminal.open'){const s={...session('ssh-ui'),kind:'ssh'};sessions.set(s.sessionId,s);return s;}return standard(method,data);}});await h.flush();assert.equal(h.text(h.find(n=>n.props?.['data-testid']==='shared-terminal-disconnect')),'断开连接');h.click('断开连接');await h.flush();assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.close').length,1);assert.deepEqual(h.errors,[]);h.unmount();});

test('explicit saved SSH open binds only its returned resource ref and never reactivates from readonly polling',async()=>{
 const received=[],h=harness({request:{nonce:'saved',kind:'ssh',mode:'interactive',profileId:'requested-profile',version:99},override:(method,data,standard,{sessions})=>{if(method==='sharedTerminal.open'){const value={...session('actual-ssh'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'actual-profile',profileVersion:3}};sessions.set(value.sessionId,value);return value;}return standard(method,data);}});h.update({onResourceChange:(state,label)=>received.push({state,label}),resourceScope:'owner-A'});await h.flush();assert.deepEqual(h.calls.filter(c=>c.method==='compute.resource.activate').map(c=>c.data),[{kind:'ssh-terminal',profileId:'actual-profile',profileVersion:3,sessionId:'actual-ssh'}]);assert.equal(received.at(-1)?.state.sessionId,'actual-ssh');assert.equal(h.sessions.get('actual-ssh').owner,'human');h.tick();await h.flush();h.tick();await h.flush();assert.equal(h.calls.filter(c=>c.method==='compute.resource.activate').length,1);assert(!h.calls.some(c=>c.method==='sharedTerminal.owner'));assert.deepEqual(h.errors,[]);h.unmount();
});

test('attaching a known SSH session binds once, and human/Agent ownership refreshes only readonly status on the same terminal',async()=>{
 const received=[],h=harness({override:(method,data,standard,{sessions})=>{if(method==='sharedTerminal.open'){const value={...session('same-ssh'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'saved',profileVersion:2}};sessions.set(value.sessionId,value);return value;}return standard(method,data);}});h.update({resourceScope:'same-owner',onResourceChange:value=>received.push(value)});await h.flush();h.click('交给 Agent');await h.flush();assert.equal(received.at(-1).agentReady,true);h.click('我来操作');await h.flush();assert.equal(received.at(-1).operator,'human');const before=h.calls.filter(c=>c.method==='compute.resource.activate').length;h.click('分离视图');h.find(n=>n.type==='select').props.onChange({target:{value:'same-ssh'}});await h.flush();assert.equal(h.calls.filter(c=>c.method==='compute.resource.activate').length,before+1);assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));assert.deepEqual(h.errors,[]);h.unmount();
});

test('late open or activation after a source change cannot publish the old terminal resource',async()=>{
 for(const hold of ['open','activate']){const gate=deferred(),received=[];const h=harness({override:(method,data,standard,{sessions})=>{if(method==='sharedTerminal.open'){const value={...session('late-ssh'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'saved',profileVersion:2}};sessions.set(value.sessionId,value);return hold==='open'?gate.promise.then(()=>value):value;}if(method==='compute.resource.activate'&&hold==='activate')return gate.promise.then(()=>standard(method,data));return standard(method,data);}});h.update({resourceScope:'owner-A',onResourceChange:value=>received.push(value)});await h.flush();h.update({resourceScope:'owner-B'});await h.flush();gate.resolve();await h.flush();assert(!received.some(value=>value.sessionId==='late-ssh'&&value.status==='selected'));if(hold==='open')assert(!h.calls.some(c=>c.method==='compute.resource.activate'));assert(!h.calls.some(c=>c.method==='sharedTerminal.owner'||c.method==='sharedTerminal.close'));h.unmount();}
});

test('a terminal response without a real resource reference never invents activation from the requested profile',async()=>{
 const h=harness({request:{nonce:'no-ref',kind:'ssh',mode:'interactive',profileId:'request-only',version:7},override:(method,data,standard,{sessions})=>{if(method==='sharedTerminal.open'){const value={...session('legacy-ssh'),kind:'ssh'};sessions.set(value.sessionId,value);return value;}return standard(method,data);}});await h.flush();assert(!h.calls.some(c=>c.method==='compute.resource.activate'));assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);h.unmount();
});

test('explicit handoff adopts the prepared conversation without reopening the existing terminal',async()=>{
 const prepared={id:'kimi:prepared-terminal',provider:'kimi',threadId:'prepared-terminal',name:'Terminal conversation',projectId:null,taskId:null},adopted=[];
 const h=harness({override:async(method,data,standard)=>{const result=await standard(method,data);return method==='sharedTerminal.owner'&&data.owner==='agent'?{...result,conversation:prepared}:result;}});
 h.update({provider:'kimi',onConversationPrepared:value=>adopted.push(value)});await h.flush();const original=[...h.sessions.keys()][0];h.click('交给 Agent');await h.flush();
 assert.deepEqual(adopted,[prepared]);assert.deepEqual(h.calls.filter(c=>c.method==='sharedTerminal.owner').map(c=>c.data),[{sessionId:original,ownerEpoch:1,owner:'agent',provider:'kimi'}]);
 assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'||c.method==='agent.connect'||c.method==='agent.rpc'));
 h.click('我来操作');await h.flush();assert.equal(adopted.length,1);assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.owner').at(-1).data.provider,undefined,'human takeover must not start or retarget a provider');assert.deepEqual(h.errors,[]);h.unmount();
});

test('late handoff cannot adopt its prepared conversation after the resource scope changes',async()=>{
 const gate=deferred(),adopted=[],prepared={id:'kimi:late-terminal',provider:'kimi',threadId:'late-terminal',name:'Late terminal conversation',projectId:null,taskId:null};
 const h=harness({override:(method,data,standard)=>method==='sharedTerminal.owner'?gate.promise.then(async()=>({...await standard(method,data),conversation:prepared})):standard(method,data)});
 h.update({provider:'kimi',resourceScope:'original',onConversationPrepared:value=>adopted.push(value)});await h.flush();h.click('交给 Agent');await h.flush();h.update({resourceScope:'replacement'});await h.flush();gate.resolve();await h.flush();
 assert.deepEqual(adopted,[]);assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));h.unmount();
});

test('unmount suppresses a pending activation result and duplicate attach clicks issue a single activation',async()=>{
 const gate=deferred(),received=[],h=harness({override:(method,data,standard,{sessions})=>{if(method==='sharedTerminal.open'){const value={...session('held-ssh'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'saved',profileVersion:1}};sessions.set(value.sessionId,value);return value;}if(method==='compute.resource.activate')return gate.promise.then(()=>standard(method,data));return standard(method,data);}});h.update({onResourceChange:value=>received.push(value)});await h.flush();const selector=h.find(n=>n.type==='select');selector.props.onChange({target:{value:'held-ssh'}});selector.props.onChange({target:{value:'held-ssh'}});await h.flush();assert.equal(h.calls.filter(c=>c.method==='compute.resource.activate').length,1);h.unmount();gate.resolve();await h.flush();assert(!received.some(value=>value.sessionId==='held-ssh'));assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));});

test('saved SSH recovery keeps the original target and one request identity across explicit retries',async()=>{
 let attempts=0;const target={kind:'ssh',mode:'interactive',profileId:'saved-exact',version:7};
 const h=harness({request:{nonce:'saved-exact-request',...target},override:(method,data,standard)=>{if(method==='sharedTerminal.open'&&attempts++<2)throw Error('terminal_recovery_required');return standard(method,data);}});
 await h.flush();const panel=()=>h.text(h.find(n=>n.props?.['data-testid']==='shared-terminal-panel'));
 assert(panel().includes('原会话已保留'));assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);
 h.find(n=>n.props?.['data-testid']==='shared-terminal-recovery-refresh').props.onClick();await h.flush();
 assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1,'refresh is read-only');
 h.click('保留原会话，另开新连接');await h.flush();assert(panel().includes('原会话已保留'));
 h.click('保留原会话，另开新连接');await h.flush();
 const opens=h.calls.filter(c=>c.method==='sharedTerminal.open');assert.deepEqual(opens[0].data,target);
 assert.deepEqual(opens[1].data,{...target,newConnection:true,requestId:opens[1].data.requestId});
 assert.match(opens[1].data.requestId,/^[a-f0-9-]{36}$/);assert.deepEqual(opens[2].data,opens[1].data);
 assert(!panel().includes('另开新连接'));assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));h.unmount();
});

test('recovery double click dispatches once and a late new connection cannot attach after context change',async()=>{
 const gate=deferred(),received=[];let attempts=0;
 const h=harness({request:{nonce:'recovery-A',kind:'ssh',mode:'interactive',profileId:'saved-A',version:2},override:(method,data,standard,{sessions})=>{
  if(method==='sharedTerminal.open'){if(attempts++===0)throw Error('terminal_unavailable');return gate.promise.then(()=>{const value={...session('old-context-new-ssh'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'saved-A',profileVersion:2}};sessions.set(value.sessionId,value);return value;});}return standard(method,data);
 }});h.update({resourceScope:'scope-A',onResourceChange:value=>received.push(value)});await h.flush();
 const button=h.find(n=>n.props?.['data-testid']==='shared-terminal-recovery-new');button.props.onClick();button.props.onClick();await h.flush();
 assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,2);assert.equal(h.find(n=>n.props?.['data-testid']==='shared-terminal-recovery-new').props.disabled,true);
 h.update({resourceScope:'scope-B'});await h.flush();gate.resolve();await h.flush();
 assert(!h.text(h.find(n=>n.props?.['data-testid']==='shared-terminal-panel')).includes('另开新连接'));
 assert(!h.calls.some(c=>c.method==='compute.resource.activate'));assert(!received.some(value=>value.sessionId==='old-context-new-ssh'));assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));h.unmount();
});

test('recovery disappears when provider or request identity changes and stale open errors stay silent',async()=>{
 for(const change of [{provider:'kimi'},{request:{nonce:'request-B',kind:'local',mode:'interactive'}},{resourceScope:'other-scope'}]){
  const gate=deferred();let attempts=0;
  const h=harness({override:(method,data,standard)=>method==='sharedTerminal.open'&&attempts++===0?gate.promise.then(()=>{throw Error('terminal_recovery_required');}):standard(method,data)});
  await h.flush();h.update(change);await h.flush();gate.resolve();await h.flush();
  assert(!h.text(h.find(n=>n.props?.['data-testid']==='shared-terminal-panel')).includes('另开新'));assert.deepEqual(h.errors,[]);
  assert(!h.calls.some(c=>c.method==='sharedTerminal.open'&&c.data.newConnection));h.unmount();
 }
});

test('safe terminal errors preserve distinct feedback without exposing backend detail',async()=>{
 const expected={terminal_runtime_unavailable:'终端运行文件暂不可用',terminal_start_failed:'终端启动未完成',terminal_session_limit:'终端会话数量已达上限',terminal_session_exited:'终端进程已退出',terminal_owner_changed:'终端操作权已变化',terminal_operation_failed:'连接记录仍保留',unexpected:'终端操作未完成'};
 for(const [code,message]of Object.entries(expected)){
  const h=harness({override:(method,data,standard)=>{if(method==='sharedTerminal.open')throw Error(code+' PRIVATE_TOKEN_HOST_OUTPUT');return standard(method,data);}});await h.flush();
  const text=h.text(h.find(n=>n.props?.['data-testid']==='shared-terminal-panel'));assert(text.includes(message),text);
  assert(h.errors.every(error=>String(error).includes(message)&&!String(error).includes('PRIVATE_TOKEN_HOST_OUTPUT')));assert(!text.includes('PRIVATE_TOKEN_HOST_OUTPUT'));assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));h.unmount();
 }
});

test('read and resize failures show safe specific notices and never open another session',async()=>{
 for(const operation of ['sharedTerminal.read','sharedTerminal.resize']){
  const h=harness({override:(method,data,standard)=>{if(method===operation)throw Error('terminal_owner_changed PRIVATE_OUTPUT');return standard(method,data);}});await h.flush();
  const text=h.text(h.find(n=>n.props?.['data-testid']==='shared-terminal-panel'));assert(text.includes('终端操作权已变化'),text);assert(!text.includes('PRIVATE_OUTPUT'));
  assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));h.unmount();
 }
});

test('late list failure and late read failure cannot publish feedback after unmount or context change',async()=>{
 for(const method of ['sharedTerminal.list','sharedTerminal.read']){
  const gate=deferred();let held=false;
  const h=harness({override:(name,data,standard)=>name===method&&!held?(held=true,gate.promise.then(()=>{throw Error('terminal_unavailable PRIVATE_OLD');})):standard(name,data)});
  await h.flush();h.update({resourceScope:'new-owner'});await h.flush();h.unmount();gate.resolve();await h.flush();assert.deepEqual(h.errors,[]);
 }
});


const serviceSnapshot=(value={})=>({status:'connecting',sessionId:'ssh-owned',profileId:'saved-ssh',profileVersion:3,attemptId:'owned-attempt',revision:1,phase:'waiting_python',phaseStartedAt:Date.now()-4000,startedAt:Date.now()-6000,updatedAt:Date.now(),terminalAccess:'reserved',workflowReady:false,...value});
function serviceHarness({initial=null,connect,disconnect,status}={}){
 const control={state:initial,opened:false};
 const h=harness({request:{nonce:'service-login',kind:'ssh',mode:'interactive',profileId:'saved-ssh',version:3},override:(method,data,standard,context)=>{
  if(method==='sharedTerminal.open'){control.opened=true;const value={...session('ssh-owned'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'saved-ssh',profileVersion:3}};context.sessions.set(value.sessionId,value);return value;}
  if(method==='compute.sshService.status'){if(control.opened&&status)return status(control);return structuredClone(control.opened&&control.state||{status:'disconnected',revision:0,terminalAccess:'available'});}
  if(method==='compute.sshService.connect'){const result=connect?.(data,control,context)||Promise.resolve(control.state);queueMicrotask(()=>h.events.get('studio:event')?.({method:'studio/sshServiceChanged'}));return result;}
  if(method==='compute.sshService.disconnect')return disconnect?.(data,control,context)||Promise.resolve(control.state);
  return standard(method,data);
 }});
 const set=(value,{terminal=true}={})=>{control.state=value;if(terminal&&h.sessions.has('ssh-owned')){const current=h.sessions.get('ssh-owned');h.sessions.set('ssh-owned',{...current,serviceActive:value?.terminalAccess!=='available',serviceStatus:value?.status||'idle'});}h.events.get('studio:event')?.({method:'studio/sshServiceChanged',params:value});};
 return {...h,set,control};
}
const panelText=h=>h.text(h.find(n=>n.props?.['data-testid']==='shared-terminal-panel'));
const testId=(h,id)=>h.find(n=>n.props?.['data-testid']===id);

test('real status snapshots show stages and ACK-only transfer progress without claiming whole-service completion or cache reuse',async()=>{
 const gate=deferred();let attempt;
 const h=serviceHarness({connect:(data,c)=>{attempt=data.requestId;c.state=serviceSnapshot({attemptId:attempt});return gate.promise;}});await h.flush();h.click('登录完成，连接作业服务');await h.flush();
 assert(panelText(h).includes('等待远端 Python 响应'));assert(panelText(h).includes('本阶段已用时'));assert(!panelText(h).includes('%'));
 h.set(serviceSnapshot({attemptId:attempt,revision:2,phase:'checking_cache'}));await h.flush();assert(panelText(h).includes('检查远端服务缓存和权限'));assert(!panelText(h).includes('已复用'));
 h.set(serviceSnapshot({attemptId:attempt,revision:3,phase:'transferring_worker',progress:{kind:'transfer',completedBytes:2048,totalBytes:8192}}));await h.flush();
 const transfer=testId(h,'ssh-service-transfer'),bar=h.find(n=>n.type==='progress');assert.equal(bar.props.value,2048);assert.equal(bar.props.max,8192);assert(h.text(transfer).includes('25%'));assert(h.text(transfer).includes('已确认传输'));
 h.set(serviceSnapshot({attemptId:attempt,revision:4,phase:'checking_tools',progress:{kind:'transfer',completedBytes:8192,totalBytes:8192}}));await h.flush();assert(panelText(h).includes('核对工作流工具'));assert(!panelText(h).includes('%'));
 const ready=serviceSnapshot({attemptId:attempt,revision:5,status:'connected',phase:'ready',workflowReady:true});h.set(ready);gate.resolve(ready);await h.flush();assert(panelText(h).includes('作业服务已就绪'));
 assert.equal(h.calls.filter(c=>c.method==='compute.sshService.connect').length,1);assert(!h.calls.some(c=>['agent.rpc','task.execute','sharedTerminal.owner','compute.sshService.scheduler'].includes(c.method)));h.unmount();
});

test('typed failed diagnostics survive terminal polling and refresh while unknown ownership never enables raw input',async()=>{
 const gate=deferred();let attempt;
 const h=serviceHarness({connect:(data,c)=>{attempt=data.requestId;c.state=serviceSnapshot({attemptId:attempt});return gate.promise;}});await h.flush();h.click('登录完成，连接作业服务');await h.flush();
 const failed=serviceSnapshot({attemptId:attempt,revision:2,status:'unknown',phase:'preparing_runtime',terminalAccess:'unknown',error:{code:'namespace_unsafe',phase:'checking_cache',message:'PRIVATE_PATH_TOKEN',python:[3,9,2]}});
 h.set(failed,{terminal:false});gate.resolve(failed);await h.flush();h.tick();await h.flush();
 assert(panelText(h).includes('目录的归属、权限或链接'));assert(panelText(h).includes('失败阶段'));assert(panelText(h).includes('Python 3.9.2'));assert(!panelText(h).includes('PRIVATE_PATH_TOKEN'));assert(testId(h,'ssh-service-unknown'));assert.equal(h.views.at(-1).options.disableStdin,true);
 const inputs=h.calls.filter(c=>c.method==='sharedTerminal.input').length;h.views.at(-1).input('MUST_REMAIN_PRIVATE');await h.flush();assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.input').length,inputs);
 testId(h,'ssh-service-refresh').props.onClick();await h.flush();assert(panelText(h).includes('目录的归属、权限或链接'));assert.equal(h.calls.filter(c=>c.method==='compute.sshService.connect').length,1);assert(!h.calls.some(c=>c.method==='compute.sshService.disconnect'||c.method==='sharedTerminal.close'));h.unmount();
});

test('a human can cancel an in-flight attempt, but input resumes only after the exact terminal recovery proof',async()=>{
 const connection=deferred(),stopping=deferred();let attempt;
 const h=serviceHarness({connect:(data,c)=>{attempt=data.requestId;c.state=serviceSnapshot({attemptId:attempt});return connection.promise;},disconnect:(data,c)=>{assert.deepEqual(data,{sessionId:'ssh-owned',attemptId:attempt});c.state=serviceSnapshot({attemptId:attempt,revision:3,status:'disconnecting',phase:'returning_terminal',terminalAccess:'unknown'});return stopping.promise;}});await h.flush();h.click('登录完成，连接作业服务');await h.flush();
 const cancel=testId(h,'ssh-service-disconnect');assert.equal(cancel.props.disabled,false);assert.equal(h.text(cancel),'停止接入并返回终端');cancel.props.onClick();cancel.props.onClick();await h.flush();assert.equal(h.calls.filter(c=>c.method==='compute.sshService.disconnect').length,1);assert.equal(h.views.at(-1).options.disableStdin,true);
 const final=serviceSnapshot({attemptId:attempt,revision:4,status:'disconnected',phase:'returning_terminal',terminalAccess:'available'});h.set(final);stopping.resolve(final);await h.flush();assert.equal(h.views.at(-1).options.disableStdin,false);assert(panelText(h).includes('SSH 连接保持打开'));
 const ready=serviceSnapshot({attemptId:attempt,revision:2,status:'connected',phase:'ready',workflowReady:true});connection.resolve(ready);await h.flush();assert(!panelText(h).includes('作业服务已就绪'));
 h.views.at(-1).input('after confirmed recovery\r');await h.flush();assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.input').length,1);assert.equal(h.calls.filter(c=>c.method==='compute.sshService.connect').length,1);assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));h.unmount();
});

test('unconfirmed stop remains read-only and only an explicit close ends the selected SSH session',async()=>{
 const initial=serviceSnapshot({status:'unknown',terminalAccess:'unknown',error:{code:'startup_timeout',phase:'waiting_python'}});
 const h=serviceHarness({initial,disconnect:(_data,c)=>{c.state=serviceSnapshot({revision:2,status:'unknown',phase:'returning_terminal',terminalAccess:'unknown',error:{code:'stop_timeout',phase:'returning_terminal'}});return c.state;}});await h.flush();h.click('返回交互终端');await h.flush();
 assert(panelText(h).includes('返回终端的确认超时'));assert.equal(h.views.at(-1).options.disableStdin,true);assert.equal(h.calls.filter(c=>c.method==='compute.sshService.disconnect').length,1);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));
 h.click('结束此 SSH 会话');await h.flush();assert.deepEqual(h.calls.filter(c=>c.method==='sharedTerminal.close').map(c=>c.data),[{sessionId:'ssh-owned'}]);assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);h.unmount();
});

test('safe unknown errors and rejected IPC never echo remote messages, paths or authentication output',async()=>{
 for(const error of [{code:'not_allowlisted_PRIVATE',phase:'waiting_python',message:'PRIVATE_STDERR'},null]){
  const gate=deferred();let attempt;
  const h=serviceHarness({connect:(data,c)=>{attempt=data.requestId;c.state=serviceSnapshot({attemptId:attempt,status:'unknown',terminalAccess:'unknown',error});return error?Promise.resolve(c.state):gate.promise.then(()=>{throw Error('UNEXPECTED PRIVATE_STDERR /private/auth');});}});await h.flush();h.click('登录完成，连接作业服务');await h.flush();if(!error){gate.resolve();await h.flush();}
  const text=panelText(h);assert(!text.includes('PRIVATE'));assert(!text.includes('/private/auth'));assert(text.includes('重新核对状态'));assert(!h.calls.some(c=>c.method==='sharedTerminal.close'||c.method==='compute.sshService.disconnect'));h.unmount();
 }
});

test('late status from an old scope or a lower revision cannot overwrite a newer service snapshot',async()=>{
 const initial=serviceSnapshot({status:'connected',phase:'ready',workflowReady:true,revision:9});const h=serviceHarness({initial});await h.flush();assert(panelText(h).includes('作业服务已就绪'));
 h.set(serviceSnapshot({status:'unknown',phase:'waiting_python',revision:8,error:{code:'startup_timeout',phase:'waiting_python'}}));await h.flush();assert(panelText(h).includes('作业服务已就绪'));assert(!panelText(h).includes('启动响应超时'));
 h.update({resourceScope:'replacement-scope'});await h.flush();h.unmount();h.set(serviceSnapshot({status:'unknown',revision:10,error:{code:'namespace_unsafe',phase:'checking_cache'}}));await h.flush();assert(!h.calls.some(c=>c.method==='compute.sshService.disconnect'||c.method==='sharedTerminal.close'));assert.deepEqual(h.errors,[]);
});

test('invalid transfer counters and progress outside transfer stages never produce a percentage',async()=>{
 for(const change of [{phase:'checking_cache',progress:{kind:'transfer',completedBytes:1,totalBytes:2}},{phase:'transferring_worker',progress:{kind:'transfer',completedBytes:3,totalBytes:2}},{phase:'transferring_transport',progress:{kind:'transfer',completedBytes:0,totalBytes:0}}]){
  const h=serviceHarness({initial:serviceSnapshot(change)});await h.flush();assert(!panelText(h).includes('%'));h.unmount();
 }
});


test('cancel before queued login input drains never dispatches a later service start',async()=>{
 const input=deferred();const h=harness({request:{nonce:'queued-login',kind:'ssh',mode:'interactive',profileId:'saved-ssh',version:3},override:(method,data,standard,{sessions})=>{
  if(method==='sharedTerminal.open'){const value={...session('ssh-queued'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'saved-ssh',profileVersion:3}};sessions.set(value.sessionId,value);return value;}
  if(method==='sharedTerminal.input')return input.promise;return standard(method,data);
 }});await h.flush();h.views.at(-1).input('final login input\r');await h.flush();h.click('登录完成，连接作业服务');await h.flush();assert(!h.calls.some(c=>c.method==='compute.sshService.connect'));
 h.click('停止接入并返回终端');await h.flush();input.resolve({accepted:true});await h.flush();assert(panelText(h).includes('尚未向远端启动作业服务'));assert(!h.calls.some(c=>c.method==='compute.sshService.connect'||c.method==='compute.sshService.disconnect'||c.method==='sharedTerminal.close'));assert.equal(h.views.at(-1).options.disableStdin,false);h.unmount();
});

test('a stale return button for attempt A cannot stop a newer attempt B on the same terminal',async()=>{
 const h=serviceHarness({initial:serviceSnapshot({attemptId:'attempt-A',revision:5,status:'unknown',terminalAccess:'unknown'})});await h.flush();const old=testId(h,'ssh-service-disconnect');
 h.set(serviceSnapshot({attemptId:'attempt-B',revision:6,status:'connected',phase:'ready',workflowReady:true}));await h.flush();old.props.onClick();await h.flush();assert(!h.calls.some(c=>c.method==='compute.sshService.disconnect'));assert(panelText(h).includes('未发送停止命令'));h.unmount();
});


test('an old in-flight status cannot publish errors or consume a newer scope revision',async()=>{
 const stale=deferred();let reads=0;const ready=serviceSnapshot({revision:10,status:'connected',phase:'ready',workflowReady:true});
 const h=serviceHarness({initial:ready,status:c=>reads++===0?stale.promise:Promise.resolve(c.state)});h.update({resourceScope:'scope-A'});await h.flush();h.update({resourceScope:'scope-B'});await h.flush();assert(panelText(h).includes('作业服务已就绪'));
 stale.resolve(serviceSnapshot({revision:99,status:'unknown',terminalAccess:'unknown',error:{code:'permission_denied',phase:'preparing_runtime'}}));await h.flush();assert(!panelText(h).includes('拒绝访问'));assert(panelText(h).includes('作业服务已就绪'));
 h.set(serviceSnapshot({revision:11,status:'connected',phase:'checking_tools'}));await h.flush();assert(panelText(h).includes('核对工作流工具'));assert(!h.calls.some(c=>c.method==='compute.sshService.disconnect'||c.method==='sharedTerminal.close'));h.unmount();
});

test('a status for a different saved profile cannot release the current reserved lane',async()=>{
 const h=serviceHarness({initial:serviceSnapshot({status:'unknown',terminalAccess:'unknown',error:{code:'connection_unconfirmed',phase:'waiting_python'}})});await h.flush();
 h.set(serviceSnapshot({revision:9,profileId:'other-profile',status:'disconnected',terminalAccess:'available'}));await h.flush();assert.equal(h.views.at(-1).options.disableStdin,true);assert(testId(h,'ssh-service-unknown'));h.unmount();
});


test('the Python first-response timeout identifies only missing confirmation and keeps the lane private without retries',async()=>{
 const h=serviceHarness({initial:serviceSnapshot({status:'unknown',phase:'waiting_python',terminalAccess:'unknown',error:{code:'python_response_timeout',phase:'waiting_python'}})});await h.flush();
 const text=panelText(h);assert(text.includes('等待远端 Python 响应超时'));assert(text.includes('不能据此判断 Python 未安装'));assert.equal(h.views.at(-1).options.disableStdin,true);
 testId(h,'ssh-service-refresh').props.onClick();await h.flush();assert(!h.calls.some(c=>c.method==='compute.sshService.connect'||c.method==='compute.sshService.disconnect'||c.method==='sharedTerminal.close'));assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);h.unmount();
});

test('confirmed cancel clears an old connect rejection and its completed recovery display',async()=>{
 const connection=deferred(),stop=deferred();let attempt;
 const h=serviceHarness({connect:(data,c)=>{attempt=data.requestId;c.state=serviceSnapshot({attemptId:attempt});return connection.promise.then(()=>{throw Error('service_disconnected');});},disconnect:(_data,c)=>{c.state=serviceSnapshot({attemptId:attempt,revision:2,status:'disconnecting',phase:'returning_terminal'});return stop.promise;}});
 await h.flush();h.click('登录完成，连接作业服务');await h.flush();h.click('停止接入并返回终端');await h.flush();connection.resolve();await h.flush();
 assert(testId(h,'ssh-service-error'));assert.equal(h.views.at(-1).options.disableStdin,true);
 const final=serviceSnapshot({attemptId:attempt,revision:4,status:'disconnected',phase:undefined,phaseStartedAt:undefined,terminalAccess:'available'});h.set(final);stop.resolve(final);await h.flush();
 assert.throws(()=>testId(h,'ssh-service-error'),/actual panel node missing/);assert.throws(()=>testId(h,'ssh-service-status'),/actual panel node missing/);assert(panelText(h).includes('SSH 连接保持打开'));assert.equal(h.views.at(-1).options.disableStdin,false);assert.equal(h.calls.filter(c=>c.method==='compute.sshService.disconnect').length,1);h.unmount();
});

test('a late rejected cancellation acknowledgement never clears a newer attempt error or announces recovery',async()=>{
 const stop=deferred(),initial=serviceSnapshot({attemptId:'attempt-A',revision:4,status:'unknown',terminalAccess:'unknown'});
 const h=serviceHarness({initial,disconnect:()=>stop.promise});await h.flush();h.click('返回交互终端');await h.flush();
 h.set(serviceSnapshot({attemptId:'attempt-B',revision:7,status:'unknown',terminalAccess:'unknown',error:{code:'namespace_unsafe',phase:'checking_cache'}}));await h.flush();
 stop.resolve(serviceSnapshot({attemptId:'attempt-A',revision:6,status:'disconnected',phase:undefined,terminalAccess:'available'}));await h.flush();assert(panelText(h).includes('目录的归属、权限或链接'));assert(!panelText(h).includes('SSH 连接保持打开'));assert.equal(h.views.at(-1).options.disableStdin,true);h.unmount();
});

test('temporary out-of-range terminal geometry never sends an invalid resize and resumes when valid',async()=>{
 const h=harness();await h.flush();const view=h.views.at(-1),before=h.calls.filter(c=>c.method==='sharedTerminal.resize').length;
 for(const [cols,rows] of [[100,1],[9,30],[501,30],[100,301],[100,2.5]]){view.cols=cols;view.rows=rows;h.appearance(15);await h.flush();assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.resize').length,before);}
 view.cols=10;view.rows=2;h.appearance(16);await h.flush();const calls=h.calls.filter(c=>c.method==='sharedTerminal.resize');assert.equal(calls.length,before+1);assert.deepEqual(calls.at(-1).data,{sessionId:'session-1',cols:10,rows:2});assert(!panelText(h).includes('终端操作未完成'));h.unmount();
});


test('opening another terminal keeps the active view and shows pending feedback',async()=>{
 const gate=deferred();let opens=0;const h=harness({override:(method,data,standard)=>method==='sharedTerminal.open'&&++opens===2?gate.promise:standard(method,data)});
 try{await h.flush();const selected=h.find(node=>node.type==='select').props.value;h.update({request:{nonce:'second-open',kind:'local',mode:'interactive'}});await h.flush();assert.equal(h.find(node=>node.type==='select').props.value,selected);assert(h.find(node=>node.props?.label==='正在打开终端…').props.busy);gate.resolve(session('second'));await h.flush();assert.equal(h.find(node=>node.type==='select').props.value,'second');assert.deepEqual(h.errors,[]);}finally{h.unmount();}
});
