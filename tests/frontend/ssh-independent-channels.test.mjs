import test from 'node:test';
import assert from 'node:assert/strict';
import {sshUiHarness} from '../helpers/ssh-ui-hooks.mjs';
const file=new URL('../../frontend/features/terminal/SshConnectionPanel.tsx',import.meta.url);
const connection={schemaVersion:2,connectionId:'connection',profileId:'profile',profileVersion:1,status:'authenticated',authentication:'verified',capabilities:{multiplex:true},terminalSessionIds:['shell'],serviceIds:['service'],revision:1};
const shell={sessionId:'shell',connectionId:'connection',name:'Independent shell',owner:'human',ownerEpoch:2,alive:true,resource:{kind:'ssh-connection',connectionId:'connection'}};
const service={schemaVersion:2,connectionId:'connection',serviceId:'service',attemptId:'attempt',status:'connected',workflowReady:true,operator:'human'};
const published={resourceId:'ssh:profile',kind:'ssh',name:'Fixture',connectionId:'connection',profileId:'profile',profileVersion:1,serviceReady:true};
const channel=h=>h.find(n=>n.type?.name==='ChannelTerminal');
const managedCalls=h=>h.calls.filter(c=>c.method==='compute.managed.publish');
const legacyCalls=h=>h.calls.filter(c=>['compute.resource.activate','sharedTerminal.owner','compute.sshService.owner','compute.sshService.connect','agent.rpc'].includes(c.method));
const snapshot=resource=>({resources:[resource],conversations:[],sources:[]});

test('native login waits for human handoff and a workspace failure stays within workspace review',async()=>{
 const pending={...connection,status:'authenticating',authentication:'pending',terminalSessionIds:[],serviceIds:[],
  loginRequestId:'exact-login',capabilities:{multiplex:false,manualHandoff:true}};
 const verified={...connection,terminalSessionIds:[],serviceIds:[],loginRequestId:pending.loginRequestId};
 let state=pending;
 const h=await selected({props:{workspacePreviewError:Error('ssh_workspace_unconfirmed')},override(method,ref){
  if(method==='compute.sshConnection.list')return {connections:[state]};
  if(method==='compute.sshConnection.loginStatus')return {connection:state,login:{status:state===pending?'waiting_authentication':'complete'}};
  if(method==='compute.sshConnection.completeLogin'){
   assert.deepEqual(ref,{connectionId:pending.connectionId,requestId:pending.loginRequestId,userConfirmed:true});
   state=verified;return {connection:verified,login:{status:'complete'}};
  }
  if(method==='sharedTerminal.list')return {sessions:[]};
 }});
 try{
  await h.tick(700);await h.tick(2000);
  assert.match(h.id('ssh-publish-resource').props['aria-label'],/登录完成，交由 AIMatterLab 管理/);
  const writes=()=>h.calls.filter(c=>/completeLogin|resourceWorkspace\.preview|openShell|managed\.publish/.test(c.method)).map(c=>c.method);
  assert.deepEqual(writes(),[]);
  h.click('ssh-publish-resource');await h.flush();
  assert.deepEqual(writes(),['compute.sshConnection.completeLogin','compute.resourceWorkspace.preview']);
  const review=h.find(node=>node.type==='ResourceWorkspaceReview');
  assert.match(review.props.initialError,/未返回有效的工作区回执/);
  assert.equal(review.props.target.connectionId,verified.connectionId);
  assert.equal(review.props.initial,undefined);
  assert(!h.find(node=>node.props?.['data-testid']==='ssh-login-error'));
  assert.equal(h.id('ssh-connection-status').props['data-state'],'authenticated');
  assert.equal(h.id('ssh-open-shell').props.disabled,false);
 }finally{h.unmount();}
});

