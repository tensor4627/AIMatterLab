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
 function render(){cursor=0;dirty=false;tree=module.exports.LegacySharedTerminalPanel(props);for(const node of all(tree))if(node.props?.ref)node.props.ref.current={clientWidth:800,clientHeight:300};}
 async function flush(){for(let i=0;i<25;i++){while(effects.length)effects.shift()();await new Promise(r=>setImmediate(r));if(dirty&&!disposed)render();}}
 const find=p=>{const value=all(tree).find(p);assert(value,'actual panel node missing');return value;};const click=label=>{const n=find(n=>n.type==='button'&&text(n)===label);assert(!n.props.disabled,'button disabled');n.props.onClick();render();};
 render();return{calls,errors,views,sessions,events,flush,find,click,text,update:v=>{Object.assign(props,v);render();},appearance:v=>{font=v;events.get('studio:appearance')?.();},fits:()=>fits,tick:()=>{for(const f of timers.values())f();},unmount:()=>{disposed=true;for(const h of hooks)h?.cleanup?.();}};
}

test('active service A blocks dropdown, detached view and external open B without changing the visible session',async()=>{
 let opened=false;const h=harness({request:{nonce:'A',kind:'ssh',mode:'interactive',profileId:'profile-A',version:1},override:(method,data,standard,{sessions})=>{if(method==='compute.sshService.status')return opened?{status:'connected',sessionId:'A',profileId:'profile-A',profileVersion:1}:{status:'disconnected'};if(method==='sharedTerminal.open'){opened=true;const a={...session('A'),kind:'ssh',serviceActive:true,serviceStatus:'connected',resource:{kind:'ssh-terminal',profileId:'profile-A',profileVersion:1}};sessions.set('A',a);sessions.set('B',{...session('B'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'profile-B',profileVersion:1}});return a;}return standard(method,data);}});await h.flush();const dropdown=h.find(node=>node.type==='select');assert.equal(dropdown.props.disabled,true);dropdown.props.onChange({target:{value:'B'}});await h.flush();assert.equal(h.find(node=>node.type==='select').props.value,'A');assert.equal(h.calls.some(call=>call.method==='compute.resource.activate'&&call.data.sessionId==='B'),false);h.update({request:{nonce:'B',kind:'ssh',mode:'interactive',profileId:'profile-B',version:1}});await h.flush();assert.equal(h.calls.filter(call=>call.method==='sharedTerminal.open').length,1);assert.equal(h.find(node=>node.type==='select').props.value,'A');assert(h.text(h.find(node=>node.props?.className==='shared-terminal-notice'&&h.text(node).includes('连接计算资源中停止当前作业服务'))));assert.equal(h.calls.some(call=>call.method==='compute.sshService.disconnect'),false);h.unmount();
});

test('resource activation refusal never commits B to the visible terminal even if the local service hint was stale',async()=>{
 const h=harness({override:(method,data,standard,{sessions})=>{if(method==='sharedTerminal.open'){const a={...session('A'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'profile-A',profileVersion:1}};sessions.set('A',a);sessions.set('B',{...session('B'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'profile-B',profileVersion:1}});return a;}if(method==='compute.resource.activate'&&data.sessionId==='B')throw Error('请先在原 SSH 连接返回交互终端，再切换计算资源。');return standard(method,data);}});await h.flush();h.find(node=>node.type==='select').props.onChange({target:{value:'B'}});await h.flush();assert.equal(h.find(node=>node.type==='select').props.value,'A');assert.equal(h.calls.some(call=>call.method==='compute.sshService.disconnect'),false);h.unmount();
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
 const received=[],h=harness({override:(method,data,standard,{sessions})=>{if(method==='sharedTerminal.open'){const value={...session('same-ssh'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'saved',profileVersion:2}};sessions.set(value.sessionId,value);return value;}return standard(method,data);}});h.update({resourceScope:'same-owner',onResourceChange:value=>received.push(value)});await h.flush();h.click('登录完成，交给 Agent');await h.flush();assert.equal(received.at(-1).agentReady,true);h.click('我来操作');await h.flush();assert.equal(received.at(-1).operator,'human');const before=h.calls.filter(c=>c.method==='compute.resource.activate').length;h.click('分离视图');h.find(n=>n.type==='select').props.onChange({target:{value:'same-ssh'}});await h.flush();assert.equal(h.calls.filter(c=>c.method==='compute.resource.activate').length,before+1);assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));assert.deepEqual(h.errors,[]);h.unmount();
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


