import assert from 'node:assert/strict';

export async function frontendCompletionCases({check, connectWorker, openProjectManagement}) {
  await check('experience-completion-settings-toast-pause-and-expiry', async page => {
    await page.setViewportSize({width:1024,height:768});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.clock.install();
    await page.evaluate(() => {
      const original = window.studio.invoke;
      window.studio.invoke = async (method, data) => {
        if (method !== 'settings') return original(method, data);
        return new Promise(resolve => {
          window.finishSave = () => resolve({...window.__test.settings,...data});
        });
      };
      return window.renderTest('App');
    });
    const opener = page.getByRole('button',{name:'设置',exact:true});
    await opener.click();
    const dialog = page.getByRole('dialog',{name:'工作台设置'});
    const theme = dialog.locator('.settings-content select').first();
    await theme.selectOption('light');
    await dialog.getByRole('button',{name:'保存设置',exact:true}).click();
    await page.waitForFunction(() => typeof window.finishSave === 'function');
    const receipt = dialog.getByTestId('settings-save-feedback');
    assert.equal(await receipt.count(),0);
    await page.evaluate(() => window.finishSave());
    await receipt.getByRole('status').filter({hasText:'设置已保存'}).waitFor();
    assert.equal(await receipt.getAttribute('data-toast-severity'),'success');
    const dismiss = receipt.getByRole('button',{name:'关闭通知',exact:true});
    await receipt.hover();
    await page.clock.runFor(5000);
    assert.equal(await receipt.count(),1);
    await dismiss.focus();
    await page.mouse.move(1,1);
    await page.clock.runFor(5000);
    assert.equal(await receipt.count(),1);
    await theme.focus();
    await page.clock.runFor(5010);
    await receipt.waitFor({state:'detached'});
    await page.keyboard.press('Escape');
    assert.equal(await opener.evaluate(element => element === document.activeElement),true);
  });

  await check('experience-completion-json-field-and-single-primary', async page => {
    await page.evaluate(() => window.renderTest('App'));
    await connectWorker(page);
    await page.waitForFunction(() => window.__test.calls.some(call => call.data?.target === '/api/projects'));
    await openProjectManagement(page);
    await page.getByRole('button',{name:'Fixture project',exact:true}).click();
    await page.locator('.home-disclosure > summary').filter({hasText:'记录统计与高级入口'}).click();
    await page.getByRole('button',{name:'高级：原生计算草稿',exact:true}).click();
    const draft = page.getByRole('dialog',{name:'高级：原生计算草稿'});
    const json = draft.getByRole('textbox',{name:'完整任务描述 · inputs 是运行目录文件名 → 已授权源文件路径'});
    const valid = await json.inputValue();
    const primary = () => draft.locator('button.primary,button[data-variant=primary]');
    assert.equal(await primary().count(),1);
    await primary().filter({hasText:'创建输入快照与草稿'}).waitFor();
    await json.fill('{');
    assert.equal(await primary().count(),1);
    assert.equal(await primary().innerText(),'应用 JSON');
    await primary().press('Enter');
    assert.equal(await json.getAttribute('aria-invalid'),'true');
    const error = await json.getAttribute('aria-describedby');
    assert.equal(await page.evaluate(id => document.getElementById(id)?.textContent,error),'JSON 语法有误。');
    assert.equal(await page.getByTestId('global-diagnostic-toast').count(),0);
    assert.equal(await draft.getByRole('button',{name:'创建输入快照与草稿',exact:true}).getAttribute('aria-disabled'),'true');
    await json.fill(JSON.stringify({...JSON.parse(valid),name:'Edited native draft'}));
    await primary().press('Enter');
    await primary().filter({hasText:'创建输入快照与草稿'}).waitFor();
    assert.equal(await draft.getByRole('textbox',{name:'计算名称',exact:true}).inputValue(),'Edited native draft');
    assert.equal(await primary().innerText(),'创建输入快照与草稿');
    assert.equal(await json.getAttribute('aria-invalid'),null);
    assert.equal(await page.evaluate(() => window.__test.calls.some(call => call.data?.target === '/api/runs/prepare')),false);
  });

  await check('experience-completion-environment-json-and-save-receipt', async page => {
    await page.evaluate(() => {
      localStorage.setItem('studio.section','environments');
      window.__test.responses = {
        '/api/environments': ({method}) => method === 'POST'
          ? {...window.__test.environment,id:'new-environment'} : [window.__test.environment],
        '/api/environments/drafts': () => [],
        '/api/compute/readiness': () => ({environments:[],clusters:[]}),
      };
      return window.renderTest('App');
    });
    await connectWorker(page);
    await page.locator('summary').filter({hasText:'手动登记与诊断'}).click();
    await page.getByRole('button',{name:'高级 JSON 配置',exact:true}).click();
    const dialog = page.getByRole('dialog',{name:'注册独立科学环境'});
    const json = dialog.getByRole('textbox',{name:'高级 JSON 配置'});
    const save = dialog.getByRole('button',{name:'保存环境',exact:true});
    const valid = await json.inputValue();
    await json.fill('{');
    await save.press('Enter');
    assert.equal(await json.getAttribute('aria-invalid'),'true');
    assert.equal(await page.evaluate(() => window.__test.calls.filter(call =>
      call.data?.target === '/api/environments' && call.data?.method === 'POST').length),0);
    await json.fill(valid);
    await save.press('Enter');
    await page.getByTestId('toast-region').getByRole('status').filter({hasText:'计算环境已登记。'}).waitFor();
    assert.equal(await dialog.count(),0);
    assert.equal(await page.evaluate(() => window.__test.calls.filter(call =>
      call.data?.target === '/api/environments' && call.data?.method === 'POST').length),1);
  });

  await check('experience-completion-disclosure-and-icon-keyboard', async page => {
    await page.evaluate(() => {
      window.__test.chatGroups = [{id:'fixture-group',name:'Fixture group'}];
      return window.renderTest('App');
    });
    const group = page.locator('.conversation-project');
    const summary = group.locator(':scope > summary');
    await summary.waitFor();
    assert.equal(await group.getAttribute('data-variant'),'section');
    assert.equal(await summary.locator(':scope > .aml-disclosure-arrow').count(),1);
    await summary.press('Enter');
    assert.equal(await group.evaluate(element => element.open),false);
    await summary.press('Space');
    assert.equal(await group.evaluate(element => element.open),true);
    for (const name of ['新建会话分组','在分组中新建对话 · Fixture group','新建未分组会话']) {
      const button = page.getByRole('button',{name,exact:true});
      const target = await button.boundingBox();
      assert(target && target.width >= 28 && target.height >= 28, name + ' target');
      const snapshot = await button.ariaSnapshot();
      assert(snapshot.includes(name), snapshot);
      await button.focus();
      await page.getByRole('tooltip').filter({hasText:name}).waitFor();
      assert(await button.getAttribute('aria-describedby'),name + ' tooltip association');
    }
    const add = page.getByRole('button',{name:'在分组中新建对话 · Fixture group',exact:true});
    await add.press('Enter');
    assert.equal(await group.evaluate(element => element.open),true);
    const layout = page.locator('.workspace-layout-menu > summary');
    await layout.press('Enter');
    const option = page.getByTestId('priority-workflow');
    await option.focus();
    await page.keyboard.press('Escape');
    assert.equal(await layout.evaluate(element => element === document.activeElement),true);
    assert.equal(await option.isVisible(),false);
  });

  await check('experience-completion-jobs-loading-error-empty-and-retry', async page => {
    await page.evaluate(() => {
      let refreshed = 0;
      window.jobRetryCount = () => refreshed;
      window.showJobPhase = (servicePhase, loaded) => {
        const source = {at:loaded ? 1 : null,stale:!loaded,loaded};
        return window.renderTest('JobsPage',{
          local:[],cluster:[],observations:{local:source,cluster:source},projects:[],projectId:'',
          tasks:[],conversations:[],worker:true,busy:false,servicePhase,onRefresh:()=>refreshed++,
          onOpen:()=>{throw Error('Unexpected open');},onConversation:()=>{throw Error('Unexpected conversation');},
        });
      };
      return window.showJobPhase('checking',false);
    });
    const state = page.getByTestId('jobs-empty');
    await state.getByRole('status').filter({hasText:'正在核对当前作业服务并读取记录'}).waitFor();
    assert.equal(await state.getByRole('alert').count(),0);
    await page.evaluate(() => window.showJobPhase('unavailable',false));
    await state.getByRole('alert').filter({hasText:'记录尚未读取完整'}).waitFor();
    await state.getByRole('button',{name:'重试读取记录',exact:true}).press('Enter');
    assert.equal(await page.evaluate(() => window.jobRetryCount()),1);
    await page.evaluate(() => window.showJobPhase('ready',true));
    await state.getByRole('heading',{name:'尚无运行记录',exact:true}).waitFor();
    assert.equal(await state.getByRole('alert').count(),0);
  });

  await check('experience-completion-assets-preview-error-and-registration-toast', async page => {
    await page.evaluate(async () => {
      const {default:AssetInspector} = await import('/frontend/features/assets/AssetInspector.tsx');
      window.__test.assetSaves = 0;
      window.__test.responses = {
        '/api/inspect':() => {throw Error('Synthetic structure unavailable');},
        '/api/assets':() => ({id:'asset-fixture',name:'fixture.xyz',path:'/fixture/fixture.xyz'}),
      };
      window.renderWithProviders(React.createElement(AssetInspector,{
        worker:true,workerScope:'fixture',projectId:'project',environments:[window.__test.environment],
        onSaved:() => {window.__test.assetSaves++;},
      }));
    });
    const path = page.getByTestId('asset-path');
    await page.getByTestId('asset-environment').selectOption('env');
    await path.fill('/fixture/fixture.xyz');
    await page.getByTestId('asset-preview').click();
    const failure = page.locator('.aml-error-state');
    await failure.getByRole('alert').filter({hasText:'无法读取结构预览'}).waitFor();
    await failure.locator('summary').press('Enter');
    await failure.getByText('Synthetic structure unavailable',{exact:true}).waitFor();
    assert.equal(await path.inputValue(),'/fixture/fixture.xyz');
    await page.getByTestId('asset-register').click();
    await page.getByTestId('toast-region').getByRole('status').filter({hasText:'资产已登记。'}).waitFor();
    await page.getByTestId('asset-register-result').getByText('fixture.xyz',{exact:true}).waitFor();
    assert.equal(await page.evaluate(() => window.__test.assetSaves),1);
  });
}
