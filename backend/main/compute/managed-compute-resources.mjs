import {randomUUID} from 'node:crypto';
import {schedulerInspectionPath,schedulerObservation} from '../../../contracts/compute/scheduler-observation.mjs';
import {scheduleOwnerId} from '../../../desktop/platform/schedule-owner.mjs';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
import {terminalToolInput,sharedTerminalTools} from './shared-terminal.mjs';
import {managedWorkerProject,originalBindingMatches} from './managed-compute-services.mjs';
import {normalizeComputeAlias,resourceFingerprint} from './managed-compute-aliases.mjs';
import {createManagedComputeIntent,genericComputeKind,requestsComputeName,canAskForResource,namesInChat} from './managed-compute-intent.mjs';
import {MANAGED_SSH_SHELL_CAPACITY} from '../../../desktop/platform/terminal-service/managed-ssh-shells.mjs';
import {safeSshServiceError,safeSshServicePhase,safeSshServiceProgress} from './ssh-service-state.mjs';
import {createManagedSshHosting,hostedLeaseKey,sameHostedTarget} from './managed-ssh-hosting.mjs';
import {stableSshWorkerBinding} from '../../../contracts/compute/task-worker-binding.mjs';
import {sshSourceId} from './worker-service-version.mjs';
import {workerRunOperationFailure} from '../../../contracts/compute/run-operation-receipt.mjs';

const rejectedBeforeDispatch=new Set(['managed_compute_invalid_request','managed_compute_user_instruction_required',
 'managed_compute_no_eligible_resource','managed_compute_resource_lease_required','managed_compute_resource_choice_required',
 'managed_compute_resource_project_changed',
 'managed_compute_project_grant_required','managed_compute_terminal_not_supported','managed_compute_command_not_supported']);
const fail=code=>{throw Object.assign(Error(code),rejectedBeforeDispatch.has(code)?{operationNotStarted:true}:{});};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const string={type:'string',minLength:1,maxLength:128};
const leaseKey=(scope,resourceId)=>JSON.stringify([scope.provider,scope.threadId,resourceId]);
const ownerOf=scope=>({provider:scope.provider,threadId:scope.threadId});
const projectOf=scope=>scope.projectId??null;
const sourceFailure=code=>['managed_compute_service_changed','ssh_authentication_unconfirmed','ssh_connection_changed','ssh_connection_not_found','terminal_unavailable','terminal_service_changed','terminal_service_unknown','terminal_service_unavailable','terminal_service_failed'].includes(code);
const projectObservationFailure=code=>['managed_compute_project_authentication_failed','managed_compute_project_observation_failed','managed_compute_project_receipt_invalid'].includes(code);
const terminalGone=code=>['terminal_session_exited','terminal_saved_connection_changed','ssh_authentication_unconfirmed','ssh_connection_changed','ssh_connection_not_found'].includes(code);
const terminalFailureCodes=new Set(['managed_compute_project_grant_required','managed_compute_terminal_not_supported','terminal_session_limit',
 'terminal_session_exited','terminal_unavailable','terminal_start_failed','ssh_channel_unavailable','ssh_shell_readiness_timeout',
 'ssh_shell_interaction_required','ssh_channel_refused','ssh_remote_terminal_unavailable','ssh_master_unavailable','ssh_authentication_unconfirmed','ssh_connection_changed','ssh_connection_not_found',
 'terminal_saved_connection_changed','terminal_service_active','terminal_service_unknown']);
const isAuthenticated=value=>value?.status==='authenticated'&&value.authentication==='verified'&&value.capabilities?.multiplex===true;
const resourceRef=resource=>({connectionId:resource.connectionId,profileId:resource.profileId,profileVersion:resource.profileVersion});
const shellAccess=access=>access==='terminal'||access==='command';
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
 tool('list_compute_resources','List resources hosted by AIMatterLab. A listed SSH resource is authenticated. commandAvailable describes its scoped command entry; canAcquire describes conversation access. Acquire the needed capability before using the resource.',{},[],true),
 tool('acquire_compute_resource','Acquire the requested capability for this conversation. Use one selector: resource_id, profile_id, or the alias the human used. For SSH, command is the default where available, terminal opens an interactive channel, and service uses the registered worker. In a live chat, an unresolved target opens the AIMatterLab resource picker. Follow target_selected.retry after the user chooses. An ordinary chat can acquire access with the user’s delegation.',{resource_id:string,profile_id:string,alias:string,access:{type:'string',enum:['command','terminal','service']}}),
 tool('run_compute_command','Run one delegated command or batch on the acquired SSH command lease. Returns output, exit_code, cwd, and job_id when observed. Use an unchanged request_id when checking or retrying the same command. Reconcile an unconfirmed operation before sending a new request. A standalone cd updates only this conversation’s command directory. Environment changes apply to the current batch. Protected operations use desktop review. When present, approval_status distinguishes an explicit denial (denied), an expired review (expired), and a changed review context (changed). Prefer the worker for tracked workflows and jobs.',{
  resource_id:string,request_id:string,command:{type:'string',minLength:1,maxLength:8192}
 },['resource_id','request_id','command']),
 tool('release_compute_resource','Release this conversation’s command, terminal and service lease on this resource.',{resource_id:string},['resource_id']),
 ...terminalTools,
]);

/** App-owned active resources, independent of every renderer selection. `publish`,
 * `publishWsl`, `confirmAlias` and `recordUserTurn` are trusted desktop entry points. */
