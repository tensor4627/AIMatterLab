import type {StageInspection,ConsumerStageInspection} from '../../../contracts/dto/stage';
import {isSessionDraftSaving,useSessionDraftKeys} from '../../ui/session-drafts';
export interface StageEditorDraft<T extends StageInspection|ConsumerStageInspection>{inspection:T;values:Record<string,unknown>;selected:string;potential?:string;history?:string;selectionAssets?:ConsumerStageInspection['assets'];dirty:boolean;uncertain?:boolean}
export const stageDraftKey=(taskId:string,engine:string)=>JSON.stringify(['stage-editor',taskId,engine]);
export function useTaskStageDrafts(taskId:string){
 const keys=useSessionDraftKeys((key,value)=>{
  try{const [kind,owner,engine]=JSON.parse(key),draft=value as StageEditorDraft<StageInspection|ConsumerStageInspection>;return kind==='stage-editor'&&owner===taskId&&['pygas.build','bias.validate','gpumd.sampling'].includes(engine)&&(isSessionDraftSaving(key)||draft?.inspection?.taskId===taskId&&!!(draft.dirty||draft.uncertain));}catch{return false;}
 });return keys.map(key=>JSON.parse(key)[2] as string);
}
export function sourceChanged(a:StageInspection|ConsumerStageInspection,b:StageInspection|ConsumerStageInspection){
 if(a.parameterRevision!==b.parameterRevision)return true;
 return JSON.stringify('contract' in a?[a.contract,a.provenance,a.files]:[a.source,a.producer])!==JSON.stringify('contract' in b?[b.contract,b.provenance,b.files]:[b.source,b.producer]);
}
export function rebaseStageValues(draft:StageEditorDraft<StageInspection|ConsumerStageInspection>,next:StageInspection|ConsumerStageInspection){
 const values={...next.values};
 for(const field of next.fields)if(!next.readOnly.includes(field.key)&&Object.hasOwn(draft.values,field.key))values[field.key]=draft.values[field.key];
 return values;
}
export function rebindStageAsset(id:string|undefined,previous:ConsumerStageInspection['assets'],next:ConsumerStageInspection['assets']){
 if(!id)return '';const original=previous.find(asset=>asset.id===id);if(!original)return id;
 const matches=next.filter(asset=>asset.name===original.name&&asset.sha256===original.sha256&&asset.size===original.size);
 return matches.length===1?matches[0].id:id;
}
