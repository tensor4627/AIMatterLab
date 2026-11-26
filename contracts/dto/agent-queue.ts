import type {AgentProvider} from './agent';
import type {ChatAttachmentRef} from './chat-attachments';

export interface QueueMessageInput {
 id: string;
 text: string;
 context?: string;
 planningMode: boolean;
 newWorkflow: boolean;
 model?: string;
 effort?: string;
 skill?: {name:string} & ({functionId:string} | {path:string});
 files?: ChatAttachmentRef[];
}
export type LegacyQueueMessage = QueueMessageInput & {unconfirmed?:boolean;preparedTaskId?:string};
export type AgentQueueAction =
 | {action:'read';pendingId?:string}
 | {action:'resume'}
 | {action:'enqueue';after:string|null;item:QueueMessageInput}
 | {action:'import';items:LegacyQueueMessage[]}
 | {action:'edit';id:string;text:string}
 | {action:'move';id:string;direction:'up'|'down'}
 | {action:'remove'|'reconcile';id:string}
 | {action:'pause';stop?:boolean}
 | {action:'steer';id:string;turnId:string};
export type AgentQueueRequest = AgentQueueAction & {provider:AgentProvider;threadId:string};
export interface QueuedMessage {
 id: string;
 text: string;
 skillName?: string;
 skillFunctionId?: string;
 files?: ChatAttachmentRef[];
 attachmentReview?: boolean;
 status: 'queued'|'preparing'|'submitting'|'unconfirmed';
 steerable: boolean;
}
export interface AgentQueueView {
 provider: AgentProvider;
 threadId: string;
 revision: number;
 after: string|null;
 pause: 'stopped'|'previous'|'changed'|'blocked'|'unconfirmed'|'restored'|null;
 items: QueuedMessage[];
}
export interface AgentQueueResult {queue:AgentQueueView;turnId?:string;admitted?:boolean}
