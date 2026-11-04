// Real Electron/React/preload/main acceptance; DOM events, no provider or compute connection.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {desktopRoot,requireLaunchContext} from './desktop-launch.mjs';

export function parseNativeCheckArgs(args){
 const values={};
 for(let i=0;i<args.length;i+=2){
  const key=args[i],value=args[i+1];
  if(!['--out','--timeout-ms'].includes(key)||values[key]!==undefined||!value||value.startsWith('--'))throw Error('Usage: node scripts/native-conversation-check.mjs --out <new .studio directory> [--timeout-ms 90000]');
  values[key]=value;
 }
 const timeoutMs=values['--timeout-ms']===undefined?90000:Number(values['--timeout-ms']);
 if(!values['--out']||!Number.isSafeInteger(timeoutMs)||timeoutMs<15000||timeoutMs>180000)throw Error('An explicit new output directory and timeout between 15000 and 180000 ms are required');
 return {out:values['--out'],timeoutMs};
}

export function freshNativeCheckPath(repoRoot,out){
 if(typeof out!=='string'||!out.trim())throw Error('An explicit output directory is required');
 const root=path.resolve(repoRoot),target=path.resolve(root,out),studio=path.join(root,'.studio'),relative=path.relative(studio,target);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Native acceptance output must be a new directory strictly inside this checkout .studio');
 for(let current=target;;current=path.dirname(current)){
  try{const entry=fs.lstatSync(current);if(entry.isSymbolicLink())throw Error('Linked native acceptance paths are refused');if(current===target)throw Error('Native acceptance output already exists; choose a new directory');if(!entry.isDirectory())throw Error('Native acceptance parent is not a directory');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(current===root)break;
 }
 return target;
}

export function nativeCheckEnvironment(env,profile){
 const clean=Object.fromEntries(Object.entries(env).filter(([key])=>!key.startsWith('STUDIO_')&&!['ELECTRON_RUN_AS_NODE','NODE_OPTIONS'].includes(key)));
 return {...clean,STUDIO_PROFILE_DIR:profile};
}

export function mainPreloadBinding(source){
 const ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),windows=[];
 function visit(node){if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='BrowserWindow')windows.push(node);ts.forEachChild(node,visit);}visit(ast);
 assert.equal(windows.length,1,'Expected one production BrowserWindow constructor');
 const property=(object,name)=>{assert(ts.isObjectLiteralExpression(object),'Expected literal BrowserWindow options');assert(!object.properties.some(ts.isSpreadAssignment),'Dynamic BrowserWindow options require a separate review');const item=object.properties.find(item=>ts.isPropertyAssignment(item)&&item.name.getText(ast)===name);assert(item,'Missing BrowserWindow '+name);return item.initializer;};
 const preload=property(property(windows[0].arguments?.[0],'webPreferences'),'preload');
 assert(ts.isCallExpression(preload)&&preload.expression.getText(ast)==='path.join'&&preload.arguments.length===2&&preload.arguments[0].getText(ast)==='here'&&ts.isStringLiteralLike(preload.arguments[1])&&preload.arguments[1].text==='preload.cjs','Unexpected production preload binding');
 const here=ast.statements.filter(ts.isVariableStatement).flatMap(node=>[...node.declarationList.declarations]).find(node=>node.name.getText(ast)==='here');
 assert(here?.initializer?.getText(ast)==='path.dirname(fileURLToPath(import.meta.url))','Production main directory must derive from its own file');
 return {source:'production BrowserWindow constructor AST',expression:preload.getText(ast),directorySource:here.initializer.getText(ast)};
}

export function nativeRendererEvidence({preferences,configuredPreload,expectedHash,actualHash,sessionPreloads}){
 assert.equal(preferences.contextIsolation,true);assert.equal(preferences.nodeIntegration,false);assert.equal(preferences.sandbox,true);
 assert.equal(actualHash,expectedHash,'Production preload artifact changed after preparation');assert.deepEqual(sessionPreloads,[],'Unexpected session-level preload could provide another bridge');
 const reported=typeof preferences.preload==='string'?preferences.preload:null;
 if(reported!==null)assert.equal(path.resolve(reported),path.resolve(configuredPreload));
 return {contextIsolation:true,nodeIntegration:false,sandbox:true,configuredPreload,preloadSha256:actualHash,preloadPathReportedByWebPreferences:reported,sessionPreloads,preferenceKeys:Object.keys(preferences).sort()};
}

