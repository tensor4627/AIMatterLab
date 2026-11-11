import test from 'node:test';import assert from 'node:assert/strict';
import {DraftOutbox,workflowOutbox,deleteWorkflowOutbox} from "../../frontend/features/workflows/draft-outbox.mjs";
import {reviewState} from "../../frontend/features/workflows/review-state.mjs";

function storage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
test('A remounted workflow shares its in-flight acknowledgement without losing a newer edit',async()=>{
 const local=storage(),oldView=workflowOutbox('same-task',local);let firstDone,secondDone;const saved=[];
 oldView.stage('md.temperature',300);
 const flight=oldView.flush(async changes=>{saved.push(changes['md.temperature']);await new Promise(resolve=>saved.length===1?firstDone=resolve:secondDone=resolve);return {id:'same-task',parameters:{md:{temperature:changes['md.temperature']}}};});
 const reopened=workflowOutbox('same-task',local);assert.equal(reopened,oldView);reopened.stage('md.temperature',350);
 assert.notEqual(workflowOutbox('other-task',local),reopened);assert.notEqual(workflowOutbox('same-task',storage()),reopened);
 firstDone();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reopened.pendingCount,1);assert.equal(workflowOutbox('same-task',local).apply({}).md.temperature,350);
 assert.equal(new DraftOutbox('same-task',local).apply({}).md.temperature,350);assert.deepEqual(saved,[300,350]);
 secondDone();await flight;assert.equal(reopened.pendingCount,0);assert.equal(local.getItem('studio.pending.same-task'),null);
});
test('Failed saves survive remount and only acknowledged fields leave the durable outbox',async()=>{
 const local=storage(),first=new DraftOutbox('t',local);first.stage('md.temperature',345);await assert.rejects(first.flush(async()=>{throw Error('offline');}));
 const next=new DraftOutbox('t',local);assert.equal(next.apply({md:{temperature:300}}).md.temperature,345);await next.flush(async changes=>({id:'t',parameters:{md:{temperature:changes['md.temperature']}}}));assert.equal(next.pendingCount,0);assert.equal(local.getItem('studio.pending.t'),null);
});
test('confirmed deletion invalidates the shared outbox before an in-flight acknowledgement can replay newer edits',async()=>{
 const local=storage(),box=workflowOutbox('deleted',local),other=workflowOutbox('kept',local),calls=[];let finish;
 box.stage('temperature',300);other.stage('temperature',400);const pending=box.flush(async changes=>{calls.push(changes);await new Promise(resolve=>{finish=resolve;});return {id:'deleted',parameters:changes};});box.stage('temperature',350);deleteWorkflowOutbox('deleted',local);finish();await pending;
 assert.equal(calls.length,1);assert.equal(box.pendingCount,0);assert.equal(local.getItem('studio.pending.deleted'),null);assert.throws(()=>workflowOutbox('deleted',local).stage('temperature',500),/deleted/);await assert.rejects(box.flush(async()=>{throw Error('Unexpected retry');}),/deleted/);assert.equal(other.pendingCount,1);assert(local.getItem('studio.pending.kept'));
});
test('A-B-A edits while saving cannot acknowledge a newer edit by value equality',async()=>{
 const outbox=new DraftOutbox('t',storage());let resolve;const saved=[];outbox.stage('temperature',300);
 const flight=outbox.flush(async changes=>{saved.push(changes.temperature);if(saved.length===1)await new Promise(r=>resolve=r);return {id:'t',parameters:changes};});
 outbox.stage('temperature',350);outbox.stage('temperature',300);resolve();await flight;assert.deepEqual(saved,[300,300]);assert.equal(outbox.pendingCount,0);
});
test('Missing or foreign save acknowledgements never discard pending inputs',async()=>{
 for(const result of [null,{id:'other',parameters:{}}]){const box=new DraftOutbox('t',storage());box.stage('temperature',300);await assert.rejects(box.flush(async()=>result),/acknowledged/);assert.equal(box.pendingCount,1);}
});
test('Outbox storage errors and prototype keys never silently change a draft',()=>{
 const box=new DraftOutbox('t',{getItem:()=>null,setItem:()=>{throw Error('quota');},removeItem:()=>{}});assert.throws(()=>box.stage('temperature',300),/quota/);assert.equal(box.pendingCount,0);assert.throws(()=>box.stage('__proto__.value',1));assert.equal({}.value,undefined);
});
test('Review instructions identify the actual gate, and unknown submission locks edits',()=>{
 const base={worker:true,saving:false,saveError:false,missing:[],task:{parameters:{temperature:300},parameterRevision:1,review:{status:'ready',parameterRevision:1,artifactIds:['r']}},artifact:{id:'r'},run:{status:'draft'}};
 assert.equal(reviewState(base).canExecute,true);assert.match(reviewState({...base,missing:['structure']}).reason,/1/);assert.equal(reviewState({...base,saveError:true}).canExecute,false);assert.equal(reviewState({...base,task:{...base.task,execution:{phase:'unknown'}}}).locked,true);assert.equal(reviewState({...base,task:{...base.task,review:{...base.task.review,parameterRevision:0}}}).canExecute,false);
});

