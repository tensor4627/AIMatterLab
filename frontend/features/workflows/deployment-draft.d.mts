export function deploymentConfig(task:any):any;

export class DeploymentOutbox {constructor(id:string,storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>);error?:string;pending:any;ack:any;activeSave:Promise<any>|null;current(task:any):any;stage(value:any,task:any):void;flush(save:(value:any)=>Promise<any>):Promise<any>;}

export function deploymentOutbox(id:string,storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>):DeploymentOutbox;
export function deleteDeploymentOutbox(id:string,storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>):void;
