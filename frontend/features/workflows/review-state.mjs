export function reviewState({worker,saving,saveError,missing,task,artifact,run}){
 const inFlight=['validating','submitting','unknown'].includes(task.execution?.phase);
 const current=task.review?.status==='ready'&&task.review.parameterRevision===task.parameterRevision&&(task.workflowVersion===2||task.review.artifactIds?.includes(artifact?.id));
 const runRevision=Number.isSafeInteger(artifact?.preparedRevision)?artifact.preparedRevision:null;
 const runCurrent=!!(run&&run.id===artifact?.id&&runRevision!==null&&runRevision===task.parameterRevision);
 const running=runCurrent&&run&&['queued','running','succeeded','failed','cancelled','unknown'].includes(run.status);
 const stage=inFlight?4:!Object.keys(task.parameters||{}).length?0:missing.length?1:(!current||saving||saveError)?2:running?4:3;
 const reason=inFlight?(task.execution.phase==='unknown'?'提交结果未确认，请先核对原作业':'正在验证或提交，请等待结果'):saving?'参数正在保存':saveError?'仍有本地修改未保存，请重试保存':missing.length?'请先补齐 '+missing.length+' 项参数或待确认事项':!worker?'请连接作业服务；当前参数仍可编辑并保存':!current?'请点击复核，核对当前参数并准备对应输入草稿':!artifact?'尚未准备实际模块输入':!run?'正在核对实际模块状态':!['draft','ready'].includes(run.status)?'实际作业状态：'+run.status:'输入和复核版本一致，执行后仍需通过实际环境验证';
 return {stage,runRevision,runCurrent,reason:inFlight?'原作业仍在运行或待核对；可以编辑下一版草稿，核对原作业后再提交。':!current&&!missing.length&&!saving&&!saveError?'当前版本尚未复核；可直接运行，也可返回流程让 Agent 检查。':task.workflowVersion===2&&current&&!running&&!saving&&!saveError&&!missing.length&&worker?'科学参数已复核，请前往独立部署模块配置工作目录、队列和计算环境':reason,locked:false,canExecute:task.workflowVersion!==2&&!!(!inFlight&&!saving&&!saveError&&!missing.length&&worker&&runCurrent&&run&&['draft','ready'].includes(run.status))};
}
