import test from 'node:test';
import assert from 'node:assert/strict';
import {agentHarness,conversation,deferred,memoryStorage} from '../helpers/agent-hooks.mjs';
import {createFollowUpQueue} from '../../agent/sessions/follow-up-queue.mjs';
import {explicitNewWorkflow} from '../../contracts/agent/workflow-intent.mjs';
import {attachmentPrompt} from '../../contracts/agent/chat-attachments.mjs';

const find=(h,id)=>h.find(node=>node.props?.['data-testid']===id);
const calls=(h,method)=>h.calls.filter(call=>call.method==='agent.rpc'&&call.data.method===method).map(call=>call.data);
const starts=h=>calls(h,'turn/start').map(call=>[call.provider,call.params.threadId,call.params.input[0].text]);
const complete=(h,threadId,turnId,status='completed',provider='codex')=>
 h.emit({provider,method:'turn/completed',params:{threadId,turn:{id:turnId,status}}});
const enter=(h,options={})=>h.textarea().props.onKeyDown({key:'Enter',nativeEvent:{},preventDefault(){},...options});
const ownerKey=({provider,threadId})=>provider+':'+threadId;
const databases=new WeakMap();
function queueCatalog(storage){
 let rows=databases.get(storage);
 if(!rows)databases.set(storage,rows=new Map());
 return {
  get:(kind,id)=>structuredClone(rows.get(kind+':'+id)??null),
  put:(kind,id,value)=>rows.set(kind+':'+id,structuredClone(value)),
  remove:(kind,id)=>rows.delete(kind+':'+id),
  list:kind=>[...rows.entries()].filter(([key])=>key.startsWith(kind+':')).map(([,value])=>structuredClone(value)),
  transaction:run=>run(),
 };
}
async function chooseEnter(h,action){
 h.click('agent-options');await h.flush();
 find(h,'agent-follow-up-enter-mode').props.onChange({target:{value:action}});
 await h.flush();
}

