export interface Tool {id:string;name:string;description:string;engines:string[];status:string;capabilities:string[];page:string}
export interface Step {id:string;title:string;tool:string;required:boolean;description:string;planned:boolean}
export interface Task {id:string;title:string;summary:string;tools:string[];steps:Step[]}
export interface Plan {id?:string;taskId:string;name:string;notes:string;steps:{id:string;enabled:boolean;source:'agent'|'user';value:string}[]}
export const tools:Tool[];export const tasks:Task[];
export function createPlan(id:string):Plan;
export function validatePlan(value:unknown):Plan;
export function planPrompt(value:Plan):string;
