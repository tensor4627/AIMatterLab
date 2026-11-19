import type {AgentProvider} from './agent';

export type BadgeMotion = 'wave' | 'breathe';
export interface ManagedResource {
  resourceId:string; profileId:string; name:string; kind:'ssh'|'wsl'|'local';
  connectionId?:string; profileVersion?:number; color?:number;
  serviceStatus?:'idle'|'preparing'|'ready'|'configuration_required'|'unavailable';
  serviceReady?:boolean; terminalReady?:boolean; authorizedProjects?:string[];
}
export interface PublishedSshResource extends ManagedResource {
  kind:'ssh'; connectionId:string; profileVersion:number;
}
export interface ResourceBadge {
  profileId:string; label:string; kind:string; color:number;
  status:'idle'|'running'|'queued'|'unknown'|'offline'; observedAt:number|null;
}
export interface ConversationActivity {
  provider:AgentProvider; threadId:string; replying:boolean; nextWakeAt:number|null; badges:ResourceBadge[];
}
export interface ManagedSchedule {
  id:string; name?:string; sourceId:string; kind:string; status:string;
  scope:{provider:AgentProvider;threadId:string;taskId?:string;projectId:string;runId?:string};
  intervalSeconds:number; maxRuns:number; count:number; delegationCount?:number; expiresAt:number; nextAt:number|null;
  connected?:boolean; history?:unknown[]; revision?:number; stopRequestedAt?:number|null; stopNeedsConfirmation?:boolean; lastResult?:unknown;
  active?:{jobId?:string;childId?:string;status?:string}|null; script?:{language?:string;sha256?:string;version?:number;text?:string}|null;
}
export interface ManagedSource {
  id:string;profileId:string;name?:string;connected:boolean;observedAt:number|null;
  schedules:ManagedSchedule[];runs:{id:string;projectId:string;status:string;jobId?:string;observedAt:number|null}[];
}
export interface MonitorNotice {
 id:string;sourceId:string;profileId:string;resourceName:string;scheduleId:string;runId:string;projectId:string;
 provider:AgentProvider;threadId:string;jobId:string|null;status:string;observedAt:number|null;count:number;maxRuns:number;
 delegationExhausted:boolean;createdAt:number;acknowledgedAt:number|null;
}
export interface ManagedSnapshot {
 notices?:MonitorNotice[];
  resources:ManagedResource[];conversations:ConversationActivity[];sources:ManagedSource[];
}
