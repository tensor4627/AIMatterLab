/** Shared UI/main preflight. The worker remains the final authorization authority. */
export function deploymentProjectIssue(project,config,engine){
 if(!project||project.authoring_only)return {code:'compute-project-required',message:'请选择或创建计算项目；草稿工作区仅用于编写输入，不能执行计算。'};
 const policy=project.policy||{};
 if(!Array.isArray(policy.engines)||!policy.engines.includes(engine))return {code:'engine',message:'此项目尚未启用当前引擎，请在项目设置中检查工具与引擎。'};
 const remote=config.target==='cluster',allowed=policy[remote?'clusters':'environments'];
 if(!config.targetId)return {code:'target-required',message:remote?'请选择已登记的集群。':'请选择已登记的计算环境。'};
 if(!Array.isArray(allowed)||!allowed.includes(config.targetId))return {code:'target',message:remote?'此集群不在项目的计算范围内，请检查项目设置。':'此计算环境不在项目的计算范围内，请检查项目设置。'};
 if(!remote&&(!Array.isArray(policy.gpus)||!policy.gpus.includes(config.gpu)))return {code:'gpu',message:'所选 GPU 不在项目的资源范围内，请调整 GPU 或项目设置。'};
 if(!Number.isSafeInteger(config.maxSeconds)||config.maxSeconds<1||!Number.isSafeInteger(policy.max_seconds)||config.maxSeconds>policy.max_seconds)return {code:'duration',message:'运行时长超出项目上限，请调整时长或项目设置。'};
 return null;
}


/** Suggest only for blank/authoring defaults; never replace an explicit compute project. */
export function deploymentProjectId(projects,preferred,config,engine){
 const current=projects.find(project=>project.id===preferred);
 if(current&&!current.authoring_only)return current.id;
 const eligible=projects.filter(project=>!deploymentProjectIssue(project,config,engine));
 return eligible.length===1?eligible[0].id:'';
}
