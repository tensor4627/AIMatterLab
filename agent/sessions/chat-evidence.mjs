import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
import {providerId} from '../providers/contracts.mjs';
import {readTaskInput} from '../../backend/main/workspace/task-input-preview.mjs';
import {normalizeSteps,parameterValue,isFieldKey} from '../../contracts/workflows/task-fields.mjs';
import {evidenceDifference,evidenceLines,evidenceParameter} from '../../contracts/agent/chat-evidence.mjs';
import {attachmentLimits} from '../../contracts/agent/chat-attachments.mjs';

const maxText=2*1024*1024;
const maxChanged=attachmentLimits.textBytes-2048;
const recordKind='chat-evidence-reference',baselineKind='chat-evidence-baseline';
const hash=value=>createHash('sha256').update(value).digest('hex');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const token=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\x00-\x1f]/.test(value);
const leaf=value=>typeof value==='string'&&value.trim().length>0&&value.length<=255&&value!=='.'&&value!=='..'&&!/[\\/\x00-\x1f\x7f]/.test(value);
const safePath=value=>typeof value==='string'&&value.length<=4096&&value.startsWith('/')&&!/[\\\x00-\x1f]/.test(value)&&!value.split('/').some(part=>part==='..'||part==='.');
const changed=()=>Error('证据来源或版本已变化。请重新打开原文并选择要发送的内容。');
const wrongOwner=()=>Error('证据和当前对话的来源不匹配。');
function exact(value,required,optional=[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))throw Error('证据请求无效。');
}
function validate(value,stage=false){
 exact(value,['provider','threadId','source','sha256','textLength',...stage?['selection']:[]],stage?['comment']:[]);
 providerId(value.provider);
 if(!token(value.threadId)||!sha(value.sha256)||!Number.isSafeInteger(value.textLength)||value.textLength<1||value.textLength>maxText)throw Error('证据的对话或版本无效。');
 const source=value.source;
 const keys={editor:['id'],taskInput:['taskId','path'],reviewFile:['taskId','snapshotId','entryId'],parameter:['taskId','revision','field'],log:['runId','target'],artifact:['runId','name','target']};
 if(!Object.hasOwn(keys,source?.kind))throw Error('证据类型无效。');
 exact(source,['kind',...keys[source.kind]]);
 if(keys[source.kind].some(k=>['id','taskId','snapshotId','entryId','runId'].includes(k)&&!token(source[k]))||
  source.kind==='taskInput'&&!safePath(source.path)||
  source.kind==='parameter'&&(!Number.isSafeInteger(source.revision)||source.revision<0||!isFieldKey(source.field))||
  ['log','artifact'].includes(source.kind)&&!['run','cluster'].includes(source.target)||
  source.kind==='artifact'&&!leaf(source.name))throw Error('证据来源无效。');
 if(!stage)return;
 if(value.comment!==undefined&&(typeof value.comment!=='string'||value.comment.length>2000||value.comment.includes('\0')))throw Error('批注限 2000 字符。');
 const selection=value.selection;
 if(Object.hasOwn(selection??{},'beforeRevision')){
  exact(selection,['beforeRevision']);if(!token(selection.beforeRevision))throw Error('比较版本无效。');
 }else{
  exact(selection,['firstLine','lastLine']);
  const {firstLine,lastLine}=selection;
  if(!Number.isSafeInteger(firstLine)||!Number.isSafeInteger(lastLine)||firstLine<1||lastLine<firstLine)throw Error('证据行段无效。');
 }
}

async function readNative(file){
 const resolved=await fs.realpath(file);
 const handle=await fs.open(resolved,'r');
 try{
  const before=await handle.stat();
  if(!before.isFile()||before.size>maxText)throw Error('证据需要 2 MiB 以内的文本。');
  const bytes=Buffer.alloc(before.size+1);
  let length=0;
  while(length<bytes.length){
   const result=await handle.read(bytes,length,bytes.length-length,length);
   if(!result.bytesRead)break;
   length+=result.bytesRead;
  }
  const after=await handle.stat(),current=await fs.stat(resolved);
  if(resolved!==await fs.realpath(file)||length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||current.ino!==before.ino||current.dev!==before.dev||current.mtimeMs!==before.mtimeMs)throw changed();
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,length));
 }finally{await handle.close();}
}