export function createManagedComputeResources({terminal,profiles,aliases,services,selectionCatalog,taskSource=()=>null,restoreOwner,
 authorizeTerminal=()=>false,authorizeSchedule,authorizeRun,authorizeRunAction, onAcquired=()=>{},onChange=()=>{},
 onConnectionLost=()=>{},onConnectionReplaced=()=>{},resourceWorkspace,serviceRegistration,terminalAuthorization,developerCompute,
 terminalPolicyRevision=()=>0,busy=()=>false,now=Date.now,uuid=randomUUID}){
 const resources=new Map(),leases=new Map(),publishing=new Map(),scheduledSweeps=new Map(),pendingAcquisitions=new Set();
 const loginStarts=new Map(),recoveryCandidates=new Map();
 const activeRunActions=new Set(),dispatchedRunActions=new Set();
 const connections=terminal.connections,intent=createManagedComputeIntent(selectionCatalog),hosting=createManagedSshHosting(selectionCatalog);
 let stopped=false;

 function liveScope(scope){
  if(stopped||!scope||typeof scope.provider!=='string'||!scope.provider||scope.provider.length>80||typeof scope.threadId!=='string'||!scope.threadId||scope.threadId.length>200||scope.checkCurrent?.()!==true)fail('managed_compute_context_changed');
 }
 function current(resource,{observe=false}={}){
  if(stopped||resources.get(resource.resourceId)!==resource)fail('managed_compute_resource_unavailable');
  const latest=profiles.read({id:resource.profileId});
  if(latest?.version!==resource.profileVersion||resourceFingerprint(latest)!==resource.targetFingerprint)fail('managed_compute_profile_changed');
  if(resource.unconfirmed&&!observe)fail('managed_compute_resource_unavailable');
 }
 const saved=(resource,options)=>{try{current(resource,options);return true;}catch{return false;}};
 const visible=resource=>saved(resource)&&(resource.kind==='ssh'||resource.serviceStatus==='ready');
 const commandAvailable=resource=>resource.kind==='ssh'&&!!resource.workspaceRegistration&&typeof terminalAuthorization?.execute==='function';
 const defaultAccess=resource=>resource.kind==='ssh'?(commandAvailable(resource)?'command':'terminal'):'service';
 const readyShell=lease=>{
  const terminal=lease?.terminal;
  return terminal?.shell&&!terminal.closing&&!terminal.observationUnknown&&terminal.shell.expiresAt>now()?terminal.shell:null;
 };
 const hasLease=lease=>!!(lease&&!lease.releasing&&saved(lease.resource)&&(lease.command||lease.service&&lease.service===lease.resource.service||readyShell(lease)));
 const count=resource=>[...leases.values()].filter(lease=>lease.resource===resource&&lease.terminal).length;
 const view=resource=>({...candidate(resource),profileVersion:resource.profileVersion,available:resource.kind==='ssh'||resource.serviceStatus==='ready',
  serviceStatus:resource.serviceStatus,...commandAvailable(resource)?{commandAvailable:true}:{},
  ...resource.kind==='ssh'?{terminalCapacity:MANAGED_SSH_SHELL_CAPACITY,terminalAvailable:Math.max(0,MANAGED_SSH_SHELL_CAPACITY-count(resource))}:{}});
 // The desktop verifies the exact authenticated connection. Agent tools use the resource ID.
 function desktopView(resource){
  const entry=view(resource);
  return resource.kind==='ssh'?{...entry,connectionId:resource.connectionId,
   ...resource.workspaceRegistration?{workspace:resourceWorkspace.publicWorkspace(resource.workspaceRegistration)}:{}}:entry;
 }
 function snapshot(){
  return [...resources.values()].filter(resource=>visible(resource)||resource.unconfirmed&&saved(resource,{observe:true}))
   .map(resource=>resource.unconfirmed?{...desktopView(resource),available:false,verificationPending:true}:desktopView(resource));
 }
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
   const retained=retainedLease(scope,resource);
   const continues=grant=>grant?.authority==='conversation'&&grantScopeMatches(scope,grant);
   const continued=continues(retained?.terminal)||continues(retained?.command)||continues(retained?.service)&&retained.service.sourceId===resource.service?.id||
    intent.continuesChannel(scope,resource,'terminal')||intent.continuesChannel(scope,resource,'command')||!!resource.service&&intent.continuesChannel(scope,resource,'service')||
    legacyRenewal(scope,resource);
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

 async function connectionState(ref){
  let state;
  try{state=await connections.state({connectionId:ref.connectionId});}
  catch(error){if(error.message==='ssh_connection_not_found')return 'lost';throw error;}
  if(!equal(resourceRef(state??{}),resourceRef(ref)))return 'unknown';
  if(['ssh_control_timeout','ssh_control_unavailable'].includes(state.error?.code))return 'unknown';
  if(isAuthenticated(state))return 'authenticated';
  if(state.status==='closed'&&state.closed===true||state.status==='unavailable'&&state.authentication==='lost'&&state.closed!==false)return 'lost';
  return 'unknown';
 }
 async function checkConnection(resource,{observe=false}={}){
  current(resource,{observe});
  const state=await connectionState(resource);
  current(resource,{observe});
  if(observe)return state;
  if(state!=='authenticated')fail('managed_compute_resource_unavailable');
 }

 function prepareService(resource,{configure=false,repairMaintenance=false,upgrade,existingOnly=false}={}){
  if(!services||resource.preparing)return resource.preparing;
  if(resource.service&&!upgrade)return Promise.resolve(resource.service);
  const original=resource.service;
  const priorSetup=resource.kind==='ssh'&&(configure||repairMaintenance)?serviceRegistration?.read({profileId:resource.profileId,profileVersion:resource.profileVersion}):null;
  if(upgrade)resource.service=null;
  resource.serviceStatus='preparing';
  const fresh=()=>current(resource);
  const preparation=Promise.resolve().then(async()=>{
   try{
    const service=await (resource.kind==='ssh'?services.ssh(resource,resource.profile,fresh,{configure,repairMaintenance,upgrade,existingOnly}):services.wsl(resource,resource.receipt,fresh));
    try{fresh();}catch(error){service.close?.();throw error;}
    if(resource.kind==='ssh'&&priorSetup?.registration&&resource.workspaceRegistration&&selectionCatalog?.put&&priorSetup.registration.runtimeId!==service.health?.runtimeId){
     try{
      const priorBinding=stableSshWorkerBinding({kind:'ssh',profileId:resource.profileId,profileVersion:resource.profileVersion,...priorSetup.registration});
      const priorId=sshSourceId(priorBinding);
      selectionCatalog.put(workerHistory,priorId,{sourceId:priorId,profileId:resource.profileId,
       resourceId:resource.workspaceRegistration.resourceId,root:priorBinding.root,hostIdentity:priorBinding.hostIdentity});
     }catch{}
    }
    resource.service=service;resource.serviceStatus='ready';delete resource.serviceError;
    return service;
   }catch(error){
    if(resources.get(resource.resourceId)===resource){
     if(upgrade&&original){
      try{await original.verify();fresh();resource.service=original;resource.serviceStatus='ready';return original;}
      catch{/* Preserve the actual unconfirmed or failed remote state. */}
     }
     resource.serviceStatus=['ssh_service_registration_required','ssh_service_maintenance_required','ssh_service_registration_identity_changed'].includes(error.message)?'configuration_required':'unavailable';
     resource.serviceError=['ssh_service_registration_required','ssh_service_maintenance_required','ssh_service_registration_identity_changed','managed_compute_service_changed','terminal_service_active','terminal_service_unknown','ssh_authentication_unconfirmed'].includes(error.message)?error.message:'managed_compute_private_service_unavailable';
    }
    return null;
   }finally{
    if(resource.preparing===preparation)resource.preparing=null;
    changed();
    if(resource.pendingRecovery&&resource.service)void recoverLeases(resource);
   }
  });
  resource.preparing=preparation;changed();return preparation;
 }

 function priorServiceSource(resource,setup){
  const {profile,workspaceRegistration:workspace}=resource,saved=setup?.registration;
  if(setup?.status!=='configured'||saved?.configuredAtProfileVersion!==profile.version||!workspace||
     workspace.account!==profile.username||!equal(saved.hostIdentity,workspace.hostIdentity))return undefined;
  try{return sshSourceId(stableSshWorkerBinding({kind:'ssh',profileId:profile.id,profileVersion:profile.version,...saved}));}
  catch{return undefined;}
 }

 async function publish(data,{restore=false}={}){
  exact(data,['connectionId','profileId','profileVersion'],['connectionId','profileId','profileVersion']);
  if(stopped||!id(data.connectionId)||!id(data.profileId)||!Number.isSafeInteger(data.profileVersion)||data.profileVersion<1)fail('managed_compute_invalid_request');
  const hosted=hosting.get(data.profileId),resourceId='ssh:'+data.profileId;
  if(restore&&(!hosted||hosted.profileVersion!==data.profileVersion))return null;
  if(hosted?.previousConnections.includes(data.connectionId))fail('managed_compute_resource_unavailable');
  const before=publishing.get(data.connectionId);
  if(before){
   if(!equal(before.data,data))fail('managed_compute_profile_changed');
   try{const result=await before.result;if(result||restore||!before.restore)return result;}
   catch(error){if(restore||!before.restore)throw error;}
   return publish(data);
  }
  const publication={data:structuredClone(data),restore,result:null};
  publishing.set(data.connectionId,publication);
  publication.result=(async()=>{
   const profile=profiles.read({id:data.profileId});
   if(profile.kind!=='ssh'||profile.version!==data.profileVersion)fail('managed_compute_profile_changed');
   const previous=resources.get(resourceId);
   const checkPublication=()=>{
    if(stopped||publishing.get(data.connectionId)!==publication||!equal(profile,profiles.read({id:profile.id})))fail('managed_compute_profile_changed');
    const active=resources.get(resourceId);
    if(hosting.get(data.profileId)!==hosted||active&&active!==previous)fail('managed_compute_profile_already_published');
   };
   if(await connectionState(data)!=='authenticated')fail('managed_compute_authentication_required');
   checkPublication();
   const prior=previous??hosted, replacing=prior&&prior.connectionId!==data.connectionId;
   if(replacing){
    const state=await connectionState(prior);
    if(state==='authenticated')fail('managed_compute_profile_already_published');
    if(state!=='lost')fail('managed_compute_recovery_pending');
   }
   checkPublication();
   const workspaceRegistration=await resourceWorkspace?.assertHandoff(data,checkPublication);
   checkPublication();
   const resource={...data,resourceId,profile,kind:'ssh',name:profile.name,targetFingerprint:resourceFingerprint(profile),serviceStatus:'idle',workspaceRegistration};
   const inherits=sameHostedTarget(hosted,resource);
   if(restore&&!inherits)return null;
   const previousSetup=workspaceRegistration&&serviceRegistration?.read({profileId:profile.id,profileVersion:profile.version});
   if(!hosted)resource.legacySourceId=priorServiceSource(resource,previousSetup);
   if(previous&&!replacing&&equal(resourceRef(previous),data)&&(!hosted||inherits)){
    previous.unconfirmed=false;
    if(workspaceRegistration)previous.workspaceRegistration=workspaceRegistration;
    previous.hosting??=hosting.replace(previous);
    if(previous.pendingRecovery)void recoverLeases(previous);
    changed();return desktopView(previous);
   }
   resource.hosting=hosting.replace(resource,inherits?hosted:undefined);
   if(hosted&&!resource.hosting)hosting.forget(hosted);
   if(previous)void remove(previous,{preserve:inherits,detach:true});
   const configure=!inherits&&(previousSetup?.status==='unconfigured'||previousSetup?.reason==='configuration_changed');
   resource.pendingRecovery=inherits&&!!Object.keys(hosted.leases).length;
   resources.set(resourceId,resource);
   if(replacing){
    onConnectionLost(prior.connectionId);
    if(inherits)onConnectionReplaced(resourceRef(prior),resourceRef(resource));
   }
   changed();prepareService(resource,{configure});
   if(resource.pendingRecovery)void recoverLeases(resource);
   return desktopView(resource);
  })();
  try{return await publication.result;}finally{if(publishing.get(data.connectionId)===publication)publishing.delete(data.connectionId);}
 }

 function noteLogin({profileId,profileVersion,requestId}){
  if(!loginStarts.has(requestId)){
   loginStarts.set(requestId,{profileId,profileVersion,hosted:hosting.get(profileId)});
   if(loginStarts.size>256)loginStarts.delete(loginStarts.keys().next().value);
  }
 }
 async function restoreHosted(data,loginRequestId){
  const record=hosting.get(data.profileId),start=loginStarts.get(loginRequestId);
  if(!record||record.profileVersion!==data.profileVersion||start&&
     (start.profileId!==data.profileId||start.profileVersion!==data.profileVersion||start.hosted!==record&&record.connectionId!==data.connectionId))return null;
  const active=resources.get('ssh:'+data.profileId);
  if(active?.connectionId===data.connectionId&&saved(active))return desktopView(active);
  try{
   const result=await publish(data,{restore:true});
   recoveryCandidates.delete(data.connectionId);return result;
  }catch(error){
   if(hosting.get(data.profileId)===record&&['managed_compute_recovery_pending','terminal_unavailable','ssh_control_timeout','ssh_workspace_unconfirmed'].includes(error.message)){
    recoveryCandidates.set(data.connectionId,{data,loginRequestId,record});
   }else recoveryCandidates.delete(data.connectionId);
   return null;
  }
 }
 function restorePublished(){return Promise.allSettled(hosting.list().map(record=>restoreHosted(resourceRef(record))));}

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

 async function refreshService({connectionId,existingOnly=false}){
  const resource=[...resources.values()].find(item=>item.connectionId===connectionId);
  if(!resource||stopped||!saved(resource))return null;
  const existing=resource.service;
  if(existing){
   try{await existing.verify();return existing;}
   catch(error){
    if(resource.kind==='ssh'&&error?.message==='ssh_control_timeout')return null;
    discardService(resource,existing);
   }
  }
  return prepareService(resource,{existingOnly});
 }

 async function configureService(data){
  exact(data,['connectionId','profileId','profileVersion'],['connectionId','profileId','profileVersion']);
  const resource=resources.get('ssh:'+data.profileId);
  if(!resource||!equal(data,resourceRef(resource)))fail('managed_compute_resource_unavailable');
  await checkConnection(resource);
  if(resourceWorkspace)resource.workspaceRegistration=await resourceWorkspace.assertHandoff(data,()=>current(resource));
  if(resource.preparing)await resource.preparing;
  current(resource);
  if(!resource.service&&!await prepareService(resource,{configure:true,repairMaintenance:true}))fail(resource.serviceError||'managed_compute_private_service_unavailable');
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
   if(!required&&(sourceFailure(error.message)||projectObservationFailure(error.message)))return null;
   throw error;
  }
 }
 const eligibleProject=async(scope,resource,options)=>!!await projectGrant(scope,resource,options);
 function retainedLease(scope,resource){
  const lease=resource.hosting?.leases[hostedLeaseKey(scope)];
  return lease?.projectId===projectOf(scope)?lease:null;
 }
 function grantScopeMatches(scope,grant){
  return grant.taskId===null||grant.taskId===(scope.taskId??null);
 }
 function legacyRenewal(scope,resource){
  if(scope.projectId||!resource.service||resource.hosting?.legacySourceId!==resource.service.id)return false;
  const turn=intent.current(scope),selection=turn?.selection;
  if(!turn?.renewLease||turn.pending||turn.projectId!==null||turn.taskId!==(scope.taskId??null)||
     selection?.projectId!==null||selection.taskId!=null&&selection.taskId!==turn.taskId||turn.retained.length!==1)return false;
  const target=turn.retained[0];
  if(target.resourceId!==resource.resourceId||target.targetFingerprint!==resource.targetFingerprint)return false;
  const original=taskSource(scope);
  if(original&&!originalBindingMatches(original,resource.service.binding))return false;
  const previous=selectionCatalog?.get?.('conversation-compute-history',hostedLeaseKey(scope));
  return previous?.provider===scope.provider&&previous.threadId===scope.threadId&&
   Array.isArray(previous.profileIds)&&previous.profileIds.includes(resource.profileId);
 }
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
   if(lease.developerWorkspaceId===workspaceId){void retire(lease,{preserve:true});continue;}
   if(lease.developerServiceWorkspace===workspaceId){lease.service=null;delete lease.developerServiceWorkspace;}
   if(lease.developerCommandWorkspace===workspaceId){lease.command=false;delete lease.developerCommandWorkspace;}
   if(lease.terminal?.developerWorkspaceId===workspaceId)void closeTerminal(lease,lease.terminal);
   removeUnused(lease);
  }
 }
 function assertResourceIntent(scope,resource){
  if(!intent.permitsUse(scope,resource))fail('managed_compute_user_instruction_required');
 }
 async function authorization(scope,resource,action,{choosing=false,acquiring=false}={}){
  liveScope(scope);current(resource);
  if(!choosing)assertResourceIntent(scope,resource);
  const policyCurrent=terminalPolicyGuard(scope,resource);
  const terminal=resource.kind==='ssh'?await authorizeTerminal(scope,resource):false;
  const terminalRequest=shellAccess(action);
  if(terminalRequest&&resource.kind!=='ssh')return null;
  if(action==='command'&&!commandAvailable(resource))return null;
  const retained=!choosing&&retainedLease(scope,resource);
  const lease=conversationLease(scope,resource);
  let savedGrant=action==='inspect'?retained?.service??(lease?.command?retained?.command:readyShell(lease)?retained?.terminal:null):retained?.[action];
  if(acquiring&&savedGrant?.sourceId&&savedGrant.sourceId!==resource.service?.id)savedGrant=null;
  const priorTerminal=intent.continuesChannel(scope,resource,'terminal');
  const priorCommand=intent.continuesChannel(scope,resource,'command');
  const priorService=intent.continuesChannel(scope,resource,'service');
  const existingInspection=action==='inspect'&&(priorService||priorCommand&&lease?.command||priorTerminal&&!!readyShell(lease));
  const chatAccess=terminal!=='denied'&&(terminalRequest?priorTerminal||action==='command'&&priorCommand:
   existingInspection||!!resource.service&&(!scope.taskId||priorService));
  const canCheckProject=terminalRequest?terminal!=='denied':!!resource.service;
  const projectObservation={required:!choosing&&!!resource.service};
  let authority=null;
  if(savedGrant){
   if(grantScopeMatches(scope,savedGrant)&&(!savedGrant.sourceId||savedGrant.sourceId===resource.service?.id)){
    const mode=savedGrant.authority;
    if(mode==='conversation'&&terminal!=='denied'||mode==='desktop-project'&&terminal===true||
       mode==='worker-project'&&canCheckProject&&await eligibleProject(scope,resource,projectObservation))authority=mode;
   }
  }else if(chatAccess||terminal!=='denied'&&legacyRenewal(scope,resource)||terminal===true&&!scope.taskId)authority='conversation';
  else if(terminal===true)authority='desktop-project';
  else if(terminal!=='denied'&&developerAccess(scope,resource))authority='developer';
  else if(canCheckProject&&await eligibleProject(scope,resource,projectObservation))authority='worker-project';
  liveScope(scope);current(resource);
  policyCurrent();
  if(!choosing)assertResourceIntent(scope,resource);
  return authority;
 }
 const allowed=async(...args)=>!!await authorization(...args);

 function rememberChannel(scope,lease,access,authority){
  const {resource}=lease,record=resource.hosting;
  if(!record||authority==='developer'||lease.developerWorkspaceId||
     (access==='terminal'?lease.terminal?.developerWorkspaceId:access==='command'?lease.developerCommandWorkspace:lease.developerServiceWorkspace))return;
  const previous=retainedLease(scope,resource);
  const proof={authority,taskId:previous?.[access]?previous[access].taskId:(scope.taskId??null)};
  if(access==='service')proof.sourceId=lease.service?.id;
  if(access==='terminal')Object.assign(proof,{connectionId:resource.connectionId,channelLeaseId:lease.terminal.id});
  hosting.setLease(record,scope,{...previous,...lease.scope,id:lease.id,projectId:lease.projectId,[access]:proof});
 }
 function clearRetainedChannel(lease,access){
  const {resource,scope}=lease;
  const previous=resource.hosting?.leases[hostedLeaseKey(scope)];
  if(previous?.id!==lease.id)return;
  const next={...previous};delete next[access];
  hosting.setLease(resource.hosting,scope,next);
 }

 async function availableChoices(scope,kind,access){
  const excluded=new Set(intent.current(scope)?.excluded.map(item=>item.resourceId));
  const tested=await Promise.all([...resources.values()].filter(resource=>(!kind||resource.kind===kind)&&visible(resource)&&!excluded.has(resource.resourceId)).map(async resource=>{
   const requested=access??defaultAccess(resource);
   if(requested==='service'&&!resource.service||shellAccess(requested)&&resource.kind!=='ssh'||requested==='command'&&!commandAvailable(resource))return null;
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
 function selectedTarget(resource,access){
  return {choice:{status:'target_selected',resource:candidate(resource),retry:{resource_id:resource.resourceId,...access?{access}:{}}}};
 }
 function proposedTarget(turn,proposal,eligible,access){
  if(turn.answer)return selectedTarget(turn.answer.choice,access);
  const candidates=offeredChoices(proposal,eligible);
  if(!candidates.length)fail('managed_compute_no_eligible_resource');
  return {choice:{status:'choice_required',...proposal.alias?{alias:proposal.alias}:{},candidates}};
 }
 async function choose(scope,args,access){
  const alias=args.alias===undefined?null:normalizeComputeAlias(args.alias);
  if(args.alias!==undefined&&!alias)fail('managed_compute_invalid_request');
  const saved=alias&&!genericComputeKind(alias)?aliasEntry(alias,scope):null;
  let resource=findResource(args,alias,saved);
  // Previously acquired exact leases survive later turns and navigation.
  const retained=resource&&retainedLease(scope,resource)?.[access??defaultAccess(resource)];
  const held=resource&&(hasLease(conversationLease(scope,resource))||retained&&grantScopeMatches(scope,retained));
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
   return selectedTarget(chosen,access);
  }
  if(turn.pending){
   const choices=await availableChoices(scope,undefined,access);
   intent.assertTurn(scope,turn);
   return proposedTarget(turn,turn.pending,choices,access);
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
   if(turn.answer)return selectedTarget(turn.answer.choice,access);
   const offered=offeredChoices({candidates:[...named,...turn.ambiguous]},choices);
   if(!offered.length)fail('managed_compute_choice_changed');
   if(named.length===1&&!turn.ambiguous.length){
    return selectedTarget(offered[0],access);
   }
   return {choice:{status:'choice_required',candidates:offered}};
  }
  if(held)return {resource};
  if((args.resourceId||args.profileId)&&developerAccess(scope,resource))return {resource,turn};
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
   if(!canAskForResource(turn.message,turn.discovered))fail('managed_compute_user_instruction_required');
   const alternatives=await availableChoices(scope,resource?.kind,access);
   intent.assertTurn(scope,turn);
   if(!alternatives.length)fail('managed_compute_no_eligible_resource');
   const proposal=intent.propose(scope,turn,{alias:null,save:false,candidates:alternatives.map(row=>({...candidate(row),targetFingerprint:row.targetFingerprint}))});
   return proposedTarget(turn,proposal,alternatives,access);
  }
  const kind=genericComputeKind(requested);
  // A known alias is never interpreted as a different running connection when
  // its original profile is merely offline.
  if(saved&&!resource&&![...resources.values()].some(row=>row.profileId===saved.profileId))fail('managed_compute_resource_unavailable');
  const choices=await availableChoices(scope,kind,access);
  intent.assertTurn(scope,turn);
  if(turn.pending)return proposedTarget(turn,turn.pending,choices,access);
  if(kind&&choices.length===1&&(!resource||choices[0]===resource))return {resource:choices[0],turn};
  if(!choices.length)fail('managed_compute_no_eligible_resource');
  const proposal=intent.propose(scope,turn,{alias:requested,previous:saved,save:!kind&&!!alias,
   candidates:choices.map(row=>({...candidate(row),targetFingerprint:row.targetFingerprint}))});
  return proposedTarget(turn,proposal,choices,access);
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
  if(!lease.service&&!lease.terminal&&!lease.command&&leases.get(lease.key)===lease)leases.delete(lease.key);
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
 function retire(lease,{preserve=false}={}){
  if(!preserve){
   const {resource,scope}=lease;
   if(resource.hosting?.leases[hostedLeaseKey(scope)]?.id===lease.id)hosting.setLease(resource.hosting,scope,null);
  }
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

 async function verifiedService(scope,resource,check,{acquiring=false}={}){
  const service=resource.service;
  if(!service)fail(resource.serviceError||'managed_compute_private_service_unavailable');
  const policyCurrent=terminalPolicyGuard(scope,resource);
  const fresh=()=>{check();policyCurrent();if(resource.service!==service)fail('managed_compute_service_changed');};
  fresh();
  if(!await allowed(scope,resource,'service',{acquiring}))fail('managed_compute_project_grant_required');
  fresh();
  try{await service.verify();}catch(error){if(sourceFailure(error.message))discardService(resource,service);throw error;}
  fresh();
  const authority=await authorization(scope,resource,'service',{acquiring});
  if(!authority)fail('managed_compute_project_grant_required');
  fresh();return {service,authority};
 }
 function rememberSelection(scope,lease,answer,check){
  if(answer?.proposal.save&&aliases)aliases.remember(answer.proposal.alias,lease.resource,answer.proposal.previous,()=>{
   try{assertLease(scope,lease);check();return true;}catch{return false;}
  });
  check();if(!developerAccess(scope,lease.resource))intent.acquired(scope,lease.resource);
 }
 function createLease(scope,resource,id=uuid()){
  const key=leaseKey(scope,resource.resourceId);
   const lease={id,key,scope:ownerOf(scope),projectId:projectOf(scope),resource,touchedAt:now(),service:null,terminal:null,command:false,releasing:null};
  leases.set(key,lease);return lease;
 }
 function startTerminal(scope,lease,answer,check,{restore=false}={}){
  const terminal={id:uuid(),shell:null,opening:null,closing:null,dispatched:false,closeUnknown:false};
  if(!restore&&developerAccess(scope,lease.resource)&&!retainedLease(scope,lease.resource)?.terminal)terminal.developerWorkspaceId=lease.resource.workspaceRegistration.workspaceId;
  lease.terminal=terminal;
  const fresh=()=>{
   assertLease(scope,lease);check();
   if(terminal.closing||lease.terminal!==terminal)fail('managed_compute_resource_lease_changed');
  };
  terminal.opening=Promise.resolve().then(async()=>{
   try{
    fresh();
    const remembered=retainedLease(scope,lease.resource)?.terminal;
    let state;
    if(remembered?.connectionId===lease.resource.connectionId){
     const original={...terminal,id:remembered.channelLeaseId};
     try{state=await connections.managedShell('state',shellRef(lease,original));}
     catch(error){if(error.message!=='terminal_session_exited')throw error;}
     if(state?.alive){terminal.id=original.id;terminal.dispatched=true;}
    }
    fresh();
    if(!state?.alive){
     terminal.dispatched=true;
     state=await connections.managedShell('open',shellRef(lease,terminal));
    }
    if(state?.alive!==true)fail('terminal_session_exited');
    fresh();
    const authority=await authorization(scope,lease.resource,'terminal');
    if(!authority)fail('managed_compute_project_grant_required');
    fresh();
    if(!restore)rememberSelection(scope,lease,answer,check);
    rememberChannel(scope,lease,'terminal',authority);
    terminal.shell=state;lease.touchedAt=now();
    if(!restore&&!terminal.developerWorkspaceId)onAcquired(scope,view(lease.resource));
   }catch(error){
    const closed=await closeTerminal(lease,terminal);
    if(terminal.dispatched&&terminalFailureCodes.has(error.message))throw Object.assign(Error(error.message),{terminalCleanup:closed?'confirmed':'unconfirmed'});
    throw error;
   }
   finally{terminal.opening=null;changed();}
  });
  changed();return terminal.opening;
 }

 function recoverLeases(resource){
  if(!resource.pendingRecovery||resource.recovering)return resource.recovering;
  const record=resource.hosting;
  const recovery=Promise.resolve().then(async()=>{
   if(!saved(resource)||hosting.get(record.profileId)!==record)return;
   const restore=async row=>{
    const owner=restoreOwner?.(row);
    if(!owner||!equal(ownerOf(owner),ownerOf(row))||projectOf(owner)!==row.projectId)return;
    const expected=access=>row[access]&&grantScopeMatches(owner,row[access]);
    if(!expected('terminal')&&!expected('service')&&!expected('command'))return;
    const check=()=>{
     current(resource);
     const retained=record.leases[hostedLeaseKey(row)];
     if(hosting.get(record.profileId)!==record||retained?.id!==row.id||retained.projectId!==row.projectId||
        ['terminal','service','command'].some(access=>row[access]&&(row[access].authority!==retained[access]?.authority||
         row[access].taskId!==retained[access]?.taskId||row[access].sourceId!==retained[access]?.sourceId))||
        !equal(restoreOwner?.(row),owner))fail('managed_compute_context_changed');
     const active=resourceWorkspace.resolveHostedResourceWorkspace?.(record.workspace.resourceId,
      {profileId:record.profileId,hostIdentity:record.workspace.hostIdentity});
     if(resourceWorkspace.resolveHostedResourceWorkspace&&(!active||!sameHostedTarget(record,{...resource,workspaceRegistration:active})))fail('ssh_workspace_changed');
    };
    const scope={...owner,checkCurrent:()=>{try{check();return true;}catch{return false;}}};
    const channels=async(access,use)=>{
     if(!expected(access))return;
     check();
     const key=leaseKey(scope,resource.resourceId),previous=leases.get(key);
     if(previous&&(previous.id!==row.id||previous.resource!==resource||previous.releasing))return;
     await use(previous,()=>leases.get(key)??createLease(scope,resource,row.id));
    };
    await Promise.allSettled([
     channels('command',async(previous,allocate)=>{
      if(previous?.command||!await allowed(scope,resource,'command'))return;
      check();
      const lease=allocate();
      assertLease(scope,lease);lease.command=true;lease.touchedAt=now();changed();
     }),
     channels('terminal',async(previous,allocate)=>{
      if(previous?.terminal||!await allowed(scope,resource,'terminal'))return;
      check();
      const lease=leases.get(leaseKey(scope,resource.resourceId));
      if(lease?.terminal||count(resource)>=MANAGED_SSH_SHELL_CAPACITY)return;
      await startTerminal(scope,allocate(),null,check,{restore:true});
     }),
     channels('service',async(previous,allocate)=>{
      if(previous?.service===resource.service||!resource.service)return;
      const {service}=await verifiedService(scope,resource,check);
      check();
      const lease=allocate();
      assertLease(scope,lease);lease.service=service;lease.touchedAt=now();changed();
     }),
    ]);
   };
   await Promise.allSettled(Object.values(record.leases).map(restore));
   const pending=Object.values(record.leases).some(row=>{
    const lease=leases.get(leaseKey(row,resource.resourceId));
    return row.command&&!lease?.command||row.terminal&&!readyShell(lease)||row.service&&(!lease?.service||lease.service!==resource.service);
   });
   resource.pendingRecovery=pending;
  }).finally(()=>{if(resource.recovering===recovery)resource.recovering=null;});
  resource.recovering=recovery;
  return recovery;
 }

 async function terminalUnavailable(scope,resource,key,error,check){
  if(!terminalFailureCodes.has(error.message))throw error;
  check();
  let service;
  try{({service}=await verifiedService(scope,resource,check));}catch{/* The PTY outcome is independent of worker availability. */}
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
      args.profileId!==undefined&&!id(args.profileId)||args.access!==undefined&&!['command','terminal','service'].includes(args.access))fail('managed_compute_invalid_request');
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
    if(lease&&lease.projectId!==projectOf(scope))fail('managed_compute_resource_project_changed');
    if(lease&&(lease.resource!==resource||lease.releasing))fail('managed_compute_resource_lease_changed');
    return lease;
   };
   const openLease=()=>{
    const previous=retainedLease(scope,resource);
    const lease=createLease(scope,resource,previous?.id);
    if(!previous&&developerAccess(scope,resource))lease.developerWorkspaceId=resource.workspaceRegistration.workspaceId;
    return lease;
   };
    const access=args.access??defaultAccess(resource);
   check();
   selectedLease();
   if(access==='service'){
    const {service,authority}=await verifiedService(scope,resource,check,{acquiring:true});
    check();if(resource.service!==service)fail('managed_compute_service_changed');
    const lease=selectedLease()??openLease(),reused=lease.service===service;
    try{rememberSelection(scope,lease,answer,check);if(!developerAccess(scope,resource))intent.recordChatChannel(scope,resource,'service');}catch(error){removeUnused(lease);throw error;}
    if(!reused&&developerAccess(scope,resource)&&!retainedLease(scope,resource)?.service)lease.developerServiceWorkspace=resource.workspaceRegistration.workspaceId;
    const previous=lease.service;
    lease.service=service;
    try{rememberChannel(scope,lease,'service',authority);}catch(error){lease.service=previous;removeUnused(lease);throw error;}
    lease.touchedAt=now();
    if(!reused){if(!lease.developerServiceWorkspace)onAcquired(scope,view(resource));changed();}
    return acquired(lease,access,reused);
   }
    if(access==='command'){
     if(!commandAvailable(resource))fail('managed_compute_command_not_supported');
     const policyCurrent=terminalPolicyGuard(scope,resource);
     const authority=await authorization(scope,resource,'command',{acquiring:true});
     if(!authority)fail('managed_compute_project_grant_required');
     check();await checkConnection(resource);check();policyCurrent();
     const lease=selectedLease()??openLease(),reused=lease.command;
     try{
      if(!reused&&authority==='developer')lease.developerCommandWorkspace=resource.workspaceRegistration.workspaceId;
      rememberSelection(scope,lease,answer,check);
      if(!developerAccess(scope,resource))intent.recordChatChannel(scope,resource,'command');
      lease.command=true;
      rememberChannel(scope,lease,access,authority);
     }catch(error){lease.command=reused;if(!reused)delete lease.developerCommandWorkspace;removeUnused(lease);throw error;}
     lease.touchedAt=now();
     if(!reused){if(!lease.developerCommandWorkspace)onAcquired(scope,view(resource));changed();}
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
    lease??=openLease();
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
  if(!lease){
   const record=args.resourceId.startsWith('ssh:')&&hosting.get(args.resourceId.slice(4));
   const retained=record?.leases[hostedLeaseKey(scope)];
   if(!retained)return {status:'not_acquired',resourceId:args.resourceId};
   if(retained.projectId!==projectOf(scope))fail('managed_compute_resource_lease_required');
   const closed=await releaseRetained(record,retained);
   liveScope(scope);
   return {status:closed?'released':'unconfirmed',resourceId:args.resourceId,terminalClosed:closed};
  }
  const closed=await retire(lease);liveScope(scope);
  return {status:closed?'released':'unconfirmed',resourceId:args.resourceId,terminalClosed:closed};
 }

 async function releaseRetained(record,row){
  hosting.setLease(record,row,null);changed();
  if(!row.terminal)return true;
  const {connectionId,channelLeaseId}=row.terminal;
  try{
   const receipt=await connections.managedShell('close',{...resourceRef(record),connectionId,leaseId:channelLeaseId,scope:ownerOf(row)});
   return receipt?.closed===true;
  }catch(error){return ['terminal_session_exited','ssh_connection_not_found'].includes(error.message);}
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
  if(action==='skill')action=lease.command?'command':readyShell(lease)?'terminal':'inspect';
  const developerWorkspace=action==='terminal'?lease.terminal?.developerWorkspaceId:action==='command'?lease.developerCommandWorkspace:lease.developerServiceWorkspace;
  if(developerWorkspace&&!developerAccess(scope,lease.resource))fail('managed_compute_project_grant_required');
  const service=lease.resource.service;
  if(action==='terminal'&&!readyShell(lease))fail('managed_compute_resource_lease_required');
  if(action==='command'&&!lease.command)fail('managed_compute_resource_lease_required');
  if(!shellAccess(action)&&lease.service&&lease.service!==service)fail('managed_compute_service_changed');
  let grant;
  if(action==='service'){
   if(retainedLease(scope,lease.resource)?.service&&!await allowed(scope,lease.resource,'service'))fail('managed_compute_project_grant_required');
   grant=await projectGrant(scope,lease.resource,{required:true});
   if(lease.resource.service!==service)fail('managed_compute_service_changed');
   if(!grant)fail('managed_compute_project_grant_required');
  }else if(!await allowed(scope,lease.resource,action))fail('managed_compute_project_grant_required');
  assertLease(scope,lease);lease.touchedAt=now();
  return {lease,service,grant,policyCurrent};
 }

 async function runCommand(scope,args){
  exact(args,['resource_id','request_id','command'],['resource_id','request_id','command']);
  const {resource_id:resourceId,request_id:requestId,command}=args;
  if(typeof resourceId!=='string'||!/^ssh:[A-Za-z0-9_-]{1,100}$/.test(resourceId)||!id(requestId)||
     typeof command!=='string'||!command.trim()||Buffer.byteLength(command)>8192||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(command))fail('managed_compute_invalid_request');
  const {lease,policyCurrent}=await resolveLease(scope,resourceId,'command');
  const {resource}=lease;
  const check=()=>{
   assertLease(scope,lease);assertResourceIntent(scope,resource);policyCurrent();
   if(!lease.command)fail('managed_compute_resource_lease_changed');
  };
  check();
  return terminalAuthorization.execute({scope,ref:{...resourceRef(resource),resourceId,resourceName:resource.name},leaseId:lease.id,
   requestId,command:command.replaceAll('\r\n','\n').replaceAll('\r','\n'),assertCurrent:check,verifyConnection:()=>checkConnection(resource)});
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
    if(!saved(lease.resource)||!intent.permitsUse(scope,lease.resource))continue;
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
   const terminalStatus=!terminal||shell?null:terminal.shell?.expiresAt<=now()?'lost':terminal.closeUnknown||terminal.observationUnknown?'unknown':terminal.closing?'releasing':'preparing';
   const status=lease.releaseUnknown?'unknown':lease.releasing?'releasing':lease.resource.unconfirmed?'unknown':shell||lease.service||lease.command?'assigned':terminalStatus??'preparing';
   return {leaseId:lease.id,...lease.scope,projectId:lease.projectId,...desktopView(lease.resource),sessionId:shell?.sessionId??null,
    serviceOnly,serviceContext:!!lease.service,commandContext:lease.command,serviceGeneration:lease.service?.generation??null,terminalStatus:serviceOnly||lease.command?terminalStatus:null,status,busy:busy(lease.scope),
    expired:!lease.command&&!serviceOnly&&!!terminal?.shell&&terminal.shell.expiresAt<=now()};
  });
  const entries=[...resources.values()].filter(resource=>{try{current(resource,{observe:true});return true;}catch{return false;}})
   .map(resource=>({...desktopView(resource),generation:resource.service?.generation??null}));
  for(const record of hosting.list()){
   let profile;
   try{profile=profiles.read({id:record.profileId});}catch{continue;}
   if(profile.version!==record.profileVersion||resourceFingerprint(profile)!==record.targetFingerprint)continue;
   const resourceId='ssh:'+record.profileId;
   const resource={...resourceRef(record),resourceId,name:profile.name,kind:'ssh',available:false,serviceStatus:'unavailable'};
   if(!entries.some(entry=>entry.resourceId===resourceId))entries.push({...resource,generation:null});
   for(const row of Object.values(record.leases)){
    if(channels.some(channel=>channel.resourceId===resourceId&&channel.leaseId===row.id))continue;
    channels.push({...resource,leaseId:row.id,...ownerOf(row),projectId:row.projectId,sessionId:null,
     serviceOnly:!!row.service&&!row.terminal,serviceContext:!!row.service,commandContext:!!row.command,serviceGeneration:null,terminalStatus:null,status:'unknown',busy:busy(row),expired:false});
   }
  }
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
  }catch(error){
   if(error.message==='terminal_session_exited'||error.message==='terminal_owner_changed')return false;
   throw error;
  }
 }
 async function observeConsoleService({resourceId,generation}){
  const resource=resources.get(resourceId),service=resource?.service;
  if(!service||service.generation!==generation)return false;
  try{
   current(resource);await service.verify();current(resource);
   return resource.service===service;
  }catch(error){
   if(error.message==='managed_compute_service_changed')return false;
   throw error;
  }
 }
 async function releaseFromConsole(target){
  const lease=leases.get(leaseKey(target,target.resourceId));
  if(!lease){
   const record=target.resourceId.startsWith('ssh:')&&hosting.get(target.resourceId.slice(4));
   const row=record?.leases[hostedLeaseKey(target)];
   if(!row||row.id!==target.leaseId||record.connectionId!==target.connectionId)fail('managed_compute_channel_changed');
   if(busy(row))fail('managed_compute_channel_busy');
   cancelAcquisitions(row,target.resourceId);
   intent.releaseChannel(row,target.resourceId);
   return {status:await releaseRetained(record,row)?'released':'unconfirmed'};
  }
  if(consoleLease(target)!==lease)fail('managed_compute_channel_changed');
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
  if(!await allowed(scope,resource,'inspect'))fail('managed_compute_project_grant_required');
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
    data.onDispatch?.();
   };
   const confirmedRejection=response=>{
    if(workerRunOperationFailure(response,data.data.id)?.operation_state==='not_started')dispatchedRunActions.delete(attemptKey);
    return response;
   };
   if(monitoredSubmit){
    // The worker reserves its bounded observation schedule in the same durable
    // transaction as the exact submission. Only this trusted bridge supplies it.
    const managed_monitor={schemaVersion:1,sourceId:service.id,
     scope:{provider:scope.provider,threadId:scope.threadId,taskId:scheduleOwnerId(scope),projectId:scope.projectId,runId}};
    const response=await anchored(resource,service,'POST','/api/cluster/submit',{run_id:runId,managed_monitor},false,data.timeoutMs,beforeDispatch);
    check();
    if(response.status!==200)return confirmedRejection(response);
    return {status:200,data:{jsonrpc:'2.0',id:data.data.id,result:{isError:false,content:[{type:'text',text:JSON.stringify(response.data)}]}}};
   }
   const payload=action==='cancel'?{...data.data,params:{...data.data.params,arguments:{run_id:runId,require_known:true}}}:data.data;
   const response=await anchored(resource,service,'POST','/mcp',payload,true,data.timeoutMs,beforeDispatch);
   check();
   return confirmedRejection(response);
  }finally{activeRunActions.delete(runKey);}
 }

 async function serviceRequest(scope,data){
  exact(data,['resourceId','method','target','data','mcp','timeoutMs','checkCurrent','beforeScheduleDispatch','onDispatch'],['resourceId','method','target']);
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
    data.onDispatch?.();
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
 function bindComputeChoice(scope,offered){
  liveScope(scope);
  return intent.bindComputeChoice(scope,offered,choice=>currentChoice(scope,choice));
 }
 function bindResourceQuestion(scope,question){
  liveScope(scope);
  return intent.bindResourceQuestion(scope,question,choice=>currentChoice(scope,choice));
 }
 function capture(provider,threadId){
  const owned=[...leases.values()].filter(lease=>lease.scope.provider===provider&&lease.scope.threadId===threadId&&hasLease(lease));
  const bindings=owned.map(lease=>({id:lease.resource.resourceId,profileVersion:lease.resource.profileVersion,
   target:lease.resource.targetFingerprint,connectionId:lease.resource.connectionId??null,
   command:!!lease.command,service:lease.service?.id??null,terminal:readyShell(lease)?.sessionId??null}));
  return {resources:owned.map(lease=>view(lease.resource)),bindings,assertCurrent(){
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
  if(hosting.list().some(record=>record.leases[hostedLeaseKey(scope)]?.projectId===projectOf(scope)))return true;
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

 function remove(resource,{preserve=false,detach=false}={}){
  if(resources.get(resource.resourceId)!==resource)return Promise.resolve([]);
  resources.delete(resource.resourceId);resource.service?.close?.();resource.service=null;
  const closing=[...leases.values()].filter(lease=>lease.resource===resource).map(lease=>{
   if(detach)leases.delete(lease.key);
   return retire(lease,{preserve});
  });
  changed();return Promise.allSettled(closing);
 }
 function revokeConnection({connectionId}){
  publishing.delete(connectionId);
  recoveryCandidates.delete(connectionId);
  for(const record of hosting.list()){
   if(record.connectionId!==connectionId)continue;
   for(const row of Object.values(record.leases))intent.releaseChannel(row,'ssh:'+record.profileId);
   hosting.forget(record);
  }
  return Promise.all([...resources.values()].filter(resource=>resource.connectionId===connectionId).map(remove));
 }
 function confirmConnectionClosed(connectionId){
  for(const lease of leases.values())if(lease.resource.connectionId===connectionId){cancelAcquisitions(lease.scope,lease.resource.resourceId);leases.delete(lease.key);}
  changed();
 }
 async function observe(resource){
  if(scheduledSweeps.has(resource))return scheduledSweeps.get(resource);
  const checked=(async()=>{
   try{current(resource,{observe:true});}
   catch{await remove(resource,{preserve:true,detach:true});return;}
   if(resource.kind==='ssh'){
    const state=await checkConnection(resource,{observe:true}).catch(()=> 'unknown');
    if(stopped||resources.get(resource.resourceId)!==resource)return;
    if(state==='lost'){
     onConnectionLost(resource.connectionId);
     await remove(resource,{preserve:true,detach:true});return;
    }
    const unconfirmed=state!=='authenticated';
    if(!!resource.unconfirmed!==unconfirmed){resource.unconfirmed=unconfirmed;changed();}
    if(unconfirmed)return;
   }
   const service=resource.service;
   if(service){
    try{await service.verify();}
    catch(error){
     // The broker timed out before forwarding the health request. Keep the
     // verified source so the next operation can check the same channel again.
     if(resource.kind==='ssh'&&error?.message==='ssh_control_timeout')return;
     discardService(resource,service);
     if(resource.kind!=='ssh')await remove(resource);
    }
   }
   if(resource.pendingRecovery)await recoverLeases(resource);
  })();scheduledSweeps.set(resource,checked);
  try{await checked;}finally{scheduledSweeps.delete(resource);}
 }
 function touch(provider,threadId){
  for(const lease of leases.values())if(lease.scope.provider===provider&&lease.scope.threadId===threadId&&!lease.releasing)lease.touchedAt=now();
 }
 function assertProfileEnvironmentUpdate(previous){
  const resource=resources.get('ssh:'+previous.id);
  if(resource&&(resource.service||resource.preparing))fail('compute_profile_environment_in_use');
 }
 function profileEnvironmentUpdated(previous,saved,adopted){
  assertProfileEnvironmentUpdate(previous);
  const ids=Array.isArray(adopted?.connectionIds)?adopted.connectionIds:[];
  const fingerprint=resourceFingerprint(saved);
  let updated=hosting.updateProfileVersion(saved.id,previous.version,saved.version,fingerprint,ids);
  const resource=resources.get('ssh:'+saved.id);
  if(resource&&resource.profileVersion===previous.version&&resource.targetFingerprint===fingerprint&&(!ids.length||ids.includes(resource.connectionId))){
   resource.profileVersion=saved.version;
   resource.profile=structuredClone(saved);
   resource.name=saved.name;
   resource.serviceStatus='configuration_required';
   delete resource.serviceError;
   const hosted=hosting.get(saved.id);
   if(hosted)resource.hosting=hosted;
   updated=true;
  }
  for(const [connectionId,candidate] of recoveryCandidates){
   if(candidate.data?.profileId!==saved.id||candidate.data.profileVersion!==previous.version||ids.length&&!ids.includes(connectionId))continue;
   candidate.data.profileVersion=saved.version;
   candidate.record=hosting.get(saved.id)||candidate.record;
  }
  if(updated)changed();
 }
 function forgetProfile(profileId){
  const record=hosting.get(profileId);
  if(record)hosting.forget(record);
  for(const [connectionId,candidate] of recoveryCandidates){
   if(candidate.data?.profileId===profileId)recoveryCandidates.delete(connectionId);
  }
  changed();
 }
 function forget(provider,threadId){
  intent.forget(provider,threadId);
  cancelAcquisitions({provider,threadId});
  const owner={provider,threadId};
  for(const record of hosting.list())if(record.leases[hostedLeaseKey(owner)])hosting.setLease(record,owner,null);
  return Promise.allSettled([...leases.values()].filter(lease=>lease.scope.provider===provider&&lease.scope.threadId===threadId).map(retire));
 }
 async function sweep({idleMs=3600000}={}){
  if(stopped)return;
  await Promise.allSettled([...resources.values()].map(observe));
  const retiring=[];
  for(const lease of leases.values()){
   if(lease.releaseUnknown)retiring.push(retire(lease));
   else if(!lease.releasing){
    const terminal=lease.terminal;
    if(!lease.resource.unconfirmed&&!busy(lease.scope)&&now()-lease.touchedAt>=idleMs)retiring.push(retire(lease));
    else if(terminal?.closeUnknown)retiring.push(closeTerminal(lease,terminal,{retry:true}));
    else if(!lease.resource.unconfirmed&&!busy(lease.scope)&&terminal?.shell&&now()>=terminal.shell.expiresAt){
     clearRetainedChannel(lease,'terminal');retiring.push(closeTerminal(lease,terminal,{retry:true}));
    }
   }
  }
  await Promise.allSettled(retiring);
  for(const [connectionId,candidate] of recoveryCandidates){
   if(hosting.get(candidate.data.profileId)!==candidate.record)recoveryCandidates.delete(connectionId);
  }
  await Promise.allSettled([...recoveryCandidates.values()].map(({data,loginRequestId})=>restoreHosted(data,loginRequestId)));
 }
 function stop(){
  stopped=true;publishing.clear();loginStarts.clear();recoveryCandidates.clear();intent.clear();
  return Promise.allSettled([...resources.values()].map(resource=>remove(resource,{preserve:true})));
 }
 const owns=name=>tools.some(tool=>tool.name===name);
 function callTool(name,args,scope){
  if(name==='list_compute_resources'){exact(args,[]);return list(scope);}
  if(name==='acquire_compute_resource'){
   exact(args,['resource_id','profile_id','alias','access']);
   return acquire(scope,Object.fromEntries(Object.entries(args).map(([key,value])=>[{resource_id:'resourceId',profile_id:'profileId'}[key]??key,value])));
  }
  if(name==='release_compute_resource'){exact(args,['resource_id'],['resource_id']);return release(scope,{resourceId:args.resource_id});}
  if(name==='run_compute_command')return runCommand(scope,args);
  return callTerminalTool(name,args,scope);
 }
 return {publish,publishWsl,noteLogin,restoreHosted,restorePublished,configureService,serviceStatus,updateService,snapshot,list,acquire,release,resolveLease,resolveSkillLibrary,resolveService,inspectService,capture,needsExplicitResource,callTerminalTool,callTool,owns,tools:()=>tools,
  terminalTools:()=>terminalTools,serviceRequest,listSources,eligibleProject,eligibleForWake,refreshService,revokeConnection,confirmConnectionClosed,confirmAlias,bindComputeChoice,bindResourceQuestion,endDeveloperAccess,isDeveloperWorkspace,
  recordUserTurn,sweep,stop,touch,forget,forgetProfile,assertProfileEnvironmentUpdate,profileEnvironmentUpdated,consoleEntries,observeConsoleLease,observeConsoleService,releaseFromConsole,detachLocalFromConsole};
}
