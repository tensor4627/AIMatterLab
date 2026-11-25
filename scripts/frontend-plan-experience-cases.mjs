// Actual React and DOM interactions; all provider/worker replies are synthetic.
import assert from 'node:assert/strict';
import path from 'node:path';

export async function frontendPlanExperienceCases({check,out}){
 const shot=(page,name)=>page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
 async function app(page,{theme='dark',large=false}={}){
  await page.evaluate(async({theme,large})=>{
   const f=window.__test,original=window.studio.invoke;
   f.settings={...f.settings,theme,...large?{fontSize:20,minimumFontSize:18,chatFontSize:22}:{}};
   f.conversations=['first','second'].map(id=>({id:'codex:'+id,threadId:id,provider:'codex',name:'Saved '+id,projectId:'project',taskId:null,updatedAt:1}));
   localStorage.setItem('studio.conversation','codex:first');
   f.initialRun=JSON.stringify(f.run);
   window.studio.invoke=async(method,data)=>{
    if(method==='conversation.list')return f.conversations;
    if(method==='compute.resource.status')return {schemaVersion:1,kind:null,status:'none',selectionId:null};
    if(method==='conversation.groups')return [{id:'group',name:'Research chats'}];
    if(method==='conversation.select')return data.new?{fresh:true}:f.conversations.find(c=>c.id===data.id);
    if(method==='conversation.remember')return f.conversations.find(c=>c.threadId===data.threadId);
    if(method==='agent.rpc'&&['thread/resume','thread/read'].includes(data.method))return {model:'fixture-model',thread:{id:data.params.threadId,turns:[{items:Array.from({length:30},(_,i)=>({id:'m-'+i,type:'agentMessage',text:data.params.threadId+' saved message '+i+'\n'.repeat(2)+'Synthetic history retained.'}))}]}};
    return original(method,data);
   };
   return window.renderTest('App');
  },{theme,large});
  await page.locator('.chat-scroll .message').first().waitFor();
 }
 async function noExecution(page){
  assert.deepEqual(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='task.execute'||c.method==='agent.rpc'&&['turn/start','turn/interrupt'].includes(c.data?.method)||c.method==='worker.request'&&['/api/run/submit','/api/runs/prepare','/api/run/resume','/api/cluster/submit'].includes(c.data?.target))),[]);
  assert.equal(await page.evaluate(()=>JSON.stringify(window.__test.run)===window.__test.initialRun),true);
 }
 const nav=(page,id)=>page.locator('[data-testid="navigate-'+id+'"]:visible');

 await check('settings-agent-approval-modes',async page=>{
  await app(page);
  await page.evaluate(()=>{
   const original=window.studio.invoke;
   window.studio.invoke=async(method,data)=>method==='compute.managed.snapshot'?{resources:[{
    resourceId:'ssh:fixture',profileId:'fixture',kind:'ssh',name:'Developer test cluster',
    workspace:{account:'tester',hostname:'test.invalid',root:'/scratch/tester',workspaceId:'c'.repeat(64)}
   }],conversations:[],sources:[]}:original(method,data);
  });
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'工作台设置',exact:true});
  await dialog.getByRole('button',{name:'Agent',exact:true}).click();
  const mode=dialog.getByTestId('agent-approval-mode'),workspace=dialog.getByTestId('developer-compute-workspace');
  const save=dialog.getByRole('button',{name:'保存设置',exact:true});
  const saved=dialog.getByText('设置已保存',{exact:true});
  const writes=()=>page.evaluate(()=>window.__test.calls.filter(c=>c.method==='settings').map(c=>[c.data.agentApprovalMode,c.data.developerComputeWorkspaceId]));
  assert.equal(await mode.inputValue(),'manual');
  assert.equal(await workspace.count(),0);
  await mode.selectOption('auto');
  await save.click();
  await saved.waitFor();
  assert.deepEqual((await writes()).at(-1),['auto',null]);

  await mode.selectOption('full');
  const before=(await writes()).length;
  await save.click();
  await dialog.getByText('请为完全权限选择一个已验证的 SSH 工作区。',{exact:true}).waitFor();
  assert.equal((await writes()).length,before);
  await workspace.selectOption('c'.repeat(64));
  await save.click();
  await saved.waitFor();
  assert.deepEqual((await writes()).at(-1),['full','c'.repeat(64)]);
  await shot(page,'agent-approval-settings');

  await mode.selectOption('manual');
  assert.equal(await workspace.count(),0);
  await save.click();
  await saved.waitFor();
  assert.deepEqual((await writes()).at(-1),['manual',null]);
  await noExecution(page);
 });

 await check('settings-agent-approval-legacy-workspace',async page=>{
  await page.evaluate(()=>{window.__test.settings.developerComputeWorkspaceId='c'.repeat(64);});
  await app(page);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'工作台设置',exact:true});
  await dialog.getByRole('button',{name:'Agent',exact:true}).click();
  assert.equal(await dialog.getByTestId('agent-approval-mode').inputValue(),'full');
  assert.equal(await dialog.getByTestId('developer-compute-workspace').inputValue(),'c'.repeat(64));
  await dialog.getByText('等待选定的 SSH 工作区重新连接',{exact:true}).waitFor({state:'attached'});
  await dialog.getByRole('button',{name:'保存设置',exact:true}).click();
  await dialog.getByText('设置已保存',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__test.settings.developerComputeWorkspaceId),'c'.repeat(64));
  await noExecution(page);
 });

 await check('planning-retains-saved-project-and-session-directory',async page=>{
  await page.evaluate(async()=>{
   const {default:Agent}=await import('/frontend/features/conversations/Agent.tsx');
   const test=window.__test,invoke=window.studio.invoke,owner={id:'codex:fixture-thread',threadId:'fixture-thread',provider:'codex',name:'Saved project chat',projectId:'original-project',taskId:null,updatedAt:1};
   const sessionSelection={nonce:'restore-original',conversation:owner};
   test.activeProject=owner.projectId;
   test.conversation={...owner};
   window.studio.invoke=async(method,data)=>{
    if(method==='conversation.remember')return test.conversation;
    if(method==='compute.resourceWorkspace.session')return {status:'verified',profileId:'original-profile',resourceId:'original-resource',workspaceId:'original-workspace',
     root:'/fixture/AIMatterLab',path:'/fixture/AIMatterLab/workfile/2026-11-20/task-1',date:'2026-11-20',taskNumber:1,checkedAt:1};
    if(method==='agent.rpc'&&['thread/resume','thread/read'].includes(data.method))return {model:'fixture-model',thread:{id:owner.threadId,turns:[{items:[{type:'agentMessage',id:'prior',text:'Original discussion retained'}]}]}};
    return invoke(method,data);
   };
   function Host(){
    const [planningMode,setPlanningMode]=window.React.useState(false);
    return window.React.createElement(Agent,{sessionSelection,selectedLocalConversation:owner,workspaceProfileId:'original-profile',
     projectId:'another-workbench-project',planningMode,onPlanningModeChange:setPlanningMode,onError:error=>{test.planningError=String(error);},context:'{}'});
   }
   window.testRoot.render(window.React.createElement(Host));
  });
  await page.getByText('Original discussion retained',{exact:true}).waitFor();
  const workspace=page.getByTestId('agent-session-workspace');
  await workspace.locator('summary').click();
  const directory='/fixture/AIMatterLab/workfile/2026-11-20/task-1';
  assert.equal(await page.getByTestId('session-workspace-path').innerText(),directory);
  const before=await page.evaluate(()=>window.__test.calls.length);
  await page.getByTestId('agent-planning-mode').check();
  assert.equal(await page.evaluate(offset=>window.__test.calls.slice(offset).some(call=>call.method==='task.create'||call.method==='agent.rpc'&&call.data.method==='turn/start'),before),false);
  await page.locator('.composer textarea').fill('继续原项目，只制定流程，暂不执行');
  await page.locator('.composer .send').click();
  await page.waitForFunction(()=>window.__test.calls.some(call=>call.method==='agent.rpc'&&call.data.method==='turn/start')||window.__test.planningError);
  const observed=await page.evaluate(()=>({calls:window.__test.calls,error:window.__test.planningError,projectId:window.__test.activeProject}));
  assert.equal(observed.error,undefined);
  const created=observed.calls.filter(call=>call.method==='task.create').map(call=>call.data);
  assert.equal(created.length,1);
  assert.equal(created[0].projectId,observed.projectId);
  assert.equal(created[0].threadId,'fixture-thread');
  const turn=observed.calls.find(call=>call.method==='agent.rpc'&&call.data.method==='turn/start');
  assert.equal(turn.data.params.planningMode,true);
  assert.equal(turn.data.params.threadId,'fixture-thread');
  assert.equal(await page.getByTestId('session-workspace-path').innerText(),directory);
  assert.equal(observed.calls.some(call=>['task.execute','task.roadmap.confirm','compute.resource.activate'].includes(call.method)||call.method==='agent.rpc'&&call.data.method==='thread/start'),false);
  await shot(page,'planning-retains-saved-project-and-session-directory');
 });

 await check('planning-execution-preview-shows-existing-session-directory',async page=>{
  const directory='/fixture/AIMatterLab/workfile/2026-11-20/task-1';
  await page.evaluate(async directory=>{
   const {default:RoadmapExecutionPanel}=await import('/frontend/features/workflows/RoadmapExecutionPanel.tsx');
   const test=window.__test,invoke=window.studio.invoke;
   window.studio.invoke=async(method,data)=>{
    if(method==='task.roadmap.list')return [];
    if(method==='task.roadmap.preview'){
     test.calls.push({method,data});
     return {snapshot_sha256:'a'.repeat(64),snapshot:{task_id:data.taskId,name:'Saved plan',original_request:'Continue the original flow',
      workspace:{choice:'session',id:'kept-workspace',root:directory},target:{project_id:'original-project',cluster_id:'original-queue',max_seconds:120},
      initial:{},steps:[],goals:[]}};
    }
    return invoke(method,data);
   };
   window.testRoot.render(window.React.createElement(RoadmapExecutionPanel,{taskId:'planned-task',revision:'1',connected:true,configured:true,
    cluster:true,nodes:[],environments:[],onRun(){}}));
  },directory);
  await page.getByTestId('roadmap-execution').locator('summary').first().click();
  await page.getByTestId('roadmap-preview').click();
  await page.getByTestId('roadmap-confirm').waitFor();
  assert.equal(await page.getByText(directory,{exact:true}).isVisible(),true);
  const operations=await page.evaluate(()=>window.__test.calls.filter(call=>call.method.startsWith('task.roadmap.')));
  assert.deepEqual(operations.map(call=>call.method),['task.roadmap.preview']);
  await shot(page,'planning-execution-preview-shows-existing-session-directory');
 });

 await check('plan-experience-navigation-preserves-session-draft-and-reading-position',async page=>{
  await app(page);await page.locator('.composer textarea').fill('Unsent first conversation draft');
  await page.locator('.chat-scroll').evaluate(node=>{node.scrollTop=30;node.dispatchEvent(new Event('scroll'));});
  const before=await page.locator('.chat-scroll').evaluate(node=>node.scrollTop);
  await nav(page,'runs').click();await page.getByTestId('jobs-page').waitFor();assert.equal(await nav(page,'runs').getAttribute('aria-current'),'page');
  await nav(page,'tools').click();await page.getByTestId('tools-directory').waitFor();assert.equal(await nav(page,'tools').getAttribute('aria-current'),'page');
  assert.equal(await page.locator('.composer textarea').inputValue(),'Unsent first conversation draft');
  assert.equal(await page.locator('.chat-scroll').evaluate(node=>node.scrollTop),before);
  assert.equal(await page.locator('.composer textarea').count(),1);
  await page.getByTestId('agent-history').click();const dialog=page.getByRole('dialog',{name:'历史会话',exact:true});
  await dialog.locator('.conversation-item').filter({hasText:'Saved second'}).click();await page.locator('.chat-scroll').getByText(/second saved message 0/).waitFor();
  await page.locator('.composer textarea').fill('Second conversation draft');
  await page.getByTestId('agent-history').click();await dialog.locator('.conversation-item').filter({hasText:'Saved first'}).click();
  await page.waitForFunction(()=>document.querySelector('.composer textarea')?.value==='Unsent first conversation draft');
  await page.getByRole('button',{name:'收起助手',exact:true}).click();assert.equal(await page.locator('.agent-panel').isVisible(),false);
  await page.getByRole('button',{name:'切换 Agent 面板',exact:true}).click();assert.equal(await page.locator('.composer textarea').inputValue(),'Unsent first conversation draft');
  await noExecution(page);await shot(page,'plan-dark-history-and-navigation');
 });

 await check('plan-experience-service-version-disclosure-is-optional-and-never-reconnects',async page=>{
  await page.setViewportSize({width:1024,height:768});await app(page,{large:true});const notice=page.getByTestId('worker-service-version'),summary=page.getByTestId('worker-service-version-summary');await summary.waitFor();assert.equal(await notice.getAttribute('open'),null);const calls=await page.evaluate(()=>window.__test.calls.length);const closed=await notice.boundingBox();assert(closed.height<80,'collapsed service notice stays compact');await summary.focus();await page.keyboard.press('Enter');assert.notEqual(await notice.getAttribute('open'),null);assert(await notice.locator('p').isVisible());await page.keyboard.press('Enter');assert.equal(await notice.getAttribute('open'),null);const input=await page.locator('.composer textarea').boundingBox();assert(input&&input.y+input.height<=768);assert.equal(await page.getByRole('button',{name:'新建计算',exact:true}).isVisible(),true);assert.equal(await page.evaluate(before=>window.__test.calls.slice(before).some(call=>['worker.connect','compute.connection.connect','task.execute','task.deployment.prepare'].includes(call.method)),calls),false);await noExecution(page);await shot(page,'plan-service-version-collapsed');
 });

 for(const width of [1366,1024,640])for(const theme of ['dark','light'])await check('plan-experience-layout-'+width+'-'+theme,async page=>{
  await page.setViewportSize({width,height:768});await app(page,{theme,large:width===1024});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const panels=await page.locator('.agent-panel').isVisible();assert.equal(panels,true);
  if(width>=1024){assert.equal(await page.locator('.main-column').isVisible(),true);if(width===1024)assert.equal(await page.locator('.sidebar').isVisible(),false);}
  else{await page.getByTestId('show-workspace').click();assert.equal(await page.locator('.main-column').isVisible(),true);await page.getByTestId('show-agent').click();await page.getByRole('button',{name:'收起助手',exact:true}).click();await nav(page,'runs').click();await page.getByRole('button',{name:'切换 Agent 面板',exact:true}).click();assert.equal(await page.locator('.agent-panel').isVisible(),true);}
  const input=await page.locator('.composer textarea').boundingBox();assert(input&&input.x>=0&&input.x+input.width<=width+1&&input.y+input.height<=768,'composer remains reachable');
  if(width===1366){await page.getByRole('button',{name:'收起导航',exact:true}).click();assert.equal(await page.locator('.sidebar').isVisible(),false);await page.getByRole('button',{name:'展开导航',exact:true}).click();assert.equal(await page.locator('.sidebar').isVisible(),true);}
  await noExecution(page);await shot(page,'plan-'+width+'-'+theme);
 });

 await check('plan-experience-status-cards-preserve-all-other-filters',async page=>{
  await page.evaluate(async()=>{const {default:JobsPage}=await import('/frontend/features/runs/JobsPage.tsx');await import('/frontend/app/frontend-refinement.css');const f=window.__test;f.initialRun=JSON.stringify(f.run);const now=Date.now()/1000;
   window.testRoot.render(window.React.createElement(JobsPage,{local:[{...f.run,id:'local',created_at:now,status:'running'}],cluster:[{...f.run,id:'cluster',kind:'cluster-run',created_at:now,status:'queued'}],observations:{local:{loaded:true,at:now,stale:false},cluster:{loaded:true,at:now,stale:true}},projects:[f.project],projectId:f.project.id,tasks:[],conversations:[],worker:true,busy:false,onOpen:()=>{},onConversation:()=>{},onRefresh:()=>{}}));});
  await page.getByLabel('计算位置筛选',{exact:true}).selectOption('cluster');await page.locator('.jobs-more-filters>summary').click();await page.getByLabel('任务时间筛选',{exact:true}).selectOption('7');await page.getByLabel('任务项目筛选',{exact:true}).selectOption('current');await page.getByLabel('搜索任务',{exact:true}).fill('Fixture');
  await page.getByTestId('jobs-overview-running').click();assert.equal(await page.locator('.job-record').count(),0);
  assert.equal(await page.getByLabel('计算位置筛选',{exact:true}).inputValue(),'cluster');assert.equal(await page.getByLabel('任务时间筛选',{exact:true}).inputValue(),'7');assert.equal(await page.getByLabel('任务项目筛选',{exact:true}).inputValue(),'current');assert.equal(await page.getByLabel('搜索任务',{exact:true}).inputValue(),'Fixture');
  await page.getByTestId('jobs-overview-queued').click();assert.equal(await page.locator('.job-record').count(),1);await page.getByRole('button',{name:'清除筛选',exact:true}).click();assert.equal(await page.locator('.job-record').count(),2);await noExecution(page);
 });

 await check('plan-experience-result-tabs-keep-selected-file-and-execution-gates',async page=>{
  await page.evaluate(()=>{const f=window.__test;f.run={...f.run,engine:'nep.train',status:'succeeded'};f.initialRun=JSON.stringify(f.run);f.responses={
   '/api/run/collect':()=>({run:f.run.id,artifacts:[{name:'force.out',size:40}]}),'/api/run/file':()=>({text:'1 2\n2 3\n3 4\n',offset:12,size:12}),'/api/inspect':()=>({status:'not_run',scope:'synthetic regression fixture'})};
   return window.renderTest('RunDetail',{run:f.run,connected:true,onRefresh:()=>{},onError:e=>{throw e;}});});
  await page.getByRole('tab',{name:'结果',exact:true}).click();await page.locator('.file-list').getByRole('button').click();await page.getByRole('button',{name:'曲线',exact:true}).first().click();assert.equal(await page.getByRole('tab',{name:'结果',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('button',{name:'文件',exact:true}).click();assert.match(await page.locator('.file-list .active').innerText(),/force.out/);
  await page.getByRole('button',{name:'评估指标',exact:true}).click();assert.equal(await page.getByRole('tab',{name:'结果',exact:true}).getAttribute('aria-selected'),'true');assert.match(await page.locator('.report').innerText(),/not_run/);
  await page.getByRole('tab',{name:'概览',exact:true}).click();assert.match(await page.locator('.run-overview').innerText(),/env/);await page.getByRole('tab',{name:'输入',exact:true}).click();assert.match(await page.locator('.input-record').innerText(),/300/);await noExecution(page);
 });

 await check('plan-experience-settings-preview-cancel-and-save',async page=>{
  await app(page);await page.getByRole('button',{name:'设置',exact:true}).click();const dialog=page.getByRole('dialog',{name:'工作台设置',exact:true});
  await dialog.locator('select').first().selectOption('light');await dialog.getByRole('status').getByText('未保存修改',{exact:true}).waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.getByRole('button',{name:'设置',exact:true}).click();await dialog.locator('select').first().selectOption('light');await dialog.getByRole('button',{name:'保存设置',exact:true}).click();await dialog.getByText('设置已保存',{exact:true}).waitFor();await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await noExecution(page);
 });
}
