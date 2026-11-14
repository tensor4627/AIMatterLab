// Isolated renderer-only fixtures: no application config, IPC, providers or worker.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium,_electron} from 'playwright';
const out=path.resolve('.studio/chat-markup-validation');await fs.mkdir(out,{recursive:true});
const sample='## 队列事实\n\n| 队列 | **状态** | 数量 | 核心 | GPU | 内存 | 说明 |\n| :--- | :---: | ---: | --- | --- | --- | --- |\n| **学校** | **可用** | `12` | 64 | 8 | 256G | '+ '超长内容'.repeat(40)+' |\n\n<script>window.evil=true</script>\n\n```text\n## literal **bold**\n```';
await fs.writeFile(path.join(out,'index.html'),`<html><body style="margin:0;width:460px"><div id="root"></div><script type="module">
import '/frontend/app/style.css';import React from 'react';import {createRoot} from 'react-dom/client';import ChatMessage from '/frontend/features/conversations/ChatMessage.tsx';
window.root=createRoot(document.getElementById('root'));window.mount=text=>root.render(React.createElement(ChatMessage,{message:{id:'fixture',role:'agent',text},actions:{},language:'zh',disabled:false,canOriginalRun:false,canCluster:false,canCompute:false}));
</script></body></html>`);
await fs.writeFile(path.join(out,'native.cjs'),`const {app,BrowserWindow}=require('electron');app.setPath('userData',process.env.MARKUP_PROFILE);app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:600,height:700,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});w.loadURL('about:blank');});app.on('window-all-closed',()=>app.quit());`);
const server=await createServer({configFile:false,root:process.cwd(),server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.studio/**']}},optimizeDeps:{entries:['.studio/chat-markup-validation/index.html']},esbuild:{jsx:'automatic'}});await server.listen();
const url='http://127.0.0.1:'+server.httpServer.address().port+'/.studio/chat-markup-validation/index.html';
const results=[];
async function check(page,kind){
 const errors=[];page.on('pageerror',error=>errors.push(String(error)));await page.goto(url);await page.waitForFunction(()=>window.mount);
 // Simulate a growing live message, then an unmount/reload of persisted history text.
 await page.evaluate(()=>window.mount('## 队列事实\n\n| 队列 | 状态 |\n| :--'));await page.locator('h2').waitFor();assert.equal(await page.locator('table').count(),0);
 await page.evaluate(text=>window.mount(text),sample);await page.locator('table').waitFor();
 for(const phase of ['live','history']){
 if(phase==='history'){await page.reload();await page.waitForFunction(()=>window.mount);await page.evaluate(text=>window.mount(text),sample);await page.locator('table').waitFor();}
 assert.equal(await page.locator('h2').innerText(),'队列事实');assert.equal(await page.locator('th').count(),7);assert.equal(await page.locator('td strong').first().innerText(),'学校');assert.equal(await page.locator('th strong').innerText(),'状态');assert.equal(await page.locator('td code').innerText(),'12');
 assert.equal(await page.locator('th').nth(1).evaluate(e=>getComputedStyle(e).textAlign),'center');assert.equal(await page.locator('th').nth(2).evaluate(e=>getComputedStyle(e).textAlign),'right');
 assert.equal(await page.locator('pre').innerText(),'## literal **bold**\n');assert.equal(await page.locator('img,script:not([type="module"]),iframe').count(),0);assert.equal(await page.evaluate(()=>window.evil),undefined);
 const scroll=page.getByRole('region',{name:'表格'});assert(await scroll.evaluate(e=>e.scrollWidth>e.clientWidth));await scroll.focus();await scroll.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('.message-table-scroll').scrollLeft>0);
 results.push({kind,phase,status:'passed'});
 }
 assert.deepEqual(errors,[]);await page.screenshot({path:path.join(out,kind+'.png')});
}
let browser,native;
try{browser=await chromium.launch({channel:process.env.STUDIO_BROWSER_CHANNEL||'msedge',headless:true});await check(await browser.newPage(),'chromium');
 if(process.env.STUDIO_MARKUP_ELECTRON_EXE){native=await _electron.launch({executablePath:process.env.STUDIO_MARKUP_ELECTRON_EXE,args:[path.join(out,'native.cjs')],env:{...process.env,MARKUP_PROFILE:path.join(out,'profile')}});await check(await native.firstWindow(),'electron-hidden');}
 else results.push({kind:'electron-hidden',status:'not_run',reason:'Set STUDIO_MARKUP_ELECTRON_EXE to an installed Electron executable'});
}finally{await native?.close();await browser?.close();await server.close();await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));}
console.log(JSON.stringify(results,null,2));
