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
const out=path.resolve('validation/local/frontend-regression');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'harness.html'),`<html><body><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';import '/src/style.css';import '/src/task-flow.css';
window.React=React;window.testRoot=createRoot(document.getElementById('root'));
window.renderTest=async(name,props={})=>{const m=await import(/* @vite-ignore */ '/src/'+name+'.tsx');window.testRoot.render(React.createElement(m.default||m[name],props));};
</script></body></html>`);
const server=await createServer({server:{port:0,strictPort:false,host:'127.0.0.1'}});await server.listen();
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
   if(method==='state')return {settings:test.settings,threads:[],ssh:[]};
   if(['task.list','workflow.list','ssh.existing','conversation.list'].includes(method))return [];
   if(method==='conversation.remember'){test.conversation={...(test.conversation||{}),id:data.provider+':'+data.threadId,provider:data.provider,threadId:data.threadId,name:data.name,projectId:data.projectId,taskId:test.task?.id||null};return test.conversation;}
   if(method==='conversation.select')return test.conversation;
   if(method==='task.create'){if(!test.task||data.newWorkflow)test.task={id:'task-'+test.calls.length,provider:data.provider,threadId:data.threadId,parameters:{},artifacts:[],updatedAt:1};test.conversation.taskId=test.task.id;return test.task;}
   if(method==='task.read')return test.task;
   if(method==='task.edit'){const current=structuredClone(test.task||{id:data.id,parameters:{},updatedAt:1});for(const [key,value] of Object.entries(data.changes)){const parts=key.split('.');let node=current.parameters;for(const part of parts.slice(0,-1))node=node[part]||(node[part]={});node[parts.at(-1)]=value;}current.updatedAt++;test.task=current;return current;}
   if(method==='task.execute')return {...test.run,status:'queued'};
   if(method==='settings'){test.settings={...test.settings,...data};return test.settings;}
   if(method==='worker.connect'){test.events.forEach(fn=>fn({method:'studio/workerConnected'}));return {};}
   if(['agent.connect','agent.disconnect','agent.login.cancel'].includes(method))return {};
   if(method==='agent.rpc'){
    if(data.method==='model/list')return {data:[{model:'fixture-model',isDefault:true,supportedReasoningEfforts:[]}]};
    if(data.method==='thread/list')return {data:[]};if(data.method==='thread/start')return {thread:{id:'fixture-thread'}};
    if(data.method==='turn/start')return {turn:{id:'fixture-turn'}};return {};
   }
   if(method!=='worker.request')throw Error('Unexpected fixture IPC: '+method);
   if(test.offline)throw Error('Fixture disconnection');const {target}=data;if(test.responses?.[target])return test.responses[target](data);
   if(target==='/api/projects')return [test.project];if(target==='/api/environments')return [test.environment];
   if(target==='/api/runs')return [test.run];if(['/api/assets','/api/gpu','/api/clusters','/api/cluster-runs'].includes(target))return [];
   if(target==='/api/run/status')return test.run;if(target==='/api/run/log')return {offset:0,text:''};
   if(target==='/api/cluster/status')return {...test.run,cluster:{scheduler:'slurm'},cluster_id:'cluster',resources:{cpus:1},snapshots:[{name:'run.py'}],script:'# fixture',scientific_validation:{status:'not_run'}};
   if(target==='/api/run/input')return {editable:true,text:'print("fixture")',sha256:'fixture'};
   throw Error('Unexpected fixture route: '+target);
  }};
 });
 await page.goto(base+'/validation/local/frontend-regression/harness.html',{timeout:30000});await page.waitForFunction(()=>window.renderTest);
 return {page,context};
}
async function check(name,fn){const {page,context}=await fixture();try{await fn(page);results.push({name,status:'passed'});}catch(e){results.push({name,status:'failed',error:String(e)});await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});}finally{await context.close();}}
try{
 await check('legacy-prose-draft-restores-with-blockers',async p=>{
  await p.evaluate(async()=>{window.__test.task={id:'legacy',provider:'codex',threadId:'fixture-thread',name:'Legacy draft',parameters:{md:{temperature:300}},plan:[{step:'审阅输入'}],missingFields:['确认实际结构与 CV 原子编号。','md.structure_file'],artifacts:[],updatedAt:1};await window.renderTest('AgentTaskPage',{worker:false,task:window.__test.task,environments:[],theme:'dark',onError:e=>{throw e;},onRun:()=>{},onCluster:()=>{},onSetup:()=>{},onAgent:()=>{},onReview:()=>{},onReplace:()=>{},onRefresh:()=>{}});});
  await p.getByTestId('workflow-requirements').waitFor();assert.match(await p.getByTestId('workflow-requirements').innerText(),/确认实际结构/);assert.equal(await p.getByTestId('execute-workflow').isDisabled(),true);
  if(await p.locator('.visual-step-heading').last().getAttribute('aria-expanded')==='false')await p.locator('.visual-step-heading').last().click();await p.locator('[data-field="md.temperature"] input').fill('345');await p.waitForFunction(()=>window.__test.task.parameters.md.temperature===345);assert.equal(await p.getByTestId('workflow-requirements').isVisible(),true);
 });
 await check('broken-workflow-keeps-sidebar-and-agent',async p=>{
  await p.evaluate(async()=>{window.studio.originalInvoke=window.studio.invoke;window.studio.invoke=async(method,data)=>method==='task.list'?[{id:'broken',provider:'codex',name:'Invalid persisted draft',steps:[{id:'invalid',title:'Invalid',fields:[{key:'__proto__.polluted',type:'text',label:'Invalid',required:true}]}],parameters:{},artifacts:[]}]:window.studio.originalInvoke(method,data);localStorage.setItem('studio.section','agent-task:broken');await window.renderTest('App');});
  await p.getByTestId('view-error').waitFor();assert.equal(await p.locator('.sidebar').isVisible(),true);assert.equal(await p.locator('.agent-panel').isVisible(),true);await p.getByTestId('view-error').getByRole('button',{name:'返回工作台',exact:true}).click();await p.locator('.home-page').waitFor();assert.equal(await p.getByTestId('view-error').count(),0);
 });
 await check('cluster-edits-survive-poll',async p=>{
  await p.clock.install();await p.evaluate(async()=>{const {ClusterRunPage}=await import('/src/ClusterPage.tsx');window.testRoot.render(window.React.createElement(ClusterRunPage,{id:'run',onError:()=>{},onAgent:()=>{}}));});
  const text=p.locator('.cluster-review textarea');await text.waitFor();await p.locator('.cluster-review input[type=checkbox]').check();await text.fill('{"temperature":345}');await p.clock.runFor(10050);assert.equal(await text.inputValue(),'{"temperature":345}');
 });
 await check('task-edits-survive-update',async p=>{
  await p.evaluate(async()=>{window.props={worker:true,task:{id:'task',name:'Fixture task',updatedAt:1,parameters:{temperature:300},artifacts:[]},environments:[],theme:'dark',onError:()=>{},onRun:()=>{},onCluster:()=>{},onSetup:()=>{},onAgent:()=>{},onReview:()=>{},onReplace:()=>{},onRefresh:()=>{}};window.__test.task=window.props.task;await window.renderTest('AgentTaskPage',window.props);});
  await p.locator('.visual-step-heading').click();const input=p.locator('[data-field="temperature"] input');await input.fill('345');await p.waitForFunction(()=>window.__test.task.parameters.temperature===345);await p.evaluate(()=>window.renderTest('AgentTaskPage',{...window.props,task:{...window.__test.task,updatedAt:3,artifacts:[{kind:'workflow',id:'fixture'}]}}));assert.equal(await input.inputValue(),'345');
 });
 await check('visual-fields-completeness-and-review',async p=>{
  await p.evaluate(async()=>{window.__test.task={id:'task',provider:'codex',threadId:'fixture-thread',name:'Visual MD',updatedAt:1,steps:[{id:'md',title:'动力学参数',fields:[{key:'temperature',label:'温度',type:'number',required:true,unit:'K'},{key:'structure_file',label:'初始结构',type:'file',required:true}]}],parameters:{temperature:null,structure_file:'/fixture/model.xyz'},artifacts:[],missingFields:['temperature']};await window.renderTest('AgentTaskPage',{worker:true,task:window.__test.task,environments:[],theme:'dark',onError:()=>{},onRun:()=>{},onCluster:()=>{},onSetup:()=>{},onAgent:()=>{},onReview:task=>window.reviewed=task,onReplace:()=>{},onRefresh:()=>{}});});
  await p.locator('.visual-step-heading .flow-dot.missing').waitFor();assert.equal(await p.locator('.parameter-json').count(),0);assert.match(await p.locator('.parameter-file').innerText(),/model.xyz/);await p.locator('[data-field="temperature"] input').fill('345');await p.locator('.visual-step-heading .flow-dot.ready').waitFor();assert.equal(await p.locator('[data-field=temperature] input').isVisible(),true);await p.getByTestId('review-workflow').click();await p.waitForFunction(()=>window.reviewed);assert.equal(await p.evaluate(()=>window.reviewed.parameters.temperature),345);assert.equal(await p.getByTestId('execute-workflow').isDisabled(),true);await p.screenshot({path:path.join(out,'visual-workflow.png')});
 });
 await check('hidden-agent-preserves-conversation',async p=>{
  await p.evaluate(async()=>{const {default:Agent}=await import('/src/Agent.tsx');window.agentProps={planningMode:false,onPlanningModeChange:()=>{},context:'{}',onError:()=>{},projectId:'project'};await window.renderTest('Agent',window.agentProps);});await p.locator('.agent-config button').first().click();await p.waitForFunction(()=>window.__test.calls.some(c=>c.method==='agent.rpc'&&c.data.method==='model/list'));await p.locator('.composer textarea').fill('Keep this draft');await p.evaluate(()=>window.renderTest('Agent',{...window.agentProps,hidden:true}));assert.equal(await p.locator('.agent-panel').isVisible(),false);await p.evaluate(()=>window.renderTest('Agent',{...window.agentProps,hidden:false}));assert.equal(await p.locator('.composer textarea').inputValue(),'Keep this draft');assert.equal(await p.locator('.agent-config select').count(),1);
 });
 await check('conversation-reuses-flow-for-natural-updates',async p=>{
  await p.evaluate(async()=>{const {default:Agent}=await import('/src/Agent.tsx');function Host(){const [planningMode,setPlanning]=window.React.useState(true);return window.React.createElement(Agent,{planningMode,onPlanningModeChange:setPlanning,context:'{}',onError:()=>{},projectId:'project'});}window.testRoot.render(window.React.createElement(Host));});await p.locator('.agent-config button').first().click();await p.waitForFunction(()=>window.__test.calls.some(c=>c.method==='agent.rpc'&&c.data.method==='model/list'));
  const prompt=p.locator('.composer textarea');await prompt.fill('准备 MD');await p.locator('.composer .send').click();await p.waitForFunction(()=>window.__test.calls.some(c=>c.method==='agent.rpc'&&c.data.method==='turn/start'));const first=await p.evaluate(()=>window.__test.task.id);await p.evaluate(()=>window.__test.events.forEach(fn=>fn({provider:'codex',method:'turn/completed',params:{threadId:'fixture-thread',turn:{status:'completed'}}})));await p.getByTestId('agent-planning-mode').uncheck();await prompt.fill('温度改成345 K');await p.locator('.composer .send').click();await p.waitForFunction(()=>window.__test.calls.filter(c=>c.method==='agent.rpc'&&c.data.method==='turn/start').length===2);assert.equal(await p.evaluate(()=>window.__test.task.id),first);assert.equal(await p.evaluate(()=>window.__test.calls.filter(c=>c.method==='task.create').length),1);assert.equal(await p.evaluate(()=>window.__test.calls.filter(c=>c.method==='agent.rpc'&&c.data.method==='turn/start').at(-1).data.params.studioTaskId),first);
 });
 await check('failure-details-visible',async p=>{
  await p.evaluate(()=>window.renderTest('RunDetail',{run:{...window.__test.run,status:'failed',error:'ENGINE_FAILURE',exit:{exit_code:-9,reason:'fixture termination'}},onRefresh:async()=>{},onError:()=>{}}));await p.locator('.subtabs button').filter({hasText:'验证'}).click();assert.match(await p.locator('.validation-report').innerText(),/ENGINE_FAILURE/);assert.match(await p.locator('.validation-report').innerText(),/-9/);
 });
 await check('disconnected-status-consistent',async p=>{
  await p.clock.install();await p.evaluate(()=>{window.__test.run.status='running';return window.renderTest('App');});await p.locator('.connect-banner button').click();await p.waitForFunction(()=>document.querySelector('.statusbar')?.textContent?.includes('已连接'));await p.evaluate(()=>{window.__test.offline=true;});await p.clock.runFor(2600);assert.match(await p.locator('.statusbar').innerText(),/未知|中断|断开/);assert.doesNotMatch(await p.locator('.queue-strip').innerText(),/队列空闲/);assert.equal(await p.locator('.stat-grid .stat strong').first().innerText(),'?');await p.screenshot({path:path.join(out,'dashboard-disconnected.png')});
 });
 await check('ime-enter-keeps-draft',async p=>{
  await p.evaluate(()=>window.renderTest('Agent',{planningMode:false,onPlanningModeChange:()=>{},context:'{}',onError:()=>{},projectId:'project'}));await p.locator('.agent-config button').first().click();await p.waitForFunction(()=>window.__test.calls.some(c=>c.method==='agent.rpc'&&c.data.method==='model/list'));const text=p.locator('.composer textarea');await text.fill('composition draft');await text.dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true});assert.equal(await text.inputValue(),'composition draft');assert.equal(await p.evaluate(()=>window.__test.calls.filter(c=>c.method==='agent.rpc'&&c.data.method==='turn/start').length),0);
 });
 await check('skill-roots-newline',async p=>{
  await p.evaluate(async()=>{const {default:SettingsPage}=await import('/src/SettingsPage.tsx');function Host(){const [settings,setSettings]=window.React.useState(window.__test.settings);return window.React.createElement(SettingsPage,{settings,onChange:setSettings,onClose:()=>{},onError:()=>{}});}window.testRoot.render(window.React.createElement(Host));});await p.locator('.settings-nav button').filter({hasText:'技能目录'}).click();const text=p.locator('.settings-content textarea');await text.fill('/fixture/one');await text.press('End');await text.press('Enter');await text.pressSequentially('/fixture/two');assert.equal(await text.inputValue(),'/fixture/one\n/fixture/two');
 });
 await check('modal-focus-escape-restore',async p=>{
  await p.evaluate(async()=>{const {Modal}=await import('/src/Dialogs.tsx');function Host(){const [open,setOpen]=window.React.useState(false);return window.React.createElement('div',null,window.React.createElement('button',{id:'opener',onClick:()=>setOpen(true)},'Open'),open&&window.React.createElement(Modal,{title:'Fixture dialog',onClose:()=>setOpen(false)},window.React.createElement('input',{id:'dialog-input'}),window.React.createElement('button',null,'Inside')));}window.testRoot.render(window.React.createElement(Host));});await p.locator('#opener').click();await p.getByRole('dialog').waitFor();for(let i=0;i<6;i++){await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('[role=dialog]')),true);}await p.keyboard.press('Escape');await p.getByRole('dialog').waitFor({state:'detached'});assert.equal(await p.evaluate(()=>document.activeElement.id),'opener');
 });
 await check('submit-waits-for-refresh',async p=>{
  await p.evaluate(()=>{window.__test.run.status='ready';window.__test.responses={'/api/run/submit':async()=>({...window.__test.run,status:'queued'})};return window.renderTest('RunDetail',{run:window.__test.run,onRefresh:()=>new Promise(r=>window.finishRefresh=r),onError:()=>{}});});
  const button=p.locator('.run-actions button').filter({hasText:'提交计算'});await button.click();await p.waitForFunction(()=>window.finishRefresh);assert.equal(await button.isDisabled(),true);await p.evaluate(()=>window.finishRefresh());
 });
 await check('ambiguous-submit-keeps-revision',async p=>{
  await p.evaluate(()=>{window.__test.responses={'/api/run/revise':async()=>({...window.__test.run,id:'revision'}),'/api/run/validate':async()=>({...window.__test.run,id:'revision',status:'ready',validation:{status:'passed'}}),'/api/run/submit':async()=>{throw Error('Fixture response lost');},'/api/run/status':async()=>{throw Error('Fixture offline');}};return window.renderTest('RunReview',{run:window.__test.run,environments:[window.__test.environment],theme:'dark',onRefresh:async()=>{},onError:()=>{},onReplace:()=>{}});});
  await p.getByTestId('execute-reviewed').click();await p.locator('.run-detail').waitFor();assert.match(await p.locator('.run-detail').innerText(),/revision/);assert.equal(await p.getByTestId('execute-reviewed').count(),0);assert.equal(await p.locator('.run-actions button').filter({hasText:'提交计算'}).isDisabled(),true);assert.equal(await p.evaluate(()=>window.__test.calls.filter(c=>c.data?.target==='/api/run/revise').length),1);
 });
 await check('review-switch-clears-uncertain-run',async p=>{
  await p.evaluate(()=>{window.__test.responses={'/api/run/revise':async()=>({...window.__test.run,id:'revision'}),'/api/run/validate':async()=>({...window.__test.run,id:'revision',status:'ready',validation:{status:'passed'}}),'/api/run/submit':async()=>{throw Error('Fixture response lost');},'/api/run/status':async()=>{throw Error('Fixture offline');}};window.reviewProps={run:window.__test.run,environments:[window.__test.environment],theme:'dark',onRefresh:async()=>{},onError:()=>{},onReplace:()=>{}};return window.renderTest('RunReview',window.reviewProps);});
  await p.getByTestId('execute-reviewed').click();await p.locator('.run-detail').waitFor();
  await p.evaluate(()=>window.renderTest('RunReview',{...window.reviewProps,run:{...window.__test.run,id:'next-run',name:'Next reviewed run'}}));
  await p.getByTestId('task-review').waitFor();assert.equal(await p.locator('.run-detail').count(),0);assert.equal(await p.locator('.task-review input').first().inputValue(),'Next reviewed run');
 });
 await check('resume-retry-retains-request',async p=>{
  await p.evaluate(()=>{let count=0;window.__test.responses={'/api/run/resume':async()=>{if(++count===1)throw Error('Fixture response lost');return {...window.__test.run,id:'continuation'};}};return window.renderTest('RunDetail',{run:{...window.__test.run,status:'failed'},onRefresh:async()=>{},onError:()=>{}});});
  const open=p.locator('.run-actions button').filter({hasText:'续算'});await open.click();await p.getByRole('dialog').locator('textarea').fill('{"checkpoint_files":["fixture.xyz"]}');await p.getByRole('dialog').getByRole('button',{name:'创建续算草稿',exact:true}).click();await p.waitForFunction(()=>window.__test.calls.some(c=>c.data?.target==='/api/run/resume'));assert.equal(await p.getByRole('dialog').locator('textarea').isDisabled(),true);await p.keyboard.press('Escape');await open.click();await p.getByRole('dialog').getByRole('button',{name:'重试同一续算请求',exact:true}).click();await p.getByRole('dialog').waitFor({state:'detached'});const requests=await p.evaluate(()=>window.__test.calls.filter(c=>c.data?.target==='/api/run/resume').map(c=>c.data.data));assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
 });
 await check('resume-identity-survives-remount',async p=>{
  await p.evaluate(()=>{let count=0;window.__test.responses={'/api/run/resume':async()=>{if(++count===1)throw Error('Fixture response lost');return {...window.__test.run,id:'continuation'};}};window.resumeProps={run:{...window.__test.run,status:'failed'},onRefresh:async()=>{},onError:()=>{}};return window.renderTest('RunDetail',window.resumeProps);});
  await p.locator('.run-actions button').filter({hasText:'续算'}).click();await p.getByRole('dialog').locator('textarea').fill('{"checkpoint_files":["fixture.xyz"]}');await p.getByRole('dialog').getByRole('button',{name:'创建续算草稿',exact:true}).click();await p.waitForFunction(()=>localStorage.getItem('studio.resume.run'));await p.evaluate(()=>window.testRoot.render(window.React.createElement('div',null,'Unmounted')));await p.locator('.run-detail').waitFor({state:'detached'});await p.evaluate(()=>window.renderTest('RunDetail',window.resumeProps));await p.locator('.run-actions button').filter({hasText:'续算'}).click();assert.equal(await p.getByRole('dialog').locator('textarea').isDisabled(),true);await p.getByRole('dialog').getByRole('button',{name:'重试同一续算请求',exact:true}).click();await p.getByRole('dialog').waitFor({state:'detached'});const requests=await p.evaluate(()=>window.__test.calls.filter(c=>c.data?.target==='/api/run/resume').map(c=>c.data.data));assert.deepEqual(requests[0],requests[1]);assert.equal(await p.evaluate(()=>localStorage.getItem('studio.resume.run')),null);
 });
 await check('resume-rejects-array-json',async p=>{
  await p.evaluate(()=>window.renderTest('RunDetail',{run:{...window.__test.run,status:'failed'},onRefresh:async()=>{},onError:()=>{}}));await p.locator('.run-actions button').filter({hasText:'续算'}).click();await p.getByRole('dialog').locator('textarea').fill('[]');await p.getByRole('dialog').getByRole('button',{name:'创建续算草稿',exact:true}).click();assert.equal(await p.evaluate(()=>window.__test.calls.filter(c=>c.data?.target==='/api/run/resume').length),0);
 });
 await check('settings-cancel-restores-preview',async p=>{
  await p.evaluate(()=>window.renderTest('App'));await p.locator('.sidebar-tools button').filter({hasText:'设置'}).click();await p.getByRole('dialog').locator('select').first().selectOption('light');await p.waitForFunction(()=>document.documentElement.dataset.theme==='light');await p.keyboard.press('Escape');await p.getByRole('dialog').waitFor({state:'detached'});assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'dark');
 });
 await check('unknown-approval-is-not-allowable',async p=>{
  await p.evaluate(()=>window.renderTest('Agent',{planningMode:false,onPlanningModeChange:()=>{},context:'{}',onError:()=>{}}));await p.locator('.composer textarea').waitFor();await p.evaluate(()=>window.__test.events.forEach(fn=>fn({method:'unrecognized/requestApproval',id:'unknown',params:{reason:'Fixture unsupported request'}})));await p.locator('.approval').waitFor();assert.equal(await p.locator('.approval button').filter({hasText:'允许'}).count(),0);
 });
 await check('modal-skips-disabled-and-hidden',async p=>{
  await p.evaluate(async()=>{const {Modal}=await import('/src/Dialogs.tsx');window.testRoot.render(window.React.createElement('div',null,window.React.createElement('button',{id:'outside'},'Outside'),window.React.createElement(Modal,{title:'Disabled fixture',onClose:()=>{}},window.React.createElement('input',{disabled:true}),window.React.createElement('input',{style:{display:'none'}}),window.React.createElement('input',{id:'available'}))));});await p.getByRole('dialog').waitFor();assert.equal(await p.evaluate(()=>document.activeElement.id),'available');await p.evaluate(()=>document.getElementById('outside').focus());assert.equal(await p.evaluate(()=>!!document.activeElement.closest('[role=dialog]')),true);
 });
 await check('bias-family-fields-and-unique-source',async p=>{
  await p.addInitScript(()=>localStorage.setItem('studio.section','bias'));await p.reload();await p.waitForFunction(()=>window.renderTest);await p.evaluate(()=>{window.__test.responses={'/api/templates/bias':async()=>({source:'# fixture only'}),'/api/workspace/write':async request=>({path:'/fixture/'+request.data.name}),'/api/run/status':async()=>window.__test.run};return window.renderTest('App');});await p.locator('.bias-grid').waitFor();await p.waitForFunction(()=>window.__test.events.length>=2);await p.evaluate(()=>window.__test.events.forEach(fn=>fn({method:'studio/workerConnected'})));await p.waitForFunction(()=>document.querySelector('.statusbar')?.textContent?.includes('已连接'));
  const inputs=p.locator('.bias-grid input');await inputs.nth(0).fill('/fixture/model.xyz');await inputs.nth(1).fill('0');await inputs.nth(2).fill('1');await inputs.nth(3).fill('5');await p.locator('.bias-grid input[type=checkbox]').check();const family=p.locator('.bias-grid select').last();await family.selectOption('wtmetad');await p.locator('.bias-grid section').last().locator('input').nth(0).fill('0.2');await family.selectOption('umbrella');await p.locator('.bias-grid section').last().locator('input').nth(0).fill('2');await p.locator('.bias-grid section').last().locator('input').nth(1).fill('1');await p.locator('.bias-grid').getByRole('button',{name:'生成源码与构建草稿',exact:true}).click();await p.getByRole('dialog').waitFor();const request=await p.evaluate(()=>window.__test.calls.find(c=>c.data?.target==='/api/templates/bias').data.data.parameters);assert.equal(request.family,'umbrella');assert.equal('sigma' in request,false);const filename=await p.evaluate(()=>window.__test.calls.find(c=>c.data?.target==='/api/workspace/write').data.data.name);assert.match(filename,/^build_bias_[0-9a-f-]+\.py$/);
 });
 await check('dashboard-light-dark-layout',async p=>{
  await p.setViewportSize({width:1280,height:900});await p.evaluate(()=>window.renderTest('App'));await p.locator('.connect-banner button').click();await p.waitForFunction(()=>document.querySelector('.statusbar')?.textContent?.includes('已连接'));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:path.join(out,'dashboard-dark.png')});await p.getByRole('button',{name:'切换主题',exact:true}).click();await p.waitForFunction(()=>document.documentElement.dataset.theme==='light');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:path.join(out,'dashboard-light.png')});
 });
 await check('chart-partial-preview-notice',async p=>{
  await p.evaluate(async()=>{const {Chart}=await import('/src/widgets.tsx');window.testRoot.render(window.React.createElement(Chart,{text:Array.from({length:4001},(_,i)=>`${i} ${i+1}`).join('\n'),name:'fixture.out'}));});await p.locator('.chart-note').first().waitFor();assert.match(await p.locator('.chart-wrap').innerText(),/4000/);await p.evaluate(()=>{document.documentElement.dataset.theme='light';window.dispatchEvent(new Event('studio:appearance'));});await p.screenshot({path:path.join(out,'chart-light.png')});
 });
}finally{await fs.writeFile(path.join(out,'results.json'),JSON.stringify({scope:'Mock IPC browser renderer regression only; no scientific validation.',checks:results},null,2));await browser.close();await server.close();}
console.log(JSON.stringify(results,null,2));if(results.some(r=>r.status==='failed'))process.exitCode=1;
