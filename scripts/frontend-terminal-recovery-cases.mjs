// Actual React/xterm with controlled IPC. No real connection or terminal process.
import assert from 'node:assert/strict';
import path from 'node:path';

async function mount(page){
 await page.evaluate(async()=>{
  const {default:Panel}=await import('/frontend/features/terminal/SharedTerminalPanel.tsx');
  const fixture=window.__test.terminalRecovery={calls:[],errors:[],changes:[],original:{sessionId:'retained-old-terminal',name:'Retained old session',kind:'ssh',mode:'interactive',owner:'human',ownerEpoch:1,alive:null,status:'unknown',sequence:0}};
  const target={kind:'ssh',mode:'interactive',profileId:'saved-recovery-profile',version:4};
  const none={schemaVersion:1,selectionId:null,kind:null,profileId:null,profileVersion:null,sessionId:null,status:'none',operator:'unknown',processStatus:'unknown',alive:null,agentReady:false,reason:null,authentication:'not_observed',managedRuns:false};
  window.studio.invoke=async(method,data)=>{
   fixture.calls.push({method,data});
   if(method==='compute.resource.status')return none;
   if(method==='compute.resource.activate')return {...none,...data,selectionId:'fixture-selection',status:'selected',operator:'human',processStatus:'running',alive:true};
   if(method==='sharedTerminal.list')return {sessions:[fixture.original,...fixture.opened?[fixture.opened]:[]]};
   if(method==='sharedTerminal.open'){
    if(!data.newConnection)throw Error('terminal_recovery_required PRIVATE_HOST_TOKEN_OUTPUT');
    return new Promise(resolve=>{fixture.finish=()=>{fixture.opened={...fixture.original,sessionId:'explicit-new-terminal',name:'Explicit new session',alive:true,status:'running',resource:{kind:'ssh-terminal',profileId:target.profileId,profileVersion:target.version}};resolve(fixture.opened);};});
   }
   if(method==='sharedTerminal.read')return {...fixture.opened,output:'',cursor:0,dropped:false};
   if(method==='sharedTerminal.resize')return {accepted:true};
   throw Error('Unexpected isolated recovery fixture IPC '+method);
  };
  const root=document.getElementById('root');root.style.width='720px';root.style.height='300px';
  window.renderTerminalRecovery=(scope='recovery-owner')=>window.renderWithProviders(window.React.createElement(Panel,{visible:true,request:{nonce:'recovery-request',...target,connectionMode:'plain'},resourceScope:scope,provider:'codex',canShare:true,onError:error=>fixture.errors.push(String(error)),onResourceChange:value=>fixture.changes.push(value)}));
  window.renderTerminalRecovery();
 });
 await page.getByTestId('shared-terminal-recovery').waitFor();
}

