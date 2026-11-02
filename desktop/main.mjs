import {environmentApiTool,createEnvironmentApiReader} from './environment-api-read.mjs';
import {createSshConnection,installSshPrivacyLifecycle,requiresCurrentSshWorker,requireCurrentSshWorker,sshTaskSource,assertSshSource} from './ssh-connection.mjs';
import {createWorkbenchImageExporter} from './workbench-image.mjs';
import {taskOperation} from './task-operations.mjs';
import {workspaceController} from './workspaces.mjs';
import {explicitSetupStage} from './explicit-setup-stage.mjs';
import {createComputeOnboarding} from './compute-onboarding.mjs';
import {createComputeConnection} from './compute-connection.mjs';
import {customCvNumericDialog,referenceImportDialog} from './custom-cv-dialog.mjs';
import {registerTaskStage} from './task-stage-ipc.mjs';
import {localReviewDialog} from './local-review-dialog.mjs';
import {registerCalculationReview} from './task-consumer-ipc.mjs';
import {consumerReviewDialog} from './consumer-review-dialog.mjs';
import {ensureDefinitionContext} from './private-conversation-context.mjs';
import {resumeConversationContext} from './conversation-recovery.mjs';
import {definitionReply} from './private-definition-scope.mjs';
import {scientificToolReadiness} from './scientific-tool-readiness.mjs';
import {createAgentWorkflowContext} from './agent-workflow-context.mjs';
import {currentPrivateTurn} from './private-task-context.mjs';
import {createPrivateCvAccess,composeToolGuards} from './private-cv-access.mjs';
import {createTaskCustomCv} from './task-custom-cv.mjs';
import {currentPairTool,readCurrentPair} from './current-pair-tool.mjs';
import {importTaskAsset} from './task-asset-import.mjs';
import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, net, screen, nativeImage } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import {ensureTaskAuthoring} from './task-authoring.mjs';
import {readTaskInput} from './task-input-preview.mjs';
import {readTaskPygas,saveTaskPygas,initializeTaskPygas,bindComposition,compositionToolGuard} from './task-pygas.mjs';
import {visibleUserText} from '../shared/tool-activity.mjs';
import {ScientificSkills,validateScientificConsent,normalizeScientificSharing} from './scientific-skills.mjs';
import {deliverScientificTurn} from './scientific-turn.mjs';
import {MaterialsProject} from './materials-project.mjs';
import {discoverSources,sourceContext,toolInventory} from './source-projects.mjs';
import { localSkills } from './skills.mjs';
import { selectedSkillContext } from './skill-context.mjs';
import {agentConfig,STUDIO_INSTRUCTIONS} from './agent-settings.mjs';
import {saveDeployment,prepareDeployment} from './task-deployment.mjs';
import {saveDeploymentDraft,deploymentContext,createDeploymentProject} from './deployment-state.mjs';
import {openDeploymentSession} from './deployment-session.mjs';
import {executeTask} from './task-execution.mjs';
import {TaskRecords} from './task-records.mjs';
import {existingConnections,existingProfile} from './existing-ssh.mjs';
import {sshEndpoint} from './ssh-endpoint.mjs';
import { Catalog } from './catalog.mjs';
import { CodexBridge } from './codex.mjs';
import {validatePlan} from '../shared/workflows.mjs';
import {AgentHub,loginUrl} from './agent-hub.mjs';
import {CredentialVault,providerId} from './providers.mjs';
import { WorkerClient } from './worker.mjs';
import {readWorkerStatus} from './worker-status.mjs';
import {bundledWorkerRuntimeId} from './worker-service-version.mjs';
import {restoreTaskWorker} from './worker-restore.mjs';
import {explicitWorkerReceipt,rememberExplicitWorker,workerSettingsSignature,validExplicitBinding,taskWorkerTarget,validTransportPort,taskTransportScope,taskTransportReceipt} from './explicit-worker-binding.mjs';
import {taskWorkerSettings,sameWorkerBinding,taskWorkerSource,validTaskWorkerSource} from '../shared/task-worker-binding.mjs';
import {bindLegacyAuthoringWorker} from './task-authoring-binding.mjs';
import { assertRpc, assertRendererWorkerRoute, linuxPath, sshAlias, quoteShell } from './security.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here,'..');
const workerSource = app.isPackaged ? path.join(process.resourcesPath,'app.asar.unpacked','worker') : path.join(root,'worker');
// Physical resources keep skill references usable by an external agent process.
const bundledSkillRoot = app.isPackaged ? path.join(process.resourcesPath,'studio-skills') : path.join(root,'agents','skills');
function studioSkillRoots(){const sourceRoots=[...(settings.sourceRoots||[]),...(catalog?.list('source-binding')||[]).map(s=>s.root)];return [...new Set([bundledSkillRoot,...(settings.skillRoots||[]),...sourceRoots.map(p=>path.join(p,'agents','skills')).filter(p=>fs.existsSync(p))])];}
const installationVerifying=process.argv.includes('--studio-install-verify');
const improvementsVerifying=process.argv.includes('--studio-improvements-verify');
const providerVerifying=process.argv.includes('--studio-providers-verify');
const verifying=installationVerifying||improvementsVerifying||providerVerifying||process.argv.includes('--studio-verify');
const verificationRoot=process.env.STUDIO_VERIFY_ROOT||root;
if(process.env.STUDIO_PROFILE_DIR)app.setPath('userData',path.resolve(process.env.STUDIO_PROFILE_DIR));
else if(verifying)app.setPath('userData',path.join(verificationRoot,'.studio',improvementsVerifying?'verification-v'+app.getVersion():providerVerifying?'verification-providers':app.isPackaged?'verification-packaged':'verification-desktop'));
let window, catalog, settings, agents,taskRecords,materials;
let shuttingDown=false;
app.on("before-quit",()=>{shuttingDown=true;});
let scientificSkills,privateAccess,customCv,workflowContext,localReview;
const activeAuthoringTasks=new Map();
const codex = new CodexBridge({strictIsolation:true,isolationRoot:path.join(app.getPath('userData'),'provider-contexts','codex')}), worker = new WorkerClient(), terminals = new Map(), grants = new Map();
Object.defineProperty(worker,'bundledRuntimeId',{value:bundledWorkerRuntimeId(workerSource)});
const defaults = { distribution:'Ubuntu', workerRoot:'~/.local/state/gpu-sampling-studio',
  workerPort:8767, codexPath:'codex', cwd: app.isPackaged ? app.getPath('documents') : root,
  sourceRoots:[],skillRoots:[], theme:'dark', agentProvider:'codex',agentLayout:'right' };
