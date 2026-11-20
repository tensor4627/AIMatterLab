import {networkProxy,configureNetworkSession} from './platform/network-proxy.mjs';
import {PRODUCT_NAME} from '../contracts/product.mjs';
import {consoleMessage} from './platform/verification/console-message.mjs';
import {installManagedTray} from './platform/managed-tray.mjs';
import {loadRecoverableWorkbench} from './platform/workbench-recovery.mjs';
import {createConversationActivity} from '../backend/main/compute/conversation-activity.mjs';
import {managedProjectAccess} from '../backend/main/compute/managed-project-access.mjs';
import {developerComputeAccess} from '../backend/main/compute/developer-compute-access.mjs';
import {installDesktopShutdown} from './platform/desktop-shutdown.mjs';
import {createWorkspaceUpdater,launchWorkspaceUpdate} from './platform/workspace-updater.mjs';
import {createUpdateAccess,validateUpdateSource} from './platform/update-feeds.mjs';
import {electronUpdateFetch} from './platform/update-http.mjs';
import {createCliRuntimeManager,migrateBundledCliPaths} from './platform/cli-runtimes.mjs';
import {cliRuntimeRequest} from '../contracts/agent/cli-runtime.mjs';
import {createPerformanceTimeline} from './platform/performance.mjs';
import {clusterDownloadRequest} from '../contracts/compute/cluster-download.mjs';
import {installedWorkspace,studioProfileRoot,workspaceSessionDirectory} from './platform/studio-profile.mjs';
import {createSetupGuide} from './platform/setup-guide.mjs';
import {terminalExecutionCache} from './platform/terminal-execution-cache.mjs';
import {registerLegacyTerminalRoutes} from '../backend/main/compute/terminal-routes.mjs';
import {registerWorkflowPlanRoutes} from '../backend/main/workspace/workflow-plans.mjs';
import {createAgentRequests} from '../agent/sessions/requests.mjs';
import {createTerminalHandoff} from '../agent/sessions/terminal-handoff.mjs';
import {createSshTerminalHandoff} from '../agent/sessions/ssh-terminal-handoff.mjs';
import {createConversationTerminals} from '../agent/sessions/conversation-terminals.mjs';
import {createAgentResourceRouting} from '../agent/sessions/resource-routing.mjs';
import {createComputeResourceBinding} from '../backend/main/compute/resource-binding.mjs';
import {findInstalledCodex} from './platform/codex-executable.mjs';
import {computeRuntime} from './platform/compute-runtime.mjs';
import {createComputeProfiles} from '../backend/main/compute/compute-profiles.mjs';
import {createSharedTerminal} from "../backend/main/compute/shared-terminal.mjs";
import {createSshService} from '../backend/main/compute/ssh-service.mjs';
import {TerminalMcp,workerToolBridge} from "../agent/tools/terminal-mcp.mjs";

import {selectConversation} from "../agent/sessions/conversation-selection.mjs";
import {createWindowsSaveAs} from "./platform/windows-save-as.mjs";
import {createStructureWithAuthoringContext} from "../backend/main/workspace/structure-authoring.mjs";
import {environmentApiTool,createEnvironmentApiReader} from "../backend/main/compute/environment-api-read.mjs";
import {copyProjectInputsTool,copyProjectInputs} from '../backend/main/workspace/copy-project-inputs.mjs';
import {createSshConnection,installSshPrivacyLifecycle,requiresCurrentSshWorker,requireCurrentSshWorker,sshTaskSource,assertSshSource} from "../backend/main/compute/ssh-connection.mjs";
import {createWorkbenchImageExporter} from "./platform/workbench-image.mjs";
import {registerWorkspaceTaskRoutes} from '../backend/main/workspace/routes.mjs';
import {createConversationDraftTool} from '../backend/main/workspace/workflow-draft-tool.mjs';
import {createToolPackageRegistry} from '../backend/main/tools/package-registry.mjs';
import {createAimlabToolRegistry} from '../backend/main/tools/aimlab-source.mjs';
import {registerAimlabToolSourceRoutes} from '../backend/main/tools/aimlab-routes.mjs';
import {createToolGroupRecords} from '../backend/main/tools/groups.mjs';
import {registerToolDefinitionRoutes} from '../backend/main/tools/routes.mjs';
import {createToolConfigurationController,registerToolConfigurationRoutes} from '../backend/main/compute/tool-configurations.mjs';
import {createResourceToolController,registerResourceToolRoutes} from '../backend/main/compute/resource-tools.mjs';
import {createToolWorkflowController,registerToolWorkflowRoutes} from '../backend/main/workspace/tool-workflows.mjs';
import {createRoadmapController} from '../backend/main/workspace/roadmap-execution.mjs';
import {createRoadmapNotifications} from '../backend/main/workspace/roadmap-notifications.mjs';
import {softwareDocDefinitions,softwareDocs} from '../backend/main/tools/public-software-docs.mjs';
import {toolGuidanceTarget} from '../backend/main/compute/tool-guidance-target.mjs';
import {explicitSetupStage} from '../agent/skills/explicit-setup-stage.mjs';
import {createComputeOnboarding} from "../backend/main/compute/compute-onboarding.mjs";
import {createComputeConnection,installedWslDistributions} from '../backend/main/compute/compute-connection.mjs';
import {customCvNumericDialog,referenceImportDialog} from "./platform/dialogs/custom-cv-dialog.mjs";
import {registerTaskStage} from "../backend/main/workspace/task-stage-ipc.mjs";
import {localReviewDialog} from "./platform/dialogs/local-review-dialog.mjs";
import {registerCalculationReview} from "../backend/main/workspace/task-consumer-ipc.mjs";
import {consumerReviewDialog} from "./platform/dialogs/consumer-review-dialog.mjs";

import {resumeConversationContext} from "../agent/sessions/conversation-recovery.mjs";
import {definitionReply} from '../agent/tools/definition-scope.mjs';
import {managedToolReadiness,scientificToolReadiness} from "../agent/tools/scientific-tool-readiness.mjs";
import {createParallelAgentWorkflowContext} from '../agent/sessions/workflow-context.mjs';

import {createPrivateCvAccess,composeToolGuards} from "../agent/tools/private-cv-access.mjs";
import {createComputeResourceInspection} from '../agent/tools/compute-resource-inspection.mjs';
import {registerSshConnectionRoutes} from '../backend/main/compute/ssh-connection-ipc.mjs';
import {createServiceHandoff} from '../agent/sessions/service-handoff.mjs';
import {createTaskCustomCv} from "../backend/main/workspace/task-custom-cv.mjs";
import {currentPairTool,readCurrentPair} from "../agent/tools/current-pair-tool.mjs";
import {importTaskAsset} from "../backend/main/workspace/task-asset-import.mjs";
import { app, BrowserWindow, Tray, Menu, Notification, ipcMain, dialog, shell, safeStorage, net, screen, nativeImage, session } from 'electron';

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {readTaskPygas,bindComposition,compositionToolGuard} from "../backend/main/workspace/task-pygas.mjs";

import {ProjectSkills} from '../agent/skills/project-skills.mjs';
import {ScientificSkills,normalizeScientificSharing} from '../agent/skills/scientific-skills.mjs';
import {saveComputeProfileWithEnvironment} from '../backend/main/compute/compute-profile-environment-save.mjs';
import {preferredSshRuntime,carrySshRuntimePreference,globalSshBindingForProfile} from '../backend/main/compute/ssh-runtime-preference.mjs';
import {createSshServiceRegistration} from '../backend/main/compute/ssh-service-registration.mjs';
import {normalizeSettings} from './settings-schema.mjs';
import {legacyGuidanceFacts} from '../agent/skills/read-policy.mjs';

import {MaterialsProject} from "../backend/main/tools/materials-project.mjs";
import {discoverSources,toolInventory} from '../backend/main/tools/source-projects.mjs';

import { localSkills } from '../agent/skills/skills.mjs';

import {agentConfig,workspaceAgentInstructions} from '../agent/context/agent-settings.mjs';
import {TaskRecords} from "../agent/sessions/task-records.mjs";
import {existingConnections,existingProfile} from "../backend/main/compute/existing-ssh.mjs";

import { Catalog } from "../backend/main/workspace/catalog.mjs";
import { CodexBridge } from '../agent/providers/codex.mjs';
import {codexRuntime} from './platform/codex-runtime.mjs';
import {createCodexSubscriptionRuntime} from './platform/codex-subscription-runtime.mjs';

import {ConversationAgentHub} from '../agent/providers/conversation-agent-hub.mjs';
import {createManagedWorkbench} from './platform/managed-workbench.mjs';
import {loginUrl} from '../agent/providers/agent-hub.mjs';
import {CredentialVault} from './platform/credential-vault.mjs';
import {registerModelProfileRoutes} from './platform/model-profile-routes.mjs';
import {providerId} from '../agent/providers/contracts.mjs';
import { WorkerClient } from "../agent/tools/worker-client.mjs";
import {readWorkerStatus} from '../backend/main/compute/worker-status.mjs';
import {bindBundledWorkerRuntimeId,taskForRecordIndex} from "../backend/main/compute/worker-service-version.mjs";
import {restoreTaskWorker} from '../backend/main/compute/worker-restore.mjs';
import {updateDraftWorker} from '../backend/main/workspace/update-draft-worker.mjs';
import {createBaseWorkspace,baseWorkspaceTool} from '../backend/main/workspace/base-workspace.mjs';
import {createResourceWorkspace} from '../backend/main/workspace/resource-workspace.mjs';
import {createWorkspaceTerminalAuthorization} from '../backend/main/compute/workspace-terminal-authorization.mjs';
import {explicitWorkerReceipt,rememberExplicitWorker,workerSettingsSignature,validExplicitBinding,taskWorkerTarget,validTransportPort,taskTransportScope,taskTransportReceipt} from '../backend/main/compute/explicit-worker-binding.mjs';
import {sameWorkerBinding,taskWorkerSource} from "../contracts/compute/task-worker-binding.mjs";

