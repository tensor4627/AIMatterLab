import assert from 'node:assert/strict';
import path from 'node:path';

const readCount=(page,target)=>page.evaluate(target=>window.__test.calls.filter(call=>call.method==='worker.request'&&call.data.target===target).length,target);

async function configureFixture(page){
 await page.clock.install();
 await page.evaluate(()=>{
  const f=window.__test;
  f.job={...f.run,id:'observed-run',name:'Observed cluster job',kind:'cluster-run',status:'unknown',cluster:{scheduler:'slurm'},cluster_id:'fixture-cluster',resources:{cpus:1},job_id:'31',snapshots:[],script:'# Synthetic fixture',scientific_validation:{status:'not_run'},cancellation:{status:'requested',signal_sent:true}};
  f.clusterList=[{...f.job,status:'succeeded'}];
  f.clusterReadVisible=true;
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>f.clusterReadVisible?'visible':'hidden'});
  f.responses={
   '/api/cluster-runs':()=>{if(f.clusterListFailure)throw Error('Synthetic observation failure');return f.clusterList;},
   '/api/cluster/observation':()=>f.holdClusterRead?new Promise((resolve,reject)=>{f.pendingClusterRead={resolve,reject};}):f.job,
   '/api/cluster/status':()=>f.job,
   '/api/cluster/log':()=>({text:'Synthetic identified log'}),
  };
 });
}

