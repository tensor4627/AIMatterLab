export function deploymentConfig(task:any):any;
export function sameDeploymentConfig(a:any,b:any):boolean;
export function validDeploymentDraft(value:any):any;
export class DeploymentOutbox {constructor(id:string,storage:Storage);error?:string;pending:any;ack:any;activeSave:Promise<any>|null;current(task:any):any;stage(value:any,task:any):void;flush(save:(value:any)=>Promise<any>):Promise<any>;}
export function deploymentOutbox(id:string,storage:Storage):DeploymentOutbox;
