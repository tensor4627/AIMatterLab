export function redactTranscriptText(value:unknown,secrets?:string[]):string;
export function sanitizeTranscript<T>(value:T,secrets?:string[]):T;
export function sanitizeProtocolTranscript<T>(value:T,secrets?:string[],options?:{kind?:string}):T;
export function createTranscriptStream(getSecrets?:()=>string[]):{push(chunk:unknown,options?:{final?:boolean}):string;clear():void};
