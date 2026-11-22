export function evidenceLines(text:string):string[];
export function evidenceParameter(value:unknown):string;
export function evidenceDifference(before:string,after:string):{
 before:{firstLine:number;lastLine:number;text:string};
 after:{firstLine:number;lastLine:number;text:string};
};