test('a failed inventory refresh stays in the terminal panel and a successful read clears it',async()=>{
 let fail=false;const errors=[];
 const h=await selected({props:{onError:error=>errors.push(error)},override:method=>{
  if(fail&&method==='sharedTerminal.list')throw Error('terminal_context_changed');
 }});
 try{
  fail=true;await h.tick(2000);assert(h.id('ssh-inventory-observation'));
  assert.deepEqual(errors,[]);assert(!h.find(n=>n.props?.['data-testid']==='ssh-login-error'));
  fail=false;await h.tick(2000);assert(!h.find(n=>n.props?.['data-testid']==='ssh-inventory-observation'));
 }finally{h.unmount();}
});
test('publish uses the viewed authenticated connection independent of another selected resource or provider',async()=>{
 const h=await selected({props:{provider:undefined,canShare:false,activeResource:{kind:'ssh-connection',status:'selected',connectionId:'other',profileId:'profile',profileVersion:1}}});
 try{
  assert.equal(channel(h).props.shell.owner,'human');assert.equal(h.id('ssh-publish-resource').props.disabled,false);
  h.click('ssh-publish-resource');await h.flush();
  assert.deepEqual(managedCalls(h).map(c=>c.data),[{connectionId:'connection',profileId:'profile',profileVersion:1}]);
  assert.deepEqual(legacyCalls(h),[]);assert.equal(channel(h).props.shell.ownerEpoch,shell.ownerEpoch);
 }finally{h.unmount();}
});
for(const code of ['exec_unavailable','channel_refused','channel_timeout'])test('pre-Python '+code+' remains visible while the independent human shell stays usable',async()=>{
 const h=await selected({override:method=>method==='compute.sshService.status'?{...service,status:'failed',serviceActive:false,workflowReady:false,error:{code,phase:'preparing_local'}}:undefined});
 try{
  assert.equal(channel(h).props.shell.owner,'human');assert.equal(channel(h).props.inputState.locked,false);
  assert(!h.find(n=>n.props?.['data-testid']==='ssh-worker-ready'));assert(!h.find(n=>n.props?.['data-testid']==='ssh-worker-preparing'));
  assert.match(JSON.stringify(h.id('ssh-worker-error')),/尚未运行 Python/);
  h.click('ssh-publish-resource');await h.flush();assert.deepEqual(legacyCalls(h),[]);
 }finally{h.unmount();}
});
function fixture(extra={}){let state=structuredClone(connection),currentService=structuredClone(service),sessions=[structuredClone(shell)];const h=sshUiHarness(file,{props:{visible:true,request:{nonce:'request',profileId:'profile',version:1},provider:'codex',canShare:true,onError(){},...extra.props},invoke:async(method,data)=>{if(extra.override){const value=extra.override(method,data);if(value!==undefined){if(method==='sharedTerminal.owner'&&value.service){currentService=structuredClone(value.service);sessions=[structuredClone(value)];}return value;}}if(method==='compute.sshConnection.list')return {connections:[state]};if(method==='compute.sshConnection.open'||method==='compute.sshConnection.confirm')return state;if(method==='compute.sshConnection.loginStatus')return {connection:state,login:{status:state.status==='authenticated'?'complete':'waiting_authentication'}};if(method==='compute.sshService.status')return currentService;if(method==='sharedTerminal.list')return {sessions};if(method==='compute.resource.status')return {kind:'ssh-connection',schemaVersion:2,connectionId:'connection',status:'selected'};if(method==='compute.managed.publish')return published;if(method==='compute.sshConnection.openShell')return shell;if(method==='sharedTerminal.owner'){sessions=[{...shell,owner:data.owner,ownerEpoch:3}];return sessions[0];}if(method==='sharedTerminal.close'){sessions=[];return {closed:true};}if(method==='compute.sshService.owner'){currentService={...currentService,operator:data.owner};return currentService;}if(method==='compute.sshService.disconnect'){currentService={...currentService,status:'disconnected',workflowReady:false,serviceActive:false};return currentService;}if(method==='compute.sshConnection.close'){state={...state,status:'closed',authentication:'lost',terminalSessionIds:[],serviceIds:[],revision:2,closed:true};return state;}throw Error('Unexpected channel call '+method);}});return h;}
async function selected(extra){const h=fixture(extra);await h.flush();return h;}

test('unconfirmed service health keeps verified SSH and shell, and offers only the exact service settings review',async()=>{const edits=[],h=await selected({props:{onConfigureSsh:value=>edits.push(value)},override:method=>method==='compute.sshService.status'?{...service,status:'unknown',workflowReady:false,error:{code:'worker_health_invalid'}}:undefined});try{assert.equal(channel(h).props.shell.owner,'human');assert(!h.find(n=>n.props?.['data-testid']==='ssh-login-retry'));assert(h.id('ssh-service-identity-notice'));assert(!h.find(n=>n.type==='progress'));h.click('ssh-service-review');await h.flush();assert.deepEqual(edits,[{profileId:'profile',profileVersion:1,section:'service'}]);assert(!h.calls.some(c=>['compute.sshConnection.open','compute.sshService.connect','compute.sshService.disconnect','sharedTerminal.owner'].includes(c.method)));}finally{h.unmount();}});

