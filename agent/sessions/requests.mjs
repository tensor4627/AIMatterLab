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
 return async function agentRpc({provider,method,params={}}){
 const {agents,catalog,taskRecords,workflowContext,privateAccess,worker,sharedTerminal,resourceRouting,conversationTerminals,authoringAuthorization,scientificSkills,setupInstructions,bundledSkillRoot,studioSkillRoots,managedSkillRoots,managedSkillEntries,managedSkillRecords,skillGuidanceScope,assertIdleAgent,emit,openUrl,root,app}=runtime();
 providerId(provider);assertRpc(method);
 const turnFlags=['turn/start','turn/steer'].includes(method)?interactionFlags(params):null;
 const resource=resourceRouting?.capture(),selectedSsh=['ssh-terminal','ssh-connection'].includes(resource?.selection?.kind)?resource.selection:null;
 if(turnFlags)resourceRouting?.assertHandoffComplete?.(provider);
 const {studioSkillId,studioTurnRequestId,...protocolParams}=params;params=protocolParams;
 if(studioTurnRequestId!==undefined&&(typeof studioTurnRequestId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(studioTurnRequestId)))throw Error('Invalid turn request identity');
 if(studioSkillId!==undefined&&(typeof studioSkillId!=='string'||!scientificSkills.router.routes.has(studioSkillId)))throw Error('Choose a listed scientific function');
 let ticket,skillContext,skillKey,terminalOnly=false,definitionOnlyTurn=false;
 const check=()=>{resource?.assertCurrent();if(ticket)workflowContext.assert(ticket);};
 const selectedTerminalReady=async()=>{const status=await resourceRouting.readiness(provider);check();if(status?.status!=='ready'||status.resource?.selectionId!==selectedSsh.selectionId)throw Error('请先将所选 SSH 终端交接给当前对话；不会改用其他计算资源。');};
 const synchronize=async()=>{check();await workflowContext.synchronize(ticket,(p,context)=>agents.selectContext(p,context));check();};
 if(['thread/start','thread/resume','turn/start'].includes(method)){
  assertIdleAgent();if(method==='turn/start'){scientificSkills.clearManagedSelection?.(provider);setupInstructions?.clear?.(provider);}ticket=workflowContext.begin(provider,method==='thread/start'?null:params.threadId);
  if(method!=='thread/start'){await conversationTerminals?.acquire(provider,workflowContext.current());check();}
  await synchronize();
 }
 if(selectedSsh&&['turn/start','turn/steer'].includes(method)){await selectedTerminalReady();terminalOnly=resourceRouting.workerSelected?.(provider)!==true;}
 else terminalOnly=['turn/start','turn/steer'].includes(method)&&!worker.providerConnection(provider)&&sharedTerminal.hasCurrentGrant(provider);
 if(method==='turn/steer'&&!terminalOnly){const task=taskRecords.bound(provider,params.threadId);if(task&&(await privateAccess.assertTask(task,provider)).definitionOnly)throw Error('Send a new definition-only message after the current reply completes; private steering does not accept automatic workspace context');check();}
 if(method==='turn/steer'&&terminalOnly)params=terminalOnlyTurn(params,{provider,resource:selectedSsh});
 if(method==='turn/steer'&&!terminalOnly){
  const task=taskRecords.bound(provider,params.threadId),{planningMode,reviewMode,studioTaskId,studioToolContext,...rest}=params;
  if(studioTaskId!==undefined&&studioTaskId!==task?.id)throw Error('Task is not bound to this conversation');
  if(turnFlags.reviewMode)throw Error('Review requires a new workflow turn');
  params={...rest,input:[...(rest.input||[]),{type:'text',text:interactionModeContext({...turnFlags,scope:task?'workflow':'chat'})+(task?'\nstudioTaskId: '+task.id:'')}]};
 }
 if(method==='turn/start'&&!terminalOnly){
  let task=taskRecords.bound(provider,params.threadId);
  if(task){const access=await privateAccess.assertTask(task,provider);check();if(access.definitionOnly){
   if(params.reviewMode===true)throw Error('Current sharing covers only this private definition; full workflow review needs separately selected input-file permission');
   const {planningMode,studioTaskId,reviewMode,...privateParams}=params;currentPrivateTurn(privateParams,task,{planningMode:turnFlags.planningMode});
   if(provider!=='codex')throw Error('Definition-only sharing requires an isolated fresh Codex context; this provider is not yet supported for private definitions');
   const clean=await ensureDefinitionContext({records:taskRecords,workflowContext,agents,task,ticket,model:params.model,publish:event=>emit('studio:event',event)});ticket=clean.ticket;check();params={...params,threadId:clean.task.threadId};
  }}
 }
 skillKey=provider+':'+params.threadId;
 if(method==='turn/start'&&terminalOnly){
  params=terminalOnlyTurn(params,{provider,resource:selectedSsh});check();
  if(provider==='codex'&&!agents.threadReady(params.threadId)){
   const resumed=await resumeConversationContext({records:taskRecords,workflowContext,agents,ticket,threadId:params.threadId,model:params.model,publish:event=>emit('studio:event',event)});ticket=resumed.ticket;check();
   if(resumed.result.studioRecovery?.status==='required')return resumed.result;
   params={...params,threadId:resumed.result.thread.id};
  }
  if(selectedSsh)await selectedTerminalReady();else if(!sharedTerminal.hasCurrentGrant(provider))throw Error('终端交接所属会话已变化，请在当前对话重新交接。');
 }
 if(method==='turn/start'&&!terminalOnly){
  const before=taskRecords.bound(provider,params.threadId);let definitionOnly=!!before?.customCv?.id;if(before&&worker.connection){definitionOnly=(await privateAccess.assertTask(before,provider)).definitionOnly;check();}
  if(definitionOnly&&params.reviewMode===true)throw Error('Current sharing covers only this private definition; full workflow review needs separately selected input-file permission');
  const text=visibleUserText(params.input||[]);
  const authoring=definitionOnly?null:await ensureTaskAuthoring(taskRecords,worker,{provider,threadId:params.threadId,taskId:params.studioTaskId,text,allowExplicitInputs:params.reviewMode!==true,assertCurrent:check,authorization:authoringAuthorization});check();
  if(authoring)params={...params,input:[...(params.input||[]).filter((c,i)=>!(i>0&&c.type==='text'&&c.text.startsWith('[Studio workspace context]'))),{type:'text',text:authoring.text}]};
  let bound=taskRecords.bound(provider,params.threadId);if(bound){definitionOnly=(await privateAccess.assertTask(bound,provider)).definitionOnly;check();}
  definitionOnlyTurn=definitionOnly;
  const privateReview=params.reviewMode===true;
  await synchronize();
  if(provider==='codex'&&!agents.threadReady(params.threadId)){
   const resumed=await resumeConversationContext({records:taskRecords,workflowContext,agents,ticket,threadId:params.threadId,model:params.model,publish:event=>emit('studio:event',event)});ticket=resumed.ticket;check();
   if(resumed.result.studioRecovery?.status==='required')return resumed.result;
   params={...params,threadId:resumed.result.thread.id};skillKey=provider+':'+params.threadId;bound=taskRecords.bound(provider,params.threadId);
  }
  params=taskRecords.prepareTurn(provider,params);check();await synchronize();
  if(definitionOnly)params=currentPrivateTurn(params,bound,{review:privateReview,planningMode:turnFlags.planningMode});
  // Public software guidance is selected only for the actual current intent.
  const guidanceScope=skillGuidanceScope(provider),readPolicy=await scientificSkills.resolvePolicy(guidanceScope);check();
  const prepareGuidance=()=>scientificSkills.context.prepare(skillKey,provider,{...(definitionOnly?{text,parameters:{},hasWorkflow:false,manualFunction:'pygas.custom-cv'}:{text,parameters:bound?.parameters||{},hasWorkflow:!!bound,manualFunction:studioSkillId}),scope:guidanceScope,policy:readPolicy});
  const explicitSetup=!definitionOnly&&studioSkillId&&['installation','setup','toolchain'].includes(scientificSkills.router.routes.get(studioSkillId)?.phase);
  skillContext=await(explicitSetup?setupInstructions.prepare(provider,studioSkillId,prepareGuidance,{retainForTurn:true,assertCurrent:check,checkCurrent:guidanceScope.checkCurrent}):prepareGuidance());check();
  if(!skillContext.guidanceKind&&!definitionOnly&&bound?.parameters?.engine&&worker.connection){
   const selectedTarget=toolGuidanceTarget(bound),environment_id=selectedTarget?.kind==='local'?selectedTarget.environmentId:undefined,engine=bound.parameters.engine;
   if(environment_id){const selection={environment_id,engine};let guide;try{guide=await worker.request('POST','/api/runtime-guide',selection);}catch{guide={status:'blocked',reason:'Selected runtime guide unavailable; use an exact selected-engine probe, not an automatic reinstall'};}check();skillContext=scientificSkills.context.mergeRuntime(skillKey,provider,skillContext,guide,selection);}
  }
  if(skillContext.attach||['blocked','permission_required'].includes(skillContext.status))params={...params,input:[...(params.input||[]),{type:'text',text:skillContext.text}]};
  if(!definitionOnly&&!skillContext.guidanceKind)params={...params,input:[...(params.input||[]),{type:'text',text:sourceContext(scientificSkills.sourcesForPolicy(readPolicy))}]};
  if(['deepseek','compatible'].includes(provider)){const task=taskRecords.bound(provider,params.threadId);params={...params,studioToolContext:task?{mode:'workflow',taskId:task.id,projectId:task.projectId}:{mode:'chat'}};}
  const normalRoots=definitionOnly?[]:studioSkillRoots(),registeredRoots=[...normalRoots,...managedSkillRoots()],registered=definitionOnly||!params.input?.some(item=>item.type==='skill')?[]:[...localSkills(normalRoots,{policy:readPolicy}),...managedSkillEntries(readPolicy)],input=[];
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
  const text=resourceRouting?.turnContext?.(provider);if(text&&!params.input?.some(item=>item.type==='text'&&item.text===text))params={...params,input:[...(params.input||[]),{type:'text',text}]};
 }
 let result;
 try{check();if(terminalOnly){if(selectedSsh){await selectedTerminalReady();if(!sharedTerminal.hasCurrentGrant(provider))throw Error('终端交接所属会话已变化，请在当前对话重新交接。');}else if(!sharedTerminal.hasCurrentGrant(provider))throw Error('终端交接所属会话已变化，请在当前对话重新交接。');}const capability=()=>{check();if(selectedSsh&&['turn/start','turn/steer'].includes(method)&&(terminalOnly?!sharedTerminal.hasCurrentGrant(provider):resourceRouting.workerSelected(provider)!==true))throw Error('当前请求所属的 SSH 能力授权已变化，不会改用另一通道。');};capability();if(provider==='codex'&&method==='thread/resume'){const restored=await resumeConversationContext({records:taskRecords,workflowContext,agents,ticket,threadId:params.threadId,model:params.model,publish:event=>emit('studio:event',event)});ticket=restored.ticket;result=restored.result;}else result=method==='turn/start'?await deliverScientificTurn({provider,key:skillKey,threadId:params.threadId,requestId:studioTurnRequestId||randomUUID(),context:skillContext,manager:scientificSkills.context,dispatch:()=>{capability();return agents.rpc(provider,method,params);},emit:event=>emit('studio:event',event)}):await agents.rpc(provider,method,params);check();}
 catch(error){if(method==='turn/start'){setupInstructions?.clear?.(provider);scientificSkills.clearManagedSelection?.(provider);try{check();taskRecords.failedTurn(provider,params.threadId,error);}catch{}}throw error;}
 if(method==='thread/start'){if(!result.thread?.id)throw Error('The server did not return a real conversation');workflowContext.started(ticket,result.thread.id);await conversationTerminals?.acquire(provider,workflowContext.current());check();await synchronize();}
 if(provider==='codex'&&['thread/start','thread/resume'].includes(method)&&result.thread)catalog.put('thread',result.thread.id,result.thread);
 if(provider==='codex'&&method==='account/login/start'&&result.authUrl)await openUrl(result.authUrl);
 return result;
};
}
