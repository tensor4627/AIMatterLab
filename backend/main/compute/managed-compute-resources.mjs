import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {terminalToolInput,sharedTerminalTools} from './shared-terminal.mjs';
import {managedWorkerProject,originalBindingMatches} from './managed-compute-services.mjs';
import {normalizeComputeAlias,resourceFingerprint} from './managed-compute-aliases.mjs';
import {createManagedComputeIntent,genericComputeKind,requestsComputeName} from './managed-compute-intent.mjs';
import {MANAGED_SSH_SHELL_CAPACITY} from '../../../desktop/platform/terminal-service/managed-ssh-shells.mjs';

const fail=code=>{throw Error(code);};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const string={type:'string',minLength:1,maxLength:128};
const leaseKey=(scope,resourceId)=>JSON.stringify([scope.provider,scope.threadId,resourceId]);
const ownerOf=scope=>({provider:scope.provider,threadId:scope.threadId});
const projectOf=scope=>scope.projectId??null;
const sourceFailure=code=>['managed_compute_service_changed','ssh_authentication_unconfirmed','ssh_connection_changed','ssh_connection_not_found','terminal_unavailable','terminal_service_changed','terminal_service_unknown','terminal_service_unavailable','terminal_service_failed'].includes(code);
const terminalGone=code=>['terminal_session_exited','terminal_saved_connection_changed','ssh_authentication_unconfirmed','ssh_connection_changed','ssh_connection_not_found'].includes(code);
const isAuthenticated=value=>value?.status==='authenticated'&&value.authentication==='verified'&&value.capabilities?.multiplex===true;
const resourceRef=resource=>({connectionId:resource.connectionId,profileId:resource.profileId,profileVersion:resource.profileVersion});
const candidate=resource=>({resourceId:resource.resourceId,profileId:resource.profileId,kind:resource.kind,name:resource.name});
const runMutations=new Map([
 ['validate_run',['validate','run']],['validate_cluster_run',['validate','cluster-run']],
 ['submit_run',['submit','run']],['submit_cluster_run',['submit','cluster-run']],
 ['cancel_run',['cancel','run']],['cancel_cluster_run',['cancel','cluster-run']],
]);

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
  'Read the acquired conversation PTY. Use the returned sequence cursor and keep resources separate.',
  'Write to one acquired conversation PTY. Send action type and action enter separately. An accepted receipt confirms input delivery. Observe the output before any retry. Use the reviewed worker path for formal calculations and scheduler submissions.',
 ][index],
}));
const tools=Object.freeze([
 tool('list_compute_resources','List currently published compute resources. A listed resource is not an authorization grant.',{},[],true),
 tool('acquire_compute_resource','Acquire the resource explicitly requested by the user in this conversation. Use the exact resource ID, stable saved profile ID or the user’s exact alias. If choice_required is returned, ask the user to choose one of those names and acquire again using the same alias. An existing lease is reused.',{resource_id:string,profile_id:string,alias:string}),
 tool('release_compute_resource','Release this conversation’s lease and its independent SSH terminal for this resource.',{resource_id:string},['resource_id']),
 ...terminalTools,
]);

/** App-owned active resources, independent of every renderer selection. `publish`,
 * `publishWsl`, `confirmAlias` and `recordUserTurn` are trusted desktop entry points. */
