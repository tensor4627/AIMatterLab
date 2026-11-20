import test from 'node:test';
import assert from 'node:assert/strict';
import {sshUiHarness} from '../helpers/ssh-ui-hooks.mjs';

const file=new URL('../../frontend/features/terminal/SshConnectionPanel.tsx',import.meta.url);
const connection={schemaVersion:2,connectionId:'connection',profileId:'profile',profileVersion:1,loginRequestId:'original-login',status:'authenticated',authentication:'verified',capabilities:{multiplex:true},terminalSessionIds:['shell'],serviceIds:[],revision:1};
const identity=(ownerEpoch=2,sessionId='shell',connectionId='connection')=>({connectionId,sessionId,ownerEpoch});
const error=(code='terminal_owner_changed',action='sharedTerminal.read')=>Object.assign(Error(code),{code,action});
function fixture(){
 let shell={...identity(),name:'Original shell',owner:'agent',alive:true},sessions=[shell];const globalErrors=[];
 const h=sshUiHarness(file,{props:{visible:true,request:{nonce:'request',profileId:'profile',version:1,connectionId:'connection'},provider:'deepseek',canShare:true,onError:e=>globalErrors.push(e)},invoke:async(method,data)=>{
  if(method==='compute.sshConnection.list')return {connections:[connection]};
  if(method==='compute.sshConnection.loginStatus')return {connection,login:{status:'complete'},...shell.alive===true?{shell}:{}};
  if(method==='compute.sshService.status')return {schemaVersion:2,status:'connected',connectionId:'connection',workflowReady:true,operator:'agent'};
  if(method==='sharedTerminal.list')return {sessions};
  if(method==='compute.resource.activate')return {...data,schemaVersion:2,status:'selected'};
  throw Error('Unexpected recovery fixture call '+method);
 }});
 const channel=()=>h.find(n=>n.type?.name==='ChannelTerminal');
 return {h,globalErrors,channel,setShell(next){shell={...shell,...next};sessions=[shell];},readError(value=error(),scope=identity()){const c=channel();if(c.props.onReadError)c.props.onReadError(value,scope);else c.props.onError(value);h.render();},readSuccess(scope=identity()){channel().props.onReadSuccess?.(scope);h.render();}};
}

test('old epoch read failure stays local and clears only after refresh plus a successful matching new read',async()=>{
 const f=fixture(),{h}=f;try{await h.flush();f.readError();await h.flush();assert.equal(f.globalErrors.length,0,'a read observation must not leave a global stale toast');assert(h.find(n=>n.props?.['data-testid']==='ssh-read-error-code'));
  f.setShell({ownerEpoch:3});h.click('ssh-login-refresh');await h.flush();assert(h.find(n=>n.props?.['data-testid']==='ssh-read-error-code'),'refresh is not proof that reading has recovered');f.readSuccess(identity(2));await h.flush();assert(h.find(n=>n.props?.['data-testid']==='ssh-read-error-code'),'old epoch success cannot clear the current observation');f.readSuccess(identity(3));await h.flush();assert(!h.find(n=>n.props?.['data-testid']==='ssh-read-error-code'));assert(!h.find(n=>n.props?.className==='shared-terminal-notice'&&String(n.props.children).includes('终端操作权')));
 }finally{h.unmount();}
});

test('ongoing read failures and foreign shell/connection successes remain visible',async()=>{
 const f=fixture(),{h}=f;try{await h.flush();f.readError(error('terminal_unavailable'));await h.flush();f.readSuccess(identity(2,'foreign-shell'));f.readSuccess(identity(2,'shell','foreign-connection'));await h.flush();assert.equal(h.id('ssh-read-error-code').props.children,'terminal_unavailable');f.readError(error('terminal_unavailable'));await h.flush();assert.equal(h.id('ssh-read-error-code').props.children,'terminal_unavailable');assert.equal(f.globalErrors.length,0);}finally{h.unmount();}
});

test('one SSH control timeout is shown for both reading and resizing the same shell',async()=>{
 const f=fixture(),{h}=f;
 try{
  await h.flush();f.readError(error('ssh_control_timeout'));
  f.channel().props.onGeometry({...identity(),code:'ssh_control_timeout'});h.render();await h.flush();
  assert.equal(h.id('ssh-read-error-code').props.children,'ssh_control_timeout');
  assert(!h.find(n=>n.props?.['data-testid']==='ssh-resize-observation'));
  f.channel().props.onGeometry({...identity(),code:'terminal_unavailable'});h.render();await h.flush();
  assert(h.id('ssh-resize-observation'),'an independent resize failure remains visible');
 }finally{h.unmount();}
});

test('successful read never clears an input failure or an unknown shell state',async()=>{
 const f=fixture(),{h}=f;try{await h.flush();f.channel().props.onError(error('terminal_owner_changed','sharedTerminal.input'));h.render();f.readError(error('terminal_unavailable'));await h.flush();f.setShell({alive:null});h.click('ssh-login-refresh');await h.flush();f.readSuccess();await h.flush();assert.equal(h.id('ssh-error-code').props.children,'terminal_owner_changed');assert.equal(h.id('ssh-read-error-code').props.children,'terminal_unavailable');assert.equal(f.globalErrors.length,1);
  f.setShell({alive:true});h.click('ssh-login-refresh');await h.flush();f.readSuccess();await h.flush();assert(!h.find(n=>n.props?.['data-testid']==='ssh-read-error-code'));assert.equal(h.id('ssh-error-code').props.children,'terminal_owner_changed');assert.equal(f.globalErrors.length,1);
 }finally{h.unmount();}
});
