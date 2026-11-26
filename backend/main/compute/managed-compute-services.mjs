import {randomUUID} from 'node:crypto';
import {schedulerInspectionCapability} from '../../../contracts/compute/scheduler-observation.mjs';
import {isDeepStrictEqual as equal} from 'node:util';
import {validTaskWorkerSource, stableSshWorkerBinding} from '../../../contracts/compute/task-worker-binding.mjs';
import {normalizeSshServiceHealth} from './ssh-connection-service.mjs';
import {sameRegistrationIdentity} from './ssh-service-registration.mjs';
import {prepareSshServiceResourcesAsync} from './ssh-service-resources.mjs';
import {sshSourceId,wslSourceId} from './worker-service-version.mjs';
import {WorkerClient} from './worker.mjs';

const fail=code=>{throw Error(code);};
const serviceId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const healthPath='/api/health';
const unwrap=result=>{if(result?.status!==200)fail('managed_compute_worker_request_failed');return result.data;};
const stableHealth=(verified,observed)=>['root','runtime','runtimeId','port'].every(k=>verified[k]===observed[k])&&
 equal(verified.hostIdentity,observed.hostIdentity)&&
 (!observed.runtimeManifestSha256||verified.runtimeManifestSha256===observed.runtimeManifestSha256);
const exactConnection=(resource,view)=>view?.connectionId===resource.connectionId&&view.profileId===resource.profileId&&view.profileVersion===resource.profileVersion;
const sameRepairTarget=(a,b)=>a.root===b.root&&a.port===b.port&&equal(a.hostIdentity,b.hostIdentity);
const repairableFailureCodes=new Set(['maintenance_required','worker_cache_invalid','worker_hash_mismatch','transport_cache_invalid','transport_hash_mismatch','worker_start_failed','worker_health_invalid','sqlite_unavailable']);

/** Attach private service clients to verified original workers. There is no
 * selection, global worker mutation, service update, or job replay here. */
