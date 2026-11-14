import assert from 'node:assert/strict';
import path from 'node:path';

export async function frontendDshHistoryCases({check,out}){
 await check('dsh-history-experience-repeated-sdk-id-preserves-two-turns-live-and-replay',async page=>{
  // Run the actual Node-side adapter against controlled SDK frames. The renderer
  // receives its real public events; no provider module enters the renderer.
  const {DshBridge,dshPublicItemId,normalizeDshPublicTurns}=await import('../agent/providers/dsh.mjs');
  const threadId='dsh-history-fixture',questions=['First repeated-id question','A short follow-up question'],texts=['First opening. First complete final summary stays intact.','Second partial reply becomes a complete final answer.'];
  const store=new Map(),bridge=new DshBridge({root:'.',catalog:{get:(kind,id)=>store.get(kind+':'+id),put:(kind,id,value)=>store.set(kind+':'+id,structuredClone(value))},credential:()=>({apiKey:'inert-fixture-never-used'}),worker:()=>null});
  const session={schemaVersion:1,harness:'dsh',id:threadId,nativeId:'synthetic-sdk-session',name:'Saved DeepSeek history',turns:[],updatedAt:1},events=[];bridge.sessions.set(threadId,session);bridge.on('event',event=>events.push(structuredClone(event)));
  const segments=[];
  for(let index=0;index<2;index++){
   const turn={id:'turn-'+index,status:'inProgress',items:[{id:'same-native-user-id',type:'userMessage',content:[{type:'text',text:questions[index]}]}]},active={turn,output:false};session.turns.push(turn);bridge.activeTurns.set(threadId,active);events.length=0;
   bridge.receive({method:'studio/dshText',params:{sessionId:session.nativeId,attemptId:'repeated-native-attempt',text:index?texts[index].slice(0,20):texts[index]}});const partial=structuredClone(events);events.length=0;
   bridge.sessionEvent({sessionId:session.nativeId,event:{type:'assistant/message',data:{stream:{attemptId:'repeated-native-attempt'},message:{id:'same-native-message-id',content:[{type:'text',text:texts[index]}]}}}});bridge.finish(session,active,'completed');segments.push({partial,completed:structuredClone(events)});
  }
  const legacy=questions.map((text,index)=>({id:'turn-'+index,status:'completed',items:[{id:'same-native-user-id',type:'userMessage',content:[{type:'text',text}]},{id:'repeated-native-attempt',type:'agentMessage',text:texts[index]}]})),original=structuredClone(legacy),replayed=normalizeDshPublicTurns(threadId,legacy);
  assert.deepEqual(legacy,original);const ids=[0,1].map(index=>dshPublicItemId(threadId,'turn-'+index,'agentMessage','repeated-native-attempt'));assert.notEqual(ids[0],ids[1]);assert.equal(segments[0].partial[0].params.itemId,ids[0]);assert.equal(segments[1].partial[0].params.itemId,ids[1]);assert.deepEqual(replayed.map(turn=>turn.items[1].id),ids);bridge.close();
  await page.evaluate(async({threadId,questions,texts,replayed})=>{
   const f=window.__test,original=window.studio.invoke;f.settings.agentProvider='deepseek';f.dshChat={id:'deepseek:'+threadId,provider:'deepseek',threadId,name:'Saved DeepSeek history',projectId:null,taskId:null};f.dshTurns=[];f.dshStarts=0;f.dshReplayed=replayed;localStorage.setItem('studio.conversation',f.dshChat.id);
   window.studio.invoke=async(method,data)=>{
    if(method==='conversation.list')return [f.dshChat];if(method==='conversation.select'||method==='conversation.remember')return f.dshChat;
    if(method==='worker.restore')return {status:'disconnected',reason:'project_missing',conversationId:f.dshChat.id,checkedAt:1};
    if(method==='agent.rpc'&&['thread/resume','thread/read'].includes(data.method))return {model:'fixture-model',thread:{id:threadId,turns:f.dshTurns}};
    if(method==='agent.rpc'&&data.method==='turn/start'){f.calls.push({method,data});return {turn:{id:'turn-'+f.dshStarts++}};}
    return original(method,data);
   };return window.renderTest('App');
  },{threadId,questions,texts,replayed});
  const send=async(text,count)=>{await page.locator('.composer textarea').fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(count=>window.__test.dshStarts===count,count);};
  const emit=async events=>page.evaluate(events=>{for(const event of events)window.__test.events.forEach(fn=>fn(event));},events);
  await page.locator('.composer textarea').waitFor();await page.waitForFunction(()=>document.querySelector('.agent-panel')?.textContent.includes('DeepSeek API'));await send(questions[0],1);await emit([...segments[0].partial,...segments[0].completed]);await page.locator('[data-message-id="'+ids[0]+'"]').getByText(texts[0],{exact:true}).waitFor();await send(questions[1],2);await emit(segments[1].partial);await page.locator('[data-message-id="'+ids[1]+'"]').waitFor();assert.equal(await page.locator('[data-message-id="'+ids[0]+'"] .message-text').innerText(),texts[0]);
  const chronological=async()=>page.locator('.chat-scroll .message .message-text').allTextContents();let visible=await chronological();assert(visible.indexOf(texts[0])<visible.indexOf(questions[1]));assert.equal(visible.filter(text=>text===texts[0]).length,1);await page.screenshot({path:path.join(out,'dsh-two-turn-partial-preserves-first-final.png')});
  await emit(segments[1].completed);await page.locator('[data-message-id="'+ids[1]+'"]').getByText(texts[1],{exact:true}).waitFor();await page.locator('.composer textarea').fill('Keep my third unsent draft');
  await page.evaluate(async()=>{window.__test.dshTurns=window.__test.dshReplayed;window.testRoot.render(null);await new Promise(resolve=>requestAnimationFrame(resolve));return window.renderTest('App');});
  await page.locator('[data-message-id="'+ids[0]+'"]').waitFor();await page.locator('[data-message-id="'+ids[1]+'"]').waitFor();visible=await chronological();assert.deepEqual(visible,[questions[0],texts[0],questions[1],texts[1]]);assert.equal(await page.locator('.composer textarea').inputValue(),'Keep my third unsent draft');assert.equal(await page.evaluate(()=>window.__test.dshStarts),2);assert.equal(await page.evaluate(()=>window.__test.calls.filter(c=>c.method==='task.execute').length),0);await page.screenshot({path:path.join(out,'dsh-two-turn-replayed-history.png')});
 });
}
