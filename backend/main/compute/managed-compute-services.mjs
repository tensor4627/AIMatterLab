import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {validTaskWorkerSource, stableSshWorkerBinding} from '../../../contracts/compute/task-worker-binding.mjs';
import {normalizeSshServiceHealth} from './ssh-connection-service.mjs';
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

/** Attach private service clients to verified original workers. There is no
 * selection, global worker mutation, service update, or job replay here. */
export function createManagedComputeServices({connections,registration,source,transportSource,
 prepareResources=prepareSshServiceResourcesAsync,newWslClient=()=>new WorkerClient(),uuid=randomUUID}){
 async function ssh(resource,profile,assertCurrent,{configure=false}={}){
  const ref={connectionId:resource.connectionId},profileRef={profileId:profile.id,profileVersion:profile.version},requestBase={...ref,...profileRef};
  const initial=configure?registration.read(profileRef):null;
  const first=!!(configure&&(initial?.status==='unconfigured'||initial?.status==='maintenance_required'&&initial.reason==='configuration_changed'));
  let saved=first?null:registration.validateReuse(profile);
  const fresh=()=>{
   assertCurrent();
   const actual=saved?registration.validateReuse(profile):registration.read(profileRef);
   if(!equal(actual,saved||initial))fail('managed_compute_service_changed');
  };
  const checkView=view=>{
   fresh();
   if(!exactConnection(resource,view))fail('managed_compute_service_changed');
   return view;
  };
  let view=checkView(await connections.serviceState(ref));
  const prepare=()=>prepareResources(source,{profileId:profile.id,transportSource,...saved?{
   port:saved.port,reuseOnly:true,expectedRuntimeId:saved.runtimeId,
   ...saved.runtimeManifestSha256?{expectedRuntimeManifestSha256:saved.runtimeManifestSha256}:{},
  }:{}});
  let bootstrap;
  if(view.serviceActive!==true&&['idle','failed','disconnected'].includes(view.status)){
   bootstrap=await prepare();
   fresh();
   await connections.openService({...requestBase,requestId:uuid()},
    {...bootstrap,...saved?{reuseOnly:true,startCached:true}:{},...profile.serviceEnvironment?{serviceEnvironment:profile.serviceEnvironment}:{}},{conversationChannel:true});
   view=checkView(await connections.serviceState(ref));
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
  if(first){
   const expected=(bootstrap??await prepare()).payload;
   fresh();
   if(expected?.expected_runtime_id!==health.runtimeId||expected?.port!==health.port||!health.runtimeManifestSha256)fail('managed_compute_service_changed');
   const requestId=uuid();
   const toolReply=await forward('POST','/mcp',{jsonrpc:'2.0',id:requestId,method:'tools/list',params:{}},true,10000);
   fresh();
   const tools=toolReply.status===200&&toolReply.data?.id===requestId&&toolReply.data.result?.tools;
   const count=Array.isArray(tools)&&tools.length>0&&tools.every(tool=>typeof tool?.name==='string')?tools.length:0;
   registration.remember(profile,health,{status:count?'ready':'warning',count});
   saved=registration.validateReuse(profile,health);
  }else registration.validateReuse(profile,health);
  const binding=stableSshWorkerBinding({kind:'ssh',profileId:profile.id,profileVersion:profile.version,...health});
  async function verify(){
   const observed=normalizeSshServiceHealth(unwrap(await forward('GET',healthPath,undefined,false,10000)));
   fresh();
   if(!stableHealth(health,observed))fail('managed_compute_service_changed');
   return observed;
  }
  return {id:sshSourceId(binding),generation:channelId,binding,health,verify,async forward(method,target,data,mcp,timeoutMs,beforeDispatch){
   fresh();const observed=await verify();
   beforeDispatch?.(observed);
   const result=await forward(method,target,data,mcp,timeoutMs);
   fresh();return result;
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
 return {ssh,wsl};
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
 if(!service||!scope.projectId)return null;
 assertCurrent();
 const query=async(method,target,data)=>{
  const response=await service.forward(method,target,data,false,10000,assertCurrent);
  assertCurrent();
  if(response?.status===403)return null;
  const rows=unwrap(response);
  const valid=target==='/api/cluster/profile'?rows&&typeof rows==='object'&&!Array.isArray(rows):Array.isArray(rows);
  if(!valid)fail('managed_compute_worker_request_failed');
  return rows;
 };
 const projects=await query('GET','/api/projects');
 const project=Array.isArray(projects)&&projects.find(row=>row?.id===scope.projectId);
 if(!project?.policy)return null;
 if(resource.kind!=='ssh'){
  if(!Array.isArray(project.policy.environments)||!project.policy.environments.length)return null;
  const registered=await query('GET','/api/environments');
  const environmentIds=Array.isArray(registered)?registered.filter(row=>project.policy.environments.includes(row?.id)).map(row=>row.id):[];
  return environmentIds.length?{environmentIds,clusterIds:[]}:null;
 }
 const allowed=project.policy.clusters;
 if(!Array.isArray(allowed)||!allowed.length||allowed.length>128)return null;
 const rows=await query('GET','/api/clusters'),clusterIds=[];
 const host=service.binding.hostIdentity,want={root:service.binding.root,hostname:host.hostname,uid:host.uid,machineId:host.machineId};
 for(const cluster of Array.isArray(rows)?rows:[]){
  if(cluster?.transport_kind!=='ssh-service-local'||!allowed.includes(cluster.id))continue;
  const detail=await query('POST','/api/cluster/profile',{cluster_id:cluster.id});
  if(detail?.id===cluster.id&&detail.version===cluster.version&&detail.transport_kind==='ssh-service-local'&&equal(detail.service_binding,want))clusterIds.push(cluster.id);
 }
 return clusterIds.length?{environmentIds:[],clusterIds}:null;
}
