/** Main-owned facts about the selected service; no registration or execution grant. */
import {randomUUID} from 'node:crypto';

const NAME='inspect_compute_resource',CAPABILITY='scheduler-inspection-v1';
const TARGET='/api/ssh-service/inspect-scheduler';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=()=>{throw Error('Current SSH job-service inspection requires the current conversation grant and the same verified connection');};
const identity=value=>({root:value?.root,runtime:value?.runtime,runtimeId:value?.runtimeId||value?.runtime_id,port:value?.port,hostname:value?.hostIdentity?.hostname||value?.hostname,uid:value?.hostIdentity?.uid??value?.uid,machineId:value?.hostIdentity?.machineId||value?.machineId});
function probeResult(value){
 if(!plain(value)||!['observed','blocked'].includes(value.status)||!Number.isFinite(value.observed_at)||value.observed_at<0||!Array.isArray(value.observations)||value.observations.length!==2||value.automatic_retry!==false)throw Error('Current scheduler observation was not confirmed');
 const statuses=new Set(['observed','not_found','timed_out','output_limit','invalid_output','command_failed']);
 const observations=value.observations.map((item,index)=>{
  const scheduler=index===0?'slurm':'lsf';
  if(!plain(item)||item.scheduler!==scheduler||!statuses.has(item.status)||!Array.isArray(item.queues)||item.queues.length>512||item.status!=='observed'&&item.queues.length)throw Error('Current scheduler observation was not confirmed');
  const queues=item.queues.map(queue=>{
   if(!plain(queue)||typeof queue.name!=='string'||!/^[A-Za-z0-9_.+\-]{1,120}$/.test(queue.name))throw Error('Current scheduler observation was not confirmed');
   if(scheduler==='slurm'){
    if(typeof queue.default!=='boolean'||!['up','down','inact','drain'].includes(queue.availability)||!Number.isSafeInteger(queue.node_count)||queue.node_count<0||queue.node_count>10000000||typeof queue.node_state!=='string'||!/^[A-Za-z0-9_+~#*%$@.!\-]{1,40}$/.test(queue.node_state)||typeof queue.gres!=='string'||!/^[A-Za-z0-9_:.,()+/\-]{0,160}$/.test(queue.gres))throw Error('Current scheduler observation was not confirmed');
    return {name:queue.name,default:queue.default,availability:queue.availability,node_count:queue.node_count,node_state:queue.node_state,gres:queue.gres};
   }
   if(!/^(?:open|closed):(?:active|inact)$/.test(queue.availability))throw Error('Current scheduler observation was not confirmed');
   return {name:queue.name,availability:queue.availability};
  });
  return {scheduler,status:item.status,queues};
 });
 if((observations.some(item=>item.status==='observed')?'observed':'blocked')!==value.status)throw Error('Current scheduler observation was not confirmed');
 return {status:value.status,observed_at:value.observed_at,observations,automatic_retry:false,scope:'Current login-host scheduler and visible queues only; not_found means absent on this bridge PATH, not proof that software is uninstalled. Compute-node GPU availability, execution authorization and scientific validation not_run'};
}

export function createComputeResourceInspection({worker,resource,service,connections}){
 const tools=()=>[{name:NAME,description:'Inspect the actual selected SSH job service and its current conversation grant, independent of workflow creation. list_clusters lists saved scheduler profiles inside this service, not SSH login sessions; an empty list does not mean disconnected or unshared. With probe_scheduler:true, perform fixed bounded read-only Slurm/LSF and visible-queue observations on this already authenticated host through the service bridge. No raw terminal, second SSH login, registration, submission or worker update. Use this for questions about the currently connected cluster.',annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:{type:'object',properties:{probe_scheduler:{type:'boolean',description:'Observe current login-host scheduler and visible queues; use only when the user has requested this read-only probe.'}},additionalProperties:false}}];
 async function call(name,args,scope){
  if(name!==NAME||!plain(args)||Object.keys(args).some(key=>key!=='probe_scheduler')||args.probe_scheduler!==undefined&&typeof args.probe_scheduler!=='boolean')throw Error('Invalid selected compute inspection request');
  const binding=resource(),controller=service(),channel=connections(),selected=binding?.peek(),snapshot=controller?.peek(),connection=worker.connection;
  if(!selected||!snapshot||!connection)fail();
  const ticket=binding.capture(),expected=identity(snapshot.health),attempt=snapshot.attemptId,workerIdentity=structuredClone(worker.identity),workerTarget=structuredClone(worker.connectionTarget);
  function fresh(){
   let current=false;try{current=scope?.checkCurrent?.()===true;}catch{}
   const choice=binding.peek(),state=controller.peek();
   if(!current||!scope.provider||!scope.threadId||!same(choice,selected)||choice.schemaVersion!==2||choice.kind!=='ssh-connection'||state.status!=='connected'||state.workflowReady!==true||state.connectionId!==choice.connectionId||state.profileId!==choice.profileId||state.profileVersion!==choice.profileVersion||state.attemptId!==attempt||worker.connection!==connection||!same(worker.identity,workerIdentity)||!same(worker.connectionTarget,workerTarget)||worker.identity?.kind!=='ssh'||worker.identity.version!==3||worker.identity.connectionId!==choice.connectionId||worker.identity.profileId!==choice.profileId||worker.identity.profileVersion!==choice.profileVersion||worker.connectionTarget?.connectionId!==choice.connectionId||worker.connectionTarget.serviceId!==state.serviceId||!same(identity(state.health),expected)||!controller.hasCurrentGrant(scope.provider,scope))fail();
   binding.assertCurrent(ticket);
  }
  fresh();
  const health=await worker.request('GET','/api/health');fresh();
  if(health?.name!=='gpu-sampling-studio'||health.ssh_service!==true||!same(identity(health),expected))fail();
  const profiles=await worker.request('GET','/api/clusters');fresh();
  if(!Array.isArray(profiles))throw Error('Saved scheduler configuration could not be read');
  const sameHost=profiles.filter(value=>value?.transport_kind==='ssh-service-local').map(value=>{
   if(typeof value.id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(value.id)||!Number.isSafeInteger(value.version)||value.version<1||!['slurm','lsf'].includes(value.scheduler))throw Error('Saved scheduler configuration could not be read');
   return {id:value.id,version:value.version,scheduler:value.scheduler};
  });
  const base=await channel.state({connectionId:selected.connectionId});fresh();if(base?.schemaVersion!==2||base.connectionId!==selected.connectionId||base.profileId!==selected.profileId||base.profileVersion!==selected.profileVersion||base.status!=='authenticated'||base.authentication!=='verified')fail();
  const view=await channel.serviceState({connectionId:selected.connectionId,serviceId:snapshot.serviceId});fresh();
  const assertView=value=>{if(value?.status!=='connected'||value.serviceActive!==true||value.connectionId!==selected.connectionId||value.profileId!==selected.profileId||value.profileVersion!==selected.profileVersion||value.attemptId!==attempt||typeof value.serviceId!=='string'||value.serviceId!==snapshot.serviceId||!same(identity(value.service),expected))fail();};
  assertView(view);
  const capable=Array.isArray(view.service?.bridge_capabilities)&&view.service.bridge_capabilities.includes(CAPABILITY);
  let observation={status:'not_run',automatic_retry:false};
  if(args.probe_scheduler===true){
   if(!capable)observation={status:'requires_new_attachment',operation_state:'not_started',automatic_retry:false,next_step:'This verified service uses an older bridge. Keep the authenticated connection and independent shell unchanged; the human may explicitly detach and attach only the service channel to load the shipped inspection capability. Do not reconnect or update the worker automatically.'};
   else{
    fresh();const response=await channel.serviceRequest({connectionId:selected.connectionId,serviceId:view.serviceId,requestId:randomUUID(),method:'POST',target:TARGET,data:{},mcp:false,timeoutMs:15000});fresh();
    const after=await channel.serviceState({connectionId:selected.connectionId,serviceId:view.serviceId});fresh();assertView(after);
    if(after.serviceId!==view.serviceId||!same(after.service?.bridge_capabilities,view.service?.bridge_capabilities)||response?.status!==200)throw Error('Current scheduler observation was not confirmed; no request was replayed');
    observation=probeResult(response.data);
   }
  }
  fresh();
  return {resource:{kind:'ssh_job_service',selected:true,status:'ready',authentication:'verified',agent_access:'granted',raw_terminal_required:false,shell_channel:'independent',shell_authorization:'separately_managed'},scheduler:{registration:sameHost.length?'configured':'missing',profiles:sameHost,inspection_supported:capable,observation},interpretation:'The selected authenticated service is available to this conversation. Its shell is an independent channel with its own input grant. list_clusters describes saved scheduler configurations in that service, not SSH login or shared terminal availability. A missing scheduler registration does not mean the SSH login failed.',next_step:args.probe_scheduler===true?observation.status==='requires_new_attachment'?observation.next_step:'Use only these observed queue facts. Saving a submission configuration and authorizing a project are separate reviewed steps in the current connection settings. Do not create a workflow just to discover queues.':'For a user-requested queue check, call inspect_compute_resource with probe_scheduler:true. No new workflow or repeated SSH authentication is needed.',scientific_validation:'not_run'};
 }
 return {tools,call};
}
