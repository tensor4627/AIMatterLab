import test from 'node:test';
import assert from 'node:assert/strict';
import {RunReviewDraft,reviewDraftIdentity,REVIEW_DRAFT_LIMITS} from '../../frontend/features/runs/run-review-draft.mjs';

const record=()=>({id:'run',name:'Original',project_id:'project',environment_id:'env',directory:'/isolated/run',engine:'gpumd.md',created_at:1,gpu:0,max_seconds:60,parameters:{temperature:300},inputs:{'run.in':'hash'}});
function storage(){const entries=new Map();return {entries,get length(){return entries.size;},key:index=>[...entries.keys()][index]??null,getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};}

test('review edits survive remount and a fresh storage adapter without changing the original run',()=>{
 const local=storage(),run=record(),before=JSON.stringify(run),draft=new RunReviewDraft('worker-a',run,local);
 draft.stage({name:'Revised',parameters:JSON.stringify({temperature:350}),inputs:{'run.in':'/new/input'},edits:{'run.in':'changed content'}});
 assert.equal(new RunReviewDraft('worker-a',run,local).values.name,'Revised');
 const restarted=new RunReviewDraft('worker-a',run,{...local});assert.deepEqual(restarted.values,draft.values);assert(restarted.dirty);assert.equal(JSON.stringify(run),before);
});
test('same run ID in another source, project, environment, directory, engine or creation is isolated',()=>{
 const local=storage(),run=record(),draft=new RunReviewDraft('worker-a',run,local);draft.stage({name:'Private edit'});
 assert.equal(new RunReviewDraft('worker-b',run,local).values.name,'Original');
 for(const key of ['project_id','environment_id','directory','engine','created_at']){const other={...run,[key]:key==='created_at'?2:run[key]+'-other'};assert.notEqual(reviewDraftIdentity('worker-a',other),draft.identity);assert.equal(new RunReviewDraft('worker-a',other,local).values.name,'Original');}
});
test('changed authoritative baseline preserves the old draft for review and blocks overwrite',()=>{
 const local=storage(),run=record(),first=new RunReviewDraft('worker-a',run,local);first.stage({name:'Saved edit'});const raw=local.getItem(first.key);
 const changed=new RunReviewDraft('worker-a',{...run,parameters:{temperature:400}},local);assert(changed.conflict);assert.equal(changed.values.parameters,JSON.stringify({temperature:400},null,2));assert.equal(changed.saved.values.name,'Saved edit');assert.equal(changed.stage({name:'Overwrite'}),false);assert.equal(local.getItem(first.key),raw);
 assert(changed.discard());assert.equal(local.getItem(first.key),null);assert.equal(changed.conflict,false);assert.equal(changed.dirty,false);
});
test('unreadable cached draft is kept and requires explicit discard rather than silently disappearing',()=>{
 const local=storage(),run=record(),first=new RunReviewDraft('worker-a',run,local);local.setItem(first.key,'corrupt retained bytes');const next=new RunReviewDraft('worker-a',run,local);assert(next.conflict);assert.equal(next.stage({name:'Overwrite'}),false);assert.equal(local.getItem(first.key),'corrupt retained bytes');assert(next.discard());assert.equal(local.getItem(first.key),null);
});
test('storage quota failure keeps edits in the current session, reports failure and can retry',()=>{
 const local=storage(),run=record(),set=local.setItem;local.setItem=()=>{throw Error('quota');};const draft=new RunReviewDraft('worker-a',run,local);draft.stage({name:'Never lose this'});assert(draft.error);const remounted=new RunReviewDraft('worker-a',run,local);assert.equal(remounted.values.name,'Never lose this');assert(remounted.error,'memory-only recovery is still reported as not durable');local.setItem=set;remounted.stage({});assert.equal(remounted.error,false);assert.equal(JSON.parse(local.getItem(remounted.key)).values.name,'Never lose this');
});
test('failed discard retains current edits and a successful discard removes all cached state',()=>{
 const local=storage(),draft=new RunReviewDraft('worker-a',record(),local);draft.stage({name:'Edited'});const remove=local.removeItem;local.removeItem=()=>{throw Error('denied');};assert.equal(draft.discard(),false);assert.equal(draft.values.name,'Edited');assert(draft.error);local.removeItem=remove;assert(draft.discard());assert.equal(new RunReviewDraft('worker-a',record(),local).values.name,'Original');assert.equal(local.entries.size,0);
});
test('an explicitly supplied legacy source migrates once and survives later conversation changes',()=>{
 const local=storage(),run=record(),legacy=new RunReviewDraft('old-conversation',run,local);legacy.stage({name:'Reviewed edit'});const recovered=new RunReviewDraft('stable-worker',run,local,['old-conversation']);assert.equal(recovered.values.name,'Reviewed edit');assert.equal(local.getItem(legacy.key),null);assert(local.getItem(recovered.key));assert.equal(new RunReviewDraft('stable-worker',run,local,['different-conversation']).values.name,'Reviewed edit');assert.equal(new RunReviewDraft('different-worker',run,local).values.name,'Original');
});
test('legacy source with changed snapshots or ambiguous edits stays preserved and blocked',()=>{
 const local=storage(),run=record(),one=new RunReviewDraft('legacy-1',run,local),two=new RunReviewDraft('legacy-2',run,local);one.stage({name:'first'});two.stage({name:'second'});const ambiguous=new RunReviewDraft('stable',run,local,['legacy-1','legacy-2']);assert(ambiguous.conflict);assert(local.getItem(one.key));assert(local.getItem(two.key));const changed=new RunReviewDraft('stable',{...run,parameters:{temperature:999}},local,['legacy-1']);assert(changed.conflict);assert.equal(changed.saved.values.name,'first');assert(local.getItem(one.key));assert.equal(local.getItem(changed.key),null);
});
test('draft count budget preserves existing edits and explicit cleanup makes the current draft durable',()=>{
 const local=storage();for(let i=0;i<REVIEW_DRAFT_LIMITS.count;i++){const draft=new RunReviewDraft('worker', {...record(),id:'old-'+i},local);draft.stage({name:'kept-'+i});assert(!draft.error);}
 local.setItem('unrelated-settings','preserved');const next=new RunReviewDraft('worker',{...record(),id:'new'},local);next.stage({name:'current edit'});assert(next.error);assert.equal(local.entries.size,REVIEW_DRAFT_LIMITS.count+1);assert.equal(new RunReviewDraft('worker',{...record(),id:'new'},local).values.name,'current edit');assert(next.clearOtherDrafts());next.stage({});assert(!next.error);assert.equal(local.getItem('unrelated-settings'),'preserved');assert.equal(local.entries.size,2);
});
test('draft byte budget rejects durable growth without deleting prior edits',()=>{
 const local=storage(),first=new RunReviewDraft('worker',record(),local);first.stage({name:'kept'});const raw=local.getItem(first.key),next=new RunReviewDraft('worker',{...record(),id:'large'},local);next.stage({edits:{'large.txt':'x'.repeat(REVIEW_DRAFT_LIMITS.bytes)}});assert(next.error);assert.equal(local.getItem(first.key),raw);assert.equal(local.getItem(next.key),null);assert.equal(next.values.edits['large.txt'].length,REVIEW_DRAFT_LIMITS.bytes);
});
test('changed immutable input hashes conflict even when displayed paths and parameters are identical',()=>{
 const local=storage(),run=record(),first=new RunReviewDraft('worker',run,local);first.stage({name:'kept'});const changed=new RunReviewDraft('worker',{...run,inputs:{'run.in':'different-hash'}},local);assert(changed.conflict);assert.equal(changed.saved.values.name,'kept');assert.equal(changed.stage({name:'overwrite'}),false);
});
