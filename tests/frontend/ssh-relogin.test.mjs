import test from 'node:test';
import assert from 'node:assert/strict';
import {sshUiHarness} from '../helpers/ssh-ui-hooks.mjs';

const file=new URL('../../frontend/features/terminal/SshConnectionPanel.tsx',import.meta.url);
const connection=(connectionId,requestId,status='authenticating',error)=>({schemaVersion:2,connectionId,profileId:'profile',profileVersion:1,loginRequestId:requestId,status,authentication:status==='authenticated'?'verified':status==='authenticating'?'pending':'not_observed',capabilities:{multiplex:status==='authenticated'},terminalSessionIds:[],serviceIds:[],revision:status==='authenticating'?1:2,...error?{error:{code:error}}:{}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture({open,complete,status}={}){
 const states=new Map(),errors=[],resources=[];
 const h=sshUiHarness(file,{props:{visible:true,request:{nonce:'original-request',profileId:'profile',version:1},provider:'codex',resourceScope:'scope',canShare:true,onError:error=>errors.push(error),onResourceChange:value=>resources.push(value)},invoke:async(method,data)=>{
  if(method==='compute.sshConnection.list')return {connections:[...states.values()]};
  if(method==='compute.sshConnection.open'){const next=await open(data,states);states.set(next.connectionId,next);return next;}
  if(method==='compute.sshConnection.completeLogin')return complete?complete(data,states):{connection:states.get(data.connectionId),login:{status:'waiting_authentication'}};
  if(method==='compute.sshConnection.loginStatus')return status?status(data,states):{connection:states.get(data.connectionId),login:{status:'waiting_authentication'}};
  if(method==='compute.sshService.status')return {schemaVersion:2,status:'disconnected'};
  if(method==='sharedTerminal.list')return {sessions:[]};
  if(method==='compute.resource.activate')return {...data,schemaVersion:2,status:'selected'};
  throw Error('Unexpected relogin fixture IPC '+method);
 }});
 return {h,states,errors,resources};
}

for(const rootCode of ['terminal_start_failed','terminal_runtime_low_integrity','ssh_master_identity_changed'])test('current failed connection exposes '+rootCode+' instead of a derivative completion mismatch',async()=>{
 const f=fixture({open:data=>connection('original',data.requestId),complete:(data,states)=>{states.set(data.connectionId,connection(data.connectionId,data.requestId,'unavailable',rootCode));throw Error('ssh_connection_changed');}}),{h}=f;
 try{await h.flush();await h.tick(2000);assert.equal(h.id('ssh-error-code').props.children,rootCode);assert(h.id('ssh-login-retry'));assert(!h.find(n=>n.props?.['data-testid']==='ssh-shell-owner'));assert.equal(f.resources.length,0);assert.equal(h.calls.filter(c=>c.method==='compute.sshConnection.open').length,1);}finally{h.unmount();}
});

test('explicit relogin clears prior failed progress while waiting and binds only the new request',async()=>{
 const held=deferred();let opens=0;const f=fixture({open:data=>++opens===1?connection('original',data.requestId):held.promise,complete:(data,states)=>{states.set(data.connectionId,connection(data.connectionId,data.requestId,'unavailable','terminal_start_failed'));return {connection:states.get(data.connectionId),login:{status:'failed',code:'terminal_start_failed'}};}}),{h}=f;
 try{
  await h.flush();assert(h.id('ssh-login-error'));h.click('ssh-login-retry');await h.flush();const calls=h.calls.filter(c=>c.method==='compute.sshConnection.open');assert.equal(calls.length,2);assert.notEqual(calls[1].data.requestId,calls[0].data.requestId);assert(!h.find(n=>n.props?.['data-testid']==='ssh-login-progress'),'old failed login progress must not describe the new opening');assert(!h.find(n=>n.props?.['data-testid']==='ssh-login-error'),'old connection error must not describe the new opening');
  held.resolve(connection('replacement',calls[1].data.requestId));await h.flush();assert(h.calls.some(c=>c.method==='compute.sshConnection.completeLogin'&&c.data.connectionId==='replacement'&&c.data.requestId===calls[1].data.requestId));assert(!h.calls.some(c=>['sharedTerminal.close','compute.sshConnection.close','compute.profiles.save'].includes(c.method)));
 }finally{held.resolve(connection('replacement','cleanup'));h.unmount();}
});

test('a foreign completion identity is still rejected when the current connection has no failed-startup receipt',async()=>{
 const f=fixture({open:data=>connection('original',data.requestId),complete:data=>({connection:connection('foreign',data.requestId),login:{status:'failed',code:'terminal_start_failed'}})}),{h}=f;
 try{await h.flush();assert.equal(h.id('ssh-error-code').props.children,'ssh_connection_changed');assert.equal(f.resources.length,0);assert(!h.find(n=>n.props?.['data-testid']==='ssh-shell-owner'));}finally{h.unmount();}
});

for(const changed of [{nonce:'original-request',profileId:'other-profile',version:1},{nonce:'original-request',profileId:'profile',version:2}])test('late open cannot select an old profile after same-nonce request changes '+JSON.stringify(changed),async()=>{
 const held=deferred(),f=fixture({open:()=>held.promise}),{h}=f;
 try{await h.flush();h.render({request:changed});await h.flush();held.resolve(connection('old-profile','original-request'));await h.flush();assert(!h.find(n=>n.type?.name==='ChannelTerminal'));assert(!h.calls.some(c=>['compute.sshConnection.completeLogin','compute.resource.activate'].includes(c.method)));assert.equal(f.resources.length,0);}finally{held.resolve(null);h.unmount();}
});
