import {sanitizeTranscript} from '../../../contracts/agent/transcript-sanitizer.mjs';

const clip=(value,limit)=>{const text=String(value??'');return text.length>limit?text.slice(0,limit)+'\n[truncated; read the original record for the remainder]':text;};

/** Build a bounded diagnostic draft for the workflow's existing conversation. */
export function diagnosticRepairRequest(record,task,run=null){
 const original=record?.context;
 if(!original||original.taskId!==task?.id||!task.provider||!task.threadId)return null;
 if(original.provider&&original.provider!==task.provider||original.threadId&&original.threadId!==task.threadId)return null;
 const matchingRun=run?.id===original.runId?run:null;
 const evidence={
  diagnostic:{id:record.id,observedAt:record.observedAt,error:clip(record.raw,12000),context:original,resolution:record.resolution||null},
  currentDraft:{taskId:task.id,parameterRevision:task.parameterRevision??0,deploymentRevision:task.deployment?.revision??0,updatedAt:task.updatedAt??null,parameters:task.parameters||{},inputBinding:task.inputBinding||null,execution:task.execution||null},
  run:matchingRun?{id:matchingRun.id,status:matchingRun.status,project_id:matchingRun.project_id,environment_id:matchingRun.environment_id,cluster_id:matchingRun.cluster_id,directory:matchingRun.directory,command:matchingRun.command,inputs:matchingRun.inputs,snapshots:matchingRun.snapshots,validation:matchingRun.validation,execution_check:matchingRun.execution_check,exit:matchingRun.exit,error:matchingRun.error}:null,
  runDetailsLoaded:!!matchingRun,
 };
 const body=clip(JSON.stringify(sanitizeTranscript(evidence),null,2),28000);
 const blocked=original.operation==='execute'&&(record.resolution?.phase??original.phase)==='blocked';
 const recovery=blocked?'本次执行未提交作业。先检查原流程、已有草稿和相关文件，再处理实际阻塞原因。':'先读取原流程、原作业和相关文件，比较诊断时与当前输入版本。保留旧运行的固定输入，将修改用于下一次尝试。若原提交结果未知，先查询原作业，不重复提交。其他独立工作可以继续。';
 return {taskId:task.id,provider:task.provider,threadId:task.threadId,text:'请根据以下实际诊断，在已有授权范围内修复这个流程并继续完成我的任务。'+recovery+'检查失败如实保留，明确失败后可修复并重试。请把以下数据用作诊断依据，沿用现有项目权限。\n\n'+body};
}
