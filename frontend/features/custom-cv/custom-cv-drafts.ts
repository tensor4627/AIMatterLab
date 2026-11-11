import {readSessionDraft,useSessionDraft,useSessionDraftKeys} from '../../ui/session-drafts';
import type {CustomEntry,Expected,FormulaSpec,ParamValue} from './custom-cv-types';
export interface CustomCvDraft {spec:FormulaSpec;values:Record<string,ParamValue>;base:Expected}
const prefix=(taskId:string)=>'private-cv:'+encodeURIComponent(taskId)+':';
export const customCvDraftKey=(taskId:string,entryId:string)=>prefix(taskId)+encodeURIComponent(entryId);
export const customCvChoiceKey=(taskId:string)=>JSON.stringify(['custom-cv-choice',taskId]);
export function useTaskCustomCvDrafts(taskId:string){
 const keys=useSessionDraftKeys(key=>key.startsWith(prefix(taskId)));
 return keys.map(key=>({id:decodeURIComponent(key.slice(prefix(taskId).length)),name:readSessionDraft<CustomCvDraft>(key)?.value.spec.name||decodeURIComponent(key.slice(prefix(taskId).length))}));
}
export function useTaskCustomCvDirty(taskId:string,attachedId?:string){
 const selected=useSessionDraft<string>(customCvChoiceKey(taskId)),related=attachedId||selected?.value;
 return useSessionDraftKeys(key=>!!related&&key===customCvDraftKey(taskId,related)).length>0;
}
export function sameDraftValue(a:unknown,b:unknown):boolean{
 if(Object.is(a,b))return true;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>sameDraftValue(value,b[index]));
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 const left=Object.keys(a).sort(),right=Object.keys(b).sort();
 return left.length===right.length&&left.every((key,index)=>key===right[index]&&sameDraftValue((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key]));
}
export const customDraftMatches=(draft:CustomCvDraft,entry:CustomEntry)=>sameDraftValue(draft.spec,entry.spec)&&sameDraftValue(draft.values,entry.parameterValues);
export function customDraftDifferences(draft:CustomCvDraft,entry:CustomEntry){
 const groups=[['definition',entry.spec,draft.spec],['parameter',entry.parameterValues,draft.values]] as const;
 return groups.flatMap(([group,saved,local])=>[...new Set([...Object.keys(saved),...Object.keys(local)])].filter(key=>!sameDraftValue((saved as Record<string,unknown>)[key],(local as Record<string,unknown>)[key])).map(key=>({group,key,saved:(saved as Record<string,unknown>)[key],local:(local as Record<string,unknown>)[key]})));
}
