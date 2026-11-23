import assert from 'node:assert/strict';
import path from 'node:path';

export async function frontendWorkflowExperienceCases({check,out}){
 const snapshot=(page,name)=>page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
 await check('workflow-experience-entry-summary-direct-field-and-review-links',async page=>{
  await page.evaluate(async()=>{
   const {default:roadmap}=await import('/tests/fixtures/workflow-roadmap.json');
   const task={id:'workflow-overview-fixture',name:'Saved sampling plan',artifacts:[],updatedAt:1,roadmap,
    parameters:{engine:'gpumd.md',structure:{file:'/fixture/snapshot.xyz',elements:['Cu','Ni'],atom_count:128},potential_file:'/fixture/nep.txt',dynamics:{temperature_K:310}},
    steps:[{id:'run-setup',title:'计算输入',fields:[{key:'control_file',label:'控制文件',type:'file',required:true},{key:'native.options',label:'原生控制选项',type:'object',required:true,advanced:true}]}],
    missingFields:['核对拟用的计算队列。']};
   return window.renderTest('AgentTaskPage',{worker:false,task,environments:[],onError:()=>{},onRefresh:()=>{}});
  });
  const summary=page.getByTestId('workflow-entry-summary'),parameters=page.getByTestId('workflow-key-parameters');
  assert.match(await summary.innerText(),/分子动力学原子轨迹/);assert.match(await summary.innerText(),/热力学时间序列 · 待确认/);
  assert.match(await parameters.innerText(),/snapshot\.xyz[\s\S]*Cu, Ni[\s\S]*128[\s\S]*nep\.txt[\s\S]*310/);
  assert.equal(await summary.evaluate(element=>element.previousElementSibling?.getAttribute('data-testid')),'workflow-pinned-heading');
  await snapshot(page,'workflow-entry-summary');
  await page.getByLabel('只看缺项').check();await page.getByLabel('搜索流程参数').fill('hidden by query');assert.equal(await page.locator('.visual-flow-step').count(),0);
  const blocker=summary.getByRole('button',{name:'原生控制选项',exact:true});await blocker.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.activeElement?.closest('[data-field]')?.getAttribute('data-field')==='native.options');
  assert.equal(await page.locator('[data-field="native.options"] textarea').isVisible(),true);
  assert.equal(await page.getByLabel('搜索流程参数').inputValue(),'');assert.equal(await page.getByLabel('只看缺项').isChecked(),false);
  await summary.getByRole('button',{name:'待确认事项 · 1',exact:true}).click();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-testid')==='workflow-requirements');
  assert.match(await page.getByTestId('workflow-requirements').innerText(),/核对拟用的计算队列/);
  assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>['task.edit','task.execute'].includes(c.method)).length),0);
 });
 await check('workflow-experience-hamiltonian-directory-opens-planned-tool',async page=>{
  await page.evaluate(()=>window.renderTest('App'));
  await page.locator('nav').getByTestId('navigate-tools').click();
  const computeGroup = page.getByTestId('tools-directory').locator('section').filter({
   has: page.getByRole('heading',{name:'计算与建模',exact:true})
  });
  await computeGroup.getByTestId('open-tool-hamiltonian').click();
  const detail = page.locator('.tool-page');
  await detail.getByRole('heading',{name:'机器学习哈密顿量',exact:true}).waitFor();
  assert.match(await detail.locator('.notice').innerText(),/后端待接入/);
  for(const label of ['数据准备','模型训练','独立评估','哈密顿量重构','能带分析']){
   await detail.locator('.tool-capabilities').getByText(label,{exact:true}).waitFor();
  }
  assert.deepEqual(await detail.getByRole('button').evaluateAll(buttons=>buttons.map(button=>button.dataset.testid)),['pin-tool']);
  await snapshot(page,'hamiltonian-tool');
  await page.locator('nav').getByTestId('navigate-tools').click();
  await page.getByTestId('open-tool-training').waitFor();
 });
 async function setup(page){await page.evaluate(async()=>{window.workflowFixtures=await import('/tests/fixtures/frontend-workflow-experience.mjs');window.workflowEvents=[];window.workflowErrors=[];document.getElementById('root').style.cssText='padding:24px;max-width:1000px;margin:auto;background:var(--bg);color:var(--text)';});}
 async function plan(page){await setup(page);await page.evaluate(async()=>{
  const {WorkflowPage}=await import('/frontend/features/workflows/Workflows.tsx');window.planSaved=[];window.planAgent=[];window.planPending=[];
  window.studio.invoke=(method,value)=>{if(method!=='workflow.save')throw Error('Unexpected fixture call '+method);return new Promise(resolve=>window.planPending.push({value:structuredClone(value),resolve}));};
  window.mountPlan=initial=>window.testRoot.render(React.createElement(WorkflowPage,{key:initial?.id||'new',initial,taskId:'sampling',onSaved:(value,options)=>window.planSaved.push({value,options}),onAgent:value=>window.planAgent.push(value),onTool:()=>{},onError:error=>window.workflowErrors.push(String(error))}));window.mountPlan();
 });await page.getByTestId('workflow-plan').waitFor();}
 async function stage(page,consumer=false){await setup(page);await page.evaluate(async consumer=>{
  const Component=(await import(consumer?'/frontend/features/workflows/ConsumerStageEditor.tsx':'/frontend/features/workflows/TaskStageEditor.tsx')).default;
  window.stageRead=0;window.stageSaveCalls=[];window.stageProposals=[];window.stageProps={taskId:'task-A',revision:1,workerReady:true,onSaved:()=>window.workflowEvents.push('saved')};
  window.stageProps.api={inspect:async({taskId,engine})=>consumer?window.workflowFixtures.consumerStage(taskId,window.stageProps.revision,++window.stageRead,engine):window.workflowFixtures.buildStage(taskId,window.stageProps.revision),propose:async value=>{window.stageProposals.push(structuredClone(value));return {taskId:value.taskId,proposalId:'fixture-proposal',engine:'gpumd.sampling',files:[],derivedControls:{},scientificValidation:'not_run'};},save:async value=>{window.stageSaveCalls.push(structuredClone(value));if(window.stageSaveFail)throw Error('Synthetic save response unavailable');return {taskId:value.taskId,status:'draft',review:'not_run',execution:'not_run'};}};
  window.mountStage=patch=>{window.stageProps={...window.stageProps,...patch};window.testRoot.render(React.createElement(Component,window.stageProps));};window.mountStage({});
 },consumer);await page.getByTestId(consumer?'consumer-stage-editor':'task-stage-editor').waitFor();}
 async function custom(page){await setup(page);await page.evaluate(async()=>{
  const Component=(await import('/frontend/features/custom-cv/CustomCvWorkbench.tsx')).default;window.customProps=window.workflowFixtures.privateCv();window.customCalls=[];
  const callback=name=>(...args)=>{window.customCalls.push({name,args});};window.customCallbacks={onSave:callback('save'),onApproveFormula:callback('formula'),onApproveCode:callback('code'),onValidate:callback('validate'),onAttach:callback('attach'),onSharing:callback('sharing'),onSelect:callback('select'),onDiscuss:callback('discuss'),onReload:callback('reload')};
  window.mountCustom=patch=>{window.customProps={...window.customProps,...patch};window.testRoot.render(React.createElement(Component,{...window.customProps,...window.customCallbacks}));};window.mountCustom({});
 });await page.getByTestId('custom-cv-workbench').waitFor();}

 await check('workflow-experience-plan-keeps-newer-input-and-defers-agent-handoff',async page=>{
  await plan(page);await page.getByLabel('任务名称',{exact:true}).fill('Submitted snapshot');await page.getByRole('button',{name:'交给 Agent 准备',exact:true}).click();
  await page.getByLabel('任务名称',{exact:true}).fill('Latest local edit');await page.evaluate(()=>{const request=window.planPending[0];request.resolve({...request.value,id:'plan-A'});});
  await page.getByRole('status').filter({hasText:'继续输入的修改仍待保存'}).waitFor();assert.equal(await page.getByLabel('任务名称',{exact:true}).inputValue(),'Latest local edit');assert.deepEqual(await page.evaluate(()=>window.planAgent),[]);assert.equal(await page.evaluate(()=>window.planSaved[0].options.navigate),false);
  await page.evaluate(()=>window.mountPlan(window.planSaved[0].value));await page.waitForFunction(()=>document.querySelector('[data-testid=workflow-plan] input')?.value==='Latest local edit');await page.getByRole('button',{name:'保存任务计划',exact:true}).click();await page.waitForFunction(()=>window.planPending.length===2);assert.equal(await page.evaluate(()=>window.planPending[1].value.id),'plan-A');assert.equal(await page.evaluate(()=>window.planPending[1].value.name),'Latest local edit');await snapshot(page,'workflow-plan-newer-input');
 });
 await check('workflow-experience-plan-late-save-does-not-navigate-or-send',async page=>{
  await plan(page);await page.getByLabel('任务名称',{exact:true}).fill('Save before visiting another page');await page.getByRole('button',{name:'交给 Agent 准备',exact:true}).click();await page.evaluate(()=>window.testRoot.render(React.createElement('p',{'data-testid':'other-page'},'Other page')));await page.getByTestId('other-page').waitFor();
  await page.evaluate(()=>{const request=window.planPending[0];request.resolve({...request.value,id:'plan-B'});});await page.waitForFunction(()=>window.planSaved.length===1);assert.equal(await page.evaluate(()=>window.planSaved[0].options.navigate),false);assert.deepEqual(await page.evaluate(()=>window.planAgent),[]);assert.equal(await page.getByTestId('other-page').isVisible(),true);
 });
 await check('workflow-experience-build-draft-survives-offline-source-update-and-navigation',async page=>{
  await stage(page);await page.getByTestId('stage-inspect').click();await page.locator('[data-field="cutoff"] input').fill('4.5');await page.evaluate(()=>window.mountStage({workerReady:false}));assert.equal(await page.locator('[data-field="cutoff"] input').inputValue(),'4.5');assert.equal(await page.getByTestId('stage-save').isDisabled(),true);
  await page.locator('[data-field="cutoff"] input').fill('4.7');await page.evaluate(()=>window.mountStage({workerReady:true,revision:2}));assert.equal(await page.getByTestId('stage-save').isDisabled(),true);await page.getByTestId('stage-inspect').click();await page.getByTestId('stage-draft-conflict').waitFor();assert.equal(await page.locator('[data-field="cutoff"] input').inputValue(),'4.7');assert.equal(await page.getByTestId('stage-save').isDisabled(),true);
  await page.getByRole('button',{name:'已核对，采用新来源并保留可编辑项',exact:true}).click();assert.equal(await page.getByTestId('stage-save').isEnabled(),true);await page.evaluate(()=>window.mountStage({taskId:'task-B'}));await page.waitForFunction(()=>document.querySelector('[data-testid=task-stage-editor]')?.dataset.taskId==='task-B');assert.equal(await page.locator('[data-field="cutoff"] input').count(),0);await page.evaluate(()=>window.mountStage({taskId:'task-A'}));await page.waitForFunction(()=>document.querySelector('[data-testid=task-stage-editor]')?.dataset.taskId==='task-A');assert.equal(await page.locator('[data-field="cutoff"] input').inputValue(),'4.7');assert.equal(await page.getByTestId('stage-save').isDisabled(),true);await snapshot(page,'workflow-build-restored-draft');
 });
 await check('workflow-experience-unknown-stage-save-requires-read-without-resubmission',async page=>{
  await stage(page);await page.getByTestId('stage-inspect').click();await page.locator('[data-field="cutoff"] input').fill('5.2');await page.evaluate(()=>window.stageSaveFail=true);await page.getByTestId('stage-save').click();await page.getByRole('alert').filter({hasText:'Synthetic save response unavailable'}).waitFor();assert.equal(await page.locator('[data-field="cutoff"] input').inputValue(),'5.2');assert.equal(await page.getByTestId('stage-save').isDisabled(),true);await page.getByTestId('stage-draft-retained').filter({hasText:'保存结果尚待核对'}).waitFor();assert.equal(await page.evaluate(()=>window.stageSaveCalls.length),1);await page.getByTestId('stage-inspect').click();assert.equal(await page.locator('[data-field="cutoff"] input').inputValue(),'5.2');assert.equal(await page.evaluate(()=>window.stageSaveCalls.length),1);
 });
 await check('workflow-experience-consumer-retains-inputs-rebinds-exact-assets-and-isolates-stages',async page=>{
  await stage(page,true);await page.getByLabel('消费阶段',{exact:true}).selectOption('gpumd.sampling');await page.getByTestId('consumer-stage-inspect').click();await page.locator('[data-field="temperature_K"] input').fill('325');await page.getByLabel('实际已导入 NEP4 势模型',{exact:true}).selectOption('potential-1');
  await page.evaluate(()=>window.mountStage({workerReady:false}));assert.equal(await page.locator('[data-field="temperature_K"] input').inputValue(),'325');await page.evaluate(()=>window.mountStage({workerReady:true}));assert.equal(await page.getByTestId('consumer-stage-preview').isDisabled(),true);await page.getByTestId('consumer-stage-inspect').click();assert.equal(await page.getByLabel('实际已导入 NEP4 势模型',{exact:true}).inputValue(),'potential-2');await page.getByTestId('consumer-stage-preview').click();assert.equal(await page.evaluate(()=>window.stageProposals[0].selections.potentialId),'potential-2');assert.equal(await page.evaluate(()=>window.stageProposals[0].values.temperature_K),325);
  await page.getByLabel('消费阶段',{exact:true}).selectOption('bias.validate');assert.equal(await page.getByTestId('consumer-stage-proposal').count(),0);await page.getByLabel('消费阶段',{exact:true}).selectOption('gpumd.sampling');assert.equal(await page.locator('[data-field="temperature_K"] input').inputValue(),'325');assert.equal(await page.getByTestId('consumer-stage-preview').isDisabled(),true);await page.evaluate(()=>window.mountStage({revision:2}));await page.getByTestId('consumer-stage-inspect').click();await page.getByTestId('consumer-draft-conflict').waitFor();await snapshot(page,'workflow-consumer-source-review');
 });
 await check('workflow-experience-private-draft-navigation-task-isolation-and-source-conflict',async page=>{
  await custom(page);await page.getByRole('button',{name:'调整数学定义',exact:true}).click();await page.getByLabel('custom.formula',{exact:true}).fill('PRIVATE UNSAVED A');await page.getByLabel('custom.parameter.epsilon',{exact:true}).fill('0.25');await page.evaluate(()=>window.testRoot.render(React.createElement('p',{'data-testid':'other-page'},'Another page')));await page.getByTestId('other-page').waitFor();
  await page.evaluate(()=>window.mountCustom(window.workflowFixtures.privateCv('task-B','private-A')));await page.getByTestId('custom-cv-workbench').waitFor();assert.equal(await page.getByLabel('custom.parameter.epsilon',{exact:true}).inputValue(),'0.1');assert.doesNotMatch(await page.getByTestId('custom-formula').innerText(),/PRIVATE UNSAVED A/);
  await page.evaluate(()=>window.mountCustom(window.workflowFixtures.privateCv()));assert.equal(await page.getByLabel('custom.parameter.epsilon',{exact:true}).inputValue(),'0.25');assert.match(await page.getByTestId('custom-formula').innerText(),/PRIVATE UNSAVED A/);await page.evaluate(()=>window.mountCustom({entry:{...window.customProps.entry,expected:{...window.customProps.entry.expected,revision:'agent-update'}}}));await page.getByRole('alert').filter({hasText:'本地修改仍保留'}).waitFor();assert.equal(await page.getByTestId('custom-primary').isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.customCalls),[]);assert.equal(await page.evaluate(()=>Object.values(localStorage).some(value=>String(value).includes('PRIVATE UNSAVED A'))),false);await snapshot(page,'workflow-private-draft-conflict');
 });
 await check('workflow-experience-private-old-save-cannot-clear-newer-remounted-edits',async page=>{
  await custom(page);await page.evaluate(()=>{window.customCallbacks.onSave=()=>new Promise(resolve=>window.finishPrivateSave=resolve);window.mountCustom({});});await page.getByLabel('custom.parameter.epsilon',{exact:true}).fill('0.2');await page.getByTestId('custom-primary').click();await page.waitForFunction(()=>typeof window.finishPrivateSave==='function');await page.evaluate(()=>window.testRoot.render(React.createElement('p',{'data-testid':'other-page'},'Another page')));await page.getByTestId('other-page').waitFor();await page.evaluate(()=>window.mountCustom({}));await page.getByLabel('custom.parameter.epsilon',{exact:true}).fill('0.3');await page.evaluate(()=>window.finishPrivateSave());await page.waitForTimeout(50);assert.equal(await page.getByLabel('custom.parameter.epsilon',{exact:true}).inputValue(),'0.3');assert.match(await page.getByTestId('custom-primary').innerText(),/保存定义与参数/);
 });
 async function privateController(page){await setup(page);await page.evaluate(async()=>{
  const Controller=(await import('/frontend/features/custom-cv/CustomCvTaskController.tsx')).default;
  window.cvRecords={'task-A':window.workflowFixtures.privateCv(),'task-B':window.workflowFixtures.privateCv('task-B','private-B')};window.cvCalls=[];window.cvStates=[];window.cvTask='task-A';
  window.cvInvoke=async(method,payload)=>{
   window.cvCalls.push({method,payload:structuredClone(payload)});const record=window.cvRecords[payload.taskId];
   if(method==='customCv.saveSpec'){record.entry={...record.entry,spec:structuredClone(payload.spec),parameterValues:structuredClone(payload.parameterValues),expected:{...record.entry.expected,revision:'accepted-save'}};throw Error('Synthetic save response unavailable');}
   if(!['customCv.read','customCv.status'].includes(method))throw Error('Unexpected mutation '+method);
   if(window.cvReadFail)throw Error('Synthetic saved record unavailable');
   if(window.cvReadDeferred){window.cvReadDeferred=false;return new Promise(resolve=>window.cvResolveRead=resolve);}
   return structuredClone(record);
  };
  window.mountCvController=taskId=>{window.cvTask=taskId||window.cvTask;window.testRoot.render(React.createElement(Controller,{key:window.cvTask,taskId:window.cvTask,entryId:window.cvRecords[window.cvTask].entry.id,provider:'codex',workerReady:true,invoke:window.cvInvoke,onDiscussion:()=>{throw Error('No provider request is expected');},onStateChange:value=>window.cvStates.push(value)}));};window.mountCvController('task-A');
 });await page.getByTestId('custom-cv-workbench').waitFor();}
 await check('experience-round2-private-save-unknown-read-confirms-without-resaving',async page=>{
  await privateController(page);await page.getByLabel('custom.parameter.epsilon',{exact:true}).fill('0.25');await page.getByTestId('custom-primary').click();await page.getByRole('alert').filter({hasText:'Synthetic save response unavailable'}).waitFor();assert.equal(await page.getByLabel('custom.parameter.epsilon',{exact:true}).inputValue(),'0.25');await page.getByTestId('custom-read-saved').click();await page.getByTestId('custom-read-matched').waitFor();assert.equal(await page.getByLabel('custom.parameter.epsilon',{exact:true}).inputValue(),'0.25');assert.equal(await page.evaluate(()=>window.cvCalls.filter(call=>call.method==='customCv.saveSpec').length),1);assert.deepEqual(await page.evaluate(()=>window.cvCalls.map(call=>call.method)),['customCv.read','customCv.saveSpec','customCv.read']);assert.equal(await page.evaluate(()=>window.cvStates.at(-1).dirty),false);await snapshot(page,'experience-round2-private-confirmed-record');
 });
 await check('experience-round2-private-read-retry-differences-narrow-large-text-keyboard',async page=>{
  await privateController(page);await page.getByLabel('custom.parameter.epsilon',{exact:true}).fill('0.3');await page.evaluate(()=>{window.cvReadFail=true;});await page.getByTestId('custom-read-saved').click();await page.getByRole('alert').filter({hasText:'Synthetic saved record unavailable'}).waitFor();assert.equal(await page.getByLabel('custom.parameter.epsilon',{exact:true}).inputValue(),'0.3');assert.equal(await page.evaluate(()=>window.cvStates.at(-1).dirty),true);
  await page.evaluate(()=>{window.cvReadFail=false;const entry=window.cvRecords['task-A'].entry;entry.parameterValues={epsilon:.7};entry.expected={...entry.expected,revision:'external-edit'};document.documentElement.style.setProperty('--ui-scale','1.5');document.documentElement.style.setProperty('--ui-min-font','18px');document.getElementById('root').style.cssText='padding:8px;width:390px;max-width:100%;margin:auto;background:var(--bg);color:var(--text)';});
  await page.getByTestId('custom-read-saved').click();await page.getByTestId('custom-read-different').waitFor();assert.equal(await page.getByTestId('custom-primary').isDisabled(),true);assert.match(await page.locator('.ccv-differences').innerText(),/当前保存版本[\s\S]*0.7[\s\S]*本地输入（未保存）[\s\S]*0.3/);assert.equal(await page.evaluate(()=>window.cvStates.at(-1).dirty),true);
  await page.getByTestId('custom-read-saved').focus();let reached=false;for(let i=0;i<12;i++){await page.keyboard.press('Tab');if(await page.evaluate(()=>document.activeElement?.getAttribute('data-testid')==='custom-continue-local')){reached=true;break;}}assert(reached,'source reconciliation action is reachable by keyboard');
  const layout=await page.getByTestId('custom-draft-reconcile').evaluate(node=>({width:node.getBoundingClientRect().width,overflow:node.scrollWidth-node.clientWidth,buttons:[...node.querySelectorAll('button')].map(button=>({width:button.getBoundingClientRect().width,text:button.textContent}))}));assert(layout.width<=390);assert(layout.overflow<=1);assert(layout.buttons.every(button=>button.width<=layout.width));await snapshot(page,'experience-round2-private-narrow-large-text');
  await page.keyboard.press('Enter');assert.equal(await page.getByLabel('custom.parameter.epsilon',{exact:true}).inputValue(),'0.3');assert.equal(await page.getByTestId('custom-primary').isEnabled(),true);assert(await page.evaluate(()=>window.cvCalls.every(call=>call.method==='customCv.read')));
  await page.evaluate(()=>{const entry=window.cvRecords['task-A'].entry;entry.parameterValues={epsilon:.8};entry.expected={...entry.expected,revision:'another-edit'};});await page.getByTestId('custom-read-saved').click();await page.getByTestId('custom-use-saved').click();assert.equal(await page.getByLabel('custom.parameter.epsilon',{exact:true}).inputValue(),'0.8');assert(await page.evaluate(()=>window.cvCalls.every(call=>call.method==='customCv.read')));
 });
 await check('experience-round2-private-late-read-navigation-keeps-each-task-draft',async page=>{
  await privateController(page);await page.getByLabel('custom.parameter.epsilon',{exact:true}).fill('0.2');await page.evaluate(()=>{window.cvReadDeferred=true;});await page.getByTestId('custom-read-saved').click();await page.waitForFunction(()=>typeof window.cvResolveRead==='function');await page.evaluate(()=>window.mountCvController('task-B'));await page.getByTestId('custom-cv-workbench').waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="custom.parameter.epsilon"]')?.value==='0.1');await page.getByLabel('custom.parameter.epsilon',{exact:true}).fill('0.3');await page.evaluate(()=>{const result=structuredClone(window.cvRecords['task-A']);result.entry.parameterValues={epsilon:.2};window.cvResolveRead(result);});await page.waitForTimeout(50);assert.equal(await page.getByLabel('custom.parameter.epsilon',{exact:true}).inputValue(),'0.3');await page.evaluate(()=>window.mountCvController('task-A'));await page.waitForFunction(()=>document.querySelector('[aria-label="custom.parameter.epsilon"]')?.value==='0.2');assert.equal(await page.getByTestId('custom-read-matched').count(),0);assert(await page.evaluate(()=>window.cvCalls.every(call=>call.method==='customCv.read')));
 });

}
