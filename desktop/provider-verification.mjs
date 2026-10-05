import fs from 'node:fs';
import path from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function verifyDesktop(window,root,errors,hooks={}){
 const out=path.join(root,'.studio','validation');fs.mkdirSync(out,{recursive:true});
 const js=code=>window.webContents.executeJavaScript(code,true),report={scope:'Packaged UI, real ACP handshake and unauthenticated state; no provider model inference or scientific jobs',packaged:hooks.packaged,agentPaths:hooks.agentPaths,checks:{},errors};
 async function until(code,message,attempts=60){for(let i=0;i<attempts;i++){if(await js(code))return;await pause(250);}throw Error(message);}
 async function choose(selector,value){await js("(()=>{const e=document.querySelector("+JSON.stringify(selector)+");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event('change',{bubbles:true}));})()");await pause(200);}
 async function clickText(selector,text){await js("[...document.querySelectorAll("+JSON.stringify(selector)+")].find(e=>e.textContent.includes("+JSON.stringify(text)+")).click()");await pause(200);}
 try{
  if(hooks.packaged&&!Object.values(hooks.agentPaths).every(file=>file.includes('agent-runtimes')&&fs.existsSync(file)))throw Error('Packaged CLI missing or using development path');
  await pause(1200);await clickText('.nav-item','工作台');
  report.checks.renderer=await js("({node:typeof require,bridge:typeof window.studio.invoke})");
  if(report.checks.renderer.node!=='undefined')throw Error('Renderer exposes Node');
  report.checks.taskCards=await js("document.querySelectorAll('.task-card').length");
  if(report.checks.taskCards!==7)throw Error('Task cards incomplete');
  fs.writeFileSync(path.join(out,'v0.3-tasks.png'),(await window.webContents.capturePage()).toPNG());
  await clickText('.task-card','增强采样模拟');
  report.checks.steps=await js("[...document.querySelectorAll('.step-heading input')].map(e=>({required:e.disabled,enabled:e.checked}))");
  if(!report.checks.steps.every(s=>!s.required||s.enabled))throw Error('Missing core step');
  await choose('.workflow-step:nth-child(3) select','user');
  await js("(()=>{const e=document.querySelector('.workflow-step:nth-child(3) textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'asset-fixture-structure');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await pause(150);await clickText('.workflow-actions button','保存任务计划');
  const plans=await js("window.studio.invoke('workflow.list')"),plan=plans.find(p=>p.taskId==='sampling'&&p.steps.some(s=>s.value==='asset-fixture-structure'));
  if(!plan||plan.status!=='draft')throw Error('Plan persistence failed');
  report.checks.workflow={id:plan.id,status:plan.status,userInput:plan.steps.find(s=>s.id==='structure'),optionalLearning:plan.steps.find(s=>s.id==='learning').enabled};
  fs.writeFileSync(path.join(out,'v0.3-workflow.png'),(await window.webContents.capturePage()).toPNG());
  await clickText('.workflow-actions button','交给 Agent 准备');
  await until("document.querySelector('.composer textarea').value.includes('asset-fixture-structure')",'Plan missing from Agent composer');
  const prompt=await js("document.querySelector('.composer textarea').value");
  if(!prompt.includes('停止等待'))throw Error('Review gate missing from plan handoff');
  report.checks.handoff={promptPrepared:true,autoSubmitted:false};
  await clickText('.sidebar-tools button','设置');await clickText('.settings-nav button','工作区布局');
  await choose('[data-testid=agent-layout]','center');await clickText('.settings-footer button','保存设置');await clickText('.settings-footer button','关闭');
  await until("document.querySelector('.shell').classList.contains('agent-center')",'Center layout missing');
  report.checks.layout=await js("({agentX:document.querySelector('.agent-panel').getBoundingClientRect().x,taskX:document.querySelector('.main-column').getBoundingClientRect().x,promptKept:document.querySelector('.composer textarea').value.includes('asset-fixture-structure')})");
  if(report.checks.layout.agentX>=report.checks.layout.taskX||!report.checks.layout.promptKept)throw Error('Center layout lost chat or positioning');
  fs.writeFileSync(path.join(out,'v0.3-agent-center.png'),(await window.webContents.capturePage()).toPNG());
  window.setSize(1100,720);await pause(350);
  if(await js("document.documentElement.scrollWidth>innerWidth"))throw Error('Compact layout overflow');
  report.checks.compact=true;fs.writeFileSync(path.join(out,'v0.3-compact.png'),(await window.webContents.capturePage()).toPNG());window.setSize(1540,980);
  await clickText('.sidebar-tools button','设置');await clickText('.settings-nav button','工作区布局');await choose('[data-testid=agent-layout]','right');await clickText('.settings-footer button','保存设置');await clickText('.settings-footer button','关闭');
  await clickText('.agent-provider button','登录');
  if(!await js("document.querySelector('.provider-login').innerText.includes('ChatGPT')"))throw Error('Codex login absent');
  await js("document.querySelector('.modal>header button').click()");await pause(150);
  await choose('[data-testid=agent-provider]','kimi');
  await until("document.querySelector('.agent-config button')?.textContent.includes('Kimi')",'Provider did not switch');
  await clickText('.agent-provider button','登录');
  if(!await js("document.querySelectorAll('.provider-login select option').length===2"))throw Error('Kimi regions absent');
  report.checks.kimiLogin={officialDeviceFlowUI:true};
  fs.writeFileSync(path.join(out,'v0.3-kimi-login.png'),(await window.webContents.capturePage()).toPNG());
  await clickText('.provider-login button','开始 Kimi 登录');
  let device;
  for(let i=0;i<80;i++){device=await js("window.studio.invoke('agent.account',{provider:'kimi'})");if(device.url||device.phase==='failed')break;await pause(250);}
  report.checks.kimiLogin.authorizationIssue=device.url?'passed':'blocked';
  report.checks.kimiLogin.modelAccess='not_run';
  if(device.url){report.checks.kimiLogin.authorizationHost=new URL(device.url).hostname;fs.writeFileSync(path.join(out,'v0.3-kimi-device.png'),(await window.webContents.capturePage()).toPNG());}
  await js("window.studio.invoke('agent.login.cancel')");await pause(150);

  await js("document.querySelector('.modal>header button').click()");
  report.checks.protocol={};
  for(const provider of ['kimi','qwen']){
   const result=await js("(async()=>{const info=await window.studio.invoke('agent.connect',{provider:"+JSON.stringify(provider)+"});const models=await window.studio.invoke('agent.rpc',{provider:"+JSON.stringify(provider)+",method:'model/list'});return {info,models};})()");
   if(result.info.protocolVersion!==1||!result.models.authRequired||result.models.data.length)throw Error(provider+' unauthenticated protocol failed');
   report.checks.protocol[provider]={protocol:result.info.protocolVersion,version:result.info.agentInfo?.version,authRequired:true,modelAccess:'not_run'};
  }
  await choose('[data-testid=agent-provider]','qwen');await until("document.querySelector('.agent-config button')?.textContent.includes('Qwen')",'Qwen did not switch');
  await clickText('.agent-provider button','登录');
  report.checks.qwenLogin=await js("({password:document.querySelector('[data-testid=qwen-api-key]').type,plans:document.querySelectorAll('.provider-login select option').length,saveDisabled:document.querySelector('.provider-login button').disabled})");
  if(report.checks.qwenLogin.password!=='password'||report.checks.qwenLogin.plans!==4||!report.checks.qwenLogin.saveDisabled)throw Error('Qwen login form failed');
  fs.writeFileSync(path.join(out,'v0.3-qwen-login.png'),(await window.webContents.capturePage()).toPNG());
  const key='sk-sp-studio-verification-only';
  const account=await js("window.studio.invoke('agent.login',{provider:'qwen',plan:'coding-cn',model:'qwen3-coder-plus',apiKey:"+JSON.stringify(key)+"})");
  if(JSON.stringify(account).includes(key)||!account.credentialStored||account.modelAccess!=='not_run')throw Error('Credential exposure or fabricated verification');
  const file=path.join(root,'.studio','verification-providers','credentials','qwen.bin');
  if(!fs.existsSync(file)||fs.readFileSync(file).includes(Buffer.from(key)))throw Error('OS credential encryption failed');
  report.checks.systemEncryption={ciphertextStored:true,publicAccountContainsKey:false,modelAccess:'not_run',credential:'synthetic test fixture, not a real provider account'};
  fs.unlinkSync(file);
  await js("document.querySelector('.modal>header button').click()");
  await choose('[data-testid=agent-provider]','codex');
  await clickText('.nav-item','工具关系图');
  if(await js("document.querySelectorAll('.relation-tools button').length")!==7)throw Error('Tool relationship graph missing');
  await clickText('.relation-tools button','主动学习');
  if(!await js("document.querySelector('.tool-page').innerText.includes('尚待接入')"))throw Error('Unavailable capabilities represented as executable');
  report.checks.toolRelations={tools:7,plannedCapabilitiesExplicit:true};
  await clickText('.sidebar-tools button','设置');await clickText('.settings-nav button','语言');await choose('.settings-content select','en');
  await js("document.querySelector('.settings-footer .primary').click()");await pause(150);await js("document.querySelector('.settings-footer button:not(.primary)').click()");
  await until("document.querySelector('.agent-provider label')?.textContent.includes('Provider')",'English provider label missing');
  if(!await js("document.querySelector('.tool-page').innerText.includes('Active Learning')"))throw Error('English tool labels missing');
  report.checks.english=true;fs.writeFileSync(path.join(out,'v0.3-english.png'),(await window.webContents.capturePage()).toPNG());
  await js("window.studio.invoke('settings',{language:'zh-CN'})");

  const finalSettings=await js("window.studio.invoke('state').then(s=>s.settings)");
  report.checks.persistence={layout:finalSettings.agentLayout,provider:finalSettings.agentProvider,plans:plans.length};
  await js("window.studio.invoke('agent.disconnect',{provider:'qwen'})");
  await js("window.studio.invoke('agent.disconnect',{provider:'kimi'})");
  report.status='passed';
 }catch(error){report.status='failed';report.error=error.stack;console.error(error);}
 finally{
  fs.writeFileSync(path.join(out,'providers-desktop.json'),JSON.stringify(report,null,2));
 }
 return report.status==='passed';
}