test('a healthy legacy runtime remains usable and does not block the human shell',async()=>{const h=await selected({override:method=>method==='compute.sshService.status'?{...service,health:{version:'legacy-fixture',runtimeId:'a'.repeat(20)}}:undefined});try{assert(h.id('ssh-worker-ready'));assert.equal(channel(h).props.shell.owner,'human');assert(!h.find(n=>n.props?.['data-testid']==='ssh-service-identity-notice'));assert(!h.calls.some(c=>c.method==='compute.sshService.connect'));}finally{h.unmount();}});
test('incomplete inventory shows a warning while the verified service and human shell stay usable',async()=>{const h=await selected({override:method=>method==='compute.sshService.status'?{...service,warnings:['tools_unavailable']}:undefined});try{assert.equal(h.id('ssh-worker-ready').props.children,'作业服务已连接');assert.match(JSON.stringify(h.id('ssh-worker-warning')),/协助配置/);assert.equal(channel(h).props.inputState.locked,false);assert.equal(channel(h).props.shell.owner,'human');assert(!h.find(n=>n.props?.['data-testid']==='ssh-worker-preparing'));}finally{h.unmount();}});
test('publishing leaves terminal input unlocked and coalesces repeated clicks while awaiting the receipt',async()=>{
 let finish;const h=await selected({override:method=>method==='compute.managed.publish'?new Promise(resolve=>finish=resolve):undefined});
 try{
  const input=channel(h).props.inputState;assert.equal(input.observationEpoch,0);
  h.click('ssh-publish-resource');h.click('ssh-publish-resource');await h.flush();
  assert.equal(h.id('ssh-publish-resource').props.disabled,true);assert.equal(input.locked,false);assert.equal(input.observationEpoch,0);
  assert.equal(managedCalls(h).length,1);assert.deepEqual(legacyCalls(h),[]);
  finish(published);await h.flush();h.render({managed:snapshot(published)});await h.flush();
  assert.equal(h.id('ssh-managed-status').type,'span');
  assert(!h.find(n=>n.props?.['data-testid']==='ssh-publish-resource'));
  assert(!h.find(n=>n.props?.['data-testid']==='ssh-diagnostics'));
 }finally{h.unmount();}
});

test('an inventory response which predates publication cannot publish a stale error',async()=>{
 let hold=false,failList,finish;const errors=[];
 const h=await selected({props:{onError:e=>errors.push(e)},override:method=>{
  if(method==='compute.managed.publish')return new Promise(resolve=>finish=resolve);
  if(hold&&method==='sharedTerminal.list')return new Promise((_r,reject)=>failList=reject);
 }});
 try{
  hold=true;await h.tick(2000);assert(failList);h.click('ssh-publish-resource');await h.flush();
  failList(Error('terminal_context_changed'));await h.flush();assert(!h.find(n=>n.props?.['data-testid']==='ssh-inventory-observation'));
  hold=false;finish(published);await h.flush();assert.deepEqual(errors,[]);assert.equal(channel(h).props.shell.sessionId,shell.sessionId);
 }finally{h.unmount();}
});

