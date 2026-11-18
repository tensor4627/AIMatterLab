import {createHash} from 'node:crypto';
import path from 'node:path';

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
 tool('inspect_compute_service','List the authorized registered targets on this workflow’s acquired service.',schema({resource_id:id},['resource_id']),true),
 tool('prepare_compute_run','Prepare a draft on an exact authorized target of the acquired service. Use inputs already selected for this workflow.',schema({
  resource_id:id,kind:{enum:['run','cluster-run']},
  spec:schema({...prepareFields,environment_id:id,gpu:finiteInteger(0,65535),cluster_id:id,resources:schema({queue:id,account:id,cpus:finiteInteger(1,2147483647),gpus:finiteInteger(0,2147483647),memory_mb:finiteInteger(1,2147483647)},['queue','cpus','gpus','memory_mb'])},['engine','max_seconds','inputs','idempotency_key'])
 },['resource_id','kind','spec'])),
 tool('read_compute_run_status','Observe one run linked to the current workflow on the acquired service.',schema(runRef,['resource_id','run_id']),true),
 tool('read_compute_run_log','Read a bounded log from one run linked to the current workflow on the acquired service.',schema({...runRef,name:{enum:['console.log','queue.out','queue.err']},offset:finiteInteger(0,Number.MAX_SAFE_INTEGER)},['resource_id','run_id','name']),true),
 tool('validate_compute_run','Validate one linked immutable run on its original acquired service when the user explicitly requests a check.',schema(runRef,['resource_id','run_id'])),
 tool('submit_compute_run','Submit one linked draft on its original acquired service when the user explicitly requests execution. Observe the original run after an uncertain response.',schema(runRef,['resource_id','run_id'])),
 {...tool('cancel_compute_run','Request cancellation of one linked run on its original acquired service when the user explicitly requests cancellation. Read status to confirm the result.',schema(runRef,['resource_id','run_id'])),annotations:{readOnlyHint:false,destructiveHint:true}},
 tool('list_task_schedules','List schedules owned by the current workflow on the acquired service.',schema({resource_id:id},['resource_id']),true),
 tool('task_schedule_status','Read the status of one schedule owned by the current workflow.',schema(scheduleRef,['resource_id','schedule_id']),true),
 tool('stop_task_schedule','Stop future occurrences of one schedule owned by the current workflow.',schema(scheduleRef,['resource_id','schedule_id'])),
 tool('attach_task_schedule','Create or revise a bounded schedule on the acquired service for this workflow. Supply an authorized linked run for poll, action and script. A wake_agent schedule wakes this conversation at the requested interval. Expiry is Unix time in seconds.',schema({
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
 if(!record(value)||value.id!==runId||value.project_id!==projectId||typeof value.status!=='string'||!value.status||value.status.length>64)throw Error('The observed run does not match this workflow and original service');
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
export function createManagedComputeTools({resources,schedules,assertWorkflow,authorizeTask=async()=>{},assertScheduleIntent=()=>{},assertRunIntent,assertRunSource,onRunObserved=()=>{}}){
 async function checkedSource(scope,resourceId){
  if(scope?.checkCurrent?.()!==true||!scope.threadId||!scope.taskId||!scope.projectId)throw Error('An exact current workflow tool lease is required');
  const task=assertWorkflow(scope);
  await authorizeTask(task,scope,resourceId);
  const service=await resources.resolveService(scope,resourceId);
  if(scope.checkCurrent()!==true||assertWorkflow(scope).id!==task.id||typeof service?.sourceId!=='string'||!service.sourceId)throw Error('The authorized workflow service changed');
  return {task,service,sourceId:service.sourceId,assertCurrent:()=>{if(scope.checkCurrent()!==true||assertWorkflow(scope).id!==task.id)throw Error('The workflow tool lease changed');}};
 }
 function runKind({task,scope,runId,sourceId,resourceId}){
  const kind=assertRunSource?.({task,scope,runId,sourceId,resourceId});
  if(!['run','cluster-run'].includes(kind))throw Error('Select an exact run linked to this workflow and original service');
  return kind;
 }
 function validateInputs(task,scope,inputs){
  const relative=value=>typeof value==='string'&&value.length>0&&!value.includes('\\')&&!value.includes('\0')&&!value.startsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
  const candidateFiles=[...(task.parameters?.files||[]),...(task.authoring?.generatedInputs||[]),...(task.authoring?.compositionFiles||[]),...(task.authoring?.imports||[]).filter(row=>row.status==='passed').map(row=>row.path)];
  const selected=new Set(candidateFiles.map(value=>scope.inputRoot&&typeof value==='string'&&value.startsWith(scope.inputRoot+'/')?path.posix.relative(scope.inputRoot,value):value).filter(relative));
  if(!Object.entries(inputs).every(([name,file])=>relative(name)&&relative(file)&&selected.has(file)))throw Error('Run inputs must be selected or generated for this exact workflow');
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
  if(!shape||!valid(args,shape))throw Error('Invalid managed compute tool arguments');
  const {task,service,sourceId,assertCurrent}=await checkedSource(scope,args.resource_id);
  const {resource_id:resourceId,run_id:runId,schedule_id:scheduleId}=args;
  const anchor=id=>runKind({task,scope,runId:id,sourceId,resourceId});
  if(name==='inspect_compute_service')return {resource_id:resourceId,environment_ids:service.environmentIds||[],cluster_ids:service.clusterIds||[]};
  if(name==='prepare_compute_run'){
   const {kind,spec}=args,cluster=kind==='cluster-run';
   if(cluster?!(service.clusterIds||[]).includes(spec.cluster_id)||!spec.resources||spec.environment_id!==undefined||spec.gpu!==undefined:!(service.environmentIds||[]).includes(spec.environment_id)||spec.gpu===undefined||spec.cluster_id!==undefined||spec.resources!==undefined)throw Error('Choose the matching authorized environment or cluster and its required run parameters');
   validateInputs(task,scope,spec.inputs);
   const idempotency_key=createHash('sha256').update(JSON.stringify([scope.provider,scope.threadId,scope.taskId,scope.projectId,sourceId,spec.idempotency_key])).digest('hex');
   const value=await callWorker(scope,resourceId,assertCurrent,cluster?'prepare_cluster_run':'prepare_run',{spec:{...spec,project_id:scope.projectId,idempotency_key}});
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
    if(runAction!=='cancel'&&requiresWorkflowReview(assertWorkflow(scope),runId))throw deny('Use the reviewed workflow execution path for this run');
    if(assertRunIntent(scope,runAction,args)===false)throw deny('The workflow has no current human authorization for this run operation');
   };
   checkOperation();
   const value=await callWorker(scope,resourceId,checkOperation,runAction+(kind==='cluster-run'?'_cluster_run':'_run'),{run_id:runId});
   const observation=observedRun(value,{kind,runId,projectId:scope.projectId});
   await onRunObserved({scope,task,sourceId,resourceId,kind,runId,operation:runAction,observation});
   assertCurrent();return observation;
  }
  const owner={provider:scope.provider,threadId:scope.threadId,taskId:scope.taskId,projectId:scope.projectId};
  const current=()=>schedules.snapshot().sources.find(source=>source.id===sourceId)?.schedules.filter(item=>scheduleOwner(item,sourceId,owner))||[];
  const operation={assertCurrent,request:async(method,target,data)=>{
   assertCurrent();
   const observed=await resources.resolveService(scope,resourceId);
   if(observed?.sourceId!==sourceId)throw Error('The acquired resource changed its original service identity');
   const result=await resources.serviceRequest(scope,{resourceId,method,target,data,checkCurrent:assertCurrent});
   assertCurrent();
   if(result?.status!==200)throw Error('The original service did not confirm the schedule request');
   return result.data;
  }};
  if(name==='list_task_schedules')return {schedules:current()};
  if(name==='task_schedule_status'||name==='stop_task_schedule'){
   const item=current().find(value=>value.id===scheduleId);
   if(!item)throw Error('This schedule is not registered to the current workflow on the original service');
   if(item.scope.runId)anchor(item.scope.runId);
   if(name==='stop_task_schedule')assertScheduleIntent(scope,'stop',args);
   const result=await schedules[name==='task_schedule_status'?'status':'stop']({sourceId,scheduleId},operation);
   assertCurrent();return result;
  }
  const {kind,key:requestedKey,name:displayName,mutation_id:mutationId,expected_revision:expectedRevision,interval_seconds:intervalSeconds,max_runs:maxRuns,expires_at:expiresAt,timeout_seconds:timeoutSeconds,action,script,wake_text:wakeText}=args;
  const editing=expectedRevision!==undefined||scheduleId!==undefined,previous=editing&&current().find(item=>item.id===scheduleId&&item.revision===expectedRevision);
  if(editing&&(!previous||previous.kind!==kind||requestedKey!==undefined&&requestedKey!==previous.key||runId!==undefined&&runId!==previous.scope.runId||typeof previous.delegationId!=='string'))throw Error('Read the current schedule and use its exact ID and revision when editing');
  const targetRun=runId??previous?.scope.runId??null,key=requestedKey??previous?.key;
  if(kind!=='wake_agent'||targetRun)anchor(targetRun);
  if(!editing&&(kind==='wake_agent'&&!wakeText||kind==='action'&&!action||kind==='script'&&(!script||!key)))throw Error('Schedule payload does not match the selected operation');
  const intent=assertScheduleIntent(scope,'upsert',args),delegationId=previous?previous.delegationId:intent;
  const request=Object.fromEntries(Object.entries({sourceId,scope:{...owner,runId:targetRun},kind,key,name:displayName,mutationId,expectedRevision,intervalSeconds,maxRuns,expiresAt,timeoutSeconds,action,script,wakeText,delegationId}).filter(([,value])=>value!==undefined));
  const result=await schedules.upsert(request,operation);
  assertCurrent();return result;
 }
 return {tools:()=>[...resources.tools(),...definitions],owns:name=>resources.owns(name)||byName.has(name),call};
}
