import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {normalizeSteps,workflowMissing,setParameter,parameterValue,fieldPath} from '../shared/task-fields.mjs';
export function structuredResult(value){
 const found=[];function walk(v,depth=0){if(depth>8||v==null)return;if(typeof v==='string'){try{walk(JSON.parse(v),depth+1);}catch{}return;}if(Array.isArray(v)){for(const item of v)walk(item,depth+1);return;}if(typeof v!=='object')return;if(v.id&&(v.engine||Array.isArray(v.steps)||v.kind==='cluster-setup'||v.kind==='task-parameters'))found.push(v);for(const k of ['content','structuredContent','result','output','data','text'])if(k in v)walk(v[k],depth+1);}walk(value);return found;
}
export class TaskRecords{
 constructor(catalog,publish){this.catalog=catalog;this.publish=publish;this.active=new Map();this.turns=new Map();this.cache=new Map();}
 tasks(){return this.catalog.list?.('agent-task')||[...this.cache.values()];}
 read(id){if(typeof id!=='string'||!id||id.length>200)throw Error('Invalid task ID');const value=this.catalog.get('agent-task',id);if(!value)throw Error('Unknown task');return structuredClone(value);}
 conversation(provider,threadId){if(!['codex','kimi','qwen'].includes(provider)||typeof threadId!=='string'||!threadId||threadId.length>200)throw Error('Invalid conversation');return this.catalog.get('conversation',provider+':'+threadId);}
 conversations(){
  const values=this.catalog.list?.('conversation')||[];
  for(const task of this.tasks().sort((a,b)=>b.updatedAt-a.updatedAt))if(task.threadId&&!values.some(c=>c.provider===task.provider&&c.threadId===task.threadId))values.push(this.remember({provider:task.provider,threadId:task.threadId,projectId:task.projectId,name:task.name,taskId:task.id}));
  return values.sort((a,b)=>b.updatedAt-a.updatedAt);
 }
 remember(value){
  const previous=this.conversation(value.provider,value.threadId),id=value.provider+':'+value.threadId;
  const next={...previous,id,provider:value.provider,threadId:value.threadId,projectId:previous?.projectId||value.projectId||null,name:previous?.name||value.name?.slice(0,100)||'新对话',taskId:value.taskId||previous?.taskId||null,updatedAt:Date.now()};
  this.catalog.put('conversation',id,next);this.publish({method:'studio/conversationUpdated',provider:next.provider,params:{conversation:next}});return next;
 }
 bound(provider,threadId){const conversation=this.conversation(provider,threadId);const id=conversation?.taskId||this.tasks().filter(t=>t.provider===provider&&t.threadId===threadId).sort((a,b)=>b.updatedAt-a.updatedAt)[0]?.id;return id?this.read(id):null;}
 create(value){
  if(value.planningMode!==true)throw Error('Enable task planning before creating a task');
  if(!['codex','kimi','qwen'].includes(value.provider)||typeof value.request!=='string'||!value.request.trim()||value.request.length>100000||value.newWorkflow!==undefined&&typeof value.newWorkflow!=='boolean')throw Error('Invalid task intent');
  if(value.threadId&&!value.newWorkflow){const old=this.bound(value.provider,value.threadId);if(old)return old;}
  const task={id:randomUUID(),kind:'agent-task',planningMode:true,name:value.request.trim().slice(0,100),request:value.request,provider:value.provider,projectId:value.projectId||null,plan:[],steps:[],parameters:{},parameterRevision:0,manualEdits:{},review:{status:'not_run'},artifacts:[],phase:'collecting',updatedAt:Date.now()};
  this.save(task,true);return value.threadId?this.attach(task.id,value.provider,value.threadId):task;
 }
 attach(id,provider,threadId){
  const task=this.read(id);this.conversation(provider,threadId);if(task.provider!==provider||task.threadId&&task.threadId!==threadId)throw Error('Invalid task provider or conversation');
  this.active.set(provider+':'+threadId,id);task.threadId=threadId;this.remember({provider,threadId,projectId:task.projectId,name:task.name,taskId:id});return this.save(task);
 }
 edit(value){
  const task=this.read(value.id);if(['validating','submitting','unknown'].includes(task.execution?.phase))throw Error('Reconcile the execution request before editing its workflow');if(!value.changes||typeof value.changes!=='object'||Array.isArray(value.changes)||JSON.stringify(value.changes).length>200000||Object.keys(value.changes).length>100)throw Error('Invalid parameter edits');
  let changed=false;
  for(const [key,next] of Object.entries(value.changes)){fieldPath(key);if(!isDeepStrictEqual(parameterValue(task.parameters||{},key),next)){task.parameters=setParameter(task.parameters||{},key,next);changed=true;}}
  if(changed){task.parameterRevision=(task.parameterRevision||0)+1;task.manualEdits={...task.manualEdits,...Object.fromEntries(Object.keys(value.changes).map(k=>[k,task.parameterRevision]))};task.review={status:'not_run',summary:'参数已修改，需要重新复核'};task.missingFields=workflowMissing(task.steps||task.plan?.map(s=>s.step)||[],task.parameters,task.missingFields||[]);}
  return this.save(task);
 }
 prepareTurn(provider,value){
  const {planningMode=false,studioTaskId,reviewMode=false,...params}=value;
  if(typeof planningMode!=='boolean'||typeof reviewMode!=='boolean'||typeof params.threadId!=='string'||!params.threadId)throw Error('Invalid interaction mode');
  let task=this.bound(provider,params.threadId);
  if(studioTaskId){const wanted=this.read(studioTaskId);if(wanted.provider!==provider||wanted.threadId&&wanted.threadId!==params.threadId||!planningMode&&!wanted.threadId)throw Error('Task is not bound to this conversation');task=wanted;}
  if(planningMode&&!task)throw Error('Planning requires a task record');
  const key=provider+':'+params.threadId;
  if(task){task=this.attach(task.id,provider,params.threadId);this.turns.set(key,{taskId:task.id,revision:task.parameterRevision||0,reviewMode,presented:false});if(reviewMode){task.review={status:'reviewing'};this.save(task);}}
  else{if(reviewMode)throw Error('Review requires an existing workflow');this.active.delete(key);this.turns.delete(key);}
  const mode=task?'[Studio interaction mode: '+(reviewMode?'review':planningMode?'planning':'workflow')+']\nstudioTaskId: '+task.id+'\nThis conversation owns this existing workflow. Update it in place only when the user changes the calculation or requests review; normal questions need no present_task. Never create another workflow implicitly. Call present_task with task_id, name, steps, parameters, missing_fields. steps may be strings for legacy data; prefer objects {id,title,description,tool,fields:[{key,label,type,required,unit,options}]}. Each key is a dot path into parameters; file fields contain actual paths. Do not use dotted object keys. Types: text,number,integer,boolean,file,files,list,select,multiline. Keep stable step IDs. Declare all required scientific fields and missing fields honestly. Manual current parameters and revision: '+JSON.stringify({parameterRevision:task.parameterRevision,parameters:task.parameters,steps:task.steps,artifacts:task.artifacts})+'\n'+(reviewMode?'Review these exact parameters. Call present_task first; prepare a fresh real module draft with the current inputs if needed, then present_task again with remaining missing fields. Do not validate or submit. Completeness review is not scientific validation.':'Prepare real module drafts when requested, then stop for human review. Never execute.'):
  '[Studio interaction mode: chat]\nAnswer in conversation; read-only inspection only. Do not create tasks or open pages. Enable task planning for a new computation.';
  return {...params,input:[...(params.input||[]),{type:'text',text:mode}]};
 }
 save(task,showFlow=false){const previous=this.catalog.get('agent-task',task.id);task.updatedAt=Math.max(Date.now(),(previous?.updatedAt||0)+1);this.catalog.put('agent-task',task.id,task);this.cache.set(task.id,task);this.publish({method:'studio/taskUpdated',provider:task.provider,params:{task,showFlow}});return task;}
 linkRun(id,run){const task=this.read(id),old=task.artifacts.find(a=>a.id===run.id);if(task.projectId&&task.projectId!==run.project_id)throw Error('Run project does not match workflow');task.artifacts=task.artifacts.filter(a=>a.id!==run.id);task.artifacts.push({kind:run.kind==='cluster-run'?'cluster-run':'run',id:run.id,name:run.name,engine:run.engine,parameters:run.parameters||{},preparedRevision:old?.preparedRevision??null});task.review={status:'not_run',summary:'运行状态从作业服务读取'};if(task.execution?.artifactId===run.id)task.execution={...task.execution,phase:run.status==='unknown'?'unknown':run.status==='validating'?'validating':'confirmed',status:run.status};return this.save(task);}
 failedTurn(provider,threadId,error){const turn=this.turns.get(provider+':'+threadId);if(!turn?.reviewMode)return;const task=this.read(turn.taskId);task.review={status:'needs-information',summary:'Agent 复核请求失败：'+error.message};this.save(task);}
 event(event){
  const p=event.params||{},provider=event.provider||'codex',key=provider+':'+p.threadId,id=this.active.get(key);if(!id)return;
  const task=this.read(id),turn=this.turns.get(key)||{revision:task.parameterRevision||0};
  if(event.method==='turn/plan/updated'&&!task.steps?.length&&!Object.keys(task.parameters||{}).length){task.plan=(p.plan||[]).map(s=>({step:s.step,assistantStatus:s.status}));task.explanation=p.explanation||'';this.save(task);}
  if(event.method==='item/completed'){
   const artifacts=structuredResult(p.item?.result);let updated=false,presented=false;
   for(const item of artifacts){
    if(item.kind==='task-parameters'){
     if(item.id!==task.id)continue;
     try{normalizeSteps(item.steps,item.parameters,item.missing_fields);}catch{continue;}
     let parameters=item.parameters||{};
     for(const [field,revision] of Object.entries(task.manualEdits||{}))if(turn.reviewMode||revision>turn.revision)parameters=setParameter(parameters,field,parameterValue(task.parameters,field));
     if(!isDeepStrictEqual(parameters,task.parameters)||!isDeepStrictEqual(item.steps,task.steps)){task.parameterRevision=(task.parameterRevision||0)+1;task.review={status:'not_run'};}
     task.name=item.name;task.parameters=parameters;task.steps=item.steps;task.plan=item.steps.map(v=>({step:typeof v==='string'?v:v.title,assistantStatus:'proposed'}));task.missingFields=workflowMissing(task.steps,parameters,item.missing_fields||[]);updated=presented=true;turn.presented=true;continue;
    }
    const kind=item.kind==='cluster-run'?'cluster-run':item.kind==='cluster-setup'?'cluster-setup':item.engine?'run':'workflow',old=task.artifacts.find(a=>a.id===item.id);
    task.artifacts=task.artifacts.filter(a=>a.id!==item.id);task.artifacts.push({kind,id:item.id,name:item.name,engine:item.engine,parameters:item.parameters||{},steps:item.steps,preparedRevision:old?old.preparedRevision:['prepare_run','prepare_cluster_run','resume_run'].includes(p.item?.tool)?task.parameterRevision:null});updated=true;
   }
   if(updated){task.phase='review';this.save(task,presented||['prepare_run','prepare_cluster_run','resume_run','draft_cluster_setup'].includes(p.item?.tool));}
  }
  if(event.method==='turn/completed'&&turn.reviewMode){
   const stale=Object.values(task.manualEdits||{}).some(revision=>revision>turn.revision),missing=workflowMissing(task.steps||[],task.parameters||{},task.missingFields||[]);
   const prepared=task.artifacts.some(a=>['run','cluster-run'].includes(a.kind)&&a.preparedRevision===task.parameterRevision);
   const ready=turn.presented&&!stale&&!missing.length&&prepared&&!p.turn?.error&&p.turn?.status!=='failed';
   task.review={status:ready?'ready':stale?'stale':'needs-information',parameterRevision:task.parameterRevision,artifactIds:ready?task.artifacts.filter(a=>a.preparedRevision===task.parameterRevision&&['run','cluster-run'].includes(a.kind)).map(a=>a.id):[],summary:stale?'复核期间参数发生变化，请重新复核':missing.length?'仍需补充：'+missing.join('、'):!prepared?'需要按当前参数准备实际模块草稿':ready?'AI 参数复核完成；执行时仍需实际环境验证':'AI 复核未完成'};this.save(task);
  }
 }
}
