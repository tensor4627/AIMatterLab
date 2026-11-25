/** Pure cross-process contracts. Runtime and renderer state belong to their owners. */

import type {AgentProvider} from './agent';

export type AgentApprovalMode='manual'|'auto'|'full';

export interface Settings {
 overviewAgentLayout?:'right'|'center';
 agentApprovalMode?:AgentApprovalMode;
 developerComputeWorkspaceId?:string|null;
 autoDiscoverCompute?:boolean;scientificSkillProviders?:Record<string,AgentProvider[]>;pygasSkillProviders?:AgentProvider[];projectAgents?:Record<string,AgentProvider>;agentLayout?:'right'|'center';agentProvider?:AgentProvider;kimiPath?:string;qwenPath?:string;agentProviders?:Partial<Record<AgentProvider,{contextWindow?:number;compactLimit?:number;effort?:string}>>;distribution:string;workerRoot:string;workerPort:number;codexPath:string;cwd:string;sourceRoots?:string[];sourceIds?:string[];skillRoots:string[];userCacheDirectory?:string;theme:string;resourceBadgeMotion?:'wave'|'breathe';language?:'zh-CN'|'en';fontFamily?:string;fontSize?:number;minimumFontSize?:number;chatFontSize?:number;editorFontSize?:number;terminalFontSize?:number;terminalIdleMinutes?:number;agent?:{contextWindow?:number;compactLimit?:number;effort?:string}}
