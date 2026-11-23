import type {JsonDraft} from '../../ui/json-draft.mjs';

export function inspectResumeParameters(source:string):{document:JsonDraft;parameters:Record<string,unknown>;issue:string|null};
export function parseResumeParameters(source:string,options?:{forSubmission?:boolean;translate?:(message:string)=>string}):Record<string,unknown>;
export function missingResumeInput(engine:string,parameters:Record<string,unknown>):string|null;
export function replaceResumeParameter(source:string|JsonDraft,key:string,value:string|string[]):string;
