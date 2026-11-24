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
 await check('setup-spotlight-visible-target-geometry',async page=>{
  await page.setViewportSize({width:1024,height:768});
  await page.evaluate(async()=>{
   const {default:GuideSpotlight}=await import('/frontend/features/onboarding/GuideSpotlight.tsx');
   const {Modal}=await import('/frontend/ui/Dialogs.tsx');
   const {createElement:h,useState}=window.React;
   function Fixture(){
    const [variant,setVariant]=useState('no-secondary'),[otherModal,setOtherModal]=useState(false);
    return h('div',{className:'application'},
      h('header',{className:'titlebar',style:{height:73}},
        h('button',{onClick:()=>setVariant('clipped')},'Mount secondary control'),
        h('button',{onClick:()=>setVariant('large')},'Mount full-size control'),
        h('button',{onClick:()=>setOtherModal(true)},'Open separate dialog')),
      variant==='large'?h('button',{'data-guide-target':'discover',style:{position:'fixed',inset:'77px 0 0'}},'Full-size control'):
        h('details',{style:{position:'fixed',left:20,top:180}},h('summary',null,'Expand primary control'),
          h('button',{'data-guide-target':'discover'},'Primary control')),
      variant==='clipped'&&h('div',{'data-testid':'spotlight-clip',style:{position:'fixed',left:20,top:82,width:145,height:28,overflow:'hidden'}},
        h('button',{'data-guide-target':'connect-worker',style:{margin:'-12px 0 0 -7px',width:180,height:50}},'Secondary control')),
      h(GuideSpotlight,{step:'environments',english:true}),
      otherModal&&h(Modal,{title:'Separate dialog',onClose:()=>setOtherModal(false)},h('input',{'aria-label':'Dialog input'})));
   }
   window.testRoot.render(h(Fixture));
  });
  const spot=page.getByTestId('guide-spotlight'),hint=spot.locator('p');
  await spot.getByRole('status').getByText('The control is out of view.',{exact:false}).waitFor();
  assert.equal(await spot.locator('.guide-focus-ring').count(),0);

  await page.evaluate(()=>{
   window.spotlightFrames=[];
   function sample(){
    const visible=document.querySelector('.guide-spotlight[data-ready="true"][data-target="connect-worker"]');
    if(visible){
     const card=visible.querySelector('aside');
     window.spotlightFrames.push({hint:card.querySelector('p').textContent,top:card.getBoundingClientRect().top});
    }
    if(window.spotlightFrames.length<2)requestAnimationFrame(sample);
   }
   requestAnimationFrame(sample);
  });
  await page.getByRole('button',{name:'Mount secondary control'}).click();
  await page.waitForFunction(()=>window.spotlightFrames.length===2);
  const frames=await page.evaluate(()=>window.spotlightFrames);
  assert.deepEqual(frames,[0,1].map(()=>({hint:'Connect the job service here first. Discovery becomes available on this page once connected.',top:frames[0].top})));
  const geometry=await spot.evaluate(layer=>{
   const ring=layer.querySelector('.guide-focus-ring').getBoundingClientRect();
   const clip=document.querySelector('[data-testid="spotlight-clip"]').getBoundingClientRect();
   const titlebar=document.querySelector('.titlebar').getBoundingClientRect(),card=layer.querySelector('aside').getBoundingClientRect();
   const caret=getComputedStyle(layer.querySelector('.guide-tip-position'),'::before');
   return {visibleClip:['top','left','right','bottom'].every(key=>ring[key]===clip[key]),
    safe:card.top>=titlebar.bottom+9.99&&card.bottom<=innerHeight&&card.right<=innerWidth,
    avoids:card.left>=ring.right||card.right<=ring.left||card.top>=ring.bottom||card.bottom<=ring.top,
    arrow:parseFloat(caret.width)>0&&parseFloat(caret.height)>0};
  });
  assert.deepEqual(geometry,{visibleClip:true,safe:true,avoids:true,arrow:true});
  await page.screenshot({path:path.join(out,'spotlight-clipped-secondary.png')});
  await page.getByText('Expand primary control',{exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.guide-spotlight[data-ready="true"]')?.dataset.target==='discover');
  assert.match(await hint.innerText(),/Use this button to discover/);

  await page.getByRole('button',{name:'Open separate dialog'}).click();
  const dialog=page.getByRole('dialog',{name:'Separate dialog'});
  await dialog.waitFor();await spot.waitFor({state:'detached'});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});await spot.waitFor();

  await page.getByRole('button',{name:'Mount full-size control'}).click();
  await page.waitForFunction(()=>document.querySelector('.guide-spotlight[data-ready="true"][data-docked="true"]'));
  assert.match(await spot.getAttribute('data-side'),/^(top|bottom)$/);
  assert.equal(await spot.evaluate(layer=>{
   const card=layer.querySelector('aside').getBoundingClientRect(),title=layer.ownerDocument.querySelector('.titlebar').getBoundingClientRect();
   const control=layer.ownerDocument.querySelector('[data-guide-target="discover"]');
   return card.top>=title.bottom&&card.bottom<=innerHeight&&control===document.elementFromPoint(innerWidth/2,innerHeight/2)&&
    (Math.abs(card.top-title.bottom-10)<1||Math.abs(card.bottom-innerHeight+10)<1);
  }),true);
  await page.screenshot({path:path.join(out,'spotlight-full-size-docked.png')});
 });
 await check('interaction-experience-guided-connected-pages',async page=>{
  await page.evaluate(()=>{
   const original=window.studio.invoke;
   window.studio.invoke=async(method,data)=>{
    if(method==='state')return {...await original(method,data),setupGuide:{page:'ready',directory:'fixture',directoryKind:'profile'}};
    if(method==='worker.request'&&data.target==='/api/compute/readiness')return {environments:[],clusters:[]};
    if(method==='worker.request'&&data.target==='/api/environments/drafts')return [];
    return original(method,data);
   };
   return window.renderTest('App');
  });
  const guide=page.getByTestId('setup-assistant'),spot=page.getByTestId('guide-spotlight');
  await page.waitForFunction(()=>window.__test.calls.some(c=>c.method==='worker.request'&&c.data.target==='/api/runs'));
  await guide.getByRole('button',{name:'配置我的第一个科学工具'}).click();
  await guide.getByRole('button',{name:'登记已有环境'}).click();
  await page.waitForFunction(()=>document.querySelector('.guide-spotlight[data-ready="true"]')?.dataset.target==='discover');
  await spot.getByRole('button').press('Space');await spot.waitFor({state:'detached'});
  assert.equal(await page.getByTestId('discover-compute').evaluate(el=>el===document.activeElement),true);
  await page.getByTestId('setup-lesson').click();
  await guide.getByRole('button',{name:/跟着示例走一遍/}).click();
  await guide.getByRole('button',{name:'查看结果',exact:true}).click();
  await guide.getByRole('button',{name:'打开运行记录'}).click();
  await page.waitForFunction(()=>document.querySelector('.guide-spotlight[data-ready="true"]')?.dataset.target==='run-record');
  await spot.getByRole('button').click();
  assert.equal(await page.locator('.job-record-open').first().evaluate(el=>el===document.activeElement),true);
  const calls=await page.evaluate(()=>window.__test.calls);
  assert.deepEqual(calls.filter(c=>c.method==='compute.setup'||c.method==='task.execute'),[]);
  // Loading the registered environment reads its existing check with POST /api/runtime-guide.
  assert.deepEqual(calls.filter(c=>c.method==='worker.request'&&c.data.method==='POST'&&c.data.target!=='/api/runtime-guide').map(c=>c.data.target),[]);
  assert.equal(await page.evaluate(()=>localStorage.getItem('studio.section')),'runs');
 });
 for(const reduced of [false,true]){
  const preference=reduced?'reduce':'no-preference';
  await check('interaction-experience-menus-and-groups-'+preference,async page=>{
   await page.emulateMedia({reducedMotion:preference});
   await app(page);
   const group=page.locator('.conversation-project').filter({hasText:'metad'}),summary=group.locator('summary');
   const duration=await group.evaluate(el=>getComputedStyle(el,'::details-content').transitionDuration);
   assert.equal(parseFloat(duration)>0,!reduced);
   await summary.press('Enter');await page.waitForFunction(()=>!document.querySelector('.conversation-project').open);
   await summary.press('Space');await group.getByText('Keep this chat',{exact:true}).waitFor();
   await group.getByRole('button',{name:'分组菜单 · metad'}).press('ArrowDown');
   const menu=page.getByRole('menu');await menu.waitFor();
   assert.equal(await menu.evaluate(el=>getComputedStyle(el).animationName),reduced?'none':'ui-reveal');
   await page.keyboard.press('Escape');await menu.waitFor({state:'detached'});
   const layout=page.locator('.workspace-layout-menu');
   await layout.locator('summary').click();await page.getByTestId('priority-chat').click();
   assert.equal(await layout.evaluate(el=>el.open),false);
   assert.equal(await layout.locator('summary').evaluate(el=>el===document.activeElement),true);
   await page.getByTestId('agent-options').click();
   const select=page.getByTestId('agent-provider'),value=await select.inputValue();
   await select.focus();await page.keyboard.press('Alt+ArrowDown');
   await page.waitForFunction(()=>document.querySelector('[data-testid="agent-provider"]').matches(':open'));
   assert.equal(await select.evaluate(el=>getComputedStyle(el,'::picker(select)').animationName),reduced?'none':'ui-reveal');
   await page.keyboard.press('Escape');
   assert.equal(await select.inputValue(),value);
  });
  await check('interaction-experience-new-message-and-replay-'+preference,async page=>{
   await page.emulateMedia({reducedMotion:preference});
   await page.evaluate(async()=>{
    await import('/frontend/app/interactions.css');
    const original=window.studio.invoke;
    window.studio.invoke=async(method,data)=>{
     if(method==='agent.rpc'&&['thread/resume','thread/read'].includes(data.method))return {model:'fixture-model',thread:{
       id:data.params.threadId,turns:[{items:[{id:'old-message',type:'userMessage',content:[{type:'text',text:'Saved message'}]}]}]}};
     return original(method,data);
    };
    window.startAnimations=[];
    document.addEventListener('animationstart',event=>window.startAnimations.push(event.animationName));
    return window.renderTest('Agent',{planningMode:false,onPlanningModeChange(){},context:'{}',onError:error=>{throw error;},
      sessionSelection:{nonce:'resume',conversation:{provider:'codex',threadId:'motion-thread',name:'Previous conversation'}}});
   });
   const previous=page.locator('[data-message-id="old-message"]');
   await previous.waitFor();assert.equal(await previous.evaluate(el=>getComputedStyle(el).animationName),'none');
   const composer=page.locator('.composer textarea');await composer.fill('New message');
   await composer.press('Enter');
   const sent=page.locator('.message.user[data-just-sent]');await sent.waitFor();
   assert.equal(await sent.locator('.message-text').innerText(),'New message');
   assert.equal(await sent.evaluate(el=>getComputedStyle(el).animationName),reduced?'none':'message-sent');
   if(!reduced)await page.waitForFunction(()=>window.startAnimations.includes('message-sent'));
   assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='agent.rpc'&&c.data.method==='turn/start').length),1);
   assert.equal(await previous.evaluate(el=>el.hasAttribute('data-just-sent')),false);
  });
 }
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
