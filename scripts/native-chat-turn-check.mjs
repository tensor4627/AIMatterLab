import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {_electron} from 'playwright';
import {desktopRoot,requireLaunchContext,resolveDesktopBinary} from './desktop-launch.mjs';
requireLaunchContext();
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
 await page.evaluate(async baseUrl=>{
  window.studio.onEvent(e=>{if(e.method.startsWith('turn/')||e.method==='studio/codexDisconnected'){window.fixtureEvents??=[];window.fixtureEvents.push({method:e.method,turn:e.params?.turn?.id,status:e.params?.turn?.status,thread:e.params?.threadId});}});
  await window.studio.invoke('models.profiles.save',{profile:{id:'turn-check',provider:'compatible',name:'Local turn fixture',baseUrl,api:'openai-completions',models:[{id:'local-turn-fixture',reasoningEfforts:false}],defaultModel:'local-turn-fixture'},apiKey:''});
 },target);
 phase='provider selection';await page.getByTestId('agent-options').click();
 await page.getByTestId('agent-provider').selectOption('compatible');
 await page.getByTestId('agent-connect').click();
 const composer=page.locator('.composer textarea');
 await page.getByTestId('agent-connect').waitFor({state:'hidden'});
 if(await page.getByTestId('agent-options').getAttribute('aria-expanded')==='true')await page.getByTestId('agent-options').click();
 phase='initial reply';await composer.fill('Fixture first question');await composer.press('Enter');
 await page.getByText('Visible fixture output 1',{exact:true}).waitFor({timeout:22000});
 phase='steering';await composer.fill('Fixture guidance for this reply');await page.getByTestId('agent-steer').click();
 await page.getByText('Fixture guidance for this reply',{exact:true}).waitFor();
 phase='queue';await composer.fill('Fixture after this turn');await page.getByTestId('agent-queue').click();await page.getByTestId('agent-queued-message').waitFor();
 assert.equal(requests.length,1);
 held.get(1)();
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
 const result={status:'passed',profile:'isolated',scope:'production Electron React/preload/main IPC, official DSH, deterministic loopback OpenAI-compatible endpoint',httpRequests:requests.length,threads:1,turns:history.turns.map(t=>t.status),keptPartial:true,continuedWithPriorContext:true};
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(dir,result);
}catch(error){
 console.error('phase',phase,dir,error.message);
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({status:'failed',phase,httpRequests:requests.length,error:error.message},null,2));
 process.exitCode=1;
}finally{
 await app?.close().catch(()=>{});
 server.closeAllConnections();await new Promise(r=>server.close(r));
}
