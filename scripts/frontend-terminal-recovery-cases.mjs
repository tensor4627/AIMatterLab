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
  window.renderTerminalRecovery=(scope='recovery-owner')=>window.testRoot.render(window.React.createElement(Panel,{visible:true,request:{nonce:'recovery-request',...target},resourceScope:scope,provider:'codex',canShare:true,onError:error=>fixture.errors.push(String(error)),onResourceChange:value=>fixture.changes.push(value)}));
  window.renderTerminalRecovery();
 });
 await page.getByTestId('shared-terminal-recovery').waitFor();
}

export async function frontendTerminalRecoveryCases({check,out}){
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
