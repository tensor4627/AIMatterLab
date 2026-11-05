import type {AgentProvider} from "../../../contracts/dto/agent";

export type SkillAttachment={attachmentId:string;name:string}&({functionId:string;path?:never}|{path:string;functionId?:never});

export interface AgentIntent {id:string;text:string;autoSend?:boolean;taskId?:string;reviewMode?:boolean;threadId?:string;provider?:AgentProvider}
