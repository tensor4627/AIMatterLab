import type {AgentProvider} from '../../../contracts/dto/agent';
import type {LegacyQueueMessage} from '../../../contracts/dto/agent-queue';

export function followUpKey(provider:AgentProvider, threadId:string): string;
export function readQueueAdmission(storage:()=>Pick<Storage,'getItem'>,key:string,draft:string):string|null;
export function rememberQueueAdmission(storage:()=>Pick<Storage,'setItem'>,key:string,id:string,draft:string):void;
export function forgetQueueAdmission(storage:()=>Pick<Storage,'getItem'|'removeItem'>,key:string,id?:string):void;
export function readLegacyFollowUps(storage:()=>Pick<Storage,'getItem'>,provider:AgentProvider,threadId:string): LegacyQueueMessage[];
export function forgetLegacyFollowUps(storage:()=>Pick<Storage,'getItem'|'setItem'|'removeItem'>,provider:AgentProvider,threadId:string): void;