function findCodex() {
  const directory = path.join(process.env.LOCALAPPDATA || '', 'OpenAI','Codex','bin');
  if (!fs.existsSync(directory)) return 'codex';
  const candidates = fs.readdirSync(directory).map(p => path.join(directory,p,'codex.exe'))
    .filter(p => fs.existsSync(p)).sort((a,b) => fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
  return candidates[0] || 'codex';
}
function findAgent(provider) {
  const entry=provider==='kimi'?'@moonshot-ai/kimi-code/dist/main.mjs':'@qwen-code/qwen-code/cli-entry.js';
  const candidates=[path.join(process.resourcesPath,'agent-runtimes','node_modules',entry),path.join(root,'node_modules',entry)];
  return candidates.find(p=>fs.existsSync(p))||provider;
}
function emit(channel,data) { if (window && !window.isDestroyed()) window.webContents.send(channel,data); }
codex.on('event', event => {
  if(event.method==='studio/codexDisconnected'&&agents?.isContextTransition?.('codex'))return;
  const tagged={...event,provider:'codex'};taskRecords?.event(tagged);emit('studio:event',tagged);
  if(event.method==='thread/started' && event.params?.thread&&!taskRecords?.deleted('codex',event.params.thread.id))
    catalog.put('thread',event.params.thread.id,event.params.thread);
});
codex.on('diagnostic', data => emit('studio:event',{ method:'studio/diagnostic',params:{text:data} }));
function trusted(event) {
  if(!window || event.sender.id!==window.webContents.id || event.senderFrame?.parent ||
      event.senderFrame?.url!==window.webContents.getURL()) throw new Error('Untrusted IPC sender');
}
function handle(name, fn) { ipcMain.handle('studio:'+name,async(event,data) => { if(shuttingDown||!window||window.isDestroyed()||window.webContents.isDestroyed()||event.sender.isDestroyed())return null;trusted(event); try{return await fn(data||{},event);}catch(error){if(shuttingDown)return null;throw error;} }); }
function openUrl(url) {
  const parsed = new URL(url);
  if(parsed.protocol !== 'https:' || !['chatgpt.com','auth.openai.com','login.openai.com'].includes(parsed.hostname))
    throw new Error('Unsupported login URL');
  return shell.openExternal(url);
}

async function initialize() {
catalog = new Catalog(path.join(app.getPath('userData'),'studio'));
settings = { ...defaults, codexPath:findCodex(),kimiPath:findAgent('kimi'),qwenPath:findAgent('qwen'), ...catalog.get('settings','main') };
const normalizedSharing=normalizeScientificSharing(settings);
if(normalizedSharing!==settings)settings=catalog.put('settings','main',normalizedSharing);
for(const provider of ['kimi','qwen']){const stored=settings[provider+'Path'];if(typeof stored==='string'&&/[\\\\/]/.test(stored)&&!fs.existsSync(stored))settings[provider+'Path']=findAgent(provider);}
if(typeof settings.codexPath==='string'&&/[\\\\/]/.test(settings.codexPath)&&!fs.existsSync(settings.codexPath))settings.codexPath=findCodex();
if(verifying&&!installationVerifying)settings={...settings,agentProvider:'codex',agentLayout:'right',kimiPath:findAgent('kimi'),qwenPath:findAgent('qwen'),language:'zh-CN',fontSize:13,editorFontSize:13,terminalFontSize:12,fontFamily:'system',workerRoot:JSON.parse(fs.readFileSync(path.join(verificationRoot,'.studio/validation/science.json'),'utf8')).desktop_worker_root,workerPort:8770};
if(installationVerifying){
 const config=JSON.parse(fs.readFileSync(process.env.STUDIO_INSTALL_CONFIG,'utf8'));
 const sourceIds=config.desktop.source_ids??[];if(!Array.isArray(sourceIds)||sourceIds.some(id=>!['pygas','pydyn','gpumd','hotpp','torchnep'].includes(id)))throw Error('Invalid installation source summary scope');
 settings=catalog.put('settings','main',{...settings,distribution:config.worker.distribution,workerRoot:config.worker.root,workerPort:config.worker.port||8767,cwd:root,sourceIds,agentProvider:config.desktop.agent_provider||'codex'});
}
agents=new AgentHub({fetchApi:(...args)=>net.fetch(...args),codex,root:path.join(app.getPath('userData'),'agents'),catalog,vault:new CredentialVault(path.join(app.getPath('userData'),'credentials'),safeStorage),settings:()=>settings,worker:provider=>worker.providerConnection(provider),releaseWorker:provider=>worker.revokeProvider(provider),bindWorkerContext:(provider,context,options)=>worker.bindProviderContext(provider,context,options)});
const scientificMap=JSON.parse(fs.readFileSync(path.join(here,'scientific-skill-map.json'),'utf8'));
const setupInstructions=explicitSetupStage({routes:new Map(scientificMap.functions.map(route=>[route.id,route])),current:()=>workflowContext?.current()});
scientificSkills=new ScientificSkills({map:scientificMap,bundledRoot:bundledSkillRoot,studioRoot:root,sources:scientificSources,settings:()=>settings,setupAllowed:(provider,route)=>setupInstructions.allowed(provider,route)});
const proposalTool={name:'propose_custom_cv',description:'Only after inspecting actual pyGAS library classes and discussing a missing/non-equivalent definition: save a typed formula/values/library_review private draft in this current conversation. It generates no code and grants no approval, sharing or execution. Human formula/code reviews and one exact CPU confirmation are separate. Prefer the real library and official examples first.',annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false},inputSchema:JSON.parse(fs.readFileSync(path.join(here,'custom-cv-tool-schema.json'),'utf8'))};
const privateReader={name:'read_custom_cv',description:'Read only the active conversation private CV after the human explicitly enables sharing with this provider. Never reads other library entries, approves or executes.',annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{workspace_id:{type:'string'}},required:['workspace_id'],additionalProperties:false}};
const readEnvironmentApi=createEnvironmentApiReader({worker,current:scope=>workflowContext.assertScope(scope)});
worker.setScopedTools([...scientificSkills.tools(),currentPairTool,proposalTool,privateReader,environmentApiTool],async(name,args,scope)=>{
 if(name==='inspect_environment_api')return readEnvironmentApi(args,scope);
 if(['read_pygas_workflow','propose_custom_cv','read_custom_cv'].includes(name))workflowContext.assertScope(scope);
 if(name==='read_pygas_workflow'){const result=await readCurrentPair({records:taskRecords,worker,activeTasks:activeAuthoringTasks,readTaskPygas,privateAccess:(task,provider)=>privateAccess.assertTask(task,provider)},args,scope);workflowContext.assertScope(scope);return result;}
 if(name==='propose_custom_cv'){const task=workflowContext.assertScope(scope);await privateAccess.assertTask(task,scope.provider);workflowContext.assertScope(scope);const result=await customCv.proposeDraft(args,scope);workflowContext.assertScope(scope);return result;}
 if(name==='read_custom_cv'){
  const task=workflowContext.assertScope(scope),id=task.id;
  if(args.workspace_id!==id||!task.customCv?.id)throw Error('Read only the selected private definition in this active conversation');
  await privateAccess.assertTask(task,scope.provider);workflowContext.assertScope(scope);
  const result=await worker.request('POST','/api/custom-cv/provider-read',{workspace_id:id,project_id:task.authoring.projectId,environment_id:task.authoring.environmentId,id:task.customCv.id,provider:scope.provider});
  const latest=workflowContext.assertScope(scope);await privateAccess.assertTask(latest,scope.provider);workflowContext.assertScope(scope);
  const permission=await worker.request('POST','/api/custom-cv/provider-status',{workspace_id:id,project_id:latest.authoring.projectId,environment_id:latest.authoring.environmentId,id:task.customCv.id,provider:scope.provider});
  workflowContext.assertScope(scope);if(!permission.allowed||JSON.stringify(permission.expected)!==JSON.stringify(result.entry?.expected))throw Error('Private definition sharing or revision changed before the reply');return definitionReply(result,workflowContext.assertScope(scope));
 }
 return scientificSkills.call(name,args,scope);
});
materials=new MaterialsProject({root:path.join(app.getPath('userData'),'credentials'),encryption:safeStorage,fetchApi:(...a)=>net.fetch(...a),worker});
worker.setLocalTools(materials.tools(),(name,args)=>materials.call(name,args));
handle('materials.status',()=>materials.status());
handle('materials.key',({apiKey,remove=false})=>remove?materials.clear():materials.save(apiKey));
handle('materials.search',({query})=>materials.search(query));
handle('materials.import',value=>materials.import(value));
taskRecords=new TaskRecords(catalog,event=>emit('studio:event',event));
workflowContext=createAgentWorkflowContext({records:taskRecords,activeTasks:activeAuthoringTasks,selectedProvider:()=>agents.active});
registerTaskStage({handle,records:taskRecords,worker,current:()=>workflowContext.current(),assertHuman:event=>{if(shuttingDown||!window||window.isDestroyed()||event.sender.isDestroyed())return false;trusted(event);return true;}});
localReview=registerCalculationReview({handle,records:taskRecords,worker,current:()=>workflowContext.current(),
 assertHuman:event=>{if(shuttingDown||!window||window.isDestroyed()||event.sender.isDestroyed())return false;trusted(event);return true;},
 receiptStore:{get:id=>catalog.get('local-input-review',id),put:(id,value)=>catalog.put('local-input-review',id,value)},
 consumerReceiptStore:{get:id=>catalog.get('local-consumer-input-review',id),put:(id,value)=>catalog.put('local-consumer-input-review',id,value)},
 targetReceiptStore:{get:id=>catalog.get('local-consumer-target-review',id),put:(id,value)=>catalog.put('local-consumer-target-review',id,value)},
 confirmTarget:async(scope,event)=>{trusted(event);const result=await dialog.showMessageBox(window,consumerReviewDialog(scope,settings.language));trusted(event);return result.response===1;},
 confirm:async(scope,event)=>{trusted(event);const result=await dialog.showMessageBox(window,(scope.kind==='consumer-science-native-scope-v1'?consumerReviewDialog(scope,settings.language):localReviewDialog(scope,settings.language)));trusted(event);return result.response===1;}
});

