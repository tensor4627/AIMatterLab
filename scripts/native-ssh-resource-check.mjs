// Explicit isolated native engineering acceptance. The SSH client is a local
// controlled console fixture: no SSH/config/authentication/model/queue access.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {desktopRoot,requireLaunchContext} from './desktop-launch.mjs';
import {parseNativeCheckArgs,prepareNativeConversationCheck,launchPreparedNativeCheck,nativeRendererEvidence} from './native-conversation-check.mjs';

const compilerCandidates=[process.env.STUDIO_CSC_PATH,'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe','C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe'].filter(Boolean),compiler=compilerCandidates.find(candidate=>fs.existsSync(candidate))||compilerCandidates[0];
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function compileNativeResourceClient(directory){
 if(process.platform!=='win32'||!fs.existsSync(compiler))throw Error('Controlled native client requires an existing .NET Framework csc.exe (set STUDIO_CSC_PATH to override); no dependency installation is permitted');
 fs.mkdirSync(directory,{recursive:true});const source=path.join(directory,'ControlledResourceClient.cs'),client=path.join(directory,'ControlledResourceClient.exe');
 fs.writeFileSync(source,'using System; using System.Text; public static class ControlledResourceClient { public static void Main(string[] ignored) { Console.OutputEncoding=new UTF8Encoding(false); Console.WriteLine("CONTROLLED_LOCAL_CLIENT_NO_SSH_AUTHENTICATION"); string line; while((line=Console.ReadLine())!=null) { Console.WriteLine("LOCAL_ECHO:"+line); } } }\n',{flag:'wx'});
 const output=execFileSync(compiler,['/nologo','/target:exe','/out:'+client,source],{encoding:'utf8',windowsHide:true,timeout:10000});
 fs.writeFileSync(path.join(directory,'compile.log'),output);if(!fs.statSync(client).isFile())throw Error('Controlled compiler did not emit its own console fixture');
 return {client,source,compiler,clientSha256:digest(client),sourceSha256:digest(source),scope:'Controlled local console client in SSH-profile path, ignores SSH argv, no SSH authentication'};
}

export function prepareNativeSshResourceCheck({repoRoot=desktopRoot,...options}){
 const started=Date.now(),timeoutMs=options.timeoutMs??90000;if(timeoutMs>90000)throw Error('Native resource acceptance is bounded to 90000 ms');
 const prepared=prepareNativeConversationCheck({repoRoot,...options,timeoutMs:Math.min(timeoutMs,75000)});
 const fixture=compileNativeResourceClient(path.join(prepared.target,'controlled-client'));
 const config={...prepared.config,...fixture,deadlineAt:started+timeoutMs,syntheticThread:'native-resource-engineering-'+randomUUID()};
 config.timeoutMs=Math.max(1000,Math.min(75000,config.deadlineAt-Date.now()-5000));
 const source="import {app,ipcMain,session,safeStorage} from 'electron';\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport http from 'node:http';\nimport {createHash} from 'node:crypto';\nimport assert from 'node:assert/strict';\n"+nativeRendererEvidence.toString()+"\nawait ("+nativeResourceHarness.toString()+')('+JSON.stringify(config)+');\n';
 fs.writeFileSync(path.join(prepared.harness,'harness.mjs'),source);prepared.config=config;
 Object.assign(prepared.manifest,{scope:fixture.scope+'; real Electron main/preload/React/terminal broker/node-pty, no model/worker connection or real SSH',fixture,harnessSha256:digest(path.join(prepared.harness,'harness.mjs'))});
 fs.writeFileSync(path.join(prepared.target,'launch.json'),JSON.stringify(prepared.manifest,null,2)+'\n');return prepared;
}

