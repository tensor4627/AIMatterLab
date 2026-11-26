// Renderer-only editing state. This never saves, validates or submits a worker run.
const sessions=new WeakMap();
const pendingRemovals=new WeakMap();
const inaccessibleStorage={getItem(){throw Error('Storage unavailable');},setItem(){throw Error('Storage unavailable');},removeItem(){throw Error('Storage unavailable');}};
const clone=value=>JSON.parse(JSON.stringify(value));
const PREFIX='studio.runReview.v1.';
export const REVIEW_DRAFT_LIMITS=Object.freeze({count:20,bytes:2*1024*1024});
function keys(storage){return Array.from({length:storage.length||0},(_,i)=>storage.key(i)).filter(key=>typeof key==='string'&&key.startsWith(PREFIX));}
function saveDraft(storage,key,raw,exclude=[]){
 const existing=keys(storage).filter(value=>value!==key&&!exclude.includes(value));
 if(existing.length>=REVIEW_DRAFT_LIMITS.count||existing.reduce((total,value)=>total+(value.length+(storage.getItem(value)||'').length)*2,(key.length+raw.length)*2)>REVIEW_DRAFT_LIMITS.bytes)throw Error('Review draft storage budget reached');
 storage.setItem(key,raw);
}
const strings=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([key,text])=>!['__proto__','constructor','prototype'].includes(key)&&typeof text==='string');
function valid(value){
 if(!value||typeof value.name!=='string'||typeof value.environment!=='string'||!Number.isFinite(value.gpu)||!Number.isFinite(value.seconds)||!strings(value.inputs)||!strings(value.edits)||typeof value.parameters!=='string')return false;
 try{const parsed=JSON.parse(value.parameters);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed);}catch{return false;}
}
export function reviewValues(run){return {name:run.name,environment:run.environment_id,gpu:run.gpu,seconds:run.max_seconds,inputs:Object.fromEntries(Object.keys(run.inputs).map(name=>[name,run.directory+'/simulation/'+name])),parameters:JSON.stringify(run.parameters||{},null,2),edits:{}};}
export function reviewDraftIdentity(scope,run){return JSON.stringify([scope,run.id,run.project_id,run.environment_id,run.directory,run.engine,run.created_at]);}
export function reviewDraftKey(scope,run){return PREFIX+encodeURIComponent(reviewDraftIdentity(scope,run));}
export class RunReviewDraft{
 constructor(scope,run,storage,legacyScopes=[]){
  this.identity=reviewDraftIdentity(scope,run);this.key=PREFIX+encodeURIComponent(this.identity);this.baseline=reviewValues(run);this.fingerprint=JSON.stringify(this.baseline);this.inputHashes=JSON.stringify(run.inputs);this.values=clone(this.baseline);this.error=false;this.conflict=false;this.saved=null;this.legacyKeys=[];
  try{this.storage=typeof storage==='function'?storage():storage;}catch{this.storage=inaccessibleStorage;this.error=true;}storage=this.storage;
  let memory=sessions.get(storage);if(!memory){memory=new Map();sessions.set(storage,memory);}this.memory=memory;
  let removals=pendingRemovals.get(storage);if(!removals){removals=new Map();pendingRemovals.set(storage,removals);}this.removals=removals;
  const cached=memory.get(this.key);let raw=cached?.raw;if(cached&&!cached.durable)this.error=true;if(!raw)try{raw=storage.getItem(this.key);}catch{this.error=true;}
  if(!raw)try{
   const candidates=[...new Set(legacyScopes)].map(legacy=>{const identity=reviewDraftIdentity(legacy,run),key=PREFIX+encodeURIComponent(identity);return {identity,key,raw:memory.get(key)?.raw||storage.getItem(key)};}).filter(value=>value.key!==this.key&&value.raw);
   this.legacyKeys=candidates.map(value=>value.key);
   if(candidates.length){
    const values=candidates.map(value=>{const saved=JSON.parse(value.raw);if(saved.schema!==1||saved.identity!==value.identity||typeof saved.baseline!=='string'||!valid(saved.values))throw Error('Invalid legacy review draft');return {...saved,identity:this.identity};});
    if(values.some(value=>JSON.stringify(value)!==JSON.stringify(values[0])))throw Error('Multiple different legacy review drafts');
    raw=JSON.stringify(values[0]);
   }
  }catch{this.conflict=true;}
  if(raw){try{const saved=JSON.parse(raw);if(saved.schema!==1||saved.identity!==this.identity||typeof saved.baseline!=='string'||!valid(saved.values))throw Error('Invalid run review draft');this.saved=saved;if(saved.baseline===this.fingerprint&&(saved.inputHashes===undefined||saved.inputHashes===this.inputHashes))this.values=clone(saved.values);else this.conflict=true;}catch{this.conflict=true;}}
  if(this.legacyKeys.length&&!this.conflict)this.stage({});
 }
 get dirty(){return JSON.stringify(this.values)!==this.fingerprint;}
 stage(changes){
  if(this.conflict)return false;
  this.removals.delete(this.key);
  this.values={...this.values,...changes};
  const raw=JSON.stringify({schema:1,identity:this.identity,baseline:this.fingerprint,inputHashes:this.inputHashes,values:this.values});
  // Keep the current session recoverable even when browser quota is exhausted.
  this.memory.set(this.key,{raw,durable:false});
  try{
   if(this.dirty)saveDraft(this.storage,this.key,raw,this.legacyKeys);else this.storage.removeItem(this.key);
   for(const key of this.legacyKeys){this.storage.removeItem(key);this.memory.delete(key);this.removals.delete(key);}this.legacyKeys=[];
   // Durable entries can be read from storage and need not accumulate in memory.
   this.memory.delete(this.key);this.error=false;
  }catch{this.error=true;}
  if(!this.dirty&&!this.error)this.memory.delete(this.key);
  return true;
 }
 reset(){
  this.legacyKeys=[];this.values=clone(this.baseline);this.saved=null;this.error=false;this.conflict=false;
 }
 discard(){
  try{for(const key of [this.key,...this.legacyKeys]){this.storage.removeItem(key);this.memory.delete(key);this.removals.delete(key);}this.reset();return true;}catch{this.error=true;return false;}
 }
 discardWithUndo(){
  const removal=this.removeWithUndo([this.key,...this.legacyKeys]);
  if(removal)this.reset();
  return removal;
 }
 clearOtherDraftsWithUndo(){
  try{
   const other=[...new Set([...keys(this.storage),...this.memory.keys()])].filter(key=>key!==this.key&&!this.legacyKeys.includes(key));
   return this.removeWithUndo(other);
  }catch{this.error=true;return null;}
 }
 removeWithUndo(keysToRemove){
  const removed=[];
  const restoreSnapshot=({key,durable,cached})=>{
   if(durable!==null)try{saveDraft(this.storage,key,durable);}catch{
    this.memory.set(key,{raw:cached?.raw??durable,durable:false});
    return false;
   }
   if(cached)this.memory.set(key,cached);
   return !cached||cached.durable;
  };
  try{
   for(const key of keysToRemove){
    const durable=this.storage.getItem(key),cached=this.memory.get(key);
    this.storage.removeItem(key);
    this.memory.delete(key);
    if(durable!==null||cached)removed.push({key,durable,cached});
   }
  }catch{
   for(const entry of removed)restoreSnapshot(entry);
   this.error=true;return null;
  }
  for(const entry of removed)this.removals.set(entry.key,entry);
  const release=()=>{
   for(const entry of removed)if(this.removals.get(entry.key)===entry)this.removals.delete(entry.key);
  };
  return {count:removed.length,release,restore:()=>{
   const restored=[];let memoryOnly=0;
   try{
    for(const entry of removed){
     try{
      if(this.removals.get(entry.key)!==entry||this.memory.has(entry.key)||this.storage.getItem(entry.key)!==null)continue;
      if(!restoreSnapshot(entry))memoryOnly++;
      restored.push(entry.key);
     }catch{}
    }
   }finally{release();}
   return {restored,skipped:removed.length-restored.length,memoryOnly};
  }};
 }
 clearOtherDrafts(){const removal=this.clearOtherDraftsWithUndo();removal?.release();return !!removal;}
}
