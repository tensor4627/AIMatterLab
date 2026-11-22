import type {ChatAttachmentRef} from '../../../contracts/dto/chat-attachments';
export type ItemMessage={files?:ChatAttachmentRef[];id:string;role:string;text:string;turnId?:string;itemId?:string;clientUserMessageId?:string;deferredDetail?:boolean;toolName?:string;activity?:any};
export function messageForItem(item:any):ItemMessage|null;
export function messageKey(message:ItemMessage):string;
export function upsertItemMessage<T extends ItemMessage>(messages:T[],item:any,turnId?:string):(T|ItemMessage)[];
export function replayMessages(turns?:any[]):ItemMessage[];