test('a connected service leaves the independent human shell selector usable',async()=>{
 const h=await selected();try{
  assert.equal(h.id('ssh-open-shell').props.disabled,false);h.click('ssh-open-shell');await h.flush();
  assert.equal(channel(h).props.shell.owner,'human');assert.equal(channel(h).props.inputState.locked,false);
  assert.deepEqual(h.calls.filter(c=>c.method==='compute.sshConnection.openShell').map(c=>c.data.connectionId),['connection']);
  assert.deepEqual(legacyCalls(h),[]);assert(!h.all().some(node=>node.type==='select'&&node.props['aria-label']==='选择基础 SSH 连接'));
 }finally{h.unmount();}
});
test('closing only a shell preserves the base connection and service',async()=>{const h=await selected();try{h.click('ssh-open-shell');await h.flush();h.click('ssh-shell-close');await h.flush();assert.deepEqual(h.calls.filter(call=>call.method==='sharedTerminal.close').map(call=>call.data),[{sessionId:'shell'}]);assert(!h.calls.some(call=>call.method==='compute.sshConnection.close'||call.method==='compute.sshService.disconnect'));assert(!h.find(n=>n.props?.['data-testid']==='ssh-service-actions'));}finally{h.unmount();}});
test('an unsupported native client offers configuration and never opens shell or service',async()=>{const unsupported={...connection,status:'unsupported',authentication:'not_observed',capabilities:{multiplex:false},terminalSessionIds:[],serviceIds:[]};const h=await selected({override:method=>method==='compute.sshConnection.list'?{connections:[unsupported]}:method==='compute.sshConnection.open'?unsupported:undefined});try{assert(h.all().some(node=>node.props?.role==='alert'));assert(!h.find(node=>node.props?.['data-testid']==='ssh-open-shell'));assert(!h.calls.some(call=>call.method==='compute.resource.activate'||call.method==='compute.sshService.connect'));}finally{h.unmount();}});


test('one ordinary terminal login automatically becomes a shell using the original stable request',async()=>{
 let opened=false,completed=false;const pending={...connection,status:'authenticating',authentication:'pending',loginRequestId:'request',terminalSessionIds:[],serviceIds:[]};
 const h=fixture({override:(method)=>{if(method==='compute.sshConnection.list')return {connections:opened?[completed?connection:pending]:[]};if(method==='compute.sshConnection.open'){opened=true;return pending;}if(method==='compute.sshConnection.completeLogin')return completed?{connection,shell}:{connection:pending};if(method==='sharedTerminal.list')return {sessions:completed?[shell]:[]};}});
 try{await h.flush();assert.equal(h.calls.filter(c=>c.method==='compute.sshConnection.open').length,1);assert(!h.find(n=>n.props?.['data-testid']==='ssh-auth-confirm'));assert(!channel(h)?.props.shell);const auth=h.find(n=>n.type?.name==='ChannelTerminal');assert.equal(auth.props.inputState.locked,false);await h.tick(700);completed=true;await h.tick(700);assert.equal(channel(h).props.shell.sessionId,shell.sessionId);assert.equal(managedCalls(h).length,0);assert(h.id('ssh-publish-resource'));assert(h.calls.filter(c=>c.method==='compute.sshConnection.completeLogin').length>=2);for(const call of h.calls.filter(c=>['compute.sshConnection.open','compute.sshConnection.completeLogin'].includes(c.method)))assert.equal(call.data.requestId,'request');assert(!h.calls.some(c=>['compute.sshConnection.confirm','compute.sshConnection.openShell','compute.sshService.connect'].includes(c.method)));}finally{h.unmount();}
});
test('reopening an ordinary pending view observes its original request before continuing the same login',async()=>{
 const pending={...connection,status:'authenticating',authentication:'pending',loginRequestId:'original-request',terminalSessionIds:[],serviceIds:[]};
 const waiting={connection:pending,login:{status:'waiting_authentication'}};
 let finishStatus,completed=false;
 const h=fixture({override:method=>{
  if(method==='compute.sshConnection.list')return {connections:[completed?connection:pending]};
  if(method==='compute.sshConnection.loginStatus')return new Promise(resolve=>finishStatus=resolve);
  if(method==='compute.sshConnection.completeLogin'){completed=true;return {connection,shell,login:{status:'complete'}};}
 }});
 try{
  await h.flush();await h.tick(700);
  assert(!h.calls.some(c=>c.method==='compute.sshConnection.completeLogin'));
  finishStatus(waiting);await h.flush();await h.tick(700);
  assert.equal(channel(h).props.shell.sessionId,shell.sessionId);
  assert(!h.calls.some(c=>c.method==='compute.sshConnection.open'));
  assert.deepEqual(h.calls.filter(c=>['compute.sshConnection.loginStatus','compute.sshConnection.completeLogin'].includes(c.method)).map(c=>[c.method,c.data.requestId]),[
   ['compute.sshConnection.loginStatus','original-request'],['compute.sshConnection.completeLogin','original-request'],
  ]);
 }finally{h.unmount();}
});