import {bindLegacyAuthoringWorker} from '../backend/main/compute/task-authoring-binding.mjs';
import {assertRendererWorkerRoute,linuxPath} from "../contracts/transport-policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here,'..');
if(process.platform==='win32'&&app.isPackaged)app.setAppUserModelId('science.gpusampling.studio');
const performanceTimeline=createPerformanceTimeline();
const workerSource = app.isPackaged ? path.join(process.resourcesPath,'app.asar.unpacked','worker') : path.join(root,'backend','worker');
const sshTransportSource=app.isPackaged?path.join(process.resourcesPath,'terminal-service','python'):path.join(here,'platform','terminal-service','python');
// Physical resources keep skill references usable by an external agent process.
const bundledSkillRoot = app.isPackaged ? path.join(process.resourcesPath,'studio-skills') : path.join(root,'agent','builtin-skills');
function studioSkillRoots(){const sourceRoots=[...(settings.sourceRoots||[]),...(catalog?.list('source-binding')||[]).map(s=>s.root)];return [...new Set([bundledSkillRoot,...(settings.skillRoots||[]),...sourceRoots.map(p=>path.join(p,'agents','skills'))])];}
// The backend composition root replaces this getter with authoritative worker facts.
let resolveSkillGuidance=async()=>legacyGuidanceFacts();
const guidanceLeases=new WeakMap();let guidanceEpoch=0;
function skillGuidanceLease(provider){
 const terminal=agents?.bridgeWorkers?.get(provider)?.transport==='desktop-terminal';
 const sessionId=workflowContext?.sessionId?.()??agents?.sessionIdentity?.(provider,workflowContext?.current()?.threadId)?.id;
 const terminalScopes=terminalMcp?.scopes,workerScopes=worker.providerScopes,legacy=terminal?terminalScopes:workerScopes;
 const raw=sessionId===undefined?legacy?.scopes.get(provider):terminalScopes?.get(provider,sessionId)??workerScopes?.get(provider,sessionId);
 if(!raw)return undefined;
 if(!guidanceLeases.has(raw))guidanceLeases.set(raw,{epoch:++guidanceEpoch,get context(){return raw.context;}});return guidanceLeases.get(raw);
}
function skillGuidanceScope(provider){const owner=workflowContext?.current(),revision=workflowContext?.revision(),stamp=JSON.stringify(owner),lease=skillGuidanceLease(provider);return {...owner,provider,epoch:lease?.epoch,checkCurrent:()=>revision===workflowContext?.revision()&&stamp===JSON.stringify(workflowContext?.current())&&skillGuidanceLease(provider)===lease};}
function assertSkillGuidanceScope(scope){if(scope?.checkCurrent&&scope.checkCurrent()!==true)throw Error('Guidance scope changed');return {...scope,serial:workflowContext?.revision(),epoch:skillGuidanceLease(scope?.provider)?.epoch??scope?.epoch};}
function managedSkillRecords(){return (toolPackages?.list({})||[]).flatMap(record=>(record.versions||[record.package_version]).map(package_version=>toolPackages.read({package_id:record.package_id,package_version})));}
function managedSkillRoots(){return managedSkillRecords().map(record=>record.snapshot_root);}
function managedSkillEntries(policy){return managedSkillRecords().map(record=>{const skill=record.delivery_skill;if(!skill)return null;const file=path.join(record.snapshot_root,skill.path);return {name:skill.name,description:skill.description,path:file,source:'registered delivery package',enabled:policy.allowsPath(file)};}).filter(Boolean);}
const installationVerifying=process.argv.includes('--studio-install-verify');
const improvementsVerifying=process.argv.includes('--studio-improvements-verify');
const providerVerifying=process.argv.includes('--studio-providers-verify');
const verifying=installationVerifying||improvementsVerifying||providerVerifying||process.argv.includes('--studio-verify');
const verificationRoot=process.env.STUDIO_VERIFY_ROOT||root;
const workspace=!verifying&&!process.env.STUDIO_PROFILE_DIR?installedWorkspace({isPackaged:app.isPackaged,execPath:process.execPath}):null;
if(process.env.STUDIO_PROFILE_DIR)app.setPath('userData',path.resolve(process.env.STUDIO_PROFILE_DIR));
else if(verifying)app.setPath('userData',path.join(verificationRoot,'.studio',improvementsVerifying?'verification-v'+app.getVersion():providerVerifying?'verification-providers':app.isPackaged?'verification-packaged':'verification-desktop'));
else{const profile=studioProfileRoot({appRoot:root,isPackaged:app.isPackaged,portableDir:process.env.PORTABLE_EXECUTABLE_DIR,execPath:process.execPath});fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);}
if(workspace)app.setPath('sessionData',workspaceSessionDirectory(workspace,app.getPath('userData')));
let window, catalog, settings, setupGuide, agents,taskRecords,materials,toolPackages,toolGroups,toolConfigurations,toolWorkflows,aimlabSources,cliRuntimes;
let managedWorkbench,managedResources,managedSchedules,resourceActivity,projectTerminalAccess,workbenchTray;
let shuttingDown=false,desktopShutdown;
const attentionBalloons=new Set();
const agentConnectAttempts=new Map();
const updateAccess=createUpdateAccess(new CredentialVault(path.join(app.getPath('userData'),'update-access'),safeStorage,validateUpdateSource));
const updater=createWorkspaceUpdater({workspace:process.platform==='win32'&&process.arch==='x64'?workspace:null,currentVersion:app.getVersion(),
  fetchApi:(url,options)=>electronUpdateFetch(net,url,{...options,version:app.getVersion()}),tokenFor:updateAccess.token,install:launchWorkspaceUpdate,quit:()=>app.quit(),
  publish:params=>emit('studio:event',{method:'studio/update',params})});
let scientificSkills,privateAccess,customCv,workflowContext,localReview,sharedTerminal,terminalMcp,computeResource,sshService,conversationTerminals;
let activeAuthoringTasks;
const codexRoot=path.join(app.getPath('userData'),'provider-contexts','codex');
const subscriptionRuntime=createCodexSubscriptionRuntime({root:codexRoot,runtime:codexRuntime,
 onEnvPrompt:prompt=>emit('studio:event',{method:'studio/codexEnvImport',params:{prompt}})});
const createCodex=(host=createCodexSubscriptionRuntime({root:codexRoot,runtime:codexRuntime,sharedEnvImport:subscriptionRuntime.envImport}))=>
 new CodexBridge({strictIsolation:true,isolationRoot:codexRoot,host});
const codex=createCodex(subscriptionRuntime), worker = new WorkerClient({host:computeRuntime,resourceSource:workerSource}), terminals = new Map();
bindBundledWorkerRuntimeId(worker,workerSource);
const resourceRouting=createAgentResourceRouting({worker,terminal:()=>terminalMcp,resource:()=>computeResource,sharedTerminal:()=>sharedTerminal,agents:()=>agents,service:()=>sshService,managed:()=>managedResources,taskSource:scope=>taskWorkerSource(taskRecords?.bound(scope.provider,scope.threadId))});
const previousSkillRoot=path.join(app.getPath('userData'),'project-skills');
const userCacheBase=!verifying&&!process.env.STUDIO_PROFILE_DIR&&process.env.LOCALAPPDATA
 ? path.join(process.env.LOCALAPPDATA,'AIMatterLab') : app.getPath('userData');
const defaultUserCacheDirectory=workspace?path.join(workspace.cache,'skills'):fs.existsSync(previousSkillRoot)?previousSkillRoot:path.join(userCacheBase,'user-cache','skills');
const defaults = { distribution:'Ubuntu', workerRoot:'~/.local/state/gpu-sampling-studio',
  workerPort:8767, terminalIdleMinutes:60, codexPath:'codex', cwd: app.isPackaged ? app.getPath('documents') : root,
  sourceRoots:[],skillRoots:[],userCacheDirectory:defaultUserCacheDirectory, theme:'dark', agentProvider:'codex',agentLayout:'right' };
function findCodex() {
  return findInstalledCodex();
}
function emit(channel,data) {
 if(!window||window.isDestroyed()||window.webContents.isDestroyed()||window.webContents.isCrashed())return;
 if(channel==='studio:event'&&data?.method==='studio/taskUpdated'&&data.params?.task){
  data={...data,params:{...data.params,task:taskForRecordIndex(data.params.task)}};
 }
 window.webContents.send(channel,data);
}
function trusted(event) {
  if(!window || event.sender.id!==window.webContents.id || event.senderFrame?.parent ||
      event.senderFrame?.url!==window.webContents.getURL()) throw new Error('Untrusted IPC sender');
}
function handle(name, fn) { ipcMain.handle('studio:'+name,async(event,data) => { if(shuttingDown||!window||window.isDestroyed()||window.webContents.isDestroyed()||event.sender.isDestroyed())return null;trusted(event); try{return await fn(data||{},event);}catch(error){if(shuttingDown)return null;throw error;} }); }
function updateAction(action) {
  return request=>{
    if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).length)throw Error('Update actions take no arguments');
    return action();
  };
}
handle('updates.status',updateAction(updater.snapshot));
handle('updates.check',updateAction(updater.check));
handle('updates.download',updateAction(updater.download));
handle('updates.install',updateAction(updater.apply));
handle('updates.run',updateAction(updater.update));
handle('updates.accessStatus',updateAction(updateAccess.status));
handle('updates.setAccess',input=>updateAccess.save(input));
function openUrl(url) {
  const parsed = new URL(url);
  if(parsed.protocol !== 'https:' || !['chatgpt.com','auth.openai.com','login.openai.com'].includes(parsed.hostname))
    throw new Error('Unsupported login URL');
  return shell.openExternal(url);
}

