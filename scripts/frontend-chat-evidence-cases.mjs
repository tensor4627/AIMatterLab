import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createChatAttachments} from '../agent/sessions/chat-attachments.mjs';
import {createChatEvidence} from '../agent/sessions/chat-evidence.mjs';
import {createPrivateCvAccess} from '../agent/tools/private-cv-access.mjs';
import {Catalog} from '../backend/main/workspace/catalog.mjs';

const sha=text=>createHash('sha256').update(text).digest('hex');
const fileText='private outside the selection\nkeep second line\nkeep third line\nalso outside the selection\n';
const logText='Job fixture-id queued\nRecorded step 10\ntemperature = 300 K\n';
const artifactText='artifact header\nenergy = 2 eV\nartifact footer\n';
const reviewedPath='/fixture/inputs/run.in';
const steps=[{id:'saved',title:'Saved settings',fields:[
 {key:'time_step_fs',label:'Time step',type:'number',required:true,unit:'fs'},
 {key:'file',label:'Scientific input',type:'file',required:true},
]}];

async function evidenceFixture(page,out,withTask){
 const folder=await fs.mkdtemp(path.join(out,'evidence-fixture-'));
 const catalog=new Catalog(folder);
 try{
  const editorFile=path.join(folder,'run.in');await fs.writeFile(editorFile,fileText);
  const a={id:'codex:run-editor',provider:'codex',threadId:'run-editor',name:'Ordinary evidence',projectId:'project',taskId:null,updatedAt:2};
  const b={id:'codex:workflow-evidence',provider:'codex',threadId:'workflow-evidence',name:'Workflow evidence',projectId:'project',taskId:'evidence-task',updatedAt:1};
  const task={id:b.taskId,provider:b.provider,threadId:b.threadId,name:b.name,projectId:b.projectId,workflowVersion:2,steps,
   authoring:{projectId:b.projectId},
   composition:{graphPath:'/fixture/review.json',status:'rendered',graph_sha256:'a'.repeat(64),expected:{files:{}}},
   parameters:{engine:'pygas.build',file:reviewedPath,time_step_fs:1},parameterRevision:1,updatedAt:1,artifacts:[],missingFields:[],review:{status:'not_run'}};
  const state={owner:withTask?b:a,selection:0,task,reviewedFile:'old step\nparameter 1\n',log:logText};
  const turns=new Map(),events=[],received=[];
  const row=(provider,id)=>[a,b].find(item=>item.provider===provider&&item.threadId===id);
  const records={conversation:row,bound:(provider,threadId)=>row(provider,threadId)===b?structuredClone(state.task):null,read:id=>id===task.id?structuredClone(state.task):null,deleted:()=>false};
  const preview=()=>({id:'approved-source',name:'run.in',path:reviewedPath,text:state.reviewedFile,sha256:sha(state.reviewedFile),size:Buffer.byteLength(state.reviewedFile),binary:false,complete:true,canConfirm:true});
  const worker={connection:{},identity:{distribution:'fixture',root:'/worker'},connectionEpoch:1,connectionTarget:{port:9999},request:async(_method,route,data)=>{
   if(route==='/api/custom-cv/access')return {blocked_project_ids:[],blocked_run_ids:[],blocked_paths:[],bindings:[]};
   if(route==='/api/workspace/read'){assert.equal(data.name,reviewedPath);return {...preview(),truncated:false};}
   if(route==='/api/run/status')return {id:'evidence-run',project_id:a.projectId};
   if(route==='/api/run/log')return {text:state.log.slice(data.offset),offset:state.log.length};
   if(route==='/api/run/file')return {name:data.name,text:artifactText};
   throw Error('Unexpected evidence worker route '+route);
  }};
  const attachments=createChatAttachments({catalog}),privateAccess=createPrivateCvAccess({records,worker,activeTasks:new Map()});
  const broker=createChatEvidence({catalog,records,worker,privateAccess,localReview:{read:async value=>{
   assert.equal(value.taskId,task.id);assert.equal(value.entryId,preview().id);
   assert.equal(value.snapshotId,'snapshot-'+state.task.parameterRevision);return preview();
  }},attachments,selected:()=>({revision:state.selection,context:state.owner}),emit:event=>events.push(event)});
  broker.editorFile('native-editor-id',editorFile);
  await page.exposeFunction('nativeEvidenceFixture',async(method,data)=>{
   if(method==='conversation.select'){
    const owner=[a,b].find(row=>row.id===data.id);assert(owner);
    state.owner=owner;state.selection++;return {value:owner};
   }
   if(method==='file.open')return {value:{id:'native-editor-id',name:'run.in',path:editorFile,content:await fs.readFile(editorFile,'utf8')}};
   if(method==='fixture.change-version'){
    state.task.parameterRevision++;state.task.updatedAt++;state.task.parameters.time_step_fs=0.5;
    state.reviewedFile='old step\nparameter 0.5\n';
    await fs.writeFile(editorFile,'New version\n');return {value:true};
   }
   if(method==='task.input.read')return {value:preview()};
   if(method==='fixture.append-log'){state.log+='file still growing\n';return {value:true};}
   if(method==='task.localReview.inspect')return {value:{taskId:task.id,snapshotId:'snapshot-'+state.task.parameterRevision,parameterRevision:state.task.parameterRevision,scope:'local-human-input-review-v1',engine:'pygas.build',
    parameters:state.task.parameters,steps,entries:[preview()],graph:{},runtimeReceiptSha:'actual-receipt',canConfirm:false,scientificValidation:'not_run'}};
   if(method==='task.localReview.read')return {value:preview()};
   if(method==='agent.attachments.preview')return {value:attachments.preview(data)};
   if(method.startsWith('chat.evidence.')){
    const result=await broker[method.split('.').at(-1)](data);
    return {value:result,event:events.splice(0).at(-1)};
   }
   if(method==='history'){
    const conversation=[a,b].find(row=>row.id===data.conversationId);
    return {value:{conversation,turns:turns.get(conversation.threadId)??[],before:null,atLatest:true,bookmarks:[],studioSession:{threadId:conversation.threadId,busy:false,turnId:null,requests:[]}}};
   }
   if(method==='turn/start'){
    const owner={provider:data.provider,threadId:data.params.threadId};
    const refs=attachments.refsFor(owner,data.params.studioAttachments||[]);
    await broker.verify(owner,refs);
    const content=[...data.params.input,...attachments.inputs(owner,refs.map(file=>file.id))];
    const turn={id:'submitted-evidence',status:'completed',items:[{id:'user-evidence',type:'userMessage',content}]};
    turns.set(owner.threadId,[turn]);received.push({owner,refs,content});
    return {value:{turn},event:{provider:owner.provider,method:'turn/completed',params:{threadId:owner.threadId,turn}}};
   }
   throw Error('Unexpected native evidence fixture '+method);
  });
  await page.evaluate(async({a,b,task,withTask,logText,artifactText})=>{
   const test=window.__test,original=window.studio.invoke;
   const ask=async(method,data)=>{const result=await window.nativeEvidenceFixture(method,data);if(result.event)for(const fn of test.events)fn(result.event);return result.value;};
   test.evidenceAsk=ask;
   test.workerStatus={status:'connected',checkedAt:1,sourceId:'local:fixture',serviceVersion:'current',binding:{kind:'local',distribution:'Ubuntu',root:'/fixture',port:8767},health:{root:'/fixture',worker_identity:'fixture'}};
   test.run={...test.run,id:'evidence-run',name:'Evidence fixture job',status:'succeeded'};
   window.studio.conversationHistory=true;
   window.studio.invoke=async(method,data)=>{
    if(method==='conversation.list')return [a,b];
    if(method==='conversation.remember')return [a,b].find(row=>row.threadId===data.threadId);
    if(method==='task.list')return [task];
    if(method==='task.read')return task;
    if(method==='task.localReview.status')return {taskId:data.taskId,scope:'local',status:'not_run',parameterRevision:task.parameterRevision,provider:task.provider,threadId:task.threadId};
    if(method==='task.localReview.confirm')throw Error('Attaching evidence must never confirm human review');
    if(method==='task.pygas.read')return {taskId:task.id,composition:{graphPath:'/fixture/review.json',status:'rendered',graph_sha256:'a'.repeat(64),expected:{files:{}}},graph:{mode:'cvonly',schema_version:1,nodes:[],edges:[],settings:{}},catalog:{schema_version:1,status:'passed',source:{files:{}},catalog:{cv:[],bias:[],switch:[],neighbor:[]}},assets:[]};
    if(['file.open','conversation.select','task.input.read','task.localReview.inspect','task.localReview.read','agent.attachments.preview'].includes(method)||method.startsWith('chat.evidence.'))return ask(method,data);
    if(['conversation.history.page','conversation.history.locate'].includes(method))return ask('history',data);
    if(method==='agent.rpc'&&['thread/read','thread/resume'].includes(data.method)){
     const conversation=[a,b].find(row=>row.threadId===data.params.threadId);
     const view=await ask('history',{conversationId:conversation.id});
     return {thread:{id:conversation.threadId,turns:view.turns},studioSession:view.studioSession,model:'fixture-model'};
    }
    if(method==='agent.rpc'&&data.method==='turn/start'){
     const result=await window.nativeEvidenceFixture('turn/start',data),turn=result.value.turn,threadId=data.params.threadId;
     const publish=event=>test.events.forEach(fn=>fn(event));
     publish({provider:data.provider,method:'turn/started',params:{threadId,turn:{id:turn.id,status:'inProgress',items:[]}}});
     setTimeout(()=>publish(result.event),35);
     return result.value;
    }
    if(method==='worker.request'&&data.target==='/api/run/log')return {text:logText.slice(data.data.offset),offset:logText.length};
    if(method==='worker.request'&&data.target==='/api/run/collect')return {run:test.run.id,artifacts:[{name:'energy.txt',size:artifactText.length}]};
    if(method==='worker.request'&&data.target==='/api/run/file')return {name:data.data.name,text:artifactText,offset:artifactText.length,size:artifactText.length};
    return original(method,data);
   };
   localStorage.setItem('studio.conversation',withTask?b.id:a.id);
   localStorage.setItem('studio.agent','true');
   await window.renderTest('App');
  },{a,b,task,withTask,logText,artifactText});
  return {a,b,received,close:()=>catalog.db.close()};
 }catch(error){catalog.db.close();throw error;}
}

