import assert from 'node:assert/strict';
import path from 'node:path';

async function assertNotice(notice,severity,label,announce=true){
 await notice.waitFor();
 assert.equal(await notice.getAttribute('data-severity'),severity);
 assert.equal(await notice.getAttribute('role'),announce?(severity==='error'?'alert':'status'):null);
 assert.equal(await notice.locator('.notice-level').innerText(),label);
 assert.equal(await notice.locator('.notice-level svg').getAttribute('aria-hidden'),'true');
 const colors=await notice.evaluate((element,severity)=>{
  const compare=document.createElement('span');element.append(compare);
  const read=name=>{compare.style.color=`var(${name})`;return getComputedStyle(compare).color;};
  const tone=severity==='warning'?'--warn':severity==='error'?'--danger':'--text';
  const status={label:getComputedStyle(element.querySelector('.notice-level')).color,expected:read(tone),edge:getComputedStyle(element).borderTopColor,expectedEdge:read(severity==='info'?'--line':tone)};
  compare.remove();return status;
 },severity);
 assert.equal(colors.label,colors.expected);
 assert.equal(colors.edge,colors.expectedEdge);
}

export async function frontendNoticeSeverityCases({check,out}){
 for(const theme of ['dark','light'])await check('notice-experience-codex-connection-'+theme,async page=>{
  await page.evaluate(theme=>{
   const original=window.studio.invoke,fixture=window.__test;
   fixture.settings.theme=theme;
   fixture.compatibility={baselineVersion:'0.165.0-alpha.1.2',installedVersion:'0.169.1',baselineMatch:false,status:'capabilities_verified',versionWarning:{code:'STUDIO_CODEX_VERSION_DIFFERENCE',severity:'warning'}};
   fixture.versionEvent=(status='capabilities_verified')=>fixture.events.forEach(fn=>fn({provider:'codex',method:'studio/codexVersionWarning',params:{...fixture.compatibility,status}}));
   window.studio.invoke=async(method,data)=>{
    if(method==='agent.connect'){
     fixture.versionEvent('pending_capability_verification');
     if(!fixture.allowConnection)throw Error('Codex 连接失败（检查隔离能力，required_isolation_controls_missing）。api_key=fixture-private-token');
     fixture.versionEvent();
     return {studioCompatibility:fixture.compatibility,tools:{status:'ready',count:1}};
    }
    if(method==='agent.account'&&fixture.failAccountRead){fixture.accountReadFailed=true;throw Error('账户状态读取失败，请刷新账户状态后重试。');}
    return original(method,data);
   };
   return window.renderTest('App');
  },theme);
  await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
  await page.getByTestId('agent-connect').click();
  const toast=page.getByTestId('global-diagnostic-toast'),warning=page.getByTestId('codex-version-warning');
  await toast.getByRole('alert').waitFor();
  await assertNotice(toast.getByTestId('diagnostic-notice'),'error','错误',false);
  assert.equal(await warning.count(),0);
  await page.screenshot({path:path.join(out,'codex-startup-error-'+theme+'.png')});
  await toast.locator('summary').click();
  assert.match(await toast.innerText(),/required_isolation_controls_missing/);
  assert.match(await toast.innerText(),/\[redacted\]/);
  assert(!((await toast.textContent()).includes('fixture-private-token')));
  await toast.getByRole('button',{name:'关闭通知',exact:true}).click();
  await page.evaluate(()=>{window.__test.allowConnection=true;window.__test.failAccountRead=true;});
  await page.getByTestId('agent-connect').click();
  await page.waitForFunction(()=>window.__test.accountReadFailed===true);
  await toast.getByRole('alert').waitFor();
  await assertNotice(toast.getByTestId('diagnostic-notice'),'error','错误',false);
  assert.equal(await toast.getByTestId('diagnostic-summary').innerText(),'账户状态读取失败，请刷新账户状态后重试。');
  assert.equal(await warning.count(),0);
  await toast.getByRole('button',{name:'关闭通知',exact:true}).click();
  await page.evaluate(()=>window.__test.failAccountRead=false);
  await page.getByTestId('agent-connect').click();
  await assertNotice(warning,'warning','警告');
  assert.match(await warning.innerText(),/0\.169\.1/);
  assert.equal(await toast.count(),0);
  await page.screenshot({path:path.join(out,'codex-version-warning-'+theme+'.png')});
  await page.locator('.composer textarea').fill('Fixture chat while a version warning is visible');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.waitForFunction(()=>window.__test.calls.filter(entry=>entry.method==='agent.rpc'&&entry.data.method==='turn/start').length===1);
  await warning.getByRole('button',{name:'关闭版本提示'}).click();
  await page.evaluate(()=>window.__test.versionEvent());
  assert.equal(await warning.count(),0);
 });

 for(const theme of ['dark','light'])await check('notice-experience-account-test-'+theme,async page=>{
  await page.evaluate(theme=>{
   const original=window.studio.invoke,fixture=window.__test;
   fixture.settings.theme=theme;
   window.studio.invoke=async(method,data)=>{
    if(method==='agent.account'&&data.provider==='deepseek')return {credentialStored:true,modelAccess:'not_run'};
    if(method==='agent.testConnection'){
     if(fixture.failTest)throw Error('测试服务拒绝认证。 bearer fixture-private-token');
     return {status:'passed',model:'fixture-model'};
    }
    return original(method,data);
   };
   return window.renderTest('App');
  },theme);
  await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
  await page.getByTestId('open-accounts').click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'DeepSeek API',exact:true}).click();
  const test=dialog.getByTestId('test-api-connection');
  await test.click();
  const success=dialog.getByTestId('api-connection-feedback');
  await assertNotice(success,'info','提示');
  assert.match(await success.innerText(),/测试调用成功.*fixture-model/s);
  await page.screenshot({path:path.join(out,'account-test-info-'+theme+'.png')});
  await page.evaluate(()=>window.__test.failTest=true);
  await test.click();
  const failure=dialog.getByTestId('diagnostic-notice');
  await assertNotice(failure,'error','错误');
  await failure.locator('summary').click();
  assert.match(await failure.innerText(),/拒绝认证/);
  assert(!((await failure.textContent()).includes('fixture-private-token')));
  assert.equal(await success.count(),0);
  assert.equal(await page.getByTestId('global-diagnostic-toast').count(),0);
 });

 await check('notice-experience-codex-restored-conversation',async page=>{
  await page.evaluate(async()=>{
   const {setLanguage}=await import('/frontend/ui/i18n.ts');setLanguage('en');
   document.documentElement.dataset.theme='light';
   const host=document.getElementById('root');host.style.cssText='display:flex;width:320px;height:720px;margin:auto';
   const original=window.studio.invoke,conversation={id:'codex:restored',provider:'codex',threadId:'restored',name:'Saved conversation',projectId:null,taskId:null};
   window.studio.invoke=async(method,data)=>{
    if(method==='agent.connect')return {studioCompatibility:{baselineVersion:'0.165.0-alpha.1.2',installedVersion:'0.169.1',baselineMatch:false,status:'capabilities_verified',versionWarning:{code:'STUDIO_CODEX_VERSION_DIFFERENCE',severity:'warning'}}};
    if(method==='agent.rpc'&&data.method==='thread/resume')return {thread:{id:conversation.threadId},model:'fixture-model'};
    if(method==='agent.rpc'&&data.method==='thread/read')return {thread:{id:conversation.threadId,turns:[{items:[{id:'saved-reply',type:'agentMessage',text:'Recovered history'}]}]}};
    return original(method,data);
   };
   await window.renderTest('Agent',{width:320,planningMode:false,onPlanningModeChange(){},context:'{}',sessionSelection:{nonce:'restore',conversation},onError:error=>{throw error;}});
  });
  await page.getByText('Recovered history',{exact:true}).waitFor();
  const warning=page.getByTestId('codex-version-warning');
  await assertNotice(warning,'warning','Warning');
  assert.equal(await page.evaluate(()=>window.__test.calls.some(entry=>entry.method==='agent.rpc'&&entry.data.method==='turn/start')),false);
  await warning.getByRole('button',{name:'Dismiss version notice'}).click();
  await page.locator('.composer textarea').fill('A new draft in the restored conversation');
  assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isEnabled(),true);
  assert.equal(await page.getByTestId('agent-history-retry').count(),0);
 });
}