async function initialize() {
performanceTimeline.mark('desktop-initialize');
const profileDirectory=app.getPath('userData'),catalogRoot=path.join(profileDirectory,'studio');
const existingProfile=fs.existsSync(path.join(catalogRoot,'catalog.sqlite'));
catalog = new Catalog(catalogRoot);
resourceActivity=createConversationActivity({catalog});projectTerminalAccess=managedProjectAccess({catalog});
const explicitProfile=Boolean(process.env.STUDIO_PROFILE_DIR)||verifying;
setupGuide=createSetupGuide({catalog,existingProfile,directory:explicitProfile?profileDirectory:path.dirname(profileDirectory),directoryKind:explicitProfile?'profile':'workspace',openDirectory:directory=>shell.openPath(directory)});
const savedSettings=catalog.get('settings','main');
const firstLanguage=!existingProfile&&!verifying ? {language:/^zh\b/i.test(app.getPreferredSystemLanguages()[0]||app.getLocale())?'zh-CN':'en'} : {};
settings = { ...defaults, ...firstLanguage, codexPath:findCodex(),kimiPath:'',qwenPath:'', ...savedSettings };
if(!savedSettings&&firstLanguage.language)catalog.put('settings','main',firstLanguage);
if(workspace){
 const oldDefault=path.join(userCacheBase,'user-cache','skills');
 const legacy=savedSettings?.userCacheDirectory || (fs.existsSync(previousSkillRoot)?previousSkillRoot:savedSettings?oldDefault:null);
 if(legacy&&[oldDefault,previousSkillRoot].some(directory=>path.relative(directory,legacy)==='')&&fs.existsSync(legacy)){
  try{settings.userCacheDirectory=new ProjectSkills({root:legacy}).prepareRoot(defaultUserCacheDirectory);}
  catch{settings.userCacheDirectory=legacy;console.warn('Existing skill cache retained. Review the cache directory in Settings.');}
  settings=catalog.put('settings','main',settings);
 }else if(legacy&&path.relative(oldDefault,legacy)===''){
  settings.userCacheDirectory=defaultUserCacheDirectory;
  settings=catalog.put('settings','main',settings);
 }
}
const normalizedSharing=normalizeScientificSharing(settings);
if(normalizedSharing!==settings)settings=catalog.put('settings','main',normalizedSharing);
const migratedCliSettings=migrateBundledCliPaths(settings);if(migratedCliSettings!==settings)settings=catalog.put('settings','main',migratedCliSettings);
cliRuntimes=createCliRuntimeManager({root:path.join(app.getPath('userData'),'agent-runtimes'),settings:()=>settings,fetchApi:(...args)=>net.fetch(...args),dependencyRoot:app.isPackaged?path.join(process.resourcesPath,'agent-runtimes'):path.join(root,'.studio','agent-runtimes'),publish:params=>emit('studio:event',{method:'studio/cliInstallProgress',provider:params.provider,params})});
if(verifying&&!installationVerifying)settings={...settings,agentProvider:'codex',agentLayout:'right',language:'zh-CN',fontSize:13,editorFontSize:13,terminalFontSize:12,fontFamily:'system',workerRoot:JSON.parse(fs.readFileSync(path.join(verificationRoot,'.studio/validation/science.json'),'utf8')).desktop_worker_root,workerPort:8770};
if(installationVerifying){
 const config=JSON.parse(fs.readFileSync(process.env.STUDIO_INSTALL_CONFIG,'utf8'));
 const sourceIds=config.desktop.source_ids??[];if(!Array.isArray(sourceIds)||sourceIds.some(id=>!['pygas','pydyn','gpumd','hotpp','torchnep'].includes(id)))throw Error('Invalid installation source summary scope');
 settings=catalog.put('settings','main',{...settings,distribution:config.worker.distribution,workerRoot:config.worker.root,workerPort:config.worker.port||8767,cwd:root,sourceIds,agentProvider:config.desktop.agent_provider||'codex'});
}
const projectSkills=new ProjectSkills({root:settings.userCacheDirectory||defaultUserCacheDirectory,current:()=>workflowContext.current(),bundledRoot:bundledSkillRoot,
 previousRoots:[defaultUserCacheDirectory,previousSkillRoot,path.join(userCacheBase,'user-cache','skills'),...(catalog.get('skill-cache','history')?.roots||[])]});
function rememberSkillCache(){
 projectSkills.previousRoots.add(projectSkills.root);
 catalog.put('skill-cache','history',{roots:[...projectSkills.previousRoots]});
}
if(projectSkills.overlapsBundle(projectSkills.root)){
 try {
  const directory=projectSkills.prepareRoot(defaultUserCacheDirectory);
  rememberSkillCache();
  settings=catalog.put('settings','main',{...settings,userCacheDirectory:directory});
  projectSkills.root=directory;
 }catch{console.warn('Existing skill cache retained. Choose a directory separate from built-in skills in Settings.');}
}
agents=new ConversationAgentHub({authCodex:codex,createCodex,initialProvider:settings.agentProvider||'codex',
 runSession:(identity,run)=>workflowContext.runInSession(identity,run),dropSession:id=>{resourceRouting.releaseSession(id);workflowContext?.dropSession(id);},instructions:workspaceAgentInstructions(workspace,projectSkills.personalDirectory),resolveCli:provider=>cliRuntimes.resolve(provider),fetchApi:(...args)=>net.fetch(...args),root:path.join(app.getPath('userData'),'agents'),catalog,vault:new CredentialVault(path.join(app.getPath('userData'),'credentials'),safeStorage),settings:()=>settings,
 confirmResourceChoice:(scope,answer)=>workflowContext.runForScope(scope,()=>managedResources.confirmQuestionChoice(scope,answer)),
 bindResourceQuestion:(scope,question)=>{
  const checkCurrent=()=>workflowContext.sessionScopeCurrent(scope);
  return checkCurrent()?managedResources.bindResourceQuestion({...scope,checkCurrent},question):null;
 },
 worker:(provider,sessionId)=>resourceRouting.sessionConnection(provider,sessionId,workflowContext),
 releaseWorker:(provider,sessionId)=>{worker.revokeProvider(provider,sessionId);terminalMcp?.revokeProvider(provider,sessionId);},bindWorkerContext:(provider,context,options)=>resourceRouting.bindWorkerContext(provider,context,options),resourceScope:(provider,method,context,sessionId)=>resourceRouting.scope(provider,method,context,sessionId)});
const scientificMap=JSON.parse(fs.readFileSync(path.join(root,'agent','skills','scientific-skill-map.json'),'utf8'));
const setupInstructions=explicitSetupStage({routes:new Map(scientificMap.functions.map(route=>[route.id,route])),current:()=>workflowContext?.current()});
scientificSkills=new ScientificSkills({providerConsent:provider=>!['qwen','compatible'].includes(provider)||agents.bridge(provider)?.selection?.profile.sharePublicGuides===true,map:scientificMap,bundledRoot:bundledSkillRoot,studioRoot:root,workerSource,sources:scientificSources,registeredSources:()=>catalog.list('source-binding'),settings:()=>settings,setupAllowed:(provider,route)=>setupInstructions.allowed(provider,route),resolveGuidance:scope=>resolveSkillGuidance(scope),assertScope:assertSkillGuidanceScope});
const proposalTool={name:'propose_custom_cv',description:'Only after inspecting actual pyGAS library classes and discussing a missing/non-equivalent definition: save a typed formula/values/library_review private draft in this current conversation. It generates no code and grants no approval, sharing or execution. Human formula/code reviews and one exact CPU confirmation are separate. Prefer the real library and official examples first.',annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false},inputSchema:JSON.parse(fs.readFileSync(path.join(root,'agent','tools','custom-cv-tool-schema.json'),'utf8'))};
const privateReader={name:'read_custom_cv',description:'Read only the active conversation private CV after the human explicitly enables sharing with this provider. Never reads other library entries, approves or executes.',annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{workspace_id:{type:'string'}},required:['workspace_id'],additionalProperties:false}};
const readEnvironmentApi=createEnvironmentApiReader({worker,current:scope=>workflowContext.assertScope(scope)});
worker.setScopedTools([...softwareDocDefinitions,...scientificSkills.tools(),currentPairTool,proposalTool,privateReader,environmentApiTool,copyProjectInputsTool,baseWorkspaceTool],async(name,args,scope)=>{
 if(name==='setup_base_workspace')return baseWorkspace.call(args,scope);
 if(name==='copy_project_inputs')return copyProjectInputs({worker,current:value=>workflowContext.assertScope(value)},args,scope);
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
 if(softwareDocDefinitions.some(tool=>tool.name===name))return softwareDocs(name,args);
 return scientificSkills.call(name,args,scope);
});
materials=new MaterialsProject({root:path.join(app.getPath('userData'),'credentials'),encryption:safeStorage,fetchApi:(...a)=>net.fetch(...a),worker});

handle('materials.status',()=>materials.status());
handle('materials.key',({apiKey,remove=false})=>remove?materials.clear():materials.save(apiKey));
handle('materials.search',({query})=>materials.search(query));
handle('materials.import',value=>materials.import(value));
taskRecords=new TaskRecords(catalog,event=>emit('studio:event',event));
workflowContext=createParallelAgentWorkflowContext({records:taskRecords,selectedProvider:()=>agents.foregroundProvider});
activeAuthoringTasks=workflowContext.activeTasks;
toolPackages=createToolPackageRegistry({catalog,storeRoot:path.join(app.getPath('userData'),'tool-packages')});
aimlabSources=createAimlabToolRegistry({catalog});
registerAimlabToolSourceRoutes({handle,sources:aimlabSources,chooseSourceDirectory:async()=>{const value=await dialog.showOpenDialog(window,{properties:['openDirectory']});return value.canceled?null:value.filePaths[0];}});
toolGroups=createToolGroupRecords({catalog,packages:toolPackages});
toolConfigurations=createToolConfigurationController({catalog,packages:toolPackages,worker,getSettings:()=>settings,current:()=>workflowContext.current(),
 getResourceIdentity:provider=>({kind:agents.bridgeWorkers.get(provider)?.transport==='desktop-terminal'?'terminal':'worker'}),
 currentTarget:()=>{const owner=workflowContext.current();return owner?.taskId?toolGuidanceTarget(taskRecords.read(owner.taskId)):null;},getProvider:()=>agents.active,getLease:skillGuidanceLease,assertIdle:assertIdleAgent,toWorkerPath:linuxPath,
 confirm:async(plan,event)=>{trusted(event);const result=await dialog.showMessageBox(window,{type:'question',buttons:settings.language==='en'?['Cancel','Install and test']:['取消','安装并测试'],defaultId:0,cancelId:0,message:settings.language==='en'?'Install and test this tool?':'安装并测试这个工具？',detail:[plan.package_id,'CPU worker engineering reference',plan.target.project_id,plan.target.environment_id,plan.installed_prefix,String(plan.tests.length)+' tests'].join('\n')});trusted(event);return result.response===1;}
});
resolveSkillGuidance=scope=>toolConfigurations.resolveGuidance(scope);
registerToolDefinitionRoutes({handle,packages:toolPackages,groups:toolGroups,choosePackageDirectory:async()=>{const value=await dialog.showOpenDialog(window,{properties:['openDirectory']});return value.canceled?null:value.filePaths[0];}});
registerToolConfigurationRoutes({handle,controller:toolConfigurations});
toolWorkflows=createToolWorkflowController({catalog,groups:toolGroups,configurations:toolConfigurations,worker,getSettings:()=>settings,current:()=>workflowContext.current(),getTask:id=>taskRecords.read(id),
 currentTarget:()=>{const owner=workflowContext.current();return owner?.taskId?toolGuidanceTarget(taskRecords.read(owner.taskId)):null;},assertIdle:assertIdleAgent,
 confirm:async({workflow,step},event)=>{trusted(event);const review=step.review,result=await dialog.showMessageBox(window,{type:'question',buttons:settings.language==='en'?['Cancel','Execute this step']:['取消','执行这个步骤'],defaultId:0,cancelId:0,message:settings.language==='en'?'Execute this reviewed workflow step?':'执行已复核的这个流程步骤？',detail:[workflow.name,step.id,review.run_id,review.target.project_id,review.target.environment_id,review.directory,review.argv.join(' '),'Review SHA256: '+review.review_sha256].join('\n')});trusted(event);return result.response===1;}
});
registerToolWorkflowRoutes({handle,controller:toolWorkflows});
const roadmapNotifications=createRoadmapNotifications({catalog,sources:()=>managedResources?.listSources()||[],english:()=>settings.language==='en',emit:event=>emit('studio:event',event)});
const roadmapExecutions=createRoadmapController({worker,catalog,groups:toolGroups,packages:toolPackages,getSettings:()=>settings,current:()=>workflowContext.current(),getTask:id=>taskRecords.read(id),assertIdle:assertIdleAgent,completed:(task,state)=>roadmapNotifications.completed(task,state),sources:()=>managedResources?.listSources()||[],
 allocateWorkspace:(data,guard)=>resourceWorkspace.forExecution(data,guard),
 sessionWorkspace:task=>resourceWorkspace.knownForExecution(task),
 confirm:async(review,event)=>{
  trusted(event);const {snapshot}=review,en=settings.language==='en';
  const result=await dialog.showMessageBox(window,{type:'question',buttons:en?['Cancel','Freeze and run']:['取消','冻结并执行'],defaultId:0,cancelId:0,
   message:en?'Run the reviewed workflow?':'按照已核对的流程执行？',detail:[snapshot.name,snapshot.original_request,snapshot.target.project_id+' / '+(snapshot.target.cluster_id||snapshot.target.environment_id),
    ...snapshot.workspace?.choice==='session'?[snapshot.workspace.root]:[],
    snapshot.steps.map(node=>node.label+' ('+node.tool+')').join(' → '),...snapshot.goals.map(goal=>goal.label+' · '+(goal.requirements||[]).join(' / ')),review.snapshot_sha256].join('\n')});
  trusted(event);return result.response===1;
 }});
