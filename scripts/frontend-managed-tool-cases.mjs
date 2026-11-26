import assert from 'node:assert/strict';
import path from 'node:path';

const resourceTestTarget={project_id:'tool-check-project',cluster_id:'tool-check-cluster',environment_id:'tool-check-env',queue_target_id:'tool-check-queue',queue:'fixture',scheduler:'slurm'};
const resourceTestManifest={id:'fixture-analysis',name:'Fixture analysis',version:'1.2.0',source:{kind:'installed',executable:'/fixture/analysis'},argv:[],inputs:{},outputs:{},test:{inputs:{},max_seconds:120}};

async function openManualForm(panel,labels){
 await panel.getByTestId('resource-tool-custom').click();
 await panel.getByTestId('resource-tool-manual').locator('summary').click();
 for(const [label,value] of [[labels[0],resourceTestManifest.name],[labels[1],resourceTestManifest.id],[labels[2],resourceTestManifest.version],[labels[3],resourceTestManifest.source.executable]]){
  await panel.getByLabel(label,{exact:true}).fill(value);
 }
}

async function openResourceToolForm(page,language='zh-CN'){
  await page.evaluate(({language,target})=>{
   const f=window.__test,standard=window.studio.invoke,now=Date.now();
   Object.assign(f.settings,{language});localStorage.setItem('studio.language',language);
   localStorage.setItem('studio.section','compute-resources');localStorage.setItem('studio.agent','false');
   const profileId='tool-check-profile',profileVersion=7,resource_id='ssh:'+profileId,connectionId='tool-check-conn';
   const resource={key:connectionId,kind:'ssh',profileId,profileVersion,connectionId,current:true,mode:'interactive',name:'Fixture tool resource',target:'fixture.invalid:22',
    master:{status:'online',checkedAt:now},service:{kind:'private',status:'online',checkedAt:now},managedId:resource_id,terminals:[],channels:[],projectPolicies:[]};
   const snapshot={checkedAt:now,observation:'complete',resources:[resource],standalone:[],projects:[]};
   f.manualToolCalls=[];
   window.studio.invoke=async(method,data)=>{
    if(['compute.console.snapshot','compute.console.refresh'].includes(method))return snapshot;
    if(method==='compute.resourceWorkspace.read')return {...data,status:'confirmed',root:'/fixture',account:'fixture',hostname:'fixture.invalid',checkedAt:now};
    if(!method.startsWith('tools.resource.'))return standard(method,data);
    f.manualToolCalls.push({method,data});
    if(data.resource_id!==resource_id||data.profile_version!==profileVersion)throw Error('Unexpected resource for manifest editor');
    if(method==='tools.resource.list')return {setups:[],targets:[target]};
    if(method==='tools.resource.plan'){
     if(Object.hasOwn(data.manifest,'future'))throw Error('Invalid resource tool request fields');
     return {id:'manual-tool-plan',resource_id,workspace_id:'fixture-workspace',route:'custom',status:'planned',stage:'review',revision:1,plan_sha256:'a'.repeat(64),manifest:data.manifest,target,install_root:'/fixture/software',activity:[]};
    }
    throw Error('Unexpected resource tool operation '+method);
   };
   return window.renderTest('App');
  },{language,target:resourceTestTarget});
  const labels=language==='en'?['Tool name','Tool ID','Tool version','Absolute remote executable path']:['工具名称','工具 ID','工具版本','远端程序绝对路径'];
  await page.getByTestId('resource-configure-tools').click();
  const panel=page.getByRole('dialog',{name:language==='en'?'Set up resource tools':'配置资源工具',exact:true});
  await openManualForm(panel,labels);
   return panel;
}

const openAdvancedJson=panel=>panel.getByTestId('resource-tool-advanced-json').click();
const planCalls=page=>page.evaluate(()=>window.__test.manualToolCalls.filter(call=>call.method!=='tools.resource.list'));

