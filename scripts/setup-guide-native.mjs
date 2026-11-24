// Exercise the normal desktop entry with a disposable profile. No credentials or compute submissions.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Catalog} from '../backend/main/workspace/catalog.mjs';
import { _electron as electron } from 'playwright';
import {requireLaunchContext,resolveDesktopBinary,desktopRoot} from './desktop-launch.mjs';

requireLaunchContext();
const output=path.join(desktopRoot,'validation','local','third-guide-native');
await fs.mkdir(output,{recursive:true});
const packaged=process.argv[2];
const run=await fs.mkdtemp(path.join(output,packaged?'packaged-':'run-')),profile=path.join(run,'profile');
const sourceApp=process.env.STUDIO_SETUP_GUIDE_SOURCE_APP?await fs.realpath(process.env.STUDIO_SETUP_GUIDE_SOURCE_APP):desktopRoot;
const expectedVersion=process.argv[3]||(!packaged&&JSON.parse(await fs.readFile(path.join(sourceApp,'package.json'),'utf8')).version);
const executablePath=packaged?await fs.realpath(packaged):await resolveDesktopBinary(),errors=[];
let application,page,runningVersion;
async function launch(directory=profile){
  application=await electron.launch({executablePath,args:packaged?[]:['.'],cwd:packaged?desktopRoot:sourceApp,env:{...process.env,STUDIO_PROFILE_DIR:directory,STUDIO_DEV_URL:''}});
  const receipt=await application.evaluate(({app})=>({packaged:app.isPackaged,version:app.getVersion()}));
  assert.equal(receipt.packaged,Boolean(packaged));runningVersion=receipt.version;
  if(expectedVersion)assert.equal(runningVersion,expectedVersion);
  page=await application.firstWindow();
  page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(8000);
}
async function close(){if(application){await application.close();application=null;}}
async function resize(width,height){
  await application.evaluate(({BrowserWindow},size)=>{
    const win=BrowserWindow.getAllWindows()[0];win.setContentSize(...size);
  },[width,height]);
  await page.waitForFunction(([w,h])=>window.innerWidth===w&&window.innerHeight===h,[width,height]);
}
const guide=()=>page.getByTestId('setup-assistant');
const button=(name)=>guide().getByRole('button',{name,exact:true});
const state=()=>page.evaluate(()=>window.studio.invoke('state'));
async function heading(name){await guide().getByRole('heading',{name,exact:true}).waitFor();}
const focusChecks=[],fallbackChecks=[];
async function checkFocus(step,title,{activateTarget=false,screenshot,target,nextTarget}={}){
  const layer=page.getByTestId('guide-spotlight');
  await page.waitForFunction(expected=>{
    const layer=document.querySelector('[data-testid="guide-spotlight"][data-ready="true"]');
    return !!layer?.dataset.target&&(!expected||layer.dataset.target===expected);
  },target);
  assert.equal(await layer.getAttribute('data-step'),step);
  assert.equal(await layer.locator('strong').innerText(),title);
  const geometry=await layer.evaluate(el=>{
    const key=el.dataset.target;
    const r=el.querySelector('.guide-focus-ring').getBoundingClientRect(),c=el.querySelector('aside').getBoundingClientRect();
    const titlebar=document.querySelector('.titlebar').getBoundingClientRect();
    const x=r.x+r.width/2,y=r.y+r.height/2;
    const receiver=document.elementFromPoint(x,y);
    const target=receiver?.closest('[data-guide-target="'+key+'"]');
    const probe=window.spotlightClickProbe={abort:new AbortController(),clicks:[]};
    target?.addEventListener('click',event=>probe.clicks.push({trusted:event.isTrusted,receiver:event.target.tagName}),{signal:probe.abort.signal});
    const back=document.querySelector('[data-testid="setup-lesson"]'),b=back?.getBoundingClientRect();
    return {key,x,y,window:[innerWidth,innerHeight],docked:el.dataset.docked==='true',side:el.dataset.side,
      modal:el.closest('[aria-modal="true"]')?.getAttribute('aria-modal')==='true',anchored:!!target,
      focusable:target?.matches('input,textarea,select,button,summary,[tabindex]')??false,
      backReachable:!b||back.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)),
      visible:c.left>=0&&c.top>=titlebar.bottom&&c.right<=innerWidth+.01&&c.bottom<=innerHeight+.01&&r.top>=titlebar.bottom,
      clear:c.right<=r.left||c.left>=r.right||c.bottom<=r.top||c.top>=r.bottom};
  });
  assert(geometry.anchored&&geometry.backReachable&&geometry.visible&&(geometry.clear||geometry.docked),JSON.stringify({step,...geometry}));
  if(target)assert.equal(geometry.key,target);
  if(screenshot)await page.screenshot({path:path.join(run,screenshot+'.png'),animations:'disabled'});
  if(activateTarget)await page.mouse.click(geometry.x,geometry.y);
  else {
    await layer.getByRole('button').focus();
    assert.equal(await layer.getByRole('button').evaluate(button=>button===document.activeElement),true);
    await page.keyboard.press('Escape');
  }
  if(nextTarget)await page.waitForFunction(expected=>document.querySelector('.guide-spotlight[data-ready="true"]')?.dataset.target===expected,nextTarget);
  else await layer.waitFor({state:'detached'});
  const observed=await page.evaluate(()=>{
    const {abort,clicks}=window.spotlightClickProbe;
    abort.abort();delete window.spotlightClickProbe;
    return {clicks,focused:document.activeElement?.closest('[data-guide-target]')?.dataset.guideTarget};
  });
  assert.deepEqual(observed.clicks.map(click=>click.trusted),activateTarget?[true]:[]);
  if(!activateTarget&&geometry.focusable)assert.equal(observed.focused,geometry.key);
  focusChecks.push({step,target:geometry.key,action:activateTarget?'native-click':'escape',...observed,geometry});
}
async function returnFromLesson(destination,title,options={}){
  const back=page.getByTestId('setup-lesson');
  assert.equal(await back.getAttribute('data-lesson'),destination);
  assert.equal(await page.getByTestId('open-setup-guide').count(),0);
  if(options.progress)assert.equal(await page.getByTestId('setup-lesson-progress').innerText(),options.progress);
  await checkFocus(destination,title,options);
  if(options.keyboard){await back.focus();await page.keyboard.press('Enter');}else await back.click();
  await guide().waitFor();await back.waitFor({state:'detached'});
}
async function capture(name){
  await page.screenshot({path:path.join(run,name+'.png'),animations:'disabled'});
  const usable=await guide().locator('.setup-primary').evaluate(element=>{
    const bounds=element.getBoundingClientRect();
    return bounds.left>=0&&bounds.right<=innerWidth&&bounds.bottom<=innerHeight&&bounds.height>=32&&
      element.contains(document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2));
  });
  assert.ok(usable,'Primary action must remain reachable: '+name);
}
try {
  await launch();await resize(1366,768);
  await button('简体中文').click();await heading('欢迎使用 AIMatterLab');
  const info=(await state()).setupGuide;
  assert.equal(info.directory,profile);assert.equal(info.directoryKind,'profile');
  await button('深色石墨').click();await capture('welcome-dark');
  const cell=guide().locator('canvas'),before=await cell.evaluate(c=>c.toDataURL());
  await cell.focus();await page.keyboard.press('ArrowRight');
  await page.waitForFunction(before=>document.querySelector('.setup-specimen canvas').toDataURL()!==before,before);
  await button('复位视角').click();
  await button('浅色').click();await capture('welcome-light');
  await button('English').click();await heading('Welcome to AIMatterLab');
  await button('Continue').click();await heading('Choose your AI assistant');
  await guide().getByRole('button',{name:/Qwen/}).click();await button('Configure account').click();
  await checkFocus('account','Configure account',{target:'add-api',activateTarget:true,nextTarget:'api-endpoint',screenshot:'lesson-account-wide'});
  const dialog=page.getByRole('dialog');await dialog.getByTestId('model-providers').waitFor();
  await checkFocus('account','Configure account',{target:'api-endpoint',activateTarget:true,screenshot:'lesson-account-editor-wide'});
  assert.equal(await dialog.getByTestId('provider-base-url').evaluate(el=>document.activeElement===el),true);
  assert.equal(await page.locator('[data-testid="cli-runtime-dialog"]').count(),0);
  await dialog.getByTestId('provider-dialog-exit').click();await dialog.waitFor({state:'detached'});await capture('agent-en');
  await button('Try a message').click();
  await page.waitForFunction(()=>document.querySelector('.agent-panel .composer textarea')?.value==='Reply with OK to test this model connection.');
  assert.equal(await page.getByTestId('agent-provider').inputValue(),'qwen');
  await checkFocus('model-test','Test the model connection',{target:'composer',activateTarget:true,screenshot:'lesson-chat-wide'});
  const composer=page.locator('.agent-panel .composer textarea');
  await page.keyboard.press('End');await page.keyboard.insertText(' Working draft.');
  assert.equal(await composer.inputValue(),'Reply with OK to test this model connection. Working draft.');
  const again=page.getByTestId('setup-lesson-rehighlight');await again.click();
  await returnFromLesson('model-test','Test the model connection',{keyboard:true,progress:'Setup 2/4'});await heading('Choose your AI assistant');
  await button('Continue').click();await heading('Where will you compute?');
  await close();await launch();await resize(1024,768);
  await heading('Where will you compute?');assert.equal((await state()).settings.agentProvider,'qwen');
  await page.evaluate(()=>window.studio.invoke('settings',{fontSize:24,minimumFontSize:18}));await page.reload();await heading('Where will you compute?');
  await guide().getByRole('button',{name:/Local WSL/}).click();await button('Choose WSL distribution').click();
  await page.getByTestId('compute-connection-guide').waitFor();await checkFocus('wsl','Choose a WSL distribution');
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).first().click();
  await heading('Where will you compute?');
  await guide().getByRole('button',{name:/Remote cluster/}).click();await button('Set up SSH').click();
  await checkFocus('choose-ssh','Set up SSH',{target:'add-ssh',activateTarget:true,screenshot:'lesson-ssh-choice-small'});
  await page.getByTestId('compute-profile-host').waitFor();
  assert.equal(await page.getByTestId('compute-choice-local').count(),0);
  await page.getByTestId('compute-profile-name').fill('Guide fixture');
  await page.getByTestId('compute-profile-host').fill('guide.invalid');
  await page.getByTestId('compute-profile-username').fill('fixture');
  await page.getByTestId('compute-profile-editor').locator('button[type=submit]').click();
  const saved=page.getByTestId('saved-compute-profile');
  await saved.getByRole('button',{name:/Edit.*Guide fixture/i}).click();
  await page.getByTestId('compute-profile-editor').locator('details').filter({has:page.getByTestId('compute-service-agent-help')}).locator('summary').click();
  await page.getByTestId('compute-service-agent-help').click();
  await returnFromLesson('ssh-service','Prepare the remote job service');
  await button('Set up SSH').click();await checkFocus('choose-ssh','Set up SSH');
  await page.locator('.compute-resource-advanced > summary').click();
  await page.getByRole('button',{name:'Open existing cluster settings'}).click();
  await returnFromLesson('ssh-settings','Configure the remote connection');
  await capture('compute-small');
  await button('Continue').click();await heading('Explore your workspace');
  await button('Set up my first scientific tool').click();
  await button('Register an environment').click();await page.locator('.compute-environments').waitFor();
  await returnFromLesson('environments','Register an environment');await heading('Explore your workspace');
  await button('Get tools and install guides').click();const details=page.getByTestId('tool-source-list');await details.waitFor();
  assert.equal(await details.evaluate(el=>el.open),false);
  await checkFocus('extensions','Find a scientific tool',{target:'tool-sources',activateTarget:true,screenshot:'lesson-tool-sources-small'});
  assert.equal(await details.evaluate(el=>el.open),true);
  await page.getByTestId('setup-lesson').click();
  await heading('Explore your workspace');
  await guide().getByRole('button',{name:/Take the guided tour/}).click();
  await button('Open data assets').click();await page.getByTestId('asset-inspector').waitFor();await returnFromLesson('assets','Import a structure',{progress:'Tour 1/5',screenshot:'lesson-assets-en'});
  await button('Next step').click();await button('Draft a goal in chat').click();
  await page.waitForFunction(()=>document.querySelector('.agent-panel .composer textarea')?.value.includes('molecular dynamics simulation of FCC copper'));
  await returnFromLesson('tour-goal','Describe your goal',{progress:'Tour 2/5'});await guide().getByRole('heading',{name:'Describe your goal'}).waitFor();
  for(let step=1;step<4;step++)await button('Next step').click();
  await guide().getByRole('heading',{name:'Inspect the results'}).waitFor();await capture('tour-en');
  await button('Open run history').click();await page.getByTestId('jobs-page').waitFor();
  const runHint=page.getByTestId('guide-spotlight');await runHint.waitFor();
  if(!await runHint.getAttribute('data-target')){
    assert.match(await runHint.getByRole('status').innerText(),/The control is out of view/);
    await page.screenshot({path:path.join(run,'lesson-runs-fallback-small.png'),animations:'disabled'});
    const pane=await page.locator('.workspace-content').boundingBox();
    await page.mouse.move(pane.x+pane.width/2,pane.y+pane.height/2);await page.mouse.wheel(0,450);
    fallbackChecks.push({step:'runs',window:[1024,768],action:'scroll'});
  }
  await returnFromLesson('runs','Inspect run results',{progress:'Tour 5/5'});
  await heading('Explore your workspace');
  await button('Close tour').click();await button('Check a compute environment').click();
  await guide().getByRole('combobox').selectOption('reference-md');await button('Prepare check in chat').click();
  await page.waitForFunction(()=>document.querySelector('.agent-panel .composer textarea')?.value.includes('reference-md'));
  assert.equal(await page.getByTestId('agent-provider').inputValue(),'qwen');
  await resize(640,720);await returnFromLesson('short-check','Prepare the ASE · CPU MD check',{keyboard:true,progress:'Setup 4/4',screenshot:'lesson-check-narrow'});await heading('Explore your workspace');
  assert.equal(await guide().getByRole('combobox').inputValue(),'reference-md');await capture('ready-narrow');
  await button('Enter workspace').click();assert.equal((await state()).setupGuide.page,'complete');
  await close();await launch();await page.getByTestId('open-setup-guide').waitFor();
  assert.equal(await guide().count(),0);
  await page.getByTestId('open-setup-guide').click();await heading('Welcome to AIMatterLab');await button('Skip setup').click();
  assert.equal((await state()).setupGuide.page,'complete');
  await close();const legacy=path.join(run,'upgraded-profile'),catalog=new Catalog(path.join(legacy,'studio'));
  catalog.put('settings','main',{language:'en',theme:'light'});catalog.db.close();
  await launch(legacy);await page.getByTestId('open-setup-guide').waitFor();assert.equal(await guide().count(),0);
  assert.equal((await state()).settings.theme,'light');assert.equal((await state()).setupGuide.page,'complete');
  await close();await launch(path.join(run,'skip-profile'));await guide().waitFor();await resize(1366,768);
  await button('简体中文').click();await button('深色石墨').click();await button('继续').click();
  await button('试发一条消息').click();await returnFromLesson('model-test','测试模型连接',{screenshot:'lesson-chat-zh-dark'});
  await button('上一步').click();await button('English').click();
  await button('Skip setup').click();assert.equal((await state()).setupGuide.page,'complete');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(run,'result.json'),JSON.stringify({status:'passed',version:runningVersion,packaged:Boolean(packaged),profile:'isolated',focusChecks,fallbackChecks,errors},null,2));
  console.log('Native setup checks passed. '+run);
}catch(error){
  if(page&&!page.isClosed())await page.screenshot({path:path.join(run,'failure.png')}).catch(()=>{});
  await fs.writeFile(path.join(run,'result.json'),JSON.stringify({status:'failed',version:runningVersion,packaged:Boolean(packaged),profile:'isolated',focusChecks,fallbackChecks,errors,failure:error.message},null,2));
  console.error('Native setup check failed. '+run);throw error;
}finally{await close();}
