export type RunStatus='draft'|'validating'|'ready'|'queued'|'running'|'succeeded'|'failed'|'cancelled'|'unknown';
export interface Project {id:string;name:string;policy:{engines:string[];gpus:number[];max_seconds:number;max_concurrent:number;input_roots:string[];environments:string[];clusters?:string[]}}
export interface Environment {id:string;name:string;executables:Record<string,string>;repositories?:Record<string,string>;variables?:Record<string,string>}
export interface Run {superseded_by?:string;revision_of?:string;id:string;name:string;engine:string;project_id:string;environment_id:string;status:RunStatus;gpu:number;max_seconds:number;directory:string;validation:{status:string;message?:string;output?:string;scope?:string};created_at:number;updated_at:number;command:string[];parameters?:Record<string,unknown>;inputs:Record<string,string>;error?:string;exit?:{exit_code:number;reason?:string}}
export interface Workflow {id:string;project_id:string;name:string;steps:unknown[];run_ids:string[]}
export interface Artifact {id:string;name:string;path:string;kind:string;sha256:string;size:number;metadata?:Record<string,unknown>}
export type AgentProvider='codex'|'kimi'|'qwen';
export interface AgentConnectRequest {provider:AgentProvider}
export interface AgentRpcRequest extends AgentConnectRequest {method:string;params?:Record<string,unknown>}
export interface Settings {projectAgents?:Record<string,AgentProvider>;agentLayout?:'right'|'center';agentProvider?:AgentProvider;kimiPath?:string;qwenPath?:string;agentProviders?:Partial<Record<AgentProvider,{contextWindow?:number;compactLimit?:number;effort?:string}>>;distribution:string;workerRoot:string;workerPort:number;codexPath:string;cwd:string;skillRoots:string[];theme:string;language?:'zh-CN'|'en';fontFamily?:string;fontSize?:number;minimumFontSize?:number;chatFontSize?:number;editorFontSize?:number;terminalFontSize?:number;agent?:{contextWindow?:number;compactLimit?:number;effort?:string}}
export interface RpcEvent {provider?:AgentProvider;method:string;id?:string|number;params:any}
export interface Studio {invoke<T=any>(method:string,data?:unknown):Promise<T>;onEvent(callback:(event:RpcEvent)=>void):()=>void;onTerminal(callback:(event:{id:string;data?:string;closed?:boolean})=>void):()=>void}
declare global {interface Window {studio?:Studio}}
export async function invoke<T=any>(method:string,data?:unknown):Promise<T>{
  if(!window.studio) throw new Error('此页面是浏览器预览。请从 Electron 桌面应用连接计算环境。');
  return window.studio.invoke<T>(method,data);
}
export const api=<T=any>(method:string,target:string,data?:unknown)=>invoke<T>('worker.request',{method,target,data});
export function wslPath(path:string){return /^[a-z]:[\\/]/i.test(path)?'/mnt/'+path[0].toLowerCase()+'/'+path.slice(3).replaceAll('\\','/'):path}
export const engines=[
 ['gpumd.md','GPUMD · 传统 MD'],['pydyn.md','PyDyn · 传统 MD'],['pygas.build','pyGAS · Bias 构建'],
 ['bias.validate','pyGAS · 产物验证'],['gpumd.sampling','GPUMD · GPU-Sampling'],['pydyn.sampling','PyDyn · pyGAS'],
 ['nep.analyze','NEP · 回归图'],['nep.train','NEP · 训练'],['nep.eval','NEP · 测试'],['hotpp.train','HotPP · 训练'],
 ['hotpp.eval','HotPP · 测试'],['hotpp.export','HotPP · 模型导出'],['pygas.reweight','WTMetaD · 重加权'],
 ['pygas.opes-reweight','OPES · 重加权']
];

export interface ClusterRun {id:string;kind:'cluster-run';name:string;engine:string;project_id:string;cluster_id:string;status:RunStatus;directory:string;parameters?:Record<string,unknown>;inputs:Record<string,string>;resources:any;max_seconds:number;cluster:any;script:string;job_id:string|null;validation:any;scientific_validation:any;snapshots:{name:string;source:string;sha256:string;size:number}[]}
