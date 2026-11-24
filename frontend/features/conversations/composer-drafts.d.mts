import type {ChatAttachmentOwner,ChatAttachmentRef} from '../../../contracts/dto/chat-attachments';
export interface ComposerDraftSnapshot {readonly entry:unknown;readonly key:string;readonly revision:number;readonly text:string;readonly files:ChatAttachmentRef[]}

export interface ComposerDraftStore {
 activate(provider:string,threadId?:string|null,fresh?:boolean):string;
 edit(text:string):string;
 seed(provider:string,threadId:string,text:string):boolean;
 capture():ComposerDraftSnapshot;
 acknowledge(snapshot:ComposerDraftSnapshot):boolean;
 retain(snapshot:ComposerDraftSnapshot,text:string):boolean;
 rebind(snapshot:ComposerDraftSnapshot,threadId:string):void;
 rekey(provider:string,oldThreadId:string,newThreadId:string,uploadsRetained?:boolean):{text:string;attachmentReview:boolean};
 discard(provider:string,threadId:string):string;
 subscribe(listener:()=>void):()=>void;
 text():string;
 owner():{provider:string;threadId:string|null};
 attachmentOwner():Readonly<ChatAttachmentOwner>;
 files():ChatAttachmentRef[];
 addToSnapshot(snapshot:ComposerDraftSnapshot,files:readonly ChatAttachmentRef[]):boolean;
 addFiles(files:readonly ChatAttachmentRef[]):void;
 removeFile(id:string):void;
 appendToDraft(provider:string,threadId:string|null,text:string,files?:readonly ChatAttachmentRef[],options?:{requireStorage?:boolean}):string;
}

export function createComposerDrafts(storage:()=>Pick<Storage,'getItem'|'setItem'|'removeItem'>,createId?:()=>string):ComposerDraftStore;