export function nativeWorkerStatusEvidence(result){
 assert(result&&typeof result==='object'&&!Array.isArray(result),'Expected a real readonly worker status reply');
 assert.deepEqual(Object.keys(result).sort(),['checkedAt','status'],'Readonly status must not return credentials or connection details');
 assert.equal(result.status,'disconnected');assert(Number.isFinite(result.checkedAt)&&result.checkedAt>=0,'Expected an actual status observation time');
 return {status:result.status,checkedAt:result.checkedAt};
}

function nativeHarness(config){
 const receipt={schema_version:1,scope:'Real Electron window, production React/preload/main IPC; DOM-triggered input/click, no physical pointer/keyboard audit',status:'running',version:config.version,profile:config.profile,checks:[],ipc:[],network:[],errors:[],not_run:['provider authentication','model calls','compute or scientific execution','physical keyboard/pointer interaction','packaged executable acceptance']};
 let finished=false,started=false,windowCount=0,mainWindow;
 const save=()=>fs.writeFileSync(config.receipt,JSON.stringify(receipt,null,2)+'\n');
 function finish(error){
  if(finished)return;finished=true;clearTimeout(deadline);receipt.status=error?'failed':'passed';if(error)receipt.errors.push(String(error.stack||error));receipt.finishedAt=new Date().toISOString();save();
  const code=error?1:0;process.exitCode=code;app.once('will-quit',()=>app.exit(code));app.quit();setTimeout(()=>app.exit(code),1500).unref();
 }
 const deadline=setTimeout(()=>finish(Error('Native conversation acceptance timed out')),config.timeoutMs);
 process.on('uncaughtException',finish);process.on('unhandledRejection',finish);
 assert.equal(process.env.STUDIO_PROFILE_DIR,config.profile);assert(!fs.existsSync(config.profile),'Fresh profile required');
 fs.mkdirSync(config.profile);fs.mkdirSync(config.sessionData);fs.mkdirSync(config.appData);
 app.setPath('appData',config.appData);app.setPath('userData',config.profile);app.setPath('sessionData',config.sessionData);
 // Observe real registrations and replies. Forbidden routes fail before external work.
 const allowed=new Set(['studio:state','studio:conversation.list','studio:conversation.groups','studio:conversation.select','studio:task.list','studio:workflow.list','studio:worker.restore','studio:worker.status','studio:scientific.skills','studio:skills.catalog']);
 const register=ipcMain.handle.bind(ipcMain);
 ipcMain.handle=(channel,handler)=>register(channel,async(event,...args)=>{
  const row={id:receipt.ipc.length+1,channel,startedAt:Date.now(),argumentKeys:args[0]&&typeof args[0]==='object'?Object.keys(args[0]):[]};receipt.ipc.push(row);
  try{
   assert(allowed.has(channel),'Native acceptance refuses unexpected IPC: '+channel);
   if(channel==='studio:conversation.select')assert.deepEqual(args[0],{new:true});
   if(channel==='studio:worker.restore')assert.deepEqual(args[0],{scope:'global'});
   const result=await handler(event,...args);row.completedAt=Date.now();
   if(channel==='studio:conversation.select'){assert.deepEqual(result,{fresh:true});row.reply={fresh:true};}
   if(channel==='studio:worker.restore'){assert.equal(result.status,'disconnected');assert.equal(result.reason,'explicit_binding_missing');row.reply={status:result.status,reason:result.reason};}
   if(channel==='studio:worker.status')row.reply=nativeWorkerStatusEvidence(result);
   return result;
  }catch(error){row.error=String(error.message||error);finish(error);throw error;}
 });
 app.whenReady().then(()=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,done)=>{
   const protocol=new URL(details.url).protocol,permitted=['file:','data:','about:','devtools:','chrome:'].includes(protocol);
   if(!permitted){receipt.network.push({protocol,hostname:new URL(details.url).hostname,blocked:true});done({cancel:true});finish(Error('Native acceptance refuses network access'));}else done({cancel:false});
  });
 });
 app.on('browser-window-created',(_event,owner)=>{
  windowCount++;if(windowCount!==1){finish(Error('Unexpected additional native window'));return;}mainWindow=owner;
  const contents=owner.webContents;
  contents.on('preload-error',(_event,preload,error)=>finish(Error('Preload failed: '+error.message)));
  contents.on('render-process-gone',(_event,details)=>{if(!finished)finish(Error('Renderer exited: '+details.reason));});
  contents.on('did-fail-load',(_event,code,message,_url,isMainFrame)=>{if(isMainFrame&&!finished)finish(Error('Main frame load failed '+code+': '+message));});
  contents.on('console-message',(details,legacyLevel,legacyMessage)=>{if(details?.level==='error'||legacyLevel===3)receipt.errors.push('Renderer console: '+(details?.message||legacyMessage));});
  contents.once('did-finish-load',()=>{if(started)return;started=true;void check(owner).then(()=>finish(),finish);});
 });
 const evaluate=code=>{if(finished)throw Error('Native acceptance already stopped');return mainWindow.webContents.executeJavaScript(code,true);};
 async function until(label,predicate){
  const end=Date.now()+20000;while(Date.now()<end){if(finished)throw Error('Native acceptance stopped during '+label);const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Timed out: '+label);
 }
 const snapshot=()=>evaluate(`(()=>{
  const text=document.querySelector('.agent-panel .composer textarea'),plan=document.querySelector('[data-testid="agent-planning-mode"]'),send=document.querySelector('.agent-panel .composer .send');
  const drafts=Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('studio.composer.v1.')).sort().map(key=>[key,localStorage.getItem(key)]));
  return {ready:!!(text&&plan&&send&&document.querySelector('.shell')),prompt:text?.value,planning:plan?.checked,planningDisabled:plan?.disabled,inputBusy:text?.getAttribute('aria-busy'),sendDisabled:send?.disabled,section:localStorage.getItem('studio.section'),selectedConversation:localStorage.getItem('studio.conversation'),drafts,skills:!!document.querySelector('[data-testid="skills-workbench"]'),bridge:typeof window.studio?.invoke,node:typeof window.require,process:typeof window.process,connectPresent:!!document.querySelector('[data-testid="agent-connect"]'),toast:document.querySelector('.toast[role="alert"]')?.textContent||''};
 })()`);
 const record=(name,details)=>{receipt.checks.push({name,status:'passed',...details});save();};
 async function click(selector){
  return evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node||node.disabled||!node.getClientRects().length||getComputedStyle(node).visibility==='hidden')throw Error('Native control unavailable: '+${JSON.stringify(selector)});node.click();return true;})()`);
 }
 async function type(text){
  await evaluate(`(()=>{const node=document.querySelector('.agent-panel .composer textarea');if(!node)throw Error('Composer absent');node.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(node,${JSON.stringify(text)});node.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(text)}}));})()`);
  return until('actual React draft update',async()=>{const value=await snapshot();return value.prompt===text&&Object.values(value.drafts).some(raw=>{try{return JSON.parse(raw).text===text;}catch{return false;}})&&value;});
 }
 const freshAcknowledgements=()=>receipt.ipc.filter(row=>row.channel==='studio:conversation.select'&&row.completedAt&&row.reply?.fresh===true);
 async function newChat(testId,planning,priorDraft){
  const count=freshAcknowledgements().length,before=await snapshot();await click('[data-testid="'+testId+'"]');
  await until('real main fresh selection ACK',()=>freshAcknowledgements().length===count+1);
  const after=await until('React publishes acknowledged fresh selection',async()=>{const value=await snapshot();return value.ready&&value.planning===planning&&!value.planningDisabled&&value.inputBusy==='false'&&value.prompt===''&&value;});
  assert.equal(after.selectedConversation,null);assert.equal(after.sendDisabled,true);assert.equal(after.section,'home');assert.equal(after.connectPresent,true);assert(!after.toast);
  assert(Object.values(after.drafts).some(raw=>{try{return JSON.parse(raw).text===priorDraft;}catch{return false;}}),'New chat must preserve the prior unsent draft');
  assert.notEqual(after.drafts['studio.composer.v1.new.codex'],before.drafts['studio.composer.v1.new.codex'],'A new blank draft must have its own identity');
  record(planning?'new computation after real main ACK':'ordinary new chat after real main ACK',{ackId:freshAcknowledgements().at(-1).id,planning:after.planning,prompt:after.prompt,sendDisabled:after.sendDisabled,priorDraftRetained:true,blankIdentityChanged:true});
 }
 async function check(owner){
  const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');assert.equal(digest(new URL(config.mainUrl)),config.mainSha256,'Production main artifact changed after preparation');
  const renderer=nativeRendererEvidence({preferences:owner.webContents.getLastWebPreferences(),configuredPreload:config.preload,expectedHash:config.preloadSha256,actualHash:digest(config.preload),sessionPreloads:owner.webContents.session.getPreloadScripts()});
  assert.equal(app.getPath('userData'),config.profile);assert.equal(app.getVersion(),config.version);
  await until('production React and real preload',async()=>{const value=await snapshot();return value.ready&&value.bridge==='function'&&value.node==='undefined'&&value.process==='undefined'&&value.connectPresent&&!value.planningDisabled&&value;});
  const initial=await snapshot();assert.equal(initial.prompt,'');assert.equal(initial.planning,false);assert.equal(initial.sendDisabled,true);assert.equal(initial.selectedConversation,null);
  const empty=await evaluate(`Promise.all(['conversation.list','task.list','workflow.list'].map(method=>window.studio.invoke(method))).then(values=>values.map(value=>value.length))`);assert.deepEqual(empty,[0,0,0]);
  record('fresh isolated native main/preload with secure renderer',{version:app.getVersion(),renderer,preloadBinding:config.preloadBinding,mainSha256:config.mainSha256,realBridgeAndTypedIpcRoundtrip:true,emptyConversationTaskWorkflowCounts:empty});
  const draft='Native acceptance: preserve this unsent blank draft.';const edited=await type(draft);assert.equal(edited.sendDisabled,true);record('real React input updates a durable unsent blank draft',{sendDisabled:true});
  await click('[data-testid="navigate-skills"]');await until('actual skills route',async()=>{const value=await snapshot();return value.skills&&value.section==='skills'&&value;});
  await click('[data-testid="navigate-home"]');await click('.quick-search');
  await until('real command palette',()=>evaluate(`!!document.querySelector('.command-list')`));
  await evaluate(`(()=>{const node=[...document.querySelectorAll('.command-list button')].find(button=>['工作区','Workspace'].includes(button.textContent.trim()));if(!node||node.disabled)throw Error('Workspace return command absent');node.click();})()`);
  const returned=await until('real workspace route return',async()=>{const value=await snapshot();return value.section==='home'&&!value.skills&&value.prompt===draft&&value;});assert.equal(returned.planning,false);assert.equal(returned.sendDisabled,true);assert(!returned.toast);record('skills navigation and command-palette workspace return preserve unsent draft',{section:returned.section,draftRetained:true,sendDisabled:true});
  await newChat('new-computation',true,draft);
  const planningDraft='Native acceptance: preserve the planning draft too.';await type(planningDraft);await newChat('new-conversation',false,planningDraft);
  const finalDraft='Native acceptance: disconnected send remains disabled.';await type(finalDraft);const calls=receipt.ipc.length;await evaluate(`document.querySelector('.agent-panel .composer .send').click()`);await new Promise(resolve=>setTimeout(resolve,100));const final=await snapshot();assert.equal(final.prompt,finalDraft);assert.equal(final.sendDisabled,true);assert.equal(receipt.ipc.length,calls);
  assert.equal(freshAcknowledgements().length,2);assert.equal(receipt.network.length,0);assert(receipt.ipc.every(row=>!row.error));assert.equal(receipt.errors.length,0);record('disconnected disabled send cannot dispatch a turn',{sendDisabled:true,ipcDispatches:0,draftRetained:true});
 }
 save();return import(config.mainUrl).catch(finish);
}

export function nativeHarnessSource(config){
 return "import {app,ipcMain,session} from 'electron';\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport {createHash} from 'node:crypto';\nimport assert from 'node:assert/strict';\n"+nativeRendererEvidence.toString()+"\n"+nativeWorkerStatusEvidence.toString()+"\nawait ("+nativeHarness.toString()+')('+JSON.stringify(config)+');\n';
}

export function prepareNativeConversationCheck({repoRoot=desktopRoot,out,timeoutMs=90000}){
 const root=path.resolve(repoRoot),target=freshNativeCheckPath(root,out),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 if(pkg.main!=='desktop/main.mjs'||typeof pkg.version!=='string')throw Error('Expected the GPU Sampling Studio checkout package');
 const main=path.join(root,pkg.main),preload=path.join(root,'desktop/preload.cjs'),index=path.join(root,'dist/index.html');
 for(const file of [main,preload,index])if(!fs.statSync(file).isFile())throw Error('Required native acceptance input missing: '+file);
 const preloadBinding=mainPreloadBinding(fs.readFileSync(main,'utf8')),mainSha256=createHash('sha256').update(fs.readFileSync(main)).digest('hex'),preloadSha256=createHash('sha256').update(fs.readFileSync(preload)).digest('hex');
 const files=[];
 function collect(directory){if(!fs.existsSync(directory))return;for(const item of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isSymbolicLink())throw Error('Linked build/source input refused: '+file);if(item.isDirectory())collect(file);else if(item.isFile())files.push(file);}}
 for(const directory of ['src','frontend','shared','contracts'])collect(path.join(root,directory));files.push(path.join(root,'package.json'));
 const indexTime=fs.statSync(index).mtimeMs,newest=Math.max(...files.map(file=>fs.statSync(file).mtimeMs));
 if(newest>indexTime+2000)throw Error('Renderer build predates its source inputs; build the current checkout before native acceptance');
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.mkdirSync(target);
 const harness=path.join(target,'harness');fs.mkdirSync(harness);
 const config={version:pkg.version,profile:path.join(target,'profile'),sessionData:path.join(target,'session'),appData:path.join(target,'app-data'),receipt:path.join(target,'receipt.json'),mainUrl:pathToFileURL(main).href,mainSha256,preload,preloadSha256,preloadBinding,timeoutMs};
 fs.writeFileSync(path.join(harness,'package.json'),JSON.stringify({name:'studio-native-conversation-check',version:pkg.version,type:'module',private:true,main:'harness.mjs'},null,2)+'\n',{flag:'wx'});
 fs.writeFileSync(path.join(harness,'harness.mjs'),nativeHarnessSource(config),{flag:'wx'});
 const hashed=[main,preload,path.join(root,'package.json'),index];collect(path.join(root,'dist'));hashed.push(...files.filter(file=>file.startsWith(path.join(root,'dist')+path.sep)&&file!==index));
 const inputs=Object.fromEntries([...new Set(hashed)].map(file=>[path.relative(root,file).replaceAll('\\','/'),createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
 const manifest={schema_version:1,status:'prepared',version:pkg.version,main:pkg.main,out:target,profile:config.profile,harness,timeoutMs,buildFreshness:{indexMtimeMs:indexTime,newestSourceMtimeMs:newest},inputs};
 fs.writeFileSync(path.join(target,'launch.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return {target,harness,config,manifest};
}

export async function runNativeConversationCheck({args=process.argv.slice(2),repoRoot=desktopRoot,env=process.env,preflight=requireLaunchContext,resolveBinary=()=>createRequire(import.meta.url)('electron'),spawnTarget=spawn}={}){
 const options=parseNativeCheckArgs(args);const context=preflight();
 const binary=await resolveBinary(),prepared=prepareNativeConversationCheck({repoRoot,...options}),launchFile=path.join(prepared.target,'launch.json');
 const stdout=fs.openSync(path.join(prepared.target,'stdout.log'),'wx'),stderr=fs.openSync(path.join(prepared.target,'stderr.log'),'wx');let child,exit;
 try{
  child=spawnTarget(binary,[prepared.harness],{cwd:path.resolve(repoRoot),env:nativeCheckEnvironment(env,prepared.config.profile),stdio:['ignore','pipe','pipe'],windowsHide:true});
  prepared.manifest.pid=child.pid;prepared.manifest.launchContext=context;prepared.manifest.status='running';fs.writeFileSync(launchFile,JSON.stringify(prepared.manifest,null,2)+'\n');
  child.stdout.on('data',value=>fs.writeSync(stdout,value));child.stderr.on('data',value=>fs.writeSync(stderr,value));
  exit=await new Promise(resolve=>{
   let failure;const timer=setTimeout(()=>{failure='Owned Electron exceeded acceptance deadline';child.kill();},options.timeoutMs+5000);
   child.once('error',error=>{failure=error.message;});child.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,...failure?{failure}:{}});});
  });
 }catch(error){exit={failure:error.message};}
 finally{fs.closeSync(stdout);fs.closeSync(stderr);}
 let receipt;try{receipt=JSON.parse(fs.readFileSync(prepared.config.receipt,'utf8'));}catch{}
 const passed=exit?.code===0&&!exit?.failure&&receipt?.status==='passed';prepared.manifest.status=passed?'passed':'failed';prepared.manifest.exit=exit||{failure:'Electron launch failed'};fs.writeFileSync(launchFile,JSON.stringify(prepared.manifest,null,2)+'\n');
 return {status:passed?'passed':'failed',version:prepared.config.version,out:prepared.target,checks:receipt?.checks?.length||0,exit:exit||null};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 try{const result=await runNativeConversationCheck();console.log(JSON.stringify(result));process.exitCode=result.status==='passed'?0:1;}
 catch(error){console.error(JSON.stringify({status:error.preflight?'blocked':'failed',reason:error.preflight?.reason,message:error.message}));process.exitCode=error.preflight?2:1;}
}
