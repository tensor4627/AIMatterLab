import {useSyncExternalStore} from 'react';
import {type PygasTaskResult} from '../../../contracts/dto/pygas';
import type {CanonicalGraph,OrderingReview} from './pygas-composer-types';
const prefix='studio.pygas.draft.v1:';
const drafts=new Map<string,string>(),listeners=new Set<()=>void>();
const deletedTasks=new Set<string>();
function changed(){for(const listener of listeners)listener();}
function subscribe(listener:()=>void){listeners.add(listener);window.addEventListener('storage',listener);return()=>{listeners.delete(listener);window.removeEventListener('storage',listener);};}
function taskPrefix(taskId:string){return prefix+encodeURIComponent(taskId)+':';}
export function isTaskPygasDirty(taskId:string){if(deletedTasks.has(taskId))return false;const start=taskPrefix(taskId);if([...drafts.keys()].some(key=>key.startsWith(start)))return true;try{for(let i=0;i<localStorage.length;i++)if(localStorage.key(i)?.startsWith(start))return true;}catch{}return false;}
export function useTaskPygasDirty(taskId:string){return useSyncExternalStore(subscribe,()=>isTaskPygasDirty(taskId),()=>false);}
export function clearTaskPygasDrafts(taskId:string){const start=taskPrefix(taskId);for(const key of [...drafts.keys()])if(key.startsWith(start))drafts.delete(key);try{for(const key of Object.keys(localStorage))if(key.startsWith(start))localStorage.removeItem(key);}catch{}changed();}
export function deleteTaskPygasDrafts(taskId:string){deletedTasks.add(taskId);clearTaskPygasDrafts(taskId);}
function draftKey(taskId:string,path:string){return taskPrefix(taskId)+encodeURIComponent(path);}
export function baseIdentity(data:PygasTaskResult){return JSON.stringify([data.composition?.expected.journal_sha256,Object.entries(data.composition?.expected.files||{}).sort(),Object.entries(data.catalog.source.files).sort()]);}
export function retainDraft(data:PygasTaskResult,graph:CanonicalGraph,ordering:OrderingReview|null){
 if(!data.composition||deletedTasks.has(data.taskId))return;const key=draftKey(data.taskId,data.composition.graphPath),text=JSON.stringify({base:baseIdentity(data),graph,ordering});
 if(text.length>1048576)throw Error('Local composition draft exceeds the 1 MiB editor limit');drafts.delete(key);drafts.set(key,text);while(drafts.size>32)drafts.delete(drafts.keys().next().value!);try{localStorage.setItem(key,text);}catch{}changed();
}
export function readDraft(data:PygasTaskResult){if(!data.composition||deletedTasks.has(data.taskId))return null;const key=draftKey(data.taskId,data.composition.graphPath);try{const text=drafts.get(key)||localStorage.getItem(key);if(!text||text.length>1048576)return null;const value=JSON.parse(text);if(typeof value.base!=='string'||!value.graph||!Array.isArray(value.graph.nodes)||!Array.isArray(value.graph.edges)||value.graph.nodes.length>128||value.graph.edges.length>512)return null;return value as {base:string;graph:CanonicalGraph;ordering:OrderingReview|null};}catch{return null;}}
export function clearDraft(data:PygasTaskResult){if(!data.composition)return;const key=draftKey(data.taskId,data.composition.graphPath);drafts.delete(key);try{localStorage.removeItem(key);}catch{}changed();}
