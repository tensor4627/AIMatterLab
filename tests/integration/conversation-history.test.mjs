import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {TaskRecords} from '../../agent/sessions/task-records.mjs';
import {ConversationAgentHub} from '../../agent/providers/conversation-agent-hub.mjs';
import {createConversationHistory} from '../../agent/sessions/conversation-history.mjs';
import {assertRpc} from '../../contracts/transport-policy.mjs';
import {constrainedRequest} from '../../desktop/platform/codex-isolation.mjs';
import {replayMessages} from '../../frontend/features/conversations/message-mapping.mjs';
import {attachmentHeader} from '../../contracts/agent/chat-attachments.mjs';

function fixture(t,nativeRequest){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aimatterlab-history-'));
 const catalog=new Catalog(root),events=[],records=new TaskRecords(catalog,event=>events.push(event));
 const denied=()=>{throw Error('Unexpected provider or compute side effect');};
 const authCodex=new EventEmitter();authCodex.close=()=>{};
 const agents=new ConversationAgentHub({catalog,root,authCodex,initialProvider:'deepseek',createCodex:denied,vault:{get:denied},settings:()=>({}),worker:denied,fetchApi:denied});
 const history=createConversationHistory({catalog,records,agents,nativeRequest:nativeRequest||denied});
 t.after(()=>{agents.close();catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});
 return {catalog,records,agents,history,events};
}
const turns=(length,term=4)=>Array.from({length},(_,index)=>({
 id:'turn-'+(index+1),status:'completed',
 items:[
  {id:'old-user',type:'userMessage',content:[{type:'text',text:index===term?'用 350 K 温区比较复现实验':'Input '+(index+1)},{type:'text',text:'[AIMatterLab workspace context]\nprivate-project-secret'}]},
  {id:'old-answer',type:'agentMessage',text:index===term?'温度 350 K 已记录。':'Reply '+(index+1)},
  {id:'old-tool',type:'mcpToolCall',tool:'submit_cluster_run',status:'completed',result:{content:[{type:'text',text:JSON.stringify({job_id:index===term?'job-77099':'other-'+(index+1),diagnostic:'tool-output-hidden-'+('z'.repeat(1500))})}]}},
 ],
}));

test('local DSH first page, stable before cursor, precise Chinese and job searches, deletion and reversible archive',async t=>{
 const {catalog,records,history,agents}=fixture(t),chat=records.remember({provider:'deepseek',threadId:'saved-dsh',projectId:'research',name:'温度扫描'});
 const other=records.remember({provider:'deepseek',threadId:'other-project',projectId:'separate',name:'另一项目'});
 const transcripts=turns(2000),save=(id,turns)=>catalog.put('deepseek-dsh-history',id,{id,provider:'deepseek',schemaVersion:1,harness:'dsh',turns});
 save(chat.threadId,transcripts);save(other.threadId,turns(4,0));
 const fullRead=agents.readLocalConversationHistory.bind(agents);
 agents.readLocalConversationHistory=()=>{throw Error('The initial and older DSH pages must not hydrate the whole transcript into main');};
 const started=performance.now(),first=await history.page({conversationId:chat.id}),elapsed=performance.now()-started;
 const bytes=Buffer.byteLength(JSON.stringify(first));
 t.diagnostic(JSON.stringify({fixture:'2000 turns, SQLite saved DSH',receivedTurns:first.turns.length,bytes,elapsedMs:Math.round(elapsed)}));
 assert.equal(first.turns.length,30);assert.equal(first.turns[0].id,'turn-1971');assert.equal(first.turns.at(-1).id,'turn-2000');
 assert(bytes<45000);assert.doesNotMatch(JSON.stringify(first),/tool-output-hidden|private-project-secret/);
 assert.equal(first.turns[0].items.at(-1).studioDetail,true);
 save(chat.threadId,[...transcripts,{id:'live-2001',status:'inProgress',items:[]}]);
 const older=await history.page({conversationId:chat.id,before:first.before});
 assert.equal(older.turns[0].id,'turn-1941');assert.equal(older.turns.at(-1).id,'turn-1970');
 agents.readLocalConversationHistory=fullRead;
 await assert.rejects(history.page({conversationId:other.id,before:first.before}),/Invalid history cursor/);
 const body=await history.search({projectId:'research',query:'350 K'});
 assert.equal(body.unavailable,0);assert.equal(body.matches.length,2);assert(body.matches.every(match=>match.conversationId===chat.id&&match.turnId==='turn-5'&&match.snippet.includes('350 K')));
 const job=await history.search({conversationId:chat.id,query:'job-77099'});
 assert.deepEqual(job.matches.map(({turnId,snippet})=>[turnId,snippet]),[['turn-5','job-77099']]);
 const {name,snippet,archived,...anchor}=job.matches[0];
 const found=await history.locate(anchor),item=await history.detail(anchor);
 assert(found.turns.find(turn=>turn.id===anchor.turnId).items.some(item=>item.id===anchor.itemId));
 assert.equal(item.studioDetail,undefined);assert.match(item.result.content[0].text,/job-77099/);
 assert.deepEqual(await history.search({projectId:'research',query:'private-project-secret'}),{matches:[],unavailable:0});
 assert.deepEqual(await history.search({projectId:'research',query:'tool-output-hidden'}),{matches:[],unavailable:0});
 const [bookmark]=await history.setBookmark({...anchor,bookmarked:true});
 assert.equal(bookmark.snippet,'job-77099');assert.deepEqual(await history.setBookmark({...anchor,bookmarked:false}),[]);
 assert.equal(history.archive({id:chat.id,archived:true}).archived,true);
 assert.equal((await history.search({projectId:'research',query:'job-77099'})).matches[0].archived,true);
 assert.equal(history.archive({id:chat.id,archived:false}).archived,false);
 records.remove(chat.id);history.forget(chat.id);
 assert.deepEqual(await history.search({projectId:'research',query:'350 K'}),{matches:[],unavailable:0});
 await assert.rejects(history.locate(anchor),/Unknown conversation/);
});

