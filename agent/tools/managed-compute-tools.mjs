import {createHash} from 'node:crypto';
import path from 'node:path';
import {scheduleOwnerId} from '../../contracts/compute/schedule-owner.mjs';

const id={type:'string',minLength:1,maxLength:200};
const finiteInteger=(minimum,maximum)=>({type:'integer',minimum,maximum});
const schema=(properties,required)=>({type:'object',properties,required,additionalProperties:false});
const tool=(name,description,inputSchema,readOnlyHint=false)=>({name,description,inputSchema,annotations:{readOnlyHint}});
const runRef={resource_id:id,run_id:id};
const scheduleRef={resource_id:id,schedule_id:id};
const kinds=['poll','action','script','wake_agent'];
const runActions=new Map([
 ['validate_compute_run','validate'],['submit_compute_run','submit'],['cancel_compute_run','cancel']
]);
const prepareFields={
 name:id,engine:id,idempotency_key:{type:'string',minLength:1,maxLength:128},
 max_seconds:finiteInteger(1,2147483647),inputs:{type:'object',additionalProperties:{type:'string'},maxProperties:128},
 parameters:{type:'object',additionalProperties:true,maxProperties:256}
};

const definitions=[
 tool('inspect_compute_service','Inspect the exact resource leased by this conversation, including in ordinary chat. Use probe_scheduler:true for a requested bounded observation of visible queues. Worker project grants are separate from host login and queue inspection.',schema({resource_id:id,probe_scheduler:{type:'boolean'}},['resource_id']),true),
 tool('prepare_compute_run','Prepare an independent job in ordinary chat or a workflow draft on the acquired service. Use an authorized project and target. Standalone input paths are on that worker: paths relative to the project inputs directory or absolute paths under its granted roots.',schema({
  resource_id:id,kind:{enum:['run','cluster-run']},
  spec:schema({...prepareFields,environment_id:id,gpu:finiteInteger(0,65535),cluster_id:id,resources:schema({queue:id,queue_target_id:id,account:id,qos:id,cpus:finiteInteger(1,2147483647),gpus:finiteInteger(0,2147483647),memory_mb:finiteInteger(1,2147483647)},[])},['engine','max_seconds','inputs','idempotency_key'])
 },['resource_id','kind','spec'])),
 tool('read_compute_run_status','Observe one run linked to this conversation or its workflow on the acquired service.',schema(runRef,['resource_id','run_id']),true),
 tool('read_compute_run_log','Read a bounded log from one run linked to this conversation or its workflow on the acquired service.',schema({...runRef,name:{enum:['console.log','queue.out','queue.err']},offset:finiteInteger(0,Number.MAX_SAFE_INTEGER)},['resource_id','run_id','name']),true),
 tool('validate_compute_run','Validate one linked immutable run on its original acquired service when the user explicitly requests a check.',schema(runRef,['resource_id','run_id'])),
 tool('submit_compute_run','Submit one linked draft on its original acquired service when the user explicitly requests execution. Observe the original run after an uncertain response.',schema(runRef,['resource_id','run_id'])),
 {...tool('cancel_compute_run','Request cancellation of one linked run on its original acquired service when the user explicitly requests cancellation. Read status to confirm the result.',schema(runRef,['resource_id','run_id'])),annotations:{readOnlyHint:false,destructiveHint:true}},
 tool('list_task_schedules','List schedules owned by this conversation or its workflow on the acquired service.',schema({resource_id:id},['resource_id']),true),
 tool('task_schedule_status','Read the status of one schedule owned by this conversation or its workflow.',schema(scheduleRef,['resource_id','schedule_id']),true),
 tool('stop_task_schedule','Stop future occurrences of one schedule owned by this conversation or its workflow.',schema(scheduleRef,['resource_id','schedule_id'])),
 tool('attach_task_schedule','Create or revise a bounded schedule on the acquired service for this conversation or its workflow. Supply an authorized linked run for poll, action and script. A wake_agent schedule wakes this conversation at the requested interval. Expiry is Unix time in seconds.',schema({
  ...runRef,kind:{enum:kinds},key:id,name:id,schedule_id:id,mutation_id:id,expected_revision:finiteInteger(0,Number.MAX_SAFE_INTEGER),interval_seconds:finiteInteger(1,2147483647),max_runs:finiteInteger(1,336),expires_at:finiteInteger(1,253402300799),timeout_seconds:finiteInteger(1,2147483647),
  action:schema({type:{enum:['status','read_log']},name:{enum:['console.log','queue.out','queue.err']},offset:finiteInteger(0,Number.MAX_SAFE_INTEGER)},['type']),
  script:schema({language:{enum:['bash','python']},text:{type:'string',minLength:1,maxLength:65536},resources:schema({cpus:finiteInteger(1,2147483647),gpus:finiteInteger(0,2147483647),memory_mb:finiteInteger(1,2147483647)},[])},['language','text']),
  wake_text:{type:'string',minLength:1,maxLength:2048}
 },['resource_id','kind','mutation_id']))
];
export const MANAGED_SERVICE_TOOL_NAMES=Object.freeze(definitions.map(value=>value.name));
const byName=new Map(definitions.map(value=>[value.name,value.inputSchema]));
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
function valid(value,rules){
 if(rules.enum)return rules.enum.includes(value);
 if(rules.type==='string')return typeof value==='string'&&value.length>=rules.minLength&&value.length<=rules.maxLength&&!value.includes('\0');
 if(rules.type==='integer')return Number.isSafeInteger(value)&&value>=rules.minimum&&value<=rules.maximum;
 if(rules.type==='boolean')return typeof value==='boolean';
 if(!record(value)||rules.maxProperties&&Object.keys(value).length>rules.maxProperties)return false;
 if(rules.additionalProperties===true)return true;
 if(rules.additionalProperties?.type==='string')return Object.entries(value).every(([key,item])=>key.length<=512&&typeof item==='string'&&item.length<=4096);
 return rules.required.every(key=>Object.hasOwn(value,key))&&Object.entries(value).every(([key,item])=>Object.hasOwn(rules.properties,key)&&valid(item,rules.properties[key]));
}
const logTools={run:'read_log','cluster-run':'cluster_read_log'};
const statusTools={run:'run_status','cluster-run':'cluster_run_status'};
const scheduleOwner=(item,sourceId,scope)=>item.sourceId===sourceId&&['provider','threadId','taskId','projectId'].every(key=>item.scope?.[key]===scope[key]);
const deny=message=>Object.assign(Error(message),{operationNotStarted:true});

