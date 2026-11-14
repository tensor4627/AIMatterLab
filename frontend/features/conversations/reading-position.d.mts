export type ReadingPosition={top:number;follow:boolean;anchor:string|null;offset:number};
export function readingKey(provider:string,threadId:string|null):string|null;
export function createReadingPositions(storage:()=>Storage):{
 read(key:string|null):ReadingPosition|null;
 save(key:string|null,node:HTMLElement|null,follow:boolean):ReadingPosition|null;
 restore(key:string|null,node:HTMLElement|null):boolean;
 discard(key:string|null):void;
};
