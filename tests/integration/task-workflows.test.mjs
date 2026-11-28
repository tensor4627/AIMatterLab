import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskRecords} from "../../agent/sessions/task-records.mjs";
import {executeTask} from "../../backend/main/workspace/task-execution.mjs";
import {normalizeSteps,workflowMissing,missingRequirements,setParameter} from "../../contracts/workflows/task-fields.mjs";
import {explicitNewWorkflow} from "../../frontend/features/conversations/workflow-intent.mjs";
import {engineContracts} from '../../contracts/tools/engine-contracts.mjs';

function fixture(){
 const data=new Map(),events=[],catalog={get:(kind,id)=>structuredClone(data.get(kind+':'+id)),put:(kind,id,value)=>{data.set(kind+':'+id,structuredClone(value));return value;},list:kind=>[...data].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>structuredClone(value))};
 return {data,catalog,events,records:new TaskRecords(catalog,event=>events.push(event))};
}
const steps=[{id:'md',title:'MD parameters',fields:[{key:'md.temperature',label:'Temperature',type:'number',required:true,unit:'K'},{key:'md.structure_file',label:'Structure',type:'file',required:true}]}];
function present(records,task,parameters={md:{temperature:300,structure_file:'/fixture/model.xyz'}},missing_fields=[]){
 records.event({provider:'codex',method:'item/completed',params:{threadId:'thread',item:{result:{id:task.id,kind:'task-parameters',name:'MD',steps,parameters,missing_fields}}}});
}
function artifact(records,id='run'){
 records.event({provider:'codex',method:'item/completed',params:{threadId:'thread',item:{tool:'prepare_run',result:{id,engine:'pydyn.md',project_id:'project',status:'draft',parameters:{temperature:300}}}}});
}
function create(records){return records.create({planningMode:true,provider:'codex',threadId:'thread',projectId:'project',request:'MD'});}
function reviewed(records){const task=create(records);records.prepareTurn('codex',{threadId:'thread',planningMode:true,studioTaskId:task.id});present(records,task);artifact(records);records.prepareTurn('codex',{threadId:'thread',studioTaskId:task.id,reviewMode:true});present(records,task);records.event({provider:'codex',method:'turn/completed',params:{threadId:'thread',turn:{status:'completed'}}});return records.read(task.id);}
test('a new workflow offers each contracted engine before the agent presents steps',()=>{
 const {records}=fixture();
 const task=records.create({workflowVersion:2,planningMode:true,provider:'codex',request:'Prepare a HotHam run'});
 const engine=records.read(task.id).steps[0].fields.find(field=>field.key==='engine');
 assert.deepEqual(new Set(engine.options),new Set(Object.keys(engineContracts.engines)));
});
test('A conversation reuses its workflow across requests, restarts and chat; explicit new preserves old',()=>{
 const {records,catalog}=fixture(),first=create(records);assert.equal(create(records).id,first.id);
 const restored=new TaskRecords(catalog,()=>{});assert.equal(create(restored).id,first.id);
 const next=restored.create({planningMode:true,newWorkflow:true,threadId:'thread',provider:'codex',request:'Another MD'});assert.notEqual(next.id,first.id);assert.equal(restored.read(first.id).threadId,'thread');assert.equal(restored.conversations()[0].taskId,next.id);
 assert.throws(()=>restored.attach(first.id,'codex','different-thread'));assert.throws(()=>restored.prepareTurn('qwen',{threadId:'thread',studioTaskId:first.id}));
});
test('Typed steps declare missing fields without confusing completeness and scientific validation',()=>{
 assert.deepEqual(workflowMissing(steps,{md:{temperature:0,structure_file:''}},[]),['md.structure_file']);
 assert.equal(normalizeSteps(['legacy'],{temperature:300},['structure']).at(-1).fields.length,2);
 assert.throws(()=>setParameter({},'__proto__.polluted',true));assert.throws(()=>setParameter({},'a.constructor.value',1));assert.equal({}.polluted,undefined);
 assert.equal(explicitNewWorkflow('新建一个计算流程'),true);assert.equal(explicitNewWorkflow('不要新建流程，只更新温度'),false);
});
test('Manual changes made during a model turn survive stale proposals and invalidate the review',()=>{
 const {records}=fixture(),task=create(records);records.prepareTurn('codex',{threadId:'thread',planningMode:true,studioTaskId:task.id});present(records,task);artifact(records);
 records.prepareTurn('codex',{threadId:'thread',reviewMode:true,studioTaskId:task.id});records.edit({id:task.id,changes:{'md.temperature':345}});present(records,task);records.event({provider:'codex',method:'turn/completed',params:{threadId:'thread',turn:{status:'completed'}}});
 const saved=records.read(task.id);assert.equal(saved.parameters.md.temperature,345);assert.equal(saved.review.status,'stale');
});
test('Review requires current prepared inputs, and an old artifact ID cannot refresh their revision',()=>{
 const {records}=fixture(),task=reviewed(records);assert.equal(task.review.status,'ready');assert(!task.validation);
 records.edit({id:task.id,changes:{'md.temperature':350}});assert.equal(records.read(task.id).review.status,'not_run');
 records.prepareTurn('codex',{threadId:'thread',reviewMode:true,studioTaskId:task.id});present(records,task,{md:{temperature:350,structure_file:'/fixture/model.xyz'}});artifact(records);
 records.event({provider:'codex',method:'turn/completed',params:{threadId:'thread',turn:{status:'completed'}}});assert.notEqual(records.read(task.id).review.status,'ready');
});
test('Foreign task results and native reasoning plans cannot replace a conversation workflow',()=>{
 const {records}=fixture(),task=create(records);records.prepareTurn('codex',{threadId:'thread',planningMode:true,studioTaskId:task.id});present(records,task);
 records.event({provider:'codex',method:'turn/plan/updated',params:{threadId:'thread',plan:[{step:'internal reasoning',status:'completed'}]}});assert.equal(records.read(task.id).steps[0].id,'md');
 present(records,{id:'foreign'},{md:{temperature:900}});assert.equal(records.read(task.id).parameters.md.temperature,300);
});
test('Execution preserves the captured run while subsequent model changes remain an editable draft',async()=>{
 const {records}=fixture(),task=reviewed(records),calls=[];
 const worker={request:async(_method,route)=>{calls.push(route);if(route.endsWith('status'))return {id:'run',project_id:'project',status:'draft'};if(route.endsWith('validate')){present(records,task,{md:{temperature:360,structure_file:'/fixture/model.xyz'}});return {validation:{status:'passed'}};}return {id:'run',project_id:'project',status:'queued'};}};
 const result=await executeTask(records,worker,{runChecks:true,taskId:task.id,artifactId:'run'});assert.equal(result.status,'queued');assert.equal(records.read(task.id).parameters.md.temperature,360);assert.equal(calls.filter(c=>c.endsWith('submit')).length,1);
});
test('Unconfirmed submission persists the original identity and cannot be automatically resubmitted',async()=>{
 const {records}=fixture(),task=reviewed(records),calls=[];
 const worker={request:async(_method,route)=>{calls.push(route);if(route.endsWith('status'))return {id:'run',project_id:'project',status:'draft'};if(route.endsWith('validate'))return {validation:{status:'passed'}};throw Error('response lost');}};
 await assert.rejects(executeTask(records,worker,{runChecks:true,taskId:task.id,artifactId:'run'}),/response lost/);assert.equal(records.read(task.id).execution.artifactId,'run');assert.equal(records.read(task.id).execution.phase,'unknown');
 await assert.rejects(executeTask(records,worker,{runChecks:true,taskId:task.id,artifactId:'run'}),/pending|never resubmit unknown/);assert.equal(calls.filter(c=>c.endsWith('submit')).length,1);
});

