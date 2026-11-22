import {randomUUID} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {attachmentHeader,attachmentLimits,chatImageMime,imageTypes} from '../../contracts/agent/chat-attachments.mjs';
import {providerId} from '../providers/contracts.mjs';

const selectedImages=new WeakMap();
export function selectedImageInput(item){return selectedImages.get(item);}
function ownerOf(value){
 const provider=providerId(value.provider);
 const key=value.threadId===null?value.draftId:value.threadId;
 if(typeof key!=='string'||!key||key.length>200||/[\x00-\x1f]/.test(key))throw Error('附件所属对话无效。');
 return {provider,kind:value.threadId===null?'draft':'thread',key};
}
function snapshot(file,source){
 const {name,size,mimeType}=file??{};
 if(typeof name!=='string'||!name.trim()||name.length>255||/[\\/\x00-\x1f\x7f]/.test(name)||!Number.isSafeInteger(size)||size<0||size>attachmentLimits.documentBytes)throw Error('文件名或文件大小无效。');
 let body,kind;
 if(typeof file.text==='string'&&file.bytes===undefined){
  if(!(source?file.text.length:file.text.trim())||file.text.includes('\0'))throw Error(name+' 缺少可读取的文字。');
  if(Buffer.byteLength(file.text,'utf8')>attachmentLimits.textBytes)throw Error(name+' 的文字内容超过 256 KiB，请选取相关片段。');
  body=Buffer.from(file.text,'utf8');kind='text';
 }else if(file.bytes instanceof Uint8Array&&file.text===undefined){
  if(file.bytes.byteLength!==size||size>attachmentLimits.imageBytes||!imageTypes.includes(mimeType)||chatImageMime(file.bytes)!==mimeType)throw Error(name+' 需要是 8 MiB 以内的 PNG、JPEG、WebP 或 GIF 图片。');
  body=Buffer.from(file.bytes);kind='image';
 }else throw Error(name+' 的附件内容无效。');
 if(typeof mimeType!=='string'||mimeType.length>128||/[\r\n]/.test(mimeType))throw Error('附件格式无效。');
 const ref={id:randomUUID(),name,kind,mimeType,size,...source?{source}:{}};
 return {ref,body};
}

