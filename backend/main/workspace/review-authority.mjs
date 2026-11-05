import {createHash} from 'node:crypto';
export function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(stable(value))).digest('hex');
export function reviewFingerprint(task){return digest({id:task.id,provider:task.provider,threadId:task.threadId,workflowVersion:task.workflowVersion,projectId:task.projectId,parameterRevision:task.parameterRevision,parameters:task.parameters,steps:task.steps,missingFields:task.missingFields||[],authoring:{projectId:task.authoring?.projectId,environmentId:task.authoring?.environmentId,inputRoot:task.authoring?.inputRoot},composition:task.composition,customCv:task.customCv?Object.fromEntries(['id','specSha','codeSha','parametersSha','revision'].map(key=>[key,task.customCv[key]])):null});}
/** receipt is read ONLY from a separate main-owned store, never the task/renderer/MCP. */
export function reviewAuthority(task,{target='local',receipt}={}){
 if(target==='local'&&task.workflowVersion===2&&receipt?.kind==='local-human-input-review-v1'&&task.localInputReview?.status==='confirmed'&&task.localInputReview.receiptId===receipt.id&&receipt.taskId===task.id&&receipt.fingerprint===reviewFingerprint(task)&&['pygas.build','bias.validate','gpumd.sampling'].includes(receipt.engine)&&receipt.engine===task.parameters?.engine)return {kind:'local-human',id:receipt.id,sha256:digest(receipt)};
 if(task.review?.status==='ready'&&task.review.parameterRevision===task.parameterRevision)return {kind:'ai',parameterRevision:task.parameterRevision};
 return null;
}
export function sameAuthority(left,right){return !!left&&!!right&&digest(left)===digest(right);}
