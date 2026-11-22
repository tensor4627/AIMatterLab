import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createChatAttachments} from '../../agent/sessions/chat-attachments.mjs';
import {createChatEvidence} from '../../agent/sessions/chat-evidence.mjs';
import {createPrivateCvAccess} from '../../agent/tools/private-cv-access.mjs';
import {Catalog} from '../../backend/main/workspace/catalog.mjs';
import {evidenceParameter} from '../../contracts/agent/chat-evidence.mjs';
import {attachmentHeader,chatAttachmentRefs} from '../../contracts/agent/chat-attachments.mjs';

const hash=text=>createHash('sha256').update(text).digest('hex');
const inputPath='/worker/task-project/inputs/run.in';
const taskSteps=[{id:'dynamics',title:'Dynamics',fields:[{key:'time_step_fs',label:'Time step',type:'number',required:true,unit:'fs'},{key:'file',label:'Input',type:'file',required:true}]}];

async function fixture(t){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'studio-chat-evidence-'));
 const catalog=new Catalog(folder);
 t.after(async()=>{catalog.db.close();await fs.rm(folder,{recursive:true,force:true});});
 const a={provider:'codex',threadId:'ordinary',projectId:'ordinary-project'};
 const b={provider:'deepseek',threadId:'workflow',projectId:'task-project'};
 const state={owner:a,selection:1,task:{...b,id:'task',authoring:{projectId:'task-project'},parameterRevision:1,steps:taskSteps,parameters:{time_step_fs:1,file:inputPath}},
  file:'thermo 100\nrun 500\n',log:'queued\nobserved id\n',artifact:'header\nenergy 2\n',blockedRuns:[],beforeRead:null};
 const events=[],calls=[];
 const row=(provider,threadId)=>[a,b].find(value=>value.provider===provider&&value.threadId===threadId);
 const records={
  conversation:row,deleted:()=>false,
  bound:(provider,threadId)=>row(provider,threadId)===b?structuredClone(state.task):null,
  read:id=>{assert.equal(id,state.task.id);return structuredClone(state.task);},
 };
 const worker={connection:{},identity:{distribution:'fixture',root:'/worker'},connectionEpoch:1,connectionTarget:{port:9999},
  request:async(method,route,data)=>{
   assert.equal(method,'POST');calls.push({route,data});
   if(route==='/api/custom-cv/access')return {blocked_project_ids:[],blocked_run_ids:state.blockedRuns,blocked_paths:[],bindings:[]};
   if(route==='/api/workspace/read'){
    assert.equal(data.project_id,b.projectId);assert.equal(data.name,inputPath);
    await state.beforeRead?.();
    const text=state.file;return {path:data.name,text,sha256:hash(text),size:Buffer.byteLength(text),binary:false,truncated:false};
   }
   if(route==='/api/run/status'||route==='/api/cluster/observation')return {id:data.run_id,project_id:data.run_id==='ordinary-run'?a.projectId:b.projectId};
   if(route==='/api/run/log'||route==='/api/cluster/log')return {text:state.log.slice(data.offset),offset:state.log.length};
   if(route==='/api/run/file'||route==='/api/cluster/result')return {name:data.name,text:state.artifact,sha256:hash(state.artifact)};
   throw Error('Unexpected worker route '+route);
  }
 };
 const localReview={async read(value,event){
  assert.deepEqual(value,{taskId:'task',snapshotId:'snapshot',entryId:'file-entry'});
  assert.equal(event,'trusted human review');
  return {name:'run.in',path:inputPath,text:state.file,sha256:hash(state.file),binary:false};
 }};
 const attachments=createChatAttachments({catalog});
 const privateAccess=createPrivateCvAccess({records,worker,activeTasks:new Map()});
 const broker=createChatEvidence({catalog,records,worker,privateAccess,localReview,attachments,selected:()=>({revision:state.selection,context:state.owner}),emit:event=>events.push(event)});
 const value=(owner,source,text)=>({provider:owner.provider,threadId:owner.threadId,source,sha256:hash(text),textLength:text.length});
 const choose=owner=>{state.owner=owner;state.selection++;};
 return {folder,catalog,a,b,state,broker,attachments,value,choose,events,calls,worker};
}