export function createManagedComputeServices({connections,registration,source,transportSource,
 prepareResources=prepareSshServiceResourcesAsync,newWslClient=()=>new WorkerClient(),uuid=randomUUID}){
 const bundled=new Map();
 async function comparison(profile,health){
  let pending=bundled.get(profile.id);
  if(!pending){
   pending=prepareResources(source,{profileId:profile.id,transportSource,reuseOnly:true,verifiedCacheOnly:true}).then(value=>value.payload);
   bundled.set(profile.id,pending);
  }
  let expected;try{expected=await pending;}catch(error){bundled.delete(profile.id);throw error;}
  if(!/^[a-f0-9]{20}$/.test(expected?.expected_runtime_id||'')||!(/^[a-f0-9]{64}$/).test(expected?.runtime_manifest_sha256||''))fail('managed_compute_bundled_service_unavailable');
  const remoteRuntimeId=health?.runtimeId,remoteManifestSha256=health?.runtimeManifestSha256;
  const status=remoteRuntimeId!==expected.expected_runtime_id?'different':!remoteManifestSha256?'unconfirmed':remoteManifestSha256===expected.runtime_manifest_sha256?'current':'different';
  return {status,remoteRuntimeId,remoteManifestSha256,bundledRuntimeId:expected.expected_runtime_id,bundledManifestSha256:expected.runtime_manifest_sha256};
 }
 async function ssh(resource,profile,assertCurrent,{configure=false,repairMaintenance=false,upgrade,existingOnly=false}={}){
  const ref={connectionId:resource.connectionId},profileRef={profileId:profile.id,profileVersion:profile.version},requestBase={...ref,...profileRef};
  const identityOptions={includeIdentityGeneration:true};
  const initial=configure?registration.read(profileRef,identityOptions):null;
  const maintenance=initial?.status==='maintenance_required';
  const sameWorkspaceHost=!!(initial?.registration&&equal(initial.registration.hostIdentity,resource.workspaceRegistration?.hostIdentity));
  const repairableMaintenance=maintenance&&(initial.reason==='configuration_changed'||repairMaintenance&&(sameWorkspaceHost||initial.reason==='registration_invalid'&&!initial.registration));
  if(configure&&repairMaintenance&&maintenance&&!repairableMaintenance)fail('ssh_service_registration_identity_changed');
  const first=!!(configure&&(initial?.status==='unconfigured'||repairableMaintenance));
  const repair=first&&sameWorkspaceHost?initial.registration:null;
  const registered=health=>registration.validateReuse(profile,health,identityOptions);
  let saved=first?null:registered();
  let replacingRegistration=!!upgrade;
  const fresh=()=>{
   assertCurrent();
   if(!saved){
    if(!equal(registration.read(profileRef,identityOptions),initial))fail('managed_compute_service_changed');
    return;
   }
   const actual=registered();
   const same=replacingRegistration?equal(saved,actual):sameRegistrationIdentity(saved,actual);
   if(!same)fail('managed_compute_service_changed');
  };
  const checkView=view=>{
   fresh();
   if(!exactConnection(resource,view))fail('managed_compute_service_changed');
   return view;
  };
  let view=checkView(await connections.serviceState(ref));
  const prepareBundled=port=>prepareResources(source,{profileId:profile.id,transportSource,...port!==undefined?{port}:{}});
  const prepare=()=>saved&&!upgrade?prepareResources(source,{profileId:profile.id,transportSource,port:saved.port,reuseOnly:true,expectedRuntimeId:saved.runtimeId,...saved.runtimeManifestSha256?{expectedRuntimeManifestSha256:saved.runtimeManifestSha256}:{}}):prepareBundled((repair||saved)?.port);
  let bootstrap,upgradeManifest,repairedConfigured=false;
  if(upgrade){
   const versions=await comparison(profile,saved);fresh();
   if(!saved||versions.status!=='different'||upgrade.expectedRuntimeId!==versions.remoteRuntimeId||upgrade.bundledRuntimeId!==versions.bundledRuntimeId||
      view.status!=='connected'||view.serviceActive!==true||view.channelKind!=='private'||view.serviceId!==upgrade.generation)fail('managed_compute_service_changed');
   bootstrap=await prepare();fresh();
   if(bootstrap.payload.expected_runtime_id!==versions.bundledRuntimeId)fail('managed_compute_service_changed');
   upgradeManifest=versions.bundledManifestSha256;
   const stopped=checkView(await connections.closeService({...ref,serviceId:view.serviceId}));
   if(stopped.serviceActive!==false)fail('terminal_service_unknown');
   view=stopped;
  }
  if(!existingOnly&&view.serviceActive!==true&&['idle','failed','disconnected'].includes(view.status)){
   bootstrap??=await prepare();
   fresh();
   let openError=null;
   try{
    await connections.openService({...requestBase,requestId:uuid()},
     {...bootstrap,...saved&&!upgrade?{reuseOnly:true,startCached:true}:{},...profile.serviceEnvironment?{serviceEnvironment:profile.serviceEnvironment}:{}},{conversationChannel:true});
   }catch(error){
    if(!(!upgrade&&saved&&repairMaintenance&&repairableFailureCodes.has(error?.message)&&equal(saved.hostIdentity,resource.workspaceRegistration?.hostIdentity)))throw error;
    openError=error;
   }
   view=checkView(await connections.serviceState(ref));
   if(!upgrade&&saved&&repairMaintenance&&view.serviceActive!==true&&equal(saved.hostIdentity,resource.workspaceRegistration?.hostIdentity)&&
      (openError||view.status==='failed'&&repairableFailureCodes.has(view.error?.code))){
    replacingRegistration=true;
    bootstrap=await prepareBundled(saved.port);
    fresh();
    await connections.openService({...requestBase,requestId:uuid()},
     {...bootstrap,...profile.serviceEnvironment?{serviceEnvironment:profile.serviceEnvironment}:{}},{conversationChannel:true});
    view=checkView(await connections.serviceState(ref));
    repairedConfigured=true;
   }
  }
  if(view.status!=='connected'||view.serviceActive!==true||view.channelKind!=='private'||!serviceId(view.serviceId))fail('managed_compute_private_service_unavailable');
  const channelId=view.serviceId;
  const forward=(method,target,data,mcp=false,timeoutMs)=>connections.privateServiceRequest({...ref,serviceId:channelId,requestId:uuid(),
   method,target,mcp,...data!==undefined?{data}:{},...timeoutMs!==undefined?{timeoutMs}:{}});
  // The authenticated bridge READY receipt carries the verified manifest.
  // The worker HTTP health provides the live process and capability evidence.
  const ready=normalizeSshServiceHealth(view),live=normalizeSshServiceHealth(unwrap(await forward('GET',healthPath,undefined,false,10000)));
  fresh();
  if(!stableHealth(ready,live))fail('managed_compute_service_changed');
  const health={...ready,...live};
  if(upgradeManifest&&health.runtimeManifestSha256!==upgradeManifest)fail('managed_compute_service_changed');
  if(repair&&!sameRepairTarget(health,repair))fail('managed_compute_service_changed');
  if(repairedConfigured&&!sameRepairTarget(health,saved))fail('managed_compute_service_changed');
  if(first||upgrade||repairedConfigured){
   const expected=(bootstrap??await prepare()).payload;
   fresh();
   if(expected?.expected_runtime_id!==health.runtimeId||expected?.port!==health.port||!health.runtimeManifestSha256)fail('managed_compute_service_changed');
   const requestId=uuid();
   const toolReply=await forward('POST','/mcp',{jsonrpc:'2.0',id:requestId,method:'tools/list',params:{}},true,10000);
   fresh();
   const tools=toolReply.status===200&&toolReply.data?.id===requestId&&toolReply.data.result?.tools;
   const count=Array.isArray(tools)&&tools.length>0&&tools.every(tool=>typeof tool?.name==='string')?tools.length:0;
   registration.remember(profile,health,{status:count?'ready':'warning',count});
   saved=registered(health);
   replacingRegistration=false;
  }else registered(health);
  const binding=stableSshWorkerBinding({kind:'ssh',profileId:profile.id,profileVersion:profile.version,...health});
  async function verify(){
   fresh();
   const observed=normalizeSshServiceHealth(unwrap(await forward('GET',healthPath,undefined,false,10000)));
   fresh();
   if(!stableHealth(health,observed))fail('managed_compute_service_changed');
   return observed;
  }
  const schedulerInspection=view.service?.bridge_capabilities?.includes(schedulerInspectionCapability)===true;
  let pending=0;
  return {id:sshSourceId(binding),generation:channelId,binding,health,verify,schedulerInspection,canUpdate:()=>pending===0,async forward(method,target,data,mcp,timeoutMs,beforeDispatch){
   fresh();pending++;
   try{
    const observed=await verify();beforeDispatch?.(observed);
    const result=await forward(method,target,data,mcp,timeoutMs);fresh();return result;
   }finally{pending--;}
  }};
 }

 async function wsl(resource,receipt,assertCurrent){
  const {distribution,root,port,runtime}=receipt,client=newWslClient();
  const binding={kind:'wsl',distribution,root,port},id=wslSourceId(binding);
  const config={distribution,workerRoot:root,workerPort:port};
  const fresh=()=>{assertCurrent();if(!client.connection||!client.matchesTarget(config))fail('managed_compute_service_changed');};
  function checkedHealth(value){
   if(value?.name!=='gpu-sampling-studio'||value.root!==root||value.runtime!==runtime||value.execution_policy!=='desktop-review-v1'||value.ssh_service===true)fail('managed_compute_service_changed');
   return value;
  }
  async function verify(){
   fresh();
   const health=checkedHealth(unwrap(await client.forward('GET',healthPath,undefined,false,10000)));
   fresh();return health;
  }
  try{
   if(!id||resource.kind!=='wsl')fail('managed_compute_service_changed');
   const result=await client.restore(config,{current:()=>{try{assertCurrent();return true;}catch{return false;}}});
   if(result.status!=='connected')fail('managed_compute_private_service_unavailable');
   const health=await verify();
   return {id,generation:uuid(),binding,health,verify,close:()=>client.close(),async forward(method,target,data,mcp,timeoutMs,beforeDispatch){
    const observed=await verify();
    beforeDispatch?.(observed);
    const response=await client.forward(method,target,data,mcp,timeoutMs);
    fresh();return response;
   }};
  }catch(error){client.close();throw error;}
 }
 return {ssh,wsl,comparison};
}

