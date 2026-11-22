import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {conversationReceiptKind,createConversationActivity} from '../../agent/sessions/conversation-activity.mjs';

function fixture(test){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-conversation-activity-'));
 const catalog=new Catalog(root),known=new Set(['codex:a','deepseek:b','codex:c','deepseek:a']);
 let changes=0,time=0,receipt=0,approval=null;
 const create=()=>createConversationActivity({
  catalog,exists:(provider,id)=>known.has(provider+':'+id),publish:()=>changes++,
  terminalApproval:()=>approval,now:()=>++time,uuid:()=>'receipt-'+(++receipt),
 });
 test.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true});});
 return {create,catalog,known,get changes(){return changes;},approve:value=>{approval=value;}};
}
function session(service,provider,threadId){
 return (method,params,id)=>service.event({provider,method,id,params:{threadId,...params}});
}
const started=id=>({turn:{id}});
const ended=(id,status='completed',rest={})=>({turn:{id,status,...rest}});
const replied=id=>ended(id,'completed',{items:[{id:'result-'+id,type:'agentMessage',text:'Recorded reply'}]});

test('activity keeps reported chat progress, waiting users, and terminal results with their own conversation',t=>{
 const f=fixture(t),service=f.create(),a=session(service,'codex','a'),b=session(service,'deepseek','b'),c=session(service,'codex','c');
 a('turn/started',started('turn-a'));
 a('turn/plan/updated',{turnId:'turn-a',explanation:'Plan sk-hidden-value',plan:[
  {step:'Inspect inputs',status:'completed'},{step:'Ask for project choice',status:'inProgress'},{step:'Invented phase',status:'guessed'},
 ]});
 a('item/tool/requestUserInput',{turnId:'turn-a',questions:[{question:'private question'}]},'choose-project');
 a('item/fileChange/requestApproval',{turnId:'earlier-turn'},'expired');
 b('turn/started',started('turn-b'));
 b('item/started',{turnId:'turn-b',item:{type:'mcpToolCall',id:'status',tool:'cluster_run_status',status:'inProgress'}});
 let rows=service.snapshot();
 assert.deepEqual(rows.find(row=>row.threadId==='a').pending.map(request=>request.requestId),['choose-project']);
 assert.deepEqual(rows.find(row=>row.threadId==='a').live.plan.steps,[
  {text:'Inspect inputs',status:'completed'},{text:'Ask for project choice',status:'inProgress'},
 ]);
 assert(!JSON.stringify(rows).includes('private question'));
 assert(!JSON.stringify(rows).includes('sk-hidden-value'));
 assert.deepEqual(rows.find(row=>row.threadId==='b').live.tool,{name:'cluster_run_status',state:'running'});
 b('item/completed',{turnId:'turn-b',item:{type:'mcpToolCall',id:'status',tool:'cluster_run_status',result:{status:'queued'}}});
 b('item/agentMessage/delta',{turnId:'turn-b',itemId:'reply-b',delta:'Still queued.'});
 b('turn/completed',ended('turn-b'));
 c('turn/started',started('turn-c'));
 c('turn/completed',ended('turn-c','failed',{operationState:'unconfirmed',error:{message:'transport lost'}}));
 c('studio/codexDisconnected',{});
 rows=service.snapshot();
 assert.deepEqual(rows.map(row=>row.threadId),['a','b']);
 assert.equal(rows.find(row=>row.threadId==='b').unread.itemId,'reply-b');
 assert.equal(rows.find(row=>row.threadId==='b').phase,'idle');
 assert.deepEqual(f.catalog.list(conversationReceiptKind).map(row=>row.threadId),['b']);
 a('serverRequest/resolved',{requestId:'choose-project'});
 assert.equal(service.snapshot().find(row=>row.threadId==='a').pending.length,0);
 a('turn/completed',ended('earlier-turn'));
 assert.equal(service.snapshot().find(row=>row.threadId==='a').live.id,'turn-a');
});

test('exact read receipts survive restart and a late acknowledgement cannot consume new output',t=>{
 const f=fixture(t),service=f.create(),emit=session(service,'codex','a');
 emit('turn/started',started('one'));emit('turn/completed',replied('one'));
 const first=service.snapshot()[0].unread;
 const priorWindow=f.create();
 assert.equal(priorWindow.snapshot()[0].unread.receiptId,first.receiptId);
 emit('turn/started',started('two'));emit('turn/completed',replied('two'));
 assert.deepEqual(service.markRead({provider:'codex',threadId:'a',receiptId:first.receiptId}),{acknowledged:false});
 const second=service.snapshot()[0].unread;
 assert.notEqual(second.receiptId,first.receiptId);
 assert.deepEqual(priorWindow.markRead({provider:'codex',threadId:'a',receiptId:first.receiptId}),{acknowledged:false});
 assert.deepEqual(service.markRead({provider:'deepseek',threadId:'a',receiptId:second.receiptId}),{acknowledged:false});
 assert.deepEqual(service.markRead({provider:'codex',threadId:'a',receiptId:second.receiptId}),{acknowledged:true});
 assert.deepEqual(service.markRead({provider:'codex',threadId:'a',receiptId:second.receiptId}),{acknowledged:true});
 emit('turn/started',started('two'));emit('turn/completed',ended('two'));
 assert.deepEqual(f.create().snapshot(),[]);
 emit('turn/started',started('empty'));emit('turn/completed',ended('empty'));
 assert.deepEqual(service.snapshot(),[]);
 assert.throws(()=>service.markRead({provider:'codex',threadId:'a',receiptId:second.receiptId,extra:true}),/Invalid conversation read/);
 f.known.delete('codex:a');service.forget('codex','a');
 assert.deepEqual(f.catalog.list(conversationReceiptKind),[]);
});

test('live approvals disappear on resolve, expiry or disconnect and are never loaded as read receipts',t=>{
 const f=fixture(t),service=f.create(),emit=session(service,'codex','a');
 emit('turn/started',started('turn-a'));
 emit('item/permissions/requestApproval',{turnId:'turn-a',permissions:{}},3);
 assert.deepEqual(service.snapshot()[0].pending.map(row=>row.kind),['approval']);
 assert.deepEqual(f.create().snapshot(),[]);
 f.approve({provider:'codex',threadId:'a',approvalId:'terminal-check',at:1,expiresAt:120000,commands:['private command']});
 const state=service.snapshot()[0];
 assert.deepEqual(state.pending.map(row=>row.kind),['approval','terminalApproval']);
 assert(!JSON.stringify(state).includes('private command'));
 f.approve({provider:'codex',threadId:'a',approvalId:'terminal-check',expiresAt:0});
 emit('studio/codexDisconnected',{});
 assert.deepEqual(service.snapshot(),[]);
});
