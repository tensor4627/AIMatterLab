// Renderer-only presentation rules. These never prepare, submit or retry a job.
export const toolGroups=[
 {id:'compute',label:'计算与建模',tools:['md','pygas','training','hamiltonian','activelearning'],pages:[]},
 {id:'data',label:'数据与分析',tools:['assets','viewer'],pages:[]},
 {id:'resources',label:'算力与管理',tools:['queue'],pages:['extensions','environments','ssh','skills','relations']}
];
export function initialBottomExpanded(read){
 const explicit=read('studio.bottomExpanded');
 if(explicit==='true'||explicit==='false')return explicit==='true';
 const previous=Number(read('studio.bottom'));
 return Number.isFinite(previous)&&previous>0;
}
export function conversationMatches(conversation,query,projectName=''){
 return [conversation.name,projectName].join('\n').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}
export function jobKey(job){return (job.kind==='cluster-run'?'cluster:':'local:')+job.id;}
// A chat's authoring workspace holds inputs; its explicit compute binding owns jobs.
// Keep an unrelated project filter that the user selected deliberately.
export function computeProjectForSelection(projectId,task){
 if(!projectId||!task)return projectId;
 const authoring=new Set([task.authoring?.projectId,task.projectId].filter(Boolean));
 if(!authoring.has(projectId))return projectId;
 const bound=task.deploymentDraft?.config?.projectId||task.deployment?.config?.projectId;
 return typeof bound==='string'&&bound&&!authoring.has(bound)?bound:projectId;
}
export function unifiedJobs(local,cluster){
 return [...local.map(run=>({key:jobKey(run),location:'local',run})),...cluster.map(run=>({key:'cluster:'+run.id,location:'cluster',run}))]
  .sort((a,b)=>(Number(b.run.created_at)||0)-(Number(a.run.created_at)||0)||a.key.localeCompare(b.key));
}
export function filterJobs(jobs,{location='all',status='all',since=0,projectId='',query=''}={}){
 const text=query.trim().toLocaleLowerCase();
 return jobs.filter(({location:source,run})=>(location==='all'||source===location)&&(status==='all'||(status==='active'?['queued','running','unknown'].includes(run.status):run.status===status))&&(!since||(Number.isFinite(run.created_at)&&run.created_at>=since))&&(!projectId||run.project_id===projectId)&&(!text||[run.name,run.engine,run.status,run.job_id||''].join('\n').toLocaleLowerCase().includes(text)));
}
export function boundJobConversation(job,tasks,conversations,sourceId){
 const kind=job.location==='cluster'?'cluster-run':'run';
 const owners=tasks.filter(task=>(sourceId?task.workerSourceId===sourceId:task.workerSourceId===undefined)&&Array.isArray(task.artifacts)&&task.artifacts.some(artifact=>artifact.id===job.run.id&&artifact.kind===kind));
 const matches=conversations.filter(conversation=>owners.some(task=>task.id===conversation.taskId&&task.provider===conversation.provider&&task.threadId===conversation.threadId));
 return matches.length===1?matches[0]:null;
}