export function originalBindingMatches(original,active){
 const source=original?.binding?original:{source:'authoring',binding:original};
 if(!validTaskWorkerSource(source))return false;
 if(active.kind==='ssh'){
  return source.binding.kind==='ssh'&&equal(stableSshWorkerBinding(source.binding),active);
 }
 const binding=source.binding;
 return binding.kind!=='ssh'&&binding.distribution===active.distribution&&binding.root===active.root&&binding.port===active.port;
}

export async function managedWorkerProject(scope,resource,service,assertCurrent){
 const observation=await observeManagedWorkerProject(scope,resource,service,assertCurrent);
 return observation.grant??null;
}

export async function observeManagedWorkerProject(scope,resource,service,assertCurrent){
 if(!scope.projectId)return {access:'no_project'};
 if(!service)return {access:'unobserved',reason:'service_unavailable'};
 assertCurrent();
 const validId=id=>typeof id==='string'&&id.length>0;
 const invalid='managed_compute_project_receipt_invalid';
 const query=async(stage,method,target,data,decode)=>{
  let status;
  try{
   const response=await service.forward(method,target,data,false,10000,assertCurrent);
   assertCurrent();
   status=response?.status;
   if(status===401||status===403&&response.data?.error==='MCP credential is restricted to /mcp')
    fail('managed_compute_project_authentication_failed');
   if(status!==200)fail('managed_compute_project_observation_failed');
   const receipt=decode(response.data);
   if(receipt===undefined)fail(invalid);
   return receipt;
  }catch(error){
   throw Object.assign(Error(error?.message||'managed_compute_project_observation_failed',{cause:error}),{
    projectObservationStage:stage,
    projectObservationHttpStatus:Number.isInteger(status)&&status>=100&&status<=599?status:undefined,
   });
  }
 };
 const catalog=rows=>Array.isArray(rows)&&rows.every(row=>validId(row?.id))?rows:undefined;
 const targetsOf=project=>{
  const policy=project.policy;
  if(!policy||typeof policy!=='object'||Array.isArray(policy))return;
  const {clusters=[],environments}=policy;
  const targets=resource.kind==='ssh'?clusters:environments;
  if(Array.isArray(targets)&&targets.every(validId)&&(resource.kind!=='ssh'||targets.length<=128))return targets;
 };
 const project=await query('project_catalog','GET','/api/projects',undefined,rows=>{
  if(!catalog(rows))return;
  const matches=rows.filter(row=>row.id===scope.projectId);
  if(!matches.length)return {access:'project_missing'};
  if(matches.length!==1)return;
  if(matches[0].authoring_only===true)return {access:'authoring_only'};
  const targets=targetsOf(matches[0]);
  if(targets)return {targets};
 });
 if(project.access)return project;
 const {targets}=project;
 if(!targets.length)return {access:'not_granted'};
 if(resource.kind!=='ssh'){
  const registered=await query('environment_catalog','GET','/api/environments',undefined,catalog);
  const environmentIds=registered.filter(row=>targets.includes(row.id)).map(row=>row.id);
  return environmentIds.length?{access:'authorized',grant:{environmentIds,clusterIds:[]}}:{access:'not_granted'};
 }
 const rows=await query('cluster_catalog','GET','/api/clusters',undefined,catalog),clusterIds=[];
 const host=service.binding.hostIdentity,want={root:service.binding.root,hostname:host.hostname,uid:host.uid,machineId:host.machineId};
 for(const cluster of rows){
  if(cluster.transport_kind!=='ssh-service-local'||!targets.includes(cluster.id))continue;
  const detail=await query('cluster_profile','POST','/api/cluster/profile',{cluster_id:cluster.id},row=>
   row&&typeof row==='object'&&!Array.isArray(row)&&row.id===cluster.id&&row.version===cluster.version&&
   row.transport_kind===cluster.transport_kind&&row.service_binding&&typeof row.service_binding==='object'&&!Array.isArray(row.service_binding)?row:undefined);
  if(equal(detail.service_binding,want))clusterIds.push(cluster.id);
 }
 return clusterIds.length?{access:'authorized',grant:{environmentIds:[],clusterIds}}:{access:'not_granted'};
}
