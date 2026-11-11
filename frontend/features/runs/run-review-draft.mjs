// Renderer-only editing state. This never saves, validates or submits a worker run.
const sessions=new WeakMap();
const inaccessibleStorage={getItem(){throw Error('Storage unavailable');},setItem(){throw Error('Storage unavailable');},removeItem(){throw Error('Storage unavailable');}};
const clone=value=>JSON.parse(JSON.stringify(value));
const PREFIX='studio.runReview.v1.';
export const REVIEW_DRAFT_LIMITS=Object.freeze({count:20,bytes:2*1024*1024});
function keys(storage){return Array.from({length:storage.length||0},(_,i)=>storage.key(i)).filter(key=>typeof key==='string'&&key.startsWith(PREFIX));}
const strings=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([key,text])=>!['__proto__','constructor','prototype'].includes(key)&&typeof text==='string');
function valid(value){
 if(!value||typeof value.name!=='string'||typeof value.environment!=='string'||!Number.isFinite(value.gpu)||!Number.isFinite(value.seconds)||!strings(value.inputs)||!strings(value.edits)||typeof value.parameters!=='string')return false;
 try{const parsed=JSON.parse(value.parameters);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed);}catch{return false;}
}
export function reviewValues(run){return {name:run.name,environment:run.environment_id,gpu:run.gpu,seconds:run.max_seconds,inputs:Object.fromEntries(Object.keys(run.inputs).map(name=>[name,run.directory+'/simulation/'+name])),parameters:JSON.stringify(run.parameters||{},null,2),edits:{}};}
export function reviewDraftIdentity(scope,run){return JSON.stringify([scope,run.id,run.project_id,run.environment_id,run.directory,run.engine,run.created_at]);}
export class RunReviewDraft{
 constructor(scope,run,storage,legacyScopes=[]){
  this.identity=reviewDraftIdentity(scope,run);this.key=PREFIX+encodeURIComponent(this.identity);this.baseline=reviewValues(run);this.fingerprint=JSON.stringify(this.baseline);this.inputHashes=JSON.stringify(run.inputs);this.values=clone(this.baseline);this.error=false;this.conflict=false;this.saved=null;this.legacyKeys=[];
  try{this.storage=typeof storage==='function'?storage():storage;}catch{this.storage=inaccessibleStorage;this.error=true;}storage=this.storage;
  let memory=sessions.get(storage);if(!memory){memory=new Map();sessions.set(storage,memory);}this.memory=memory;
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
  this.values={...this.values,...changes};
  const raw=JSON.stringify({schema:1,identity:this.identity,baseline:this.fingerprint,inputHashes:this.inputHashes,values:this.values});
  // Keep the current session recoverable even when browser quota is exhausted.
  this.memory.set(this.key,{raw,durable:false});
  try{
   if(this.dirty){const existing=keys(this.storage).filter(key=>key!==this.key&&!this.legacyKeys.includes(key));if(existing.length>=REVIEW_DRAFT_LIMITS.count||existing.reduce((total,key)=>total+(key.length+(this.storage.getItem(key)||'').length)*2,(this.key.length+raw.length)*2)>REVIEW_DRAFT_LIMITS.bytes)throw Error('Review draft storage budget reached');this.storage.setItem(this.key,raw);}else this.storage.removeItem(this.key);
   for(const key of this.legacyKeys){this.storage.removeItem(key);this.memory.delete(key);}this.legacyKeys=[];
   // Durable entries can be read from storage and need not accumulate in memory.
   this.memory.delete(this.key);this.error=false;
  }catch{this.error=true;}
  if(!this.dirty&&!this.error)this.memory.delete(this.key);
  return true;
 }
 discard(){
  try{for(const key of [this.key,...this.legacyKeys]){this.storage.removeItem(key);this.memory.delete(key);}this.legacyKeys=[];this.values=clone(this.baseline);this.saved=null;this.error=false;this.conflict=false;return true;}catch{this.error=true;return false;}
 }
 clearOtherDrafts(){try{for(const key of new Set([...keys(this.storage),...this.memory.keys()]))if(key!==this.key&&!this.legacyKeys.includes(key)){this.storage.removeItem(key);this.memory.delete(key);}return true;}catch{this.error=true;return false;}}
}