function observedRun(value,{kind,runId,projectId}){
 if(!record(value)||value.id!==runId||value.project_id!==projectId||typeof value.status!=='string'||!value.status||value.status.length>64)throw Error('The observed run does not match this project and original service');
 if(kind==='cluster-run'&&value.kind!==undefined&&value.kind!=='cluster-run'||kind==='run'&&value.kind==='cluster-run')throw Error('The worker returned a different run kind');
 const bounded=value=>typeof value==='string'&&value.length>0&&value.length<=128?value:null;
 return {id:value.id,kind,status:value.status,job_id:bounded(value.job_id),
  ...(record(value.validation)?{validation:{status:bounded(value.validation.status)}}:{}),
  ...(record(value.execution_check)?{execution_check:{status:bounded(value.execution_check.status),required:value.execution_check.required===true}}:{}),
  ...(record(value.cancellation)?{cancellation:{status:bounded(value.cancellation.status)}}:{}),
  ...(typeof value.cancel_requested==='boolean'?{cancel_requested:value.cancel_requested}:{})};
}
function requiresWorkflowReview(task,runId){
 return !!(task.customCv?.id||task.composition||task.inputBinding||task.consumerArtifact||task.consumerStage||task.roadmap||task.deployment?.prepared?.artifactId===runId);
}

