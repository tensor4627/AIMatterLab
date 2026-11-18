// Actual App interactions. Provider, worker, authorization and scheduler results are fixtures.
import assert from 'node:assert/strict';
import path from 'node:path';

const names = ['活跃会话 A', '活跃会话 B', '有定时提醒的会话', '需要换行的长会话名称与资源徽记'];
const row = (page, name) => page.getByTestId('conversation-sidebar').locator('.conversation-row')
  .filter({has: page.getByText(name, {exact: true})});
const motion = node => node.evaluate(element => getComputedStyle(element).animationName);

async function managedApp(page, {manyBadges = false, monitorNotices = false} = {}) {
  await page.evaluate(async ({names, manyBadges, monitorNotices}) => {
    const f = window.__test;
    localStorage.setItem('studio.sidebarWidth', manyBadges ? '192' : '290');
    f.settings.resourceBadgeMotion = 'wave';
    const now = Math.floor(Date.now() / 1000);
    const conversation = (name, i) => ({id: 'codex:managed-chat-' + i, provider: 'codex',
      threadId: 'managed-chat-' + i, name, updatedAt: i + 1, taskId:null, projectId:null});
    f.managedChats = names.map(conversation);
    const badges = ['集群 A', '结果集群 B', '独立资源 C', '长资源名称 D', '计算课题 E'];
    const resource = (name, i) => ({resourceId:'managed-' + i, profileId:'profile-' + i,
      kind:'ssh', name, color:i + 1, serviceReady:i !== 0, terminalReady:true, authorizedProjects:[]});
    const badge = (i, status) => ({profileId:'profile-' + i, label:badges[i],
      kind:'ssh', color:i + 1, status, observedAt:now});
    const owner = n => ({provider:'codex', threadId:f.managedChats[n].threadId,
      taskId:'workflow-' + n, projectId:'fixture-project-' + n, runId:'parent-' + n});
    const script = {language:'python', version:2, sha256:'b'.repeat(64)};
    f.managedCallLog = [];
    f.managedSnapshotReads = 0;
    f.managed = {
      resources:badges.map(resource),
      conversations:f.managedChats.map((chat, i) => ({provider:chat.provider,threadId:chat.threadId,
        replying:i < 2, nextWakeAt:i === 0 || i === 2 ? now + 1800 : null,
        badges:i === 0 ? [badge(0, 'running'),badge(1, 'running')] :
          i === 1 ? [badge(1,'idle'),badge(2,'offline')] :
          i === 2 ? [badge(2,'queued')] : manyBadges ? badges.map((_label, k) => badge(k, 'running')) : [],
      })),
      sources:[
        {id:'source-offline',profileId:'profile-0',connected:false,observedAt:now - 3600,runs:[{id:'parent-0',
          projectId:'fixture-project-0',status:'running',observedAt:now - 3600}],schedules:[{id:'offline-poll',
          name:'离线巡检计划',sourceId:'source-offline',kind:'poll',status:'scheduled',scope:owner(0),
          intervalSeconds:1800,count:4,maxRuns:48,nextAt:now + 1800,expiresAt:now + 86400,
          lastResult:{status:'succeeded',run:{id:'parent-0',status:'running'}}}]},
        {id:'source-online',profileId:'profile-1',connected:true,observedAt:now,runs:[{id:'fixture-child-b',
          projectId:'fixture-project-1',status:'running',jobId:'17',observedAt:now}],schedules:[{id:'other-script',
          name:'同行资源脚本',sourceId:'source-online',kind:'script',status:'running',scope:owner(1),
          intervalSeconds:1800,count:1,maxRuns:48,nextAt:now + 1800,expiresAt:now + 86400,script,
          active:{childId:'fixture-child-b',jobId:'17',status:'running'}}]},
      ],
    };
    if (monitorNotices) {
      f.managed.notices = [1,0].map(index => {
        const source = f.managed.sources[index];
        const scope = {...owner(index),runId:'exhausted-fixture-run'};
        const jobId = index === 0 ? '41414' : '72727';
        const run = {id:scope.runId,projectId:scope.projectId,jobId,status:'queued',observedAt:source.observedAt};
        const plan = {id:'exhausted-monitor',name:index === 0 ? '原服务巡检计划' : '其他服务巡检计划',
          sourceId:source.id,kind:'poll',status:'exhausted',scope,intervalSeconds:1800,count:48,maxRuns:48,
          revision:2,nextAt:null,expiresAt:now + 86400,lastResult:{status:'succeeded',run}};
        source.schedules.push(plan);
        source.runs.push(run);
        return {id:(index === 0 ? 'a' : 'b').repeat(64),sourceId:source.id,profileId:source.profileId,
          resourceName:badges[index],scheduleId:plan.id,runId:run.id,projectId:scope.projectId,provider:scope.provider,
          threadId:scope.threadId,jobId,status:run.status,observedAt:run.observedAt,count:plan.count,maxRuns:plan.maxRuns,
          delegationExhausted:false,createdAt:now + (1-index),acknowledgedAt:null};
      });
    }
    f.emitManaged = (method = 'studio/managedActivity') => f.events.slice().forEach(callback => callback({method}));
    const original = window.studio.invoke;
    window.studio.invoke = async (method, data) => {
      if (method === 'compute.managed.snapshot') {
        f.managedSnapshotReads++;
        return structuredClone(f.managed);
      }
      if (method === 'conversation.list') return structuredClone(f.managedChats);
      if (method === 'conversation.select') {
        f.managedCallLog.push({method,data});
        return structuredClone(f.managedChats.find(value => value.id === data.id));
      }
      if (method === 'compute.managed.stopSchedule') {
        f.managedCallLog.push({method,data});
        const source = f.managed.sources.find(value => value.id === data.sourceId);
        const item = source?.schedules.find(value => value.id === data.scheduleId);
        if (!item || source.connected) throw Error('Unexpected stop target in native managed fixture');
        Object.assign(item,{status:'stopping',stopRequestedAt:now,nextAt:null,stopNeedsConfirmation:false});
        f.emitManaged();
        return structuredClone(item);
      }
      if (method === 'compute.managed.scheduleDetails') {
        f.managedCallLog.push({method,data});
        const source = f.managed.sources.find(value => value.id === data.sourceId);
        const item = source?.schedules.find(value => value.id === data.scheduleId);
        if (!item) throw Error('Unrecognized fixture schedule');
        return {...item,connected:source.connected,...item.script ? {
          script:{...item.script,text:'print("isolated fixture script")'},
          history:[{occurrence:1,childId:'fixture-child-b',status:'running'}],
        } : {}};
      }
      if (method === 'compute.managed.acknowledgeNotice') {
        f.managedCallLog.push({method,data});
        const notice = f.managed.notices?.find(value => value.id === data.id);
        if (!notice) throw Error('Unrecognized fixture monitor notice');
        notice.acknowledgedAt ??= now;
        f.emitManaged();
        return {acknowledged:true};
      }
      if (method === 'compute.managed.observeOnce') {
        f.managedCallLog.push({method,data});
        const source = f.managed.sources.find(value => value.id === data.sourceId);
        const plan = source?.schedules.find(value => value.id === data.scheduleId);
        const run = source?.runs.find(value => value.id === plan?.scope.runId && value.projectId === plan.scope.projectId);
        const notice = f.managed.notices?.find(value => value.sourceId === data.sourceId && value.scheduleId === data.scheduleId);
        if (!source?.connected || plan?.status !== 'exhausted' || !run || !notice) throw Error('Missing original fixture monitor');
        const observedStatus = f.observationReplies?.shift();
        if (observedStatus && observedStatus !== 'observed') {
          return {sourceId:source.id,scheduleId:plan.id,requestId:data.requestId,status:observedStatus,run:structuredClone(run)};
        }
        Object.assign(run,{status:'running',observedAt:now + 60});
        Object.assign(notice,{status:run.status,observedAt:run.observedAt});
        f.emitManaged();
        return {sourceId:source.id,scheduleId:plan.id,requestId:data.requestId,status:'observed',run:structuredClone(run)};
      }
      if (method === 'compute.resource.status') return {schemaVersion:1,kind:null,status:'none',selectionId:null};
      if (method === 'compute.profiles.list') return {profiles:[],defaults:{}};
      if (method === 'sharedTerminal.list') return {sessions:[]};
      if (method === 'worker.restore') return {status:'disconnected',checkedAt:1};
      if (method === 'agent.rpc' && ['thread/read','thread/resume'].includes(data.method)) {
        return {thread:{id:data.params.threadId,turns:[]}};
      }
      if (method === 'agent.rpc' && data.method === 'turn/start') throw Error('No model turns in the managed renderer fixture');
      return original(method,data);
    };
    return window.renderTest('App');
  }, {names, manyBadges, monitorNotices});
  await page.getByTestId('conversation-sidebar').waitFor();
  await row(page,names[0]).locator('.conversation-resource-badge').first().waitFor();
}

