export function legacyAuthoringBindingEligible(task:any):boolean;
export function taskWorkerSource(task:any):{source:string;binding:any}|null;
export function unboundWorkflow(task:any):boolean;
export function isSshWorkerBinding(value:any):boolean;
export function stableSshWorkerBinding(value:any):{kind:'ssh';version:2;profileId:string;profileVersion:number;hostIdentity:{hostname:string;uid:number;machineId:string};root:string;runtime:string;runtimeId:string};
