// Explicit isolated Electron acceptance of the real C21 offline panel and navigation gates.
// No workspace/run binding, worker reply, IPC result or provider state is fabricated.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {desktopRoot,requireLaunchContext} from './desktop-launch.mjs';
import {parseNativeCheckArgs,prepareNativeConversationCheck,launchPreparedNativeCheck,nativeRendererEvidence} from './native-conversation-check.mjs';

const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function prepareNativeToolWorkflowCheck({repoRoot=desktopRoot,...options}){
 const prepared=prepareNativeConversationCheck({repoRoot,...options}),config=prepared.config;
 const source="import {app,ipcMain,session} from 'electron';\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport {createHash} from 'node:crypto';\nimport assert from 'node:assert/strict';\n"+nativeRendererEvidence.toString()+"\nawait ("+nativeWorkflowHarness.toString()+')('+JSON.stringify(config)+');\n';
 fs.writeFileSync(path.join(prepared.harness,'harness.mjs'),source);
 Object.assign(prepared.manifest,{scope:'Actual Electron C21 offline workbench panel, real draft persistence, readonly lookup failure and disabled execution gates',harnessSha256:sha(path.join(prepared.harness,'harness.mjs')),not_run:['connected workspace and active configuration','native prepared-step review and execution','native run-to-existing-step focus','model/compute/scientific execution','physical keyboard/pointer input','packaged executable']});
 fs.writeFileSync(path.join(prepared.target,'launch.json'),JSON.stringify(prepared.manifest,null,2)+'\n');return prepared;
}

