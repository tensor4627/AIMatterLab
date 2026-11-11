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
  await page.waitForFunction(()=>document.querySelector('[data-testid="asset-preview-result"] .chart-note')?.textContent.startsWith('3'));
  await page.evaluate(()=>window.__test.inspectWaiters[0].resolve(window.__test.structure(1)));
  await page.waitForTimeout(100);
  assert.match(await page.getByTestId('asset-preview-result').innerText(),/latest\.xyz/);
  assert.match(await page.locator('[data-testid="asset-preview-result"] .chart-note').innerText(),/^3/);
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
  await page.evaluate(()=>{
   const test=window.__test,original=window.studio.invoke;test.answerWaiters=[];
   window.studio.invoke=async(method,data)=>{if(method==='agent.respond'){test.calls.push({method,data});return new Promise(resolve=>test.answerWaiters.push(resolve));}return original(method,data);};
   test.question=id=>({provider:'codex',id,method:'item/tool/requestUserInput',params:{threadId:'fixture-thread',questions:[{id:'same-choice',header:'策略',question:'选择测试策略',isSecret:false,isOther:true,options:[{label:'只检查界面',description:'使用隔离数据检查页面交互'},{label:'检查布局',description:'只查看当前布局'}]},{id:'same-secret',header:'私密值',question:'输入测试私密值',isSecret:true,isOther:false,options:null}]}});
   test.events.forEach(fn=>fn(test.question('first-question')));
  });
  const first=page.getByTestId('agent-question-request').filter({has:page.locator('[data-testid="agent-question-input"]')}).first();
  await first.getByTestId('agent-question-option').filter({hasText:'只检查界面'}).click();
  assert.equal(await first.getByTestId('agent-question-option').filter({hasText:'只检查界面'}).getAttribute('aria-pressed'),'true');
  assert.match(await first.innerText(),/使用隔离数据检查页面交互/);
  await first.locator('input[type="password"]').fill('synthetic-private-value');
  await first.getByTestId('agent-question-submit').click();
  await page.waitForFunction(()=>window.__test.answerWaiters.length===1);
  assert.equal(await first.getByTestId('agent-question-submit').isDisabled(),true);
  await page.evaluate(()=>window.__test.events.forEach(fn=>fn(window.__test.question('second-question'))));
  const second=page.locator('[data-testid="agent-question-request"][data-request-id="second-question"]');
  await second.waitFor();
  assert.deepEqual(await second.getByTestId('agent-question-input').evaluateAll(nodes=>nodes.map(node=>node.value)),['','']);
  await second.locator('input[type="password"]').fill('second-synthetic-value');
  await page.evaluate(()=>window.__test.answerWaiters[0]({}));
  await page.waitForFunction(()=>document.querySelectorAll('[data-testid="agent-question-request"]').length===1);
  assert.equal(await second.locator('input[type="password"]').inputValue(),'second-synthetic-value');
  const response=await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='agent.respond'));
  assert.equal(response.length,1);assert.deepEqual(response[0].data.result.answers,{'same-choice':{answers:['只检查界面']},'same-secret':{answers:['synthetic-private-value']}});
  assert.equal(await page.evaluate(()=>Object.values(localStorage).some(value=>value.includes('synthetic-private-value'))),false);
  await snapshot(page,'review-fixes-question-controls');
  await page.evaluate(()=>window.__test.events.forEach(fn=>fn({provider:'codex',method:'serverRequest/resolved',params:{threadId:'fixture-thread',requestId:'second-question'}})));
  await page.waitForFunction(()=>document.querySelectorAll('[data-testid="agent-question-request"]').length===0);
  await noExecution(page);
 });
}