test('an expired ordinary connection hint does not open another login when the same saved version has one live connection',async()=>{
 const h=await selected({props:{request:{nonce:'ordinary-view',profileId:'profile',version:1,connectionId:'expired'}}});
 try{
  assert.equal(channel(h).props.connection.connectionId,connection.connectionId);
  assert.equal(channel(h).props.shell.sessionId,shell.sessionId);
  assert(!h.calls.some(call=>call.method==='compute.sshConnection.open'));
 }finally{h.unmount();}
});

test('an exact connection does not follow its requested shell into another connection',async()=>{
 const h=await selected({props:{request:{nonce:'exact-view',profileId:'profile',version:1,connectionId:'expired',sessionId:shell.sessionId,exact:true}}});
 try{
  assert(!channel(h));
  assert(h.find(node=>node.props?.children==='原终端当前不可用，请核对连接。'));
  assert(!h.calls.some(call=>['compute.sshConnection.open','compute.sshConnection.loginStatus','compute.sshConnection.completeLogin'].includes(call.method)));
 }finally{h.unmount();}
});

test('exact shell restoration waits for a live inventory row independently of the service status request',async()=>{
 let liveness=null,finishService;
 const h=await selected({props:{request:{nonce:'exact-view',profileId:'profile',version:1,connectionId:connection.connectionId,sessionId:shell.sessionId,exact:true}},override:method=>{
  if(method==='compute.sshService.status')return new Promise(resolve=>finishService=resolve);
  if(method==='sharedTerminal.list')return {sessions:[{...shell,alive:liveness}]};
 }});
 try{
  assert(finishService);assert(!channel(h));
  assert(h.find(node=>node.props?.children==='正在打开终端…'));
  liveness=true;await h.tick(2000);
  assert.equal(channel(h).props.shell.sessionId,shell.sessionId);
  assert.equal(h.calls.filter(call=>call.method==='compute.sshService.status').length,1);
  assert(!h.calls.some(call=>['compute.sshConnection.open','compute.sshConnection.openShell'].includes(call.method)));
 }finally{finishService?.(service);h.unmount();}
});

test('an authenticated login receipt cannot attach another conversation shell before scoped inventory',async()=>{
 const agentShell={...shell,owner:'agent'};
 const restored={...connection,loginRequestId:'original-request'};
 let finishList;
 const h=await selected({override:method=>{
  if(method==='compute.sshConnection.list')return {connections:[restored]};
  if(method==='compute.sshConnection.loginStatus')return {connection:restored,login:{status:'complete'},shell:agentShell};
  if(method==='sharedTerminal.list')return new Promise(resolve=>finishList=resolve);
 }});
 try{
  assert(finishList);assert(!channel(h));
  finishList({sessions:[{...agentShell,conversationTerminal:true,currentConversation:false}]});await h.flush();
  assert(!channel(h));assert(!h.calls.some(call=>call.method==='compute.sshConnection.openShell'));
 }finally{finishList?.({sessions:[]});h.unmount();}
});

test('a late original shell receipt preserves a deliberately chosen shell in the same connection',async()=>{
 const other={...shell,sessionId:'other-shell'};
 const restored={...connection,loginRequestId:'original-request',terminalSessionIds:[shell.sessionId,other.sessionId]};
 let finishStatus;
 const h=await selected({override:method=>{
  if(method==='compute.sshConnection.list')return {connections:[restored]};
  if(method==='compute.sshConnection.loginStatus')return new Promise(resolve=>finishStatus=resolve);
  if(method==='sharedTerminal.list')return {sessions:[shell,other]};
 }});
 try{
  h.id('ssh-shell-actions').props.children[1].props.onClick();await h.flush();
  assert.equal(channel(h).props.shell.sessionId,other.sessionId);
  finishStatus({connection:restored,login:{status:'complete'},shell});await h.flush();
  assert.equal(channel(h).props.shell.sessionId,other.sessionId);
 }finally{finishStatus?.({connection:restored,login:{status:'complete'}});h.unmount();}
});

test('a slow connection inventory can complete across periodic refresh ticks',async()=>{
 let finishList,holding=true;
 const h=fixture({override:method=>{
  if(method==='compute.sshConnection.list'&&holding)return new Promise(resolve=>finishList=resolve);
 }});
 try{
  await h.flush();await h.tick(2000);await h.tick(2000);
  assert.equal(h.calls.filter(call=>call.method==='compute.sshConnection.list').length,1);
  holding=false;finishList({connections:[connection]});await h.flush();
  assert.equal(channel(h).props.shell.sessionId,shell.sessionId);
  assert(!h.calls.some(call=>call.method==='compute.sshConnection.open'));
 }finally{finishList?.({connections:[connection]});h.unmount();}
});

