export interface TaskField {key:string;label:string;type:string;required:boolean;unit?:string;description?:string;options?:string[]}
export interface TaskStep {id:string;title:string;description?:string;tool?:string;optional?:boolean;fields:TaskField[]}
export function fieldPath(key:string):string[];
export function parameterValue(parameters:Record<string,any>,key:string):any;
export function setParameter(parameters:Record<string,any>,key:string,value:any):Record<string,any>;
export function inferField(key:string,value:any,required?:boolean):TaskField;
export function flattenParameters(parameters:Record<string,any>,prefix?:string):TaskField[];
export function normalizeSteps(steps:any[],parameters?:Record<string,any>,missing?:string[]):TaskStep[];
export function fieldMissing(field:TaskField,parameters:Record<string,any>):boolean;
export function workflowMissing(steps:any[],parameters?:Record<string,any>,missing?:string[]):string[];
export function explicitNewWorkflow(text:string):boolean;
