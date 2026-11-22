import assert from 'node:assert/strict';
import path from 'node:path';
import {createConversationActivity} from '../agent/sessions/conversation-activity.mjs';

export async function frontendConversationActivityCases({check,out}){
 await check('chat-experience-activity-jumps-to-the-origin-and-keeps-scheduler-state-separate',async page=>{
  const conversations=[
   {provider:'codex',threadId:'attention-a',name:'A · User choice'},
   {provider:'deepseek',threadId:'attention-b',name:'B · Queued project'},
   {provider:'codex',threadId:'attention-c',name:'C · Unknown project'},
  ].map(row=>({...row,id:row.provider+':'+row.threadId,projectId:null,taskId:null,updatedAt:1}));
  const [a,b,c]=conversations,records=new Map(),acknowledged=[],responses=[];
  const catalogue={list:()=>[],transaction:work=>work(),get:(_kind,id)=>records.get(id),
   put:(_kind,id,row)=>{records.set(id,structuredClone(row));return row;}};
  const service=createConversationActivity({catalog:catalogue,exists:(provider,threadId)=>conversations.some(row=>row.provider===provider&&row.threadId===threadId)});
  const request={provider:a.provider,id:'which-resource',method:'item/tool/requestUserInput',params:{threadId:a.threadId,turnId:'ask-turn',questions:[
   {id:'choice',question:'Select the saved fixture resource',options:[{label:'Use alpha'},{label:'Use beta'}]},
  ]}};
  const synth=(row,method,params={})=>({provider:row.provider,method,params:{threadId:row.threadId,...params}});
  const plan=synth(a,'turn/plan/updated',{turnId:'ask-turn',plan:[
   {step:'Read saved inputs',status:'completed'},{step:'Confirm the target',status:'inProgress'},
  ]});
  const compact={id:'compact-b',type:'contextCompaction'};
  const result={id:'reply-b',type:'agentMessage',text:'The scheduler is still queued.'};
  const bHistory={id:'result-turn',status:'completed',items:[compact,result]};
  for(const event of [
   synth(a,'turn/started',{turn:{id:'ask-turn'}}),plan,request,
   synth(b,'turn/started',{turn:{id:'result-turn'}}),synth(b,'turn/completed',{turn:bHistory}),
   synth(c,'turn/started',{turn:{id:'unknown-turn'}}),
   synth(c,'turn/completed',{turn:{id:'unknown-turn',status:'failed',operationState:'unconfirmed'}}),
   synth(c,'studio/codexDisconnected'),
  ])service.event(event);
  await page.exposeFunction('conversationActivityFixture',(method,data)=>{
   if(method==='conversation.activity.list')return service.snapshot();
   if(method==='conversation.activity.markRead'){acknowledged.push(data);return service.markRead(data);}
   if(method==='agent.respond'){responses.push(data);service.resolved(data.provider,data.threadId,data.id);return {};}
   throw Error('Unexpected activity fixture method '+method);
  });
  await page.evaluate(async({conversations,bHistory,request})=>{
   const [a,b,c]=conversations,original=window.studio.invoke;
   const test=window.__test;
   window.studio.conversationHistory=true;
   test.activeRequests={[a.threadId]:[request]};
   test.emitActivity=event=>{
    for(const f of test.events){if(event)f(event);f({method:'studio/conversationActivityChanged'});}
   };
   window.studio.invoke=async(method,data)=>{
    if(method.startsWith('conversation.activity.')||method==='agent.respond'){
     test.calls.push({method,data});
     const value=await window.conversationActivityFixture(method,data);
     if(method==='agent.respond'){
      test.activeRequests[data.threadId]=(test.activeRequests[data.threadId]||[]).filter(row=>row.id!==data.id);
      test.emitActivity({provider:data.provider,method:'serverRequest/resolved',params:{threadId:data.threadId,requestId:data.id}});
     }
     if(method==='conversation.activity.markRead')test.emitActivity();
     return value;
    }
    if(method==='conversation.list')return conversations;
    if(method==='conversation.select')return conversations.find(row=>row.id===data.id);
    if(method==='conversation.remember')return conversations.find(row=>row.threadId===data.threadId);
    if(['conversation.history.page','conversation.history.locate'].includes(method)){
     const conversation=conversations.find(row=>row.id===data.conversationId),id=conversation.threadId;
     test.calls.push({method,data});
     return {conversation,turns:id===b.threadId?[bHistory]:[],before:null,atLatest:true,bookmarks:[],
      studioSession:{threadId:id,busy:id===a.threadId,turnId:id===a.threadId?'ask-turn':null,requests:test.activeRequests[id]||[]}};
    }
    if(method==='compute.managed.snapshot')return {resources:[],sources:[],conversations:[
     {provider:b.provider,threadId:b.threadId,badges:[{label:'B scheduler',profileId:'profile-b',color:1,status:'queued'}]},
     {provider:c.provider,threadId:c.threadId,badges:[{label:'C scheduler',profileId:'profile-c',color:2,status:'unknown'}]},
    ]};
    if(method==='agent.rpc'&&['thread/read','thread/resume'].includes(data.method)){
     const id=data.params.threadId;
     return {thread:{id,turns:id===b.threadId?[bHistory]:[]},model:'fixture-model',
      studioSession:{threadId:id,busy:id===a.threadId,turnId:id===a.threadId?'ask-turn':null,requests:test.activeRequests[id]||[]}};
    }
    return original(method,data);
   };
   localStorage.setItem('studio.conversation',c.id);
   await window.renderTest('App');
  },{conversations,bHistory,request});
  const aRow=page.locator('.conversation-row').filter({hasText:a.name});
  const bRow=page.locator('.conversation-row').filter({hasText:b.name});
  const cRow=page.locator('.conversation-row').filter({hasText:c.name});
  await aRow.getByTestId('conversation-waiting-question').waitFor();
  await bRow.getByTestId('conversation-unread-result').waitFor();
  await bRow.locator('[data-status="queued"]').waitFor();
  await cRow.locator('[data-status="unknown"]').waitFor();
  assert.equal(await cRow.getByTestId('conversation-unread-result').count(),0);
  assert.deepEqual(acknowledged,[]);
  await page.getByTestId('next-conversation-attention').click();
  const question=page.locator('[data-request-id="which-resource"]');
  await question.waitFor();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-request-id')==='which-resource');
  const progress=page.getByTestId('agent-turn-activity');
  await progress.waitFor();
  await progress.locator('summary').click();
  await progress.getByText('Confirm the target',{exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'conversation-activity-question.png')});
  await question.getByRole('radio',{name:'Use alpha'}).click();
  await aRow.getByTestId('conversation-waiting-question').waitFor({state:'detached'});
  assert.deepEqual(responses.map(({threadId,id})=>({threadId,id})),[{threadId:a.threadId,id:'which-resource'}]);
  const approval={...synth(a,'item/permissions/requestApproval',{turnId:'ask-turn',reason:'Inspect the pending fixture permission'}),id:'fixture-approval'};
  service.event(approval);
  await page.evaluate(event=>window.__test.emitActivity(event),approval);
  const badge=aRow.getByTestId('conversation-waiting-approval');
  await badge.click();
  const approvalPanel=page.locator('[data-request-id="fixture-approval"]');
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-request-id')==='fixture-approval');
  assert.equal(responses.length,1,'Focusing the approval sends no decision');
  await approvalPanel.getByRole('button',{name:'拒绝权限请求',exact:true}).click();
  await badge.waitFor({state:'detached'});
  await page.getByTestId('next-conversation-attention').click();
  await page.getByText(result.text,{exact:true}).waitFor();
  await page.getByText('已压缩对话上下文',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-item-id')==='reply-b');
  await bRow.getByTestId('conversation-unread-result').waitFor({state:'detached'});
  assert.equal(acknowledged.length,1);
  assert.equal(acknowledged[0].threadId,b.threadId);
  await bRow.locator('[data-status="queued"]').waitFor();
  await cRow.locator('[data-status="unknown"]').waitFor();
  await page.screenshot({path:path.join(out,'conversation-activity-unread-result.png')});
 });
}
