export interface ProductCheck {requirement:string;fact:string;op:'eq'|'ge'|'le'|'contains';value:string|number}
export interface RoadmapResource {id:string;label:string;format?:string;requirements?:string[];checks?:ProductCheck[];field?:string;file_name?:string;basis?:'user'|'inferred'}
export interface RoadmapPort {port:string;resource:string}
export interface RoadmapStep {id:string;tool:string;label:string;parameter_field?:string;inputs:RoadmapPort[];outputs:RoadmapPort[];runtime?:{top?:string;bottom?:string}}
export interface WorkflowRoadmap {schema_version:1;tool_group?:{id:string;version:string};resources:RoadmapResource[];inputs:string[];steps:RoadmapStep[];outputs:string[]}
export interface RoadmapFinding {code:'no_outputs'|'input_needed'|'ambiguous_file'|'confirm'|'no_source'|'unused_input'|'unused_step'|'unused_resource';resource?:string;step?:string}
export interface RoadmapAnalysis {order:string[];depths:Record<string,number>;goals:{output:string;inputs:string[];steps:string[];unresolved:string[]}[];findings:RoadmapFinding[]}
export function validateRoadmap(value:unknown):WorkflowRoadmap;
export function resolveRoadmapInput(parameters:Record<string,unknown>,resource:RoadmapResource):{value:unknown;ambiguous?:boolean};
export function analyzeRoadmap(plan:WorkflowRoadmap,parameters?:Record<string,unknown>):RoadmapAnalysis;
