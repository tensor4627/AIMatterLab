export interface NewProjectSpec {name:string;policy:{engines:string[];gpus:number[];max_seconds:number;max_concurrent:number;input_roots:string[];environments:string[];clusters:string[]}}
export function suggestedProjectEnvironment(environmentIds:string[],suggestedId?:string):string|null;
export function scopedSuggestedInputRoot(value?:string):string|null;
export function newProjectDefaults(engineIds:string[],environmentIds:string[],suggestedEnvironmentId?:string,suggestedInputRoot?:string):NewProjectSpec;
