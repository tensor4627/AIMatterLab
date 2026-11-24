import {taskOutboxes} from './task-outboxes.mjs';
import {fieldPath,setParameter} from "../../../contracts/workflows/task-fields.mjs";
export class DraftOutbox{
 constructor(id,storage,restore=true){this.id=id;this.storage=storage;this.key='studio.pending.'+id;this.seq=0;this.entries={};this.corrupt=null;if(!restore)return;const raw=storage.getItem(this.key);if(raw){try{const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid pending draft');const entries={};let seq=0;for(const [key,entry] of Object.entries(value)){fieldPath(key);if(!entry||typeof entry!=='object'||!Number.isSafeInteger(entry.seq)||entry.seq<1)throw Error('Invalid pending draft');seq=Math.max(seq,entry.seq);entries[key]=entry;}this.seq=seq;this.entries=entries;}catch{/* Keep the unreadable bytes as evidence instead of crashing the editor. */this.corrupt=raw;try{storage.setItem(this.key+'.corrupt',raw);storage.removeItem(this.key);}catch{}}}}
 get pendingCount(){return Object.keys(this.entries).length;}
 get activeSave(){return this.flight||null;}
 invalidate(){this.deleted=true;this.entries={};this.corrupt=null;try{this.storage.removeItem(this.key);this.storage.removeItem(this.key+'.corrupt');}catch{}}
 persist(entries){if(this.deleted)return;if(Object.keys(entries).length)this.storage.setItem(this.key,JSON.stringify(entries));else this.storage.removeItem(this.key);}
 stage(key,value){if(this.deleted)throw Error('This workflow was deleted');fieldPath(key);const entries={...this.entries,[key]:{seq:++this.seq,value}};if(Object.keys(entries).length>100||JSON.stringify(entries).length>200000)throw Error('Pending draft is too large');this.persist(entries);this.entries=entries;}
 apply(parameters){let result=parameters;for(const [key,entry] of Object.entries(this.entries))result=setParameter(result,key,entry.value);return result;}
 async flush(save){
  if(this.deleted)throw Error('This workflow was deleted');
  if(this.flight)return this.flight;
  this.flight=(async()=>{let saved;while(this.pendingCount){const snapshot={...this.entries};saved=await save(Object.fromEntries(Object.entries(snapshot).map(([key,entry])=>[key,entry.value])));if(this.deleted)return;if(!saved||saved.id!==this.id||!saved.parameters)throw Error('Draft save was not acknowledged');const remaining={...this.entries};for(const [key,entry] of Object.entries(snapshot))if(remaining[key]?.seq===entry.seq)delete remaining[key];this.persist(remaining);this.entries=remaining;}return saved;})().finally(()=>{this.flight=null;});return this.flight;
 }
}

export const {get:workflowOutbox,remove:deleteWorkflowOutbox}=taskOutboxes(DraftOutbox);
