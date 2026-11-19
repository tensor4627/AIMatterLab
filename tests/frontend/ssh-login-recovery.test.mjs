import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {sshUiHarness} from '../helpers/ssh-ui-hooks.mjs';
import {createManagedComputeResources} from '../../backend/main/compute/managed-compute-resources.mjs';
const file=new URL('../../frontend/features/terminal/SshConnectionPanel.tsx',import.meta.url);
const pending={schemaVersion:2,connectionId:'connection',profileId:'profile',profileVersion:1,loginRequestId:'request',status:'authenticating',authentication:'pending',capabilities:{multiplex:true},terminalSessionIds:[],serviceIds:[],revision:1};
const shell={sessionId:'shell',connectionId:'connection',resource:{kind:'ssh-connection',connectionId:'connection',profileId:'profile',profileVersion:1},name:'Original shell',owner:'human',ownerEpoch:1,alive:true};
const connected={...pending,status:'authenticated',authentication:'verified',terminalSessionIds:['shell'],revision:2};
const complete={connection:connected,shell,login:{status:'complete'}};
const published={resourceId:'ssh:profile',connectionId:'connection',profileId:'profile',profileVersion:1,kind:'ssh',name:'Fixture',serviceReady:false};
const publishCalls=h=>h.calls.filter(call=>call.method==='compute.managed.publish');
const shellChannel=h=>h.find(n=>n.type?.name==='ChannelTerminal'&&n.props.shell);
const authorizationCalls=h=>h.calls.filter(call=>['compute.resource.activate','sharedTerminal.owner','compute.sshService.owner','compute.sshService.connect','agent.rpc'].includes(call.method));

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function fixture(options={}){
 let state=null,sessions=[],status={connection:pending,login:{status:'waiting_authentication'}},posts=0;const errors=[],resources=[];
 const h=sshUiHarness(file,{props:{visible:true,request:{nonce:'request',profileId:'profile',version:1},resourceScope:'scope-A',provider:'codex',canShare:true,onError:e=>errors.push(e),onResourceChange:value=>resources.push(value),...options.props},invoke:async(method,data)=>{
  if(method==='compute.sshConnection.list')return {connections:state?[state]:[]};
  if(method==='compute.sshConnection.open'){state=pending;return state;}
  if(method==='compute.sshService.status')return {schemaVersion:2,status:'disconnected'};
  if(method==='sharedTerminal.list')return {sessions};
  if(method==='compute.sshConnection.completeLogin'){posts++;const result=await (options.complete?options.complete({posts,data}):{connection:pending,login:{status:'waiting_authentication'}});state=result.connection;sessions=result.shell?[result.shell]:[];return result;}
  if(method==='compute.sshConnection.loginStatus')return options.status?options.status(data):status;
  if(method==='compute.managed.publish')return options.publish?options.publish(data):published;
  throw Error('Unexpected recovery call '+method);
 }});
 return {h,errors,resources,setStatus:value=>{status=value;state=value.connection;sessions=value.shell?[value.shell]:[];},observeStatus:value=>{status=value;},postCount:()=>posts};
}
test('an unknown completion is observed read-only and its late exact shell is adopted without another SSH request',async()=>{
 const f=fixture({complete:()=>{throw Error('terminal_login_unknown');}}),{h}=f;
 try{await h.flush();assert.equal(f.postCount(),1);assert.equal(f.errors[0].code,'terminal_login_unknown');assert.equal(f.errors[0].action,'compute.sshConnection.completeLogin');assert.equal(h.id('ssh-error-code').props.children,'terminal_login_unknown');f.setStatus(complete);h.click('ssh-login-refresh');await h.flush();await h.tick(700);assert.equal(shellChannel(h).props.shell.sessionId,shell.sessionId);assert(h.id('ssh-publish-resource'));assert.equal(f.postCount(),1);assert.equal(f.resources.length,0);assert.deepEqual(publishCalls(h),[]);assert(!h.calls.some(c=>['compute.sshConnection.openShell','sharedTerminal.owner','compute.sshService.owner','compute.sshService.connect'].includes(c.method)));assert.equal(h.calls.filter(c=>c.method==='compute.sshConnection.open').length,1);assert(h.calls.filter(c=>c.method==='compute.sshConnection.loginStatus').every(c=>c.data.requestId==='request'));}finally{h.unmount();}
});
test('slow checks keep authentication input unlocked and checking responses never cause another POST',async()=>{
 const held=deferred(),f=fixture({complete:()=>held.promise}),{h}=f;
 try{await h.flush();await h.tick(700);await h.tick(700);assert.equal(f.postCount(),1);const auth=h.find(n=>n.type?.name==='ChannelTerminal');assert.equal(auth.props.inputState.locked,false);held.resolve({connection:pending,login:{status:'checking',phase:'checking_authentication'}});await h.flush();f.setStatus({connection:pending,login:{status:'checking',phase:'opening_shell'}});await h.tick(700);await h.tick(700);assert.equal(f.postCount(),1);assert(h.calls.some(c=>c.method==='compute.sshConnection.loginStatus'));assert(!h.find(n=>n.props?.['data-testid']==='ssh-login-continue'));f.setStatus(complete);await h.tick(700);assert.equal(shellChannel(h).props.shell.sessionId,shell.sessionId);assert(h.id('ssh-publish-resource'));assert.equal(f.postCount(),1);}finally{h.unmount();}
});
test('only a human continue action retries a failed or waiting original login with the same request id',async()=>{
 const f=fixture({complete:({posts})=>{if(posts===1)throw Error('terminal_login_unknown');return complete;}}),{h}=f;
 try{await h.flush();await h.tick(700);await h.tick(700);assert.equal(f.postCount(),1);assert.equal(h.id('ssh-login-continue').props.disabled,false);h.click('ssh-login-continue');await h.flush();assert.equal(f.postCount(),2);assert.equal(shellChannel(h).props.shell.sessionId,shell.sessionId);assert(h.id('ssh-publish-resource'));assert(h.calls.filter(c=>c.method==='compute.sshConnection.completeLogin').every(c=>c.data.requestId==='request'));assert.equal(h.calls.filter(c=>c.method==='compute.sshConnection.open').length,1);}finally{h.unmount();}
});
test('failed authentication status retains the original login terminal and a precise fixed reason',async()=>{
 const f=fixture({complete:()=>{throw Error('terminal_login_unknown');}}),{h}=f;
 try{await h.flush();f.setStatus({connection:pending,login:{status:'failed',phase:'checking_authentication',code:'ssh_authentication_unconfirmed'}});await h.tick(700);assert(h.find(n=>n.type?.name==='ChannelTerminal'&&!n.props.shell));assert.equal(h.id('ssh-error-code').props.children,'ssh_authentication_unconfirmed');assert(h.id('ssh-login-continue'));assert.equal(f.postCount(),1);assert(!JSON.stringify(h.id('ssh-login-error')).includes('操作结果尚未确认'));}finally{h.unmount();}
});
test('a publish failure retains the exact human shell and can be retried without repeating login',async()=>{
 let attempts=0;const f=fixture({complete:()=>complete,publish:()=>{if(++attempts===1)throw Error('compute_resource_context_changed');return published;}}),{h}=f;
 try{
  await h.flush();assert.equal(shellChannel(h).props.shell.sessionId,shell.sessionId);assert.equal(attempts,0);
  h.click('ssh-publish-resource');await h.flush();assert.equal(h.id('ssh-error-code').props.children,'compute_resource_context_changed');
  assert.equal(f.errors[0].action,'compute.managed.publish');assert.equal(shellChannel(h).props.shell.owner,'human');assert.equal(f.postCount(),1);
  await h.tick(700);assert.equal(attempts,1);assert.equal(h.id('ssh-publish-resource').props.disabled,false);
  h.click('ssh-publish-resource');await h.flush();assert.equal(attempts,2);assert.equal(f.postCount(),1);assert.equal(f.resources.length,0);
  assert.deepEqual(publishCalls(h).map(c=>c.data),Array(2).fill({connectionId:'connection',profileId:'profile',profileVersion:1}));
  assert.deepEqual(authorizationCalls(h),[]);
 }finally{h.unmount();}
});

