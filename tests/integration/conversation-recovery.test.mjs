import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Catalog} from "../../backend/main/workspace/catalog.mjs";
import {AgentHub} from "../../agent/providers/agent-hub.mjs";
import {TaskRecords} from "../../agent/sessions/task-records.mjs";
import {createAgentWorkflowContext} from "../../agent/sessions/workflow-context.mjs";
import {resumeConversationContext} from "../../agent/sessions/conversation-recovery.mjs";
import {createChatAttachments} from '../../agent/sessions/chat-attachments.mjs';

function fixture(t,{state='empty',withTask=true}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-conversation-recovery-')),catalog=new Catalog(root),events=[],calls=[];
 t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});
 const records=new TaskRecords(catalog,event=>events.push(event));records.remember({provider:'codex',threadId:'old',projectId:'project',name:'Original workflow'});
 const attachments=createChatAttachments({catalog,deleted:(...owner)=>records.deleted(...owner)});
 let task;if(withTask){task=records.create({provider:'codex',threadId:'old',planningMode:true,request:'Original workflow',projectId:'project'});task.parameters={temperature:300};task.artifacts=[{id:'existing-run',kind:'run'}];task.authoring={projectId:'authoring',environmentId:'env',inputRoot:'/owned/inputs'};task.review={status:'ready',revision:1};task=records.save(task);}
 catalog.put('settings','main',{preserve:'settings'});catalog.put('ssh','private',{preserve:'connection'});catalog.put('thread','old',{id:'old',turns:[],preview:'original metadata'});
 if(state)catalog.put('codex-thread-lifecycle','old',{id:'old',state});
 const codex=new EventEmitter();codex.process={};codex.activeTurns=new Set();let next=0;
 codex.close=()=>{codex.process=null;};codex.start=async()=>{codex.process={};};
 const f={catalog,records,events,calls,codex,task,attachments};
 codex.request=async(method,params)=>{calls.push({method,params});if(f.request)return f.request(method,params);if(method==='thread/resume')throw Error('no rollout found for thread');if(method==='thread/start')return {thread:{id:'fresh-'+(++next),turns:[]},model:'actual-model',reasoningEffort:'low'};return {};};
 const hub=new AgentHub({codex,catalog,root,settings:()=>({}),worker:()=>null,bindWorkerContext:()=>({rotated:false})});
 const workflowContext=createAgentWorkflowContext({records,activeTasks:new Map(),selectedProvider:()=> 'codex'});
 const begin=async()=>{const ticket=workflowContext.begin('codex','old');await workflowContext.synchronize(ticket,(provider,context)=>hub.selectContext(provider,context));return ticket;};
 Object.assign(f,{hub,workflowContext,begin,recover:async(extra={})=>resumeConversationContext({records,workflowContext,agents:hub,attachments,ticket:await begin(),threadId:'old',...extra})});return f;
}