const serviceSnapshot=(value={})=>({status:'connecting',sessionId:'ssh-owned',profileId:'saved-ssh',profileVersion:3,attemptId:'owned-attempt',revision:1,phase:'waiting_python',phaseStartedAt:Date.now()-4000,startedAt:Date.now()-6000,updatedAt:Date.now(),terminalAccess:'reserved',workflowReady:false,operator:'human',...value});
const reserved=value=>!!value&&(value.terminalAccess==='reserved'||value.terminalAccess==='unknown'||['connecting','connected','disconnecting','unknown'].includes(value.status));
function serviceHarness({initial=null,status,operation}={}){
 const control={state:initial,opened:false};
 const h=harness({request:{nonce:'service-login',kind:'ssh',mode:'interactive',profileId:'saved-ssh',version:3},override:(method,data,standard,context)=>{
  const custom=operation?.(method,data,standard,context,control);if(custom!==undefined)return custom;
  if(method==='sharedTerminal.open'){control.opened=true;const value={...session('ssh-owned'),kind:'ssh',ownerEpoch:reserved(control.state)?2:1,serviceActive:reserved(control.state),serviceStatus:control.state?.status||'idle',resource:{kind:'ssh-terminal',profileId:'saved-ssh',profileVersion:3}};context.sessions.set(value.sessionId,value);return value;}
  if(method==='compute.sshService.status'){if(control.opened&&status)return status(control);return structuredClone(control.opened&&control.state||{status:'disconnected',revision:0,terminalAccess:'available'});}
  if(method==='sharedTerminal.owner'){
   const current=context.sessions.get(data.sessionId);assert.equal(data.ownerEpoch,current.ownerEpoch,'handoff must use the actual broker epoch');
   if(control.state?.status==='connected'&&control.state.workflowReady){control.state={...control.state,operator:data.owner,revision:control.state.revision+1};return {...structuredClone(current),handoffKind:'service',serviceOwner:data.owner};}
  }
  return standard(method,data);
 }});
 const set=(value,{terminal=true}={})=>{control.state=value;if(terminal&&h.sessions.has('ssh-owned')){const current=h.sessions.get('ssh-owned'),serviceActive=reserved(value);h.sessions.set('ssh-owned',{...current,ownerEpoch:current.ownerEpoch+(current.serviceActive===serviceActive?0:1),serviceActive,serviceStatus:value?.status||'idle'});}h.events.get('studio:event')?.({method:'studio/sshServiceChanged',params:value});};
 return {...h,set,control};
}
const panelText=h=>h.text(h.find(n=>n.props?.['data-testid']==='shared-terminal-panel'));
const testId=(h,id)=>h.find(n=>n.props?.['data-testid']===id);
const noServiceMutations=h=>assert(!h.calls.some(c=>['compute.sshService.connect','compute.sshService.disconnect','compute.sshService.scheduler'].includes(c.method)));

test('interactive login has one explicit handoff and points service maintenance to connection settings without starting a service',async()=>{
 const h=serviceHarness();await h.flush();assert.equal(h.text(testId(h,'shared-terminal-handoff')),'登录完成，交给 Agent');
 for(const id of ['ssh-service-connect','ssh-service-disconnect'])assert.throws(()=>testId(h,id),/actual panel node missing/);
 assert(panelText(h).includes('作业服务设置、检查和更新位于连接计算资源'));assert(!panelText(h).includes('连接作业服务'));
 h.tick();await h.flush();noServiceMutations(h);assert(!h.calls.some(c=>c.method==='sharedTerminal.owner'));assert.equal(h.views.at(-1).options.disableStdin,false);h.unmount();
});

