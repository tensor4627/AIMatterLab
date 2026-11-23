import assert from 'node:assert/strict';
import path from 'node:path';
export async function frontendLayoutExperienceCases({check,out}){
 await check('review-pinned-tools-sidebar-directory-and-reload',async page=>{
  await page.setViewportSize({width:1366,height:768});
  await page.evaluate(()=>{localStorage.setItem('studio.pinnedTools','["unknown"]');return window.renderTest('App');});
  await page.getByTestId('navigate-tools').click();
  await page.getByTestId('open-tool-md').click();
  const pin=page.getByTestId('pin-tool');
  assert.equal(await pin.getAttribute('aria-pressed'),'false');
  await pin.click();
  const sidebar=page.getByTestId('sidebar-pinned-tools');
  await sidebar.getByRole('button',{name:'分子动力学引擎'}).click();
  assert.equal(await pin.getAttribute('aria-pressed'),'true');
  await page.reload();await page.waitForFunction(()=>window.renderTest);
  await page.evaluate(()=>window.renderTest('App'));
  await sidebar.getByRole('button',{name:'分子动力学引擎'}).waitFor();
  await page.setViewportSize({width:640,height:720});
  await page.locator('.workspace-shell.single-panel').waitFor();
  await page.locator('.navigation-rail:not([hidden])').getByTestId('navigate-tools').click();
  const directory=page.getByTestId('directory-pinned-tools');
  await directory.getByRole('button',{name:'分子动力学引擎'}).click();
  assert.equal(await pin.getAttribute('aria-pressed'),'true');
  await pin.click();await page.getByTestId('navigate-tools').click();
  assert.equal(await directory.count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('studio.pinnedTools')),'[]');
 });
 await check('review-narrow-panels-restore-focus-caret-and-scroll',async page=>{
  await page.setViewportSize({width:640,height:600});
  await page.evaluate(()=>window.renderTest('App'));
  await page.getByTestId('navigate-tools').click();
  const field=page.getByTestId('open-tool-hamiltonian');
  await field.focus();
  const scrollTop=await page.locator('.workspace-content').evaluate(el=>{el.scrollTop=68;return el.scrollTop;});
  assert(scrollTop>0);
  await page.getByTestId('show-agent').click();
  const draft=page.locator('.agent-panel .composer textarea');
  await page.waitForFunction(()=>document.activeElement?.matches('.agent-panel .composer textarea'));
  await draft.fill('未发送的草稿');await draft.evaluate(el=>el.setSelectionRange(2,4));
  await page.getByTestId('show-workspace').click();
  await page.waitForFunction(()=>document.activeElement?.dataset.testid==='open-tool-hamiltonian');
  assert.equal(await page.locator('.workspace-content').evaluate(el=>el.scrollTop),scrollTop);
  await page.getByTestId('show-agent').click();
  await page.waitForFunction(()=>document.activeElement?.matches('.agent-panel .composer textarea'));
  assert.deepEqual(await draft.evaluate(el=>[el.value,el.selectionStart,el.selectionEnd]),['未发送的草稿',2,4]);
  await page.getByTestId('show-workspace').click();
  const terminalTab=page.locator('.bottom-tabs').getByRole('button',{name:'终端',exact:true});
  await terminalTab.click();await page.locator('.terminal-holder').waitFor();
  await page.getByTestId('show-agent').click();await draft.waitFor();
  await page.getByTestId('show-workspace').click();
  await page.waitForFunction(()=>document.activeElement?.closest('.bottom-tabs')&&document.activeElement.textContent==='终端');
  await page.locator('.terminal-holder').waitFor();
 });
 await check('review-terminal-log-20000-lines-text-dom-and-selection',async page=>{
  await page.evaluate(()=>{
   const f=window.__test;
   f.largeLog=Array.from({length:20000},(_,i)=>'step '+(i+1)).join('\n');
   f.responses={'/api/run/log':({data})=>({offset:f.largeLog.length,text:data.offset===0?f.largeLog:''})};
   return window.renderTest('RunDetail',{run:{...f.run,status:'succeeded'},connected:true,onRefresh:()=>{},onError:cause=>{throw cause;}});
  });
  await page.waitForFunction(()=>document.querySelector('pre.console')?.textContent.endsWith('step 20000'));
  const observed=await page.locator('pre.console').evaluate(pre=>{
   const text=pre.textContent,needle='step 19998\nstep 19999',node=pre.firstElementChild.firstChild,start=node.textContent.indexOf(needle);
   const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+needle.length);
   const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
   pre.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
   return {exact:text===window.__test.largeLog,lines:text.split('\n').length,spans:pre.children.length,selection:selection.toString()};
  });
  assert.deepEqual(observed,{exact:true,lines:20000,spans:1,selection:'step 19998\nstep 19999'});
 });
 async function app(page){await page.evaluate(()=>{const original=window.studio.invoke;window.studio.invoke=async(method,data)=>method==='compute.resource.status'?{schemaVersion:1,kind:'none',selectionId:null}:method==='compute.profiles.list'?{profiles:[],defaults:{}}:method==='sharedTerminal.list'?{sessions:[]}:original(method,data);localStorage.setItem('studio.bottomExpanded','true');localStorage.setItem('studio.bottom','190');return window.renderTest('App');});await page.getByTestId('toggle-bottom-panel').waitFor();if(await page.locator('.sidebar').isVisible())await page.locator('.sidebar-title').getByRole('button',{name:/^(收起导航|Collapse navigation)$/}).click();}
 await check('experience-round2-layout-navigation-labels-and-keyboard-height',async page=>{
  await app(page);
  for(const [id,label] of [['navigate-home','工作区'],['navigate-tools','工具与资源'],['navigate-runs','运行记录']]){await page.getByTestId(id).focus();await page.getByRole('tooltip').filter({hasText:label}).waitFor();assert.equal(await page.getByTestId(id).getAttribute('aria-label'),label);await page.keyboard.press('Escape');assert.equal(await page.getByRole('tooltip').count(),0);}
  const divider=page.getByRole('separator',{name:'调整终端与队列高度',exact:true});await divider.focus();assert.equal(await divider.getAttribute('aria-orientation'),'horizontal');
  await page.keyboard.press('ArrowUp');await page.waitForFunction(()=>document.querySelector('[data-testid="bottom-panel"]').style.height==='222px');
  await page.keyboard.press('Shift+ArrowDown');assert.equal(await divider.getAttribute('aria-valuenow'),'221');await page.keyboard.press('End');assert.equal(await divider.getAttribute('aria-valuenow'),'380');await page.keyboard.press('Home');assert.equal(await divider.getAttribute('aria-valuenow'),'90');
  await page.keyboard.press('ArrowUp');assert.equal(await page.evaluate(()=>localStorage.getItem('studio.bottom')),'122');
  const panel=await page.getByTestId('bottom-panel').boundingBox(),bar=await divider.boundingBox();assert(Math.abs(bar.width-panel.width)<2&&bar.height>=6);
  await page.getByTestId('toggle-bottom-panel').click();assert.equal(await divider.count(),0);await page.getByTestId('toggle-bottom-panel').click();assert.equal(await divider.getAttribute('aria-valuenow'),'122');
  await page.screenshot({path:path.join(out,'experience-round2-layout-keyboard-height.png')});
  const mutations=await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='task.execute'||c.method==='sharedTerminal.open'||c.method==='agent.rpc'&&c.data?.method==='turn/start'));assert.deepEqual(mutations,[]);
 });
 await check('experience-round2-layout-light-english-controls',async page=>{
  await page.evaluate(()=>{window.__test.settings.theme='light';window.__test.settings.language='en';});await app(page);
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.getByTestId('navigate-runs').focus();const label=await page.getByTestId('navigate-runs').getAttribute('aria-label');assert.match(label,/[A-Za-z]/);assert.doesNotMatch(label,/[\u4e00-\u9fff]/);await page.getByRole('tooltip').filter({hasText:label}).waitFor();await page.keyboard.press('Escape');
  const divider=page.getByRole('separator',{name:'Adjust terminal and queue height',exact:true});await divider.focus();await page.keyboard.press('ArrowUp');assert.equal(await divider.getAttribute('aria-valuenow'),'222');
  await page.screenshot({path:path.join(out,'experience-round2-layout-light-english.png')});
 });
 await check('experience-round2-layout-pointer-resize-and-release',async page=>{
  await app(page);const divider=page.getByRole('separator',{name:'调整终端与队列高度',exact:true}),box=await divider.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y-60,{steps:10});await page.mouse.up();
  const height=Number(await divider.getAttribute('aria-valuenow'));assert(height>=248&&height<=256);await page.mouse.move(box.x+30,box.y-140);assert.equal(Number(await divider.getAttribute('aria-valuenow')),height);
  await divider.focus();await page.keyboard.press('Home');assert.equal(await divider.getAttribute('aria-valuenow'),'90');await page.screenshot({path:path.join(out,'experience-round2-layout-pointer-height.png')});
 });
}
