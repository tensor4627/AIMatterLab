// Presentation mirrors Service.resume; the worker remains the authority.
export function runContinuation(engine,mode){
 if(engine==='gpumd.neb')return {allowed:false,reason:'NEB 路径不含优化器状态，请显式创建新的路径计算'};
 if(['gpumd.md','hotpp.train','pydyn.md','pydyn.sampling'].includes(engine))return {allowed:true,reason:null};
 if(engine==='gpumd.sampling')return mode==='static'?{allowed:true,reason:null}:{allowed:false,reason:'当前续算入口仅支持 GPUMD static；历史依赖采样需独立工作流与恢复契约。'};
 return {allowed:false,reason:'此任务没有当前续算入口支持的 checkpoint 契约。'};
}