test('an authenticated view with no remaining shell never recreates a user-closed shell',async()=>{
 const h=await selected({override:method=>method==='sharedTerminal.list'?{sessions:[]}:undefined});try{await h.tick(700);assert(!channel(h)?.props.shell);assert(!h.calls.some(c=>['compute.sshConnection.open','compute.sshConnection.completeLogin','compute.sshConnection.openShell'].includes(c.method)));assert.equal(h.id('ssh-open-shell').props.disabled,false);}finally{h.unmount();}
});
test('login completion with a different connection cannot publish a shell or authorize a resource',async()=>{
 const pending={...connection,status:'authenticating',authentication:'pending',loginRequestId:'original-request',terminalSessionIds:[]};const h=fixture({override:method=>method==='compute.sshConnection.list'?{connections:[pending]}:method==='compute.sshConnection.loginStatus'?{connection:{...connection,connectionId:'other'},shell,login:{status:'complete'}}:undefined});try{await h.flush();assert(!channel(h)?.props.shell);assert.deepEqual(managedCalls(h),[]);assert.deepEqual(legacyCalls(h),[]);assert.equal(h.id('ssh-error-code').props.children,'ssh_connection_changed');}finally{h.unmount();}
});
for(const code of ['ssh_control_unavailable','ssh_client_unavailable','terminal_runtime_low_integrity','terminal_runtime_execution_unavailable'])test('local failure '+code+' has a specific cause and edits only the original profile',async()=>{
 const unavailable={...connection,status:'unavailable',authentication:'not_observed',error:{code},terminalSessionIds:[],serviceIds:[]};const edits=[];let opened=false;const h=fixture({props:{onConfigureSsh:ref=>edits.push(ref)},override:method=>{if(method==='compute.sshConnection.list')return {connections:opened?[unavailable]:[]};if(method==='compute.sshConnection.open'){opened=true;return unavailable;}}});try{await h.flush();const alert=h.id('ssh-login-error');assert(!JSON.stringify(alert).includes('操作结果尚未确认'));assert(!JSON.stringify(alert).includes('配置 WSL/Linux'));h.click('ssh-error-edit');assert.deepEqual(edits,[{profileId:'profile',profileVersion:1}]);assert(!h.calls.some(c=>c.method==='compute.profiles.save'||c.method==='compute.sshConnection.completeLogin'));}finally{h.unmount();}
});
test('connection settings target the exact saved connection without changing its client',async()=>{const edits=[],h=await selected({props:{onConfigureSsh:ref=>edits.push(ref)}});try{h.click('ssh-edit-connection');assert.deepEqual(edits,[{profileId:'profile',profileVersion:1}]);assert(!h.calls.some(c=>c.method==='compute.profiles.save'));}finally{h.unmount();}});

test('publishing exposes the service summary without transferring human shell ownership or enabling controls',async()=>{
 const h=await selected();try{
  h.click('ssh-publish-resource');await h.flush();h.render({managed:snapshot(published)});await h.flush();
  assert.equal(managedCalls(h).length,1);assert(h.id('ssh-worker-ready'));assert.equal(channel(h).props.shell.owner,'human');
  for(const id of ['ssh-service-actions','ssh-service-owner','ssh-service-connect','ssh-service-settings','ssh-shell-owner','ssh-agent-separate'])assert(!h.find(n=>n.props?.['data-testid']===id));
  assert.deepEqual(legacyCalls(h),[]);
 }finally{h.unmount();}
});