test('native Codex uses the real cursor sequence and bounded exact fork while source keeps later turns',async t=>{
 const source=turns(2000),calls=[],known=new Map([['source',source]]);
 const {records,history,catalog}=fixture(t,async(method,params)=>{
  calls.push({method,params});
  const items=known.get(params.threadId);assert(items,'native request host is scoped to a known thread');
  if(method==='thread/turns/list'){
   const end=params.cursor?items.findIndex(turn=>turn.id===params.cursor):items.length;
   const start=Math.max(0,end-params.limit);
   return {data:items.slice(start,end).reverse(),nextCursor:start?items[start].id:null};
  }
  if(method==='thread/fork'){
   const count=items.findIndex(turn=>turn.id===params.lastTurnId)+1;
   known.set('new-branch',items.slice(0,count));return {thread:{id:'new-branch',forkedFromId:'source'}};
  }
  throw Error('Unexpected native request '+method);
 });
 const chat=records.remember({provider:'codex',threadId:'source',projectId:'research',name:'原实验',taskId:'original-task'});
 const first=await history.page({conversationId:chat.id});
 assert.equal(first.turns.length,30);assert.equal(calls.length,1);assert.deepEqual(calls[0].params,{threadId:'source',limit:30,sortDirection:'desc',itemsView:'summary'});
 source.push({id:'turn-2001',status:'inProgress',items:[]});
 const older=await history.page({conversationId:chat.id,before:first.before});
 assert.equal(older.turns.at(-1).id,'turn-1970');
 const output=await history.branch({conversationId:chat.id,turnId:'turn-4',itemId:'old-answer'});
 assert.deepEqual(calls.find(call=>call.method==='thread/fork')?.params,{threadId:'source',lastTurnId:'turn-4',excludeTurns:true});
 assert.deepEqual(known.get('new-branch').map(turn=>turn.id),['turn-1','turn-2','turn-3','turn-4']);assert.equal(source[4].id,'turn-5');
 assert.deepEqual(output.conversation.source,{conversationId:chat.id,turnId:'turn-4',itemId:'old-answer',name:chat.name,kind:'fork'});
 assert.equal(output.conversation.projectId,null);assert.equal(output.conversation.taskId,null);assert.equal(records.conversation('codex','source').taskId,'original-task');
 assert.equal(catalog.list('agent-service-notification').length,0);
 assert(calls.every(call=>['thread/turns/list','thread/fork'].includes(call.method)));
});

test('Codex queue reconciliation reads one native item per frame and needs an exact client ID and a terminal turn',async t=>{
 const calls=[],clientId='queued-attachment-id',threadId='photo-thread';
 const items=[
  {turnId:'unrelated',item:{id:'other-user',type:'userMessage',clientId:'different-id',content:[{type:'text',text:'Same caption'}]}},
  {turnId:'with-image',item:{id:'native-user',type:'userMessage',clientId,content:[{type:'text',text:'Same caption'},{type:'image',url:'data:image/png;base64,aW1hZ2U='}]}},
 ];
 let status='inProgress';
 const {records,history}=fixture(t,async(method,params)=>{
  calls.push({method,params});
  assert.equal(params.threadId,threadId);
  if(method==='thread/items/list'){
   assert.equal(params.limit,1);
   assert.equal(params.sortDirection,'desc');
   return {data:[params.cursor?items[1]:items[0]],nextCursor:params.cursor?null:'second-item'};
  }
  assert.equal(method,'thread/turns/list');
  assert.equal(params.itemsView,'notLoaded');
  return {data:[{id:'with-image',status,items:[]}],nextCursor:null};
 });
 records.remember({provider:'codex',threadId,name:'Synthetic illustration'});
 await assert.rejects(history.confirmDelivery({threadId:'unknown'},clientId),/Unknown conversation/);
 assert.equal(calls.length,0);
 assert.equal(await history.confirmDelivery({threadId},clientId),null);
 status='completed';
 assert.equal(await history.confirmDelivery({threadId},'no-matching-id'),null);
 assert.equal(await history.confirmDelivery({threadId},clientId),'with-image');
 assert.deepEqual(calls.map(call=>call.method),[
  'thread/items/list','thread/items/list','thread/turns/list',
  'thread/items/list','thread/items/list',
  'thread/items/list','thread/items/list','thread/turns/list',
 ]);
});

