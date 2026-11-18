/** Agent input assembly and acknowledgment; all task/state effects use injected backend ports. */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {assertRpc} from '../../contracts/transport-policy.mjs';
import {providerId} from '../providers/contracts.mjs';
import {visibleUserText} from "../../contracts/agent/user-message.mjs";

import {ensureTaskAuthoring} from '../../backend/main/workspace/task-authoring.mjs';
import {toolGuidanceTarget} from '../../backend/main/compute/tool-guidance-target.mjs';
import {terminalOnlyTurn} from './terminal-turn.mjs';
import {ensureDefinitionContext} from './private-conversation-context.mjs';
import {resumeConversationContext} from './conversation-recovery.mjs';
import {currentPrivateTurn} from '../context/private-task-context.mjs';
import {interactionFlags,interactionModeContext} from '../context/interaction-mode.mjs';
import {deliverScientificTurn} from './scientific-turn.mjs';
import {sourceContext} from '../context/source-context.mjs';
import {localSkills} from '../skills/skills.mjs';
import {selectedSkillContext} from '../skills/skill-context.mjs';
import {managedToolSkillContext} from '../skills/managed-tool-context.mjs';

export function createAgentRequests({runtime}){
 async function request({provider,method,params={}},{notification}={}){
 const {agents,catalog,taskRecords,workflowContext,privateAccess,worker,sharedTerminal,resourceRouting,conversationTerminals,authoringAuthorization,baseWorkspace,scientificSkills,setupInstructions,projectSkills,bundledSkillRoot,studioSkillRoots,managedSkillRoots,managedSkillEntries,managedSkillRecords,skillGuidanceScope,assertIdleAgent,recordUserTurn,emit,openUrl,root,app}=runtime();
 providerId(provider);assertRpc(method);
 const userParams=params;
 const turnFlags=['turn/start','turn/steer'].includes(method)?interactionFlags(params):null;
 const resource=resourceRouting?.capture(provider,params.threadId),selectedSsh=['ssh-terminal','ssh-connection'].includes(resource?.selection?.kind)?resource.selection:null;
 if(turnFlags)resourceRouting?.assertHandoffComplete?.(provider,params.threadId);
 const {studioSkillId,studioTurnRequestId,studioInitialProjectId,...protocolParams}=params;params=protocolParams;
 if(studioInitialProjectId!==undefined&&method!=='thread/start')throw Error('An initial project belongs to a new conversation');
 if(studioTurnRequestId!==undefined&&(typeof studioTurnRequestId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(studioTurnRequestId)))throw Error('Invalid turn request identity');
 if(studioSkillId!==undefined&&(typeof studioSkillId!=='string'||!scientificSkills.router.routes.has(studioSkillId)))throw Error('Choose a listed scientific function');
 const reservedShell=method==='thread/start'?conversationTerminals?.pendingForNewConversation(provider):null;
 let ticket,skillContext,skillKey,modelCurrent,terminalOnly=false,definitionOnlyTurn=false;
 const check=()=>{resource?.assertCurrent();if(ticket)workflowContext.assert(ticket);modelCurrent?.();};
 const recordUser=()=>{if(turnFlags&&!notification)recordUserTurn?.({provider,method,params:{...userParams,threadId:params.threadId}});};
 const selectedTerminalReady=async()=>{const status=await resourceRouting.readiness(provider,params.threadId);check();if(status?.status!=='ready'||status.resource?.selectionId!==selectedSsh.selectionId)throw Error('请先将所选 SSH 终端交接给当前对话；不会改用其他计算资源。');};
 const synchronize=async()=>{check();await workflowContext.synchronize(ticket,(p,context)=>agents.selectContext(p,context));check();};
 if(['thread/start','thread/resume','turn/start'].includes(method)){
  if(agents?.runInConversation)agents.assertContextIdle();else assertIdleAgent();
  if(method==='turn/start'){scientificSkills.clearManagedSelection?.(provider,params.threadId);setupInstructions?.clear?.(provider,params.threadId);}ticket=workflowContext.begin(provider,method==='thread/start'?null:params.threadId,studioInitialProjectId);
  if(method==='turn/start')recordUser();
  if(method!=='thread/start'){await conversationTerminals?.acquire(provider,workflowContext.current());check();}
  await synchronize();
 }
 const managed=Array.isArray(resource?.resources);
 const managedOnly=managed&&turnFlags&&!resourceRouting.scopedWorkerConnection?.({...workflowContext.current(),sessionId:workflowContext.sessionId?.(),checkCurrent:()=>{try{check();return true;}catch{return false;}}});
 if(method==='turn/start'&&['qwen','compatible'].includes(provider))modelCurrent=agents.bridge?.(provider)?.prepareTurnModel?.(params);
  if(selectedSsh&&['turn/start','turn/steer'].includes(method)){await selectedTerminalReady();terminalOnly=resourceRouting.workerSelected?.(provider,params.threadId)!==true;}
 else terminalOnly=!managed&&['turn/start','turn/steer'].includes(method)&&!worker.providerConnection(provider)&&sharedTerminal.hasCurrentGrant(provider);
 if(method==='turn/steer'&&!terminalOnly){const task=taskRecords.bound(provider,params.threadId);if(task&&(!managedOnly||task.customCv?.id)&&(await privateAccess.assertTask(task,provider)).definitionOnly)throw Error('Send a new definition-only message after the current reply completes; private steering does not accept automatic workspace context');check();}
 if(method==='turn/steer'&&terminalOnly)params=terminalOnlyTurn(params,{provider,resource:selectedSsh});
 if(method==='turn/steer'&&!terminalOnly){
  const task=taskRecords.bound(provider,params.threadId),{planningMode,reviewMode,studioTaskId,studioToolContext,...rest}=params;
  if(studioTaskId!==undefined&&studioTaskId!==task?.id)throw Error('Task is not bound to this conversation');
  if(turnFlags.reviewMode)throw Error('Review requires a new workflow turn');
  params={...rest,input:[...(rest.input||[]),{type:'text',text:interactionModeContext({...turnFlags,scope:task?'workflow':'chat'})+(task?'\nstudioTaskId: '+task.id:'')}]};
 }
 if(method==='turn/start'&&!terminalOnly){
  let task=taskRecords.bound(provider,params.threadId);
  if(task&&(!managedOnly||task.customCv?.id)){const access=await privateAccess.assertTask(task,provider);check();if(access.definitionOnly){
   if(params.reviewMode===true)throw Error('Current sharing covers only this private definition; full workflow review needs separately selected input-file permission');
   const {planningMode,studioTaskId,reviewMode,...privateParams}=params;currentPrivateTurn(privateParams,task,{planningMode:turnFlags.planningMode});
   if(provider!=='codex'||notification)throw Error('Definition-only sharing requires an isolated fresh Codex context explicitly opened for the private definition');
   const clean=await ensureDefinitionContext({records:taskRecords,workflowContext,agents,task,ticket,model:params.model,publish:event=>emit('studio:event',event)});ticket=clean.ticket;check();params={...params,threadId:clean.task.threadId};definitionOnlyTurn=true;
  }}
 }
 skillKey=provider+':'+params.threadId;
 if(method==='turn/start'&&terminalOnly){
  params=terminalOnlyTurn(params,{provider,resource:selectedSsh});check();
  if(provider==='codex'&&!agents.threadReady(params.threadId)&&!notification){
   const resumed=await resumeConversationContext({records:taskRecords,workflowContext,agents,ticket,threadId:params.threadId,model:params.model,publish:event=>emit('studio:event',event)});ticket=resumed.ticket;check();
   if(resumed.result.studioRecovery?.status==='required')return resumed.result;
   params={...params,threadId:resumed.result.thread.id};
  }
  if(selectedSsh)await selectedTerminalReady();else if(!sharedTerminal.hasCurrentGrant(provider))throw Error('终端交接所属会话已变化，请在当前对话重新交接。');
 }
 if(method==='turn/start'&&!terminalOnly){
  const before=taskRecords.bound(provider,params.threadId);let definitionOnly=definitionOnlyTurn||!!before?.customCv?.id;if(before&&worker.connection&&(!managedOnly||definitionOnly)){definitionOnly=(await privateAccess.assertTask(before,provider)).definitionOnly;check();}
  if(definitionOnly&&params.reviewMode===true)throw Error('Current sharing covers only this private definition; full workflow review needs separately selected input-file permission');
  const text=visibleUserText(params.input||[]);
  if(managedOnly&&params.reviewMode===true)throw Error('Connect the original workflow worker before reviewing its scientific inputs');
  const authoring=definitionOnly||notification||managedOnly?null:await ensureTaskAuthoring(taskRecords,worker,{provider,threadId:params.threadId,taskId:params.studioTaskId,text,allowExplicitInputs:params.reviewMode!==true,assertCurrent:check,authorization:authoringAuthorization,baseWorkspace});check();
  if(selectedSsh&&!definitionOnly)params={...params,input:[...(params.input||[]),{type:'text',text:'For first use after SSH handoff and base-workspace configuration, follow the bundled cluster.workspace-setup skill route. setup_base_workspace can inspect or initialize the selected connection workspace in ordinary chat. Reuse the returned directory and the current workflow context.'}]};
  if(authoring)params={...params,input:[...(params.input||[]).filter((c,i)=>!(i>0&&c.type==='text'&&c.text.startsWith('[Studio workspace context]'))),{type:'text',text:authoring.text}]};
  let bound=taskRecords.bound(provider,params.threadId);if(bound&&(!managedOnly||bound.customCv?.id)){definitionOnly=(await privateAccess.assertTask(bound,provider)).definitionOnly;check();}
  definitionOnlyTurn=definitionOnly;
  const privateReview=params.reviewMode===true;
  await synchronize();
  if(provider==='codex'&&!agents.threadReady(params.threadId)&&!notification){
   const resumed=await resumeConversationContext({records:taskRecords,workflowContext,agents,ticket,threadId:params.threadId,model:params.model,publish:event=>emit('studio:event',event)});ticket=resumed.ticket;check();
   if(resumed.result.studioRecovery?.status==='required')return resumed.result;
   params={...params,threadId:resumed.result.thread.id};skillKey=provider+':'+params.threadId;bound=taskRecords.bound(provider,params.threadId);
  }
  if(managedOnly){
   const prepared=taskRecords.prepareTurnState(provider,params),first=prepared.params.input?.[0];
   if(first?.type!=='text'||typeof first.text!=='string'||!first.text.trim())throw Error('A message is required');
   bound=taskRecords.bound(provider,params.threadId);
   const mode=interactionModeContext({...turnFlags,scope:bound?'workflow':'chat'}),taskContext=bound?'\nstudioTaskId: '+bound.id:'';
   params={...prepared.params,input:[first,{type:'text',text:mode+taskContext+'\nUse the authorized managed resource tools for this request. Automatic workspace data is unavailable until its original tool scope is verified.'},...(prepared.params.input||[]).filter(item=>item.type==='skill')]};
  }else params=taskRecords.prepareTurn(provider,params);
  check();await synchronize();
  if(definitionOnly)params=currentPrivateTurn(params,bound,{review:privateReview,planningMode:turnFlags.planningMode});
  // Public software guidance is selected only for the actual current intent.
  const guidanceScope=skillGuidanceScope(provider),readPolicy=await scientificSkills.resolvePolicy(guidanceScope);check();
  // An ordinary unbound chat starts from AGENTS.md and reads its chosen skill via MCP.
  if(studioSkillId||!managedOnly&&(bound||readPolicy.state!=='legacy_unconfigured')){
   const prepareGuidance=()=>scientificSkills.context.prepare(skillKey,provider,{...(definitionOnly?{text,parameters:{},hasWorkflow:false,manualFunction:'pygas.custom-cv'}:{text,parameters:bound?.parameters||{},hasWorkflow:!!bound,planRoadmap:turnFlags.planningMode&&!bound?.roadmap,manualFunction:studioSkillId}),scope:guidanceScope,policy:readPolicy});
   const explicitSetup=!definitionOnly&&studioSkillId&&['installation','setup','toolchain'].includes(scientificSkills.router.routes.get(studioSkillId)?.phase);
   skillContext=await(explicitSetup?setupInstructions.prepare(provider,studioSkillId,prepareGuidance,{retainForTurn:true,assertCurrent:check,checkCurrent:guidanceScope.checkCurrent}):prepareGuidance());check();
   if(!skillContext.guidanceKind&&!definitionOnly&&!managedOnly&&bound?.parameters?.engine&&worker.connection){
    const selectedTarget=toolGuidanceTarget(bound),environment_id=selectedTarget?.kind==='local'?selectedTarget.environmentId:undefined,engine=bound.parameters.engine;
    if(environment_id){const selection={environment_id,engine};let guide;try{guide=await worker.request('POST','/api/runtime-guide',selection);}catch{guide={status:'blocked',reason:'Selected runtime guide unavailable; use an exact selected-engine probe, not an automatic reinstall'};}check();skillContext=scientificSkills.context.mergeRuntime(skillKey,provider,skillContext,guide,selection);}
   }
   if(skillContext.attach||['blocked','permission_required'].includes(skillContext.status))params={...params,input:[...(params.input||[]),{type:'text',text:skillContext.text}]};
   if(!definitionOnly&&!skillContext.guidanceKind)params={...params,input:[...(params.input||[]),{type:'text',text:sourceContext(scientificSkills.sourcesForPolicy(readPolicy))}]};
  }
  if(['deepseek','compatible','qwen'].includes(provider)){const task=taskRecords.bound(provider,params.threadId);params={...params,studioToolContext:task?{mode:'workflow',taskId:task.id,projectId:task.projectId}:{mode:'chat'}};}
  const selected=params.input?.some(item=>item.type==='skill');
  const normalRoots=selected&&!definitionOnly?studioSkillRoots():[],registeredRoots=selected?[...normalRoots,...managedSkillRoots()]:[],registered=definitionOnly||!selected?[]:[...localSkills(normalRoots,{policy:readPolicy,projectSkills,bundledRoot:bundledSkillRoot}),...managedSkillEntries(readPolicy)],input=[];
  for(const item of params.input||[]){
   if(item.type==='text')input.push(item);
   else if(item.type==='skill'){
    const managed=!definitionOnly&&managedSkillRecords().find(record=>item.path===path.join(record.snapshot_root,record.delivery_skill.path));
    let context=managed?await managedToolSkillContext({selection:item,record:managed,policy:readPolicy,scope:guidanceScope}):await selectedSkillContext({selection:item,registered,registeredRoots,bundledRoot:bundledSkillRoot,policy:readPolicy,scope:guidanceScope,validatePrivateProfile:async value=>{const validator=app.isPackaged?path.join(process.resourcesPath,'studio-tools','localize-skill.mjs'):path.join(root,'scripts','localize-skill.mjs');return (await import(pathToFileURL(validator).href)).validateProfile(value);}});check();
    if(managed){const identity={id:managed.package_id,version:managed.package_version,root:managed.snapshot_root};context=scientificSkills.bindManagedSelection?.({selection:item,record:managed,context,policy:readPolicy,scope:guidanceScope,assertCurrent:check,currentRecord:()=>managedSkillRecords().find(record=>record.package_id===identity.id&&record.package_version===identity.version&&record.snapshot_root===identity.root)||null})??context;check();}
    input.push({type:'text',text:context.text});
   }else if(provider==='codex')input.push(item);else throw Error('Unsupported input content');
  }
  params={...params,input};
 }
 if(!terminalOnly&&!definitionOnlyTurn&&['turn/start','turn/steer'].includes(method)){
  const text=resourceRouting?.turnContext?.(provider,params.threadId);if(text&&!params.input?.some(item=>item.type==='text'&&item.text===text))params={...params,input:[...(params.input||[]),{type:'text',text}]};
 }
 let result;
 try{
  check();
  if(terminalOnly){if(selectedSsh)await selectedTerminalReady();if(!sharedTerminal.hasCurrentGrant(provider))throw Error('终端交接所属会话已变化，请在当前对话重新交接。');}
  const capability=()=>{check();if(selectedSsh&&turnFlags&&(terminalOnly?!sharedTerminal.hasCurrentGrant(provider):resourceRouting.workerSelected(provider,params.threadId)!==true))throw Error('当前请求所属的 SSH 能力授权已变化，不会改用另一通道。');};
  const dispatch=()=>{
   capability();
   if(method==='turn/steer'||params.threadId!==userParams.threadId)recordUser();
   return agents.rpc(provider,method,params);
  };
  if(provider==='codex'&&method==='thread/resume'){
   const restored=await resumeConversationContext({records:taskRecords,workflowContext,agents,ticket,threadId:params.threadId,model:params.model,publish:event=>emit('studio:event',event)});ticket=restored.ticket;result=restored.result;
  }else result=method==='turn/start'?await deliverScientificTurn({provider,key:skillKey,threadId:params.threadId,requestId:studioTurnRequestId||randomUUID(),context:skillContext,manager:scientificSkills.context,dispatch,emit:event=>emit('studio:event',event)}):await dispatch();
  check();
 }
 catch(error){if(method==='turn/start'){setupInstructions?.clear?.(provider,params.threadId);scientificSkills.clearManagedSelection?.(provider,params.threadId);try{check();taskRecords.failedTurn(provider,params.threadId,error);}catch{}}throw error;}
 if(method==='thread/start'){
  if(!result.thread?.id)throw Error('The server did not return a real conversation');
  if(reservedShell&&(result.thread.turns?.length||taskRecords.conversation(provider,result.thread.id)||taskRecords.bound(provider,result.thread.id)))throw Error('A reserved terminal requires a newly created conversation');
  workflowContext.started(ticket,result.thread.id);await conversationTerminals?.acquire(provider,workflowContext.current(),reservedShell);check();await synchronize();
 }
 if(provider==='codex'&&['thread/start','thread/resume'].includes(method)&&result.thread)catalog.put('thread',result.thread.id,result.thread);
 if(provider==='codex'&&method==='account/login/start'&&result.authUrl)await openUrl(result.authUrl);
 return result;
 }
 return async function agentRpc(value,options){
  const {provider,method,params={}}=value,{agents}=runtime();
  providerId(provider);assertRpc(method);
  if(!agents?.runInConversation)return request(value,options);
  const threadId=params.threadId;
  if(method==='thread/resume'&&agents.isBusy(provider,threadId))return agents.readActive(provider,threadId,method,params);
  if(method==='thread/start'&&agents.sessionIdentity(provider)?.threadId)throw Error('Start a new chat before creating a conversation');
  if(method==='turn/start'&&!threadId)throw Error('A real conversation is required before sending a message');
  return agents.runInConversation(provider,threadId,()=>request(value,options),{claimTurn:method==='turn/start'});
 };
}
