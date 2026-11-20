import type {RoadmapResource} from '../workflows/roadmap.mjs';

export interface Producer {step_id:string;port:string;run_id:string}
export interface RoadmapAsset {resource:string;path:string;sha256:string;size:number;producer?:Producer;facts?:Record<string,unknown>}
export interface FrozenInvocation {
 id:string;label:string;tool:string;argv:string[];registered_function?:{package_version:string;function_id:string}|null;version:{version:string;executable_sha256:string};environment:{id:string};environment_sha256:string;
 parameters:Record<string,unknown>;native_controls?:string[];inputs:Record<string,{name:string;resource:string;producer:{step_id:string;port:string}|null}>;
 target?:{project_id:string;cluster_id?:string;environment_id?:string;max_seconds:number;gpu:number;resources?:{queue?:string;queue_target_id?:string;cpus?:number;gpus?:number;memory_mb?:number;account?:string;qos?:string}};
 outputs:Record<string,{name:string;resource:string;format:string}>;
}
export interface RoadmapPreview {
 snapshot_sha256:string;snapshot:{task_id:string;name:string;original_request:string;workspace?:{choice:string|null;id:string|null;root:string|null}|null;target:{project_id:string;environment_id?:string;cluster_id?:string;gpu:number;max_seconds:number};
 initial:Record<string,RoadmapAsset>;steps:FrozenInvocation[];goals:RoadmapResource[]};
}
export interface RoadmapMissingTools {
 task_id:string;missing_tools:{step_id:string;tool:string;reason:string}[];
}
export interface RoadmapExecution {
 id:string;task_id:string;snapshot_sha256:string;status:string;confirmed_at:number;
 directory?:string;nodes:Record<string,{status:string;run_id?:string;job_id?:string;directory?:string;reason?:string;consumed?:{port:string;sha256:string;bytes_read:number;samples:number;producer?:Producer|null}[]}>;
 goals:{resource:string;label:string;status:string;artifact:RoadmapAsset|null;checks:{requirement:string;status:string;observed?:unknown}[]}[];
}
