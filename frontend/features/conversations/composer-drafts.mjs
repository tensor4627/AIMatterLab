import {validAttachmentRef,attachmentLimits,attachmentsAfterReplacement} from '../../../contracts/agent/chat-attachments.mjs';
// Draft storage holds text and opaque references. File bytes stay in the desktop profile.
const providers=new Set(['codex','kimi','qwen','deepseek','compatible']);

const prefix='studio.composer.v1.';

export function createComposerDrafts(storage,createId=()=>crypto.randomUUID()){
 const read=key=>{try{return storage().getItem(key);}catch{return null;}};
 const write=(key,value)=>{try{storage().setItem(key,value);return true;}catch{return false;}};
 const remove=key=>{try{storage().removeItem(key);return true;}catch{return false;}};
 const entries=new Map(),newIds=new Map();
 const keyFor=(provider,kind,id)=>prefix+JSON.stringify([provider,kind,id]);
 function load(provider,threadId,fresh=false){
  let id=threadId;
  if(!id){const pointer=prefix+'new.'+provider;id=!fresh&&(newIds.get(provider)||read(pointer))||createId();newIds.set(provider,id);write(pointer,id);}
  const key=keyFor(provider,threadId?'thread':'new',id);
  if(entries.has(key))return entries.get(key);
  let text='',files=[];try{const saved=JSON.parse(read(key));if(!threadId&&saved?.migratedTo)return load(provider,null,true);if(saved?.version===1&&typeof saved.text==='string'){text=saved.text;if(Array.isArray(saved.files))files=saved.files.filter(validAttachmentRef);}}catch{/* Ignore malformed or unavailable storage. */}
  const entry={provider,threadId:threadId||null,blankId:threadId?null:id,key,text,files,revision:0,deleted:false,backups:new Set()};entries.set(key,entry);return entry;
 }
 const selected=read('studio.conversation'),separator=selected?.indexOf(':')??-1;
 const selectedProvider=separator>0?selected.slice(0,separator):null;
 const provider=providers.has(selectedProvider)?selectedProvider:providers.has(read(prefix+'provider'))?read(prefix+'provider'):'codex';
 let active=load(provider,providers.has(selectedProvider)&&separator<selected.length-1?selected.slice(separator+1):null);
 function save(entry){
  if(entry.deleted)return false;
  const data={version:1,text:entry.text,...entry.files.length?{files:entry.files}:{}};
  const saved=write(entry.key,JSON.stringify(data));
  for(const key of entry.backups){if(saved&&remove(key))entry.backups.delete(key);else write(key,JSON.stringify({...data,migratedTo:entry.threadId}));}
  return saved;
 }
 function activate(provider,threadId=null,fresh=false){active=load(provider,threadId,fresh);write(prefix+'provider',provider);return active.text;}
 function edit(text){active.text=text;active.revision++;save(active);return text;}
 function seed(provider,threadId,text){
  const entry=load(provider,threadId);
  if(entry.deleted||entry.text||entry.revision)return false;
  entry.text=text;entry.revision++;save(entry);return true;
 }
 function capture(){return {entry:active,key:active.key,revision:active.revision,text:active.text,files:[...active.files]};}
 function acknowledge(snapshot){
  const entry=snapshot.entry;if(entry.deleted)return false;
  const match=entry.revision===snapshot.revision&&entry.text===snapshot.text;
  const sent=new Set((snapshot.files||[]).map(file=>file.id)),files=entry.files.filter(file=>!sent.has(file.id));
  if(!match&&files.length===entry.files.length)return false;
  entry.files=files;if(match){entry.text='';entry.revision++;}save(entry);return match;
 }
 function appendFiles(entry,files){
  const merged=new Map(entry.files.map(file=>[file.id,file]));
  for(const file of files){if(!validAttachmentRef(file))throw Error('附件引用无效。');merged.set(file.id,file);}
  if(merged.size>attachmentLimits.count)throw Error('每条消息最多添加 8 个附件。');
  entry.files=[...merged.values()];
 }
 function addToSnapshot(snapshot,files){
  const entry=snapshot.entry;
  if(entry.deleted||snapshot.key!==entry.key)return false;
  appendFiles(entry,files);save(entry);return true;
 }
 function addFiles(files){appendFiles(active,files);save(active);}
 function removeFile(id){active.files=active.files.filter(file=>file.id!==id);save(active);}
 function appendToDraft(provider,threadId,text,files=[],{requireStorage=false}={}){
  const entry=load(provider,threadId),previous={text:entry.text,files:entry.files,revision:entry.revision};
  appendFiles(entry,files);
  if(text){entry.text=[entry.text,text].filter(Boolean).join('\n\n');entry.revision++;}
  if(!save(entry)&&requireStorage){Object.assign(entry,previous);throw Error('无法保存草稿，消息仍在队列中。');}
  return active.text;
 }
 function retain(snapshot,text){const entry=snapshot.entry;if(snapshot.text||entry.deleted||entry.revision!==snapshot.revision||entry.text!==snapshot.text)return false;entry.text=text;entry.revision++;save(entry);return true;}
 function rebind(snapshot,threadId,files=snapshot.entry.files){
  const entry=snapshot.entry;if(entry.deleted||entry.threadId===threadId)return;
  const next=load(entry.provider,threadId);
  // A target already edited in this renderer wins. Preserve the source separately.
  if(next!==entry&&(next.revision>0||next.text||next.files.length)){if(active===entry)active=next;return;}
  const previous=entry.key,wasNew=!entry.threadId;entry.backups.add(previous);entry.key=next.key;entry.threadId=threadId;entry.files=files;entries.set(entry.key,entry);save(entry);
  if(wasNew){entries.delete(previous);const id=createId();newIds.set(entry.provider,id);write(prefix+'new.'+entry.provider,id);}
 }
 function rekey(provider,oldThreadId,newThreadId,uploadsRetained){
  const old=load(provider,oldThreadId);
  if(old.threadId!==oldThreadId||oldThreadId===newThreadId)return {text:active.text,attachmentReview:false};
  const visible=active===old,originalCount=old.files.length;
  rebind({entry:old},newThreadId,attachmentsAfterReplacement(old.files,uploadsRetained));
  return {text:active.text,attachmentReview:visible&&originalCount>(active===old?old.files.length:0)};
 }
 function discard(provider,threadId){
  const key=keyFor(provider,'thread',threadId),candidate=entries.get(key),entry=candidate?.threadId===threadId?candidate:null;remove(key);entries.delete(key);candidate?.backups.delete(key);
  if(entry){entry.deleted=true;for(const backup of entry.backups)remove(backup);entry.backups.clear();for(const [alias,value] of entries)if(value===entry){entries.delete(alias);remove(alias);}}
  if(active===entry)activate(provider,null,true);
  return active.text;
 }
 return {activate,edit,seed,capture,acknowledge,retain,rebind,rekey,discard,addFiles,addToSnapshot,removeFile,appendToDraft,files:()=>active.files,text:()=>active.text,owner:()=>({provider:active.provider,threadId:active.threadId}),
  attachmentOwner:()=>({provider:active.provider,threadId:active.threadId,...active.threadId?{}:{draftId:active.blankId}})};
}
