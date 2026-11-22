import type {AgentProvider} from './agent';
import type {ChatAttachmentRef} from './chat-attachments';

export type ChatEvidenceLocator =
 | {kind:'editor';id:string}
 | {kind:'taskInput';taskId:string;path:string}
 | {kind:'reviewFile';taskId:string;snapshotId:string;entryId:string}
 | {kind:'parameter';taskId:string;revision:number;field:string}
 | {kind:'log';runId:string;target:'run'|'cluster'}
 | {kind:'artifact';runId:string;name:string;target:'run'|'cluster'};

export interface ChatEvidenceRequest {
 provider:AgentProvider;
 threadId:string;
 source:ChatEvidenceLocator;
 sha256:string;
 textLength:number;
}
export type ChatEvidenceStageRequest=ChatEvidenceRequest & {
 selection:{firstLine:number;lastLine:number}|{beforeRevision:string};
 comment?:string;
};
export interface ChatEvidenceDifference {
 beforeRevision:string;
 afterRevision:string;
 before:{firstLine:number;lastLine:number;text:string};
 after:{firstLine:number;lastLine:number;text:string};
 beforeUnit?:string;
 afterUnit?:string;
}
export interface ChatEvidenceSelection {
 provider:AgentProvider;
 threadId:string;
 files:ChatAttachmentRef[];
 comment?:string;
}