/** The model selects an acquired resource and operation. Main supplies every owner and worker identity. */
export function createManagedComputeTools({resources,schedules,assertWorkflow,authorizeTask=async()=>{},assertScheduleIntent,assertRunIntent,assertRunSource,onRunObserved=()=>{}}){
 function scheduleIntent(scope,operation,args){
  try{
   const delegation=assertScheduleIntent?.(scope,operation,args);
   if(typeof delegation!=='string'||!delegation)throw deny('managed_schedule_task_delegation_required');
   return delegation;
  }catch(error){throw Object.assign(error,{operationNotStarted:true});}
 }
 async function checkedOwner(scope,resourceId){
  if(scope?.checkCurrent?.()!==true||!scope.threadId)throw deny('managed_compute_context_changed');
  const task=scope.taskId?assertWorkflow(scope):null;
  if(task)await authorizeTask(task,scope,resourceId);
  const assertCurrent=()=>{if(scope.checkCurrent()!==true||task&&assertWorkflow(scope).id!==task.id)throw Error('managed_compute_context_changed');};
  assertCurrent();
  return {task,assertCurrent};
 }
 async function checkedSource(scope,resourceId){
  const {task,assertCurrent}=await checkedOwner(scope,resourceId);
  if(!scope.projectId)throw deny('managed_compute_project_required');
  const service=await resources.resolveService(scope,resourceId);
  assertCurrent();
  if(typeof service?.sourceId!=='string'||!service.sourceId)throw Error('managed_compute_service_changed');
  return {task,service,sourceId:service.sourceId,assertCurrent};
 }
 function runKind({task,scope,runId,sourceId,resourceId}){
  const kind=assertRunSource?.({task,scope,runId,sourceId,resourceId});
  if(!['run','cluster-run'].includes(kind))throw Error('Select an exact run linked to this conversation and original service');
  return kind;
 }
 function runInputs(task,scope,inputs,service){
  const relative=value=>typeof value==='string'&&value.length>0&&!value.includes('\\')&&!value.includes('\0')&&!value.startsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
  if(!task){
   return Object.fromEntries(Object.entries(inputs).map(([name,file])=>{
    if(!relative(name)||!relative(file.startsWith('/')?file.slice(1):file))throw deny('Use a file under an input root authorized on this worker');
    if(!file.startsWith('/')&&!service.projectInputRoot)throw deny('The original worker project input directory is unavailable');
    return [name,file.startsWith('/')?file:path.posix.join(service.projectInputRoot,file)];
   }));
  }
  const candidateFiles=[...(task.parameters?.files||[]),...(task.authoring?.generatedInputs||[]),...(task.authoring?.compositionFiles||[]),...(task.authoring?.imports||[]).filter(row=>row.status==='passed').map(row=>row.path)];
  const selected=new Set(candidateFiles.map(value=>scope.inputRoot&&typeof value==='string'&&value.startsWith(scope.inputRoot+'/')?path.posix.relative(scope.inputRoot,value):value).filter(relative));
  if(!Object.entries(inputs).every(([name,file])=>relative(name)&&relative(file)&&selected.has(file)))throw Error('Run inputs must be selected or generated for this exact workflow');
  return inputs;
 }
 async function callWorker(scope,resourceId,assertCurrent,name,args){
  const rpcId='managed-run-operation',data={jsonrpc:'2.0',id:rpcId,method:'tools/call',params:{name,arguments:args}};
  const response=await resources.serviceRequest(scope,{resourceId,method:'POST',target:'/mcp',mcp:true,data,timeoutMs:20000,checkCurrent:assertCurrent});
  assertCurrent();
  if(response?.status!==200||response.data?.id!==rpcId||response.data.error||response.data.result?.isError)throw Error('The original worker did not confirm the requested run operation');
  const blocks=response.data.result?.content,text=Array.isArray(blocks)&&blocks.length===1&&blocks[0].type==='text'&&blocks[0].text;
  if(typeof text!=='string'||Buffer.byteLength(text)>256*1024)throw Error('The worker reply exceeds the run tool limit');
  try{return JSON.parse(text);}catch{throw Error('The worker returned an invalid run receipt');}
 }
 async function call(name,args,scope){
  if(resources.owns(name))return resources.callTool(name,args,scope);
  const shape=byName.get(name);
  if(!shape||!valid(args,shape))throw deny('Invalid managed compute tool arguments');
  if(name==='inspect_compute_service'){
   const {assertCurrent}=await checkedOwner(scope,args.resource_id);
   const result=await resources.inspectService(scope,args.resource_id,{probeScheduler:args.probe_scheduler===true});
   assertCurrent();return result;
  }
  const {task,service,sourceId,assertCurrent}=await checkedSource(scope,args.resource_id).catch(error=>{
   // Only read-only checks have run for this tool operation.
   throw Object.assign(error,{operationNotStarted:true});
  });
  const {resource_id:resourceId,run_id:runId,schedule_id:scheduleId}=args;
  const anchor=id=>runKind({task,scope,runId:id,sourceId,resourceId});
  if(name==='prepare_compute_run'){
   const {kind,spec}=args,cluster=kind==='cluster-run';
   if(cluster?!(service.clusterIds||[]).includes(spec.cluster_id)||spec.environment_id!==undefined||spec.gpu!==undefined:!(service.environmentIds||[]).includes(spec.environment_id)||spec.gpu===undefined||spec.cluster_id!==undefined||spec.resources!==undefined)throw Error('Choose the matching authorized environment or cluster and its required run parameters');
   const inputs=runInputs(task,scope,spec.inputs,service);
   const idempotency_key=createHash('sha256').update(JSON.stringify([scope.provider,scope.threadId,scope.taskId,scope.projectId,sourceId,spec.idempotency_key])).digest('hex');
   const value=await callWorker(scope,resourceId,assertCurrent,cluster?'prepare_cluster_run':'prepare_run',{spec:{...spec,inputs,project_id:scope.projectId,idempotency_key}});
   if(!record(value)||typeof value.id!=='string'||value.project_id!==scope.projectId||!['prepared','draft','needs_auth','needs_human_auth'].includes(value.status))throw Error('The original worker did not return an exact prepared draft receipt');
   if(['prepared','draft'].includes(value.status))await onRunObserved({scope,task,sourceId,resourceId,kind,runId:value.id,observation:observedRun(value,{kind,runId:value.id,projectId:scope.projectId})});
   assertCurrent();return {id:value.id,kind,status:value.status};
  }
  if(name==='read_compute_run_status'||name==='read_compute_run_log'){
   const kind=anchor(runId),readLog=name==='read_compute_run_log';
   const value=await callWorker(scope,resourceId,assertCurrent,(readLog?logTools:statusTools)[kind],{run_id:runId,...readLog?{name:args.name,offset:args.offset??0}:{}});
   anchor(runId);
   if(readLog)return value;
   const observation=observedRun(value,{kind,runId,projectId:scope.projectId});
   await onRunObserved({scope,task,sourceId,resourceId,kind,runId,observation});assertCurrent();return observation;
  }
  const runAction=runActions.get(name);
  if(runAction){
   const kind=anchor(runId);
   const checkOperation=()=>{
    assertCurrent();anchor(runId);
    if(typeof assertRunIntent!=='function')throw deny('Explicit authorized human run intent is required');
    if(task&&runAction!=='cancel'&&requiresWorkflowReview(assertWorkflow(scope),runId))throw deny('Use the reviewed workflow execution path for this run');
    if(assertRunIntent(scope,runAction,args)===false)throw deny('This run operation needs a current instruction from the user');
   };
   checkOperation();
   let value;
   try{
    value=await callWorker(scope,resourceId,checkOperation,runAction+(kind==='cluster-run'?'_cluster_run':'_run'),{run_id:runId});
   }catch(error){
    if(runAction==='submit'&&kind==='cluster-run')void schedules.refresh?.(sourceId).catch(()=>{});
    throw error;
   }
   const observation=observedRun(value,{kind,runId,projectId:scope.projectId});
   await onRunObserved({scope,task,sourceId,resourceId,kind,runId,operation:runAction,observation});
   assertCurrent();return observation;
  }
  const owner={provider:scope.provider,threadId:scope.threadId,taskId:scheduleOwnerId(scope),projectId:scope.projectId};
  const current=()=>schedules.snapshot().sources.find(source=>source.id===sourceId)?.schedules.filter(item=>scheduleOwner(item,sourceId,owner))||[];
  const operationFor=beforeScheduleDispatch=>({assertCurrent,request:async(method,target,data)=>{
   assertCurrent();
   const observed=await resources.resolveService(scope,resourceId);
   if(observed?.sourceId!==sourceId)throw deny('The acquired resource changed its original service identity');
   const result=await resources.serviceRequest(scope,{resourceId,method,target,data,checkCurrent:assertCurrent,beforeScheduleDispatch});
   assertCurrent();
   if(result?.status!==200)throw Error('The original service did not confirm the schedule request');
   return result.data;
  }});
  const recheck=(action,selection,turn)=>()=>{
   if(scheduleIntent(scope,action,selection)!==turn)throw deny('managed_schedule_task_delegation_required');
  };
  if(name==='list_task_schedules')return {schedules:current()};
  if(!service.supportsManagedSchedules)throw deny('managed_compute_worker_update_required');
  if(name==='task_schedule_status'||name==='stop_task_schedule'){
   const item=current().find(value=>value.id===scheduleId);
   if(!item)throw Error('This schedule is not registered to this conversation on the original service');
   if(item.scope.runId)anchor(item.scope.runId);
   const stopping=name==='stop_task_schedule';
   const confirm=stopping?recheck('stop',args,scheduleIntent(scope,'stop',args)):undefined;
   const result=await schedules[stopping?'stop':'status']({sourceId,scheduleId},operationFor(confirm));
   assertCurrent();return result;
  }
  const {kind,key:requestedKey,name:displayName,mutation_id:mutationId,expected_revision:expectedRevision,interval_seconds:intervalSeconds,max_runs:maxRuns,expires_at:expiresAt,timeout_seconds:timeoutSeconds,action,script,wake_text:wakeText}=args;
  const editing=expectedRevision!==undefined||scheduleId!==undefined,previous=editing&&current().find(item=>item.id===scheduleId&&item.revision===expectedRevision);
  if(editing&&(!previous||previous.kind!==kind||requestedKey!==undefined&&requestedKey!==previous.key||runId!==undefined&&runId!==previous.scope.runId||typeof previous.delegationId!=='string'))throw Error('Read the current schedule and use its exact ID and revision when editing');
  const targetRun=runId??previous?.scope.runId??null,key=requestedKey??previous?.key;
  if(kind!=='wake_agent'||targetRun)anchor(targetRun);
  if(!editing&&(kind==='wake_agent'&&!wakeText||kind==='action'&&!action||kind==='script'&&(!script||!key)))throw Error('Schedule payload does not match the selected operation');
  const effectiveIntent=kind==='action'&&action===undefined&&previous?{...args,action:previous.action}:args;
  const intent=scheduleIntent(scope,'upsert',effectiveIntent),delegationId=previous?previous.delegationId:intent;
  const request=Object.fromEntries(Object.entries({sourceId,scope:{...owner,runId:targetRun},kind,key,name:displayName,mutationId,expectedRevision,intervalSeconds,maxRuns,expiresAt,timeoutSeconds,action,script,wakeText,delegationId}).filter(([,value])=>value!==undefined));
  const result=await schedules.upsert(request,operationFor(recheck('upsert',effectiveIntent,intent)));
  assertCurrent();return result;
 }
 return {tools:()=>[...resources.tools(),...definitions],owns:name=>resources.owns(name)||byName.has(name),call};
}
