import {SHARED_TERMINAL_CHAT_INSTRUCTIONS} from './agent-settings.mjs';
import {graphAuthorityContext,protectGraphMirrors} from './composition-authority.mjs';
import {scienceOnly,scientificSpec,deploymentField,inputControlParameters} from '../shared/deployment.mjs';
import {randomUUID} from 'node:crypto';
import {conversationTitle,validConversationName} from '../shared/conversation-title.mjs';
import {isDeepStrictEqual} from 'node:util';
import {normalizeSteps,workflowMissing,setParameter,parameterValue,fieldPath} from '../shared/task-fields.mjs';
export function structuredResult(value){
 const found=[];function walk(v,depth=0){if(depth>8||v==null)return;if(typeof v==='string'){try{walk(JSON.parse(v),depth+1);}catch{}return;}if(Array.isArray(v)){for(const item of v)walk(item,depth+1);return;}if(typeof v!=='object')return;if(v.id&&(v.engine||Array.isArray(v.steps)||v.kind==='cluster-setup'||v.kind==='task-parameters'))found.push(v);for(const k of ['content','structuredContent','result','output','data','text'])if(k in v)walk(v[k],depth+1);}walk(value);return found;
}
export class TaskRecords{
 constructor(catalog,publish){this.catalog=catalog;this.publish=publish;this.active=new Map();this.turns=new Map();this.cache=new Map();}
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
  this.catalog.transaction(()=>{this.catalog.put('deleted-conversation',id,{id,provider,threadId,taskIds,deletedAt:Date.now()});this.catalog.remove('conversation',id);this.catalog.remove('agent-thread',id);if(provider==='codex')this.catalog.remove('thread',threadId);if(['deepseek','compatible'].includes(provider))this.catalog.remove(provider+'-history',threadId);for(const key of taskIds)this.catalog.remove('agent-task',key);});
  this.active.delete(id);this.turns.delete(id);for(const key of taskIds)this.cache.delete(key);
  const result={id,provider,threadId,taskIds};this.publish({method:'studio/conversationDeleted',provider,params:result});return result;
 }
 conversations(){
  const values=(this.catalog.list?.('conversation')||[]).filter(c=>!this.deleted(c.provider,c.threadId));
  for(const c of values)if(!c.titleVersion){c.name=conversationTitle(c.name,{name:c.name,existing:true});c.titleVersion=1;c.titleSource='automatic';this.catalog.put('conversation',c.id,c);}
  for(const task of this.tasks().sort((a,b)=>b.updatedAt-a.updatedAt))if(task.threadId&&!this.deleted(task.provider,task.threadId)&&!values.some(c=>c.provider===task.provider&&c.threadId===task.threadId))values.push(this.remember({provider:task.provider,threadId:task.threadId,projectId:task.projectId,name:task.name,taskId:task.id}));
  return values.sort((a,b)=>b.updatedAt-a.updatedAt);
 }
 remember(value){
  if(this.deleted(value.provider,value.threadId))return null;
  if(value.groupId!=null&&!this.catalog.get('conversation-project',value.groupId))throw Error('Unknown conversation project');
  const previous=this.conversation(value.provider,value.threadId),id=value.provider+':'+value.threadId;
  const next={...previous,id,provider:value.provider,threadId:value.threadId,groupId:previous?previous.groupId||null:value.groupId||null,projectId:previous?.projectId||value.projectId||null,name:previous?.name||conversationTitle(value.intent||value.name,{name:value.intent?undefined:value.name,existing:!value.intent}),titleVersion:1,titleSource:previous?.titleSource||'automatic',taskId:value.taskId||previous?.taskId||null,updatedAt:Date.now()};
  this.catalog.put('conversation',id,next);this.publish({method:'studio/conversationUpdated',provider:next.provider,params:{conversation:next}});return next;
 }
 rename({id,name}){if(typeof id!=='string')throw Error('Invalid conversation');const previous=this.catalog.get('conversation',id);if(!previous||this.deleted(previous.provider,previous.threadId))throw Error('Unknown conversation');const next={...previous,name:validConversationName(name),titleVersion:1,titleSource:'manual'};this.catalog.put('conversation',id,next);this.publish({method:'studio/conversationUpdated',provider:next.provider,params:{conversation:next}});return next;}
 groups(){return this.catalog.list('conversation-project').sort((a,b)=>a.createdAt-b.createdAt);}
 createGroup(value){if(!value||Object.keys(value).join(',')!=='name')throw Error('Invalid conversation project');const group={id:randomUUID(),name:validConversationName(value.name),createdAt:Date.now()};this.catalog.put('conversation-project',group.id,group);return group;}
 organize(value){if(!value||Object.keys(value).sort().join(',')!=='groupId,id,pinned'||typeof value.id!=='string'||typeof value.pinned!=='boolean'||value.groupId!==null&&typeof value.groupId!=='string')throw Error('Invalid conversation organization');const old=this.catalog.get('conversation',value.id);if(!old||this.deleted(old.provider,old.threadId))throw Error('Unknown conversation');if(value.groupId!==null&&!this.catalog.get('conversation-project',value.groupId))throw Error('Unknown conversation project');const next={...old,pinned:value.pinned,groupId:value.groupId};this.catalog.put('conversation',next.id,next);this.publish({method:'studio/conversationUpdated',provider:next.provider,params:{conversation:next}});return next;}
 bindProject(provider,threadId,projectId){const previous=this.conversation(provider,threadId);if(!previous||this.deleted(provider,threadId))throw Error('Unknown conversation');const next={...previous,projectId,updatedAt:Date.now()};this.catalog.put('conversation',next.id,next);this.publish({method:'studio/conversationUpdated',provider,params:{conversation:next}});return next;}
 bound(provider,threadId){const conversation=this.conversation(provider,threadId);const id=conversation?.taskId||this.tasks().filter(t=>t.provider===provider&&t.threadId===threadId).sort((a,b)=>b.updatedAt-a.updatedAt)[0]?.id;return id?this.read(id):null;}
 create(value){
  if(value.planningMode!==true)throw Error('Enable task planning before creating a task');
  if(!['codex','kimi','qwen','deepseek','compatible'].includes(value.provider)||typeof value.request!=='string'||!value.request.trim()||value.request.length>100000||value.newWorkflow!==undefined&&typeof value.newWorkflow!=='boolean')throw Error('Invalid task intent');
  if(value.threadId&&this.deleted(value.provider,value.threadId))throw Error('Conversation was deleted');
  if(value.threadId&&!value.newWorkflow){const old=this.bound(value.provider,value.threadId);if(old)return old;}
  const task={id:randomUUID(),kind:'agent-task',planningMode:true,workflowVersion:value.workflowVersion===2?2:1,name:value.request.trim().slice(0,100),request:value.request,provider:value.provider,projectId:value.projectId||null,plan:[],steps:[],parameters:{},parameterRevision:0,manualEdits:{},review:{status:'not_run'},artifacts:[],phase:'collecting',updatedAt:Date.now()};
  if(task.workflowVersion===2){task.parameters={engine:'',files:[]};task.steps=[{id:'inputs',title:'引擎与输入',fields:[{key:'engine',label:'计算引擎',type:'select',required:true,options:['gpumd.sampling','pydyn.sampling','gpumd.neb','gpumd.md','pydyn.md','pygas.build','bias.validate','nep.train','nep.eval','hotpp.train','hotpp.eval','hotpp.export','nep.analyze','pygas.reweight','pygas.opes-reweight']},{key:'files',label:'科学输入文件',type:'files',required:true}]}];}
  this.save(task,true);return value.threadId?this.attach(task.id,value.provider,value.threadId):task;
 }
 attach(id,provider,threadId){
  const task=this.read(id);this.conversation(provider,threadId);if(task.provider!==provider||task.threadId&&task.threadId!==threadId)throw Error('Invalid task provider or conversation');
  this.active.set(provider+':'+threadId,id);task.threadId=threadId;this.remember({provider,threadId,projectId:task.projectId,name:task.name,taskId:id});return this.save(task);
 }
 edit(value){
  const task=this.read(value.id);if(['validating','submitting','unknown'].includes(task.execution?.phase))throw Error('Reconcile the execution request before editing its workflow');if(!value.changes||typeof value.changes!=='object'||Array.isArray(value.changes)||JSON.stringify(value.changes).length>200000||Object.keys(value.changes).length>100)throw Error('Invalid parameter edits');
  let changed=false;const fields=normalizeSteps(task.steps||[],task.parameters||{},[]).flatMap(step=>step.fields||[]);task.manualInputs={...task.manualInputs};
  for(const [key,next] of Object.entries(value.changes)){fieldPath(key);if(task.workflowVersion===2&&deploymentField(key))throw Error('请在独立部署模块设置运行环境和队列');
   const field=fields.find(field=>field.key===key),previous=parameterValue(task.parameters,key),receipt=task.manualInputs[key];
   if(field?.type==='file'&&typeof next==='string'&&next)task.manualInputs[key]={type:'file',value:next,approvedValues:[next]};
   else if(field?.type==='files'&&Array.isArray(next)){
    const prior=Array.isArray(previous)?previous:[],approved=[...(receipt?.type==='files'?receipt.approvedValues||[]:[]),...next.filter(item=>typeof item==='string'&&item&&!prior.includes(item))];
    task.manualInputs[key]={type:'files',value:structuredClone(next),approvedValues:[...new Set(approved)].filter(item=>next.includes(item))};
   }else delete task.manualInputs[key];
   if(!isDeepStrictEqual(parameterValue(task.parameters||{},key),next)){task.parameters=setParameter(task.parameters||{},key,next);changed=true;}}
  if(changed){task.parameterRevision=(task.parameterRevision||0)+1;task.manualEdits={...task.manualEdits,...Object.fromEntries(Object.keys(value.changes).map(k=>[k,task.parameterRevision]))};task.review={status:'not_run',summary:'参数已修改，需要重新复核'};task.missingFields=workflowMissing(task.steps||task.plan?.map(s=>s.step)||[],task.parameters,task.missingFields||[]);}
  return this.save(task);
 }
 prepareTurn(provider,value){
  const {planningMode=false,studioTaskId,reviewMode=false,...params}=value;
  if(typeof planningMode!=='boolean'||typeof reviewMode!=='boolean'||typeof params.threadId!=='string'||!params.threadId)throw Error('Invalid interaction mode');
  if(this.deleted(provider,params.threadId))throw Error('Conversation was deleted');
  let task=this.bound(provider,params.threadId);
  if(studioTaskId){const wanted=this.read(studioTaskId);if(wanted.provider!==provider||wanted.threadId&&wanted.threadId!==params.threadId||!planningMode&&!wanted.threadId)throw Error('Task is not bound to this conversation');task=wanted;}
  if(planningMode&&!task)throw Error('Planning requires a task record');
  const key=provider+':'+params.threadId;
  if(task){task=this.attach(task.id,provider,params.threadId);this.turns.set(key,{taskId:task.id,revision:task.parameterRevision||0,reviewMode,presented:false});if(reviewMode){task.review={status:'reviewing'};this.save(task);}}
  else{if(reviewMode)throw Error('Review requires an existing workflow');this.active.delete(key);this.turns.delete(key);}
  const mode=task?'[Studio interaction mode: '+(reviewMode?'review':planningMode?'planning':'workflow')+']\nstudioTaskId: '+task.id+'\nThis conversation owns this existing workflow. Update it in place only when the user changes the calculation or requests review; normal questions need no present_task. Never create another workflow implicitly. Call present_task with task_id, name, steps, parameters, missing_fields. steps may be strings for legacy data; prefer objects {id,title,description,tool,fields:[{key,label,type,required,unit,options}]}. Each key is a dot path into parameters; file fields contain actual paths. Do not use dotted object keys. Types: text,number,integer,boolean,file,files,list,select,multiline. Keep stable step IDs. Declare all required scientific fields and missing fields honestly. Manual current parameters and revision: '+JSON.stringify({parameterRevision:task.parameterRevision,parameters:task.parameters,steps:task.steps,artifacts:task.artifacts,composition:task.composition})+'\n'+(reviewMode&&task.workflowVersion===2?'Review science only. If scientific values changed, use write_project_input to update actual run.in, GAScfg.yaml or driver/config inputs first, then call present_task with final file paths and actual missing fields. Parameter metadata alone never rewrites an input. Deployment is configured afterwards; never prepare or submit a run.':reviewMode?'Review these exact parameters. Call present_task first; prepare a fresh real module draft with the current inputs if needed, then present_task again with remaining missing fields. Do not validate or submit. Completeness review is not scientific validation.':'Prepare real module drafts when requested, then stop for human review. Never execute.'):
  '[Studio interaction mode: chat]\nAnswer in conversation; read-only scientific inspection. '+SHARED_TERMINAL_CHAT_INSTRUCTIONS+' When explicitly asked to configure compute, discover existing environments and propose draft_local_environment or draft_cluster_setup for human review on the compute settings page; these setup drafts create no computation. Do not create scientific tasks or open workflow pages. Enable task planning for a new computation.';
  const scienceMode=task?.workflowVersion===2?'\n[Scientific workflow v2] Only define science here: parameters.engine (registered engine ID) and parameters.files (list of actual input paths; preserve basenames such as run.in, model.xyz, bias.pt, run.py). Keep scientific settings in other nested parameters. MetaD/WTMetaD default is ONE job and ONE walker, even with multiple CVs; do not invent replicas. Multiple walkers are unsupported unless explicitly implemented. Do NOT put workdir, queue, project/environment/cluster IDs, GPUs, walltime or resources in scientific steps/parameters. A separate desktop Deployment module collects these AFTER scientific review. In review mode call present_task to check input completeness; do NOT call prepare_run or prepare_cluster_run for v2. Never execute or submit.':'';
  const bindingContext=task?.inputBinding?'\n[Existing input controls] '+JSON.stringify(inputControlParameters(task.inputBinding.parameters))+'\nKeep these existing scientific parameter keys and values stable when science is unchanged. Put new derived observations, provenance and review text in step descriptions or a separate review manifest, never create duplicate numeric aliases. Changed, added or removed non-evidence controls with identical executable inputs are blocked; update actual driver/config for scientific changes. Never modify an unrelated manifest or comment merely to change the snapshot hash.':'';
  return {...params,input:[...(params.input||[]),{type:'text',text:mode+scienceMode+bindingContext+(task?graphAuthorityContext(task):'')}]};
 }
 save(task,showFlow=false){if(task.threadId&&this.deleted(task.provider,task.threadId))return task;const previous=this.catalog.get('agent-task',task.id);task.updatedAt=Math.max(Date.now(),(previous?.updatedAt||0)+1);this.catalog.put('agent-task',task.id,task);this.cache.set(task.id,task);this.publish({method:'studio/taskUpdated',provider:task.provider,params:{task,showFlow}});return task;}
 linkRun(id,run,expectedPrepared){const task=this.read(id);
  if(expectedPrepared!==undefined){
   const expected=expectedPrepared,keys=['artifactId','parameterRevision','deploymentRevision'];
   if(!expected||typeof expected!=='object'||Array.isArray(expected)||Object.keys(expected).length!==3||keys.some(key=>!Object.hasOwn(expected,key))||typeof expected.artifactId!=='string'||!expected.artifactId||expected.artifactId.length>128||keys.slice(1).some(key=>!Number.isSafeInteger(expected[key])||expected[key]<0))throw Error('Invalid prepared reference');
   const current=task.deployment?.prepared;
   if(run.id!==expected.artifactId||task.deployment?.revision!==expected.deploymentRevision||!current||keys.some(key=>current[key]!==expected[key]))throw Error('Prepared run changed; refresh the current input snapshots');
  }
  const old=task.artifacts.find(a=>a.id===run.id);if(task.projectId&&task.projectId!==run.project_id&&task.deployment?.config?.projectId!==run.project_id)throw Error('Run project does not match workflow');task.artifacts=task.artifacts.filter(a=>a.id!==run.id);task.artifacts.push({kind:run.kind==='cluster-run'?'cluster-run':'run',id:run.id,name:run.name,engine:run.engine,parameters:run.parameters||{},preparedRevision:old?.preparedRevision??null});if(task.workflowVersion!==2)task.review={status:'not_run',summary:'运行状态从作业服务读取'};if(task.execution?.artifactId===run.id)task.execution={...task.execution,phase:run.status==='unknown'?'unknown':run.status==='validating'?'validating':'confirmed',status:run.status};return this.save(task);}
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
     if(task.workflowVersion===2){const split=scienceOnly(parameters,item.steps,item.missing_fields||[]);parameters=split.parameters;item.steps=split.steps;item.missing_fields=split.missing;task.deploymentHints={...task.deploymentHints,...split.hints};}
     for(const [field,revision] of Object.entries(task.manualEdits||{}))if(turn.reviewMode||revision>turn.revision){
      const manual=parameterValue(task.parameters,field),proposed=parameterValue(parameters,field),root=task.authoring?.inputRoot;
      if(field==='files'&&Array.isArray(manual)&&Array.isArray(proposed)&&typeof root==='string'){
       const owned=proposed.filter(value=>typeof value==='string'&&value.startsWith(root.replace(/\/$/,'')+'/')&&!/[\\\r\n\0]/.test(value)&&!value.split('/').some(part=>part==='..'||part==='.')&&!manual.includes(value));
       parameters=setParameter(parameters,field,[...manual,...new Set(owned)]);
      }else parameters=setParameter(parameters,field,manual);
     }
     parameters=protectGraphMirrors(task,parameters);
     if(!isDeepStrictEqual(parameters,task.parameters)||!isDeepStrictEqual(item.steps,task.steps)){task.parameterRevision=(task.parameterRevision||0)+1;task.review={status:'not_run'};}
     task.name=item.name;task.parameters=parameters;task.steps=item.steps;task.plan=item.steps.map(v=>({step:typeof v==='string'?v:v.title,assistantStatus:'proposed'}));task.missingFields=workflowMissing(task.steps,parameters,item.missing_fields||[]);const c=this.conversation(provider,p.threadId);if(c&&c.titleSource!=='manual'){c.name=conversationTitle(task.request,{name:item.name,engine:parameters.engine});c.titleVersion=1;c.titleSource='workflow';this.catalog.put('conversation',c.id,c);this.publish({method:'studio/conversationUpdated',provider,params:{conversation:c}});}updated=presented=true;turn.presented=true;continue;
    }
    const kind=item.kind==='cluster-run'?'cluster-run':item.kind==='cluster-setup'?'cluster-setup':item.engine?'run':'workflow',old=task.artifacts.find(a=>a.id===item.id);
    task.artifacts=task.artifacts.filter(a=>a.id!==item.id);task.artifacts.push({kind,id:item.id,name:item.name,engine:item.engine,parameters:item.parameters||{},steps:item.steps,preparedRevision:old?old.preparedRevision:['prepare_run','prepare_cluster_run','resume_run'].includes(p.item?.tool)?task.parameterRevision:null});updated=true;
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
