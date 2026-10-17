import {fieldPath,setParameter} from './task-fields.mjs';
// Browser storage is an outbox only. The main-process record remains authoritative.
export class DraftOutbox{
 constructor(id,storage){this.id=id;this.storage=storage;this.key='studio.pending.'+id;this.seq=0;this.entries={};const raw=storage.getItem(this.key);if(raw){const value=JSON.parse(raw);for(const [key,entry] of Object.entries(value)){fieldPath(key);if(!Number.isSafeInteger(entry.seq)||entry.seq<1)throw Error('Invalid pending draft');this.seq=Math.max(this.seq,entry.seq);this.entries[key]=entry;}}}
 get pendingCount(){return Object.keys(this.entries).length;}
 persist(entries){if(Object.keys(entries).length)this.storage.setItem(this.key,JSON.stringify(entries));else this.storage.removeItem(this.key);}
 stage(key,value){fieldPath(key);const entries={...this.entries,[key]:{seq:++this.seq,value}};if(Object.keys(entries).length>100||JSON.stringify(entries).length>200000)throw Error('Pending draft is too large');this.persist(entries);this.entries=entries;}
 apply(parameters){let result=parameters;for(const [key,entry] of Object.entries(this.entries))result=setParameter(result,key,entry.value);return result;}
 async flush(save){
  if(this.flight)return this.flight;
  this.flight=(async()=>{let saved;while(this.pendingCount){const snapshot={...this.entries};saved=await save(Object.fromEntries(Object.entries(snapshot).map(([key,entry])=>[key,entry.value])));if(!saved||saved.id!==this.id||!saved.parameters)throw Error('Draft save was not acknowledged');const remaining={...this.entries};for(const [key,entry] of Object.entries(snapshot))if(remaining[key]?.seq===entry.seq)delete remaining[key];this.persist(remaining);this.entries=remaining;}return saved;})().finally(()=>{this.flight=null;});return this.flight;
 }
}