async function fixture({provider='codex',props,handle,storage=memoryStorage(),sendInitial=true}={}){
 let next=0,closed=false,project=props?.projectId,receive;
 const active=new Map(),completed=new Set();
 const q=createFollowUpQueue({
  catalog:queueCatalog(storage),agents:{activeTurn:(provider,threadId)=>active.get(ownerKey({provider,threadId}))?.id??null,
   isBusy:(provider,threadId)=>active.get(ownerKey({provider,threadId}))?.busy===true},
  capture:owner=>({...owner,project}),publish:event=>receive?.(event),reconcile:async()=>null,
  validateFiles:(_owner,files)=>files,
  interrupt:async()=>({}),
  async dispatch(owner,item,control){
   if(control.mode==='steer'){
    control.beforeDispatch();
    const data={provider:owner.provider,method:'turn/steer',params:{threadId:owner.threadId,expectedTurnId:control.targetTurnId,
     clientUserMessageId:item.id,input:[{type:'text',text:item.text}],planningMode:item.planningMode}};
    h.calls.push({method:'agent.rpc',data});
    return handle?.('steer',data)??{turnId:control.targetTurnId};
   }
   const key=ownerKey(owner);
   active.set(key,{busy:true,id:null});
   receive({provider:owner.provider,method:'studio/agentTurnState',params:{threadId:owner.threadId,turnId:null,busy:true}});
   try{
    const text=item.text.trim()?item.text:attachmentPrompt(item.files);
    const fresh=item.newWorkflow||explicitNewWorkflow(item.text);
    let taskId=item.preparedTaskId;
    if((item.planningMode||fresh)&&!taskId){
     if(fresh)control.beforeTaskCreation();
     const data={request:text,provider:owner.provider,threadId:owner.threadId,newWorkflow:fresh};
     h.calls.push({method:'task.create',data});
     const task=await(handle?.('workflow',data)??{id:'prepared-task'});
     if(fresh)control.taskPrepared(task.id);
     taskId=task.id;
    }
    control.beforeDispatch();
    const data={provider:owner.provider,method:'turn/start',params:{
     threadId:owner.threadId,input:[{type:'text',text},{type:'text',text:item.context}],
     planningMode:item.planningMode,studioTaskId:taskId,studioSkillId:item.skill?.functionId,studioAttachments:item.files?.map(file=>file.id),
    }};
    h.calls.push({method:'agent.rpc',data});
    const turnId='turn-'+ ++next;
    const result=await(handle?.('start',data,turnId)??{turn:{id:turnId}});
    if(!closed&&!completed.has(key+'|'+result.turn.id))h.emit({provider:owner.provider,method:'turn/started',params:{threadId:owner.threadId,turn:result.turn}});
    return result;
   }catch(error){
    if(!closed){
     active.delete(key);
     receive({provider:owner.provider,method:'studio/agentTurnState',params:{threadId:owner.threadId,turnId:null,busy:false}});
    }
    throw error;
   }
  },
 });
 q.recover();
 const h=agentHarness({storage,props:{sessionSelection:{nonce:'first',conversation:conversation(provider,'first')},...props},override:async(method,data,standard)=>{
  if(method==='agent.queue'){
   if(data.action==='enqueue')await handle?.('before-admission',data);
   const result=await q.request(data);
   if(data.action==='enqueue')await handle?.('admission',data);
   return result;
  }
  if(method==='agent.attachments.import')return handle?.('file-import',data)??[];
  if(method==='agent.rpc'&&data.method==='turn/start'){
   const turnId='turn-'+ ++next;
   const result=await(handle?.('start',data,turnId)??{turn:{id:turnId}});
   if(!closed)active.set(ownerKey({provider:data.provider,threadId:data.params.threadId}),{busy:true,id:result.turn.id});
   return result;
  }
  if(method==='agent.rpc'&&data.method==='turn/steer')return handle?.('steer',data)??{turnId:data.params.expectedTurnId};
  if(method==='agent.rpc'&&data.method==='turn/interrupt'){q.pause(data.provider,data.params.threadId);return {accepted:true};}
  if(method==='task.create')return handle?.('workflow',data)??{id:'prepared-task'};
  if(method==='agent.rpc'&&['thread/resume','thread/read'].includes(data.method)){
   const result=await standard(method,data);
   const flight=active.get(ownerKey({provider:data.provider,threadId:data.params.threadId}));
   if(flight)return {...result,studioSession:{threadId:data.params.threadId,turnId:flight.id,busy:true}};
   return result;
  }
  return standard(method,data);
 }});
 receive=h.emit;
 h.emit=event=>{
  const key=ownerKey({provider:event.provider,threadId:event.params?.threadId});
  if(event.method==='turn/started')active.set(key,{busy:true,id:event.params.turn.id});
  if(event.method==='turn/completed'&&active.get(key)?.id===event.params.turn.id){
   active.delete(key);completed.add(key+'|'+event.params.turn.id);
  }
  q.observe(event);receive(event);
 };
 const unmount=h.unmount;h.unmount=()=>{closed=true;q.close();unmount();};
 const render=h.render;h.render=changes=>{if(changes&&'projectId' in changes)project=changes.projectId;return render(changes);};
 await h.flush();if(sendInitial){h.type('First request');h.send();await h.flush();}
 return h;
}

test('busy Enter queues once, preserves new typing and follows exact terminal receipts in FIFO order',async()=>{
 const h=await fixture();
 try{
  h.type('First follow-up');
  enter(h,{shiftKey:true});enter(h,{nativeEvent:{isComposing:true}});enter(h,{repeat:true});
  assert.equal(h.textarea().props.value,'First follow-up');
  assert.throws(()=>find(h,'agent-follow-up-queue'));
  enter(h);enter(h);await h.flush();
  assert.equal(h.textarea().props.value,'');
  h.type('Second follow-up');h.click('agent-queue');await h.flush();
  h.type('A third draft stays unsent');
  assert.deepEqual(starts(h),[['codex','first','First request']]);
  complete(h,'first','wrong-turn');
  complete(h,'other','turn-1');
  await h.flush();assert.equal(starts(h).length,1);
  complete(h,'first','turn-1');await h.flush();
  assert.equal(starts(h).at(-1)[2],'First follow-up');
  complete(h,'first','turn-1');await h.flush();assert.equal(starts(h).length,2);
  complete(h,'first','turn-2');await h.flush();
  assert.deepEqual(starts(h).map(start=>start[2]),['First request','First follow-up','Second follow-up']);
  assert.equal(h.textarea().props.value,'A third draft stays unsent');
  assert.throws(()=>find(h,'agent-follow-up-queue'));
 }finally{h.unmount();}
});

