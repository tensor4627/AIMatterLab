export type ItemMessage={id:string;role:string;text:string;toolName?:string;activity?:any};
export function messageForItem(item:any):ItemMessage|null;
export function upsertItemMessage<T extends ItemMessage>(messages:T[],item:any):(T|ItemMessage)[];
export function replayMessages(turns?:any[]):ItemMessage[];
