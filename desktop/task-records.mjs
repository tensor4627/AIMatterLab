import {randomUUID} from 'node:crypto';
export function structuredResult(value){
 const found=[];
 function walk(v,depth=0){
  if(depth>8||v==null)return;
  if(typeof v==='string'){try{walk(JSON.parse(v),depth+1);}catch{}return;}
  if(Array.isArray(v)){for(const item of v)walk(item,depth+1);return;}
  if(typeof v!=='object')return;
  if(v.id&&(v.engine||Array.isArray(v.steps)||v.kind==='cluster-setup'||v.kind==='task-parameters'))found.push(v);
  for(const k of ['content','structuredContent','result','output','data','text'])if(k in v)walk(v[k],depth+1);
 }
 walk(value);return found;
}
export class TaskRecords{
 constructor(catalog,publish){this.catalog=catalog;this.publish=publish;this.active=new Map();}
 create(value){
  if(value.planningMode!==true)throw Error('Enable task planning before creating a task');
  if(!['codex','kimi','qwen'].includes(value.provider)||typeof value.request!=='string'||!value.request.trim()||value.request.length>100000)throw Error('Invalid task intent');
  const task={id:randomUUID(),kind:'agent-task',planningMode:true,name:value.request.trim().slice(0,100),request:value.request,provider:value.provider,projectId:value.projectId||null,plan:[],artifacts:[],phase:'collecting',updatedAt:Date.now()};
  this.catalog.put('agent-task',task.id,task);this.publish({method:'studio/taskUpdated',provider:task.provider,params:{task}});return task;
 }
 attach(id,provider,threadId){
  const task=this.catalog.get('agent-task',id);if(!task||task.provider!==provider)throw Error('Invalid task provider');
  this.active.set(provider+':'+threadId,id);return this.save({...task,threadId});
 }
 prepareTurn(provider,value){
  const {planningMode=false,studioTaskId,...params}=value;
  if(typeof planningMode!=='boolean'||typeof params.threadId!=='string'||!params.threadId)throw Error('Invalid interaction mode');
  if(planningMode){if(!studioTaskId)throw Error('Planning requires a task record');this.attach(studioTaskId,provider,params.threadId);}
  else {if(studioTaskId)throw Error('Chat cannot create a task');this.active.delete(provider+':'+params.threadId);}
  const mode=planningMode?'[Studio interaction mode: planning]\nstudioTaskId: '+studioTaskId+'\nCall gpusampling present_task with exactly the top-level keys task_id, name, steps (array of strings), parameters (object), and missing_fields (array of strings). Use task_id='+studioTaskId+'. Do not nest steps inside workflow. Confirm a successful task-parameters result before claiming the page was filled; correct tool errors. Then stop for human review.':'[Studio interaction mode: chat]\nAnswer in conversation. Read-only inspection is allowed. Do not present_task, create workflow or calculation drafts, write inputs, or open task pages. Ask the user to enable task planning when they want a prepared computation.';
  return {...params,input:[...(params.input||[]),{type:'text',text:mode}]};
 }
 save(task){const previous=this.catalog.get('agent-task',task.id);task.updatedAt=Math.max(Date.now(),(previous?.updatedAt||0)+1);this.catalog.put('agent-task',task.id,task);this.publish({method:'studio/taskUpdated',provider:task.provider,params:{task}});return task;}
 event(event){
  const p=event.params||{},provider=event.provider||'codex',id=this.active.get(provider+':'+p.threadId);if(!id)return;
  const task=this.catalog.get('agent-task',id);if(!task)return;
  if(event.method==='turn/plan/updated'){task.plan=(p.plan||[]).map(s=>({step:s.step,assistantStatus:s.status}));task.explanation=p.explanation||'';this.save(task);}
  if(event.method==='item/completed'){
   const artifacts=structuredResult(p.item?.result);
   for(const item of artifacts){if(item.kind==='task-parameters'){task.name=item.name;task.parameters=item.parameters;task.plan=(item.steps||[]).map(v=>typeof v==='string'?{step:v,assistantStatus:'proposed'}:{step:v.step||v.name||JSON.stringify(v),assistantStatus:'proposed'});task.missingFields=item.missing_fields;continue;}const kind=item.kind==='cluster-run'?'cluster-run':item.kind==='cluster-setup'?'cluster-setup':item.engine?'run':'workflow';task.artifacts=task.artifacts.filter(a=>a.id!==item.id);task.artifacts.push({kind,id:item.id,name:item.name,engine:item.engine,parameters:item.parameters||{},steps:item.steps});}
   if(artifacts.length){task.phase='review';this.save(task);}
  }
  if(event.method==='turn/completed'){task.phase=task.artifacts.length?'review':p.turn?.status==='failed'?'blocked':'needs-information';this.save(task);}
 }
}