for(const provider of ['codex','deepseek','qwen','compatible']){
 test(provider+' steering targets the current turn and leaves further typing intact',async()=>{
  const gate=deferred();
  const h=await fixture({provider,handle:stage=>stage==='steer'?gate.promise:undefined});
  try{
   h.type('Use 310 K in this reply');
   h.click('agent-steer');h.click('agent-steer');await h.flush();
   assert.equal(calls(h,'turn/steer').length,1);
   const [steering]=calls(h,'turn/steer');
   assert.equal(steering.provider,provider);
   assert.equal(steering.params.threadId,'first');
   assert.equal(steering.params.expectedTurnId,'turn-1');
   assert.deepEqual(steering.params.input,[{type:'text',text:'Use 310 K in this reply'}]);
   assert.ok(steering.params.clientUserMessageId);
   h.type('New draft after submitting steer');gate.resolve({turnId:'turn-1'});await h.flush();
   assert.equal(h.textarea().props.value,'New draft after submitting steer');
   assert.equal(starts(h).length,1);
   assert.match(JSON.stringify(h.find(node=>node.props?.className==='agent-send-notice')),/引导已发送/);
  }finally{h.unmount();}
 });
}

test('Kimi offers queued messages only and dispatches the follow-up after its receipt',async()=>{
 const h=await fixture({provider:'kimi'});
 try{
  h.type('Wait for the next reply');assert.throws(()=>find(h,'agent-steer'));
  h.click('agent-queue');await h.flush();
  complete(h,'first','turn-1','completed','kimi');await h.flush();
  assert.equal(starts(h).at(-1)[2],'Wait for the next reply');
  assert.deepEqual(calls(h,'turn/steer'),[]);
 }finally{h.unmount();}
});

test('queued text can be steered once, removed, or moved back to a nonempty draft',async()=>{
 const h=await fixture();
 try{
  h.type('Promote this queued message');h.click('agent-queue');await h.flush();
  h.click('agent-queued-steer');await h.flush();
  assert.equal(calls(h,'turn/steer')[0].params.input[0].text,'Promote this queued message');
  assert.throws(()=>find(h,'agent-follow-up-queue'));
  h.type('Delete this queued message');h.click('agent-queue');await h.flush();
  h.click('agent-queued-remove');await h.flush();
  h.type('Restore this queued message');h.click('agent-queue');await h.flush();
  h.type('New draft');h.click('agent-queued-to-draft');await h.flush();
  assert.equal(h.textarea().props.value,'New draft\n\nRestore this queued message');
  complete(h,'first','turn-1');await h.flush();assert.equal(starts(h).length,1);
 }finally{h.unmount();}
});

function fileRef(index,name='sample-'+index+'.txt'){
 return {id:'12345678-1234-4abc-8fff-'+String(index).padStart(12,'0'),name,kind:'text',mimeType:'text/plain',size:12};
}
function addFixtureFiles(h,files){
 h.emit({method:'studio/chatEvidenceSelected',params:{provider:'codex',threadId:'first',files}});
}

test('moving a file-only message to a full draft keeps the queue and restores its chip when space is made',async()=>{
 const h=await fixture();
 try{
  const queued=fileRef(123,'queued-file.txt'),fill=Array.from({length:8},(_,index)=>fileRef(index));
  addFixtureFiles(h,[queued]);await h.flush();
  assert.equal(h.textarea().props.value,'');
  assert.equal(find(h,'agent-queue').props.disabled,false);
  h.click('agent-queue');await h.flush();
  assert.equal(h.calls.find(call=>call.method==='agent.queue'&&call.data.action==='enqueue').data.item.text,'');
  addFixtureFiles(h,fill);await h.flush();
  h.click('agent-queued-to-draft');await h.flush();
  assert.equal(h.calls.filter(call=>call.method==='agent.queue'&&call.data.action==='remove').length,0);
  assert(find(h,'agent-queued-message'));
  assert(h.find(node=>node.props?.children==='每条消息最多添加 8 个附件。'));
  h.find(node=>node.props?.['aria-label']==='移除附件 '+fill[7].name).props.onClick();
  await h.flush();h.click('agent-queued-to-draft');await h.flush();
  assert.throws(()=>find(h,'agent-queued-message'));
  assert.equal(h.textarea().props.value,'');
  assert(h.find(node=>node.props?.tooltip==='预览附件 · '+queued.name));
  assert(h.find(node=>node.props?.['aria-label']==='移除附件 '+queued.name));
  assert.match(h.storage.values.get('studio.composer.v1.'+JSON.stringify(['codex','thread','first'])),/queued-file\.txt/);
 }finally{h.unmount();}
});