test('ready service handoff and reclaim use service ownership while the raw shell stays human and read-only',async()=>{
 const h=serviceHarness({initial:serviceSnapshot({status:'connected',phase:'ready',workflowReady:true})});h.update({provider:'kimi'});await h.flush();
 assert.equal(testId(h,'shared-terminal-handoff').props.disabled,false);assert(panelText(h).includes('作业服务由你操作'));assert.equal(h.views.at(-1).options.disableStdin,true);
 h.click('交给 Agent');await h.flush();assert(panelText(h).includes('Agent 使用作业服务'));assert.equal(h.text(testId(h,'shared-terminal-handoff')),'我来操作');
 assert.equal(h.sessions.get('ssh-owned').owner,'human');assert.equal(h.sessions.get('ssh-owned').ownerEpoch,2);assert.equal(h.views.at(-1).options.disableStdin,true);
 h.views.at(-1).input('MUST_STAY_PRIVATE');await h.flush();assert(!h.calls.some(c=>c.method==='sharedTerminal.input'));
 h.click('我来操作');await h.flush();assert(panelText(h).includes('作业服务由你操作'));assert.equal(h.views.at(-1).options.disableStdin,true);
 assert.deepEqual(h.calls.filter(c=>c.method==='sharedTerminal.owner').map(c=>c.data),[{sessionId:'ssh-owned',ownerEpoch:2,owner:'agent',provider:'kimi'},{sessionId:'ssh-owned',ownerEpoch:2,owner:'human'}]);
 noServiceMutations(h);assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);assert.deepEqual(h.errors,[]);h.unmount();
});

test('service ownership response updates the button while a subsequent readonly status refresh is still pending',async()=>{
 const statusGate=deferred();let hold=false;const h=serviceHarness({initial:serviceSnapshot({status:'connected',phase:'ready',workflowReady:true}),status:c=>hold?statusGate.promise:structuredClone(c.state)});await h.flush();hold=true;
 h.click('交给 Agent');await h.flush();assert(panelText(h).includes('Agent 使用作业服务'));assert.equal(h.text(testId(h,'shared-terminal-handoff')),'我来操作');assert.equal(h.views.at(-1).options.disableStdin,true);
 statusGate.resolve(structuredClone(h.control.state));await h.flush();assert.equal(testId(h,'shared-terminal-handoff').props.disabled,false);noServiceMutations(h);h.unmount();
});

test('connecting, stopping, unconfirmed and incomplete ready service states block handoff and raw input',async()=>{
 for(const change of [{status:'connecting'},{status:'disconnecting',phase:'returning_terminal'},{status:'unknown',terminalAccess:'unknown'},{status:'connected',phase:'ready',workflowReady:false},{status:'connected',phase:'ready',workflowReady:true,terminalAccess:'unknown'}]){
  const h=serviceHarness({initial:serviceSnapshot(change)});await h.flush();assert.equal(testId(h,'shared-terminal-handoff').props.disabled,true);assert.equal(h.views.at(-1).options.disableStdin,true);
  h.views.at(-1).input('DO_NOT_SEND');await h.flush();assert(!h.calls.some(c=>c.method==='sharedTerminal.input'));testId(h,'ssh-service-refresh').props.onClick();await h.flush();noServiceMutations(h);assert(!h.calls.some(c=>c.method==='sharedTerminal.owner'));h.unmount();
 }
});

test('external service reservation and release refresh the full broker epoch before handing the shell to Agent',async()=>{
 const h=serviceHarness();await h.flush();assert.equal(h.sessions.get('ssh-owned').ownerEpoch,1);
 h.set(serviceSnapshot({status:'connected',phase:'ready',workflowReady:true,revision:2}));await h.flush();assert.equal(h.sessions.get('ssh-owned').ownerEpoch,2);assert.equal(h.views.at(-1).options.disableStdin,true);
 h.set(serviceSnapshot({status:'disconnected',phase:undefined,terminalAccess:'available',revision:3}));await h.flush();assert.equal(h.sessions.get('ssh-owned').ownerEpoch,3);assert.equal(h.views.at(-1).options.disableStdin,false);
 h.click('登录完成，交给 Agent');await h.flush();assert.equal(h.calls.find(c=>c.method==='sharedTerminal.owner').data.ownerEpoch,3);assert.equal(h.sessions.get('ssh-owned').ownerEpoch,4);assert.equal(h.sessions.get('ssh-owned').owner,'agent');assert.equal(h.views.at(-1).options.disableStdin,true);noServiceMutations(h);assert.deepEqual(h.errors,[]);h.unmount();
});

