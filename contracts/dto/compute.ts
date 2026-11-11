/** Pure cross-process contracts. Runtime and renderer state belong to their owners. */

export interface Project {revision?:number;authoring_only?:boolean;authoring_task_id?:string;id:string;name:string;policy:{engines:string[];gpus:number[];max_seconds:number;max_concurrent:number;input_roots:string[];environments:string[];clusters?:string[];cluster_queue_policies?:Record<string,ClusterQueuePolicy>}}

export interface Environment {id:string;name:string;provider?:'wsl'|'ssh';executables:Record<string,string>;repositories?:Record<string,string>;variables?:Record<string,string>}

export interface WorkerStatus {status:'connected'|'disconnected'|'unknown'|'checking';checkedAt:number;taskId?:string;conversationId?:string;scope?:'global';sourceId?:string;sourceKind?:'ssh';profileId?:string;profileVersion?:number;serviceVersion?:'current'|'different'|'unconfirmed';reason?:string}

export interface ComputeConnectionView {planId:string|null;status:string;phase:string;scope?:'task'|'saved-global'|'saved-profile'|'global';profileId?:string;profileVersion?:number;profileName?:string;intent?:'standard'|'existing';taskId?:string|null;ownerName?:string|null;locked?:boolean;needsLegacyPort?:boolean;portSource?:'unknown'|'saved'|'verified'|'human-confirmed';canChooseSource?:boolean;canUpdate?:boolean;distributions?:string[];target?:{distribution:string;root:string;port:number|null}|null;connection:string;discovery:string;scientificValidation?:'not_run';serviceVersion?:string;resolvedRoot?:string;mode?:string;environments?:number;finished:boolean;error?:{code:string;message:string}}

export interface ClusterQueueLimits {cpus:number;gpus:number;memory_mb:number;max_seconds:number}

export interface ClusterQueueEnvironment {executables:Record<string,string>;repositories?:Record<string,string>;variables?:Record<string,string>}

export interface ClusterQueueTarget {id:string;queue:string;usage_class:'owned'|'paid'|'unknown';enabled:boolean;engines:string[];environment:ClusterQueueEnvironment;activation:string;limits:ClusterQueueLimits;account?:string}

export interface ClusterQueuePolicy {profile_version:number;allowed_target_ids:string[];new_submission_order:string[];paid:{permitted:boolean;conditions_known:boolean;conditions:string;limits?:ClusterQueueLimits}}

export interface ClusterQueueProfile {id?:string;version?:number;queue?:string;queue_targets?:ClusterQueueTarget[];environment:ClusterQueueEnvironment;activation:string;limits:Partial<ClusterQueueLimits>}

export interface ClusterSchedulerObservation {queues?:string[];detected_schedulers?:string[];selected_scheduler?:string;selected_scheduler_match?:boolean;schedulers?:Record<string,{queues?:string[];commands?:unknown;queue_status?:string}>}

export interface ExistingSshReference {ref:string;label:string;source?:'codex'|'xshell';action?:'select-session'}

export interface WslComputeProfile {id:string;version:number;kind:'wsl';name:string;distribution:string;root:string;port:number;intent:'standard'|'existing'}

export interface SshComputeProfile {id:string;version:number;kind:'ssh';name:string;host:string;username:string;port:number;ssh_client:string;distribution?:string;identity_file?:string;proxy_jump?:string[];via?:string[];mode:'interactive'|'key'}

export type ComputeProfile=WslComputeProfile|SshComputeProfile;
export interface ComputeProfileRemovalRequest {id:string;expectedVersion:number}
export interface ComputeProfileRemovalResult {removed:true;id:string;version:number}

/** A selected SSH terminal is not an authenticated Studio worker or a run grant. */
export interface SshTerminalResourceReference {kind:'ssh-terminal';profileId:string;profileVersion:number}
export interface ComputeResourceActivation extends SshTerminalResourceReference {sessionId:string}
export interface ComputeResourceState {schemaVersion:1;selectionId:string|null;kind:'ssh-terminal'|null;profileId:string|null;profileVersion:number|null;sessionId:string|null;status:'selected'|'stale'|'unavailable'|'none';operator:'human'|'agent'|'unknown';processStatus:'running'|'exited'|'expired'|'unknown';alive:boolean|null;agentReady:boolean;reason:string|null;authentication:'not_observed'|'verified';managedRuns:boolean;workflowReady?:boolean;serviceActive?:boolean;serviceStatus?:'disconnected'|'connecting'|'connected'|'unknown'}
export interface SshServiceConnectRequest {sessionId:string;ownerEpoch:number;profileId:string;profileVersion:number;requestId:string}
export type SshServicePhase='preparing_local'|'waiting_python'|'checking_cache'|'transferring_transport'|'transferring_worker'|'preparing_runtime'|'starting_worker'|'checking_health'|'checking_tools'|'ready'|'request'|'stopping'|'returning_terminal';
export type SshServiceErrorCode='python_response_timeout'|'python_unsupported'|'sqlite_unavailable'|'tty_unavailable'|'invalid_hello'|'protocol_failed'|'transport_hash_mismatch'|'transport_cache_invalid'|'worker_hash_mismatch'|'worker_cache_invalid'|'namespace_unsafe'|'permission_denied'|'storage_unavailable'|'worker_start_timeout'|'worker_start_failed'|'worker_identity_unavailable'|'worker_health_invalid'|'service_request_unconfirmed'|'internal_error'|'startup_timeout'|'connection_unconfirmed'|'identity_unconfirmed'|'tools_unavailable'|'local_resources_unavailable'|'context_changed'|'stop_timeout';
export interface SshServiceDisconnectRequest {sessionId:string;attemptId:string}
export interface SshServiceState {status:'idle'|'connecting'|'connected'|'disconnecting'|'disconnected'|'failed'|'unknown';sessionId?:string;profileId?:string;profileVersion?:number;attemptId?:string;revision?:number;phase?:SshServicePhase;phaseStartedAt?:number;startedAt?:number;updatedAt?:number;terminalAccess?:'available'|'reserved'|'unknown';serviceActive?:boolean;workflowReady?:boolean;progress?:{kind:'transfer';completedBytes:number;totalBytes:number};health?:{name:string;root:string;runtime:string;runtimeId:string;port:number;execution_policy:string;hostIdentity:{hostname:string;uid:number;machineId:string}};error?:{code:SshServiceErrorCode;phase?:SshServicePhase;python?:[number,number,number];sqlite?:[number,number,number]}}
export interface SshSchedulerRequest {id?:string;version?:number;name:string;scheduler:'slurm'|'lsf';environment:{executables:Record<string,string>;repositories?:Record<string,string>;variables?:Record<string,string>};limits:{cpus:number;gpus:number;memory_mb:number};remote_root:string;read_roots:string[];queue?:string;activation?:string;queue_targets?:ClusterQueueTarget[];lsf_memory_scope?:'per_slot'|'per_job';notes?:string}

export type ProjectAuthorizationSpec={name:string;policy:{engines:string[];gpus:number[];max_seconds:number;max_concurrent:number;input_roots:string[];environments:string[];clusters?:string[]}};