test('an unsavable draft leaves the queued item in place',async()=>{
 const storage=memoryStorage(),setItem=storage.setItem;
 let fail=false;
 storage.setItem=(key,value)=>{if(fail&&key==='studio.composer.v1.'+JSON.stringify(['codex','thread','first']))throw Error('Fixture storage full');setItem(key,value);};
 const h=await fixture({storage});
 try{
  h.type('Keep queued');h.click('agent-queue');await h.flush();
  h.type('Unchanged draft');fail=true;
  h.click('agent-queued-to-draft');await h.flush();
  assert.equal(h.textarea().props.value,'Unchanged draft');
  assert(find(h,'agent-queued-message'));
  assert.equal(h.calls.filter(call=>call.method==='agent.queue'&&call.data.action==='remove').length,0);
 }finally{h.unmount();}
});

test('busy composer keyboard and stale button handlers wait for the exact draft file import while another chat remains usable',async()=>{
 const pending=deferred(),h=await fixture({handle:stage=>stage==='file-import'?pending.promise:undefined});
 try{
  h.type('Send the whole original draft once files arrive');
  const queueClick=find(h,'agent-queue').props.onClick,steerClick=find(h,'agent-steer').props.onClick;
  const picker=find(h,'chat-file-picker');
  picker.props.onChange({target:{value:'fixture',files:[new File(['synthetic'], 'delayed.txt',{type:'text/plain'})]}});
  await h.flush();
  assert.equal(h.calls.filter(call=>call.method==='agent.attachments.import').length,1);
  assert.equal(find(h,'agent-queue').props.disabled,true);
  assert.equal(find(h,'agent-steer').props.disabled,true);
  enter(h);enter(h,{ctrlKey:true});queueClick();steerClick();await h.flush();
  assert.equal(h.calls.filter(call=>call.method==='agent.queue'&&call.data.action==='enqueue').length,0);
  assert.equal(calls(h,'turn/steer').length,0);
  h.render({sessionSelection:{nonce:'second',conversation:conversation('codex','second')}});await h.flush();
  h.type('Normal prompt in the other chat');h.send();await h.flush();
  h.type('Second chat can also queue');enter(h);await h.flush();
  assert.equal(h.calls.filter(call=>call.method==='agent.queue'&&call.data.action==='enqueue').at(-1).data.threadId,'second');
  pending.resolve([fileRef(400,'delayed.txt')]);await h.flush();
  h.render({sessionSelection:{nonce:'back-to-first',conversation:conversation('codex','first')}});await h.flush();
  assert.equal(h.textarea().props.value,'Send the whole original draft once files arrive');
  assert(h.find(node=>node.props?.tooltip==='预览附件 · delayed.txt'));
  assert.equal(find(h,'agent-queue').props.disabled,false);
  assert.equal(find(h,'agent-steer').props.disabled,true);
 }finally{pending.resolve([]);h.unmount();}
});

test('in-place edit and reorder affect only unsent queued entries',async()=>{
 const h=await fixture();
 try{
  for(const text of ['First queued','Second queued','Third queued']){
   h.type(text);h.click('agent-queue');await h.flush();
  }
  h.click('agent-queued-edit');await h.flush();
  find(h,'agent-queued-editor').props.onChange({target:{value:'Edited first'}});await h.flush();
  h.click('agent-queued-save');await h.flush();
  h.click('agent-queued-down');await h.flush();
  complete(h,'first','turn-1');await h.flush();
  complete(h,'first','turn-2');await h.flush();
  complete(h,'first','turn-3');await h.flush();
  assert.deepEqual(starts(h).map(start=>start[2]),['First request','Second queued','Edited first','Third queued']);
 }finally{h.unmount();}
});

