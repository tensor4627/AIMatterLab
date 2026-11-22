import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function frontendConversationHistoryCases({check,out}){
 await check('conversation-history-experience-pagination-search-branch-archive',async page=>{
  await page.evaluate(()=>{
   window.studio.conversationHistory=true;
   const f=window.__test,prior=window.studio.invoke,chat=(id,name)=>({id:'deepseek:'+id,provider:'deepseek',threadId:id,projectId:null,taskId:null,name,updatedAt:1});
   const a=chat('long-history','温度扫描'),b=chat('other-history','并行对话');
   const tools={id:'job-details',type:'mcpToolCall',tool:'submit_cluster_run',status:'completed'};
   const turns=Array.from({length:2000},(_,index)=>({id:'turn-'+(index+1),status:'completed',items:[
    {id:'old-repeated-answer',type:'agentMessage',text:index===3?'用 350 K 温区重复这个实验。':('第 '+(index+1)+' 轮结果。\n').repeat(7)},
    ...index===3?[{...tools,studioDetail:true}]:[],
   ]}));
   const rows=[a,b],transcripts=new Map([[a.id,turns],[b.id,[]]]),bookmarks=new Map();
   f.historyCalls=[];f.pageReceipts=[];f.historyFixture={a,b,rows};
   const emit=(method,params)=>f.events.forEach(listener=>listener({method,provider:'deepseek',params}));
   const older=(owner,end=transcripts.get(owner.id).length)=>{
    const first=Math.max(0,end-30),before=first?String(first):null,value={conversation:{...owner},turns:transcripts.get(owner.id).slice(first,end),before,atLatest:end===transcripts.get(owner.id).length,bookmarks:bookmarks.get(owner.id)||[]};
    f.pageReceipts.push({turns:value.turns.length,bytes:new TextEncoder().encode(JSON.stringify(value)).length,atLatest:value.atLatest});return value;
   };
   window.studio.invoke=async(method,data)=>{
    if(method==='conversation.list')return structuredClone(rows);
    if(method==='conversation.select')return data.new?{fresh:true}:structuredClone(rows.find(row=>row.id===data.id));
    if(method==='conversation.delete'){
     const index=rows.findIndex(row=>row.id===data.id),[owner]=rows.splice(index,1);
     transcripts.delete(data.id);bookmarks.delete(data.id);
     const result={id:owner.id,provider:owner.provider,threadId:owner.threadId,taskIds:[]};emit('studio/conversationDeleted',result);return result;
    }
    if(method==='conversation.activity.list')return [];
    if(!method.startsWith('conversation.history.'))return prior(method,data);
    f.historyCalls.push({method,data});
    const owner=rows.find(row=>row.id===(data.conversationId||data.id));
    const anchor={conversationId:a.id,turnId:'turn-4',itemId:'old-repeated-answer'};
    if(method==='conversation.history.search'){
     const allowed=rows.some(row=>row.id===a.id)&&(data.conversationId===a.id||data.projectId===a.projectId);
     const matching=allowed&&(['350 K','job-77099'].includes(data.query)||data.query==='温区');
     return {matches:matching?[{...anchor,itemId:data.query==='job-77099'?tools.id:anchor.itemId,name:a.name,snippet:data.query==='job-77099'?'作业 job-77099':'用 350 K 温区重复这个实验。',archived:a.archived}]:[],unavailable:0};
    }
    if(!owner)throw Error('Fixture conversation was deleted');
    if(method==='conversation.history.page'){
     if(owner.id===a.id&&data.before!==undefined)return new Promise(resolve=>{f.releaseOlder=()=>resolve(older(owner,Number(data.before)));});
     return older(owner);
    }
    if(method==='conversation.history.locate')return older(owner,30);
    if(method==='conversation.history.detail')return {...tools,result:{content:[{type:'text',text:'Saved tool receipt job-77099'}]}};
    if(method==='conversation.history.archive'){owner.archived=data.archived;emit('studio/conversationUpdated',{conversation:{...owner},organizationOnly:true});return {...owner};}
    if(method==='conversation.history.bookmark'){
     const value=data.bookmarked?[{conversationId:owner.id,turnId:data.turnId,itemId:data.itemId,snippet:'350 K 温区'}]:[];
     bookmarks.set(owner.id,value);return value;
    }
    if(method==='conversation.history.branch'){
     const source={conversationId:owner.id,turnId:data.turnId,itemId:data.itemId,kind:'excerpt',name:owner.name};
     if(!data.revision)return {preview:{source,excerpt:'用 350 K 温区重复这个实验。',revision:'reviewed'}};
     assertFixtureRevision(data.revision);
     const branch={...chat('branch','分支讨论'),source};
     rows.push(branch);transcripts.set(branch.id,[]);return {conversation:branch,draft:'> 用 350 K 温区重复这个实验。\n\n'};
    }
    throw Error('Unexpected history fixture request '+method);
   };
   function assertFixtureRevision(value){if(value!=='reviewed')throw Error('Excerpt approval missing');}
   localStorage.setItem('studio.conversation',a.id);
   return window.renderTest('App');
  });
  const row=turn=>page.locator('.message[data-turn-id="'+turn+'"]');
  const chatScroll=page.locator('.chat-scroll');
  const composer=page.locator('.agent-panel .composer textarea');
  const earlier=page.getByRole('button',{name:'加载更早消息',exact:true});
  await row('turn-2000').waitFor();
  assert.deepEqual(await page.locator('.message[data-turn-id]').count(),30);
  assert.equal(await page.evaluate(()=>window.__test.pageReceipts[0].turns),30);
  await chatScroll.evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll'));});
  await earlier.click();
  await page.waitForFunction(()=>!!window.__test.releaseOlder);
  const top=()=>row('turn-1971').evaluate(node=>node.getBoundingClientRect().top-node.closest('.chat-scroll').getBoundingClientRect().top);
  const offset=await top();
  await page.evaluate(()=>{
   const f=window.__test,threadId=f.historyFixture.a.threadId;
   const event=(method,params)=>f.events.forEach(listener=>listener({method,provider:'deepseek',params:{threadId,...params}}));
   event('turn/started',{turn:{id:'turn-2001'}});
   event('item/agentMessage/delta',{turnId:'turn-2001',itemId:'fresh-stream',delta:'正在流入新结果'});
   event('turn/completed',{turn:{id:'turn-2001',status:'completed'}});
   f.releaseOlder();
  });
  await row('turn-1941').waitFor();await row('turn-2001').waitFor();
  assert(Math.abs(await top()-offset)<=2,'prepend and stream retain original reading anchor');
  assert.equal(await page.evaluate(()=>window.__test.historyCalls.filter(call=>call.method==='conversation.history.detail').length),0);
  await page.getByRole('button',{name:'在会话中查找',exact:true}).click();
  const find=page.getByRole('searchbox',{name:'在会话中查找',exact:true});
  await find.fill('job-77099');
  await page.getByRole('button',{name:/温度扫描.*job-77099/}).click();
  const target=page.locator('[data-located="true"][data-item-id="job-details"]');
  await target.waitFor();
  await target.getByText('查看工具详情',{exact:true}).click();
  await target.locator('pre').filter({hasText:'Saved tool receipt job-77099'}).waitFor();
  assert.equal(await page.evaluate(()=>window.__test.historyCalls.filter(call=>call.method==='conversation.history.detail').length),1);
  await composer.fill('保留原来的草稿');
  const answer=row('turn-4').filter({hasText:'用 350 K 温区重复'});
  await answer.getByRole('button',{name:'引用到草稿',exact:true}).click();
  assert.match(await composer.inputValue(),/保留原来的草稿\n\n> 用 350 K 温区重复/);
  await answer.getByRole('button',{name:'添加书签',exact:true}).click();
  await answer.getByRole('button',{name:'移除书签',exact:true}).waitFor();
  await answer.getByRole('button',{name:'从此轮另开讨论',exact:true}).click();
  const preview=page.getByRole('dialog',{name:'从此轮另开讨论',exact:true});
  await preview.getByText('用 350 K 温区重复这个实验。',{exact:true}).waitFor();
  await preview.getByRole('button',{name:'创建讨论草稿',exact:true}).click();
  const provenance=page.getByRole('button',{name:/返回来源.*温度扫描/});await provenance.waitFor();
  assert.match(await composer.inputValue(),/^> 用 350 K 温区重复/);
  await provenance.click();
  await page.locator('[data-located="true"][data-turn-id="turn-4"][data-item-id="old-repeated-answer"]').waitFor();
  assert.match(await composer.inputValue(),/^保留原来的草稿/);
  const menu=page.getByRole('button',{name:'会话菜单 · 温度扫描',exact:true});
  await menu.click();
  await page.getByRole('menuitem',{name:'归档会话',exact:true}).click();
  await menu.waitFor({state:'detached'});
  await page.getByRole('button',{name:'搜索聊天正文',exact:true}).click();
  const history=page.getByRole('dialog',{name:'历史会话',exact:true});
  await history.getByRole('searchbox',{name:'搜索聊天正文',exact:true}).fill('温区');
  const matches=history.getByRole('button',{name:/温度扫描.*已归档.*350 K/});await matches.waitFor();
  await matches.click();await history.waitFor({state:'detached'});
  await page.getByRole('button',{name:'历史会话',exact:true}).last().click();
  await history.getByText('已归档会话',{exact:true}).click();
  await history.getByRole('button',{name:'恢复归档会话',exact:true}).click();
  await history.getByRole('button',{name:'会话菜单 · 温度扫描',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await history.waitFor({state:'detached'});
  await menu.click();
  await page.getByRole('menuitem',{name:'删除对话 · 温度扫描',exact:true}).click();
  await page.getByRole('dialog',{name:'删除对话',exact:true}).getByRole('button',{name:'确认删除',exact:true}).click();
  await menu.waitFor({state:'detached'});
  await page.getByRole('button',{name:'搜索聊天正文',exact:true}).click();
  await history.getByRole('searchbox',{name:'搜索聊天正文',exact:true}).fill('job-77099');
  await history.getByText('没有匹配的消息',{exact:true}).waitFor();
  const result=await page.evaluate(()=>{
   const f=window.__test;
   return {pages:f.pageReceipts,historyCalls:f.historyCalls,unwanted:f.calls.filter(call=>['agent.connect','task.execute','agent.bindProject'].includes(call.method)||call.method==='agent.rpc'&&['thread/read','turn/start'].includes(call.data.method))};
  });
  assert.deepEqual(result.unwanted,[]);
  await fs.writeFile(path.join(out,'conversation-history-controls.json'),JSON.stringify(result,null,2));
 });
}
