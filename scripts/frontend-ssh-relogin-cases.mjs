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
    if(method==='compute.sshConnection.open'){
     f.calls.push({method,data});const ordinal=++f.sshOpenCount,next={schemaVersion:2,connectionId:'relogin-'+ordinal,profileId:profile.id,profileVersion:1,loginRequestId:data.requestId,status:ordinal===1?'unavailable':'authenticating',authentication:ordinal===1?'not_observed':'pending',capabilities:{multiplex:ordinal!==1},terminalSessionIds:[],serviceIds:[],revision:1,...ordinal===1?{error:{code:'terminal_start_failed'}}:{}};
     f.sshConnections.push(next);if(ordinal===2)await new Promise(resolve=>f.finishSshOpen=resolve);return next;
    }
    if(method==='compute.sshConnection.completeLogin'||method==='compute.sshConnection.loginStatus'){
     f.calls.push({method,data});let current=f.sshConnections.find(c=>c.connectionId===data.connectionId);if(current.loginRequestId!==data.requestId)throw Error('ssh_request_changed');
     if(!f.sshAuthenticated)return {connection:current,login:{status:'waiting_authentication'}};
     f.sshSession??={sessionId:'relogin-shell',connectionId:current.connectionId,name:'Fixture exact shell',kind:'ssh',mode:'interactive',owner:'human',ownerEpoch:1,alive:true,status:'running',resource:{kind:'ssh-connection',connectionId:current.connectionId,profileId:profile.id,profileVersion:1}};
     current={...current,status:'authenticated',authentication:'verified',terminalSessionIds:[f.sshSession.sessionId],revision:2};f.sshConnections=f.sshConnections.map(c=>c.connectionId===current.connectionId?current:c);return {connection:current,shell:f.sshSession,login:{status:'complete'}};
    }
    if(method==='compute.sshConnection.authRead'){const state=f.sshConnections.find(c=>c.connectionId===data.connectionId);return {connectionId:state.connectionId,state,output:data.cursor?'':'SYNTHETIC SSH LOGIN> ',cursor:1,dropped:false};}
    if(method==='compute.sshConnection.authResize')return {resized:true};
    if(method==='compute.sshService.status')return {schemaVersion:2,status:'disconnected',workflowReady:false,serviceActive:false};
    if(method==='sharedTerminal.list')return {sessions:f.sshSession?[f.sshSession]:[]};
    if(method==='sharedTerminal.read')return {...f.sshSession,output:data.cursor?'':'SYNTHETIC EXACT SHELL> ',cursor:1,dropped:false};
    if(method==='sharedTerminal.resize')return {accepted:true};
    if(method==='compute.resource.activate'){f.calls.push({method,data});return {...data,schemaVersion:2,status:'selected'};}
    if(method==='compute.resource.status')return {schemaVersion:2,kind:null,selectionId:null,status:'none'};
    return original(method,data);
   };
   const App=(await import('/frontend/app/App.tsx')).default;window.reloginApp=App;window.testRoot.render(React.createElement(React.StrictMode,null,React.createElement(App)));
  });
  await page.getByTestId('new-conversation').click();await page.locator('.composer textarea').fill('Preserve these unsent school connection instructions');
  const openSaved=async()=>{await page.getByTestId('unified-compute-entry').click();await page.getByTestId('saved-compute-profile').getByRole('button',{name:'交互式登录',exact:true}).click();};
  await openSaved();await page.getByTestId('ssh-login-retry').waitFor();assert.equal(await page.getByTestId('ssh-error-code').innerText(),'terminal_start_failed');await page.getByTestId('ssh-login-retry').click();await page.waitForFunction(()=>typeof window.__test.finishSshOpen==='function');assert.equal(await page.getByTestId('ssh-login-error').count(),0);assert.equal(await page.getByTestId('ssh-login-progress').count(),0);
  await page.evaluate(()=>window.__test.finishSshOpen());await page.getByTestId('ssh-login-progress').getByText('请在原终端完成密码或验证码输入。',{exact:true}).waitFor();await page.getByRole('region',{name:'SSH 登录终端',exact:true}).locator('.xterm').waitFor();assert.equal(await page.getByTestId('ssh-login-error').count(),0);await page.screenshot({path:path.join(out,'ssh-relogin-fresh-authentication.png')});
  await page.evaluate(()=>window.__test.sshAuthenticated=true);await page.getByTestId('ssh-shell-owner').waitFor();await page.getByRole('region',{name:'SSH 终端',exact:true}).locator('.xterm').waitFor();assert.equal(await page.locator('.composer textarea').inputValue(),'Preserve these unsent school connection instructions');
  await openSaved();await page.getByTestId('ssh-shell-owner').waitFor();assert.equal(await page.evaluate(()=>window.__test.sshOpenCount),2);const opened=await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='compute.sshConnection.open'));assert.notEqual(opened[0].data.requestId,opened[1].data.requestId);const bindings=await page.evaluate(()=>window.__test.calls.filter(c=>['compute.sshConnection.completeLogin','compute.sshConnection.loginStatus'].includes(c.method)));assert(bindings.length>0);assert(bindings.every(c=>c.data.connectionId==='relogin-2'&&c.data.requestId===opened[1].data.requestId));assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>['task.execute','compute.profiles.save','compute.sshConnection.close','sharedTerminal.close','sharedTerminal.owner'].includes(c.method)||c.method==='agent.rpc'&&c.data?.method==='turn/start').length),0);await page.screenshot({path:path.join(out,'ssh-relogin-reopened-exact-shell.png')});
 });
}
