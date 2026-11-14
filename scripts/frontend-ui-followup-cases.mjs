import assert from 'node:assert/strict';
import path from 'node:path';
export async function frontendUiFollowupCases({check,out}){
 async function app(page,{custom=false,empty=false}={}){await page.evaluate(async({custom,empty})=>{
  const f=window.__test,original=window.studio.invoke;f.groups=[{id:'metad',name:'metad'},{id:'neb',name:'neb'}];f.conversations=empty?[]:[{id:'codex:grouped',provider:'codex',threadId:'grouped',name:'Keep this chat',groupId:'metad',projectId:null,taskId:null,updatedAt:1}];
  if(custom)Object.assign(f.settings,{fontSize:20,minimumFontSize:15,chatFontSize:22,editorFontSize:16,terminalFontSize:14});
  window.studio.invoke=async(method,data)=>{
   if(method==='conversation.groups')return structuredClone(f.groups);if(method==='conversation.list')return structuredClone(f.conversations);
   if(method==='conversation.deleteGroup'){f.calls.push({method,data});f.groups=f.groups.filter(g=>g.id!==data.id);f.conversations=f.conversations.map(c=>c.groupId===data.id?{...c,groupId:null}:c);return {id:data.id,conversations:structuredClone(f.conversations)};}
   if(method==='compute.resource.status')return {schemaVersion:1,kind:null,status:'none',selectionId:null};return original(method,data);
  };return window.renderTest('App');
 },{custom,empty});await page.locator('.primary-navigation').waitFor({state:'attached'});}
 for(const theme of ['light','dark'])for(const width of [320,420])await check('ui-followup-header-'+theme+'-'+width,async page=>{
  await page.evaluate(async({theme,width})=>{await import('/frontend/app/frontend-refinement.css');document.documentElement.dataset.theme=theme;const root=document.getElementById('root');root.className='workspace-shell';root.style.cssText='height:100vh;display:flex;justify-content:center';const original=window.studio.invoke;
   window.studio.invoke=async(method,data)=>{if(method==='agent.connect')return {tools:{status:'blocked',message:'Synthetic disconnected tool state'}};if(method==='agent.tools')return {status:'blocked',message:'Synthetic disconnected tool state'};if(method==='agent.rpc'&&data.method==='model/list')return {data:[{model:'synthetic-long-model',displayName:'Synthetic model with a long descriptive name',isDefault:true,supportedReasoningEfforts:[]}]};return original(method,data);};
   window.testProps={width,planningMode:false,onPlanningModeChange(){},onOpenHistory(){},onNewConversation(){},context:'{}',computeResource:{kind:'ssh-connection',status:'selected',authentication:'verified',alive:true,operator:'human',capabilities:{terminal:{agentReady:false},service:{agentReady:false,workflowReady:false}}},onError:error=>{throw error;}};
   return window.renderTest('Agent',window.testProps);
  },{theme,width});
  await page.getByTestId('agent-connect').click();await page.getByTestId('agent-options-summary').getByText(/Synthetic model/).waitFor();await page.getByTestId('agent-ssh-resource-notice').waitFor();
  const fits=await page.evaluate(()=>{const head=document.querySelector('.agent-heading'),summary=document.querySelector('.agent-collapsed-summary'),notice=document.querySelector('.agent-tool-alert');const h=head.getBoundingClientRect(),s=summary.getBoundingClientRect(),n=notice.getBoundingClientRect();return {headerContainsSummary:s.top>=h.top&&s.bottom<=h.bottom,noticeBelowHeader:n.top>=h.bottom-1,headerAuto:getComputedStyle(head).display==='grid',composerBottom:document.querySelector('.composer').getBoundingClientRect().bottom,windowHeight:innerHeight};});
  assert(fits.headerContainsSummary&&fits.noticeBelowHeader&&fits.headerAuto);assert(fits.composerBottom<=fits.windowHeight);assert.equal(await page.locator('.agent-footer').count(),0);
  await page.screenshot({path:path.join(out,'header-'+theme+'-'+width+'.png')});assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='agent.rpc'&&c.data.method==='turn/start').length),0);
 });
 for(const custom of [false,true])await check('ui-followup-fonts-'+(custom?'preserve-explicit':'larger-defaults'),async page=>{
  await app(page,{custom});const actual=await page.evaluate(()=>{const style=document.documentElement.style;return {font:parseFloat(getComputedStyle(document.documentElement).fontSize),minimum:style.getPropertyValue('--ui-min-font'),chat:style.getPropertyValue('--chat-font-size'),editor:style.getPropertyValue('--editor-font-size'),terminal:style.getPropertyValue('--terminal-font-size')};});
  assert.deepEqual(actual,custom?{font:20,minimum:'15px',chat:'22px',editor:'16',terminal:'14'}:{font:18,minimum:'17px',chat:'18px',editor:'18',terminal:'17'});
  await page.getByRole('button',{name:'设置',exact:true}).click();const dialog=page.getByRole('dialog',{name:'工作台设置',exact:true});assert.equal(await dialog.locator('label').filter({hasText:'界面字号'}).locator('input').inputValue(),custom?'20':'18');
 });
 for(const width of [1366,1024])await check('ui-followup-default-layout-'+width,async page=>{
  await page.setViewportSize({width,height:768});await app(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const box=await page.locator('.composer textarea').boundingBox();assert(box&&box.y+box.height<=768&&box.x+box.width<=width,'larger default keeps the composer reachable');
  assert.equal(await page.locator('.agent-panel').isVisible(),true);assert.equal(await page.locator('.main-column').isVisible(),true);await page.screenshot({path:path.join(out,'default-layout-'+width+'.png')});
 });
 await check('ui-followup-group-menu-confirm-delete-retains-chat',async page=>{
  await app(page);const group=page.locator('.conversation-project').filter({hasText:'metad'}),trigger=group.getByRole('button',{name:'分组菜单 · metad',exact:true});
  const plus=await group.getByRole('button',{name:'在分组中新建对话 · metad',exact:true}).boundingBox(),dots=await trigger.boundingBox();assert(dots.x>=plus.x+plus.width);
  await trigger.click();await page.getByRole('menuitem',{name:'删除分组 · metad',exact:true}).click();const dialog=page.getByRole('dialog',{name:'删除会话分组',exact:true});await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='conversation.deleteGroup').length),0);
  await trigger.focus();await page.keyboard.press('ArrowDown');await page.getByRole('menuitem',{name:'删除分组 · metad',exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await trigger.evaluate(node=>node===document.activeElement),true);
  await trigger.click();await page.getByRole('menuitem',{name:'删除分组 · metad',exact:true}).click();await dialog.getByRole('button',{name:'删除分组',exact:true}).click();await group.waitFor({state:'detached'});await page.locator('.conversation-sidebar>.conversation-row').getByText('Keep this chat',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__test.conversations.length),1);assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='conversation.deleteGroup').length),1);assert.equal(await page.locator('.conversation-project').count(),1);
  await page.screenshot({path:path.join(out,'group-after-delete.png')});
 });
 await check('ui-followup-empty-sidebar-has-no-autosave-placeholder',async page=>{await app(page,{empty:true});assert.equal(await page.getByText('对话会自动保存在这里',{exact:true}).count(),0);assert.equal(await page.getByText('Agent 会话与科学计算队列独立运行',{exact:true}).count(),0);});
}
