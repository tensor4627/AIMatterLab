import assert from 'node:assert/strict';
import path from 'node:path';

async function selectedServiceApp(page,{unavailable=false}={}){
 await page.evaluate(async unavailable=>{
  const f=window.__test,original=window.studio.invoke;f.recordSource='A';f.recordAvailable=!unavailable;f.recordIdentityOverride=null;f.recordHolds={};f.recordErrors=[];
  f.recordChat={id:'codex:record-observer',provider:'codex',threadId:'record-observer',name:'Read existing history',projectId:null,taskId:null};localStorage.setItem('studio.conversation',f.recordChat.id);localStorage.setItem('studio.section','runs');
  f.recordResource=id=>({schemaVersion:2,selectionId:'selection-'+id,kind:'ssh-connection',connectionId:'connection-'+id,profileId:'profile-'+id,profileVersion:1,sessionId:null,status:'selected',connectionStatus:'authenticated',authentication:'verified',operator:'agent',alive:true,workflowReady:true,agentReady:true,capabilities:{terminal:{status:'ready'},service:{status:'connected',workflowReady:true,agentReady:true}}});
  f.recordStatus=id=>({status:'connected',checkedAt:1,sourceKind:'ssh',connectionId:'connection-'+id,profileId:'profile-'+id,profileVersion:1,sourceId:f.recordIdentityOverride||(id==='A'?'a':'b').repeat(64),serviceVersion:'different'});
  f.history=id=>({...f.run,id:'history-'+id,name:'History '+id,status:'draft',project_id:'saved-project',environment_id:'saved-env',directory:'/saved/'+id,inputs:{'run.py':'/saved/run.py'}});
  f.clusterHistory=id=>({...f.history(id),id:'cluster-history-'+id,name:'Cluster history '+id,kind:'cluster-run',cluster:{scheduler:'slurm'},cluster_id:'cluster',resources:{cpus:1},snapshots:[],script:'# Saved script only',validation:{status:'not_run'},scientific_validation:{status:'not_run'},job_id:null});
  window.studio.invoke=async(method,data)=>{
   if(method==='conversation.list')return [f.recordChat];if(method==='conversation.select'||method==='conversation.remember')return f.recordChat;
   if(method==='task.list')return [];
   if(method==='worker.restore'){f.calls.push({method,data});return {status:'disconnected',reason:'project_missing',conversationId:f.recordChat.id,checkedAt:1};}
   if(method==='worker.status'){f.calls.push({method,data});return f.recordAvailable?f.recordStatus(f.recordSource):{status:'unknown',checkedAt:1};}
   if(method==='compute.resource.status')return f.recordResource(f.recordSource);
   if(method==='compute.sshConnection.list')return {connections:[]};
   if(method==='sharedTerminal.list')return {sessions:[]};
   if(method==='agent.rpc'&&['thread/resume','thread/read'].includes(data.method))return {model:'fixture-model',thread:{id:data.params.threadId,turns:[{items:[{id:'saved-history',type:'agentMessage',text:'Preserved Agent history'}]}]}};
   if(method==='worker.request'&&['/api/runs','/api/cluster-runs','/api/run/status','/api/cluster/status'].includes(data.target)){
    f.calls.push({method,data});const id=f.recordSource,hold=f.recordHolds[id];if(hold&&['/api/runs','/api/cluster-runs'].includes(data.target))await new Promise(resolve=>hold.push(resolve));
    if(data.target==='/api/runs'){if(f.recordIndexUnavailable)throw Error('Synthetic index read unavailable');return [f.history(id)];}if(data.target==='/api/cluster-runs')return [f.clusterHistory(id)];if(data.target==='/api/run/status')return f.history(id);return f.clusterHistory(id);
   }
   return original(method,data);
  };return window.renderTest('App');
 },unavailable);
 await page.getByText('Preserved Agent history',{exact:true}).waitFor();await page.locator('.composer textarea').fill('Keep my unsent history question');await page.locator('nav [data-testid="navigate-runs"]:visible').click();await page.getByTestId('jobs-page').waitFor();
}
const assertNoExecutionMutations=async page=>assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>['worker.connect','compute.sshConnection.open','compute.resource.activate','compute.profiles.save','task.execute','task.authoring.bindWorker'].includes(c.method)||c.method==='agent.rpc'&&c.data?.method==='turn/start'||c.method==='worker.request'&&/\/(submit|cancel|resume|revise|validate|prepare)$/.test(c.data?.target||'')).length),0);

