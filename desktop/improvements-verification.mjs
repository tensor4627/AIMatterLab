import fs from 'node:fs';
import path from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function verifyDesktop(window,root,errors,hooks={}){
 const out=path.join(root,'.studio','validation'),report={scope:'Actual desktop typography, account query, central parameters and SSH review UI. No real remote jobs submitted.',packaged:hooks.packaged,checks:{},errors};
 const js=code=>window.webContents.executeJavaScript(code,true);
 const invoke=(method,data)=>js("window.studio.invoke("+JSON.stringify(method)+","+JSON.stringify(data||{})+")");
 const api=(method,target,data)=>invoke('worker.request',{method,target,data});
 async function wait(code,message){for(let i=0;i<300;i++){if(await js(code))return;await pause(200);}throw Error(message);}
 async function click(selector,label){await js("[...document.querySelectorAll("+JSON.stringify(selector)+")].find(e=>e.textContent.includes("+JSON.stringify(label)+")).click()");await pause(300);}
 async function input(selector,value,index=0){await js("(()=>{const e=document.querySelectorAll("+JSON.stringify(selector)+")["+index+"];const prototype=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()");await pause(250);}
 async function screenshot(name){window.webContents.invalidate?.();await pause(600);fs.writeFileSync(path.join(out,name),(await window.webContents.capturePage()).toPNG());}
 try{
  await pause(1200);report.checks.offlineRestore={errorToast:!!await js("document.querySelector('.toast')")};if(report.checks.offlineRestore.errorToast)throw Error('Restored page requested worker before connecting');await click('.nav-item','工作台');
  report.checks.renderer=await js("({node:typeof require,bridge:typeof window.studio.invoke})");if(report.checks.renderer.node!=='undefined')throw Error('Renderer boundary failed');
  await click('.sidebar-tools button','设置');await input('.settings-content input[type=number]','16',0);
  if(!await js("!!document.querySelector('[data-testid=minimum-font]')"))throw Error('Minimum font control missing');
  await input('[data-testid=minimum-font]','14');await click('.settings-footer button','保存设置');await click('.settings-footer button','关闭');
  report.checks.fonts=await js("({label:parseFloat(getComputedStyle(document.querySelector('.nav-label')).fontSize),caption:parseFloat(getComputedStyle(document.querySelector('.task-card span')).fontSize),usage:parseFloat(getComputedStyle(document.querySelector('.context-usage')).fontSize),footer:parseFloat(getComputedStyle(document.querySelector('.agent-footer')).fontSize)})");
  if(!Object.values(report.checks.fonts).every(v=>v>=17))throw Error('Small text did not scale');
  await screenshot('v0.5-fonts.png');
  await invoke('worker.connect');await pause(1000);
  if(await js("document.querySelector('[data-testid=agent-planning-mode]').checked"))throw Error('Planning enabled by default');
  await click('.agent-config button','连接');await wait("!!document.querySelector('.agent-config select')",'Agent connection unavailable');
  const before=(await invoke('task.list')).length;
  await input('.composer textarea','只回复 STUDIO_CHAT_MODE_OK，不调用任何工具。');await click('.composer .send','');
  await wait("document.querySelector('.chat-scroll')?.textContent.includes('STUDIO_CHAT_MODE_OK')&&!document.querySelector('.composer .send[title]')",'Chat mode did not complete');
  if((await invoke('task.list')).length!==before||await js("!!document.querySelector('.agent-task-page')"))throw Error('Chat opened a task');
  report.checks.chatMode={status:'passed',taskCreated:false};
  await js("document.querySelector('[data-testid=agent-planning-mode]').click()");await pause(250);
  await input('.composer textarea','用 present_task 一次将温度 345 K、检查结构与审阅参数两步流程、缺失 structure 和 potential 填入当前 studioTaskId。不要调用其他工具或执行计算。然后回复 STUDIO_PLAN_MODE_OK。');await click('.composer .send','');
  await wait("document.querySelector('.agent-task-page .parameter-json')?.value.includes('345')&&!document.querySelector('.composer .send[title]')",'Planning parameter handoff did not complete');
  report.checks.realPlanningMode={status:'passed',temperature:345,automaticPage:true};
  const afterPlan=(await invoke('task.list')).length;
  await js("document.querySelector('[data-testid=agent-planning-mode]').click()");await pause(250);await click('.nav-item','工作台');
  await input('.composer textarea','只回复 STUDIO_CHAT_RESUMED_OK，不调用任何工具。');await click('.composer .send','');
  await wait("document.querySelector('.chat-scroll')?.textContent.includes('STUDIO_CHAT_RESUMED_OK')&&!document.querySelector('.composer .send[title]')",'Return to chat did not complete');
  if((await invoke('task.list')).length!==afterPlan||await js("!!document.querySelector('.agent-task-page')"))throw Error('Old planning reopened during chat');
  report.checks.returnToChat={status:'passed',taskReopened:false};
  await js("document.querySelector('[data-testid=agent-planning-mode]').click()");await pause(250);
  const actual=JSON.parse(fs.readFileSync(path.join(out,'v0.4-codex-real.json'),'utf8'));if(actual.status!=='passed')throw Error('Real central task evidence unavailable');
  const task=await invoke('task.create',{planningMode:true,provider:'codex',request:'计算流程与参数审阅测试'});
  await wait("!!document.querySelector('[data-testid=agent-task-page]')",'Task intent did not open central page');
  hooks.taskAttach(task.id,'codex','ui-fixture');
  hooks.taskEvent({provider:'codex',method:'item/completed',params:{threadId:'ui-fixture',item:{result:{content:[{type:'text',text:JSON.stringify({id:task.id,kind:'task-parameters',name:'计算流程与参数审阅测试',steps:['检查输入结构','审阅参数后执行'],parameters:actual.checks.centralTask.parameters,missing_fields:['structure','potential']})}]}}}});
  await wait("document.querySelector('.agent-task-page .parameter-json')?.value.includes('300')",'Parameter page missing model result');
  report.checks.centralTask={autoOpened:true,steps:await js("document.querySelectorAll('.task-plan li').length"),temperature:300,source:'Real model parameters; simulated completion event in actual task index'};
  await screenshot('v0.5-task-parameters.png');
  await click('.nav-item','SSH');await wait("!!document.querySelector('[data-testid=cluster-settings]')",'Cluster settings absent');
  report.checks.clusterTabs=await js("[...document.querySelectorAll('.cluster-page .subtabs button')].map(e=>e.textContent)");
  if(report.checks.clusterTabs.length!==5)throw Error('Cluster settings tabs missing');
  const privacy=await js("({target:document.querySelectorAll('.cluster-page input[type=password]').length,importOptions:document.querySelectorAll('.cluster-selection select')[1].options.length})");
  if(privacy.target<2)throw Error('Private fields not masked');report.checks.connectionPrivacy=privacy;
  await click('.cluster-page .subtabs button','提交 Skill');await screenshot('v0.5-cluster-skill.png');
  const cluster=await api('POST','/api/clusters',{name:'界面验收 · 连接占位',scheduler:'lsf',target:'fixture@example.test',port:22,ssh_client:'/usr/bin/ssh',remote_root:'/tmp/gss-fixture',queue:'fixture',environment:{executables:{python:'/usr/bin/python3'}}});
  const project=await api('POST','/api/projects',{name:'界面验收 · 不提交',policy:{input_roots:['/tmp'],engines:['pydyn.md'],environments:[],clusters:[cluster.id]}});
  const source=await api('POST','/api/workspace/write',{project_id:project.id,name:'run.py',content:"print('UI_ONLY_NOT_SUBMITTED')"});
  const draft=await api('POST','/api/cluster/prepare',{spec:{project_id:project.id,cluster_id:cluster.id,engine:'pydyn.md',max_seconds:60,gpu:0,idempotency_key:'ui-'+Date.now(),inputs:{'run.py':source.path},parameters:{temperature:300},resources:{cpus:1,gpus:0,memory_mb:1024,queue:'fixture'},name:'界面验收 · 集群提交草稿'}});
  hooks.taskEvent({provider:'codex',method:'item/completed',params:{threadId:'ui-fixture',item:{result:{content:[{type:'text',text:JSON.stringify(draft)}]}}}});
  await wait("!!document.querySelector('.agent-task-page')",'Remote artifact routing failed');await click('.agent-task-page .tool-card','集群提交草稿');
  await wait("!!document.querySelector('[data-testid=cluster-review]')",'Remote review page absent');
  if(!await js("document.querySelector('.batch-script').textContent.includes('#BSUB')"))throw Error('Batch script absent');
  const remote=await api('POST','/api/cluster/status',{run_id:draft.id});
  if(remote.status!=='draft'||remote.job_id)throw Error('Unreviewed draft was submitted');
  report.checks.remoteReview={status:remote.status,jobId:remote.job_id,scriptVisible:true,scientificValidation:remote.scientific_validation.status,scope:'Synthetic connection, no SSH execution'};
  await screenshot('v0.5-cluster-review.png');
  await js("document.querySelector('.cluster-review input[type=checkbox]').click()");await pause(200);
  const revision=JSON.parse(await js("document.querySelector('.cluster-review .parameter-json').value"));
  await input('.cluster-review .parameter-json',JSON.stringify({...revision,resources:{...revision.resources,cpus:2}},null,2));
  await click('.cluster-review button','保存修订并预览脚本');
  await wait("document.querySelector('.batch-script')?.textContent.includes('#BSUB -n 2')",'Revised script not visible before submit');
  report.checks.remoteRevision={previewBeforeSubmit:true,cpus:2};
  await click('.agent-provider button','登录');await wait("!!document.querySelector('.provider-login')",'Account dialog absent');
  report.checks.loginMethods=await js("[...document.querySelector('.provider-login select').options].map(o=>o.value)");
  if(!report.checks.loginMethods.includes('chatgptDeviceCode'))throw Error('Device login missing');
  const account=await invoke('agent.account',{provider:'codex'});report.checks.actualAccount={status:account.account?'passed':'blocked',type:account.account?.type||null};if(!account.account)throw Error('Authenticated account unavailable');
  await js("document.querySelector('.modal>header button').click()");
  window.setSize(1100,720);await pause(400);report.checks.compact={overflow:await js("document.documentElement.scrollWidth>innerWidth")};if(report.checks.compact.overflow)throw Error('Large text horizontal overflow');
  await screenshot('v0.5-compact.png');report.status='passed';
 }catch(error){report.status='failed';report.reason=error.message;console.error(error.message);}
 finally{fs.writeFileSync(path.join(out,'v0.5-desktop.json'),JSON.stringify(report,null,2));}
 return report.status==='passed';
}