for(const action of ['preview','confirm','list','snapshot'])handle('task.roadmap.'+action,(data,event)=>roadmapExecutions[action](data,event));
const lastCompute=catalog.get('worker-binding','last-explicit');
const computeProfiles=createComputeProfiles({catalog,guideRoot:path.join(app.getPath('userData'),'ssh-service-environments'),initialWsl:lastCompute?.kind!=='ssh'&&validExplicitBinding(lastCompute,settings)?{distribution:lastCompute.distribution,root:lastCompute.root,port:lastCompute.port,intent:lastCompute.intent||'standard'}:undefined});
for(const profile of computeProfiles.list())resourceActivity.style(profile);
const serviceRegistration=createSshServiceRegistration({catalog,profiles:computeProfiles,legacyBinding:()=>catalog.get('worker-binding','last-explicit')});
handle('compute.profiles.list',value=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length)throw Error('Invalid connection listing');return {profiles:computeProfiles.list(),serviceRegistrations:serviceRegistration.list().map(({profileId,profileVersion,status})=>({profileId,profileVersion,status})),inUseProfileIds:sharedTerminal?.inUseProfileIds()||[],...worker.connection&&!worker.connecting&&!worker.restoring&&worker.identity&&worker.identity.kind!=='ssh'&&worker.connectionTarget?{activeLocal:{distribution:worker.identity.distribution,root:worker.identity.root,requestedRoot:worker.connectionTarget.requestedRoot,port:worker.connectionTarget.port}}:{},defaults:{distribution:settings.distribution,root:settings.workerRoot,port:settings.workerPort,ssh_client:process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','OpenSSH','ssh.exe'):'/usr/bin/ssh'}};});
handle('compute.profiles.read',value=>computeProfiles.read(value));
function selectedSshBinding(profile){const owner=workflowContext.current(),task=owner?.taskId?taskRecords.read(owner.taskId):null;return task?taskWorkerSource(task)?.binding:owner?.taskId?null:globalSshBindingForProfile(profile,catalog.get('worker-binding','last-explicit'));}
handle('compute.profiles.save',async value=>{const previous=value?.id?computeProfiles.read({id:value.id}):null,preference=previous?catalog.get('ssh-runtime-preference',previous.id):null,binding=selectedSshBinding(previous);const saved=await saveComputeProfileWithEnvironment({profiles:computeProfiles,terminal:sharedTerminal,resource:computeResource,sshService,assertIdle:()=>{if(previous&&sharedTerminal.inUseProfileIds().includes(previous.id))assertLegacyWorkerIdle();}},value);if(previous&&saved.version!==previous.version){const carried=carrySshRuntimePreference(previous,saved,binding,preference);if(carried)catalog.put('ssh-runtime-preference',saved.id,carried);else catalog.remove('ssh-runtime-preference',saved.id);}resourceActivity.style(saved);emit('studio:event',{method:'studio/computeResourceChanged'});return saved;});
handle('compute.profiles.remove',value=>{
 if(managedResources?.snapshot().some(row=>row.profileId===value?.id))throw Error('compute_profile_in_use');
 if(sharedTerminal?.inUseProfileIds().includes(value?.id))throw Error('compute_profile_in_use');
 return computeProfiles.remove(value);
});
handle('compute.profiles.inventory',async value=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length)throw Error('Invalid WSL inventory request');return {distributions:await installedWslDistributions()};});
sharedTerminal=createSharedTerminal({worker,profiles:computeProfiles,encryption:safeStorage,catalog,current:()=>workflowContext.current(),currentView:()=>workflowContext.selectedOwner(),settings:()=>settings,getSelectedResource:()=>computeResource?.peek(),selectionRevision:()=>computeResource?.revision()??0,
 workspaceCommands:()=>workspaceTerminalAuthorization,
 workspaceConfinementPath:path.join(workerSource,'studio_worker','compute','workspace_confinement.py'),
 root:path.join(app.getPath('userData'),'shared-terminal'),runtimeRoot:terminalExecutionCache({profileRoot:app.getPath('userData'),home:app.getPath('home')}),
 dependencyRoot:app.isPackaged?path.join(process.resourcesPath,'agent-runtimes'):path.join(root,'.studio','agent-runtimes'),
 servicePath:app.isPackaged?path.join(process.resourcesPath,'terminal-service','broker.mjs'):path.join(here,'platform','terminal-service','broker.mjs'),nodeExecutable:process.execPath,
 sourceGuard:()=>assertSshSource(sshTaskSource(taskRecords,()=>workflowContext.current(),{}),worker)});
// Persisted references are observations, never authentication or Agent leases.
// Schema 1 remains readable; selecting a real new connection archives it in a
// versioned transition rather than discarding saved state on desktop startup.
computeResource=createComputeResourceBinding({catalog,profiles:computeProfiles,terminal:sharedTerminal,connections:sharedTerminal.connections,current:()=>workflowContext.selectedOwner(),serviceState:connectionId=>sshService?.peek(connectionId?{connectionId}:{})});
sshService=createSshService({worker,connections:sharedTerminal.connections,profiles:computeProfiles,resource:computeResource,registration:serviceRegistration,source:workerSource,transportSource:sshTransportSource,preferredRuntimeId:profile=>preferredSshRuntime(profile,selectedSshBinding(profile),catalog.get('ssh-runtime-preference',profile.id)),current:()=>workflowContext.current(),assertIdle:()=>{assertIdleAgent();agents.assertContextIdle();},publish:()=>{emit('studio:event',{method:'studio/sshServiceChanged',params:sshService?.peek()||{status:'disconnected'}});},onRuntimeUpdated:update=>updateDraftWorker(taskRecords,worker,update),remember:(identity,health)=>{catalog.put('worker-binding','last-explicit',{...identity,port:health.port,health,checkedAt:Date.now(),sourceIdentity:{runtimeId:health.runtimeId}});}});
conversationTerminals=createConversationTerminals({terminal:sharedTerminal,service:sshService,registration:serviceRegistration,
 resource:computeResource,current:()=>workflowContext.current(),conversationName:(provider,threadId)=>taskRecords.conversation(provider,threadId)?.name,idleMinutes:()=>settings.terminalIdleMinutes,
 busy:scope=>agents.isBusy(scope.provider,scope.threadId),
 serviceBusy:()=>agents.contextBusy(),
 publish:scope=>{
  emit('studio:event',{method:'studio/conversationTerminalChanged'});
  if(scope)void scientificTools(scope.provider).then(params=>{
   if(sshService.hasCurrentGrant(scope.provider,scope))emit('studio:event',{method:'studio/toolsStatus',provider:scope.provider,params});
  }).catch(()=>{});
 }});
const terminalIdleTimer=setInterval(()=>{
 void roadmapNotifications.sweep().catch(()=>{});
 void conversationTerminals.sweep();
 void managedResources?.sweep({idleMs:(settings.terminalIdleMinutes||60)*60000}).catch(()=>{});
},10000);terminalIdleTimer.unref();
const authoringAuthorization={
 begin(task){
  const service=sshService.prepareAuthoringGrant(task);
  const shell=conversationTerminals.prepareAuthoringGrant();return service||shell?{service,shell}:null;
 },
 commit(ticket,task){
  if(!ticket)return false;
  const authorized=ticket.service?sshService.completeAuthoringGrant(ticket.service,task):false;
  ticket.shell?.(ticket.service?authorized:true);return authorized;
 },
 abort(ticket){
  if(ticket){ticket.shell?.(false);if(ticket.service)sshService.abortAuthoringGrant(ticket.service);}
 },
};
worker.setResourceUseGuard?.(async(provider,scope,toolName)=>{
 if(scope?.sessionId)return !!resourceRouting.scopedWorkerConnection(scope);
 const selected=computeResource.peek(),terminalTool=['list_shared_terminals','read_shared_terminal','write_shared_terminal'].includes(toolName);
 if(selected?.kind==='ssh-connection'){
  if(scope?.provider!==provider||scope.checkCurrent?.()!==true)return false;
  let connection;try{connection=await sharedTerminal.connections.state({connectionId:selected.connectionId});}catch(error){if(!['ssh_control_timeout','ssh_control_unavailable'].includes(error?.message))sshService.connectionLost(selected.connectionId);return false;}
  if(JSON.stringify(selected)!==JSON.stringify(computeResource.peek())||scope.checkCurrent?.()!==true)return false;
  if(connection.status!=='authenticated'||connection.authentication!=='verified'){sshService.connectionLost(selected.connectionId);return false;}
  if(connection.connectionId!==selected.connectionId||connection.profileId!==selected.profileId||connection.profileVersion!==selected.profileVersion)return false;
  if(terminalTool)return sharedTerminal.hasCurrentGrant(provider)===true;
  const state=sshService.peek();return state.connectionId===selected.connectionId&&state.profileId===selected.profileId&&state.profileVersion===selected.profileVersion&&state.status==='connected'&&state.workflowReady===true&&sshService.hasCurrentGrant(provider,scope);
 }
 if(selected?.kind==='ssh-terminal'||worker.identity?.kind==='ssh')return selected?.kind==='ssh-terminal'&&terminalTool&&scope?.provider===provider&&sharedTerminal.hasCurrentGrant(provider,selected.sessionId)===true;
 return true;
});
const sshConnectionRoutes=registerSshConnectionRoutes({handle,connections:sharedTerminal.connections,onClosing:connectionId=>{managedResources?.revokeConnection({connectionId});conversationTerminals.releaseConnection(connectionId);workspaceTerminalAuthorization.revokeConnection(connectionId);sshService.connectionLost(connectionId);},onClosed:connectionId=>{managedResources?.confirmConnectionClosed?.(connectionId);sshService.connectionClosed(connectionId);},onUnknown:connectionId=>{workspaceTerminalAuthorization.revokeConnection(connectionId);sshService.connectionLost(connectionId);},onChange:params=>{emit('studio:event',{method:'studio/sshConnectionChanged',params});emit('studio:event',{method:'studio/computeResourceChanged'});}});
handle('compute.sshService.registration',value=>{
 const registration=serviceRegistration.read(value);
 return {...registration,localProjectSkillsRoot:projectSkills.root};
});
handle('compute.sshService.check',value=>sshService.check(value));
async function connectSelectedSshService(value,useHosted=false){
 assertIdleAgent();agents.assertContextIdle();const result=await (useHosted?sshService.useHosted(value):sshService.connect(value));if(result.workflowReady)await managedResources?.refreshService({connectionId:value.connectionId});
 if(result.status==='connected')emit('studio:event',{method:'studio/workerConnected',params:{sourceKind:'ssh'}});
 emit('studio:event',{method:'studio/computeResourceChanged',params:await computeResource.status({})});return result;
}
handle('compute.sshService.connect',value=>connectSelectedSshService(value));
handle('compute.sshService.status',value=>sshService.status(value));
handle('compute.sshService.scheduler',async value=>{const result=await sshService.scheduler(value);emit('studio:event',{method:'studio/sshSchedulerChanged',params:{profileId:result.id,version:result.version}});return result;});
handle('compute.sshService.disconnect',async value=>{conversationTerminals.serviceOwner(value.connectionId,'human');const result=await sshService.disconnect(value);emit('studio:event',{method:'studio/computeResourceChanged',params:await computeResource.status({})});return result;});
handle('compute.resource.status',async value=>{const result=await computeResource.status(value);return result.kind==='ssh-connection'&&result.authentication==='verified'?{...result,canAcquireConversationTerminal:conversationTerminals.canAcquire(agents.active)}:result;});
async function changeComputeResource(method,value){
 assertLegacyWorkerIdle();const before=computeResource.capture(),result=await computeResource[method](value),after=computeResource.capture();
 if(before.revision!==after.revision||JSON.stringify(before.selection)!==JSON.stringify(after.selection)){
  if(before.selection?.connectionId)conversationTerminals.detachConnection(before.selection.connectionId);
  await sshService.resourceChanged();
  for(const provider of ['codex','kimi','qwen','deepseek','compatible']){worker.revokeProvider(provider);terminalMcp?.revokeProvider(provider);}
 }
 emit('studio:event',{method:'studio/computeResourceChanged',params:result});
 const provider=agents.active;void scientificTools(provider).then(params=>emit('studio:event',{method:'studio/toolsStatus',provider,params})).catch(()=>{});return result;
}
for(const method of ['activate','clear'])handle('compute.resource.'+method,value=>changeComputeResource(method,value));
handle('compute.managed.useForWorkflow',async value=>{
 const keys=['connectionId','profileId','profileVersion'];
 if(Object.keys(value).sort().join(',')!==keys.join(','))throw Error('managed_compute_invalid_request');
 assertIdleAgent();agents.assertContextIdle();
 const live=managedResources?.snapshot().find(row=>row.kind==='ssh'&&row.serviceStatus==='ready'&&keys.every(key=>row[key]===value[key]));
 if(!live)throw Error('managed_compute_private_service_unavailable');
 await changeComputeResource('activate',{kind:'ssh-connection',...value});
 const guard=computeResource.capture();
 const result=await connectSelectedSshService({...value,requestId:randomUUID(),mode:'reuse'},true);
 computeResource.assertCurrent(guard);
 return result;
});
const terminalTools=sharedTerminal.tools(),terminalToolNames=new Set(terminalTools.map(tool=>tool.name));
const computeInspection=createComputeResourceInspection({worker,resource:()=>computeResource,service:()=>sshService,connections:()=>sharedTerminal.connections});
const resourceWorkspace=createResourceWorkspace({catalog,profiles:computeProfiles,connections:sharedTerminal.connections,
 resource:computeResource,worker,current:()=>workflowContext.current(),registration:serviceRegistration,
 emit:()=>emit('studio:event',{method:'studio/resourceWorkspaceChanged'})});