test('Tool cards use actual failure flags and link only successfully persisted artifacts',async()=>{
 const {toolActivity}=await import("../../frontend/features/conversations/tool-activity.mjs");const result={content:[{type:'text',text:JSON.stringify({id:'t',kind:'task-parameters',name:'Draft'})}]};
 assert.equal(toolActivity({status:'completed',result}).artifact.id,'t');assert.equal(toolActivity({status:'completed',result:{...result,isError:true}}).state,'failed');assert.equal(toolActivity({status:'completed',result:{...result,isError:true}}).artifact,undefined);assert.equal(toolActivity({status:'inProgress'}).state,'running');
});

test('Restored user history hides Studio context while preserving the actual user message',async()=>{
 const {visibleUserText}=await import("../../contracts/agent/user-message.mjs");const context=JSON.stringify({environments:[],workflow:null,project:null});
 assert.equal(visibleUserText([{type:'text',text:'Run MD'},{type:'text',text:'[Studio workspace context]\n'+context},{type:'text',text:'[Studio interaction mode: planning]\nprivate instructions'}]),'Run MD');
 assert.equal(visibleUserText([{type:'text',text:'Run MD\n\n[Studio workspace context]\n'+context}]),'Run MD');
 assert.equal(visibleUserText([{type:'text',text:'Explain [Studio workspace context] in my code'}]),'Explain [Studio workspace context] in my code');
});


test('Current draft stage is independent of the previous completed run',()=>{
 const base={worker:true,saving:false,saveError:false,missing:[],task:{workflowVersion:2,parameters:{temperature:315},parameterRevision:3,review:{status:'not_run',parameterRevision:2}},artifact:{id:'old',preparedRevision:2},run:{id:'old',status:'succeeded'}};
 const changed=reviewState(base);assert.equal(changed.stage,2);assert.equal(changed.runRevision,2);assert.equal(changed.runCurrent,false);assert.equal(changed.canExecute,false);
 assert.equal(reviewState({...base,missing:['temperature']}).stage,1);
 const reviewed={...base,task:{...base.task,review:{status:'ready',parameterRevision:3}}};assert.equal(reviewState(reviewed).stage,3);
 const current={...reviewed,artifact:{id:'new',preparedRevision:3},run:{id:'new',status:'running'}};assert.equal(reviewState(current).stage,4);assert.match(reviewState(current).reason,/running/);
 assert.equal(reviewState({...current,artifact:{id:'historical'}}).runRevision,null);assert.equal(reviewState({...current,artifact:{id:'historical'}}).stage,3);
 assert.equal(reviewState({...base,task:{...base.task,execution:{phase:'unknown'}}}).locked,true);
});
