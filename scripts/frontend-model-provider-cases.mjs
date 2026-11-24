// Actual DOM interactions with synthetic model profiles and IPC, never a live key.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function frontendModelProviderCases({check,out}){
 for(const scenario of ['matched','missing-model','missing-effort']){
  await check('model-providers-codex-native-defaults-'+scenario,async page=>{
   await page.evaluate(async scenario=>{
    const original=window.studio.invoke;
    const defaults={id:'fixture-import',model:scenario==='missing-model'?'unlisted':'native-model',effort:scenario==='missing-effort'?'unlisted-effort':'high'};
    window.studio.invoke=async(method,data)=>{
     if(method==='agent.connect')return {tools:{status:'ready',count:1},nativeCodexDefaults:defaults};
     if(method==='agent.rpc'&&data.method==='model/list'){
      const next=data.params?.cursor==='next-page',model=next?'native-model':'account-model';
      return {data:[{model,displayName:model,isDefault:!next,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low'}],nextCursor:next?null:'next-page'};
     }
     return original(method,data);
    };
    await window.renderTest('Agent',{width:640,planningMode:false,onPlanningModeChange(){},context:'{}',onError:error=>{throw error;}});
   },scenario);
   const connect=page.getByTestId('agent-connect');
   if(!await connect.isVisible())await page.getByTestId('agent-options').click();
   await connect.click();
   const model=page.getByTestId('agent-model'),effort=page.getByTestId('agent-effort');
   await page.locator('.composer textarea').fill('Synthetic selection check');
   const send=page.getByRole('button',{name:'发送',exact:true});
   if(scenario!=='matched'){
    const review=page.getByTestId('codex-model-defaults-review');await review.waitFor();
    assert.match(await review.innerText(),scenario==='missing-model'?/unlisted/:/unlisted-effort/);
    assert(await send.isDisabled());
    await model.selectOption('native-model');await effort.selectOption('high');
    await review.getByRole('button',{name:'确认使用所选配置'}).click();
    await review.waitFor({state:'detached'});
   }
   await page.waitForFunction(()=>localStorage.getItem('studio.codex.appliedDefaults')==='fixture-import');
   assert.equal(await model.inputValue(),'native-model');
   assert.equal(await effort.inputValue(),'high');
   await send.click();
   await page.waitForFunction(()=>window.__test.calls.some(c=>c.method==='agent.rpc'&&c.data.method==='turn/start'));
   const turn=await page.evaluate(()=>window.__test.calls.find(c=>c.method==='agent.rpc'&&c.data.method==='turn/start').data.params);
   assert.equal(turn.model,'native-model');assert.equal(turn.effort,'high');
  });
 }
 await check('model-providers-codex-first-use-import-choices',async page=>{
  await page.evaluate(()=>{
   const previous=window.studio.invoke;
   window.importModes=[];
   window.showImport=()=>{
    window.pendingImport={requestId:String(window.importModes.length+1),sourceState:'available'};
    window.__test.events.forEach(fn=>fn({method:'studio/codexEnvImport',params:{prompt:window.pendingImport}}));
   };
   window.pendingImport={requestId:'1',sourceState:'available',hasModelDefaults:true};
   window.studio.invoke=async(method,data)=>{
    if(method==='codex.envImport.pending')return window.pendingImport;
    if(method==='codex.envImport.decide'){
     window.importModes.push(data.mode);
     if(data.requestId==='1')window.useModels=data.useModelDefaults;
     window.__test.events.forEach(fn=>fn({method:'studio/codexEnvImport',params:{prompt:null}}));
     return null;
    }
    return previous(method,data);
   };
   return window.renderTest('App');
  });
  const dialog=page.getByRole('dialog',{name:'首次启动 Codex'});
  for(const [index,mode] of ['proxy','full','none','cancel'].entries()){
   if(index)await page.evaluate(()=>window.showImport());
   await dialog.waitFor();
   const proxy=dialog.getByLabel('仅迁移代理变量'),full=dialog.getByLabel('复制整份 .env');
   assert(await proxy.isChecked());assert.equal(await full.isChecked(),false);
   if(!index){const modelDefaults=dialog.getByLabel('沿用本机默认模型和推理强度');assert.equal(await modelDefaults.isChecked(),false);await modelDefaults.check();}
   if(mode==='full'){await full.check();assert.equal(await proxy.isChecked(),false);}
   if(mode==='none'){await proxy.uncheck();assert.equal(await full.isChecked(),false);}
   if(mode==='cancel')await page.keyboard.press('Escape');else await dialog.getByRole('button',{name:'继续启动'}).click();
   await dialog.waitFor({state:'detached'});
  }
  assert.deepEqual(await page.evaluate(()=>window.importModes),['proxy','full','none','cancel']);
  assert.equal(await page.evaluate(()=>window.useModels),true);
 });
 await check('model-providers-codex-fresh-install-connect-to-login',async page=>{
  await page.evaluate(()=>{
   const previous=window.studio.invoke;
   window.studio.invoke=async(method,data)=>{
    if(method==='codex.envImport.pending')return null;
    if(method==='agent.account')return {account:null,requiresOpenaiAuth:true};
    if(method==='agent.connect'){
     window.__test.events.forEach(fn=>fn({method:'studio/codexEnvImport',params:{prompt:{sourceState:'absent',requestId:'new'}}}));
     return new Promise(resolve=>{window.finishConnect=resolve;});
    }
    if(method==='codex.envImport.decide'){
     window.selectedMode=data.mode;
     window.__test.events.forEach(fn=>fn({method:'studio/codexEnvImport',params:{prompt:null}}));
     window.finishConnect({provider:'codex',loginRequired:true});return null;
    }
    if(method==='agent.login'){window.loginType=data.type;return {provider:'codex',phase:'authorizing',loginId:'fixture',url:'https://auth.openai.com/fixture'};}
    return previous(method,data);
   };
   return window.renderTest('App');
  });
  const connect=page.getByTestId('agent-connect');
  await page.getByTestId('agent-options').waitFor();
  if(!await connect.isVisible())await page.getByTestId('agent-options').click();
  await connect.click();
  const dialog=page.getByRole('dialog',{name:'首次启动 Codex'});await dialog.waitFor();
  assert.equal(await dialog.getByRole('checkbox').count(),0);
  assert.match(await dialog.innerText(),/本机没有 Codex .env/);
  await dialog.getByRole('button',{name:'继续启动'}).click();
  const account=page.getByTestId('account-center');
  await account.getByLabel('登录方式').waitFor();
  assert.equal(await account.getByLabel('登录方式').inputValue(),'chatgpt');
  assert.equal(await page.evaluate(()=>window.selectedMode),'none');
  await account.getByRole('button',{name:'开始登录'}).click();
  await page.waitForFunction(()=>window.loginType==='chatgpt');
  await account.getByRole('button',{name:'打开官方授权页面'}).waitFor();
  await page.screenshot({path:path.join(out,'codex-fresh-install-login.png')});
 });
 await check('model-providers-codex-config-without-env',async page=>{
  await page.evaluate(()=>{
   const original=window.studio.invoke;
   window.studio.invoke=async(method,data)=>{
    if(method==='codex.envImport.pending')return {requestId:'config-only',sourceState:'absent',hasSystemProxy:true,hasModelDefaults:true};
    if(method==='codex.envImport.decide'){window.importAnswer=data;return null;}
    return original(method,data);
   };
   return window.renderTest('App');
  });
  const dialog=page.getByRole('dialog',{name:'首次启动 Codex'}),proxy=dialog.getByLabel('沿用本机 Codex 代理设置'),model=dialog.getByLabel('沿用本机默认模型和推理强度');
  assert(await proxy.isChecked());assert.equal(await model.isChecked(),false);
  assert.equal(await dialog.getByLabel('复制整份 .env').count(),0);
  await proxy.uncheck();await model.check();await dialog.getByRole('button',{name:'继续启动'}).click();
  await page.waitForFunction(()=>!!window.importAnswer);
  assert.deepEqual(await page.evaluate(()=>window.importAnswer),{requestId:'config-only',mode:'none',useModelDefaults:true,useSystemProxy:false});
 });
 await check('model-providers-keyless-local-image-capability-settings',async page=>{
  await page.evaluate(()=>{
   const fixture=window.__localModelFixture={saved:{schemaVersion:1,id:'fixture-local',provider:'compatible',name:'Local fixture',baseUrl:'http://127.0.0.1:11434/v1',api:'openai-completions',preset:'custom',models:[{id:'local-model'},{id:'local-vision',input:['text','image']}],defaultModel:'local-model',credentialStored:false,requiresApiKey:false,revision:1}};
   window.studio.invoke=async(method,data)=>{
    if(method==='models.profiles.list')return [fixture.saved];
    if(method==='models.profiles.save'){
     fixture.saved={...data.profile,revision:fixture.saved.revision+1};
     return fixture.saved;
    }
    throw Error('Unexpected keyless fixture action '+method);
   };
   return window.renderTest('ProviderLogin',{provider:'compatible',embedded:true,onClose(){},onConfigured(){},onError:error=>{throw error;}});
  });
  await page.locator('.model-provider-row small').waitFor();
  assert.match(await page.locator('.model-provider-row small').innerText(),/本机服务无需密钥/);
  assert.equal(await page.getByTestId('provider-api-key').inputValue(),'');
  const textModel=page.getByTestId('api-model-0'),visionModel=page.getByTestId('api-model-1');
  const textToggle=textModel.getByRole('checkbox',{name:'支持图片输入',exact:true});
  const visionToggle=visionModel.getByRole('checkbox',{name:'支持图片输入',exact:true});
  await textModel.locator('summary').press('Enter');
  await visionModel.locator('summary').press('Enter');
  assert.equal(await textToggle.isChecked(),false);
  assert.equal(await visionToggle.isChecked(),true);
  await textToggle.press('Space');
  await visionToggle.press('Space');
  await page.getByTestId('save-api-provider').click();
  await page.waitForFunction(()=>window.__localModelFixture.saved.revision===2);
  assert.deepEqual(await page.evaluate(()=>window.__localModelFixture.saved.models.map(model=>model.input)),[['text','image'],['text']]);
  await page.getByTestId('provider-row-fixture-local').click();
  assert.equal(await textToggle.isChecked(),true);
  assert.equal(await visionToggle.isChecked(),false);
 });
 await check('model-providers-codex-first-login-account-entry',async page=>{
  await page.evaluate(()=>{
   window.__authFixture={calls:[]};window.studio.invoke=async(method,data)=>{
    window.__authFixture.calls.push({method,data});
    if(method==='agent.account')return {account:null,requiresOpenaiAuth:true};
    if(method==='agent.login')return {provider:'codex',phase:'authorizing',loginId:'attempt',url:'https://auth.openai.com/fixture-only',userCode:'FIXTURE-AUTH-CODE'};
    if(method==='agent.login.cancel')return {provider:'codex',phase:'cancelled'};
    if(method==='agent.login.open')return {};
    throw Error('Unexpected authentication fixture action');
   };
   return window.renderTest('ProviderLogin',{provider:'codex',embedded:true,onClose(){},onConfigured(){},onError:error=>{throw error;}});
  });
  await page.getByText('尚未登录',{exact:true}).waitFor();const method=page.getByRole('combobox');await method.waitFor();await method.selectOption('chatgptDeviceCode');await page.getByRole('button',{name:'开始登录',exact:true}).click();await page.getByText('FIXTURE-AUTH-CODE',{exact:true}).waitFor();await page.getByRole('button',{name:'打开官方授权页面',exact:true}).click();
  await page.getByText('请在浏览器完成授权',{exact:true}).waitFor();
  await page.evaluate(()=>window.__test.events.forEach(fn=>fn({method:'studio/login',provider:'codex',params:{phase:'failed',message:'Fixture authorization declined'}})));
  await page.getByRole('alert').filter({hasText:'Fixture authorization declined'}).waitFor();
  await page.getByRole('button',{name:'重新登录',exact:true}).click();await page.getByRole('button',{name:'取消登录',exact:true}).click();
  await page.getByText('已取消登录',{exact:true}).waitFor();
  const calls=await page.evaluate(()=>window.__authFixture.calls);assert.deepEqual(calls.find(v=>v.method==='agent.login.cancel').data,{provider:'codex',loginId:'attempt'});assert.equal(calls.find(v=>v.method==='agent.login').data.type,'chatgptDeviceCode');assert(calls.some(v=>v.method==='agent.login.open'));assert(!calls.some(v=>v.method==='agent.connect'));
 });
 async function editor(page){await page.evaluate(()=>{
  const saved={schemaVersion:1,id:'fixture-api',provider:'qwen',name:'Qwen Token Plan · Fixture',baseUrl:'https://fixture.invalid/v1',api:'openai-completions',preset:'custom',models:[{id:'model-a',name:'Model A',contextWindow:128000,maxTokens:8192,reasoningEfforts:{off:null,low:'low',high:'xhigh'}},{id:'model-b',name:'Model B',reasoningEfforts:false}],defaultModel:'model-a',credentialStored:true,revision:1};
  const f=window.__modelProfiles={saved,calls:[],errors:[]};window.studio.invoke=async(method,data)=>{f.calls.push({method,data});if(method==='models.profiles.list')return [f.saved];if(method==='models.profiles.save'){f.saved={...data.profile,defaultModel:data.profile.models.some(v=>v.id===data.profile.defaultModel)?data.profile.defaultModel:data.profile.models[0].id,revision:f.saved.revision+1,credentialStored:true};return f.saved;}if(method==='models.profiles.discover')return {source:'endpoint',models:[{id:'model-a'},{id:'model-c',name:'Model C',contextWindow:64000}]};if(method==='models.profiles.test')return new Promise(resolve=>f.complete=()=>resolve({status:'passed',model:data.model}));throw Error('Unexpected model settings IPC '+method);};
  document.getElementById('root').style.cssText='max-width:900px;margin:24px auto;padding:20px;background:var(--panel);color:var(--text)';return window.renderTest('ProviderLogin',{provider:'qwen',embedded:true,onClose(){},onConfigured(){},onError:error=>f.errors.push(String(error))});
 });await page.getByTestId('provider-base-url').waitFor();}
 await check('model-providers-qwen-multiple-models-discovery-and-write-only-key',async page=>{
  await editor(page);assert.equal(await page.getByTestId('provider-api-key').inputValue(),'');assert.equal(await page.locator('.api-model-card').count(),2);assert.equal(await page.getByTestId('provider-public-guides').isChecked(),false);
  await page.getByTestId('api-model-0').locator('summary').click();await page.getByLabel('high API 参数值',{exact:true}).fill('vendor-high');await page.getByTestId('discover-api-models').click();await page.getByLabel('搜索发现的模型',{exact:true}).fill('model-c');await page.locator('.model-discovery-candidates input[type=checkbox]').check();await page.getByTestId('adopt-api-models').click();assert.equal(await page.locator('.api-model-card').count(),3);await page.getByTestId('save-api-provider').click();await page.waitForFunction(()=>window.__modelProfiles.saved.models.length===3);const saved=await page.evaluate(()=>window.__modelProfiles.saved);assert.equal(saved.models[0].reasoningEfforts.high,'vendor-high');assert.equal(saved.models[2].id,'model-c');assert.equal(await page.getByTestId('provider-api-key').inputValue(),'');assert.equal(await page.evaluate(()=>window.__modelProfiles.calls.some(v=>v.method.startsWith('agent.cli')||v.method==='agent.login')),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,'qwen-model-providers.png'),fullPage:true});
 });
 await check('model-providers-visible-operation-feedback',async page=>{
  await editor(page);
  await page.evaluate(()=>{const original=window.studio.invoke;window.studio.invoke=(method,data)=>new Promise((resolve,reject)=>{window.__modelProfiles.finish=()=>Promise.resolve(original(method,data)).then(resolve,reject);});});
  for(const [id,label] of [['discover-api-models','正在获取可用模型'],['save-api-provider','正在保存服务商配置'],['test-api-provider','正在验证 API 连接']]){
   const button=page.getByTestId(id);await button.click();const status=button.getByRole('status');await status.waitFor();
   assert.equal(await status.innerText(),label);
   assert(await status.evaluate(element=>{const rect=element.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight;}));
   await page.evaluate(()=>{void window.__modelProfiles.finish();});
   if(id==='test-api-provider'){await page.waitForFunction(()=>!!window.__modelProfiles.complete);await page.evaluate(()=>window.__modelProfiles.complete());}
   await status.waitFor({state:'detached'});
  }
 });
 await check('model-providers-dirty-save-validation-single-flight',async page=>{
  await editor(page);await page.getByTestId('test-api-provider').click();await page.waitForFunction(()=>window.__modelProfiles.complete);assert.equal(await page.getByTestId('save-api-provider').isDisabled(),true);await page.evaluate(()=>window.__modelProfiles.complete());await page.getByText('测试调用成功 · model-a',{exact:true}).waitFor();await page.getByTestId('api-model-id-0').fill('renamed-model');assert.equal(await page.getByTestId('test-api-provider').isDisabled(),true);assert.equal(await page.getByText('测试调用成功 · model-a',{exact:true}).count(),0);await page.getByTestId('save-api-provider').click();await page.getByTestId('test-api-provider').click();await page.evaluate(()=>window.__modelProfiles.complete());await page.getByText('测试调用成功 · renamed-model',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.__modelProfiles.errors),[]);
 });
 await check('model-providers-deepseek-account-native-credential-mode',async page=>{
  await editor(page);await page.evaluate(()=>{window.__modelProfiles.saved.provider='compatible';return window.renderTest('ProviderLogin',{provider:'compatible',embedded:true,onClose(){},onConfigured(){},onError:error=>window.__modelProfiles.errors.push(String(error))});});await page.getByTestId('provider-auth-mode').waitFor();await page.getByTestId('provider-api-key').fill('synthetic-unsaved-key');await page.getByTestId('provider-auth-mode').selectOption('deepseek-account');assert.equal(await page.getByTestId('provider-base-url').inputValue(),'https://api.deepseek.com/anthropic');assert.equal(await page.getByTestId('provider-protocol').inputValue(),'anthropic-messages');assert.equal(await page.getByTestId('provider-api-key').inputValue(),'');await page.getByText('账户令牌与 API Key 不同，仅发送到官方 DeepSeek 地址；过期后需重新导入。',{exact:true}).waitFor();await page.getByTestId('save-api-provider').click();await page.waitForFunction(()=>window.__modelProfiles.saved.authMode==='deepseek-account');assert.equal(await page.getByTestId('provider-public-guides').isChecked(),false);await page.screenshot({path:path.join(out,'deepseek-account-profile.png'),fullPage:true});
 });
 async function accountDialogs(page){
  await page.evaluate(()=>{
   const prior=window.studio.invoke;
   const fixture=window.__accountDialogs={stored:{},calls:[],configured:0,tested:0,page:'agent'};
   const guide=()=>({page:fixture.page,directory:'fixture profile',directoryKind:'profile'});
   const profile=provider=>({schemaVersion:1,id:'saved-'+provider,provider,name:'Saved '+provider,
    baseUrl:'https://fixture.invalid/v1',api:'openai-completions',preset:provider==='qwen'?'token-cn':'custom',
    models:[{id:'fixture-model'}],defaultModel:'fixture-model',revision:1,credentialStored:true});
   window.studio.invoke=async(method,data)=>{
    if(method==='state')return {...await prior(method,data),setupGuide:guide()};
    if(method==='onboarding.progress'){fixture.page=data.page;return guide();}
    if(/^(models\.profiles\.|agent\.(?:account|login|logout|testConnection|connect|rpc))/.test(method))fixture.calls.push([method,data?.provider??data?.profile?.provider]);
    if(method==='agent.account'){
     const saved=fixture.stored[data.provider];
     if(data.provider==='codex')return {modelAccess:'not_run',requiresOpenaiAuth:true,account:saved?{type:'apiKey'}:null};
     if(data.provider==='kimi')return {modelAccess:'not_run',phase:saved?'completed':'signed_out'};
     return {modelAccess:'not_run',credentialStored:!!saved};
    }
    if(method==='models.profiles.list')return fixture.stored[data.provider]?[profile(data.provider)]:[];
    if(method==='models.profiles.save'){
     fixture.stored[data.profile.provider]=true;
     return {...data.profile,revision:1,credentialStored:true,modelAccess:'not_run'};
    }
    return prior(method,data);
   };
  });
 }
 const exitButton=page=>page.getByTestId('provider-dialog-exit');
 const accountCalls=page=>page.evaluate(()=>window.__accountDialogs.calls);
 const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const guideTarget=(page,target)=>page.waitForFunction(target=>document.querySelector('.guide-spotlight[data-ready="true"]')?.dataset.target===target,target);
 async function leaveAccount(page,label){
  const exit=exitButton(page);
  await exit.and(page.getByRole('button',{name:label,exact:true})).waitFor();
  assert.equal(await exit.evaluate(element=>element.classList.contains('primary')),label==='完成');
  const calls=await accountCalls(page);
  await exit.click();
  await exit.waitFor({state:'detached'});
  await frames(page);
  assert.deepEqual(await accountCalls(page),calls,'manual exit must send no account requests');
 }

 await check('model-providers-guide-experience-inputs-and-explicit-exit',async page=>{
  await accountDialogs(page);
  await page.evaluate(()=>window.renderTest('App'));
  const assistant=page.getByTestId('setup-assistant');
  const open=()=>assistant.getByRole('button',{name:'配置账号',exact:true}).click();
  const observed=[];
  for(const [provider,name,initial,target] of [
   ['codex',/Codex/,'login-method','codex-api-key'],['kimi',/Kimi/,'login-region','login-region'],
   ['deepseek',/DeepSeek API/,'api-key','api-key'],['qwen',/Qwen/,'add-api','api-endpoint'],
   ['compatible',/自定义 API/,'add-api','api-endpoint']
  ]){
   const select=assistant.locator('.setup-providers').getByRole('button',{name});
   await select.click();
   await select.and(assistant.locator('[aria-pressed="true"]')).waitFor();
   await open();await guideTarget(page,initial);
   const dialog=page.getByRole('dialog').filter({has:exitButton(page)});
   await exitButton(page).and(page.getByRole('button',{name:'稍后配置',exact:true})).waitFor();
   if(provider==='codex')await dialog.getByLabel('登录方式').selectOption('apiKey');
   if(initial==='add-api')await dialog.getByTestId('add-api-provider').click();
   await guideTarget(page,target);
   const input=dialog.locator(`[data-guide-target="${target}"]`).first();
   if(provider==='kimi')await input.selectOption('global');
   else await input.fill(target==='api-endpoint'?'https://unsaved.invalid/v1':'synthetic-unsaved');
   await leaveAccount(page,'放弃修改并关闭');

   await page.evaluate(provider=>{window.__accountDialogs.stored[provider]=true;},provider);
   await open();
   await guideTarget(page,initial==='add-api'?'api-endpoint':initial);
   if(initial==='add-api')assert.equal(await dialog.getByTestId('provider-api-key').inputValue(),'');
   if(provider==='deepseek')assert.equal(await dialog.getByTestId('deepseek-api-key').inputValue(),'');
   await leaveAccount(page,'完成');
   observed.push({provider,first:initial,input:target,discardsUnsaved:true,closesSaved:true,exitRequests:0});
  }
  assert((await accountCalls(page)).every(([method])=>['agent.account','models.profiles.list'].includes(method)));
  await fs.writeFile(path.join(out,'setup-account-exits.json'),JSON.stringify(observed,null,2)+'\n');
 });

 await check('model-providers-dialog-experience-saved-credentials-do-not-verify-models',async page=>{
  await accountDialogs(page);
  await page.evaluate(()=>{
   const fixture=window.__accountDialogs;
   return window.renderTest('ProviderLogin',{provider:'compatible',onClose:()=>window.testRoot.render(null),
    onConfigured:()=>fixture.configured++,onTested:()=>fixture.tested++,onError:()=>{}});
  });
  const dialog=page.getByRole('dialog').filter({has:exitButton(page)});
  await dialog.getByTestId('add-api-provider').click();
  await dialog.getByTestId('provider-base-url').fill('https://fixture.invalid/v1');
  await dialog.getByTestId('provider-api-key').fill('synthetic-key');
  await dialog.getByTestId('api-model-id-0').fill('fixture-model');
  await dialog.getByTestId('save-api-provider').click();
  await exitButton(page).and(page.getByRole('button',{name:'完成',exact:true})).waitFor();
  assert.equal(await dialog.getByTestId('provider-api-key').inputValue(),'');
  assert.equal(await dialog.getByText(/测试调用成功/).count(),0);
  assert.deepEqual(await accountCalls(page),[['models.profiles.list','compatible'],['models.profiles.save','compatible']]);
  const samples=[];
  for(const theme of ['dark','light']){
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
   const colors=await exitButton(page).evaluate(button=>{
    const {color,backgroundColor}=getComputedStyle(button);
    const luminance=value=>value.match(/\d+/g).slice(0,3).map(Number).map(channel=>channel/255)
     .map(channel=>channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4)
     .reduce((sum,channel,index)=>sum+channel*[0.2126,0.7152,0.0722][index],0);
    const [low,high]=[luminance(color),luminance(backgroundColor)].sort((a,b)=>a-b);
    const box=button.getBoundingClientRect(),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
    return {color,backgroundColor,contrast:(high+0.05)/(low+0.05),visible:button.contains(hit)};
   });
   assert(colors.contrast>=4.5);
   assert.equal(colors.visible,true,'the completion action is visible while the form can scroll');
   samples.push({theme,...colors});
   await dialog.screenshot({path:path.join(out,'account-dialog-done-'+theme+'.png')});
  }
  await fs.writeFile(path.join(out,'account-dialog-done-contrast.json'),JSON.stringify(samples,null,2)+'\n');
  await dialog.getByTestId('provider-base-url').fill('https://unsaved.invalid/v1');
  await leaveAccount(page,'放弃修改并关闭');
  assert.deepEqual(await page.evaluate(()=>({configured:window.__accountDialogs.configured,tested:window.__accountDialogs.tested})),{configured:1,tested:0});

  await page.evaluate(()=>window.renderTest('AccountCenter',{provider:'compatible',busy:false,onError:()=>{}}));
  await page.getByTestId('account-center').getByTestId('provider-api-key').waitFor();
  assert.equal(await exitButton(page).count(),0);
  assert.equal(await page.locator('.account-dialog-scroll').count(),0);
  assert.equal(await page.getByTestId('provider-base-url').inputValue(),'https://fixture.invalid/v1');
 });

 await check('model-providers-composer-model-and-reasoning-selection',async page=>{
  await page.evaluate(()=>{const original=window.studio.invoke;window.__modelTurns=[];window.studio.invoke=async(method,data)=>{if(method==='agent.rpc'&&data.method==='model/list'||method==='agent.rpc'&&data.method==='model/select')return {data:[{id:'api:a:model-a',model:'api:a:model-a',displayName:'Model A',providerName:'Provider A',profileId:'a',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'off'},{reasoningEffort:'high'}],defaultReasoningEffort:'off'},{id:'api:a:model-b',model:'api:a:model-b',displayName:'Model B',providerName:'Provider A',profileId:'a',supportedReasoningEfforts:[]},{id:'api:b:model-c',model:'api:b:model-c',displayName:'Model C',providerName:'Provider B',profileId:'b',supportedReasoningEfforts:[]}]};if(method==='agent.rpc'&&data.method==='turn/start')window.__modelTurns.push(data.params);return original(method,data);};return window.renderTest('Agent',{planningMode:false,onPlanningModeChange(){},context:'{}',onError:error=>window.__test.modelError=String(error)});});await page.getByTestId('agent-options').click();await page.getByTestId('agent-provider').selectOption('qwen');await page.getByTestId('agent-connect').click();await page.waitForFunction(()=>document.querySelector('[data-testid=agent-model]')||document.querySelector('[data-testid=composer-model]'));if(await page.getByTestId('agent-options').getAttribute('aria-expanded')==='true')await page.getByTestId('agent-options').click();await page.getByTestId('composer-model').waitFor();await page.getByTestId('composer-effort').selectOption('high');await page.getByTestId('composer-model').selectOption('api:a:model-b');await page.waitForFunction(()=>document.querySelector('[data-testid=composer-effort]')?.disabled);await page.getByTestId('composer-model').selectOption('api:a:model-a');await page.getByTestId('composer-effort').selectOption('high');await page.locator('.composer textarea').fill('Synthetic model selection question');await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>window.__modelTurns.length===1);const turn=await page.evaluate(()=>window.__modelTurns[0]);assert.equal(turn.model,'api:a:model-a');assert.equal(turn.effort,'high');await page.evaluate(()=>window.__test.events.forEach(fn=>fn({provider:'qwen',method:'turn/completed',params:{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'completed'}}})));await page.waitForFunction(()=>!document.querySelector('[data-testid=composer-model]').disabled);assert.equal(await page.locator('[data-testid=composer-model] option[value="api:b:model-c"]').isDisabled(),true);await page.screenshot({path:path.join(out,'composer-model-effort.png')});
 });
}