test('Read-only run queries cannot certify a newly prepared module for current parameters',()=>{
 const {records}=fixture(),task=create(records);records.prepareTurn('codex',{threadId:'thread',reviewMode:true,studioTaskId:task.id});present(records,task);
 records.event({provider:'codex',method:'item/completed',params:{threadId:'thread',item:{tool:'run_status',result:{id:'old-run',engine:'pydyn.md',status:'draft'}}}});
 records.event({provider:'codex',method:'turn/completed',params:{threadId:'thread',turn:{status:'completed'}}});assert.equal(records.read(task.id).review.status,'needs-information');
});
test('A failed provider request clears review state and can be retried',()=>{
 const {records}=fixture(),task=create(records);records.prepareTurn('codex',{threadId:'thread',reviewMode:true,studioTaskId:task.id});records.failedTurn('codex','thread',Error('provider unavailable'));assert.equal(records.read(task.id).review.status,'needs-information');
 records.prepareTurn('codex',{threadId:'thread',reviewMode:true,studioTaskId:task.id});assert.equal(records.read(task.id).review.status,'reviewing');
});

test('Typed completeness rejects string booleans, invalid options and optional malformed numbers',()=>{
 for(const [type,value,options] of [['boolean','false'],['number','300'],['select','invalid',['nvt','nve']],['files',[3]]])assert.deepEqual(workflowMissing([{id:'s',title:'S',fields:[{key:'value',label:'Value',type,required:false,options}]}],{value},[]),['value']);
 assert.deepEqual(workflowMissing([{id:'s',title:'S',fields:[{key:'value',label:'PBC',type:'boolean',required:true}]}],{value:false},[]),[]);
});