test('a release status alone cannot enable handoff while the full session refresh is pending',async()=>{
 const gate=deferred();let hold=false;const h=serviceHarness({initial:serviceSnapshot({status:'connected',phase:'ready',workflowReady:true}),operation:(method,_data,_standard,{sessions})=>method==='sharedTerminal.list'&&hold?gate.promise.then(()=>({sessions:[...sessions.values()].map(v=>structuredClone(v))})):undefined});await h.flush();hold=true;
 h.set(serviceSnapshot({status:'disconnected',phase:undefined,terminalAccess:'available',revision:2}));await h.flush();assert.equal(testId(h,'shared-terminal-handoff').props.disabled,true);assert.equal(h.views.at(-1).options.disableStdin,true);
 h.views.at(-1).input('MUST_WAIT_FOR_RECOVERY');await h.flush();assert(!h.calls.some(c=>c.method==='sharedTerminal.input'));
 hold=false;gate.resolve();await h.flush();assert.equal(testId(h,'shared-terminal-handoff').props.disabled,false);assert.equal(h.views.at(-1).options.disableStdin,false);h.click('登录完成，交给 Agent');await h.flush();assert.equal(h.calls.find(c=>c.method==='sharedTerminal.owner').data.ownerEpoch,3);h.unmount();
});

test('explicit handoff waits for already sent login input and duplicate clicks dispatch once',async()=>{
 const input=deferred(),handoff=deferred();let hold=true;const h=serviceHarness({operation:(method,data,standard)=>method==='sharedTerminal.input'?input.promise:method==='sharedTerminal.owner'&&hold?handoff.promise.then(()=>standard(method,data)):undefined});await h.flush();
 h.views.at(-1).input('last authentication response\r');await h.flush();const button=testId(h,'shared-terminal-handoff');button.props.onClick();button.props.onClick();await h.flush();assert(!h.calls.some(c=>c.method==='sharedTerminal.owner'));assert.equal(h.views.at(-1).options.disableStdin,true);
 input.resolve({accepted:true});await h.flush();assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.owner').length,1);hold=false;handoff.resolve();await h.flush();assert.equal(h.sessions.get('ssh-owned').owner,'agent');noServiceMutations(h);h.unmount();
});

test('handoff drains earlier queued authentication input before granting Agent access without accepting new typing',async()=>{
 const gate=deferred();let writes=0;const h=serviceHarness({operation:(method,_data)=>method==='sharedTerminal.input'&&writes++===0?gate.promise:undefined});await h.flush();
 h.views.at(-1).input('first login response');await h.flush();h.views.at(-1).input('queued authentication response\r');testId(h,'shared-terminal-handoff').props.onClick();h.views.at(-1).input('NEW INPUT AFTER HANDOFF');await h.flush();
 assert(!h.calls.some(c=>c.method==='sharedTerminal.owner'));gate.resolve({accepted:true});await h.flush();
 assert.deepEqual(h.calls.filter(c=>c.method==='sharedTerminal.input').map(c=>c.data.data),['first login response','queued authentication response\r']);
 assert(h.calls.findIndex(c=>c.method==='sharedTerminal.owner')>h.calls.findLastIndex(c=>c.method==='sharedTerminal.input'));assert.equal(h.sessions.get('ssh-owned').owner,'agent');h.unmount();
});

test('real service snapshots show stages and ACK-only transfer progress without claiming whole-service completion or cache reuse',async()=>{
 const h=serviceHarness({initial:serviceSnapshot()});await h.flush();assert(panelText(h).includes('等待远端 Python 响应'));assert(panelText(h).includes('本阶段已用时'));assert(!panelText(h).includes('%'));
 h.set(serviceSnapshot({revision:2,phase:'checking_cache'}));await h.flush();assert(panelText(h).includes('检查远端服务缓存和权限'));assert(!panelText(h).includes('已复用'));
 h.set(serviceSnapshot({revision:3,phase:'transferring_worker',progress:{kind:'transfer',completedBytes:2048,totalBytes:8192}}));await h.flush();const bar=h.find(n=>n.type==='progress');assert.equal(bar.props.value,2048);assert.equal(bar.props.max,8192);assert(h.text(testId(h,'ssh-service-transfer')).includes('25%'));
 h.set(serviceSnapshot({revision:4,phase:'checking_tools',progress:{kind:'transfer',completedBytes:8192,totalBytes:8192}}));await h.flush();assert(panelText(h).includes('核对工作流工具'));assert(!panelText(h).includes('%'));
 h.set(serviceSnapshot({revision:5,status:'connected',phase:'ready',workflowReady:true}));await h.flush();assert(panelText(h).includes('作业服务已就绪'));noServiceMutations(h);assert(!h.calls.some(c=>['agent.rpc','task.execute','sharedTerminal.owner'].includes(c.method)));h.unmount();
});

