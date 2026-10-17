export function deploymentField(key:string):boolean;
export function scienceOnly(parameters:any,steps?:any[],missing?:string[]):{parameters:any;steps:any[];missing:string[];hints:any};
export function scientificSpec(task:any):{engine:string;inputs:Record<string,string>;parameters:any};
export function validDeployment(value:any):any;
export function deploymentCurrent(task:any):boolean;
export function snapshotIdentity(task:any,run:any):string;
