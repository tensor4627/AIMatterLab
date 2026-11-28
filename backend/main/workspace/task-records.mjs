import {graphAuthorityFacts,protectGraphMirrors} from './composition-authority.mjs';
import {scienceOnly,scientificSpec,deploymentField,inputControlParameters} from "../../../contracts/compute/deployment.mjs";

import {createHash,randomUUID} from 'node:crypto';
import {conversationTitle,validConversationName} from "../../../contracts/agent/conversation-title.mjs";

import {isDeepStrictEqual} from 'node:util';
import {normalizeSteps,workflowMissing,setParameter,parameterValue,fieldPath} from "../../../contracts/workflows/task-fields.mjs";
import {analyzeRoadmap,validateRoadmap} from "../../../contracts/workflows/roadmap.mjs";
import {visibleUserText} from '../../../contracts/agent/user-message.mjs';
import {bindWorkflowInputFields} from '../../../contracts/workflows/task-input-fields.mjs';
import {engineContracts} from '../../../contracts/tools/engine-contracts.mjs';

export function structuredResult(value){
 const found=[];function walk(v,depth=0){if(depth>8||v==null)return;if(typeof v==='string'){try{walk(JSON.parse(v),depth+1);}catch{}return;}if(Array.isArray(v)){for(const item of v)walk(item,depth+1);return;}if(typeof v!=='object')return;if(v.id&&(v.engine||Array.isArray(v.steps)||v.kind==='cluster-setup'||v.kind==='task-parameters'))found.push(v);for(const k of ['content','structuredContent','result','output','data','text'])if(k in v)walk(v[k],depth+1);}walk(value);return found;
}
function workflowSnapshotDigest(workflow){
 return createHash('sha256').update(JSON.stringify(workflow)).digest('hex');
}
export class TaskRecords{
 constructor(catalog,publish){this.catalog=catalog;this.publish=publish;this.active=new Map();this.turns=new Map();this.cache=new Map();this.deliveredWorkflowSnapshots=new Map();this.pendingSnapshots=new Map();}
 tasks(){return this.catalog.list?.('agent-task')||[...this.cache.values()];}
 read(id){if(typeof id!=='string'||!id||id.length>200)throw Error('Invalid task ID');const value=this.catalog.get('agent-task',id);if(!value)throw Error('Unknown task');return structuredClone(value);}
 conversation(provider,threadId){if(!['codex','kimi','qwen','deepseek','compatible'].includes(provider)||typeof threadId!=='string'||!threadId||threadId.length>200)throw Error('Invalid conversation');return this.catalog.get('conversation',provider+':'+threadId);}
 deleted(provider,threadId){return !!(this.catalog.get('deleted-conversation',provider+':'+threadId)||this.catalog.get('retired-conversation-context',provider+':'+threadId));}
 remove(id){
  if(typeof id!=='string'||!id||id.length>210)throw Error('Invalid conversation');
  const previous=this.catalog.get('deleted-conversation',id);if(previous)return {id,provider:previous.provider,threadId:previous.threadId,taskIds:previous.taskIds};
  const conversation=this.catalog.get('conversation',id);if(!conversation)throw Error('Unknown conversation');
  const {provider,threadId}=conversation;this.conversation(provider,threadId);if(id!==provider+':'+threadId)throw Error('Invalid conversation identity');
  const taskIds=this.tasks().filter(t=>t.provider===provider&&t.threadId===threadId).map(t=>t.id);
  this.catalog.transaction(()=>{this.catalog.put('deleted-conversation',id,{id,provider,threadId,taskIds,deletedAt:Date.now()});this.catalog.remove('conversation',id);this.catalog.remove('conversation-title-progress',id);this.catalog.remove('conversation-bookmarks',id);this.catalog.remove('agent-thread',id);if(provider==='codex')this.catalog.remove('thread',threadId);if(['deepseek','compatible','kimi'].includes(provider))this.catalog.remove(provider+'-history',threadId);for(const key of taskIds)this.catalog.remove('agent-task',key);});
  this.active.delete(id);this.turns.delete(id);this.deliveredWorkflowSnapshots.delete(id);this.pendingSnapshots.delete(id);for(const key of taskIds)this.cache.delete(key);
  const result={id,provider,threadId,taskIds};this.publish({method:'studio/conversationDeleted',provider,params:result});return result;
 }
 conversations(){
  const values=(this.catalog.list?.('conversation')||[]).filter(c=>!this.deleted(c.provider,c.threadId));
  for(const c of values)if(!c.titleVersion){if(c.titleSource!=='manual')c.name=conversationTitle(c.name,{name:c.name,existing:true});c.titleVersion=1;c.titleSource??='automatic';this.catalog.put('conversation',c.id,c);}
  for(const task of this.tasks().sort((a,b)=>b.updatedAt-a.updatedAt))if(task.threadId&&!this.deleted(task.provider,task.threadId)&&!values.some(c=>c.provider===task.provider&&c.threadId===task.threadId))values.push(this.remember({provider:task.provider,threadId:task.threadId,projectId:task.projectId,name:task.name,taskId:task.id}));
  return values.sort((a,b)=>b.updatedAt-a.updatedAt);
 }
 remember(value){
  if(this.deleted(value.provider,value.threadId))return null;
  const requestedGroup=value.groupId!=null&&!this.catalog.get('conversation-project',value.groupId)&&this.catalog.get('deleted-conversation-project',value.groupId)?null:value.groupId;
  if(requestedGroup!=null&&!this.catalog.get('conversation-project',requestedGroup))throw Error('Unknown conversation project');
  const previous=this.conversation(value.provider,value.threadId),id=value.provider+':'+value.threadId;
  const next={...previous,id,provider:value.provider,threadId:value.threadId,groupId:previous?previous.groupId||null:requestedGroup||null,projectId:previous?.projectId||value.projectId||null,name:previous?.name||conversationTitle(value.intent||value.name,{name:value.intent?undefined:value.name,existing:!value.intent}),titleVersion:1,titleSource:previous?.titleSource||'automatic',taskId:value.taskId||previous?.taskId||null,updatedAt:Date.now()};
  this.catalog.put('conversation',id,next);this.publish({method:'studio/conversationUpdated',provider:next.provider,params:{conversation:next}});return next;
 }
 rename({id,name}){if(typeof id!=='string')throw Error('Invalid conversation');const previous=this.catalog.get('conversation',id);if(!previous||this.deleted(previous.provider,previous.threadId))throw Error('Unknown conversation');const next={...previous,name:validConversationName(name),titleVersion:1,titleSource:'manual'};this.catalog.put('conversation',id,next);this.publish({method:'studio/conversationUpdated',provider:next.provider,params:{conversation:next,titleOnly:true}});return next;}
 groups(){return this.catalog.list('conversation-project').sort((a,b)=>a.createdAt-b.createdAt);}
 createGroup(value){if(!value||Object.keys(value).join(',')!=='name')throw Error('Invalid conversation project');const group={id:randomUUID(),name:validConversationName(value.name),createdAt:Date.now()};this.catalog.put('conversation-project',group.id,group);return group;}
 deleteGroup(value){
  if(!value||Object.keys(value).join(',')!=='id'||typeof value.id!=='string'||!value.id||value.id.length>200)throw Error('Invalid conversation group deletion');
  const {id}=value;
  if(this.catalog.get('deleted-conversation-project',id))return {id,conversations:[]};
  if(!this.catalog.get('conversation-project',id))throw Error('Unknown conversation project');
  const conversations=this.catalog.list('conversation').filter(row=>row.groupId===id).map(row=>({...row,groupId:null}));
  this.catalog.transaction(()=>{
   for(const conversation of conversations)this.catalog.put('conversation',conversation.id,conversation);
   this.catalog.remove('conversation-project',id);
   this.catalog.put('deleted-conversation-project',id,{id,deletedAt:Date.now()});
  });
  for(const conversation of conversations)this.publish({method:'studio/conversationUpdated',provider:conversation.provider,params:{conversation}});
  const result={id,conversations};this.publish({method:'studio/conversationGroupDeleted',params:result});return result;
 }
 organize(value){if(!value||Object.keys(value).sort().join(',')!=='groupId,id,pinned'||typeof value.id!=='string'||typeof value.pinned!=='boolean'||value.groupId!==null&&typeof value.groupId!=='string')throw Error('Invalid conversation organization');const old=this.catalog.get('conversation',value.id);if(!old||this.deleted(old.provider,old.threadId))throw Error('Unknown conversation');if(value.groupId!==null&&!this.catalog.get('conversation-project',value.groupId))throw Error('Unknown conversation project');const next={...old,pinned:value.pinned,groupId:value.groupId};this.catalog.put('conversation',next.id,next);this.publish({method:'studio/conversationUpdated',provider:next.provider,params:{conversation:next}});return next;}
 bindProject(provider,threadId,projectId){const previous=this.conversation(provider,threadId);if(!previous||this.deleted(provider,threadId))throw Error('Unknown conversation');const next={...previous,projectId,updatedAt:Date.now()};this.catalog.put('conversation',next.id,next);this.publish({method:'studio/conversationUpdated',provider,params:{conversation:next}});return next;}
 bound(provider,threadId){const conversation=this.conversation(provider,threadId);const id=conversation?.taskId||this.tasks().filter(t=>t.provider===provider&&t.threadId===threadId).sort((a,b)=>b.updatedAt-a.updatedAt)[0]?.id;return id?this.read(id):null;}
 create(value){
  if(value.planningMode!==true)throw Error('Enable task planning before creating a task');
  if(!['codex','kimi','qwen','deepseek','compatible'].includes(value.provider)||typeof value.request!=='string'||!value.request.trim()||value.request.length>100000||value.newWorkflow!==undefined&&typeof value.newWorkflow!=='boolean')throw Error('Invalid task intent');
  if(value.threadId&&this.deleted(value.provider,value.threadId))throw Error('Conversation was deleted');
  if(value.threadId&&!value.newWorkflow){const old=this.bound(value.provider,value.threadId);if(old)return old;}
  const conversation=value.threadId?this.conversation(value.provider,value.threadId):null;
  const task={id:randomUUID(),kind:'agent-task',planningMode:true,workflowVersion:value.workflowVersion===2?2:1,name:value.request.trim().slice(0,100),request:value.request,provider:value.provider,projectId:conversation?conversation.projectId??null:value.projectId||null,plan:[],steps:[],parameters:{},parameterRevision:0,manualEdits:{},review:{status:'not_run'},artifacts:[],phase:'collecting',updatedAt:Date.now()};
  if(task.workflowVersion===2){task.parameters={engine:'',files:[]};task.steps=[{id:'inputs',title:'引擎与输入',fields:[{key:'engine',label:'计算引擎',type:'select',required:true,options:Object.keys(engineContracts.engines)},{key:'files',label:'科学输入文件',type:'files',required:true}]}];}
  this.save(task,true);return value.threadId?this.attach(task.id,value.provider,value.threadId):task;
 }
 attach(id,provider,threadId){
  const task=this.read(id);this.conversation(provider,threadId);if(task.provider!==provider||task.threadId&&task.threadId!==threadId)throw Error('Invalid task provider or conversation');
  this.active.set(provider+':'+threadId,id);task.threadId=threadId;this.remember({provider,threadId,projectId:task.projectId,name:task.name,taskId:id});return this.save(task);
 }
 edit(value){
  const task=this.read(value.id);if(!value.changes||typeof value.changes!=='object'||Array.isArray(value.changes)||JSON.stringify(value.changes).length>200000||Object.keys(value.changes).length>100)throw Error('Invalid parameter edits');
  const previousParameters=task.parameters;
  let changed=false;const fields=normalizeSteps(task.steps||[],task.parameters||{},[]).flatMap(step=>step.fields||[]);task.manualInputs={...task.manualInputs};
  for(const [key,next] of Object.entries(value.changes)){fieldPath(key);if(task.workflowVersion===2&&deploymentField(key))throw Error('请在独立部署模块设置运行环境和队列');
   const field=fields.find(field=>field.key===key),previous=parameterValue(task.parameters,key),receipt=task.manualInputs[key];
   if(field?.type==='file'&&typeof next==='string'&&next)task.manualInputs[key]={type:'file',value:next,approvedValues:[next]};
   else if(field?.type==='files'&&Array.isArray(next)){
    const prior=Array.isArray(previous)?previous:[],approved=[...(receipt?.type==='files'?receipt.approvedValues||[]:[]),...next.filter(item=>typeof item==='string'&&item&&!prior.includes(item))];
    task.manualInputs[key]={type:'files',value:structuredClone(next),approvedValues:[...new Set(approved)].filter(item=>next.includes(item))};
   }else delete task.manualInputs[key];
   if(!isDeepStrictEqual(parameterValue(task.parameters||{},key),next)){task.parameters=setParameter(task.parameters||{},key,next);changed=true;}}
  if(changed){
   const beforeBinding=task.parameters,edited=new Set(Object.keys(value.changes));
   if(task.workflowVersion===2)task.parameters=bindWorkflowInputFields(task.steps,task.parameters,{previous:previousParameters,changes:value.changes});
   if(beforeBinding!==task.parameters)for(const key of new Set(['files',...fields.map(field=>field.key)])){
    if(!isDeepStrictEqual(parameterValue(beforeBinding,key),parameterValue(task.parameters,key)))edited.add(key);
   }
   task.parameterRevision=(task.parameterRevision||0)+1;task.manualEdits={...task.manualEdits,...Object.fromEntries([...edited].map(k=>[k,task.parameterRevision]))};task.review={status:'not_run',summary:'参数已修改，需要重新复核'};task.missingFields=workflowMissing(task.steps||task.plan?.map(s=>s.step)||[],task.parameters,task.missingFields||[]);
  }
  return this.save(task);
 }
 /** Prepare owned workflow state before model-facing formatting. */
 prepareTurnState(provider,value){
  const {planningMode=false,studioTaskId,reviewMode=false,...params}=value;
  if(typeof planningMode!=='boolean'||typeof reviewMode!=='boolean'||typeof params.threadId!=='string'||!params.threadId)throw Error('Invalid interaction mode');
  if(this.deleted(provider,params.threadId))throw Error('Conversation was deleted');
  let task=this.bound(provider,params.threadId);
  if(studioTaskId){const wanted=this.read(studioTaskId);if(wanted.provider!==provider||wanted.threadId&&wanted.threadId!==params.threadId||!planningMode&&!wanted.threadId)throw Error('Task is not bound to this conversation');task=wanted;}
  if(planningMode&&!task)throw Error('Planning requires a task record');
  const key=provider+':'+params.threadId;
  if(task){task=this.attach(task.id,provider,params.threadId);this.turns.set(key,{taskId:task.id,revision:task.parameterRevision||0,reviewMode,presented:false,userRequest:visibleUserText(params.input||[])});if(reviewMode){task.review={status:'reviewing'};this.save(task);}}
  else{if(reviewMode)throw Error('Review requires an existing workflow');this.active.delete(key);this.turns.delete(key);}
  const roadmap=task?.roadmap&&analyzeRoadmap(task.roadmap,task.parameters);
  const executionObservation=roadmap&&this.catalog.list?.('roadmap-execution-index').filter(row=>row.task_id===task.id).sort((a,b)=>b.confirmed_at-a.confirmed_at)[0]?.observation;
  const workflow=task?{
   id:task.id,workflowVersion:task.workflowVersion,parameterRevision:task.parameterRevision,
   parameters:task.parameters,steps:task.steps,artifacts:task.artifacts,composition:task.composition,
   ...(roadmap?{roadmap:task.roadmap,roadmapFindings:roadmap.findings,roadmapOrder:roadmap.order}:{}),
   ...(executionObservation?{executionObservation}:{}),
   ...(task.inputBinding?{inputBinding:{parameters:inputControlParameters(task.inputBinding.parameters)}}:{}),
   graphAuthority:graphAuthorityFacts(task)
  }:null;
  let contextBaseline;
  if(workflow){
   const digest=workflowSnapshotDigest(workflow),previous=this.deliveredWorkflowSnapshots.get(key);
   this.pendingSnapshots.set(key,{taskId:workflow.id,workflowVersion:workflow.workflowVersion,parameterRevision:workflow.parameterRevision,digest});
   if(!reviewMode&&previous&&previous.taskId===workflow.id&&previous.workflowVersion===workflow.workflowVersion&&previous.digest===digest){
    contextBaseline={unchanged:true,parameterRevision:workflow.parameterRevision,digest:digest.slice(0,12)};
   }
  }else{
   this.pendingSnapshots.delete(key);this.deliveredWorkflowSnapshots.delete(key);
  }
  return {params,interaction:structuredClone({planningMode,reviewMode,workflow,...(contextBaseline?{contextBaseline}:{})})};
 }
 currentInputRequest({provider,threadId,taskId}){
  const turn=this.turns.get(provider+':'+threadId);
  return turn?.taskId===taskId?turn.userRequest:undefined;
 }
 confirmTurnContext(provider,threadId){
  const key=provider+':'+threadId,pending=this.pendingSnapshots.get(key);
  if(pending){this.deliveredWorkflowSnapshots.set(key,pending);this.pendingSnapshots.delete(key);}
 }
 resetTurnContext(provider,threadId){
  const key=provider+':'+threadId;
  this.deliveredWorkflowSnapshots.delete(key);this.pendingSnapshots.delete(key);
 }
 save(task,showFlow=false){if(task.threadId&&this.deleted(task.provider,task.threadId))return task;const previous=this.catalog.get('agent-task',task.id);task.updatedAt=Math.max(Date.now(),(previous?.updatedAt||0)+1);this.catalog.put('agent-task',task.id,task);this.cache.set(task.id,task);this.publish({method:'studio/taskUpdated',provider:task.provider,params:{task,showFlow}});return task;}
 linkRun(id,run,expectedPrepared){
  const task=this.read(id),kind=run.kind==='cluster-run'?'cluster-run':'run';
  const target=task.deployment?.config?.target;
  const deployedKind=target==='cluster'?'cluster-run':target==='local'?'run':null;
  if(expectedPrepared!==undefined){
   const expected=expectedPrepared,keys=['artifactId','parameterRevision','deploymentRevision'];
   if(!expected||typeof expected!=='object'||Array.isArray(expected)||Object.keys(expected).length!==3||keys.some(key=>!Object.hasOwn(expected,key))||typeof expected.artifactId!=='string'||!expected.artifactId||expected.artifactId.length>128||keys.slice(1).some(key=>!Number.isSafeInteger(expected[key])||expected[key]<0))throw Error('Invalid prepared reference');
   const current=task.deployment?.prepared;
   if(run.id!==expected.artifactId||(deployedKind&&kind!==deployedKind)||task.deployment?.revision!==expected.deploymentRevision||!current||keys.some(key=>current[key]!==expected[key]))throw Error('Prepared run changed; refresh the current input snapshots');
  }
  if(task.projectId&&task.projectId!==run.project_id&&task.deployment?.config?.projectId!==run.project_id)throw Error('Run project does not match workflow');
  const matches=row=>row.id===run.id&&row.kind===kind,old=task.artifacts.find(matches);
  task.artifacts=task.artifacts.filter(row=>!matches(row));
  task.artifacts.push({kind,id:run.id,name:run.name,engine:run.engine,parameters:run.parameters||{},preparedRevision:old?.preparedRevision??null});
  if(task.workflowVersion!==2)task.review={status:'not_run',summary:'运行状态从作业服务读取'};
  const attemptKind=task.execution?.artifactKind||deployedKind;
  const sameAttempt=attemptKind?attemptKind===kind:!task.artifacts.some(row=>row.id===run.id&&row.kind!==kind);
  // A draft observed while a submit reply is unresolved does not settle that request.
  const unsettledDraft=['draft','ready'].includes(run.status)&&['validating','submitting','unknown','blocked'].includes(task.execution?.phase);
  if(task.execution?.artifactId===run.id&&sameAttempt&&!unsettledDraft)task.execution={...task.execution,phase:run.status==='unknown'?'unknown':run.status==='validating'?'validating':'confirmed',status:run.status};
  return this.save(task);
 }
 failedTurn(provider,threadId,error){const key=provider+':'+threadId;this.pendingSnapshots.delete(key);this.deliveredWorkflowSnapshots.delete(key);const turn=this.turns.get(key);if(!turn?.reviewMode)return;const task=this.read(turn.taskId);task.review={status:'needs-information',summary:'Agent 复核请求失败：'+error.message};this.save(task);}
 presentDraft(provider,threadId,value){
  const key=provider+':'+threadId,activeId=this.active.get(key);
  if(activeId!==value.task_id||this.turns.get(key)?.taskId!==activeId||this.bound(provider,threadId)?.id!==activeId||this.deleted(provider,threadId))throw Error('The draft must belong to this conversation');
  const {task_id,...draft}=value;
  this.event({method:'item/completed',provider,params:{threadId,item:{tool:'present_task',result:{id:task_id,kind:'task-parameters',...draft}}}});
  return this.read(activeId);
 }
 event(event){
  const p=event.params||{},provider=event.provider||'codex',key=provider+':'+p.threadId;
  if(event.method==='thread/compacted'||event.method==='item/completed'&&p.item?.type==='contextCompaction'){this.deliveredWorkflowSnapshots.delete(key);this.pendingSnapshots.delete(key);}
  if(event.method==='turn/completed'){
   if(p.turn?.error||['failed','interrupted','cancelled','canceled'].includes(p.turn?.status)){this.deliveredWorkflowSnapshots.delete(key);this.pendingSnapshots.delete(key);}
   else this.confirmTurnContext(provider,p.threadId);
  }
  const id=this.active.get(key);if(!id)return;
  const task=this.read(id),turn=this.turns.get(key)||{revision:task.parameterRevision||0};
  if(event.method==='turn/plan/updated'&&!task.steps?.length&&!Object.keys(task.parameters||{}).length){task.plan=(p.plan||[]).map(s=>({step:s.step,assistantStatus:s.status}));task.explanation=p.explanation||'';this.save(task);}
  if(event.method==='item/completed'){
   const artifacts=structuredResult(p.item?.result);let updated=false,presented=false;
   for(const item of artifacts){
    if(item.kind==='task-parameters'){
     if(item.id!==task.id)continue;
     let roadmap;
     try{
      normalizeSteps(item.steps,item.parameters,item.missing_fields);
      if(Object.hasOwn(item,'roadmap'))roadmap=validateRoadmap(item.roadmap);
     }catch{continue;}
     let parameters=item.parameters||{};
     if(task.workflowVersion===2){const split=scienceOnly(parameters,item.steps,item.missing_fields||[]);parameters=split.parameters;item.steps=split.steps;item.missing_fields=split.missing;task.deploymentHints={...task.deploymentHints,...split.hints};}
     for(const [field,revision] of Object.entries(task.manualEdits||{}))if(turn.reviewMode||revision>turn.revision){
      const manual=parameterValue(task.parameters,field),proposed=parameterValue(parameters,field),root=task.authoring?.inputRoot;
      if(field==='files'&&Array.isArray(manual)&&Array.isArray(proposed)&&typeof root==='string'){
       const owned=proposed.filter(value=>typeof value==='string'&&value.startsWith(root.replace(/\/$/,'')+'/')&&!/[\\\r\n\0]/.test(value)&&!value.split('/').some(part=>part==='..'||part==='.')&&!manual.includes(value));
       parameters=setParameter(parameters,field,[...manual,...new Set(owned)]);
      }else parameters=setParameter(parameters,field,manual);
     }
     parameters=protectGraphMirrors(task,parameters);
     if(task.workflowVersion===2)parameters=bindWorkflowInputFields(item.steps,parameters);
     if(roadmap)task.roadmap=roadmap;
     if(!isDeepStrictEqual(parameters,task.parameters)||!isDeepStrictEqual(item.steps,task.steps)){task.parameterRevision=(task.parameterRevision||0)+1;task.review={status:'not_run'};}
     task.name=item.name;task.parameters=parameters;task.steps=item.steps;task.plan=item.steps.map(v=>({step:typeof v==='string'?v:v.title,assistantStatus:'proposed'}));task.missingFields=workflowMissing(task.steps,parameters,item.missing_fields||[]);
     const c=this.conversation(provider,p.threadId);
     if(c&&!['manual','model'].includes(c.titleSource)){c.name=conversationTitle(task.request,{name:item.name,engine:parameters.engine});c.titleVersion=1;c.titleSource='workflow';this.catalog.put('conversation',c.id,c);this.publish({method:'studio/conversationUpdated',provider,params:{conversation:c}});}
     updated=presented=true;turn.presented=true;continue;
    }
    const kind=item.kind==='cluster-run'?'cluster-run':item.kind==='cluster-setup'?'cluster-setup':item.engine?'run':'workflow',old=task.artifacts.find(a=>a.id===item.id&&a.kind===kind);
    task.artifacts=task.artifacts.filter(a=>a.id!==item.id||a.kind!==kind);task.artifacts.push({kind,id:item.id,name:item.name,engine:item.engine,parameters:item.parameters||{},steps:item.steps,preparedRevision:old?old.preparedRevision:['prepare_run','prepare_cluster_run','resume_run'].includes(p.item?.tool)?task.parameterRevision:null});updated=true;
   }
   if(updated){task.phase='review';this.save(task,presented||['prepare_run','prepare_cluster_run','resume_run','draft_cluster_setup'].includes(p.item?.tool));}
  }
  if(event.method==='turn/completed'&&turn.reviewMode){
   const stale=Object.values(task.manualEdits||{}).some(revision=>revision>turn.revision)||Math.max(task.authoring?.compositionAuthority?.lastHumanRevision||0,task.authoring?.lastHumanCompositionRevision||0)>turn.revision,missing=workflowMissing(task.steps||[],task.parameters||{},task.missingFields||[]);
   if(task.composition?.render_blocked)missing.push('CV/bias graph requires a complete source-backed render: '+(task.composition.reasons||task.composition.missing_fields||[]).join(', '));
   const prepared=task.artifacts.some(a=>['run','cluster-run'].includes(a.kind)&&a.preparedRevision===task.parameterRevision);
   let scientific=false;if(task.workflowVersion===2)try{scientificSpec(task);scientific=true;}catch(error){missing.push(error.message);}
   const ready=turn.presented&&!stale&&!missing.length&&(task.workflowVersion===2?scientific:prepared)&&!p.turn?.error&&p.turn?.status==='completed';
   task.review={status:ready?'ready':stale?'stale':'needs-information',parameterRevision:task.parameterRevision,artifactIds:ready?task.artifacts.filter(a=>a.preparedRevision===task.parameterRevision&&['run','cluster-run'].includes(a.kind)).map(a=>a.id):[],summary:stale?'复核期间参数发生变化，请重新复核':missing.length?'仍需补充：'+missing.join('、'):task.workflowVersion!==2&&!prepared?'需要按当前参数准备实际模块草稿':ready?'AI 参数复核完成；执行时仍需实际环境验证':'AI 复核未完成'};this.save(task);
  }
 }
}
