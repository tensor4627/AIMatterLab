import type {AgentProvider} from './agent';

export interface ChatEvidenceSource {
 kind: 'input'|'log'|'artifact'|'parameters';
 label: string;
 revision: string;
 firstLine: number;
 lastLine: number;
 taskId?: string;
 projectId?: string;
 runId?: string;
 field?: string;
 unit?: string;
 comparison?: {beforeRevision:string;afterRevision:string};
}
export interface ChatAttachmentRef {
 id:string;
 name:string;
 kind:'text'|'image';
 mimeType:string;
 size:number;
 source?:ChatEvidenceSource;
}
export interface ChatAttachmentOwner {provider:AgentProvider;threadId:string|null;draftId?:string}
export type SelectedChatFile =
 | {name:string;size:number;text:string;mimeType:string}
 | {name:string;size:number;bytes:Uint8Array;mimeType:string};
export interface ChatImportRequest extends ChatAttachmentOwner {files:SelectedChatFile[]}
export interface ChatPreviewRequest extends ChatAttachmentOwner {id:string}
export type ChatAttachmentPreview = {file:ChatAttachmentRef;text:string}|{file:ChatAttachmentRef;url:string};
