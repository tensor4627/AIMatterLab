import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {createVerifiedWorkerScope} from '../compute/verified-worker-scope.mjs';

const INDEX='tool-workflow-index',INTENT='tool-workflow-creation';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error('Exact typed tool workflow request required');};
const token=value=>{if(typeof value!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value))throw Error('Invalid workflow identity');return value;};
const hex=value=>{if(typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value))throw Error('Exact frozen group or review hash required');return value;};
const ownerFacts=owner=>[owner?.serial,owner?.provider,owner?.threadId,owner?.taskId];
const workspaceFacts=task=>[task.workspaceChoice,task.workspace?.id,task.workspace?.root,task.workspace?.workerBinding];

/** Desktop references and human actions only. Store/Service remain the run authority. */
export function createToolWorkflowController({catalog,groups,configurations,worker,getSettings,current,currentTarget=()=>null,getTask,assertIdle,confirm,now=Date.now}){
 const scopes=createVerifiedWorkerScope({worker,getSettings,current,currentTarget,label:'Workflow'});
 function taskFor(taskId){
  token(taskId);const task=getTask(taskId),owner=current();
  if(!task||task.id!==taskId||!equal([owner?.provider,owner?.threadId,owner?.taskId],[task.provider,task.threadId,task.id]))throw Error('Select this workflow’s original conversation first');
  if(task.workflowVersion!==2||task.workspaceChoice!=='workspace'||!task.workspace?.id||!task.workspace?.workerBinding)throw Error('Select a registered workspace for this workflow first');
  return task;
 }
 async function verified(taskId,expected){
  const task=taskFor(taskId),workspace=structuredClone(workspaceFacts(task)),owner=structuredClone(ownerFacts(current())),ticket=await scopes.verified(expected);
  const assert=()=>{ticket.assert();if(!equal(ownerFacts(current()),owner)||!equal(workspaceFacts(taskFor(taskId)),workspace))throw Error('Workflow workspace or conversation changed');};assert();
  if(!equal(task.workspace.workerBinding,ticket.binding))throw Error('Restore and explicitly reselect this workspace on its original verified service');
  if(worker.connection.health?.tool_workflow_schema!==1)throw Error('The original service does not support tool-group workflows; explicit service configuration is required');
  return {binding:ticket.binding,workspace:structuredClone(task.workspace),assert};
 }
 function reference(taskId,executionId){token(executionId);const value=catalog.get(INDEX,executionId);if(!value||value.schema_version!==1||value.task_id!==taskId)throw Error('Unknown tool workflow reference for this task');return value;}
 function note(expected,value){
  const execution=value?.execution,workflow=value?.workflow;
  if(!execution||!workflow||execution.schema_version!==1||workflow.schema_version!==2||execution.id!==expected.execution_id||workflow.id!==expected.workflow_id||execution.workflow_id!==workflow.id||execution.workspace_id!==expected.workspace_id||workflow.workspace_id!==expected.workspace_id||!equal(execution.target,expected.target)||workflow.project_id!==expected.target.project_id||!equal(execution.group,{id:expected.group_id,version:expected.group_version})||!equal(workflow.tool_group_refs,[{id:expected.group_id,version:expected.group_version}])||execution.execution_mode!=='manual_step_review'||workflow.execution_mode!=='manual_step_review'||!Number.isSafeInteger(execution.revision)||execution.revision<1||!Array.isArray(execution.steps))throw Error('Worker workflow identity, version or target differs');
  token(execution.id);token(workflow.id);
  if(execution.snapshot_sha256!==expected.snapshot_sha256)throw Error('Worker workflow snapshot identity changed');
  const bindings=execution.steps.map(step=>({id:step.id,tool_id:step.tool_id,package_version:step.package_version,function_id:step.function_id,configuration_id:step.configuration_id,execution_skill_id:step.execution_skill_id}));
  if(!equal(bindings,expected.step_bindings))throw Error('Worker step configuration or execution skill differs from the frozen selection');
  return catalog.transaction(()=>{
   const fresh=catalog.get(INDEX,execution.id);
   if(fresh&&(!equal([fresh.execution_id,fresh.workflow_id,fresh.task_id,fresh.workspace_id,fresh.worker_binding,fresh.group_id,fresh.group_version,fresh.target,fresh.step_bindings,fresh.snapshot_sha256,fresh.creation_request_id,fresh.request_sha256],[expected.execution_id,expected.workflow_id,expected.task_id,expected.workspace_id,expected.worker_binding,expected.group_id,expected.group_version,expected.target,expected.step_bindings,expected.snapshot_sha256,expected.creation_request_id,expected.request_sha256])||execution.revision<fresh.last_revision))throw Error('Late or changed workflow authority reply');
   catalog.put(INDEX,execution.id,{...expected,...fresh,last_revision:execution.revision});return value;
  });
 }
 async function request(value,route,extra={}){
  const expected=reference(value.task_id,value.execution_id),ticket=await verified(value.task_id,expected.worker_binding);
  if(ticket.workspace.id!==expected.workspace_id)throw Error('Restore this workflow’s original workspace before operating its steps');
  const result=await worker.request('POST',route,{execution_id:value.execution_id,...extra});ticket.assert();return note(expected,result);
 }
 const listFor=taskId=>catalog.list(INDEX).filter(value=>value.task_id===taskId).map(value=>structuredClone(value));
 const intentKey=(binding,taskId,requestId)=>digest([binding,taskId,requestId]);
 const api={
  async context(value){
   exact(value,['task_id']);const ticket=await verified(value.task_id),owner_key=digest([ownerFacts(current()),currentTarget(),ticket.binding,worker.connectionEpoch,workspaceFacts(taskFor(value.task_id))]);
   return {task_id:value.task_id,owner_key,workspace_id:ticket.workspace.id,worker_binding:ticket.binding,groups:groups.list({}),configurations:configurations.list({}).filter(item=>equal(item.worker_binding,ticket.binding)),workflows:listFor(value.task_id).filter(item=>item.workspace_id===ticket.workspace.id),creations:catalog.list(INTENT).filter(item=>item.task_id===value.task_id&&item.source_request?.workspace_id===ticket.workspace.id&&equal(item.worker_binding,ticket.binding)).map(({request_id,status,name,group_id,group_version,execution_id,reason})=>({request_id,status,name,group_id,group_version,...execution_id?{execution_id}:{},...reason?{reason}:{}}))};
  },
  list(value){exact(value,['task_id']);const task=taskFor(value.task_id);return listFor(value.task_id).filter(item=>item.workspace_id===task.workspace.id);},
  async locateRun(value){
   exact(value,['run_id']);token(value.run_id);const ticket=await scopes.verified(),run=await worker.request('POST','/api/run/status',{run_id:value.run_id});ticket.assert();
   const binding=run?.studio_workflow_binding;if(run?.id!==value.run_id||binding?.schema_version!==1)throw Error('This run is not a registered tool-group workflow step');
   const expected=catalog.get(INDEX,binding.execution_id);if(!expected||expected.schema_version!==1)throw Error('The run is retained by the worker but its desktop workflow reference is unavailable');
   if(!equal(expected.worker_binding,ticket.binding))throw Error('Restore this run’s original verified job service');
   const result=await worker.request('POST','/api/workflow/read',{execution_id:expected.execution_id});ticket.assert();note(expected,result);const step=result.execution.steps.find(step=>step.id===binding.step_id);
   if(!step||step.run_id!==run.id||binding.workflow_id!==expected.workflow_id||binding.snapshot_sha256!==expected.snapshot_sha256||binding.group_id!==expected.group_id||binding.group_version!==expected.group_version||binding.configuration_id!==step.configuration_id||binding.execution_skill_id!==step.execution_skill_id)throw Error('Run binding no longer matches its frozen workflow step');
   const task=getTask(expected.task_id);if(!task?.provider||!task.threadId||task.workspace?.id!==expected.workspace_id)throw Error('Select the original conversation and workspace for this retained workflow step');
   return {task_id:task.id,provider:task.provider,thread_id:task.threadId,conversation_id:task.provider+':'+task.threadId,workspace_id:expected.workspace_id,workflow_id:expected.workflow_id,execution_id:expected.execution_id,step_id:step.id,run_id:run.id};
  },
  async create(value){
   exact(value,['task_id','workspace_id','name','directory_name','group_id','group_version','configurations','request_id']);assertIdle();token(value.request_id);token(value.group_id);hex(value.group_version);
   if(typeof value.name!=='string'||!value.name.trim()||value.name.length>80||/[\x00-\x1f]/.test(value.name)||typeof value.directory_name!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(value.directory_name)||!Array.isArray(value.configurations)||!value.configurations.length||value.configurations.length>128)throw Error('Choose a bounded workflow name, directory and explicit configurations');
   const ticket=await verified(value.task_id);if(ticket.workspace.id!==value.workspace_id)throw Error('Selected workspace changed');
   const frozen=groups.read({id:value.group_id,version:value.group_version});if(!frozen.has_frozen_version||frozen.version!==value.group_version||!frozen.definition_text)throw Error('Explicitly save and freeze this group before creating a workflow');
   const selected=new Map(),authorities=new Map();let target;
   const registered=configurations.list({});
   for(const item of value.configurations){
    exact(item,['step_id','configuration_id']);token(item.step_id);token(item.configuration_id);if(selected.has(item.step_id)||!frozen.compiled.steps.some(step=>step.id===item.step_id))throw Error('Duplicate or unknown group step');
    const reference=registered.find(entry=>entry.configuration_id===item.configuration_id);if(!reference||!equal(reference.worker_binding,ticket.binding))throw Error('Restore the original service for every selected configuration');
    const configured=await configurations.read({configuration_id:item.configuration_id});ticket.assert();const step=frozen.compiled.steps.find(step=>step.id===item.step_id);
    if(configured.status!=='active'||!configured.execution_skill||configured.package_id!==step.tool_id||configured.package_version!==step.package_version||!configured.functions.some(feature=>feature.id===step.function_id))throw Error('Select an active exact package/function configuration for every step');
    if(target&&!equal(target,configured.target))throw Error('Every group step must use the same explicitly authorized project and environment');target=structuredClone(configured.target);selected.set(item.step_id,structuredClone(item));authorities.set(item.step_id,configured.execution_skill.id);
   }
   if(selected.size!==frozen.compiled.steps.length)throw Error('Every frozen group step needs its own selected configuration');
   const body={request_id:value.request_id,name:value.name.trim(),directory_name:value.directory_name,workspace_id:value.workspace_id,target,tool_groups:[{id:value.group_id,version:value.group_version,definition_text:frozen.definition_text}],configurations:frozen.compiled.execution_order.map(id=>selected.get(id))},key=intentKey(ticket.binding,value.task_id,value.request_id),identity=digest(body),previous=catalog.get(INTENT,key);
   if(previous&&previous.request_sha256!==identity)throw Error('Creation request already belongs to a different workflow');
   if(previous?.execution_id)return api.read({task_id:value.task_id,execution_id:previous.execution_id});
   ticket.assert();catalog.put(INTENT,key,{schema_version:1,id:key,task_id:value.task_id,worker_binding:ticket.binding,request_id:value.request_id,name:body.name,group_id:value.group_id,group_version:value.group_version,status:'creating',request_sha256:identity,source_request:structuredClone(value),created_at:previous?.created_at??now()});
   try{
    const result=await worker.request('POST','/api/workflow/tool-group/create',body);ticket.assert();token(result?.execution?.id);token(result?.workflow?.id);
    const step_bindings=frozen.compiled.execution_order.map(id=>{const step=frozen.compiled.steps.find(step=>step.id===id);return {id,tool_id:step.tool_id,package_version:step.package_version,function_id:step.function_id,configuration_id:selected.get(id).configuration_id,execution_skill_id:authorities.get(id)};});
    hex(result.execution.snapshot_sha256);
    const expected={schema_version:1,execution_id:result.execution.id,workflow_id:result.workflow.id,task_id:value.task_id,workspace_id:value.workspace_id,name:body.name,group_id:value.group_id,group_version:value.group_version,target,worker_binding:ticket.binding,step_bindings,snapshot_sha256:result.execution.snapshot_sha256,creation_request_id:value.request_id,request_sha256:identity,created_at:now(),last_revision:0};
    const reply=note(expected,result);catalog.put(INTENT,key,{...catalog.get(INTENT,key),status:'created',execution_id:expected.execution_id});return reply;
   }catch(error){const fresh=catalog.get(INTENT,key);if(fresh?.status!=='created')catalog.put(INTENT,key,{...fresh,status:'unknown',reason:String(error.message||error).slice(0,2000)});throw error;}
  },
  async retryCreate(value){exact(value,['task_id','request_id']);assertIdle();token(value.request_id);const ticket=await verified(value.task_id),intent=catalog.get(INTENT,intentKey(ticket.binding,value.task_id,value.request_id));if(!intent?.source_request)throw Error('Unknown original workflow creation request');return api.create(structuredClone(intent.source_request));},
  async prepareStep(value){exact(value,['task_id','execution_id','step_id','expected_revision','request_id']);assertIdle();token(value.step_id);token(value.request_id);if(!Number.isSafeInteger(value.expected_revision)||value.expected_revision<1)throw Error('Read the current workflow revision');return request(value,'/api/workflow/prepare-step',{step_id:value.step_id,expected_revision:value.expected_revision,request_id:value.request_id});},
  async executeStep(value,event){
   exact(value,['task_id','execution_id','step_id','expected_revision','review_sha256']);assertIdle();token(value.step_id);hex(value.review_sha256);
   const expected=reference(value.task_id,value.execution_id),ticket=await verified(value.task_id,expected.worker_binding);
   if(ticket.workspace.id!==expected.workspace_id)throw Error('Restore this workflow’s original workspace before executing a step');
   const status=await worker.request('POST','/api/workflow/status',{execution_id:value.execution_id});ticket.assert();note(expected,status);
   const step=status.execution.steps.find(step=>step.id===value.step_id);if(status.execution.revision!==value.expected_revision||step?.status!=='prepared'||step.review?.review_sha256!==value.review_sha256)throw Error('Prepared step or review changed; inspect the same existing run again');
   if(!await confirm({workflow:status.workflow,execution:status.execution,step},event)){ticket.assert();return {...status,cancelled:true};}ticket.assert();assertIdle();
   return request(value,'/api/workflow/execute-step',{step_id:value.step_id,expected_revision:value.expected_revision,review_sha256:value.review_sha256});
  },
  status(value){exact(value,['task_id','execution_id']);return request(value,'/api/workflow/status');},
  read(value){exact(value,['task_id','execution_id']);return request(value,'/api/workflow/read');}
 };
 return api;
}

export function registerToolWorkflowRoutes({handle,controller}){
 for(const method of ['context','list','locateRun','create','retryCreate','prepareStep','status','read'])handle('tools.workflows.'+method,value=>controller[method](value));
 handle('tools.workflows.executeStep',(value,event)=>controller.executeStep(value,event));
}
