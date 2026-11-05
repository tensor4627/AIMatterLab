/** Pure cross-process contracts. Runtime and renderer state belong to their owners. */

export interface Project {authoring_only?:boolean;authoring_task_id?:string;id:string;name:string;policy:{engines:string[];gpus:number[];max_seconds:number;max_concurrent:number;input_roots:string[];environments:string[];clusters?:string[];cluster_queue_policies?:Record<string,ClusterQueuePolicy>}}

export interface Environment {id:string;name:string;executables:Record<string,string>;repositories?:Record<string,string>;variables?:Record<string,string>}

export interface WorkerStatus {status:'connected'|'disconnected'|'unknown'|'checking';checkedAt:number;taskId?:string;conversationId?:string;scope?:'global';serviceVersion?:'current'|'different'|'unconfirmed';reason?:string}

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

/** A selected SSH terminal is not an authenticated Studio worker or a run grant. */
export interface SshTerminalResourceReference {kind:'ssh-terminal';profileId:string;profileVersion:number}
export interface ComputeResourceActivation extends SshTerminalResourceReference {sessionId:string}
export interface ComputeResourceState {schemaVersion:1;selectionId:string|null;kind:'ssh-terminal'|null;profileId:string|null;profileVersion:number|null;sessionId:string|null;status:'selected'|'stale'|'unavailable'|'none';operator:'human'|'agent'|'unknown';processStatus:'running'|'exited'|'expired'|'unknown';alive:boolean|null;agentReady:boolean;reason:string|null;authentication:'not_observed';managedRuns:false}

export type ProjectAuthorizationSpec={name:string;policy:{engines:string[];gpus:number[];max_seconds:number;max_concurrent:number;input_roots:string[];environments:string[];clusters?:string[]}};
