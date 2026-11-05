// Explicit isolated Electron acceptance for package UI + actual registry actions.
// Directory dialog responses are test-selected; production IPC/domain replies are never replaced.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {desktopRoot,requireLaunchContext} from './desktop-launch.mjs';
import {parseNativeCheckArgs,prepareNativeConversationCheck,launchPreparedNativeCheck,nativeRendererEvidence} from './native-conversation-check.mjs';
import {createToolPackageRegistry} from '../backend/main/tools/package-registry.mjs';
import {Catalog} from "../backend/main/workspace/catalog.mjs";

const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function prepareNativeToolPackageCheck({repoRoot=desktopRoot,...options}){
 const prepared=prepareNativeConversationCheck({repoRoot,...options}),base=path.join(prepared.target,'fixtures'),name='cpu-worker-reference-package';
 const roots=['initial','updated','moved'].map(part=>path.join(base,part,name));
 execFileSync(process.execPath,[path.join(repoRoot,'developer/skills/studio-tool-integration/scripts/create-cpu-reference.mjs'),'--output',roots[0]],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 fs.mkdirSync(path.dirname(roots[1]),{recursive:true});fs.cpSync(roots[0],roots[1],{recursive:true});fs.appendFileSync(path.join(roots[1],'manual.md'),'\nNative package update fixture: human instructions changed.\n');
 fs.mkdirSync(path.dirname(roots[2]),{recursive:true});fs.cpSync(roots[1],roots[2],{recursive:true});
 const catalog=new Catalog(path.join(base,'inspection-catalog'));let inspections;
 try{const registry=createToolPackageRegistry({catalog,storeRoot:path.join(base,'unused-inspection-store')});inspections=roots.map(package_root=>registry.inspect({package_root}));}finally{catalog.db.close();}
 if(inspections[0].package_version===inspections[1].package_version||inspections[1].package_version!==inspections[2].package_version)throw Error('Native package fixture identity is invalid');
 const config={...prepared.config,roots,versions:inspections.map(value=>value.package_version),packageId:inspections[0].package_id};
 const source="import {app,ipcMain,session,dialog} from 'electron';\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport {createHash} from 'node:crypto';\nimport assert from 'node:assert/strict';\n"+nativeRendererEvidence.toString()+"\nawait ("+nativeToolHarness.toString()+')('+JSON.stringify(config)+');\n';
 fs.writeFileSync(path.join(prepared.harness,'harness.mjs'),source);prepared.config=config;
 Object.assign(prepared.manifest,{scope:'Native package registration, update, relocation and offline configuration controls',fixture:{roots,versions:config.versions,dialog:'Explicit controlled folder selection; no physical file picker audit'},harnessSha256:sha(path.join(prepared.harness,'harness.mjs'))});
 fs.writeFileSync(path.join(prepared.target,'launch.json'),JSON.stringify(prepared.manifest,null,2)+'\n');return prepared;
}

function nativeToolHarness(config){
 const receipt={schema_version:1,scope:'Actual Electron React/preload/main/registry with explicit fixture folder dialog choices; DOM events, no physical pointer or picker audit',version:config.version,status:'running',checks:[],ipc:[],network:[],errors:[],not_run:['tool installation','model calls','compute/cluster/scientific execution','physical input','packaged executable']};
 let finished=false,owner,started=false,choices=0;const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),save=()=>fs.writeFileSync(config.receipt,JSON.stringify(receipt,null,2)+'\n');
 function finish(error){if(finished)return;finished=true;clearTimeout(deadline);receipt.status=error?'failed':'passed';if(error)receipt.errors.push(String(error.stack||error));save();const code=error?1:0;process.exitCode=code;app.once('will-quit',()=>app.exit(code));app.quit();setTimeout(()=>app.exit(code),1500).unref();}
 const deadline=setTimeout(()=>finish(Error('Native package acceptance timed out')),config.timeoutMs);process.on('uncaughtException',finish);process.on('unhandledRejection',finish);
 assert.equal(process.env.STUDIO_PROFILE_DIR,config.profile);assert(!fs.existsSync(config.profile));for(const file of [config.profile,config.sessionData,config.appData])fs.mkdirSync(file);app.setPath('appData',config.appData);app.setPath('userData',config.profile);app.setPath('sessionData',config.sessionData);
 dialog.showOpenDialog=async()=>{assert(choices<config.roots.length,'Unexpected folder dialog');return {canceled:false,filePaths:[config.roots[choices++]]};};
 const allowed=new Set(['state','conversation.list','conversation.groups','task.list','task.create','task.read','workflow.list','worker.restore','compute.resource.status','worker.status','scientific.skills','skills.catalog','tools.packages.choose','tools.packages.inspect','tools.packages.register','tools.packages.update','tools.packages.relocate','tools.packages.read','tools.packages.list','tools.configurations.list','tools.configurations.context','worker.request'].map(name=>'studio:'+name));
 const register=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,handler)=>register(channel,async(event,value)=>{
  const row={channel,startedAt:Date.now()};receipt.ipc.push(row);
  try{assert(allowed.has(channel),'Unexpected native IPC: '+channel);if(channel==='studio:worker.request')assert(value.method==='GET'&&['/api/projects','/api/environments'].includes(value.target),'Only explicit offline catalog reads permitted');const result=await handler(event,value);row.completedAt=Date.now();if(['studio:tools.packages.register','studio:tools.packages.update','studio:tools.packages.relocate'].includes(channel))row.record={package_id:result.package_id,package_version:result.package_version,revision:result.revision,snapshot_root:result.snapshot_root,package_roots:result.package_roots,versions:result.versions,installation:result.installation,tests:result.tests};return result;}
  catch(error){row.error=String(error.message||error);if(channel==='studio:worker.request'){row.expectedOfflineFailure=true;throw error;}finish(error);throw error;}
 });
 app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,done)=>{const url=new URL(details.url),permitted=['file:','data:','about:','devtools:','chrome:'].includes(url.protocol);if(!permitted){receipt.network.push({protocol:url.protocol,hostname:url.hostname,blocked:true});done({cancel:true});finish(Error('Unexpected external network'));}else done({cancel:false});}));
 app.on('browser-window-created',(_event,window)=>{if(owner){finish(Error('Unexpected window'));return;}owner=window;owner.webContents.on('preload-error',(_e,_p,error)=>finish(error));owner.webContents.on('render-process-gone',(_e,details)=>{if(!finished)finish(Error(details.reason));});owner.webContents.on('console-message',(details,level,message)=>{if(details?.level==='error'||level===3)receipt.errors.push('Renderer: '+(details?.message||message));});owner.webContents.once('did-finish-load',()=>{if(started)return;started=true;void check().then(()=>finish(),finish);});});
 const evaluate=source=>owner.webContents.executeJavaScript(source,true),pause=()=>new Promise(resolve=>setTimeout(resolve,50));
 async function until(label,condition){const end=Date.now()+20000;while(Date.now()<end){if(finished)throw Error('Stopped '+label);const value=await condition();if(value)return value;await pause();}throw Error('Timed out '+label);}
 const inspect=()=>evaluate(`(()=>{const panel=document.querySelector('[data-testid="tool-packages-panel"]');return {ready:!!document.querySelector('.shell'),panel:!!panel,candidate:panel?.querySelector('[data-testid="tool-package-candidate"]')?.textContent,record:panel?.querySelector('[data-testid="tool-package-record"]')?.textContent,error:panel?.querySelector('[role="alert"]')?.textContent||'',busy:panel?.querySelector('button[data-testid="tool-package-choose"]')?.disabled,version:panel?.querySelector('select[aria-label="已保存版本"]')?.value,versions:panel?.querySelector('select[aria-label="已保存版本"]')?.options.length,projectTarget:!!panel?.querySelector('[data-testid="tool-configuration-target"]'),node:typeof window.require,process:typeof window.process,bridge:typeof window.studio?.invoke};})()`);
 async function click(selector){await evaluate(`(()=>{const value=document.querySelector(${JSON.stringify(selector)});if(!value||value.disabled||!value.getClientRects().length)throw Error('Unavailable native control '+${JSON.stringify(selector)});value.click();})()`);}
 async function candidateAction(label){await evaluate(`(()=>{const value=[...document.querySelectorAll('[data-testid="tool-package-candidate"] button')].find(node=>node.textContent.trim()===${JSON.stringify(label)});if(!value||value.disabled)throw Error('Candidate action unavailable');value.click();})()`);}
 function record(name,details={}){receipt.checks.push({name,status:'passed',...details});save();}
 async function check(){
  assert.equal(digest(new URL(config.mainUrl)),config.mainSha256);const renderer=nativeRendererEvidence({preferences:owner.webContents.getLastWebPreferences(),configuredPreload:config.preload,expectedHash:config.preloadSha256,actualHash:digest(config.preload),sessionPreloads:owner.webContents.session.getPreloadScripts()});assert.equal(app.getPath('userData'),config.profile);
  await until('renderer',async()=>{const value=await inspect();return value.ready&&value.node==='undefined'&&value.process==='undefined'&&value.bridge==='function';});await click('[data-testid="navigate-skills"]');await until('package panel metadata',async()=>{const value=await inspect();return value.panel&&!value.busy&&!value.error;});record('production secure renderer opens actual package metadata panel',{renderer});
  for(const [index,action]of ['登记此工具包','更新为此版本','仅更新包位置'].entries()){
   await click('[data-testid="tool-package-choose"]');await until('candidate inspect',async()=>{const value=await inspect();return value.candidate?.includes(config.versions[index])&&!value.busy&&!value.error;});
   const before=receipt.ipc.filter(row=>row.record).length;await candidateAction(action);await until('actual package record acknowledgement',()=>receipt.ipc.filter(row=>row.record).length===before+1);const value=await until('rendered immutable record',async()=>{const state=await inspect();return state.record&&state.version===config.versions[index]&&!state.busy&&!state.error&&state;});const observed=receipt.ipc.filter(row=>row.record).at(-1).record;
   assert.equal(observed.revision,index+1);assert.equal(observed.package_id,config.packageId);assert.equal(observed.installation.status,'not_run');assert.equal(observed.tests.status,'not_run');assert.equal(observed.versions.length,index===0?1:2);assert(fs.statSync(observed.snapshot_root).isDirectory());record(['actual registration','actual version update','actual package relocation'][index],{package_version:observed.package_version,revision:observed.revision,versions:observed.versions.length,snapshotExists:true,installation:'not_run',tests:'not_run'});
  }
  const records=receipt.ipc.filter(row=>row.record).map(row=>row.record);assert.notEqual(records[0].snapshot_root,records[1].snapshot_root);assert.equal(records[1].snapshot_root,records[2].snapshot_root);assert.deepEqual(records[2].package_roots,config.roots);assert.equal(choices,3);
  await evaluate(`(()=>{const value=document.querySelector('[data-testid="tool-package-record"] select[aria-label="已保存版本"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(value,${JSON.stringify(config.versions[0])});value.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until('old immutable selection',async()=>{const value=await inspect();return value.version===config.versions[0]&&value.record?.includes(config.versions[0])&&!value.busy&&!value.error;});record('historical package selection keeps its exact version');
  await click('[data-testid="tool-configuration-start"]');await until('offline configuration error',async()=>{const value=await inspect();return value.error&&!value.busy&&value;});const offline=await inspect();assert.equal(offline.projectTarget,false);assert(receipt.ipc.some(row=>row.channel==='studio:worker.request'&&row.expectedOfflineFailure));assert(!receipt.ipc.some(row=>/tools\.configurations\.(plan|execute|activate)/.test(row.channel)));record('explicit offline configuration reports real failure without a plan, install, test or activation');
  // A real explicitly created draft exercises the changed DeploymentPanel offline path.
  // No thread, worker source, authorization or scientific readiness is manufactured.
  const task=await evaluate(`window.studio.invoke('task.create',{provider:'codex',planningMode:true,workflowVersion:2,projectId:'native-retained-project',request:'Native deployment context draft; never execute'})`);assert.equal(task.projectId,'native-retained-project');assert.equal(task.review.status,'not_run');
  await evaluate(`(()=>{localStorage.setItem('studio.section',${JSON.stringify('deployment:'+task.id)});setTimeout(()=>location.reload(),0);return true;})()`);
  const deployment=await until('actual offline deployment panel',()=>evaluate(`(()=>{const page=document.querySelector('[data-testid="deployment-page"]'),state=page?.querySelector('[data-testid="deployment-context-state"]'),button=page?.querySelector('[data-testid="execute-deployment"]');return page&&state&&button&&{state:state.textContent,disabled:button.disabled,restoring:state.textContent.includes('正在核对'),section:localStorage.getItem('studio.section')};})()`));assert.equal(deployment.disabled,true);assert.equal(deployment.section,'deployment:'+task.id);
  const retained=await evaluate(`window.studio.invoke('task.read',{id:${JSON.stringify(task.id)}})`);assert.equal(retained.projectId,'native-retained-project');assert.equal(retained.review.status,'not_run');assert.equal(retained.deployment,undefined);record('actual DeploymentPanel offline restoration keeps the saved project and execution gate',{task_id:task.id,projectRetained:true,executionDisabled:true,review:'not_run',workerOrScientificSubmission:false});
  assert.equal(receipt.network.length,0);assert.equal(receipt.errors.length,0);assert(receipt.ipc.every(row=>!row.error||row.expectedOfflineFailure));
 }
 save();return import(config.mainUrl).catch(finish);
}

export async function runNativeToolPackageCheck({args=process.argv.slice(2),repoRoot=desktopRoot}={}){
 const options=parseNativeCheckArgs(args),context=requireLaunchContext(),binary=createRequire(import.meta.url)('electron'),prepared=prepareNativeToolPackageCheck({repoRoot,...options});return launchPreparedNativeCheck({prepared,binary,context,repoRoot});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=await runNativeToolPackageCheck();console.log(JSON.stringify(result));process.exitCode=result.status==='passed'?0:1;}catch(error){console.error(JSON.stringify({status:error.preflight?'blocked':'failed',reason:error.preflight?.reason,message:error.message}));process.exitCode=error.preflight?2:1;}
}
