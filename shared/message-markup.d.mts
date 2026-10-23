export type InlineMarkup={type:'text'|'code';text:string}|{type:'strong';children:InlineMarkup[]};
export type MessageBlock={type:'paragraph';text:string}|{type:'code';text:string;closed:boolean}|{type:'ol';start:number;items:string[]}|{type:'ul';start:number;items:string[]};
export function inlineMarkup(text:string,depth?:number):InlineMarkup[];
export function messageMarkup(raw:string):MessageBlock[];
