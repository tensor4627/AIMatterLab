import assert from 'node:assert/strict';
import path from 'node:path';

async function openObservedTerminal(page,human=false){
 await page.evaluate(async human=>{
  const f=window.__test,original=window.studio.invoke,profile={id:'observed-profile',version:1,kind:'ssh',name:'Observation fixture',host:'fixture.invalid',username:'fixture',port:22,ssh_client:'ssh',mode:'interactive'};
  f.terminalChat={id:'codex:observed-terminal',provider:'codex',threadId:'observed-terminal',name:'Preserved terminal chat',projectId:null,taskId:null};localStorage.setItem('studio.conversation',f.terminalChat.id);f.listEpoch=human?3:2;f.actualEpoch=3;f.readFailure=human;f.readSuccesses=0;f.inputCount=0;
  const connection={schemaVersion:2,connectionId:'observed-connection',profileId:profile.id,profileVersion:1,loginRequestId:'original-request',status:'authenticated',authentication:'verified',capabilities:{multiplex:true},terminalSessionIds:['observed-shell'],serviceIds:[],revision:1};
  f.observedShell=epoch=>({sessionId:'observed-shell',connectionId:connection.connectionId,name:'Original observed shell',kind:'ssh',mode:'interactive',owner:human?'human':'agent',ownerEpoch:epoch,alive:true,status:'running',resource:{kind:'ssh-connection',connectionId:connection.connectionId,profileId:profile.id,profileVersion:1}});
  const resource={schemaVersion:2,selectionId:'observed-selection',kind:'ssh-connection',connectionId:connection.connectionId,profileId:profile.id,profileVersion:1,sessionId:'observed-shell',status:'selected',connectionStatus:'authenticated',authentication:'verified',alive:true,workflowReady:true,agentReady:true,operator:'agent',capabilities:{terminal:{status:'ready'},service:{status:'connected',workflowReady:true,agentReady:true}}};
  window.studio.invoke=async(method,data)=>{
   if(method==='conversation.list')return [f.terminalChat];if(method==='conversation.select'||method==='conversation.remember')return f.terminalChat;
   if(method==='worker.restore')return {status:'disconnected',reason:'project_missing',conversationId:f.terminalChat.id,checkedAt:1};
   if(method==='worker.status')return {status:'connected',checkedAt:1,sourceKind:'ssh',connectionId:connection.connectionId,profileId:profile.id,profileVersion:1,sourceId:'a'.repeat(64),serviceVersion:'current'};
   if(method==='compute.profiles.list')return {profiles:[profile],defaults:{distribution:'Ubuntu',root:'~/fixture',port:8767,ssh_client:'ssh'}};
   if(method==='compute.profiles.read')return profile;
   if(method==='compute.sshConnection.list')return {connections:[connection]};
   if(method==='compute.sshService.status')return {schemaVersion:2,connectionId:connection.connectionId,status:'connected',workflowReady:true,operator:'agent'};
   if(method==='compute.resource.status'||method==='compute.resource.activate')return resource;
   if(method==='sharedTerminal.list')return {sessions:[f.observedShell(f.listEpoch)]};
   if(method==='sharedTerminal.read'){
    f.calls.push({method,data});if(data.ownerEpoch!==f.actualEpoch)throw Error('terminal_owner_changed');if(f.readFailure)throw Error('terminal_unavailable');f.readSuccesses++;return {...f.observedShell(f.actualEpoch),output:data.cursor?'':'RECOVERED ORIGINAL SHELL> ',cursor:1,dropped:false};
   }
   if(method==='sharedTerminal.resize'){
    f.calls.push({method,data});if(f.geometryFailure)throw Error('terminal_context_changed');return {accepted:true};
   }
   if(method==='sharedTerminal.input'){f.calls.push({method,data});f.inputCount++;throw Error('terminal_owner_changed');}
   if(method==='agent.rpc'&&['thread/resume','thread/read'].includes(data.method))return {model:'fixture-model',thread:{id:f.terminalChat.threadId,turns:[{items:[{id:'saved-terminal-message',type:'agentMessage',text:'Preserved terminal history'}]}]}};
   if(method==='worker.request'&&['/api/runs','/api/cluster-runs'].includes(data.target))return [];
   return original(method,data);
  };return window.renderTest('App');
 },human);
 await page.getByText('Preserved terminal history',{exact:true}).waitFor();await page.locator('.composer textarea').fill('Keep these unsent terminal instructions');await page.getByTestId('unified-compute-entry').click();await page.getByTestId('saved-compute-profile').getByRole('button',{name:'交互式登录',exact:true}).click();await page.getByTestId('ssh-shell-owner').waitFor();await page.getByRole('region',{name:'SSH 终端',exact:true}).locator('.xterm').waitFor();
}

