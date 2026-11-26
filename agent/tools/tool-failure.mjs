const checkSshLogin=['connection_unconfirmed','Check the original saved SSH connection. Resume a pending login and have the user handle prompts in its private terminal. Wait for verified hosting before acquiring a capability.'];
const checkSshControl=['connection_unconfirmed','The control check did not complete. Refresh the original saved SSH resource and job service. If the resource shows a verified login, retry the read on that connection. Resume a pending login only when its private terminal shows an authentication prompt. For an unconfirmed write, reconcile the original setup or job first.'];
const managedRecovery=new Map([
 ['Use the script directory designated by the user for this resource',['directory_selection_required','Use the directory the user named on this resource. If the directory is unclear, ask them to identify it in this chat.']],
 ['Invalid skill name',['invalid_input','Supply name as 1 to 64 lowercase ASCII letters, digits or hyphens, beginning with a letter. For writes, match the name in the SKILL.md front matter and supply body and expected_sha256. Use null to create a new skill.']],
 ['managed_compute_user_instruction_required',['resource_selection_required','Use a resource the user selected in the picker or directly named in this chat. If a picker is already open, wait for its answer. Report a project or login refusal only when its own receipt identifies that cause.']],
 ['managed_compute_resource_lease_required',['resource_lease_required','List the hosted resources and acquire the resource named in this chat with the required access. Then use the corresponding command tool, returned terminal or service. A workflow is optional.']],
 ['managed_compute_resource_project_changed',['resource_lease_project_changed','The existing conversation channel belongs to the earlier project context. Ask the user to release that conversation channel in Computing Resources, then reacquire the original resource for the selected project. Keep the saved SSH login and job service.']],
 ['managed_compute_resource_unavailable',['connection_unconfirmed','Refresh the hosted resource list and check the original saved connection. Use its current verified resource ID and lease. A missing entry alone leaves the reason unconfirmed.']],
 ['ssh_authentication_unconfirmed',checkSshLogin],
 ['ssh_control_timeout',checkSshControl],
 ['ssh_control_unavailable',checkSshControl],
 ['ssh_connection_not_found',checkSshLogin],
 ['ssh_workspace_unconfirmed',['workspace_unconfirmed','Check the original command receipt on the same login. Reconcile any unconfirmed write or submission before repeating it. To continue a file inspection, use a separate bounded read such as ls or find on the same resource.']],
 ['ssh_exec_unavailable',['command_channel_unavailable','The SSH endpoint refused the short command. Use a suitable capability already granted on the same resource or report the actual restriction.']],
 ['ssh_command_outcome_unconfirmed',['operation_unconfirmed','The original command may have been dispatched. Check its existing effects and any scheduler receipt before sending a new request.']],
 ['managed_compute_command_not_supported',['capability_required','Check the hosted resource and its confirmed workspace. Select an already available channel appropriate to the operation.']],
 ['ssh_master_unavailable',['connection_unconfirmed','Check the original saved SSH connection. If its loss is confirmed, the user can explicitly sign in again on that profile in the private terminal. After verified hosting, acquire the needed capability for this chat. Reconcile unknown operations by their original identity.']],
 ['managed_compute_invalid_request',['invalid_input','For acquisition, use one advertised selector: resource_id, profile_id, or alias. Set access to command for a short SSH operation, service for the registered worker, or terminal for interactive shell work.']],
 ['managed_compute_no_eligible_resource',['access_required','Read the current hosted resources and report which capability is unavailable for this request. Use any specific access or connection receipt as evidence before suggesting a change.']],
 ['managed_compute_choice_changed',['resource_selection_required','Refresh the hosted resource list and confirm the changed candidate in this chat. Keep the current requested access and use the returned resource_id after the user chooses.']],
 ['managed_compute_choice_pending',['resource_selection_required','Wait for the open resource picker and follow its target_selected.retry when the user answers.']],
 ['managed_compute_choice_interrupted',['resource_selection_required','The resource picker was closed before an answer. Continue when the user resumes this request.']],
 ['managed_compute_project_required',['project_required','For a tracked worker job, select a project authorized on this original service. Queue inspection and authorized operations in the conversation terminal are available in ordinary chat.']],
 ['ssh_service_registration_required',['service_setup_required','Open the original resource settings and prepare its job service. Its authorized terminal can still be used.']],
 ['ssh_service_maintenance_required',['service_setup_required','Inspect the registered job service on the original resource. Updating it requires the explicit update action.']],
 ['managed_compute_worker_update_required',['capability_required','Inspect the original worker version and its advertised capabilities. Update through its resource settings to use this operation.']],
 ['managed_run_user_instruction_required',['access_required','Use the exact original draft and current human instruction. For an independent new job, submit the exact draft prepared for that turn.']],
 ['managed_compute_run_intent_required',['access_required','Use the exact original draft and current human instruction.']],
 ['managed_compute_run_action_unconfirmed',['operation_unconfirmed','Check the recorded result on the exact original run before any further action.']],
 ['managed_compute_run_state_unconfirmed',['operation_unconfirmed','Check the actual status of the exact original run before continuing.']],
 ['managed_compute_worker_request_failed',['observation_unavailable','Read the project and service health again on the original worker before making any permission change.']],
 ['managed_compute_project_authentication_failed',['connection_unconfirmed','Re-verify the original job service connection before reading its project authorization.']],
 ['managed_compute_project_observation_failed',['observation_unavailable','Read project authorization again on the original verified service.']],
 ['managed_compute_project_receipt_invalid',['observation_unavailable','Inspect the project authorization response from the original worker before taking another action.']],
 ['managed_compute_private_service_unavailable',['connection_unavailable','Check the current job-service receipt on the original resource. If the request can use a private terminal there, use its separately authorized terminal lease. Service unavailability alone does not establish an SSH authentication problem.']],
 ['managed_compute_project_grant_required',['access_required','Check the denied operation, current lease and project on the original resource. A planning change alone leaves existing authorization intact. Ask for a desktop permission change only when a specific required grant is missing or revoked.']],
 ['managed_schedule_task_delegation_required',['access_required','Check the user’s requested schedule purpose in this workflow and confirm any additional action with the user.']],
 ['shared_terminal_not_granted',['access_required','This conversation has no explicitly shared manual terminal. For a hosted SSH request, use its published resource and the matching service or terminal lease.']],
]);

