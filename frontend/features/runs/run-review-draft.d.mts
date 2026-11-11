import type {Run} from '../../../contracts/dto/runs';
export interface ReviewValues {name:string;environment:string;gpu:number;seconds:number;inputs:Record<string,string>;parameters:string;edits:Record<string,string>}
export function reviewValues(run:Run):ReviewValues;
export function reviewDraftIdentity(scope:string,run:Run):string;
export class RunReviewDraft {
 constructor(scope:string,run:Run,storage:Storage|(()=>Storage),legacyScopes?:string[]);
 identity:string;key:string;fingerprint:string;inputHashes:string;baseline:ReviewValues;values:ReviewValues;error:boolean;conflict:boolean;saved:{values:ReviewValues}|null;
 readonly dirty:boolean;
 stage(changes:Partial<ReviewValues>):boolean;
 discard():boolean;
 clearOtherDrafts():boolean;
}
