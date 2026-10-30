// Renderer-only unsent text. Storage failure leaves the in-memory draft usable.
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
  let text='';try{const saved=JSON.parse(read(key));if(!threadId&&saved?.migratedTo)return load(provider,null,true);if(saved?.version===1&&typeof saved.text==='string')text=saved.text;}catch{/* Ignore malformed or unavailable storage. */}
  const entry={provider,threadId:threadId||null,key,text,revision:0,deleted:false,backups:new Set()};entries.set(key,entry);return entry;
 }
 const selected=read('studio.conversation'),separator=selected?.indexOf(':')??-1;
 const selectedProvider=separator>0?selected.slice(0,separator):null;
 const provider=providers.has(selectedProvider)?selectedProvider:providers.has(read(prefix+'provider'))?read(prefix+'provider'):'codex';
 let active=load(provider,providers.has(selectedProvider)&&separator<selected.length-1?selected.slice(separator+1):null);
 function save(entry){
  if(entry.deleted)return false;
  const saved=write(entry.key,JSON.stringify({version:1,text:entry.text}));
  for(const key of entry.backups){if(saved&&remove(key))entry.backups.delete(key);else write(key,JSON.stringify({version:1,text:entry.text,migratedTo:entry.threadId}));}
  return saved;
 }
 function activate(provider,threadId=null,fresh=false){active=load(provider,threadId,fresh);write(prefix+'provider',provider);return active.text;}
 function edit(text){active.text=text;active.revision++;save(active);return text;}
 function capture(){return {entry:active,revision:active.revision,text:active.text};}
 function acknowledge(snapshot){const entry=snapshot.entry;if(entry.deleted||entry.revision!==snapshot.revision||entry.text!==snapshot.text)return false;entry.text='';entry.revision++;save(entry);return true;}
 function retain(snapshot,text){const entry=snapshot.entry;if(snapshot.text||entry.deleted||entry.revision!==snapshot.revision||entry.text!==snapshot.text)return false;entry.text=text;entry.revision++;save(entry);return true;}
 function rebind(snapshot,threadId){
  const entry=snapshot.entry;if(entry.deleted||entry.threadId===threadId)return;
  const next=load(entry.provider,threadId);
  // A target already edited in this renderer wins. Preserve the source separately.
  if(next!==entry&&(next.revision>0||next.text)){if(active===entry)active=next;return;}
  const previous=entry.key,wasNew=!entry.threadId;entry.backups.add(previous);entry.key=next.key;entry.threadId=threadId;entries.set(entry.key,entry);save(entry);
  if(wasNew){entries.delete(previous);const id=createId();newIds.set(entry.provider,id);write(prefix+'new.'+entry.provider,id);}
 }
 function rekey(provider,oldThreadId,newThreadId){const old=entries.get(keyFor(provider,'thread',oldThreadId))||load(provider,oldThreadId);rebind({entry:old},newThreadId);return active.text;}
 function discard(provider,threadId){
  const key=keyFor(provider,'thread',threadId),candidate=entries.get(key),entry=candidate?.threadId===threadId?candidate:null;remove(key);entries.delete(key);candidate?.backups.delete(key);
  if(entry){entry.deleted=true;for(const backup of entry.backups)remove(backup);entry.backups.clear();for(const [alias,value] of entries)if(value===entry){entries.delete(alias);remove(alias);}}
  if(active===entry)activate(provider,null,true);
  return active.text;
 }
 return {activate,edit,capture,acknowledge,retain,rebind,rekey,discard,text:()=>active.text,owner:()=>({provider:active.provider,threadId:active.threadId})};
}
