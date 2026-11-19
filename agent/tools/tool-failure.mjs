const managedRecovery=new Map([
 ['managed_compute_user_instruction_required',['resource_selection_required','List the hosted resources and ask which resource the user means. This concerns the current conversation’s target. The listed SSH connection is already authenticated; use its published resource and acquire_compute_resource.']],
 ['managed_compute_resource_lease_required',['resource_lease_required','List the available compute resources and acquire the intended resource for this conversation, then use the returned session or service. A workflow is optional.']],
 ['managed_compute_invalid_request',['invalid_input','Use one advertised selector for acquisition: resource_id, profile_id, or alias. Use the identity returned by this conversation’s tools.']],
 ['managed_compute_no_eligible_resource',['access_required','Check the published resources and their actual access in the resource manager. A missing project grant is separate from the SSH login.']],
 ['managed_compute_project_required',['project_required','For a tracked worker job, select a project authorized on this original service. Queue inspection and authorized operations in the conversation terminal are available in ordinary chat.']],
 ['ssh_service_registration_required',['service_setup_required','Open the original resource settings and prepare its job service. Its authorized terminal can still be used.']],
 ['ssh_service_maintenance_required',['service_setup_required','Inspect the registered job service on the original resource. Updating it requires the explicit update action.']],
 ['managed_compute_worker_update_required',['capability_required','Inspect the original worker version and its advertised capabilities. Update through its resource settings to use this operation.']],
 ['managed_compute_worker_request_failed',['observation_unavailable','Read the project and service health again on the original worker before making any permission change.']],
 ['managed_compute_private_service_unavailable',['connection_unavailable','Check the job service on the original resource. Use its authorized terminal to diagnose the connection.']],
 ['managed_compute_project_grant_required',['access_required','Check the current project on its original worker. Project permissions can be changed only in the trusted desktop settings.']],
 ['managed_schedule_task_delegation_required',['access_required','Check the user’s requested schedule purpose in this workflow and confirm any additional action with the user.']],
]);

// Tool-level failures stay on the MCP channel so the Agent can correct its next
// action. This is guidance only: no retry, resource grant or dispatch occurs here.
export function toolFailure(error,{dispatched=false}={}){
 const message=String(error?.message||error||'Tool request failed').slice(0,4000);
 if(error?.operationNotStarted===true)dispatched=false;
 let code='tool_error',next_step='Inspect the tool details and correct the request before continuing.';
 if(managedRecovery.has(message)){
  [code,next_step]=managedRecovery.get(message);
 }else if(/unknown (?:tool|project|environment)|not (?:bound|belong)|conversation-owned|active conversation|another conversation/i.test(message)){
  code='context_required';next_step='Read the current conversation workflow and its registered project/environment. Use those identities; do not create a replacement workflow or broaden access.';
 }else if(/stale|hash|newer human|existing graph in place|saved canonical|reload/i.test(message)){
  code='input_changed';next_step='Read the latest saved workflow and input hashes, preserve human edits, then update that same workflow. Do not reuse a stale preparation.';
 }else if(/permission|sharing|unshared|not authorized|not allowed|protected private|outside this workflow/i.test(message)){
  code='access_required';next_step='Use inputs already available to this conversation. If a specific file or resource is needed, describe it to the user; do not change access settings through tools.';
 }else if(/connect|disconnected|fetch failed|ECONN|timed? ?out|timeout/i.test(message)){
  code='connection_unavailable';next_step='Reconnect the service, then inspect the existing workflow or run status. Do not replay a write or submit operation whose result is unknown.';
 }else if(/required|invalid|missing|expected|must |请选择|参数|缺少/i.test(message)){
  code='invalid_input';next_step='Read the tool schema or engine contract and fill technical fields from the current workflow. Ask the user only for unresolved scientific choices.';
 }
 return {content:[{type:'text',text:JSON.stringify({status:dispatched?'unknown':code==='tool_error'?'failed':'blocked',code,message,next_step,operation_state:dispatched?'unconfirmed':'not_started',automatic_retry:false})}],isError:true};
}

export function toolValueResult(value){
 return {content:[{type:'text',text:JSON.stringify(value)??'null'}],isError:['blocked','permission_required','failed','unknown'].includes(value?.status)};
}

export function validToolCall(body){
 return body?.method==='tools/call'&&typeof body.params?.name==='string'&&body.params.name.length>0&&
  (body.params.arguments===undefined||body.params.arguments!==null&&typeof body.params.arguments==='object'&&!Array.isArray(body.params.arguments));
}

export function validRpcRequest(body){
 return body?.jsonrpc==='2.0'&&(typeof body.id==='string'||Number.isSafeInteger(body.id));
}

export function validToolResponse(body,id){
 if(!body||body.jsonrpc!=='2.0'||body.id!==id||Object.hasOwn(body,'result')===Object.hasOwn(body,'error'))return false;
 if(Object.hasOwn(body,'error'))return body.error&&Number.isInteger(body.error.code)&&typeof body.error.message==='string';
 const value=body.result;
 return !!value&&Array.isArray(value.content)&&(value.isError===undefined||typeof value.isError==='boolean')&&value.content.every(item=>item&&typeof item==='object'&&typeof item.type==='string'&&(item.type!=='text'||typeof item.text==='string'));
}