// Tool-level failures stay on the MCP channel so the Agent can correct its next
// action. This is guidance only: no retry, resource grant or dispatch occurs here.
export function toolFailure(error,{dispatched=false,toolName}={}){
 const message=String(error?.message||error||'Tool request failed').slice(0,4000);
 if(typeof error?.operationDispatched==='boolean')dispatched=error.operationDispatched;
 else if(error?.operationNotStarted===true)dispatched=false;
 else if(error?.terminalCleanup==='unconfirmed'||message==='ssh_command_outcome_unconfirmed')dispatched=true;
 const readOnly=error?.readOnlyOperation===true;
 const original=typeof error?.originalRunId==='string'?{run_id:error.originalRunId}:{};
 if(error?.workerFailure){
  const value=error.workerFailure;
  const observationFailed=readOnly&&value.operation_state==='unconfirmed';
  const connection=value.status==='needs_human_auth'&&error.originalRunKind==='cluster-run'&&original.run_id?
   {connection_action:{kind:'authenticate_original_run',code:'needs_human_auth',runId:original.run_id}}:{};
  return toolValueResult({...value,...original,...connection,...observationFailed?{operation_state:'read_started',status:value.status==='unknown'?'blocked':value.status,
   next_step:value.status==='needs_human_auth'?value.next_step:'Read the exact original run on its authorized service again when available.'}:{}});
 }
 let code='tool_error',next_step='Inspect the tool details and correct the request before continuing.';
 if(toolName==='acquire_compute_resource'&&['ssh_channel_unavailable','ssh_channel_refused','ssh_shell_readiness_timeout','ssh_shell_interaction_required'].includes(message)){
  code='terminal_channel_unavailable';
  next_step='The private shell was not confirmed. Keep the original hosted SSH resource and inspect the actual lease state. For a queue check, use the same resource’s service-only path when the tool offers it. Preserve an unconfirmed attempt without replay. A channel failure alone calls for neither a new login nor a manual handoff. A service lease provides no shell.';
 }else if(toolName==='run_compute_command'&&['ssh_control_timeout','ssh_control_unavailable'].includes(message)){
  code='connection_unconfirmed';
  next_step=dispatched
   ?'Check the original command receipt and any remote effects using its request ID before considering another command.'
   :'The connection check ended before this command reached the remote executor. Refresh the original hosted SSH connection and check its current state.';
 }else if(managedRecovery.has(message)){
  [code,next_step]=managedRecovery.get(message);
 }else if(/unknown (?:tool|project|environment)|not (?:bound|belong)|conversation-owned|active conversation|another conversation/i.test(message)){
  code='context_required';next_step='Read the current conversation workflow and its registered project/environment. Use those identities; do not create a replacement workflow or broaden access.';
 }else if(/stale|hash|newer human|existing graph in place|saved canonical|reload/i.test(message)){
  code='input_changed';next_step='Read the latest saved workflow and input hashes, preserve human edits, then update that same workflow. Do not reuse a stale preparation.';
 }else if(/permission|sharing|unshared|not authorized|not allowed|protected private|outside this workflow/i.test(message)){
  code='access_required';next_step='Use inputs already available to this conversation. If a specific file or resource is needed, describe it to the user; do not change access settings through tools.';
 }else if(/connect|disconnected|fetch failed|ECONN|timed? ?out|timeout/i.test(message)){
  code='connection_unavailable';next_step='Check the original connection or service and inspect the existing workflow or run status. Reconcile a write or submission with an unknown result using its original identity.';
 }else if(/required|invalid|missing|expected|must |请选择|参数|缺少/i.test(message)){
  code='invalid_input';next_step='Read the tool schema or engine contract and fill technical fields from the current workflow. Ask the user only for unresolved scientific choices.';
 }
 if(dispatched&&readOnly)next_step=toolName==='run_compute_command'
  ?'The read did not return a confirmed receipt. Retry on the same resource with the same request_id for the identical read, or use a new request_id for a smaller read. Directory visibility still depends on the original SSH account.'
  :'Check the original authorized source and retry this read when available.';
 if(dispatched&&!readOnly&&original.run_id)next_step='Read the status of the exact original run before another write.';
 return {content:[{type:'text',text:JSON.stringify({status:dispatched&&!readOnly?'unknown':code==='tool_error'?'failed':'blocked',code,message,next_step,...original,operation_state:dispatched?(readOnly?'read_started':'unconfirmed'):'not_started',automatic_retry:false})}],isError:true};
}

export function toolValueResult(value){
 return {content:[{type:'text',text:JSON.stringify(value)??'null'}],isError:['blocked','permission_required','failed','unknown','terminal_unavailable','needs_auth','needs_human_auth','needs_worker_update'].includes(value?.status)};
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