export async function frontendTerminalRecoveryCases({check,out}){
 for(const maintenance of [false,true])await check(maintenance?'ssh-service-update-disconnected-maintenance-no-login':'ssh-service-update-existing-shared-shell-explicit-cas',async page=>{
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.evaluate(async maintenance=>{
   const {default:Panel}=await import('/frontend/features/compute/IndependentSshServiceSettings.tsx'),profile={id:'owned-update-profile',version:2,kind:'ssh',name:'Owned update fixture',host:'fixture.invalid',username:'fixture',port:22,ssh_client:'/usr/bin/ssh',mode:'interactive'},connection={schemaVersion:2,connectionId:'owned-existing-connection',profileId:profile.id,profileVersion:2,status:'authenticated',authentication:'verified',capabilities:{multiplex:true},terminalSessionIds:['owned-original-shell'],serviceIds:['owned-service'],revision:1},service={schemaVersion:2,connectionId:connection.connectionId,serviceId:'owned-service',attemptId:'old-attempt',status:'connected',workflowReady:true,operator:'agent'},fixture=window.__test.serviceUpdate={calls:[],changes:0};
   if(maintenance)Object.assign(service,{status:'disconnected',workflowReady:false,serviceActive:false});
   window.studio.invoke=async(method,data)=>{fixture.calls.push({method,data});if(method==='compute.sshService.registration')return {status:maintenance&&!fixture.configured?'maintenance_required':'configured',profileId:profile.id,profileVersion:2,registration:{revision:1,checkedAt:1}};if(method==='compute.sshConnection.list')return {connections:[connection]};if(method==='compute.sshConnection.state')return connection;if(method==='compute.sshService.status')return service;if(method==='compute.resource.activate')return {...data,schemaVersion:2,status:'selected'};if(method==='compute.sshService.connect'){fixture.configured=true;return Object.assign(service,{status:'connected',workflowReady:true,attemptId:data.requestId});}throw Error('Unexpected isolated update IPC '+method);};
   window.testRoot.render(window.React.createElement(Panel,{profile,onClose:()=>{},onLogin:()=>{throw Error('Update must not request a login');},onChanged:()=>fixture.changes++}));
  },maintenance);
  const update=page.getByTestId('ssh-service-update');await update.waitFor();await page.waitForFunction(()=>!document.querySelector('[data-testid="ssh-service-update"]').disabled);await update.click();await page.waitForFunction(()=>window.__test.serviceUpdate.changes===1);
  const calls=await page.evaluate(()=>window.__test.serviceUpdate.calls),starts=calls.filter(row=>row.method==='compute.sshService.connect');assert.equal(starts.length,1);assert.deepEqual({...starts[0].data,requestId:'new-request'},{connectionId:'owned-existing-connection',profileId:'owned-update-profile',profileVersion:2,requestId:'new-request',mode:'update',...maintenance?{}:{expectedAttemptId:'old-attempt'}});assert.match(await page.getByTestId('ssh-service-registration').textContent(),/已登记/);assert.equal(calls.filter(row=>row.method==='compute.sshService.registration').length,2);assert(!calls.some(row=>['compute.sshConnection.open','compute.sshService.disconnect','sharedTerminal.owner','compute.profiles.save'].includes(row.method)));assert.deepEqual(errors,[]);await page.screenshot({path:path.join(out,maintenance?'explicit-disconnected-maintenance-update.png':'explicit-same-shell-update.png')});
 });
 await check('terminal-recovery-experience-explicit-new-keeps-target-and-old-session',async page=>{
  await mount(page);
  await page.screenshot({path:path.join(out,'terminal-recovery-keeps-original.png')});
  const count=()=>page.evaluate(()=>window.__test.terminalRecovery.calls.filter(row=>row.method==='sharedTerminal.open').length);
  assert.equal(await count(),1);
  await page.getByTestId('shared-terminal-recovery-refresh').click();
  await page.waitForFunction(()=>!document.querySelector('[data-testid="shared-terminal-recovery-refresh"]').disabled);
  assert.equal(await count(),1,'Readonly list refresh must not reopen a terminal');
  await page.evaluate(()=>{const button=document.querySelector('[data-testid="shared-terminal-recovery-new"]');button.click();button.click();});
  await page.waitForFunction(()=>typeof window.__test.terminalRecovery.finish==='function');
  assert.equal(await count(),2);assert.equal(await page.getByTestId('shared-terminal-recovery-new').isDisabled(),true);
  const opened=await page.evaluate(()=>window.__test.terminalRecovery.calls.filter(row=>row.method==='sharedTerminal.open').map(row=>row.data));
  assert.deepEqual(opened[0],{kind:'ssh',mode:'interactive',profileId:'saved-recovery-profile',version:4});
  assert.deepEqual({...opened[1],requestId:undefined},{...opened[0],newConnection:true,requestId:undefined});assert.match(opened[1].requestId,/^[a-f0-9-]{36}$/);
  await page.evaluate(()=>window.__test.terminalRecovery.finish());
  await page.locator('.shared-terminal-host .xterm-screen').waitFor();
  assert.equal(await page.getByTestId('shared-terminal-recovery').count(),0);
  const state=await page.evaluate(()=>window.__test.terminalRecovery);
  assert(!state.calls.some(row=>row.method==='sharedTerminal.close'));assert(!state.errors.some(error=>error.includes('PRIVATE_HOST_TOKEN_OUTPUT')));
  assert(await page.getByRole('combobox',{name:'共享终端会话'}).locator('option[value="retained-old-terminal"]').count());
  await page.screenshot({path:path.join(out,'terminal-recovery-explicit-new.png')});
 });
 await check('terminal-recovery-experience-late-new-response-cannot-attach-another-context',async page=>{
  await mount(page);await page.getByTestId('shared-terminal-recovery-new').click();
  await page.waitForFunction(()=>typeof window.__test.terminalRecovery.finish==='function');
  await page.evaluate(()=>window.renderTerminalRecovery('replacement-owner'));
  await page.getByTestId('shared-terminal-recovery').waitFor({state:'detached'});
  await page.evaluate(()=>window.__test.terminalRecovery.finish());await page.waitForTimeout(100);
  assert.equal(await page.locator('.shared-terminal-host').count(),0);
  const state=await page.evaluate(()=>window.__test.terminalRecovery);
  assert(!state.calls.some(row=>row.method==='compute.resource.activate'||row.method==='sharedTerminal.close'));
  assert(!state.changes.some(value=>value.sessionId==='explicit-new-terminal'));
  assert.equal(state.calls.filter(row=>row.method==='sharedTerminal.open').length,2);
  await page.screenshot({path:path.join(out,'terminal-recovery-context-changed.png')});
 });
}