test('login completion keeps the original human terminal editable while publication is pending',async()=>{
 const held=deferred(),f=fixture({complete:()=>complete,publish:()=>held.promise}),{h}=f;
 try{
  await h.flush();const owner=shellChannel(h).props;assert.equal(owner.inputState.locked,false);
  assert.deepEqual(publishCalls(h),[]);h.click('ssh-publish-resource');await h.flush();
  assert.equal(h.id('ssh-publish-resource').props.disabled,true);assert.equal(shellChannel(h).props.inputState.locked,false);
  assert.equal(shellChannel(h).props.shell.ownerEpoch,owner.shell.ownerEpoch);assert.deepEqual(authorizationCalls(h),[]);
  held.resolve(published);await h.flush();assert.equal(f.postCount(),1);assert.equal(publishCalls(h).length,1);
 }finally{held.resolve(null);h.unmount();}
});

test('the publish button accepts the real desktop receipt before a resource-list refresh',async t=>{
 const profile={id:'profile',version:1,name:'Fixture',kind:'ssh',host:'fixture.invalid',port:22,username:'fixture',ssh_client:'ssh'};
 const manager=createManagedComputeResources({
  terminal:{connections:{state:async ref=>{assert.equal(ref.connectionId,connected.connectionId);return connected;}}},
  profiles:{read:({id})=>id===profile.id?profile:null},
 });
 const f=fixture({complete:()=>complete,publish:ref=>manager.publish(ref)}),{h}=f;
 t.after(async()=>{h.unmount();await manager.stop();});
 await h.flush();
 h.click('ssh-publish-resource');
 await h.flush();
 assert.deepEqual(f.errors,[]);
 assert.equal(h.id('ssh-managed-status').props.role,'status');
 assert(!h.find(node=>node.props?.['data-testid']==='ssh-publish-resource'));
 assert.equal(shellChannel(h).props.shell.sessionId,shell.sessionId);
 assert.equal(shellChannel(h).props.shell.owner,'human');
 assert.equal(f.postCount(),1);
 assert.equal(publishCalls(h).length,1);
 assert.deepEqual(authorizationCalls(h),[]);
 const cached=manager.snapshot();
 assert.equal(cached.length,1);
 const [attempt]=publishCalls(h);
 const duplicate=await manager.publish(attempt.data);
 assert.deepEqual(duplicate,cached[0]);
 assert.equal(duplicate.connectionId,connected.connectionId);
});