test('switching away hides the original queue while it drains in the background',async()=>{
 const h=await fixture();
 try{
  h.type('Follow up in the first chat');h.click('agent-queue');await h.flush();
  h.render({sessionSelection:{nonce:'second',conversation:conversation('codex','second')}});await h.flush();
  assert.throws(()=>find(h,'agent-follow-up-queue'));
  h.type('Unsent second draft');complete(h,'first','turn-1');await h.flush();
  assert.equal(starts(h).length,2);
  assert.equal(h.textarea().props.value,'Unsent second draft');
  h.render({sessionSelection:{nonce:'first-again',conversation:conversation('codex','first')}});await h.flush();
  assert.deepEqual(starts(h).at(-1),['codex','first','Follow up in the first chat']);
  h.render({sessionSelection:{nonce:'second-again',conversation:conversation('codex','second')}});await h.flush();
  assert.equal(h.textarea().props.value,'Unsent second draft');
 }finally{h.unmount();}
});

test('an interruption leaves queued messages paused until explicitly resumed',async()=>{
 const h=await fixture();
 try{
  h.type('Wait for permission to continue');h.click('agent-queue');await h.flush();
  h.click('agent-stop');await h.flush();
  complete(h,'first','turn-1','interrupted');await h.flush();
  assert.equal(starts(h).length,1);
  h.click('agent-resume-queue');await h.flush();
  assert.equal(starts(h).at(-1)[2],'Wait for permission to continue');
 }finally{h.unmount();}
});

test('ambiguous queued submission is preserved and is never retried automatically',async()=>{
 const h=await fixture({handle:(stage,_data,id)=>stage==='start'&&id==='turn-2'?Promise.reject(Error('Fixture connection closed')):undefined});
 try{
  h.type('Needs a receipt');h.click('agent-queue');await h.flush();
  h.type('Keep this behind it');h.click('agent-queue');await h.flush();
  complete(h,'first','turn-1');await h.flush();
  assert.equal(starts(h).length,2);
  assert.match(JSON.stringify(find(h,'agent-follow-up-queue')),/发送结果待核对/);
  assert.throws(()=>find(h,'agent-resume-queue'));
  complete(h,'first','turn-1');await h.flush();assert.equal(starts(h).length,2);
 }finally{h.unmount();}
});

test('a queued message pauses when its original send context changes',async()=>{
 const h=await fixture({props:{projectId:'original'}});
 try{
  h.type('Follow up in the original project');h.click('agent-queue');await h.flush();
  h.render({projectId:'different'});await h.flush();
  complete(h,'first','turn-1');await h.flush();
  assert.equal(starts(h).length,1);
  assert.match(JSON.stringify(find(h,'agent-follow-up-queue')),/发送环境已变化/);
  h.click('agent-resume-queue');await h.flush();
  assert.match(JSON.stringify(h.find(node=>node.props?.className==='agent-send-notice')),/Restore the original project or resource/);
  assert.equal(starts(h).length,1);
 }finally{h.unmount();}
});

test('credentials changing while a queue waits for a background chat requires explicit resumption',async()=>{
 const h=await fixture();
 try{
  h.type('Message intended for the original account');h.click('agent-queue');await h.flush();
  h.render({sessionSelection:{nonce:'second',conversation:conversation('kimi','second')}});await h.flush();
  complete(h,'first','turn-1');
  h.emit({provider:'codex',method:'studio/accountUpdated',params:{credentialsChanged:true}});await h.flush();
  h.render({sessionSelection:{nonce:'first-again',conversation:conversation('codex','first')}});await h.flush();
  assert.equal(starts(h).length,1);
  assert.match(JSON.stringify(find(h,'agent-follow-up-queue')),/发送环境已变化/);
  assert.ok(find(h,'agent-resume-queue'));
 }finally{h.unmount();}
});

test('a fast queued completion is used exactly once even when the start acknowledgement arrives later',async()=>{
 const gate=deferred();
 const h=await fixture({handle:(stage,_data,id)=>stage==='start'&&id==='turn-2'?gate.promise:undefined});
 try{
  for(const text of ['One queued follow-up','Another queued follow-up']){
   h.type(text);h.click('agent-queue');await h.flush();
  }
  complete(h,'first','turn-1');await h.flush();
  h.emit({provider:'codex',method:'turn/started',params:{threadId:'first',turn:{id:'turn-2'}}});
  complete(h,'first','turn-2');complete(h,'first','turn-2');await h.flush();
  assert.equal(starts(h).length,2);
  gate.resolve({turn:{id:'turn-2'}});await h.flush();
  assert.equal(starts(h).length,3);
  assert.equal(starts(h).at(-1)[2],'Another queued follow-up');
  complete(h,'first','turn-2');await h.flush();assert.equal(starts(h).length,3);
 }finally{h.unmount();}
});

