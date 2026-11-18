// Exercise the normal desktop entry with a disposable profile. No credentials or compute submissions.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Catalog} from '../backend/main/workspace/catalog.mjs';
import { _electron as electron } from 'playwright';
import {requireLaunchContext,resolveDesktopBinary,desktopRoot} from './desktop-launch.mjs';

requireLaunchContext();
const output=path.join(desktopRoot,'.studio','setup-guide-native');
await fs.mkdir(output,{recursive:true});
const run=await fs.mkdtemp(path.join(output,'run-')),profile=path.join(run,'profile');
const packaged=process.argv[2];
const executablePath=packaged?await fs.realpath(packaged):await resolveDesktopBinary(),errors=[];
let application,page;
async function launch(directory=profile){
  application=await electron.launch({executablePath,args:packaged?[]:['.'],cwd:desktopRoot,env:{...process.env,STUDIO_PROFILE_DIR:directory,STUDIO_DEV_URL:''}});
  page=await application.firstWindow();
  page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(8000);
}
async function close(){if(application){await application.close();application=null;}}
async function resize(width,height){
  await application.evaluate(({BrowserWindow},size)=>{
    const win=BrowserWindow.getAllWindows()[0];win.setMinimumSize(400,440);win.setContentSize(...size);
  },[width,height]);
  await page.waitForFunction(([w,h])=>window.innerWidth===w&&window.innerHeight===h,[width,height]);
}
const guide=()=>page.getByTestId('setup-assistant');
const button=(name)=>guide().getByRole('button',{name,exact:true});
const state=()=>page.evaluate(()=>window.studio.invoke('state'));
async function heading(name){await guide().getByRole('heading',{name,exact:true}).waitFor();}
async function returnFromLesson(destination,title,{keyboard=false,screenshot}={}){
  const bubble=page.getByTestId('setup-lesson');
  await bubble.waitFor();assert.equal(await bubble.getAttribute('data-lesson'),destination);
  assert.equal(await bubble.locator('strong').innerText(),title);
  assert((await bubble.locator('.setup-lesson-hint').innerText()).length>12);
  assert.equal(await page.getByTestId('open-setup-guide').count(),0);
  assert(await bubble.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}));
  if(screenshot)await page.screenshot({path:path.join(run,screenshot+'.png'),animations:'disabled'});
  if(keyboard){await bubble.focus();await page.keyboard.press('Enter');}else await bubble.click();
  await guide().waitFor();await bubble.waitFor({state:'detached'});
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
  const dialog=page.getByRole('dialog');await dialog.getByTestId('model-providers').waitFor();
  await dialog.getByTestId('add-api-provider').click();await dialog.getByTestId('provider-preset').waitFor();
  assert.equal(await page.locator('[data-testid="cli-runtime-dialog"]').count(),0);
  await page.keyboard.press('Escape');await capture('agent-en');
  await button('Try a message').click();
  await page.waitForFunction(()=>document.querySelector('.agent-panel .composer textarea')?.value==='Reply with OK to test this model connection.');
  assert.equal(await page.getByTestId('agent-provider').inputValue(),'qwen');
  await returnFromLesson('model-test','Test the model connection',{keyboard:true,screenshot:'lesson-chat-wide'});await heading('Choose your AI assistant');
  await button('Continue').click();await heading('Where will you compute?');
  await close();await launch();await resize(1024,768);
  await heading('Where will you compute?');assert.equal((await state()).settings.agentProvider,'qwen');
  await page.evaluate(()=>window.studio.invoke('settings',{fontSize:24,minimumFontSize:18}));await page.reload();await heading('Where will you compute?');
  await guide().getByRole('button',{name:/Local WSL/}).click();await button('Choose WSL distribution').click();
  await page.getByTestId('compute-connection-guide').waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).first().click();
  await heading('Where will you compute?');
  await guide().getByRole('button',{name:/Remote cluster/}).click();await button('Set up SSH').click();
  await page.getByTestId('compute-choice-ssh').click();await page.getByTestId('compute-profile-host').waitFor();
  assert.equal(await page.getByTestId('compute-choice-local').count(),0);
  await page.keyboard.press('Escape');await capture('compute-small');
  await button('Continue').click();await heading('Explore your workspace');
  await button('Set up my first scientific tool').click();
  await button('Register an environment').click();await page.locator('.compute-environments').waitFor();
  await returnFromLesson('environments','Register an environment');await heading('Explore your workspace');
  await button('Get tools and install guides').click();await page.getByTestId('tool-source-list').waitFor();await returnFromLesson('extensions','Find a scientific tool');
  await heading('Explore your workspace');
  await guide().getByRole('button',{name:/Take the guided tour/}).click();
  await button('Open data assets').click();await page.getByTestId('asset-inspector').waitFor();await returnFromLesson('assets','Import a structure',{screenshot:'lesson-assets-en'});
  await button('Next step').click();await button('Draft a goal in chat').click();
  await page.waitForFunction(()=>document.querySelector('.agent-panel .composer textarea')?.value.includes('molecular dynamics simulation of FCC copper'));
  await returnFromLesson('tour-goal','Describe your goal');await guide().getByRole('heading',{name:'Describe your goal'}).waitFor();
  for(let step=1;step<4;step++)await button('Next step').click();
  await guide().getByRole('heading',{name:'Inspect the results'}).waitFor();await capture('tour-en');
  await button('Open run history').click();await returnFromLesson('runs','Inspect run results');
  await heading('Explore your workspace');
  await button('Close tour').click();await button('Check a compute environment').click();
  await guide().getByRole('combobox').selectOption('reference-md');await button('Prepare check in chat').click();
  await page.waitForFunction(()=>document.querySelector('.agent-panel .composer textarea')?.value.includes('reference-md'));
  assert.equal(await page.getByTestId('agent-provider').inputValue(),'qwen');
  await resize(630,720);await returnFromLesson('short-check','Prepare the ASE · CPU MD check',{keyboard:true,screenshot:'lesson-check-narrow'});await heading('Explore your workspace');
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
  await fs.writeFile(path.join(run,'result.json'),JSON.stringify({status:'passed',profile:'isolated',errors},null,2));
  console.log('Native setup checks passed. '+run);
}catch(error){
  if(page&&!page.isClosed())await page.screenshot({path:path.join(run,'failure.png')}).catch(()=>{});
  console.error('Native setup check failed. '+run);throw error;
}finally{await close();}