export async function frontendChatEvidenceCases({check,out}){
 await check('chat-experience-evidence-editor-sends-selected-lines-and-reopens-immutable-history',async page=>{
  const fixture=await evidenceFixture(page,out,false);
  try{
   await page.locator('.conversation-item.selected-conversation').filter({hasText:fixture.a.name}).waitFor();
   const open=page.getByRole('button',{name:'打开源码',exact:true});
   if(!await open.isVisible())await page.getByTestId('toggle-bottom-panel').click();
   await open.click();
   const source=page.locator('[data-source-kind="editor"]');
   await source.locator('summary').click();
   await source.getByLabel('起始行',{exact:true}).fill('2');
   await source.getByLabel('结束行',{exact:true}).fill('3');
   const comment='Check the exact two selected lines';
   await source.getByLabel('批注（可选）',{exact:true}).fill(comment);
   await source.getByRole('button',{name:'把所选行加入草稿',exact:true}).click();
   await page.getByTestId('toast-region').getByRole('status').filter({hasText:'已添加到对话草稿'}).last().waitFor();
   const compose=page.locator('.agent-panel textarea[data-guide-target="composer"]');
   await page.waitForFunction(comment=>document.querySelector('.agent-panel textarea[data-guide-target="composer"]')?.value===comment,comment);
   await page.locator('.conversation-item').filter({hasText:fixture.b.name}).click();
   await page.locator('.conversation-item.selected-conversation').filter({hasText:fixture.b.name}).waitFor();
   assert.equal(await compose.inputValue(),'');
   await page.locator('.conversation-item').filter({hasText:fixture.a.name}).click();
   await page.waitForFunction(comment=>document.querySelector('.agent-panel textarea[data-guide-target="composer"]')?.value===comment,comment);
   const connect=page.getByTestId('agent-connect');
   if(await connect.isVisible())await connect.click();
   await page.getByRole('button',{name:'发送',exact:true}).click();
   await page.getByRole('button',{name:'发送',exact:true}).waitFor();
   await page.locator('.conversation-item').filter({hasText:fixture.b.name}).click();
   await page.locator('.conversation-item.selected-conversation').filter({hasText:fixture.b.name}).waitFor();
   await page.locator('.conversation-item').filter({hasText:fixture.a.name}).click();
   const history=page.locator('[data-item-id="user-evidence"]');
   await history.waitFor();
   assert.equal(fixture.received.length,1);
   const [{refs,content,owner}]=fixture.received;
   assert.equal(owner.threadId,fixture.a.threadId);
   assert.equal(refs[0]?.source.firstLine,2);assert.equal(refs[0]?.source.lastLine,3);
   assert.match(JSON.stringify(content),/keep second line\\nkeep third line/);
   assert.doesNotMatch(JSON.stringify(content),/private outside|also outside/);
   await page.evaluate(()=>window.__test.evidenceAsk('fixture.change-version',{}));
   await history.getByRole('button',{name:/run\.in/}).click();
   const modal=page.getByRole('dialog');
   await modal.getByText(/keep second line/).waitFor();
   assert.doesNotMatch(await modal.innerText(),/outside the selection|New version/);
   await page.screenshot({path:path.join(out,'evidence-editor-history.png')});
  }finally{fixture.close();}
 });
 await check('chat-experience-evidence-task-review-compares-actual-field-versions-with-units-and-comment',async page=>{
  const fixture=await evidenceFixture(page,out,true);
  try{
   await page.locator('.conversation-item.selected-conversation').filter({hasText:fixture.b.name}).waitFor();
   await page.getByTestId('open-local-review').click();
   const review=page.getByTestId('local-input-review');
   const inspect=review.getByTestId('local-review-inspect');
   await inspect.click();
   const parameter=review.locator('[data-source-kind="parameter"]');
   await review.getByLabel('比较已保存参数',{exact:true}).selectOption('time_step_fs');
   await parameter.locator('summary').click();
   await parameter.getByRole('button',{name:'保留此版本供比较',exact:true}).click();
   await parameter.getByRole('status').filter({hasText:'已保存比较基线'}).waitFor();
   const openFile=async()=>{
    await review.getByRole('button',{name:/run\.in ·/}).click();
    await review.getByText('源码与文件原文',{exact:true}).click();
    const evidence=review.locator('[data-source-kind="reviewFile"]');
    await evidence.locator('summary').click();
    return evidence;
   };
   const initialFile=await openFile();
   await initialFile.getByRole('button',{name:'保留此版本供比较',exact:true}).click();
   await initialFile.getByRole('status').filter({hasText:'已保存比较基线'}).waitFor();
   await page.evaluate(()=>window.__test.evidenceAsk('fixture.change-version',{}));
   await inspect.click();
   await review.getByText(/保存版本 2/).waitFor();
   if(!await parameter.evaluate(node=>node.open))await parameter.locator('summary').click();
   await parameter.getByRole('button',{name:'与保留版本比较',exact:true}).click();
   const diff=review.getByTestId('chat-evidence-diff');
   await diff.waitFor();
   assert.match(await diff.innerText(),/修改前 · r1 [^\n]+ · fs[\s\S]*修改后 · r2 [^\n]+ · fs[\s\S]*0\.5/);
   await parameter.getByLabel('批注（可选）',{exact:true}).fill('Review 0.5 fs before sending');
   await parameter.getByRole('button',{name:'把带批注的差异加入草稿',exact:true}).click();
   await page.getByTestId('toast-region').getByRole('status').filter({hasText:'已添加到对话草稿'}).last().waitFor();
   await page.waitForFunction(()=>document.querySelector('.agent-panel textarea[data-guide-target="composer"]')?.value==='Review 0.5 fs before sending');
   assert.equal(fixture.received.length,0);
   await page.screenshot({path:path.join(out,'evidence-task-parameter-review.png')});
   const currentFile=await openFile();
   await currentFile.getByRole('button',{name:'与保留版本比较',exact:true}).click();
   const fileDiff=currentFile.getByTestId('chat-evidence-diff');
   await fileDiff.getByText('parameter 1',{exact:true}).waitFor();
   await fileDiff.getByText('parameter 0.5',{exact:true}).waitFor();
   await currentFile.getByLabel('批注（可选）',{exact:true}).fill('Review the changed file line');
   await currentFile.getByRole('button',{name:'把带批注的差异加入草稿',exact:true}).click();
   await page.getByTestId('toast-region').getByRole('status').filter({hasText:'已添加到对话草稿'}).last().waitFor();
   await page.locator('.composer').getByTestId('chat-file-chip').filter({hasText:'run.in'}).waitFor();
   assert.match(await page.locator('.agent-panel textarea[data-guide-target="composer"]').inputValue(),/Review 0\.5 fs before sending\n\nReview the changed file line/);
   await page.screenshot({path:path.join(out,'evidence-task-file-review.png')});
  }finally{fixture.close();}
 });
 await check('chat-experience-evidence-saved-job-log-and-artifact-in-the-authorized-conversation',async page=>{
  const fixture=await evidenceFixture(page,out,false);
  try{
   await page.locator('.conversation-item.selected-conversation').filter({hasText:fixture.a.name}).waitFor();
   await page.getByTestId('navigate-runs').click();
   await page.locator('.job-record-open').filter({hasText:'Evidence fixture job'}).click();
   const log=page.locator('[data-source-kind="log"]');
   await log.locator('summary').click();
   const addLine=async source=>{
    await source.getByLabel('结束行',{exact:true}).fill('2');
    await source.getByLabel('起始行',{exact:true}).fill('2');
    await source.getByRole('button',{name:'把所选行加入草稿',exact:true}).click();
    await page.getByTestId('toast-region').getByRole('status').filter({hasText:'已添加到对话草稿'}).last().waitFor();
   };
   await page.evaluate(()=>window.__test.evidenceAsk('fixture.append-log',{}));
   await addLine(log);
   await page.getByRole('tab',{name:'结果',exact:true}).click();
   await page.getByRole('button',{name:/energy\.txt/}).click();
   const artifact=page.locator('[data-source-kind="artifact"]');
   await artifact.locator('summary').click();
   await addLine(artifact);
   const chips=page.locator('.composer').getByTestId('chat-file-chip');
   await chips.filter({hasText:'energy.txt'}).waitFor();
   assert.equal(await chips.count(),2);
   await chips.getByRole('button',{name:/^console\.log/}).click();
   const preview=page.getByTestId('chat-file-preview');
   await preview.getByText('Recorded step 10',{exact:true}).waitFor();
   assert.match(await preview.innerText(),/evidence-run/);
   assert.doesNotMatch(await preview.innerText(),/temperature|still growing|queued/);
   assert.equal(fixture.received.length,0);
   await page.screenshot({path:path.join(out,'evidence-run-log-preview.png')});
  }finally{fixture.close();}
 });
}