export async function frontendTerminalReadObservationCases({check,out}){
 await check('terminal-resize-stays-local-through-reply-and-recovers-on-the-current-epoch',async page=>{
  await openObservedTerminal(page);
  await page.evaluate(()=>{const f=window.__test;f.listEpoch=f.actualEpoch;f.geometryFailure=true;});
  await page.getByTestId('ssh-login-refresh').click();
  await page.getByTestId('ssh-resize-observation').filter({hasText:'terminal_context_changed'}).waitFor();
  assert.equal(await page.getByTestId('ssh-login-error').count(),0);assert.equal(await page.locator('.toast').count(),0);
  await page.evaluate(()=>{const f=window.__test;f.geometryFailure=false;f.listEpoch=++f.actualEpoch;});
  await page.getByTestId('ssh-login-refresh').click();
  await page.waitForFunction(()=>window.__test.calls.some(c=>c.method==='sharedTerminal.resize'&&c.data.ownerEpoch===window.__test.actualEpoch));
  await page.getByTestId('ssh-resize-observation').waitFor({state:'detached'});
  assert.equal(await page.locator('.composer textarea').inputValue(),'Keep these unsent terminal instructions');
  const calls=await page.evaluate(()=>window.__test.calls);assert(!calls.some(c=>['compute.sshConnection.open','sharedTerminal.owner','sharedTerminal.input'].includes(c.method)));
 });
 await check('terminal-read-observation-experience-stale-epoch-refresh-current-read-clears-local-only',async page=>{
  await openObservedTerminal(page);await page.getByTestId('ssh-read-error-code').filter({hasText:'terminal_owner_changed'}).waitFor();assert.equal(await page.locator('.toast').count(),0);
  await page.evaluate(()=>{window.__test.listEpoch=3;window.__test.readFailure=true;});await page.getByTestId('ssh-login-refresh').click();await page.getByTestId('ssh-read-error-code').filter({hasText:'terminal_unavailable'}).waitFor();assert.equal(await page.locator('.toast').count(),0);assert.equal(await page.getByTestId('ssh-read-observation').evaluate(node=>{const notice=node.getBoundingClientRect(),panel=node.closest('[data-testid="bottom-panel"]').getBoundingClientRect();return notice.top>=panel.top&&notice.bottom<=panel.bottom;}),true,'current read fault must be fully visible within the terminal panel');await page.screenshot({path:path.join(out,'terminal-current-read-failure-remains-visible.png')});
  await page.evaluate(()=>window.__test.readFailure=false);await page.waitForFunction(()=>window.__test.readSuccesses>0);await page.getByTestId('ssh-read-observation').waitFor({state:'detached'});assert.equal(await page.getByTestId('ssh-login-error').count(),0);assert.equal(await page.locator('.toast').count(),0);assert.equal(await page.locator('.composer textarea').inputValue(),'Keep these unsent terminal instructions');assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>['compute.sshConnection.open','compute.sshConnection.completeLogin','sharedTerminal.owner','sharedTerminal.input','sharedTerminal.close','compute.profiles.save','task.execute'].includes(c.method)).length),0);await page.screenshot({path:path.join(out,'terminal-same-shell-new-epoch-recovered.png')});
 });
 await check('terminal-read-observation-experience-read-recovery-retains-real-input-failure',async page=>{
  await openObservedTerminal(page,true);await page.getByTestId('ssh-read-error-code').filter({hasText:'terminal_unavailable'}).waitFor();await page.getByRole('region',{name:'SSH 终端',exact:true}).click();await page.keyboard.type('X');await page.waitForFunction(()=>window.__test.inputCount===1);await page.getByTestId('ssh-error-code').filter({hasText:'terminal_owner_changed'}).waitFor();await page.locator('.toast').waitFor();
  await page.evaluate(()=>window.__test.readFailure=false);await page.waitForFunction(()=>window.__test.readSuccesses>0);await page.getByTestId('ssh-read-observation').waitFor({state:'detached'});assert.equal(await page.getByTestId('ssh-error-code').innerText(),'terminal_owner_changed');assert.equal(await page.locator('.toast').isVisible(),true);assert.equal(await page.evaluate(()=>window.__test.inputCount),1);assert.equal(await page.locator('.composer textarea').inputValue(),'Keep these unsent terminal instructions');assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>['compute.sshConnection.open','compute.sshConnection.completeLogin','sharedTerminal.owner','sharedTerminal.close','compute.profiles.save','task.execute'].includes(c.method)).length),0);await page.screenshot({path:path.join(out,'terminal-read-recovered-input-failure-retained.png')});
 });
}