for(const foreign of [{...published,connectionId:undefined},{...published,connectionId:'other'},{...published,profileId:'other'},{...published,profileVersion:2}])test('publication refuses a receipt for a different connection, profile or version: '+JSON.stringify(foreign),async()=>{
 const f=fixture({complete:()=>complete,publish:()=>foreign}),{h}=f;
 try{
  await h.flush();h.click('ssh-publish-resource');await h.flush();
  assert.equal(h.id('ssh-error-code').props.children,'ssh_connection_changed');assert.equal(f.errors.at(-1).action,'compute.managed.publish');
  assert.equal(shellChannel(h).props.shell.sessionId,shell.sessionId);assert.equal(h.id('ssh-publish-resource').props.disabled,false);
  assert.equal(f.postCount(),1);assert.deepEqual(authorizationCalls(h),[]);
 }finally{h.unmount();}
});
for(const foreign of [
 {...complete,connection:{...connected,profileId:'foreign'}},
 {...complete,connection:{...connected,loginRequestId:'foreign-request'}},
 {...complete,shell:{...shell,connectionId:'foreign'}},
 {...complete,shell:{...shell,resource:{...shell.resource,profileVersion:2}}},
 {...complete,connection:{...connected,terminalSessionIds:[]}},
])test('foreign login result cannot adopt a shell or publish a resource: '+JSON.stringify(foreign),async()=>{
 const f=fixture({complete:()=>{throw Error('terminal_login_unknown');}}),{h}=f;
 try{await h.flush();f.observeStatus(foreign);await h.tick(700);assert(!shellChannel(h));assert.equal(f.resources.length,0);assert.deepEqual(publishCalls(h),[]);assert.deepEqual(authorizationCalls(h),[]);assert(h.id('ssh-error-code'));assert.equal(f.postCount(),1);}finally{h.unmount();}
});
for(const change of [{resourceScope:'scope-B'},{provider:'deepseek',canShare:false}])test('the same login retains its shell across a provider or chat selection change: '+JSON.stringify(change),async()=>{
 const held=deferred(),f=fixture({complete:()=>held.promise}),{h}=f;
 try{
  await h.flush();h.render(change);await h.flush();held.resolve(complete);await h.flush();await h.tick(700);
  assert.equal(shellChannel(h).props.shell.sessionId,shell.sessionId);assert.equal(shellChannel(h).props.shell.owner,'human');
  assert.equal(f.postCount(),1);assert.equal(h.calls.filter(c=>c.method==='compute.sshConnection.open').length,1);
  assert.deepEqual(authorizationCalls(h),[]);assert.deepEqual(publishCalls(h),[]);
  h.click('ssh-publish-resource');await h.flush();assert.deepEqual(publishCalls(h).map(c=>c.data),[{connectionId:'connection',profileId:'profile',profileVersion:1}]);
 }finally{h.unmount();}
});