test('failed native steering leaves the draft and makes no new turn or queued fallback',async()=>{
 const h=await fixture({handle:stage=>stage==='steer'?Promise.reject(Error('Native expected turn is no longer active')):undefined});
 try{
  h.type('Keep this text when not acknowledged');h.click('agent-steer');await h.flush();
  assert.equal(h.textarea().props.value,'Keep this text when not acknowledged');
  assert.equal(starts(h).length,1);
  assert.throws(()=>find(h,'agent-follow-up-queue'));
  assert.match(JSON.stringify(h.find(node=>node.props?.className==='agent-send-notice')),/引导结果待核对/);
 }finally{h.unmount();}
});

test('queue captures planning, workspace context and explicit skill without steering it',async()=>{
 const skill={attachmentId:'queue-skill',name:'Fixture skill',functionId:'fixture.queue'},consumed=[];
 const h=await fixture({props:{onAttachmentConsumed:id=>consumed.push(id)}});
 try{
  h.render({planningMode:true,context:'ORIGINAL_CONTEXT',skill});await h.flush();
  h.type('Follow up with a planning skill');
  assert.equal(find(h,'agent-steer').props.disabled,true);
  h.click('agent-queue');await h.flush();
  assert.equal(consumed.length,1);
  assert.throws(()=>find(h,'agent-queued-steer'));
  h.render({planningMode:false,context:'LATER_UI_CONTEXT',skill:undefined});await h.flush();
  complete(h,'first','turn-1');await h.flush();
  const queued=calls(h,'turn/start').at(-1).params;
  assert.equal(queued.planningMode,true);
  assert.equal(queued.studioSkillId,skill.functionId);
  assert.equal(queued.studioTaskId,'prepared-task');
  assert.match(queued.input[1].text,/ORIGINAL_CONTEXT/);
  assert.doesNotMatch(queued.input[1].text,/LATER_UI_CONTEXT/);
 }finally{h.unmount();}
});

test('stopping fresh workflow preparation holds the queued text and resumes without creating a second workflow',async()=>{
 const gate=deferred(),h=await fixture({handle:stage=>stage==='workflow'?gate.promise:undefined});
 try{
  h.type('Create a new workflow for this example');h.click('agent-queue');await h.flush();
  complete(h,'first','turn-1');await h.flush();
  assert.equal(h.calls.filter(call=>call.method==='task.create').length,1);
  h.click('agent-stop');await h.flush();
  assert.equal(h.textarea().props.value,'');
  gate.resolve({id:'newly-created-task'});await h.flush();
  assert.equal(starts(h).length,1);
  h.click('agent-resume-queue');await h.flush();
  assert.equal(h.calls.filter(call=>call.method==='task.create').length,1);
  assert.equal(calls(h,'turn/start').at(-1).params.studioTaskId,'newly-created-task');
  assert.equal(starts(h).at(-1)[2],'Create a new workflow for this example');
 }finally{h.unmount();}
});

test('normal queue entries survive restart only in their original chat and wait for explicit resume',async()=>{
 const storage=memoryStorage(),first=await fixture({storage});
 try{
  for(const text of ['Known unsent first','Known unsent second']){
   first.type(text);first.click('agent-queue');await first.flush();
  }
  first.type('Separate unsent draft');
 }finally{first.unmount();}
 const reopened=await fixture({storage,sendInitial:false,props:{sessionSelection:{nonce:'other',conversation:conversation('codex','other')}}});
 try{
  assert.throws(()=>find(reopened,'agent-follow-up-queue'));
  reopened.render({sessionSelection:{nonce:'return',conversation:conversation('codex','first')}});await reopened.flush();
  assert.match(JSON.stringify(find(reopened,'agent-follow-up-queue')),/Known unsent first.*Known unsent second/);
  assert.match(JSON.stringify(find(reopened,'agent-follow-up-queue')),/队列已恢复/);
  assert.equal(reopened.textarea().props.value,'Separate unsent draft');
  assert.equal(starts(reopened).length,0);
  reopened.click('agent-resume-queue');await reopened.flush();
  assert.equal(starts(reopened).at(-1)[2],'Known unsent first');
  complete(reopened,'first','turn-1');await reopened.flush();
  assert.deepEqual(starts(reopened).map(start=>start[2]),['Known unsent first','Known unsent second']);
  assert.equal(reopened.textarea().props.value,'Separate unsent draft');
 }finally{reopened.unmount();}
});

