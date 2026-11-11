export type CliProvider='kimi'|'qwen';
export interface CliReadiness {provider:CliProvider;status:'ready'|'missing'|'incompatible'|'invalid'|'failed';source?:'manual'|'environment'|'path'|'managed';executable?:string;version?:string;expectedVersion:string;message:string}
export interface CliInstallProgress {provider:CliProvider;requestId:string;phase:'downloading'|'verifying'|'extracting'|'checking'|'completed'|'cancelled'|'failed';receivedBytes:number;totalBytes?:number;packageIndex:number;packageCount:number;message?:string}
export interface CliInstallRequest {provider:CliProvider;requestId:string}
