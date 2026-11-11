import {useSyncExternalStore} from 'react';

// Renderer-session memory only. Private authoring text is never copied to storage
// or sent to a provider. Keys include the owning task and editor identity.
export interface SessionDraft<T>{version:number;value:T}
const values=new Map<string,SessionDraft<unknown>>(),listeners=new Set<()=>void>();
const deletedTasks=new Set<string>();
const saves=new Map<string,number>();
let version=0;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function changed(){for(const listener of listeners)listener();}
export function readSessionDraft<T>(key:string){return values.get(key) as SessionDraft<T>|undefined;}
function taskOwner(key:string):string|undefined{
 if(key.startsWith('private-cv:')){try{return decodeURIComponent(key.split(':')[1]);}catch{return;}}
 try{const parts=JSON.parse(key);if(Array.isArray(parts)&&['stage-editor','consumer-stage-choice','custom-cv-choice'].includes(parts[0])&&typeof parts[1]==='string')return parts[1];}catch{}
}
export function writeSessionDraft<T>(key:string,value:T){const next={version:++version,value:structuredClone(value)};const task=taskOwner(key);if(task!==undefined&&deletedTasks.has(task))return next;values.set(key,next);changed();return next;}
export function clearSessionDraft(key:string,expectedVersion?:number){if(expectedVersion!==undefined&&values.get(key)?.version!==expectedVersion)return false;const removed=values.delete(key);if(removed)changed();return removed;}
export function useSessionDraft<T>(key:string){return useSyncExternalStore(subscribe,()=>readSessionDraft<T>(key),()=>undefined);}
export function useSessionDraftPresence(prefix:string){return useSyncExternalStore(subscribe,()=>[...values.keys()].some(key=>key.startsWith(prefix)),()=>false);}
export const isSessionDraftSaving=(key:string)=>saves.has(key);
export function useSessionDraftSaving(key:string){return useSyncExternalStore(subscribe,()=>isSessionDraftSaving(key),()=>false);}
export function beginSessionDraftSave(key:string){const task=taskOwner(key);if(saves.has(key)||task!==undefined&&deletedTasks.has(task))return null;const token=++version;saves.set(key,token);changed();return token;}
export function endSessionDraftSave(key:string,token:number){if(saves.get(key)!==token)return;saves.delete(key);changed();}
export function useSessionDraftKeys(matches:(key:string,value:unknown)=>boolean):string[]{
 const keys=useSyncExternalStore(subscribe,()=>JSON.stringify([...new Set([...values.keys(),...saves.keys()])].filter(key=>matches(key,values.get(key)?.value))),()=>'[]');return JSON.parse(keys);
}
/** Call only after the desktop confirms deletion of these task-owned records. */
export function clearTaskSessionDrafts(taskId:string){deletedTasks.add(taskId);let removed=false;for(const key of new Set([...values.keys(),...saves.keys()]))if(taskOwner(key)===taskId){removed=values.delete(key)||removed;removed=saves.delete(key)||removed;}if(removed)changed();}
