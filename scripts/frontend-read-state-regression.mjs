// Current React components with synthetic IPC only. No native or scientific acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'vite';
const {chromium}=await import(pathToFileURL(process.env.STUDIO_PLAYWRIGHT_MODULE||path.resolve(path.dirname(process.execPath),'../node_modules/playwright/index.mjs')).href);
const out=path.resolve('validation/local/frontend-read-state-regression');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'harness.html'),`<html><body><div id="root"></div><script type="module">
import React,{useState,useLayoutEffect}from'react';import{createRoot}from'react-dom/client';
import{useLocalReviewStatus,currentLocalReview}from'/src/useLocalReviewStatus.ts';
import Deployment from'/src/DeploymentPanel.tsx';import Task from'/src/AgentTaskPage.tsx';
import Workspace from'/src/WorkspacePanel.tsx';import Divider from'/src/PaneDivider.tsx';
const root=createRoot(document.getElementById('root'));
function Hook({task,worker,nonce}){const read=useLocalReviewStatus(task,worker,nonce),ready=currentLocalReview(task,read);useLayoutEffect(()=>{window.fixture.trace.push({updatedAt:task.updatedAt,ready});});return React.createElement('pre',{'data-testid':'hook'},JSON.stringify({read,ready}));}
window.mount=mode=>{function Host(){const[p,setP]=useState({task:window.fixture.task,worker:true,busy:false,nonce:0}),[width,setWidth]=useState(565);window.fixture.update=delta=>setP(v=>({...v,...delta,task:delta.task?{...v.task,...delta.task}:v.task}));const noop=()=>{};if(mode==='hook')return React.createElement(Hook,p);if(mode==='divider'||mode==='reverse')return React.createElement(React.Fragment,null,React.createElement(Divider,{label:'Synthetic pane',value:width,min:260,max:1000,reverse:mode==='reverse',onChange:v=>{window.fixture.widths.push(v);setWidth(v);}}),React.createElement('output',{'data-testid':'width'},width));if(mode==='workspace')return React.createElement(Workspace,{...p,onRefresh:noop,onError:e=>window.fixture.errors.push(String(e))});return React.createElement(mode==='deployment'?Deployment:Task,{...p,projects:[window.fixture.project],environments:[window.fixture.environment],theme:'dark',onTask:noop,onRun:noop,onError:e=>window.fixture.errors.push(String(e)),onRefresh:noop,onReview:noop,onCluster:noop,onSetup:noop,onAgent:noop,onReplace:noop,onDeploy:noop});}root.render(React.createElement(Host));};window.unmount=()=>root.render(React.createElement('div',null,'unmounted'));
</script></body></html>`);
const server=await createServer({cacheDir:path.join(out,'vite-cache'),server:{host:'127.0.0.1',port:0,strictPort:false,watch:{ignored:['**/validation/**','**/release/**','**/.studio/**']}}});await server.listen();
const base='http://127.0.0.1:'+server.httpServer.address().port,checks=[];let browser;
async function check(name,mode,fn,{english=false,prepared=false}={}){
 const context=await browser.newContext(),page=await context.newPage();
 try{
  page.setDefaultTimeout(3000);await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  await page.addInitScript(({english,prepared,mode})=>{
   localStorage.setItem('studio.language',english?'en':'zh-CN');
   const f=window.fixture={calls:[],pending:[],errors:[],trace:[],widths:[]};
   f.environment={id:'env',name:'Synthetic environment',executables:{python:'/synthetic/python'},repositories:{},variables:{}};
   f.project={id:'project',name:'Synthetic project',policy:{engines:['pygas.build','pydyn.md'],environments:['env'],gpus:[0],max_seconds:300,max_concurrent:1,input_roots:['/synthetic/inputs'],clusters:[]}};
   f.task={id:'task',provider:'codex',threadId:'thread',name:'Synthetic workflow',workflowVersion:2,parameterRevision:7,updatedAt:1,workspaceChoice:mode==='workspace'?'pending':'draft',projectId:'project',authoring:{projectId:'project',environmentId:'env',inputRoot:'/synthetic/inputs'},parameters:{engine:'pygas.build',files:['/synthetic/inputs/build_bias.py']},steps:[],missingFields:[],artifacts:[],review:{status:'not_run'},deployment:{revision:1,config:{target:'local',projectId:'project',targetId:'env',inputSource:'local',directoryName:'synthetic',gpu:0,maxSeconds:300,resources:{cpus:1,gpus:1,memory_mb:4096,queue:'',account:''}}}};
   f.run={id:'run',engine:'pygas.build',project_id:'project',environment_id:'env',status:'draft',validation:{status:'not_run'},snapshots:[],inputs:{}};
   if(prepared)f.task.deployment.prepared={artifactId:'run',parameterRevision:7,deploymentRevision:1,reviewAuthority:{kind:'local-human',id:'receipt',sha256:'a'.repeat(64)}};
   window.studio={onEvent:()=>()=>{},invoke:(method,data)=>{
    f.calls.push({method,data});
    if(['task.localReview.status','workspace.list'].includes(method))return new Promise((resolve,reject)=>f.pending.push({method,resolve,reject}));
    if(method==='task.deployment.context')return Promise.resolve({taskId:data.taskId,projects:[f.project],environments:[f.environment],clusters:[]});
    if(method==='task.consumerTarget.status')return Promise.resolve({status:'not_run'});
    if(method==='worker.request'&&data.method==='POST'&&data.target==='/api/run/status')return Promise.resolve(f.run);
    if(method==='task.linkRun')return Promise.resolve(f.task); // Existing mount observation metadata only.
    throw Error('Unexpected mutation or read: '+method);
   }};
  },{english,prepared,mode});
  await page.goto(base+'/validation/local/frontend-read-state-regression/harness.html',{timeout:20000});await page.waitForFunction(()=>window.mount);await page.evaluate(mode=>window.mount(mode),mode);
  if(['hook','deployment','task','workspace'].includes(mode))await page.waitForFunction(()=>window.fixture.pending.length>0);
  await fn(page);
  const calls=await page.evaluate(()=>window.fixture.calls);
  assert(calls.every(c=>['task.localReview.status','workspace.list','task.deployment.context','task.consumerTarget.status','worker.request','task.linkRun'].includes(c.method)));
  checks.push({name,status:'passed',calls:calls.map(c=>c.method)});
 }catch(error){checks.push({name,status:'failed',error:String(error.stack||error)});}
 finally{await context.close();}
}
const current={taskId:'task',provider:'codex',threadId:'thread',parameterRevision:7,status:'current',scope:'local',authority:{kind:'local-human',id:'receipt',sha256:'a'.repeat(64)}};
async function count(page,method='task.localReview.status'){return page.evaluate(method=>window.fixture.pending.filter(p=>p.method===method).length,method);}
async function settle(page,value=current,method='task.localReview.status',index=-1){await page.waitForFunction(m=>window.fixture.pending.some(p=>p.method===m),method);await page.evaluate(({value,method,index})=>{const p=window.fixture.pending.filter(p=>p.method===method);p[index<0?p.length-1:index].resolve(value);},{value,method,index});}
async function update(page,task){const n=await count(page);await page.evaluate(task=>window.fixture.update({task}),task);await page.waitForFunction(n=>window.fixture.pending.filter(p=>p.method==='task.localReview.status').length===n+1,n);}
async function ready(page){await settle(page);await page.waitForFunction(()=>{const hook=document.querySelector('[data-testid=hook]');return hook?JSON.parse(hook.textContent).ready:!document.querySelector('[data-testid=local-review-status]');});}
try{
 browser=await chromium.launch({channel:process.env.STUDIO_BROWSER_CHANNEL||'msedge',headless:true});
 for(const delay of [0,25,250])await check('Hook synchronously drops prior authority at updatedAt; '+delay+'ms','hook',async page=>{
  await ready(page);await update(page,{updatedAt:2});await page.waitForTimeout(delay);const trace=await page.evaluate(()=>window.fixture.trace);assert.equal(trace.find(x=>x.updatedAt===2).ready,false);await ready(page);
 });
 for(const mode of ['deployment','task']){
  await check(mode+' current error visible once, never an unknown write',mode,async page=>{
   await page.waitForFunction(()=>window.fixture.pending.length>0);await page.evaluate(()=>window.fixture.pending.find(p=>p.method==='task.localReview.status').reject(Error('Synthetic owner or transport failure')));
   const notice=page.getByTestId('local-review-status');await notice.filter({hasText:'Synthetic owner or transport failure'}).waitFor();assert.equal(await notice.getAttribute('role'),'alert');assert.equal((await page.locator('body').innerText()).split('无法核对当前人工输入复核状态').length-1,1);
   if(mode==='deployment')assert(await page.getByTestId('prepare-deployment').isDisabled());
   const n=await count(page);await page.waitForTimeout(100);assert.equal(await count(page),n);
  });
  await check(mode+' unknown original run points to reconciliation',mode,async page=>{
   await ready(page);await update(page,{updatedAt:2,execution:{artifactId:'run',phase:'unknown'}});await settle(page,{...current,status:'stale',authority:null});const notice=page.getByTestId('local-review-status');await notice.filter({hasText:'请核对原作业状态'}).waitFor();assert.equal(await notice.getAttribute('role'),'status');assert(!(await notice.innerText()).includes('请先完成'));
  });
  await check(mode+' old owner failure is ignored',mode,async page=>{
   await update(page,{updatedAt:2});await page.evaluate(()=>window.fixture.pending.find(p=>p.method==='task.localReview.status').reject(Error('OLD FAILURE')));await ready(page);assert(!(await page.locator('body').innerText()).includes('OLD FAILURE'));
  });
 }
 await check('Deployment Execute current→pending disabled→fresh current without invoking Execute','deployment',async page=>{
  await ready(page);await page.getByTestId('review-input-snapshots').check();await page.waitForFunction(()=>!document.querySelector('[data-testid=execute-deployment]').disabled);await update(page,{updatedAt:2});await page.getByTestId('local-review-status').waitFor();assert(await page.getByTestId('execute-deployment').isDisabled());await ready(page);assert.equal(await page.getByTestId('execute-deployment').isDisabled(),false);
 },{prepared:true});
 await check('Valid independent AI keeps scientific overview while human status checks','task',async page=>{
  await update(page,{updatedAt:2,review:{status:'ready',parameterRevision:7}});await page.waitForTimeout(25);assert.equal(await page.getByTestId('local-review-status').count(),0);assert(!(await page.getByTestId('workflow-overview').innerText()).includes('正在核对当前人工输入复核状态'));
 });
 await check('English checking appears once and retains role','task',async page=>{
  const notice=page.getByTestId('local-review-status');await notice.waitFor();assert.equal(await notice.getAttribute('role'),'status');assert.equal((await page.locator('body').innerText()).split('Checking the current human input-review status…').length-1,1);
 },{english:true});
 await check('Unmount ignores deferred receipt','hook',async page=>{await page.waitForFunction(()=>window.fixture.pending.length>0);await page.evaluate(()=>window.unmount());await settle(page);await page.waitForTimeout(20);assert.equal(await page.getByTestId('hook').count(),0);});
 await check('Workspace same-mount busy cycle drops old list and freshens once','workspace',async page=>{
  await page.waitForFunction(()=>window.fixture.pending.some(p=>p.method==='workspace.list'));await page.evaluate(()=>window.fixture.update({busy:true}));await page.waitForTimeout(20);await page.evaluate(()=>window.fixture.update({busy:false}));await page.waitForFunction(()=>window.fixture.pending.filter(p=>p.method==='workspace.list').length===2);await settle(page,{status:'ready',taskId:'task',workspaces:[{id:'old',name:'OLD'}]},'workspace.list',0);await settle(page,{status:'ready',taskId:'task',workspaces:[{id:'current',name:'CURRENT'}]},'workspace.list');await page.getByRole('option',{name:'CURRENT',exact:true}).waitFor({state:'attached'});assert.equal(await page.getByRole('option',{name:'OLD',exact:true}).count(),0);
 });
 await check('Workspace persistent superseded is neutral with only explicit refresh','workspace',async page=>{
  await settle(page,{status:'superseded',taskId:'task',reason:'selection_changed'},'workspace.list');await page.getByTestId('workspace-list-state').filter({hasText:'待刷新'}).waitFor();const n=await count(page,'workspace.list');await page.waitForTimeout(100);assert.equal(await count(page,'workspace.list'),n);await page.getByRole('button',{name:'刷新工作区列表',exact:true}).click();await page.waitForFunction(n=>window.fixture.pending.filter(p=>p.method==='workspace.list').length===n+1,n);
 });
 for(const reverse of [false,true])await check('Divider default32, fine1, bounds and exact340; reverse='+reverse,reverse?'reverse':'divider',async page=>{
  const divider=page.getByRole('separator',{name:'Synthetic pane'});await divider.focus();await divider.press('ArrowRight');assert.equal(Number(await page.getByTestId('width').innerText()),reverse?533:597);await divider.press('Home');for(let i=0;i<80;i++)await divider.press(reverse?'Shift+ArrowLeft':'Shift+ArrowRight');assert.equal(Number(await page.getByTestId('width').innerText()),340);await divider.press('Home');await divider.press(reverse?'Shift+ArrowRight':'Shift+ArrowLeft');assert.equal(Number(await page.getByTestId('width').innerText()),260);assert.match(await divider.getAttribute('aria-description'),/Shift\+/);
 });
}finally{
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify({scope:'Current React + synthetic IPC only; no native window, worker connection, target model or science',checks},null,2)+'\n');
 if(browser)await browser.close();await server.close();
}
console.log(JSON.stringify({total:checks.length,passed:checks.filter(c=>c.status==='passed').length,failed:checks.filter(c=>c.status==='failed')}));if(checks.some(c=>c.status==='failed'))process.exitCode=1;
