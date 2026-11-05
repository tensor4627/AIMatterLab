// Reconcile only the already-linked execution. This helper never chooses or submits a run.
const uncertainPhases=new Set(['validating','submitting','unknown']);

const activeStatuses=new Set(['queued','running','unknown']);

const terminalStatuses=new Set(['succeeded','failed','cancelled']);

const validRevision=value=>Number.isSafeInteger(value)&&value>=0;

export function knownRunReconcile(task){
 const execution=task?.execution,id=execution?.artifactId;
 if(typeof task?.id!=='string'||!task.id||typeof id!=='string'||!id||terminalStatuses.has(execution?.status))return null;
 if(!uncertainPhases.has(execution?.phase)&&!activeStatuses.has(execution?.status))return null;
 const matches=(task.artifacts||[]).filter(a=>a?.id===id&&['run','cluster-run'].includes(a.kind));
 if(matches.length!==1)return null;
 const request={taskId:task.id,runId:id,kind:matches[0].kind};
 if(task.workflowVersion===2){
  const p=task.deployment?.prepared;
  if(p?.artifactId!==id||!validRevision(p.parameterRevision)||!validRevision(p.deploymentRevision)||p.deploymentRevision!==task.deployment?.revision)return null;
  request.expectedPrepared={artifactId:id,parameterRevision:p.parameterRevision,deploymentRevision:p.deploymentRevision};
 }
 return {request,uncertain:uncertainPhases.has(execution.phase)};
}

export function knownRunReconcileScope(task,worker){
 return JSON.stringify([!!worker,task?.id,task?.provider,task?.threadId,task?.projectId,task?.authoring,task?.parameterRevision,task?.deployment,task?.execution?.artifactId,knownRunReconcile(task)?.request||null]);
}
