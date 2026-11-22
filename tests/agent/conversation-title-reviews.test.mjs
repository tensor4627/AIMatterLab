import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {TaskRecords} from '../../agent/sessions/task-records.mjs';
import {ConversationTitleReviews,conversationTitleTool} from '../../agent/sessions/conversation-title-reviews.mjs';
import {titleReviewHeader} from '../../contracts/agent/conversation-title.mjs';
import {dshToolAllowed} from '../../agent/providers/dsh-policy.mjs';
import {replayMessages,upsertItemMessage} from '../../frontend/features/conversations/message-mapping.mjs';

function fixture(t,provider='deepseek'){
 const root=mkdtempSync(path.join(tmpdir(),'aimatterlab-title-')),catalog=new Catalog(root),events=[];
 t.after(()=>{catalog.db.close();rmSync(root,{recursive:true,force:true});});
 const records=new TaskRecords(catalog,event=>events.push(event));
 const reviews=new ConversationTitleReviews(records);
 const threadId='subject',row=records.remember({provider,threadId,intent:'你好'});
 return {catalog,records,reviews,events,row,provider,threadId};
}

async function start(f,turnId,{threadId=f.threadId,currentName=true}={}){
 const provider=f.provider,scope={provider,threadId,checkCurrent:()=>true};
 const emit=(method,turn)=>f.reviews.event({method,provider,params:{threadId,turn}});
 let input;
 await f.reviews.dispatch(provider,{threadId,input:[{type:'text',text:'讨论 '+turnId}]},async params=>{
  input=params.input;
  emit('turn/started',{id:turnId});
  return {turn:{id:turnId,status:'inProgress'}};
 },{includeCurrentName:currentName});
 const prompt=input.find(part=>part.text.startsWith(titleReviewHeader))?.text;
 const id=prompt&&/review_id ([\da-f-]{36})/.exec(prompt)?.[1];
 if(prompt)assert.ok(id);
 return {input,prompt,propose:(title,otherScope=scope)=>f.reviews.propose({review_id:id,title},otherScope),
  end:(status='completed')=>emit('turn/completed',{id:turnId,status})};
}

const humanTurn=(id,status='completed')=>({id,status,items:[{id:'u-'+id,type:'userMessage',content:[{type:'text',text:'Human discussion '+id}]},{id:'a-'+id,type:'agentMessage',text:'Answer '+id}]});

test('reviews the original chat at turns 4 and 12, retains the interval after restart and keeps sidebar metadata',async t=>{
 const f=fixture(t),g=f.records.createGroup({name:'铜'}),organized=f.records.organize({id:f.row.id,groupId:g.id,pinned:true});
 const requests=[];
 for(let n=1;n<=20;n++){
  if(n===7)f.reviews=new ConversationTitleReviews(new TaskRecords(f.catalog,e=>f.events.push(e)));
  const turn=await start(f,'turn-'+n);
  if(turn.prompt){
   requests.push(n);
   const before=f.records.conversation(f.provider,f.threadId).name;
   assert.ok(turn.prompt.includes(JSON.stringify(before)));
   const title=n===4?'铜的热膨胀':'空位扩散系数';
   assert.equal(turn.propose(title).status,'received');
   assert.equal(f.records.conversation(f.provider,f.threadId).name,before);
  }
  turn.end();turn.end();
  const row=f.records.conversation(f.provider,f.threadId);
  assert.equal(row.name,n<4?organized.name:n<12?'铜的热膨胀':'空位扩散系数');
  assert.equal(row.pinned,true);assert.equal(row.groupId,g.id);assert.equal(row.updatedAt,organized.updatedAt);
 }
 assert.deepEqual(requests,[4,12,20]);
 assert.equal(f.events.filter(e=>e.params?.titleOnly).length,2);
 assert.ok(dshToolAllowed(conversationTitleTool.name,false)&&dshToolAllowed(conversationTitleTool.name,true));
});

test('continued historical chats use completed human exchanges and skip tool traffic, notifications and failed turns',async t=>{
 const f=fixture(t,'codex');
 const history=[humanTurn('a'),humanTurn('b'),humanTurn('c'),humanTurn('cancel','interrupted'),humanTurn('fail','failed'),
  {id:'s',status:'completed',items:[{type:'serviceMessage',text:'Scheduled job finished'}]},
  {id:'tool',status:'completed',items:[{type:'mcpToolCall',tool:'run_status'}]}];
 f.reviews.restore(f.provider,{id:f.threadId,turns:history});
 f.reviews.restore(f.provider,{id:f.threadId,turns:history});
 const active=await start(f,'fourth',{currentName:false});
 assert.ok(active.prompt);assert.ok(!active.prompt.includes(f.row.name));
 const wrongChat={provider:'kimi',threadId:f.threadId,checkCurrent:()=>true};
 assert.equal(active.propose('Other chat',wrongChat).status,'skipped');
 assert.equal(active.propose('Revoked',{...wrongChat,provider:f.provider,checkCurrent:()=>false}).status,'skipped');
 assert.throws(()=>active.propose('a\nb'));assert.throws(()=>active.propose('sk-fixture-credential'));
 assert.throws(()=>active.propose('a'.repeat(61)));
 active.propose('First attempt');active.end('interrupted');
 assert.equal(f.records.conversation(f.provider,f.threadId).name,f.row.name);
 const retry=await start(f,'retry');
 assert.ok(retry.prompt);assert.equal(active.propose('Stale name').status,'skipped');
 retry.propose('长会话的新主题');retry.end();
 assert.equal(f.records.conversation(f.provider,f.threadId).name,'长会话的新主题');
 assert.equal((await start(f,'fifth')).prompt,undefined);
});

