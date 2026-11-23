import type {TaskField,TaskStep} from '../../../contracts/workflows/task-fields.mjs';
import type {WorkflowRoadmap} from '../../../contracts/workflows/roadmap.mjs';

export type WorkflowFieldTarget={step:TaskStep;field:TaskField};
export function keyWorkflowFields(steps:TaskStep[],parameters:Record<string,unknown>):WorkflowFieldTarget[];
export function workflowMissingTargets(steps:TaskStep[],parameters:Record<string,unknown>):WorkflowFieldTarget[];
export function workflowOutputLabels(roadmap?:WorkflowRoadmap):{id:string;label:string;inferred:boolean}[];
