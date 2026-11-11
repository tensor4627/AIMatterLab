// Actual React/CSS in headless Edge; all worker/CLI calls below are synthetic IPC.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';

const output=path.resolve('.studio/frontend-feedback-browser');
await fs.mkdir(output,{recursive:true});
await fs.writeFile(path.join(output,'entry.jsx'),`
import React from 'react';import {createRoot} from 'react-dom/client';
import LoadingFeedback from '/frontend/ui/LoadingFeedback.tsx';
import ClusterResults from '/frontend/features/cluster/ClusterResults.tsx';
import CliRuntimeDialog from '/frontend/features/settings/CliRuntimeDialog.tsx';
import '/frontend/app/style.css';
const root=createRoot(document.getElementById('root'));
const fixture=window.fixture={events:new Set(),calls:[],pending:new Map(),closed:0,ready:[],errors:[],timings:[]};
window.studio={onEvent:callback=>{fixture.events.add(callback);return()=>fixture.events.delete(callback)},invoke:async(method,data)=>{
 fixture.calls.push({method,data});if(method==='agent.cli.cancel')return {cancelled:true};
 return new Promise((resolve,reject)=>fixture.pending.set(method==='worker.request'?data.target+':'+(data.data?.name||''):method,{resolve,reject}));
}};
window.mount=kind=>{
 fixture.kind=kind;
 if(kind==='spinner')root.render(<section className="page"><h1>连接反馈检查</h1><LoadingFeedback busy label="正在检查连接与调度器…" phase="等待所选服务器响应"/></section>);
 if(kind==='measured')root.render(<section className="page"><h1>已确认传输进度</h1><LoadingFeedback busy label="正在下载 CLI" phase="已接收 30 / 100 B" startedAt={Date.now()-2500} progress={{completed:30,total:100}}/></section>);
 if(kind==='results')root.render(<section className="page"><ClusterResults run={{id:'synthetic-run',status:'succeeded'}} onError={error=>fixture.errors.push(String(error))}/></section>);
 if(kind==='cli')root.render(<CliRuntimeDialog provider="kimi" readiness={{provider:'kimi',status:'missing',expectedVersion:'fixture-compatible',message:'仅用于界面反馈检查的合成状态'}} onReady={value=>fixture.ready.push(value)} onClose={()=>{fixture.closed++;root.render(null)}}/>);
};
new MutationObserver(()=>{const spinner=document.querySelector('.loading-feedback__spinner');if(fixture.kind!=='spinner'||!spinner||fixture.timings.length)return;fixture.timings.push({phase:'inserted',opacity:getComputedStyle(spinner).opacity});setTimeout(()=>fixture.timings.push({phase:'after-delay',opacity:getComputedStyle(spinner).opacity,transform:getComputedStyle(spinner).transform}),230);setTimeout(()=>fixture.timings.push({phase:'rotated',transform:getComputedStyle(spinner).transform}),450);}).observe(document.getElementById('root'),{childList:true,subtree:true});
window.available=true;
`);
await fs.writeFile(path.join(output,'index.html'),'<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="./entry.jsx"></script></body></html>');
const server=await createServer({configFile:false,root:process.cwd(),plugins:[react()],cacheDir:'.studio/vite-feedback-browser',server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.studio/**','**/release/**','**/validation/**']}},optimizeDeps:{entries:[path.join(output,'index.html')]}});
await server.listen();
let browser;const checks=[],errors=[];
try{
 browser=await chromium.launch({channel:process.env.STUDIO_BROWSER_CHANNEL||'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1100,height:650}});page.on('pageerror',error=>errors.push(String(error)));page.setDefaultTimeout(5000);
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/.studio/frontend-feedback-browser/index.html');await page.waitForFunction(()=>window.available);
 await page.evaluate(()=>window.mount('spinner'));await page.waitForFunction(()=>window.fixture.timings.length===3);
 const timings=await page.evaluate(()=>window.fixture.timings);assert.equal(timings[0].opacity,'0');assert.equal(timings[1].opacity,'1');assert.notEqual(timings[1].transform,timings[2].transform);assert.equal(await page.locator('progress').count(),0);await page.screenshot({path:path.join(output,'01-connection-spinner.png')});checks.push({name:'delayed-spinner-animates',status:'passed',timings});
 await page.evaluate(()=>window.mount('measured'));await page.waitForFunction(()=>document.querySelector('progress')?.value===30);assert.equal(await page.locator('progress').getAttribute('max'),'100');assert(Number((await page.locator('.loading-feedback__elapsed').innerText()).match(/\d+/)?.[0])>=2);await page.screenshot({path:path.join(output,'02-measured-progress.png')});checks.push({name:'confirmed-progress-and-elapsed-time',status:'passed',completed:30,total:100});
 await page.emulateMedia({reducedMotion:'reduce'});assert.doesNotMatch(await page.locator('.loading-feedback__spinner').evaluate(element=>getComputedStyle(element).animationName),/spin/);checks.push({name:'reduced-motion',status:'passed'});await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>window.mount('results'));await page.getByTestId('collect-cluster-results').click();await page.waitForFunction(()=>window.fixture.pending.has('/api/cluster/collect:'));await page.getByText('正在回收并校验结果…',{exact:true}).waitFor();assert.equal(await page.getByTestId('collect-cluster-results').isDisabled(),true);await page.waitForTimeout(200);await page.screenshot({path:path.join(output,'03-results-loading.png')});
 await page.evaluate(()=>window.fixture.pending.get('/api/cluster/collect:').resolve({files:[{id:'a',name:'a.txt',size:3,sha256:'a'.repeat(64)},{id:'b',name:'b.txt',size:3,sha256:'b'.repeat(64)}],manifest:{transfer_status:'passed'}}));await page.getByRole('button',{name:/a.txt/}).click();await page.getByRole('button',{name:/b.txt/}).click();await page.evaluate(()=>window.fixture.pending.get('/api/cluster/result:b.txt').resolve({name:'b.txt',text:'当前所选结果预览'}));await page.getByText('当前所选结果预览',{exact:true}).waitFor();await page.evaluate(()=>window.fixture.pending.get('/api/cluster/result:a.txt').resolve({name:'a.txt',text:'不应显示的旧结果'}));await page.waitForTimeout(50);assert.doesNotMatch(await page.locator('body').innerText(),/不应显示/);checks.push({name:'result-loading-and-stale-preview-suppression',status:'passed'});
 await page.evaluate(()=>{window.fixture.calls=[];window.mount('cli')});await page.getByTestId('cli-runtime-dialog').waitFor();assert.equal(await page.evaluate(()=>window.fixture.calls.length),0);await page.getByTestId('cli-download').click();await page.waitForFunction(()=>window.fixture.calls.some(call=>call.method==='agent.cli.install'));
 await page.evaluate(()=>{const ticket=window.fixture.calls.find(call=>call.method==='agent.cli.install').data;for(const callback of window.fixture.events)callback({method:'studio/cliInstallProgress',params:{...ticket,phase:'downloading',receivedBytes:40,totalBytes:100,packageIndex:1,packageCount:2}})});await page.waitForFunction(()=>document.querySelector('progress')?.value===40);await page.waitForTimeout(200);await page.screenshot({path:path.join(output,'04-cli-download-progress.png')});await page.getByTestId('cli-cancel').click();await page.waitForFunction(()=>window.fixture.closed===1);assert.equal(await page.getByTestId('cli-runtime-dialog').count(),0);await page.evaluate(()=>window.fixture.pending.get('agent.cli.install').resolve({provider:'kimi',status:'ready',expectedVersion:'fixture-compatible',message:'Late synthetic completion'}));await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>window.fixture.ready.length),0);checks.push({name:'explicit-cli-download-measured-progress-and-cancel',status:'passed'});
 assert.deepEqual(await page.evaluate(()=>window.fixture.errors),[]);assert.deepEqual(errors,[]);
}catch(error){checks.push({name:'renderer-run',status:'failed',error:String(error),stack:error.stack});process.exitCode=1;}
finally{await browser?.close();await server.close();await fs.writeFile(path.join(output,'results.json'),JSON.stringify({mode:'headless-msedge',scope:'Actual React renderer and CSS with synthetic IPC only; no real SSH, worker, CLI download or scientific execution.',checks,errors},null,2));}
console.log(JSON.stringify({output,checks},null,2));