function nativeResourceHarness(config){
 const receipt={schema_version:1,status:'running',version:config.version,scope:'Real Electron main/preload/React/broker/node-pty. Controlled local client in SSH-profile path, no SSH authentication. Synthetic conversation metadata only; no model reply.',checks:[],ipc:[],network:[],errors:[],not_run:['real SSH/config/authentication','agent model/server calls','worker connection or installation','queue/scientific execution','physical pointer/keyboard audit','packaged executable']};
 let finished=false,finishing=false,owner,started=false,fixtureProfile,selectedResource,lastEvent;const sessions=new Set(),handlers=new Map();
 const save=()=>fs.writeFileSync(config.receipt,JSON.stringify(receipt,null,2)+'\n'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const evaluate=code=>owner.webContents.executeJavaScript(code,true);
 const invoke=(method,value={})=>evaluate('window.studio.invoke('+JSON.stringify(method)+','+JSON.stringify(value)+')');
 const localRequest=(descriptor,route)=>new Promise((resolve,reject)=>{const request=http.request(descriptor.origin+route,{method:route==='/shutdown'?'POST':'GET',headers:{Authorization:'Bearer '+descriptor.controlToken,...route==='/shutdown'?{'Content-Type':'application/json','Content-Length':2}:{}}},response=>{const parts=[];response.on('data',part=>parts.push(part));response.on('end',()=>{if(response.statusCode!==200)return reject(Error('Owned broker cleanup refused'));try{resolve(JSON.parse(Buffer.concat(parts).toString()));}catch(error){reject(error);}});});request.setTimeout(2000,()=>request.destroy(Error('Owned broker timeout')));request.on('error',reject);if(route==='/shutdown')request.write('{}');request.end();});
 async function cleanup(){
  receipt.cleanup={sessionIds:[...sessions],closed:[],brokerStopped:false};
  for(const sessionId of sessions)try{const handler=handlers.get('studio:sharedTerminal.close');if(handler&&lastEvent){await handler(lastEvent,{sessionId});receipt.cleanup.closed.push(sessionId);}}catch(error){receipt.cleanup.sessionCloseError=String(error.message||error);}
  const file=path.join(config.profile,'shared-terminal','broker.bin');
  if(!fs.existsSync(file)){receipt.cleanup.brokerStopped=sessions.size===0;return;}
  const descriptor=JSON.parse(safeStorage.decryptString(fs.readFileSync(file))),runtime=path.join(config.profile,'shared-terminal','runtime')+path.sep,url=new URL(descriptor.origin);
  assert(descriptor.runtimeRoot.startsWith(runtime)&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/'&&!url.search&&!url.hash,'Only owned broker cleanup is permitted');
  const health=await localRequest(descriptor,'/health');assert.equal(health.pid,descriptor.pid);assert.equal(health.instanceId,descriptor.instanceId);receipt.cleanup.brokerPid=descriptor.pid;receipt.cleanup.instanceId=descriptor.instanceId;
  await localRequest(descriptor,'/shutdown');
  for(let i=0;i<30;i++){try{process.kill(descriptor.pid,0);}catch(error){if(error.code==='ESRCH'){receipt.cleanup.brokerStopped=true;break;}throw error;}await pause(50);}
  assert.equal(receipt.cleanup.brokerStopped,true,'Owned broker did not exit after its authenticated shutdown');
 }
 async function finish(error){
  if(finishing)return;finishing=true;clearTimeout(deadline);
  try{await cleanup();}catch(cleanupError){receipt.errors.push('Cleanup: '+String(cleanupError.message||cleanupError));error=error||cleanupError;}
  finished=true;receipt.status=error?'failed':'passed';if(error)receipt.errors.push(String(error.stack||error));receipt.finishedAt=new Date().toISOString();save();
  const code=error?1:0;process.exitCode=code;app.once('will-quit',()=>app.exit(code));app.quit();setTimeout(()=>app.exit(code),1000).unref();
 }
 const deadline=setTimeout(()=>void finish(Error('Native resource acceptance deadline')),Math.max(1,config.deadlineAt-Date.now()-5000));process.on('uncaughtException',error=>void finish(error));process.on('unhandledRejection',error=>void finish(error));
 assert.equal(process.env.STUDIO_PROFILE_DIR,config.profile);for(const directory of [config.profile,config.sessionData,config.appData]){assert(!fs.existsSync(directory));fs.mkdirSync(directory);}app.setPath('appData',config.appData);app.setPath('userData',config.profile);app.setPath('sessionData',config.sessionData);
 const allowed=new Set(['state','conversation.list','conversation.groups','conversation.select','conversation.remember','task.list','workflow.list','worker.restore','worker.status','compute.profiles.list','compute.profiles.save','compute.profiles.read','compute.resource.status','compute.resource.activate','compute.resource.clear','sharedTerminal.list','sharedTerminal.open','sharedTerminal.read','sharedTerminal.input','sharedTerminal.resize','sharedTerminal.owner','sharedTerminal.close','scientific.skills','skills.catalog','tools.packages.list','tools.configurations.list','tools.configurations.context','agent.tools'].map(name=>'studio:'+name));
 const register=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,handler)=>{handlers.set(channel,handler);return register(channel,async(event,value)=>{
  const row={channel,at:Date.now(),keys:value&&typeof value==='object'?Object.keys(value):[]};receipt.ipc.push(row);lastEvent=event;
  try{
   assert(allowed.has(channel),'Forbidden native resource IPC: '+channel);
   if(channel==='studio:compute.profiles.save')assert.deepEqual(value,{expectedVersion:0,kind:'ssh',name:'Native controlled SSH resource',host:'controlled.invalid',username:'native-fixture',port:22,ssh_client:config.client,mode:'interactive'});
   if(channel==='studio:sharedTerminal.open')assert(fixtureProfile&&value.kind==='ssh'&&value.profileId===fixtureProfile.id&&value.version===fixtureProfile.version&&value.mode==='interactive');
   if(['studio:sharedTerminal.input','studio:sharedTerminal.owner','studio:sharedTerminal.read','studio:sharedTerminal.resize','studio:sharedTerminal.close'].includes(channel))assert(sessions.has(value.sessionId),'Only the fixture session may be operated');
   if(channel==='studio:sharedTerminal.input')assert(/^NATIVE_RESOURCE_[A-Za-z0-9_-]+\r$/.test(value.data),'Only fixed harmless local echo input is allowed');
   if(channel==='studio:conversation.remember')assert.deepEqual(value,{provider:'codex',threadId:config.syntheticThread,name:'Native resource engineering metadata',projectId:null});
   if(channel==='studio:conversation.select')assert(value.new===true&&Object.keys(value).length===1||value.id==='codex:'+config.syntheticThread);
   if(channel==='studio:agent.tools')assert.deepEqual(value,{provider:'codex'});
   const result=await handler(event,value);
   if(channel==='studio:compute.profiles.save'){fixtureProfile=result;row.fixtureProfileId=result.id;}
   if(channel==='studio:sharedTerminal.open'){sessions.add(result.sessionId);row.sessionId=result.sessionId;}
   if(channel==='studio:compute.resource.activate'){assert(sessions.has(result.sessionId));selectedResource=result;row.resource={kind:result.kind,selectionId:result.selectionId,sessionId:result.sessionId,agentReady:result.agentReady};}
   if(channel==='studio:worker.status')assert.equal(result.status,'disconnected');
   row.completed=true;return result;
  }catch(error){row.error=String(error.message||error);const expected=channel==='studio:sharedTerminal.input'&&/human_owned/.test(row.error)||['studio:sharedTerminal.read','studio:sharedTerminal.resize','studio:compute.resource.status'].includes(channel)&&/context_changed|selection_changed/.test(row.error);if(expected)row.expectedBoundary=true;else void finish(error);throw error;}
 });};
 app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,done)=>{const url=new URL(details.url),permitted=['file:','data:','about:','devtools:','chrome:'].includes(url.protocol);if(!permitted){receipt.network.push({protocol:url.protocol,hostname:url.hostname,blocked:true});done({cancel:true});void finish(Error('Native acceptance refuses network access'));}else done({cancel:false});}));
 app.on('browser-window-created',(_event,window)=>{if(owner){void finish(Error('Unexpected additional window'));return;}owner=window;window.webContents.on('preload-error',(_e,_p,error)=>void finish(error));window.webContents.on('render-process-gone',(_e,details)=>{if(!finishing)void finish(Error(details.reason));});window.webContents.once('did-finish-load',()=>{if(started)return;started=true;void check().then(()=>finish(),finish);});});
 async function until(label,read){for(let i=0;i<200;i++){if(finishing||finished)throw Error('Stopped '+label);const result=await read();if(result)return result;await pause(50);}throw Error('Timed out '+label);}
 async function click(selector){await evaluate(`(()=>{const value=document.querySelector(${JSON.stringify(selector)});if(!value||value.disabled||!value.getClientRects().length)throw Error('Unavailable native resource control');value.click();})()`);}
 const record=(name,details={})=>{receipt.checks.push({name,status:'passed',...details});save();};
 const resource=()=>invoke('compute.resource.status'),list=()=>invoke('sharedTerminal.list');
 async function chooser(){await click('[data-testid="unified-compute-entry"]');await until('actual chooser',()=>evaluate('!!document.querySelector(\'[data-testid="compute-resource-manager"]\')?.getClientRects().length'));await click('[data-profile-id="'+fixtureProfile.id+'"] [data-guide-target="saved-ssh"]');}
 async function check(){
  const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');assert.equal(sha(new URL(config.mainUrl)),config.mainSha256);assert.equal(sha(config.client),config.clientSha256);
  receipt.renderer=nativeRendererEvidence({preferences:owner.webContents.getLastWebPreferences(),configuredPreload:config.preload,expectedHash:config.preloadSha256,actualHash:sha(config.preload),sessionPreloads:owner.webContents.session.getPreloadScripts()});
  await until('production shell',()=>evaluate('!!document.querySelector(".shell")&&typeof window.studio?.invoke==="function"'));assert.equal((await invoke('worker.status')).status,'disconnected');
  await invoke('compute.profiles.save',{expectedVersion:0,kind:'ssh',name:'Native controlled SSH resource',host:'controlled.invalid',username:'native-fixture',port:22,ssh_client:config.client,mode:'interactive'});await chooser();
  const active=await until('real selected resource',async()=>{const value=await resource();return value.kind==='ssh-terminal'&&value.status==='selected'&&value.processStatus==='running'&&value;});assert.equal(active.profileId,fixtureProfile.id);assert.equal(active.agentReady,false);assert.equal(active.authentication,'not_observed');assert.equal(active.managedRuns,false);assert.equal((await invoke('worker.status')).status,'disconnected');
  await until('selected SSH sidebar/footer',()=>evaluate('(()=>{const side=document.querySelector(\'[data-testid="active-ssh-resource"]\')?.textContent||"",foot=document.querySelector(\'[data-testid="current-compute-resource-status"]\')?.textContent||"";return side.includes("由你操作")&&foot.includes("SSH")&&foot.includes("由你操作");})()'));record('Chooser opens the controlled local client and binds its exact saved profile/session without a worker',{selectionId:active.selectionId,sessionId:active.sessionId,authentication:active.authentication});
  let sessionValue=(await list()).sessions.find(value=>value.sessionId===active.sessionId);assert(sessionValue?.resource);const marker='NATIVE_RESOURCE_FIRST_'+Date.now();await invoke('sharedTerminal.input',{sessionId:active.sessionId,ownerEpoch:sessionValue.ownerEpoch,requestId:'native-echo-first',data:marker+'\r'});await until('real local echo',async()=>{const value=await invoke('sharedTerminal.read',{sessionId:active.sessionId,ownerEpoch:sessionValue.ownerEpoch});return value.output.includes('LOCAL_ECHO:'+marker);});record('Actual node-pty child receives and echoes bounded fixture stdin');
  await chooser();const reused=await until('same selected session reused',async()=>{const value=await resource();return value.sessionId===active.sessionId&&value.status==='selected'&&value;});assert.equal((await list()).sessions.length,1);assert.equal(sessions.size,1);record('Selecting the same saved profile reuses the existing terminal',{sessionId:reused.sessionId});
  const conversation=await invoke('conversation.remember',{provider:'codex',threadId:config.syntheticThread,name:'Native resource engineering metadata',projectId:null});assert.equal(conversation.id,'codex:'+config.syntheticThread);await invoke('conversation.select',{id:conversation.id});
  sessionValue=(await list()).sessions.find(value=>value.sessionId===active.sessionId);await invoke('sharedTerminal.owner',{sessionId:active.sessionId,ownerEpoch:sessionValue.ownerEpoch,owner:'agent'});
  const handed=await until('actual current Agent grant',async()=>{const value=await resource();return value.agentReady&&value.operator==='agent'&&value;});const tools=await invoke('agent.tools',{provider:'codex'});assert.equal(tools.status,'ready');assert.equal(tools.scope,'terminal-only');assert.equal(tools.scientificStatus,'blocked');assert.equal((await invoke('worker.status')).status,'disconnected');
  sessionValue=(await list()).sessions.find(value=>value.sessionId===active.sessionId);const denied=await invoke('sharedTerminal.input',{sessionId:active.sessionId,ownerEpoch:sessionValue.ownerEpoch,requestId:'native-human-denied',data:'NATIVE_RESOURCE_DENIED\r'}).then(()=>null,error=>String(error));assert.match(denied,/human_owned/);record('Synthetic saved conversation receives only an explicit terminal grant; human writes are denied while Agent owns it',{agentReady:handed.agentReady,toolsScope:tools.scope,syntheticConversation:true,modelCalls:0});
  const takeover=await evaluate('(()=>{const b=document.querySelector(\'[data-testid="shared-terminal-handoff"]\');return !!b&&!b.disabled&&b.textContent.includes("我来操作");})()');if(takeover)await click('[data-testid="shared-terminal-handoff"]');else await invoke('sharedTerminal.owner',{sessionId:active.sessionId,ownerEpoch:sessionValue.ownerEpoch,owner:'human'});
  await until('human control restored',async()=>{const value=await resource();return !value.agentReady&&value.operator==='human'&&value;});sessionValue=(await list()).sessions.find(value=>value.sessionId===active.sessionId);const last='NATIVE_RESOURCE_AFTER_'+Date.now();await invoke('sharedTerminal.input',{sessionId:active.sessionId,ownerEpoch:sessionValue.ownerEpoch,requestId:'native-human-after',data:last+'\r'});await until('same child still responds',async()=>{const value=await invoke('sharedTerminal.read',{sessionId:active.sessionId,ownerEpoch:sessionValue.ownerEpoch});return value.output.includes('LOCAL_ECHO:'+last);});assert.equal((await resource()).sessionId,active.sessionId);record('Human takeover keeps the same channel and restores actual echo',{takeover:takeover?'original UI button':'typed actual owner handler'});
  assert.equal(receipt.network.length,0);assert(receipt.ipc.every(row=>!row.error||row.expectedBoundary));assert(!receipt.ipc.some(row=>/agent\.(rpc|connect)|worker\.connect|compute\.connection\.|ssh\.auth\.|tools\.workflows\.(prepare|execute)/.test(row.channel)));receipt.sessionId=active.sessionId;
 }
 save();return import(config.mainUrl).catch(finish);
}

export async function runNativeSshResourceCheck({args=process.argv.slice(2),repoRoot=desktopRoot}={}){
 const started=Date.now(),prepareOnly=args.includes('--prepare-only'),filtered=args.filter(value=>value!=='--prepare-only'),options=parseNativeCheckArgs(filtered);
 if(options.timeoutMs>90000)throw Error('Native resource acceptance is bounded to 90000 ms');
 const context=prepareOnly?null:requireLaunchContext(),remaining=options.timeoutMs-(Date.now()-started);if(remaining<10000)throw Error('Native resource preflight exhausted its bounded budget');
 const prepared=prepareNativeSshResourceCheck({repoRoot,...options,timeoutMs:remaining});if(prepareOnly)return{status:'prepared',out:prepared.target,fixture:prepared.config.client};
 const binary=createRequire(import.meta.url)('electron');return launchPreparedNativeCheck({prepared,binary,context,repoRoot});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=await runNativeSshResourceCheck();console.log(JSON.stringify(result));process.exitCode=['passed','prepared'].includes(result.status)?0:1;}catch(error){console.error(JSON.stringify({status:error.preflight?'blocked':'failed',reason:error.preflight?.reason,message:error.message}));process.exitCode=error.preflight?2:1;}
}
