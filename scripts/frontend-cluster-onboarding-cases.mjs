import assert from 'node:assert/strict';
import path from 'node:path';

const profile={id:'guide-resource',version:4,kind:'ssh',name:'Fixture research cluster',host:'fixture.invalid',username:'fixture',port:22,ssh_client:'ssh',mode:'interactive'};
const target={project_id:'fixture-project',environment_id:'fixture-env',cluster_id:'fixture-scheduler',queue_target_id:'fixture-queue',queue:'short',scheduler:'slurm'};
const copy={
 'zh-CN':{welcome:'欢迎使用 AIMatterLab',agent:'选择你的 AI 助手',compute:'在哪里运行计算？',ready:'开始使用工作台',next:'继续',later:'稍后配置',remote:/^远程集群/,light:'浅色',dark:'深色石墨',setup:'配置资源工具',dismiss:'关闭提示',discuss:'让 Agent 帮我配置',close:'关闭'},
 en:{welcome:'Welcome to AIMatterLab',agent:'Choose your AI assistant',compute:'Where will you compute?',ready:'Explore your workspace',next:'Continue',later:'Set up later',remote:/^Remote cluster/,light:'Light',dark:'Graphite',setup:'Set up resource tools',dismiss:'Dismiss hint',discuss:'Set up with Agent',close:'Close'}
};

async function mountGuide(page,{language='zh-CN',theme='dark',font=18,start='welcome',empty=false,fail=false,withoutProfile=false,readySsh=false}={}){
 await page.evaluate(({language,theme,font,start,empty,fail,withoutProfile,readySsh,profile,target})=>{
  const f=window.__test,original=window.studio.invoke;
  const guide={page:start,directory:'C:/fixture/aim/profile',directoryKind:'profile'};
  const projectScope={profileId:profile.id,profileVersion:profile.version,connectionId:'original-master'};
  Object.assign(f.settings,{language,theme,fontSize:font,minimumFontSize:font===24?18:17,chatFontSize:font});
  if(!withoutProfile){
   const progress={profileId:profile.id,profileVersion:profile.version,name:profile.name,step:'resource-tools',route:'fresh'};
   localStorage.setItem('studio.clusterGuide',JSON.stringify({[JSON.stringify([profile.id,profile.version])]:progress}));
  }
  f.toolReads=0;f.scans=0;
  window.studio.invoke=async(method,data)=>{
   if(method==='state')return {...await original(method,data),setupGuide:{...guide}};
   if(method==='onboarding.progress'){f.calls.push({method,data});guide.page=data.page;return {...guide};}
   if(method==='compute.resource.status')return readySsh?{...projectScope,schemaVersion:2,kind:'ssh-connection',selectionId:'guide-selection',status:'selected',authentication:'verified',workflowReady:true,managedRuns:true,alive:true,capabilities:{terminal:{status:'ready',sessionIds:[],operator:'human',agentReady:false},service:{status:'connected',workflowReady:true,operator:'human',agentReady:false},files:{status:'requires_authorized_project',via:'job-service'}}}:{schemaVersion:2,kind:null,selectionId:null,status:'none'};
   if(method==='compute.profiles.list')return {profiles:withoutProfile?[]:[profile],defaults:{distribution:'Ubuntu',root:'~/fixture',port:8767,ssh_client:'ssh'}};
   if(method==='compute.profiles.read')return profile;
   if(method==='compute.managed.snapshot')return {resources:[],conversations:[],sources:[]};
   if(['compute.console.snapshot','compute.console.refresh'].includes(method))return {resources:[],standalone:[],projects:[],observation:'unverified',checkedAt:null};
   if(method==='compute.sshConnection.list')return {connections:[]};
   if(method==='compute.sshService.registration')return {status:'unconfigured'};
   if(method==='compute.resourceWorkspace.read'){
    f.calls.push({method,data});const root='/home/fixture/AIMatterLab';
    return {...data,root,directories:[root+'/workfile',root+'/software'],status:'confirmed'};
   }
   if(readySsh&&method==='worker.request'&&data.method==='POST'&&data.target==='/api/projects'){
    f.calls.push({method,data});
    if(!data.projectScope||Object.entries(projectScope).some(([key,value])=>data.projectScope[key]!==value))throw Error('Missing exact project scope');
    if(f.projectWorkerChanged)throw Error('project_edit_unavailable');
    f.projectSaved=true;f.project={id:'reviewed-project',...data.data};return f.project;
   }
   if(method.startsWith('tools.resource.')){
    f.calls.push({method,data});
    if(data.resource_id!=='ssh:'+profile.id||data.profile_version!==profile.version)throw Error('Incorrect fixture resource');
    if(method==='tools.resource.list'){
     if(++f.toolReads===1&&fail)throw Error('Fixture tool library temporarily unavailable');
     return {setups:[],targets:empty&&!f.projectSaved?[]:[target],...readySsh?{workfile_root:'/home/fixture/AIMatterLab/workfile',schedulers:[{id:target.cluster_id,name:'Fixture scheduler',scheduler:'slurm',queue:target.queue}]}:{}};
    }
    if(method==='tools.resource.discover'){
     if(++f.scans===1&&fail)throw Error('Fixture directory scan temporarily unavailable');
     return {directory:data.directory,truncated:false,candidates:[]};
    }
    throw Error('Unexpected tool setup action '+method);
   }
   return original(method,data);
  };
  return window.renderTest('App');
 },{language,theme,font,start,empty,fail,withoutProfile,readySsh,profile,target});
}

