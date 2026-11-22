import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {_electron} from 'playwright';
import {desktopRoot,requireLaunchContext,resolveDesktopBinary} from './desktop-launch.mjs';
requireLaunchContext();
const {values}=parseArgs({options:{attachments:{type:'boolean'},'packaged-exe':{type:'string'},'expected-version':{type:'string'},'startup-only':{type:'boolean'}}});
const packaged=!!values['packaged-exe'],startupOnly=!!values['startup-only'];
const expectedVersion=values['expected-version']??(!packaged?JSON.parse(await fs.readFile(path.join(desktopRoot,'package.json'),'utf8')).version:null);
assert.match(expectedVersion??'',/^\d+\.\d+\.\d+(?:-[\w.]+)?$/,'Choose the expected packaged application version');
const attachments=packaged||!!values.attachments;
const executablePath=packaged?await fs.realpath(values['packaged-exe']):await resolveDesktopBinary();
const packagedRoot=packaged?path.dirname(executablePath):null;
const archive=packaged?path.join(packagedRoot,'resources','app.asar'):null;
if(packaged)assert.equal(path.basename(executablePath).toLowerCase(),'aimatterlab.exe','Use the extracted release executable');
const output=path.join(desktopRoot,'validation','local',...(packaged?['release-'+expectedVersion.replaceAll('.','')]:[]));
await fs.mkdir(output,{recursive:true});
const dir=await fs.mkdtemp(path.join(output,packaged?'chat-package-':'chat-turn-desktop-'));
const profile=path.join(dir,'profile'),chromium=path.join(dir,'chromium'),home=path.join(dir,'home'),temporary=path.join(dir,'tmp');
const appData=path.join(home,'AppData','Roaming'),localData=path.join(home,'AppData','Local');
// Windows shell folder resolution can run before the packaged app creates its window.
const folders=[profile,appData,chromium,localData,temporary,...['Documents','Downloads','Desktop'].map(name=>path.join(home,name))];
await Promise.all(folders.map(directory=>fs.mkdir(directory,{recursive:true})));
const wrapper=path.join(dir,'fixture-entry.mjs');
if(!packaged){
 // Source checks keep the test window hidden. Package checks launch the supplied exe directly.
 const nativeMain=pathToFileURL(path.join(desktopRoot,'desktop','main.mjs')).href;
 await fs.writeFile(wrapper,`import {app} from 'electron';
app.setPath('userData',${JSON.stringify(profile)});app.setPath('appData',${JSON.stringify(appData)});app.setPath('sessionData',${JSON.stringify(chromium)});
app.on('browser-window-created',(_e,win)=>{win.show=()=>{};});
await import(${JSON.stringify(nativeMain)});`);
}
function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}
async function fileSha256(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
function samePath(actual,expected){assert.equal(typeof actual,'string','Expected the runtime path for '+expected);assert.equal(path.relative(expected,actual),'');}
const requests=[],held=new Map();
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
 const {messages,model}=JSON.parse(raw);
 const n=requests.push(messages);
 res.writeHead(200,{'content-type':'text/event-stream'});
 const write=(delta,reason)=>res.write('data: '+JSON.stringify({id:'response-'+n,object:'chat.completion.chunk',created:n,model,choices:[{index:0,delta,finish_reason:reason}],...(reason?{usage:{prompt_tokens:17,completion_tokens:8,total_tokens:25}}:{})})+'\n\n');
 write({role:'assistant',content:'Visible fixture output '+n},null);
 const finish=()=>{write({},'stop');res.end('data: [DONE]\n\n');};
 if(n===1||n===3)held.set(n,finish);else finish();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,target=origin+'/v1';
const envKeys=new Set(['systemroot','windir','systemdrive','comspec','pathext','os','number_of_processors','processor_architecture','programfiles','programfiles(x86)','programw6432']);
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>envKeys.has(key.toLowerCase())));
const system=env.SystemRoot||env.SYSTEMROOT||process.env.SystemRoot;
Object.assign(env,{
 PATH:system?[path.join(system,'System32'),system].join(path.delimiter):'/usr/bin:/bin',
 HTTP_PROXY:origin,HTTPS_PROXY:origin,NO_PROXY:'127.0.0.1,localhost,::1',
 STUDIO_PROFILE_DIR:profile,APPDATA:appData,LOCALAPPDATA:localData,USERPROFILE:home,HOME:home,CODEX_HOME:path.join(home,'.codex'),TEMP:temporary,TMP:temporary,TMPDIR:temporary,
 XDG_CONFIG_HOME:appData,XDG_CACHE_HOME:localData,XDG_DATA_HOME:localData,
 ...system?{HOMEDRIVE:path.parse(home).root.slice(0,-1),HOMEPATH:home.slice(path.parse(home).root.length-1)}:{},
});
let app,page,phase='launch',runtime,artifacts,originalFigure,wireFigure;
const rendererErrors=[];
async function launch(){
 app=await _electron.launch({executablePath,cwd:packagedRoot??desktopRoot,args:packaged?[]:[wrapper],env,timeout:30000});
 page=await app.firstWindow({timeout:25000});page.setDefaultTimeout(12000);
 page.on('pageerror',error=>rendererErrors.push(error.message));
 await page.locator('.composer textarea').waitFor();
 const observed=await app.evaluate(({app,BrowserWindow})=>{
  const web=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
  const archive=app.getAppPath(),fs=process.getBuiltinModule('node:fs'),path=process.getBuiltinModule('node:path'),os=process.getBuiltinModule('node:os');
  return {version:app.getVersion(),installed:app.isPackaged,binary:process.execPath,archive,resources:process.resourcesPath,
   profile:app.getPath('userData'),session:app.getPath('sessionData'),fixtureHome:os.homedir(),codexHome:process.env.CODEX_HOME,pid:process.pid,
   packagedPreloadPresent:app.isPackaged?fs.existsSync(path.join(archive,'desktop','preload.cjs')):undefined,
   sandbox:web.sandbox,contextIsolation:web.contextIsolation,nodeIntegration:web.nodeIntegration};
 });
 assert.equal(observed.installed,packaged);
 samePath(observed.binary,executablePath);samePath(observed.profile,profile);
 if(packaged){
  assert.equal(observed.version,expectedVersion);
  samePath(observed.archive,archive);samePath(observed.resources,path.dirname(archive));samePath(observed.fixtureHome,home);
  samePath(observed.codexHome,path.join(home,'.codex'));
  assert.equal(observed.packagedPreloadPresent,true);
  assert([profile,chromium].some(root=>path.relative(root,observed.session)===''),'Chromium must start with a disposable session directory');
  samePath(fileURLToPath(page.url()),path.join(archive,'dist','index.html'));
 }
 assert.equal(await page.locator('.version').innerText(),expectedVersion);
 assert.deepEqual([observed.sandbox,observed.contextIsolation,observed.nodeIntegration],[true,true,false]);
 assert.equal(await page.evaluate(()=>typeof window.require==='undefined'&&typeof window.process==='undefined'&&typeof window.studio?.invoke==='function'),true);
 return observed;
}
async function assertPackagedHarness(){
 const modelRoot=path.join(profile,'agents','model-providers','turn-check');
 const processes=await fs.readdir(path.join(modelRoot,'processes'));
 assert(processes.length,'Expected an app-owned DSH process configuration');
 const dshDirectory=path.join(path.dirname(archive),'agent-runtimes','dsh');
 const runtime=JSON.parse(await fs.readFile(path.join(dshDirectory,'runtime.json'),'utf8'));
 const sdk=JSON.parse(await fs.readFile(path.join(dshDirectory,'node_modules','@deepseek-ai','dsh','package.json'),'utf8'));
 assert.equal(sdk.version,runtime.version);
 const adapter=path.join(dshDirectory,'node_modules','@deepseek-ai','dsh-llm-pi-ai','lib','index.js');
 const policy=path.join(path.dirname(archive),'studio-dsh','dsh-policy.mjs');
 for(const id of processes){
  const config=JSON.parse(await fs.readFile(path.join(modelRoot,'processes',id,'profiles','studio','cordis.patch.yml'),'utf8'))[0].insert;
  samePath(config.find(plugin=>plugin.id==='models').name,adapter);
  samePath(config.find(plugin=>plugin.id==='studio-policy').name,policy);
  samePath(config.find(plugin=>plugin.id==='attachments').config.dshHome,modelRoot);
 }
 return {version:runtime.version,adapterSha256:await fileSha256(adapter),policySha256:await fileSha256(policy)};
}
async function checkConversation(){
 phase='startup';
 await page.getByRole('button',{name:/^(?:跳过引导|Skip setup(?: guide)?)$/i}).click();
 assert.deepEqual(await page.evaluate(()=>window.studio.invoke('conversation.list')),[]);
 await page.evaluate(async ({baseUrl,vision})=>{
  window.studio.onEvent(e=>{if(e.method.startsWith('turn/')||e.method==='studio/codexDisconnected'){window.fixtureEvents??=[];window.fixtureEvents.push({method:e.method,turn:e.params?.turn?.id,status:e.params?.turn?.status,thread:e.params?.threadId});}});
  await window.studio.invoke('models.profiles.save',{profile:{id:'turn-check',provider:'compatible',name:'Local turn fixture',baseUrl,api:'openai-completions',models:[{id:'local-turn-fixture',input:vision?['text','image']:['text'],reasoningEfforts:false}],defaultModel:'local-turn-fixture'},apiKey:''});
 },{baseUrl:target,vision:attachments});
 phase='provider selection';await page.getByTestId('agent-options').click();
 await page.getByTestId('agent-provider').selectOption('compatible');
 await page.getByTestId('agent-connect').click();
 const composer=page.locator('.composer textarea');
 await page.getByTestId('agent-connect').waitFor({state:'hidden',timeout:45000});
 if(await page.getByTestId('agent-options').getAttribute('aria-expanded')==='true')await page.getByTestId('agent-options').click();
 if(attachments){
  phase='select files in fresh draft';
  const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=3;canvas.height=2;const ctx=canvas.getContext('2d');ctx.fillStyle='rgb(180,35,70)';ctx.fillRect(0,0,3,2);return canvas.toDataURL('image/png').split(',')[1];});
  const imageBytes=Buffer.from(image,'base64');
  await page.getByTestId('chat-file-picker').setInputFiles([
   {name:'settings.in',mimeType:'text/plain',buffer:Buffer.from('fixture_integrator npt 310 K')},
   {name:'plane.png',mimeType:'image/png',buffer:imageBytes},
  ]);
  await page.locator('.composer').getByRole('button',{name:'settings.in',exact:true}).click();
  assert.equal(await page.getByTestId('chat-file-preview').locator('pre').textContent(),'fixture_integrator npt 310 K');
  await page.keyboard.press('Escape');
  await page.locator('.composer').getByRole('button',{name:'plane.png',exact:true}).click();
  const preview=page.getByTestId('chat-file-preview').locator('img');
  await preview.waitFor();
  assert.equal(await preview.getAttribute('src'),'data:image/png;base64,'+image);
  originalFigure={bytes:imageBytes.length,sha256:sha256(imageBytes)};
  await page.keyboard.press('Escape');
 }
 phase='initial reply';await composer.fill('Fixture first question');await composer.press('Enter');
 await page.getByText('Visible fixture output 1',{exact:true}).waitFor({timeout:22000});
 if(attachments){
  const content=requests[0].filter(message=>message.role==='user').flatMap(message=>message.content);
  assert(JSON.stringify(content).includes('fixture_integrator npt 310 K'));
  const wireImage=content.find(part=>part.type==='image_url')?.image_url?.url;
  assert.match(wireImage||'',/^data:image\/(png|jpeg|webp);base64,/);
  const pixel=await page.evaluate(async url=>{const img=new Image();img.src=url;await img.decode();const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;const ctx=cv.getContext('2d');ctx.drawImage(img,0,0);return [img.width,img.height,...ctx.getImageData(0,0,1,1).data];},wireImage);
  assert.deepEqual(pixel.slice(0,2),[3,2]);assert(pixel[2]>160&&pixel[3]<55&&pixel[4]>50&&pixel[4]<90);
  const bytes=Buffer.from(wireImage.slice(wireImage.indexOf(',')+1),'base64');
  wireFigure={bytes:bytes.length,sha256:sha256(bytes),pixels:pixel};
 }
 phase='steering';await composer.fill('Fixture guidance for this reply');await page.getByTestId('agent-steer').click();
 await page.getByText('Fixture guidance for this reply',{exact:true}).waitFor();
 phase='queue';
 if(attachments){
  await page.locator('.composer').evaluate(element=>{const transfer=new DataTransfer();transfer.items.add(new File(['queued_temperature,350 K'],'step.csv',{type:'text/csv'}));element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));});
  await page.locator('.composer').getByRole('button',{name:'step.csv',exact:true}).waitFor();
 }
 await composer.fill('Fixture after this turn');await page.getByTestId('agent-queue').click();await page.getByTestId('agent-queued-message').waitFor();
 assert.equal(requests.length,1);
 let sourceChat;
 if(attachments){
  phase='dispatch A while editing B';
  [sourceChat]=await page.evaluate(()=>window.studio.invoke('conversation.list'));
  await page.getByTestId('new-conversation').click();
  await page.waitForFunction(()=>!document.querySelector('.conversation-item.selected-conversation'));
  await composer.fill('B has an unsent draft');
 }
 held.get(1)();
 if(attachments){
  const deadline=Date.now()+20000;
  while(requests.length<3&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(requests.length,3,'A must drain while B is selected');
  assert.equal(await composer.inputValue(),'B has an unsent draft');
  assert(JSON.stringify(requests[2]).includes('queued_temperature,350 K'));
  const sidebarConversation=page.locator('.conversation-sidebar .conversation-item').filter({hasText:sourceChat.name}).first();
  if(await sidebarConversation.isVisible())await sidebarConversation.click();
  else{
   await page.locator('nav.navigation-rail').getByRole('button',{name:'历史会话',exact:true}).click();
   await page.getByRole('dialog',{name:'历史会话',exact:true}).locator('.conversation-item').filter({hasText:sourceChat.name}).first().click();
  }
 }
 await page.getByText('Visible fixture output 3',{exact:true}).waitFor({timeout:20000});
 assert(JSON.stringify(requests[1]).includes('Fixture guidance for this reply'));
 assert(JSON.stringify(requests[2]).includes('Fixture after this turn'));
 phase='interrupt';await composer.fill('Fixture continue after stop');await page.getByTestId('agent-stop').click();
 await page.waitForFunction(()=>window.fixtureEvents?.some(e=>e.method==='turn/completed'&&['cancelled','interrupted'].includes(e.status)),{},{timeout:12000});
 assert.equal(await composer.inputValue(),'Fixture continue after stop');
 await page.waitForFunction(()=>{const send=document.querySelector('.composer button.send[aria-label="发送"]');return send&&!send.disabled;});
 phase='continue';await composer.press('Enter');await page.getByText('Visible fixture output 4',{exact:true}).waitFor({timeout:15000});
 await page.waitForFunction(()=>window.fixtureEvents?.filter(e=>e.method==='turn/completed').length===3);
 const events=await page.evaluate(()=>window.fixtureEvents);
 assert.deepEqual(events.filter(e=>e.method==='turn/completed').map(e=>e.status),['completed','cancelled','completed']);
 assert.equal(new Set(events.map(e=>e.thread)).size,1);
 assert.equal(requests.length,4);
 const history=await page.evaluate(async threadId=>(await window.studio.invoke('agent.rpc',{provider:'compatible',method:'thread/read',params:{threadId,includeTurns:true}})).thread,events[0].thread);
 assert.deepEqual(history.turns.map(turn=>turn.status),['completed','cancelled','completed']);
 assert(history.turns[1].items.some(item=>item.text==='Visible fixture output 3'));
 const lastWire=JSON.stringify(requests[3]);for(const content of ['Fixture first question','Fixture guidance for this reply','Fixture after this turn','Visible fixture output 3','Fixture continue after stop'])assert(lastWire.includes(content),content);
 if(attachments){
  phase='attachment-only clipboard turn';
  await composer.evaluate(element=>{const transfer=new DataTransfer();transfer.items.add(new File(['last line 221'],'clip.log',{type:'text/plain'}));element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));});
  await page.locator('.composer').getByRole('button',{name:'clip.log',exact:true}).waitFor();
  assert.equal(await composer.inputValue(),'');await composer.press('Enter');
  await page.getByText('Visible fixture output 5',{exact:true}).waitFor();assert(JSON.stringify(requests[4]).includes('last line 221'));
  await page.waitForFunction(()=>window.fixtureEvents.filter(e=>e.method==='turn/completed').length===4);
  phase='reopen attachment history';
  if(packaged){
   await app.close();app=null;
   const reopened=await launch();
   assert.notEqual(reopened.pid,runtime.pid);
   runtime.reopenedPid=reopened.pid;
  }else await page.reload();
  await page.locator('.message.user').getByRole('button',{name:'settings.in',exact:true}).first().click({timeout:18000});
  assert.equal(await page.getByTestId('chat-file-preview').locator('pre').textContent(),'fixture_integrator npt 310 K');
  await page.keyboard.press('Escape');
  await page.locator('.message.user').getByRole('button',{name:'plane.png',exact:true}).first().click();
  const reopenedImage=await page.getByTestId('chat-file-preview').locator('img').getAttribute('src');
  assert.equal(sha256(Buffer.from(reopenedImage.split(',')[1],'base64')),originalFigure.sha256);
  await page.keyboard.press('Escape');
  for(const text of ['Fixture guidance for this reply','Visible fixture output 3','Visible fixture output 5'])await page.getByText(text,{exact:true}).first().waitFor();
  assert.equal(await page.locator('.message-text').filter({hasText:'user-selected attachments v1'}).count(),0);
  assert.equal(requests.length,5,'Restart and history preview must not replay a model call');
  if(packaged)await page.screenshot({path:path.join(dir,'reopened-history.png')});
 }
 return {modelThreads:1,turns:[...history.turns.map(t=>t.status),...attachments?['completed']:[]],keptPartial:true,continuedWithPriorContext:true,
  ...attachments?{queuedInBackground:true,originalAndQueuedTextRead:true,originalFigure,wireFigure,pastedFileOnly:true,reopenedHistoryPreview:true}:{}};
}
const scope=startupOnly?'desktop startup and isolation':'production Electron React/preload/main IPC, official DSH, deterministic loopback OpenAI-compatible endpoint';
try{
 if(packaged){
  phase='package identity';
  const [binarySha256,archiveSha256]=await Promise.all([fileSha256(executablePath),fileSha256(archive)]);
  artifacts={binarySha256,archiveSha256};
 }
 phase='packaged or source launch';
 runtime=await launch();
 const conversation=startupOnly?{}:await checkConversation();
 if(packaged&&!startupOnly){phase='bundled DSH receipts';artifacts.dsh=await assertPackagedHarness();}
 assert.deepEqual(rendererErrors,[]);
 const result={status:'passed',profile:'isolated',scope,runtime,artifacts,httpRequests:requests.length,...conversation};
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(dir,result);
}catch(error){
 console.error('phase',phase,dir,error.message);
 if(page)await page.screenshot({path:path.join(dir,'failed.png'),timeout:5000}).catch(()=>{});
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({status:'failed',scope,phase,runtime,artifacts,httpRequests:requests.length,rendererErrors,error:error.message},null,2));
 process.exitCode=1;
}finally{
 await app?.close().catch(()=>{});
 server.closeAllConnections();await new Promise(r=>server.close(r));
}
