import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';

async function openClusterEnvironment(page,{deferProfileList=false}={}){
 await page.setViewportSize({width:1024,height:768});
 await page.evaluate(async deferProfileList=>{
  const f=window.__test;
  f.originalEnvironment={executables:{python:'/fixture/python',gpumd:'/fixture/gpumd'},repositories:{pydyn:'/fixture/pydyn'},variables:{OMP_NUM_THREADS:4,LIBRARY_PATH:''},site_extension:{config:{edition:7,features:[true,null,'preserve']}}};
  f.clusterProfile={id:'environment-cluster',version:4,name:'Environment fixture',scheduler:'slurm',auth_mode:'key',host:'fixture.invalid',username:'fixture',port:22,ssh_client:'/usr/bin/ssh',via:[],read_roots:[],remote_root:'/fixture/runs',queue:'short',activation:'',limits:{cpus:8,gpus:1,memory_mb:1024},environment:f.originalEnvironment,
   probe:{selected_scheduler:'slurm',detected_schedulers:['slurm'],ssh_status:'passed',scheduler_status:'passed',queue_status:'passed',queues:['fixture-private-queue']}};
  f.environmentSaves=[];f.environmentPrompts=[];
  f.responses={
   '/api/clusters':request=>{
    if(request.method==='GET')return deferProfileList?new Promise(resolve=>{f.finishClusterProfileList=()=>resolve([f.clusterProfile]);}):[f.clusterProfile];
    assertFixtureProfile(request.data);
    f.environmentSaves.push(structuredClone(request.data));
    f.clusterProfile={...request.data,version:f.clusterProfile.version+1};
    return {id:f.clusterProfile.id,version:f.clusterProfile.version};
   },
   '/api/cluster/profile':()=>f.clusterProfile,
   '/api/engines':()=>[],
  };
  function assertFixtureProfile(value){
   if(value?.id!==f.clusterProfile.id||value.version!==f.clusterProfile.version)throw Error('Unexpected environment fixture profile version');
  }
  const {default:ClusterPage}=await import('/frontend/features/cluster/ClusterPage.tsx');
  const props={worker:true,sourceId:'fixture-environment-worker',serviceVersion:'current',settings:f.settings,project:f.project,onError:error=>{throw error;},onRefresh:()=>{},onAgent:prompt=>f.environmentPrompts.push(prompt),onRun:()=>{},onAuthenticate:()=>{},onConnectCompute:()=>{},onTerminal:()=>{}};
  window.testRoot.render(window.React.createElement('div',{style:{height:'100%',overflow:'auto'}},window.React.createElement(ClusterPage,props)));
 },deferProfileList);
 const cluster=page.getByTestId('cluster-settings');
 await cluster.getByRole('button',{name:'环境探测',exact:true}).click();
 await cluster.getByRole('textbox',{name:'可执行文件绝对路径',exact:true}).first().waitFor();
 return cluster;
}

async function openSkill(cluster){
 const more=cluster.locator('.settings-advanced');
 if(!await more.evaluate(node=>node.open))await more.locator('summary').click();
 await more.getByRole('button',{name:'提交 Skill',exact:true}).click();
}

async function accessibilityTree(page){
 const session=await page.context().newCDPSession(page);
 try{
  const {nodes}=await session.send('Accessibility.getFullAXTree');
  return nodes.filter(node=>!node.ignored);
 }finally{await session.detach();}
}

