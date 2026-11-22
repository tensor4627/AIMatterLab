import type {Conversation,RpcEvent} from './agent';

export interface ConversationAnchor {conversationId:string;turnId:string;itemId?:string}
export interface ConversationHistoryTarget extends ConversationAnchor {nonce:string}
export interface ConversationSource extends ConversationAnchor {name:string;kind:'fork'|'excerpt'}
export interface ConversationBookmark extends ConversationAnchor {snippet:string}
export interface ConversationHistoryItem {
 id:string;
 type:string;
 text?:string;
 status?:string;
 studioDetail?:boolean;
 [field:string]:unknown;
}
export interface ConversationHistoryTurn {id:string;items:ConversationHistoryItem[];status?:string}
export interface ConversationHistoryPage {
 conversation:Conversation;
 turns:ConversationHistoryTurn[];
 liveTurn?:ConversationHistoryTurn;
 before:string|null;
 atLatest:boolean;
 bookmarks:ConversationBookmark[];
 studioSession?:{threadId:string;turnId:string|null;busy:boolean;requests:RpcEvent[]};
}
export interface ConversationHistorySearchRequest {conversationId?:string;projectId?:string|null;query:string}
export interface ConversationHistoryMatch extends ConversationAnchor {name:string;snippet:string;archived?:boolean}
export interface ConversationHistorySearchResult {matches:ConversationHistoryMatch[];unavailable:number}
export interface ConversationBranchPreview {source:ConversationSource;excerpt:string;revision:string}
export type ConversationBranchResult={conversation:Conversation;draft?:string}|{preview:ConversationBranchPreview};