export async function frontendClusterObservationCases({check,out}){
 await check('cluster-observation-terminal-stops-and-manual-logs',async page=>{
  await configureFixture(page);
  await page.evaluate(async()=>{
   const {ClusterRunPage}=await import('/frontend/features/cluster/ClusterPage.tsx');
   window.testRoot.render(window.React.createElement(ClusterRunPage,{id:window.__test.job.id,onAgent:()=>{},onError:error=>{throw error;}}));
  });
  const panel=page.getByTestId('cluster-review');
  await panel.getByTestId('cluster-cancellation-receipt').waitFor();
  assert.equal(await readCount(page,'/api/cluster/observation'),1);
  await page.evaluate(()=>{window.__test.job={...window.__test.job,status:'cancelled'};});
  await page.clock.runFor(10100);
  assert.equal(await panel.locator('.page-heading .tag').innerText(),'cancelled');
  await page.clock.runFor(35000);
  assert.equal(await readCount(page,'/api/cluster/observation'),2);
  assert.equal(await readCount(page,'/api/cluster/status'),0);
  await panel.getByRole('button',{name:'核对作业与日志',exact:true}).press('Enter');
  await panel.getByText('Synthetic identified log',{exact:true}).waitFor();
  assert.equal(await readCount(page,'/api/cluster/status'),1);
  assert.equal(await readCount(page,'/api/cluster/log'),1);
  assert.equal(await readCount(page,'/api/cluster/cancel'),0);
 });

 await check('cluster-observation-monitor-keeps-discovery-and-pauses-hidden',async page=>{
  await configureFixture(page);
  await page.evaluate(()=>window.renderTest('ClusterPage',{worker:true,sourceId:'fixture-source',settings:window.__test.settings,onError:error=>{throw error;},onRefresh:()=>{},onAgent:()=>{},onRun:id=>{window.__test.openedCluster=id;},onAuthenticate:()=>{},onConnectCompute:()=>{},onTerminal:()=>{}}));
  await page.getByTestId('cluster-settings').waitFor();
  await page.clock.runFor(20000);
  assert.equal(await readCount(page,'/api/cluster-runs'),0);
  await page.locator('.cluster-page .settings-advanced summary').click();
  await page.getByRole('button',{name:'作业监视',exact:true}).click();
  const monitor=page.getByTestId('cluster-monitor'),observation=monitor.getByTestId('cluster-observation-status');
  await monitor.getByRole('button',{name:/^Observed cluster job/}).waitFor();
  await page.evaluate(()=>{const f=window.__test;f.clusterList=[...f.clusterList,{...f.job,id:'newly-submitted-run',name:'Newly observed job',status:'queued'}];});
  await page.clock.runFor(10100);
  const added=monitor.getByRole('button',{name:/^Newly observed job/});
  await added.click();
  assert.equal(await page.evaluate(()=>window.__test.openedCluster),'newly-submitted-run');
  const observedAt=await observation.locator('time').getAttribute('datetime');
  await page.evaluate(()=>{window.__test.clusterListFailure=true;});
  await page.clock.runFor(10100);
  assert.equal(await observation.getAttribute('data-stale'),'true');
  assert.equal(await observation.locator('time').getAttribute('datetime'),observedAt);
  assert.equal(await added.count(),1);
  await page.screenshot({path:path.join(out,'cluster-monitor-retained-list.png')});
  await page.evaluate(()=>{const f=window.__test;f.clusterListFailure=false;f.clusterReadVisible=false;document.dispatchEvent(new Event('visibilitychange'));});
  const reads=await readCount(page,'/api/cluster-runs');
  await page.clock.runFor(45000);
  assert.equal(await readCount(page,'/api/cluster-runs'),reads);
  await page.evaluate(()=>{const f=window.__test;f.clusterReadVisible=true;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(count=>window.__test.calls.filter(call=>call.method==='worker.request'&&call.data.target==='/api/cluster-runs').length>count,reads);
  await monitor.locator('[data-testid="cluster-observation-status"][data-stale="false"]').waitFor();
  assert.equal(await readCount(page,'/api/clusters'),1);
 });

 await check('cluster-observation-native-app-preserves-original-restore-after-disconnect',async page=>{
  await configureFixture(page);
  await page.evaluate(()=>{
   const f=window.__test,standard=window.studio.invoke;
   const chat={id:'codex:restore-cluster',provider:'codex',threadId:'restore-cluster',name:'Synthetic original conversation',projectId:'project',taskId:'original-flow'};
   const task={id:chat.taskId,provider:chat.provider,threadId:chat.threadId,title:'Original flow',parameters:{},steps:[],artifacts:[{kind:'cluster-run',id:f.job.id}],deployment:{workerBinding:{distribution:'Ubuntu',root:'/original-fixture',port:8767}}};
   f.conversation=chat;f.task=task;
   f.clusterList=[f.job];
   localStorage.setItem('studio.conversation',chat.id);localStorage.setItem('studio.agent','false');
   window.studio.invoke=async(method,data)=>{
    if(method==='conversation.list')return [chat];
    if(method==='conversation.select'||method==='conversation.remember')return chat;
    if(method==='task.list')return [task];
    if(method==='agent.rpc'&&['thread/resume','thread/read'].includes(data.method))return {model:'fixture-model',thread:{id:chat.threadId,turns:[{items:[{id:'fixture-history',type:'agentMessage',text:'Synthetic original history'}]}]}};
    if(method==='compute.connection.plan'){
     f.originalRestoreRequest=data;
     return {planId:'fixture-restore-plan',status:'review',scope:'task',intent:'standard',distributions:['Ubuntu'],target:{distribution:'Ubuntu',root:'/original-fixture',port:8767}};
    }
    if(method==='worker.status'||method==='worker.restore')return {status:f.offline?'disconnected':'connected',sourceId:'a'.repeat(64),serviceVersion:'current',checkedAt:1,taskId:task.id,conversationId:chat.id,...data};
    return standard(method,data);
   };
   return window.renderTest('App');
  });
  await page.getByText('Synthetic original history',{exact:true}).waitFor();
  await page.locator('nav [data-testid="navigate-runs"]:visible').click();
  await page.locator('[data-job-key="cluster:observed-run"] .job-record-open').click();
  const review=page.getByTestId('cluster-review');
  await review.getByRole('heading',{name:'Observed cluster job',exact:true}).waitFor();
  await page.evaluate(()=>{window.__test.holdClusterRead=true;});
  await page.clock.runFor(10200);
  await page.waitForFunction(()=>window.__test.pendingClusterRead);
  await page.evaluate(()=>{window.__test.offline=true;});
  await page.clock.runFor(2800);
  const stale=review.getByTestId('cluster-observation-status');
  assert.equal(await stale.getAttribute('data-stale'),'true');
  await page.evaluate(()=>{window.__test.pendingClusterRead.reject(Error('needs_human_auth'));});
  const restore=page.getByRole('button',{name:'恢复原作业服务',exact:true});
  await restore.waitFor();
  assert.equal(await review.getByRole('button',{name:'核对原作业连接',exact:true}).count(),0);
  await page.screenshot({path:path.join(out,'cluster-run-disconnected-retained.png')});
  await restore.click();
  await page.getByTestId('compute-connection-guide').waitFor();
  await page.waitForFunction(()=>window.__test.originalRestoreRequest);
  assert.deepEqual(await page.evaluate(()=>window.__test.originalRestoreRequest),{taskId:'original-flow'});
  assert.equal(await readCount(page,'/api/cluster/submit'),0);
  assert.equal(await readCount(page,'/api/cluster/cancel'),0);
 });
}
