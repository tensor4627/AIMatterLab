import {invoke} from './studio';
import type {ConversationRecoveryRequest,ConversationResumeResult} from '../../contracts/dto/agent';

export const recoverConversation=(request:ConversationRecoveryRequest)=>invoke<ConversationResumeResult>('agent.recover',request);