test('typed failed diagnostics survive terminal polling and refresh while unknown ownership keeps raw input locked',async()=>{
 const failed=serviceSnapshot({revision:2,status:'unknown',phase:'preparing_runtime',terminalAccess:'unknown',error:{code:'namespace_unsafe',phase:'checking_cache',message:'PRIVATE_PATH_TOKEN',python:[3,9,2]}});
 const h=serviceHarness({initial:failed});await h.flush();h.tick();await h.flush();const text=panelText(h);assert(text.includes('目录的归属、权限或链接'));assert(text.includes('失败阶段'));assert(text.includes('Python 3.9.2'));assert(!text.includes('PRIVATE_PATH_TOKEN'));assert(testId(h,'ssh-service-unknown'));assert.equal(h.views.at(-1).options.disableStdin,true);
 testId(h,'ssh-service-refresh').props.onClick();await h.flush();assert(panelText(h).includes('目录的归属、权限或链接'));noServiceMutations(h);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));h.unmount();
});

test('unconfirmed stop stays read-only and explicit session end closes only that SSH session',async()=>{
 const h=serviceHarness({initial:serviceSnapshot({status:'unknown',phase:'returning_terminal',terminalAccess:'unknown',error:{code:'stop_timeout',phase:'returning_terminal'}})});await h.flush();assert(panelText(h).includes('返回终端的确认超时'));assert.equal(h.views.at(-1).options.disableStdin,true);assert.equal(testId(h,'shared-terminal-handoff').props.disabled,true);
 testId(h,'ssh-service-refresh').props.onClick();await h.flush();noServiceMutations(h);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));h.click('结束此 SSH 会话');await h.flush();assert.deepEqual(h.calls.filter(c=>c.method==='sharedTerminal.close').map(c=>c.data),[{sessionId:'ssh-owned'}]);assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);h.unmount();
});

test('safe unknown diagnostics and rejected status refresh never expose remote messages or authentication output',async()=>{
 for(const reject of [false,true]){
  const h=serviceHarness({initial:serviceSnapshot({status:'unknown',terminalAccess:'unknown',error:{code:'not_allowlisted_PRIVATE',phase:'waiting_python',message:'PRIVATE_STDERR'}}),status:reject?()=>{throw Error('UNEXPECTED PRIVATE_STDERR /private/auth');}:undefined});await h.flush();
  const text=panelText(h);assert(!text.includes('PRIVATE'));assert(!text.includes('/private/auth'));assert(text.includes('重新核对状态'));noServiceMutations(h);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));h.unmount();
 }
});

test('lower service revisions cannot release or replace the current service lane',async()=>{
 const h=serviceHarness({initial:serviceSnapshot({status:'connected',phase:'ready',workflowReady:true,revision:9})});await h.flush();assert(panelText(h).includes('作业服务已就绪'));
 h.set(serviceSnapshot({status:'disconnected',terminalAccess:'available',revision:8}),{terminal:false});await h.flush();assert(panelText(h).includes('作业服务已就绪'));assert.equal(h.views.at(-1).options.disableStdin,true);
 h.set(serviceSnapshot({status:'unknown',phase:'waiting_python',revision:8,error:{code:'startup_timeout',phase:'waiting_python'}}),{terminal:false});await h.flush();assert(!panelText(h).includes('启动响应超时'));noServiceMutations(h);h.unmount();
});

test('invalid transfer counters and progress outside transfer stages never produce a percentage',async()=>{
 for(const change of [{phase:'checking_cache',progress:{kind:'transfer',completedBytes:1,totalBytes:2}},{phase:'transferring_worker',progress:{kind:'transfer',completedBytes:3,totalBytes:2}},{phase:'transferring_transport',progress:{kind:'transfer',completedBytes:0,totalBytes:0}}]){
  const h=serviceHarness({initial:serviceSnapshot(change)});await h.flush();assert(!panelText(h).includes('%'));h.unmount();
 }
});

