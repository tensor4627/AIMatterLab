import {randomUUID} from 'node:crypto';
import {schedulerInspectionPath,schedulerObservation} from '../../../contracts/compute/scheduler-observation.mjs';
import {scheduleOwnerId} from '../../../contracts/compute/schedule-owner.mjs';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
import {terminalToolInput,sharedTerminalTools} from './shared-terminal.mjs';
import {managedWorkerProject,originalBindingMatches} from './managed-compute-services.mjs';
import {normalizeComputeAlias,resourceFingerprint} from './managed-compute-aliases.mjs';
import {createManagedComputeIntent,genericComputeKind,requestsComputeName,canAskForResource,namesInChat} from './managed-compute-intent.mjs';
import {MANAGED_SSH_SHELL_CAPACITY} from '../../../desktop/platform/terminal-service/managed-ssh-shells.mjs';
import {safeSshServiceError,safeSshServicePhase,safeSshServiceProgress} from './ssh-service-state.mjs';

const rejectedBeforeDispatch=new Set(['managed_compute_invalid_request','managed_compute_user_instruction_required',
 'managed_compute_no_eligible_resource','managed_compute_resource_lease_required','managed_compute_resource_choice_required',
 'managed_compute_project_grant_required','managed_compute_terminal_not_supported']);
const fail=code=>{throw Object.assign(Error(code),rejectedBeforeDispatch.has(code)?{operationNotStarted:true}:{});};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const string={type:'string',minLength:1,maxLength:128};
const leaseKey=(scope,resourceId)=>JSON.stringify([scope.provider,scope.threadId,resourceId]);
const ownerOf=scope=>({provider:scope.provider,threadId:scope.threadId});
const projectOf=scope=>scope.projectId??null;
const sourceFailure=code=>['managed_compute_service_changed','ssh_authentication_unconfirmed','ssh_connection_changed','ssh_connection_not_found','terminal_unavailable','terminal_service_changed','terminal_service_unknown','terminal_service_unavailable','terminal_service_failed'].includes(code);
const terminalGone=code=>['terminal_session_exited','terminal_saved_connection_changed','ssh_authentication_unconfirmed','ssh_connection_changed','ssh_connection_not_found'].includes(code);
const terminalFailureCodes=new Set(['managed_compute_project_grant_required','managed_compute_terminal_not_supported','terminal_session_limit',
 'terminal_session_exited','terminal_unavailable','terminal_start_failed','ssh_channel_unavailable','ssh_shell_readiness_timeout',
 'ssh_shell_interaction_required','ssh_channel_refused','ssh_remote_terminal_unavailable','ssh_master_unavailable','ssh_authentication_unconfirmed','ssh_connection_changed','ssh_connection_not_found',
 'terminal_saved_connection_changed','terminal_service_active','terminal_service_unknown']);
const isAuthenticated=value=>value?.status==='authenticated'&&value.authentication==='verified'&&value.capabilities?.multiplex===true;
const resourceRef=resource=>({connectionId:resource.connectionId,profileId:resource.profileId,profileVersion:resource.profileVersion});
const candidate=resource=>({resourceId:resource.resourceId,profileId:resource.profileId,kind:resource.kind,name:resource.name});
const runMutations=new Map([
 ['validate_run',['validate','run']],['validate_cluster_run',['validate','cluster-run']],
 ['submit_run',['submit','run']],['submit_cluster_run',['submit','cluster-run']],
 ['cancel_run',['cancel','run']],['cancel_cluster_run',['cancel','cluster-run']],
]);
const workerHistory='managed-ssh-runtime-history';

function exact(value,keys,required=[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||required.some(key=>!Object.hasOwn(value,key)))fail('managed_compute_invalid_request');
}
function tool(name,description,properties,required=[],readOnlyHint=false){
 return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint}};
}
const terminalTools=sharedTerminalTools.map((item,index)=>({...item,
 name:['list_compute_terminals','read_compute_terminal','write_compute_terminal'][index],
 description:[
  'List SSH PTYs acquired by this conversation from published AIMatterLab compute resources.',
  'Read the acquired conversation PTY using the returned sequence cursor. Scoped command output is in the write_compute_terminal enter receipt.',
  'Run a delegated command from this conversation’s verified SSH workspace. Stage the batch with type, then send enter once. Read output and exit_code from the enter receipt. A standalone cd persists for the lease. Each batch has a fresh shell, so combine environment setup and execution. Interrupt clears staged input while idle. A protected operation displays the exact batch for desktop approval. Prefer the registered worker for tracked jobs. An explicitly requested independent scheduler job may also use this terminal. Record its scheduler receipt and reconcile an uncertain submission before retry.',
 ][index],
}));
const tools=Object.freeze([
 tool('list_compute_resources','List resources already hosted by AIMatterLab. A listed SSH resource is authenticated. canAcquire describes conversation access; verification_pending means the worker project grant may still be checked. Acquire a lease before using its terminal or service.',{},[],true),
 tool('acquire_compute_resource','Acquire this conversation’s own terminal or service context. Use one selector: resource_id, profile_id, or the alias the human used. A request to inspect cluster queues can select the only eligible cluster. Follow a target_selected receipt. For a choice_required receipt, use the provided user_answer or ask which listed name if the choice is unanswered. No planning mode, workflow, new SSH login or terminal handoff is needed.',{resource_id:string,profile_id:string,alias:string,access:{type:'string',enum:['terminal','service']}}),
 tool('release_compute_resource','Release this conversation’s lease and its independent SSH terminal for this resource.',{resource_id:string},['resource_id']),
 ...terminalTools,
]);

/** App-owned active resources, independent of every renderer selection. `publish`,
 * `publishWsl`, `confirmAlias` and `recordUserTurn` are trusted desktop entry points. */
