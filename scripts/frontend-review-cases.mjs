// Real renderer interaction with explicitly synthetic IPC. Never connects an engine.
import assert from 'node:assert/strict';
import path from 'node:path';

export async function frontendReviewCases({check,out}){
 const snapshot=(page,name)=>page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
 async function app(page){
  await page.evaluate(()=>{
   const original=window.studio.invoke;
   window.studio.invoke=async(method,data)=>{
    if(method==='compute.resource.status')return {schemaVersion:1,kind:'none',selectionId:null};
    if(method==='compute.profiles.list')return {profiles:[],defaults:{}};
    if(method==='sharedTerminal.list')return {sessions:[]};
    return original(method,data);
   };
   localStorage.setItem('studio.section','task:run');
   return window.renderTest('App');
  });
  await page.getByTestId('task-review').waitFor();
 }
 async function agent(page){
  await page.evaluate(()=>{
   document.getElementById('root').style.cssText='display:flex;height:100vh;justify-content:center;background:var(--bg);color:var(--text)';
   return window.renderTest('Agent',{width:620,planningMode:false,onPlanningModeChange:()=>{},context:'{}',onError:error=>{throw error;}});
  });
  await page.getByTestId('agent-connect').click();
  await page.locator('.composer textarea').fill('Synthetic renderer interaction only');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.waitForFunction(()=>window.__test.calls.some(call=>call.method==='agent.rpc'&&call.data.method==='turn/start'));
 }
 const noExecution=async page=>{
  const mutations=await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='task.execute'||call.method==='worker.request'&&/\/api\/run\/(submit|revise|validate|cancel)|\/api\/cluster\/submit/.test(call.data.target)));
  assert.deepEqual(mutations,[],'editing and observation must not dispatch run mutations');
 };

 await check('review-fixes-run-draft-navigation-offline-reload',async page=>{
  await app(page);
  await page.getByLabel('计算名称',{exact:true}).fill('Unsubmitted local review');
  await page.locator('[data-field="temperature"] input').fill('325');
  await page.getByTestId('navigate-runs').click();
  await page.locator('.job-record-open').filter({hasText:'Fixture run'}).click();
  await page.getByTestId('task-review').waitFor();
  assert.equal(await page.getByLabel('计算名称',{exact:true}).inputValue(),'Unsubmitted local review');
  assert.equal(await page.locator('[data-field="temperature"] input').inputValue(),'325');
  await page.evaluate(()=>{window.__test.offline=true;});
  await page.getByTestId('run-record-unavailable').waitFor({timeout:8000});
  await page.evaluate(()=>{window.__test.offline=false;});
  await page.getByRole('button',{name:'同步记录',exact:true}).click();
  await page.getByTestId('task-review').waitFor();
  assert.equal(await page.getByLabel('计算名称',{exact:true}).inputValue(),'Unsubmitted local review');
  await page.reload();await page.waitForFunction(()=>window.renderTest);await app(page);
  assert.equal(await page.getByLabel('计算名称',{exact:true}).inputValue(),'Unsubmitted local review');
  assert.equal(await page.locator('[data-field="temperature"] input').inputValue(),'325');
  assert.match(await page.getByTestId('task-review').innerText(),/尚未提交/);
  await noExecution(page);await snapshot(page,'review-fixes-retained-draft');
 });

 await check('review-fixes-run-draft-worker-scope-and-discard',async page=>{
  await page.evaluate(async()=>{
   const Review=(await import('/frontend/features/runs/RunReview.tsx')).default;
   window.renderReview=scope=>window.testRoot.render(React.createElement(Review,{key:scope,run:window.__test.run,draftScope:scope,environments:[window.__test.environment],theme:'dark',onRefresh:()=>{},onError:error=>{throw error;},onReplace:()=>{}}));
   window.renderReview('synthetic-worker-a');
  });
  await page.getByLabel('计算名称',{exact:true}).fill('Only worker A');
  await page.evaluate(()=>window.renderReview('synthetic-worker-b'));
  await page.waitForFunction(()=>document.querySelector('[data-testid="task-review"] input')?.value==='Fixture run');
  await page.evaluate(()=>window.renderReview('synthetic-worker-a'));
  await page.waitForFunction(()=>document.querySelector('[data-testid="task-review"] input')?.value==='Only worker A');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:/丢弃本地草稿/}).click();
  assert.equal(await page.getByLabel('计算名称',{exact:true}).inputValue(),'Fixture run');
  await noExecution(page);
 });

 await check('review-fixes-assets-late-preview-and-input-invalidation',async page=>{
  await page.evaluate(async()=>{
   const Inspector=(await import('/frontend/features/assets/AssetInspector.tsx')).default,test=window.__test,original=window.studio.invoke;
   test.inspectWaiters=[];test.assetSaves=0;
   window.studio.invoke=async(method,data)=>{
    if(method==='worker.request'&&data.target==='/api/inspect')return new Promise(resolve=>test.inspectWaiters.push({resolve,input:data.data}));
    return original(method,data);
   };
   test.structure=count=>({n_atoms:count,positions:Array.from({length:count},(_,i)=>[i,0,0]),symbols:Array(count).fill('Cu'),cell:[[10,0,0],[0,10,0],[0,0,10]]});
   window.renderInspector=(workerScope='synthetic-worker-a',projectId='project')=>window.testRoot.render(React.createElement(Inspector,{worker:true,workerScope,projectId,environments:[test.environment],onSaved:()=>test.assetSaves++,onError:error=>{throw error;}}));
   window.renderInspector();
  });
  assert.equal(await page.getByTestId('asset-preview').isDisabled(),true);
  await page.getByTestId('asset-environment').selectOption('env');
  await page.getByTestId('asset-path').fill('/fixture/first.xyz');await page.getByTestId('asset-preview').click();
  await page.getByTestId('asset-path').fill('/fixture/latest.xyz');await page.getByTestId('asset-frame').fill('2');
  await page.getByTestId('asset-preview').click();
  await page.waitForFunction(()=>window.__test.inspectWaiters.length===2);
  await page.evaluate(()=>window.__test.inspectWaiters[1].resolve(window.__test.structure(3)));
  await page.getByTestId('asset-preview-result').waitFor();
  await page.waitForFunction(()=>/\b3\b/.test(document.querySelector('[data-testid="asset-preview-result"] .chart-note')?.textContent||''));
  await page.evaluate(()=>window.__test.inspectWaiters[0].resolve(window.__test.structure(1)));
  await page.waitForTimeout(100);
  assert.match(await page.getByTestId('asset-preview-result').innerText(),/latest\.xyz/);
  assert.match(await page.locator('[data-testid="asset-preview-result"] .chart-note').innerText(),/\b3\b/);
  await snapshot(page,'review-fixes-current-asset-preview');
  await page.getByTestId('asset-frame').fill('3');
  assert.equal(await page.getByTestId('asset-preview-result').count(),0);
  await page.getByTestId('asset-preview').click();
  await page.evaluate(()=>window.renderInspector('synthetic-worker-b','other-project'));
  await page.evaluate(()=>window.__test.inspectWaiters[2].resolve(window.__test.structure(7)));
  await page.waitForTimeout(100);assert.equal(await page.getByTestId('asset-preview-result').count(),0);
  await noExecution(page);
 });

 await check('review-fixes-assets-registration-is-not-current-after-input-change',async page=>{
  await page.evaluate(async()=>{
   const Inspector=(await import('/frontend/features/assets/AssetInspector.tsx')).default,test=window.__test,original=window.studio.invoke;
   test.assetSaves=0;
   window.studio.invoke=async(method,data)=>method==='worker.request'&&data.target==='/api/assets'&&data.method==='POST'?new Promise(resolve=>{test.finishRegistration=resolve;}):original(method,data);
   window.testRoot.render(React.createElement(Inspector,{worker:true,workerScope:'synthetic-worker',projectId:'project',environments:[test.environment],onSaved:()=>test.assetSaves++,onError:error=>{throw error;}}));
  });
  await page.getByTestId('asset-environment').selectOption('env');await page.getByTestId('asset-path').fill('/fixture/registered.xyz');
  await page.getByTestId('asset-register').click();await page.waitForFunction(()=>typeof window.__test.finishRegistration==='function');
  assert.equal(await page.getByTestId('asset-register').isDisabled(),true);
  await page.getByTestId('asset-path').fill('/fixture/different.xyz');
  assert.match(await page.getByTestId('asset-stale-status').innerText(),/仍可能完成/);
  await page.evaluate(()=>window.__test.finishRegistration({name:'registered.xyz',status:'passed'}));
  await page.waitForTimeout(100);assert.equal(await page.getByTestId('asset-register-result').count(),0);
  assert.equal(await page.evaluate(()=>window.__test.assetSaves),0);
  await noExecution(page);await snapshot(page,'review-fixes-stale-registration');
 });

 await check('review-fixes-tool-approval-arguments',async page=>{
  await agent(page);
  await page.evaluate(()=>{
   const test=window.__test,original=window.studio.invoke;
   window.studio.invoke=async(method,data)=>{
    if(method==='agent.respond'){test.calls.push({method,data});return {};}
    return original(method,data);
   };
   test.events.forEach(fn=>fn({provider:'codex',id:'review-tool-call',method:'mcpServer/elicitation/request',
    params:{threadId:'fixture-thread',mode:'form',serverName:'gpusampling',message:'Allow acquire_compute_resource?',
     requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call',
      tool_params:{resource_id:'ssh:fixture-east',access:'service'}}}}));
  });
  const card=page.locator('[data-testid="agent-question-request"][data-request-id="review-tool-call"]');
  const args=card.getByTestId('approval-tool-input');
  await args.waitFor();
  assert.deepEqual(JSON.parse(await args.innerText()),{resource_id:'ssh:fixture-east',access:'service'});
  assert.equal(await card.locator('textarea').count(),0);
  await snapshot(page,'review-fixes-tool-approval-arguments');
  await card.getByRole('button',{name:'拒绝',exact:true}).click();
  await card.waitFor({state:'hidden'});
  const responses=await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='agent.respond'));
  assert.deepEqual(responses.map(call=>call.data.result),[{action:'decline',content:null}]);
 });

 await check('review-fixes-chat-stream-preserves-reading-position',async page=>{
  await agent(page);
  await page.evaluate(()=>{for(let i=0;i<45;i++)window.__test.events.forEach(fn=>fn({provider:'codex',method:'item/agentMessage/delta',params:{threadId:'fixture-thread',itemId:'history-'+i,delta:'Synthetic history '+i+'\n'+('Readable historical text. '.repeat(15))}}));});
  const scroll=page.locator('.chat-scroll');
  await page.waitForFunction(()=>{const node=document.querySelector('.chat-scroll');return node&&node.scrollHeight>node.clientHeight+1000&&node.scrollHeight-node.clientHeight-node.scrollTop<80;});
  await scroll.hover();await page.mouse.wheel(0,-1800);
  await page.waitForFunction(()=>{const node=document.querySelector('.chat-scroll');return node.scrollHeight-node.clientHeight-node.scrollTop>1000;});
  const position=await scroll.evaluate(node=>node.scrollTop);
  await page.evaluate(()=>window.__test.events.forEach(fn=>fn({provider:'codex',method:'item/agentMessage/delta',params:{threadId:'fixture-thread',itemId:'latest-stream',delta:'A new synthetic message arrived.'}})));
  await page.getByTestId('agent-new-messages').waitFor();
  assert(Math.abs((await scroll.evaluate(node=>node.scrollTop))-position)<5,'new streamed text must not move an upward-scrolled reader');
  await snapshot(page,'review-fixes-chat-new-message-indicator');
  await page.getByTestId('agent-new-messages').click();
  await page.waitForFunction(()=>{const node=document.querySelector('.chat-scroll');return node.scrollHeight-node.clientHeight-node.scrollTop<80;});
  await noExecution(page);
 });

 await check('review-fixes-questions-isolated-selectable-secret-and-pending',async page=>{
  await agent(page);
  await page.setViewportSize({width:420,height:640});
  await page.evaluate(()=>{
   document.querySelector('.agent-panel').style.width='min(100%, 360px)';
   const test=window.__test,original=window.studio.invoke;test.answerWaiters=[];
   window.studio.invoke=async(method,data)=>{if(method==='agent.respond'){test.calls.push({method,data});return new Promise(resolve=>test.answerWaiters.push(resolve));}return original(method,data);};
   test.question=id=>({provider:'codex',id,method:'item/tool/requestUserInput',params:{threadId:'fixture-thread',questions:[{id:'same-choice',header:'策略',question:'选择测试策略',isSecret:false,isOther:true,options:[{label:'只检查界面（推荐）',description:'使用隔离数据检查页面交互'},{label:'检查布局',description:'只查看当前布局'}]},{id:'same-secret',header:'私密值',question:'输入测试私密值',isSecret:true,isOther:false,options:null}]}});
   test.events.forEach(fn=>fn(test.question('first-question')));
  });
  const first=page.locator('.composer').getByTestId('agent-question-request').first();
  const choice=first.getByRole('radio',{name:/只检查界面/});
  assert.equal(await choice.getAttribute('data-highlighted'),'true');
  assert.equal(await choice.getAttribute('aria-checked'),'false');
  assert.match(await choice.innerText(),/推荐/);
  assert.equal(await page.locator('.agent-composer-questions').evaluate(node=>node.scrollWidth<=node.clientWidth),true);
  assert.match(await first.innerText(),/使用隔离数据检查页面交互/);
  await choice.click();
  await first.locator('input[type="password"]').waitFor();
  assert.equal(await first.getByTestId('agent-question-count').innerText(),'2 / 2');
  assert.equal(await first.getByRole('radio').count(),0);
  await first.locator('input[type="password"]').fill('synthetic-private-value');
  await first.getByTestId('agent-question-submit').click();
  await page.waitForFunction(()=>window.__test.answerWaiters.length===1);
  assert.equal(await first.getByTestId('agent-question-submit').isDisabled(),true);
  await page.evaluate(()=>window.__test.events.forEach(fn=>fn(window.__test.question('second-question'))));
  const second=page.locator('[data-testid="agent-question-request"][data-request-id="second-question"]');
  assert.equal(await second.count(),0);
  await page.evaluate(()=>window.__test.answerWaiters[0]({}));
  await second.waitFor();
  assert.equal(await second.getByTestId('agent-question-input').inputValue(),'');
  await second.getByRole('radio').first().press('2');
  await second.locator('input[type="password"]').waitFor();
  assert.equal(await second.locator('input[type="password"]').inputValue(),'');
  const response=await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='agent.respond'));
  assert.equal(response.length,1);assert.deepEqual(response[0].data.result.answers,{'same-choice':{answers:['只检查界面（推荐）']},'same-secret':{answers:['synthetic-private-value']}});
  assert.equal(await page.evaluate(()=>Object.values(localStorage).some(value=>value.includes('synthetic-private-value'))),false);
  await snapshot(page,'review-fixes-question-controls');
  await page.evaluate(()=>window.__test.events.forEach(fn=>fn({provider:'codex',method:'serverRequest/resolved',params:{threadId:'fixture-thread',requestId:'second-question'}})));
  await page.waitForFunction(()=>document.querySelectorAll('[data-testid="agent-question-request"]').length===0);
  await noExecution(page);
 });

 await check('review-fixes-resource-tool-setup-and-explicit-review',async page=>{
  await page.setViewportSize({width:630,height:720});
  await page.evaluate(async()=>{
   const tool=window.__test,original=window.studio.invoke;
   const Component=(await import('/frontend/features/tools/ResourceToolSetup.tsx')).default;
   const resource_id='ssh:site-account-a',target={project_id:'fixture-project',cluster_id:'fixture-cluster',environment_id:'fixture-env',queue_target_id:'fixture-queue',queue:'short',scheduler:'slurm'};
   const manifest={id:'demo-analysis',name:'Analysis demo',version:'1.2.3',source:{kind:'installed',executable:'/project/existing/analyze.sh'},interpreter:'bash',argv:['{output:result}'],inputs:{},outputs:{result:{filename:'summary.txt',format:'text'}},test:{inputs:{},max_seconds:120}};
   const planned={id:'agent-plan',resource_id,workspace_id:'fixture-workspace',route:'custom',status:'planned',stage:'review',revision:2,plan_sha256:'a'.repeat(64),manifest,target,install_root:'/project/fixture/AIMatterLab/software/demo-analysis',activity:[]};
   tool.toolSetups=[];tool.toolDiscussions=[];
   window.studio.invoke=async(method,data)=>{
    if(!method.startsWith('tools.resource.'))return original(method,data);
    tool.calls.push({method,data});
    if(data.resource_id!==resource_id||data.profile_version!==7)throw Error('Tool setup used a different saved profile');
    if(method==='tools.resource.list')return {setups:tool.toolSetups,targets:[target]};
    if(method==='tools.resource.discover')return {directory:data.directory,truncated:false,candidates:[{id:'script',tool:'Analysis',path:'/project/existing/analyze.sh',sha256:'b'.repeat(64),environment:['module load fixture'],evidence:['source directive'],examples:['/project/existing/analyze.sh'],scheduler:'slurm',count:1}]};
    if(method==='tools.resource.chooseSource')return data.kind==='manual'?{kind:'manual',name:'fixture-guide.txt',size:12,sha256:'d'.repeat(64),text:'Fixture usage'}:{kind:'program',name:'fixture-program.sh',size:15,sha256:'e'.repeat(64),text:'#!/bin/sh\nexit 0',local_source:'fixture-local-source-token'};
    if(method==='tools.resource.start')return {...planned,status:'active',stage:'active',revision:3,test:{run_id:'fixture-run',job_id:'42',status:'succeeded',outputs:{}},skill:{name:'analysis-demo',status:'saved',sha256:'c'.repeat(64),body:'# Verified fixture skill'}};
    throw Error('Unexpected tool setup call '+method);
   };
   tool.openToolSetup=(resume=false)=>{
    if(resume)tool.toolSetups=[planned];
    document.documentElement.dataset.theme='light';
    window.testRoot.render(React.createElement(Component,{key:String(resume),resourceId:resource_id,profileVersion:7,resourceName:'Same-name fixture',onDiscuss:value=>tool.toolDiscussions.push(value),onClose:()=>{},...(resume?{initialRoute:'custom',newPlanAfter:[]}:{})}));
   };
   tool.openToolSetup();
  });
  await page.getByTestId('resource-tool-fresh').click();
  assert.equal(await page.getByTestId('resource-tool-argv').isVisible(),false);
  await page.getByTestId('resource-tool-description').fill('I need Demo version 1.2.3');
  await page.getByTestId('resource-tool-discuss').click();
  assert.equal(await page.evaluate(()=>window.__test.toolDiscussions[0].target.queue_target_id),'fixture-queue');
  await page.getByTestId('resource-tool-existing').click();
  await page.getByTestId('resource-tool-scan-path').fill('/project/existing');
  await page.getByTestId('resource-tool-scan').click();
  await page.getByTestId('resource-tool-candidate').check();
  await page.getByTestId('resource-tool-discuss').click();
  assert.equal(await page.evaluate(()=>window.__test.toolDiscussions.at(-1).candidate.path),'/project/existing/analyze.sh');
  await page.getByTestId('resource-tool-custom').click();
  await page.getByTestId('resource-tool-choose-program').click();
  await page.getByTestId('resource-tool-choose-manual').click();
  await page.getByTestId('resource-tool-discuss').click();
  const draft=await page.evaluate(()=>window.__test.toolDiscussions.at(-1));
  assert.match(draft.description,/Fixture usage/);assert.equal(draft.source.name,'fixture-program.sh');assert.equal(draft.source.local_source,undefined);
  await page.evaluate(()=>window.__test.openToolSetup(true));
  const receipt=page.getByTestId('resource-tool-receipt');
  await receipt.waitFor();
  assert.match(await receipt.innerText(),/fixture-env · slurm short/);
  assert.match(await receipt.innerText(),/summary.txt/);
  assert.deepEqual(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='tools.resource.start')),[]);
  await page.getByTestId('resource-tool-start').click();
  await page.getByTestId('resource-tool-skill').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='tools.resource.start').map(call=>call.data)),[{resource_id:'ssh:site-account-a',profile_version:7,setup_id:'agent-plan',revision:2,plan_sha256:'a'.repeat(64)}]);
  await page.getByTestId('resource-tool-skill-content').locator('summary').click();
  assert.match(await receipt.innerText(),/Verified fixture skill/);
  await noExecution(page);
 });

 await check('review-fixes-terminal-workspace-approval-in-composer',async page=>{
  await agent(page);
  await page.evaluate(()=>{
   const test=window.__test,original=window.studio.invoke;
   test.approval={approvalId:'fixture-authorization',provider:'codex',threadId:'fixture-thread',resourceName:'Selected fixture resource',connectionId:'exact-id',workspaceRoot:'/authorized',cwd:'/outside',commands:['printf fixture > /outside/new'],paths:['/outside/new'],reason:'outside_workspace',expiresAt:Date.now()+12000};
   window.studio.invoke=async(method,data)=>{
    if(method==='compute.terminalApproval.pending')return test.approval;
    if(method==='compute.terminalApproval.decide'){test.calls.push({method,data});test.approval=null;return {status:data.decision==='approve'?'approved':'denied'};}
    return original(method,data);
   };
   test.events.forEach(notify=>notify({method:'studio/terminalApprovalChanged'}));
  });
  const card=page.locator('.composer').getByTestId('terminal-workspace-approval');
  await card.waitFor();
  assert.match(await card.innerText(),/Selected fixture resource/);
  assert.match(await card.innerText(),/\/authorized/);
  assert.match(await card.innerText(),/printf fixture > \/outside\/new/);
  assert.deepEqual(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='compute.terminalApproval.decide')),[]);
  await card.getByTestId('terminal-workspace-deny').click();
  await card.waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='compute.terminalApproval.decide').map(call=>call.data)),[{approvalId:'fixture-authorization',decision:'deny'}]);
  await noExecution(page);
 });
}