test('ordinary conversation stages exact native editor lines and keeps their historical text after the original changes',async t=>{
 const {folder,a,b,broker,attachments,value,choose,events}=await fixture(t);
 const text='outside\r\nchosen two\r\nchosen three\r\nexcluded';
 const file=path.join(folder,'run.in');await fs.writeFile(file,text);
 const source={kind:'editor',id:'native-open'};
 broker.editorFile(source.id,file);
 const excerpt={...value(a,source,text),selection:{firstLine:2,lastLine:3},comment:'Can you check these two settings?'};
 await assert.rejects(broker.stage({...excerpt,source:{...source,path:file}}),/证据请求无效/);
 await assert.rejects(broker.stage({...excerpt,selection:{firstLine:3,lastLine:5}}),/行段超出/);
 const [ref]=await broker.stage(excerpt);
 assert.deepEqual(ref.source,{kind:'input',label:'run.in',revision:hash(text),firstLine:2,lastLine:3,projectId:a.projectId});
 assert.deepEqual(events[0].params,{provider:a.provider,threadId:a.threadId,files:[ref],comment:excerpt.comment});
 assert.equal(JSON.stringify(events).includes(folder),false);
 assert.equal(attachments.preview({...a,id:ref.id}).text,'chosen two\r\nchosen three\r\n');
 const replay=file=>chatAttachmentRefs([{type:'text',text:attachmentHeader+'\n'+JSON.stringify([file])+'\n'}]);
 assert.deepEqual(replay(ref),[ref]);
 assert.deepEqual(replay({...ref,source:{...ref.source,revision:{}}}),[]);
 await broker.verify(a,[ref]);
 assert.throws(()=>attachments.preview({...b,id:ref.id}),/原对话/);
 await assert.rejects(broker.verify(b,[ref]),/不匹配/);
 choose(b);
 await assert.rejects(broker.stage(excerpt),/不匹配/);
 await fs.writeFile(file,text.replace('chosen two','new version'));
 await assert.rejects(broker.verify(a,[ref]),/版本已变化/);
 assert.equal(attachments.preview({...a,id:ref.id}).text,'chosen two\r\nchosen three\r\n');
});

test('task review holds one exact parameter baseline and comments on real field changes with units',async t=>{
 const {a,b,state,broker,attachments,value,choose,events}=await fixture(t);
 choose(b);
 const field=revision=>({kind:'parameter',taskId:'task',revision,field:'time_step_fs'});
 const before=value(b,field(1),evidenceParameter(1));
 assert.deepEqual(await broker.remember(before),{revision:'r1/'+hash('1')});
 state.task.parameterRevision=2;state.task.parameters.time_step_fs=0.5;
 const after=value(b,field(2),evidenceParameter(0.5));
 const diff=await broker.compare(after);
 assert.deepEqual(diff.before,{firstLine:1,lastLine:1,text:'1'});
 assert.deepEqual(diff.after,{firstLine:1,lastLine:1,text:'0.5'});
 assert.equal(diff.beforeUnit,'fs');assert.equal(diff.afterUnit,'fs');
 const comment='Review whether 0.5 fs is appropriate';
 const [ref]=await broker.stage({...after,selection:{beforeRevision:diff.beforeRevision},comment});
 assert.equal(ref.source.kind,'parameters');
 assert.equal(ref.source.field,'time_step_fs');
 assert.deepEqual(ref.source.comparison,{beforeRevision:'r1/'+hash('1'),afterRevision:'r2/'+hash('0.5')});
 assert.equal(events[0].params.comment,comment);
 assert.match(attachments.preview({...b,id:ref.id}).text,/fs\nLines 1–1\n0\.5/);
 choose(a);
 await broker.verify(b,[ref]);
 state.task.parameterRevision=3;state.task.parameters.time_step_fs=0.25;
 await assert.rejects(broker.verify(b,[ref]),/版本已变化/);
 assert.match(attachments.preview({...b,id:ref.id}).text,/0\.5/);
});