privateAccess=createPrivateCvAccess({records:taskRecords,worker,activeTasks:activeAuthoringTasks});
worker.setAuthoringGuard(composeToolGuards(privateAccess,compositionToolGuard(taskRecords,activeAuthoringTasks)));
customCv=createTaskCustomCv({records:taskRecords,worker,getProvider:()=>agents.active||settings.agentProvider||'codex',getActiveTaskId:provider=>activeAuthoringTasks.get(provider),assertProvider:context=>{workflowContext.assertScope(context);return providerId(context.provider);},assertHuman:event=>{trusted(event);return true;},access:()=>true,
 validateRuntimeReceipt:async(runtime,context)=>{const current=await worker.request('POST','/api/runtime-guide',{environment_id:context.args.environment_id,engine:'pygas.build'});return current.status==='observed'&&runtime.status==='observed'&&current.receipt===runtime.receipt_sha256;},
 confirmNumericScope:async({scope,task,structure},event)=>{
  trusted(event);const result=await dialog.showMessageBox(window,customCvNumericDialog({language:settings.language,scope,task,structure}));trusted(event);return result.response===1;
 },bindComposition:(records,id,result)=>bindComposition(records,id,result,undefined,'human')
});
for(const action of ['read','saveSpec','approveFormula','approveCode','sharing','validate','status','attach','reuse'])handle('customCv.'+action,(value,event)=>customCv.dispatch(action,value,event));
handle('task.pygas.importAsset',(value,event)=>{trusted(event);return importTaskAsset({records:taskRecords,worker,getProvider:()=>agents.active||'codex',assertHuman:()=>{if(shuttingDown||!window||window.isDestroyed()||event.sender.isDestroyed())return false;trusted(event);return true;},protectedRoots:[app.getPath('userData')],chooseFile:async()=>{const result=await dialog.showOpenDialog(window,referenceImportDialog(settings.language));return result.canceled?null:result.filePaths[0];}},value);});
agents.on('event',event=>{taskRecords.event(event);emit('studio:event',event);});
handle('task.create',value=>{const task=taskRecords.create(value);if(task.workflowVersion===2&&!task.authoring&&task.workspaceChoice===undefined){const workspace=catalog.list('workspace-index').find(w=>w.id===value.projectId&&JSON.stringify(w.workerBinding)===JSON.stringify(worker.identity));task.workspaceChoice=workspace?'workspace':'pending';if(workspace)task.workspace=workspace;return taskRecords.save(task);}return task;});
const workspaces=()=>workspaceController({records:taskRecords,worker,selection:()=>workflowContext.current(),assertIdle:assertIdleAgent,onBound:workspace=>catalog.put('workspace-index',workspace.workerBinding.distribution+':'+workspace.workerBinding.root+':'+workspace.id,{...workspace,assets:[]}),chooseFile:async()=>{const value=await dialog.showOpenDialog(window,{properties:['openFile']});return value.canceled?null:value.filePaths[0];},refreshContext:async task=>{const current=workflowContext.current();if(current.taskId===task.id){const ticket=workflowContext.begin(task.provider,task.threadId);await workflowContext.synchronize(ticket,(provider,context)=>agents.selectContext(provider,context));}}});
for(const [method,action]of [['workspace.list','list'],['workspace.create','create'],['workspace.select','select'],['workspace.keepDraft','keepDraft'],['workspace.import','importAsset'],['workspace.attach','attach']])handle(method,value=>action==='list'?workspaces()[action](value):taskOperation(taskRecords,value.taskId,'workspace-'+action,JSON.stringify(value),()=>workspaces()[action](value)));
handle('task.deployment.save',value=>saveDeployment(taskRecords,value,localReview,worker));
handle('task.deployment.draft',value=>saveDeploymentDraft(taskRecords,worker,value));
handle('task.deployment.context',value=>deploymentContext(taskRecords,worker,value));
handle('task.deployment.open',value=>openDeploymentSession({records:taskRecords,workflowContext,agents,assertIdle:assertIdleAgent,connect:async task=>{
 const source=taskWorkerSource(task);
 // Opening deployment is read-only. An unavailable original service stays
 // offline until the human reviews the same source in the connection guide.
 if(!source)return;
 const observed=await restoreTaskWorker({records:taskRecords,catalog,worker,settings:()=>settings,selection:()=>workflowContext.current(),selectionEpoch:()=>workflowContext.revision()},{taskId:task.id});
 if(observed.status==='connected')emit('studio:event',{method:'studio/workerConnected',params:{}});
}},value));
handle('task.deployment.createProject',value=>{assertIdleAgent();return createDeploymentProject(taskRecords,worker,value);});
handle('task.deployment.prepare',value=>prepareDeployment(taskRecords,worker,value,localReview));
handle('task.list',()=>catalog.list('agent-task'));
handle('task.read',({id})=>taskRecords.read(id));
handle('task.input.read',value=>readTaskInput(taskRecords,worker,value));
handle('task.pygas.read',value=>readTaskPygas(taskRecords,worker,value));
handle('task.pygas.initialize',value=>initializeTaskPygas(taskRecords,worker,value,()=>workflowContext.current()));
handle('task.pygas.save',value=>saveTaskPygas(taskRecords,worker,value));
handle('task.pygas.normalize',value=>saveTaskPygas(taskRecords,worker,value,true));
handle('task.edit',value=>taskRecords.edit(value));
handle('task.execute',value=>executeTask(taskRecords,worker,value,localReview));
handle('task.linkRun',async({taskId,runId,kind,expectedPrepared})=>{if(!['run','cluster-run'].includes(kind)||typeof runId!=='string')throw Error('Invalid run reference');const run=await worker.request('POST',kind==='run'?'/api/run/status':'/api/cluster/status',{run_id:runId});return taskRecords.linkRun(taskId,run,expectedPrepared);});
handle('conversation.delete',({id})=>{assertIdleAgent();const result=taskRecords.remove(id);workflowContext.clear(result.provider);agents.disconnect(result.provider);agents.forget(result.provider,result.threadId);scientificSkills.context.forget(result.id);return result;});
handle('conversation.list',()=>taskRecords.conversations());
handle('conversation.remember',value=>taskRecords.remember(value));
handle('conversation.groups',()=>taskRecords.groups());
handle('conversation.createGroup',value=>taskRecords.createGroup(value));
handle('conversation.organize',value=>taskRecords.organize(value));
handle('conversation.rename',value=>{if(!value||Object.keys(value).sort().join(',')!=='id,name')throw Error('Invalid typed conversation name');return taskRecords.rename(value);});
handle('conversation.select',async({id})=>{if(typeof id!=='string')throw Error('Invalid conversation');const conversation=catalog.get('conversation',id);if(!conversation)throw Error('Unknown conversation');assertIdleAgent();if(agents.active!==conversation.provider){workflowContext.clear(agents.active);agents.disconnect(agents.active);}const ticket=workflowContext.begin(conversation.provider,conversation.threadId);await workflowContext.synchronize(ticket,(provider,context)=>agents.selectContext(provider,context));workflowContext.assert(ticket);return {...conversation,task:conversation.taskId?taskRecords.read(conversation.taskId):null};});
handle('ssh.existing',()=>existingConnections(app.getPath('home')));
handle('ssh.import',({ref})=>existingProfile(app.getPath('home'),ref));
handle('cluster.download',async value=>{
 const first=await worker.request('POST','/api/cluster/browse',{...value,offset:0});
 if(typeof first.base64!=='string'||!first.sha256)throw Error('Select a regular file in an authorized read root');
 const response=await dialog.showSaveDialog(window,{defaultPath:path.basename(value.relative)});
 if(response.canceled)return null;
 const file=response.filePath,temp=file+'.partial-'+randomUUID(),fd=fs.openSync(temp,'w'),hash=createHash('sha256');let current=first,offset=0;
 try{for(;;){const data=Buffer.from(current.base64,'base64');if(!data.length&&offset<first.size)throw Error('Remote file changed');fs.writeSync(fd,data);hash.update(data);offset=current.offset;if(offset>=first.size)break;current=await worker.request('POST','/api/cluster/browse',{...value,offset});if(current.size!==first.size)throw Error('Remote file changed');}if(hash.digest('hex')!==first.sha256)throw Error('Remote file hash mismatch');}finally{fs.closeSync(fd);}
 fs.renameSync(temp,file);
 return {path:file,bytes:offset,sha256:first.sha256};
});
handle('agent.bindProject',({projectId,provider})=>{providerId(provider);if(typeof projectId!=='string'||!projectId||projectId.length>100)throw Error('Select a project');settings=catalog.put('settings','main',{...settings,projectAgents:{...settings.projectAgents,[projectId]:provider}});return {projectId,provider};});
handle('state',() => ({ settings, threads:catalog.list('thread'), ssh:catalog.list('ssh') }));
handle('settings',data => {
  const next={...settings,...data};
  if(next.autoDiscoverCompute!==undefined&&typeof next.autoDiscoverCompute!=='boolean')throw Error('Invalid compute discovery preference');
  if(!/^[\w .-]{1,80}$/.test(next.distribution) || !Number.isInteger(next.workerPort) ||
     next.workerPort<1024 || next.workerPort>65535 ||
     !/^~\/|^\//.test(next.workerRoot)) throw new Error('Invalid WSL settings');
  agentConfig(next.agent);
  if(!['right','center'].includes(next.agentLayout||'right'))throw Error('Unsupported workspace layout');
  providerId(next.agentProvider||'codex');
  for(const key of ['kimiPath','qwenPath'])if(next[key]!==undefined&&(typeof next[key]!=='string'||/[\r\n\0]/.test(next[key])))throw Error('Invalid CLI path');
  if(!['zh-CN','en'].includes(next.language||'zh-CN'))throw Error('Unsupported language');
  for(const [key,min,max] of [['fontSize',12,24],['minimumFontSize',11,18],['chatFontSize',12,28],['editorFontSize',10,28],['terminalFontSize',10,24]])
    if(next[key]!==undefined&&(!Number.isInteger(next[key])||next[key]<min||next[key]>max))throw Error('Invalid font size');
  if(next.fontFamily && !['system','sans','serif'].includes(next.fontFamily))throw Error('Unsupported font');
  if(!Array.isArray(next.pygasSkillProviders||[])||(next.pygasSkillProviders||[]).some(p=>!['codex','kimi','qwen','deepseek','compatible'].includes(p)))throw Error('Invalid skill sharing provider scope');
  validateScientificConsent(next.scientificSkillProviders);
  if(next.sourceIds!==undefined&&(!Array.isArray(next.sourceIds)||next.sourceIds.some(id=>!['pygas','pydyn','gpumd','hotpp','torchnep'].includes(id))))throw Error('Invalid source allowlist');
  if(!Array.isArray(next.sourceRoots||[])||(next.sourceRoots||[]).some(v=>typeof v!=='string'||!path.isAbsolute(v)))throw Error('Source roots must be absolute paths');
  if(!Array.isArray(next.skillRoots)) throw new Error('Skill roots must be an array');
  settings=catalog.put('settings','main',next); return settings;
});
function scientificSources(){return discoverSources({cwd:settings.cwd,applicationRoot:app.isPackaged?undefined:root,ids:settings.sourceIds,roots:[...(settings.sourceRoots||[]),...catalog.list('source-binding').map(v=>v.root)]});}
async function bindSources(current=()=>{}){const sources=scientificSources();for(const source of sources){current();await worker.request('POST','/api/source-projects',{...source,root:linuxPath(source.root)});current();catalog.put('source-binding',source.id,source);}return sources;}
handle('sources.list',()=>scientificSources());
handle('sources.diagnose',async()=>{const sources=scientificSources();return {sources,tools:toolInventory(sources),worker:worker.connection?await worker.request('GET','/api/tools/status'):null};});
function assertIdleAgent(){if([codex,...agents.bridges.values()].some(b=>b.activeTurns?.size))throw Error('请先停止当前回复，再调整连接或上下文设置');}
const configureCompute=createComputeOnboarding({worker,publish:event=>emit('studio:event',event)});
function discoverCompute(){if(settings.autoDiscoverCompute!==false)return configureCompute().catch(()=>null);return Promise.resolve(null);}
handle('compute.setup',async data=>configureCompute(data||{}));
const computeConnection=createComputeConnection({worker,records:taskRecords,catalog,settings:()=>settings,selection:()=>workflowContext.current(),selectionEpoch:()=>workflowContext.revision(),source:()=>({path:workerSource,id:worker.bundledRuntimeId}),beforeSwitch:()=>{assertIdleAgent();agents.close();},bindFreshSources:bindSources,saveSettings:target=>{settings=catalog.put('settings','main',{...settings,distribution:target.distribution,workerRoot:target.workerRoot,workerPort:target.workerPort});},remember:(target,evidence)=>{const value={version:1,distribution:worker.identity?.distribution,root:worker.identity?.root,port:target.workerPort,intent:evidence.intent||'standard',settingsSignature:workerSettingsSignature(settings),checkedAt:evidence.checkedAt,...evidence.serviceVersion==='current'?{sourceIdentity:{runtimeId:worker.bundledRuntimeId}}:{}};if(!validExplicitBinding(value,settings)||worker.connection?.health?.root!==value.root||worker.connectionTarget?.port!==value.port)throw Error('Verified connection receipt changed');catalog.put('worker-binding','last-explicit',value);},onConnected:()=>emit('studio:event',{method:'studio/workerConnected',params:{}})});
handle('compute.connection.plan',value=>computeConnection.plan(value));
handle('compute.connection.status',value=>computeConnection.status(value));
handle('compute.connection.connect',value=>{assertIdleAgent();return computeConnection.connect(value);});
handle('compute.connection.cancel',value=>computeConnection.cancel(value));
const sshConnection=createSshConnection({worker,selection:()=>workflowContext.current(),revision:()=>workflowContext.revision(),sourceScope:request=>sshTaskSource(taskRecords,()=>workflowContext.current(),request),assertSource:request=>assertSshSource(sshTaskSource(taskRecords,()=>workflowContext.current(),request),worker),validateRunReceipt:(request,receipt)=>{const proof=sshTaskSource(taskRecords,()=>workflowContext.current(),request);assertSshSource(proof,worker);if(proof?.preparedProject&&proof.preparedProject!==receipt.projectId)throw Error('original_run_changed');},beforeStart:assertIdleAgent,observeWorker:()=>readWorkerStatus(worker,()=>settings)});
handle('ssh.auth.plan',(value,event)=>sshConnection.plan(value,event));
handle('ssh.auth.start',(value,event)=>sshConnection.start(value,event));
handle('ssh.auth.read',(value,event)=>sshConnection.read(value,event));
handle('ssh.auth.input',(value,event)=>sshConnection.input(value,event));
handle('ssh.auth.resize',(value,event)=>sshConnection.resize(value,event));
handle('ssh.auth.finish',(value,event)=>sshConnection.finish(value,event));
handle('ssh.auth.closed',(value,event)=>sshConnection.closed(value,event));
handle('ssh.tunnel.plan',(value,event)=>sshConnection.tunnelPlan(value,event));
handle('ssh.tunnel.start',(value,event)=>sshConnection.tunnelStart(value,event));
handle('ssh.tunnel.status',(value,event)=>sshConnection.tunnelStatus(value,event));
handle('ssh.tunnel.close',(value,event)=>sshConnection.tunnelClose(value,event));
handle('worker.connect',async()=>{assertIdleAgent();agents.close();const target={...settings},result=await worker.connect(target,workerSource),receipt=explicitWorkerReceipt(worker,target);await bindSources();await rememberExplicitWorker({catalog,worker,settings:()=>settings},receipt);discoverCompute();emit('studio:event',{method:'studio/workerConnected',params:{}});return result;});
handle('worker.status',()=>readWorkerStatus(worker,()=>settings));
handle('worker.restore',value=>restoreTaskWorker({records:taskRecords,catalog,worker,settings:()=>settings,selection:()=>workflowContext.current(),selectionEpoch:()=>workflowContext.revision()},value));
handle('task.authoring.bindWorker',value=>{assertIdleAgent();return bindLegacyAuthoringWorker({records:taskRecords,worker,selection:()=>workflowContext.current(),settings:()=>settings},value);});
handle('worker.request',async({method,target,data}) => {
  assertRendererWorkerRoute(method,target);
  const route=new URL(target,'http://127.0.0.1').pathname;
  if(method==='POST'&&['/api/clusters','/api/cluster/test'].includes(route)&&requiresCurrentSshWorker(route==='/api/cluster/test'?data?.connection:data))await requireCurrentSshWorker(worker,()=>readWorkerStatus(worker,()=>settings));
  if(method==='POST'&&['/api/cluster/probe','/api/cluster/browse'].includes(route)&&data?.cluster_id){const connection=worker.connection,epoch=worker.connectionEpoch,observed=await readWorkerStatus(worker,()=>settings);if(observed.status!=='connected'||observed.serviceVersion!=='current'){const profile=await worker.request('POST','/api/cluster/profile',{cluster_id:data.cluster_id});if(worker.connection!==connection||worker.connectionEpoch!==epoch||requiresCurrentSshWorker(profile))throw Error('needs_worker_update');}}
  const result=await worker.request(method,target,data);
  if(method==='GET' && ['/api/projects','/api/environments'].includes(target))
    for(const item of result) catalog.put(target.split('/').at(-1),item.id,item);
  return result;
});
handle('codex.connect',async() => agents.connect('codex'));
handle('codex.configure',async({preferences={},threadId,model}) => {
  assertIdleAgent();
  agentConfig(preferences);
  settings=catalog.put('settings','main',{...settings,agent:preferences});
  return agents.configure('codex',preferences,threadId,model);
});
handle('codex.rpc',value=>agentRpc({...value,provider:'codex'}));
handle('workflow.list',()=>catalog.list('workflow-plan'));
handle('workflow.save',value=>{
 const plan=validatePlan(value),id=value.id;
 if(id!==undefined&&(typeof id!=='string'||!catalog.get('workflow-plan',id)))throw Error('Unknown workflow plan');
 const key=id||randomUUID();return catalog.put('workflow-plan',key,{...plan,id:key,status:'draft',updatedAt:Date.now()});
});
async function scientificTools(provider){
 return scientificToolReadiness({worker,codex,workflowContext,records:taskRecords,privateAccess,selectedProvider:()=>agents.active},provider);
}
handle('agent.connect',async({provider,repairTools=false})=>{
 providerId(provider);if(typeof repairTools!=='boolean')throw Error('Invalid repair request');
 if(repairTools){
  assertIdleAgent();const revision=workflowContext.revision(),owner=workflowContext.current(),connection=worker.connection,epoch=worker.connectionEpoch;
  const task=owner?.taskId?taskRecords.read(owner.taskId):null;let source,target;try{source=taskWorkerSource(task);target=task?taskWorkerTarget(task,settings,catalog):settings;}catch{throw Error('请先通过“连接计算资源”核对原服务来源和端口，再修复工具连接。');}
  if(task&&(!source||!target||!validTransportPort(target.workerPort)))throw Error('请先通过“连接计算资源”核对原服务来源和端口，再修复工具连接。');
  const transportScope=task?taskTransportScope(task):null,transportReceipt=task?taskTransportReceipt(task,catalog):null;
  const observed=await readWorkerStatus(worker,()=>target||settings);
  if(observed.status!=='connected'||workflowContext.revision()!==revision||worker.connection!==connection||worker.connectionEpoch!==epoch||task&&(JSON.stringify(transportScope)!==JSON.stringify(taskTransportScope(taskRecords.read(task.id)))||JSON.stringify(transportReceipt)!==JSON.stringify(taskTransportReceipt(taskRecords.read(task.id),catalog)))||source&&(!sameWorkerBinding(source.binding,worker)||worker.connectionTarget?.port!==target.workerPort))throw Error('请先通过“连接计算资源”恢复此流程的原作业服务，再修复工具连接。');
  assertIdleAgent();
  agents.close();
 }
 // Account recovery does not install/start/switch compute. App restores its saved binding separately.
 settings=catalog.put('settings','main',{...settings,agentProvider:provider});
 if(!repairTools&&worker.connection&&!worker.connecting&&!worker.restoring){await bindSources();await discoverCompute();}
 const info=await agents.connect(provider),tools=await scientificTools(provider);
 emit('studio:event',{method:'studio/toolsStatus',provider,params:tools});
 return {...info,tools};
});
handle('agent.tools',async({provider})=>{providerId(provider);return scientificTools(provider);});
handle('agent.disconnect',({provider})=>{providerId(provider);workflowContext.clear(provider);agents.disconnect(provider);return {};});
handle('agent.account',({provider})=>agents.account(provider));
async function agentRpc({provider,method,params={}}){
 providerId(provider);assertRpc(method);
 const {studioSkillId,studioTurnRequestId,...protocolParams}=params;params=protocolParams;
 if(studioTurnRequestId!==undefined&&(typeof studioTurnRequestId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(studioTurnRequestId)))throw Error('Invalid turn request identity');
 if(studioSkillId!==undefined&&(typeof studioSkillId!=='string'||!scientificSkills.router.routes.has(studioSkillId)))throw Error('Choose a listed scientific function');
 if(method==='turn/steer'){
  const task=taskRecords.bound(provider,params.threadId);
  if(task&&(await privateAccess.assertTask(task,provider)).definitionOnly)throw Error('Send a new definition-only message after the current reply completes; private steering does not accept automatic workspace context');
 }
 let ticket,skillContext,skillKey;
 const check=()=>{if(ticket)workflowContext.assert(ticket);};
 const synchronize=async()=>{check();await workflowContext.synchronize(ticket,(p,context)=>agents.selectContext(p,context));check();};
 if(['thread/start','thread/resume','turn/start'].includes(method)){
  assertIdleAgent();ticket=workflowContext.begin(provider,method==='thread/start'?null:params.threadId);await synchronize();
 }
 if(method==='turn/start'){
  let task=taskRecords.bound(provider,params.threadId);
  if(task){const access=await privateAccess.assertTask(task,provider);check();if(access.definitionOnly){
   if(params.reviewMode===true)throw Error('Current sharing covers only this private definition; full workflow review needs separately selected input-file permission');
   const {planningMode,studioTaskId,reviewMode,...privateParams}=params;currentPrivateTurn(privateParams,task);
   if(provider!=='codex')throw Error('Definition-only sharing requires an isolated fresh Codex context; this provider is not yet supported for private definitions');
   const clean=await ensureDefinitionContext({records:taskRecords,workflowContext,agents,task,ticket,model:params.model,publish:event=>emit('studio:event',event)});ticket=clean.ticket;check();params={...params,threadId:clean.task.threadId};
  }}
 }
 skillKey=provider+':'+params.threadId;
 if(method==='turn/start'){
  const before=taskRecords.bound(provider,params.threadId);let definitionOnly=!!before?.customCv?.id;if(before&&worker.connection){definitionOnly=(await privateAccess.assertTask(before,provider)).definitionOnly;check();}
  if(definitionOnly&&params.reviewMode===true)throw Error('Current sharing covers only this private definition; full workflow review needs separately selected input-file permission');
  const text=visibleUserText(params.input||[]);
  const authoring=definitionOnly?null:await ensureTaskAuthoring(taskRecords,worker,{provider,threadId:params.threadId,taskId:params.studioTaskId,text,allowExplicitInputs:params.reviewMode!==true,assertCurrent:check});check();
  if(authoring)params={...params,input:[...(params.input||[]).filter((c,i)=>!(i>0&&c.type==='text'&&c.text.startsWith('[Studio workspace context]'))),{type:'text',text:authoring.text}]};
  let bound=taskRecords.bound(provider,params.threadId);if(bound){definitionOnly=(await privateAccess.assertTask(bound,provider)).definitionOnly;check();}
  const privateReview=params.reviewMode===true;
  await synchronize();
  if(provider==='codex'&&!agents.threadReady(params.threadId)){
   const resumed=await resumeConversationContext({records:taskRecords,workflowContext,agents,ticket,threadId:params.threadId,model:params.model,publish:event=>emit('studio:event',event)});ticket=resumed.ticket;check();
   if(resumed.result.studioRecovery?.status==='required')return resumed.result;
   params={...params,threadId:resumed.result.thread.id};skillKey=provider+':'+params.threadId;bound=taskRecords.bound(provider,params.threadId);
  }
  params=taskRecords.prepareTurn(provider,params);check();await synchronize();
  if(definitionOnly)params=currentPrivateTurn(params,bound,{review:privateReview});
  // Public software guidance is selected only for the actual current intent.
  const prepareGuidance=()=>scientificSkills.context.prepare(skillKey,provider,definitionOnly?{text,parameters:{},hasWorkflow:false,manualFunction:'pygas.custom-cv'}:{text,parameters:bound?.parameters||{},hasWorkflow:!!bound,manualFunction:studioSkillId});
  const explicitSetup=!definitionOnly&&studioSkillId&&['installation','setup','toolchain'].includes(scientificSkills.router.routes.get(studioSkillId)?.phase);
  skillContext=await(explicitSetup?setupInstructions.prepare(provider,studioSkillId,prepareGuidance):prepareGuidance());check();
  if(!definitionOnly&&bound?.parameters?.engine&&worker.connection){
   const environment_id=bound.deployment?.config?.environmentId||bound.authoring?.environmentId,engine=bound.parameters.engine;
   if(environment_id){const selection={environment_id,engine};let guide;try{guide=await worker.request('POST','/api/runtime-guide',selection);}catch{guide={status:'blocked',reason:'Selected runtime guide unavailable; use an exact selected-engine probe, not an automatic reinstall'};}check();skillContext=scientificSkills.context.mergeRuntime(skillKey,provider,skillContext,guide,selection);}
  }
  if(skillContext.attach||['blocked','permission_required'].includes(skillContext.status))params={...params,input:[...(params.input||[]),{type:'text',text:skillContext.text}]};
  if(!definitionOnly)params={...params,input:[...(params.input||[]),{type:'text',text:sourceContext(scientificSources())}]};
  if(['deepseek','compatible'].includes(provider)){const task=taskRecords.bound(provider,params.threadId);params={...params,studioToolContext:task?{mode:'workflow',taskId:task.id,projectId:task.projectId}:{mode:'chat'}};}
  const registeredRoots=definitionOnly?[]:studioSkillRoots(),registered=definitionOnly?[]:localSkills(registeredRoots),input=[];
  for(const item of params.input||[]){
   if(item.type==='text')input.push(item);
   else if(item.type==='skill'){
    const context=await selectedSkillContext({selection:item,registered,registeredRoots,bundledRoot:bundledSkillRoot,validatePrivateProfile:async value=>{const validator=app.isPackaged?path.join(process.resourcesPath,'studio-tools','localize-skill.mjs'):path.join(root,'scripts','localize-skill.mjs');return (await import(pathToFileURL(validator).href)).validateProfile(value);}});check();
    input.push({type:'text',text:context.text});
   }else if(provider==='codex')input.push(item);else throw Error('Unsupported input content');
  }
  params={...params,input};
 }
 let result;
 try{check();if(provider==='codex'&&method==='thread/resume'){const restored=await resumeConversationContext({records:taskRecords,workflowContext,agents,ticket,threadId:params.threadId,model:params.model,publish:event=>emit('studio:event',event)});ticket=restored.ticket;result=restored.result;}else result=method==='turn/start'?await deliverScientificTurn({provider,key:skillKey,threadId:params.threadId,requestId:studioTurnRequestId||randomUUID(),context:skillContext,manager:scientificSkills.context,dispatch:()=>{check();return agents.rpc(provider,method,params);},emit:event=>emit('studio:event',event)}):await agents.rpc(provider,method,params);check();}
 catch(error){if(method==='turn/start'){try{check();taskRecords.failedTurn(provider,params.threadId,error);}catch{}}throw error;}
 if(method==='thread/start'){if(!result.thread?.id)throw Error('The server did not return a real conversation');workflowContext.started(ticket,result.thread.id);await synchronize();}
 if(provider==='codex'&&['thread/start','thread/resume'].includes(method)&&result.thread)catalog.put('thread',result.thread.id,result.thread);
 if(provider==='codex'&&method==='account/login/start'&&result.authUrl)await openUrl(result.authUrl);
 return result;
}
handle('agent.rpc',agentRpc);
handle('agent.recover',async({provider,threadId,model})=>{
 if(provider!=='codex'||typeof threadId!=='string'||!threadId||threadId.length>200||model!==undefined&&(typeof model!=='string'||!model||model.length>200))throw Error('Invalid conversation recovery request');
 assertIdleAgent();const current=workflowContext.current();if(current?.provider!==provider||current.threadId!==threadId)throw Error('Select this conversation before rebuilding its connection');
 const ticket=workflowContext.begin(provider,threadId);await workflowContext.synchronize(ticket,(p,context)=>agents.selectContext(p,context));
 return (await resumeConversationContext({records:taskRecords,workflowContext,agents,ticket,threadId,model,explicit:true,publish:event=>emit('studio:event',event)})).result;
});
handle('agent.respond',({provider,id,result})=>agents.respond(provider,id,result));
handle('agent.configure',async({provider,preferences={},threadId,model})=>{
  assertIdleAgent();
  providerId(provider);if(provider!=='codex')throw Error('Context budget changes are not supported by this ACP provider');
  agentConfig(preferences);settings=catalog.put('settings','main',{...settings,agent:preferences});await agents.configure(provider,preferences);return threadId?agentRpc({provider,method:'thread/resume',params:{threadId,model}}):{configured:true};
});
handle('agent.login',async({provider,...value})=>{
  assertIdleAgent();
  if(provider==='compatible'&&value.sharePublicGuides!==undefined&&typeof value.sharePublicGuides!=='boolean')throw Error('Invalid public guide sharing choice');
  const previousEndpoint=provider==='compatible'?agents.vault.get('compatible')?.baseUrl:null;
  const result=await agents.login(provider,value);
  if(provider==='compatible'&&(value.sharePublicGuides!==undefined||previousEndpoint!==result.baseUrl)){
   const shared=!!value.sharePublicGuides,scope=providers=>[...(providers||[]).filter(p=>p!=='compatible'),...shared?['compatible']:[]],sources={...settings.scientificSkillProviders};
   for(const source of ['pydyn','gpumd','hotpp','torchnep'])sources[source]=scope(sources[source]);
   settings=catalog.put('settings','main',{...settings,pygasSkillProviders:scope(settings.pygasSkillProviders),scientificSkillProviders:sources});
  }
  if(result.phase==='configured'||result.phase==='completed'||result.credentialStored)emit('studio:event',{method:'studio/accountUpdated',provider,params:{credentialsChanged:true}});
  if(provider==='codex'&&result.url)await openUrl(result.url);
  return result;
});
handle('agent.login.cancel',()=>{agents.cancelLogin();return {};});
handle('agent.logout',async value=>{if(!value||Object.keys(value).join(',')!=='provider')throw Error('Invalid typed account request');assertIdleAgent();const result=await agents.logout(value.provider);emit('studio:event',{method:'studio/accountUpdated',provider:value.provider,params:{credentialsChanged:true}});return result;});
handle('agent.testConnection',async value=>{if(!value||Object.keys(value).join(',')!=='provider')throw Error('Invalid typed account request');assertIdleAgent();return agents.testConnection(value.provider);});
handle('agent.login.open',async({provider})=>{
  const state=await agents.account(provider);if(!state.url)throw Error('Start provider login first');return shell.openExternal(loginUrl(provider,state.url));
});
handle('skills.catalog',()=>localSkills(studioSkillRoots()));
handle('scientific.skills',({provider})=>{providerId(provider);return scientificSkills.catalog(provider);});
handle('codex.respond',({id,result})=>codex.respond(id,result));
handle('file.open',async() => {
  const response=await dialog.showOpenDialog(window,{properties:['openFile']});
  if(response.canceled) return null;
  const file=response.filePaths[0], stat=fs.statSync(file);
  if(stat.size>2*1024*1024) throw new Error('Text editor limit is 2 MiB');
  const id=randomUUID(); grants.set(id,file);
  return { id,path:file,name:path.basename(file),content:fs.readFileSync(file,'utf8') };
});
handle('file.save',async({id,content,name}) => {
  if(typeof content!=='string' || content.length>2*1024*1024) throw new Error('Text source exceeds 2 MiB');
  let file=grants.get(id);
  if(!file) {
    const response=await dialog.showSaveDialog(window,{defaultPath:name||'workflow.py'});
    if(response.canceled) return null;
    file=response.filePath; id=randomUUID(); grants.set(id,file);
  }
  fs.writeFileSync(file,content,'utf8'); return { id,path:file,name:path.basename(file) };
});
handle('file.choose',async({directory=false}) => {
  const response=await dialog.showOpenDialog(window,{properties:[directory?'openDirectory':'openFile']});
  return response.canceled?null:response.filePaths[0];
});
handle('ssh.save',({alias,name}) => {
  alias=sshAlias(alias); return catalog.put('ssh',alias,{alias,name:name||alias});
});
handle('ssh.browse',async({alias,directory='.',file}) => {
  alias=sshAlias(alias);
  const script=file ?
    'import pathlib,json,sys;p=pathlib.Path(sys.argv[1]).expanduser();s=p.stat();assert s.st_size<=262144;print(json.dumps({"path":str(p),"content":p.read_text()}))' :
    'import pathlib,json,sys;p=pathlib.Path(sys.argv[1]).expanduser().resolve();print(json.dumps({"path":str(p),"entries":[{"name":x.name,"directory":x.is_dir(),"size":x.stat().st_size} for x in list(p.iterdir())[:1000]]}))';
  const command='python3 -c '+quoteShell(script)+' '+quoteShell(file||directory);
  const {stdout}=await exec('ssh.exe',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
    '-o','ConnectTimeout=10',alias,command],{windowsHide:true,timeout:20000,maxBuffer:1024*1024});
  return JSON.parse(stdout);
});
handle('terminal.start',async({kind,alias,clusterId}) => {
  if(terminals.size>=4) throw new Error('Close an existing terminal before opening another');
  const id=randomUUID();
  let child, protocol=false;
  if(kind==='cluster'){
    const p=await worker.request('POST','/api/cluster/profile',{cluster_id:clusterId});
    if(p.auth_mode==='interactive')throw Error('请在集群连接页打开私有认证；普通 SSH 终端不能代替受控认证会话。');
    const endpoint=sshEndpoint(p);
    const args=['-tt','-l',endpoint.username,'-p',String(p.port),'-o','StrictHostKeyChecking=yes'];
    if(p.identity_file)args.push('-i',p.identity_file);
    if(p.proxy_jump?.length)args.push('-J',p.proxy_jump.join(','));
    args.push(endpoint.host);
    if(p.via?.length){const inner=p.via.reduceRight((cmd,hop)=>'ssh -tt -o StrictHostKeyChecking=yes '+quoteShell(hop)+(cmd?' '+quoteShell(cmd):''),'');args.push(inner);}
    const native=p.ssh_client.startsWith('/mnt/c/')?'C:/'+p.ssh_client.slice(7):p.ssh_client;
    child=/^[A-Za-z]:/.test(native)?spawn(native,args,{stdio:['pipe','pipe','pipe'],windowsHide:true}):spawn('wsl.exe',['-d',settings.distribution,'--',native,...args],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  }
  else if(kind==='ssh') child=spawn('ssh.exe',['-tt',sshAlias(alias)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  else {
    protocol=true;
    child=spawn('wsl.exe',['-d',settings.distribution,'--','python3',linuxPath(path.join(workerSource,'terminal.py'))],
      {stdio:['pipe','pipe','pipe'],windowsHide:true});
  }
  terminals.set(id,{child,protocol});
  if(protocol) {
    createInterface({input:child.stdout}).on('line',line=>{
      try{const value=JSON.parse(line); emit('studio:terminal',{id,...value});}catch{}
    });
  } else child.stdout.on('data',buffer=>emit('studio:terminal',{id,data:buffer.toString()}));
  child.stderr.on('data',buffer=>emit('studio:terminal',{id,data:buffer.toString()}));
  child.on('error',error=>emit('studio:terminal',{id,data:error.message}));
  child.on('exit',code=>{terminals.delete(id);emit('studio:terminal',{id,closed:true,code});});
  return {id};
});
handle('terminal.input',({id,data,cols,rows})=>{
  const terminal=terminals.get(id); if(!terminal) throw new Error('Terminal is closed');
  if(terminal.protocol) terminal.child.stdin.write(JSON.stringify(data===undefined?
    {type:'resize',cols,rows}:{type:'input',data})+'\n');
  else if(data!==undefined) terminal.child.stdin.write(data);
});
handle('terminal.close',({id})=>{terminals.get(id)?.child.kill();terminals.delete(id);});
handle('window',({action})=>{
  if(action==='minimize') window.minimize();
  if(action==='maximize') window.isMaximized()?window.unmaximize():window.maximize();
  if(action==='close') window.close();
});
const saveWorkbenchImage=createWorkbenchImageExporter({ownerForEvent:event=>{if(!window||window.isDestroyed()||window.webContents.isDestroyed())return null;trusted(event);return BrowserWindow.fromWebContents(event.sender)===window?window:null;},displayScale:owner=>screen.getDisplayMatching(owner.getBounds()).scaleFactor,showSaveDialog:(owner,options)=>dialog.showSaveDialog(owner,options),decodePng:bytes=>nativeImage.createFromBuffer(bytes),privacy:()=>sshConnection.privacy()});
ipcMain.handle('studio:diagnostics.saveWorkbenchImage',async(event,data)=>{if(shuttingDown||!window||window.isDestroyed()||window.webContents.isDestroyed()||event.sender.isDestroyed())return null;trusted(event);try{return await saveWorkbenchImage(data,event);}catch(error){if(shuttingDown)return null;throw error;}});
handle('export',async({run})=>{
  const bundle=await worker.request('POST','/api/run/export',{run_id:run.id});
  const response=await dialog.showSaveDialog(window,{defaultPath:'reproduction-'+run.id+'.zip'});
  if(response.canceled) return null;
  fs.writeFileSync(response.filePath,Buffer.from(bundle.base64,'base64'));
  return response.filePath;
});
window=new BrowserWindow({width:1540,height:980,minWidth:1100,minHeight:720,frame:false,
  backgroundColor:'#15151b',title:'GPU Sampling Studio',show:false,
  webPreferences:{backgroundThrottling:!verifying,offscreen:improvementsVerifying,preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
installSshPrivacyLifecycle(window.webContents,sshConnection);
window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
window.webContents.on('will-navigate',(event,url)=>{if(url!==window.webContents.getURL()) event.preventDefault();});
const development=process.env.STUDIO_DEV_URL;
if(development && !/^http:\/\/127\.0\.0\.1:5173\/?$/.test(development)) throw new Error('Invalid development origin');
if(development) await window.loadURL(development); else await window.loadFile(path.join(root,'dist','index.html'));
if(verifying){const errors=[];window.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});const {verifyDesktop}=await import(installationVerifying?'./install-verification.mjs':improvementsVerifying?'./improvements-verification.mjs':providerVerifying?'./provider-verification.mjs':'./verification.mjs');const ok=await verifyDesktop(window,verificationRoot,errors,{publish:event=>emit('studio:event',event),packaged:app.isPackaged,version:app.getVersion(),taskAttach:(...args)=>taskRecords.attach(...args),taskEvent:event=>taskRecords.event(event),agentPaths:{kimi:settings.kimiPath,qwen:settings.qwenPath}});shuttingDown=true;agents.close();worker.close();app.exit(ok?0:1);}else window.show();
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{sshConnection.shutdown();agents.close();worker.close();for(const t of terminals.values())t.child.kill();});

}
app.whenReady().then(initialize).catch(error=>{console.error(error);const log=path.join(app.getPath('userData'),'startup-error.log');try{fs.mkdirSync(path.dirname(log),{recursive:true});fs.appendFileSync(log,new Date().toISOString()+' '+String(error.stack||error)+'\n');dialog.showErrorBox('GPU Sampling Studio 启动失败','项目与连接配置已保留。请查看诊断日志：\n'+log);}catch{}app.exit(1);});