test('Legacy sessions migrate to their newest workflow while retaining older records',()=>{
 const {records,catalog}=fixture();for(const [id,time] of [['older',1],['newer',2]])catalog.put('agent-task',id,{id,kind:'agent-task',provider:'codex',threadId:'legacy',name:id,updatedAt:time,parameters:{},steps:[],artifacts:[]});
 assert.equal(records.conversations()[0].taskId,'newer');assert.equal(records.read('older').id,'older');
});


test('Legacy natural-language blockers survive restoration and manual edits without becoming field paths',()=>{
 const prose='确认 CV 原子编号与单位，并提供实际结构文件。';
 const missing=['md.structure_file',prose,'__proto__.polluted'];
 const normalized=normalizeSteps(['审阅输入'],{md:{temperature:300}},missing);
 assert.deepEqual(missingRequirements(missing),[prose,'__proto__.polluted']);
 assert(normalized.flatMap(s=>s.fields).every(f=>!missingRequirements(missing).includes(f.key)));
 assert.deepEqual(workflowMissing(normalized,{md:{temperature:300}},missing),missing);
 const {records,catalog}=fixture(),task=create(records);
 catalog.put('agent-task',task.id,{...task,steps:['审阅输入'],parameters:{md:{temperature:300}},missingFields:missing});
 const updated=records.edit({id:task.id,changes:{'md.temperature':345}});
 assert.equal(updated.parameters.md.temperature,345);assert.deepEqual(updated.missingFields,missing);
 assert.equal(updated.review.status,'not_run');assert.equal({}.polluted,undefined);
});

test('A cancelled or interrupted review can never enable execution',()=>{
 for(const status of ['cancelled','interrupted','failed']){const {records}=fixture(),task=reviewed(records);records.prepareTurn('codex',{threadId:'thread',reviewMode:true,studioTaskId:task.id});present(records,task);records.event({provider:'codex',method:'turn/completed',params:{threadId:'thread',turn:{status}}});assert.notEqual(records.read(task.id).review.status,'ready');}
});


test('Only affirmative workflow creation requests create a new page; negations and quoted examples stay conversation',()=>{
 for(const text of ['这是软件界面验收。请只精确回复 FINAL_UI_CHAT_OK，不调用工具、不读取文件、不新建流程。','不新建流程','新建流程是什么意思？','What does create a new workflow mean?','停止创建流程','取消新建流程','don’t create a new workflow','不用再新建流程','无需创建流程','请勿另建流程','不要新建流程，只更新温度','解释如何新建流程','“新建一个计算流程”这个按钮是什么意思？','请复述 `create a new workflow`','continue this workflow, do not create a new workflow',"don't start another workflow",'Explain how to create a new workflow',"The button says 'create a new workflow'."]){assert.equal(explicitNewWorkflow(text),false,text);}
 for(const text of ['新建一个计算流程','请另建一个流程，但不要执行','新建一个流程但不要执行','请新建一个计算流程，不调用外部工具','create a new workflow; do not run it','Do not execute; please create a new workflow','Can you start another workflow?'])assert.equal(explicitNewWorkflow(text),true,text);
});
