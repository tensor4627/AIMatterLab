import {isDeepStrictEqual as equal} from 'node:util';
import {sameWorkerBinding} from '../../contracts/compute/task-worker-binding.mjs';
import {MCP_CONTEXT_KEYS} from '../tools/provider-scope.mjs';
const managedInstructions=[
 '[AIMatterLab hosted compute resources]',
 'When list_compute_resources marks a row developerWorkspace:true, the desktop user selected that verified cluster workspace for tool testing. Use its exact resource_id to acquire command access, use list_resource_tools for activated tools, and inspect the actual command receipt. Outside-workspace writes and execution use the desktop review. Use the current worker project and its registered targets for structured jobs.',
 'These current tools and receipts supersede historical tool definitions, messages and skills about SSH handoff. AIMatterLab lists hosted SSH resources after verified login. The canAcquire flag, service readiness and terminal slots do not prove a shell has opened.',
 'For queue questions in ordinary chat, use list_compute_resources and choose the requested resource. On SSH resources with commandAvailable, use access="command" and run_compute_command for a bounded scheduler query or short workspace command. For an available job service, use access="service" and inspect_compute_service with probe_scheduler:true. A service lease provides no terminal. The planning panel is optional, including for explicitly delegated independent jobs.',
 'A clear name in the current chat is the resource selection. After a short answer such as “就是<name>”, match the listed name to its resource_id and continue the original request. If the inventory leaves multiple possibilities, call acquire_compute_resource with the user’s selector to resolve the eligible choices. If the tool returns choice_required without an answer, show the candidates and ask in this chat. For matching display names, give their listed resource_id or profile_id so the user can reply with the exact ID. A target_selected receipt identifies the choice already made. Follow its retry and requested access without asking again. Wait for acquired before treating it as a lease. A resource_selection_required receipt only describes a target choice. Use actual receipts before reporting authorization, login or connection problems. Hosted resource selection requires no desktop panel binding.',
 'For private shell work request access="terminal" and use only a returned terminal session. On terminal_unavailable follow a returned retry with access="service" on the same resource when it can fulfill the request. If the service path is unavailable, report the failed capability or use an already authorized suitable channel on that same resource. Keep unconfirmed shell attempts and runs intact. A hosted channel failure by itself provides no reason for another SSH login, a legacy terminal handoff or repeating the same failed request. Manual sharing applies only to a separate explicit handoff.',
 'When this chat adds a workflow, continue with its existing lease and project. Use read_session_workspace with the original profile_id for the confirmed workfile directory when available. Reuse the returned path on that resource. A saved path or target is historical until observed, and creating or editing a draft does not allocate a workfile directory.',
 'If SSH recovery is needed, check the original saved profile and resume its live terminal or pending login. The user answers prompts in that attempt’s private terminal. A waiting or timed-out check leaves authentication unconfirmed. If the hosted connection is confirmed lost, the user can sign in again on that profile. AIMatterLab verifies the same remote identity and workspace and restores eligible conversation leases. List the current resources and terminals before using the restored channel. When the user explicitly asks to renew a lease, use the verified resource selection already saved for this chat. Reconcile unknown jobs using their original IDs and receipts.',
 'Use a service lease to inspect authorized targets and prepare a draft with prepare_compute_run. Use validate_compute_run, submit_compute_run, and cancel_compute_run for the corresponding user-delegated action on its exact run. Keep the original resource and actual workflow gates. Inspect the original receipt when a result is unconfirmed. Release a lease at the user’s request.',
 'Use attach_task_schedule only for a user-delegated schedule. Select poll for periodic observation, action for a bounded status or log read, script for a temporary scheduler job, or wake_agent to wake this conversation on request. Read the existing schedule and revision before editing.'
].join('\n');
/** Route independently granted capabilities of the explicitly selected resource. */
export function createAgentResourceRouting({worker,terminal,resource,sharedTerminal,agents,service=()=>null,managed=()=>null,taskSource=()=>null}){
 const handoffHints=new Map(),workerPins=new Map();
 const directory=()=>typeof managed==='function'?managed():managed;
 function assertHandoffComplete(provider,threadId,sessionId){
  const hint=handoffHints.get(provider);
  if(!hint)return;
  const caller=sessionId??(threadId?agents()?.sessionIdentity?.(provider,threadId)?.id:undefined);
  if(hint.sessionId&&caller?hint.sessionId===caller:!hint.threadId||!threadId||hint.threadId===threadId)throw Error('请等待当前能力交接完成；未发送或重发请求。');
 }
 const selected=()=>resource()?.peek()||null,controller=()=>typeof service==='function'?service():service;
 const connection=()=>{const v=selected();return v?.schemaVersion===2&&v.kind==='ssh-connection'?v:null;};
 const legacy=()=>selected()?.kind==='ssh-terminal';
 function selectedService(){const v=connection(),s=controller()?.peek?.();return v&&s?.connectionId===v.connectionId&&s.profileId===v.profileId&&s.profileVersion===v.profileVersion?s:null;}
 function readyService(){const v=connection();if(!v)return false;const s=selectedService(),i=worker?.identity,t=worker?.connectionTarget;return !!(s?.status==='connected'&&s.workflowReady===true&&worker?.connection&&i?.kind==='ssh'&&i.version===3&&i.connectionId===v.connectionId&&i.profileId===v.profileId&&i.profileVersion===v.profileVersion&&t?.connectionId===v.connectionId&&t.serviceId===s.serviceId);}
 const serviceGranted=provider=>controller()?.hasCurrentGrant?.(provider)===true;
 const shellGranted=provider=>!!(connection()&&sharedTerminal()?.hasCurrentGrant(provider));
 const workerSelected=(provider,threadId)=>!(threadId&&directory())&&readyService()&&(provider===undefined||serviceGranted(provider));
 function capture(provider,threadId){
  if(provider&&threadId&&directory()){
   const owned=directory().capture(provider,threadId);
   // Model dispatch itself is resource independent. The tool gateway fences each
   // acquired source separately, including a resource chosen during this turn.
   return {selection:null,resources:owned.resources,bindings:owned.bindings,assertCurrent:()=>{},assertResourcesCurrent:owned.assertCurrent};
  }
  const port=resource(),ticket=port?.capture();return {selection:ticket?.selection||null,assertCurrent:()=>{if(port!==resource())throw Error('compute_resource_selection_changed');if(ticket)port.assertCurrent(ticket);}};
 }
 function prepareHandoff({provider,capability,connectionId,attemptId,sessionId}){
  if(!['codex','kimi','qwen','deepseek','compatible'].includes(provider)||!['service','terminal'].includes(capability))throw Error('compute_resource_handoff_invalid');
  const selected=connection(),state=selectedService(),ticket=capture();if(!selected||selected.connectionId!==connectionId||capability==='service'&&(!readyService()||state.attemptId!==attemptId)||capability==='terminal'&&(typeof sessionId!=='string'||!sessionId))throw Error('compute_resource_handoff_changed');
  // This is discovery routing inside a human handoff, never a usage grant.
  const origin=agents()?.sessionIdentity?.(provider);
  const target=capability==='terminal'&&serviceGranted(provider)?'service':capability,entry={target,ticket,connectionId,serviceId:state?.serviceId,attemptId:state?.attemptId,workerConnection:worker?.connection,workerIdentity:structuredClone(worker?.identity),workerTarget:structuredClone(worker?.connectionTarget),threadId:origin?.threadId,sessionId:origin?.id};handoffHints.set(provider,entry);
  const assertCurrent=()=>{ticket.assertCurrent();if(handoffHints.get(provider)!==entry||connection()?.connectionId!==connectionId)throw Error('compute_resource_handoff_changed');if(target==='service'){const actual=selectedService();if(!readyService()||capability==='terminal'&&!serviceGranted(provider)||actual?.serviceId!==entry.serviceId||actual.attemptId!==entry.attemptId||worker.connection!==entry.workerConnection||!equal(worker.identity,entry.workerIdentity)||!equal(worker.connectionTarget,entry.workerTarget))throw Error('compute_resource_handoff_changed');}};
  entry.assertCurrent=assertCurrent;
  return {assertCurrent,release:()=>{if(handoffHints.get(provider)===entry)handoffHints.delete(provider);}};
 }
 function providerConnection(provider,sessionId,context){
  if(sessionId&&directory()){
   const hint=handoffHints.get(provider);
   if(hint&&(hint.sessionId?hint.sessionId===sessionId:hint.threadId===context?.threadId))hint.assertCurrent();
   return terminal()?.providerConnection(provider,sessionId);
  }
  if(legacy())return undefined;
  if(connection()){
   const hint=handoffHints.get(provider);
   if(hint){hint.assertCurrent();return hint.target==='service'?worker.providerConnection(provider):terminal()?.providerConnection(provider);}
   return readyService()&&(serviceGranted(provider)||!shellGranted(provider))?worker.providerConnection(provider):terminal()?.providerConnection(provider);
  }
  return worker.providerConnection(provider)||terminal()?.providerConnection(provider);
 }

 function matchingPin(sessionId){
  const pinned=workerPins.get(sessionId);
  return pinned&&pinned.connection===worker.connection&&pinned.epoch===worker.connectionEpoch&&equal(pinned.identity,worker.identity)&&equal(pinned.target,worker.connectionTarget)?pinned:null;
 }
 function usesForegroundWorker(sessionId){
  const pinned=matchingPin(sessionId);
  return !!pinned&&!directory()?.needsExplicitResource(pinned,{readAliases:false});
 }
 function followUpBinding(provider,threadId){
  const ticket=capture(provider,threadId);
  ticket.assertCurrent();ticket.assertResourcesCurrent?.();
  const sessionId=agents()?.sessionIdentity?.(provider,threadId)?.id;
  const pinned=sessionId?matchingPin(sessionId):null;
  return {
   selection:ticket.selection,
   bindings:[...(ticket.bindings||[])].sort((left,right)=>left.id.localeCompare(right.id)),
   worker:pinned?{identity:pinned.identity,target:pinned.target}:null,
  };
 }
 function scopedWorkerConnection(scope){
  if(!scope?.sessionId||scope.checkCurrent?.()!==true||directory()?.needsExplicitResource(scope))return undefined;
  const pinned=matchingPin(scope.sessionId);
  if(!pinned||pinned.provider!==scope.provider||pinned.threadId!==scope.threadId)return undefined;
  const original=scope.threadId?taskSource(scope):null;
  if(original&&!sameWorkerBinding(original.binding||original,worker))return undefined;
  if(worker.identity?.kind==='ssh'&&(!readyService()||!controller()?.hasCurrentGrant?.(scope.provider,scope)))return undefined;
  return worker.providerConnection(scope.provider,scope.sessionId);
 }

 function bindSessionTools(provider,context,options){
  const local=terminal()?.bindProviderContext(provider,context,options);
  worker.bindProviderContext(provider,context,options);
  return local;
 }
 function sessionConnection(provider,sessionId,workflow){
  const owner=workflow.current();
  if(!sessionId||workflow.sessionId()!==sessionId||owner?.provider!==provider)throw Error('The tool connection no longer belongs to this conversation');
  const context=Object.fromEntries(MCP_CONTEXT_KEYS.map(key=>[key,owner[key]]));
  // Discovery starts before thread/resume. A cold or revoked lease must already
  // identify this workflow when the harness asks for its tools.
  if(directory())bindSessionTools(provider,context,{sessionId});
  return providerConnection(provider,sessionId,context);
 }
 function bindWorkerContext(provider,context,options){
  if(options?.sessionId&&directory()){
   const sessionId=options.sessionId;
   const local=bindSessionTools(provider,context,options);
   const pinned=workerPins.get(sessionId);
   const original=context?.threadId?taskSource({provider,...context}):null;
   if(worker.connection&&(!original||sameWorkerBinding(original.binding||original,worker))&&
      (!pinned||pinned.threadId!==context.threadId||original)&&!worker.connecting&&!worker.restoring){
    workerPins.set(sessionId,{provider,threadId:context.threadId,connection:worker.connection,epoch:worker.connectionEpoch,
     identity:structuredClone(worker.identity),target:structuredClone(worker.connectionTarget)});
   }
   const previous=agents()?.bridgeWorkers?.get(provider),next=providerConnection(provider,sessionId,context);
   const changed=!!previous!==!!next||previous&&(previous.url!==next?.url||previous.tokens?.mcp!==next?.tokens?.mcp);
   return changed?{...local,rotated:true}:local;
  }
  controller()?.reconcileContext?.();sharedTerminal()?.reconcileContext?.();
  const local=terminal()?.bindProviderContext(provider,context,options);let binding=local;
  if(!connection()&&!legacy()||readyService())binding=worker.bindProviderContext(provider,context,options)||local;
  const previous=agents()?.bridgeWorkers?.get(provider),next=providerConnection(provider),changed=!!previous!==!!next||previous&&(previous.url!==next?.url||previous.transport!==next?.transport||previous.tokens?.mcp!==next?.tokens?.mcp);
  return changed?{...binding,rotated:true}:binding;
 }
 function scope(provider,method,context,sessionId){
  if(sessionId&&directory())return {assertCurrent:()=>{if(['turn/start','turn/steer'].includes(method))assertHandoffComplete(provider,context?.threadId,sessionId);}};
  const ticket=capture(),route=workerSelected(provider)?'service':shellGranted(provider)?'shell':null;
  return {assertCurrent:()=>{ticket.assertCurrent();if(!['turn/start','turn/steer'].includes(method))return;assertHandoffComplete(provider);if(ticket.selection?.kind==='ssh-terminal')throw Error('原 SSH 终端属于旧连接格式，请明确重新登录建立独立通道。');if(ticket.selection?.kind==='ssh-connection'&&(route==='service'?!workerSelected(provider):route==='shell'?!shellGranted(provider):true))throw Error('当前操作所属的 SSH 能力授权已变化；不会改用另一能力或重新登录。');}};
 }
 async function readiness(provider,threadId){
  if(threadId&&directory())return null;
  const ticket=capture();if(!ticket.selection)return null;
  if(legacy())return {status:'blocked',scope:'terminal-only',scientificStatus:'blocked',count:0,reason:'legacy_connection_requires_login',message:'旧连接记录不能替代本次认证，请明确重新登录。',checkedAt:Date.now()};
  if(!connection())return null;
  const state=await resource().status({});ticket.assertCurrent();
  if(state?.schemaVersion!==2||state.kind!=='ssh-connection'||state.selectionId!==ticket.selection.selectionId||state.connectionId!==ticket.selection.connectionId||state.profileId!==ticket.selection.profileId||state.profileVersion!==ticket.selection.profileVersion||state.status!=='selected'||state.connectionStatus!=='authenticated'||state.authentication!=='verified')return {status:'blocked',scope:'terminal-only',scientificStatus:'blocked',count:0,transport:'ssh-connection',reason:state?.reason||'selected_connection_unverified',message:'所选 SSH 连接的认证或配置已变化，请核对原连接；不会借用其他能力或重新登录。',resource:state,checkedAt:Date.now()};
  if(workerSelected(provider)){let tools;try{tools=await worker.probeTools();}catch{}ticket.assertCurrent();if(workerSelected(provider)&&['ready','warning'].includes(tools?.status))return {status:'ready',scope:'workflow',scientificStatus:tools.status,warning:tools.status==='warning',count:tools.count,transport:'ssh-connection',message:tools.status==='warning'?tools.message:'所选 SSH 作业服务已连接；具体科学环境按需配置和验证。',resource:state,checkedAt:Date.now()};}
  let shell=false;if(shellGranted(provider)){try{const list=await sharedTerminal().list({});ticket.assertCurrent();shell=list.sessions.some(s=>s.connectionId===ticket.selection.connectionId&&s.kind==='ssh'&&s.alive===true&&!s.expired&&s.owner==='agent'&&sharedTerminal().hasCurrentGrant(provider,s.sessionId));}catch{}}
  ticket.assertCurrent();const ready=shell&&shellGranted(provider);
  return {status:ready?'ready':'blocked',scope:'terminal-only',scientificStatus:'blocked',count:ready?3:0,transport:'desktop-terminal',message:ready?'所选连接的共享终端可用；服务状态不影响此独立通道。':'请在此连接的终端点击“交给 Agent”。',reason:ready?null:'current_capability_grant_required',resource:state,checkedAt:Date.now()};
 }
 function turnContext(provider,threadId){
  if(threadId&&directory())return managedInstructions;
  if(!workerSelected(provider))return null;return '[AIMatterLab selected compute resource]\n'+JSON.stringify({kind:'ssh-connection',status:'authenticated',service:'connected',serviceAuthorizedForThisConversation:true,shellAuthorizedForThisConversation:shellGranted(provider),schedulerRegistration:'not_checked'})+'\nThe selected SSH connection is authenticated. The human handoff enables separately verified shell and service grants. The managed service uses its own channel. When the user explicitly selects a shared-shell service transport, ordinary input resumes after its exchange is confirmed. Connection readiness does not establish installed scientific tools, a configured environment or execution readiness. Incomplete inventory and repairable environment issues are warnings: inspect and help configure within the granted terminal and project scope. list_clusters returns saved scheduler profiles, not SSH sessions. For a requested current-host queue observation call inspect_compute_resource with probe_scheduler=true, without creating a workflow or asking the human to paste commands. A missing profile does not mean disconnected. A service failure does not by itself establish shell failure; only an independently verified and granted shell can be used. Never reconnect, upgrade, switch resources or replay unknown requests automatically.';
 }
 return {selected,capture,followUpBinding,providerConnection,sessionConnection,bindWorkerContext,scope,readiness,workerSelected,turnContext,prepareHandoff,assertHandoffComplete,
  scopedWorkerConnection,usesForegroundWorker,releaseSession:id=>workerPins.delete(id)};
}
