export interface Plan {id?:string;taskId:string;name:string;notes:string;steps:{id:string;enabled:boolean;source:'agent'|'user';value:string}[]}

export function validatePlan(value:unknown):Plan;
