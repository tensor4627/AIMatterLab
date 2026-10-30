export interface ComposerDraftSnapshot {readonly entry:unknown;readonly revision:number;readonly text:string}
export interface ComposerDraftStore {
 activate(provider:string,threadId?:string|null,fresh?:boolean):string;
 edit(text:string):string;
 capture():ComposerDraftSnapshot;
 acknowledge(snapshot:ComposerDraftSnapshot):boolean;
 retain(snapshot:ComposerDraftSnapshot,text:string):boolean;
 rebind(snapshot:ComposerDraftSnapshot,threadId:string):void;
 rekey(provider:string,oldThreadId:string,newThreadId:string):string;
 discard(provider:string,threadId:string):string;
 text():string;
 owner():{provider:string;threadId:string|null};
}
export function createComposerDrafts(storage:()=>Pick<Storage,'getItem'|'setItem'|'removeItem'>,createId?:()=>string):ComposerDraftStore;
