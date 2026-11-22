/** Pure cross-process contracts. Runtime and renderer state belong to their owners. */

export type AgentProvider='codex'|'kimi'|'qwen'|'deepseek'|'compatible';

export interface AgentConnectRequest {provider:AgentProvider;repairTools?:boolean|'managed';threadId?:string}
export interface AgentCliRequiredResult {cliRequired:import('./cli-runtime').CliReadiness}
export interface AgentLoginRequiredResult {loginRequired:true;provider:'codex'}
export interface NativeCodexDefaults {id:string;model?:string;effort?:string}
export interface CodexCompatibility {baselineVersion:string;installedVersion:string;baselineMatch:boolean;status:'capabilities_verified'|'version_observed';scope:string;versionWarning?:{code:'STUDIO_CODEX_VERSION_DIFFERENCE';severity:'warning'}}
export interface ManagedToolReadiness {status:'not_run'|'ready'|'blocked';count:number;message?:string}
export interface AgentToolsStatus {
 status:'not_run'|'ready'|'blocked'|'warning';count:number;scope?:'chat'|'workflow'|'terminal-only'|'definition-only';threadId?:string;
 managedCompute?:boolean;managedTools?:ManagedToolReadiness;workflowBound?:boolean;message?:string;warning?:boolean;inventoryWarning?:string|null;
}
export type AgentConnectResult=AgentCliRequiredResult|AgentLoginRequiredResult|{tools?:AgentToolsStatus;studioCompatibility?:CodexCompatibility;nativeCodexDefaults?:NativeCodexDefaults};
export type CancelProviderLoginRequest={provider:'kimi'}|{provider:'codex';loginId:string};

export interface AgentRpcRequest extends AgentConnectRequest {method:string;params?:Record<string,unknown>}

export interface AgentSteerRequest {
 provider:Exclude<AgentProvider,'kimi'>;
 method:'turn/steer';
 params:{threadId:string; expectedTurnId:string; clientUserMessageId:string; input:[{type:'text'; text:string}]; planningMode:boolean};
}
export interface AgentSteerResult {turnId:string}

export interface ScientificSkillFunction {id:string;title?:string;phase:string;engines:string[];tools:string[];status:string;sources:string[];permission:'allowed'|'permission_required';source_status:'registered'|'unregistered'}

export interface ScientificSkillCatalog {schema_version:1;functions:ScientificSkillFunction[];sharing:Record<string,AgentProvider[]>;source_scope:string}

export interface RpcEvent {provider?:AgentProvider;method:string;id?:string|number;params:any}

export interface Conversation {groupId?:string|null;pinned?:boolean;id:string;provider:AgentProvider;threadId:string;name:string;projectId:string|null;taskId:string|null;updatedAt:number}
export interface ConversationGroup {id:string;name:string;createdAt?:number}
export interface DeleteConversationGroupRequest {id:string}
export interface DeleteConversationGroupResult {id:string;conversations:Conversation[]}

export type ConversationRecovery={status:'required';oldThreadId:string}|{status:'recovered';oldThreadId:string;conversation:Conversation};

export type ConversationRecoveryRequest={provider:'codex';threadId:string;model?:string};

export interface ConversationResumeResult {thread?:{id:string;turns?:unknown[]};studioRecovery?:ConversationRecovery}
