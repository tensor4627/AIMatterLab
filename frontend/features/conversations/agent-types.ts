import type {AgentProvider} from "../../../contracts/dto/agent";

export type SkillAttachment={attachmentId:string;name:string;fromDraft?:true}&({functionId:string;path?:never}|{path:string;functionId?:never});

export interface AgentIntent {id:string;text:string;skill?:Extract<SkillAttachment,{functionId:string}>;autoSend?:boolean;taskId?:string;reviewMode?:boolean;threadId?:string|null;provider?:AgentProvider}
export interface MissingWorkflowToolQuestion {id:string;provider:import('../../../contracts/dto/agent').AgentProvider;threadId:string;tool:string;onAnswer:(action:'setup'|'later')=>void}