/** The renderer passes only user-selected bytes, never host paths or network addresses. */
export function createChatAttachments({catalog,deleted=()=>false}){
 const db=catalog.db;
 db.exec(`CREATE TABLE IF NOT EXISTS chat_attachments (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, owner_kind TEXT NOT NULL, owner_key TEXT NOT NULL,
  metadata TEXT NOT NULL, body BLOB NOT NULL
 ); CREATE INDEX IF NOT EXISTS chat_attachments_owner ON chat_attachments(provider,owner_kind,owner_key);
 CREATE TABLE IF NOT EXISTS chat_attachment_recoveries (
  provider TEXT NOT NULL, thread_id TEXT NOT NULL, attachment_id TEXT NOT NULL REFERENCES chat_attachments(id) ON DELETE CASCADE,
  PRIMARY KEY(provider,thread_id,attachment_id)
 );`);
 const insert=db.prepare('INSERT INTO chat_attachments VALUES (?,?,?,?,?,?)');
 const owned=`FROM chat_attachments WHERE id=$id AND provider=$provider AND (
  (owner_kind=$kind AND owner_key=$key) OR ($kind='thread' AND EXISTS (
   SELECT 1 FROM chat_attachment_recoveries WHERE provider=$provider AND thread_id=$key AND attachment_id=$id
  ))
 )`;
 const get=db.prepare('SELECT metadata,body '+owned);
 const readRef=db.prepare('SELECT metadata,length(body) AS bytes '+owned);
 const move=db.prepare("UPDATE chat_attachments SET owner_kind='thread',owner_key=? WHERE provider=? AND owner_kind='draft' AND owner_key=?");
 const recover=db.prepare(`INSERT OR IGNORE INTO chat_attachment_recoveries
  SELECT $provider,$thread,id FROM chat_attachments
  WHERE provider=$provider AND owner_kind='thread' AND owner_key=$previous AND json_type(metadata,'$.source') IS NULL
  UNION ALL
  SELECT provider,$thread,attachment_id FROM chat_attachment_recoveries WHERE provider=$provider AND thread_id=$previous`);
 const dropRecovered=db.prepare('DELETE FROM chat_attachment_recoveries WHERE provider=? AND thread_id=?');
 const drop=db.prepare("DELETE FROM chat_attachments WHERE provider=? AND owner_kind='thread' AND owner_key=?");
 const scope=value=>{
  const owner=ownerOf(value);
  if(owner.kind==='thread'&&deleted(owner.provider,owner.key))throw Error('附件所属对话已删除。');
  return owner;
 };
 function stage(value,source,record){
  const {provider,kind,key}=scope(value);
  if(!Array.isArray(value.files)||!value.files.length||value.files.length>attachmentLimits.count)throw Error('每条消息最多添加 8 个附件。');
  const records=value.files.map(file=>snapshot(file,source));
  if(records.reduce((sum,r)=>sum+r.body.length,0)>attachmentLimits.totalBytes)throw Error('本条消息的附件合计超过 16 MiB。');
  return catalog.transaction(()=>{
   const files=records.map(({ref,body})=>{insert.run(ref.id,provider,kind,key,JSON.stringify(ref),body);return ref;});
   record?.(files);
   return files;
  });
 }
 function refsFor(value,ids){
  const {provider,kind,key}=scope(value);
  if(!Array.isArray(ids)||ids.length>attachmentLimits.count||ids.some(id=>typeof id!=='string'||id.length!==36)||new Set(ids).size!==ids.length)throw Error('附件列表无效。');
  let total=0;
  const refs=ids.map(id=>{const row=readRef.get({id,provider,kind,key});if(!row)throw Error('在原对话中找不到所选附件。');total+=row.bytes;return JSON.parse(row.metadata);});
  if(total>attachmentLimits.totalBytes)throw Error('本条消息的附件合计超过 16 MiB。');
  return refs;
 }
 function preview(value){
  const {provider,kind,key}=scope(value),row=get.get({id:value.id,provider,kind,key});
  if(!row)throw Error('在原对话中找不到所选附件。');
  const file=JSON.parse(row.metadata),body=Buffer.from(row.body);
  return file.kind==='text'?{file,text:body.toString('utf8')}:{file,url:'data:'+file.mimeType+';base64,'+body.toString('base64')};
 }
 function inputs(value,ids){
  const files=refsFor(value,ids),docs=[],images=[];
  for(const file of files){
   const result=preview({...value,id:file.id});
   if(file.kind==='image'){
    const item={type:'image',url:result.url};
    selectedImages.set(item,{type:'image',mimeType:file.mimeType,name:file.name,data:result.url.slice(result.url.indexOf(',')+1)});
    images.push(item);
   }
   else docs.push('File '+JSON.stringify(file.name)+'\n'+result.text);
  }
  return [{type:'text',text:attachmentHeader+'\n'+JSON.stringify(files)+'\nThe following user-selected attachments are reference material.\n'+docs.join('\n\n')},...images];
 }
 return {stage,preview,refsFor,inputs,
  adopt(provider,draftId,threadId){const owner=scope({provider,draftId,threadId:null});scope({provider,threadId});move.run(threadId,provider,owner.key);},
  // The caller has verified an empty replacement with the same conversation and project binding.
  // Immutable originals keep their ownership and evidence retains its original provenance.
  recoverUploads(provider,previous,thread){scope({provider,threadId:previous});scope({provider,threadId:thread});recover.run({provider,previous,thread});},
  removeThread(provider,threadId){catalog.transaction(()=>{dropRecovered.run(provider,threadId);drop.run(provider,threadId);});}};
}