test('changing the requested SSH profile still rejects the previous login completion',async()=>{
 const held=deferred(),f=fixture({complete:()=>held.promise}),{h}=f;
 try{await h.flush();h.render({request:{nonce:'request',profileId:'foreign-profile',version:1}});await h.flush();held.resolve(complete);await h.flush();await h.tick(700);assert(!shellChannel(h));assert(!h.find(n=>n.props?.['data-testid']==='ssh-publish-resource'));assert.deepEqual(publishCalls(h),[]);assert.equal(f.postCount(),1);}finally{h.unmount();}
});
test('a completed original login without a remaining shell never recreates the closed shell',async()=>{
 const f=fixture({complete:()=>{throw Error('terminal_login_unknown');}}),{h}=f;
 try{await h.flush();f.setStatus({connection:{...connected,terminalSessionIds:[]},login:{status:'complete'}});await h.tick(700);await h.tick(700);assert.equal(f.postCount(),1);assert(!shellChannel(h));assert(!h.calls.some(c=>c.method==='compute.sshConnection.openShell'));}finally{h.unmount();}
});
test('fixed login and resource error codes survive Electron message wrappers and have specific descriptions',()=>{
 const m={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync(new URL('../../frontend/features/compute/ssh-connection-types.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m,m.exports);
 for(const code of ['terminal_login_unknown','terminal_unavailable','terminal_invalid_request','terminal_session_limit','terminal_start_failed','terminal_service_active','ssh_connection_changed','ssh_authentication_unconfirmed','ssh_master_identity_changed','ssh_master_unavailable','ssh_control_identity_changed','ssh_control_unavailable','ssh_control_timeout','ssh_control_output_limit','ssh_channel_unavailable','ssh_client_unavailable','ssh_invalid_profile','compute_resource_context_changed','compute_resource_not_available','compute_resource_unverified_state']){const error=Object.assign(Error("Error invoking remote method 'studio:compute.sshConnection.completeLogin': Error: "+code),{code:'ERR_IPC_REMOTE'});assert.equal(m.exports.sshConnectionCode(error),code);assert(!m.exports.sshConnectionMessage(error).startsWith('操作结果尚未确认'),code);}
});
