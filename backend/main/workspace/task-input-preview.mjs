import {normalizeSteps,parameterValue} from "../../../contracts/workflows/task-fields.mjs";

function referenced(task,path){
 const steps=normalizeSteps(task.steps?.length?task.steps:task.plan?.map(value=>value.step)||[],task.parameters||{},task.missingFields||[]);
 return steps.some(step=>step.fields.some(field=>{const value=parameterValue(task.parameters||{},field.key);return field.type==='file'?value===path:field.type==='files'&&Array.isArray(value)&&value.includes(path);}));
}
export async function readTaskInput(records,worker,value){
 if(!value||Array.isArray(value)||Object.keys(value).some(key=>!['taskId','path'].includes(key))||typeof value.taskId!=='string'||!value.taskId||value.taskId.length>200||typeof value.path!=='string'||!value.path||value.path.length>4096||value.path.includes('\0'))throw Error('Invalid task input preview request');
 const task=records.read(value.taskId);
 if(!task.projectId||!referenced(task,value.path))throw Error('Preview requires a saved file reference in the current task');
 const revision=task.parameterRevision,projectId=task.projectId;
 // Existing project grants are authoritative. This route never writes inputs or grants.
 const result=await worker.request('POST','/api/workspace/read',{project_id:projectId,name:value.path});
 const current=records.read(value.taskId);
 if(current.projectId!==projectId||current.parameterRevision!==revision||!referenced(current,value.path))throw Error('Task input changed while loading; reopen the current file');
 return result;
}
