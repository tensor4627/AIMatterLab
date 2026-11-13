import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {sshUiHarness} from '../helpers/ssh-ui-hooks.mjs';
const file=new URL('../../frontend/features/terminal/SshConnectionPanel.tsx',import.meta.url);
const pending={schemaVersion:2,connectionId:'connection',profileId:'profile',profileVersion:1,loginRequestId:'request',status:'authenticating',authentication:'pending',capabilities:{multiplex:true},terminalSessionIds:[],serviceIds:[],revision:1};
const shell={sessionId:'shell',connectionId:'connection',resource:{kind:'ssh-connection',connectionId:'connection',profileId:'profile',profileVersion:1},name:'Original shell',owner:'human',ownerEpoch:1,alive:true};
const connected={...pending,status:'authenticated',authentication:'verified',terminalSessionIds:['shell'],revision:2};
const complete={connection:connected,shell,login:{status:'complete'}};
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
  if(method==='compute.resource.activate')return options.activate?options.activate(data):{...data,schemaVersion:2,status:'selected'};
  throw Error('Unexpected recovery call '+method);
 }});
 return {h,errors,resources,setStatus:value=>{status=value;state=value.connection;sessions=value.shell?[value.shell]:[];},postCount:()=>posts};
}
test('an unknown completion is observed read-only and its late exact shell is adopted without another SSH request',async()=>{
 const f=fixture({complete:()=>{throw Error('terminal_login_unknown');}}),{h}=f;
 try{await h.flush();assert.equal(f.postCount(),1);assert.equal(f.errors[0].code,'terminal_login_unknown');assert.equal(f.errors[0].action,'compute.sshConnection.completeLogin');assert.equal(h.id('ssh-error-code').props.children,'terminal_login_unknown');f.setStatus(complete);h.click('ssh-login-refresh');await h.flush();await h.tick(700);assert(h.id('ssh-shell-owner'));assert.equal(f.postCount(),1);assert.equal(f.resources.length,1);assert(!h.calls.some(c=>['compute.sshConnection.openShell','sharedTerminal.owner','compute.sshService.owner','compute.sshService.connect'].includes(c.method)));assert.equal(h.calls.filter(c=>c.method==='compute.sshConnection.open').length,1);assert(h.calls.filter(c=>c.method==='compute.sshConnection.loginStatus').every(c=>c.data.requestId==='request'));}finally{h.unmount();}
});
test('slow checks keep authentication input unlocked and checking responses never cause another POST',async()=>{
 const held=deferred(),f=fixture({complete:()=>held.promise}),{h}=f;
 try{await h.flush();await h.tick(700);await h.tick(700);assert.equal(f.postCount(),1);const auth=h.find(n=>n.type?.name==='ChannelTerminal');assert.equal(auth.props.inputState.locked,false);held.resolve({connection:pending,login:{status:'checking',phase:'checking_authentication'}});await h.flush();f.setStatus({connection:pending,login:{status:'checking',phase:'opening_shell'}});await h.tick(700);await h.tick(700);assert.equal(f.postCount(),1);assert(h.calls.some(c=>c.method==='compute.sshConnection.loginStatus'));assert(!h.find(n=>n.props?.['data-testid']==='ssh-login-continue'));f.setStatus(complete);await h.tick(700);assert(h.id('ssh-shell-owner'));assert.equal(f.postCount(),1);}finally{h.unmount();}
});
test('only a human continue action retries a failed or waiting original login with the same request id',async()=>{
 const f=fixture({complete:({posts})=>{if(posts===1)throw Error('terminal_login_unknown');return complete;}}),{h}=f;
 try{await h.flush();await h.tick(700);await h.tick(700);assert.equal(f.postCount(),1);assert.equal(h.id('ssh-login-continue').props.disabled,false);h.click('ssh-login-continue');await h.flush();assert.equal(f.postCount(),2);assert(h.id('ssh-shell-owner'));assert(h.calls.filter(c=>c.method==='compute.sshConnection.completeLogin').every(c=>c.data.requestId==='request'));assert.equal(h.calls.filter(c=>c.method==='compute.sshConnection.open').length,1);}finally{h.unmount();}
});
test('failed authentication status retains the original login terminal and a precise fixed reason',async()=>{
 const f=fixture({complete:()=>{throw Error('terminal_login_unknown');}}),{h}=f;
 try{await h.flush();f.setStatus({connection:pending,login:{status:'failed',phase:'checking_authentication',code:'ssh_authentication_unconfirmed'}});await h.tick(700);assert(h.find(n=>n.type?.name==='ChannelTerminal'&&!n.props.shell));assert.equal(h.id('ssh-error-code').props.children,'ssh_authentication_unconfirmed');assert(h.id('ssh-login-continue'));assert.equal(f.postCount(),1);assert(!JSON.stringify(h.id('ssh-login-error')).includes('操作结果尚未确认'));}finally{h.unmount();}
});
test('resource selection failure preserves the exact shell and its error stage, without replaying login or granting an owner',async()=>{
 let activations=0;const f=fixture({complete:()=>complete,activate:data=>{if(++activations===1)throw Error('compute_resource_context_changed');return {...data,schemaVersion:2,status:'selected'};}}),{h}=f;
 try{await h.flush();assert(h.id('ssh-shell-owner'));assert.equal(h.id('ssh-error-code').props.children,'compute_resource_context_changed');assert.equal(f.errors[0].code,'compute_resource_context_changed');assert.equal(f.errors[0].action,'compute.resource.activate');await h.tick(700);assert.equal(f.postCount(),1);assert.equal(activations,1);assert(!h.calls.some(c=>c.method==='sharedTerminal.owner'));h.click('ssh-activate-resource');await h.flush();assert.equal(activations,2);assert.equal(f.postCount(),1);assert.equal(f.resources.length,1);}finally{h.unmount();}
});
for(const foreign of [
 {...complete,connection:{...connected,profileId:'foreign'}},
 {...complete,connection:{...connected,loginRequestId:'foreign-request'}},
 {...complete,shell:{...shell,connectionId:'foreign'}},
 {...complete,shell:{...shell,resource:{...shell.resource,profileVersion:2}}},
 {...complete,connection:{...connected,terminalSessionIds:[]}},
])test('foreign login result cannot select a shell or activate a resource: '+JSON.stringify(foreign),async()=>{
 const f=fixture({complete:()=>{throw Error('terminal_login_unknown');}}),{h}=f;
 try{await h.flush();f.setStatus(foreign);await h.tick(700);assert(!h.find(n=>n.props?.['data-testid']==='ssh-shell-owner'));assert.equal(f.resources.length,0);assert(!h.calls.some(c=>c.method==='compute.resource.activate'));assert.equal(f.postCount(),1);}finally{h.unmount();}
});
for(const change of [{resourceScope:'scope-B'},{provider:'deepseek'},{request:{nonce:'request',profileId:'foreign-profile',version:1}}])test('a late completion after context changes cannot adopt or activate the old connection: '+JSON.stringify(change),async()=>{
 const held=deferred(),f=fixture({complete:()=>held.promise}),{h}=f;
 try{await h.flush();h.render(change);await h.flush();held.resolve(complete);await h.flush();await h.tick(700);assert(!h.find(n=>n.props?.['data-testid']==='ssh-shell-owner'));assert(!h.calls.some(c=>c.method==='compute.resource.activate'));assert.equal(f.postCount(),1);assert.equal(f.resources.length,0);}finally{h.unmount();}
});
test('a completed original login without a remaining shell never recreates the closed shell',async()=>{
 const f=fixture({complete:()=>{throw Error('terminal_login_unknown');}}),{h}=f;
 try{await h.flush();f.setStatus({connection:{...connected,terminalSessionIds:[]},login:{status:'complete'}});await h.tick(700);await h.tick(700);assert.equal(f.postCount(),1);assert(!h.find(n=>n.props?.['data-testid']==='ssh-shell-owner'));assert(!h.calls.some(c=>c.method==='compute.sshConnection.openShell'));}finally{h.unmount();}
});
test('fixed login and resource error codes survive Electron message wrappers and have specific descriptions',()=>{
 const m={exports:{}};new Function('module','exports',ts.transpileModule(fs.readFileSync(new URL('../../frontend/features/compute/ssh-connection-types.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(m,m.exports);
 for(const code of ['terminal_login_unknown','terminal_unavailable','terminal_invalid_request','terminal_session_limit','terminal_start_failed','terminal_service_active','ssh_connection_changed','ssh_authentication_unconfirmed','ssh_master_identity_changed','ssh_master_unavailable','ssh_control_identity_changed','ssh_control_unavailable','ssh_control_timeout','ssh_control_output_limit','ssh_channel_unavailable','ssh_client_unavailable','ssh_invalid_profile','compute_resource_context_changed','compute_resource_not_available','compute_resource_unverified_state']){const error=Object.assign(Error("Error invoking remote method 'studio:compute.sshConnection.completeLogin': Error: "+code),{code:'ERR_IPC_REMOTE'});assert.equal(m.exports.sshConnectionCode(error),code);assert(!m.exports.sshConnectionMessage(error).startsWith('操作结果尚未确认'),code);}
});
