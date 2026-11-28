import type {Conversation} from './agent';

export type ConversationApprovalOwner=Pick<Conversation,'provider'|'threadId'>;
export interface ConversationApproval {
 id:string;
 operation:string;
 resource?:string;
 paths:string[];
 approvedAt:number;
 lifetime:'conversation'|'operation';
 revokedAt?:number;
}
