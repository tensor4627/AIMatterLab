/** Pure cross-process contracts. Runtime and renderer state belong to their owners. */

export interface Workflow {id:string;project_id:string;name:string;steps:unknown[];run_ids:string[]}

export interface TaskEditRequest {id:string;changes:Record<string,unknown>}

export interface TaskExecuteRequest {taskId:string;artifactId:string;inputReceipt?:string}

export interface TaskLinkRunRequest {taskId:string;runId:string;kind:'run'|'cluster-run';expectedPrepared?:{artifactId:string;parameterRevision:number;deploymentRevision:number}}

export interface TaskInputReadRequest {taskId:string;path:string}

export interface TaskInputReadResult {path:string;sha256:string;size:number;text?:string;binary?:boolean;truncated?:boolean;reason?:string}