for(const method of ['read','preview','confirm','cancel'])handle('compute.resourceWorkspace.'+method,value=>resourceWorkspace[method](value));
handle('compute.resourceWorkspace.session',value=>resourceWorkspace.forSession(value));
const developerCompute=developerComputeAccess({workspaceId:()=>settings.developerComputeWorkspaceId,
 userTurn:scope=>agents.turnOrigin(scope.provider,scope.threadId)==='human'});
const workspaceTerminalAuthorization=createWorkspaceTerminalAuthorization({workspace:resourceWorkspace,connections:sharedTerminal.connections,developerCompute,
 current:()=>{const selected=workflowContext.selectedOwner();return {...selected.context,revision:selected.revision+':'+computeResource.revision()};},
 emit:()=>emit('studio:event',{method:'studio/terminalApprovalChanged'})});
for(const method of ['pending','decide'])handle('compute.terminalApproval.'+method,value=>workspaceTerminalAuthorization[method](value));
const baseWorkspace=createBaseWorkspace({catalog,worker,resource:computeResource,service:sshService,current:()=>workflowContext.current(),emit:()=>emit('studio:event',{method:'studio/baseWorkspaceChanged'})});
handle('compute.workspace.setup',value=>{assertIdleAgent();return baseWorkspace.manual(value);});
worker.setLocalTools([...materials.tools(),...terminalTools,...computeInspection.tools()],(name,args,scope)=>name==='inspect_compute_resource'?computeInspection.call(name,args,scope):terminalToolNames.has(name)?sharedTerminal.callTool(name,args,scope):materials.call(name,args,scope));
const terminalHandoff=createTerminalHandoff({terminal:sharedTerminal,workflowContext,agents,records:taskRecords,resourceRouting,agentRpc:value=>agentRpc(value),assertIdle:assertIdleAgent,
 beforeAgentHandoff:()=>{const selected=computeResource.peek();if(selected?.kind==='ssh-connection')return resourceWorkspace.assertHandoff(selected);}});
const connectionHandoff=createSshTerminalHandoff({terminalHandoff,terminal:sharedTerminal,service:()=>sshService,registration:serviceRegistration,resourceRouting,workflowContext,agents,records:taskRecords,agentRpc:value=>agentRpc(value)});
const serviceHandoff=createServiceHandoff({service:()=>sshService,workflowContext,agents,records:taskRecords,resourceRouting,agentRpc:value=>agentRpc(value),assertIdle:assertIdleAgent});
handle('compute.sshService.owner',async value=>{const result=await serviceHandoff.owner(value);conversationTerminals.serviceOwner(value.connectionId,value.owner);emit('studio:event',{method:'studio/computeResourceChanged'});const provider=workflowContext.current()?.provider;if(provider)void scientificTools(provider).then(params=>emit('studio:event',{method:'studio/toolsStatus',provider,params})).catch(()=>{});return result;});
for(const method of ['list','open','read','input','resize','owner','close'])handle('sharedTerminal.'+method,async value=>{let result;
 if(method==='list'){const list=await sharedTerminal.list(value);return {...list,sessions:list.sessions.map(conversationTerminals.describe)};}
 if(method==='owner'&&value.owner==='agent'&&computeResource.peek()?.kind==='ssh-connection'){
  assertIdleAgent();agents.assertContextIdle();providerId(value.provider||agents.active);
  if(Object.keys(value).some(key=>!['sessionId','ownerEpoch','owner','provider'].includes(key)))throw Error('terminal_invalid_request');
  const selected=computeResource.capture(),contextBefore=workflowContext.revision();
  await resourceWorkspace.assertHandoff(selected.selection,()=>{computeResource.assertCurrent(selected);if(contextBefore!==workflowContext.revision())throw Error('terminal_context_changed');});
  result=await conversationTerminals.arm(value,value.provider||agents.active);
  const context=workflowContext.current();
  if(context?.threadId&&result.currentConversation)await workflowContext.synchronize(context,(provider,scope)=>agents.selectContext(provider,scope));
 }else{
  result=await (['owner','close'].includes(method)?connectionHandoff:sharedTerminal)[method](value);
  if(method==='close'||method==='owner'&&value.owner==='human')conversationTerminals.releaseShell(value.sessionId);
 }
 if(['owner','close'].includes(method)){emit('studio:event',{method:'studio/computeResourceChanged'});const provider=workflowContext.current()?.provider;if(provider)void scientificTools(provider).then(params=>emit('studio:event',{method:'studio/toolsStatus',provider,params})).catch(()=>{});}return result;});

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
worker.setProjectSkills(projectSkills);
const runToolScope=(scope,run)=>agents.runForScope(scope,()=>workflowContext.runForScope(scope,run));
worker.setToolScope(runToolScope);
managedWorkbench=createManagedWorkbench({catalog,profiles:computeProfiles,registration:serviceRegistration,terminal:sharedTerminal,projectSkills,resourceActivity,
 resourceWorkspace,terminalAuthorization:workspaceTerminalAuthorization,developerCompute,
 hostedServiceReplaced:value=>{if(sshService.hostedServiceReplaced(value))emit('studio:event',{method:'studio/computeResourceChanged'});},
 projectAccess:projectTerminalAccess,records:taskRecords,workflow:workflowContext,agents,privateAccess,workerSource,sshTransportSource,handle,
 worker,conversationTerminals,closeSsh:sshConnectionRoutes.closeExact,assertConnectionIdle:target=>{
  if(!target||computeResource.peek()?.connectionId===target.connectionId||worker.identity?.connectionId===target.connectionId)assertLegacyWorkerIdle();
  if(target&&computeResource.peek()?.connectionId===target.connectionId){
   const scope=workflowContext.current();
   if(scope?.threadId&&agents.isBusy(scope.provider,scope.threadId))throw Error('managed_compute_channel_busy');
  }
 },
 notify:()=>emit('studio:event',{method:'studio/managedActivity'}),dispatch:(...args)=>agentRequests(...args),
 announce:notice=>{
  if(shuttingDown||!window||window.isFocused()&&window.isVisible()||!Notification.isSupported())return;
  const en=settings.language==='en';
  const alert=new Notification({title:en?'AIMatterLab · Monitoring limit reached':'AIMatterLab · 巡检已达上限',
   body:notice.resourceName+' · '+(notice.jobId||notice.runId)+'\n'+(en?'Follow the original job in Run records.':'作业尚无终态回执，请在运行记录中自行关注。')});
  attentionBalloons.add(alert);
  alert.once('click',()=>{focusExistingWindow();emit('studio:event',{method:'studio/openManagedAttention',params:{id:notice.id,sourceId:notice.sourceId,scheduleId:notice.scheduleId}});attentionBalloons.delete(alert);});
  alert.once('close',()=>attentionBalloons.delete(alert));alert.once('failed',()=>attentionBalloons.delete(alert));
  try{alert.show();}catch{attentionBalloons.delete(alert);}
 }});
managedResources=managedWorkbench.resources;managedSchedules=managedWorkbench.schedules;
const resourceToolSetups=createResourceToolController({
 resources:managedResources,workspaces:resourceWorkspace,skills:projectSkills,developerCompute,current:()=>workflowContext.revision(),
 emit:params=>emit('studio:event',{method:'studio/resourceToolSetupChanged',params}),
 chooseFile:async (event,kind)=>{
  trusted(event);
  const options={properties:['openFile']};
  if(kind==='manual')options.filters=[{name:settings.language==='en'?'Text and Markdown manuals':'文本和 Markdown 手册',extensions:['md','txt','rst','html']},{name:settings.language==='en'?'All files':'所有文件',extensions:['*']}];
  const result=await dialog.showOpenDialog(window,options);trusted(event);
  return result.canceled?null:result.filePaths[0];
 },
 confirm:async(row,resource,workspace,event)=>{
  trusted(event);
  const en=settings.language==='en',source=row.manifest.source,target=row.target;
  const reviewedSource=source.kind==='installed'?source.executable:[source.url,source.sha256||source.commit,source.executable].filter(Boolean).join('\n');
  const scope=[
   resource.name+' / '+workspace.account+' · '+workspace.hostIdentity.hostname,workspace.root,
   row.manifest.name+' '+row.manifest.version,row.install_root,reviewedSource,
   [target.project_id,target.cluster_id,target.environment_id,target.scheduler,target.queue].join(' / '),
   ...row.manifest.build?[(en?'Build limit ':'构建时限 ')+row.manifest.build.max_seconds+(en?' seconds':' 秒'),
     JSON.stringify(row.manifest.build.steps).slice(0,3200)]:[],
   (en?'Minimal test limit ':'最小测试时限 ')+row.manifest.test.max_seconds+(en?' seconds':' 秒'),
   JSON.stringify(row.manifest.argv).slice(0,3200)
  ].join('\n');
  const decision=await dialog.showMessageBox(window,{type:'question',title:en?'Configure resource tool':'配置资源工具',
   message:en?'Confirm the selected source and queue test':'确认工具来源和队列测试',detail:scope,
   buttons:en?['Cancel','Configure and test']:['取消','配置并测试'],defaultId:1,cancelId:0,noLink:true});
  trusted(event);return decision.response===1;
 }
});
projectSkills.resolveResource=resourceToolSetups.resolveSkills;
registerResourceToolRoutes(handle,resourceToolSetups.controller);
const desktopAgentTools={
 tools:()=>[...managedWorkbench.desktopTools.tools(),...resourceToolSetups.tools()],
 owns:name=>managedWorkbench.desktopTools.owns(name)||resourceToolSetups.owns(name),
 call:(name,args,scope)=>resourceToolSetups.owns(name)?resourceToolSetups.call(name,args,scope):managedWorkbench.desktopTools.call(name,args,scope),
};
terminalMcp=new TerminalMcp({terminal:sharedTerminal,projectSkills,scientificSkills,publicDocs:{definitions:softwareDocDefinitions,call:softwareDocs},guard:()=>worker.authoringGuard,desktopTools:desktopAgentTools,
 workerTools:workerToolBridge({connection:scope=>resourceRouting.scopedWorkerConnection(scope),
  conversationDraft:createConversationDraftTool({records:taskRecords,assertScope:scope=>workflowContext.assertScope(scope)})}),runScope:runToolScope,captureScope:scope=>agents.captureToolScope(scope)});
