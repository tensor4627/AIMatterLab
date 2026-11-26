import assert from 'node:assert/strict';
import path from 'node:path';
import {packageRecord,configurationRecord} from '../tests/helpers/tool-packages-components.mjs';
import {workflowRead} from '../tests/helpers/tool-workflows-components.mjs';

export async function frontendContinuousWorkCases({check,out}){
 await check('continuous-work-current-wording-app-advanced-inputs-are-advisory',async page=>{
  await page.evaluate(()=>{const f=window.__test,original=window.studio.invoke;f.conversation={id:'codex:wording',provider:'codex',threadId:'wording',name:'Wording review',projectId:'project',taskId:null};localStorage.setItem('studio.conversation',f.conversation.id);window.studio.invoke=async(method,data)=>method==='conversation.list'?[f.conversation]:method==='worker.status'?{status:'connected',checkedAt:1}:method==='worker.request'&&['/api/runs','/api/cluster-runs'].includes(data.target)?[]:original(method,data);return window.renderTest('App');});
  await page.getByTestId('navigate-home').filter({visible:true}).click();await page.locator('.recent-runs').waitFor();assert.match(await page.locator('.recent-runs').innerText(),/尚无运行记录|尚未读取运行记录/);
  await page.locator('.home-disclosure>summary').filter({hasText:'记录统计与高级入口'}).click();const advanced=page.getByRole('button',{name:'高级：原生计算草稿',exact:true});await advanced.waitFor();assert.equal(await advanced.isEnabled(),true);await advanced.click();
  await page.getByRole('button',{name:'创建输入快照与草稿',exact:true}).waitFor();const modal=page.getByRole('dialog');assert.match(await modal.innerText(),/检查结果单独记录，可在授权范围内提交/);assert.doesNotMatch(await modal.innerText(),/验证通过后才能提交|复核后才能提交/);assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='task.execute'||c.method==='worker.request'&&c.data?.method==='POST').length),0);
 });
 for(const language of ['zh-CN','en'])await check('continuous-work-current-wording-pygas-stale-checks-'+language,async page=>{
  await page.evaluate(language=>{
   const sha='a'.repeat(64),template={input:{inputs:{},outputs:{pos:'pos'}},collect:{inputs:{value:'value'},outputs:{cv:'cv'}},output:{inputs:{cv:'cv'},outputs:{}},reduce:{inputs:{value:'value'},outputs:{value:'value'}}};
   const catalog={schema_version:1,status:'passed',source:{files:{'tools/graph_workflow.py':sha}},catalog:{cv:[],bias:[],switch:[],neighbor:[]},ports:{status:'passed',source_sha256:sha,classes:{},templates:{cvonly:template,metad:template},multiple_inputs:[['collect','value']],compatible_pairs:[],reductions:['identity','sum']}},graph={version:2,mode:'cvonly',settings:{cutoff:3},nodes:[],edges:[]};
   window.__test.beforeGraph=structuredClone(graph);return window.renderTest('PygasComposer',{ownerKey:'wording',catalog,sourceReceipt:catalog.source,graph,language,onChange:next=>window.__test.changedGraph=next,onSave:async()=>{},currentSHA:''});
  },language);
  await page.locator('.pg-framework>summary').click();const copy=await page.locator('.pg-framework').innerText();assert.match(copy,language==='en'?/Previous checks.*become stale/:/旧检查将标记过期/);assert.equal(await page.getByTestId('save-pygas-composition').isEnabled(),true);await page.getByLabel('pygas.graph.mode',{exact:true}).selectOption('metad');const graphs=await page.evaluate(()=>({before:window.__test.beforeGraph,after:window.__test.changedGraph}));assert.deepEqual(graphs.after,{...graphs.before,mode:'metad'});assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='task.execute'||c.method==='worker.request'&&c.data?.method==='POST').length),0);
 });
 await check('continuous-work-diagnostic-repair-preserves-draft-and-never-auto-sends',async page=>{
  await page.evaluate(async()=>{
   const f=window.__test,original=window.studio.invoke;f.conversation={id:'codex:repair-owner',provider:'codex',threadId:'repair-owner',name:'Repair owner',projectId:'project',taskId:'repair-task'};f.other={...f.conversation,id:'codex:other-owner',threadId:'other-owner',name:'Other conversation',taskId:null};f.task={id:'repair-task',name:'Repair current workflow',provider:'codex',threadId:'repair-owner',projectId:'project',workflowVersion:2,parameterRevision:3,updatedAt:1,parameters:{engine:'pydyn.md'},steps:[],artifacts:[],review:{status:'not_run'},workspaceChoice:'draft',deployment:{revision:2,config:{target:'local',projectId:'project',targetId:'env',inputSource:'local',directoryName:'repair-attempt',maxSeconds:60,gpu:0,resources:{cpus:1,gpus:1,memory_mb:1024,queue:'',account:''}}}};localStorage.setItem('studio.conversation',f.conversation.id);localStorage.setItem('studio.section','agent-task:'+f.task.id);
   const {deploymentDiagnosticJournal,diagnosticContext}=await import('/frontend/features/diagnostics/ui-diagnostics.mjs');deploymentDiagnosticJournal.add(Error('Synthetic actual-input failure: missing required run.py'),diagnosticContext(f.task,f.task.deployment.config,'prepare'));
   window.studio.invoke=async(method,data)=>{
    if(method==='conversation.list')return [f.conversation,f.other];
    if(method==='conversation.select'){
     if(data.id===f.conversation.id&&f.deferRepairSelection){
      f.deferRepairSelection=false;
      return new Promise(resolve=>{f.releaseRepairSelection=()=>resolve(f.conversation);});
     }
     return data.id===f.conversation.id?f.conversation:f.other;
    }
    if(method==='conversation.remember')return data.threadId===f.conversation.threadId?f.conversation:f.other;
    if(method==='task.list')return [f.task];
    if(method==='compute.resource.status')return {schemaVersion:1,kind:null,status:'none',selectionId:null};
    if(method==='agent.rpc'&&['thread/resume','thread/read'].includes(data.method)){
     const original=data.params.threadId===f.conversation.threadId;
     return {model:'fixture-model',thread:{id:data.params.threadId,turns:[{items:[{id:'saved-repair',type:'agentMessage',text:original?'Saved repair history':'Other saved history'}]}]}};
    }
    return original(method,data);
   };
   return window.renderTest('App');
  });
  await page.getByTestId('agent-task-page').waitFor();
  await page.getByTestId('open-deployment').click();
  await page.getByTestId('deployment-page').waitFor();
  await page.getByText('Saved repair history',{exact:true}).waitFor();
  const input=page.locator('.composer textarea'),repair=page.getByTestId('diagnostic-repair');
  const sends=()=>page.evaluate(()=>window.__test.calls.filter(c=>c.method==='task.execute'||c.method==='agent.rpc'&&c.data?.method==='turn/start').length);
  await input.fill('Keep my existing unsent instructions');
  const before=await sends();
  await repair.click();
  await page.getByTestId('agent-prompt-proposal').waitFor();
  assert.equal(await input.inputValue(),'Keep my existing unsent instructions');
  await page.getByTestId('agent-prompt-append').click();
  const draft=await input.inputValue();
  assert.match(draft,/^Keep my existing unsent instructions/);
  assert.match(draft,/missing required run.py/);
  assert.match(draft,/"parameterRevision": 3/);
  assert.match(draft,/"taskId": "repair-task"/);
  assert.equal(await page.evaluate(()=>localStorage.getItem('studio.conversation')),'codex:repair-owner');
  await page.screenshot({path:path.join(out,'continuous-app-repair-draft.png')});
  await page.evaluate(()=>{window.__test.deferRepairSelection=true;});
  await repair.click();
  await page.waitForFunction(()=>typeof window.__test.releaseRepairSelection==='function');
  const sidebar=page.getByTestId('conversation-sidebar');
  await sidebar.getByRole('button',{name:'Other conversation',exact:true}).click();
  await page.getByText('Other saved history',{exact:true}).waitFor();
  await input.fill('Keep the other conversation draft');
  await page.evaluate(async()=>{
   window.__test.releaseRepairSelection();
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  assert.equal(await input.inputValue(),'Keep the other conversation draft');
  assert.equal(await page.getByTestId('agent-prompt-proposal').count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('studio.conversation')),'codex:other-owner');
  await sidebar.getByRole('button',{name:'Repair owner',exact:true}).click();
  await page.getByText('Saved repair history',{exact:true}).waitFor();
  assert.equal(await input.inputValue(),draft);
  assert.equal(await sends(),before);
 });
 await check('continuous-work-repair-grant-purpose-and-durable-notice',async page=>{
  const record=packageRecord(),configuration=configurationRecord(record,'failed');configuration.install.status='passed';configuration.tests=configuration.tests.map(value=>({...value,status:'failed',reason:'Synthetic functional check finding'}));await page.evaluate(async({record,configuration})=>{
   const f=window.__test,original=window.studio.invoke;document.getElementById('root').className='application';
   window.studio.invoke=async(method,data)=>{
    if(method==='tools.packages.list')return [{...record,name:record.manifest.name}];if(method==='tools.packages.read')return record;
    if(method==='tools.configurations.list')return [{...configuration,worker_binding:{distribution:'Fixture',root:'/fixture',port:1},project_id:configuration.target.project_id,environment_id:configuration.target.environment_id}];
    if(method==='tools.configurations.context')return {provider:'codex',providers:['codex'],hasConversation:true,configuration_id:configuration.configuration_id,owner_key:'isolated-owner'};
    if(method==='tools.configurations.status')return configuration;
    if(method==='tools.configurations.activate'){f.calls.push({method,data});return {...configuration,status:'active',guidance_resources:[],archived_resources:[],execution_skill:{id:'execution',body:'Synthetic execution guidance',sha256:'a'.repeat(64)}};}
    if(method==='tools.configurations.bind'){f.calls.push({method,data});return {status:'bound',configuration_id:configuration.configuration_id};}
    if(method==='tools.configurations.read')return {...configuration,status:'stale',check_findings:[{status:'warning',code:'environment_changed',message:'Original environment evidence is stale'}],guidance_resources:[{id:'registered-installation',role:'installation',paths:['/fixture/installation.md']}],archived_resources:[],execution_skill:{id:'execution',body:'Synthetic execution guidance',sha256:'a'.repeat(64)}};
    if(method==='tools.configurations.grant'){f.calls.push({method,data});return data.purpose==='repair'?{status:'granted',duration:'delegation',expires_at:null}:{status:'granted',duration:'temporary',expires_at:Date.now()+600000};}
    return original(method,data);
   };const {default:Panel}=await import('/frontend/features/tools/ToolPackagesPanel.tsx');window.renderWithProviders(window.React.createElement(Panel,{provider:'codex',onSelect(){}}));
  },{record,configuration});
  await page.getByLabel('已登记工具包',{exact:true}).selectOption(record.package_id);await page.getByLabel('已登记配置',{exact:true}).selectOption(configuration.configuration_id);await page.getByTestId('tool-configuration-activate').click();await page.getByTestId('tool-package-notice').getByText(/执行技能已生成/).waitFor();await page.getByRole('button',{name:'查看执行技能与指导范围',exact:true}).click();await page.getByTestId('tool-environment-findings').waitFor();await page.getByLabel('执行技能服务商',{exact:true}).selectOption('codex');await page.getByTestId('tool-execution-bind').click();await page.getByTestId('tool-package-notice').getByText(/已授权当前对话引用执行技能/).waitFor();await page.getByText('配置、修复或升级的指导授权',{exact:true}).click();await page.locator('.tool-guidance-resource input').check();assert.match(await page.getByTestId('tool-guidance-grant').innerText(),/本次委托/);await page.getByTestId('tool-guidance-grant').click();await page.getByTestId('tool-package-notice').getByText(/重启后保留/).waitFor();assert.match(await page.getByTestId('tool-package-notice').innerText(),/撤销/);await page.getByLabel('前置指导读取用途',{exact:true}).selectOption('update');assert.match(await page.getByTestId('tool-guidance-grant').innerText(),/限时/);await page.getByTestId('tool-guidance-grant').click();await page.getByTestId('tool-package-notice').getByText(/限时授权至/).waitFor();assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='tools.configurations.grant').length),2);assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='tools.configurations.execute'||call.method==='task.execute').length),0);
 });
 await check('continuous-work-app-run-details-retains-chat-until-associated-action',async page=>{
  const bundle=workflowRead({id:'attempt',taskId:'owner-task',workspaceId:'project'});
  await page.evaluate(bundle=>{
   const f=window.__test,original=window.studio.invoke,workerBinding={distribution:'Ubuntu',root:'/synthetic-worker',port:8767};
   const {workflow,execution}=bundle,step=execution.steps.at(-1);
   step.run_id=f.run.id;step.status='completed';step.run_status='succeeded';execution.status='completed';
   f.conversations=['current','owner'].map(id=>({id:'codex:'+id,provider:'codex',threadId:id,name:'Conversation '+id,projectId:'project',taskId:id==='owner'?'owner-task':null}));
   f.task={id:'owner-task',provider:'codex',threadId:'owner',name:'Associated workflow',workflowVersion:2,parameters:{engine:'pydyn.md'},steps:[],artifacts:[{kind:'run',id:f.run.id}],workspaceChoice:'workspace',workspace:{id:'project',root:'/fixture',workerBinding}};
   f.run={...f.run,status:'succeeded',studio_workflow_binding:{schema_version:1,workflow_id:workflow.id,execution_id:execution.id,step_id:step.id,snapshot_sha256:execution.snapshot_sha256,group_id:execution.group.id,group_version:execution.group.version,configuration_id:step.configuration_id,execution_skill_id:step.execution_skill_id,execution_skill_sha256:'c'.repeat(64)}};localStorage.setItem('studio.conversation','codex:current');
   window.studio.invoke=async(method,data)=>{
    if(method==='conversation.list')return f.conversations;if(method==='task.list')return [f.task];if(method==='compute.resource.status')return {schemaVersion:1,kind:null,status:'none',selectionId:null};
    if(method==='conversation.select'){f.calls.push({method,data});return f.conversations.find(value=>value.id===data.id);}if(method==='conversation.remember')return f.conversations.find(value=>value.threadId===data.threadId);
    if(method==='agent.rpc'&&['thread/resume','thread/read'].includes(data.method))return {model:'fixture-model',thread:{id:data.params.threadId,turns:[{items:[{id:'saved-'+data.params.threadId,type:'agentMessage',text:'History for '+data.params.threadId}]}]}};
    if(method==='tools.workflows.locateRun'){
     f.calls.push({method,data});if(f.missingWorkflowLocation)throw Error('Fixture workflow reference unavailable');
     return {task_id:'owner-task',provider:'codex',thread_id:'owner',conversation_id:'codex:owner',workspace_id:'project',workflow_id:workflow.id,execution_id:execution.id,step_id:step.id,run_id:f.run.id};
    }
    if(method==='tools.workflows.context')return {task_id:data.task_id,owner_key:'fixture-owner',workspace_id:'project',worker_binding:workerBinding,groups:[],configurations:[],creations:[],workflows:[{task_id:f.task.id,workspace_id:'project',execution_id:execution.id,group_id:execution.group.id,group_version:execution.group.version,name:workflow.name}]};
    if(method==='tools.workflows.read'){f.calls.push({method,data});return structuredClone(bundle);}
    return original(method,data);
   };return window.renderTest('App');
  },bundle);
  await page.getByText('History for current',{exact:true}).waitFor();await page.locator('.composer textarea').fill('Keep current unsent draft');await page.locator('[data-testid="navigate-runs"]:visible').click();await page.locator('.job-record-open').first().click();await page.getByTestId('tool-workflow-run-readonly').waitFor();assert.equal(await page.locator('.composer textarea').inputValue(),'Keep current unsent draft');assert.equal(await page.evaluate(()=>localStorage.getItem('studio.conversation')),'codex:current');assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='tools.workflows.locateRun').length),0);await page.screenshot({path:path.join(out,'continuous-app-run-details.png')});
  await page.getByTestId('open-tool-workflow-step').click();await page.getByText('History for owner',{exact:true}).waitFor();
  const workflowPage=page.getByTestId('agent-task-page'),returnToStep=workflowPage.getByTestId('open-tool-workflow-step');
  const step=page.locator('[data-testid="tool-workflow-step-step-2"][data-focused="true"]');await step.waitFor();
  assert.equal(await step.evaluate(element=>document.activeElement===element),true);
  assert.equal(await page.evaluate(()=>localStorage.getItem('studio.conversation')),'codex:owner');
  await returnToStep.click();await page.waitForFunction(()=>window.__test.calls.filter(c=>c.method==='tools.workflows.read').length===2);
  await page.waitForFunction(()=>document.activeElement?.id==='tool-flow-step-attempt-step-2');
  assert.equal(await page.evaluate(()=>localStorage.getItem('studio.section')),'agent-task:owner-task');
  await page.evaluate(()=>{window.__test.missingWorkflowLocation=true;});await returnToStep.click();
  await page.getByTestId('diagnostic-notice').filter({hasText:'Fixture workflow reference unavailable'}).waitFor();
  const calls=await page.evaluate(()=>window.__test.calls);
  assert.deepEqual(calls.filter(c=>c.method==='tools.workflows.locateRun').map(c=>c.data),[{run_id:'run'},{run_id:'run'},{run_id:'run'}]);
  assert.deepEqual(calls.filter(c=>c.method==='tools.workflows.read').map(c=>c.data),[{task_id:'owner-task',execution_id:'attempt'},{task_id:'owner-task',execution_id:'attempt'}]);
  assert.equal(await page.evaluate(()=>localStorage.getItem('studio.section')),'agent-task:owner-task');
  assert(!calls.some(c=>c.method==='task.execute'||c.method==='worker.request'&&/\/(?:submit|resume|cancel)$/.test(c.data.target)));
 });
 for(const theme of ['dark','light'])await check('continuous-work-resume-repair-modal-'+theme,async page=>{
  let nativeDialogs=0;page.on('dialog',async dialog=>{nativeDialogs++;await dialog.dismiss();});
  await page.evaluate(async theme=>{
   const {setLanguage}=await import('/frontend/ui/i18n.ts');setLanguage(theme==='light'?'en':'zh-CN');
   document.documentElement.dataset.theme=theme;
   localStorage.setItem('studio.resume.run','{malformed');localStorage.setItem('studio.resume.other','keep this record');
   return window.renderTest('RunDetail',{run:{...window.__test.run,status:'failed'},onRefresh:()=>{},onError:()=>{}});
  },theme);
  const english=theme==='light',clearLabel=english?'Checked; clear damaged record':'已核对，清除损坏记录',open=page.getByRole('button',{name:clearLabel,exact:true});
  const dialog=page.getByRole('dialog',{name:english?'Clear damaged local continuation record':'清除损坏的本地续算记录'});
  await open.click();await dialog.waitFor();
  assert.match(await dialog.innerText(),/Fixture run · run/);assert.equal(await dialog.evaluate(node=>node.closest('html').dataset.theme),theme);
  await page.waitForFunction(expected=>document.activeElement?.textContent===expected,english?'Cancel':'取消');
  await page.screenshot({path:path.join(out,'continuation-repair-'+theme+'.png')});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  assert.equal(await open.evaluate(node=>document.activeElement===node),true);
  assert.equal(await page.evaluate(()=>localStorage.getItem('studio.resume.run')),'{malformed');
  await open.click();await dialog.getByRole('button',{name:clearLabel,exact:true}).click();await dialog.waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>[localStorage.getItem('studio.resume.run'),localStorage.getItem('studio.resume.other')]),[null,'keep this record']);
  assert.equal(await page.getByRole('button',{name:english?'Continue':'续算',exact:true}).isEnabled(),true);
  assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.data?.target==='/api/run/resume').length),0);assert.equal(nativeDialogs,0);
 });
  await check('continuous-work-resume-repair-closes-when-narrow-layout-hides-workspace',async page=>{
   await page.setViewportSize({width:640,height:800});
   await page.evaluate(()=>{
    window.__test.run={...window.__test.run,status:'failed'};
    localStorage.setItem('studio.section','runs');
    localStorage.setItem('studio.resume.run','{malformed');
    return window.renderTest('App');
   });
   await page.locator('[data-job-key="local:run"] .job-record-open').click();
   const open=page.getByRole('button',{name:'已核对，清除损坏记录',exact:true});
   await open.waitFor();
   await page.getByTestId('show-agent').click();
   const composer=page.locator('.agent-panel .composer textarea');
   await composer.waitFor();
   await open.waitFor({state:'hidden'});
   await page.setViewportSize({width:1100,height:800});
   await open.click();
   const dialog=page.locator('.run-detail [role="dialog"]');
   await dialog.waitFor();
   assert.match(await dialog.innerText(),/Fixture run · run/);
   await page.setViewportSize({width:640,height:800});
   await dialog.waitFor({state:'detached'});
   await composer.focus();
   assert.equal(await composer.evaluate(node=>document.activeElement===node),true);
   await page.keyboard.type('Keep this conversation draft');
   assert.equal(await composer.inputValue(),'Keep this conversation draft');
   await page.screenshot({path:path.join(out,'continuation-repair-narrow-conversation.png')});
   await page.setViewportSize({width:1100,height:800});
   await open.waitFor();
   assert.equal(await dialog.count(),0);
   assert.equal(await page.evaluate(()=>localStorage.getItem('studio.resume.run')),'{malformed');
   assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.data?.target==='/api/run/resume').length),0);
  });
 await check('continuous-work-embedded-run-without-workflow-navigator',async page=>{
  await page.evaluate(()=>{
   const f=window.__test;f.run={...f.run,status:'succeeded',studio_workflow_binding:{schema_version:1}};f.openedRuns=[];
   const task={id:'standalone-legacy-task',name:'Retained run',steps:[],parameters:{},artifacts:[{kind:'run',id:f.run.id,name:'Open retained computation'}]};
   return window.renderTest('AgentTaskPage',{task,worker:true,environments:[f.environment],onRun:id=>f.openedRuns.push(id),onError:()=>{},onRefresh:()=>{}});
  });
  const history=page.getByTestId('workflow-run-history');await history.getByTestId('tool-workflow-run-readonly').waitFor();
  assert.equal(await history.getByTestId('open-tool-workflow-step').count(),0);
  await page.getByText('模块草稿与输入记录',{exact:false}).click();await page.getByRole('button',{name:'Open retained computation'}).click();
  assert.deepEqual(await page.evaluate(()=>window.__test.openedRuns),['run']);
 });
 for(const theme of ['dark','light'])await check('continuous-work-history-anchor-replay-'+theme,async page=>{
  await page.evaluate(async theme=>{
   document.documentElement.dataset.theme=theme;const root=document.getElementById('root');root.className='application';root.style.cssText='height:100vh;display:flex;flex-direction:row;justify-content:center;align-items:stretch';
   const f=window.__test,original=window.studio.invoke;f.chat=id=>({id:'codex:'+id,provider:'codex',threadId:id,name:'Saved conversation '+id,projectId:null,taskId:null});
   window.studio.invoke=async(method,data)=>{if(method==='conversation.remember')return f.chat(data.threadId);if(method==='agent.rpc'&&data.method==='thread/resume')return {thread:{id:data.params.threadId},model:'fixture-model'};if(method==='agent.rpc'&&data.method==='thread/read')return {thread:{id:data.params.threadId,turns:[{items:[...Array.from({length:50},(_,i)=>({id:data.params.threadId+'-'+i,type:'agentMessage',text:'Saved message '+i+'\n\nThe calculation inputs and observations stay available while you read earlier work.'})),{id:'command',type:'commandExecution',command:'python check_inputs.py',aggregatedOutput:'Input shape mismatch',exitCode:1,status:'completed'},{id:'change',type:'fileChange',status:'completed',changes:[{path:'input.py',diff:'-old\n+fixed',kind:{type:'update'}}]}]}]}};return original(method,data);};
   window.chatProps={width:480,planningMode:false,onPlanningModeChange(){},context:'{}',onError:error=>{throw error;},sessionSelection:{nonce:'a',conversation:f.chat('a')}};window.renderChat=value=>window.renderTest('Agent',window.chatProps={...window.chatProps,...value});return window.renderChat({});
  },theme);
  const tools=page.getByTestId('tool-group').filter({has:page.locator('[data-message-id="change"]')});
  await tools.locator(':scope > summary').press('Enter');
  await page.locator('[data-message-id="change"]').waitFor();assert.match(await page.locator('[data-message-id="command"]').innerText(),/命令执行失败/);assert.match(await page.locator('[data-message-id="change"]').innerText(),/文件修改完成/);
  await page.locator('.composer textarea').fill('Keep draft for A');await page.evaluate(()=>{const scroll=document.querySelector('.chat-scroll');scroll.scrollTop=540;scroll.dispatchEvent(new Event('scroll'));window.__test.readingTop=scroll.scrollTop;});
  await page.evaluate(()=>window.renderChat({sessionSelection:{nonce:'b',conversation:window.__test.chat('b')}}));await page.locator('[data-message-id="b-49"]').waitFor();await page.locator('.composer textarea').fill('Keep draft for B');await page.evaluate(()=>window.renderChat({sessionSelection:{nonce:'a-return',conversation:window.__test.chat('a')}}));await page.locator('[data-message-id="a-49"]').waitFor();
  assert.equal(await page.locator('.composer textarea').inputValue(),'Keep draft for A');const position=await page.evaluate(()=>({top:document.querySelector('.chat-scroll').scrollTop,want:window.__test.readingTop}));assert(Math.abs(position.top-position.want)<=2,JSON.stringify(position));
  await page.evaluate(()=>window.renderChat({hidden:true}));await page.locator('.agent-panel').waitFor({state:'hidden'});await page.evaluate(()=>window.renderChat({hidden:false}));await page.locator('.agent-panel').waitFor({state:'visible'});assert.equal(await page.locator('.composer textarea').inputValue(),'Keep draft for A');await page.screenshot({path:path.join(out,'continuous-history-'+theme+'.png')});assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='agent.rpc'&&call.data.method==='turn/start').length),0);
 });

 for(const status of ['not_run','stale','unknown','consumer'])await check('continuous-work-deployment-'+status,async page=>{
  await page.evaluate(async status=>{
   const f=window.__test,original=window.studio.invoke;f.task={id:'continuous',name:'Continuous exploration',workflowVersion:2,parameters:{engine:'pydyn.md'},parameterRevision:3,review:{status:status==='stale'?'ready':'not_run',parameterRevision:1},deployment:{revision:2,config:{target:'local',projectId:'project',targetId:'env',inputSource:'local',directoryName:'attempt',gpu:0,maxSeconds:60,resources:{cpus:1,gpus:1,memory_mb:1024,queue:'',account:''}}},...(status==='unknown'?{execution:{phase:'unknown',artifactId:'old-run'}}:{})};
   if(status==='consumer'){f.task.provider='codex';f.task.threadId='consumer';f.task.parameters.engine='bias.validate';f.project.policy.engines=['bias.validate'];}
   window.studio.invoke=async(method,data)=>{
    if(status==='consumer'&&method==='task.localReview.status')return {taskId:f.task.id,parameterRevision:3,provider:'codex',threadId:'consumer',status:'current',scope:'local',authority:{kind:'local-human',id:'local-review',sha256:'b'.repeat(64)}};
    if(status==='consumer'&&method==='task.consumerTarget.status')return {taskId:f.task.id,parameterRevision:3,deploymentRevision:2,status:'not_run'};
    if(method==='task.deployment.save'){f.calls.push({method,data});f.task={...f.task,deployment:{...f.task.deployment,config:data.value}};return f.task;}
    if(method==='task.deployment.prepare'){f.calls.push({method,data});f.prepared={...f.run,id:'new-attempt',status:'draft',snapshots:[{name:'run.py',sha256:'a'.repeat(64),size:42}]};f.task={...f.task,deployment:{...f.task.deployment,prepared:{artifactId:f.prepared.id,parameterRevision:3,deploymentRevision:2}}};const {snapshotIdentity}=await import('/contracts/compute/deployment.mjs');f.task.deployment.prepared.inputIdentity=snapshotIdentity(f.task,f.prepared);return f.prepared;}
    if(method==='task.execute'){f.calls.push({method,data});f.execution=data;return {...f.prepared,status:'queued'};}
    if(method==='task.linkRun')return f.task;
    if(method==='worker.request'&&data.target==='/api/run/status'&&f.prepared)return f.prepared;
    return original(method,data);
   };
   window.deployProps={task:f.task,worker:true,projects:[f.project],environments:[f.environment],onTask(){},onRun(id){f.openedRun=id;},onError(error){f.error=String(error);},onRefresh:()=>window.renderTest('DeploymentPanel',{...window.deployProps,task:f.task})};return window.renderTest('DeploymentPanel',window.deployProps);
  },status);
  await page.getByTestId('deployment-review-advisory').waitFor();const execute=page.getByTestId('execute-deployment');await page.waitForFunction(()=>!document.querySelector('.deployment-settings').disabled);
  if(status==='unknown'){assert.equal(await execute.isDisabled(),true);await page.getByLabel('工作目录名',{exact:true}).fill('next-attempt');await page.waitForFunction(()=>window.__test.task.deploymentDraft?.config.directoryName==='next-attempt');assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='task.execute').length),0);}
  else{if(status==='consumer'){await page.getByTestId('deployment-target-advisory').waitFor();await page.getByTestId('consumer-target-review').waitFor();}assert.equal(await execute.isEnabled(),true);await execute.click();await page.waitForFunction(()=>window.__test.openedRun==='new-attempt');assert.match(await page.evaluate(()=>window.__test.execution.inputReceipt),/new-attempt/);assert.equal(await page.evaluate(()=>window.__test.task.review.parameterRevision),1);assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='task.execute').length),1);}
  await page.screenshot({path:path.join(out,'continuous-deployment-'+status+'.png')});
 });
}
