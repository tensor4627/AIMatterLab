import assert from 'node:assert/strict';
import path from 'node:path';

export async function frontendSshReloginCases({check,out}){
 await check('ssh-relogin-experience-fresh-request-reopens-exact-terminal',async page=>{
  await page.evaluate(async()=>{
   const f=window.__test,original=window.studio.invoke,profile={id:'relogin-profile',version:1,kind:'ssh',name:'Fixture school SSH',host:'fixture.invalid',username:'fixture',port:22,ssh_client:'ssh',mode:'interactive'};
   f.sshConnections=[];f.sshAuthenticated=false;f.sshSession=null;f.sshOpenCount=0;
   window.studio.invoke=async(method,data)=>{
    if(method==='compute.profiles.list')return {profiles:[profile],defaults:{distribution:'Ubuntu',root:'~/fixture',port:8767,ssh_client:'ssh'}};
    if(method==='compute.profiles.read')return profile;
    if(method==='compute.sshConnection.list')return {connections:f.sshConnections};
    if(method==='compute.managed.snapshot')return {resources:f.sshHosted?[f.sshHosted]:[],conversations:[],sources:[]};
    if(method==='compute.resourceWorkspace.preview'){
     f.calls.push({method,data});const root=data.directory||'/home/fixture/AIMatterLab';
     return {...data,root,directories:[root+'/workfile',root+'/software'],status:'confirmation_required',source:data.directory?'custom':'suggested',confirmationId:'fixture-confirm',account:'fixture',hostname:'fixture-host',resourceName:profile.name,checkedAt:Date.now()};
    }
    if(method==='compute.resourceWorkspace.cancel'){f.calls.push({method,data});return {cancelled:true};}
    if(method==='compute.resourceWorkspace.confirm'){
     f.calls.push({method,data});const preview=f.calls.findLast(row=>row.method==='compute.resourceWorkspace.preview');
     return {...data,root:preview.data.directory||'/home/fixture/AIMatterLab',status:'confirmed',source:'confirmed',account:'fixture',hostname:'fixture-host',resourceName:profile.name,checkedAt:Date.now()};
    }
    if(method==='compute.managed.publish'){
     f.calls.push({method,data});
     const current=f.sshConnections.find(c=>c.connectionId===data.connectionId&&c.status==='authenticated');
     if(!current||current.profileId!==data.profileId||current.profileVersion!==data.profileVersion)throw Error('unexpected SSH publication');
     f.sshHosted={...data,name:profile.name,kind:'ssh',resourceId:'ssh:'+profile.id,serviceStatus:'idle',terminalReady:true};
     f.events.forEach(notify=>notify({method:'studio/managedActivity'}));return f.sshHosted;
    }
    if(method==='compute.sshConnection.open'){
     f.calls.push({method,data});const ordinal=++f.sshOpenCount,next={schemaVersion:2,connectionId:'relogin-'+ordinal,profileId:profile.id,profileVersion:1,loginRequestId:data.requestId,status:ordinal===1?'unavailable':'authenticating',authentication:ordinal===1?'not_observed':'pending',capabilities:{multiplex:ordinal!==1},terminalSessionIds:[],serviceIds:[],revision:1,...ordinal===1?{error:{code:'terminal_start_failed'}}:{}};
     f.sshConnections.push(next);if(ordinal===2)await new Promise(resolve=>f.finishSshOpen=resolve);return next;
    }
    if(method==='compute.sshConnection.completeLogin'||method==='compute.sshConnection.loginStatus'){
     f.calls.push({method,data});let current=f.sshConnections.find(c=>c.connectionId===data.connectionId);if(current.loginRequestId!==data.requestId)throw Error('ssh_request_changed');
     if(!f.sshAuthenticated)return {connection:current,login:{status:'waiting_authentication'}};
     f.sshSession??={sessionId:'relogin-shell-'+current.connectionId,connectionId:current.connectionId,name:'Fixture exact shell',kind:'ssh',mode:'interactive',owner:'human',ownerEpoch:1,alive:true,status:'running',resource:{kind:'ssh-connection',connectionId:current.connectionId,profileId:profile.id,profileVersion:1}};
     current={...current,status:'authenticated',authentication:'verified',terminalSessionIds:[f.sshSession.sessionId],revision:2};f.sshConnections=f.sshConnections.map(c=>c.connectionId===current.connectionId?current:c);
     if(f.recoverHosted){
      f.sshHosted={connectionId:current.connectionId,profileId:profile.id,profileVersion:1,name:profile.name,kind:'ssh',resourceId:'ssh:'+profile.id,serviceStatus:'ready',terminalReady:true};
      for(const notify of f.events)notify({method:'studio/managedActivity'});
     }
     return {connection:current,shell:f.sshSession,login:{status:'complete'}};
    }
    if(method==='compute.sshConnection.authRead'){const state=f.sshConnections.find(c=>c.connectionId===data.connectionId);return {connectionId:state.connectionId,state,output:data.cursor?'':'SYNTHETIC SSH LOGIN> ',cursor:1,dropped:false};}
    if(method==='compute.sshConnection.authResize')return {resized:true};
    if(method==='compute.sshService.status')return {schemaVersion:2,status:'disconnected',workflowReady:false,serviceActive:false};
    if(method==='sharedTerminal.list')return {sessions:f.sshSession?[f.sshSession]:[]};
    if(method==='sharedTerminal.read')return {...f.sshSession,output:data.cursor?'':'SYNTHETIC EXACT SHELL> ',cursor:1,dropped:false};
    if(method==='sharedTerminal.resize')return {accepted:true};
    if(method==='compute.resource.activate'){f.calls.push({method,data});return {...data,schemaVersion:2,status:'selected'};}
    if(method==='compute.resource.status'){
     const restored=f.recoverHosted&&f.sshHosted;
     return {schemaVersion:2,kind:'ssh-connection',selectionId:'old-selection',connectionId:restored?.connectionId||'previous-desktop',profileId:profile.id,profileVersion:profile.version,
      status:restored?'selected':'unavailable',alive:restored?true:null,authentication:restored?'verified':'not_observed'};
    }
    return original(method,data);
   };
   const App=(await import('/frontend/app/App.tsx')).default;window.reloginApp=App;window.testRoot.render(React.createElement(React.StrictMode,null,React.createElement(App)));
  });
  await page.getByTestId('new-conversation').click();await page.locator('.composer textarea').fill('Preserve these unsent school connection instructions');
  const openSaved=async()=>{await page.getByTestId('unified-compute-entry').click();await page.getByTestId('saved-compute-profile').getByRole('button',{name:'交互式登录',exact:true}).click();};
  await openSaved();await page.getByTestId('ssh-login-retry').waitFor();await page.getByTestId('ssh-diagnostic-toggle').click();assert.equal(await page.getByTestId('ssh-error-code').innerText(),'terminal_start_failed');await page.getByTestId('ssh-login-retry').click();await page.waitForFunction(()=>typeof window.__test.finishSshOpen==='function');assert.equal(await page.getByTestId('ssh-login-error').count(),0);assert.equal(await page.getByTestId('ssh-login-progress').count(),0);
  await page.evaluate(()=>window.__test.finishSshOpen());await page.getByTestId('ssh-login-progress').getByText('请在原终端完成密码或验证码输入。',{exact:true}).waitFor();await page.getByRole('region',{name:'SSH 登录终端',exact:true}).locator('.xterm').waitFor();assert.equal(await page.getByTestId('ssh-login-error').count(),0);await page.screenshot({path:path.join(out,'ssh-relogin-fresh-authentication.png')});
  await page.evaluate(()=>window.__test.sshAuthenticated=true);await page.getByTestId('ssh-publish-resource').waitFor();await page.getByRole('region',{name:'SSH 终端',exact:true}).locator('.xterm').waitFor();assert.equal(await page.locator('.composer textarea').inputValue(),'Preserve these unsent school connection instructions');
  await page.getByTestId('ssh-publish-resource').click();
  await page.getByTestId('resource-workspace-review').waitFor();
  assert.match(await page.getByTestId('resource-workspace-review').innerText(),/fixture@fixture-host/);
  await page.keyboard.press('Escape');
  await page.getByTestId('resource-workspace-review').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='compute.managed.publish'||call.method==='compute.resourceWorkspace.confirm').length),0);
  await page.getByTestId('ssh-publish-resource').click();
  await page.getByTestId('resource-workspace-path').fill('/project/fixture/AIMatterLab');
  assert.equal(await page.getByTestId('resource-workspace-confirm').isDisabled(),true);
  await page.getByTestId('resource-workspace-preview').click();
  await page.getByTestId('resource-workspace-resolved').getByText('/project/fixture/AIMatterLab').waitFor();
  await page.getByTestId('resource-workspace-confirm').click();
  await page.getByTestId('ssh-managed-status').waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-testid="current-compute-resource-status"]')?.textContent.includes('Fixture school SSH'));
  assert.equal(await page.getByTestId('agent-ssh-resource-notice').count(),0);
  await openSaved();
  await page.waitForFunction(()=>document.querySelector('.shared-terminal-host .xterm-rows')?.textContent.replace(/\s+/g,' ').includes('SYNTHETIC EXACT SHELL>'));
  assert.equal(await page.evaluate(()=>window.__test.sshOpenCount),2);
  const opened=await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='compute.sshConnection.open'));
  assert.notEqual(opened[0].data.requestId,opened[1].data.requestId);
  const bindings=await page.evaluate(()=>window.__test.calls.filter(c=>['compute.sshConnection.completeLogin','compute.sshConnection.loginStatus'].includes(c.method)));
  assert(bindings.length>0);assert(bindings.every(c=>c.data.connectionId==='relogin-2'&&c.data.requestId===opened[1].data.requestId));
  const unrelated=await page.evaluate(()=>window.__test.calls.filter(c=>['task.execute','compute.resource.activate','compute.profiles.save','compute.sshConnection.close','sharedTerminal.close','sharedTerminal.owner'].includes(c.method)||c.method==='agent.rpc'&&c.data.method==='turn/start'));
  assert.equal(unrelated.length,0);
  await page.screenshot({path:path.join(out,'ssh-relogin-reopened-exact-shell.png')});
  await page.evaluate(()=>{
   const f=window.__test;
   f.sshConnections=f.sshConnections.map(connection=>connection.connectionId==='relogin-2'?{...connection,status:'unavailable',authentication:'lost',terminalSessionIds:[],revision:3}:connection);
   f.sshHosted=null;f.sshSession=null;f.sshAuthenticated=false;f.recoverHosted=true;
   for(const notify of f.events)notify({method:'studio/sshConnectionChanged'});
  });
  await page.getByTestId('ssh-login-retry').click();
  await page.getByTestId('ssh-login-progress').getByText('请在原终端完成密码或验证码输入。',{exact:true}).waitFor();
  await page.evaluate(()=>window.__test.sshAuthenticated=true);
  await page.getByTestId('ssh-managed-status').waitFor();
  assert.equal(await page.getByTestId('ssh-publish-resource').count(),0);
  assert.equal(await page.locator('.composer textarea').inputValue(),'Preserve these unsent school connection instructions');
  assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='compute.managed.publish').length),1);
  assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='compute.resourceWorkspace.confirm').length),1);
  assert.equal(await page.evaluate(()=>window.__test.sshHosted.connectionId),'relogin-3');
  await page.screenshot({path:path.join(out,'ssh-relogin-restored-original-hosting.png')});
 });

 await check('ssh-relogin-restores-private-prompt-and-shell-while-completion-is-in-flight',async page=>{
  await page.evaluate(async()=>{
   const original=window.studio.invoke,profile={id:'campus',version:1,kind:'ssh',name:'Campus SSH',mode:'interactive'};
   const pending={schemaVersion:2,profileId:profile.id,profileVersion:1,connectionId:'live-ssh',loginRequestId:'original-login',status:'authenticating',authentication:'pending',capabilities:{multiplex:false},terminalSessionIds:[],serviceIds:[],revision:1};
   const shell={sessionId:'original-shell',connectionId:pending.connectionId,name:'My terminal',kind:'ssh',mode:'interactive',owner:'human',ownerEpoch:1,alive:true};
   const verified={...pending,status:'authenticated',authentication:'verified',capabilities:{multiplex:true},terminalSessionIds:[shell.sessionId],revision:2};
   const f=window.__test;
   f.loginCalls=[];f.remoteReady=false;
   window.studio.invoke=async(method,data)=>{
    const connection=f.remoteReady?verified:pending;
    if(method==='compute.profiles.list')return {profiles:[profile],defaults:{distribution:'Ubuntu',root:'~/fixture',port:8767,ssh_client:'ssh'}};
    if(method==='compute.profiles.read')return profile;
    if(method==='compute.sshConnection.list')return {connections:[connection]};
    if(method.startsWith('compute.sshConnection.'))f.loginCalls.push({method,connectionId:data.connectionId,requestId:data.requestId});
    if(method==='compute.sshConnection.loginStatus')return f.remoteReady?{connection,shell,login:{status:'complete'}}:{connection,login:{status:'waiting_authentication'}};
    if(method==='compute.sshConnection.completeLogin'){await new Promise(resolve=>f.finishReceipt=resolve);return {connection:verified,shell,login:{status:'complete'}};}
    if(method==='compute.sshConnection.authRead')return {connectionId:connection.connectionId,state:connection,output:data.cursor?'':'Verification code: ',cursor:1,dropped:false};
    if(method==='compute.sshConnection.authResize'||method==='sharedTerminal.resize')return {resized:true};
    if(method==='compute.sshService.status')return new Promise(resolve=>f.finishService=resolve);
    if(method==='sharedTerminal.list')return {sessions:f.remoteReady?[shell]:[]};
    if(method==='sharedTerminal.read')return {...shell,output:data.cursor?'':'RESTORED REMOTE SHELL> ',cursor:1,dropped:false};
    return original(method,data);
   };
   const App=(await import('/frontend/app/App.tsx')).default;
   window.testRoot.render(React.createElement(React.StrictMode,null,React.createElement(App)));
  });
  await page.getByTestId('unified-compute-entry').click();
  await page.getByTestId('saved-compute-profile').getByRole('button',{name:'交互式登录',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.shared-terminal-host .xterm-rows')?.textContent.replace(/\s+/g,' ').includes('Verification code:'));
  await page.waitForFunction(()=>typeof window.__test.finishReceipt==='function');
  await page.getByRole('button',{name:/^运行队列/}).click();
  await page.evaluate(()=>{window.__test.remoteReady=true;});
  await page.getByRole('button',{name:'终端',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.shared-terminal-host .xterm-rows')?.textContent.replace(/\s+/g,' ').includes('RESTORED REMOTE SHELL>'));
  const calls=await page.evaluate(()=>{
   const f=window.__test;f.finishReceipt();
   f.finishService?.({schemaVersion:2,status:'disconnected',serviceActive:false,workflowReady:false,connectionId:'live-ssh'});
   return f.loginCalls;
  });
  for(const method of ['compute.sshConnection.open','compute.sshConnection.authInput'])assert(!calls.some(call=>call.method===method));
  assert.equal(calls.filter(call=>call.method==='compute.sshConnection.completeLogin').length,1);
  assert(calls.filter(call=>call.method.endsWith('Login')||call.method.endsWith('loginStatus')).every(call=>call.requestId==='original-login'&&call.connectionId==='live-ssh'));
 });
}
