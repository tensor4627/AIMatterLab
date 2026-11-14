/** Fixed public connection diagnostics. No remote exception strings or credentials. */
export const SSH_SERVICE_PHASES=Object.freeze(['preparing_local','preparing_environment','waiting_python','checking_cache','transferring_transport','transferring_worker','preparing_runtime','starting_worker','checking_health','checking_tools','ready','stopping','returning_terminal']);
const phases=new Set(SSH_SERVICE_PHASES);
const codes=new Set(['environment_activation_failed','python_start_failed','python_unsupported','python_response_timeout','sqlite_unavailable','tty_unavailable','invalid_hello','protocol_failed','transport_hash_mismatch','transport_cache_invalid','worker_hash_mismatch','worker_cache_invalid','namespace_unsafe','permission_denied','storage_unavailable','worker_start_timeout','worker_start_failed','worker_identity_unavailable','worker_health_invalid','service_request_unconfirmed','internal_error','startup_timeout','connection_unconfirmed','identity_unconfirmed','tools_unavailable','local_resources_unavailable','context_changed','stop_timeout']);
codes.add('registration_required');codes.add('maintenance_required');
for(const code of ['exec_unavailable','channel_refused','channel_timeout'])codes.add(code);
codes.add('terminal_busy');
const mapped={
 service_start_unknown:'startup_timeout',terminal_service_unknown:'connection_unconfirmed',service_stop_unknown:'stop_timeout',
 service_protocol_failed:'protocol_failed',terminal_service_failed:'protocol_failed',service_identity_failed:'identity_unconfirmed',
 terminal_service_changed:'context_changed',terminal_context_changed:'context_changed',terminal_owner_changed:'context_changed',
 terminal_human_owned:'context_changed',terminal_scope_denied:'context_changed',terminal_saved_connection_changed:'context_changed',
 terminal_invalid_request:'internal_error',ssh_service_invalid_request:'internal_error',
 ssh_service_context_changed:'context_changed',ssh_service_selection_changed:'context_changed',
 ssh_service_identity_changed:'identity_unconfirmed',ssh_service_identity_unavailable:'identity_unconfirmed',ssh_service_runtime_changed:'identity_unconfirmed',
 ssh_service_tools_unavailable:'tools_unavailable',ssh_service_resources_invalid:'local_resources_unavailable',ssh_service_resources_changed:'local_resources_unavailable',ssh_service_resources_incomplete:'local_resources_unavailable'
};
Object.assign(mapped,{ssh_service_registration_required:'registration_required',ssh_service_maintenance_required:'maintenance_required',ssh_service_registration_identity_changed:'identity_unconfirmed'});
Object.assign(mapped,{ssh_service_connection_required:'context_changed',ssh_service_selection_changed:'context_changed',ssh_connection_changed:'context_changed',ssh_invalid_profile:'context_changed',ssh_authentication_unconfirmed:'connection_unconfirmed',ssh_service_connection_unavailable:'connection_unconfirmed',ssh_master_unavailable:'connection_unconfirmed',ssh_control_unavailable:'connection_unconfirmed',ssh_channel_unavailable:'connection_unconfirmed',ssh_master_identity_changed:'identity_unconfirmed',ssh_control_identity_changed:'identity_unconfirmed'});
export function safeSshServicePhase(value,fallback='waiting_python'){return phases.has(value)?value:phases.has(fallback)?fallback:'waiting_python';}
export function safeSshServiceError(value,phase){const raw=typeof value==='string'?value:value?.code,code=codes.has(raw)?raw:Object.hasOwn(mapped,raw)?mapped[raw]:'connection_unconfirmed',result={code,phase:safeSshServicePhase(value?.phase,phase)};if(Number.isInteger(value?.errno)&&value.errno>0&&value.errno<=4095)result.errno=value.errno;for(const key of ['python','sqlite'])if(Array.isArray(value?.[key])&&value[key].length===3&&value[key].every(n=>Number.isInteger(n)&&n>=0&&n<=1000))result[key]=[...value[key]];return result;}
export function safeSshServiceProgress(value){return value?.kind==='transfer'&&Number.isSafeInteger(value.completedBytes)&&Number.isSafeInteger(value.totalBytes)&&value.totalBytes>0&&value.totalBytes<=16*1024*1024&&value.completedBytes>=0&&value.completedBytes<=value.totalBytes?{kind:'transfer',completedBytes:value.completedBytes,totalBytes:value.totalBytes}:undefined;}
