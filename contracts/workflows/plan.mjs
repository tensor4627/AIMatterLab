import {taskSchemas as tasks} from "./plan-schema.mjs";
export function validatePlan(value){
 const task=tasks.find(t=>t.id===value?.taskId);if(!task)throw Error('Unknown task');
 if(typeof value.name!=='string'||!value.name.trim()||value.name.length>200||typeof value.notes!=='string'||value.notes.length>10000)throw Error('Invalid plan text');
 if(!Array.isArray(value.steps)||value.steps.length!==task.steps.length)throw Error('Invalid steps');
 const steps=task.steps.map(s=>{
  const entries=value.steps.filter(v=>v.id===s.id);if(entries.length!==1)throw Error('Duplicate or missing step');
  const item=entries[0];
  if(typeof item.enabled!=='boolean'||s.required&&!item.enabled||!['agent','user'].includes(item.source)||typeof item.value!=='string'||item.value.length>10000)throw Error('Invalid step');
  return {id:s.id,enabled:item.enabled,source:item.source,value:item.value};
 });
 return {taskId:task.id,name:value.name,notes:value.notes,steps};
}
