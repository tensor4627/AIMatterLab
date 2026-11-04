import {invoke} from './studio';
import type {Project} from '../../contracts/dto/compute';
import type {AgentProvider} from '../../contracts/dto/agent';
import type {ToolPackageInspection,ToolPackageRecord,ToolPackageSummary,ToolPackageRead,ToolPackageChange,ToolConfigurationPlan,ToolConfiguration,ToolConfigurationReference,ToolConfigurationReview,ToolConfigurationIndex,ToolExecutionSkill,ToolGuidanceBinding,ToolGuidanceGrant,ToolGroupDefinition,ToolGroupCompiled,ToolGroupRecord} from '../../contracts/dto/tools';

export const toolPackages={
 choose:()=>invoke<{package_root:string|null}>('tools.packages.choose',{}),
 inspect:(package_root:string)=>invoke<ToolPackageInspection>('tools.packages.inspect',{package_root}),
 register:(package_root:string)=>invoke<ToolPackageRecord>('tools.packages.register',{package_root}),
 update:(value:ToolPackageChange)=>invoke<ToolPackageRecord>('tools.packages.update',value),
 relocate:(value:ToolPackageChange)=>invoke<ToolPackageRecord>('tools.packages.relocate',value),
 list:()=>invoke<ToolPackageSummary[]>('tools.packages.list',{}),
 read:(value:ToolPackageRead)=>invoke<ToolPackageRecord>('tools.packages.read',value)
};
export const toolConfigurations={
 context:()=>invoke<{provider:AgentProvider;providers:AgentProvider[];hasConversation:boolean;configuration_id:string|null;owner_key:string|null}>('tools.configurations.context',{}),
 list:()=>invoke<ToolConfigurationIndex[]>('tools.configurations.list',{}),
 createProject:(value:{environment_id:string;name:string;request_id:string})=>invoke<Project>('tools.configurations.createProject',value),
 plan:(value:ToolConfigurationPlan)=>invoke<ToolConfiguration>('tools.configurations.plan',value),
 execute:(value:ToolConfigurationReview)=>invoke<ToolConfiguration>('tools.configurations.execute',value),
 status:(value:ToolConfigurationReference)=>invoke<ToolConfiguration>('tools.configurations.status',value),
 activate:(value:ToolConfigurationReview)=>invoke<ToolExecutionSkill>('tools.configurations.activate',value),
 read:(value:ToolConfigurationReference)=>invoke<ToolExecutionSkill>('tools.configurations.read',value),
 bind:(value:ToolGuidanceBinding)=>invoke<{status:'bound';configuration_id:string}>('tools.configurations.bind',value),
 grant:(value:ToolGuidanceGrant)=>invoke<{status:'granted';expires_at:number}>('tools.configurations.grant',value)
};
export const toolGroups={
 compile:(definition:ToolGroupDefinition)=>invoke<ToolGroupCompiled>('tools.groups.compile',{definition}),
 save:(definition:ToolGroupDefinition,expected_revision:number)=>invoke<ToolGroupRecord>('tools.groups.save',{definition,expected_revision}),
 read:(id:string)=>invoke<ToolGroupRecord>('tools.groups.read',{id}),
 list:()=>invoke<Pick<ToolGroupRecord,'id'|'name'|'revision'|'updated_at'|'status'|'execution_status'>[]>('tools.groups.list',{})
};
