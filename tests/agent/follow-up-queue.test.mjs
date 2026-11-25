import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {desktopFollowUpQueue} from '../../desktop/platform/follow-up-queue.mjs';

const deferred=()=>{
 let resolve,reject;
 const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
};
const tick=async()=>{for(let index=0;index<4;index++)await new Promise(resolve=>setImmediate(resolve));};
const text=(id,body,extra={})=>({id:'message-'+id,text:body,planningMode:false,newWorkflow:false,...extra});
const key=(provider,thread)=>provider+':'+thread;

function fixture(t){
 const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'studio-queue-'));
 assert.equal(path.dirname(root),parent);
 const databases=[];
 t.after(()=>{for(const item of databases)item.db.close();fs.rmSync(root,{recursive:true,force:true});});
 const calls=[],events=[],scope=new AsyncLocalStorage();
 const resources=new Map([['codex:A',{target:'resource-A'}],['codex:B',{target:'resource-B'}],['deepseek:A',{target:'resource-C'}]]);
 const nativeHistory=new Map(),gates=new Map(),pending=[],states=new Map();
 let foreground={provider:'codex',threadId:'A'},queue;
 function open(){
  const catalog=new Catalog(root);databases.push(catalog);
  const records={
   conversation:(provider,threadId)=>catalog.get('conversation',key(provider,threadId)),
   deleted:(provider,threadId)=>!!catalog.get('retired-conversation-context',key(provider,threadId)),
  };
  for(const owner of resources.keys()){
   const [provider,threadId]=owner.split(':');
   if(!records.deleted(provider,threadId)&&!records.conversation(provider,threadId))catalog.put('conversation',owner,{id:owner,provider,threadId,projectId:'project-'+owner});
  }
  const agents={
   activeTurn:(provider,threadId)=>states.get(key(provider,threadId))??null,
   isBusy:(provider,threadId)=>states.has(key(provider,threadId)),
   runInConversation(provider,threadId,operation,{claimTurn}={}){
    assert.equal(scope.getStore(),undefined,'a queue pump may not inherit the predecessor turn scope');
    if(claimTurn)assert.equal(states.has(key(provider,threadId)),false);
    return scope.run({provider,threadId},operation);
   }
  };
  queue=desktopFollowUpQueue({
   catalog,agents,records,worker:{},workflowContext:{current:()=>scope.getStore()??foreground},
   resourceRouting:{followUpBinding:(provider,threadId)=>({selection:null,binding:resources.get(key(provider,threadId))})},
   publish:event=>events.push(event),
   validateFiles:(_owner,files)=>structuredClone(files),
   request:async(request,{queued}={})=>{
    const {provider,method,params}=request,owner=key(provider,params.threadId);
    if(method==='thread/read')return {thread:{id:params.threadId,turns:nativeHistory.get(owner)??[]}};
    if(method==='turn/interrupt'){calls.push(request);return {};}
    assert.deepEqual(scope.getStore(),{provider,threadId:params.threadId});
    const gate=gates.get(params.clientUserMessageId);
    if(gate?.before)await gate.before.promise;
    queued.beforeDispatch();
    calls.push({...request,foreground:{...foreground},binding:resources.get(owner)});
    const turnId='turn-'+calls.length;
    states.set(owner,turnId);
    queue.observe({provider,method:'turn/started',params:{threadId:params.threadId,turn:{id:turnId}}});
    if(gate?.after)await gate.after.promise;
    queued.accepted(turnId);
    return {turn:{id:turnId}};
   },
  });
  if(pending.length)pending.push(queue);else pending[0]=queue;
  queue.recover();
  return queue;
 }
 function observe(provider,threadId,turnId,status='completed'){
  if(states.get(key(provider,threadId))===turnId)states.delete(key(provider,threadId));
  scope.run({provider,threadId},()=>queue.observe({provider,method:'turn/completed',params:{threadId,turn:{id:turnId,status}}}));
 }
 function commitReplacement({reason='explicit-missing-history-recovery',projectId='project-codex:A',provider='codex'}={}){
  const catalog=databases.at(-1);
  catalog.transaction(()=>{
   catalog.put('conversation','codex:B',{id:'codex:B',provider:'codex',threadId:'B',projectId});
   catalog.put('retired-conversation-context','codex:A',{provider,threadId:'A',replacementThreadId:'B',projectId:'project-codex:A',taskId:null,reason,uploadsRetained:true});
   catalog.remove('conversation','codex:A');
  });
 }
 const request=(action,extra={},provider='codex',threadId='A')=>queue.request({provider,threadId,action,...extra});
 open();
 t.after(()=>{for(const controller of pending)controller.close();});
 return {calls,events,states,resources,nativeHistory,gates,commitReplacement,
  enqueue:(item,after='original',provider='codex',threadId='A')=>request('enqueue',{item,after},provider,threadId),
  request,observe,open,close:()=>queue.close(),start:(provider,threadId,turnId)=>states.set(key(provider,threadId),turnId),
  replace:(uploadsRetained)=>queue.observe({provider:'codex',method:'studio/conversationContextChanged',params:{oldThreadId:'A',threadId:'B',uploadsRetained}}),
  select:(provider,threadId)=>{foreground={provider,threadId};},
 };
}

