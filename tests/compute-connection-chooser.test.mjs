import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {deferred} from './helpers/agent-hooks.mjs';
const source=fs.readFileSync(new URL('../src/ComputeConnectionChooser.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const local={id:'fixture-wsl',version:2,kind:'wsl',name:'Fixture local',distribution:'Fixture Linux',root:'/fixture/service',port:9080,intent:'existing'};
const ssh={id:'fixture-ssh',version:3,kind:'ssh',name:'Fixture SSH',host:'example.invalid',username:'fixture-user',port:22,ssh_client:'C:/Windows/System32/OpenSSH/ssh.exe',identity_file:'',proxy_jump:[],via:[],mode:'interactive'};
function harness({profiles=[local,ssh],override,props={}}={}){
 const hooks=[],effects=[],calls=[],connected=[],errors=[];let index=0,dirty=false,disposed=false,tree,currentProps={...props};
 const state=v=>{const i=index++;hooks[i]??={value:typeof v==='function'?v():v};return [hooks[i].value,n=>{hooks[i].value=typeof n==='function'?n(hooks[i].value):n;dirty=true;}];};
 const ref=v=>{const i=index++;return hooks[i]??={current:v};};
 const effect=(fn,deps)=>{const i=index++,old=hooks[i];if(!old||deps.some((x,j)=>x!==old.deps[j])){const h={deps,cleanup:old?.cleanup};hooks[i]=h;effects.push(()=>{h.cleanup?.();h.cleanup=fn();});}};
 const standard=async(method,data)=>{if(method==='compute.profiles.list')return {profiles:structuredClone(profiles),defaults:{distribution:'Fixture Linux',root:'/fixture/service',port:9080,ssh_client:ssh.ssh_client}};if(method==='compute.profiles.inventory')return {distributions:['Fixture Linux']};if(method==='compute.profiles.read')return structuredClone(profiles.find(p=>p.id===data.id));if(method==='compute.profiles.save'){const {expectedVersion,...v}=data;return {...v,id:v.id||'new-fixture',version:expectedVersion+1};}throw Error('Unexpected fixture '+method);};
 const invoke=async(method,data)=>{calls.push({method,data});return override?override(method,data,standard):standard(method,data);};
 const jsx=(type,props)=>({type,props}),module={exports:{}};
 new Function('require','module','exports','window',compiled)(name=>name==='react'?{useState:state,useRef:ref,useEffect:effect}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='./types'?{invoke}:name==='./i18n'?{t:v=>v}:new Proxy({},{get:(_t,k)=>String(k)}),module,module.exports,{confirm:()=>true});
 function render(changes={}){currentProps={...currentProps,...changes};index=0;dirty=false;tree=module.exports.default({onLocal:p=>connected.push(['local',p]),onSsh:p=>connected.push(['ssh',p]),onClose:()=>connected.push(['close']),...currentProps});}
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];
 const find=fn=>{const n=all(tree).find(fn);assert(n,'fixture node missing');return n;};
 const id=v=>find(n=>n.props?.['data-testid']===v);
 async function flush(){for(let i=0;i<8;i++){while(effects.length)effects.shift()();await new Promise(r=>setImmediate(r));if(dirty&&!disposed)render();}}
 const clickId=v=>{id(v).props.onClick();render();};
 const input=(v,value)=>{id(v).props.onChange({target:{value}});render();};
 const submit=()=>{id('compute-profile-editor').props.onSubmit({preventDefault(){}});render();};
 const unmount=()=>{disposed=true;for(const h of hooks)h?.cleanup?.();};
 render();return {render,flush,find,id,input,submit,clickId,unmount,calls,connected,errors,all:()=>all(tree)};
}
const row=(h,id)=>h.find(n=>n.props?.['data-profile-id']===id);
const children=n=>Array.isArray(n)?n.flatMap(children):n&&typeof n==='object'?[n,...children(n.props?.children)]:[];
const edit=(h,id)=>children(row(h,id)).find(n=>n.props?.['aria-label']?.startsWith('编辑连接')).props.onClick();
const connect=(h,id)=>children(row(h,id)).find(n=>n.type==='button'&&n.props.className==='button primary').props.onClick();
test('manager listing and unsaved edit/cancel never connect or persist',async()=>{
 const h=harness();await h.flush();assert.equal(h.all().filter(n=>n.props?.['data-testid']==='saved-compute-profile').length,2);assert.deepEqual(h.calls.map(c=>c.method),['compute.profiles.list']);
 h.clickId('compute-choice-ssh');h.input('compute-profile-name','Unsaved fixture');h.find(n=>n.type==='button'&&n.props.children==='取消').props.onClick();await h.flush();assert(!h.all().some(n=>n.props?.['data-testid']==='compute-profile-editor'));assert.deepEqual(h.connected,[]);assert(!h.calls.some(c=>c.method.endsWith('.save')||c.method.endsWith('.read')));h.unmount();
});
for(const kind of ['wsl','ssh'])test('new '+kind+' save uses expectedVersion zero and only stores a record',async()=>{
 const h=harness({profiles:[]});await h.flush();h.clickId(kind==='wsl'?'compute-choice-local':'compute-choice-ssh');await h.flush();h.input('compute-profile-name','New fixture');if(kind==='ssh'){h.input('compute-profile-host','example.invalid');h.input('compute-profile-username','fixture-user');}h.submit();await h.flush();const saved=h.calls.find(c=>c.method==='compute.profiles.save').data;assert.equal(saved.expectedVersion,0);assert.equal(saved.kind,kind);assert.equal(saved.id,undefined);assert.deepEqual(h.connected,[]);assert(h.all().some(n=>n.props?.role==='status'&&n.props.children==='连接已保存'));h.unmount();
});
test('edit saves existing version; conflict preserves all user input',async()=>{
 const h=harness({override:(m,d,s)=>m==='compute.profiles.save'?Promise.reject(Error('profile_conflict')):s(m,d)});await h.flush();edit(h,'fixture-ssh');await h.flush();h.input('compute-profile-name','Edited fixture');h.input('compute-profile-host','changed.invalid');h.submit();await h.flush();const save=h.calls.find(c=>c.method==='compute.profiles.save').data;assert.equal(save.id,ssh.id);assert.equal(save.expectedVersion,3);assert.equal(h.id('compute-profile-name').props.value,'Edited fixture');assert.equal(h.id('compute-profile-host').props.value,'changed.invalid');assert(h.all().some(n=>n.props?.role==='alert'));assert.deepEqual(h.connected,[]);h.unmount();
});
for(const profile of [local,ssh])test(profile.kind+' connect reads version then passes complete saved profile only',async()=>{
 const fresh={...profile,name:'Authoritative fixture'};const h=harness({override:(m,d,s)=>m==='compute.profiles.read'?fresh:s(m,d)});await h.flush();connect(h,profile.id);await h.flush();assert.deepEqual(h.calls.find(c=>c.method==='compute.profiles.read').data,{id:profile.id,version:profile.version});assert.deepEqual(h.connected,[[profile.kind==='wsl'?'local':'ssh',fresh]]);assert(!h.calls.some(c=>c.method.endsWith('.save')));h.unmount();
});
for(const operation of ['save','read'])test('late '+operation+' after unmount cannot initiate a connection',async()=>{
 const gate=deferred(),h=harness({override:(m,d,s)=>m==='compute.profiles.'+operation?gate.promise:s(m,d)});await h.flush();if(operation==='save'){h.clickId('compute-choice-local');await h.flush();h.input('compute-profile-name','Late fixture');h.submit();}else connect(h,local.id);h.unmount();gate.resolve(local);await h.flush();assert.deepEqual(h.connected,[]);
});
test('read version conflict stays in manager without connecting or saving',async()=>{
 const h=harness({override:(m,d,s)=>m==='compute.profiles.read'?Promise.reject(Error('profile_conflict')):s(m,d)});await h.flush();connect(h,local.id);await h.flush();assert.deepEqual(h.connected,[]);assert(h.all().some(n=>n.props?.role==='alert'));assert(!h.calls.some(c=>c.method.endsWith('.save')));h.unmount();
});


test('Agent becomes busy during authoritative profile read: late result does not connect and editing remains available',async()=>{
 const gate=deferred(),h=harness({override:(m,d,s)=>m==='compute.profiles.read'?gate.promise:s(m,d)});await h.flush();connect(h,ssh.id);h.render({connectionBusy:true});gate.resolve(ssh);await h.flush();assert.deepEqual(h.connected,[]);assert(h.all().some(n=>n.props?.role==='alert'&&n.props.children==='当前操作尚未完成，请稍后连接。'));assert(children(row(h,ssh.id)).find(n=>n.type==='button'&&n.props.className==='button primary').props.disabled);edit(h,ssh.id);await h.flush();assert.equal(h.id('compute-profile-host').props.value,ssh.host);assert.equal(h.id('compute-profile-host').props.disabled,false);h.unmount();
});
test('current connection badge requires observed active target and live gate, accepts only exact root or requested alias',async()=>{
 const alias={...local,id:'fixture-alias',root:'~/fixture'},wrong={...local,id:'fixture-default',root:'/settings-only'},wrongPort={...local,id:'fixture-port',port:9081};
 const h=harness({profiles:[local,alias,wrong,wrongPort,ssh],props:{localConnected:true},override:(m,d,s)=>m==='compute.profiles.list'?{profiles:[local,alias,wrong,wrongPort,ssh],activeLocal:{distribution:local.distribution,root:local.root,requestedRoot:alias.root,port:local.port},defaults:{distribution:wrong.distribution,root:wrong.root,port:wrong.port,ssh_client:ssh.ssh_client}}:s(m,d)});await h.flush();
 const badge=id=>children(row(h,id)).some(n=>n.type==='em'&&n.props.children==='当前连接');assert.equal(badge(local.id),true);assert.equal(badge(alias.id),true);assert.equal(badge(wrong.id),false);assert.equal(badge(wrongPort.id),false);assert.equal(badge(ssh.id),false);h.render({localConnected:false});assert.equal(h.all().some(n=>n.type==='em'),false);h.unmount();
});
