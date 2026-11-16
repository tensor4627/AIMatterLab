export type ApiProtocol='openai-completions'|'openai-responses'|'anthropic-messages';
export type ReasoningLevel='off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max';
export interface ApiModel {id:string;name?:string;contextWindow?:number;maxTokens?:number;input?:('text'|'image')[];reasoningEfforts?:false|Partial<Record<ReasoningLevel,string|null>>;thinkingFormat?:'openai'|'qwen'|'deepseek';supportsReasoningEffort?:boolean;supportsDeveloperRole?:boolean;requiresReasoningContentOnAssistantMessages?:boolean;requiresThinkingAsText?:boolean}
export interface ModelProfile {schemaVersion:1;id:string;provider:'qwen'|'compatible';name:string;baseUrl:string;api:ApiProtocol;preset:string;sharePublicGuides?:boolean;catalogProvider?:string;models:ApiModel[];defaultModel:string;credentialStored?:boolean;revision?:number}
export interface ModelDiscovery {models:ApiModel[];source:'endpoint'|'catalog';notice?:string}
