export type ResourceToolRoute = 'fresh' | 'existing' | 'custom';
export type ResourceToolFormat = string;
export interface ResourceToolPort {filename:string;format:ResourceToolFormat}
export interface ResourceToolCitation {url:string;title?:string;version?:string}
export interface ResourceToolPackage {
 kind:'archive'|'binary';
 url?:string;
 sha256:string;
 filename:string;
 executable:string;
}
export type ResourceToolSource = ResourceToolPackage |
 {kind:'installed';executable:string;sha256?:string} |
 {kind:'git';url:string;commit:string;executable:string};
export interface ResourceToolResources {cpus?:number;gpus?:number;memory_mb?:number;qos?:string}
export interface ResourceToolOutputCheck {sha256?:string;contains?:string;json_keys?:string[];min_bytes?:number}
export interface ResourceToolBuild {steps:{command:string;args:string[];cwd?:string}[];max_seconds:number}
export interface ResourceToolParameterSpec {
 type:'string'|'boolean'|'integer'|'number';
 required:boolean;
 default?:string|number|boolean;
}
export interface ResourceToolManifest {
 id:string;
 name:string;
 version:string;
 description?:string;
 source:ResourceToolSource;
 citations?:ResourceToolCitation[];
 interpreter?:'bash'|'python';
 argv:string[];
 dependencies?:string[];
 support_files?:string[];
 build?:ResourceToolBuild;
 parameters?:Record<string,string|number|boolean>;
 parameter_specs?:Record<string,ResourceToolParameterSpec>;
 inputs:Record<string,ResourceToolPort>;
 outputs:Record<string,ResourceToolPort>;
 test:{inputs:Record<string,{path:string}|{text:string}>;outputs?:Record<string,ResourceToolOutputCheck>;parameters?:Record<string,string|number|boolean>;max_seconds:number;resources?:ResourceToolResources};
 git_bootstrap?:ResourceToolPackage;
}
export interface ResourceToolRef {resource_id:string;profile_version?:number}
export interface ResourceToolSourcePick {kind:'program'|'manual';name:string;size:number;sha256:string;text?:string;truncated?:boolean;local_source?:string}
export interface ResourceToolSetupRef extends ResourceToolRef {setup_id:string}
export interface ResourceToolReview extends ResourceToolSetupRef {revision:number;plan_sha256:string}
export interface ResourceToolFileRequest extends ResourceToolSetupRef {revision:number}
export interface ResourceToolCandidate {
 id:string;
 path:string;
 sha256:string;
 tool:string;
 scheduler:'slurm'|'lsf'|'direct';
 environment:string[];
 evidence:string[];
 count:number;
 examples:string[];
}
export interface ResourceToolDiscovery {directory:string;candidates:ResourceToolCandidate[];truncated:boolean}
export interface ResourceToolPlan extends ResourceToolRef {
 request_id:string;
 route:ResourceToolRoute;
 manifest:ResourceToolManifest;
 project_id:string;
 environment_id:string;
 cluster_id:string;
 queue_target_id?:string;
 candidate?:Pick<ResourceToolCandidate,'path'|'sha256'>;
 prior_run_id?:string;
 local_source?:string;
}
export interface ResourceToolTarget {
 project_id:string;
 cluster_id:string;
 environment_id:string;
 queue_target_id?:string;
 queue:string;
 scheduler:'slurm'|'lsf';
}
export interface ResourceToolOnboarding {
 package_id:string;
 package_version:string;
 manifest_sha256:string;
 source_commit:string;
 function_id:string;
 reference_test_case_id:string;
 entrypoint:string;
 support:Record<string,string>;
 entrypoint_git_object?:string;
 support_git_objects?:Record<string,string>;
 parameter_specs?:Record<string,ResourceToolParameterSpec>;
}
export interface ResourceToolSetup {
 id:string;
 resource_id:string;
 workspace_id:string;
 route:ResourceToolRoute;
 status:'planned'|'acquiring'|'desktop_fallback'|'needs_file'|'testing'|'active'|'failed'|'unknown';
 stage:'review'|'cluster_download'|'desktop_download'|'transfer'|'verify'|'git'|'build'|'test'|'active';
 revision:number;
 plan_sha256:string;
 manifest:ResourceToolManifest;
 onboarding?:ResourceToolOnboarding;
 target:ResourceToolTarget;
 install_root:string;
 activity:{stage:string;status:'passed'|'failed'|'pending'|'reused';message:string}[];
 build?:{run_id:string;job_id?:string;status:string;directory?:string};
 test?:{run_id:string;job_id?:string;status:string;directory?:string;reused?:boolean;onboarding?:ResourceToolOnboarding;outputs?:Record<string,{sha256:string;size:number;checks:Record<string,'passed'|'failed'>}>};
 activation_id?:string;
 skill?:{name:string;sha256:string;path?:string;body?:string;status:'saved'|'available';error?:string};
 supply?:'package'|'git';
 message?:string;
 cancelled?:boolean;
}
export interface ResourceToolScheduler {id:string;name:string;scheduler:'slurm'|'lsf';queue?:string;queue_targets:boolean}
export interface ResourceToolLibrary {setups:ResourceToolSetup[];targets:ResourceToolTarget[];schedulers?:ResourceToolScheduler[];workfile_root?:string}
