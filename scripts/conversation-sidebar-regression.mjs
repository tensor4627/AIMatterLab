// Current App renderer + isolated synthetic IPC; no live providers, SSH or jobs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
import {requireLaunchContext} from './desktop-launch.mjs';

const electron=process.env.STUDIO_SIDEBAR_ELECTRON==='1';
if(electron)requireLaunchContext();
const out=path.resolve(process.env.STUDIO_SIDEBAR_OUTPUT||('.studio/conversation-sidebar-20261112'+(electron?'/electron':'')));
await fs.mkdir(out,{recursive:true});
const harness=path.join(out,'harness.html');
await fs.writeFile(harness,`<!doctype html><html><head><meta charset="utf-8"><title>Studio sidebar preview</title></head><body><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';import App from '/frontend/app/App.tsx';import '/frontend/app/style.css';
const query=new URLSearchParams(location.search),theme=query.get('theme')||'dark',large=query.has('large'),many=query.has('many'),long=query.has('long');
localStorage.clear();localStorage.setItem('studio.sidebarWidth',query.get('sidebar')||'260');
const conversation=(id,name,groupId=null,pinned=false)=>({id:'codex:'+id,provider:'codex',threadId:id,name,groupId,pinned,projectId:null,taskId:null,updatedAt:1});
const f=window.fixture={calls:[],events:[],errors:[],settings:{distribution:'Ubuntu',workerRoot:'synthetic',workerPort:8767,codexPath:'codex',cwd:'/synthetic',skillRoots:[],theme,language:'zh-CN',agentProvider:'codex',...(large?{fontSize:24,minimumFontSize:18}:{})},groups:[{id:'research',name:long?'模拟项目名称很长'.repeat(15):'模拟研究'},{id:'analysis',name:'结果分析'}],conversations:[conversation('pinned','置顶记录',null,true),conversation('project','项目内的会话','research'),conversation('second','第二个项目会话','research'),conversation('loose',long?'很长的无项目会话名称'.repeat(20):'无项目会话'),conversation('other','另一个无项目会话')]};
if(many){for(let i=0;i<32;i++)f.groups.push({id:'group-'+i,name:'额外项目 '+i+' 长项目名称'});for(let i=0;i<24;i++)f.conversations.push(conversation('loose-'+i,'滚动会话 '+i));}
const changed=(id,patch)=>{const c=f.conversations.find(c=>c.id===id);if(!c)throw Error('Unknown synthetic conversation '+id);Object.assign(c,patch);return structuredClone(c);};
window.studio={onEvent:fn=>{f.events.push(fn);return()=>{f.events=f.events.filter(v=>v!==fn);};},onTerminal:()=>()=>{},invoke:async(method,data)=>{
 f.calls.push({method,data});
 if(method==='state')return {settings:structuredClone(f.settings),threads:[],ssh:[]};
 if(method==='settings'){Object.assign(f.settings,data);return structuredClone(f.settings);}
 if(method==='conversation.list')return structuredClone(f.conversations);
 if(method==='conversation.groups')return structuredClone(f.groups);
 if(method==='conversation.organize')return changed(data.id,{pinned:data.pinned,groupId:data.groupId});
 if(method==='conversation.rename')return changed(data.id,{name:data.name});
 if(method==='conversation.delete'){f.conversations=f.conversations.filter(c=>c.id!==data.id);return {id:data.id,taskIds:[]};}
 if(method==='conversation.select')return data.new?{fresh:true}:structuredClone(f.conversations.find(c=>c.id===data.id));
 if(['task.list','workflow.list','ssh.existing','skills.catalog'].includes(method))return [];
 if(method==='worker.status'||method==='worker.restore')return {status:'disconnected',checkedAt:1};
 if(method==='compute.resource.status')return {schemaVersion:1,selectionId:null,kind:null,status:'none',operator:'unknown',processStatus:'unknown',alive:null,agentReady:false,reason:null,authentication:'not_observed',managedRuns:false};
 if(method==='diagnostics.performance'||method==='agent.disconnect')return {};
 if(method==='agent.account')return {account:null,requiresOpenaiAuth:true,modelAccess:'not_run'};
 if(method==='agent.connect')return {tools:{status:'ready',count:0}};
 if(method==='agent.tools')return {status:'ready',count:0};
 if(method==='agent.rpc'){if(data.method==='model/list')return {data:[]};if(data.method==='thread/list')return {data:[]};if(['thread/read','thread/resume'].includes(data.method))return {thread:{id:data.params.threadId,turns:[]}};throw Error('Synthetic renderer cannot start model turns: '+data.method);}
 if(method==='scientific.skills')return {schema_version:1,functions:[],sharing:{},source_scope:'Synthetic renderer only'};
 const error='Unexpected synthetic IPC '+method;f.errors.push(error);throw Error(error);
}};
window.addEventListener('error',e=>f.errors.push(e.message));
window.testRoot=createRoot(document.getElementById('root'));window.testRoot.render(React.createElement(App));
</script></body></html>`);
const server=await createServer({configFile:false,root:process.cwd(),cacheDir:path.join(out,'vite-cache'),optimizeDeps:{entries:[harness],include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','lucide-react']},server:{host:'127.0.0.1',port:0,strictPort:false,watch:{ignored:['**/.studio/**','**/.config/**','**/validation/**','**/release/**']}}});
await server.listen();
const base='http://127.0.0.1:'+server.httpServer.address().port;
const url=base+'/'+path.relative(process.cwd(),harness).split(path.sep).map(encodeURIComponent).join('/');
if(process.env.STUDIO_SIDEBAR_NATIVE==='1'){
 await fs.writeFile(path.join(out,'native-url.txt'),url);
 console.log('Isolated sidebar preview: '+url);
 await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
 await server.close();
}else{
 const {chromium,_electron}=await import('playwright');
 let browser;
 const checks=[];
 const applications=new Set(),pageApplications=new WeakMap();
 const nativeMain=path.join(out,'electron-main.cjs');
 if(electron)await fs.writeFile(nativeMain,`const {app,BrowserWindow}=require('electron');
app.setPath('userData',process.env.STUDIO_SIDEBAR_PROFILE);
app.whenReady().then(()=>{const window=new BrowserWindow({width:Number(process.env.STUDIO_SIDEBAR_WIDTH),height:Number(process.env.STUDIO_SIDEBAR_HEIGHT),useContentSize:true,title:'Studio sidebar regression - isolated synthetic data',autoHideMenuBar:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});window.setMenu(null);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));window.loadURL('about:blank');});
app.on('window-all-closed',()=>app.quit());`);
 const menu=p=>p.locator('.conversation-popover');
 const trigger=(p,name)=>p.getByRole('button',{name:'会话菜单 · '+name,exact:true});
 const row=(p,name)=>p.locator('.conversation-row').filter({has:p.locator('.conversation-item').filter({hasText:name})});
 async function noOperations(p){assert.equal(await p.evaluate(()=>window.fixture.calls.filter(c=>c.method==='worker.request'||c.method==='worker.connect'||c.method==='task.execute'||c.method==='agent.rpc'&&c.data.method==='turn/start').length),0);assert.deepEqual(await p.evaluate(()=>window.fixture.errors),[]);}
 async function check(name,fn,{query='',viewport={width:1280,height:840}}={}){
  if(process.env.STUDIO_SIDEBAR_FILTER&&!new RegExp(process.env.STUDIO_SIDEBAR_FILTER).test(name))return;
  let context,p;
  try{context=await browser.newContext({viewport});p=await context.newPage();p.setDefaultTimeout(6000);await p.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());await p.goto(url+query);await trigger(p,'项目内的会话').waitFor();await p.waitForFunction(()=>document.documentElement.dataset.theme===window.fixture.settings.theme);await fn(p);await noOperations(p);
   let isolation;
   if(electron){isolation=await context.application.evaluate(({BrowserWindow})=>{const preferences=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {sandbox:preferences.sandbox,contextIsolation:preferences.contextIsolation,nodeIntegration:preferences.nodeIntegration,preload:preferences.preload||null};});assert.deepEqual(isolation,{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:null});assert.deepEqual(await p.evaluate(()=>({require:typeof window.require,process:typeof window.process})),{require:'undefined',process:'undefined'});}
   checks.push({name,status:'passed',...(isolation?{isolation}:{})});}
  catch(error){checks.push({name,status:'failed',error:String(error.stack||error)});if(p&&!p.isClosed())await p.screenshot({path:path.join(out,name+'-failed.png'),fullPage:true}).catch(()=>{});}
  finally{await context?.close();}
 }
 async function open(p,name='项目内的会话'){await trigger(p,name).click();await menu(p).waitFor();}
 async function bounded(p){const box=await menu(p).boundingBox(),size=await p.evaluate(()=>({width:innerWidth,height:innerHeight}));assert(box.x>=7&&box.y>=7,JSON.stringify(box));assert(box.x+box.width<=size.width-7&&box.y+box.height<=size.height-7,JSON.stringify({box,size}));}
 async function resize(p,size){if(electron){await pageApplications.get(p).evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(size.width,size.height),size);await p.waitForFunction(size=>innerWidth===size.width&&innerHeight===size.height,size);}else await p.setViewportSize(size);}
 try{
  browser=electron?{newContext:async({viewport})=>{
   const profile=await fs.mkdtemp(path.join(out,'profile-'));
   const application=await _electron.launch({args:[nativeMain],env:{...process.env,STUDIO_SIDEBAR_PROFILE:profile,STUDIO_SIDEBAR_WIDTH:String(viewport.width),STUDIO_SIDEBAR_HEIGHT:String(viewport.height)},timeout:20000});
   applications.add(application);const close=async()=>{try{await application.close();}finally{applications.delete(application);}};
   try{const p=await application.firstWindow();pageApplications.set(p,application);return {newPage:async()=>p,application,close};}catch(error){await close();throw error;}
  },close:async()=>{await Promise.allSettled([...applications].map(application=>application.close()));applications.clear();}}:await chromium.launch({channel:process.env.STUDIO_BROWSER_CHANNEL||'msedge',headless:true});
  await check('hierarchy-no-bullets',async p=>{
   assert.equal(await p.locator('.conversation-dot').count(),0);assert.equal(await p.locator('details.conversation-menu').count(),0);
   const left=await p.evaluate(()=>{const title=name=>{const button=[...document.querySelectorAll('.conversation-item')].find(e=>e.textContent===name);return button.querySelector('span').getBoundingClientRect().left;};return {project:title('项目内的会话'),unassigned:title('无项目会话'),pinned:title('置顶记录')};});
   assert(left.project>=left.unassigned+12,JSON.stringify(left));assert(Math.abs(left.unassigned-left.pinned)<2,JSON.stringify(left));await p.screenshot({path:path.join(out,'sidebar-dark.png')});
  });
  await check('floating-menu-keeps-rows-stable',async p=>{
   const before=await row(p,'第二个项目会话').boundingBox();await open(p);assert.deepEqual(await row(p,'第二个项目会话').boundingBox(),before);assert.equal(await menu(p).evaluate(e=>e.parentElement===document.body),true);await bounded(p);
   assert.equal(await menu(p).getByRole('menuitem').count(),4);const widths=await menu(p).getByRole('menuitem').evaluateAll(items=>items.map(e=>({whiteSpace:getComputedStyle(e).whiteSpace,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));assert(widths.every(e=>e.height>=30&&e.width>=150),JSON.stringify(widths));await p.screenshot({path:path.join(out,'popover-dark.png')});
  });
  await check('light-theme-popover',async p=>{await open(p);await bounded(p);const colors=await menu(p).evaluate(e=>({background:getComputedStyle(e).backgroundColor,text:getComputedStyle(e).color}));assert.notEqual(colors.background,colors.text);await p.screenshot({path:path.join(out,'popover-light.png')});},{query:'?theme=light'});
  await check('keyboard-navigation-escape-focus',async p=>{
   await trigger(p,'项目内的会话').focus();await p.keyboard.press('ArrowDown');await menu(p).waitFor();await p.waitForFunction(()=>document.activeElement?.getAttribute('role')==='menuitem');const first=await p.evaluate(()=>document.activeElement.getAttribute('aria-label')||document.activeElement.textContent);await p.keyboard.press('ArrowDown');assert.notEqual(await p.evaluate(()=>document.activeElement.getAttribute('aria-label')||document.activeElement.textContent),first);await p.keyboard.press('Home');assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('aria-label')||document.activeElement.textContent),first);await p.keyboard.press('End');assert.match(await p.evaluate(()=>document.activeElement.textContent),/删除/);await p.keyboard.press('Escape');assert.equal(await menu(p).count(),0);assert.equal(await trigger(p,'项目内的会话').evaluate(e=>e===document.activeElement),true);
  });
  await check('outside-click-single-open-menu',async p=>{
   await open(p);await trigger(p,'置顶记录').click();assert.equal(await menu(p).count(),1);assert.equal(await trigger(p,'项目内的会话').getAttribute('aria-expanded'),'false');assert.equal(await trigger(p,'置顶记录').getAttribute('aria-expanded'),'true');await p.getByLabel('搜索会话',{exact:true}).click();assert.equal(await menu(p).count(),0);assert.equal(await p.evaluate(()=>window.fixture.calls.filter(c=>c.method==='conversation.select').length),0);
  });
  await check('rename-action-saves-existing-conversation',async p=>{
   await open(p);await p.getByRole('menuitem',{name:'重命名会话 · 项目内的会话',exact:true}).click();assert.equal(await menu(p).count(),0);const dialog=p.getByRole('dialog',{name:'重命名会话',exact:true});await dialog.waitFor();await p.getByTestId('conversation-name').fill('重新命名');await dialog.getByRole('button',{name:'保存名称',exact:true}).click();await trigger(p,'重新命名').waitFor();assert.deepEqual(await p.evaluate(()=>window.fixture.calls.filter(c=>c.method==='conversation.rename').map(c=>c.data)),[{id:'codex:project',name:'重新命名'}]);
  });
  await check('pin-and-unpin-preserve-project',async p=>{
   await open(p);await p.getByRole('menuitem',{name:'置顶',exact:true}).click();await p.waitForFunction(()=>window.fixture.conversations.find(c=>c.id==='codex:project').pinned);assert.equal(await p.locator('.conversation-project').filter({hasText:'模拟研究'}).locator('.conversation-item').filter({hasText:'项目内的会话'}).count(),0);await open(p);await p.getByRole('menuitem',{name:'取消置顶',exact:true}).click();await p.waitForFunction(()=>!window.fixture.conversations.find(c=>c.id==='codex:project').pinned);assert.equal(await p.evaluate(()=>window.fixture.conversations.find(c=>c.id==='codex:project').groupId),'research');
  });
  await check('move-project-back-and-choose',async p=>{
   await open(p);await p.getByRole('menuitem',{name:'移动会话到项目 · 项目内的会话',exact:true}).click();const current=p.getByRole('menuitemradio',{name:'模拟研究',exact:true});await current.waitFor();assert.equal(await current.getAttribute('aria-checked'),'true');await p.keyboard.press('ArrowLeft');await p.getByRole('menuitem',{name:'重命名会话 · 项目内的会话',exact:true}).waitFor();await p.getByRole('menuitem',{name:'移动会话到项目 · 项目内的会话',exact:true}).click();await p.getByRole('menuitemradio',{name:'结果分析',exact:true}).click();await p.waitForFunction(()=>window.fixture.conversations.find(c=>c.id==='codex:project').groupId==='analysis');assert.equal(await menu(p).count(),0);assert.equal(await p.locator('.conversation-project').filter({hasText:'结果分析'}).locator('.conversation-item').filter({hasText:'项目内的会话'}).count(),1);
  });
  await check('delete-keeps-confirmation-and-cancel',async p=>{
   await open(p);await p.getByRole('menuitem',{name:'删除对话 · 项目内的会话',exact:true}).click();let dialog=p.getByRole('dialog',{name:'删除对话',exact:true});await dialog.waitFor();assert.equal(await p.evaluate(()=>window.fixture.calls.filter(c=>c.method==='conversation.delete').length),0);await dialog.getByRole('button',{name:'取消',exact:true}).click();await open(p);await p.getByRole('menuitem',{name:'删除对话 · 项目内的会话',exact:true}).click();dialog=p.getByRole('dialog',{name:'删除对话',exact:true});await dialog.getByRole('button',{name:'确认删除',exact:true}).click();await p.waitForFunction(()=>!window.fixture.conversations.some(c=>c.id==='codex:project'));assert.equal(await p.evaluate(()=>window.fixture.calls.filter(c=>c.method==='conversation.delete').length),1);assert.equal(await trigger(p,'项目内的会话').count(),0);
  });
  await check('large-font-narrow-bottom-menu-contained',async p=>{
   const target=trigger(p,'滚动会话 23');await target.scrollIntoViewIfNeeded();await target.click();await menu(p).waitFor();await bounded(p);const overflow=await menu(p).evaluate(e=>e.scrollWidth>e.clientWidth+1);assert.equal(overflow,false);await p.screenshot({path:path.join(out,'popover-large-narrow.png')});
  },{query:'?large&many&theme=light&sidebar=210',viewport:{width:760,height:620}});
  await check('long-titles-project-list-scroll',async p=>{
   const title='很长的无项目会话名称'.repeat(20);await trigger(p,title).scrollIntoViewIfNeeded();await open(p,title);await p.getByRole('menuitem',{name:'移动会话到项目 · '+title,exact:true}).click();await bounded(p);const last=p.getByRole('menuitemradio',{name:'额外项目 31 长项目名称',exact:true});await last.scrollIntoViewIfNeeded();await last.click();await p.waitForFunction(()=>window.fixture.conversations.find(c=>c.id==='codex:loose').groupId==='group-31');assert.equal(await menu(p).count(),0);assert.equal(await p.locator('[data-testid="conversation-sidebar"]').evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
  },{query:'?many&long&sidebar=210',viewport:{width:900,height:680}});
  await check('scroll-and-resize-dismiss',async p=>{
   await open(p);await p.getByTestId('conversation-sidebar').evaluate(e=>e.dispatchEvent(new Event('scroll')));await p.waitForFunction(()=>!document.querySelector('.conversation-popover'));await open(p);await resize(p,{width:1100,height:700});await p.waitForFunction(()=>!document.querySelector('.conversation-popover'));
  });
 }finally{const report={scope:electron?'Actual isolated Electron renderer driven by Playwright mouse/keyboard input with synthetic IPC; no physical Windows capture, packaged application, backend, SSH, model or scientific validation.':'Current App browser renderer with synthetic IPC; no native/SSH/model/scientific validation.',checks};await fs.writeFile(path.join(out,'results-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));if(browser)await browser.close();await server.close();}
 console.log(JSON.stringify(checks,null,2));if(checks.some(c=>c.status==='failed'))process.exitCode=1;
}
