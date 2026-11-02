export function deploymentField(key:string):boolean;
export function scienceOnly(parameters:any,steps?:any[],missing?:string[]):{parameters:any;steps:any[];missing:string[];hints:any};
export function scientificSpec(task:any):{engine:string;inputs:Record<string,string>;parameters:any};
export function validDeployment(value:any):any;
export function clusterDeploymentChoice(resources:any,profile:any,targetId?:string):any;
export function deploymentCurrent(task:any,authority?:{kind:'local-human';id:string;sha256:string}|null):boolean;
export function snapshotIdentity(task:any,run:any):string;