test('workflow binding errors keep the authenticated SSH and managed service available for an explicit retry',async()=>{
 const errors=[];let attempts=0;
 const h=await selected({props:{managed:snapshot(published),onError:e=>errors.push(e),onUseForWorkflow:async()=>{
  if(++attempts===1)throw Error('ssh_service_channel_in_use');
  return {status:'connected',workflowReady:true};
 }}});
 try{
  h.click('ssh-use-for-workflow');await h.flush();
  assert.equal(h.id('ssh-connection-status').props['data-state'],'authenticated');
  assert.ok(h.id('ssh-worker-ready'));assert.ok(h.id('ssh-workflow-error'));
  assert.ok(!h.find(n=>n.props?.['data-testid']==='ssh-login-error'));
  assert.equal(errors[0].action,'compute.managed.useForWorkflow');
  assert.equal(errors[0].code,'ssh_service_channel_in_use');
  await h.tick(2000);assert.equal(attempts,1);
  h.click('ssh-use-for-workflow');await h.flush();assert.equal(attempts,2);
  assert.ok(!h.find(n=>n.props?.['data-testid']==='ssh-workflow-error'));
  assert.equal(legacyCalls(h).length,0);
 }finally{h.unmount();}
});

for(const hosted of [false,true])test('a failed '+(hosted?'hosted':'foreground')+' service read preserves the exact shell and offers a read-only retry',async()=>{
 const method=hosted?'compute.managed.serviceStatus':'compute.sshService.status';
 let reject=false;
 const h=await selected({props:hosted?{managed:snapshot(published)}:undefined,override:action=>{
  if(action==='compute.sshService.status'&&reject)return Promise.reject(Error('Error invoking remote method '+method+': Error: worker_health_invalid'));
 }});
 try{
  assert(h.id('ssh-worker-ready'));const original=channel(h).props.shell;
  reject=true;await h.tick(2000);
  assert.equal(h.id('ssh-service-status-error-code').props.children,'worker_health_invalid');
  assert(!h.find(n=>n.props?.['data-testid']==='ssh-worker-ready'));
  assert.equal(h.id('ssh-connection-status').props['data-state'],'authenticated');
  assert.deepEqual(channel(h).props.shell,original);
  const before=h.calls.length;reject=false;h.click('ssh-service-status-retry');await h.flush();
  const calls=h.calls.slice(before);
  assert(calls.some(call=>call.method===method&&call.data.connectionId===original.connectionId));
  assert(calls.every(call=>['compute.sshConnection.list','sharedTerminal.list',method].includes(call.method)));
  assert(h.id('ssh-worker-ready'));assert(!h.find(n=>n.props?.['data-testid']==='ssh-service-status-pending'));
 }finally{h.unmount();}
});

test('an unavailable service keeps its own error and the published connection retains the human terminal',async()=>{
 const unavailable={...published,serviceReady:false},h=await selected({override:method=>method==='compute.sshService.status'?{...service,status:'failed',workflowReady:false,error:{code:'python_unsupported'}}:method==='compute.managed.publish'?unavailable:undefined});
 try{
  h.click('ssh-publish-resource');await h.flush();h.render({managed:snapshot(unavailable)});await h.flush();
  assert(h.id('ssh-worker-error'));assert(!h.find(n=>n.props?.['data-testid']==='ssh-worker-ready'));
  assert.equal(channel(h).props.shell.owner,'human');assert.equal(channel(h).props.inputState.locked,false);assert.deepEqual(legacyCalls(h),[]);
 }finally{h.unmount();}
});

test('login-time worker preparation is visible before Agent handoff without service action buttons',async()=>{const h=await selected({override:method=>method==='compute.sshService.status'?{...service,status:'connecting',phase:'transferring_worker',workflowReady:false,progress:{kind:'transfer',completedBytes:20,totalBytes:100}}:undefined});try{assert(h.id('ssh-worker-preparing'));assert.equal(h.find(n=>n.type==='progress').props.value,20);assert.equal(h.find(n=>n.type==='progress').props.max,100);assert(!h.find(n=>n.props?.['data-testid']==='ssh-service-actions'));assert(!h.calls.some(c=>c.method==='sharedTerminal.owner'));}finally{h.unmount();}});

test('preparation progress follows acknowledged bytes, waits during startup, and disappears when ready',async()=>{let state={...service,status:'connecting',phase:'transferring_worker',workflowReady:false,progress:{kind:'transfer',completedBytes:0,totalBytes:100}};const h=await selected({override:method=>method==='compute.sshService.status'?state:undefined}),bar=()=>h.find(n=>n.type==='progress');try{assert.equal(bar().props.value,0);assert.equal(bar().props.max,100);state={...state,progress:{...state.progress,completedBytes:50}};await h.tick(2000);assert.equal(bar().props.value,50);state={...state,phase:'starting_worker',progress:undefined};await h.tick(2000);assert.equal(bar().props.value,undefined);assert(JSON.stringify(h.id('ssh-worker-preparing')).includes('启动远端作业服务'));state={...state,status:'connected',workflowReady:true};await h.tick(2000);assert.equal(bar(),undefined);assert(h.id('ssh-worker-ready'));}finally{h.unmount();}});