export async function frontendSelectedServiceRecordCases({check,out}){
 for(const width of [1024,1366])await check('selected-service-records-experience-workbench-'+width,async page=>{
  await page.setViewportSize({width,height:768});await selectedServiceApp(page);
  await page.waitForFunction(()=>document.querySelector('.job-record-open')?.disabled===false);
  const detail=page.locator('.jobs-more-filters');assert.equal(await detail.evaluate(node=>node.open),false);
  await page.mouse.move(0,0);await page.keyboard.press('Escape');
  const sources=page.locator('.jobs-sources');assert.equal(await sources.evaluate(node=>node.open),false);
  const first=await page.locator('.job-record-open').first().boundingBox(),content=await page.locator('.workspace-content').boundingBox();
  assert(first&&content&&first.y+first.height<=content.y+content.height+1,'The first record can be opened in the initial viewport');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(out,'workbench-jobs-'+width+'.png')});await assertNoExecutionMutations(page);
 });
 await check('selected-service-records-experience-open-cluster-switch-with-reused-id',async page=>{
  await selectedServiceApp(page);
  await page.evaluate(()=>{const f=window.__test,original=f.clusterHistory;f.clusterHistory=id=>({...original(id),id:'shared-cluster-run'});});
  await page.getByRole('button',{name:'同步记录',exact:true}).click();
  await page.locator('[data-job-key="cluster:shared-cluster-run"] .job-record-open').click();
  await page.getByRole('heading',{name:'Cluster history A',exact:true}).waitFor();
  await page.evaluate(()=>{const f=window.__test;f.recordSource='B';f.events.forEach(fn=>fn({method:'studio/computeResourceChanged'}));});
  await page.getByTestId('jobs-page').waitFor();
  await page.locator('[data-job-key="cluster:shared-cluster-run"]').getByText('Cluster history B',{exact:true}).waitFor();
  assert.equal(await page.getByTestId('cluster-review').count(),0);assert.equal(await page.locator('.composer textarea').inputValue(),'Keep my unsent history question');await assertNoExecutionMutations(page);
 });
 await check('selected-service-records-experience-uncertain-cancel-receipt',async page=>{
  await selectedServiceApp(page);
  await page.evaluate(()=>{const f=window.__test,original=f.clusterHistory;f.clusterHistory=id=>({...original(id),status:'unknown',cancellation:{status:'unconfirmed',signal_sent:null}});});
  await page.locator('[data-job-key="cluster:cluster-history-A"] .job-record-open').click();
  await page.getByTestId('cluster-cancellation-receipt').getByText('撤销命令的送达情况未知，请核对原作业。',{exact:true}).waitFor();
  await assertNoExecutionMutations(page);
 });
 await check('selected-service-records-experience-recent-queue-and-command-open-readonly-history',async page=>{
  await selectedServiceApp(page);
  await page.evaluate(()=>{const f=window.__test,original=f.history;f.history=id=>({...original(id),status:'queued'});});
  await page.getByRole('button',{name:'同步记录',exact:true}).click();
  await page.locator('nav [data-testid="navigate-home"]:visible').click();
  const recent=page.locator('.recent-runs').getByRole('button',{name:/^History A/});
  await recent.click();
  await page.getByTestId('run-readonly-observation').waitFor();
  await page.locator('nav [data-testid="navigate-runs"]:visible').click();
  await page.locator('.bottom-tabs button').filter({hasText:'运行队列'}).click();
  await page.locator('.queue-strip button').filter({has:page.getByText('History A',{exact:true})}).click();
  await page.getByTestId('run-readonly-observation').waitFor();
  await page.keyboard.press('Control+k');await page.getByRole('textbox',{name:'搜索页面、引擎或任务…',exact:true}).fill('Cluster history A');
  await page.locator('.command-list button').filter({hasText:'Cluster history A'}).click();
  await page.getByRole('heading',{name:'Cluster history A',exact:true}).waitFor();
  await page.getByTestId('run-readonly-observation').waitFor();await assertNoExecutionMutations(page);
  assert.equal(await page.locator('.composer textarea').inputValue(),'Keep my unsent history question');
 });
 await check('selected-service-records-experience-unbound-history-and-readonly-details',async page=>{
  await selectedServiceApp(page);const local=page.locator('.job-record-open').filter({has:page.getByText('History A',{exact:true})});await page.waitForFunction(()=>!document.querySelector('.job-record-open')?.disabled);await page.getByText('运行记录可查看；提交、续算等操作需匹配原服务与权限。',{exact:true}).waitFor();const version=page.getByTestId('worker-service-version');assert.equal(await version.getAttribute('data-version'),'different');assert.equal(await version.evaluate(node=>node.open),false);await page.getByTestId('worker-service-version-summary').click();assert.match(await version.innerText(),/当前连接设置.*更新作业服务/);assert.doesNotMatch(await version.innerText(),/本地 WSL/);await page.getByTestId('worker-service-version-summary').click();assert.equal(await page.getByText('作业服务未连接；请先恢复原服务，再打开运行记录。',{exact:true}).isVisible().catch(()=>false),false);
  const before=await page.evaluate(()=>({restores:window.__test.calls.filter(c=>c.method==='worker.restore').length,reads:window.__test.calls.filter(c=>c.method==='worker.request'&&c.data.target==='/api/runs').length}));await page.getByRole('button',{name:'同步记录',exact:true}).click();await page.waitForFunction(count=>window.__test.calls.filter(c=>c.method==='worker.request'&&c.data.target==='/api/runs').length>count,before.reads);await page.waitForFunction(()=>!document.querySelector('.job-record-open')?.disabled);assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='worker.restore').length),before.restores);
  await local.click();await page.getByTestId('run-readonly-observation').waitFor();assert.equal(await page.getByRole('button',{name:'提交计算',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'验证',exact:true}).isDisabled(),true);await page.getByRole('tab',{name:'输入',exact:true}).click();assert.match(await page.locator('.input-record').innerText(),/run.py/);assert.equal(await page.locator('.composer textarea').inputValue(),'Keep my unsent history question');await page.screenshot({path:path.join(out,'selected-service-local-readonly.png')});
  await page.locator('nav [data-testid="navigate-runs"]:visible').click();await page.waitForFunction(()=>!document.querySelector('.job-record-open')?.disabled);await page.locator('.job-record-open').filter({has:page.getByText('Cluster history A',{exact:true})}).click();await page.getByTestId('cluster-review').waitFor();await page.getByTestId('run-readonly-observation').waitFor();assert.equal(await page.getByRole('button',{name:'审阅完成，提交到集群',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('checkbox',{name:'修改参数并创建新快照',exact:true}).isDisabled(),true);assert.match(await page.locator('.batch-script').innerText(),/Saved script only/);await assertNoExecutionMutations(page);assert.equal(await page.locator('.composer textarea').inputValue(),'Keep my unsent history question');await page.screenshot({path:path.join(out,'selected-service-cluster-readonly.png')});
 });
 await check('selected-service-records-experience-switch-race-and-wrong-source-click',async page=>{
  await selectedServiceApp(page);await page.waitForFunction(()=>!document.querySelector('.job-record-open')?.disabled);await page.evaluate(()=>window.__test.recordHolds.A=[]);await page.getByRole('button',{name:'同步记录',exact:true}).click();await page.waitForFunction(()=>window.__test.recordHolds.A.length===2);
  await page.evaluate(()=>{const f=window.__test;f.recordSource='B';f.recordHolds.B=[];f.events.forEach(fn=>fn({method:'studio/computeResourceChanged'}));});await page.getByText('其他作业服务的上次记录',{exact:true}).first().waitFor();assert.equal(await page.locator('.job-record-open').first().isDisabled(),true);await page.waitForFunction(()=>window.__test.recordHolds.B.length===2);await page.evaluate(()=>{const f=window.__test,held=f.recordHolds.B;delete f.recordHolds.B;held.forEach(done=>done());});await page.getByText('History B',{exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.job-record-open')?.disabled);await page.evaluate(()=>{const f=window.__test,held=f.recordHolds.A;delete f.recordHolds.A;held.forEach(done=>done());});await page.waitForTimeout(100);assert.equal(await page.getByText('History A',{exact:true}).count(),0);
  await page.evaluate(()=>window.__test.recordIdentityOverride='c'.repeat(64));const before=await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='worker.request'&&c.data.target==='/api/run/status').length);await page.locator('.job-record-open').filter({has:page.getByText('History B',{exact:true})}).click();await page.getByText('当前作业服务尚未核对或不可用；可同步记录重新检查。',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='worker.request'&&c.data.target==='/api/run/status').length),before);assert.equal(await page.getByTestId('run-readonly-observation').count(),0);await assertNoExecutionMutations(page);await page.screenshot({path:path.join(out,'selected-service-source-mismatch.png')});
 });
 await check('selected-service-records-experience-unavailable-is-truthful-and-readonly-recheck',async page=>{
  await selectedServiceApp(page,{unavailable:true});await page.getByText('当前作业服务尚未核对或不可用；可同步记录重新检查。',{exact:true}).waitFor();assert.equal(await page.locator('.job-record-open').count(),0);assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='worker.request'&&['/api/runs','/api/cluster-runs'].includes(c.data.target)).length),0);const sync=page.getByRole('button',{name:'同步记录',exact:true});assert.equal(await sync.isEnabled(),true);await sync.click();await page.getByText('当前作业服务尚未核对或不可用；可同步记录重新检查。',{exact:true}).waitFor();await assertNoExecutionMutations(page);assert.equal(await page.locator('.composer textarea').inputValue(),'Keep my unsent history question');await page.screenshot({path:path.join(out,'selected-service-unavailable.png')});
 });
 await check('selected-service-records-experience-event-storm-and-stale-same-source-open',async page=>{
  await selectedServiceApp(page);await page.waitForFunction(()=>!document.querySelector('.job-record-open')?.disabled);const calls=await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='worker.status'||c.method==='worker.request'&&['/api/runs','/api/cluster-runs'].includes(c.data.target)).length);
  await page.evaluate(()=>{const f=window.__test;for(let i=0;i<40;i++)for(const method of ['studio/toolsStatus','studio/sshServiceChanged'])f.events.forEach(fn=>fn({method,params:method==='studio/toolsStatus'?{status:'ready',count:26}:{status:'connected',workflowReady:true,connectionId:'connection-A'}}));});await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='worker.status'||c.method==='worker.request'&&['/api/runs','/api/cluster-runs'].includes(c.data.target)).length),calls);
  await page.evaluate(()=>window.__test.recordIndexUnavailable=true);await page.getByRole('button',{name:'同步记录',exact:true}).click();await page.getByText('记录读取失败 · 保留上次记录',{exact:true}).waitFor();const row=page.locator('.job-record-open').filter({has:page.getByText('History A',{exact:true})});assert.equal(await row.isEnabled(),true);await row.click();await page.getByTestId('run-readonly-observation').waitFor();assert.equal(await page.getByRole('button',{name:'提交计算',exact:true}).isDisabled(),true);await assertNoExecutionMutations(page);await page.screenshot({path:path.join(out,'selected-service-stale-index-fresh-detail.png')});
 });
}
