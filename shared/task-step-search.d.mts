import type {TaskStep} from './task-fields.mjs';
export function stepMatchesQuery(step:TaskStep,parameters:Record<string,unknown>,query:string):boolean;
