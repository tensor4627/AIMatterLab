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
const out=path.resolve(process.env.STUDIO_SHELL_OUTPUT||'.studio/v0182/round2/agent-b/frontend-final2');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'harness.html'),`<html><body><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';import '/frontend/app/style.css';import '/frontend/features/workflows/task-flow.css';
window.React=React;window.testRoot=createRoot(document.getElementById('root'));
window.renderTest=async(name,props={})=>{const m=await import(/* @vite-ignore */ {"main":"/frontend/app/main.tsx","App":"/frontend/app/App.tsx","Dialogs":"/frontend/ui/Dialogs.tsx","Tooltip":"/frontend/ui/Tooltip.tsx","PaneDivider":"/frontend/ui/PaneDivider.tsx","ModuleIcon":"/frontend/ui/ModuleIcon.tsx","ParameterFields":"/frontend/ui/ParameterFields.tsx","ViewBoundary":"/frontend/ui/ViewBoundary.tsx","widgets":"/frontend/ui/widgets.tsx","Agent":"/frontend/features/conversations/Agent.tsx","ConversationCommands":"/frontend/features/conversations/ConversationCommands.tsx","MessageText":"/frontend/features/conversations/MessageText.tsx","ToolActivity":"/frontend/features/conversations/ToolActivity.tsx","AccountCenter":"/frontend/features/settings/AccountCenter.tsx","ProviderLogin":"/frontend/features/settings/ProviderLogin.tsx","SettingsPage":"/frontend/features/settings/SettingsPage.tsx","ComputeConnectionChooser":"/frontend/features/compute/ComputeConnectionChooser.tsx","ComputeConnectionGuide":"/frontend/features/compute/ComputeConnectionGuide.tsx","ComputeEnvironments":"/frontend/features/compute/ComputeEnvironments.tsx","ProjectAuthorizationForm":"/frontend/features/compute/ProjectAuthorizationForm.tsx","QueueChoices":"/frontend/features/compute/QueueChoices.tsx","ClusterPage":"/frontend/features/cluster/ClusterPage.tsx","ClusterQueueSettings":"/frontend/features/cluster/ClusterQueueSettings.tsx","ClusterResults":"/frontend/features/cluster/ClusterResults.tsx","SshConnectionGuide":"/frontend/features/cluster/SshConnectionGuide.tsx","AgentTaskPage":"/frontend/features/workflows/AgentTaskPage.tsx","Workflows":"/frontend/features/workflows/Workflows.tsx","DeploymentPanel":"/frontend/features/workflows/DeploymentPanel.tsx","TaskStageEditor":"/frontend/features/workflows/TaskStageEditor.tsx","ConsumerArtifactPicker":"/frontend/features/workflows/ConsumerArtifactPicker.tsx","ConsumerStageEditor":"/frontend/features/workflows/ConsumerStageEditor.tsx","ConsumerTargetReview":"/frontend/features/workflows/ConsumerTargetReview.tsx","LocalInputReview":"/frontend/features/workflows/LocalInputReview.tsx","WorkspacePanel":"/frontend/features/workflows/WorkspacePanel.tsx","PygasComposer":"/frontend/features/pygas/PygasComposer.tsx","PygasFrameworkControls":"/frontend/features/pygas/PygasFrameworkControls.tsx","PygasSettings":"/frontend/features/pygas/PygasSettings.tsx","PygasStructuredValue":"/frontend/features/pygas/PygasStructuredValue.tsx","PygasTaskComposer":"/frontend/features/pygas/PygasTaskComposer.tsx","CustomCvLibrary":"/frontend/features/custom-cv/CustomCvLibrary.tsx","CustomCvNumericScope":"/frontend/features/custom-cv/CustomCvNumericScope.tsx","CustomCvTaskController":"/frontend/features/custom-cv/CustomCvTaskController.tsx","CustomCvWorkbench":"/frontend/features/custom-cv/CustomCvWorkbench.tsx","JobsPage":"/frontend/features/runs/JobsPage.tsx","RunDetail":"/frontend/features/runs/RunDetail.tsx","RunReview":"/frontend/features/runs/RunReview.tsx","MaterialsProject":"/frontend/features/assets/MaterialsProject.tsx","StructureBuilder":"/frontend/features/assets/StructureBuilder.tsx","SkillsWorkbench":"/frontend/features/tools/SkillsWorkbench.tsx","DiagnosticNotice":"/frontend/features/diagnostics/DiagnosticNotice.tsx","WorkbenchImageCommand":"/frontend/features/diagnostics/WorkbenchImageCommand.tsx","SharedTerminalPanel":"/frontend/features/terminal/SharedTerminalPanel.tsx"}[name]);window.testRoot.render(React.createElement(m.default||m[name],props));};
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
 await page.goto(base+'/'+path.relative(process.cwd(),path.join(out,'harness.html')).split(path.sep).map(encodeURIComponent).join('/'),{timeout:30000});await page.waitForFunction(()=>window.renderTest);
 return {page,context};
}
async function openAgentOptions(p){const toggle=p.getByTestId('agent-options');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();}
async function check(name,fn){if(process.env.STUDIO_FRONTEND_FILTER&&!new RegExp(process.env.STUDIO_FRONTEND_FILTER).test(name))return;const {page,context}=await fixture();try{await fn(page);results.push({name,status:'passed'});}catch(e){results.push({name,status:'failed',error:String(e)});await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});}finally{await context.close();}}
async function seeded(page,{legacy=false,large=false,longTitles=false}={}){
 await page.evaluate(({legacy,large,longTitles})=>{
  if(legacy){localStorage.setItem('studio.bottom','190');window.__test.settings.agentLayout='center';}
  if(large)Object.assign(window.__test.settings,{fontSize:24,minimumFontSize:18,theme:'light'});
  const test=window.__test,now=Date.now()/1000;
  test.run={...test.run,status:'queued',created_at:now};
  test.cluster={...test.run,id:'run',kind:'cluster-run',name:'Remote NEB',status:'unknown',job_id:'1001',cluster_id:'cluster',cluster:{scheduler:'lsf'},resources:{gpus:1},snapshots:[]};
  test.conversations=[{id:'codex:thread',provider:'codex',threadId:'thread',name:'Current NEB workflow',projectId:'project',taskId:'flow',updatedAt:1},...['Saved MD','Training data','Analysis'].map((name,index)=>({id:'codex:other'+index,provider:'codex',threadId:'other'+index,name,projectId:null,taskId:null,updatedAt:index+2}))];
  if(longTitles){test.project.name='Long project name '.repeat(15)+'END';test.conversations[0].name='Long conversation title '.repeat(20)+'END';}
  test.task={id:'flow',name:'Fixture conversation workflow',provider:'codex',threadId:'thread',workflowVersion:1,parameterRevision:1,updatedAt:1,parameters:{temperature:300},steps:[{id:'science',title:'Temperature settings',fields:[{key:'temperature',label:'Temperature',type:'number',required:true,unit:'K'}]}],artifacts:[{id:'run',kind:'cluster-run',name:'Remote NEB',engine:'gpumd.neb'}],review:{status:'not_run'}};
 },{legacy,large,longTitles});
 await page.evaluate(()=>window.renderTest('App'));
 await page.getByTestId('new-conversation').waitFor();
}
async function connect(page){await page.getByRole('button',{name:'连接 WSL',exact:true}).click();await page.waitForFunction(()=>window.__test.calls.some(call=>call.method==='worker.request'&&call.data.target==='/api/cluster-runs'));}
async function noWrites(page){assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='task.execute'||call.method==='agent.rpc'&&call.data.method==='turn/start'||call.method==='worker.request'&&call.data.method!=='GET'&&!['/api/run/status','/api/cluster/status','/api/run/log','/api/cluster/log'].includes(call.data.target)).length),0);}
try{
 await check('startup-deferred-first-records-never-display-live-zero',async page=>{
  await seeded(page);await page.evaluate(()=>{window.__pendingLocal=[];window.__pendingCluster=[];window.__test.responses={'/api/runs':()=>new Promise(resolve=>window.__pendingLocal.push(resolve)),'/api/cluster-runs':()=>new Promise(resolve=>window.__pendingCluster.push(resolve))};});
  await page.getByRole('button',{name:'连接 WSL',exact:true}).click();await page.waitForFunction(()=>window.__pendingLocal.length>0&&window.__pendingCluster.length>0);await page.waitForTimeout(60);
  assert.equal(await page.getByTestId('navigate-runs').locator('.nav-count').textContent(),'?');
  await page.evaluate(()=>window.__pendingLocal.forEach(resolve=>resolve([window.__test.run])));await page.waitForTimeout(60);assert.equal(await page.getByTestId('navigate-runs').locator('.nav-count').textContent(),'?');
  await page.evaluate(()=>window.__pendingCluster.forEach(resolve=>resolve([window.__test.cluster])));await page.waitForFunction(()=>document.querySelector('[data-testid="navigate-runs"] .nav-count').textContent==='2');
  await page.getByTestId('navigate-runs').click();assert.equal(await page.locator('.job-record').count(),2);assert.equal(await page.getByTestId('job-observation-local').locator('strong').textContent(),'本地');assert.match(await page.getByTestId('job-observation-local').textContent(),/已读取记录/);assert.match(await page.getByTestId('job-observation-cluster').textContent(),/已读取记录/);await noWrites(page);
 });
 await check('primary-navigation-history-search-new-chat-direct-focus',async page=>{
  await seeded(page);assert.equal(await page.locator('.primary-navigation .nav-item').count(),3);
  assert.equal(await page.getByTestId('bottom-panel').evaluate(element=>element.classList.contains('is-collapsed')),true);
  const sidebar=await page.getByTestId('conversation-sidebar').boundingBox();assert(sidebar.height>350);
  await page.getByLabel('搜索会话',{exact:true}).fill('NEB');assert.equal(await page.locator('.conversation-item').count(),1);
  await page.locator('.conversation-item').click();await page.getByTestId('agent-task-page').waitFor();
  assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='conversation.select').at(-1).data.id),'codex:thread');
  await page.getByTestId('new-conversation').click();await page.waitForFunction(()=>document.activeElement===document.querySelector('.agent-panel .composer textarea'));
  await page.getByTestId('navigate-tools').click();await page.getByTestId('tools-directory').waitFor();assert.equal(await page.locator('.tool-directory-group').count(),3);assert.equal(await page.locator('[data-testid^="open-tool-"]').count(),7);
  await page.getByTestId('open-tool-md').click();await page.locator('.tool-page').waitFor();await noWrites(page);
  await page.screenshot({path:path.join(out,'navigation-default.png')});
 });
 await check('legacy-layout-and-persistent-task-agent-terminal-across-navigation-and-resize',async page=>{
  await seeded(page,{legacy:true});await connect(page);await page.locator('.conversation-item').filter({hasText:'Current NEB'}).click();await page.getByTestId('agent-task-page').waitFor();
  await page.getByTestId('workflow-key-parameters').getByRole('button').filter({hasText:'Temperature'}).click();
  await page.evaluate(()=>{window.__test.deferEdit=true;window.__taskNode=document.querySelector('[data-testid="agent-task-page"]');window.__agentNode=document.querySelector('.agent-panel');});
  await page.locator('[data-field="temperature"] input').fill('350');await page.getByLabel('搜索流程参数').fill('Temperature');
  await page.locator('.agent-panel .composer textarea').fill('Keep this unsent draft');
  await page.getByRole('button',{name:'WSL',exact:true}).click();await page.locator('.terminal-holder .xterm').waitFor();await page.evaluate(()=>window.__terminalNode=document.querySelector('.terminal-holder .xterm'));
  await page.getByTestId('navigate-tools').click();await page.getByTestId('open-tool-assets').click();
  await page.setViewportSize({width:1100,height:760});await page.getByTestId('show-agent').click();assert.equal(await page.locator('.agent-panel .composer textarea').inputValue(),'Keep this unsent draft');
  await page.getByTestId('show-workspace').click();await page.locator('.workspace-tabs button').filter({hasText:'Fixture conversation workflow'}).first().click();
  assert.equal(await page.getByLabel('搜索流程参数').inputValue(),'Temperature');assert.equal(await page.locator('[data-field="temperature"] input').inputValue(),'350');
  assert.equal(await page.evaluate(()=>window.__taskNode===document.querySelector('[data-testid="agent-task-page"]')&&window.__agentNode===document.querySelector('.agent-panel')&&window.__terminalNode===document.querySelector('.terminal-holder .xterm')),true);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('studio.pending.flow')).temperature.value),350);
  assert.equal(await page.evaluate(()=>window.__test.settings.agentLayout),'center');assert.equal(await page.getByTestId('bottom-panel').evaluate(element=>element.style.height),'190px');
  await page.getByTestId('toggle-bottom-panel').click();await page.getByTestId('toggle-bottom-panel').click();assert.equal(await page.evaluate(()=>window.__terminalNode===document.querySelector('.terminal-holder .xterm')),true);
  assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='terminal.start').length),1);assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='terminal.close').length),0);await noWrites(page);
  await page.screenshot({path:path.join(out,'narrow-persistent-workflow.png')});
 });
 await check('unified-real-route-records-filter-and-exact-conversation-return',async page=>{
  await seeded(page);await connect(page);await page.getByTestId('navigate-runs').click();await page.locator('[data-job-key="cluster:run"]').waitFor();
  assert.equal(await page.locator('.job-record').count(),2);assert.equal(await page.locator('[data-job-key="local:run"] .badge').textContent(),'排队中');
  await page.getByLabel('计算位置筛选').selectOption('cluster');await page.getByLabel('任务状态筛选').selectOption('unknown');await page.getByLabel('任务时间筛选').selectOption('7');await page.getByLabel('搜索任务',{exact:true}).fill('1001');assert.equal(await page.locator('.job-record').count(),1);
  await page.getByRole('button',{name:'返回会话 · Current NEB workflow'}).click();await page.getByTestId('agent-task-page').waitFor();assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='conversation.select').at(-1).data.id),'codex:thread');
  assert.equal(await page.evaluate(()=>window.__test.cluster.status),'unknown');await noWrites(page);
 });
 await check('source-failure-keeps-independent-record-status-and-read-time',async page=>{
  await seeded(page);await connect(page);await page.getByTestId('navigate-runs').click();await page.locator('[data-job-key="cluster:run"]').waitFor();
  const before=await page.getByTestId('job-observation-cluster').locator('small').textContent();
  await page.evaluate(()=>window.__test.failedSources=['/api/assets']);await page.getByRole('button',{name:'同步记录',exact:true}).click();await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-job-key="local:run"] .badge').textContent(),'排队中');assert.equal(await page.getByTestId('job-observation-local').evaluate(element=>element.classList.contains('stale')),false);
  await page.evaluate(()=>window.__test.failedSources=['/api/cluster-runs']);await page.getByRole('button',{name:'同步记录',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-testid="job-observation-cluster"]').classList.contains('stale'));
  assert.equal(await page.locator('.job-record').count(),2);assert.equal(await page.locator('[data-job-key="cluster:run"] .badge').textContent(),'状态未知');assert.equal(await page.getByTestId('job-observation-cluster').locator('small').textContent(),before);
  await noWrites(page);await page.screenshot({path:path.join(out,'jobs-partial-offline.png')});
 });
 await check('failed-read-sources-pause-after-three-and-explicit-sync-recovers',async page=>{
  await page.evaluate(()=>{const interval=window.setInterval;window.setInterval=(fn,ms,...args)=>interval(fn,ms===2500||ms===5000?50:ms,...args);});
  await seeded(page);await connect(page);await page.getByTestId('navigate-runs').click();await page.locator('[data-job-key="cluster:run"]').waitFor();
  await page.evaluate(()=>{window.__test.failedSources=['/api/environments','/api/cluster-runs','/api/gpu'];window.__test.countsBefore=Object.fromEntries(['/api/environments','/api/cluster-runs','/api/gpu'].map(target=>[target,window.__test.calls.filter(call=>call.method==='worker.request'&&call.data.target===target).length]));});
  await page.waitForFunction(()=>document.querySelector('[data-testid="job-observation-cluster"]').textContent.includes('自动同步已暂停'));
  await page.waitForFunction(()=>window.__test.calls.filter(call=>call.method==='worker.request'&&call.data.target==='/api/gpu').length-window.__test.countsBefore['/api/gpu']===3);
  const counts=await page.evaluate(()=>Object.fromEntries(Object.keys(window.__test.countsBefore).map(target=>[target,window.__test.calls.filter(call=>call.method==='worker.request'&&call.data.target===target).length-window.__test.countsBefore[target]])));assert.deepEqual(counts,{'/api/environments':3,'/api/cluster-runs':3,'/api/gpu':3});
  const localBefore=await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='worker.request'&&call.data.target==='/api/runs').length);await page.waitForTimeout(180);
  assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.keys(window.__test.countsBefore).map(target=>[target,window.__test.calls.filter(call=>call.method==='worker.request'&&call.data.target===target).length-window.__test.countsBefore[target]]))),counts);
  assert(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='worker.request'&&call.data.target==='/api/runs').length)>localBefore);
  assert.equal(await page.getByTestId('job-observation-local').evaluate(element=>element.classList.contains('stale')),false);
  await page.evaluate(()=>window.__test.failedSources=[]);await page.getByRole('button',{name:'同步记录',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-testid="job-observation-cluster"]').classList.contains('stale'));
  assert.equal(await page.locator('[data-job-key="local:run"] .badge').textContent(),'排队中');await noWrites(page);
 });
 await check('final-css-large-center-long-history-no-horizontal-overflow',async page=>{
  await page.setViewportSize({width:1100,height:760});await seeded(page,{legacy:true,large:true,longTitles:true});await connect(page);await page.locator('.conversation-project>button>span').first().waitFor();
  const longTitle='Long conversation title '.repeat(20)+'END',longProject='Long project name '.repeat(15)+'END';
  const sidebar=page.locator('.sidebar'),history=page.getByTestId('conversation-sidebar'),conversation=page.locator('.conversation-item').first(),title=conversation.locator(':scope > span:nth-child(2)'),projectTitle=page.locator('.conversation-project>button>span').first();
  const bounds=await sidebar.boundingBox();assert(bounds.width>=240&&bounds.width<=300);assert.equal(await page.locator('.workspace-shell').evaluate(element=>element.classList.contains('agent-center')),true);
  assert.equal(await conversation.getAttribute('title'),longTitle);assert.equal(await projectTitle.getAttribute('title'),longProject);
  for(const label of [title,projectTitle]){const geometry=await label.evaluate(element=>{const style=getComputedStyle(element);return {ellipsis:style.textOverflow,nowrap:style.whiteSpace,overflow:style.overflow,scroll:element.scrollWidth,client:element.clientWidth,font:parseFloat(style.fontSize)};});assert.equal(geometry.ellipsis,'ellipsis');assert.equal(geometry.nowrap,'nowrap');assert.equal(geometry.overflow,'hidden');assert(geometry.scroll>geometry.client);assert(geometry.font>=18);}
  assert.equal(await history.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);assert.equal(await sidebar.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true);
  const historyBox=await history.boundingBox(),conversationBox=await conversation.boundingBox();assert(conversationBox.y>=historyBox.y&&conversationBox.y+conversationBox.height<=historyBox.y+historyBox.height);
  const remove=page.locator('.conversation-row').first().locator('.conversation-delete');assert.equal(await remove.isVisible(),true);assert.equal(await remove.isEnabled(),true);const removeBox=await remove.boundingBox();assert(removeBox.x+removeBox.width<=bounds.x+bounds.width);
  await remove.click();await page.getByRole('dialog',{name:'删除对话',exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.evaluate(()=>window.__test.calls.some(call=>call.method==='conversation.delete')),false);
  await noWrites(page);await page.screenshot({path:path.join(out,'final-css-large-center-long-history.png')});
 });
 await check('large-type-narrow-navigation-and-expanded-empty-queue-wrap',async page=>{
  await page.setViewportSize({width:1100,height:760});await seeded(page,{legacy:true,large:true});
  const visible=await page.locator('.conversation-item').evaluateAll(elements=>elements.filter(element=>{const b=element.getBoundingClientRect(),p=element.closest('.conversation-sidebar').getBoundingClientRect();return b.top>=p.top&&b.bottom<=p.bottom;}).length);assert(visible>=1);
  await page.getByTestId('new-conversation').click();await page.waitForFunction(()=>document.activeElement===document.querySelector('.composer textarea'));await page.getByTestId('show-workspace').click();
  await page.getByRole('button',{name:'运行队列',exact:false}).click();
  const fits=await page.locator('.queue-empty small').evaluate(element=>{const a=element.getBoundingClientRect(),p=element.closest('.bottom-panel').getBoundingClientRect();return a.width<=p.width&&a.bottom<=p.bottom&&getComputedStyle(element).whiteSpace==='normal';});assert.equal(fits,true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await noWrites(page);await page.screenshot({path:path.join(out,'large-light-narrow-queue.png')});
 });
}finally{await fs.writeFile(path.join(out,'results.json'),JSON.stringify({scope:'Synthetic renderer software only; fixture IPC, no model turn, real worker, SSH or scientific execution.',results},null,2));await browser.close();await server.close();}
console.log(JSON.stringify(results,null,2));if(results.some(result=>result.status!=='passed'))process.exitCode=1;