export async function frontendClusterEnvironmentCases({check,out}){
 await check('cluster-readiness-normal-settings-entry-works-offline',async page=>{
  await page.evaluate(()=>{
   localStorage.setItem('studio.agent','false');
   const original=window.studio.invoke;
   window.studio.invoke=async(method,data)=>{
    if(method==='worker.status'||method==='worker.restore'){
     window.__test.calls.push({method,data});
     return {status:'disconnected',checkedAt:1};
    }
    return original(method,data);
   };
   return window.renderTest('App');
  });
  const settings=page.getByRole('button',{name:'设置',exact:true}).filter({visible:true});
  await settings.click();
  const dialog=page.getByRole('dialog',{name:'工作台设置'});
  await dialog.getByRole('button',{name:'计算连接',exact:true}).click();
  await dialog.getByText('默认本地服务与已有集群',{exact:true}).click();
  await dialog.getByTestId('settings-connect-ssh').click();
  const cluster=page.getByTestId('cluster-settings');
  await cluster.getByRole('heading',{name:'集群连接与托管',exact:true}).waitFor();
  await cluster.getByRole('button',{name:'连接 WSL 作业服务',exact:true}).waitFor();
  const readiness=cluster.getByTestId('cluster-connection-health');
  assert.equal(await readiness.locator('button[data-state="unknown"]').count(),4);
  await readiness.getByTestId('cluster-ready-queues').click();
  await cluster.getByTestId('cluster-queue-settings').waitFor();
  await readiness.getByTestId('cluster-ready-ssh').click();
  const guide=cluster.locator('[data-guide-target="cluster-host"]');
  assert.equal(await guide.getAttribute('aria-expanded'),'false');
  await guide.click();
  assert.equal(await cluster.getByTestId('ssh-host').getAttribute('type'),'text');
  assert.equal(await page.getByTestId('cluster-review').count(),0);
  assert.deepEqual(await page.evaluate(()=>window.__test.calls.filter(call=>
   call.method==='worker.connect'||call.method==='worker.request'||
   call.method.startsWith('ssh.auth.')||call.method==='compute.connection.connect')),[]);
 });

 await check('cluster-readiness-saved-failure-reopen-and-refresh',async page=>{
  await page.evaluate(()=>{
   const f=window.__test,version=4,observed=Date.now()/1000-5;
   const profile={id:'check-fixture',name:'Check fixture',version,scheduler:'slurm',auth_mode:'key',host:'check-fixture.invalid',username:'fixture',port:22,
    ssh_client:'/usr/bin/ssh',via:[],read_roots:[],remote_root:'/fixture/runs',queue:'fixture',activation:'',limits:{cpus:1,gpus:0,memory_mb:1024},
    environment:{executables:{python:'/fixture/python'}},probe:null};
   const passed=observed_at=>({status:'passed',ssh_status:'passed',scheduler_status:'passed',selected_scheduler:'slurm',
    selected_scheduler_match:true,queue_status:'passed',queues:['fixture'],observed_at});
   const saveProbe=observed_at=>{
    const probe=passed(observed_at);
    f.checkProfile={...profile,probe,connection_check:{...probe,version}};
    return probe;
   };
   f.checkProfile=profile;
   f.firstCheckTime=new Date(observed*1000).toISOString();
   f.failedCheckTime=new Date((observed+1)*1000).toISOString();
   f.recoverClusterCheck=()=>saveProbe(observed+2);
   f.probeAttempts=0;
   f.workerStatus={status:'connected',sourceId:'cluster-check-worker',serviceVersion:'current',checkedAt:Date.now()};
   f.responses={
    '/api/clusters':request=>{if(request.method!=='GET')throw Error('Unexpected fixture profile write');return [f.checkProfile];},
    '/api/cluster/profile':request=>{if(request.data.cluster_id!==profile.id)throw Error('Unexpected fixture profile');return f.checkProfile;},
    '/api/cluster/probe':request=>{
     if(request.data.cluster_id!==profile.id)throw Error('Unexpected fixture probe');
     if(++f.probeAttempts===1)return saveProbe(observed);
     f.checkProfile={...profile,connection_check:{status:'failed',version,observed_at:observed+1,compute_node_status:'not_run'}};
     throw Error('needs_human_auth');
    },
   };
   localStorage.setItem('studio.agent','false');
   return window.renderTest('App');
  });
  const cluster=page.getByTestId('cluster-settings');
  async function openFromSettings(){
   await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click();
   const dialog=page.getByRole('dialog',{name:'工作台设置'});
   await dialog.getByRole('button',{name:'计算连接',exact:true}).click();
   await dialog.getByText('默认本地服务与已有集群',{exact:true}).click();
   await dialog.getByTestId('settings-connect-ssh').click();
   await cluster.getByRole('heading',{name:'集群连接与托管',exact:true}).waitFor();
  }
  const state=(stage,value)=>cluster.locator(`[data-testid="cluster-ready-${stage}"][data-state="${value}"]`);
  const failed=cluster.getByTestId('cluster-saved-check-failed');
  const probe=cluster.getByRole('button',{name:'检查连接与调度器',exact:true});
  await openFromSettings();
  await probe.click();
  await state('ssh','verified').waitFor();await state('scheduler','verified').waitFor();
  await probe.click();
  await failed.waitFor();
  assert.equal(await failed.locator('time').getAttribute('datetime'),await page.evaluate(()=>window.__test.failedCheckTime));
  assert.equal(await state('ssh','stale').locator('time').getAttribute('datetime'),await page.evaluate(()=>window.__test.firstCheckTime));
  await state('scheduler','stale').waitFor();
  assert.equal(await cluster.getByTestId('cluster-probe-unconfirmed').count(),0);
  assert.equal(await state('science','configured').isVisible(),true);
  await page.screenshot({path:path.join(out,'cluster-check-failed-historical-observations.png')});

  await page.getByTestId('navigate-runs').click();
  await cluster.waitFor({state:'detached'});
  await openFromSettings();
  await failed.waitFor();
  await state('ssh','configured').waitFor();await state('scheduler','configured').waitFor();
  assert.equal(await failed.locator('time').getAttribute('datetime'),await page.evaluate(()=>window.__test.failedCheckTime));
  await page.evaluate(()=>window.__test.recoverClusterCheck());
  await cluster.getByRole('button',{name:'刷新连接列表',exact:true}).click();
  await state('ssh','verified').waitFor();await state('scheduler','verified').waitFor();
  await failed.waitFor({state:'detached'});
  const calls=await page.evaluate(()=>window.__test.calls);
  assert.equal(calls.filter(call=>call.method==='worker.request'&&call.data.target==='/api/cluster/probe').length,2);
  assert(!calls.some(call=>call.method==='worker.connect'||call.method.startsWith('ssh.auth.')||
   call.method==='worker.request'&&call.data.method==='POST'&&!['/api/cluster/profile','/api/cluster/probe'].includes(call.data.target)));
 });

 await check('cluster-readiness-saved-scope-expiry-and-navigation',async page=>{
  await page.setViewportSize({width:1024,height:768});
  await page.addStyleTag({content:'#root{overflow:auto}'});
  await page.clock.install();
  await page.evaluate(()=>{
   const f=window.__test,version=4;
   const environment={executables:{python:'/fixture/python'},repositories:{},variables:{}};
   const probe={selected_scheduler:'slurm',scheduler_status:'passed',ssh_status:'passed',queue_status:'passed',queues:['fixture'],observed_at:Date.now()/1000};
   const limits={cpus:1,gpus:0,memory_mb:1024,max_seconds:60};
   const cluster={id:'ready-cluster',name:'Readiness fixture',version,scheduler:'slurm',auth_mode:'key',host:'ready-fixture.invalid',username:'fixture',port:30273,ssh_client:'/usr/bin/ssh',via:[],read_roots:[],remote_root:'/fixture/runs',queue:'fixture',activation:'',limits,environment,probe,
    queue_targets:[{id:'owned-fixture',queue:'fixture',usage_class:'owned',enabled:true,engines:['pydyn.md'],environment,activation:'',limits}]};
   const policy={...f.project.policy,clusters:[cluster.id],cluster_queue_policies:{[cluster.id]:{profile_version:version,allowed_target_ids:['owned-fixture'],new_submission_order:['owned-fixture'],paid:{}}}};
   f.readinessProps={worker:true,sourceId:'readiness-worker',serviceVersion:'current',settings:f.settings,project:{...f.project,policy},onError:error=>{throw error;},onRefresh(){},onAgent(){},onTerminal(){},onRun(){},onAuthenticate(){},onConnectCompute(){}};
   f.responses={'/api/clusters':()=>[cluster],'/api/cluster/profile':()=>cluster,'/api/environments':()=>[],'/api/engines':()=>['pydyn.md']};
   return window.renderTest('ClusterPage',f.readinessProps);
  });
  const cluster=page.getByTestId('cluster-settings'),indicator=key=>cluster.getByTestId('cluster-ready-'+key);
  await cluster.locator('[data-testid="cluster-ready-ssh"][data-state="verified"]').waitFor();
  assert.equal(await indicator('scheduler').getAttribute('data-state'),'verified');
  assert.match(await indicator('scheduler').innerText(),/登录节点 · Slurm/);
  assert.equal(await indicator('queues').getAttribute('data-state'),'verified');
  assert.match(await indicator('queues').innerText(),/当前项目.*v4/);
  assert.equal(await indicator('science').getAttribute('data-state'),'configured');
  assert.match(await indicator('science').innerText(),/计算节点待验证/);
  await page.screenshot({path:path.join(out,'cluster-readiness-saved-1024.png')});
  await indicator('queues').click();
  await cluster.getByTestId('cluster-queue-settings').waitFor();
  await indicator('scheduler').click();
  assert.equal(await cluster.getByRole('button',{name:'只读探测',exact:true}).isVisible(),true);
  await indicator('science').press('Enter');
  const editor=cluster.getByRole('region',{name:'科学环境',exact:true});
  await page.waitForFunction(()=>document.activeElement?.classList.contains('cluster-science-environment'));
  assert.equal(await editor.evaluate(node=>document.activeElement===node),true);
  await indicator('ssh').click();
  assert.equal(await cluster.getByTestId('ssh-test').isEnabled(),true);
  await page.clock.fastForward(901000);
  await cluster.locator('[data-testid="cluster-ready-ssh"][data-state="expired"]').waitFor();
  assert.equal(await indicator('scheduler').getAttribute('data-state'),'expired');
  assert.equal(await indicator('queues').getAttribute('data-state'),'verified');
  await page.evaluate(()=>{
   const f=window.__test,project=f.readinessProps.project;
   const stalePolicy={...project.policy.cluster_queue_policies['ready-cluster'],profile_version:3};
   return window.renderTest('ClusterPage',{...f.readinessProps,project:{...project,policy:{...project.policy,cluster_queue_policies:{'ready-cluster':stalePolicy}}}});
  });
  await cluster.locator('[data-testid="cluster-ready-queues"][data-state="stale"]').waitFor();
  await page.evaluate(()=>{
   const f=window.__test,project={...f.project,id:'unrelated-project'};
   return window.renderTest('ClusterPage',{...f.readinessProps,project});
  });
  await cluster.locator('[data-testid="cluster-ready-queues"][data-state="configured"]').waitFor();
  const routes=await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='worker.request').map(call=>[call.data.method,call.data.target]));
  assert(routes.some(([,route])=>route==='/api/environments'));
  assert(routes.every(([method,route])=>method==='GET'&&['/api/clusters','/api/environments','/api/engines'].includes(route)||method==='POST'&&route==='/api/cluster/profile'));
 });

 await check('cluster-readiness-private-endpoints-in-the-electron-accessibility-tree',async page=>{
  await page.addStyleTag({content:'#root{overflow:auto}'});
  const values=['masked-host-fixture.invalid','masked-user-fixture','54371','/fixture/key-masked-fixture'];
  await page.evaluate(([host,username,port,identity_file])=>{
   const f=window.__test;
   const profile={id:'privacy-fixture',name:'Privacy fixture',version:1,scheduler:'lsf',auth_mode:'key',host,username,port:Number(port),identity_file,ssh_client:'/usr/bin/ssh',via:[],read_roots:[],remote_root:'/fixture/runs',queue:'fixture',activation:'',limits:{cpus:1,gpus:0,memory_mb:1024},environment:{executables:{python:'/fixture/python'}}};
   const second={...profile,id:'privacy-fixture-2',name:'Second fixture',host:'second-mask-fixture.invalid'};
   f.responses={'/api/clusters':()=>[profile,second],'/api/cluster/profile':request=>request.data.cluster_id===second.id?second:profile,'/api/cluster/test':()=>({status:'passed',username_matches:true})};
   return window.renderTest('ClusterPage',{worker:true,sourceId:'privacy-worker',serviceVersion:'current',settings:f.settings,onError:error=>{throw error;},onRefresh(){},onAgent(){},onTerminal(){},onRun(){},onAuthenticate(){},onConnectCompute(){}});
  },values);
  const cluster=page.getByTestId('cluster-settings');
  const reveal=cluster.getByRole('button',{name:'显示私有连接字段',exact:true});
  const hide=cluster.getByRole('button',{name:'隐藏私有连接字段',exact:true});
  const guide=cluster.locator('[data-guide-target="cluster-host"]');
  await cluster.locator('[data-testid="cluster-ready-ssh"][data-state="configured"]').waitFor();
  await cluster.getByText('高级连接设置：客户端、密钥、端口与路由',{exact:true}).click();
  const snapshotMasked=async maskedValues=>{
   assert.equal(await cluster.locator('input[type="password"],input[data-testid^="ssh-"]').count(),0);
   const html=await cluster.innerHTML(),ax=JSON.stringify(await accessibilityTree(page));
   assert.match(ax,/已隐藏/);
   for(const value of maskedValues){assert(!html.includes(value),'hidden value omitted from rendered DOM');assert(!ax.includes(value),'hidden value omitted from Chromium accessibility tree');}
  };
  await snapshotMasked(values);
  assert.equal(await guide.getAttribute('aria-expanded'),'false');
  await page.screenshot({path:path.join(out,'cluster-ssh-private-fields-hidden.png')});
  await reveal.press('Enter');
  const fields=await cluster.locator('input[data-testid^="ssh-"],input[value$="/key-masked-fixture"]').evaluateAll(nodes=>nodes.map(node=>({type:node.type,autoComplete:node.autocomplete,value:node.value})));
  assert.deepEqual(fields,values.map(value=>({type:'text',autoComplete:'off',value})));
  const visibleTree=JSON.stringify(await accessibilityTree(page));
  for(const value of values)assert(visibleTree.includes(value),'revealed value present in the Chromium accessibility tree');
  assert.equal(await guide.getAttribute('data-testid'),'ssh-host');
  await cluster.getByTestId('ssh-port').fill('54372');
  await hide.press('Enter');
  await snapshotMasked([...values,'54372']);
  await cluster.getByTestId('ssh-test').click();
  await cluster.locator('[data-testid="cluster-ready-ssh"][data-state="verified"]').waitFor();
  assert.equal(await page.evaluate(()=>window.__test.calls.find(call=>call.method==='worker.request'&&call.data.target==='/api/cluster/test').data.data.connection.port),54372);
  await reveal.click();
  await cluster.getByRole('combobox',{name:'集群配置',exact:true}).selectOption('privacy-fixture-2');
  await snapshotMasked([...values,'54372','second-mask-fixture.invalid']);

  const comparison=['password-comparison-fixture','css-comparison-fixture'];
  await page.evaluate(values=>{
   const sample=document.createElement('div');sample.id='mask-comparison';
   values.forEach((value,index)=>{
    const input=document.createElement('input');
    input.type=index===0?'password':'text';input.autocomplete='off';input.value=value;
    if(index===1)input.style.webkitTextSecurity='disc';
    input.setAttribute('aria-label',index===0?'Synthetic password comparison':'Synthetic CSS comparison');
    sample.append(input);
   });
   document.body.append(sample);
  },comparison);
  const tree=await accessibilityTree(page);
  const comparisonState=['Synthetic password comparison','Synthetic CSS comparison'].map((name,index)=>{
   const node=tree.find(node=>node.name?.value===name);
   assert.equal(node?.role?.value,'textbox');
   return {name,literalVisibleInAccessibilityTree:JSON.stringify(node).includes(comparison[index])};
  });
  await page.evaluate(()=>document.getElementById('mask-comparison').remove());
  await fs.writeFile(path.join(out,'cluster-ssh-accessibility.json'),JSON.stringify({
   defaultMask:{endpointInputsMounted:false,valuesInDom:false,valuesInChromiumAccessibilityTree:false},
   explicitReveal:{type:'text',autocomplete:'off',valuesInChromiumAccessibilityTree:true},
   afterHideOrProfileChange:{endpointInputsMounted:false,valuesInChromiumAccessibilityTree:false},
   comparison:comparisonState
  },null,2));
 });

 await check('cluster-environment-draft-is-retained-during-initial-profile-discovery',async page=>{
  const cluster=await openClusterEnvironment(page,{deferProfileList:true});
  const details=cluster.getByTestId('cluster-environment-json');
  await details.locator('summary').click();
  const json=details.getByRole('textbox',{name:'显式科学环境 · JSON',exact:true});
  const partial='{"executables":{"python":"/draft';
  await json.fill(partial);
  await page.waitForFunction(()=>window.__test.finishClusterProfileList);
  await page.evaluate(()=>window.__test.finishClusterProfileList());
  const profiles=cluster.getByRole('combobox',{name:'集群配置',exact:true});
  await profiles.locator('option[value="environment-cluster"]').waitFor({state:'attached'});
  assert.equal(await profiles.inputValue(),'');
  assert.equal(await json.inputValue(),partial);
  assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='worker.request'&&call.data.target==='/api/cluster/profile').length),0);
  await profiles.selectOption('environment-cluster');
  const python=cluster.getByRole('textbox',{name:'可执行文件绝对路径',exact:true}).first();
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-testid="cluster-environment-executables"] input')].some(input=>input.value==='/fixture/python'));
  assert.equal(await python.inputValue(),'/fixture/python');
 });

 await check('cluster-environment-structured-save-retains-the-original-version-and-diagnostics-entry',async page=>{
  const cluster=await openClusterEnvironment(page);
  const editor=cluster.getByTestId('cluster-environment-editor');
  const details=editor.getByTestId('cluster-environment-json');
  assert.equal(await details.evaluate(node=>node.open),false);
  await editor.getByRole('textbox',{name:'可执行文件绝对路径',exact:true}).first().fill('/fixture/selected-python');
  await editor.getByRole('textbox',{name:'变量值',exact:true}).first().fill('8');
  const repositories=editor.getByTestId('cluster-environment-repositories');
  await repositories.getByRole('button',{name:'添加仓库路径',exact:true}).click();
  await repositories.getByRole('textbox',{name:'仓库标识',exact:true}).last().fill('gpumd');
  await repositories.getByRole('textbox',{name:'仓库绝对路径',exact:true}).last().fill('/fixture/registered/gpumd');
  await page.screenshot({path:path.join(out,'cluster-environment-structured-1024.png')});
  await details.locator('summary').click();
  const text=details.getByRole('textbox',{name:'显式科学环境 · JSON',exact:true});
  const expected={...await page.evaluate(()=>window.__test.originalEnvironment),executables:{python:'/fixture/selected-python',gpumd:'/fixture/gpumd'},repositories:{pydyn:'/fixture/pydyn',gpumd:'/fixture/registered/gpumd'},variables:{OMP_NUM_THREADS:8,LIBRARY_PATH:''}};
  assert.deepEqual(JSON.parse(await text.inputValue()),expected);
  await openSkill(cluster);
  const gpu=cluster.getByRole('spinbutton',{name:'gpus',exact:true});
  await gpu.fill('');
  await cluster.getByRole('button',{name:'保存连接',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__test.environmentSaves.length),0);
  await gpu.fill('0');
  await cluster.getByRole('button',{name:'保存连接',exact:true}).click();
  await cluster.getByText('连接已保存；项目授权未改变。',{exact:true}).waitFor();
  const saved=await page.evaluate(()=>window.__test.environmentSaves);
  assert.equal(saved.length,1);
  assert.equal(saved[0].id,'environment-cluster');assert.equal(saved[0].version,4);assert.equal(saved[0].limits.gpus,0);
  assert.deepEqual(saved[0].environment,expected);
  await cluster.getByRole('button',{name:'环境探测',exact:true}).click();
  await cluster.getByRole('button',{name:'让 Agent 协助配置',exact:true}).click();
  const [prompt]=await page.evaluate(()=>window.__test.environmentPrompts);
  assert.match(prompt,/环境|集群/);assert.match(prompt,/environment-cluster/);assert.match(prompt,/"visible_queue_count":1/);
  assert.doesNotMatch(prompt,/fixture-private-queue|selected-python|site_extension/);
  assert.equal(await page.evaluate(()=>window.__test.calls.some(call=>call.method==='worker.request'&&call.data.method==='POST'&&/\/(projects|submit)$/.test(call.data.target))),false);
 });

 await check('cluster-environment-invalid-and-duplicate-drafts-survive-tab-switches',async page=>{
  const cluster=await openClusterEnvironment(page),editor=cluster.getByTestId('cluster-environment-editor');
  const details=editor.getByTestId('cluster-environment-json');
  await details.locator('summary').click();
  const json=details.getByRole('textbox',{name:'显式科学环境 · JSON',exact:true});
  const invalid='{"executables":{"python":"/fixture/partial';
  await json.fill(invalid);
  await details.getByRole('alert').filter({hasText:'JSON 语法有误。'}).waitFor();
  assert.equal(await editor.getByRole('textbox',{name:'可执行文件名称',exact:true}).first().isDisabled(),true);
  await cluster.getByRole('button',{name:'队列与环境',exact:true}).click();
  const queue=cluster.getByTestId('cluster-queue-settings');
  await queue.getByTestId('queue-add').click();
  await queue.getByRole('status').filter({hasText:'请先填写有效环境。'}).waitFor();
  assert.equal(await queue.getByTestId('queue-remove-0').count(),0);
  await openSkill(cluster);
  assert.equal(await json.inputValue(),invalid);
  await cluster.getByRole('button',{name:'保存连接',exact:true}).click();
  await cluster.getByText('修正科学环境草稿后再保存。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__test.environmentSaves.length),0);
  const source=await page.evaluate(()=>JSON.stringify(window.__test.originalEnvironment,null,2));
  await json.fill(source);
  const executables=editor.getByTestId('cluster-environment-executables');
  const duplicate=executables.getByRole('textbox',{name:'可执行文件名称',exact:true}).last();
  await duplicate.fill('python');
  await executables.getByRole('status').filter({hasText:'同一组内的名称必须唯一。'}).waitFor();
  assert.equal(await json.getAttribute('readonly'),'');
  await cluster.getByRole('button',{name:'环境探测',exact:true}).click();
  assert.equal(await duplicate.inputValue(),'python');
  assert.deepEqual(await executables.getByRole('textbox',{name:'可执行文件绝对路径',exact:true}).evaluateAll(inputs=>inputs.map(input=>input.value)),['/fixture/python','/fixture/gpumd']);
  await duplicate.fill('gpumd-renamed');
  await details.locator('summary').click();
  const repaired=JSON.parse(await json.inputValue());
  assert.deepEqual(repaired.executables,{python:'/fixture/python','gpumd-renamed':'/fixture/gpumd'});
  assert.deepEqual(repaired.site_extension,JSON.parse(source).site_extension);
  const duplicateRaw='{"executables":{"python":"/fixture/python"},"extra":{"enabled":true,"\\u0065nabled":false}}';
  await json.fill(duplicateRaw);
  await details.getByRole('alert').filter({hasText:'JSON 对象中有重复键。'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'cluster-environment-duplicate-advanced-json.png')});
  assert.equal(await json.inputValue(),duplicateRaw);
  const signedZero='{"executables":{"python":"/fixture/python"},"extra":{"signed":-0e2}}';
  await json.fill(signedZero);
  await details.getByRole('alert').filter({hasText:'JSON 数值超出可保存的精度。'}).waitFor();
  assert.equal(await json.inputValue(),signedZero);
  await cluster.getByRole('button',{name:'保存连接',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__test.environmentSaves.length),0);
 });
}