test('an old in-flight service status cannot publish errors or consume a newer scope revision',async()=>{
 const stale=deferred();let reads=0;const ready=serviceSnapshot({revision:10,status:'connected',phase:'ready',workflowReady:true});
 const h=serviceHarness({initial:ready,status:c=>reads++===0?stale.promise:structuredClone(c.state)});h.update({resourceScope:'scope-A'});await h.flush();h.update({resourceScope:'scope-B'});await h.flush();assert(panelText(h).includes('作业服务已就绪'));
 stale.resolve(serviceSnapshot({revision:99,status:'unknown',terminalAccess:'unknown',error:{code:'permission_denied',phase:'preparing_runtime'}}));await h.flush();assert(!panelText(h).includes('拒绝访问'));assert(panelText(h).includes('作业服务已就绪'));
 h.set(serviceSnapshot({revision:11,status:'connected',phase:'checking_tools'}));await h.flush();assert(panelText(h).includes('核对工作流工具'));noServiceMutations(h);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));h.unmount();
});

test('status for a different saved profile cannot release the current reserved lane',async()=>{
 const h=serviceHarness({initial:serviceSnapshot({status:'unknown',terminalAccess:'unknown',error:{code:'connection_unconfirmed',phase:'waiting_python'}})});await h.flush();
 h.set(serviceSnapshot({revision:9,profileId:'other-profile',status:'disconnected',terminalAccess:'available'}),{terminal:false});await h.flush();assert.equal(h.views.at(-1).options.disableStdin,true);assert(testId(h,'ssh-service-unknown'));assert.equal(testId(h,'shared-terminal-handoff').props.disabled,true);h.unmount();
});

test('Python first-response timeout reports missing confirmation and keeps the lane private without retries',async()=>{
 const h=serviceHarness({initial:serviceSnapshot({status:'unknown',phase:'waiting_python',terminalAccess:'unknown',error:{code:'python_response_timeout',phase:'waiting_python'}})});await h.flush();
 const text=panelText(h);assert(text.includes('等待远端 Python 响应超时'));assert(text.includes('不能据此判断 Python 未安装'));assert.equal(h.views.at(-1).options.disableStdin,true);
 testId(h,'ssh-service-refresh').props.onClick();await h.flush();noServiceMutations(h);assert(!h.calls.some(c=>c.method==='sharedTerminal.close'));assert.equal(h.calls.filter(c=>c.method==='sharedTerminal.open').length,1);h.unmount();
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

test('the compatibility selector does not route independent connection shells through the old lane',async()=>{const h=harness({override:(method,data,standard,{sessions})=>{if(method==='sharedTerminal.list')sessions.set('independent',{...session('independent'),connectionId:'connection',kind:'ssh',resource:{kind:'ssh-connection',connectionId:'connection',profileId:'profile',profileVersion:1}});return standard(method,data);}});try{await h.flush();assert.throws(()=>h.find(node=>node.type==='option'&&node.props.value==='independent'));assert(!h.calls.some(call=>call.method==='sharedTerminal.owner'&&call.data.sessionId==='independent'));}finally{h.unmount();}});

test('explicit ordinary SSH never invokes the independent service API or forwards UI-only request fields',async()=>{const request={nonce:'plain',kind:'ssh',mode:'interactive',profileId:'profile',version:1,profileName:'Saved SSH',connectionMode:'plain',connectionId:'must-not-forward'};const h=harness({request,override:(method,data,standard,{sessions})=>{if(method==='sharedTerminal.open'){const value={...session('plain'),kind:'ssh',resource:{kind:'ssh-terminal',profileId:'profile',profileVersion:1}};sessions.set(value.sessionId,value);return value;}return standard(method,data);}});try{await h.flush();assert.deepEqual(h.calls.find(c=>c.method==='sharedTerminal.open').data,{kind:'ssh',mode:'interactive',profileId:'profile',version:1});assert(!h.calls.some(c=>c.method.startsWith('compute.sshService.')));h.click('登录完成，交给 Agent');await h.flush();assert(h.calls.some(c=>c.method==='sharedTerminal.owner'));assert(!h.calls.some(c=>c.method.startsWith('compute.sshService.')));assert.match(h.text(h.find(n=>n.props?.['data-testid']==='ssh-resource-scope')),/普通 SSH 模式仅提供终端操作/);}finally{h.unmount();}});
