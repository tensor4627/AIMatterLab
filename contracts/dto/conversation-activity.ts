import type {AgentProvider} from './agent';

export interface ConversationActivityOwner {provider:AgentProvider;threadId:string}
export interface ConversationPendingRequest {
 kind:'question'|'approval'|'terminalApproval';
 requestId:string;
 turnId?:string;
 at:number;
}
export interface ConversationResultReceipt {
 receiptId:string;
 turnId:string;
 itemId?:string;
 at:number;
}
export interface ConversationTurnProgress {
 id:string;
 plan?:{steps:{text:string;status:'pending'|'inProgress'|'completed'}[];explanation?:string};
 tool?:{name:string;state:'running'|'reported'|'failed'};
}
export interface ConversationActivity extends ConversationActivityOwner {
 phase:'preparing'|'replying'|'idle';
 live?:ConversationTurnProgress;
 pending:ConversationPendingRequest[];
 unread?:ConversationResultReceipt;
}
export interface ConversationReadReceipt extends ConversationActivityOwner {receiptId:string}
export type ConversationAttentionTarget=ConversationActivityOwner&{
 nonce:string;
 target:ConversationPendingRequest|ConversationResultReceipt;
};