export function createManagedComputeResources({terminal,profiles,aliases,services,taskSource=()=>null,
 authorizeTerminal=()=>false,authorizeSchedule,authorizeRun,authorizeRunAction, onAcquired=()=>{},onChange=()=>{},
 busy=()=>false,now=Date.now,uuid=randomUUID}){
 const resources=new Map(),leases=new Map(),publishing=new Map(),scheduledSweeps=new Map();
 const activeRunActions=new Set(),dispatchedRunActions=new Set();
 const connections=terminal.connections,intent=createManagedComputeIntent();
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
 const count=resource=>[...leases.values()].filter(lease=>lease.resource===resource).length;
 const view=resource=>({...candidate(resource),profileVersion:resource.profileVersion,available:resource.kind==='ssh'||resource.serviceStatus==='ready',
  serviceStatus:resource.serviceStatus,...resource.kind==='ssh'?{terminalCapacity:MANAGED_SSH_SHELL_CAPACITY,terminalAvailable:Math.max(0,MANAGED_SSH_SHELL_CAPACITY-count(resource))}:{}});
 function snapshot(){return [...resources.values()].filter(visible).map(resource=>({...view(resource),...resource.kind==='ssh'?{connectionId:resource.connectionId}:{}}));}
 async function list(scope){
  liveScope(scope);
  const entries=await Promise.all([...resources.values()].filter(visible).map(async resource=>{
   const terminalGrant=resource.kind==='ssh'&&await authorizeTerminal(scope,resource)===true;
   const lease=leases.get(leaseKey(scope,resource.resourceId));
   const acquired=!!(lease&&lease.resource===resource&&lease.projectId===projectOf(scope)&&!lease.releasing);
   const canAcquire=terminalGrant?true:resource.service&&scope.projectId?'verification_pending':false;
   return {resource,entry:{...view(resource),canAcquire,acquired}};
  }));
  liveScope(scope);
  return {resources:entries.filter(({resource})=>visible(resource)).map(({entry})=>entry)};
 }
 function changed(){if(!stopped)onChange();}

 async function checkConnection(resource){
  current(resource);
  const view=await connections.state({connectionId:resource.connectionId});
  current(resource);
  if(!isAuthenticated(view)||view.profileId!==resource.profileId||view.profileVersion!==resource.profileVersion||view.connectionId!==resource.connectionId)fail('managed_compute_resource_unavailable');
 }

 function prepareService(resource,{configure=false}={}){
  if(!services||resource.preparing)return resource.preparing;
  if(resource.service)return Promise.resolve(resource.service);
  resource.serviceStatus='preparing';
  const fresh=()=>current(resource);
  const preparation=Promise.resolve().then(async()=>{
   try{
    const service=await (resource.kind==='ssh'?services.ssh(resource,resource.profile,fresh,{configure}):services.wsl(resource,resource.receipt,fresh));
    try{fresh();}catch(error){service.close?.();throw error;}
    resource.service=service;resource.serviceStatus='ready';delete resource.serviceError;
    return service;
   }catch(error){
    if(resources.get(resource.resourceId)===resource){
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
   const resourceId='ssh:'+profile.id,previous=resources.get(resourceId);
   if(previous&&saved(previous)){if(!equal(resourceRef(previous),data))fail('managed_compute_profile_already_published');return view(previous);}
   if(previous)void remove(previous);
   const resource={...data,resourceId,profile,kind:'ssh',name:profile.name,targetFingerprint:resourceFingerprint(profile),serviceStatus:'idle'};
   resources.set(resourceId,resource);changed();prepareService(resource);
   return view(resource);
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
  if(resource.preparing)await resource.preparing;
  current(resource);
  if(!resource.service&&!await prepareService(resource,{configure:true}))fail(resource.serviceError||'managed_compute_private_service_unavailable');
  current(resource);
  return view(resource);
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
 async function allowed(scope,resource,action){
  liveScope(scope);current(resource);
  const approved=((action==='acquire'||action==='terminal')&&resource.kind==='ssh'&&await authorizeTerminal(scope,resource)===true)||await eligibleProject(scope,resource);
  liveScope(scope);current(resource);
  return approved===true;
 }

 async function availableChoices(scope,kind){
  const tested=await Promise.all([...resources.values()].filter(resource=>(!kind||resource.kind===kind)&&view(resource).available).map(async resource=>{
   try{return await allowed(scope,resource,'acquire')?resource:null;}catch(error){if(error.message==='managed_compute_context_changed')throw error;return null;}
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
 async function choose(scope,args){
  const alias=args.alias===undefined?null:normalizeComputeAlias(args.alias);
  if(args.alias!==undefined&&!alias)fail('managed_compute_invalid_request');
  const saved=alias&&!genericComputeKind(alias)?aliasEntry(alias,scope):null;
  let resource=findResource(args,alias,saved);
  // Previously acquired exact leases survive later turns and navigation.
  const existing=resource&&leases.get(leaseKey(scope,resource.resourceId));
  if(existing&&existing.resource===resource&&existing.projectId===projectOf(scope)&&!existing.releasing)return {resource,existing};
  const turn=intent.current(scope);
  intent.assertTurn(scope,turn);
  const answer=turn.answer;
  if(answer&&(alias===answer.proposal.alias||resource?.resourceId===answer.choice.resourceId)){
   resource=resources.get(answer.choice.resourceId);
   if(!resource||resource.targetFingerprint!==answer.choice.targetFingerprint)fail('managed_compute_choice_changed');
   return {resource,turn,answer};
  }
  const direct=alias??normalizeComputeAlias(resource?.name);
  const selectedByName=resource&&direct&&requestsComputeName(turn.message,direct);
  if(selectedByName&&!genericComputeKind(direct))return {resource,turn};
  const genericAlias=(alias&&genericComputeKind(alias)?alias:null)||resource&&groupMatch(turn,['集群','ssh','cluster','本地','wsl','local'],resource);
  const requested=genericAlias||alias;
  if(!requested||!requestsComputeName(turn.message,requested))fail('managed_compute_user_instruction_required');
  const kind=genericComputeKind(requested);
  // A known alias is never interpreted as a different running connection when
  // its original profile is merely offline.
  if(saved&&!resource&&![...resources.values()].some(row=>row.profileId===saved.profileId))fail('managed_compute_resource_unavailable');
  const choices=await availableChoices(scope,kind);
  intent.assertTurn(scope,turn);
  if(kind&&choices.length===1&&(!resource||choices[0]===resource))return {resource:choices[0],turn};
  if(!choices.length)fail('managed_compute_no_eligible_resource');
  const proposal=intent.propose(scope,turn,{alias:requested,previous:saved,save:!kind&&!!alias,
   candidates:choices.map(row=>({...candidate(row),targetFingerprint:row.targetFingerprint}))});
  return {choice:{status:'choice_required',alias:requested,candidates:proposal.candidates.map(candidate)}};
 }

 function assertLease(scope,lease){
  liveScope(scope);current(lease.resource);
  if(lease.releasing||leases.get(lease.key)!==lease||!equal(lease.scope,ownerOf(scope))||lease.projectId!==projectOf(scope))fail('managed_compute_resource_lease_required');
 }
 const shellRef=lease=>({...resourceRef(lease.resource),leaseId:lease.id,scope:lease.scope});
 const shellView=lease=>({sessionId:lease.shell.sessionId,resourceId:lease.resource.resourceId,name:lease.resource.name,kind:'ssh',alive:true});
 const acquired=(lease,reused)=>({status:'acquired',resource:view(lease.resource),reused,...lease.shell?{terminal:shellView(lease)}:{}});

 async function acquire(scope,args){
  exact(args,['resourceId','profileId','alias']);
  if(Object.keys(args).length!==1||args.resourceId!==undefined&&(typeof args.resourceId!=='string'||! /^(?:ssh|wsl):[A-Za-z0-9_-]{1,100}$/.test(args.resourceId))||args.profileId!==undefined&&!id(args.profileId))fail('managed_compute_invalid_request');
  liveScope(scope);
  const selection=await choose(scope,args);
  if(selection.choice)return selection.choice;
  const {resource,turn,answer}=selection,key=leaseKey(scope,resource.resourceId);
  const instruct=()=>{if(turn)intent.assertTurn(scope,turn);};
  if(!await allowed(scope,resource,'acquire'))fail('managed_compute_project_grant_required');
  instruct();
  let lease=leases.get(key);
  if(lease&&(lease.resource!==resource||lease.projectId!==projectOf(scope)||lease.releasing))fail('managed_compute_resource_lease_changed');
  if(lease){
   await lease.opening;assertLease(scope,lease);
   if(lease.shell&&!await verifyShell(lease,scope))fail('terminal_session_exited');
   lease.touchedAt=now();return acquired(lease,true);
  }
  if(resource.kind==='ssh'&&count(resource)>=MANAGED_SSH_SHELL_CAPACITY)fail('terminal_session_limit');
  if(resource.kind!=='ssh'&&!resource.service)fail('managed_compute_private_service_unavailable');
  lease={id:uuid(),key,scope:ownerOf(scope),projectId:projectOf(scope),resource,touchedAt:now(),shell:null,opening:null,releasing:null};
  leases.set(key,lease);
  lease.opening=(async()=>{
   try{
    if(resource.kind==='ssh'){
     const state=await connections.managedShell('open',shellRef(lease));
     if(!state.alive)fail('terminal_session_exited');
     lease.shell=state;
    }
    assertLease(scope,lease);instruct();
    if(!await allowed(scope,resource,'acquire'))fail('managed_compute_project_grant_required');
    assertLease(scope,lease);instruct();
    if(answer?.proposal.save&&aliases){
     aliases.remember(answer.proposal.alias,resource,answer.proposal.previous,()=>{
      try{assertLease(scope,lease);instruct();return true;}catch{return false;}
     });
    }
    onAcquired(scope,view(resource));
   }catch(error){void retire(lease);throw error;}
  })();
  changed();await lease.opening;
  return acquired(lease,false);
 }

 function retire(lease){
  if(lease.releasing)return lease.releasing;
  const operation=Promise.resolve().then(async()=>{
   try{
    if(lease.resource.kind==='ssh')await connections.managedShell('close',shellRef(lease));
    if(leases.get(lease.key)===lease)leases.delete(lease.key);
    return true;
   }catch(error){
    if(['ssh_connection_not_found','terminal_session_exited'].includes(error.message)){
     if(leases.get(lease.key)===lease)leases.delete(lease.key);
     return true;
    }
    lease.closeUnknown=true;return false;
   }finally{changed();}
  });
  lease.releasing=operation;
  return operation;
 }

 async function release(scope,args){
  exact(args,['resourceId'],['resourceId']);liveScope(scope);
  if(typeof args.resourceId!=='string')fail('managed_compute_invalid_request');
  const lease=leases.get(leaseKey(scope,args.resourceId));
  if(!lease)return {status:'not_acquired',resourceId:args.resourceId};
  const closed=await retire(lease);liveScope(scope);
  return {status:'released',resourceId:args.resourceId,terminalClosed:closed};
 }

 async function verifyShell(lease,scope){
  assertLease(scope,lease);
  try{
   const state=await connections.managedShell('state',shellRef(lease));
   assertLease(scope,lease);
   if(state.alive&&state.sessionId===lease.shell.sessionId&&state.ownerEpoch===lease.shell.ownerEpoch)return true;
  }catch(error){if(!terminalGone(error.message))throw error;}
  void retire(lease);return false;
 }

 async function resolveLease(scope,resourceId,action='service'){
  liveScope(scope);
  const rows=[...leases.values()].filter(lease=>equal(lease.scope,ownerOf(scope))&&lease.projectId===projectOf(scope)&&!lease.releasing&&(!resourceId||lease.resource.resourceId===resourceId));
  if(rows.length!==1)fail(rows.length?'managed_compute_resource_choice_required':'managed_compute_resource_lease_required');
  const lease=rows[0];
  await lease.opening;assertLease(scope,lease);
  const service=lease.resource.service;
  let grant;
  if(action==='service'){
   grant=await projectGrant(scope,lease.resource,{required:true});
   if(lease.resource.service!==service)fail('managed_compute_service_changed');
   if(!grant)fail('managed_compute_project_grant_required');
  }else if(!await allowed(scope,lease.resource,action))fail('managed_compute_project_grant_required');
  assertLease(scope,lease);lease.touchedAt=now();
  return {lease,service,grant};
 }

 async function callTerminalTool(name,args,scope){
  liveScope(scope);
  if(name==='list_compute_terminals'){
   exact(args,[]);const sessions=[];
   for(const lease of [...leases.values()]){
    if(!lease.shell||lease.releasing||!equal(lease.scope,ownerOf(scope))||lease.projectId!==projectOf(scope))continue;
    if(await allowed(scope,lease.resource,'terminal')&&await verifyShell(lease,scope))sessions.push(shellView(lease));
   }
   return {sessions};
  }
  if(!['read_compute_terminal','write_compute_terminal'].includes(name))fail('managed_compute_invalid_request');
  const reading=name==='read_compute_terminal';
  exact(args,reading?['session_id','cursor','max_bytes']:['session_id','request_id','action','data'],['session_id']);
  const input=reading?null:terminalToolInput(args);
  if(!id(args.session_id)||reading&&(args.cursor!==undefined&&(!Number.isSafeInteger(args.cursor)||args.cursor<0)||args.max_bytes!==undefined&&(!Number.isInteger(args.max_bytes)||args.max_bytes<1||args.max_bytes>65536)))fail('managed_compute_invalid_request');
  const own=[...leases.values()].find(lease=>lease.shell?.sessionId===args.session_id&&equal(lease.scope,ownerOf(scope)));
  if(!own)fail('managed_compute_resource_lease_required');
  const {lease}=await resolveLease(scope,own.resource.resourceId,'terminal');
  if(lease!==own)fail('managed_compute_resource_lease_changed');
  const ref={...shellRef(lease),sessionId:lease.shell.sessionId,ownerEpoch:lease.shell.ownerEpoch};
  const maxBytes=Math.max(16384,args.max_bytes??65536);
  try{
   const result=reading?await connections.managedShell('read',{...ref,...args.cursor!==undefined?{cursor:args.cursor}:{},maxBytes}):await connections.managedShell('input',{...ref,...input});
   assertLease(scope,lease);
   return reading?{session_id:ref.sessionId,output:result.output,cursor:result.cursor,dropped:result.dropped,effective_max_bytes:maxBytes}:result;
  }catch(error){if(terminalGone(error.message))void retire(lease);throw error;}
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
   sources.push({id:service.id,generation:service.generation,profileId:resource.profileId,kind:resource.kind,health:structuredClone(service.health),async request(method,path,data){
    if(path==='/api/managed-schedules/observe-once'){
     const fields=['sourceId','scheduleId','requestId'];exact(data,fields,fields);
     if(method!=='POST'||data.sourceId!==service.id)fail('managed_compute_invalid_request');
    }
    const response=await anchored(resource,service,method,path,data);
    if(response.status!==200)throw Error(response.data?.error||'managed_compute_worker_request_failed');
    return response.data;
   }});
  }
  return sources;
 }

 async function resolveService(scope,resourceId){
  const {lease,service,grant}=await resolveLease(scope,resourceId,'service'),resource=lease.resource;
  assertLease(scope,lease);
  if(!service||resource.service!==service)fail('managed_compute_service_changed');
  return {sourceId:service.id,resourceId:resource.resourceId,profileId:resource.profileId,kind:resource.kind,
   supportsManagedSchedules:service.health?.managed_schedule_schema===1,...grant};
 }

 async function assertRun(scope,resource,service,runId,kind){
  if(!id(runId)||kind==='run'&&resource.kind==='ssh'||kind==='cluster-run'&&resource.kind!=='ssh')fail('managed_compute_run_source_changed');
  if(authorizeRun){
   if(await authorizeRun(scope,{sourceId:service.id,resourceId:resource.resourceId,runId,kind})!==true)fail('managed_compute_run_source_changed');
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
  if(monitoredSubmit&&!scope.taskId)fail('managed_compute_project_grant_required');
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
     scope:{provider:scope.provider,threadId:scope.threadId,taskId:scope.taskId,projectId:scope.projectId,runId}};
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
  const check=()=>{assertLease(scope,lease);data.checkCurrent?.();};
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
     await assertRun(scope,resource,service,args?.run_id,name.startsWith('cluster_')?'cluster-run':'run');
    }else fail('managed_compute_invalid_request');
   }
  }else{
   if(!/^\/api\/managed-schedules\/(?:upsert|stop|status)$/.test(data.target)||payload?.sourceId!==service.id)fail('managed_compute_invalid_request');
   if(service.health?.managed_schedule_schema!==1)fail('managed_compute_worker_update_required');
   if(data.target.endsWith('/upsert')){
    if(payload.scope?.projectId!==scope.projectId||payload.scope?.taskId!==scope.taskId||payload.scope?.threadId!==scope.threadId||payload.scope?.provider!==scope.provider)fail('managed_compute_project_grant_required');
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
 function capture(provider,threadId){
  const owned=[...leases.values()].filter(lease=>lease.scope.provider===provider&&lease.scope.threadId===threadId&&!lease.releasing);
  return {resources:owned.map(lease=>view(lease.resource)),assertCurrent(){
   for(const lease of owned){
    current(lease.resource);
    if(lease.releasing||leases.get(lease.key)!==lease)fail('managed_compute_resource_lease_changed');
   }
  }};
 }
 function needsExplicitResource(scope,{readAliases=true}={}){
  if(!scope?.threadId)return false;
  const turn=intent.current(scope);
  if(capture(scope.provider,scope.threadId).resources.length>0)return true;
  if(!turn)return false;
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
 async function observe(resource){
  if(scheduledSweeps.has(resource))return scheduledSweeps.get(resource);
  const checked=(async()=>{
   try{if(resource.kind==='ssh')await checkConnection(resource);else current(resource);}
   catch{await remove(resource);return;}
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
  return Promise.allSettled([...leases.values()].filter(lease=>lease.scope.provider===provider&&lease.scope.threadId===threadId).map(retire));
 }
 async function sweep({idleMs=3600000}={}){
  if(stopped)return;
  const retiring=[];
  for(const lease of leases.values()){
   if(lease.closeUnknown){lease.closeUnknown=false;lease.releasing=null;retiring.push(retire(lease));}
   else if(!lease.releasing&&!busy(lease.scope)&&(now()-lease.touchedAt>=idleMs||lease.shell&&now()>=lease.shell.expiresAt))retiring.push(retire(lease));
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
   exact(args,['resource_id','profile_id','alias']);
   return acquire(scope,Object.fromEntries(Object.entries(args).map(([key,value])=>[{resource_id:'resourceId',profile_id:'profileId'}[key]??key,value])));
  }
  if(name==='release_compute_resource'){exact(args,['resource_id'],['resource_id']);return release(scope,{resourceId:args.resource_id});}
  return callTerminalTool(name,args,scope);
 }
 return {publish,publishWsl,configureService,snapshot,list,acquire,release,resolveLease,resolveService,capture,needsExplicitResource,callTerminalTool,callTool,owns,tools:()=>tools,
  terminalTools:()=>terminalTools,serviceRequest,listSources,eligibleProject,eligibleForWake,refreshService,revokeConnection,confirmAlias,
  recordUserTurn:intent.recordUserTurn,sweep,stop,touch,forget};
}
