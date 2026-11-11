import assert from 'node:assert/strict';
import path from 'node:path';
export async function frontendLayoutExperienceCases({check,out}){
 async function app(page){await page.evaluate(()=>{const original=window.studio.invoke;window.studio.invoke=async(method,data)=>method==='compute.resource.status'?{schemaVersion:1,kind:'none',selectionId:null}:method==='compute.profiles.list'?{profiles:[],defaults:{}}:method==='sharedTerminal.list'?{sessions:[]}:original(method,data);localStorage.setItem('studio.bottomExpanded','true');localStorage.setItem('studio.bottom','190');return window.renderTest('App');});await page.getByTestId('toggle-bottom-panel').waitFor();}
 await check('experience-round2-layout-navigation-labels-and-keyboard-height',async page=>{
  await app(page);
  for(const [id,label] of [['navigate-home','会话'],['navigate-skills','技能库'],['navigate-runs','任务总览']]){await page.getByTestId(id).focus();await page.getByRole('tooltip').filter({hasText:label}).waitFor();assert.equal(await page.getByTestId(id).getAttribute('aria-label'),label);await page.keyboard.press('Escape');assert.equal(await page.getByRole('tooltip').count(),0);}
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
