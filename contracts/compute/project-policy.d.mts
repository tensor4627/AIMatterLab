export interface EditableProjectSpec {name:string;policy:{engines:string[];gpus:number[];max_seconds:number;max_concurrent:number;input_roots:string[];environments:string[];clusters?:string[]}}

export function validateProjectSpec(spec:any,engines:string[]):void;
export const FIELDS:string[];
export function object(value:any):boolean;
