import fs from 'node:fs';
import path from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function verifyDesktop(window,root,errors,hooks={}) {
 const out=path.join(root,'.studio','validation');fs.mkdirSync(out,{recursive:true});
 const js=code=>window.webContents.executeJavaScript(code,true);
 const report={checks:{},errors};
 try{
  await pause(1200);
  await js("[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.includes('工作台')).click()");
  report.checks.sandbox=await js("({node:typeof require,bridge:typeof window.studio?.invoke,title:document.title})");
  if(report.checks.sandbox.node!=='undefined'||report.checks.sandbox.bridge!=='function')throw Error('Renderer boundary failed');
  report.checks.worker=await js("window.studio.invoke('worker.connect')");
  await js("document.querySelector('[title=\"连接 WSL\"]').click()");
  await pause(2200);
  report.checks.dom=await js("({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,text:document.body.innerText.slice(0,1000)})");
  if(report.checks.dom.overflow)throw Error('Horizontal overflow');
  fs.writeFileSync(path.join(out,'workspace.png'),(await window.webContents.capturePage()).toPNG());
  await js("[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.includes('Bias')).click()");
  await pause(400);
  if(!await js("document.body.innerText.includes('CV 定义') || document.body.innerText.includes('原子')"))throw Error('Bias editor absent');
  fs.writeFileSync(path.join(out,'bias.png'),(await window.webContents.capturePage()).toPNG());
  await js("document.querySelector('[title=\"切换主题\"]').click()");
  await pause(200);
  fs.writeFileSync(path.join(out,'light.png'),(await window.webContents.capturePage()).toPNG());
  await js("document.querySelector('[title=\"切换主题\"]').click()");
  report.checks.sharedTerminal=await js("window.studio.invoke('sharedTerminal.list').then(r=>Array.isArray(r?.sessions))");
  if(!report.checks.sharedTerminal)throw Error('Shared terminal IPC check failed');
  await js("[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.includes('计算任务')).click()");
  await pause(300);
  await js("document.querySelector('.run-row')?.click()");
  await pause(200);
  fs.writeFileSync(path.join(out,'run.png'),(await window.webContents.capturePage()).toPNG());
  report.checks.imagePreview=await js(`(async()=>{const runs=await window.studio.invoke('worker.request',{method:'GET',target:'/api/runs'});const run=runs.find(r=>r.engine==='nep.analyze');const files=await window.studio.invoke('worker.request',{method:'POST',target:'/api/run/collect',data:{run_id:run.id}});const image=files.artifacts.find(f=>f.name.endsWith('.png'));const preview=await window.studio.invoke('worker.request',{method:'POST',target:'/api/run/file',data:{run_id:run.id,name:image.name}});return preview.image?.startsWith('data:image/png;base64,')})()`);
  if(!report.checks.imagePreview)throw Error('Scientific image preview failed');
  window.setSize(1100,720);await pause(300);
  report.checks.compact=await js("({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth})");
  if(report.checks.compact.overflow)throw Error('Compact viewport overflow');
  fs.writeFileSync(path.join(out,'compact.png'),(await window.webContents.capturePage()).toPNG());
  window.setSize(1540,980);
  // The model smoke created an actual unsubmitted task. Replay its completion event
  // to exercise desktop routing, then execute only through the visible review button.
  const modelEvidence=JSON.parse(fs.readFileSync(path.join(out,'settings-review.json'),'utf8'));
  if(modelEvidence.status!=='passed')throw Error('Real model settings/review evidence missing');
  const identifier=modelEvidence.checks.draft.run_id;
  const draft=await js(`window.studio.invoke('worker.request',{method:'POST',target:'/api/run/status',data:{run_id:${JSON.stringify(identifier)}}})`);
  if(draft.status!=='draft')throw Error('Review fixture already executed');
  hooks.publish({method:'item/started',params:{item:{id:'review-ui-route',type:'mcpToolCall',tool:'prepare_run'}}});
  hooks.publish({method:'item/completed',params:{item:{id:'review-ui-route',type:'mcpToolCall',tool:'prepare_run',status:'completed',result:{content:[{type:'text',text:JSON.stringify(draft)}]}}}});
  await pause(1200);
  if(!await js("!!document.querySelector('[data-testid=task-review]')"))throw Error('Agent task did not open review page');
  if(await js("document.body.innerText.includes('Agent 已准备任务草稿')")!==true)throw Error('Review instructions missing');
  fs.writeFileSync(path.join(out,'review.png'),(await window.webContents.capturePage()).toPNG());
  await js("[...document.querySelectorAll('.review-input button')].find(b=>b.textContent==='run.py').click()");
  await pause(1000);
  report.checks.review={before_click_status:draft.status,input_editor:await js("!!document.querySelector('.review-source .monaco-editor')"),routing:'simulated tool event with real model-created draft'};
  await js(`(()=>{const e=document.querySelector('.parameter-json');const p=JSON.parse(e.value);p.seed=123;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,JSON.stringify(p,null,2));e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await pause(100);
  await js("document.querySelector('[data-testid=execute-reviewed]').click()");
  let executed;
  for(let attempt=0;attempt<60;attempt++){
   await pause(500);
   executed=await js(`window.studio.invoke('worker.request',{method:'GET',target:'/api/runs'}).then(runs=>runs.find(r=>r.revision_of===${JSON.stringify(identifier)}))`);
   if(executed?.status==='succeeded')break;
   if(executed?.status==='failed')throw Error('Reviewed execution failed');
  }
  if(executed?.status!=='succeeded'||executed.seed!==123)throw Error('Review button did not execute reviewed parameters');
  const actualLog=await js(`window.studio.invoke('worker.request',{method:'POST',target:'/api/run/log',data:{run_id:${JSON.stringify(executed.id)}}})`);
  if(!actualLog.text.includes('USER_REVIEW_GATE_OK'))throw Error('Missing real completion evidence');
  report.checks.review.after_click={run_id:executed.id,status:executed.status,seed:executed.seed,scope:'CPU infrastructure fixture only'};
  // Model controls use the actual app server catalog and scoped configuration.
  await js("document.querySelector('.agent-config button').click()");
  for(let i=0;i<40;i++){await pause(250);if(await js("!!document.querySelector('.agent-config select')"))break;}
  report.checks.effort_options=await js("[...document.querySelectorAll('.agent-controls select option')].map(o=>o.value)");
  if(!report.checks.effort_options.length||!report.checks.effort_options[0])throw Error('Effort catalog unavailable');
  await js("document.querySelector('.agent-controls button').click()");
  await pause(100);
  for(const [index,value] of [[0,'131072'],[1,'98304']]){
   await js(`(()=>{const e=document.querySelectorAll('.context-options input')[${index}];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(100);
  }
  await js("document.querySelector('.context-options button').click()");
  for(let i=0;i<40;i++){await pause(250);if(await js("document.querySelector('.context-options small').textContent.includes('已应用')"))break;}
  report.checks.context_settings=await js("window.studio.invoke('state').then(s=>s.settings.agent)");
  if(report.checks.context_settings?.contextWindow!==131072)throw Error('Context settings were not saved');
  fs.writeFileSync(path.join(out,'context.png'),(await window.webContents.capturePage()).toPNG());
  await js("document.querySelector('.agent-controls button').click()");
  await js("[...document.querySelectorAll('.sidebar-tools button')].find(b=>b.textContent.includes('设置')).click()");await pause(150);
  for(const [index,value] of [[0,'16'],[1,'17'],[2,'15']]){
   await js(`(()=>{const e=document.querySelectorAll('.settings-content input[type=number]')[${index}];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(100);
  }
  await js("(()=>{const e=document.querySelectorAll('.settings-content select')[1];Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'serif');e.dispatchEvent(new Event('change',{bubbles:true}));})()");await pause(150);
  await js("document.querySelector('.settings-footer button.primary').click()");await pause(250);
  report.checks.font_settings=await js("window.studio.invoke('state').then(s=>({family:s.settings.fontFamily,computed:getComputedStyle(document.body).fontFamily,font:s.settings.fontSize,editor:s.settings.editorFontSize,terminal:s.settings.terminalFontSize,scale:getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')}))");
  if(report.checks.font_settings.family!=='serif'||!report.checks.font_settings.computed.includes('Georgia')||report.checks.font_settings.font!==16||report.checks.font_settings.editor!==17||report.checks.font_settings.terminal!==15)throw Error('Font preferences not persisted');
  await js("[...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.includes('语言')).click()");await pause(100);
  await js("(()=>{const e=document.querySelector('.settings-content select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'en');e.dispatchEvent(new Event('change',{bubbles:true}));})()");await pause(150);
  report.checks.language=await js("({heading:document.querySelector('.settings-heading h2').textContent,nav:[...document.querySelectorAll('.nav-item')].map(b=>b.textContent),lang:document.documentElement.lang})");
  if(report.checks.language.heading!=='Language'||report.checks.language.lang!=='en'||!report.checks.language.nav.includes('Runs'))throw Error('English interface did not switch');
  await js("document.querySelector('.settings-footer button.primary').click()");await pause(250);
  if(await js("window.studio.invoke('state').then(s=>s.settings.language)")!=='en')throw Error('Language not persisted');
  await js("[...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent==='Appearance').click()");await pause(150);
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await pause(400);
  fs.writeFileSync(path.join(out,'settings-english.png'),(await window.webContents.capturePage()).toPNG());
  report.status=errors.length?'failed':'passed';
 }catch(error){report.status='failed';report.error=error.stack;}
 fs.writeFileSync(path.join(out,'desktop.json'),JSON.stringify(report,null,2));
 console.log('Desktop verification:',report.status,report.error||'');
 return report.status==='passed';
}