export async function frontendManagedToolCases({check,out}){
 for(const language of ['zh-CN','en'])await check(`experience-resource-tool-json-field-errors-${language}`,async page=>{
   const panel=await openResourceToolForm(page,language);
   await openAdvancedJson(panel);
   const fields=language==='en'?['Command arguments (JSON)','Inputs and outputs (JSON)','Test inputs and resources (JSON)']:['命令参数（JSON）','输入输出（JSON）','测试输入与资源（JSON）'];
   const reasons=language==='en'?['Invalid JSON syntax.','Command arguments must be a JSON array of strings.','Enter a JSON object.']:['JSON 语法有误。','运行参数必须是 JSON 字符串列表。','请填写 JSON 对象。'];
  const submit=panel.getByTestId('resource-tool-plan'),alert=panel.getByRole('alert');
  const good=['["{output:summary}"]','{"inputs":{},"outputs":{"summary":{"filename":"summary.txt","format":"text"}},"dependencies":["fixture"]}','{"inputs":{},"max_seconds":120}'];
  const inputs=['argv','io','test'].map(field=>panel.getByTestId('resource-tool-'+field));
  for(let i=0;i<3;i++)await inputs[i].fill(good[i]);
  for(const [i,syntax,shape] of [[0,'["first" "second"]','[42]'],[1,'{"inputs":{} "outputs":{}}','null'],[2,'{"inputs":{} "max_seconds":120}','[]']]){
   for(const [value,reason] of [[syntax,reasons[0]],[shape,reasons[i===0?1:2]]]){
    await inputs[i].fill(value);await submit.click();
    const error=alert.filter({hasText:`${fields[i]} · ${reason}`});await error.waitFor();
    assert.equal(await inputs[i].inputValue(),value,'preserve the field text for correction');
   }
   await inputs[i].fill(good[i]);
  }
  assert.equal(await page.evaluate(()=>window.__test.manualToolCalls.some(call=>call.method==='tools.resource.plan')),false);
  await submit.click();await panel.getByTestId('resource-tool-receipt').waitFor();
   const operations=await planCalls(page);
  assert.equal(operations.length,1);
  const {method,data}=operations[0];assert.equal(method,'tools.resource.plan');
  assert.equal(data.resource_id,'ssh:tool-check-profile');assert.equal(data.profile_version,7);assert.equal(data.route,'custom');
  const {project_id,cluster_id,environment_id,queue_target_id}=resourceTestTarget;
  assert.deepEqual([data.project_id,data.cluster_id,data.environment_id,data.queue_target_id],[project_id,cluster_id,environment_id,queue_target_id]);
  assert.deepEqual(JSON.parse(JSON.stringify(data.manifest)),{...resourceTestManifest,argv:['{output:summary}'],outputs:{summary:{filename:'summary.txt',format:'text'}},dependencies:['fixture']});
 });

  await check('experience-resource-tool-structured-manifest-without-json',async page=>{
   const panel=await openResourceToolForm(page);
   const primary=panel.locator('button[data-variant="primary"]:visible');
   assert.equal(await primary.count(),1);
   assert.equal(await primary.getAttribute('data-testid'),'resource-tool-plan');
   assert.equal(await panel.getByTestId('resource-tool-io').isVisible(),false);
   const argv=['--label=seed A','{input:settings}','{input:seed}','{output:summary}'];
   for(const [index,argument] of [...argv,'unused'].entries()){
    await panel.getByTestId('resource-tool-add-argument').click();
    await panel.getByTestId('resource-tool-argument').nth(index).fill(argument);
   }
   await panel.getByRole('button',{name:'移除参数 5',exact:true}).click();
   const addPort=async(direction,id,filename,format)=>{
    await panel.getByTestId('resource-tool-'+direction+'-name').fill(id);
    await panel.getByTestId('resource-tool-'+direction+'-port-add').click();
    const row=panel.locator(`[data-testid="resource-tool-${direction}-port"][data-port-id="${id}"]`);
    await row.getByTestId('resource-tool-port-filename').fill(filename);
    await row.getByTestId('resource-tool-port-format').fill(format);
   };
   await addPort('input','settings','settings.ini','text');
   await addPort('input','seed','seed.xyz','xyz');
   await addPort('output','summary','summary.txt','text');
   const setFixture=async(name,kind,value)=>{
    const row=panel.locator(`[data-testid="resource-tool-test-input"][data-port-id="${name}"]`);
    await row.getByTestId('resource-tool-test-input-kind').selectOption(kind);
    await row.getByTestId('resource-tool-test-input-value').fill(value);
   };
   await setFixture('settings','text','mode=sample\nshots=4\n');
   await setFixture('seed','path','/fixture/authorized/seed.xyz');
   for(const [field,value] of Object.entries({'max-seconds':'45',cpus:'2',gpus:'0','memory-mb':'128',qos:'short'})){
    await panel.getByTestId('resource-tool-test-'+field).fill(value);
   }
   const submit=panel.getByTestId('resource-tool-plan'),pendingPort=panel.getByTestId('resource-tool-output-name');
   await pendingPort.fill('unapplied');
   await submit.click();
   assert.match(await pendingPort.evaluate(node=>node.validationMessage),/请添加端口或清空/);
   assert.deepEqual(await planCalls(page),[]);
   await pendingPort.clear();
   await panel.getByTestId('resource-tool-test-max-seconds').scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(out,'resource-tool-structured-manifest.png')});
   await submit.click();
   await panel.getByTestId('resource-tool-receipt').waitFor();
   assert.equal(await primary.count(),1);
   assert.equal(await primary.getAttribute('data-testid'),'resource-tool-start');
   const [call,...extra]=await planCalls(page);
   assert.deepEqual(extra,[]);assert.equal(call.method,'tools.resource.plan');
   const {project_id,cluster_id,environment_id,queue_target_id}=resourceTestTarget;
   assert.deepEqual([call.data.resource_id,call.data.profile_version,call.data.project_id,call.data.cluster_id,call.data.environment_id,call.data.queue_target_id],['ssh:tool-check-profile',7,project_id,cluster_id,environment_id,queue_target_id]);
   assert.deepEqual(call.data.manifest,{...resourceTestManifest,argv,
    inputs:{settings:{filename:'settings.ini',format:'text'},seed:{filename:'seed.xyz',format:'xyz'}},
    outputs:{summary:{filename:'summary.txt',format:'text'}},
    test:{inputs:{settings:{text:'mode=sample\nshots=4\n'},seed:{path:'/fixture/authorized/seed.xyz'}},max_seconds:45,resources:{cpus:2,gpus:0,memory_mb:128,qos:'short'}}});
  });

  await check('experience-resource-tool-advanced-source-and-invalid-draft-remain-intact',async page=>{
   const panel=await openResourceToolForm(page,'en');
   await openAdvancedJson(panel);
   const io=panel.getByTestId('resource-tool-io'),test=panel.getByTestId('resource-tool-test');
   const original='{"inputs":{},"outputs":{"summary":{"filename":"before.txt","format":"text"}},"parameters":{"scale":0.01230e+2},"future":{"extra":9007199254740993},"support_files":["seed.dat"],"dependencies":["python"]}';
   const testSource='{"inputs":{}, "max_seconds":120, "outputs":{"summary":{"min_bytes":1,"contains":"done"}}}';
   await io.fill(original);
   await test.fill(testSource);
   await panel.getByTestId('resource-tool-port-filename').fill('after.txt');
   await panel.getByTestId('resource-tool-test-max-seconds').fill('33');
   const edited=original.replace('before.txt','after.txt');
   assert.equal(await io.inputValue(),edited);
   assert.equal(await test.inputValue(),testSource.replace('120','33'));
   const submit=panel.getByTestId('resource-tool-plan');
   await submit.click();
   await panel.getByText('A JSON number would lose precision when saved.',{exact:true}).waitFor();
   assert.equal(await io.getAttribute('aria-invalid'),'true');
   const describedBy=await io.getAttribute('aria-describedby');
   assert.equal(await page.evaluate(id=>document.getElementById(id)?.textContent,describedBy),'A JSON number would lose precision when saved.');
   assert.deepEqual(await planCalls(page),[]);
   assert.equal(await io.inputValue(),edited);
   const unsupported=edited.replace('9007199254740993','41');
   await io.fill(unsupported);
   await submit.click();
   const fault=panel.locator('.aml-error-state').filter({hasText:'Cannot check resource tools right now'});
   await fault.getByRole('alert').waitFor();
   await fault.locator('summary').click();
   await fault.getByText(/Invalid resource tool request fields/).waitFor();
   assert.deepEqual((await planCalls(page)).map(call=>call.data.manifest.future),[{extra:41}]);
   assert.equal(await io.inputValue(),unsupported);
   const name=panel.getByTestId('resource-tool-input-name');
   await name.fill('unapplied');
   await io.fill('{"outputs":');
   await name.waitFor({state:'hidden'});
   assert.equal(await io.inputValue(),'{"outputs":');
   const corrected=edited.replace('"future":{"extra":9007199254740993},','');
   await io.fill(corrected);
   await name.waitFor();
   assert.equal(await name.inputValue(),'unapplied');
   await name.clear();
   await submit.click();
   await panel.getByTestId('resource-tool-receipt').waitFor();
   const [,call,...extra]=await planCalls(page);
   assert.deepEqual(extra,[]);
   assert.deepEqual(call.data.manifest,{...resourceTestManifest,...JSON.parse(corrected),test:JSON.parse(testSource.replace('120','33'))});
  });

 await check('experience-resource-tool-late-reads-and-writes-stay-with-their-owner',async page=>{
  await page.evaluate(async({target,manifest})=>{
   const Component=(await import('/frontend/features/tools/ResourceToolSetup.tsx')).default;
   const standard=window.studio.invoke;
   const destinations={
    'ssh:first:2':[{...target,environment_id:'first-v2'}],
    'ssh:second:7':[{...target,environment_id:'second-v7-one'},{...target,environment_id:'second-v7-two',queue_target_id:'other-queue'}],
    'ssh:second:8':[{...target,environment_id:'second-v8'}]
   };
   const f=window.__test.resourceOwners={destinations,calls:[],latest:{},gates:{},waiting:{}};
   f.open=(resourceId,profileVersion,options={})=>window.testRoot.render(window.React.createElement(Component,{resourceId,profileVersion,resourceName:'Same-name fixture',onClose(){},...options}));
   f.notify=resource_id=>window.__test.events.forEach(listener=>listener({method:'studio/resourceToolSetupChanged',params:{resource_id}}));
   f.defer=(method,key,name)=>{f.gates[method+' '+key]=name;};
   window.studio.invoke=async(method,data)=>{
    if(!method.startsWith('tools.resource.'))return standard(method,data);
    const key=`${data.resource_id}:${data.profile_version}`;
    f.calls.push({method,data});
    if(!(key in destinations))throw Error('Unknown fixture resource scope');
    let result;
    if(method==='tools.resource.list')result={targets:destinations[key],setups:f.latest[key]?[f.latest[key]]:[]};
    else if(method==='tools.resource.plan'){
     const chosen=destinations[key].find(item=>item.environment_id===data.environment_id&&item.queue_target_id===data.queue_target_id);
     if(!chosen)throw Error('Fixture plan selected a replaced target');
     result={id:'plan-'+key,resource_id:data.resource_id,workspace_id:'fixture-workspace',route:'custom',status:'planned',stage:'review',revision:1,plan_sha256:'a'.repeat(64),manifest:{...manifest,name:'Plan '+key},target:chosen,install_root:'/fixture/software',activity:[]};
    }else throw Error('Unexpected fixture operation '+method);
    const gate=f.gates[method+' '+key];delete f.gates[method+' '+key];
    if(gate)await new Promise((resolve,reject)=>{f.waiting[gate]={resolve,reject};});
    if(method==='tools.resource.plan')f.latest[key]=result;
    return result;
   };
   f.defer('tools.resource.list','ssh:first:2','oldResourceList');f.open('ssh:first',2);
  },{target:resourceTestTarget,manifest:resourceTestManifest});
  const panel=page.getByTestId('resource-tool-setup'),target=panel.getByTestId('resource-tool-target');
  const labels=['工具名称','工具 ID','工具版本','远端程序绝对路径'];
  const calls=()=>page.evaluate(()=>window.__test.resourceOwners.calls);
  const waiting=gate=>page.waitForFunction(name=>!!window.__test.resourceOwners.waiting[name],gate);
  await waiting('oldResourceList');
  await page.evaluate(()=>window.__test.resourceOwners.open('ssh:second',7));
  await openManualForm(panel,labels);
  await target.locator('option').filter({hasText:'second-v7-one'}).waitFor({state:'attached'});
  await target.selectOption({label:'second-v7-one · slurm fixture · tool-check-project'});
  await page.evaluate(()=>{
   const f=window.__test.resourceOwners;
   f.waiting.oldResourceList.reject(Error('Late failure from earlier resource'));
   f.defer('tools.resource.list','ssh:second:7','oldEventList');f.notify('ssh:second');
  });
  await waiting('oldEventList');
  await page.evaluate(()=>{
   const f=window.__test.resourceOwners;
   f.destinations['ssh:second:7']=f.destinations['ssh:second:7'].slice(1);f.notify('ssh:second');
  });
  await target.locator('option').filter({hasText:'second-v7-one'}).waitFor({state:'detached'});
  await page.evaluate(async()=>{
   window.__test.resourceOwners.waiting.oldEventList.resolve();
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  assert.equal(await target.inputValue(),'','an explicit disappeared target must be reselected');
  assert.equal(await target.locator('option').filter({hasText:'second-v7-one'}).count(),0);
  assert.equal(await panel.getByRole('alert').count(),0);
  assert.equal(await panel.getByTestId('resource-tool-plan').isEnabled(),false);
  await target.selectOption({label:'second-v7-two · slurm fixture · tool-check-project'});
  await page.evaluate(()=>window.__test.resourceOwners.defer('tools.resource.plan','ssh:second:7','oldVersionPlan'));
  await panel.getByTestId('resource-tool-plan').click();await waiting('oldVersionPlan');
  await page.evaluate(()=>window.__test.resourceOwners.open('ssh:second',8));
  await openManualForm(panel,labels);
  await target.locator('option').filter({hasText:'second-v8'}).waitFor({state:'attached'});
  await page.evaluate(async()=>{
   window.__test.resourceOwners.waiting.oldVersionPlan.resolve();
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  assert.equal(await panel.getByTestId('resource-tool-receipt').count(),0);
  assert.equal(await panel.getByRole('alert').count(),0);
  await page.evaluate(()=>window.__test.resourceOwners.defer('tools.resource.plan','ssh:second:8','currentPlan'));
  await panel.getByTestId('resource-tool-plan').click();await waiting('currentPlan');
  const listsBefore=(await calls()).filter(call=>call.method==='tools.resource.list').length;
  await page.evaluate(()=>{
   const f=window.__test.resourceOwners;
   f.notify('ssh:first');f.notify('ssh:second');f.notify('ssh:second');
  });
  assert.equal((await calls()).filter(call=>call.method==='tools.resource.list').length,listsBefore);
  await page.evaluate(()=>window.__test.resourceOwners.waiting.currentPlan.resolve());
  const receipt=panel.getByTestId('resource-tool-receipt');await receipt.getByRole('heading',{name:'Plan ssh:second:8 · 1.2.0',exact:true}).waitFor();
  const after=await calls();
  assert.equal(after.filter(call=>call.method==='tools.resource.list').length,listsBefore+1);
  assert.deepEqual(after.filter(call=>call.method==='tools.resource.plan').map(({data})=>[data.resource_id,data.profile_version,data.environment_id]),[
   ['ssh:second',7,'second-v7-two'],['ssh:second',8,'second-v8']
  ]);
 });

 await check('experience-resource-tool-poll-keeps-the-latest-revision',async page=>{
  await page.evaluate(async({manifest,target})=>{
   const Component=(await import('/frontend/features/tools/ResourceToolSetup.tsx')).default;
   const standard=window.studio.invoke,resourceId='ssh:poll-fixture',profileVersion=6;
   const receipt={id:'checking-tool',resource_id:resourceId,workspace_id:'fixture-workspace',route:'custom',status:'testing',stage:'test',revision:1,plan_sha256:'d'.repeat(64),manifest,target,install_root:'/fixture/software',activity:[],message:'First testing observation'};
   const f=window.__test.toolPoll={calls:[],row:receipt};
   f.notify=()=>window.__test.events.forEach(listener=>listener({method:'studio/resourceToolSetupChanged',params:{resource_id:resourceId}}));
   window.studio.invoke=async(method,data)=>{
    if(!method.startsWith('tools.resource.'))return standard(method,data);
    f.calls.push({method,data});
    if(data.resource_id!==resourceId||data.profile_version!==profileVersion)throw Error('Status used a different resource scope');
    if(method==='tools.resource.list')return {setups:[f.row],targets:[target]};
    if(method!=='tools.resource.status'||data.setup_id!==receipt.id)throw Error('Unexpected resource tool operation');
    if(!f.finishOldPoll)return new Promise(resolve=>{f.finishOldPoll=()=>resolve({...receipt,message:'Late first observation'});});
    return f.row;
   };
   window.testRoot.render(window.React.createElement(Component,{resourceId,profileVersion,resourceName:'Polling fixture',onClose(){}}));
  },{manifest:resourceTestManifest,target:resourceTestTarget});
  const panel=page.getByTestId('resource-tool-setup');
  await panel.getByRole('button',{name:'Fixture analysis · 1.2.0',exact:true}).click();
  const receipt=panel.getByTestId('resource-tool-receipt');
  await receipt.getByText('First testing observation',{exact:true}).waitFor();
  await page.waitForFunction(()=>typeof window.__test.toolPoll.finishOldPoll==='function');
  await page.evaluate(()=>{
   const f=window.__test.toolPoll;
   f.row={...f.row,revision:2,message:'Current testing observation'};f.notify();
  });
  await receipt.getByText('Current testing observation',{exact:true}).waitFor();
  await page.evaluate(async()=>{
   window.__test.toolPoll.finishOldPoll();
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  assert.equal(await receipt.getByText('Current testing observation',{exact:true}).isVisible(),true);
  assert.equal(await receipt.getByText('Late first observation',{exact:true}).count(),0);
  const statusCalls=()=>page.evaluate(()=>window.__test.toolPoll.calls.filter(call=>call.method!=='tools.resource.list'));
  const before=(await statusCalls()).length;
  await page.evaluate(()=>{const f=window.__test.toolPoll;f.row={...f.row,revision:3,status:'active',stage:'active',message:'Current activation receipt'};});
  await receipt.getByTestId('resource-tool-refresh').click();
  await receipt.getByText('Current activation receipt',{exact:true}).waitFor();
  const after=await statusCalls();assert(after.length>before);
  for(const call of after)assert.deepEqual(call,{method:'tools.resource.status',data:{resource_id:'ssh:poll-fixture',profile_version:6,setup_id:'checking-tool'}});
 });

 await check('managed-tools-experience-follows-the-restored-conversation',async page=>{
  await page.evaluate(()=>{
   const original=window.studio.invoke;
   const provider='deepseek',threadId='isolated-managed-tool-chat';
   const conversation={id:provider+':'+threadId,provider,threadId,name:'隔离测试 · 集群队列',projectId:null,taskId:null};
   const ready={status:'blocked',count:0,managedCompute:true,threadId,managedTools:{status:'ready',count:3}};
   const f=window.managedToolFixture={calls:[],compute:0,errors:[],sendStatus(params){
    window.__test.events.forEach(fn=>fn({provider,method:'studio/toolsStatus',params:{...ready,...params}}));
   }};
   window.studio.invoke=async(method,data)=>{
    f.calls.push({method,data});
    if(method==='agent.connect')return {tools:ready};
    if(method==='agent.tools')return ready;
    if(method==='agent.account')return {credentialStored:true};
    if(method==='conversation.remember')return conversation;
    if(method==='conversation.list')return [conversation];
    if(method==='agent.rpc'){
     if(data.method==='model/list')return {data:[{id:'fixture-model',model:'fixture-model',isDefault:true}]};
     if(['thread/read','thread/resume'].includes(data.method))return {thread:{id:threadId,turns:[]},model:'fixture-model'};
    }
    return original(method,data);
   };
   return window.renderTest('Agent',{planningMode:false,onPlanningModeChange(){},context:'{}',computeConnected:false,
    onConnectCompute:()=>{f.compute++;},onError:error=>f.errors.push(String(error)),sessionSelection:{nonce:'fixture-restore',conversation}});
  });
  await page.getByTestId('agent-options-summary').getByText(/fixture-model/).waitFor();
  await page.getByTestId('agent-options').click();
  const status=page.getByTestId('agent-tools-status');
  await status.getByText('托管计算工具通道已连接',{exact:true}).waitFor();
  assert.equal(await status.getAttribute('data-status'),'ready');
  assert.equal(await page.getByTestId('agent-tool-repair').count(),0);
  assert.equal(await page.getByTestId('agent-workflow-tools-status').count(),0);
  await page.screenshot({path:path.join(out,'managed-tools-restored-ready.png')});

  // A status for another chat must not replace the displayed one.
  const incomplete={status:'blocked',count:2,message:'当前对话的托管计算工具清单不完整。'};
  await page.evaluate(managedTools=>window.managedToolFixture.sendStatus({threadId:'foreign-chat',managedTools}),incomplete);
  assert.equal(await status.getAttribute('data-status'),'ready');
  await page.evaluate(managedTools=>window.managedToolFixture.sendStatus({managedTools}),incomplete);
  const repair=page.getByTestId('agent-managed-tools-repair');
  await repair.waitFor();
  assert.equal(await repair.innerText(),'修复工具连接');
  await page.screenshot({path:path.join(out,'managed-tools-incomplete.png')});
  await page.locator('.composer textarea').fill('继续查询同一个资源。');
  await repair.click();
  await status.getByText('托管计算工具通道已连接',{exact:true}).waitFor();
  assert.equal(await page.locator('.composer textarea').inputValue(),'继续查询同一个资源。');
  const {calls,compute,errors}=await page.evaluate(()=>window.managedToolFixture);
  assert.equal(compute,0);assert.deepEqual(errors,[]);
  assert.deepEqual(calls.filter(call=>call.method==='agent.connect').at(-1).data,
   {provider:'deepseek',threadId:'isolated-managed-tool-chat',repairTools:'managed'});
  assert(!calls.some(call=>call.method==='worker.connect'||call.method==='agent.rpc'&&call.data.method==='turn/start'));
 });
}
