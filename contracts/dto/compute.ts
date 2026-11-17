import type {SshLocations} from '../compute/ssh-service-locations.mjs';
/** Pure cross-process contracts. Runtime and renderer state belong to their owners. */

export interface SharedTerminalResizeRequest {sessionId:string;ownerEpoch:number;cols:number;rows:number}

export interface Project {revision?:number;authoring_only?:boolean;authoring_task_id?:string;id:string;name:string;policy:{engines:string[];gpus:number[];max_seconds:number;max_concurrent:number;input_roots:string[];environments:string[];clusters?:string[];cluster_queue_policies?:Record<string,ClusterQueuePolicy>}}

export interface Environment {id:string;name:string;provider?:'wsl'|'ssh';executables:Record<string,string>;repositories?:Record<string,string>;variables?:Record<string,string>}

export interface WorkerStatus {status:'connected'|'disconnected'|'unknown'|'checking';checkedAt:number;taskId?:string;conversationId?:string;scope?:'global';sourceId?:string;sourceKind?:'ssh';connectionId?:string;profileId?:string;profileVersion?:number;serviceVersion?:'current'|'different'|'unconfirmed';reason?:string}

export interface ComputeConnectionView {planId:string|null;status:string;phase:string;scope?:'task'|'saved-global'|'saved-profile'|'global';profileId?:string;profileVersion?:number;profileName?:string;intent?:'standard'|'existing';taskId?:string|null;ownerName?:string|null;locked?:boolean;needsLegacyPort?:boolean;portSource?:'unknown'|'saved'|'verified'|'human-confirmed';canChooseSource?:boolean;canUpdate?:boolean;distributions?:string[];target?:{distribution:string;root:string;port:number|null}|null;connection:string;discovery:string;scientificValidation?:'not_run';serviceVersion?:string;resolvedRoot?:string;mode?:string;environments?:number;finished:boolean;error?:{code:string;message:string}}

export interface ClusterQueueLimits {cpus:number;gpus:number;memory_mb:number;max_seconds:number}

export interface ClusterQueueEnvironment {executables:Record<string,string>;repositories?:Record<string,string>;variables?:Record<string,string>}

export interface ClusterQueueTarget {id:string;queue:string;usage_class:'owned'|'paid'|'unknown';enabled:boolean;engines:string[];environment:ClusterQueueEnvironment;activation:string;limits:ClusterQueueLimits;account?:string}

export interface ClusterQueuePolicy {profile_version:number;allowed_target_ids:string[];new_submission_order:string[];paid:{permitted:boolean;conditions_known:boolean;conditions:string;limits?:ClusterQueueLimits}}

export interface ClusterQueueProfile {id?:string;version?:number;queue?:string;queue_targets?:ClusterQueueTarget[];environment:ClusterQueueEnvironment;activation:string;limits:Partial<ClusterQueueLimits>}

export interface ClusterSchedulerObservation {queues?:string[];detected_schedulers?:string[];selected_scheduler?:string;selected_scheduler_match?:boolean;schedulers?:Record<string,{queues?:string[];commands?:unknown;queue_status?:string}>}

export interface ExistingSshReference {ref:string;label:string;source?:'codex'|'xshell';action?:'select-session'}

export interface WslComputeProfile {id:string;version:number;kind:'wsl';name:string;distribution:string;root:string;port:number;intent:'standard'|'existing'}

export interface SshServiceEnvironment {python:string;activation:string}
export interface SshComputeProfile {id:string;version:number;kind:'ssh';name:string;host:string;username:string;port:number;ssh_client:string;distribution?:string;identity_file?:string;proxy_jump?:string[];via?:string[];mode:'interactive'|'key';serviceEnvironment?:SshServiceEnvironment}

export type ComputeProfile=WslComputeProfile|SshComputeProfile;
export interface BaseWorkspaceRequest {connectionId:string;profileId:string;profileVersion:number;action:'inspect'|'ensure';name?:string;directory?:string}
export type BaseWorkspaceResult={status:'unconfigured';suggested:{name:string;directory:string}}|{status:'ready';workspace:{id:string;name:string;root:string;directories:string[];asset_mode:'copy'|'link'}};
export interface ComputeProfileRemovalRequest {id:string;expectedVersion:number}
export interface ComputeProfileRemovalResult {removed:true;id:string;version:number}