test('oversized Codex history pages resume using the same anchor without skipping older turns',async t=>{
 const source=turns(10),calls=[];
 const {records,history}=fixture(t,async(method,params)=>{
  calls.push({method,params});
  assert.equal(params.threadId,'image-heavy-thread');
  assert.equal(method,'thread/turns/list');
  if(params.limit>3)throw Object.assign(Error('Fixture large image frame'),{code:'STUDIO_CODEX_OVERSIZED_FRAME'});
  const end=params.cursor?source.findIndex(turn=>turn.id===params.cursor):source.length,start=Math.max(0,end-params.limit);
  return {data:source.slice(start,end).reverse(),nextCursor:start?source[start].id:null};
 });
 const chat=records.remember({provider:'codex',threadId:'image-heavy-thread',name:'Several figures'});
 const newest=await history.page({conversationId:chat.id});
 assert.deepEqual(newest.turns.map(turn=>turn.id),['turn-8','turn-9','turn-10']);
 const older=await history.page({conversationId:chat.id,before:newest.before});
 assert.deepEqual(older.turns.map(turn=>turn.id),['turn-5','turn-6','turn-7']);
 assert(calls.slice(0,4).every(call=>call.params.cursor===undefined));
 assert(calls.slice(4).every(call=>call.params.cursor==='turn-8'));
});

test('legacy Codex declines unsupported pages and requires confirmation for an edited excerpt before starting a fresh local discussion',async t=>{
 const legacy=turns(6);legacy[3].items[0].content.push({type:'text',text:attachmentHeader+'\n[]\nFile body sentinel'});
 const seen=[];
 const {records,history,agents}=fixture(t,async(method,params)=>{
  seen.push(method);
  if(method==='thread/turns/list')throw Object.assign(Error('Pagination unavailable'),{rpcResponse:true,rpcCode:-32601});
  assert.equal(method,'thread/read');return {thread:{id:params.threadId,turns:legacy}};
 });
 agents.startPlainDiscussion=async provider=>{assert.equal(provider,'codex');seen.push('detached-thread/start');return {id:'fresh-id'};};
 const chat=records.remember({provider:'codex',threadId:'old-id',name:'旧对话'}),anchor={conversationId:chat.id,turnId:'turn-4',itemId:'old-user'};
 const page=await history.page({conversationId:chat.id});
 assert.equal(page.turns.length,6);
 assert.equal(replayMessages(page.turns).filter(item=>item.id==='old-user').length,6,'same legacy item IDs across turns preserve row identity');
 const {preview}=await history.branch(anchor);
 assert.equal(preview.excerpt,'Input 4');assert(!seen.includes('detached-thread/start'));
 legacy[3].items[0].content[0].text='Updated visible excerpt';
 const {preview:updated}=await history.branch({...anchor,revision:preview.revision});
 assert.equal(updated.excerpt,'Updated visible excerpt');assert(!seen.includes('detached-thread/start'));
 const result=await history.branch({...anchor,revision:updated.revision});
 assert.match(result.draft,/Updated visible excerpt/);assert.doesNotMatch(result.draft,/File body sentinel|Input 5|private-project-secret/);
 assert.equal(result.conversation.source.kind,'excerpt');assert.equal(seen.filter(method=>method==='detached-thread/start').length,1);
});

test('bounded native fork is available only to the worker-free main transport',()=>{
 const params={threadId:'source',lastTurnId:'turn-4',excludeTurns:true},isolation={historyOnly:true,cwd:'owned',config:{},worker:null};
 for(const method of ['thread/fork','thread/turns/list','thread/items/list'])assert.throws(()=>assertRpc(method),/Unsupported/);
 assert.equal(constrainedRequest('thread/fork',params,isolation).sandbox,'read-only');
 assert.throws(()=>constrainedRequest('thread/fork',{...params,path:'unowned'},isolation),/Unknown/);
 assert.throws(()=>constrainedRequest('thread/fork',{...params,lastTurnId:null},isolation),/specific stored turn/);
 assert.throws(()=>constrainedRequest('thread/fork',params,{...isolation,worker:{}}),/worker-free/);
 assert.throws(()=>constrainedRequest('turn/start',{threadId:'branch'},isolation),/only available/);
});
