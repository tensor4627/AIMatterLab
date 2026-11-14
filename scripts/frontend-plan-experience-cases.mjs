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
  await page.getByLabel('计算位置筛选',{exact:true}).selectOption('cluster');await page.getByLabel('任务时间筛选',{exact:true}).selectOption('7');await page.getByLabel('任务项目筛选',{exact:true}).selectOption('current');await page.getByLabel('搜索任务',{exact:true}).fill('Fixture');
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