await terminalMcp.start();
customCv=createTaskCustomCv({records:taskRecords,worker,getProvider:()=>agents.active||settings.agentProvider||'codex',getActiveTaskId:provider=>activeAuthoringTasks.get(provider),assertProvider:context=>{workflowContext.assertScope(context);return providerId(context.provider);},assertHuman:event=>{trusted(event);return true;},access:()=>true,
 validateRuntimeReceipt:async(runtime,context)=>{const current=await worker.request('POST','/api/runtime-guide',{environment_id:context.args.environment_id,engine:'pygas.build'});return current.status==='observed'&&runtime.status==='observed'&&current.receipt===runtime.receipt_sha256;},
 confirmNumericScope:async({scope,task,structure},event)=>{
  trusted(event);const result=await dialog.showMessageBox(window,customCvNumericDialog({language:settings.language,scope,task,structure}));trusted(event);return result.response===1;
 },bindComposition:(records,id,result)=>bindComposition(records,id,result,undefined,'human')
});
for(const action of ['read','saveSpec','approveFormula','approveCode','sharing','validate','status','attach','reuse'])handle('customCv.'+action,(value,event)=>customCv.dispatch(action,value,event));
handle('task.pygas.importAsset',(value,event)=>{trusted(event);return importTaskAsset({records:taskRecords,worker,getProvider:()=>agents.active||'codex',assertHuman:()=>{if(shuttingDown||!window||window.isDestroyed()||event.sender.isDestroyed())return false;trusted(event);return true;},protectedRoots:[app.getPath('userData')],chooseFile:async()=>{const result=await dialog.showOpenDialog(window,referenceImportDialog(settings.language));return result.canceled?null:result.filePaths[0];}},value);});
agents.on('event',event=>{
 const threadId=event.params?.threadId;
 if(threadId){conversationTerminals.touch(event.provider,threadId);managedResources?.touch(event.provider,threadId);}
 if(event.method==='thread/started'&&event.provider==='codex'&&event.params?.thread&&!taskRecords.deleted('codex',event.params.thread.id))catalog.put('thread',event.params.thread.id,event.params.thread);
 taskRecords.event(event);emit('studio:event',event);
 if(threadId&&event.method==='turn/completed')setImmediate(()=>conversationTerminals.finishDeferredService(event.provider,threadId));
});
registerWorkspaceTaskRoutes({
 records:taskRecords,catalog,worker,workflowContext,agents,handle,assertIdle:assertIdleAgent,authoringAuthorization,
 getSettings:()=>settings,getLocalReview:()=>localReview,emit,
 chooseFile:async()=>{const value=await dialog.showOpenDialog(window,{properties:['openFile']});return value.canceled?null:value.filePaths[0];},
});
handle('conversation.delete',({id})=>{const prior=catalog.get('conversation',id);if(prior&&agents.isBusy(prior.provider,prior.threadId))throw Error('Stop this conversation before deleting it');
 const result=taskRecords.remove(id);conversationTerminals.forget(result.provider,result.threadId);managedResources?.forget?.(result.provider,result.threadId);resourceActivity.forget(result.provider,result.threadId);agents.forget(result.provider,result.threadId);scientificSkills.context.forget(result.id);return result;});