async function visibleInWindow(locator){
 await locator.scrollIntoViewIfNeeded();
 const box=await locator.boundingBox(),viewport=locator.page().viewportSize();
 assert.ok(box&&box.x>=-1&&box.y>=-1&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,JSON.stringify({box,viewport}));
}

async function noDispatch(page){
 const actions=await page.evaluate(()=>window.__test.calls.filter(({method,data})=>[
  'compute.sshConnection.open','compute.sshService.connect','compute.managed.publish','compute.resourceWorkspace.confirm','task.execute','sharedTerminal.owner'
 ].includes(method)||method==='agent.rpc'&&data.method==='turn/start'||method.startsWith('tools.resource.')&&!['tools.resource.list','tools.resource.discover'].includes(method)));
 assert.deepEqual(actions,[]);
}

export async function frontendClusterOnboardingCases({check,out}){
 await check('setup-spotlight-preserves-modal-close',async page=>{
  await page.setViewportSize({width:1024,height:768});
  await mountGuide(page,{language:'en',font:20,start:'ready'});
  const guide=page.getByTestId('setup-assistant');
  await guide.getByTestId('setup-first-resource-tool').click();
  await guide.getByTestId('setup-tool-fresh').click();
  const dialog=page.getByRole('dialog',{name:'Set up resource tools',exact:true});
  await dialog.getByTestId('resource-tool-target').waitFor();
  const spotlight=page.locator('.guide-spotlight[data-ready="true"][data-target="resource-tool-setup"][data-docked="true"]');
  await spotlight.waitFor();
  const close=dialog.getByRole('button',{name:'Close',exact:true});
  assert.equal(await close.evaluate(element=>{
   const {x,y,width,height}=element.getBoundingClientRect();
   return element.contains(document.elementFromPoint(x+width/2,y+height/2));
  }),true);
  await close.click();
  await dialog.waitFor({state:'detached'});
  await noDispatch(page);
 });
 const dimensions=[{width:1366,height:768,font:18,route:'fresh'},{width:1024,height:768,font:24,route:'existing'},{width:630,height:720,font:18,route:'custom'}];
 for(const {width,height,font,route} of dimensions)for(const language of ['zh-CN','en'])for(const theme of ['dark','light']){
  const name=`cluster-novice-experience-${width}x${height}-${language}-${theme}`;
  await check(name,async page=>{
   await page.setViewportSize({width,height});
   await mountGuide(page,{language:language==='en'?'zh-CN':'en',theme:theme==='dark'?'light':'dark',font});
   const labels=copy[language],guide=page.getByTestId('setup-assistant');
   await guide.getByRole('button',{name:language==='en'?'English':'简体中文',exact:true}).press('Enter');
   await guide.getByRole('heading',{name:labels.welcome,exact:true}).waitFor();
   await guide.getByRole('button',{name:labels[theme],exact:true}).press('Enter');
   await page.waitForFunction(({theme,language,font})=>document.documentElement.dataset.theme===theme&&document.documentElement.lang===language&&Math.abs(parseFloat(getComputedStyle(document.documentElement).fontSize)-font)<.1,{theme,language,font});
   await guide.getByRole('button',{name:labels.next,exact:true}).press('Enter');
   await guide.getByRole('heading',{name:labels.agent,exact:true}).waitFor();
   assert.equal(await page.locator('#setup-heading').evaluate(el=>el===document.activeElement),true);
   await guide.getByRole('button',{name:labels.later,exact:true}).press('Enter');
   await guide.getByRole('heading',{name:labels.compute,exact:true}).waitFor();
   await guide.getByRole('button',{name:labels.remote}).press('Enter');
   const later=guide.getByRole('button',{name:labels.later,exact:true});
   await visibleInWindow(later);await later.press('Enter');
   await guide.getByRole('heading',{name:labels.ready,exact:true}).waitFor();
   await guide.getByTestId('setup-first-resource-tool').press('Enter');
   await Promise.all(['fresh','existing','custom'].map(value=>guide.getByTestId('setup-tool-'+value).waitFor()));
   const opener=guide.getByTestId('setup-tool-'+route);
   await visibleInWindow(opener);await opener.press('Enter');

   const spotlight=page.getByTestId('guide-spotlight'),dismiss=spotlight.getByRole('button',{name:labels.dismiss,exact:true});
   const dialog=page.getByRole('dialog',{name:labels.setup,exact:true});
   await dismiss.waitFor();await visibleInWindow(spotlight.locator('.guide-focus-tip'));
   await dismiss.focus();await page.keyboard.press('Tab');
   assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)&&!document.activeElement?.closest('.guide-spotlight')),true);
   await page.keyboard.press('Escape');await spotlight.waitFor({state:'hidden'});
   await dialog.getByTestId('resource-tool-target').waitFor();
   assert.equal(await dialog.getByTestId('resource-tool-'+route).getAttribute('aria-pressed'),'true');
   assert.match(await dialog.innerText(),/Fixture research cluster/);
   assert.equal(await dialog.getByTestId('resource-tool-argv').isVisible(),false);
   assert.equal(await dialog.locator('.modal-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
   await visibleInWindow(dialog.getByRole('button',{name:labels.discuss,exact:true}));
   await page.screenshot({path:path.join(out,name+'.png')});

   const close=dialog.getByRole('button',{name:labels.close,exact:true});
   await close.focus();await page.keyboard.press('Shift+Tab');
   assert.equal(await page.evaluate(()=>document.activeElement?.closest('[data-testid="resource-tool-manual"]')?.tagName==='DETAILS'&&document.activeElement.tagName==='SUMMARY'),true,await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,200)));
   await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
   await page.getByTestId('setup-lesson').press('Enter');await opener.waitFor();
   await page.waitForFunction(testId=>document.activeElement?.getAttribute('data-testid')===testId,'setup-tool-'+route);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await noDispatch(page);
  });
 }

 await check('cluster-novice-experience-empty-library-scan-errors-and-scheduler-return',async page=>{
  await page.setViewportSize({width:630,height:720});
  await mountGuide(page,{start:'ready',empty:true,fail:true});
  await page.getByTestId('setup-first-resource-tool').click();await page.getByTestId('setup-tool-existing').click();
  const spotlight=page.getByTestId('guide-spotlight');
  await spotlight.getByRole('button',{name:'关闭提示',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'配置资源工具',exact:true}),failure=dialog.getByRole('alert');
  await failure.getByText('Fixture tool library temporarily unavailable').waitFor();
  await failure.getByRole('button',{name:'刷新状态'}).click();
  await dialog.getByText(/没有可用的测试目标/).waitFor();
  assert.equal(await dialog.getByTestId('resource-tool-target').count(),0);
  await visibleInWindow(dialog.getByTestId('resource-tool-configure-project'));
  await dialog.getByTestId('resource-tool-scan-path').fill('/home/fixture/scripts');
  const scan=dialog.getByTestId('resource-tool-scan');await scan.click();
  await failure.getByText('Fixture directory scan temporarily unavailable').waitFor();
  await scan.click();await dialog.getByText('在此目录中没有找到可登记的脚本。',{exact:true}).waitFor();
  assert.equal(await dialog.getByTestId('resource-tool-scan-path').inputValue(),'/home/fixture/scripts');
  await dialog.getByTestId('resource-tool-manual').locator('summary').click();
  assert.equal(await dialog.getByTestId('resource-tool-plan').isDisabled(),true);
  await dialog.getByTestId('resource-tool-manual').locator('summary').click();
  await page.screenshot({path:path.join(out,'cluster-novice-empty-retry.png')});
  await dialog.getByTestId('resource-tool-configure-scheduler').click();
  const service=page.getByTestId('ssh-service-settings');await service.waitFor();
  assert.match(await service.innerText(),/Fixture research cluster/);
  await page.keyboard.press('Escape');await dialog.waitFor();
  assert.equal(await dialog.getByTestId('resource-tool-existing').getAttribute('aria-pressed'),'true');
  await dialog.getByText(/没有可用的测试目标/).waitFor();
  assert.equal(await dialog.getByTestId('resource-tool-scan-path').inputValue(),'/home/fixture/scripts');
  await dialog.getByText('在此目录中没有找到可登记的脚本。',{exact:true}).waitFor();
  const calls=await page.evaluate(()=>window.__test.calls);
  assert.deepEqual(calls.filter(call=>call.method==='tools.resource.discover').map(call=>call.data.directory),['/home/fixture/scripts','/home/fixture/scripts']);
  assert.deepEqual(calls.filter(call=>call.method==='compute.resourceWorkspace.read').map(call=>call.data),[{profileId:profile.id,profileVersion:profile.version}]);
  await noDispatch(page);
 });

 await check('cluster-novice-experience-unconfigured-first-use',async page=>{
  await page.setViewportSize({width:630,height:720});
  await mountGuide(page,{start:'ready',withoutProfile:true,language:'en',theme:'light'});
  await page.getByTestId('setup-first-resource-tool').click();await page.getByTestId('setup-tool-custom').click();
  const console=page.getByTestId('compute-resource-console');await console.waitFor();
  await console.getByText('No saved compute connections',{exact:true}).waitFor();
  await page.getByTestId('setup-lesson').click();await page.getByTestId('setup-tool-custom').waitFor();
  assert.equal(await page.getByTestId('resource-tool-setup').count(),0);
  await noDispatch(page);
 });

 await check('cluster-novice-experience-project-permissions-retry-and-return',async page=>{
  await page.setViewportSize({width:1024,height:768});
  await mountGuide(page,{start:'ready',font:24,empty:true,readySsh:true});
  await page.waitForFunction(()=>window.__test.calls.some(c=>c.method==='worker.request'&&c.data.method==='GET'&&c.data.target==='/api/projects'));
  await page.getByTestId('setup-first-resource-tool').click();await page.getByTestId('setup-tool-fresh').click();
  await page.getByTestId('guide-spotlight').getByRole('button',{name:'关闭提示',exact:true}).click();
  const tools=page.getByRole('dialog',{name:'配置资源工具',exact:true});
  await tools.getByTestId('resource-tool-description').fill('Install the reviewed fixture program.');
  await tools.getByTestId('resource-tool-configure-project').click();
  const projectList=page.getByTestId('project-management');await projectList.getByTestId('new-project').click();
  const form=page.getByTestId('project-authorization');
  await form.getByRole('textbox',{name:'项目名称',exact:true}).fill('Scoped fixture project');
  const workfile=form.getByTestId('project-resource-workfile');await workfile.waitFor();
  const body=page.getByRole('dialog',{name:'新建计算项目',exact:true}).locator('.modal-body');
  const bodyBox=await body.boundingBox();assert.ok(bodyBox);
  await page.mouse.move(bodyBox.x+bodyBox.width-24,bodyBox.y+bodyBox.height*.5);
  await page.mouse.wheel(0,Math.round(bodyBox.height*.55));
  await page.waitForFunction(()=>{
   const button=document.querySelector('[data-testid="project-resource-workfile"]');
   if(!button)return false;
   const box=button.getBoundingClientRect();
   return button.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));
  },undefined,{polling:25});
  await workfile.click();
  await form.getByTestId('project-resource-scheduler').check();
  await form.getByRole('checkbox',{name:'工具安装与最小测试',exact:true}).check();
  const save=form.getByTestId('save-project-authorization');
  await page.evaluate(()=>window.__test.projectWorkerChanged=true);await save.click();
  await form.getByRole('alert').getByText(/项目、会话或计算连接已变化/).waitFor();
  assert.equal(await page.evaluate(()=>window.__test.projectSaved),undefined);
  await page.evaluate(()=>window.__test.projectWorkerChanged=false);await save.click();
  await tools.getByTestId('resource-tool-target').waitFor();
  assert.equal(await tools.getByTestId('resource-tool-description').inputValue(),'Install the reviewed fixture program.');
  assert.equal(await tools.getByTestId('resource-tool-fresh').getAttribute('aria-pressed'),'true');
  assert.deepEqual(await page.evaluate(()=>window.__test.project.policy.clusters),[target.cluster_id]);
  assert.deepEqual(await page.evaluate(()=>window.__test.project.policy.input_roots),['/home/fixture/AIMatterLab/workfile']);
  assert.equal(await page.evaluate(()=>window.__test.project.policy.engines.includes('installation.check')),true);
  await noDispatch(page);
 });

 await check('cluster-novice-experience-offline-workspace-copy-stays-with-the-saved-chat',async page=>{
  await page.evaluate(()=>{
   const f=window.__test,original=window.studio.invoke;
   const saved={provider:'kimi',threadId:'offline-workflow',id:'kimi:offline-workflow',name:'Saved workflow',taskId:'workflow',projectId:null};
   const other={...saved,threadId:'other',id:'kimi:other',name:'Second saved chat'};
   const receipt={status:'last_confirmed',profileId:'guide-resource',resourceId:'workspace-owner',workspaceId:'workspace',root:'/home/fixture/AIMatterLab',path:'/home/fixture/AIMatterLab/workfile/2026-11-20/task-0001',date:'2026-11-20',taskNumber:1,checkedAt:Date.now()};
   f.copied=[];f.workspaceReadCount=0;
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{f.copied.push(value);}}});
   window.studio.invoke=async(method,data)=>{
    if(method==='agent.connect')throw Error('Fixture model provider offline');
    if(method==='compute.resourceWorkspace.session'){
     f.calls.push({method,data});
     if(data.profileId!==receipt.profileId)throw Error('Incorrect workspace resource');
     if(++f.workspaceReadCount===1)return new Promise(resolve=>{f.completeOldWorkspace=()=>resolve(receipt);});
     return f.workspaceOwner.id===other.id?{status:'unassigned'}:receipt;
    }
    return original(method,data);
   };
   f.openWorkspaceOwner=(viewer,nonce)=>{
    f.workspaceOwner=viewer==='saved'?saved:other;
    return window.renderTest('Agent',{workspaceProfileId:receipt.profileId,selectedLocalConversation:f.workspaceOwner,sessionSelection:{nonce,conversation:f.workspaceOwner},planningMode:false,onPlanningModeChange(){},context:'{}',onError(){}});
   };
   return f.openWorkspaceOwner('saved','first');
  });
  const workspace=page.getByTestId('agent-session-workspace'),summary=workspace.locator('summary');
  await summary.click();await page.waitForFunction(()=>typeof window.__test.completeOldWorkspace==='function');
  await page.evaluate(()=>window.__test.openWorkspaceOwner('other','second'));
  await page.waitForFunction(()=>document.querySelector('[data-testid="agent-session-workspace"]')?.open===false);
  await summary.click();await workspace.getByText(/此会话尚未执行计算流程/).waitFor();
  await page.evaluate(()=>window.__test.completeOldWorkspace());
  assert.equal(await workspace.getByTestId('session-workspace-path').count(),0);
  await page.evaluate(()=>window.__test.openWorkspaceOwner('saved','restored'));
  await page.waitForFunction(()=>document.querySelector('[data-testid="agent-session-workspace"]')?.open===false);
  await summary.click();await workspace.getByTestId('session-workspace-copy').click();
  await page.getByTestId('toast-region').getByText(/已复制工作目录/).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__test.copied),['/home/fixture/AIMatterLab/workfile/2026-11-20/task-0001']);
  await noDispatch(page);
 });

 await check('setup-experience-workspace-guide-targets-the-directory-input',async page=>{
  await page.evaluate(async()=>{
   const {default:Review}=await import('/frontend/features/compute/ResourceWorkspaceReview.tsx');
   const {default:Lesson}=await import('/frontend/features/onboarding/SetupLesson.tsx');
   const {createElement:h,Fragment}=window.React,prior=window.studio.invoke;
   const owner={connectionId:'fixture-login',profileId:'fixture-profile',profileVersion:3};
   const receipt=root=>({...owner,schemaVersion:2,root,account:'fixture',hostname:'fixture-host',
    directories:[root+'/workfile',root+'/software'],status:'confirmation_required',confirmationId:'reviewed'});
   const observed=window.__workspaceInput={calls:[],confirmed:null};
   window.studio.invoke=async(method,data)=>{
    if(!method.startsWith('compute.resourceWorkspace.'))return prior(method,data);
    observed.calls.push({method,data});
    if(method==='compute.resourceWorkspace.preview')return receipt('/home/fixture/custom');
    if(method==='compute.resourceWorkspace.confirm')return {...receipt('/home/fixture/custom'),status:'confirmed',confirmationId:undefined};
    throw Error('Unexpected workspace mutation');
   };
   window.testRoot.render(h(Fragment,null,h(Lesson,{lesson:{destination:'ssh-workspace'},page:'compute',english:false,
    showFocus:true,onDismiss(){},onRehighlight(){},onReturn(){}}),h(Review,{
    target:owner,resourceName:'Fixture',initial:receipt('/home/fixture/default'),isCurrent:()=>true,
    onClose:()=>window.testRoot.render(null),onConfirmed:value=>{observed.confirmed=value.root;}
   })));
  });
  const input=page.getByTestId('resource-workspace-path'),confirm=page.getByTestId('resource-workspace-confirm'),preview=page.getByTestId('resource-workspace-preview');
  const spotlight=page.getByTestId('guide-spotlight');
  const highlighted=target=>page.waitForFunction(target=>document.querySelector('.guide-spotlight[data-ready="true"]')?.dataset.target===target,target);
  await highlighted('ssh-workspace-path');
  assert.equal(await confirm.isEnabled(),true);
  assert.deepEqual(await page.evaluate(()=>window.__workspaceInput.calls),[]);
  await input.click();
  assert.equal(await input.evaluate(element=>element===document.activeElement),true);
  await input.fill('~/custom');
  assert.equal(await confirm.isDisabled(),true);
  assert.equal(await confirm.getAttribute('data-guide-target'),null);
  await preview.click();
  await page.getByText('/home/fixture/custom',{exact:true}).waitFor();
  await highlighted('ssh-workspace-confirm');
  assert.equal(await input.getAttribute('data-guide-target'),null);
  assert.equal(await preview.getAttribute('data-guide-target'),null);
  await input.fill('~/another');
  await highlighted('ssh-workspace-path');
  assert.equal(await confirm.isDisabled(),true);
  assert.equal(await confirm.getAttribute('data-guide-target'),null);
  await input.fill('~/custom');
  await preview.click();
  await highlighted('ssh-workspace-confirm');
  await confirm.click();
  await spotlight.waitFor({state:'detached'});
  await page.waitForFunction(()=>window.__workspaceInput.confirmed==='/home/fixture/custom');
  const calls=await page.evaluate(()=>window.__workspaceInput.calls);
  assert.deepEqual(calls.map(call=>call.method),['compute.resourceWorkspace.preview','compute.resourceWorkspace.preview','compute.resourceWorkspace.confirm']);
  assert.equal(calls[0].data.directory,'~/custom');assert.equal(calls[2].data.confirmationId,'reviewed');
 });
}
