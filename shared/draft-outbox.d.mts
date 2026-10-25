export class DraftOutbox {constructor(id:string,storage:Storage);pendingCount:number;readonly activeSave:Promise<any>|null;stage(key:string,value:any):void;apply(parameters:Record<string,any>):Record<string,any>;flush(save:(changes:Record<string,any>)=>Promise<any>):Promise<any>;}
export function workflowOutbox(id:string, storage:Storage):DraftOutbox;