/** A selected SSH terminal is not an authenticated AIMatterLab worker or a run grant. */
export interface SshTerminalResourceReference {kind:'ssh-terminal';profileId:string;profileVersion:number}
export interface SshConnectionResourceReference {kind:'ssh-connection';connectionId:string;profileId:string;profileVersion:number}
export type ComputeResourceActivation=(SshTerminalResourceReference & {sessionId:string})|SshConnectionResourceReference;
export interface ComputeResourceCapabilities {
 terminal:{status:'ready'|'closed'|'unknown';sessionIds:string[];agentReady:boolean;operator:'human'|'agent'|'unknown'};
 service:{status:string;agentReady:boolean;workflowReady:boolean;operator:'human'|'agent'|'unknown'};
 files:{status:'requires_authorized_project'|'unavailable'|'unknown';via:'job-service'|null};
}
export interface ComputeResourceState {canAcquireConversationTerminal?:boolean;schemaVersion:1|2;selectionId:string|null;kind:'ssh-terminal'|'ssh-connection'|null;connectionId?:string|null;profileId:string|null;profileVersion:number|null;sessionId:string|null;terminalSessionIds?:string[];connectionStatus?:SshConnectionStatus;capabilities?:ComputeResourceCapabilities;status:'selected'|'stale'|'unavailable'|'none';operator:'human'|'agent'|'unknown';processStatus:'running'|'exited'|'expired'|'unknown';alive:boolean|null;agentReady:boolean;reason:string|null;authentication:'not_observed'|'verified'|'pending'|'lost';managedRuns:boolean;workflowReady?:boolean;serviceActive?:boolean;serviceStatus?:'idle'|'disconnected'|'connecting'|'connected'|'disconnecting'|'failed'|'unknown'}
export type SshConnectionStatus='authenticating'|'authenticated'|'unavailable'|'closed'|'requires_review'|'unsupported';
export interface SshConnectionState {schemaVersion:2;connectionId:string;loginRequestId?:string;profileId:string;profileVersion:number;status:SshConnectionStatus;authentication:'pending'|'verified'|'not_observed'|'lost';capabilities:{multiplex:boolean};terminalSessionIds:string[];serviceIds:string[];revision:number;closed?:boolean;error?:{code:string}}
export interface SshConnectionOpenRequest {profileId:string;profileVersion:number;requestId:string}
export interface SshConnectionRequest {connectionId:string}
export interface SshConnectionAuthReadRequest extends SshConnectionRequest {cursor?:number;maxBytes?:number}
export interface SshConnectionAuthInputRequest extends SshConnectionRequest {requestId:string;data:string}
export interface SshConnectionAuthResizeRequest extends SshConnectionRequest {cols:number;rows:number}
export interface SshConnectionOpenShellRequest extends SshConnectionRequest {requestId:string}
export interface SshConnectionCompleteLoginRequest extends SshConnectionRequest {requestId:string}
export interface SshLoginCompletionState {status:'waiting_authentication'|'checking'|'complete'|'failed';phase?:'waiting_authentication'|'checking_authentication'|'opening_shell';code?:string}
export interface SshConnectionCompleteLoginResult {connection:SshConnectionState;shell?:SshShellSessionState;login?:SshLoginCompletionState}
export type SshConnectionLoginStatusRequest=SshConnectionCompleteLoginRequest;
export interface SshConnectionLoginStatusResult extends SshConnectionCompleteLoginResult {login:SshLoginCompletionState}
export interface SshConnectionAuthReadResult {connectionId:string;output:string;cursor:number;dropped:boolean;state:SshConnectionState}
export interface SshShellSessionState {id:string;sessionId:string;connectionId:string;kind:'ssh';mode:'interactive'|'key';name:string;owner:'human'|'agent';ownerEpoch:number;alive:boolean|null;status:'running'|'exited'|'unknown';expired?:boolean;sequence:number;exitCode?:number|null;resource:SshConnectionResourceReference}
export interface SshServiceConnectRequest {connectionId:string;profileId:string;profileVersion:number;requestId:string;mode?:'setup'|'reuse'|'check'|'update';expectedAttemptId?:string}
export type SshServicePhase='preparing_local'|'preparing_environment'|'waiting_python'|'checking_cache'|'transferring_transport'|'transferring_worker'|'preparing_runtime'|'starting_worker'|'checking_health'|'checking_tools'|'ready'|'request'|'stopping'|'returning_terminal';
export type SshServiceErrorCode='registration_required'|'maintenance_required'|'environment_activation_failed'|'python_start_failed'|'python_response_timeout'|'python_unsupported'|'sqlite_unavailable'|'tty_unavailable'|'invalid_hello'|'protocol_failed'|'transport_hash_mismatch'|'transport_cache_invalid'|'worker_hash_mismatch'|'worker_cache_invalid'|'namespace_unsafe'|'permission_denied'|'storage_unavailable'|'worker_start_timeout'|'worker_start_failed'|'worker_identity_unavailable'|'worker_health_invalid'|'service_request_unconfirmed'|'internal_error'|'startup_timeout'|'connection_unconfirmed'|'identity_unconfirmed'|'tools_unavailable'|'local_resources_unavailable'|'context_changed'|'stop_timeout';
export interface SshServiceDisconnectRequest {connectionId:string;attemptId:string}
export interface SshServiceOwnerRequest extends SshServiceDisconnectRequest {owner:'human'|'agent';provider?:'codex'|'kimi'|'qwen'|'deepseek'|'compatible'}
export interface SshServiceStatusRequest {connectionId?:string}
export type SshServiceCheckRequest=SshServiceDisconnectRequest;
export interface SshServiceRegistrationRequest {profileId:string;profileVersion:number}
export interface SshServiceRegistrationState {localProjectSkillsRoot?:string;status:'unconfigured'|'configured'|'maintenance_required';profileId:string;profileVersion:number;reason?:string;registration?:{schemaVersion:1;profileId:string;configuredAtProfileVersion:number;revision:number;checkedAt:number;root:string;runtime:string;runtimeId:string;runtimeManifestSha256?:string;locations?:SshLocations;port:number;hostIdentity:{hostname:string;uid:number;machineId:string};tools:{status:'ready';count:number}|{status:'legacy_not_recorded'};maintenance?:{code:string}}}
export interface SshServiceState {warnings?:Array<'tools_unavailable'|'tools_incomplete'>;schemaVersion?:2;connectionId?:string;serviceId?:string;status:'idle'|'connecting'|'connected'|'disconnecting'|'disconnected'|'failed'|'unknown';operator?:'human'|'agent';handoffKind?:'service';sessionId?:string;profileId?:string;profileVersion?:number;attemptId?:string;revision?:number;phase?:SshServicePhase;phaseStartedAt?:number;startedAt?:number;updatedAt?:number;terminalAccess?:'available'|'reserved'|'unknown';serviceActive?:boolean;workflowReady?:boolean;progress?:{kind:'transfer';completedBytes:number;totalBytes:number};health?:{name:string;root:string;runtime:string;runtimeId:string;runtimeManifestSha256?:string;locations?:SshLocations;port:number;execution_policy:string;hostIdentity:{hostname:string;uid:number;machineId:string}};error?:{code:SshServiceErrorCode;phase?:SshServicePhase;python?:[number,number,number];sqlite?:[number,number,number]}}
export interface SshSchedulerConfiguration {id?:string;version?:number;name:string;scheduler:'slurm'|'lsf';environment:{executables:Record<string,string>;repositories?:Record<string,string>;variables?:Record<string,string>};limits:{cpus:number;gpus:number;memory_mb:number};remote_root:string;read_roots:string[];queue?:string;activation?:string;queue_targets?:ClusterQueueTarget[];lsf_memory_scope?:'per_slot'|'per_job';notes?:string}
export interface SshSchedulerRequest {connectionId:string;attemptId:string;configuration:SshSchedulerConfiguration}

export type ProjectAuthorizationSpec={name:string;policy:{engines:string[];gpus:number[];max_seconds:number;max_concurrent:number;input_roots:string[];environments:string[];clusters?:string[]}};