for(const status of ['connected','unknown'])test('incomplete service '+status+' keeps explicit unconfirmed state without implying active work',async()=>{const h=await selected({override:method=>method==='compute.sshService.status'?{...service,status,workflowReady:false,...status==='unknown'?{error:{code:'connection_unconfirmed'}}:{}}:undefined});try{assert(h.id('ssh-worker-preparing'));assert(!h.find(n=>n.type==='progress'));assert(!h.find(n=>n.props?.['data-testid']==='ssh-worker-ready'));if(status==='unknown')assert(h.id('ssh-worker-error'));}finally{h.unmount();}});
test('a published connection with an unconfirmed service remains separate from its healthy human shell',async()=>{
 const h=await selected({props:{managed:snapshot({...published,serviceReady:false})},override:method=>method==='compute.sshService.status'?{...service,status:'unknown',workflowReady:false,error:{code:'connection_unconfirmed'}}:undefined});
 try{
  assert.equal(h.id('ssh-managed-status').type,'span');assert(h.id('ssh-worker-error'));
  assert(!h.find(n=>n.props?.['data-testid']==='ssh-publish-resource'));
  assert(!h.find(n=>n.props?.['data-testid']==='ssh-worker-ready'));assert.equal(channel(h).props.shell.owner,'human');
  assert.deepEqual(managedCalls(h),[]);assert.deepEqual(legacyCalls(h),[]);
 }finally{h.unmount();}
});

test('an observed Agent shell stays separate across refresh and selecting its read-only tab never grants access',async()=>{
 let extra;
 const h=await selected({override:method=>method==='sharedTerminal.list'?{sessions:[shell,...extra?[extra]:[]]}:undefined});
 try{
  assert.equal(channel(h).props.shell.sessionId,shell.sessionId);
  extra={...shell,sessionId:'agent-shell',owner:'agent',ownerEpoch:3,conversationTerminal:true,currentConversation:true,conversationName:'Named conversation'};
  await h.tick(2000);
  const tab=label=>h.find(n=>n.type==='button'&&typeof n.props.children==='string'&&n.props.children.includes(label));
  assert.equal(tab('我的终端').props['aria-pressed'],true);assert.equal(tab('Named conversation').props['aria-pressed'],false);
  tab('Named conversation').props.onClick();await h.flush();await h.tick(2000);assert.equal(channel(h).props.shell.owner,'agent');
  tab('我的终端').props.onClick();await h.flush();await h.tick(2000);assert.equal(channel(h).props.shell.owner,'human');
  assert.deepEqual(managedCalls(h),[]);assert.deepEqual(legacyCalls(h),[]);assert(!h.calls.some(c=>c.method==='compute.sshConnection.openShell'));
 }finally{h.unmount();}
});

test('hosted idle SSH connection offers a prepare-service action and suppresses duplicate login alert on matching service failure',async()=>{
 let serviceState={...service,status:'idle',workflowReady:false,serviceActive:false};
 const h=await selected({
  props:{
   managed:snapshot({...published,serviceReady:false,serviceStatus:'configuration_required'}),
  },
  override:(method)=>{
   if(method==='compute.sshService.status')return serviceState;
   if(method==='compute.managed.configureService')return Promise.reject(Object.assign(Error('ssh_service_maintenance_required'),{code:'ssh_service_maintenance_required'}));
  },
 });
 try{
  const button=h.id('ssh-service-prepare');
  assert.match(JSON.stringify(button),/准备作业服务/);
  button.props.onClick();
  await h.flush();
  assert(h.calls.some(c=>c.method==='compute.managed.configureService'));
  assert.match(JSON.stringify(h.id('ssh-login-error')),/作业服务需要核对/);
  serviceState={...service,status:'failed',workflowReady:false,serviceActive:false,error:{code:'ssh_service_maintenance_required'}};
  await h.tick(2000);
  assert(!h.find(n=>n.props?.['data-testid']==='ssh-login-error'));
  assert(h.id('ssh-worker-error'));
 }finally{h.unmount();}
});