test('the original conversation drains in the background in order, after exact terminal receipts only',async t=>{
 const f=fixture(t);
 f.start('codex','A','original');
 await f.enqueue(text('one','first'));
 await f.enqueue(text('two','second'));
 await f.enqueue(text('three','third'));
 f.select('codex','B');
 await f.request('move',{id:'message-three',direction:'up'});
 await f.request('edit',{id:'message-two',text:'edited second'});
 f.observe('deepseek','A','original');
 f.observe('codex','B','original');f.observe('codex','A','other');await tick();
 assert.equal(f.calls.length,0);
 f.observe('codex','A','original');await tick();
 assert.equal(f.calls.length,1);
 await assert.rejects(f.request('move',{id:'message-two',direction:'down'}),/unsent/);
 f.observe('codex','A','original');await tick();assert.equal(f.calls.length,1);
 f.observe('codex','A','turn-1');await tick();
 f.observe('codex','A','turn-2');await tick();
 assert.deepEqual(f.calls.map(call=>[call.provider,call.params.threadId,call.params.input[0].text,call.foreground.threadId,call.binding.target]),[
  ['codex','A','first','B','resource-A'],['codex','A','third','B','resource-A'],['codex','A','edited second','B','resource-A']
 ]);
 assert.deepEqual((await f.request('read',{},'codex','B')).queue.items,[]);
 await f.enqueue(text('one','retry with the same durable id'));await tick();
 assert.equal(f.calls.length,3);
});

test('SQLite reopen retains admitted order, marks outstanding provider calls uncertain and reconciles only exact IDs',async t=>{
 const f=fixture(t);
 f.start('codex','A','original');
 await f.enqueue(text('one','first'));await f.enqueue(text('two','second'));await f.enqueue(text('three','third'));
 f.close();f.states.clear();f.open();await tick();
 let queue=(await f.request('read')).queue;
 assert.equal(queue.pause,'restored');assert.deepEqual(queue.items.map(item=>item.text),['first','second','third']);assert.equal(f.calls.length,0);
 const gate=deferred();f.gates.set('message-one',{after:gate});
 await f.request('resume');await tick();assert.equal(f.calls.length,1);
 f.close();f.states.clear();f.open();await tick();
 queue=(await f.request('read')).queue;
 assert.equal(queue.items[0].status,'unconfirmed');
 await assert.rejects(f.request('resume'),/unconfirmed/);
 f.nativeHistory.set('codex:A',[{id:'similar',status:'completed',items:[{type:'userMessage',id:'different-id',content:[{type:'text',text:'first'}]}]}]);
 assert.equal((await f.request('reconcile',{id:'message-one'})).turnId,undefined);
 f.nativeHistory.set('codex:A',[{id:'actual',status:'completed',items:[{type:'userMessage',clientId:'message-one'}]}]);
 assert.equal((await f.request('reconcile',{id:'message-one'})).turnId,'actual');
 assert.deepEqual((await f.request('read')).queue.items.map(item=>item.text),['second','third']);
 gate.resolve();await tick();
 f.close();f.states.clear();f.open();await tick();
 assert.deepEqual((await f.request('read')).queue.items.map(item=>item.text),['second','third']);
 await f.request('resume');await tick();
 assert.deepEqual(f.calls.map(call=>call.params.clientUserMessageId),['message-one','message-two']);
});

