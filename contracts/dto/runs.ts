/** Pure cross-process contracts. Runtime and renderer state belong to their owners. */

import type {ClusterQueueTarget,ClusterQueuePolicy} from './compute';

export type RunStatus='draft'|'validating'|'ready'|'queued'|'running'|'succeeded'|'failed'|'cancelled'|'unknown';

export interface ContinuationMetadata {schema:"gpumd-continuation-v1";parent_run:string;parameter_scope:"inherited_unverified";checkpoint:{input:string;source_name:string|null;sha256:string;has_velocities:null;velocity_status:"not_checked"};input:{name:string;sha256:string};velocity_initialization:"no_velocity_command"|"not_checked"}

export interface Run {parent_run?:string;continuation_metadata?:ContinuationMetadata;superseded_by?:string;revision_of?:string;id:string;name:string;engine:string;project_id:string;environment_id:string;status:RunStatus;gpu:number;max_seconds:number;directory:string;validation:{status:string;message?:string;output?:string;scope?:string;scientific_status?:string;artifact_status?:string};created_at:number;updated_at:number;command:string[];parameters?:Record<string,unknown>;inputs:Record<string,string>;error?:string;exit?:{exit_code:number;reason?:string}}

export interface ClusterRun {queue_target_snapshot?:ClusterQueueTarget;queue_profile_version?:number;queue_policy_snapshot?:ClusterQueuePolicy;queue_policy_digest?:string;id:string;kind:'cluster-run';name:string;engine:string;project_id:string;cluster_id:string;status:RunStatus;directory:string;parameters?:Record<string,unknown>;inputs:Record<string,string>;resources:any;max_seconds:number;cluster:any;script:string;job_id:string|null;validation:any;scientific_validation:any;snapshots:{name:string;source:string;sha256:string;size:number}[]}
