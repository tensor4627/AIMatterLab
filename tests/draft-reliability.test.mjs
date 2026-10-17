import test from 'node:test';import assert from 'node:assert/strict';
import {DraftOutbox} from '../shared/draft-outbox.mjs';import {reviewState} from '../shared/review-state.mjs';
function storage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}
test('Failed saves survive remount and only acknowledged fields leave the durable outbox',async()=>{
 const local=storage(),first=new DraftOutbox('t',local);first.stage('md.temperature',345);await assert.rejects(first.flush(async()=>{throw Error('offline');}));
 const next=new DraftOutbox('t',local);assert.equal(next.apply({md:{temperature:300}}).md.temperature,345);await next.flush(async changes=>({id:'t',parameters:{md:{temperature:changes['md.temperature']}}}));assert.equal(next.pendingCount,0);assert.equal(local.getItem('studio.pending.t'),null);
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