test('renderer remount reconciles a lost queue-admission reply without duplicating the saved draft',async()=>{
 const storage=memoryStorage(),gate=deferred();
 const first=await fixture({storage,handle:stage=>stage==='admission'?gate.promise:undefined});
 try{
  first.type('Persisted despite losing the admission reply');first.click('agent-queue');await first.flush();
  assert.equal(first.textarea().props.value,'Persisted despite losing the admission reply');
  assert.match(JSON.stringify(find(first,'agent-queued-message')),/Persisted despite losing the admission reply/);
 }finally{first.unmount();}
 const reopened=await fixture({storage,sendInitial:false});
 try{
  assert.equal(reopened.textarea().props.value,'');
  assert.match(JSON.stringify(find(reopened,'agent-queued-message')),/Persisted despite losing the admission reply/);
  assert.equal(starts(reopened).length,0);
  reopened.click('agent-resume-queue');await reopened.flush();
  assert.deepEqual(starts(reopened).map(start=>start[2]),['Persisted despite losing the admission reply']);
  gate.resolve();await reopened.flush();
  assert.throws(()=>find(reopened,'agent-follow-up-queue'));
 }finally{reopened.unmount();}
});

test('a rejected queue admission keeps the draft and reuses the message identity on explicit retry',async()=>{
 let rejected=false;
 const h=await fixture({handle:stage=>{
  if(stage==='before-admission'&&!rejected){rejected=true;throw Error('Original queue unavailable');}
 }});
 try{
  h.type('Keep this text until admitted');h.click('agent-queue');await h.flush();
  assert.equal(h.textarea().props.value,'Keep this text until admitted');
  assert.throws(()=>find(h,'agent-follow-up-queue'));
  h.click('agent-queue');await h.flush();
  const requests=h.calls.filter(call=>call.method==='agent.queue'&&call.data.action==='enqueue');
  assert.equal(requests.length,2);assert.equal(requests[0].data.item.id,requests[1].data.item.id);
  assert.equal(h.textarea().props.value,'');
  assert.match(JSON.stringify(find(h,'agent-queued-message')),/Keep this text until admitted/);
 }finally{h.unmount();}
});

test('legacy renderer queues import into the saved origin once and retain unconfirmed delivery',async()=>{
 const storage=memoryStorage();
 const legacy=(id,text)=>({id,text,planningMode:false,newWorkflow:false,context:''});
 storage.setItem('studio.follow-up-queues.v1',JSON.stringify({version:1,queues:[
  {provider:'codex',threadId:'first',items:[{...legacy('old-first-id','Old ambiguous delivery'),unconfirmed:true},legacy('old-next-id','Old pending draft')]},
  {provider:'codex',threadId:'other',items:[legacy('old-other-id','Other origin stays in its queue')]},
 ]}));
 const h=await fixture({storage,sendInitial:false});
 try{
  assert.match(JSON.stringify(find(h,'agent-follow-up-queue')),/Old ambiguous delivery.*Old pending draft/);
  assert.throws(()=>find(h,'agent-resume-queue'));
  assert.equal(starts(h).length,0);
  assert.deepEqual(JSON.parse(storage.getItem('studio.follow-up-queues.v1')).queues.map(row=>row.threadId),['other']);
 }finally{h.unmount();}
 const reopened=await fixture({storage,sendInitial:false});
 try{
  assert.match(JSON.stringify(find(reopened,'agent-follow-up-queue')),/待发送消息.*2/);
  assert.equal(reopened.calls.some(call=>call.method==='agent.queue'&&call.data.action==='import'),false);
 }finally{reopened.unmount();}
});

