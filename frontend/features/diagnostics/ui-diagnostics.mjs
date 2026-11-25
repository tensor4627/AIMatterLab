import {redactTranscriptText} from '../../../contracts/agent/transcript-sanitizer.mjs';
import {executionNotStartedPrefix} from '../../../contracts/compute/run-operation-receipt.mjs';

const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const errorBody=text=>text.replace(/^Error invoking remote method ['"]studio:[A-Za-z0-9_.-]+['"]:\s*(?:Error:\s*)?/,'');
export const executionNotStarted=error=>errorBody(error instanceof Error?error.message:String(error)).startsWith(executionNotStartedPrefix);

export function diagnosticContext(task,config,operation,runId=null,targetName=''){return {operation,taskId:task.id,provider:task.provider||null,threadId:task.threadId||null,inputParameters:structuredClone(task.parameters||{}),taskName:task.name||'',parameterRevision:task.parameterRevision??0,deploymentRevision:task.deployment?.revision??0,target:config.target,targetId:config.targetId||'',targetName,projectId:config.projectId||'',runId:runId||task.deployment?.prepared?.artifactId||null,preparedId:task.deployment?.prepared?.artifactId||null,requestId:task.deployment?.request?.id||null,configuration:canonical(config),executionBefore:canonical(task.execution||null),taskVersion:task.updatedAt??null,phase:operation==='execute'?'unconfirmed':'failed'};}

export function createDiagnostic(error,context=null,severity='error'){
 const raw=redactTranscriptText(error instanceof Error?error.message:String(error));
 const stack=error instanceof Error&&error.stack?redactTranscriptText(error.stack):null;
 const captured=context?structuredClone(context):null;
 if(captured?.operation==='execute'&&executionNotStarted(error))captured.phase='blocked';
 return {id:crypto.randomUUID(),observedAt:Date.now(),raw,stack,context:captured,severity};
}

function freshExecution(record,task){return task?.id===record.context?.taskId&&task.execution?.artifactId===record.context?.runId&&canonical(task.execution)!==record.context.executionBefore;}

export function diagnosticPhase(record,task){if(record.resolution)return record.resolution.phase;const context=record.context;if(context?.operation==='execute'&&context.phase==='unconfirmed'&&freshExecution(record,task))return task.execution.phase||context.phase;return context?.phase||'failed';}

export const diagnosticPending=phase=>['unknown','unconfirmed','submitting','validating'].includes(phase);

export function diagnosticSeverity(record,phase){
 if(diagnosticPending(phase))return 'warning';
 if(phase==='confirmed')return 'info';
 return record.severity??'error';
}

export function diagnosticCurrent(record,task,config){const before=record.context;if(!before)return false;const after=diagnosticContext(task,config,before.operation);return ['taskId','parameterRevision','deploymentRevision','target','targetId','projectId','configuration','preparedId'].every(key=>before[key]===after[key]);}

export function diagnosticSummary(record,phase='failed'){
 if(diagnosticPending(phase))return '执行结果尚未确认，请核对原作业；不会自动重新提交。';
 if(phase==='confirmed')return '原作业状态已核对，以下保留当时诊断供查看。';
 const raw=errorBody(record.raw),body=raw.startsWith(executionNotStartedPrefix)?raw.slice(executionNotStartedPrefix.length):raw;
 if(/^(?:Required PyDyn runtime imports failed|PyDyn environment probe failed|PyDyn import probe)/.test(body))return '目标环境的 PyDyn 必需依赖未就绪，请检查解释器与已登记源码。';
 if(body.length<=200&&!/[\r\n]/.test(body)&&/[\u4e00-\u9fff]/.test(body))return body;
 return ({save:'部署保存未确认，请查看诊断详情。',prepare:'准备未完成，请查看诊断详情。',execute:'本次执行未提交。请查看诊断详情。'})[record.context?.operation]||'操作未完成，请查看诊断详情。';
}

export function createDiagnosticJournal(){const records=new Map();return {add(error,context){const value=createDiagnostic(error,context),list=records.get(context.taskId)||[];records.set(context.taskId,[...list,value]);return value;},list(taskId){return [...records.get(taskId)||[]];},reconcile(task){const list=(records.get(task.id)||[]).map(record=>!record.resolution&&record.context?.operation==='execute'&&record.context.phase==='unconfirmed'&&freshExecution(record,task)&&['blocked','confirmed'].includes(task.execution?.phase)?{...record,resolution:{phase:task.execution.phase,observedAt:Date.now(),execution:structuredClone(task.execution)}}:record);records.set(task.id,list);return [...list];}};}

// Renderer-lifetime presentation history only. Backend records remain authoritative.
export const deploymentDiagnosticJournal=createDiagnosticJournal();
