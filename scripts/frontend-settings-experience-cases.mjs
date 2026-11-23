// Real DOM interaction, backed only by synthetic IPC. No provider, SSH or worker connection.
import assert from 'node:assert/strict';
import path from 'node:path';

export async function frontendSettingsExperienceCases({check,out}){
 const snapshot=(page,name)=>page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
 await check('experience-settings-github-first-update-access',async page=>{
  await page.evaluate(()=>{
   const original=window.studio.invoke;
   const access={nju:true,github:false};
   const state={phase:'idle',currentVersion:'1.2.3',sequence:1};
   window.__test.updateWrites=[];
   window.studio.invoke=async(method,data)=>{
    if(method==='updates.status'||method==='updates.check')return state;
    if(method==='updates.accessStatus')return {...access};
    if(method==='updates.setAccess'){
     window.__test.updateWrites.push(data);
     access[data.source]=data.token!==null;
     return {...access};
    }
    return original(method,data);
   };
   return window.renderTest('App');
  });
  await page.getByRole('button',{name:'软件更新',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByText('私有仓库访问',{exact:true}).click();
  const source=dialog.getByRole('combobox',{name:/发布源/}),token=dialog.getByLabel('只读访问令牌');
  assert.equal(await source.inputValue(),'github');
  await token.fill('unsaved-github-fixture');
  await source.selectOption('nju');
  assert.equal(await token.inputValue(),'');
  await dialog.getByRole('button',{name:'移除令牌'}).waitFor();
  await token.fill('nju-fixture');
  await dialog.getByRole('button',{name:'保存并检查'}).click();
  await source.selectOption('github');
  assert.equal(await token.inputValue(),'');
  assert.equal(await dialog.getByRole('button',{name:'移除令牌'}).count(),0);
  assert.deepEqual(await page.evaluate(()=>window.__test.updateWrites),[{source:'nju',token:'nju-fixture'}]);
 });
 await check('experience-settings-cluster-distinguishes-empty-limit-from-zero',async page=>{
  await page.evaluate(()=>{
   const test=window.__test;
   window.studio.invoke=async(method,data)=>{
    if(method==='ssh.existing')return [];
    if(method==='worker.request'&&data.target==='/api/clusters'){
     if(data.method==='POST')test.savedCluster={...data.data,id:'limit-fixture',version:1};
     return data.method==='POST'?test.savedCluster:test.savedCluster?[test.savedCluster]:[];
    }
    if(method==='worker.request'&&data.target==='/api/cluster/profile')return test.savedCluster;
    throw Error('Unexpected cluster limit fixture request: '+method);
   };
   return window.renderTest('ClusterPage',{worker:true,serviceVersion:'current',settings:{},onError:e=>{throw e;},onRefresh(){}});
  });
  await page.getByTestId('ssh-host').fill('fixture.invalid');
  await page.getByTestId('ssh-username').fill('fixture');
  await page.locator('.settings-advanced>summary').filter({hasText:/^更多/}).click();
  await page.getByRole('button',{name:'提交 Skill',exact:true}).click();
  const limit=page.getByRole('spinbutton',{name:'gpus',exact:true});
  await limit.fill('');
  assert.equal(await limit.inputValue(),'');
  await page.getByRole('button',{name:'保存连接',exact:true}).click();
  await page.getByText('请填写资源上限。 · gpus',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>!!window.__test.savedCluster),false);
  await limit.fill('0');
  await page.getByRole('button',{name:'保存连接',exact:true}).click();
  await page.getByText('连接已保存；项目授权未改变。',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__test.savedCluster.limits),{cpus:64,gpus:0,memory_mb:262144});
 });
 await check('experience-settings-storage-denied-language-preview-and-cancel',async page=>{
  await page.evaluate(()=>{
   window.__test.workerStatus={status:'disconnected',checkedAt:1};
   Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Fixture: storage disabled','SecurityError');}});
   return window.renderTest('App');
  });
  const settings=page.getByRole('button',{name:'设置',exact:true}).filter({visible:true});
  await settings.click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'语言',exact:true}).click();
  await dialog.locator('#settings-language').selectOption('en');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.lang),'en');
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'detached'});
  await settings.waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.lang),'zh-CN');
  assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='settings').length),0);
 });
 await check('experience-settings-idle-edit-and-save-when-preference-writes-fail',async page=>{
  const warnings=[];
  page.on('console',msg=>{if(/NaN/.test(msg.text()))warnings.push(msg.text());});
  await page.evaluate(()=>{
   Storage.prototype.setItem=()=>{throw new DOMException('Fixture: quota exhausted','QuotaExceededError');};
   return window.renderTest('App');
  });
  await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'计算连接',exact:true}).click();
  const idle=page.getByTestId('terminal-idle-minutes');
  await idle.fill('');
  assert.equal(await idle.inputValue(),'');
  await idle.pressSequentially('30');
  await dialog.getByRole('button',{name:'保存设置',exact:true}).click();
  await page.waitForFunction(()=>window.__test.settings.terminalIdleMinutes===30);
  assert.deepEqual(warnings,[]);
 });
 async function account(page){await page.evaluate(()=>{
  const f=window.__settingsFixture={calls:[],errors:[],saved:{schemaVersion:1,id:'fixture-api',provider:'compatible',credentialStored:true,revision:1,preset:'custom',api:'openai-completions',baseUrl:'https://fixture.invalid/v1',models:[{id:'fixture-model-a'}],defaultModel:'fixture-model-a',name:'Fixture API'}};
  window.studio.invoke=async(method,data)=>{f.calls.push({method,data});if(method==='models.profiles.list')return [f.saved];if(method==='models.profiles.save'){f.saved={...data.profile,revision:f.saved.revision+1,credentialStored:true,defaultModel:data.profile.models[0].id};return f.saved;}if(method==='models.profiles.test')return new Promise((resolve,reject)=>{f.finishTest=()=>{f.saved={...f.saved,modelAccess:'passed'};resolve({status:'passed',model:f.saved.defaultModel});};f.failTest=()=>reject(Error('Synthetic API unavailable'));});throw Error('Unexpected synthetic account action '+method);};
  document.getElementById('root').style.cssText='max-width:820px;margin:24px auto;padding:20px;background:var(--panel);color:var(--text)';
  return window.renderTest('ProviderLogin',{provider:'compatible',embedded:true,onClose(){},onConfigured(){},onError:error=>f.errors.push(String(error))});
 });await page.getByTestId('provider-base-url').waitFor();await page.waitForFunction(()=>document.querySelector('[data-testid=api-model-id-0]')?.value==='fixture-model-a');}
 async function files(page){await page.evaluate(()=>{
  const profile=id=>({id,name:id==='cluster-a'?'Fixture Cluster A':'Fixture Cluster B',version:1,auth_mode:'key',proxy_jump:[],host:'synthetic.invalid',username:'fixture',port:22,identity_file:'',ssh_client:'ssh',scheduler:'slurm',remote_root:'~/runs',read_roots:['~/inputs'],via:[],queue:'fixture',activation:'',environment:{executables:{python:'/synthetic/python'},repositories:{},variables:{}},limits:{cpus:1,gpus:0,memory_mb:1024}});
  const f=window.__settingsFixture={calls:[],errors:[],pending:[],delayBrowse:false,downloadMode:'cancel',file:(text='Synthetic preview A')=>({exists:true,base64:btoa(text),sha256:'a'.repeat(64),size:text.length})};
  window.studio.invoke=async(method,data)=>{f.calls.push({method,data});if(method==='ssh.existing')return [];if(method==='cluster.download'){if(f.downloadMode==='error')throw Error('Synthetic download error');if(f.downloadMode==='pending')return new Promise(resolve=>f.finishDownload=resolve);return f.downloadMode==='cancel'?null:{bytes:9,sha256:'a'.repeat(64)};}if(method==='worker.request'){if(data.target==='/api/clusters')return [profile('cluster-a'),profile('cluster-b')];if(data.target==='/api/cluster-runs')return [];if(data.target==='/api/cluster/profile')return profile(data.data.cluster_id);if(data.target==='/api/cluster/browse')return f.delayBrowse?new Promise((resolve,reject)=>f.pending.push({resolve,reject})):f.file();}throw Error('Unexpected synthetic file action '+method);};
  return window.renderTest('ClusterPage',{worker:true,serviceVersion:'current',project:{id:'project-a'},settings:{language:'zh-CN'},selectedClusterId:'cluster-a',onError:error=>f.errors.push(String(error)),onRefresh(){},onAgent(){},onRun(){},onTerminal(){},onConnectCompute:async()=>{},onAuthenticate(){}});
 });await page.locator('.cluster-selection select').first().selectOption('cluster-a');await page.locator('.settings-advanced>summary').filter({hasText:/^更多/}).click();await page.getByRole('button',{name:'远程文件',exact:true}).click();await page.getByTestId('cluster-files').waitFor();await page.getByRole('button',{name:'浏览 / 预览',exact:true}).waitFor();}
 async function preview(page,name='a.xyz'){await page.getByLabel('相对路径',{exact:true}).fill(name);await page.getByRole('button',{name:'浏览 / 预览',exact:true}).click();await page.getByRole('button',{name:'下载文件',exact:true}).waitFor();}
 const noRuns=async page=>assert.deepEqual(await page.evaluate(()=>window.__settingsFixture.calls.filter(c=>c.method==='task.execute'||c.method==='agent.rpc'||c.method==='worker.request'&&!['/api/clusters','/api/cluster-runs','/api/cluster/profile','/api/cluster/browse'].includes(c.data.target))),[]);

 await check('experience-settings-api-save-and-verify',async page=>{
  await account(page);await page.getByTestId('test-api-provider').click();await page.waitForFunction(()=>typeof window.__settingsFixture.finishTest==='function');assert.equal(await page.getByTestId('api-model-id-0').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'保存服务商配置',exact:true}).isDisabled(),true);await snapshot(page,'api-validation-pending');
  await page.evaluate(()=>window.__settingsFixture.finishTest());await page.getByText('测试调用成功 · fixture-model-a',{exact:true}).waitFor();await page.getByTestId('api-model-id-0').fill('fixture-model-b');assert.equal(await page.getByText('测试调用成功 · fixture-model-a',{exact:true}).count(),0);assert.equal(await page.getByTestId('test-api-provider').isDisabled(),true);await page.getByRole('button',{name:'保存服务商配置',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-testid=test-api-provider]').disabled);await page.getByTestId('test-api-provider').click();await page.evaluate(()=>window.__settingsFixture.finishTest());await page.getByText('测试调用成功 · fixture-model-b',{exact:true}).waitFor();await snapshot(page,'api-current-configuration-verified');assert.deepEqual(await page.evaluate(()=>window.__settingsFixture.errors),[]);
 });
 await check('experience-settings-api-error-and-retry',async page=>{
  await account(page);await page.getByTestId('test-api-provider').click();await page.waitForFunction(()=>typeof window.__settingsFixture.failTest==='function');await page.evaluate(()=>window.__settingsFixture.failTest());await page.getByText('Synthetic API unavailable',{exact:true}).waitFor();assert.equal(await page.getByTestId('test-api-provider').isEnabled(),true);await page.getByTestId('test-api-provider').click();await page.evaluate(()=>window.__settingsFixture.finishTest());await page.getByText('测试调用成功 · fixture-model-a',{exact:true}).waitFor();
 });
 await check('experience-settings-file-preview-follows-selection',async page=>{
  await files(page);await preview(page);await page.getByLabel('相对路径',{exact:true}).fill('b.xyz');assert.equal(await page.getByRole('button',{name:'下载文件',exact:true}).count(),0);assert.equal(await page.getByText('Synthetic preview A',{exact:true}).count(),0);await preview(page);await page.getByLabel('已授权读取根目录',{exact:true}).selectOption('1');assert.equal(await page.getByLabel('相对路径',{exact:true}).inputValue(),'');assert.equal(await page.getByRole('button',{name:'下载文件',exact:true}).count(),0);
  await page.evaluate(()=>window.__settingsFixture.delayBrowse=true);await page.getByLabel('相对路径',{exact:true}).fill('slow.xyz');await page.getByRole('button',{name:'浏览 / 预览',exact:true}).click();await page.waitForFunction(()=>window.__settingsFixture.pending.length===1);await page.getByLabel('相对路径',{exact:true}).fill('current.xyz');await page.getByRole('button',{name:'浏览 / 预览',exact:true}).click();await page.waitForFunction(()=>window.__settingsFixture.pending.length===2);await page.evaluate(()=>{const f=window.__settingsFixture;f.pending[1].resolve(f.file('Current selected file'));});await page.getByText('Current selected file',{exact:true}).waitFor();await page.evaluate(()=>{const f=window.__settingsFixture;f.pending[0].resolve(f.file('Obsolete file'));});assert.equal(await page.getByText('Obsolete file',{exact:true}).count(),0);await snapshot(page,'remote-current-file');await page.locator('.cluster-selection select').first().selectOption('cluster-b');await page.waitForFunction(()=>document.querySelector('.cluster-selection select')?.value==='cluster-b');assert.equal(await page.getByRole('button',{name:'下载文件',exact:true}).count(),0);await noRuns(page);
 });
 await check('experience-settings-file-download-cancel-error-success',async page=>{
  await files(page);await preview(page);await page.getByRole('button',{name:'下载文件',exact:true}).click();await page.waitForFunction(()=>window.__settingsFixture.calls.some(c=>c.method==='cluster.download'));assert.equal(await page.getByText('文件已下载并通过 SHA256 核对',{exact:true}).count(),0);
  await page.evaluate(()=>window.__settingsFixture.downloadMode='error');await page.getByRole('button',{name:'下载文件',exact:true}).click();await page.getByRole('alert').getByText('Synthetic download error',{exact:true}).waitFor();await page.evaluate(()=>window.__settingsFixture.downloadMode='pending');await page.getByRole('button',{name:'下载文件',exact:true}).click();await page.waitForFunction(()=>typeof window.__settingsFixture.finishDownload==='function');assert.equal(await page.getByRole('button',{name:'正在准备下载…',exact:true}).isDisabled(),true);await snapshot(page,'remote-download-pending');await page.evaluate(()=>window.__settingsFixture.finishDownload({bytes:9,sha256:'a'.repeat(64)}));await page.getByText('文件已下载并通过 SHA256 核对',{exact:true}).waitFor();const downloads=await page.evaluate(()=>window.__settingsFixture.calls.filter(c=>c.method==='cluster.download').map(c=>c.data));assert.equal(downloads.length,3);assert(downloads.every(data=>data.cluster_id==='cluster-a'&&data.relative==='a.xyz'&&data.expected_sha256==='a'.repeat(64)));await noRuns(page);
 });
}