async function workspaceText(call,projectId,file,complete){
 let text='',offset=0,identity=null;
 for(let page=0;page<9;page++){
  const value=await call('/api/workspace/read',{project_id:projectId,name:file,offset});
  if(value.path!==file||value.binary||typeof value.text!=='string'||!sha(value.sha256))throw changed();
  if(identity&&identity!==value.sha256)throw changed();
  identity=value.sha256;text+=value.text;
  if(!complete||!value.truncated)return {text,digest:identity};
  if(!Number.isSafeInteger(value.offset)||value.offset<=offset||value.offset>maxText)throw changed();
  offset=value.offset;
 }
 throw changed();
}

/** A displayed source is resolved again through its owner before attaching or dispatching. */
export function createChatEvidence({catalog,records,worker,selected,attachments,localReview,privateAccess,emit}){
 const editors=new Map();
 function rememberEditor(id,source){
  editors.set(id,source);
  if(editors.size>64)editors.delete(editors.keys().next().value);
  return id;
 }
 function workerIdentity(){
  if(!worker.connection||!worker.identity)throw Error('请恢复证据所在的作业服务。');
  return JSON.stringify({identity:worker.identity,port:worker.connectionTarget?.port});
 }
 function editorFile(id,file){
  if(typeof file==='string'&&path.isAbsolute(file)&&leaf(path.basename(file)))rememberEditor(id,{kind:'native',file,name:path.basename(file)});
 }
 function projectEditor(projectId,file){
  if(!token(projectId)||!safePath(file)||!worker.connection||!worker.identity)return undefined;
  return rememberEditor(randomUUID(),{kind:'project',projectId,file,worker:workerIdentity()});
 }
 function owner(value,requiresSelection){
  const {provider,threadId}=value,conversation=records.conversation(provider,threadId),task=records.bound(provider,threadId);
  if(!conversation||records.deleted(provider,threadId)||task&&(task.provider!==provider||task.threadId!==threadId))throw wrongOwner();
  const selection=requiresSelection?selected():null;
  const scope={provider,threadId,taskId:task?.id??null,projectId:task?.authoring?.projectId||task?.projectId||conversation.projectId||null};
  if(selection&&(selection.context?.provider!==provider||selection.context?.threadId!==threadId))throw wrongOwner();
  const assert=(requireTaskRevision=false)=>{
   const current=records.conversation(provider,threadId),latest=records.bound(provider,threadId);
   if(!current||records.deleted(provider,threadId)||latest?.id!==task?.id||requireTaskRevision&&latest?.parameterRevision!==task?.parameterRevision||
    (latest?.authoring?.projectId||latest?.projectId||current.projectId||null)!==scope.projectId||selection&&!equal(selected(),selection))throw wrongOwner();
  };
  return {scope,task,assert};
 }
 function service(expected){
  const marker=workerIdentity(),connection=worker.connection,epoch=worker.connectionEpoch;
  if(expected&&marker!==expected)throw Error('请恢复证据所在的作业服务。');
  const assert=()=>{if(connection!==worker.connection||epoch!==worker.connectionEpoch||marker!==workerIdentity())throw changed();};
  return {marker,assert,async call(route,value){assert();const result=await worker.request('POST',route,value);assert();return result;}};
 }
 async function resolve(value,binding,context,event,share){
  const input=value.source,kind=input.kind;
  const task=context.task;
  let locator=binding?.locator;
  if(!locator){
   if(kind==='editor'){
    locator=editors.get(input.id);if(!locator)throw Error('请重新打开已保存的文件。');
   }else locator=input;
  }
  if(locator.kind==='native'){
   if(share&&task?.customCv?.id)throw Error('当前模型没有此项科学证据的共享许可。');
   const text=await readNative(locator.file);
   context.assert();
   return {text,locator,label:locator.name,kind:'input',anchor:['native',locator.file]};
  }
  if(input.taskId&&context.scope.taskId!==input.taskId)throw wrongOwner();
  const network=service(binding?.worker??locator.worker);
  const call=network.call;
  const project=locator.projectId||context.scope.projectId;
  // The existing provider privacy registry still owns blocked projects, paths and historical runs.
  const authorize=(file,runId)=>share?privateAccess.assertEvidence(context.scope.provider,{task,projectId:project,file,runId}):undefined;
  let source;
  if(locator.kind==='project'){
   if(project!==context.scope.projectId)throw wrongOwner();
   await authorize(locator.file);
   const result=await workspaceText(call,project,locator.file,true);
   if(hash(result.text)!==result.digest)throw changed();
   source={text:result.text,label:path.posix.basename(locator.file),kind:'input',anchor:['project',project,locator.file]};
  }else if(kind==='taskInput'){
   await authorize(locator.path);
   const result=await readTaskInput(records,{request:(_method,route,data)=>call(route,data)},{taskId:locator.taskId,path:locator.path});
   if(result.path!==locator.path||result.binary||typeof result.text!=='string'||!sha(result.sha256))throw changed();
   source={text:result.text,label:path.posix.basename(result.path),revision:result.sha256,kind:'input',anchor:['taskInput',project,result.path]};
  }else if(kind==='reviewFile'){
   if(!binding){
    const result=await localReview.read({taskId:input.taskId,snapshotId:input.snapshotId,entryId:input.entryId},event);
    if(result.binary||typeof result.text!=='string'||!safePath(result.path)||!leaf(result.name)||hash(result.text)!==result.sha256)throw changed();
    locator={kind,taskId:input.taskId,path:result.path,projectId:task.authoring?.projectId};
    if(locator.projectId!==context.scope.projectId)throw wrongOwner();
    await authorize(locator.path);
    source={text:result.text,label:result.name,kind:'input',anchor:['reviewFile',project,result.path]};
   }else{
    if(project!==context.scope.projectId||task?.authoring?.projectId!==project)throw wrongOwner();
    await authorize(locator.path);
    const result=await workspaceText(call,project,locator.path,true);
    if(hash(result.text)!==result.digest)throw changed();
    source={text:result.text,label:path.posix.basename(locator.path),kind:'input',anchor:['reviewFile',project,locator.path]};
   }
  }else if(kind==='parameter'){
   await authorize();
   if(task.parameterRevision!==locator.revision)throw changed();
   const field=normalizeSteps(task.steps||[],task.parameters,[]).flatMap(step=>step.fields).find(field=>field.key===locator.field);
   if(!field)throw changed();
   const text=evidenceParameter(parameterValue(task.parameters,locator.field));
   source={text,label:field.label,field:field.key,unit:field.unit,revision:'r'+locator.revision+'/'+hash(text),kind:'parameters',anchor:['parameter',field.key]};
  }else{
   const run=await call(input.target==='cluster'?'/api/cluster/observation':'/api/run/status',{run_id:input.runId});
   if(!project||run.id!==input.runId||run.project_id!==project)throw wrongOwner();
   await authorize(undefined,input.runId);
   if(kind==='log'){
    const route=input.target==='cluster'?'/api/cluster/log':'/api/run/log';
    let text='',offset=0;
    for(let page=0;page<9&&text.length<value.textLength;page++){
     const result=await call(route,{run_id:input.runId,offset});
     if(typeof result.text!=='string'||!Number.isSafeInteger(result.offset)||result.offset<=offset)throw changed();
     text+=result.text;offset=result.offset;
    }
    source={text:text.slice(0,value.textLength),label:'console.log',runId:input.runId,kind:'log',anchor:['log',input.target,input.runId]};
   }else{
    const result=await call(input.target==='cluster'?'/api/cluster/result':'/api/run/file',{run_id:input.runId,name:input.name,...input.target==='run'?{offset:0}:{}});
    if(result.name!==input.name||result.image||typeof result.text!=='string')throw changed();
    if(input.target==='cluster'&&hash(result.text)!==result.sha256)throw changed();
    source={text:result.text,label:result.name,runId:input.runId,kind:'artifact',anchor:['artifact',input.target,input.runId,result.name]};
   }
  }
  network.assert();context.assert(kind==='parameter'||kind==='reviewFile'&&!binding);
  return {...source,locator,worker:network.marker,taskId:task?.id};
 }
 async function current(value,binding,event,share=true){
  const context=owner(value,!binding);
  if(binding&&!equal(context.scope,binding.owner))throw wrongOwner();
  const source=await resolve(value,binding,context,event,share);
  if(source.text.length!==value.textLength||Buffer.byteLength(source.text)>maxText||source.text.includes('\0')||hash(source.text)!==value.sha256)throw changed();
  const revision=source.revision||value.sha256;
  if(binding&&binding.revision!==revision)throw changed();
  const key=hash(JSON.stringify([context.scope,source.worker,source.anchor]));
  return {...source,key,revision,owner:context.scope,assert:()=>context.assert(value.source.kind==='parameter'||value.source.kind==='reviewFile'&&!binding)};
 }
 function difference(source){
  const before=catalog.get(baselineKind,source.key);
  if(!before||before.text===source.text&&before.unit===source.unit)return null;
  const found=before.text===source.text
   ?{before:{firstLine:1,lastLine:evidenceLines(before.text).length,text:before.text},after:{firstLine:1,lastLine:evidenceLines(source.text).length,text:source.text}}
   :evidenceDifference(before.text,source.text);
  if(Buffer.byteLength(found.before.text)+Buffer.byteLength(found.after.text)>maxChanged)throw Error('这次比较的变更超过 256 KiB，请选择要发送的行。');
  return {beforeRevision:before.revision,afterRevision:source.revision,beforeUnit:before.unit,afterUnit:source.unit,...found};
 }
 async function localVersion(value,event){
  validate(value);
  if(!['editor','reviewFile','parameter'].includes(value.source.kind))throw Error('请从原输入编辑器或流程复核比较版本。');
  return current(value,null,event,false);
 }
 async function remember(value,event){
  const source=await localVersion(value,event);
  source.assert();catalog.put(baselineKind,source.key,{owner:source.owner,revision:source.revision,text:source.text,unit:source.unit});
  return {revision:source.revision};
 }
 async function compare(value,event){return difference(await localVersion(value,event));}
 async function stage(value,event){
  validate(value,true);
  const source=await current(value,null,event),selection=value.selection,lines=evidenceLines(source.text);
  let text,firstLine,lastLine,comparison;
  if('beforeRevision' in selection){
   const diff=difference(source);
   if(!diff||diff.beforeRevision!==selection.beforeRevision)throw changed();
   const range=diff.after.lastLine>=diff.after.firstLine?diff.after:diff.before;
   ({firstLine,lastLine}=range);
   comparison={beforeRevision:diff.beforeRevision,afterRevision:diff.afterRevision};
   const block=(label,revision,unit,part)=>[label+' '+revision+(unit?' · '+unit:''),part.lastLine>=part.firstLine?'Lines '+part.firstLine+'–'+part.lastLine:'Empty range',part.text].join('\n');
   text=block('Before',diff.beforeRevision,diff.beforeUnit,diff.before)+'\n\n'+block('After',diff.afterRevision,diff.afterUnit,diff.after);
  }else{
   ({firstLine,lastLine}=selection);
   if(lastLine>lines.length)throw Error('行段超出已打开的证据。');
   text=lines.slice(firstLine-1,lastLine).join('');
  }
  const name=source.label.replace(/[\\/\x00-\x1f\x7f]/g,' ').trim().slice(0,255)||'evidence.txt';
  const provenance={kind:source.kind,label:name,revision:source.revision,firstLine,lastLine,...source.owner.projectId?{projectId:source.owner.projectId}:{},...source.taskId?{taskId:source.taskId}:{},...source.runId?{runId:source.runId}:{},...source.field?{field:source.field}:{},...source.unit?{unit:source.unit}:{},...comparison?{comparison}:{}};
  source.assert();
  const {provider,threadId}=source.owner;
  const {sha256,textLength}=value;
  const files=attachments.stage({provider,threadId,files:[{name,size:Buffer.byteLength(text),text,mimeType:'text/plain'}]},provenance,([file])=>{
   catalog.put(recordKind,file.id,{owner:source.owner,locator:source.locator,worker:source.worker,source:value.source,sha256,textLength,revision:source.revision});
  });
  emit({method:'studio/chatEvidenceSelected',provider,params:{provider,threadId,files,...value.comment?.trim()?{comment:value.comment.trim()}:{}}});
  return files;
 }
 async function verify(value,files){
  for(const file of files){
   if(!file.source)continue;
   const binding=catalog.get(recordKind,file.id);
   if(!binding||binding.owner.provider!==value.provider||binding.owner.threadId!==value.threadId||binding.revision!==file.source.revision)throw wrongOwner();
   await current({...value,source:binding.source,sha256:binding.sha256,textLength:binding.textLength},binding);
  }
 }
 function remove(provider,threadId){
  for(const kind of [recordKind,baselineKind])for(const row of catalog.list(kind))if(row.owner?.provider===provider&&row.owner?.threadId===threadId)catalog.remove(kind,row.id);
 }
 return {editorFile,projectEditor,stage,compare,remember,verify,remove};
}
