// Isolated browser renderer checks. No real worker/provider/SSH or science jobs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'vite';
let playwright;
try{playwright=await import('playwright');}
catch(error){const module=process.env.STUDIO_PLAYWRIGHT_MODULE||path.resolve(path.dirname(process.execPath),'../node_modules/playwright/index.mjs');try{playwright=await import(pathToFileURL(module).href);}catch{throw Error('Playwright is required for renderer checks. Set STUDIO_PLAYWRIGHT_MODULE to its index.mjs path.',{cause:error});}}
const {chromium}=playwright;
const out=path.resolve(process.env.STUDIO_LOG_OUTPUT||'.studio/v0182/round2/agent-b/run-detail-logs-v1/renderer-final1');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'harness.html'),`<html><body><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/style.css';import '/src/task-flow.css';
window.React=React;window.testRoot=createRoot(document.getElementById('root'));
window.renderTest=async(name,props={})=>{const m=await import(/* @vite-ignore */ '/src/'+name+'.tsx');window.testRoot.render(React.createElement(m.default||m[name],props));};
</script></body></html>`);
const server=await createServer({cacheDir:'.studio/vite-regression-cache',server:{port:0,strictPort:false,host:'127.0.0.1',watch:{ignored:['**/.studio/**','**/validation/**','**/release/**']}}});await server.listen();
const base=`http://127.0.0.1:${server.httpServer.address().port}`;
let browser;try{browser=await chromium.launch({channel:process.env.STUDIO_BROWSER_CHANNEL||'msedge',headless:true});}catch(error){await server.close();throw error;}
const results=[];
async function fixture(){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.setDefaultTimeout(5000);await page.addInitScript(()=>{
  const settings={distribution:'Ubuntu',workerRoot:'fixture',workerPort:8767,codexPath:'codex',cwd:'/fixture',skillRoots:[],theme:'dark',language:'zh-CN',agentProvider:'codex'};
  const environment={id:'env',name:'Fixture environment',executables:{python:'/fixture/python'}};
  const project={id:'project',name:'Fixture project',policy:{engines:['pydyn.md'],gpus:[0],max_seconds:3600,max_concurrent:1,input_roots:['/fixture'],environments:['env']}};
  const run={id:'run',name:'Fixture run',engine:'pydyn.md',project_id:'project',environment_id:'env',status:'draft',gpu:0,max_seconds:60,directory:'/fixture/run',validation:{status:'not_run'},created_at:1,updated_at:1,command:[],parameters:{temperature:300},inputs:{'run.py':'/fixture/run.py'}};
  const test=window.__test={settings,environment,project,run,events:[],calls:[],offline:false};
  window.studio={onEvent:fn=>{test.events.push(fn);return()=>{test.events=test.events.filter(x=>x!==fn);};},onTerminal:()=>()=>{},invoke:async(method,data)=>{
   test.calls.push({method,data});
   if(method==='scientific.skills')return {schema_version:1,functions:[{id:'md.pydyn',title:'PyDyn MD',phase:'authoring',engines:['pydyn.md'],tools:[],status:'implemented_adapter_missing_project_skill',sources:['studio'],permission:'allowed',source_status:'registered'},{id:'analysis.wtmetad',title:'WTMetaD',phase:'analysis',engines:['pygas.reweight'],tools:[],status:'implemented',sources:['pygas'],permission:(test.settings.pygasSkillProviders||[]).includes(data.provider)?'allowed':'permission_required',source_status:'registered'}],sharing:{...test.settings.scientificSkillProviders||{},pygas:test.settings.pygasSkillProviders||[]},source_scope:'Only public allowlisted skills'};
    if(method==='skills.catalog')return [{name:'Fixture public skill',path:'/fixture/skills/public/SKILL.md',description:'Synthetic explicitly selected public skill'}];
    if(method==='state')return {settings:test.settings,threads:[],ssh:[]};
   if(method==='conversation.list')return test.conversations||[];if(method==='task.list')return test.task?[test.task]:[];if(['workflow.list','ssh.existing'].includes(method))return [];
   if(method==='conversation.remember'){test.conversation={...(test.conversation||{}),id:data.provider+':'+data.threadId,provider:data.provider,threadId:data.threadId,name:data.name,projectId:data.projectId,taskId:test.task?.id||null};return test.conversation;}
   if(method==='conversation.select')return test.conversations.find(value=>value.id===data.id);
   if(method==='terminal.start')return {id:'terminal'};if(['terminal.resize','terminal.input','terminal.close'].includes(method))return {};
   if(method==='task.edit'&&test.deferEdit)return new Promise(resolve=>test.finishEdit=()=>resolve({...test.task,parameters:{...test.task.parameters,...data.changes}}));
   if(method==='task.create'){if(!test.task||data.newWorkflow)test.task={id:'task-'+test.calls.length,provider:data.provider,threadId:data.threadId,parameters:{},artifacts:[],updatedAt:1};test.conversation.taskId=test.task.id;return test.task;}
   if(method==='task.pygas.read')return {taskId:data.taskId,composition:null,graph:null,assets:[],catalog:{schema_version:1,status:'passed',source:{files:{}},catalog:{cv:[],bias:[],switch:[],neighbor:[]}}};
   if(method==='task.read')return test.task;
   if(method==='task.edit'){const current=structuredClone(test.task||{id:data.id,parameters:{},updatedAt:1});for(const [key,value] of Object.entries(data.changes)){const parts=key.split('.');let node=current.parameters;for(const part of parts.slice(0,-1))node=node[part]||(node[part]={});node[parts.at(-1)]=value;}current.updatedAt++;test.task=current;return current;}
   if(method==='task.execute')return {...test.run,status:'queued'};
   if(method==='settings'){test.settings={...test.settings,...data};return test.settings;}
   if(method==='worker.connect'){test.events.forEach(fn=>fn({method:'studio/workerConnected'}));return {};}
   if(['agent.connect','agent.tools'].includes(method))return method==='agent.tools'?{status:'ready',count:26}:{tools:{status:'ready',count:26}};
   if(['agent.disconnect','agent.login.cancel'].includes(method))return {};
   if(method==='agent.account')return {account:null,requiresOpenaiAuth:true,modelAccess:'not_run'};
   if(method==='agent.rpc'){
    if(data.method==='model/list')return {data:[{model:'fixture-model',isDefault:true,supportedReasoningEfforts:[]}]};
    if(['thread/resume','thread/read'].includes(data.method))return {thread:{id:data.params.threadId,name:'Saved fixture',turns:[]}};if(data.method==='thread/list')return {data:[]};if(data.method==='thread/start')return {thread:{id:'fixture-thread'}};
    if(data.method==='turn/start')return {turn:{id:'fixture-turn'}};return {};
   }
   if(method!=='worker.request')throw Error('Unexpected fixture IPC: '+method);
   if(test.offline||test.failedSources?.includes(data.target))throw Error('Fixture source unavailable');const {target}=data;if(test.responses?.[target])return test.responses[target](data);
   if(target==='/api/projects')return [test.project];if(target==='/api/environments')return [test.environment];
   if(target==='/api/runs')return test.runs||[test.run];if(target==='/api/cluster-runs')return test.cluster?[test.cluster]:[];if(['/api/assets','/api/gpu','/api/clusters','/api/cluster-runs'].includes(target))return [];
   if(target==='/api/run/status')return test.run;if(target==='/api/run/log')return {offset:0,text:''};
   if(target==='/api/cluster/status')return {...test.run,cluster:{scheduler:'slurm'},cluster_id:'cluster',resources:{cpus:1},snapshots:[{name:'run.py'}],script:'# fixture',scientific_validation:{status:'not_run'}};
   if(target==='/api/run/input')return {editable:true,text:'print("fixture")',sha256:'fixture'};
   throw Error('Unexpected fixture route: '+target);
  }};
 });
 await page.goto(base+'/.studio/v0182/round2/agent-b/frontend-attempt1/harness.html',{timeout:30000});await page.waitForFunction(()=>window.renderTest);
 return {page,context};
}
async function openAgentOptions(p){const toggle=p.getByTestId('agent-options');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();}
async function check(name,fn){if(process.env.STUDIO_FRONTEND_FILTER&&!new RegExp(process.env.STUDIO_FRONTEND_FILTER).test(name))return;const {page,context}=await fixture();try{await fn(page);results.push({name,status:'passed'});}catch(e){results.push({name,status:'failed',error:String(e)});await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});}finally{await context.close();}}
async function logFixture(page,connected=true){
 await page.clock.install();
 await page.evaluate(connected=>{
  const test=window.__test,original=window.studio.invoke;test.logCalls=[];test.logChunks=[{offset:7,text:'α log\n'}];
  test.readLog=()=>Promise.resolve(test.logChunks.shift()||{offset:test.lastOffset||0,text:''});
  window.studio.invoke=async(method,data)=>{if(method==='worker.request'&&data.target==='/api/run/log'){test.calls.push({method,data});test.logCalls.push(structuredClone(data.data));const response=await test.readLog(data.data);test.lastOffset=response.offset;return response;}return original(method,data);};
  window.__runProps={run:{...test.run,status:'succeeded'},connected,onError:error=>test.errors=(test.errors||[]).concat(String(error)),onRefresh:()=>{test.refreshes=(test.refreshes||0)+1;}};
  return window.renderTest('RunDetail',window.__runProps);
 },connected);
}
async function count(page){return page.evaluate(()=>window.__test.logCalls.length);}
async function onlyLogRequests(page){assert.equal(await page.evaluate(()=>window.__test.calls.some(call=>call.method==='task.execute'||call.method==='agent.rpc'||call.method==='worker.request'&&call.data.target!=='/api/run/log')),false);}
try{
 await check('log-new-response-appends-once-and-uses-byte-offset',async page=>{
  await logFixture(page);await page.waitForFunction(()=>window.__test.logCalls.length===1);assert.equal(await page.locator('.console').textContent(),'α log\n');
  await page.evaluate(()=>window.__test.readLog=()=>new Promise(resolve=>window.__finishChunk=resolve));await page.clock.runFor(2000);await page.waitForFunction(()=>typeof window.__finishChunk==='function');
  assert.equal(await page.locator('.console').textContent(),'α log\n');assert.equal(await page.evaluate(()=>window.__test.logCalls[1].offset),7); // UTF-8 byte offset, not JS character count.
  await page.evaluate(()=>window.__finishChunk({offset:14,text:'second\n'}));await page.waitForFunction(()=>document.querySelector('.console').textContent==='α log\nsecond\n');await onlyLogRequests(page);
 });
 await check('log-three-failures-pause-preserve-text-and-explicit-retry',async page=>{
  await logFixture(page);await page.waitForFunction(()=>window.__test.logCalls.length===1);await page.evaluate(()=>window.__test.readLog=()=>Promise.reject(Error('Synthetic offline')));
  for(const delay of [2000,4000,8000]){await page.clock.runFor(delay);await page.waitForTimeout(1);}
  await page.waitForFunction(()=>document.querySelector('[data-testid="run-log-observation"]')?.textContent.includes('已暂停'));assert.equal(await count(page),4);assert.equal(await page.locator('.console').textContent(),'α log\n');
  await page.clock.runFor(30000);assert.equal(await count(page),4);
  await page.evaluate(()=>window.__test.readLog=()=>Promise.resolve({offset:14,text:'second\n'}));await page.getByTestId('run-log-observation').getByRole('button',{name:'重新查询',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.console').textContent==='α log\nsecond\n');assert.equal(await count(page),5);assert.equal(await page.evaluate(()=>window.__test.logCalls.at(-1).offset),7);await onlyLogRequests(page);
 });
 await check('log-disconnect-stops-and-reconnect-retains-offset-discards-late-response',async page=>{
  await logFixture(page,false);await page.clock.runFor(10000);assert.equal(await count(page),0);assert.equal(await page.getByTestId('run-log-observation').getByRole('button').isDisabled(),true);for(const name of ['验证','提交计算','取消','收集产物','续算','导出不可变输入与复现记录 ZIP'])assert.equal(await page.getByRole('button',{name,exact:true}).isDisabled(),true);
  await page.evaluate(()=>window.renderTest('RunDetail',{...window.__runProps,connected:true}));await page.waitForFunction(()=>document.querySelector('.console').textContent==='α log\n');
  await page.evaluate(()=>window.__test.readLog=()=>new Promise(resolve=>window.__finishLate=resolve));await page.clock.runFor(2000);await page.waitForFunction(()=>typeof window.__finishLate==='function');
  await page.evaluate(()=>window.renderTest('RunDetail',{...window.__runProps,connected:false}));await page.getByTestId('run-log-observation').waitFor();await page.evaluate(()=>window.__finishLate({offset:999,text:'LATE WRONG'}));await page.clock.runFor(10000);assert.equal(await count(page),2);assert.equal(await page.locator('.console').textContent(),'α log\n');
  await page.evaluate(()=>{window.__test.readLog=()=>Promise.resolve({offset:14,text:'second\n'});return window.renderTest('RunDetail',{...window.__runProps,connected:true});});await page.waitForFunction(()=>document.querySelector('.console').textContent==='α log\nsecond\n');assert.equal(await count(page),3);assert.equal(await page.evaluate(()=>window.__test.logCalls.at(-1).offset),7);await onlyLogRequests(page);
 });
 await check('log-new-run-resets-and-rejects-old-run-late-chunk',async page=>{
  await page.clock.install();await page.evaluate(()=>{const test=window.__test,original=window.studio.invoke;test.logCalls=[];window.studio.invoke=async(method,data)=>{if(method==='worker.request'&&data.target==='/api/run/log'){test.calls.push({method,data});test.logCalls.push(structuredClone(data.data));if(data.data.run_id==='run')return new Promise(resolve=>window.__finishOldRun=resolve);return {offset:4,text:'NEW\n'};}return original(method,data);};window.__runProps={run:test.run,connected:true,onError:()=>{},onRefresh:()=>{}};return window.renderTest('RunDetail',window.__runProps);});await page.waitForFunction(()=>typeof window.__finishOldRun==='function');
  await page.evaluate(()=>window.renderTest('RunDetail',{...window.__runProps,run:{...window.__test.run,id:'new-run',name:'New run'}}));await page.waitForFunction(()=>document.querySelector('.console').textContent==='NEW\n');await page.evaluate(()=>window.__finishOldRun({offset:900,text:'OLD WRONG'}));await page.waitForTimeout(1);assert.equal(await page.locator('.console').textContent(),'NEW\n');assert.deepEqual(await page.evaluate(()=>window.__test.logCalls),[{run_id:'run',offset:0},{run_id:'new-run',offset:0}]);await onlyLogRequests(page);
 });
}finally{await fs.writeFile(path.join(out,'results.json'),JSON.stringify({scope:'Synthetic RunDetail renderer and fake clock/IPC only; no real worker/provider/SSH or scientific execution.',results},null,2));await browser.close();await server.close();}
console.log(JSON.stringify(results,null,2));if(results.some(result=>result.status!=='passed'))process.exitCode=1;
