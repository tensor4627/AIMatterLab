import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {deferred} from "../helpers/agent-hooks.mjs";
const source=fs.readFileSync(new URL("../../frontend/features/compute/ComputeConnectionChooser.tsx",import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const local={id:'fixture-wsl',version:2,kind:'wsl',name:'Fixture local',distribution:'Fixture Linux',root:'/fixture/service',port:9080,intent:'existing'};
const ssh={id:'fixture-ssh',version:3,kind:'ssh',name:'Fixture SSH',host:'example.invalid',username:'fixture-user',port:22,ssh_client:'C:/Windows/System32/OpenSSH/ssh.exe',identity_file:'',proxy_jump:[],via:[],mode:'interactive'};
function harness({profiles=[local,ssh],override,props={}}={}){
 profiles=structuredClone(profiles);const hooks=[],effects=[],calls=[],connected=[],errors=[];let index=0,dirty=false,disposed=false,tree,currentProps={...props};
 const state=v=>{const i=index++;hooks[i]??={value:typeof v==='function'?v():v};return [hooks[i].value,n=>{hooks[i].value=typeof n==='function'?n(hooks[i].value):n;dirty=true;}];};
 const ref=v=>{const i=index++;return hooks[i]??={current:v};};
 const effect=(fn,deps)=>{const i=index++,old=hooks[i];if(!old||deps.some((x,j)=>x!==old.deps[j])){const h={deps,cleanup:old?.cleanup};hooks[i]=h;effects.push(()=>{h.cleanup?.();h.cleanup=fn();});}};
 const standard=async(method,data)=>{if(method==='compute.profiles.list')return {profiles:structuredClone(profiles),defaults:{distribution:'Fixture Linux',root:'/fixture/service',port:9080,ssh_client:ssh.ssh_client}};if(method==='compute.profiles.inventory')return {distributions:['Fixture Linux']};if(method==='compute.profiles.read')return structuredClone(profiles.find(p=>p.id===data.id));if(method==='compute.profiles.remove'){const found=profiles.find(p=>p.id===data.id);profiles=profiles.filter(p=>p.id!==data.id);return {removed:true,id:data.id,version:found?.version};}if(method==='compute.profiles.save'){const {expectedVersion,...v}=data;return {...v,id:v.id||'new-fixture',version:expectedVersion+1};}throw Error('Unexpected fixture '+method);};
 const invoke=async(method,data)=>{calls.push({method,data});return override?override(method,data,standard):standard(method,data);};
 const jsx=(type,props)=>({type,props}),module={exports:{}};
 new Function('require','module','exports','window',compiled)(name=>name==='react'?{useState:state,useRef:ref,useEffect:effect}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==="../../api/studio"?{invoke}:name==="../../ui/i18n"?{t:v=>v}:new Proxy({},{get:(_t,k)=>String(k)}),module,module.exports,{confirm:()=>true});
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

test('active SSH profile is marked current without treating an existing local worker as the selected resource',async()=>{
 const h=harness({props:{localConnected:true,activeResource:{kind:'ssh-terminal',selectionId:'selected',profileId:ssh.id,profileVersion:ssh.version,status:'selected'}}});await h.flush();const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):'';assert.match(text(row(h,ssh.id)),/当前连接/);assert.doesNotMatch(text(row(h,local.id)),/当前连接/);assert.deepEqual(h.connected,[]);h.unmount();
});
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

const removeButton=(h,id)=>children(row(h,id)).find(n=>n.props?.['data-testid']==='compute-profile-delete');
const beginRemoval=(h,id)=>{removeButton(h,id).props.onClick();h.render();};
const removals=h=>h.calls.filter(call=>call.method==='compute.profiles.remove');

test('deletion requires a named confirmation and cancelling never invokes removal or connection',async()=>{
 const h=harness();await h.flush();beginRemoval(h,ssh.id);assert(h.id('compute-profile-delete-confirmation'));assert.match(JSON.stringify(h.id('compute-profile-delete-confirmation')),/Fixture SSH/);assert.match(JSON.stringify(h.id('compute-profile-delete-confirmation')),/凭据均保留/);assert.deepEqual(removals(h),[]);
 children(h.id('compute-profile-delete-confirmation')).find(n=>n.type==='button'&&n.props.children==='取消').props.onClick();await h.flush();assert.equal(h.all().some(n=>n.props?.['data-testid']==='compute-profile-delete-confirmation'),false);assert.equal(h.all().filter(n=>n.props?.['data-testid']==='saved-compute-profile').length,2);assert.deepEqual(h.connected,[]);assert.deepEqual(removals(h),[]);h.unmount();
});

test('confirmed deletion uses the displayed version, waits for acknowledgement and cannot double submit',async()=>{
 const gate=deferred(),h=harness({override:(m,d,s)=>m==='compute.profiles.remove'?gate.promise:s(m,d)});await h.flush();beginRemoval(h,ssh.id);const confirm=h.id('compute-profile-delete-confirm');confirm.props.onClick();confirm.props.onClick();await h.flush();
 assert.equal(removals(h).length,1);assert.deepEqual(removals(h)[0].data,{id:ssh.id,expectedVersion:ssh.version});assert.equal(h.id('compute-profile-delete-confirm').props.disabled,true);assert(row(h,ssh.id));assert.deepEqual(h.connected,[]);
 gate.resolve({removed:true,id:ssh.id,version:ssh.version});await h.flush();assert.equal(h.all().filter(n=>n.props?.['data-testid']==='saved-compute-profile').length,1);assert(row(h,local.id));assert(h.all().some(n=>n.props?.role==='status'&&n.props.children==='已删除保存的连接；现有作业、环境和凭据保留。'));assert.deepEqual(h.connected,[]);h.unmount();
});

for(const failure of ['compute_profile_changed','compute_profile_unavailable','compute_profile_in_use','unconfirmed transport'])test('failed removal '+failure+' retains the row and requires review instead of automatic retry',async()=>{
 const h=harness({override:(m,d,s)=>m==='compute.profiles.remove'?Promise.reject(Error(failure)):s(m,d)});await h.flush();beginRemoval(h,ssh.id);h.clickId('compute-profile-delete-confirm');await h.flush();assert(row(h,ssh.id));assert.equal(h.id('compute-profile-delete-confirm').props.disabled,true);assert(children(h.id('compute-profile-delete-confirmation')).some(n=>n.props?.role==='alert'));h.clickId('compute-profile-delete-confirm');await h.flush();assert.equal(removals(h).length,1);assert.deepEqual(h.connected,[]);h.unmount();
});

test('a mismatched deletion acknowledgement cannot remove a displayed saved row',async()=>{
 const h=harness({override:(m,d,s)=>m==='compute.profiles.remove'?{removed:true,id:local.id,version:local.version}:s(m,d)});await h.flush();beginRemoval(h,ssh.id);h.clickId('compute-profile-delete-confirm');await h.flush();assert(row(h,ssh.id));assert.match(JSON.stringify(h.id('compute-profile-delete-confirmation')),/删除结果尚未确认/);assert.equal(h.id('compute-profile-delete-confirm').props.disabled,true);h.unmount();
});

test('selected SSH and authoritative in-use profiles cannot be removed, including an older selected version',async()=>{
 const h=harness({props:{activeResource:{kind:'ssh-terminal',profileId:ssh.id,profileVersion:1,status:'selected'}}});await h.flush();assert.equal(removeButton(h,ssh.id).props.disabled,true);removeButton(h,ssh.id).props.onClick();await h.flush();assert.deepEqual(removals(h),[]);assert(h.all().some(n=>n.props?.role==='alert'&&n.props.children==='请先断开该 SSH 连接，再删除保存项。'));h.unmount();
 const known=harness({override:(m,d,s)=>m==='compute.profiles.list'?Promise.resolve(s(m,d)).then(value=>({...value,inUseProfileIds:[ssh.id]})):s(m,d)});await known.flush();assert.equal(removeButton(known,ssh.id).props.disabled,true);assert.equal(removeButton(known,local.id).props.disabled,false);known.unmount();
});
test('an authoritative empty in-use list permits deletion after SSH exit despite stale renderer selection',async()=>{
 const h=harness({props:{activeResource:{kind:'ssh-terminal',profileId:ssh.id,profileVersion:ssh.version,status:'selected'}},override:(m,d,s)=>m==='compute.profiles.list'?Promise.resolve(s(m,d)).then(value=>({...value,inUseProfileIds:[]})):s(m,d)});await h.flush();assert.equal(removeButton(h,ssh.id).props.disabled,false);beginRemoval(h,ssh.id);h.clickId('compute-profile-delete-confirm');await h.flush();assert.equal(removals(h).length,1);assert.equal(h.all().filter(n=>n.props?.['data-testid']==='saved-compute-profile').length,1);h.unmount();
});

test('deleting an active WSL saved entry preserves the live connection callback and other entries',async()=>{
 const h=harness({props:{localConnected:true},override:(m,d,s)=>m==='compute.profiles.list'?Promise.resolve(s(m,d)).then(value=>({...value,activeLocal:{distribution:local.distribution,root:local.root,port:local.port}})):s(m,d)});await h.flush();assert.equal(removeButton(h,local.id).props.disabled,false);beginRemoval(h,local.id);assert.match(JSON.stringify(h.id('compute-profile-delete-confirmation')),/当前 WSL 作业服务保持连接/);h.clickId('compute-profile-delete-confirm');await h.flush();assert.equal(h.all().filter(n=>n.props?.['data-testid']==='saved-compute-profile').length,1);assert(row(h,ssh.id));assert.deepEqual(h.connected,[]);assert.deepEqual(h.calls.map(call=>call.method),['compute.profiles.list','compute.profiles.remove']);h.unmount();
});

for(const change of ['selection','busy'])test('late '+change+' while confirmation is open prevents deleting a newly protected SSH entry',async()=>{
 const h=harness();await h.flush();beginRemoval(h,ssh.id);h.render(change==='selection'?{activeResource:{kind:'ssh-terminal',profileId:ssh.id,profileVersion:ssh.version,status:'selected'}}:{connectionBusy:true});assert.equal(h.id('compute-profile-delete-confirm').props.disabled,true);h.clickId('compute-profile-delete-confirm');await h.flush();assert.deepEqual(removals(h),[]);assert(row(h,ssh.id));h.unmount();
});

test('late list response cannot resurrect a successfully deleted saved entry',async()=>{
 const gate=deferred();let lists=0;const h=harness({override:(m,d,s)=>m==='compute.profiles.list'&&lists++?gate.promise:s(m,d)});await h.flush();beginRemoval(h,ssh.id);h.find(n=>n.props?.['aria-label']==='刷新连接列表').props.onClick();await h.flush();h.clickId('compute-profile-delete-confirm');await h.flush();gate.resolve({profiles:[local,ssh],defaults:{}});await h.flush();assert.equal(h.all().filter(n=>n.props?.['data-testid']==='saved-compute-profile').length,1);assert(row(h,local.id));assert.equal(h.find(n=>n.props?.['aria-label']==='刷新连接列表').props.disabled,false);h.unmount();
});

test('a deletion response after unmount cannot trigger another operation or connection',async()=>{
 const gate=deferred(),h=harness({override:(m,d,s)=>m==='compute.profiles.remove'?gate.promise:s(m,d)});await h.flush();beginRemoval(h,ssh.id);h.clickId('compute-profile-delete-confirm');h.unmount();gate.resolve({removed:true,id:ssh.id,version:ssh.version});await h.flush();assert.equal(removals(h).length,1);assert.deepEqual(h.connected,[]);
});