test('changed original route and explicit stop preserve the remaining queue without sending',async t=>{
 const f=fixture(t);
 f.start('codex','A','original');
 await f.enqueue(text('one','first'));await f.enqueue(text('two','second'));
 f.resources.set('codex:A',{target:'changed-resource'});
 f.observe('codex','A','original');await tick();
 assert.equal((await f.request('read')).queue.pause,'changed');assert.equal(f.calls.length,0);
 await assert.rejects(f.request('resume'),/Restore the original/);
 f.resources.set('codex:A',{target:'resource-A'});
 const gate=deferred();f.gates.set('message-one',{before:gate});
 await f.request('resume');await tick();
 assert.equal((await f.request('read')).queue.items[0].status,'preparing');
 await f.request('pause',{stop:true});gate.resolve();await tick();
 const queue=(await f.request('read')).queue;
 assert.equal(queue.pause,'stopped');assert.deepEqual(queue.items.map(item=>item.text),['first','second']);assert.equal(f.calls.length,0);
});

test('opaque attachment references and captured model preferences follow only the queued original turn',async t=>{
 const f=fixture(t);
 const ref={id:'fixture-file',name:'window.log',kind:'text',mimeType:'text/plain',size:12};
 f.start('codex','A','original');
 await f.enqueue(text('file','Read the clipped file',{files:[ref],model:'original-model',effort:'max',skill:{name:'fixture skill',functionId:'fixture.skill'}}));
 let queue=(await f.request('read')).queue;
 assert.deepEqual(queue.items[0].files,[ref]);assert.equal(queue.items[0].steerable,false);
 await assert.rejects(f.request('steer',{id:'message-file',turnId:'original'}),/cannot receive/);
 await f.request('edit',{id:'message-file',text:'Read the clipped file, please'});
 f.select('codex','B');f.observe('codex','A','original');await tick();
 assert.deepEqual(f.calls[0].params.studioAttachments,[ref.id]);
 assert.equal(f.calls[0].params.model,'original-model');assert.equal(f.calls[0].params.effort,'max');assert.equal(f.calls[0].params.studioSkillId,'fixture.skill');
 assert.equal(f.calls[0].params.input[0].text,'Read the clipped file, please');
 queue=(await f.request('read')).queue;assert.deepEqual(queue.items,[]);
});

for(const uploadsRetained of [true,false])test('replacement leaves queued work paused and keeps only authorized upload refs, uploads='+uploadsRetained,async t=>{
 const f=fixture(t),upload={id:'fixture-upload',name:'notes.txt',kind:'text',mimeType:'text/plain',size:12};
 const evidence={...upload,id:'fixture-evidence',name:'window.log',source:{kind:'log',label:'window.log',firstLine:1,lastLine:1,revision:'a'.repeat(64)}};
 f.start('codex','A','original');
 await f.enqueue(text('both','Read the selected sources',{files:[upload,evidence]}));
 f.replace(uploadsRetained);
 const queue=(await f.request('read',{},'codex','B')).queue;
 assert.equal(queue.pause,'changed');
 assert.deepEqual(queue.items,[{id:'message-both',text:'Read the selected sources',...(uploadsRetained?{files:[upload]}:{}),attachmentReview:true,status:'queued',steerable:false}]);
 assert.deepEqual((await f.request('read')).queue.items,[]);
 await assert.rejects(f.request('resume',{},'codex','B'),/Restore the original/);
 await tick();assert.deepEqual(f.calls,[]);
});

test('restart reconciles a committed replacement before it was announced, with no uncertain replay',async t=>{
 const f=fixture(t),upload={id:'fixture-upload',name:'notes.txt',kind:'text',mimeType:'text/plain',size:12};
 f.start('codex','A','original');
 await f.enqueue(text('one','uncertain first',{files:[upload]}));
 await f.enqueue(text('two','still waiting'));
 const receipt=deferred();f.gates.set('message-one',{after:receipt});
 f.observe('codex','A','original');await tick();
 assert.equal((await f.request('read')).queue.items[0].status,'submitting');
 f.commitReplacement();
 for(let restart=0;restart<2;restart++){
  f.close();f.states.clear();f.open();await tick();
  const recovered=(await f.request('read',{},'codex','B')).queue;
  assert.deepEqual(recovered.items.map(item=>[item.id,item.status]),[['message-one','unconfirmed'],['message-two','queued']]);
  assert.deepEqual(recovered.items[0].files,[upload]);
  assert.equal(recovered.pause,'unconfirmed');
  assert.deepEqual((await f.request('read')).queue.items,[]);
  await assert.rejects(f.request('resume',{},'codex','B'),/unconfirmed/);
  assert.equal(f.calls.length,1);
 }
 receipt.resolve();await tick();assert.equal(f.calls.length,1);
});