test('verified empty recovery keeps the same workflow, scientific review, assets and protected records',async t=>{
 const f=fixture(t),before=f.records.read(f.task.id),conversation=f.records.conversation('codex','old');
 const {ticket,result}=await f.recover();assert.equal(result.thread.id,'fresh-1');assert.equal(result.studioRecovery.status,'recovered');f.workflowContext.assert(ticket);
 const after=f.records.read(before.id);assert.equal(after.threadId,'fresh-1');for(const key of Object.keys(before).filter(k=>!['threadId','updatedAt'].includes(k)))assert.deepEqual(after[key],before[key],key);
 assert.equal(f.records.conversations().length,1);assert.equal(f.records.conversations()[0].name,conversation.name);assert.equal(f.records.conversations()[0].taskId,before.id);
 assert.deepEqual(f.catalog.get('ssh','private'),{preserve:'connection'});assert.deepEqual(f.catalog.get('settings','main'),{preserve:'settings'});
 assert.equal(f.catalog.get('conversation-context-history','codex:old').thread.preview,'original metadata');assert.equal(f.records.deleted('codex','old'),true);
 assert.equal(f.hub.codexThreadState('fresh-1').state,'empty');assert.deepEqual(f.calls.map(c=>c.method),['thread/resume','thread/start']);
 assert.equal(f.events.filter(e=>e.method==='studio/conversationContextChanged').length,1);assert.equal(f.workflowContext.current().taskId,before.id);
});
for(const state of [null,'unknown','pending','has_turns'])test('missing '+state+' history is not silently replaced',async t=>{
 const f=fixture(t,{state}),before=f.records.read(f.task.id),result=await f.recover();assert.equal(result.result.studioRecovery.status,'required');assert.equal(f.calls.length,1);assert.deepEqual(f.records.read(before.id),before);assert.equal(f.records.deleted('codex','old'),false);
});
test('explicit recovery archives unavailable history and creates only a native empty connection',async t=>{
 const f=fixture(t,{state:'has_turns',withTask:false});f.catalog.put('thread','old',{id:'old',turns:[{id:'stored-local-history'}]});
 const {result}=await f.recover({explicit:true});assert.equal(result.thread.id,'fresh-1');assert.equal(f.records.conversations()[0].projectId,'project');assert.equal(f.records.tasks().length,0);assert.equal(f.catalog.get('conversation-context-history','codex:old').thread.turns[0].id,'stored-local-history');
 assert.equal(f.calls.some(c=>c.method==='turn/start'),false);assert.equal(f.catalog.get('retired-conversation-context','codex:old').reason,'explicit-missing-history-recovery');
});
test('same-scope recovery permits original upload IDs without rebinding historical scientific evidence',async t=>{
 const f=fixture(t),old={provider:'codex',threadId:'old'},fresh={...old,threadId:'fresh-1'};
 const upload={name:'notes.txt',size:14,text:'fixture notes\n',mimeType:'text/plain'};
 const [file]=f.attachments.stage({...old,files:[upload]});
 const [evidence]=f.attachments.stage({...old,files:[{...upload,name:'window.log'}]},
  {kind:'log',label:'window.log',firstLine:3,lastLine:3,revision:'a'.repeat(64),runId:'run'});
 const result=await f.recover();
 assert.equal(result.result.studioRecovery.uploadsRetained,true);
 assert.equal(f.events.find(event=>event.method==='studio/conversationContextChanged').params.uploadsRetained,true);
 assert.deepEqual(f.catalog.get('retired-conversation-context','codex:old'),{
  provider:'codex',threadId:'old',taskId:f.task.id,projectId:'project',replacementThreadId:'fresh-1',reason:'verified-empty-recovery',uploadsRetained:true,
 });
 assert.deepEqual(f.attachments.refsFor(fresh,[file.id]),[file]);
 assert.equal(f.attachments.preview({...fresh,id:file.id}).text,upload.text);
 assert.throws(()=>f.attachments.preview({...fresh,id:evidence.id}),/原对话/);
 assert.throws(()=>f.attachments.preview({...fresh,id:file.id,threadId:'unrelated'}),/原对话/);
 assert.throws(()=>f.attachments.preview({...fresh,id:file.id,provider:'deepseek'}),/原对话/);
 const original=f.catalog.db.prepare('SELECT owner_key,metadata FROM chat_attachments WHERE id=?');
 assert.equal(original.get(file.id).owner_key,'old');
 assert.deepEqual(JSON.parse(original.get(evidence.id).metadata),evidence);
 const reopened=createChatAttachments({catalog:f.catalog,deleted:(...owner)=>f.records.deleted(...owner)});
 assert.deepEqual(reopened.refsFor(fresh,[file.id]),[file]);
 assert.throws(()=>reopened.preview({...old,id:file.id}),/已删除/);
});
test('available real history wins over an old empty marker',async t=>{
 const f=fixture(t);f.request=async()=>({thread:{id:'old',turns:[{id:'real-turn'}]}});const r=await f.recover();assert.equal(r.result.thread.id,'old');assert.equal(r.result.studioRecovery,undefined);assert.equal(f.hub.codexThreadState('old').state,'has_turns');assert.equal(f.calls.length,1);
});
test('empty-thread recovery retains its actual recorded model unless the user explicitly selects another',async t=>{
 for(const model of [undefined,'new-choice']){const f=fixture(t);f.catalog.put('codex-thread-lifecycle','old',{id:'old',state:'empty',model:'original-choice'});await f.recover({model});assert.equal(f.calls.find(c=>c.method==='thread/start').params.model,model||'original-choice');}
});
test('a normal native error never triggers replacement',async t=>{
 const f=fixture(t);f.request=async()=>{throw Error('temporary timeout');};await assert.rejects(f.recover(),/temporary timeout/);assert.equal(f.calls.length,1);assert.equal(f.records.deleted('codex','old'),false);
});
test('a mismatched native resume response cannot change the selected workflow',async t=>{
 const f=fixture(t);f.request=async()=>({thread:{id:'foreign',turns:[]}});await assert.rejects(f.recover(),/different conversation/);assert.equal(f.calls.length,1);assert.equal(f.records.read(f.task.id).threadId,'old');
});
test('failed native start preserves the original local task and does not retry',async t=>{
 const f=fixture(t),before=f.records.read(f.task.id);f.request=async method=>{throw Error(method==='thread/resume'?'no rollout found for thread':'start rejected');};await assert.rejects(f.recover(),/start rejected/);assert.deepEqual(f.records.read(before.id),before);assert.equal(f.records.deleted('codex','old'),false);assert.equal(f.calls.filter(c=>c.method==='thread/start').length,1);
});
test('concurrent input edits invalidate recovery without overwriting the newer workflow',async t=>{
 const f=fixture(t);f.request=async method=>{if(method==='thread/resume')throw Error('no rollout found for thread');const task=f.records.read(f.task.id);task.parameters.temperature=350;f.records.save(task);return {thread:{id:'fresh',turns:[]}};};await assert.rejects(f.recover(),/changed/);assert.equal(f.records.read(f.task.id).parameters.temperature,350);assert.equal(f.records.read(f.task.id).threadId,'old');assert.equal(f.records.deleted('codex','old'),false);
});
test('a new user selection invalidates a late native recovery without clearing the new selection',async t=>{
 const f=fixture(t);f.request=async method=>{if(method==='thread/resume')throw Error('no rollout found for thread');f.workflowContext.begin('codex','newer');return {thread:{id:'fresh',turns:[]}};};await assert.rejects(f.recover(),/changed/);assert.equal(f.workflowContext.current().threadId,'newer');assert.equal(f.records.read(f.task.id).threadId,'old');
});
test('transaction failure rolls back both conversation and workflow ownership',async t=>{
 const f=fixture(t),owner={provider:'codex',threadId:'old'};
 const [file]=f.attachments.stage({...owner,files:[{name:'notes.txt',size:4,text:'text',mimeType:'text/plain'}]});
 const put=f.catalog.put.bind(f.catalog);f.catalog.put=(kind,...args)=>{if(kind==='retired-conversation-context')throw Error('disk full');return put(kind,...args);};await assert.rejects(f.recover(),/disk full/);assert.equal(f.records.read(f.task.id).threadId,'old');assert.equal(f.records.deleted('codex','old'),false);assert.equal(f.catalog.get('conversation-context-history','codex:old'),null);
 assert.deepEqual(f.attachments.refsFor(owner,[file.id]),[file]);
 assert.throws(()=>f.attachments.refsFor({...owner,threadId:'fresh-1'},[file.id]),/原对话/);
});
for(const phase of ['validating','submitting','unknown'])test('execution '+phase+' cannot be bypassed by chat recovery',async t=>{
 const f=fixture(t),task=f.records.read(f.task.id);task.execution={phase};f.records.save(task);await assert.rejects(f.recover({explicit:true}),/Reconcile/);assert.equal(f.calls.some(c=>c.method==='thread/start'),false);
});
test('native response must explicitly prove a different empty thread',async t=>{
 for(const thread of [{id:'old',turns:[]},{id:'fresh'},{id:'fresh',turns:[{id:'not-empty'}]}]){
  const f=fixture(t);f.request=async method=>{if(method==='thread/resume')throw Error('no rollout found for thread');return {thread};};await assert.rejects(f.recover(),/verified fresh empty/);assert.equal(f.records.read(f.task.id).threadId,'old');
 }
});
test('fresh recovery keeps private-CV consent and only carries forward an already matching definition marker',async t=>{
 for(const matching of [true,false]){
  const f=fixture(t),task=f.records.read(f.task.id);task.customCv={id:'private',specSha:'spec',parametersSha:'params',codeSha:'code',sharing:{codex:false},numericalStatus:'not_run'};task.privateDefinitionContext={provider:'codex',threadId:'old',taskId:task.id,entryId:'private',specSha:matching?'spec':'older',parametersSha:'params',codeSha:'code'};f.records.save(task);
  await f.recover();const after=f.records.read(task.id);assert.deepEqual(after.customCv,task.customCv);assert.equal(after.privateDefinitionContext.threadId,matching?'fresh-1':'old');for(const key of ['provider','taskId','entryId','specSha','parametersSha','codeSha'])assert.equal(after.privateDefinitionContext[key],task.privateDefinitionContext[key]);assert.equal(f.calls.some(c=>c.method==='turn/start'),false);
 }
});
test('first-turn transport uncertainty persists across Hub instances and forbids automatic recovery',async t=>{
 const f=fixture(t);f.request=async method=>{if(method==='thread/start')return {thread:{id:'old',turns:[]}};throw Error('connection lost');};
 f.hub.contexts.clear();await f.hub.rpc('codex','thread/start');await assert.rejects(f.hub.rpc('codex','turn/start',{threadId:'old',input:[]}),/connection lost/);assert.equal(f.catalog.get('codex-thread-lifecycle','old').state,'unknown');
 const reopened=new AgentHub({codex:f.codex,catalog:f.catalog,settings:()=>({}),worker:()=>null});assert.equal(reopened.codexThreadState('old').state,'unknown');assert.equal(f.hub.pendingTurnDispatches.size,0);
});
test('an explicit first-turn rejection retains durable proof of no accepted turn',async t=>{
 const f=fixture(t);f.request=async method=>{if(method==='thread/start')return {thread:{id:'old',turns:[]}};throw Object.assign(Error('rejected'),{rpcResponse:true});};f.hub.contexts.clear();await f.hub.rpc('codex','thread/start');await assert.rejects(f.hub.rpc('codex','turn/start',{threadId:'old',input:[]}),/rejected/);assert.equal(f.hub.codexThreadState('old').state,'empty');
});
test('observed turn-started prevents an error response from restoring empty evidence',async t=>{
 const f=fixture(t);f.request=async method=>{if(method==='thread/start')return {thread:{id:'old',turns:[]}};f.codex.emit('event',{method:'turn/started',params:{threadId:'old',turn:{id:'accepted'}}});throw Object.assign(Error('late rejection'),{rpcResponse:true});};f.hub.contexts.clear();await f.hub.rpc('codex','thread/start');await assert.rejects(f.hub.rpc('codex','turn/start',{threadId:'old',input:[]}),/late rejection/);assert.equal(f.hub.codexThreadState('old').state,'has_turns');
});
test('model catalog is readable even when the selected old thread has no rollout',async t=>{
 const f=fixture(t);await f.begin();f.codex.process={};f.hub.contextResume.set('codex','old');f.request=async method=>{assert.equal(method,'model/list');return {data:[{model:'actual'}]};};assert.equal((await f.hub.rpc('codex','model/list')).data.length,1);assert.deepEqual(f.calls.map(c=>c.method),['model/list']);
});

