const active=new WeakMap();
/** Deduplicate an identical in-flight action, never a different action or old result. */
export function taskOperation(records,taskId,kind,identity,perform){
 let slots=active.get(records);if(!slots){slots=new Map();active.set(records,slots);}const current=slots.get(taskId);
 if(current){if(current.kind===kind&&current.identity===identity)return current.promise;return Promise.reject(Object.assign(Error('此流程已有操作正在进行，请等待当前操作完成。'),{operationNotStarted:true}));}
 const operation={kind,identity,promise:null};operation.promise=Promise.resolve().then(perform).finally(()=>{if(slots.get(taskId)===operation)slots.delete(taskId);});slots.set(taskId,operation);return operation.promise;
}