export function createManagedComputeResources({terminal,profiles,aliases,services,selectionCatalog,taskSource=()=>null,
 authorizeTerminal=()=>false,authorizeSchedule,authorizeRun,authorizeRunAction, onAcquired=()=>{},onChange=()=>{},
 resourceWorkspace,serviceRegistration,terminalAuthorization,developerCompute,terminalPolicyRevision=()=>0,busy=()=>false,now=Date.now,uuid=randomUUID}){
 const resources=new Map(),leases=new Map(),publishing=new Map(),scheduledSweeps=new Map(),pendingAcquisitions=new Set();
 const activeRunActions=new Set(),dispatchedRunActions=new Set();
 const connections=terminal.connections,intent=createManagedComputeIntent(selectionCatalog);
 let stopped=false;

 function liveScope(scope){
  if(stopped||!scope||typeof scope.provider!=='string'||!scope.provider||scope.provider.length>80||typeof scope.threadId!=='string'||!scope.threadId||scope.threadId.length>200||scope.checkCurrent?.()!==true)fail('managed_compute_context_changed');
 }
 function current(resource){
  if(stopped||resources.get(resource.resourceId)!==resource)fail('managed_compute_resource_unavailable');
  const latest=profiles.read({id:resource.profileId});
  if(latest?.version!==resource.profileVersion||resourceFingerprint(latest)!==resource.targetFingerprint)fail('managed_compute_profile_changed');
 }
 const saved=resource=>{try{current(resource);return true;}catch{return false;}};
 const visible=resource=>saved(resource)&&(resource.kind==='ssh'||resource.serviceStatus==='ready');
 const readyShell=lease=>{
  const terminal=lease?.terminal;
  return terminal?.shell&&!terminal.closing&&!terminal.observationUnknown&&terminal.shell.expiresAt>now()?terminal.shell:null;
 };
 const hasLease=lease=>!!(lease&&!lease.releasing&&(lease.service||readyShell(lease)));
 const count=resource=>[...leases.values()].filter(lease=>lease.resource===resource&&lease.terminal).length;
 const view=resource=>({...candidate(resource),profileVersion:resource.profileVersion,available:resource.kind==='ssh'||resource.serviceStatus==='ready',
  serviceStatus:resource.serviceStatus,...resource.kind==='ssh'?{terminalCapacity:MANAGED_SSH_SHELL_CAPACITY,terminalAvailable:Math.max(0,MANAGED_SSH_SHELL_CAPACITY-count(resource))}:{}});
 // The desktop verifies the exact authenticated connection. Agent tools use the resource ID.
 function desktopView(resource){
  const entry=view(resource);
  return resource.kind==='ssh'?{...entry,connectionId:resource.connectionId,
   ...resource.workspaceRegistration?{workspace:resourceWorkspace.publicWorkspace(resource.workspaceRegistration)}:{}}:entry;
 }
 function snapshot(){return [...resources.values()].filter(visible).map(desktopView);}
 function recordUserTurn(value){
  const candidates=[...resources.values()].filter(visible).map(resource=>({...candidate(resource),targetFingerprint:resource.targetFingerprint}));
  let namedAliases=[];
  // Personal aliases are optional for a direct display name. Acquisition by
  // alias still checks the actual stored mapping on the scoped tool path.
  if(candidates.length&&aliases?.entries){
   try{namedAliases=aliases.entries(()=>!stopped);}catch{ /* no usable alias evidence for this turn */ }
  }
  intent.recordUserTurn(value,candidates,namedAliases);
 }
 async function list(scope){
  liveScope(scope);
  const entries=await Promise.all([...resources.values()].filter(visible).map(async resource=>{
   const terminalPolicy=resource.kind==='ssh'?await authorizeTerminal(scope,resource):false;
   const lease=conversationLease(scope,resource);
   const acquired=hasLease(lease);
   const continued=intent.continuesChannel(scope,resource,'terminal')||
    !!resource.service&&intent.continuesChannel(scope,resource,'service');
   const developer=terminalPolicy!=='denied'&&developerAccess(scope,resource);
   const canAcquire=terminalPolicy===true||developer||terminalPolicy!=='denied'&&(continued||resource.service&&!scope.taskId)?true:resource.service&&scope.projectId?'verification_pending':false;
   return {resource,entry:{...view(resource),canAcquire,acquired,...developer?{developerWorkspace:true}:{}}};
  }));
  liveScope(scope);
  const listed=entries.filter(({resource})=>visible(resource));
  intent.observedChoices(scope,listed.map(({resource})=>({...candidate(resource),targetFingerprint:resource.targetFingerprint})));
  return {resources:listed.map(({entry})=>entry)};
 }
 function changed(){if(!stopped)onChange();}

 async function checkConnection(resource){
  current(resource);
  const view=await connections.state({connectionId:resource.connectionId});
  current(resource);
  if(!isAuthenticated(view)||view.profileId!==resource.profileId||view.profileVersion!==resource.profileVersion||view.connectionId!==resource.connectionId)fail('managed_compute_resource_unavailable');
 }

 function prepareService(resource,{configure=false,upgrade}={}){
  if(!services||resource.preparing)return resource.preparing;
  if(resource.service&&!upgrade)return Promise.resolve(resource.service);
  const original=resource.service;
  if(upgrade)resource.service=null;
  resource.serviceStatus='preparing';
  const fresh=()=>current(resource);
  const preparation=Promise.resolve().then(async()=>{
   try{
    const service=await (resource.kind==='ssh'?services.ssh(resource,resource.profile,fresh,{configure,upgrade}):services.wsl(resource,resource.receipt,fresh));
    try{fresh();}catch(error){service.close?.();throw error;}
    resource.service=service;resource.serviceStatus='ready';delete resource.serviceError;
    return service;
   }catch(error){
    if(resources.get(resource.resourceId)===resource){
     if(upgrade&&original){
      try{await original.verify();fresh();resource.service=original;resource.serviceStatus='ready';return original;}
      catch{/* Preserve the actual unconfirmed or failed remote state. */}
     }
     resource.serviceStatus=['ssh_service_registration_required','ssh_service_maintenance_required'].includes(error.message)?'configuration_required':'unavailable';
     resource.serviceError=['ssh_service_registration_required','ssh_service_maintenance_required','managed_compute_service_changed','terminal_service_active','terminal_service_unknown','ssh_authentication_unconfirmed'].includes(error.message)?error.message:'managed_compute_private_service_unavailable';
    }
    return null;
   }finally{if(resource.preparing===preparation)resource.preparing=null;changed();}
  });
  resource.preparing=preparation;changed();return preparation;
 }

 async function publish(data){
  exact(data,['connectionId','profileId','profileVersion'],['connectionId','profileId','profileVersion']);
  if(stopped||!id(data.connectionId)||!id(data.profileId)||!Number.isSafeInteger(data.profileVersion)||data.profileVersion<1)fail('managed_compute_invalid_request');
  const before=publishing.get(data.connectionId);
  if(before){if(!equal(before.data,data))fail('managed_compute_profile_changed');return before.result;}
  const publication={data:structuredClone(data),result:null};
  publishing.set(data.connectionId,publication);
  publication.result=(async()=>{
   const connection=await connections.state({connectionId:data.connectionId});
   if(stopped||publishing.get(data.connectionId)!==publication||!isAuthenticated(connection)||connection.connectionId!==data.connectionId||connection.profileId!==data.profileId||connection.profileVersion!==data.profileVersion)fail('managed_compute_authentication_required');
   const profile=profiles.read({id:data.profileId});
   if(profile.kind!=='ssh'||profile.version!==data.profileVersion)fail('managed_compute_profile_changed');
   const checkPublication=()=>{
    if(stopped||publishing.get(data.connectionId)!==publication||!equal(profile,profiles.read({id:profile.id})))fail('managed_compute_profile_changed');
   };
   const workspaceRegistration=await resourceWorkspace?.assertHandoff(data,checkPublication);
   checkPublication();
   const resourceId='ssh:'+profile.id,previous=resources.get(resourceId);
   if(previous&&saved(previous)){
    if(!equal(resourceRef(previous),data))fail('managed_compute_profile_already_published');
    if(workspaceRegistration)previous.workspaceRegistration=workspaceRegistration;
    changed();return desktopView(previous);
   }
   if(previous)void remove(previous);
   const resource={...data,resourceId,profile,kind:'ssh',name:profile.name,targetFingerprint:resourceFingerprint(profile),serviceStatus:'idle',workspaceRegistration};
   const previousSetup=workspaceRegistration&&serviceRegistration?.read({profileId:profile.id,profileVersion:profile.version});
   const configure=previousSetup?.status==='unconfigured'||previousSetup?.reason==='configuration_changed';
   resources.set(resourceId,resource);changed();prepareService(resource,{configure});
   return desktopView(resource);
  })();
  try{return await publication.result;}finally{if(publishing.get(data.connectionId)===publication)publishing.delete(data.connectionId);}
 }

 async function publishWsl(receipt){
  const fields=['profileId','profileVersion','distribution','root','port','runtime'];exact(receipt,fields,fields);
  if(stopped||!id(receipt.profileId)||!Number.isSafeInteger(receipt.profileVersion)||receipt.profileVersion<1||typeof receipt.root!=='string'||!receipt.root.startsWith('/')||typeof receipt.runtime!=='string'||!receipt.runtime.startsWith('/')||!services?.wsl)fail('managed_compute_invalid_request');
  const profile=profiles.read({id:receipt.profileId});
  if(profile.kind!=='wsl'||profile.version!==receipt.profileVersion||profile.distribution!==receipt.distribution||profile.port!==receipt.port||profile.root.startsWith('/')&&profile.root!==receipt.root)fail('managed_compute_profile_changed');
  const resourceId='wsl:'+profile.id,previous=resources.get(resourceId);
  const duplicate=[...resources.values()].some(row=>row.kind==='wsl'&&row.resourceId!==resourceId&&saved(row)&&
   ['distribution','root','port'].every(key=>row.receipt[key]===receipt[key]));
  if(duplicate)fail('managed_compute_profile_already_published');
  if(previous&&equal(receipt,previous.receipt)&&(previous.service||previous.preparing)){
   if(previous.preparing)await previous.preparing;
   if(previous.service)return view(previous);
  }
  if(previous)void remove(previous);
  const resource={resourceId,profileId:profile.id,profileVersion:profile.version,profile,receipt:structuredClone(receipt),kind:'wsl',name:profile.name,targetFingerprint:resourceFingerprint(profile),serviceStatus:'idle'};
  resources.set(resourceId,resource);
  if(!await prepareService(resource)){if(resources.get(resourceId)===resource)await remove(resource);fail('managed_compute_private_service_unavailable');}
  current(resource);
  return view(resource);
 }

 async function refreshService({connectionId}){
  const resource=[...resources.values()].find(item=>item.connectionId===connectionId);
  if(!resource||stopped||!saved(resource))return null;
  const existing=resource.service;
  if(existing){
   try{await existing.verify();return existing;}
   catch{discardService(resource,existing);}
  }
  return prepareService(resource);
 }

 async function configureService(data){
  exact(data,['connectionId','profileId','profileVersion'],['connectionId','profileId','profileVersion']);
  const resource=resources.get('ssh:'+data.profileId);
  if(!resource||!equal(data,resourceRef(resource)))fail('managed_compute_resource_unavailable');
  await checkConnection(resource);
  if(resourceWorkspace)resource.workspaceRegistration=await resourceWorkspace.assertHandoff(data,()=>current(resource));
  if(resource.preparing)await resource.preparing;
  current(resource);
  if(!resource.service&&!await prepareService(resource,{configure:true}))fail(resource.serviceError||'managed_compute_private_service_unavailable');
  current(resource);
  return desktopView(resource);
 }

 async function serviceStatus(data){
  exact(data,['connectionId','profileId','profileVersion'],['connectionId','profileId','profileVersion']);
  const resource=resources.get('ssh:'+data.profileId);
  if(!resource||!equal(data,resourceRef(resource)))fail('managed_compute_resource_unavailable');
  await checkConnection(resource);
  const observed=await connections.serviceState({connectionId:data.connectionId});
  current(resource);
  if(!equal(resourceRef(observed),data))fail('managed_compute_service_changed');
  const progress=safeSshServiceProgress(observed.progress),phase=safeSshServicePhase(observed.servicePhase);
  const ready=resource.serviceStatus==='ready'&&observed.status==='connected'&&resource.service?.generation===observed.serviceId;
  let runtimeComparison;
  if(ready&&services.comparison){
   try{runtimeComparison=await services.comparison(resource.profile,resource.service.health);}catch{}
   current(resource);
   if(resource.service?.generation!==observed.serviceId)fail('managed_compute_service_changed');
  }
  const status=ready?'connected':observed.status==='unknown'?'unknown':resource.preparing?'connecting':
   resource.serviceStatus==='unavailable'||resource.serviceStatus==='configuration_required'?'failed':
   ['idle','failed','unknown','disconnecting','disconnected'].includes(observed.status)?observed.status:'unknown';
  const error=observed.error||resource.serviceError;
  return {...data,schemaVersion:2,status,operator:'human',workflowReady:ready,serviceActive:observed.serviceActive===true,
   ...phase?{phase}:{},...progress?{progress}:{},...observed.serviceId?{serviceId:observed.serviceId}:{},
   ...observed.attemptId?{attemptId:observed.attemptId}:{},...ready?{health:resource.service.health}:{},
   ...error?{error:safeSshServiceError(error,phase||'preparing_local')}:{},...runtimeComparison?{runtimeComparison}:{}};
 }

 async function updateService(data){
  const keys=['connectionId','profileId','profileVersion','expectedRuntimeId','bundledRuntimeId'];exact(data,keys,keys);
  if(!/^[a-f0-9]{20}$/.test(data.expectedRuntimeId)||!/^[a-f0-9]{20}$/.test(data.bundledRuntimeId))fail('managed_compute_invalid_request');
  const {expectedRuntimeId,bundledRuntimeId,...ref}=data,resource=resources.get('ssh:'+data.profileId);
  if(!resource||!equal(ref,resourceRef(resource)))fail('managed_compute_resource_unavailable');
  await checkConnection(resource);
  if(resourceWorkspace)resource.workspaceRegistration=await resourceWorkspace.assertHandoff(ref,()=>current(resource));
  const original=resource.service;
  if(resource.preparing||!original||original.canUpdate?.()!==true||[...leases.values()].some(lease=>lease.resource===resource&&busy(lease.scope)))fail('managed_compute_channel_busy');
  await original.verify();current(resource);
  if(resource.service!==original||original.canUpdate()!==true)fail('managed_compute_service_changed');
  if(resource.workspaceRegistration&&selectionCatalog?.put){
   // The data root and account are independent of the service executable.
   // Retain the previously verified source for this project's historical reads.
   selectionCatalog.put(workerHistory,original.id,{sourceId:original.id,profileId:resource.profileId,
    resourceId:resource.workspaceRegistration.resourceId,root:original.binding.root,hostIdentity:original.binding.hostIdentity});
  }
  const next=await prepareService(resource,{upgrade:{expectedRuntimeId,bundledRuntimeId,generation:original.generation}});
  current(resource);
  if(!next||next===original||next.health?.runtimeId!==bundledRuntimeId)fail(resource.serviceError||'managed_compute_service_changed');
  return desktopView(resource);
 }

 async function projectGrant(scope,resource,{required=false}={}){
  const expected=resource.service;
  const assertCurrent=()=>{liveScope(scope);current(resource);if(resource.service!==expected)fail('managed_compute_service_changed');};
  assertCurrent();
  if(required&&!expected)fail(resource.serviceError||'managed_compute_private_service_unavailable');
  try{return await managedWorkerProject(scope,resource,expected,assertCurrent);}
  catch(error){
   if(sourceFailure(error.message))discardService(resource,expected);
   if(!required&&(sourceFailure(error.message)||error.message==='managed_compute_worker_request_failed'))return null;
   throw error;
  }
 }
 const eligibleProject=async(scope,resource)=>!!await projectGrant(scope,resource);
 function conversationLease(scope,resource){
  const lease=leases.get(leaseKey(scope,resource.resourceId));
  return lease?.resource===resource&&lease.projectId===projectOf(scope)&&!lease.releasing?lease:null;
 }
 function terminalPolicyGuard(scope,resource){
  const revision=terminalPolicyRevision(scope,resource);
  const workspaceId=resource.workspaceRegistration?.workspaceId,modeRevision=developerCompute?.revision(workspaceId);
  return ()=>{if(revision!==terminalPolicyRevision(scope,resource)||modeRevision!==developerCompute?.revision(workspaceId))throw Error('managed_compute_project_grant_required');};
 }
 function developerAccess(scope,resource){
  return !!resource&&resource.kind==='ssh'&&!!terminalAuthorization&&
   developerCompute?.allows(scope,resource.workspaceRegistration?.workspaceId)===true;
 }
 function isDeveloperWorkspace(scope,resourceId){
  const resource=resources.get(resourceId);
  if(!resource||!visible(resource)||!developerAccess(scope,resource))return false;
  liveScope(scope);return true;
 }
 function endDeveloperAccess(workspaceId){
  if(!workspaceId)return;
  for(const lease of leases.values()){
   if(lease.developerWorkspaceId===workspaceId){void retire(lease);continue;}
   if(lease.developerServiceWorkspace===workspaceId){lease.service=null;delete lease.developerServiceWorkspace;}
   if(lease.terminal?.developerWorkspaceId===workspaceId)void closeTerminal(lease,lease.terminal);
   removeUnused(lease);
  }
 }
 function assertResourceIntent(scope,resource){
  if(!intent.permitsUse(scope,resource))fail('managed_compute_user_instruction_required');
 }
 async function allowed(scope,resource,action,{choosing=false}={}){
  liveScope(scope);current(resource);
  if(!choosing)assertResourceIntent(scope,resource);
  const policyCurrent=terminalPolicyGuard(scope,resource);
  const terminal=resource.kind==='ssh'?await authorizeTerminal(scope,resource):false;
  const terminalRequest=action==='terminal';
  const priorTerminal=intent.continuesChannel(scope,resource,'terminal');
  const priorService=intent.continuesChannel(scope,resource,'service');
  const existingInspection=action==='inspect'&&(priorService||priorTerminal&&!!readyShell(conversationLease(scope,resource)));
  const chatAccess=terminal!=='denied'&&(terminalRequest?resource.kind==='ssh'&&priorTerminal:
   existingInspection||!!resource.service&&(!scope.taskId||priorService));
  const canCheckProject=terminalRequest?resource.kind==='ssh'&&terminal!=='denied':!!resource.service;
  const canUse=terminal===true||terminal!=='denied'&&developerAccess(scope,resource)||chatAccess||canCheckProject&&await eligibleProject(scope,resource);
  liveScope(scope);current(resource);
  policyCurrent();
  if(!choosing)assertResourceIntent(scope,resource);
  return canUse;
 }

 async function availableChoices(scope,kind,access){
  const tested=await Promise.all([...resources.values()].filter(resource=>(!kind||resource.kind===kind)&&visible(resource)).map(async resource=>{
   const requested=access??(resource.kind==='ssh'?'terminal':'service');
   if(requested==='service'&&!resource.service||requested==='terminal'&&resource.kind!=='ssh')return null;
   try{return await allowed(scope,resource,requested,{choosing:true})?resource:null;}catch(error){if(error.message==='managed_compute_context_changed')throw error;return null;}
  }));
  liveScope(scope);
  return tested.filter(resource=>resource&&resources.get(resource.resourceId)===resource);
 }

 const aliasEntry=(alias,scope)=>aliases?.read(alias,()=>{try{liveScope(scope);return true;}catch{return false;}})??null;
 function findResource(args,alias,saved){
  const rows=[...resources.values()];
  if(args.resourceId!==undefined)return resources.get(args.resourceId);
  if(args.profileId!==undefined)return rows.find(row=>row.profileId===args.profileId);
  if(saved)return rows.find(row=>row.profileId===saved.profileId&&row.targetFingerprint===saved.targetFingerprint);
  const matches=rows.filter(row=>normalizeComputeAlias(row.name)===alias);
  return matches.length===1?matches[0]:undefined;
 }
 function groupMatch(turn,group,resource){
  for(const alias of group)if(requestsComputeName(turn.message,alias)&&genericComputeKind(alias)===resource.kind)return alias;
  return null;
 }
 function offeredChoices(proposal,eligible){
  return proposal.candidates.filter(option=>eligible.some(resource=>option.resourceId===resource.resourceId&&option.targetFingerprint===resource.targetFingerprint)).map(candidate);
 }
 async function choose(scope,args,access){
  const alias=args.alias===undefined?null:normalizeComputeAlias(args.alias);
  if(args.alias!==undefined&&!alias)fail('managed_compute_invalid_request');
  const saved=alias&&!genericComputeKind(alias)?aliasEntry(alias,scope):null;
  let resource=findResource(args,alias,saved);
  // Previously acquired exact leases survive later turns and navigation.
  const held=resource&&hasLease(conversationLease(scope,resource));
  const turn=intent.current(scope);
  if(!turn&&held)return {resource};
  intent.assertTurn(scope,turn);
  if(turn.projectId!==projectOf(scope)||(scope.taskId??null)!==turn.taskId)fail('managed_compute_context_changed');
  if(turn.excluded.some(item=>item.resourceId===resource?.resourceId))fail('managed_compute_user_instruction_required');
  const answer=turn.answer;
  if(answer){
   const chosen=resources.get(answer.choice.resourceId);
   if(!chosen||chosen.targetFingerprint!==answer.choice.targetFingerprint)fail('managed_compute_choice_changed');
   if(resource===chosen||alias&&alias===answer.proposal.alias)return {resource:chosen,turn,answer};
   return {choice:{status:'target_selected',resource:candidate(chosen),retry:{resource_id:chosen.resourceId,...access?{access}:{}}}};
  }
  const named=turn.named.length?turn.named:turn.retained;
  if(named.length||turn.ambiguous.length){
   const matching=named.find(item=>item.resourceId===resource?.resourceId);
   if(matching){
    if(matching.targetFingerprint!==resource.targetFingerprint)fail('managed_compute_choice_changed');
    return {resource,turn};
   }
   const choices=await availableChoices(scope,undefined,access);
   intent.assertTurn(scope,turn);
   const offered=offeredChoices({candidates:[...named,...turn.ambiguous]},choices);
   if(!offered.length)fail('managed_compute_choice_changed');
   if(named.length===1&&!turn.ambiguous.length){
    return {choice:{status:'target_selected',resource:offered[0],retry:{resource_id:offered[0].resourceId,...access?{access}:{}}}};
   }
   return {choice:{status:'choice_required',candidates:offered}};
  }
  if(held&&!turn.pending)return {resource};
  if(!turn.pending&&(args.resourceId||args.profileId)&&developerAccess(scope,resource))return {resource,turn};
  const direct=alias??normalizeComputeAlias(resource?.name);
  if(saved&&resource&&direct&&namesInChat(turn.message,direct))return {resource,turn};
  if(!alias&&resource&&aliases){
   const currentScope=()=>{try{liveScope(scope);return true;}catch{return false;}};
   for(const known of aliases.list(currentScope)){
    if(!namesInChat(turn.message,known))continue;
    const link=aliasEntry(known,scope);
    if(link?.profileId===resource.profileId&&link.targetFingerprint===resource.targetFingerprint)return {resource,turn};
   }
  }
  const genericAlias=(alias&&genericComputeKind(alias)?alias:null)||resource&&groupMatch(turn,['集群','ssh','cluster','本地','wsl','local'],resource);
  const requested=genericAlias||alias;
  if(!requested||!(genericComputeKind(requested)?requestsComputeName(turn.message,requested):namesInChat(turn.message,requested))){
   if(turn.pending||!canAskForResource(turn.message,turn.discovered))fail('managed_compute_user_instruction_required');
   const alternatives=await availableChoices(scope,resource?.kind,access);
   intent.assertTurn(scope,turn);
   if(!alternatives.length)fail('managed_compute_no_eligible_resource');
   const proposal=intent.propose(scope,turn,{alias:null,save:false,candidates:alternatives.map(row=>({...candidate(row),targetFingerprint:row.targetFingerprint}))});
   return {choice:{status:'choice_required',candidates:offeredChoices(proposal,alternatives)}};
  }
  const kind=genericComputeKind(requested);
  // A known alias is never interpreted as a different running connection when
  // its original profile is merely offline.
  if(saved&&!resource&&![...resources.values()].some(row=>row.profileId===saved.profileId))fail('managed_compute_resource_unavailable');
  const choices=await availableChoices(scope,kind,access);
  intent.assertTurn(scope,turn);
  if(kind&&choices.length===1&&(!resource||choices[0]===resource))return {resource:choices[0],turn};
  if(!choices.length)fail('managed_compute_no_eligible_resource');
  const proposal=intent.propose(scope,turn,{alias:requested,previous:saved,save:!kind&&!!alias,
   candidates:choices.map(row=>({...candidate(row),targetFingerprint:row.targetFingerprint}))});
  const candidates=offeredChoices(proposal,choices);
  if(!candidates.length)fail('managed_compute_no_eligible_resource');
  return {choice:{status:'choice_required',alias:requested,candidates}};
 }

 function assertLease(scope,lease){
  liveScope(scope);current(lease.resource);
  if(lease.releasing||leases.get(lease.key)!==lease||!equal(lease.scope,ownerOf(scope))||lease.projectId!==projectOf(scope))fail('managed_compute_resource_lease_required');
  if(lease.developerWorkspaceId&&!developerAccess(scope,lease.resource))fail('managed_compute_project_grant_required');
 }
 const shellRef=(lease,terminal)=>({...resourceRef(lease.resource),leaseId:terminal.id,scope:lease.scope});
 const shellView=(lease,shell)=>({sessionId:shell.sessionId,resourceId:lease.resource.resourceId,name:lease.resource.name,kind:'ssh',alive:true});
 const acquired=(lease,access,reused)=>({status:'acquired',resource:view(lease.resource),access,reused,
  ...access==='terminal'?{terminal:shellView(lease,readyShell(lease))}:{}});

 function removeUnused(lease){
  if(!lease.service&&!lease.terminal&&leases.get(lease.key)===lease)leases.delete(lease.key);
 }
 function closeTerminal(lease,terminal,{retry=false}={}){
  if(terminal.closing&&!(retry&&terminal.closeUnknown))return terminal.closing;
  terminal.closeUnknown=false;
  const operation=Promise.resolve().then(async()=>{
   try{
    if(terminal.dispatched){
     const receipt=await connections.managedShell('close',shellRef(lease,terminal));
     if(receipt?.closed!==true)fail('terminal_unavailable');
    }
   }catch(error){
    if(error.message!=='terminal_session_exited'){terminal.closeUnknown=true;changed();return false;}
   }
   if(lease.terminal===terminal)lease.terminal=null;
   removeUnused(lease);changed();return true;
  });
  terminal.closing=operation;
  changed();return operation;
 }
 function retire(lease){
  if(lease.releasing&&!lease.releaseUnknown)return lease.releasing;
  cancelAcquisitions(lease.scope,lease.resource.resourceId);
  lease.releaseUnknown=false;
  const closing=Promise.resolve().then(async()=>{
   const closed=!lease.terminal||await closeTerminal(lease,lease.terminal,{retry:true});
   if(closed&&leases.get(lease.key)===lease)leases.delete(lease.key);
   lease.releaseUnknown=!closed;
   changed();return closed;
  });
  lease.releasing=closing;
  changed();return closing;
 }
 function cancelAcquisitions(scope,resourceId){
  for(const request of pendingAcquisitions){
   if(request.scope.provider!==scope.provider||request.scope.threadId!==scope.threadId)continue;
   if(resourceId===undefined)request.forgotten=true;
   else request.cancelled.add(resourceId);
  }
 }

 async function verifiedService(scope,resource,check){
  const service=resource.service;
  if(!service)fail(resource.serviceError||'managed_compute_private_service_unavailable');
  const policyCurrent=terminalPolicyGuard(scope,resource);
  const fresh=()=>{check();policyCurrent();if(resource.service!==service)fail('managed_compute_service_changed');};
  fresh();
  if(!await allowed(scope,resource,'service'))fail('managed_compute_project_grant_required');
  fresh();
  try{await service.verify();}catch(error){if(sourceFailure(error.message))discardService(resource,service);throw error;}
  fresh();
  if(!await allowed(scope,resource,'service'))fail('managed_compute_project_grant_required');
  fresh();return service;
 }
 function rememberSelection(scope,lease,answer,check){
  if(answer?.proposal.save&&aliases)aliases.remember(answer.proposal.alias,lease.resource,answer.proposal.previous,()=>{
   try{assertLease(scope,lease);check();return true;}catch{return false;}
  });
  check();if(!developerAccess(scope,lease.resource))intent.acquired(scope,lease.resource);
 }
 function startTerminal(scope,lease,answer,check){
  const terminal={id:uuid(),shell:null,opening:null,closing:null,dispatched:false,closeUnknown:false};
  if(developerAccess(scope,lease.resource))terminal.developerWorkspaceId=lease.resource.workspaceRegistration.workspaceId;
  lease.terminal=terminal;
  const fresh=()=>{
   assertLease(scope,lease);check();
   if(terminal.closing||lease.terminal!==terminal)fail('managed_compute_resource_lease_changed');
  };
  terminal.opening=Promise.resolve().then(async()=>{
   try{
    fresh();terminal.dispatched=true;
    const state=await connections.managedShell('open',shellRef(lease,terminal));
    if(state?.alive!==true)fail('terminal_session_exited');
    fresh();
    if(!await allowed(scope,lease.resource,'terminal'))fail('managed_compute_project_grant_required');
    fresh();rememberSelection(scope,lease,answer,check);
    terminal.shell=state;lease.touchedAt=now();onAcquired(scope,view(lease.resource));
   }catch(error){
    const closed=await closeTerminal(lease,terminal);
    if(terminal.dispatched&&terminalFailureCodes.has(error.message))throw Object.assign(Error(error.message),{terminalCleanup:closed?'confirmed':'unconfirmed'});
    throw error;
   }
   finally{terminal.opening=null;changed();}
  });
  changed();return terminal.opening;
 }

 async function terminalUnavailable(scope,resource,key,error,check){
  if(!terminalFailureCodes.has(error.message))throw error;
  check();
  let service;
  try{service=await verifiedService(scope,resource,check);}catch{/* The PTY outcome is independent of worker availability. */}
  check();
  const lease=leases.get(key);
  const unresolved=error.terminalCleanup==='unconfirmed'||lease?.terminal?.closeUnknown||lease?.terminal?.observationUnknown;
  const serviceReady=service&&resource.service===service;
  if(!serviceReady&&!error.terminalCleanup&&!unresolved)throw error;
  const leaseStatus=unresolved?'unknown':lease?.service&&lease.service===resource.service?'service_retained':'none';
  return {status:'terminal_unavailable',code:error.message,leaseStatus,resource:view(resource),
   ...serviceReady?{retry:{resource_id:resource.resourceId,access:'service'}}:{}};
 }

 async function acquire(scope,args){
  exact(args,['resourceId','profileId','alias','access']);
  if(args.alias===undefined&&args.resourceId===undefined&&args.profileId===undefined||
     args.resourceId!==undefined&&(typeof args.resourceId!=='string'||! /^(?:ssh|wsl):[A-Za-z0-9_-]{1,100}$/.test(args.resourceId))||
     args.profileId!==undefined&&!id(args.profileId)||args.access!==undefined&&!['terminal','service'].includes(args.access))fail('managed_compute_invalid_request');
  liveScope(scope);
  const request={scope:ownerOf(scope),cancelled:new Set(),forgotten:false};
  pendingAcquisitions.add(request);
  try{
   const selector=args.alias!==undefined?{alias:args.alias}:args.resourceId!==undefined?{resourceId:args.resourceId}:{profileId:args.profileId};
   const selection=await choose(scope,selector,args.access);
   if(selection.choice)return selection.choice;
   const {resource,turn,answer}=selection,key=leaseKey(scope,resource.resourceId);
   if(args.resourceId!==undefined&&args.resourceId!==resource.resourceId||args.profileId!==undefined&&args.profileId!==resource.profileId)fail('managed_compute_invalid_request');
   const check=()=>{
    liveScope(scope);current(resource);
    if(turn)intent.assertTurn(scope,turn);
    if(request.forgotten||request.cancelled.has(resource.resourceId))fail('managed_compute_resource_lease_changed');
   };
   const selectedLease=()=>{
    const lease=leases.get(key);
    if(lease&&(lease.resource!==resource||lease.projectId!==projectOf(scope)||lease.releasing))fail('managed_compute_resource_lease_changed');
    return lease;
   };
   const createLease=()=>{
    const lease={id:uuid(),key,scope:request.scope,projectId:projectOf(scope),resource,touchedAt:now(),service:null,terminal:null,releasing:null};
    if(developerAccess(scope,resource))lease.developerWorkspaceId=resource.workspaceRegistration.workspaceId;
    leases.set(key,lease);return lease;
   };
   const access=args.access??(resource.kind==='ssh'?'terminal':'service');
   check();
   if(access==='service'){
    const service=await verifiedService(scope,resource,check);
    check();if(resource.service!==service)fail('managed_compute_service_changed');
    const lease=selectedLease()??createLease(),reused=lease.service===service;
    try{rememberSelection(scope,lease,answer,check);if(!developerAccess(scope,resource))intent.recordChatChannel(scope,resource,'service');}catch(error){removeUnused(lease);throw error;}
    if(!reused&&developerAccess(scope,resource))lease.developerServiceWorkspace=resource.workspaceRegistration.workspaceId;
    lease.service=service;lease.touchedAt=now();
    if(!reused){onAcquired(scope,view(resource));changed();}
    return acquired(lease,access,reused);
   }
   try{
    if(resource.kind!=='ssh')fail('managed_compute_terminal_not_supported');
   const policyCurrent=terminalPolicyGuard(scope,resource);
   const fresh=()=>{check();policyCurrent();};
    if(!await allowed(scope,resource,'terminal'))fail('managed_compute_project_grant_required');
    fresh();await checkConnection(resource);fresh();
    // Keep the verified target and requested capability across a mode change.
    // The shell still has to return its own independent ready receipt.
    if(!developerAccess(scope,resource))intent.recordChatChannel(scope,resource,'terminal');
    let lease=selectedLease();
    let terminal=lease?.terminal;
    if(terminal?.opening){
     try{await terminal.opening;}
     catch(error){
      fresh();
      if(!['managed_compute_context_changed','managed_compute_turn_changed'].includes(error.message)||terminal.closeUnknown||selectedLease()?.terminal)throw error;
      // This is a new request under the current scope. The stale channel has
      // a confirmed close, so a fresh opening cannot duplicate it.
      lease=selectedLease();terminal=lease?.terminal;
     }
    }
    if(terminal){
     const closedTerminal=()=>Object.assign(Error('terminal_session_exited'),{terminalCleanup:terminal.closeUnknown?'unconfirmed':'confirmed'});
     if(terminal.closing){await terminal.closing;throw closedTerminal();}
     if(!await verifyShell(lease,scope))throw closedTerminal();
     assertLease(scope,lease);fresh();
     if(lease.terminal!==terminal||!readyShell(lease))throw closedTerminal();
     lease.touchedAt=now();return acquired(lease,access,true);
    }
    if(count(resource)>=MANAGED_SSH_SHELL_CAPACITY)throw Object.assign(Error('terminal_session_limit'),{operationNotStarted:true});
    lease??=createLease();
    await startTerminal(scope,lease,answer,fresh);
    assertLease(scope,lease);fresh();
    if(!readyShell(lease))fail('terminal_session_exited');
    return acquired(lease,access,false);
   }catch(error){return await terminalUnavailable(scope,resource,key,error,check);}
  }finally{pendingAcquisitions.delete(request);}
 }

 async function release(scope,args){
  exact(args,['resourceId'],['resourceId']);liveScope(scope);
  if(typeof args.resourceId!=='string')fail('managed_compute_invalid_request');
  const lease=leases.get(leaseKey(scope,args.resourceId));
  if(lease&&lease.projectId!==projectOf(scope))fail('managed_compute_resource_lease_required');
  cancelAcquisitions(scope,args.resourceId);
  intent.releaseChannel(scope,args.resourceId);
  if(!lease)return {status:'not_acquired',resourceId:args.resourceId};
  const closed=await retire(lease);liveScope(scope);
  return {status:closed?'released':'unconfirmed',resourceId:args.resourceId,terminalClosed:closed};
 }

 async function verifyShell(lease,scope){
  assertLease(scope,lease);
  const terminal=lease.terminal,shell=terminal?.shell;
  if(!shell||terminal.closing)return false;
  try{
   const state=await connections.managedShell('state',shellRef(lease,terminal));
   assertLease(scope,lease);
   if(lease.terminal===terminal&&!terminal.closing&&state?.alive===true&&state.expiresAt>now()&&state.sessionId===shell.sessionId&&state.ownerEpoch===shell.ownerEpoch){
    if(terminal.observationUnknown){terminal.observationUnknown=false;changed();}
    return true;
   }
  }catch(error){
   if(!terminalGone(error.message)){
    if(terminalFailureCodes.has(error.message)&&lease.terminal===terminal&&!terminal.closing){terminal.observationUnknown=true;changed();}
    throw error;
   }
  }
  if(lease.terminal===terminal)await closeTerminal(lease,terminal);
  return false;
 }

 async function resolveLease(scope,resourceId,action='service'){
  liveScope(scope);
  const rows=[...leases.values()].filter(lease=>equal(lease.scope,ownerOf(scope))&&lease.projectId===projectOf(scope)&&hasLease(lease)&&(!resourceId||lease.resource.resourceId===resourceId));
  if(rows.length!==1)fail(rows.length?'managed_compute_resource_choice_required':'managed_compute_resource_lease_required');
  const lease=rows[0];
  assertLease(scope,lease);
  const policyCurrent=terminalPolicyGuard(scope,lease.resource);
  assertResourceIntent(scope,lease.resource);
  if(action==='skill')action=readyShell(lease)?'terminal':'inspect';
  if((action==='terminal'?lease.terminal?.developerWorkspaceId:lease.developerServiceWorkspace)&&!developerAccess(scope,lease.resource))fail('managed_compute_project_grant_required');
  const service=lease.resource.service;
  if(action==='terminal'&&!readyShell(lease))fail('managed_compute_resource_lease_required');
  if(action!=='terminal'&&lease.service&&lease.service!==service)fail('managed_compute_service_changed');
  let grant;
  if(action==='service'){
   grant=await projectGrant(scope,lease.resource,{required:true});
   if(lease.resource.service!==service)fail('managed_compute_service_changed');
   if(!grant)fail('managed_compute_project_grant_required');
  }else if(!await allowed(scope,lease.resource,action))fail('managed_compute_project_grant_required');
  assertLease(scope,lease);lease.touchedAt=now();
  return {lease,service,grant,policyCurrent};
 }

 async function resolveSkillLibrary(scope,resourceId){
  if(typeof resourceId!=='string'||!resourceId.startsWith('ssh:'))fail('managed_compute_invalid_request');
  const {lease}=await resolveLease(scope,resourceId,'skill');
  const {resource}=lease,original=resource.workspaceRegistration;
  if(!original||!resourceWorkspace)fail('ssh_workspace_confirmation_required');
  const check=()=>{
   assertLease(scope,lease);
   const registration=resourceWorkspace.resolveHostedResourceWorkspace(original.resourceId,
    {profileId:resource.profileId,hostIdentity:original.hostIdentity});
   if(!registration||registration.account!==original.account)fail('ssh_workspace_changed');
   return registration;
  };
  await checkConnection(resource);
  return {registration:check(),check};
 }

 async function callTerminalTool(name,args,scope){
  liveScope(scope);
  if(name==='list_compute_terminals'){
   exact(args,[]);const sessions=[];
   for(const lease of [...leases.values()]){
    if(!lease.terminal?.shell||lease.releasing||!equal(lease.scope,ownerOf(scope))||lease.projectId!==projectOf(scope))continue;
    if(!intent.permitsUse(scope,lease.resource))continue;
    if(await allowed(scope,lease.resource,'terminal')&&await verifyShell(lease,scope))sessions.push(shellView(lease,readyShell(lease)));
   }
   return {sessions};
  }
  if(!['read_compute_terminal','write_compute_terminal'].includes(name))fail('managed_compute_invalid_request');
  const reading=name==='read_compute_terminal';
  exact(args,reading?['session_id','cursor','max_bytes']:['session_id','request_id','action','data'],['session_id']);
  const input=reading?null:terminalToolInput(args);
  if(!id(args.session_id)||reading&&(args.cursor!==undefined&&(!Number.isSafeInteger(args.cursor)||args.cursor<0)||args.max_bytes!==undefined&&(!Number.isInteger(args.max_bytes)||args.max_bytes<1||args.max_bytes>65536)))fail('managed_compute_invalid_request');
  const own=[...leases.values()].find(lease=>readyShell(lease)?.sessionId===args.session_id&&equal(lease.scope,ownerOf(scope)));
  if(!own)fail('managed_compute_resource_lease_required');
  const {lease,policyCurrent}=await resolveLease(scope,own.resource.resourceId,'terminal');
  const terminal=lease.terminal,shell=readyShell(lease);
  if(lease!==own||shell?.sessionId!==args.session_id)fail('managed_compute_resource_lease_changed');
  const ref={...shellRef(lease,terminal),sessionId:shell.sessionId,ownerEpoch:shell.ownerEpoch};
  const check=()=>{
   assertLease(scope,lease);
   assertResourceIntent(scope,lease.resource);
   if(lease.terminal!==terminal||readyShell(lease)!==shell)fail('managed_compute_resource_lease_changed');
   policyCurrent();
  };
  const maxBytes=Math.max(16384,args.max_bytes??65536);
  try{
   if(!reading&&terminalAuthorization){
    if(!await verifyShell(lease,scope))fail('managed_compute_resource_lease_changed');
    check();
    return await terminalAuthorization.input({scope,ref:{...resourceRef(lease.resource),resourceName:lease.resource.name},input,
     sessionId:shell.sessionId,ownerEpoch:shell.ownerEpoch,assertCurrent:check});
   }
   const result=reading?await connections.managedShell('read',{...ref,...args.cursor!==undefined?{cursor:args.cursor}:{},maxBytes}):await connections.managedShell('input',{...ref,...input});
   check();
   if(reading){
    if(!await allowed(scope,lease.resource,'terminal'))fail('managed_compute_project_grant_required');
    check();
   }
   return reading?{session_id:ref.sessionId,output:result.output,cursor:result.cursor,dropped:result.dropped,effective_max_bytes:maxBytes}:result;
  }catch(error){if(terminalGone(error.message)&&lease.terminal===terminal)void closeTerminal(lease,terminal);throw error;}
 }

 function consoleEntries(){
  const channels=[...leases.values()].map(lease=>{
   const terminal=lease.terminal,shell=readyShell(lease),serviceOnly=!!lease.service&&!shell;
   const terminalStatus=!terminal||shell?null:terminal.closeUnknown||terminal.observationUnknown||terminal.shell?.expiresAt<=now()?'lost':terminal.closing?'releasing':'preparing';
   const status=lease.releaseUnknown?'lost':lease.releasing?'releasing':shell||lease.service?'assigned':terminalStatus??'preparing';
   return {leaseId:lease.id,...lease.scope,projectId:lease.projectId,...desktopView(lease.resource),sessionId:shell?.sessionId??null,
    serviceOnly,serviceContext:!!lease.service,serviceGeneration:lease.service?.generation??null,terminalStatus:serviceOnly?terminalStatus:null,status,busy:busy(lease.scope),
    expired:!serviceOnly&&!!terminal?.shell&&terminal.shell.expiresAt<=now()};
  });
  const entries=[...resources.values()].filter(saved).map(resource=>({...desktopView(resource),generation:resource.service?.generation??null}));
  return {entries,channels};
 }
 function consoleLease(target){
  const lease=leases.get(leaseKey(target,target.resourceId));
  if(!lease||lease.id!==target.leaseId)fail('managed_compute_channel_changed');
  return lease;
 }
 async function observeConsoleLease(target){
  const lease=consoleLease(target);
  const terminal=lease.terminal,shell=readyShell(lease);
  if(lease.releasing||!shell||target.sessionId!==shell.sessionId)return false;
  try{
   current(lease.resource);
   const state=await connections.managedShell('state',shellRef(lease,terminal));
   current(lease.resource);
   return consoleLease(target)===lease&&!lease.releasing&&lease.terminal===terminal&&readyShell(lease)===shell&&state.alive&&state.sessionId===shell.sessionId&&state.ownerEpoch===shell.ownerEpoch;
  }catch{return false;}
 }
 async function observeConsoleService({resourceId,generation}){
  const resource=resources.get(resourceId),service=resource?.service;
  if(!service||service.generation!==generation)return false;
  try{
   current(resource);await service.verify();current(resource);
   return resource.service===service;
  }catch{return false;}
 }
 async function releaseFromConsole(target){
  const lease=consoleLease(target);
  if(busy(lease.scope))fail('managed_compute_channel_busy');
  intent.releaseChannel({...lease.scope,projectId:lease.projectId},lease.resource.resourceId);
  const closed=await retire(lease);
  return {status:closed?'released':'unconfirmed'};
 }
 async function detachLocalFromConsole({resourceId,generation},beforeDetach){
  const resource=resources.get(resourceId);
  if(resource?.kind!=='wsl'||!resource.service||resource.service.generation!==generation)fail('managed_compute_resource_unavailable');
  current(resource);
  if([...leases.values()].some(lease=>lease.resource===resource&&busy(lease.scope)))fail('managed_compute_channel_busy');
  beforeDetach?.();
  await remove(resource);
 }

 function discardService(resource,expected){
  if(!expected||resource.service!==expected)return;
  resource.service=null;resource.serviceStatus='unavailable';expected.close?.();changed();
 }
 async function anchored(resource,service,method,target,data,mcp=false,timeoutMs,beforeDispatch){
  current(resource);
  if(resource.service!==service||!service)fail('managed_compute_private_service_unavailable');
  if(!['GET','POST'].includes(method)||typeof target!=='string'||!/^\/(?:api\/[a-z0-9_/-]+|mcp)$/.test(target)||target.includes('//')||mcp!==(target==='/mcp'))fail('managed_compute_invalid_request');
  try{
   const result=await service.forward(method,target,data,mcp,timeoutMs,beforeDispatch);
   current(resource);
   if(resource.service!==service)fail('managed_compute_service_changed');
   return result;
  }catch(error){if(sourceFailure(error.message))discardService(resource,service);throw error;}
 }
 function listSources({scheduleReady=false}={}){
  const sources=[];
  for(const resource of resources.values()){
   try{current(resource);}catch{continue;}
   const service=resource.service;
   if(!service||resource.serviceStatus!=='ready'||scheduleReady&&service.health?.managed_schedule_schema!==1)continue;
   sources.push({id:service.id,generation:service.generation,profileId:resource.profileId,kind:resource.kind,binding:structuredClone(service.binding),health:structuredClone(service.health),async request(method,path,data,{beforeDispatch,timeoutMs}={}){
    if(path==='/api/managed-schedules/observe-once'){
     const fields=['sourceId','scheduleId','requestId'];exact(data,fields,fields);
     if(method!=='POST'||data.sourceId!==service.id)fail('managed_compute_invalid_request');
    }
    const response=await anchored(resource,service,method,path,data,false,timeoutMs,beforeDispatch);
    if(response.status!==200)throw Error(response.data?.error||'managed_compute_worker_request_failed');
    return response.data;
   }});
  }
  return sources;
 }

 async function inspectService(scope,resourceId,{probeScheduler=false}={}){
  const {lease,service,policyCurrent}=await resolveLease(scope,resourceId,'inspect'),resource=lease.resource;
  const check=()=>{assertLease(scope,lease);assertResourceIntent(scope,resource);if(resource.service!==service)fail('managed_compute_service_changed');};
  const grant=service&&await projectGrant(scope,resource);
  const terminalAvailable=!!readyShell(lease)&&await allowed(scope,resource,'terminal');
  if(!terminalAvailable&&!await allowed(scope,resource,'inspect'))fail('managed_compute_project_grant_required');
  check();
  const result={resource_id:resource.resourceId,kind:resource.kind,service_status:resource.serviceStatus,
   terminal_available:terminalAvailable,project_access:!scope.projectId?'no_project':grant?'authorized':service?'not_granted':'unobserved',
   environment_ids:grant?.environmentIds||[],cluster_ids:grant?.clusterIds||[]};
  if(!probeScheduler)return result;
  if(!service?.schedulerInspection)return {...result,scheduler:{status:'unavailable',reason:service?'inspection_not_advertised':'service_unavailable',
   next_step:terminalAvailable?'Use the returned conversation terminal for a bounded scheduler query.':'Inspect this resource’s service in the desktop.'}};
  const response=await anchored(resource,service,'POST',schedulerInspectionPath,{},false,15000,()=>{
   check();
   if(!grant)policyCurrent();
  });
  if(!await allowed(scope,resource,'inspect'))fail('managed_compute_project_grant_required');
  check();
  if(response?.status!==200)fail('managed_compute_worker_request_failed');
  return {...result,scheduler:schedulerObservation(response.data)};
 }

 async function resolveService(scope,resourceId){
  const {lease,service,grant}=await resolveLease(scope,resourceId,'service'),resource=lease.resource;
  assertLease(scope,lease);
  if(!service||resource.service!==service)fail('managed_compute_service_changed');
  return {sourceId:service.id,resourceId:resource.resourceId,profileId:resource.profileId,kind:resource.kind,
   supportsManagedSchedules:service.health?.managed_schedule_schema===1,
   ...id(scope.projectId)&&service.health?.root?.startsWith('/')?{projectInputRoot:path.posix.join(service.health.root,'projects',scope.projectId,'inputs')}:{},...grant};
 }

 async function assertRun(scope,resource,service,runId,kind,{readOnly=false}={}){
  if(!id(runId)||kind==='run'&&resource.kind==='ssh'||kind==='cluster-run'&&resource.kind!=='ssh')fail('managed_compute_run_source_changed');
  if(authorizeRun){
   const permits=(sourceId)=>authorizeRun(scope,{sourceId,resourceId:resource.resourceId,runId,kind});
   if(await permits(service.id)===true)return;
   if(readOnly&&resource.workspaceRegistration){
    const history=selectionCatalog?.list?.(workerHistory)||[];
    for(const old of history){
     if(old.profileId!==resource.profileId||old.resourceId!==resource.workspaceRegistration.resourceId||old.root!==service.binding.root||
        !equal(old.hostIdentity,service.binding.hostIdentity)||old.sourceId===service.id||!/^[a-f0-9]{64}$/.test(old.sourceId||''))continue;
     if(await permits(old.sourceId)===true)return;
    }
   }
   fail('managed_compute_run_source_changed');
  }else if(!originalBindingMatches(taskSource(scope),service.binding))fail('managed_compute_run_source_changed');
 }

 async function runMutation(scope,lease,service,data,action,kind,check){
  const resource=lease.resource,args=data.data.params.arguments;
  exact(args,['run_id'],['run_id']);
  const runId=args.run_id,cluster=kind==='cluster-run',monitoredSubmit=cluster&&action==='submit';
  const ref={sourceId:service.id,resourceId:resource.resourceId,runId,kind,action};
  await assertRun(scope,resource,service,runId,kind);
  check();
  const intent=()=>{if(authorizeRunAction?.(scope,ref)!==true)fail('managed_compute_run_intent_required');};
  intent();
  const capability=monitoredSubmit?'managed_submit_monitor_schema':action==='cancel'?'managed_run_action_schema':null;
  const requireCapability=health=>{if(capability&&health?.[capability]!==1)fail('managed_compute_worker_update_required');};
  requireCapability(service.health);
  const runKey=JSON.stringify([service.id,runId]),attemptKey=JSON.stringify([runKey,action]);
  if(activeRunActions.has(runKey))fail('managed_compute_run_busy');
  if(dispatchedRunActions.has(attemptKey))fail('managed_compute_run_action_unconfirmed');
  activeRunActions.add(runKey);
  try{
   const grant=await projectGrant(scope,resource,{required:true});
   if(!grant)fail('managed_compute_project_grant_required');
   // Observation is passive. In particular, cluster/status can poll the
   // scheduler and cannot substitute for the current immutable worker record.
   const observation=await anchored(resource,service,'POST',cluster?'/api/cluster/observation':'/api/run/status',{run_id:runId},false,10000,check);
   check();
   const run=observation.data;
   if(observation.status!==200||run?.id!==runId||run.project_id!==scope.projectId||
      !(cluster?grant.clusterIds.includes(run.cluster_id):grant.environmentIds.includes(run.environment_id)))fail('managed_compute_run_source_changed');
   if(run.status==='unknown'||run.studio_workflow_binding||run.managed_child||run.superseded_by)fail('managed_compute_run_state_unconfirmed');
   if(action==='cancel'){
    if(!['queued','running'].includes(run.status)||run.cancel_requested||cluster&&!/^[0-9]+$/.test(run.job_id||''))fail('managed_compute_run_state_unconfirmed');
   }else if(!['draft','ready'].includes(run.status)||run.submit_attempted||run.job_id||dispatchedRunActions.has(JSON.stringify([runKey,'submit'])))fail('managed_compute_run_state_unconfirmed');
   const beforeDispatch=observed=>{
    check();intent();requireCapability(observed);
    // The worker has its own durable reservation under its Store lock. This
    // app also suppresses uncertain duplicate actions before they reach it.
    if(action!=='validate')dispatchedRunActions.add(attemptKey);
   };
   if(monitoredSubmit){
    // The worker reserves its bounded observation schedule in the same durable
    // transaction as the exact submission. Only this trusted bridge supplies it.
    const managed_monitor={schemaVersion:1,sourceId:service.id,
     scope:{provider:scope.provider,threadId:scope.threadId,taskId:scheduleOwnerId(scope),projectId:scope.projectId,runId}};
    const response=await anchored(resource,service,'POST','/api/cluster/submit',{run_id:runId,managed_monitor},false,data.timeoutMs,beforeDispatch);
    check();
    if(response.status!==200)return response;
    return {status:200,data:{jsonrpc:'2.0',id:data.data.id,result:{isError:false,content:[{type:'text',text:JSON.stringify(response.data)}]}}};
   }
   const payload=action==='cancel'?{...data.data,params:{...data.data.params,arguments:{run_id:runId,require_known:true}}}:data.data;
   const response=await anchored(resource,service,'POST','/mcp',payload,true,data.timeoutMs,beforeDispatch);
   check();
   return response;
  }finally{activeRunActions.delete(runKey);}
 }

 async function serviceRequest(scope,data){
  exact(data,['resourceId','method','target','data','mcp','timeoutMs','checkCurrent','beforeScheduleDispatch'],['resourceId','method','target']);
  const {lease,service,grant}=await resolveLease(scope,data.resourceId,'service'),resource=lease.resource;
  const check=()=>{assertLease(scope,lease);assertResourceIntent(scope,resource);data.checkCurrent?.();};
  const payload=data.data;
  if(data.method!=='POST'||!service)fail('managed_compute_private_service_unavailable');
  if(data.mcp===true){
   if(data.target!=='/mcp'||!['initialize','tools/list','tools/call'].includes(payload?.method))fail('managed_compute_invalid_request');
   if(payload.method==='tools/call'){
    const {name,arguments:args}=payload.params||{};
    if(runMutations.has(name))return runMutation(scope,lease,service,data,...runMutations.get(name),check);
    if(['prepare_run','prepare_cluster_run'].includes(name)){
     const remote=name==='prepare_cluster_run',spec=args?.spec;
     if(!grant||spec?.project_id!==scope.projectId||remote!==(resource.kind==='ssh')||
         !(remote?grant.clusterIds.includes(spec?.cluster_id):grant.environmentIds.includes(spec?.environment_id)))fail('managed_compute_project_grant_required');
    }else if(['read_log','run_status','cluster_run_status','cluster_read_log'].includes(name)){
     await assertRun(scope,resource,service,args?.run_id,name.startsWith('cluster_')?'cluster-run':'run',{readOnly:true});
    }else fail('managed_compute_invalid_request');
   }
  }else{
   if(!/^\/api\/managed-schedules\/(?:upsert|stop|status)$/.test(data.target)||payload?.sourceId!==service.id)fail('managed_compute_invalid_request');
   if(service.health?.managed_schedule_schema!==1)fail('managed_compute_worker_update_required');
   if(data.target.endsWith('/upsert')){
    if(payload.scope?.projectId!==scope.projectId||payload.scope?.taskId!==scheduleOwnerId(scope)||payload.scope?.threadId!==scope.threadId||payload.scope?.provider!==scope.provider)fail('managed_compute_project_grant_required');
    if(payload.scope.runId)await assertRun(scope,resource,service,payload.scope.runId,resource.kind==='ssh'?'cluster-run':'run');
   }else if(!authorizeSchedule||!await authorizeSchedule(scope,payload))fail('managed_compute_project_grant_required');
  }
  check();
  const beforeDispatch=health=>{
   check();
   if(data.mcp!==true&&health?.managed_schedule_schema!==1)fail('managed_compute_worker_update_required');
   if(data.mcp!==true)data.beforeScheduleDispatch?.();
  };
  const response=await anchored(resource,service,data.method,data.target,payload,data.mcp===true,data.timeoutMs,beforeDispatch);
  check();return response;
 }

 function confirmAlias(scope,data){
  exact(data,['resourceId','alias'],['resourceId']);liveScope(scope);
  intent.confirmChoice(scope,data);
 }
 function currentChoice(scope,choice){
  liveScope(scope);
  const resource=resources.get(choice.resourceId);
  return !!resource&&resource.targetFingerprint===choice.targetFingerprint&&visible(resource);
 }
 function confirmQuestionChoice(scope,data){
  liveScope(scope);
  return intent.confirmQuestionChoice(scope,data,choice=>currentChoice(scope,choice));
 }
 function bindResourceQuestion(scope,question){
  liveScope(scope);
  return intent.bindResourceQuestion(scope,question,choice=>currentChoice(scope,choice));
 }
 function capture(provider,threadId){
  const owned=[...leases.values()].filter(lease=>lease.scope.provider===provider&&lease.scope.threadId===threadId&&hasLease(lease));
  return {resources:owned.map(lease=>view(lease.resource)),assertCurrent(){
   for(const lease of owned){
    current(lease.resource);
    if(!hasLease(lease)||leases.get(lease.key)!==lease)fail('managed_compute_resource_lease_changed');
   }
  }};
 }
 function needsExplicitResource(scope,{readAliases=true}={}){
  if(!scope?.threadId)return false;
  const turn=intent.current(scope);
  if(capture(scope.provider,scope.threadId).resources.length>0)return true;
  if(!turn)return false;
  if(turn.named.length||turn.retained.length||turn.ambiguous.length)return true;
  if(readAliases){
   try{if(aliases?.list?.(()=>scope.checkCurrent?.()===true).some(alias=>requestsComputeName(turn.message,alias)))return true;}
   catch{return true;}
  }
  return !!(turn.pending||turn.answer||
   [...resources.values()].some(resource=>requestsComputeName(turn.message,normalizeComputeAlias(resource.name)))||
   /(?:用|使用|在|选择|选用|指定|切换到)[^。！？\n]{0,64}(?:集群|本地|\bwsl\b|\bssh\b)|\b(?:use|run on|choose|select)\b[^.!?\n]{0,64}\b(?:cluster|wsl|ssh|local)\b/u.test(turn.message));
 }

 async function eligibleForWake(scope,sourceId){
  liveScope(scope);
  const resource=[...resources.values()].find(item=>item.service?.id===sourceId);
  return !!resource&&await eligibleProject(scope,resource);
 }

 function remove(resource){
  if(resources.get(resource.resourceId)!==resource)return Promise.resolve([]);
  resources.delete(resource.resourceId);resource.service?.close?.();resource.service=null;
  const closing=[...leases.values()].filter(lease=>lease.resource===resource).map(retire);
  changed();return Promise.allSettled(closing);
 }
 function revokeConnection({connectionId}){
  publishing.delete(connectionId);
  return Promise.all([...resources.values()].filter(resource=>resource.connectionId===connectionId).map(remove));
 }
 function confirmConnectionClosed(connectionId){
  for(const lease of leases.values())if(lease.resource.connectionId===connectionId){cancelAcquisitions(lease.scope,lease.resource.resourceId);leases.delete(lease.key);}
  changed();
 }
 async function observe(resource){
  if(scheduledSweeps.has(resource))return scheduledSweeps.get(resource);
  const checked=(async()=>{
   try{if(resource.kind==='ssh')await checkConnection(resource);else current(resource);}
   catch(error){if(!['ssh_control_timeout','ssh_control_unavailable'].includes(error?.message))await remove(resource);return;}
   const service=resource.service;
   if(service){try{await service.verify();}catch{discardService(resource,service);if(resource.kind!=='ssh')await remove(resource);}}
  })();scheduledSweeps.set(resource,checked);
  try{await checked;}finally{scheduledSweeps.delete(resource);}
 }
 function touch(provider,threadId){
  for(const lease of leases.values())if(lease.scope.provider===provider&&lease.scope.threadId===threadId&&!lease.releasing)lease.touchedAt=now();
 }
 function forget(provider,threadId){
  intent.forget(provider,threadId);
  cancelAcquisitions({provider,threadId});
  return Promise.allSettled([...leases.values()].filter(lease=>lease.scope.provider===provider&&lease.scope.threadId===threadId).map(retire));
 }
 async function sweep({idleMs=3600000}={}){
  if(stopped)return;
  const retiring=[];
  for(const lease of leases.values()){
   if(lease.releaseUnknown)retiring.push(retire(lease));
   else if(!lease.releasing){
    const terminal=lease.terminal;
    if(!busy(lease.scope)&&now()-lease.touchedAt>=idleMs)retiring.push(retire(lease));
    else if(terminal?.closeUnknown||!busy(lease.scope)&&terminal?.shell&&now()>=terminal.shell.expiresAt)retiring.push(closeTerminal(lease,terminal,{retry:true}));
   }
  }
  await Promise.allSettled([...retiring,...[...resources.values()].map(observe)]);
 }
 function stop(){
  stopped=true;publishing.clear();intent.clear();
  return Promise.allSettled([...resources.values()].map(remove));
 }
 const owns=name=>tools.some(tool=>tool.name===name);
 function callTool(name,args,scope){
  if(name==='list_compute_resources'){exact(args,[]);return list(scope);}
  if(name==='acquire_compute_resource'){
   exact(args,['resource_id','profile_id','alias','access']);
   return acquire(scope,Object.fromEntries(Object.entries(args).map(([key,value])=>[{resource_id:'resourceId',profile_id:'profileId'}[key]??key,value])));
  }
  if(name==='release_compute_resource'){exact(args,['resource_id'],['resource_id']);return release(scope,{resourceId:args.resource_id});}
  return callTerminalTool(name,args,scope);
 }
 return {publish,publishWsl,configureService,serviceStatus,updateService,snapshot,list,acquire,release,resolveLease,resolveSkillLibrary,resolveService,inspectService,capture,needsExplicitResource,callTerminalTool,callTool,owns,tools:()=>tools,
  terminalTools:()=>terminalTools,serviceRequest,listSources,eligibleProject,eligibleForWake,refreshService,revokeConnection,confirmConnectionClosed,confirmAlias,confirmQuestionChoice,bindResourceQuestion,endDeveloperAccess,isDeveloperWorkspace,
  recordUserTurn,sweep,stop,touch,forget,consoleEntries,observeConsoleLease,observeConsoleService,releaseFromConsole,detachLocalFromConsole};
}
