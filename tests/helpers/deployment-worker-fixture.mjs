// Wiring for legacy deployment/hash tests. Authorization behavior is tested without
// this wrapper in deployment-authorization.test.mjs with explicit project policies.
export function withComputeProject(worker,task){
 const config=task.deployment.config;
 const project={id:config.projectId,policy:{engines:[task.parameters.engine],environments:config.target==='local'?[config.targetId]:[],clusters:config.target==='cluster'?[config.targetId]:[],gpus:[config.gpu??0],max_seconds:3600,max_concurrent:1}};
 return {request:(method,route,data)=>method==='GET'&&route==='/api/projects'?Promise.resolve([structuredClone(project)]):worker.request(method,route,data)};
}