function nativeWorkflowHarness(config){
 const receipt={schema_version:1,status:'running',version:config.version,scope:'Real Electron production renderer/preload/main with DOM-triggered navigation. Offline task/workspace gates only; no mocked IPC/worker/provider result or manufactured workspace/run binding.',checks:[],ipc:[],network:[],errors:[],not_run:['connected workspace/active configuration','native prepared-step confirmation and execution','native return-to-existing-step focus','model/compute/scientific execution','physical keyboard/pointer input','packaged executable']};
 let finished=false,started=false,window;const save=()=>fs.writeFileSync(config.receipt,JSON.stringify(receipt,null,2)+'\n'),digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 function finish(error){if(finished)return;finished=true;clearTimeout(deadline);receipt.status=error?'failed':'passed';receipt.finishedAt=new Date().toISOString();if(error)receipt.errors.push(String(error.stack||error));save();const code=error?1:0;process.exitCode=code;app.once('will-quit',()=>app.exit(code));app.quit();setTimeout(()=>app.exit(code),1500).unref();}
 const deadline=setTimeout(()=>finish(Error('Native workflow gate check timed out')),config.timeoutMs);process.on('uncaughtException',finish);process.on('unhandledRejection',finish);
 assert.equal(process.env.STUDIO_PROFILE_DIR,config.profile);for(const folder of [config.profile,config.sessionData,config.appData]){assert(!fs.existsSync(folder),'A fresh isolated profile is required');fs.mkdirSync(folder);}app.setPath('appData',config.appData);app.setPath('userData',config.profile);app.setPath('sessionData',config.sessionData);
 const readonlyWorkflows=new Set(['studio:tools.workflows.context','studio:tools.workflows.list','studio:tools.workflows.locateRun','studio:tools.workflows.read','studio:tools.workflows.status']);
 const allowed=new Set(['state','conversation.list','conversation.groups','conversation.select','task.list','task.create','task.read','workflow.list','worker.restore','worker.status','scientific.skills','skills.catalog','tools.packages.list','tools.configurations.list','tools.configurations.context','worker.request'].map(name=>'studio:'+name));
 const register=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,handler)=>register(channel,async(event,value)=>{
  const row={channel,startedAt:Date.now(),keys:value&&typeof value==='object'?Object.keys(value):[]};receipt.ipc.push(row);
  try{
   assert(allowed.has(channel)||readonlyWorkflows.has(channel),'Forbidden native IPC: '+channel);
   if(channel==='studio:conversation.select')assert.deepEqual(value,{new:true},'No real conversation binding is manufactured');
   if(channel==='studio:worker.restore')assert.deepEqual(value,{scope:'global'});
   if(channel==='studio:worker.request')assert(value?.method==='GET'&&['/api/projects','/api/environments'].includes(value.target),'No worker mutation is allowed');
   const result=await handler(event,value);row.completedAt=Date.now();
   if(channel==='studio:worker.status')row.observation={status:result.status};
   if(channel==='studio:worker.restore'){assert.equal(result.status,'disconnected');row.observation={status:result.status,reason:result.reason};}
   if(channel==='studio:task.create')row.task={id:result.id,workflowVersion:result.workflowVersion,review:result.review?.status,workspaceChoice:result.workspaceChoice};
   return result;
  }catch(error){row.error=String(error.message||error);if(channel==='studio:tools.workflows.locateRun'||channel==='studio:worker.request'&&value?.method==='GET'&&['/api/projects','/api/environments'].includes(value.target)){row.expectedOfflineFailure=true;throw error;}finish(error);throw error;}
 });
 app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,done)=>{const url=new URL(details.url),permitted=['file:','data:','about:','devtools:','chrome:'].includes(url.protocol);if(!permitted){receipt.network.push({protocol:url.protocol,hostname:url.hostname,blocked:true});done({cancel:true});finish(Error('Native offline check refuses external network'));}else done({cancel:false});}));
 app.on('browser-window-created',(_event,owner)=>{if(window){finish(Error('Unexpected additional native window'));return;}window=owner;owner.webContents.on('preload-error',(_event,_path,error)=>finish(error));owner.webContents.on('render-process-gone',(_event,details)=>{if(!finished)finish(Error(details.reason));});owner.webContents.on('console-message',(details,level,message)=>{if(details?.level==='error'||level===3)receipt.errors.push('Renderer: '+(details?.message||message));});owner.webContents.once('did-finish-load',()=>{if(started)return;started=true;void check().then(()=>finish(),finish);});});
 const evaluate=code=>window.webContents.executeJavaScript(code,true),pause=()=>new Promise(resolve=>setTimeout(resolve,50));
 async function until(label,read){const end=Date.now()+20000;while(Date.now()<end){if(finished)throw Error('Stopped '+label);const value=await read();if(value)return value;await pause();}throw Error('Timed out '+label);}
 const panel=()=>evaluate(`(()=>{const node=document.querySelector('[data-testid="tool-workflows-panel"]');return {shell:!!document.querySelector('.shell'),node:typeof window.require,process:typeof window.process,bridge:typeof window.studio?.invoke,visible:!!node?.getClientRects().length,text:node?.textContent||'',controls:node?[...node.querySelectorAll('button,input,select')].map(value=>({text:value.textContent.trim(),disabled:value.disabled})):[],workspace:document.querySelector('[data-testid="workspace-saved-choice"]')?.textContent||'',section:localStorage.getItem('studio.section')};})()`);
 const record=(name,facts={})=>{receipt.checks.push({name,status:'passed',...facts});save();};
 async function click(selector){await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element||element.disabled||!element.getClientRects().length)throw Error('Native control unavailable');element.click();})()`);}
 async function returnToTask(taskId){await evaluate(`(()=>{localStorage.setItem('studio.section',${JSON.stringify('agent-task:')}+${JSON.stringify(taskId)});setTimeout(()=>location.reload(),0);return true;})()`);return until('actual offline workflow panel',async()=>{const value=await panel();return value.visible&&value.section==='agent-task:'+taskId&&value;});}
 async function check(){
  assert.equal(digest(new URL(config.mainUrl)),config.mainSha256);const renderer=nativeRendererEvidence({preferences:window.webContents.getLastWebPreferences(),configuredPreload:config.preload,expectedHash:config.preloadSha256,actualHash:digest(config.preload),sessionPreloads:window.webContents.session.getPreloadScripts()});assert.equal(app.getPath('userData'),config.profile);
  await until('production renderer',async()=>{const value=await panel();return value.shell&&value.node==='undefined'&&value.process==='undefined'&&value.bridge==='function';});record('actual secure dev renderer and production preload/main load in a fresh private profile',{renderer});
  const task=await evaluate(`window.studio.invoke('task.create',{provider:'codex',planningMode:true,workflowVersion:2,request:'Native offline C21 panel gate draft; do not execute'})`);assert.equal(task.workflowVersion,2);assert.equal(task.review.status,'not_run');assert.equal(task.workspaceChoice,'pending');assert(!task.workspace?.id);assert(!task.threadId);receipt.taskId=task.id;record('real TaskRecords create persists an unbound workflow draft without a workspace or run',{task_id:task.id,review:'not_run',workspaceChoice:'pending'});
  const first=await returnToTask(task.id);assert(first.text.includes('工作区工具组流程'));assert(first.text.includes('先选择已保存的工作区'));assert(first.controls.length>0);assert(first.controls.every(control=>control.disabled));assert(!first.text.includes('已准备原任务输入'));record('actual AgentTaskPage and WorkspacePanel compose the C21 panel with all workflow controls disabled',{controls:first.controls,workspace:first.workspace});
  const before=receipt.ipc.length;await evaluate(`(()=>{const button=[...document.querySelectorAll('[data-testid="tool-workflows-panel"] button')].find(value=>value.textContent.trim()==='刷新流程目录');if(!button||!button.disabled)throw Error('Offline gate missing');button.click();return true;})()`);await new Promise(resolve=>setTimeout(resolve,200));assert(!receipt.ipc.slice(before).some(row=>row.channel.startsWith('studio:tools.workflows.')));record('disabled offline workflow refresh produces no workflow IPC');
  await click('[data-testid="navigate-skills"]');await until('actual resource workbench',()=>evaluate(`!!document.querySelector('[data-testid="skills-workbench"]')?.getClientRects().length`));const restored=await returnToTask(task.id);assert(restored.controls.every(control=>control.disabled));const retained=await evaluate(`window.studio.invoke('task.read',{id:${JSON.stringify(task.id)}})`);assert.equal(retained.review.status,'not_run');assert.equal(retained.workspaceChoice,'pending');assert(!retained.workspace?.id);assert(!retained.deployment);record('real resource navigation and persisted return keep the draft and execution gates unchanged');
  const observation=await evaluate(`window.studio.invoke('worker.status',{})`);assert.equal(observation.status,'disconnected');const missing=await evaluate(`window.studio.invoke('tools.workflows.locateRun',{run_id:'native-offline-missing-run'}).then(()=>({unexpected:true}),error=>({error:String(error.message||error)}))`);assert(!missing.unexpected);assert(missing.error);record('actual readonly locateRun rejects disconnected lookup without inventing a step focus',{workerStatus:observation.status,rejection:missing.error});
  assert(!receipt.ipc.some(row=>/tools\.workflows\.(create|retryCreate|prepareStep|executeStep)|tools\.configurations\.(plan|execute|activate)|agent\.rpc|agent\.connect/.test(row.channel)));assert.equal(receipt.ipc.filter(row=>row.channel==='studio:tools.workflows.locateRun').length,1);assert.equal(receipt.ipc.filter(row=>readonlyWorkflows.has(row.channel)&&row.channel!=='studio:tools.workflows.locateRun').length,0);assert.equal(receipt.network.length,0);assert.equal(receipt.errors.length,0);assert(receipt.ipc.every(row=>!row.error||row.expectedOfflineFailure));
 }
 save();return import(config.mainUrl).catch(finish);
}

export async function runNativeToolWorkflowCheck({args=process.argv.slice(2),repoRoot=desktopRoot}={}){
 const options=parseNativeCheckArgs(args),context=requireLaunchContext(),binary=createRequire(import.meta.url)('electron'),prepared=prepareNativeToolWorkflowCheck({repoRoot,...options});return launchPreparedNativeCheck({prepared,binary,context,repoRoot});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=await runNativeToolWorkflowCheck();console.log(JSON.stringify(result));process.exitCode=result.status==='passed'?0:1;}catch(error){console.error(JSON.stringify({status:error.preflight?'blocked':'failed',reason:error.preflight?.reason,message:error.message}));process.exitCode=error.preflight?2:1;}
}
