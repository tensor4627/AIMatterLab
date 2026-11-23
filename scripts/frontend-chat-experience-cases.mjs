// Actual renderer/DOM interactions against synthetic transport only.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createFollowUpQueue} from '../agent/sessions/follow-up-queue.mjs';

export async function frontendChatExperienceCases({check,out}){
 const snapshot=(page,name)=>page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
 async function setup(page){await page.evaluate(async()=>{document.getElementById('root').style.cssText='display:flex;height:100vh;justify-content:center;background:var(--bg);color:var(--text)';window.__chat={rpc:[],errors:[],props:{width:620,planningMode:false,onPlanningModeChange:()=>{},context:'{}',onError:error=>window.__chat.errors.push(String(error))}};window.chatRender=changes=>{Object.assign(window.__chat.props,changes);return window.renderTest('Agent',window.__chat.props);};await window.chatRender({});});}
 const starts=page=>page.evaluate(()=>window.__test.calls.filter(call=>call.method==='agent.rpc'&&call.data.method==='turn/start'));
 async function narrow(page){await page.evaluate(()=>{const root=document.getElementById('root');root.style.width='320px';root.style.maxWidth='320px';root.style.height='720px';root.style.margin='0 auto';const style=document.documentElement.style;style.setProperty('--ui-min-font','18px');style.setProperty('--ui-scale',String(18/13));style.setProperty('--chat-font-size','28px');return window.chatRender({width:320});});}
 async function readableLayout(page){const layout=await page.evaluate(()=>{const panel=document.querySelector('.agent-panel'),composer=document.querySelector('.composer'),input=composer.querySelector('textarea'),root=document.getElementById('root'),proposal=document.querySelector('.agent-prompt-proposal');return {width:panel.getBoundingClientRect().width,inputHeight:input.getBoundingClientRect().height,inputFont:parseFloat(getComputedStyle(input).fontSize),composerBottom:composer.getBoundingClientRect().bottom,rootBottom:root.getBoundingClientRect().bottom,proposalHeight:proposal?.getBoundingClientRect().height||0,overflow:[panel,composer,proposal].filter(Boolean).map(node=>node.scrollWidth-node.clientWidth)};});assert.equal(Math.round(layout.width),320);assert(layout.inputHeight>=108,'large chat text must retain two complete editable lines');assert(layout.inputFont>=28);assert(layout.composerBottom<=layout.rootBottom+1);assert(layout.proposalHeight<=320);assert(layout.overflow.every(value=>value<=2));}

 await check('chat-experience-follow-up-steer-queue-stop-and-continue',async page=>{
  await setup(page);
  const first={provider:'codex',threadId:'fixture-thread'},second={provider:'codex',threadId:'other-thread'};
  const rows=new Map(),trace=[],active=new Map();
  let serial=0;
  const publish=event=>page.evaluate(event=>window.__test.events.forEach(listener=>listener(event)),event).catch(()=>{});
  const catalog={
   get:(kind,id)=>structuredClone(rows.get(kind+':'+id)??null),
   put:(kind,id,value)=>rows.set(kind+':'+id,structuredClone(value)),
   remove:(kind,id)=>rows.delete(kind+':'+id),
   list:kind=>[...rows].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>structuredClone(value)),
   transaction:operation=>operation(),
  };
  const model=(data,{queued=false}={})=>{
   trace.push(data);
   if(data.method==='turn/start'){
    const turn={id:'reply-' + ++serial};
    active.set(data.params.threadId,turn.id);
    if(queued)void publish({provider:data.provider,method:'turn/started',params:{threadId:data.params.threadId,turn}});
    return {turn};
   }
   if(data.method==='turn/interrupt'){queue.pause(data.provider,data.params.threadId);return {};}
   return {turnId:data.params.expectedTurnId};
  };
  const queue=createFollowUpQueue({
   catalog,agents:{activeTurn:(_provider,threadId)=>active.get(threadId)??null,isBusy:(_provider,threadId)=>active.has(threadId)},
   capture:owner=>owner,publish:event=>void publish(event),interrupt:async()=>({}),reconcile:async()=>null,
   validateFiles:(_owner,files)=>files,
   dispatch:(owner,item,control)=>{
    control.beforeDispatch();
    return model({provider:owner.provider,method:'turn/start',params:{threadId:owner.threadId,input:[{type:'text',text:item.text}]}},{queued:true});
   },
  });
  await page.exposeFunction('followUpNativeFixture',async({type,data})=>{
   if(type==='queue')return queue.request(data);
   if(type==='model')return model(data);
   if(type==='thread'){
    const turnId=active.get(data.threadId);
    return {thread:{id:data.threadId,turns:[]},model:'fixture-model',studioSession:{threadId:data.threadId,busy:!!turnId,turnId:turnId??null}};
   }
   if(data.method==='turn/completed'&&active.get(data.params.threadId)===data.params.turn?.id)active.delete(data.params.threadId);
   queue.observe(data);await publish(data);
  });
  await page.evaluate(()=>{
   const invoke=window.studio.invoke;
   window.__chat.emit=(method,params)=>window.followUpNativeFixture({type:'event',data:{provider:'codex',method,params:{threadId:'fixture-thread',...params}}});
   window.studio.invoke=async(method,data)=>{
    if(method==='agent.queue')return window.followUpNativeFixture({type:'queue',data});
    if(method==='agent.attachments.import')return new Promise(resolve=>{
     window.__chat.finishAttachment=()=>resolve(data.files.map(file=>({
      id:crypto.randomUUID(),name:file.name,kind:'text',mimeType:file.mimeType,size:file.size,
     })));
    });
    if(method==='agent.rpc'&&data.method.startsWith('turn/'))return window.followUpNativeFixture({type:'model',data});
    if(method==='agent.rpc'&&['thread/resume','thread/read'].includes(data.method))return window.followUpNativeFixture({type:'thread',data:data.params});
    return invoke(method,data);
   };
  });
  const composer=page.locator('.composer textarea');
  const end=(id,status)=>page.evaluate(({id,status})=>window.__chat.emit('turn/completed',{turn:{id,status}}),{id,status});
  const select=owner=>page.evaluate(owner=>window.chatRender({sessionSelection:{nonce:crypto.randomUUID(),
   conversation:{...owner,id:owner.provider+':'+owner.threadId,name:owner.threadId,projectId:null,taskId:null}}}),owner);
  async function waitForStarts(count){
   for(let attempt=0;attempt<50;attempt++){
    if(trace.filter(call=>call.method==='turn/start').length>=count)return;
    await new Promise(resolve=>setTimeout(resolve,50));
   }
   assert.fail('Expected the next synthetic provider call');
  }
  await page.getByTestId('agent-connect').click();
  await page.getByTestId('agent-options').click();
  const defaultAction=page.getByTestId('agent-follow-up-enter-mode');
  assert.equal(await defaultAction.inputValue(),'queue');
  await defaultAction.selectOption('steer');
  await page.getByTestId('agent-options').click();
  await composer.fill('First question');await composer.press('Enter');
  await composer.fill('Change the units in this reply');await composer.press('Enter');
  await page.getByText('Change the units in this reply',{exact:true}).waitFor();
  await composer.fill('First queued message');await composer.press('Control+Enter');
  await page.getByTestId('agent-queued-message').first().waitFor();
  await composer.fill('Second queued message');await page.getByTestId('agent-queue').click();
  await page.getByTestId('agent-queued-message').nth(1).waitFor();
  await composer.fill('Third queued message');await page.getByTestId('agent-queue').click();
  const third=page.getByTestId('agent-queued-message').nth(2);await third.waitFor();
  await third.getByTestId('agent-queued-edit').click();
  await page.getByTestId('agent-queued-editor').fill('Third queued message edited');await page.getByTestId('agent-queued-save').click();
  await third.getByTestId('agent-queued-up').click();
  await page.getByTestId('agent-queued-message').nth(1).getByText('Third queued message edited').waitFor();
  const calls=()=>trace.map(({method,params})=>({method,thread:params.threadId,turn:params.expectedTurnId||params.turnId,text:params.input?.[0]?.text}));
  assert.deepEqual(calls().map(call=>call.method),['turn/start','turn/steer']);
  assert.equal(calls()[1].turn,'reply-1');
  await snapshot(page,'chat-follow-up-pending');
  await select(second);
  await page.getByTestId('agent-follow-up-queue').waitFor({state:'hidden'});
  await composer.fill('This draft belongs to the other conversation');
  await end('reply-1','completed');
  await waitForStarts(2);
  await end('reply-2','completed');
  await waitForStarts(3);
  await end('reply-3','completed');
  await waitForStarts(4);
  assert.equal(await composer.inputValue(),'This draft belongs to the other conversation');
  assert.equal(await composer.evaluate(node=>node===document.activeElement),true);
  assert.equal(await page.getByTestId('agent-follow-up-queue').count(),0);
  await select(first);
  await page.getByTestId('agent-stop').waitFor();
  await page.evaluate(()=>window.__chat.emit('item/agentMessage/delta',{turnId:'reply-4',itemId:'partial',delta:'Partial answer before stop'}));
  await page.getByText('Partial answer before stop',{exact:true}).waitFor();
  await composer.fill('Continue from the partial answer');await page.getByTestId('agent-stop').click();
  await page.getByRole('button',{name:'等待停止确认',exact:true}).waitFor();
  await end('reply-4','interrupted');
  assert.equal(await composer.inputValue(),'Continue from the partial answer');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await waitForStarts(5);
  const actual=calls();
  assert.deepEqual(actual.map(call=>call.method),['turn/start','turn/steer','turn/start','turn/start','turn/start','turn/interrupt','turn/start']);
  assert.deepEqual(actual.filter(call=>call.method==='turn/start').map(call=>call.text),['First question','First queued message','Third queued message edited','Second queued message','Continue from the partial answer']);
  assert(actual.every(call=>call.thread==='fixture-thread'));
  assert.equal(actual[5].turn,'reply-4');
  await composer.fill('This draft waits for the entire file');
  await page.getByTestId('chat-file-picker').setInputFiles({name:'queued-notes.txt',mimeType:'text/plain',buffer:Buffer.from('Only synthetic fixture notes.')});
  await page.waitForFunction(()=>window.__chat.finishAttachment);
  assert.equal(await page.getByTestId('agent-queue').isDisabled(),true);
  assert.equal(await page.getByTestId('agent-steer').isDisabled(),true);
  await composer.press('Enter');await composer.press('Control+Enter');
  assert.equal(await page.getByTestId('agent-queued-message').count(),0);
  assert.equal(calls().length,actual.length);
  await composer.fill('');
  await page.evaluate(()=>window.__chat.finishAttachment());
  await page.getByTestId('chat-file-chip').getByText('queued-notes.txt',{exact:true}).waitFor();
  await page.getByTestId('agent-queue').click();
  await page.getByTestId('agent-queued-message').getByText('queued-notes.txt',{exact:true}).waitFor();
  await page.evaluate(()=>window.__chat.emit('studio/chatEvidenceSelected',{provider:'codex',files:Array.from({length:8},(_,index)=>({
   id:crypto.randomUUID(),name:'draft-'+index+'.txt',kind:'text',mimeType:'text/plain',size:5,
  }))}));
  await page.getByRole('button',{name:'移除附件 draft-7.txt',exact:true}).waitFor();
  await page.getByTestId('agent-queued-to-draft').click();
  await page.getByText('每条消息最多添加 8 个附件。',{exact:true}).waitFor();
  assert.equal(await page.getByTestId('agent-queued-message').count(),1);
  await page.getByRole('button',{name:'移除附件 draft-7.txt',exact:true}).click();
  await page.getByTestId('agent-queued-to-draft').click();
  await page.getByTestId('agent-queued-message').waitFor({state:'detached'});
  await page.getByRole('button',{name:'移除附件 queued-notes.txt',exact:true}).waitFor();
  assert.equal(await composer.inputValue(),'');
  assert.equal(calls().length,actual.length);
  await snapshot(page,'chat-follow-up-file-restored');
  assert.deepEqual(await page.evaluate(()=>window.__chat.errors),[]);
  queue.close();
 });

 await check('chat-experience-cancel-preparation-keeps-exact-draft',async page=>{
  await setup(page);await page.evaluate(()=>{const original=window.studio.invoke;window.studio.invoke=async(method,data)=>{if(method==='conversation.remember')return new Promise(resolve=>{window.__chat.pendingRemember=()=>resolve({id:data.provider+':'+data.threadId,provider:data.provider,threadId:data.threadId,name:'Synthetic',projectId:null,taskId:null});});return original(method,data);};});
  await page.getByTestId('agent-connect').click();await page.locator('.composer textarea').fill('Keep this exact draft after cancellation');await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>window.__chat.pendingRemember);await page.getByTestId('agent-stop').click();await page.evaluate(()=>window.__chat.pendingRemember());await page.getByRole('button',{name:'发送',exact:true}).waitFor();
  assert.equal(await page.locator('.composer textarea').inputValue(),'Keep this exact draft after cancellation');assert.equal((await starts(page)).length,0);assert.equal(await page.evaluate(()=>window.__test.calls.filter(call=>call.method==='agent.rpc'&&call.data.method==='turn/interrupt').length),0);await snapshot(page,'chat-cancelled-preparation');
 });

 await check('chat-experience-stop-awaits-identity-and-explicit-retry',async page=>{
  await setup(page);await page.evaluate(()=>{const original=window.studio.invoke;window.studio.invoke=async(method,data)=>{if(method==='agent.rpc'&&data.method==='turn/start')return new Promise(resolve=>{window.__chat.ack=()=>resolve({turn:{id:'exact-stopped-turn'}});});if(method==='agent.rpc'&&data.method==='turn/interrupt'){window.__chat.rpc.push(data);if(window.__chat.rpc.length===1)throw Error('Synthetic acknowledgement unavailable');return {};}return original(method,data);};});
  await page.getByTestId('agent-connect').click();await page.locator('.composer textarea').fill('Message submitted before stopping');await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>window.__chat.ack);await page.getByTestId('agent-stop').click();assert.equal(await page.getByTestId('agent-stop').isDisabled(),true);assert.equal(await page.evaluate(()=>window.__chat.rpc.length),0);
  await page.locator('.composer textarea').fill('Unsent continuation');await page.evaluate(()=>window.__chat.ack());
  await page.getByRole('button',{name:'再次请求停止',exact:true}).waitFor();assert.equal(await page.getByTestId('agent-stop').innerText(),'再次停止');assert.equal(await page.getByTestId('agent-work-state').innerText(),'停止结果待确认');assert.equal(await page.locator('.composer textarea').inputValue(),'Unsent continuation');assert.deepEqual(await page.evaluate(()=>window.__chat.rpc.map(call=>call.params)),[{threadId:'fixture-thread',turnId:'exact-stopped-turn'}]);await snapshot(page,'chat-stop-unconfirmed');await page.getByRole('button',{name:'再次请求停止',exact:true}).click();await page.waitForFunction(()=>window.__chat.rpc.length===2);await page.evaluate(()=>window.__test.events.forEach(fn=>fn({provider:'codex',method:'turn/completed',params:{threadId:'fixture-thread',turn:{id:'exact-stopped-turn',status:'interrupted',error:{message:'cancelled'}}}})));
  await page.getByRole('button',{name:'发送',exact:true}).waitFor();assert.equal(await page.locator('.composer textarea').inputValue(),'Unsent continuation');assert.equal(await page.getByText('已停止当前回复。',{exact:true}).count(),1);assert.deepEqual(await page.evaluate(()=>window.__chat.errors),['Error: Synthetic acknowledgement unavailable']);
 });

 await check('chat-experience-discussion-preserves-draft-and-offers-explicit-choice',async page=>{
  await setup(page);await page.locator('.composer textarea').fill('My detailed unsent calculation request');await page.evaluate(()=>window.chatRender({intent:{id:'discussion-1',text:'New discussion from the workflow'}}));await page.getByTestId('agent-prompt-proposal').waitFor();assert.equal(await page.locator('.composer textarea').inputValue(),'My detailed unsent calculation request');await snapshot(page,'chat-discussion-choice');await page.getByTestId('agent-prompt-append').click();assert.equal(await page.locator('.composer textarea').inputValue(),'My detailed unsent calculation request\n\nNew discussion from the workflow');
  await page.evaluate(()=>window.chatRender({intent:{id:'discussion-2',text:'A second suggestion'}}));await page.getByTestId('agent-prompt-cancel').click();assert.match(await page.locator('.composer textarea').inputValue(),/^My detailed/);await page.evaluate(()=>window.chatRender({intent:{id:'discussion-3',text:'Explicit replacement'}}));await page.getByTestId('agent-prompt-replace').click();assert.equal(await page.locator('.composer textarea').inputValue(),'Explicit replacement');assert.equal((await starts(page)).length,0);
 });

 await check('chat-experience-history-loading-failure-and-owner-safe-retry',async page=>{
  await setup(page);await page.evaluate(()=>{const original=window.studio.invoke;window.__chat.conversation=id=>({id:'codex:'+id,provider:'codex',threadId:id,name:id,projectId:null,taskId:null});window.studio.invoke=async(method,data)=>{if(method==='agent.rpc'&&data.method==='thread/resume')return {thread:{id:data.params.threadId},model:'fixture-model'};if(method==='agent.rpc'&&data.method==='thread/read'){const id=data.params.threadId;if(id==='B'&&!window.__chat.retryReady)return new Promise((_resolve,reject)=>window.__chat.failHistory=()=>reject(Error('Synthetic selected history unavailable')));return {thread:{id,turns:[{items:[{id:id+'-message',type:'agentMessage',text:'Only history for '+id}]}]}};}if(method==='conversation.remember')return window.__chat.conversation(data.threadId);return original(method,data);};return window.chatRender({sessionSelection:{nonce:'A',conversation:window.__chat.conversation('A')}});});
  await page.getByText('Only history for A',{exact:true}).waitFor();await page.locator('.composer textarea').fill('Draft A');await page.evaluate(()=>window.chatRender({sessionSelection:{nonce:'B',conversation:window.__chat.conversation('B')}}));await page.getByTestId('agent-history-state').waitFor();assert.equal(await page.getByText('Only history for A',{exact:true}).count(),0);await page.locator('.composer textarea').fill('Draft B while loading');await page.waitForFunction(()=>window.__chat.failHistory);await page.evaluate(()=>window.__chat.failHistory());await page.getByTestId('agent-history-retry').waitFor();assert.equal(await page.locator('.message').count(),0);await snapshot(page,'chat-history-failed');await page.evaluate(()=>{window.__chat.retryReady=true;});await page.getByTestId('agent-history-retry').click();await page.getByText('Only history for B',{exact:true}).waitFor();assert.equal(await page.locator('.composer textarea').inputValue(),'Draft B while loading');assert.equal((await starts(page)).length,0);
 });

 await check('chat-experience-draft-edits-do-not-regroup-an-unchanged-transcript',async page=>{
  await page.evaluate(async()=>{
   const {default:Messages}=await import('/frontend/features/conversations/ConversationMessages.tsx');
   const {createElement:h,useState}=window.React;
   const rows=Array.from({length:120},(_,i)=>({id:'row-'+i,itemId:'row-'+i,turnId:String(i),role:'user',text:'Message '+i}));
   let traversals=0;
   const messages=new Proxy(rows,{get(target,property,receiver){
    if(property===Symbol.iterator)traversals++;
    return Reflect.get(target,property,receiver);
   }});
   const actions={bookmark(){}};
   window.__test.transcriptTraversals=()=>traversals;
   function Fixture(){
    const [draft,setDraft]=useState(''),[bookmarks,setBookmarks]=useState([]);
    return h('section',null,
     h('input',{'aria-label':'Draft',value:draft,onChange:event=>setDraft(event.target.value)}),
     h('button',{onClick:()=>setBookmarks([{turnId:'0',itemId:'row-0'}])},'Bookmark first'),
     h(Messages,{messages,language:'zh-CN',actions,disabled:false,canOriginalRun:false,canCluster:false,canCompute:false,bookmarks}));
   }
   window.testRoot.render(h(Fixture));
  });
  const first=page.locator('[data-message-id="row-0"]');
  await first.waitFor();
  const initial=await page.evaluate(()=>window.__test.transcriptTraversals());
  assert(initial>0);
  await page.getByRole('textbox',{name:'Draft'}).pressSequentially('new draft');
  assert.equal(await page.evaluate(()=>window.__test.transcriptTraversals()),initial);
  await page.getByRole('button',{name:'Bookmark first'}).click();
  await first.getByRole('button',{name:'移除书签'}).waitFor();
  assert((await page.evaluate(()=>window.__test.transcriptTraversals()))>initial);
 });

 await check('chat-experience-long-history-preserves-selection-and-completed-dom',async page=>{
  await setup(page);await page.getByTestId('agent-connect').click();await page.locator('.composer textarea').fill('Synthetic history rendering check');await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>window.__test.calls.some(call=>call.method==='agent.rpc'&&call.data.method==='turn/start'));
  await page.evaluate(()=>{for(let i=0;i<250;i++)window.__test.events.forEach(fn=>fn({provider:'codex',method:'item/agentMessage/delta',params:{threadId:'fixture-thread',itemId:'history-'+i,delta:'History '+i+' — **stable selected text** and `code`.'}}));});await page.locator('[data-message-id="history-249"]').waitFor();
  await page.evaluate(()=>{const scroll=document.querySelector('.chat-scroll'),message=document.querySelector('[data-message-id="history-5"]'),text=message.querySelector('p').firstChild;scroll.scrollTop=message.offsetTop-scroll.offsetTop;scroll.dispatchEvent(new Event('scroll'));const selection=window.getSelection(),range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(text.textContent.length,9));selection.removeAllRanges();selection.addRange(range);window.__chat.anchor=text;window.__chat.selected=selection.toString();window.__chat.scrollTop=scroll.scrollTop;window.__chat.mutations=0;window.__chat.observer=new MutationObserver(records=>window.__chat.mutations+=records.length);window.__chat.observer.observe(message,{subtree:true,childList:true,characterData:true});});
  for(let i=0;i<12;i++)await page.evaluate(()=>{window.__test.events.forEach(fn=>fn({provider:'codex',method:'item/agentMessage/delta',params:{threadId:'fixture-thread',itemId:'history-249',delta:' latest'}}));return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const state=await page.evaluate(()=>({sameAnchor:window.getSelection().anchorNode===window.__chat.anchor,selection:window.getSelection().toString(),expected:window.__chat.selected,position:document.querySelector('.chat-scroll').scrollTop,expectedPosition:window.__chat.scrollTop,mutations:window.__chat.mutations}));assert.equal(state.sameAnchor,true);assert.equal(state.selection,state.expected);assert.equal(state.mutations,0);assert(Math.abs(state.position-state.expectedPosition)<=1);await page.getByTestId('agent-new-messages').waitFor();await snapshot(page,'chat-stable-long-history');
 });

 await check('chat-experience-round2-narrow-large-font-proposal-keyboard',async page=>{
  await setup(page);await narrow(page);await page.getByTestId('agent-connect').click();await page.locator('.composer textarea').fill('保留我正在编辑的草稿');await page.evaluate(()=>{window.__chat.longProposal='需要逐项讨论的输入与约束。\n'.repeat(80)+'unbroken_reference_'.repeat(18);return window.chatRender({intent:{id:'large-font-long-proposal',text:window.__chat.longProposal}});});
  const preview=page.getByTestId('agent-prompt-preview');await preview.waitFor();assert.equal(await preview.getAttribute('open'),null);assert.match(await page.getByTestId('agent-prompt-append').getAttribute('class'),/primary/);await readableLayout(page);await preview.locator('summary').focus();await page.keyboard.press('Enter');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'PRE');await page.keyboard.press('PageDown');await page.waitForFunction(()=>document.querySelector('[data-testid="agent-prompt-preview"] pre').scrollTop>0);await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-testid')),'agent-prompt-append');await readableLayout(page);await snapshot(page,'chat-round2-narrow-proposal');await page.keyboard.press('Enter');assert.equal(await page.locator('.composer textarea').inputValue(),'保留我正在编辑的草稿\n\n'+await page.evaluate(()=>window.__chat.longProposal));assert.equal((await starts(page)).length,0);await page.locator('.composer textarea').fill('仍可继续编辑');assert.equal(await page.locator('.composer textarea').inputValue(),'仍可继续编辑');
 });

 await check('chat-experience-round2-single-history-recovery-and-error-details',async page=>{
  await setup(page);await narrow(page);await page.evaluate(()=>{const original=window.studio.invoke;window.studio.invoke=async(method,data)=>{if(method==='agent.rpc'&&data.method==='thread/resume')return {thread:{id:data.params.threadId},model:'fixture-model'};if(method==='agent.rpc'&&data.method==='thread/read')throw Error('Synthetic recovery detail: '+('long_error_reference_'.repeat(40)));return original(method,data);};return window.chatRender({sessionSelection:{nonce:'round2-history',conversation:{id:'codex:round2-history',provider:'codex',threadId:'round2-history',name:'Selected history',projectId:null,taskId:null}}});});
  await page.getByTestId('agent-history-retry').waitFor();assert.equal(await page.getByTestId('agent-restore-draft').count(),0);assert.equal(await page.getByTestId('agent-history-error-details').getAttribute('open'),null);await page.locator('.composer textarea').fill('读取失败时继续保留的草稿');await page.getByTestId('agent-history-error-details').locator('summary').focus();await page.keyboard.press('Enter');assert.match(await page.getByTestId('agent-history-error-details').innerText(),/Synthetic recovery detail/);await readableLayout(page);await snapshot(page,'chat-round2-single-history-recovery');assert.equal((await starts(page)).length,0);
 });

 await check('chat-experience-round2-narrow-visible-stop-states',async page=>{
  await setup(page);await narrow(page);await page.evaluate(()=>{const original=window.studio.invoke;window.studio.invoke=async(method,data)=>{if(method==='agent.rpc'&&data.method==='turn/start')return new Promise(resolve=>window.__chat.ack=()=>resolve({turn:{id:'round2-turn'}}));if(method==='agent.rpc'&&data.method==='turn/interrupt'){window.__chat.rpc.push(data);return new Promise((_resolve,reject)=>window.__chat.failStop=()=>reject(Error('Synthetic stop result unconfirmed')));}return original(method,data);};});
  const stop=page.getByTestId('agent-stop'),composer=page.locator('.composer textarea');
  await page.getByTestId('agent-connect').click();
  await composer.fill('等待停止确认时保留草稿');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.waitForFunction(()=>window.__chat.ack);
  await stop.click();
  await page.getByRole('button',{name:'确认提交中',exact:true}).waitFor();
  assert.equal(await stop.isDisabled(),true);
  await composer.fill('正在编辑的下一条消息');
  await page.evaluate(()=>window.__chat.ack());
  await page.waitForFunction(()=>window.__chat.failStop);
  await page.getByRole('button',{name:'等待停止确认',exact:true}).waitFor();
  assert.equal(await stop.isDisabled(),true);
  await readableLayout(page);
  await page.evaluate(()=>window.__chat.failStop());
  await page.getByRole('button',{name:'再次请求停止',exact:true}).waitFor();
  assert.equal(await stop.innerText(),'再次停止');
  assert.equal(await page.getByTestId('agent-work-state').innerText(),'停止结果待确认');
  assert.equal(await composer.inputValue(),'正在编辑的下一条消息');
  assert.deepEqual(await page.evaluate(()=>window.__chat.rpc.map(value=>value.params)),[{threadId:'fixture-thread',turnId:'round2-turn'}]);
  await readableLayout(page);await snapshot(page,'chat-round2-narrow-stop-state');
 });

 await check('chat-experience-round2-light-english-stop-contrast-and-keyboard',async page=>{
  await setup(page);await narrow(page);await page.evaluate(async()=>{const {setLanguage}=await import('/frontend/ui/i18n.ts');setLanguage('en');document.documentElement.dataset.theme='light';window.__chat.submits=0;const original=window.studio.invoke;window.studio.invoke=async(method,data)=>{if(method==='agent.rpc'&&data.method==='turn/start'){window.__chat.submits++;return new Promise(resolve=>window.__chat.ack=()=>resolve({turn:{id:'light-english-turn'}}));}if(method==='agent.rpc'&&data.method==='turn/interrupt'){window.__chat.rpc.push(data);return new Promise((_resolve,reject)=>window.__chat.failStop=()=>reject(Error('Synthetic stop result unconfirmed')));}return original(method,data);};return window.chatRender({width:320});});
  const samples=[];
  async function inspect(state){await readableLayout(page);const sample=await page.getByTestId('agent-stop').evaluate((button,state)=>{const style=getComputedStyle(button),parse=value=>(value.match(/[\d.]+/g)||[]).slice(0,3).map(Number),blend=(a,b,opacity)=>a.map((value,i)=>value*opacity+b[i]*(1-opacity));let parent=button.parentElement,canvas;while(parent){const value=getComputedStyle(parent).backgroundColor;if(value!=='rgba(0, 0, 0, 0)'&&value!=='transparent'){canvas=parse(value);break;}parent=parent.parentElement;}canvas||=[255,255,255];const opacity=Number(style.opacity),foreground=blend(parse(style.color),canvas,opacity),background=blend(parse(style.backgroundColor),canvas,opacity),luminance=rgb=>rgb.map(value=>{const s=value/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;}).reduce((sum,value,i)=>sum+value*[.2126,.7152,.0722][i],0),a=luminance(foreground),b=luminance(background);return {state,text:button.innerText,color:style.color,background:style.backgroundColor,opacity,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),disabled:button.disabled,overflow:button.scrollWidth-button.clientWidth};},state);samples.push(sample);assert(sample.overflow<=1);assert(sample.contrast>=(sample.disabled?3:4.5),JSON.stringify(sample));}
  await page.getByTestId('agent-connect').click();await page.locator('.composer textarea').fill('Keep this draft while the stop is confirmed');await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>window.__chat.ack);await page.mouse.move(0,0);assert.equal(await page.getByTestId('agent-stop').innerText(),'Stop');await inspect('enabled');await snapshot(page,'chat-round2-light-english-stop');
  await page.getByTestId('agent-stop').focus();await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Confirming submission',exact:true}).waitFor();
  await inspect('awaiting-turn-identity');
  await page.evaluate(()=>window.__chat.ack());await page.waitForFunction(()=>window.__chat.failStop);
  await page.getByRole('button',{name:'Awaiting stop confirmation',exact:true}).waitFor();
  await inspect('awaiting-stop-receipt');await snapshot(page,'chat-round2-light-english-stop-waiting');
  await page.evaluate(()=>window.__chat.failStop());await page.waitForFunction(()=>document.querySelector('[data-testid="agent-stop"]')?.textContent==='Retry stop');await page.getByTestId('agent-stop').hover();await inspect('retry-hover');await snapshot(page,'chat-round2-light-english-stop-retry');await page.getByTestId('agent-stop').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__chat.rpc.length===2);assert.equal(await page.evaluate(()=>window.__chat.submits),1);assert.deepEqual(await page.evaluate(()=>window.__chat.rpc.map(value=>value.params)),[{threadId:'fixture-thread',turnId:'light-english-turn'},{threadId:'fixture-thread',turnId:'light-english-turn'}]);assert.equal(await page.locator('.composer textarea').inputValue(),'');await fs.writeFile(path.join(out,'chat-round2-light-english-stop-contrast.json'),JSON.stringify(samples,null,2)+'\n');
 });
}