handle('conversation.list',()=>taskRecords.conversations());
handle('conversation.remember',value=>taskRecords.remember(value));
handle('conversation.groups',()=>taskRecords.groups());
handle('conversation.createGroup',value=>taskRecords.createGroup(value));
handle('conversation.deleteGroup',value=>taskRecords.deleteGroup(value));
handle('conversation.organize',value=>taskRecords.organize(value));
handle('conversation.rename',value=>{if(!value||Object.keys(value).sort().join(',')!=='id,name')throw Error('Invalid typed conversation name');return taskRecords.rename(value);});
handle('conversation.select',async value=>{const result=await selectConversation({catalog,records:taskRecords,workflowContext,agents,conversationTerminals,assertIdle:assertIdleAgent},value);emit('studio:event',{method:'studio/conversationTerminalChanged'});return result;});
handle('ssh.existing',()=>existingConnections(app.getPath('home'),{documents:app.getPath('documents'),includeXshellPicker:true}));
handle('ssh.import',({ref})=>existingProfile(app.getPath('home'),ref,{documents:app.getPath('documents'),selectXshellSession:async()=>{
  const response=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'Xshell session',extensions:['xsh']}]});
  return response.canceled?null:response.filePaths[0];
}}));
handle('cluster.download',async value=>{
 value=clusterDownloadRequest(value);
 const {expected_sha256,...request}=value;
 const first=await worker.request('POST','/api/cluster/browse',{...request,offset:0});
 if(typeof first.base64!=='string'||!first.sha256)throw Error('Select a regular file in an authorized read root');
 if(expected_sha256!==undefined&&expected_sha256!==first.sha256)throw Error('远程文件已变化，请重新预览后下载');
 const response=await dialog.showSaveDialog(window,{defaultPath:path.basename(value.relative)});
 if(response.canceled)return null;
 const file=response.filePath,temp=file+'.partial-'+randomUUID(),hash=createHash('sha256');let fd=null,current=first,offset=0;
 try{
  fd=fs.openSync(temp,'w');
  for(let pages=0;;pages++){
   if(pages>16384)throw Error('Remote file exceeds the bounded download window');
   const data=Buffer.from(current.base64,'base64');if(!data.length&&offset<first.size)throw Error('Remote file changed');fs.writeSync(fd,data);hash.update(data);offset=current.offset;
   if(offset>=first.size)break;
    current=await worker.request('POST','/api/cluster/browse',{...request,offset});if(current.size!==first.size)throw Error('Remote file changed');
  }
  if(hash.digest('hex')!==first.sha256)throw Error('Remote file hash mismatch');
  fs.closeSync(fd);fd=null;
  fs.renameSync(temp,file);
 }catch(error){if(fd!==null)try{fs.closeSync(fd)}catch{};try{fs.unlinkSync(temp)}catch{};throw error;}
 return {path:file,bytes:offset,sha256:first.sha256};
});
handle('agent.bindProject',({projectId,provider})=>{providerId(provider);if(typeof projectId!=='string'||!projectId||projectId.length>100)throw Error('Select a project');settings=catalog.put('settings','main',{...settings,projectAgents:{...settings.projectAgents,[projectId]:provider}});return {projectId,provider};});
handle('state',() => ({ settings, threads:catalog.list('thread'), ssh:catalog.list('ssh'), setupGuide:verifying?null:setupGuide.info() }));
handle('onboarding.progress',request=>setupGuide.progress(request));
handle('onboarding.openDirectory',request=>setupGuide.open(request));
handle('diagnostics.performance',value=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid performance observation');
 if(Object.keys(value).length===0)return performanceTimeline.snapshot();
 if(Object.keys(value).join(',')!=='phase'||!['renderer-interactive','workspace-observed'].includes(value.phase))throw Error('Invalid renderer performance phase');
 return performanceTimeline.mark(value.phase);
});
handle('settings',data=>{
 const next=normalizeSettings(settings,data);
 const previousDeveloperWorkspace=settings.developerComputeWorkspaceId??null;
 const nextDeveloperWorkspace=next.developerComputeWorkspaceId??null;
 if(previousDeveloperWorkspace!==nextDeveloperWorkspace)developerCompute.verifyChange(previousDeveloperWorkspace,nextDeveloperWorkspace,managedResources.snapshot());
 next.userCacheDirectory=projectSkills.prepareRoot(next.userCacheDirectory||defaultUserCacheDirectory);
 if(projectSkills.root!==next.userCacheDirectory)rememberSkillCache();
 settings=catalog.put('settings','main',next);workbenchTray?.menu();
 if(previousDeveloperWorkspace!==nextDeveloperWorkspace){
  developerCompute.changed(previousDeveloperWorkspace,nextDeveloperWorkspace);
  managedResources.endDeveloperAccess(previousDeveloperWorkspace);
  emit('studio:event',{method:'studio/managedActivity'});
 }
 if(projectSkills.root!==settings.userCacheDirectory){
  projectSkills.root=settings.userCacheDirectory;
  agents.updateInstructions(workspaceAgentInstructions(workspace,projectSkills.personalDirectory));
 }
 return settings;
});
function scientificSources(){return discoverSources({cwd:settings.cwd,applicationRoot:app.isPackaged?undefined:root,workspaceSources:workspace?.sources,ids:settings.sourceIds,roots:[...(settings.sourceRoots||[]),...catalog.list('source-binding').map(v=>v.root)]});}
async function bindSources(current=()=>{}){if(worker.identity?.kind==='ssh'){current();return worker.request('GET','/api/source-projects');}const sources=scientificSources();for(const source of sources){current();await worker.request('POST','/api/source-projects',{...source,root:linuxPath(source.root)});current();catalog.put('source-binding',source.id,source);}return sources;}
handle('sources.list',()=>scientificSources());
handle('sources.diagnose',async()=>{const sources=scientificSources();return {sources,tools:toolInventory(sources),worker:worker.connection?await worker.request('GET','/api/tools/status'):null};});
function assertIdleAgent(){agents.assertContextIdle();}
function assertLegacyWorkerIdle(){
 if(agents.turnStates().some(turn=>resourceRouting.usesForegroundWorker(agents.sessionIdentity(turn.provider,turn.threadId)?.id)))
  throw Error('An active conversation is still using this workbench worker');
}
const configureCompute=createComputeOnboarding({worker,publish:event=>emit('studio:event',event)});
function discoverCompute(){if(settings.autoDiscoverCompute!==false)return configureCompute().catch(()=>null);return Promise.resolve(null);}
handle('compute.setup',async data=>configureCompute(data||{}));
const computeConnection=createComputeConnection({worker,profiles:computeProfiles,records:taskRecords,catalog,settings:()=>settings,selection:()=>workflowContext.current(),selectionEpoch:()=>workflowContext.revision(),source:()=>({path:workerSource,id:worker.bundledRuntimeId}),beforeSwitch:assertLegacyWorkerIdle,bindFreshSources:bindSources,saveSettings:target=>{settings=catalog.put('settings','main',{...settings,distribution:target.distribution,workerRoot:target.workerRoot,workerPort:target.workerPort});},remember:(target,evidence)=>{const value={version:1,distribution:worker.identity?.distribution,root:worker.identity?.root,port:target.workerPort,intent:evidence.intent||'standard',settingsSignature:workerSettingsSignature(settings),checkedAt:evidence.checkedAt,...evidence.serviceVersion==='current'?{sourceIdentity:{runtimeId:worker.bundledRuntimeId}}:{}};if(!validExplicitBinding(value,settings)||worker.connection?.health?.root!==value.root||worker.connectionTarget?.port!==value.port)throw Error('Verified connection receipt changed');catalog.put('worker-binding','last-explicit',value);},onConnected:view=>{emit('studio:event',{method:'studio/workerConnected',params:{}});void managedWorkbench.publishLocal(worker,view?.profileId).catch(()=>emit('studio:event',{method:'studio/managedActivity'}));}});
handle('compute.connection.plan',value=>computeConnection.plan(value));
handle('compute.connection.status',value=>computeConnection.status(value));
handle('compute.connection.connect',async value=>{assertLegacyWorkerIdle();if(computeResource.peek())throw Error('请先在连接设置明确选择本地计算资源；后台 SSH 通道会保留。');await sshService.resourceChanged();return computeConnection.connect(value);});
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
handle('worker.connect',async()=>{assertLegacyWorkerIdle();if(computeResource.peek())throw Error('请先在连接设置明确选择本地计算资源；后台 SSH 通道会保留。');await sshService.resourceChanged();const target={...settings},result=await worker.connect(target,workerSource),receipt=explicitWorkerReceipt(worker,target);await bindSources();await rememberExplicitWorker({catalog,worker,settings:()=>settings},receipt);discoverCompute();await managedWorkbench.publishLocal(worker);emit('studio:event',{method:'studio/workerConnected',params:{}});return result;});
handle('worker.status',()=>readWorkerStatus(worker,()=>settings));
handle('worker.restore',value=>restoreTaskWorker({records:taskRecords,catalog,worker,settings:()=>settings,selection:()=>workflowContext.current(),selectionEpoch:()=>workflowContext.revision(),selectedResource:()=>computeResource.peek()},value));
handle('task.authoring.bindWorker',value=>{assertIdleAgent();return bindLegacyAuthoringWorker({records:taskRecords,worker,selection:()=>workflowContext.current(),settings:()=>settings},value).then(taskForRecordIndex);});
handle('worker.request',async({method,target,data,projectScope}) => {
  assertRendererWorkerRoute(method,target);
  const route=new URL(target,'http://127.0.0.1').pathname;
  if(projectScope!==undefined){
    const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
    if(target!=='/api/projects'||!['GET','POST'].includes(method)||!projectScope||typeof projectScope!=='object'||Object.keys(projectScope).sort().join(',')!=='connectionId,profileId,profileVersion'||
      !id(projectScope.connectionId)||!id(projectScope.profileId)||!Number.isSafeInteger(projectScope.profileVersion)||projectScope.profileVersion<1)throw Error('Invalid scoped project request');
    const matches=value=>value?.connectionId===projectScope.connectionId&&value?.profileId===projectScope.profileId&&value?.profileVersion===projectScope.profileVersion;
    const resource=computeResource.capture(),owner=workflowContext.revision(),connection=worker.connection,epoch=worker.connectionEpoch;
    if(resource.selection?.kind!=='ssh-connection'||!matches(resource.selection))throw Error('project_edit_unavailable');
    const observed=await readWorkerStatus(worker,()=>settings);
    try{computeResource.assertCurrent(resource);}catch{throw Error('project_edit_unavailable');}
    if(observed.status!=='connected'||observed.sourceKind!=='ssh'||!matches(observed)||workflowContext.revision()!==owner||worker.connection!==connection||worker.connectionEpoch!==epoch)throw Error('project_edit_unavailable');
  }
  if(method==='POST'&&route==='/api/cluster/submit'&&data&&Object.hasOwn(data,'managed_monitor'))throw Error('Managed submission metadata belongs to the private resource service');
  if(method==='POST'&&route==='/api/structures/create')return createStructureWithAuthoringContext({records:taskRecords,worker,selection:()=>workflowContext.current()},data);
  if(method==='POST'&&['/api/clusters','/api/cluster/test'].includes(route)&&requiresCurrentSshWorker(route==='/api/cluster/test'?data?.connection:data))await requireCurrentSshWorker(worker,()=>readWorkerStatus(worker,()=>settings));
  if(method==='POST'&&['/api/cluster/probe','/api/cluster/browse'].includes(route)&&data?.cluster_id){const connection=worker.connection,epoch=worker.connectionEpoch,observed=await readWorkerStatus(worker,()=>settings);if(observed.status!=='connected'||observed.serviceVersion!=='current'){const profile=await worker.request('POST','/api/cluster/profile',{cluster_id:data.cluster_id});if(worker.connection!==connection||worker.connectionEpoch!==epoch||requiresCurrentSshWorker(profile))throw Error('needs_worker_update');}}
  const result=await worker.request(method,target,data);
  if(method==='POST'&&['/api/cluster/submit','/api/runs/submit','/api/run/submit','/api/cluster/cancel','/api/run/cancel'].includes(target))
    void readWorkerStatus(worker,()=>settings).then(status=>status.sourceId&&managedSchedules?.refresh(status.sourceId)).catch(()=>{});
  if(method==='GET' && ['/api/projects','/api/environments'].includes(target))
    for(const item of result) catalog.put(target.split('/').at(-1),item.id,item);
  return result;
});
handle('codex.envImport.pending',input=>{
 if(Object.keys(input).length)throw Error('Invalid Codex configuration request');
 return subscriptionRuntime.envImport.current();
});
handle('codex.envImport.decide',input=>{subscriptionRuntime.envImport.decide(input);return null;});
handle('codex.connect',async() => agents.connect('codex',{checkLogin:true}));
handle('codex.configure',async({preferences={},threadId,model}) => {
  assertIdleAgent();
  agentConfig(preferences);
  settings=catalog.put('settings','main',{...settings,agent:preferences});
  return agents.configure('codex',preferences,threadId,model);
});
handle('codex.rpc',value=>agentRpc({...value,provider:'codex'}));
registerWorkflowPlanRoutes({handle,catalog});
async function scientificTools(provider,threadId){
 const session=managedResources?agents.sessionIdentity(provider,threadId):null;
 const task=session?.threadId?taskRecords.bound(provider,session.threadId):null;
 const workflowBound=!!task&&!!(task.customCv?.id||taskWorkerSource(task));
 const localReadiness=async()=>{
  const selected=await resourceRouting.readiness(provider,threadId);if(selected&&!workflowBound)return selected;
  const terminalReady=()=>!workflowBound&&sharedTerminal?.hasCurrentGrant(provider)?{status:'ready',scope:'terminal-only',scientificStatus:'blocked',count:3,transport:'desktop-terminal',message:'共享终端可用',checkedAt:Date.now()}:null;
  if(!worker.providerConnection(provider)&&terminalReady())return terminalReady();
  const result=await scientificToolReadiness({worker,codex:agents.bridge('codex')||codex,workflowContext,records:taskRecords,privateAccess,selectedProvider:()=>agents.active},provider);
  return result.status==='blocked'?terminalReady()||result:result;
 };
 if(!managedResources)return localReadiness();
 const [local,managedTools]=await Promise.all([localReadiness(),managedToolReadiness({agents,terminalMcp},provider,threadId)]);
 const owner=agents.sessionIdentity(provider,threadId);
 if(owner?.id!==session?.id||owner?.threadId!==session?.threadId)throw Error('Agent selection changed during the tool check');
 return {...local,managedCompute:true,managedTools,workflowBound,...owner?.threadId?{threadId:owner.threadId}:{}};
}
handle('agent.connect',async({provider,repairTools=false,threadId})=>{
 providerId(provider);if(typeof repairTools!=='boolean'&&repairTools!=='managed')throw Error('Invalid repair request');if(threadId!==undefined&&(typeof threadId!=='string'||!threadId.trim()||threadId.length>200))throw Error('Invalid connection conversation');
 if(repairTools&&threadId!==undefined){const owner=workflowContext.current();if(owner?.provider!==provider||owner?.threadId!==threadId)throw Error('请先选择要修复工具连接的原对话。');}
 if(repairTools==='managed'){
  const owner=agents.sessionIdentity(provider);
  if(!managedResources||!owner||owner.threadId!==(threadId??null))throw Error('请先选择要修复工具连接的原对话。');
 }
 const key=JSON.stringify([provider,threadId||null]),connectionTicket=Symbol();agentConnectAttempts.set(key,connectionTicket);
 const current=()=>agentConnectAttempts.get(key)===connectionTicket;
 try{
 const resource=resourceRouting.capture(provider,threadId);
 if(repairTools==='managed'||repairTools&&['ssh-terminal','ssh-connection'].includes(resource.selection?.kind)){if(agents.isBusy(provider,threadId))throw Error('Conversation in progress');agents.disconnect(provider,threadId);}
 else if(repairTools){
  if(agents.isBusy(provider,threadId))throw Error('Conversation in progress');const revision=workflowContext.revision(),owner=workflowContext.current(),connection=worker.connection,epoch=worker.connectionEpoch;
  const task=owner?.taskId?taskRecords.read(owner.taskId):null;let source,target;try{source=taskWorkerSource(task);target=task?taskWorkerTarget(task,settings,catalog):settings;}catch{throw Error('请先通过“连接计算资源”核对原服务来源和端口，再修复工具连接。');}
  if(task&&(!source||!target||!validTransportPort(target.workerPort)))throw Error('请先通过“连接计算资源”核对原服务来源和端口，再修复工具连接。');
  const transportScope=task?taskTransportScope(task):null,transportReceipt=task?taskTransportReceipt(task,catalog):null;
  const observed=await readWorkerStatus(worker,()=>target||settings);
  if(observed.status!=='connected'||workflowContext.revision()!==revision||worker.connection!==connection||worker.connectionEpoch!==epoch||task&&(JSON.stringify(transportScope)!==JSON.stringify(taskTransportScope(taskRecords.read(task.id)))||JSON.stringify(transportReceipt)!==JSON.stringify(taskTransportReceipt(taskRecords.read(task.id),catalog)))||source&&(!sameWorkerBinding(source.binding,worker)||worker.connectionTarget?.port!==target.workerPort))throw Error('请先通过“连接计算资源”恢复此流程的原作业服务，再修复工具连接。');
  if(agents.isBusy(provider,threadId))throw Error('Conversation in progress');
  agents.disconnect(provider,threadId);
 }
 // Model/account recovery never registers sources or environments.
 // Compute setup owns discovery/registration; App restores its saved binding separately.
 settings=catalog.put('settings','main',{...settings,agentProvider:provider});
 let info;try{info=await agents.connect(provider,{threadId,checkLogin:true,assertCurrent:()=>{resource.assertCurrent();if(!current())throw Error('Agent connection was superseded');}});}catch(error){if(current()&&error.readiness&&['missing','incompatible','invalid'].includes(error.readiness.status)&&['kimi','qwen'].includes(provider)){resource.assertCurrent();emit('studio:event',{method:'studio/cliRuntimeRequired',provider,params:error.readiness});return {cliRequired:error.readiness};}throw error;}
 resource.assertCurrent();
 if(info?.loginRequired)return info;
 const tools=await scientificTools(provider,threadId);resource.assertCurrent();
 emit('studio:event',{method:'studio/toolsStatus',provider,params:tools});
 const defaults=provider==='codex'?subscriptionRuntime.envImport.settings().defaults:null;
 return {...info,tools,...defaults?{nativeCodexDefaults:defaults}:{}};
 }finally{if(current())agentConnectAttempts.delete(key);}
});
handle('agent.tools',async({provider,threadId})=>{
 providerId(provider);
 if(threadId!==undefined&&(typeof threadId!=='string'||!threadId.trim()||threadId.length>200||agents.sessionIdentity(provider)?.threadId!==threadId))throw Error('Select the conversation before checking its tools');
 return scientificTools(provider,threadId);
});
handle('agent.disconnect',({provider})=>{providerId(provider);workflowContext.clear(provider);agents.disconnect(provider);return {};});
registerModelProfileRoutes({handle,agents,assertIdle:()=>{assertIdleAgent();agents.assertContextIdle();},emit:event=>emit('studio:event',event),fetchApi:(...args)=>net.fetch(...args)});
handle('agent.account',({provider})=>{providerId(provider);return agents.account(provider);});
handle('agent.cli.inspect',value=>cliRuntimes.inspect(cliRuntimeRequest(value)));
handle('agent.cli.install',value=>cliRuntimes.install(cliRuntimeRequest(value,{installation:true})));
handle('agent.cli.cancel',value=>cliRuntimes.cancel(cliRuntimeRequest(value,{installation:true})));
handle('agent.cli.choose',async value=>{
 const {provider}=cliRuntimeRequest(value),response=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'CLI program',extensions:['exe','js','mjs','cjs','cmd','bat']}]});
 if(response.canceled)return null;
 const readiness=await cliRuntimes.inspect({provider,executable:response.filePaths[0]});
 if(readiness.status==='ready')settings=catalog.put('settings','main',normalizeSettings(settings,{[provider+'Path']:response.filePaths[0]}));
 return readiness;
});
const agentRequests=createAgentRequests({runtime:()=>({agents,catalog,taskRecords,workflowContext,privateAccess,worker,sharedTerminal,resourceRouting,conversationTerminals,recordUserTurn:value=>{managedWorkbench.userMessage(value);resourceToolSetups.recordUserTurn(value);},authoringAuthorization,baseWorkspace,scientificSkills,setupInstructions,projectSkills,bundledSkillRoot,studioSkillRoots,managedSkillRoots,managedSkillEntries,managedSkillRecords,skillGuidanceScope,assertIdleAgent,emit,openUrl,root,app})});
async function agentRpc(value){return agentRequests(value);}
managedSchedules.start();
handle('agent.rpc',agentRpc);
handle('agent.recover',async({provider,threadId,model})=>{
 if(provider!=='codex'||typeof threadId!=='string'||!threadId||threadId.length>200||model!==undefined&&(typeof model!=='string'||!model||model.length>200))throw Error('Invalid conversation recovery request');
 return agents.runInConversation(provider,threadId,async()=>{agents.assertContextIdle();
 const ticket=workflowContext.begin(provider,threadId);await workflowContext.synchronize(ticket,(p,context)=>agents.selectContext(p,context));
 return (await resumeConversationContext({records:taskRecords,workflowContext,agents,ticket,threadId,model,explicit:true,publish:event=>emit('studio:event',event)})).result;
 });
});
handle('agent.respond',({provider,threadId,id,result})=>{providerId(provider);if(!(typeof id==='string'&&id.length>0&&id.length<=200)&&!Number.isSafeInteger(id))throw Error('Invalid agent response identity');if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Invalid agent response');return agents.respond(provider,threadId,id,result);});
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
handle('agent.login.cancel',value=>{
 if(value.provider==='codex'&&Object.keys(value).length===2&&Object.hasOwn(value,'loginId'))return agents.cancelCodexLogin(value.loginId);
 if(Object.keys(value).length===0||value.provider==='kimi'&&Object.keys(value).length===1){agents.cancelLogin('kimi');return {};}
 throw Error('Invalid provider login cancellation');
});
handle('agent.logout',async value=>{if(!value||Object.keys(value).join(',')!=='provider')throw Error('Invalid typed account request');assertIdleAgent();const result=await agents.logout(value.provider);emit('studio:event',{method:'studio/accountUpdated',provider:value.provider,params:{credentialsChanged:true}});return result;});
handle('agent.testConnection',async value=>{if(!value||Object.keys(value).join(',')!=='provider')throw Error('Invalid typed account request');assertIdleAgent();return agents.testConnection(value.provider);});
handle('agent.login.open',async({provider})=>{
  const state=await agents.account(provider);if(!state.url)throw Error('Start provider login first');return shell.openExternal(loginUrl(provider,state.url));
});
handle('skills.catalog',async()=>{const policy=await scientificSkills.resolvePolicy(skillGuidanceScope(agents.active));const result=[...localSkills(studioSkillRoots(),{policy,projectSkills,bundledRoot:bundledSkillRoot}),...managedSkillEntries(policy)];await policy.revalidate();return result;});
handle('scientific.skills',({provider})=>{providerId(provider);return scientificSkills.catalog(provider,skillGuidanceScope(provider));});
handle('codex.respond',({threadId,id,result})=>{if(!(typeof id==='string'&&id.length>0&&id.length<=200)&&!Number.isSafeInteger(id))throw Error('Invalid agent response identity');if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Invalid agent response');if(agents.active!=='codex')throw Error('Provider switched');return codex.respond(id,result);});
handle('file.open',async() => {
  const response=await dialog.showOpenDialog(window,{properties:['openFile']});
  if(response.canceled) return null;
  const file=response.filePaths[0], stat=fs.statSync(file);
  if(stat.size>2*1024*1024) throw new Error('Text editor limit is 2 MiB');
  const id=randomUUID();
  return { id,path:file,name:path.basename(file),content:fs.readFileSync(file,'utf8') };
});
handle('file.save',async value=>createWindowsSaveAs({grants:new Map(),choose:options=>dialog.showSaveDialog(window,options),write:(file,content)=>fs.writeFileSync(file,content,'utf8')})(value));
handle('file.choose',async({directory=false}) => {
  const response=await dialog.showOpenDialog(window,{properties:[directory?'openDirectory':'openFile']});
  return response.canceled?null:response.filePaths[0];
});
registerLegacyTerminalRoutes({handle,worker,catalog,terminals,getSettings:()=>settings,workerSource,emit,host:computeRuntime});
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
  const file=response.filePath,temp=file+'.partial-'+randomUUID();
  try{
   const bytes=Buffer.from(bundle.base64,'base64');if(!bytes.length)throw Error('Empty reproduction archive');
   if(typeof bundle.sha256==='string'&&createHash('sha256').update(bytes).digest('hex')!==bundle.sha256)throw Error('Reproduction archive hash mismatch');
   fs.writeFileSync(temp,bytes);fs.renameSync(temp,file);
  }catch(error){try{fs.unlinkSync(temp)}catch{};throw error;}
  return file;
});
let terminalClosing,managedClosing;
desktopShutdown=installDesktopShutdown({app,begin:()=>{
 shuttingDown=true;agentConnectAttempts.clear();resourceToolSetups.close();managedSchedules?.halt();managedClosing=managedResources?.stop();updater.close();clearInterval(terminalIdleTimer);conversationTerminals.stop();
 // Fence the terminal bridge on this exact stack, before already-queued open
 // continuations can run. The asynchronous cleanup below only waits for it.
 try{terminalClosing=sharedTerminal.shutdown({timeoutMs:4000});}catch{terminalClosing=Promise.resolve({status:'unconfirmed'});}
},cleanup:async()=>{
 for(const cleanup of [()=>terminalMcp?.close(),()=>sshConnection.shutdown(),()=>agents.close(),()=>worker.close(),()=>{for(const t of terminals.values())t.child.kill();}])try{cleanup();}catch{}
 await managedClosing;
 return await terminalClosing;
}});
window=new BrowserWindow({width:1540,height:980,minWidth:1100,minHeight:720,frame:false,
  backgroundColor:'#15151b',title:PRODUCT_NAME,show:false,
  webPreferences:{backgroundThrottling:!verifying,offscreen:improvementsVerifying,preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
performanceTimeline.mark('window-created');
if(!verifying) {
 const appIcon=nativeImage.createFromPath(path.join(root,'build','icon.ico'));
 const icon=appIcon.isEmpty()?await app.getFileIcon(process.execPath,{size:'small'}):appIcon;
 workbenchTray=installManagedTray({app,window,Tray,Menu,icon,language:()=>settings.language,isQuitting:()=>shuttingDown});
 app.on('activate',focusExistingWindow);
}
installSshPrivacyLifecycle(window.webContents,sshConnection);
window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
window.webContents.on('will-navigate',(event,url)=>{if(url!==window.webContents.getURL()) event.preventDefault();});
// The renderer needs no web platform permissions; deny every request explicitly.
window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
window.webContents.session.setPermissionCheckHandler(()=>false);
const development=process.env.STUDIO_DEV_URL;
if(development && !/^http:\/\/127\.0\.0\.1:5173\/?$/.test(development)) throw new Error('Invalid development origin');
const loaded=await loadRecoverableWorkbench({
 window,isQuitting:()=>shuttingDown,
 load:()=>development?window.loadURL(development):window.loadFile(path.join(root,'dist','index.html')),
 recordExit:({reason,exitCode})=>{
  try{fs.writeFileSync(path.join(profileDirectory,'renderer-exit.json'),JSON.stringify({at:new Date().toISOString(),version:app.getVersion(),reason,exitCode})+'\n');}
  catch{console.error('Could not record renderer exit',reason,exitCode);}
 },
 askRetry:async()=>{
  const en=settings.language==='en',options={type:'warning',title:PRODUCT_NAME,
   message:en?'The workbench could not be displayed.':'工作台画面未能恢复。',
   detail:en?'Reload the workbench now, or open it from the tray to try again later.':'可以立即重新加载，也可以稍后从系统托盘打开 AIMatterLab 重试。',
   buttons:en?['Reload workbench','Later']:['重新加载工作台','稍后重试'],defaultId:0,cancelId:1,noLink:true};
  const decision=window.isVisible()?await dialog.showMessageBox(window,options):await dialog.showMessageBox(options);
  return decision.response===0;
 }
});
if(!loaded||shuttingDown)return;
performanceTimeline.mark('window-loaded');
if(verifying){const errors=[];window.webContents.on('console-message',(...args)=>{const {level,message}=consoleMessage(args);if(level===3)errors.push(message);});const {verifyDesktop}=await import(installationVerifying?'./platform/verification/install-verification.mjs':improvementsVerifying?'./platform/verification/improvements-verification.mjs':providerVerifying?'./platform/verification/provider-verification.mjs':'./platform/verification/verification.mjs');const ok=await verifyDesktop(window,verificationRoot,errors,{publish:event=>emit('studio:event',event),packaged:app.isPackaged,version:app.getVersion(),taskAttach:(...args)=>taskRecords.attach(...args),taskEvent:event=>taskRecords.event(event),agentPaths:{kimi:settings.kimiPath,qwen:settings.qwenPath}});await desktopShutdown.run();app.exit(ok?0:1);}else window.show();
app.on('window-all-closed',()=>app.quit());
if(workspace){const timer=setTimeout(()=>{if(!shuttingDown&&updater.snapshot().phase==='idle')void updater.check();},4000);timer.unref();}

}
function focusExistingWindow(){if(!window||window.isDestroyed())return;if(window.isMinimized())window.restore();window.show();window.focus();}
// A second desktop instance would race the same Catalog, broker descriptor and
// fixed worker port. Refuse it and focus the existing window instead.
if(!app.requestSingleInstanceLock()){
 console.error('AIMatterLab is already running for this profile; closing this instance.');
 app.exit(0);
}else{
 app.on('second-instance',focusExistingWindow);
 app.whenReady().then(async()=>{
  const network=networkProxy();
  for(const [key,value] of Object.entries(network.env)){
   if(process.env[key]!==value)process.env[key]=value;
  }
  await configureNetworkSession(session.defaultSession,network);
  return initialize();
 }).catch(async error=>{console.error(error);const log=path.join(app.getPath('userData'),'startup-error.log');try{fs.mkdirSync(path.dirname(log),{recursive:true});fs.appendFileSync(log,new Date().toISOString()+' '+String(error.stack||error)+'\n');dialog.showErrorBox(PRODUCT_NAME+' 启动失败','项目与连接配置已保留。请查看诊断日志：\n'+log);}catch{}await desktopShutdown?.run();app.exit(1);});
}