for(const provider of ['deepseek','kimi'])test('explicit recovery supports '+provider+' while non-explicit resume never silently replaces it',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-recovery-provider-')),catalog=new Catalog(root),events=[],calls=[];
 t.after(()=>{catalog.db.close();fs.rmSync(root,{recursive:true,force:true});});
 const records=new TaskRecords(catalog,event=>events.push(event));
 records.remember({provider,threadId:'old',projectId:'project',name:'Cross-provider workflow'});
 let task=records.create({provider,threadId:'old',planningMode:true,request:'Cross-provider workflow',projectId:'project'});
 task.parameters={temperature:320};task=records.save(task);
 const attachments=createChatAttachments({catalog,deleted:(...owner)=>records.deleted(...owner)});
 const [file]=attachments.stage({provider,threadId:'old',files:[{name:'notes.txt',size:5,text:'notes',mimeType:'text/plain'}]});
 const workflowContext=createAgentWorkflowContext({records,activeTasks:new Map(),selectedProvider:()=>provider});
 const agents={
  assertContextIdle(){},selectContext:async()=>{},forget(){},codexThreadState(){return null;},
  rpc:async(p,method,params)=>{calls.push({provider:p,method,params});if(method==='thread/resume')throw Error('Session load failed');if(method==='thread/start')return {thread:{id:'fresh-'+p,turns:[]}};return {};},
 };
 const begin=()=>workflowContext.begin(provider,'old');
 await assert.rejects(resumeConversationContext({records,workflowContext,agents,attachments,ticket:begin(),provider,threadId:'old',explicit:false}),/Session load failed/);
 assert.equal(records.deleted(provider,'old'),false);
 const {result}=await resumeConversationContext({records,workflowContext,agents,attachments,ticket:begin(),provider,threadId:'old',model:'provider-model',explicit:true});
 assert.equal(result.thread.id,'fresh-'+provider);
 assert.equal(result.studioRecovery.status,'recovered');
 assert.equal(records.read(task.id).threadId,'fresh-'+provider);
 assert.equal(records.read(task.id).parameters.temperature,320);
 assert.deepEqual(attachments.refsFor({provider,threadId:'fresh-'+provider},[file.id]),[file]);
 assert.equal(calls.some(call=>call.method==='turn/start'),false);
 assert.equal(events.some(event=>event.method==='studio/conversationContextChanged'&&event.provider===provider),true);
});