for(const foreign of [{reason:'private-definition'},{projectId:'other-project'},{provider:'deepseek'}])test('restart never applies an unrelated replacement receipt '+JSON.stringify(foreign),async t=>{
 const f=fixture(t);
 f.start('codex','A','original');
 await f.enqueue(text('one','original scope'));
 f.commitReplacement(foreign);f.close();f.states.clear();f.open();await tick();
 assert.deepEqual((await f.request('read',{},'codex','B')).queue.items,[]);
 assert.deepEqual((await f.request('read')).queue.items.map(item=>item.id),['message-one']);
 assert.deepEqual(f.calls,[]);
});

test('a file-only queue item stays blank through editing and materializes its prompt at dispatch',async t=>{
 const f=fixture(t),ref={id:'fixture-only-file',name:'only-file.png',kind:'image',mimeType:'image/png',size:12};
 f.start('codex','A','original');
 await assert.rejects(f.enqueue(text('empty','')),/Invalid queued message/);
 await f.enqueue(text('file-only','',{files:[ref]}));
 await f.request('edit',{id:'message-file-only',text:'caption'});
 await f.request('edit',{id:'message-file-only',text:''});
 assert.equal((await f.request('read')).queue.items[0].text,'');
 f.select('codex','B');f.observe('codex','A','original');await tick();
 assert.deepEqual(f.calls[0].params.studioAttachments,[ref.id]);
 assert.equal(f.calls[0].params.input[0].text,'请查看附件：only-file.png');
});

test('studio/conversationDeleted cancels active in-flight queue delivery, clears isBusy, and purges stored queue',async t=>{
 const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'studio-queue-del-'));
 const catalog=new Catalog(root);
 t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});
 const gate=deferred(),events=[];
 catalog.put('conversation','codex:A',{id:'codex:A',provider:'codex',threadId:'A',projectId:null});
 const busyProviders=new Set();
 let activeTurnId='original';
 const queue=desktopFollowUpQueue({
  catalog,
  agents:{
   activeTurn:(provider,threadId)=>provider==='codex'&&threadId==='A'?activeTurnId:null,
   isBusy:(provider,threadId)=>busyProviders.has(key(provider,threadId)),
   runInConversation:(_provider,_threadId,operation)=>operation(),
  },
  records:{
   conversation:(provider,threadId)=>catalog.get('conversation',key(provider,threadId)),
   deleted:(provider,threadId)=>!!catalog.get('retired-conversation-context',key(provider,threadId)),
  },
  worker:{},
  workflowContext:{current:()=>({provider:'codex',threadId:'A'})},
  resourceRouting:{followUpBinding:()=>({selection:null,binding:null})},
  publish:event=>events.push(event),
  validateFiles:(_owner,files)=>structuredClone(files),
  request:async(request,{queued}={})=>{
   if(request.method==='thread/read')return {thread:{id:request.params.threadId,turns:[]}};
   queued.beforeDispatch();
   busyProviders.add('codex:A');
   await gate.promise;
   queued.accepted('turn-after-delete');
   return {turn:{id:'turn-after-delete'}};
  },
 });
 t.after(()=>queue.close());
 queue.recover();
 busyProviders.add('codex:A');
 await queue.request({provider:'codex',threadId:'A',action:'enqueue',item:text('one','first'),after:'original'});
 await queue.request({provider:'codex',threadId:'A',action:'enqueue',item:text('two','second'),after:'original'});
 activeTurnId=null;
 busyProviders.delete('codex:A');
 queue.observe({provider:'codex',method:'turn/completed',params:{threadId:'A',turn:{id:'original',status:'completed'}}});
 await tick();
 assert.equal(queue.isBusy('codex','A'),true);
 events.length=0;
 queue.observe({provider:'codex',method:'studio/conversationDeleted',params:{threadId:'A'}});
 assert.equal(catalog.get('conversation-follow-up-queue','codex:A'),null);
 gate.resolve();
 await tick();
 assert.equal(queue.isBusy('codex','A'),false);
 assert.deepEqual(events.filter(event=>event.method==='studio/followUpQueue'&&event.params.threadId==='A'&&event.params.items?.length>0),[]);
});