export async function frontendManagedComputeCases({check, out}) {
  const capture = (page, file) => page.screenshot({path:path.join(out, file + '.png')});

  await check('managed-compute-experience-concurrent-conversations-and-clock', async page => {
    await managedApp(page);
    const first = row(page,names[0]), second = row(page,names[1]), scheduled = row(page,names[2]);
    for (const chat of [first, second]) {
      assert.equal(await chat.getByRole('img',{name:'Agent 正在工作',exact:true}).count(),1);
      assert.equal(await chat.locator('.conversation-menu-trigger').isDisabled(),true);
    }
    assert.equal(await first.getByRole('img',{name:/下次唤醒/}).count(),0);
    assert.equal(await scheduled.getByRole('img',{name:/下次唤醒/}).count(),1);
    assert.equal(await scheduled.locator('.conversation-menu-trigger').isEnabled(),true);
    assert.deepEqual(await first.locator('.conversation-resource-badge').evaluateAll(nodes =>
      nodes.map(node => [node.textContent,node.dataset.status,getComputedStyle(node).animationName])),
    [['集群 A','running','conversation-job-wave'],['结果集群 B','running','conversation-job-wave']]);
    await second.locator('.conversation-item').click();
    await page.waitForFunction(() => window.__test.managedCallLog.some(call =>
      call.method === 'conversation.select' && call.data.id === 'codex:managed-chat-1'));
    assert.equal(await first.getByRole('img',{name:'Agent 正在工作',exact:true}).count(),1);
    await page.evaluate(() => {
      window.__test.managed.conversations[0].replying = false;
      window.__test.emitManaged('studio/agentTurnState');
    });
    await first.getByRole('img',{name:/下次唤醒/}).waitFor();
    assert.equal(await second.getByRole('img',{name:'Agent 正在工作',exact:true}).count(),1);
    await capture(page,'managed-concurrent-clock');
  });

  await check('managed-compute-experience-badge-styles-reduced-motion-and-wrap', async (page,captureNative) => {
    await managedApp(page,{manyBadges:true});
    const first = row(page,names[0]), badges = first.locator('.conversation-resource-badge');
    assert.equal(await motion(badges.first()),'conversation-job-wave');
    const t0 = await badges.first().evaluate(element => element.getAnimations()[0]?.currentTime);
    await page.waitForFunction(time => document.querySelector('.conversation-resource-badge[data-status="running"]')?.
      getAnimations()[0]?.currentTime > time,t0);
    await page.getByRole('button',{name:'设置',exact:true}).first().click();
    const picker = page.getByLabel('作业徽记动效',{exact:true});
    assert.equal(await picker.inputValue(),'wave');
    await picker.selectOption('breathe');
    await page.getByRole('button',{name:'保存设置',exact:true}).click();
    await page.getByText('设置已保存',{exact:true}).waitFor();
    assert.equal(await page.evaluate(() => window.__test.settings.resourceBadgeMotion),'breathe');
    await page.keyboard.press('Escape');
    await picker.waitFor({state:'hidden'});
    assert.deepEqual(await badges.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationName)),
      ['conversation-job-breathe','conversation-job-breathe']);
    assert.deepEqual(await row(page,names[1]).locator('.conversation-resource-badge').evaluateAll(nodes =>
      nodes.map(node => getComputedStyle(node).animationName)), ['none','none']);
    const dimensions = await row(page,names[3]).evaluate(element => {
      const within = element.querySelector('.conversation-item').getBoundingClientRect();
      const sidebar = element.closest('.conversation-sidebar');
      const tags = Array.from(element.querySelectorAll('.conversation-resource-badge'), tag => tag.getBoundingClientRect());
      return {rows:new Set(tags.map(tag => Math.round(tag.top))).size,
        inside:tags.every(tag => tag.right <= within.right && tag.left >= within.left),
        sidebarWidth:sidebar.clientWidth,scrollWidth:sidebar.scrollWidth};
    });
    assert.ok(dimensions.rows > 1 && dimensions.inside && dimensions.scrollWidth <= dimensions.sidebarWidth + 1,
      JSON.stringify(dimensions));
    await capture(page,'managed-breathe-wrap');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await motion(badges.first()),'none');
    assert.equal(await motion(first.locator('.conversation-turn-spinner')),'none');
    assert.notEqual(await badges.first().evaluate(element => getComputedStyle(element).boxShadow),'none');
    await captureNative('managed-reduced-motion');
  });

  await check('managed-compute-experience-offline-stop-and-original-script-details', async page => {
    await managedApp(page);
    await page.locator('nav [data-testid="navigate-runs"]:visible').click();
    const jobs = page.getByTestId('jobs-page');
    const offline = jobs.getByTestId('managed-schedule-record').filter({hasText:'离线巡检计划'});
    const other = jobs.getByTestId('managed-schedule-record').filter({hasText:'同行资源脚本'});
    await offline.getByRole('button',{name:'终止计划',exact:true}).click();
    await offline.getByText('停止待远端确认',{exact:true}).waitFor();
    assert.equal(await offline.getByRole('button',{name:'终止计划',exact:true}).isDisabled(),true);
    assert.equal(await other.getByRole('button',{name:'终止计划',exact:true}).isEnabled(),true);
    await other.locator('summary').click();
    await other.getByText('print("isolated fixture script")',{exact:true}).waitFor();
    assert.match(await other.innerText(),/脚本版本 · 2.*\n[\s\S]*"childId": "fixture-child-b"/);
    assert.match(await other.innerText(),/子作业 17/);
    assert.deepEqual(await page.evaluate(() => window.__test.managedCallLog.filter(call => call.method.startsWith('compute.'))),
      [{method:'compute.managed.stopSchedule',data:{sourceId:'source-offline',scheduleId:'offline-poll'}},
       {method:'compute.managed.scheduleDetails',data:{sourceId:'source-online',scheduleId:'other-script'}}]);
    assert.deepEqual(await page.evaluate(() => window.__test.calls.filter(call =>
      ['/api/cluster/cancel','/api/run/cancel'].includes(call.data?.target))), []);
    await capture(page,'managed-offline-stop');
    await page.evaluate(() => {
      const source = window.__test.managed.sources[0];
      source.connected = true;
      source.schedules[0].status = 'stopped';
      window.__test.emitManaged();
    });
    await offline.getByText('已停止',{exact:true}).waitFor();
    assert.equal(await offline.getByRole('button',{name:'终止计划',exact:true}).count(),0);
    assert.equal(await other.getByRole('button',{name:'终止计划',exact:true}).isEnabled(),true);
  });

  await check('managed-compute-experience-exhausted-monitor-follows-original-job-once', async page => {
    await managedApp(page,{monitorNotices:true});
    const notice = page.getByTestId('monitor-budget-notice');
    const repeatSnapshots = async () => {
      const before = await page.evaluate(() => window.__test.managedSnapshotReads);
      for (let i = 1; i <= 3; i++) {
        await page.evaluate(() => window.__test.emitManaged());
        await page.waitForFunction(reads => window.__test.managedSnapshotReads >= reads,before + i);
      }
    };
    await notice.getByText('巡检已达上限 · 2',{exact:true}).waitFor();
    await repeatSnapshots();
    assert.equal(await notice.count(),1);
    assert.match(await notice.innerText(),/结果集群 B · 72727 · 最近状态 排队中/);
    await notice.getByRole('button',{name:'知道了',exact:true}).click();
    await notice.getByText(/集群 A · 41414 · 最近状态 排队中/).waitFor();
    await repeatSnapshots();
    assert.equal(await notice.count(),1);
    assert.doesNotMatch(await notice.innerText(),/72727|巡检已达上限 · 2/);
    assert.match(await notice.innerText(),/自动巡检次数已用完。.*请自行关注原作业的后续状态。/s);
    await capture(page,'managed-exhausted-monitor-notice');

    await notice.getByRole('button',{name:'查看运行记录',exact:true}).click();
    await notice.waitFor({state:'hidden'});
    const jobs = page.getByTestId('jobs-page');
    const original = jobs.getByTestId('managed-schedule-record').filter({hasText:'原服务巡检计划'});
    const peer = jobs.getByTestId('managed-schedule-record').filter({hasText:'其他服务巡检计划'});
    await page.waitForFunction(() => document.activeElement?.querySelector('strong')?.textContent === '原服务巡检计划');
    await original.getByText('关联作业 · exhausted-fixture-run',{exact:true}).waitFor();
    assert.equal(await original.locator('details').evaluate(element => element.open),true);
    assert.equal(await peer.locator('details').evaluate(element => element.open),false);
    await page.waitForFunction(() => window.__test.managedCallLog.some(call => call.method === 'compute.managed.scheduleDetails'));
    const manual = original.getByRole('button',{name:'手动核对一次',exact:true});
    assert.equal(await manual.isDisabled(),true);
    assert.equal(await peer.getByRole('button',{name:'手动核对一次',exact:true}).isEnabled(),true);
    assert.equal(await original.getByText('次数已用完',{exact:true}).count(),1);
    assert.equal(await original.getByText('剩余次数 0 / 48',{exact:true}).count(),1);

    await page.evaluate(() => {
      window.__test.managed.sources.find(source => source.id === 'source-offline').connected = true;
      window.__test.emitManaged();
    });
    await manual.click();
    await original.getByRole('status').getByText('最近状态 · 运行中',{exact:true}).waitFor();
    await repeatSnapshots();
    assert.equal(await notice.count(),0);
    assert.equal(await original.getByText('次数已用完',{exact:true}).count(),1);
    assert.equal(await original.getByText('剩余次数 0 / 48',{exact:true}).count(),1);
    assert.equal(await original.getByRole('button',{name:'终止计划',exact:true}).count(),0);
    assert.match(await original.innerText(),/集群 A · 41414 · 最近状态 运行中/);
    assert.match(await peer.innerText(),/结果集群 B · 72727 · 最近状态 排队中/);

    const evidence = await page.evaluate(() => {
      const f = window.__test;
      const source = f.managed.sources.find(item => item.id === 'source-offline');
      const {status,count,maxRuns,nextAt,revision} = source.schedules.find(item => item.id === 'exhausted-monitor');
      return {calls:f.managedCallLog,plan:{status,count,maxRuns,nextAt,revision}};
    });
    const {requestId} = evidence.calls.find(call => call.method === 'compute.managed.observeOnce')?.data || {};
    assert.match(requestId,/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    assert.deepEqual(evidence.calls,[
      {method:'compute.managed.acknowledgeNotice',data:{id:'b'.repeat(64)}},
      {method:'compute.managed.acknowledgeNotice',data:{id:'a'.repeat(64)}},
      {method:'compute.managed.scheduleDetails',data:{sourceId:'source-offline',scheduleId:'exhausted-monitor'}},
      {method:'compute.managed.observeOnce',data:{sourceId:'source-offline',scheduleId:'exhausted-monitor',requestId}},
    ]);
    assert.deepEqual(evidence.plan,{status:'exhausted',count:48,maxRuns:48,nextAt:null,revision:2});
    await capture(page,'managed-exhausted-monitor-after-manual-check');
  });

  await check('managed-schedule-incomplete-receipts-and-legacy-stop', async page => {
    await managedApp(page,{monitorNotices:true});
    await page.evaluate(() => {
      const f = window.__test;
      f.observationReplies = ['in_progress','unknown','observed'];
      f.managed.sources[0].schedules[0].stopNeedsConfirmation = true;
      f.emitManaged();
    });
    await page.locator('nav [data-testid="navigate-runs"]:visible').click();
    const records = page.getByTestId('managed-schedule-record');
    const legacy = records.filter({hasText:'离线巡检计划'});
    await legacy.getByText('旧版停止请求待确认，请在此核对并终止计划。',{exact:true}).waitFor();
    await legacy.getByRole('button',{name:'终止计划',exact:true}).click();
    await legacy.getByText('停止待远端确认',{exact:true}).waitFor();
    const original = records.filter({hasText:'其他服务巡检计划'});
    const manual = original.getByRole('button',{name:'手动核对一次',exact:true});
    for (const feedback of ['原作业正在核对，可稍后查看本次回执。','本次核对未取得原作业的新回执。','最近状态 · 运行中']) {
      await manual.click();
      await original.getByRole('status').getByText(feedback,{exact:true}).waitFor();
    }
    const ids = await page.evaluate(() => window.__test.managedCallLog
      .filter(call => call.method==='compute.managed.observeOnce').map(call=>call.data.requestId));
    assert.equal(ids.length,3);
    assert.equal(ids[0],ids[1]);
    assert.notEqual(ids[1],ids[2]);
    await original.getByText('剩余次数 0 / 48',{exact:true}).waitFor();
  });
}
