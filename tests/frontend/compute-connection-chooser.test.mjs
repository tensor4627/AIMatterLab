import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {deferred} from "../helpers/agent-hooks.mjs";
const compile=file=>ts.transpileModule(fs.readFileSync(new URL("../../frontend/features/compute/"+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const compiled=compile("ComputeConnectionChooser.tsx");
const connectionTypes={exports:{}};
new Function("module","exports",compile("ssh-connection-types.ts"))(connectionTypes,connectionTypes.exports);
const local={id:'fixture-wsl',version:2,kind:'wsl',name:'Fixture local',distribution:'Fixture Linux',root:'/fixture/service',port:9080,intent:'existing'};
const ssh={id:'fixture-ssh',version:3,kind:'ssh',name:'Fixture SSH',host:'example.invalid',username:'fixture-user',port:22,ssh_client:'C:/Windows/System32/OpenSSH/ssh.exe',identity_file:'',proxy_jump:[],via:[],mode:'interactive'};
function harness({profiles=[local,ssh],override,props={},confirm=()=>true}={}){
 profiles=structuredClone(profiles);const hooks=[],effects=[],calls=[],connected=[],errors=[];let index=0,dirty=false,disposed=false,tree,currentProps={...props};
 const state=v=>{const i=index++;hooks[i]??={value:typeof v==='function'?v():v};return [hooks[i].value,n=>{hooks[i].value=typeof n==='function'?n(hooks[i].value):n;dirty=true;}];};
 const ref=v=>{const i=index++;return hooks[i]??={current:v};};
 const effect=(fn,deps)=>{const i=index++,old=hooks[i];if(!old||deps.some((x,j)=>x!==old.deps[j])){const h={deps,cleanup:old?.cleanup};hooks[i]=h;effects.push(()=>{h.cleanup?.();h.cleanup=fn();});}};
 const standard=async(method,data)=>{if(method==='compute.profiles.list')return {profiles:structuredClone(profiles),defaults:{distribution:'Fixture Linux',root:'/fixture/service',port:9080,ssh_client:ssh.ssh_client}};if(method==='compute.profiles.inventory')return {distributions:['Fixture Linux']};if(method==='compute.profiles.read')return structuredClone(profiles.find(p=>p.id===data.id));if(method==='compute.profiles.remove'){const found=profiles.find(p=>p.id===data.id);profiles=profiles.filter(p=>p.id!==data.id);return {removed:true,id:data.id,version:found?.version};}if(method==='compute.profiles.save'){const {expectedVersion,...v}=data,value={...v,id:v.id||'new-fixture',version:expectedVersion+1};profiles=[value,...profiles.filter(profile=>profile.id!==value.id)];return structuredClone(value);}throw Error('Unexpected fixture '+method);};
 const invoke=async(method,data)=>{calls.push({method,data});return override?override(method,data,standard):standard(method,data);};
 const jsx=(type,props)=>({type,props}),module={exports:{}};
 new Function('require','module','exports','window',compiled)(name=>name==='react'?{useState:state,useRef:ref,useEffect:effect}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==="../../api/studio"?{invoke}:name==="../../ui/i18n"?{t:v=>v}:name==="./ssh-connection-types"?connectionTypes.exports:new Proxy({},{get:(_t,k)=>String(k)}),module,module.exports,{confirm});
 function render(changes={}){currentProps={...currentProps,...changes};index=0;dirty=false;tree=module.exports.default({onLocal:p=>connected.push(['local',p]),onSsh:p=>connected.push(['ssh',p]),onClose:()=>connected.push(['close']),...currentProps});}
 const all=n=>Array.isArray(n)?n.flatMap(all):n&&typeof n==='object'?[n,...all(n.props?.children)]:[];
 const find=fn=>{const n=all(tree).find(fn);assert(n,'fixture node missing');return n;};
 const id=v=>find(n=>n.props?.['data-testid']===v);
 async function flush(){for(let i=0;i<8;i++){while(effects.length)effects.shift()();await new Promise(r=>setImmediate(r));if(dirty&&!disposed)render();}}
 const clickId=v=>{id(v).props.onClick();render();};
 const input=(v,value)=>{id(v).props.onChange({target:{value}});render();};
 const submit=()=>{id('compute-profile-editor').props.onSubmit({preventDefault(){}});render();};
 const unmount=()=>{disposed=true;for(const h of hooks)h?.cleanup?.();};
 render();return {render,flush,find,id,input,submit,clickId,unmount,calls,connected,errors,all:(target=tree)=>all(target)};
}
const row=(h,id)=>h.find(n=>n.props?.['data-profile-id']===id);

test('Windows OpenSSH is identified and can save and open a new connection without WSL discovery',async()=>{
 const h=harness({profiles:[],override(method,data,standard){
  assert.notEqual(method,'compute.profiles.inventory','Windows SSH should not discover WSL');
  return standard(method,data);
 }});
 try{
  await h.flush();
  h.clickId('compute-choice-ssh');
  assert.match(h.id('compute-profile-windows-ssh-note').props.children,/无需本机 WSL/);
  h.input('compute-profile-name','Windows gateway');
  h.input('compute-profile-host','fixture.invalid');
  h.input('compute-profile-username','fixture');
  h.clickId('compute-save-login');await h.flush();
  assert.equal(h.connected.length,1);
  assert.equal(h.connected[0][0],'ssh');
  assert.equal(h.connected[0][1].ssh_client,ssh.ssh_client);
  assert(!Object.hasOwn(h.connected[0][1],'distribution'));
  assert.match(JSON.stringify(row(h,'new-fixture')),/Windows OpenSSH/);
 }finally{h.unmount();}
});

test('WSL inventory shows failure, retries once clicked and preserves manual input',async()=>{
 const first=deferred(),second=deferred();let count=0;
 const h=harness({override:(m,d,s)=>m==='compute.profiles.inventory'?(++count===1?first:second).promise:s(m,d)});
 try{
  await h.flush();h.clickId('compute-choice-local');await h.flush();
  assert(h.find(n=>n.props?.busy&&n.props?.label==='正在查找已安装的 WSL 发行版'));
  first.reject(Error('fixture unavailable'));await h.flush();
  assert(h.find(n=>n.props?.role==='alert'&&n.props.children.includes('可以手动填写')));
  h.find(n=>n.type==='button'&&n.props.children==='重新检测').props.onClick();await h.flush();
  h.input('compute-profile-distribution','My Linux');second.resolve({distributions:['Other Linux']});await h.flush();
  assert.equal(h.id('compute-profile-distribution').props.value,'My Linux');assert.equal(count,2);
 }finally{h.unmount();}
});

test('saved SSH has a discoverable service settings entry that does not connect, update or save',async()=>{const h=harness();try{await h.flush();h.clickId('compute-profile-service');await h.flush();const service=h.find(n=>n.props?.profile?.id==='fixture-ssh'&&typeof n.props.onLogin==='function');assert.equal(service.props.profile.version,3);assert.deepEqual(h.connected,[]);assert(!h.calls.some(c=>c.method.includes('connect')||c.method.endsWith('.save')));}finally{h.unmount();}});

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

test('SSH service environment edits save only to that profile and do not connect or start setup',async()=>{
 const configured={...ssh,serviceEnvironment:{python:'/fixture/env/bin/python',activation:'source /fixture/venv/bin/activate'}};
 const h=harness({profiles:[local,configured]});await h.flush();edit(h,ssh.id);await h.flush();assert.equal(h.id('compute-service-python').props.value,configured.serviceEnvironment.python);assert.equal(h.id('compute-service-activation').props.value,configured.serviceEnvironment.activation);
 h.input('compute-service-python','python3.12');h.input('compute-service-activation','source /fixture/conda.sh\nconda activate studio');h.submit();await h.flush();
 const saved=h.calls.find(call=>call.method==='compute.profiles.save').data;assert.equal(saved.id,ssh.id);assert.equal(saved.expectedVersion,ssh.version);assert.deepEqual(saved.serviceEnvironment,{python:'python3.12',activation:'source /fixture/conda.sh\nconda activate studio'});assert.deepEqual(h.connected,[]);assert.deepEqual(h.calls.map(call=>call.method),['compute.profiles.list','compute.profiles.save','compute.profiles.list']);h.unmount();
});

test('legacy default service environment remains absent until explicitly changed and is SSH-only',async()=>{
 const h=harness();await h.flush();edit(h,ssh.id);await h.flush();assert.equal(h.id('compute-service-python').props.value,'python3');assert.equal(h.id('compute-service-activation').props.value,'');h.submit();await h.flush();assert(!Object.hasOwn(h.calls.find(call=>call.method==='compute.profiles.save').data,'serviceEnvironment'));edit(h,local.id);await h.flush();assert(!h.all().some(node=>node.props?.['data-testid']==='compute-service-environment'));h.unmount();
});

test('Agent setup help receives the saved connection rather than unsaved environment edits',async()=>{
 const help=[],h=harness({props:{onServiceEnvironmentHelp:profile=>help.push(profile)}});await h.flush();edit(h,ssh.id);await h.flush();h.input('compute-service-python','unsaved-python');h.input('compute-service-activation','UNSAVED_PRIVATE_TEXT');h.clickId('compute-service-agent-help');await h.flush();assert.deepEqual(help,[ssh]);assert(!JSON.stringify(help).includes('UNSAVED_PRIVATE_TEXT'));assert.deepEqual(h.connected,[]);assert(!h.calls.some(call=>call.method==='compute.profiles.save'));h.unmount();
});

test('declining unsaved-edit discard keeps the Python draft and does not invoke Agent setup',async()=>{
 const help=[],h=harness({props:{onServiceEnvironmentHelp:profile=>help.push(profile)},confirm:()=>false});await h.flush();edit(h,ssh.id);await h.flush();h.input('compute-service-python','unsaved-python');h.clickId('compute-service-agent-help');await h.flush();assert.deepEqual(help,[]);assert.equal(h.id('compute-service-python').props.value,'unsaved-python');assert(!h.calls.some(call=>call.method==='compute.profiles.save'));h.unmount();
});
test('advanced maintenance opens from the editor without logging in or probing terminals',async()=>{const h=harness();await h.flush();edit(h,ssh.id);await h.flush();h.clickId('compute-editor-service');await h.flush();assert(h.all().some(node=>node.props?.profile?.id===ssh.id&&typeof node.props?.onLogin==='function'));assert.deepEqual(h.connected,[]);assert.deepEqual(h.calls.map(call=>call.method),['compute.profiles.list']);h.unmount();});
test('service registration does not add extra actions to the login card',async()=>{const h=harness({override:(method,data,standard)=>method==='compute.profiles.list'?Promise.resolve(standard(method,data)).then(value=>({...value,serviceRegistrations:[{profileId:ssh.id,profileVersion:ssh.version,status:'maintenance_required'}]})):standard(method,data)});await h.flush();assert.doesNotMatch(JSON.stringify(row(h,ssh.id)),/服务需要维护/);assert.doesNotMatch(JSON.stringify(row(h,local.id)),/服务需要维护/);assert.deepEqual(h.calls.map(call=>call.method),['compute.profiles.list']);h.unmount();});
test('new SSH save returns to one login action without an extra service setup step',async()=>{const h=harness({profiles:[],override:(method,data,standard)=>method==='compute.profiles.list'?Promise.resolve(standard(method,data)).then(value=>({...value,serviceRegistrations:value.profiles.map(profile=>({profileId:profile.id,profileVersion:profile.version,status:'unconfigured'}))})):standard(method,data)});await h.flush();h.clickId('compute-choice-ssh');h.input('compute-profile-name','Saved fixture');h.input('compute-profile-host','fixture.invalid');h.input('compute-profile-username','owned');h.submit();await h.flush();assert.doesNotMatch(JSON.stringify(row(h,'new-fixture')),/服务未设置/);assert.deepEqual(h.calls.map(call=>call.method),['compute.profiles.list','compute.profiles.save','compute.profiles.list']);assert.deepEqual(h.connected,[]);h.unmount();});
test('changing a saved Python environment versions the profile without adding a setup step',async()=>{const h=harness({override:(method,data,standard)=>method==='compute.profiles.list'?Promise.resolve(standard(method,data)).then(value=>({...value,serviceRegistrations:value.profiles.filter(profile=>profile.kind==='ssh').map(profile=>({profileId:profile.id,profileVersion:profile.version,status:profile.version===ssh.version?'configured':'maintenance_required'}))})):standard(method,data)});await h.flush();assert.doesNotMatch(JSON.stringify(row(h,ssh.id)),/服务已设置/);edit(h,ssh.id);await h.flush();h.input('compute-service-python','python3.9');h.submit();await h.flush();assert.doesNotMatch(JSON.stringify(row(h,ssh.id)),/服务需要维护/);assert.doesNotMatch(JSON.stringify(row(h,ssh.id)),/服务已设置/);assert.equal(row(h,ssh.id).props['data-profile-version'],ssh.version+1);assert.deepEqual(h.connected,[]);h.unmount();});

test('new Windows SSH draft keeps its route and discovers WSL only on explicit selection',async()=>{const h=harness({profiles:[]});try{await h.flush();h.clickId('compute-choice-ssh');await h.flush();assert.equal(h.id('compute-profile-client').props.value,ssh.ssh_client);assert(!h.all().some(node=>node.props?.['data-testid']==='compute-profile-ssh-distribution'));assert(!h.calls.some(call=>call.method==='compute.profiles.inventory'));h.clickId('compute-profile-use-linux-client');await h.flush();assert.equal(h.id('compute-profile-client').props.value,'/usr/bin/ssh');assert.equal(h.calls.filter(call=>call.method==='compute.profiles.inventory').length,1);assert.equal(h.id('compute-profile-ssh-distribution').props.value,'Fixture Linux');assert(!h.calls.some(call=>call.method==='compute.profiles.save'));assert.match(JSON.stringify(h.all()),/Windows 与 WSL\/Linux 的密钥和 known_hosts/);}finally{h.unmount();}});
test('editing a saved Windows client keeps its client and key until an explicit user selection',async()=>{const original={...ssh,identity_file:'C:/public-fixture/key'},h=harness({profiles:[original]});try{await h.flush();edit(h,original.id);await h.flush();assert.equal(h.id('compute-profile-client').props.value,original.ssh_client);assert.equal(h.id('compute-profile-identity-file').props.value,original.identity_file);h.clickId('compute-profile-use-linux-client');await h.flush();assert.equal(h.id('compute-profile-client').props.value,'/usr/bin/ssh');assert.equal(h.id('compute-profile-identity-file').props.value,original.identity_file);assert(!h.calls.some(call=>call.method==='compute.profiles.save'));}finally{h.unmount();}});
test('direct failure recovery edits only the named original profile and never inherits a default namespace',async()=>{const h=harness({props:{initialEdit:{profileId:ssh.id,profileVersion:ssh.version,nonce:'edit-original'}}});try{await h.flush();assert.equal(h.id('compute-profile-client').props.value,ssh.ssh_client);assert(!h.all().some(node=>node.props?.['data-testid']==='compute-profile-ssh-distribution'));assert(!h.calls.some(call=>call.method==='compute.profiles.inventory'));assert.equal(h.id('compute-profile-host').props.value,ssh.host);assert(!h.calls.some(c=>c.method==='compute.profiles.save'||c.method==='compute.profiles.read'));assert.deepEqual(h.connected,[]);}finally{h.unmount();}});
test('direct service settings open the named profile without opening another login',async()=>{const h=harness({props:{initialEdit:{profileId:ssh.id,profileVersion:ssh.version,nonce:'service-original',section:'service'}}});try{await h.flush();assert(h.all().some(n=>n.props?.profile?.id===ssh.id&&typeof n.props.onLogin==='function'));assert(!h.calls.some(c=>c.method==='compute.profiles.save'));assert.deepEqual(h.connected,[]);}finally{h.unmount();}});
test('save and login explicitly persists the reviewed profile before opening its terminal',async()=>{const actual=[],h=harness({profiles:[],props:{onSsh:profile=>actual.push(profile)}});try{await h.flush();h.clickId('compute-choice-ssh');h.input('compute-profile-name','Saved login');h.input('compute-profile-host','fixture.invalid');h.input('compute-profile-username','fixture-user');h.clickId('compute-save-login');await h.flush();assert.equal(actual.length,1);assert.equal(actual[0].id,'new-fixture');assert.equal(actual[0].version,1);assert.equal(actual[0].host,'fixture.invalid');assert.equal(h.calls.filter(c=>c.method==='compute.profiles.save').length,1);}finally{h.unmount();}});
test('service settings for an older live connection load only its immutable historical profile',async()=>{const original={...ssh,version:2,host:'original.invalid',serviceEnvironment:{python:'/original/python',activation:''}},h=harness({props:{initialEdit:{profileId:ssh.id,profileVersion:2,nonce:'historical-service',section:'service'}},override:(method,data,standard)=>method==='compute.profiles.read'?structuredClone(original):standard(method,data)});try{await h.flush();const settings=h.all().find(n=>n.props?.profile?.id===ssh.id&&typeof n.props.onLogin==='function');assert.deepEqual(settings.props.profile,original);assert.deepEqual(h.calls.find(c=>c.method==='compute.profiles.read').data,{id:ssh.id,version:2});assert(!h.calls.some(c=>c.method==='compute.profiles.save'));assert.deepEqual(h.connected,[]);}finally{h.unmount();}});
test('a mismatched historical profile cannot configure a different connection version',async()=>{const h=harness({props:{initialEdit:{profileId:ssh.id,profileVersion:2,nonce:'wrong-history',section:'service'}},override:(method,data,standard)=>method==='compute.profiles.read'?structuredClone(ssh):standard(method,data)});try{await h.flush();assert(!h.all().some(n=>n.props?.profile&&typeof n.props.onLogin==='function'));assert(h.all().some(n=>n.props?.role==='alert'));assert(!h.calls.some(c=>c.method==='compute.profiles.save'));}finally{h.unmount();}});

test('the login card keeps one SSH login action and shares its service settings entry with the editor',async()=>{const h=harness();try{await h.flush();assert(h.id('compute-profile-service'));assert(!h.all().some(n=>n.props?.['data-testid']==='compute-profile-plain-ssh'));const saved=row(h,ssh.id);assert.equal(h.all(saved).filter(n=>n.type==='button'&&n.props.className==='button primary').length,1);edit(h,ssh.id);await h.flush();assert(h.id('compute-editor-service'));assert.deepEqual(h.connected,[]);}finally{h.unmount();}});
test('setup imports only the chosen SSH reference into an unsaved form',async()=>{
 const ref='fixture-ref',imported={name:'Example cluster',host:'example.invalid',username:'researcher',port:2222,ssh_client:'/usr/bin/ssh',identity_file:'~/.ssh/example',proxy_jump:['jump.example.invalid'],via:[]};
 const h=harness({profiles:[local,ssh],props:{preferredKind:'ssh'},override:(method,data,standard)=>{
  if(method==='ssh.existing')return [{ref,label:'Example'}];
  if(method==='ssh.import'){assert.deepEqual(data,{ref});return imported;}
  return standard(method,data);
 }});
 try{
  await h.flush();assert.deepEqual(h.calls.map(call=>call.method),['compute.profiles.list']);
  assert.equal(h.all().filter(n=>n.props?.['data-testid']==='saved-compute-profile').length,1);
  h.clickId('compute-import-ssh');await h.flush();
  h.find(n=>n.type==='select'&&n.props['aria-label']==='选择连接来源').props.onChange({target:{value:ref}});
  await h.flush();assert.equal(h.id('compute-profile-host').props.value,imported.host);
  assert.equal(h.id('compute-profile-username').props.value,imported.username);
  assert.deepEqual(h.connected,[]);assert.ok(!h.calls.some(c=>c.method==='compute.profiles.save'));
 }finally{h.unmount();}
});

test('an imported route needing review cannot become a saved or active SSH profile',async()=>{
 const h=harness({props:{preferredKind:'ssh'},override:(m,d,standard)=>m==='ssh.existing'?[{ref:'r',label:'Example'}]:m==='ssh.import'?{import_review:{requires_review:true}}:standard(m,d)});
 try{
  await h.flush();h.clickId('compute-import-ssh');await h.flush();
  h.find(n=>n.type==='select'&&n.props['aria-label']==='选择连接来源').props.onChange({target:{value:'r'}});
  await h.flush();assert.ok(h.all().some(n=>n.props?.role==='alert'));
  assert.ok(!h.all().some(n=>n.props?.['data-testid']==='compute-profile-editor'));assert.deepEqual(h.connected,[]);
 }finally{h.unmount();}
});
