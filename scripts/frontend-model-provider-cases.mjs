// Actual DOM interactions with synthetic model profiles and IPC, never a live key.
import assert from 'node:assert/strict';
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
 await check('model-providers-composer-model-and-reasoning-selection',async page=>{
  await page.evaluate(()=>{const original=window.studio.invoke;window.__modelTurns=[];window.studio.invoke=async(method,data)=>{if(method==='agent.rpc'&&data.method==='model/list'||method==='agent.rpc'&&data.method==='model/select')return {data:[{id:'api:a:model-a',model:'api:a:model-a',displayName:'Model A',providerName:'Provider A',profileId:'a',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'off'},{reasoningEffort:'high'}],defaultReasoningEffort:'off'},{id:'api:a:model-b',model:'api:a:model-b',displayName:'Model B',providerName:'Provider A',profileId:'a',supportedReasoningEfforts:[]},{id:'api:b:model-c',model:'api:b:model-c',displayName:'Model C',providerName:'Provider B',profileId:'b',supportedReasoningEfforts:[]}]};if(method==='agent.rpc'&&data.method==='turn/start')window.__modelTurns.push(data.params);return original(method,data);};return window.renderTest('Agent',{planningMode:false,onPlanningModeChange(){},context:'{}',onError:error=>window.__test.modelError=String(error)});});await page.getByTestId('agent-options').click();await page.getByTestId('agent-provider').selectOption('qwen');await page.getByTestId('agent-connect').click();await page.waitForFunction(()=>document.querySelector('[data-testid=agent-model]')||document.querySelector('[data-testid=composer-model]'));if(await page.getByTestId('agent-options').getAttribute('aria-expanded')==='true')await page.getByTestId('agent-options').click();await page.getByTestId('composer-model').waitFor();await page.getByTestId('composer-effort').selectOption('high');await page.getByTestId('composer-model').selectOption('api:a:model-b');await page.waitForFunction(()=>document.querySelector('[data-testid=composer-effort]')?.disabled);await page.getByTestId('composer-model').selectOption('api:a:model-a');await page.getByTestId('composer-effort').selectOption('high');await page.locator('.composer textarea').fill('Synthetic model selection question');await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>window.__modelTurns.length===1);const turn=await page.evaluate(()=>window.__modelTurns[0]);assert.equal(turn.model,'api:a:model-a');assert.equal(turn.effort,'high');await page.evaluate(()=>window.__test.events.forEach(fn=>fn({provider:'qwen',method:'turn/completed',params:{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'completed'}}})));await page.waitForFunction(()=>!document.querySelector('[data-testid=composer-model]').disabled);assert.equal(await page.locator('[data-testid=composer-model] option[value="api:b:model-c"]').isDisabled(),true);await page.screenshot({path:path.join(out,'composer-model-effort.png')});
 });
}