test('task files, bounded logs and text artifacts are re-read only within current scope and permissions',async t=>{
 const {a,b,state,broker,attachments,value,choose,events,worker}=await fixture(t);
 const range={firstLine:2,lastLine:2};
 const runLog={kind:'log',runId:'ordinary-run',target:'run'};
 const [log]=await broker.stage({...value(a,runLog,state.log),selection:range});
 state.log+='appended without replacing the selected prefix\n';
 await broker.verify(a,[log]);
 assert.equal(attachments.preview({...a,id:log.id}).text,'observed id\n');
 state.blockedRuns.push('ordinary-run');
 await assert.rejects(broker.verify(a,[log]),/共享许可/);
 state.blockedRuns.length=0;state.log='replaced first line\n';
 await assert.rejects(broker.verify(a,[log]),/版本已变化/);
 await assert.rejects(broker.stage({...value(a,{kind:'artifact',runId:'task-run',target:'cluster',name:'energy.txt'},state.artifact),selection:range}),/不匹配/);
 choose(b);
 const [artifact]=await broker.stage({...value(b,{kind:'artifact',runId:'task-run',target:'cluster',name:'energy.txt'},state.artifact),selection:range});
 const [taskInput]=await broker.stage({...value(b,{kind:'taskInput',taskId:'task',path:inputPath},state.file),selection:range});
 const reviewFile={kind:'reviewFile',taskId:'task',snapshotId:'snapshot',entryId:'file-entry'};
 await broker.remember(value(b,reviewFile,state.file),'trusted human review');
 state.file='thermo 100\nrun 750\n';
 const diff=await broker.compare(value(b,reviewFile,state.file),'trusted human review');
 assert.deepEqual(diff.before,{firstLine:2,lastLine:2,text:'run 500\n'});
 assert.deepEqual(diff.after,{firstLine:2,lastLine:2,text:'run 750\n'});
 const [review]=await broker.stage({...value(b,reviewFile,state.file),selection:{beforeRevision:diff.beforeRevision}},'trusted human review');
 await broker.verify(b,[review,artifact]);
 await assert.rejects(broker.verify(b,[taskInput]),/版本已变化/);
 worker.identity={distribution:'different',root:'/worker'};
 await assert.rejects(broker.verify(b,[artifact]),/恢复证据/);
 assert.equal(events.length,4);
});

test('switching conversations while a task file is being read never adds it to either draft',async t=>{
 const {a,b,state,broker,value,choose,events}=await fixture(t);
 choose(b);
 let release,begin;
 const reading=new Promise(resolve=>{begin=resolve;});
 const pending=new Promise(resolve=>{release=resolve;});
 state.beforeRead=()=>{begin();return pending;};
 const operation=broker.stage({...value(b,{kind:'taskInput',taskId:'task',path:inputPath},state.file),selection:{firstLine:1,lastLine:2}});
 await reading;
 choose(a);release();
 await assert.rejects(operation,/不匹配/);
 assert.deepEqual(events,[]);
});

test('local review can compare private parameter versions without giving the model access',async t=>{
 const {b,state,broker,value,choose,events}=await fixture(t);
 choose(b);state.task.customCv={id:'private-definition'};
 const source=revision=>({kind:'parameter',taskId:'task',revision,field:'time_step_fs'});
 await broker.remember(value(b,source(1),'1'));
 state.task.parameterRevision=2;state.task.parameters.time_step_fs=0.5;
 const latest=value(b,source(2),'0.5'),diff=await broker.compare(latest);
 assert.equal(diff.after.text,'0.5');
 await assert.rejects(broker.stage({...latest,selection:{beforeRevision:diff.beforeRevision}}),/共享许可/);
 assert.deepEqual(events,[]);
});