for(const pending of ['start','steer']){
 test('a pending '+pending+' survives restart as unconfirmed and cannot be silently resubmitted',async()=>{
  const storage=memoryStorage(),gate=deferred();
  const first=await fixture({storage,handle:(stage,_data,id)=>stage===pending&&(stage==='steer'||id==='turn-2')?gate.promise:undefined});
  try{
   for(const text of ['Check this delivery first','Known unsent behind it']){
    first.type(text);first.click('agent-queue');await first.flush();
   }
   if(pending==='start')complete(first,'first','turn-1');else first.click('agent-queued-steer');
   await first.flush();
  }finally{first.unmount();}
  const reopened=await fixture({storage,sendInitial:false});
  try{
   assert.match(JSON.stringify(find(reopened,'agent-queued-message')),/Check this delivery first.*发送结果待核对/);
   assert.throws(()=>find(reopened,'agent-resume-queue'));
   assert.equal(starts(reopened).length,0);
   reopened.click('agent-queued-remove');await reopened.flush();
   reopened.click('agent-resume-queue');await reopened.flush();
   assert.deepEqual(starts(reopened).map(start=>start[2]),['Known unsent behind it']);
   gate.resolve(pending==='start'?{turn:{id:'turn-2'}}:{turnId:'turn-1'});
   await reopened.flush();
   assert.throws(()=>find(reopened,'agent-follow-up-queue'));
  }finally{reopened.unmount();}
  const fresh=await fixture({storage,sendInitial:false});
  try{assert.throws(()=>find(fresh,'agent-follow-up-queue'));}finally{fresh.unmount();}
 });
}

test('Enter preference persists and Ctrl or Cmd runs the alternate action',async()=>{
 const storage=memoryStorage(),first=await fixture({storage});
 try{
  assert.match(JSON.stringify(find(first,'agent-follow-up-shortcuts')),/Ctrl\/Cmd\+Enter 引导/);
  first.type('Steer with alternate shortcut');enter(first,{ctrlKey:true});await first.flush();
  assert.equal(calls(first,'turn/steer')[0].params.input[0].text,'Steer with alternate shortcut');
  await chooseEnter(first,'steer');
  assert.match(JSON.stringify(find(first,'agent-follow-up-shortcuts')),/Ctrl\/Cmd\+Enter 排队/);
  first.type('Default Enter now steers');enter(first,{shiftKey:true});enter(first,{nativeEvent:{isComposing:true}});
  assert.equal(calls(first,'turn/steer').length,1);
  enter(first);await first.flush();
  assert.equal(calls(first,'turn/steer').at(-1).params.input[0].text,'Default Enter now steers');
  first.type('Alternate now queues');enter(first,{metaKey:true});await first.flush();
  assert.match(JSON.stringify(find(first,'agent-queued-message')),/Alternate now queues/);
 }finally{first.unmount();}
 const reopened=await fixture({storage,sendInitial:false});
 try{
  reopened.click('agent-options');await reopened.flush();
  assert.equal(find(reopened,'agent-follow-up-enter-mode').props.value,'steer');
 }finally{reopened.unmount();}
});

for(const unsupported of ['kimi','skill']){
 test('Steer Enter preference queues explicitly for '+unsupported,async()=>{
  const h=await fixture({provider:unsupported==='kimi'?'kimi':'codex'});
  try{
   await chooseEnter(h,'steer');
   if(unsupported==='skill'){h.render({skill:{attachmentId:'fixture-skill',name:'Fixture skill',functionId:'fixture.skill'}});await h.flush();}
   h.type('Send when this turn finishes');enter(h);await h.flush();
   assert.deepEqual(calls(h,'turn/steer'),[]);
   assert.match(JSON.stringify(find(h,'agent-follow-up-shortcuts')),/Enter 排队 · Shift\+Enter/);
   assert.match(JSON.stringify(find(h,'agent-queued-message')),/Send when this turn finishes/);
  }finally{h.unmount();}
 });
}

test('the steer shortcut racing an already completed reply keeps the draft and does not start another turn',async()=>{
 const h=await fixture();
 try{
  await chooseEnter(h,'steer');
  h.type('Hold on to this draft');
  const keyDown=h.textarea().props.onKeyDown;
  complete(h,'first','turn-1');
  keyDown({key:'Enter',nativeEvent:{},preventDefault(){}});
  await h.flush();
  assert.deepEqual(calls(h,'turn/steer'),[]);
  assert.equal(starts(h).length,1);
  assert.equal(h.textarea().props.value,'Hold on to this draft');
  assert.match(JSON.stringify(h.find(node=>node.props?.className==='agent-send-notice')),/当前回复无法接收引导/);
 }finally{h.unmount();}
});