test('manual renames, deletion and replacement of a model context win over late proposals',async t=>{
 const f=fixture(t),history={id:f.threadId,turns:[humanTurn('a'),humanTurn('b'),humanTurn('c')]};
 f.reviews.restore(f.provider,history);
 const active=await start(f,'manual');
 active.propose('Model title');f.records.rename({id:f.row.id,name:'我的固定标题'});
 assert.equal(active.propose('Late title').status,'skipped');active.end();
 assert.equal(f.records.conversation(f.provider,f.threadId).name,'我的固定标题');
 f.reviews=new ConversationTitleReviews(f.records);
 assert.equal((await start(f,'after-restart')).prompt,undefined);
 for(const disposition of ['deleted','retired']){
  const threadId=disposition,row=f.records.remember({provider:f.provider,threadId,intent:'Hello'});
  f.reviews.restore(f.provider,{...history,id:threadId});
  const old=await start(f,threadId,{threadId});old.propose('Discarded');
  if(disposition==='deleted')f.records.remove(row.id);
  else f.catalog.put('retired-conversation-context',row.id,{replacementThreadId:'new-identity'});
  assert.equal(old.propose('Late').status,'skipped');old.end();
  assert.ok(!f.records.conversations().some(c=>c.id===row.id));
  if(disposition==='deleted')assert.equal(f.catalog.get('conversation-title-progress',row.id),null);
 }
});

test('workflow proposals continue to rename their workflow while the reviewed conversation title stays in place',async t=>{
 const f=fixture(t),task=f.records.create({provider:f.provider,threadId:f.threadId,planningMode:true,workflowVersion:2,request:'构建铜结构'});
 f.records.prepareTurnState(f.provider,{threadId:f.threadId,planningMode:true,studioTaskId:task.id});
 f.reviews.restore(f.provider,{id:f.threadId,turns:[humanTurn('a'),humanTurn('b'),humanTurn('c')]});
 const turn=await start(f,'review');turn.propose('铜晶体的空位扩散');turn.end();
 f.records.presentDraft(f.provider,f.threadId,{task_id:task.id,name:'建立超胞',steps:[],parameters:{temperature:300},missing_fields:[]});
 assert.equal(f.records.read(task.id).name,'建立超胞');
 assert.equal(f.records.conversation(f.provider,f.threadId).name,'铜晶体的空位扩散');
});

test('title instructions and tool receipts stay out of live and restored chat messages',async t=>{
 const f=fixture(t,'kimi'),items=['a','b','c'].flatMap(id=>humanTurn(id).items);
 items.push(humanTurn('no known reply').items[0]);
 f.reviews.restore(f.provider,{id:f.threadId,turns:[{id:'history',items}]});
 assert.equal(f.catalog.get('conversation-title-progress',f.row.id).completed,3);
 const turn=await start(f,'fourth');
 assert.ok(turn.prompt);
 const meta={id:'tool-title',type:'mcpToolCall',tool:conversationTitleTool.name,arguments:{title:'四轮总结'}};
 const messages=replayMessages([{items:[{id:'u',type:'userMessage',content:turn.input},meta,{id:'reply',type:'agentMessage',text:'正常答复'}]}]);
 assert.deepEqual(messages.map(m=>m.text),['讨论 fourth','正常答复']);
 const flattened=turn.input.map(part=>part.text).join('\n');
 assert.equal(replayMessages([{items:[{id:'flat',type:'userMessage',content:[{type:'text',text:flattened}]}]}])[0].text,'讨论 fourth');
 assert.equal(upsertItemMessage(messages,meta),messages);
});

test('a missed proposal keeps the title and the next interval, with independent reviews for simultaneous chats',async t=>{
 const f=fixture(t),other='parallel',oldTurns=Array.from({length:15},(_,i)=>humanTurn(String(i)));
 f.records.remember({provider:f.provider,threadId:other,intent:'Hello'});
 for(const id of [f.threadId,other])f.reviews.restore(f.provider,{id,turns:oldTurns});
 const a=await start(f,'a'),b=await start(f,'b',{threadId:other});
 assert.ok(a.prompt&&b.prompt);assert.notEqual(a.prompt,b.prompt);
 assert.equal(a.propose('Wrong owner',{provider:f.provider,threadId:other,checkCurrent:()=>true}).status,'skipped');
 b.propose('第二个会话');b.end();a.end();
 assert.equal(f.records.conversation(f.provider,f.threadId).name,f.row.name);
 assert.equal(f.records.conversation(f.provider,other).name,'第二个会话');
 for(let n=17;n<=24;n++){
  const next=await start(f,'conversation-'+n);
  assert.equal(!!next.prompt,n===24);next.end();
 }
});
