import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {_electron} from 'playwright';
import {desktopRoot,requireLaunchContext,resolveDesktopBinary} from './desktop-launch.mjs';
requireLaunchContext();
const attachments=process.argv.includes('--attachments');
const output=path.join(desktopRoot,'validation','local');
await fs.mkdir(output,{recursive:true});
const dir=await fs.mkdtemp(path.join(output,'chat-turn-desktop-'));
const profile=path.join(dir,'profile'),appData=path.join(dir,'app-data'),chromium=path.join(dir,'chromium');
await Promise.all([profile,appData,chromium].map(d=>fs.mkdir(d)));
const nativeMain=pathToFileURL(path.join(desktopRoot,'desktop','main.mjs')).href;
// Production main, preload and renderer run unchanged apart from keeping the test window hidden.
const wrapper=path.join(dir,'fixture-entry.mjs');
await fs.writeFile(wrapper,`import {app} from 'electron';
app.setPath('userData',${JSON.stringify(profile)});app.setPath('appData',${JSON.stringify(appData)});app.setPath('sessionData',${JSON.stringify(chromium)});
app.on('browser-window-created',(_e,win)=>{win.show=()=>{};});
await import(${JSON.stringify(nativeMain)});`);
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
const target='http://127.0.0.1:'+server.address().port+'/v1';
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('STUDIO_')&&!['NODE_OPTIONS','ELECTRON_RUN_AS_NODE'].includes(key)));
env.STUDIO_PROFILE_DIR=profile;
let app,page,phase='launch';
try{
 app=await _electron.launch({executablePath:await resolveDesktopBinary(),args:[wrapper],env,timeout:30000});
 page=await app.firstWindow({timeout:25000});page.setDefaultTimeout(12000);
 phase='startup';await page.locator('.composer textarea').waitFor();
 await page.getByRole('button',{name:'跳过引导'}).click();
 await page.evaluate(async ({baseUrl,vision})=>{
  window.studio.onEvent(e=>{if(e.method.startsWith('turn/')||e.method==='studio/codexDisconnected'){window.fixtureEvents??=[];window.fixtureEvents.push({method:e.method,turn:e.params?.turn?.id,status:e.params?.turn?.status,thread:e.params?.threadId});}});
  await window.studio.invoke('models.profiles.save',{profile:{id:'turn-check',provider:'compatible',name:'Local turn fixture',baseUrl,api:'openai-completions',models:[{id:'local-turn-fixture',input:vision?['text','image']:['text'],reasoningEfforts:false}],defaultModel:'local-turn-fixture'},apiKey:''});
 },{baseUrl:target,vision:attachments});
 phase='provider selection';await page.getByTestId('agent-options').click();
 await page.getByTestId('agent-provider').selectOption('compatible');
 await page.getByTestId('agent-connect').click();
 const composer=page.locator('.composer textarea');
 await page.getByTestId('agent-connect').waitFor({state:'hidden'});
 if(await page.getByTestId('agent-options').getAttribute('aria-expanded')==='true')await page.getByTestId('agent-options').click();
 if(attachments){
  phase='select files in fresh draft';
  const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=3;canvas.height=2;const ctx=canvas.getContext('2d');ctx.fillStyle='rgb(180,35,70)';ctx.fillRect(0,0,3,2);return canvas.toDataURL('image/png').split(',')[1];});
  await page.getByTestId('chat-file-picker').setInputFiles([
   {name:'settings.in',mimeType:'text/plain',buffer:Buffer.from('fixture_integrator npt 310 K')},
   {name:'plane.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')},
  ]);
  await page.locator('.composer').getByRole('button',{name:'plane.png',exact:true}).click();
  await page.getByTestId('chat-file-preview').locator('img').waitFor();
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
  await page.locator('.conversation-sidebar .conversation-item').filter({hasText:sourceChat.name}).first().click();
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
  phase='reopen attachment history';await page.reload();
  await page.locator('.message.user').getByRole('button',{name:'settings.in',exact:true}).first().click({timeout:18000});
  assert.equal(await page.getByTestId('chat-file-preview').locator('pre').textContent(),'fixture_integrator npt 310 K');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.message-text').filter({hasText:'user-selected attachments v1'}).count(),0);
 }
 const result={status:'passed',profile:'isolated',scope:'production Electron React/preload/main IPC, official DSH, deterministic loopback OpenAI-compatible endpoint',httpRequests:requests.length,modelThreads:1,turns:[...history.turns.map(t=>t.status),...attachments?['completed']:[]],keptPartial:true,continuedWithPriorContext:true,...attachments?{queuedInBackground:true,originalAndQueuedTextRead:true,decodedImagePixelsVerified:true,pastedFileOnly:true,reopenedHistoryPreview:true}:{}};
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(dir,result);
}catch(error){
 console.error('phase',phase,dir,error.message);
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({status:'failed',phase,httpRequests:requests.length,error:error.message},null,2));
 process.exitCode=1;
}finally{
 await app?.close().catch(()=>{});
 server.closeAllConnections();await new Promise(r=>server.close(r));
}
