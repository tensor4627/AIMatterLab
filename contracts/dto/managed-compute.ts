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
export type ComputeLinkStatus = 'online'|'offline'|'preparing'|'unconfigured'|'requires_review'|'channel_ready'|'lost'|'unknown'|'closed';
export interface ComputeLinkObservation { status:ComputeLinkStatus; checkedAt?:number|null }
export interface ComputeConsoleTerminal extends ComputeLinkObservation {
  sessionId:string; kind:'ssh'|'local'; mode:'interactive'|'key'; owner:'human'|'agent';
  profileId?:string; profileVersion?:number; profileName?:string;
}
export type ComputeConsoleChannelSource = 'managed'|'handoff'|'wsl';
export interface ComputeConsoleChannel {
  source:ComputeConsoleChannelSource; leaseId:string|null; sessionId:string|null; provider:AgentProvider; threadId:string;
  conversationId:string|null; conversationName:string|null; projectId:string|null; projectName:string|null; serviceOnly:boolean; busy:boolean;
  serviceContext?:boolean; terminalStatus?:'preparing'|'releasing'|'lost'|null;
  status:'preparing'|'assigned'|'releasing'|'lost'|'unknown'|'parked'; checkedAt:number|null;
}
export interface ComputeConsoleProfileRef { profileId:string; profileVersion:number }
export interface ComputeConsoleSshRef extends ComputeConsoleProfileRef { connectionId:string }
export type ComputeConsoleLocalRef = (ComputeConsoleProfileRef & {generation:string|null;foregroundEpoch:number|null}) |
  {profileId:null;profileVersion:null;generation:null;foregroundEpoch:number};
export interface ComputeConsoleRelease {
  resourceId:string; connectionId:string|null; source:ComputeConsoleChannelSource; leaseId:string; provider:AgentProvider; threadId:string;
}
export interface ComputeConsoleResource extends ComputeConsoleProfileRef {
  key:string; kind:'ssh'|'wsl'; name:string; current:boolean; target:string|null; mode?:'interactive'|'key';
  connectionId:string|null; managedId:string|null; canDisconnect?:boolean; localGeneration?:string|null; foregroundEpoch?:number|null;
  master:ComputeLinkObservation|null; service:ComputeLinkObservation & {kind:'private'|'borrowed'|'wsl'};
  capacity:{total:number;occupied:number}|null; channels:ComputeConsoleChannel[]; terminals:ComputeConsoleTerminal[];
  projectPolicies:{projectId:string;allowed:boolean}[];
}
export interface ComputeConsoleSnapshot {
  checkedAt:number|null; observation:'unverified'|'complete'|'partial'; resources:ComputeConsoleResource[];
  standalone:ComputeConsoleTerminal[]; projects:{id:string;name:string}[];
  foregroundLocal?:{distribution:string;port:number;foregroundEpoch:number;service:ComputeLinkObservation}|null;
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
