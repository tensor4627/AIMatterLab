import type {AgentProvider} from '../../../contracts/dto/agent';
import type {SkillAttachment} from './agent-types';

export interface QueuedFollowUp {
 readonly id: string;
 readonly text: string;
 readonly route: string;
 readonly context: string;
 readonly planningMode: boolean;
 readonly newWorkflow: boolean;
 readonly preparedTaskId?: string;
 readonly attachment?: SkillAttachment;
 readonly unconfirmed?: boolean;
}

export type FollowUpPause = 'stopped' | 'previous' | 'changed' | 'blocked' | 'unconfirmed' | 'restored';

interface QueueState {
 readonly items: readonly QueuedFollowUp[];
 readonly after: string | null;
 readonly pending: string | null;
 readonly pause: FollowUpPause | null;
}

export function followUpKey(provider: AgentProvider, threadId: string): string;
export function createFollowUpQueues(storage:()=>Pick<Storage,'getItem'|'setItem'|'removeItem'>): {
 read(key: string): QueueState;
 enqueue(key: string, turnId: string | null, item: QueuedFollowUp): void;
 settle(key: string, turnId: string, completed: boolean): boolean;
 hasSettled(key: string, turnId: string): boolean;
 pause(key: string, reason: FollowUpPause): boolean;
 pauseProvider(provider: AgentProvider, reason: FollowUpPause): boolean;
 resume(key: string): boolean;
 begin(key: string, itemId: string, mode: 'next' | 'steer'): boolean;
 markAttempt(itemId: string, attempted: boolean, preparedTaskId?: string): void;
 remove(key: string, itemId: string): boolean;
 finish(itemId: string, turnId?: string | null): boolean;
 discard(key: string): boolean;
 rekey(oldKey: string, key: string): boolean;
};
