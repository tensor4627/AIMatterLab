import {useEffect,useRef,useState} from 'react';
import type {AgentProvider} from '../../../contracts/dto/agent';
import type {Project,Environment} from '../../../contracts/dto/compute';
import type {ToolPackageInspection,ToolPackageRecord,ToolPackageSummary,ToolConfiguration,ToolConfigurationIndex,ToolExecutionSkill,ToolGuidanceGrant} from '../../../contracts/dto/tools';
import type {SkillAttachment} from "../conversations/agent-types";
import {toolPackages,toolConfigurations} from '../../api/tools';
import {api} from '../../api/worker';
import {t} from '../../ui/i18n';

type Context=Awaited<ReturnType<typeof toolConfigurations.context>>;
type Candidate={root:string;inspection:ToolPackageInspection};
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
const identity=(value:{package_id:string;package_version:string})=>value.package_id+':'+value.package_version;

/** This only recognizes the supported shape. The worker still verifies the actual fixed reference source. */
export function referenceConfigurationSupported(value:ToolPackageInspection){
 const {environment,functions,tests}=value.manifest,parallel=environment.parallelism;
 return environment.hardware==='cpu'&&parallel.supported.length===1&&parallel.supported[0]==='serial'&&parallel.threads===1&&parallel.processes===1&&parallel.gpus===0&&functions.every(feature=>feature.engine==='installation.check'&&feature.operation.command.length===2&&feature.operation.command[0]==='{python}'&&feature.operation.command[1]==='{entrypoint}'&&!feature.inputs.length&&!feature.parameters.length&&feature.outputs.length===1&&feature.outputs[0].type==='file'&&feature.outputs[0].format==='json')&&tests.cases.every(test=>!test.resources.length&&test.expected_outputs.length===1&&test.expected_outputs[0].path==='smoke-result.json'&&test.expected_outputs[0].format==='json');
}

/** Owns explicit package/configuration actions; all privileged work uses the typed main-process clients. */
export function useToolPackages({provider,onSelect}:{provider:AgentProvider;onSelect:(value:SkillAttachment)=>void}){
 const [packages,setPackages]=useState<ToolPackageSummary[]>([]),[configurations,setConfigurations]=useState<ToolConfigurationIndex[]>([]),[context,setContext]=useState<Context|null>(null);
 const [record,setRecord]=useState<ToolPackageRecord|null>(null),[candidate,setCandidate]=useState<Candidate|null>(null),[selected,setSelected]=useState(''),[version,setVersion]=useState('');
 const [busy,setBusy]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [configuring,setConfiguring]=useState(false),[projects,setProjects]=useState<Project[]>([]),[environments,setEnvironments]=useState<Environment[]>([]),[projectId,setProjectId]=useState(''),[environmentId,setEnvironmentId]=useState(''),[projectName,setProjectName]=useState('');
 const [configuration,setConfiguration]=useState<ToolConfiguration|null>(null),[execution,setExecution]=useState<ToolExecutionSkill|null>(null),[pollPaused,setPollPaused]=useState(false);
 const [selectedConfigurationId,setSelectedConfigurationId]=useState('');
 const [sharingProvider,setSharingProvider]=useState<AgentProvider|''>(''),[purpose,setPurpose]=useState<ToolGuidanceGrant['purpose']>('repair'),[resourceIds,setResourceIds]=useState<string[]>([]),[bound,setBound]=useState(false);
 const mounted=useRef(true),scope=useRef(0),catalogSequence=useRef(0),lock=useRef<symbol|null>(null),requestIds=useRef(new Map<string,string>()),currentProvider=useRef(provider);currentProvider.current=provider;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;scope.current++;catalogSequence.current++;lock.current=null;};},[]);
 useEffect(()=>{invalidate();setContext(null);setSharingProvider('');setBound(false);void refresh();},[provider]);
 function invalidate(){scope.current++;lock.current=null;setBusy('');setError('');setNotice('');}
 function valid(ticket:number){return mounted.current&&ticket===scope.current&&currentProvider.current===provider;}
 function requestId(kind:string,facts:string[]){const key=JSON.stringify([kind,...facts]);if(!requestIds.current.has(key))requestIds.current.set(key,crypto.randomUUID());return requestIds.current.get(key)!;}
 async function refresh(){
  const sequence=++catalogSequence.current,owner=provider;if(!mounted.current||currentProvider.current!==owner)return;setLoading(true);setError('');
  const results=await Promise.allSettled([toolPackages.list(),toolConfigurations.list(),toolConfigurations.context()]);
  if(!mounted.current||sequence!==catalogSequence.current||currentProvider.current!==owner)return;
  const errors:string[]=[];if(results[0].status==='fulfilled')setPackages(results[0].value);else errors.push(message(results[0].reason));
  if(results[1].status==='fulfilled')setConfigurations(results[1].value);else errors.push(message(results[1].reason));
  if(results[2].status==='fulfilled'){setContext(results[2].value);setBound(false);}else {setContext(null);setBound(false);errors.push(message(results[2].reason));}setError(errors.join(' · '));setLoading(false);
 }
 async function action(label:string,work:(ticket:number)=>Promise<void>){
  if(lock.current||!mounted.current)return;const operation=Symbol(label),ticket=scope.current;lock.current=operation;setBusy(label);setError('');setNotice('');
  try{await work(ticket);}catch(error){if(valid(ticket)){setError(message(error));setPollPaused(true);}}finally{if(valid(ticket)&&lock.current===operation){lock.current=null;setBusy('');}}
 }
 function clearConfiguration(){setSelectedConfigurationId('');setConfiguration(null);setExecution(null);setConfiguring(false);setProjects([]);setEnvironments([]);setProjectId('');setEnvironmentId('');setResourceIds([]);setBound(false);setPollPaused(false);}
 function acceptRecord(value:ToolPackageRecord){invalidate();setSelected(value.package_id);setVersion(value.package_version);setRecord(value);setCandidate(null);clearConfiguration();}
 function selectPackage(packageId:string,packageVersion?:string){
  invalidate();setSelected(packageId);setVersion(packageVersion||'');setRecord(null);setCandidate(null);clearConfiguration();if(!packageId)return;
  void action('读取工具包',async ticket=>{const value=await toolPackages.read({package_id:packageId,...packageVersion?{package_version:packageVersion}:{}});if(!valid(ticket))return;if(value.package_id!==packageId||packageVersion&&value.package_version!==packageVersion)throw Error('工具包响应与所选版本不符');setVersion(value.package_version);setRecord(value);});
 }
 function choose(){void action('检查工具包',async ticket=>{
  const choice=await toolPackages.choose();if(!valid(ticket)||!choice.package_root)return;const inspection=await toolPackages.inspect(choice.package_root);if(valid(ticket))setCandidate({root:choice.package_root,inspection});
 });}
 function changePackage(mode:'register'|'update'|'relocate'){
  if(!candidate)return;const reviewed=candidate,previous=record;
  void action(mode==='register'?'登记工具包':mode==='update'?'更新工具包':'移址工具包',async ticket=>{
   if(mode!=='register'&&(!previous||previous.package_id!==reviewed.inspection.package_id))throw Error('先选择同一工具的已登记版本');
   const value=mode==='register'?await toolPackages.register(reviewed.root):await toolPackages[mode]({package_id:previous!.package_id,expected_revision:previous!.revision,package_root:reviewed.root});if(!valid(ticket))return;
   if(identity(value)!==identity(reviewed.inspection))throw Error('工具包在检查后发生变化，请重新检查');acceptRecord(value);setNotice('工具定义已登记；安装和功能测试尚未运行。');void refresh();
  });
 }
 function startConfiguration(){if(!record||!referenceConfigurationSupported(record))return;void action('读取配置目标',async ticket=>{
  const results=await Promise.all([api<Project[]>('GET','/api/projects'),api<Environment[]>('GET','/api/environments')]);if(!valid(ticket))return;setProjects(results[0]);setEnvironments(results[1]);setProjectId('');setEnvironmentId('');setConfiguring(true);setProjectName(record.manifest.name+' · CPU 检查');
 });}
 function targetEnvironment(value:string){invalidate();setSelectedConfigurationId('');setEnvironmentId(value);setProjectId('');setConfiguration(null);setExecution(null);setResourceIds([]);setBound(false);}
 function targetProject(value:string){invalidate();setSelectedConfigurationId('');setProjectId(value);setConfiguration(null);setExecution(null);setResourceIds([]);setBound(false);}
 const authorizedProjects=projects.filter(project=>!project.authoring_only&&project.policy.engines.includes('installation.check')&&project.policy.environments.includes(environmentId)&&project.policy.gpus.includes(0)&&project.policy.max_seconds>=30&&project.policy.max_concurrent>=1);
 function createProject(){if(!environmentId||!projectName.trim())return;void action('新建 CPU 检查项目',async ticket=>{
  const environment=environmentId,name=projectName.trim(),value=await toolConfigurations.createProject({environment_id:environment,name,request_id:requestId('project',[environment,name])});if(!valid(ticket))return;if(!value.policy.environments.includes(environment)||!value.policy.engines.includes('installation.check')||value.authoring_only)throw Error('新项目授权与所选配置目标不符');setProjects(old=>[...old.filter(item=>item.id!==value.id),value]);setProjectId(value.id);setNotice('已新建独立 CPU 检查项目，原项目授权保持不变。');
 });}
 function matchingConfiguration(value:{configuration_id:string;package_id:string;package_version:string},expectedId?:string){if(!record||identity(value)!==identity(record)||expectedId&&value.configuration_id!==expectedId)throw Error('配置响应与所选工具或配置不符');}
 function plan(){if(!record||!environmentId||!authorizedProjects.some(project=>project.id===projectId))return;void action('生成配置计划',async ticket=>{
  const environment=environmentId,project=projectId,value=await toolConfigurations.plan({package_id:record.package_id,package_version:record.package_version,project_id:project,environment_id:environment,request_id:requestId('plan',[identity(record),project,environment])});if(!valid(ticket))return;matchingConfiguration(value);if(value.target.project_id!==project||value.target.environment_id!==environment)throw Error('配置计划目标与所选项目和环境不符');setConfiguration(value);setExecution(null);setPollPaused(false);setResourceIds([]);setBound(false);const entries=await toolConfigurations.list();if(valid(ticket))setConfigurations(entries);
 });}
 function chooseConfiguration(configurationId:string){
  invalidate();setSelectedConfigurationId(configurationId);setConfiguration(null);setExecution(null);setResourceIds([]);setBound(false);setPollPaused(false);if(!configurationId)return;
  void action('读取配置状态',async ticket=>{const value=await toolConfigurations.status({configuration_id:configurationId});if(!valid(ticket))return;matchingConfiguration(value,configurationId);setConfiguration(value);});
 }
 function status(){if(!configuration)return;const configurationId=configuration.configuration_id;void action('读取配置状态',async ticket=>{
  const value=await toolConfigurations.status({configuration_id:configurationId});if(!valid(ticket))return;matchingConfiguration(value,configurationId);setConfiguration(value);setPollPaused(false);
 });}
 useEffect(()=>{if(!configuration||!['installing','testing'].includes(configuration.status)||pollPaused||busy)return;const timer=setTimeout(status,2000);return()=>clearTimeout(timer);},[configuration,busy,pollPaused]);
 function execute(){if(!configuration||configuration.status!=='planned')return;const reviewed=configuration;void action('等待原生确认并执行',async ticket=>{
  const value=await toolConfigurations.execute({configuration_id:reviewed.configuration_id,expected_revision:reviewed.revision,plan_sha256:reviewed.plan_sha256});if(!valid(ticket))return;matchingConfiguration(value,reviewed.configuration_id);setConfiguration(value);setPollPaused(false);if(value.cancelled)setNotice('已取消本次配置执行。');
 });}
 function activate(){if(!configuration||configuration.install?.status!=='passed')return;const reviewed=configuration;void action('生成执行技能',async ticket=>{
  const value=await toolConfigurations.activate({configuration_id:reviewed.configuration_id,expected_revision:reviewed.revision,plan_sha256:reviewed.plan_sha256});if(!valid(ticket))return;matchingConfiguration(value,reviewed.configuration_id);setExecution(value);setConfiguration(old=>old?{...old,status:value.status,revision:value.revision}:old);setResourceIds([]);setBound(false);if(value.status!=='active'||!value.execution_skill)throw Error(value.reason||'服务未返回可用的执行技能，请核对真实状态');setNotice('执行技能已生成，交付与安装指导已封存。');
 });}
 function readExecution(){if(!configuration)return;const configurationId=configuration.configuration_id;void action('读取执行技能',async ticket=>{
  const value=await toolConfigurations.read({configuration_id:configurationId});if(!valid(ticket))return;matchingConfiguration(value,configurationId);setExecution(value);setResourceIds([]);setConfiguration(old=>old?{...old,status:value.status,revision:value.revision}:old);setBound(false);
 });}
 async function currentContext(ticket:number){const value=await toolConfigurations.context();if(!valid(ticket))return null;setContext(value);if(!value.hasConversation||!value.owner_key||value.provider!==provider||sharingProvider!==value.provider)throw Error('请选择当前对话的服务商，并先建立真实对话');if(context?.owner_key!==value.owner_key){setBound(false);setResourceIds([]);throw Error('对话、服务商或计算目标已变化，请重新选择');}return value;}
 async function sameOwner(ticket:number,owner:Context){const value=await toolConfigurations.context();if(!valid(ticket))return false;setContext(value);if(value.owner_key!==owner.owner_key||value.provider!==owner.provider||!value.hasConversation){setBound(false);setResourceIds([]);throw Error('对话、服务商或计算目标已变化，请重新选择');}return true;}
 function bind(){if(!execution?.execution_skill)return;const skill=execution;void action('授权当前对话',async ticket=>{
  const owner=await currentContext(ticket);if(!owner)return;await toolConfigurations.bind({configuration_id:skill.configuration_id,providers:[owner.provider]});if(!valid(ticket)||!await sameOwner(ticket,owner))return;setBound(true);onSelect({attachmentId:crypto.randomUUID(),name:skill.execution_skill!.id,path:'studio-execution:'+encodeURIComponent(skill.execution_skill!.id)});setNotice('已授权当前对话引用执行技能。');
 });}
 function grant(){if(!execution||!record||!resourceIds.length)return;const skill=execution,attachment=record.delivery_attachment,ids=[...resourceIds],selectedPurpose=purpose;
  void action(selectedPurpose==='repair'?'授权本次委托的修复指导':'限时授权前置指导',async ticket=>{
   const owner=await currentContext(ticket);if(!owner)return;const value=await toolConfigurations.grant({configuration_id:skill.configuration_id,purpose:selectedPurpose,resource_ids:ids});if(!valid(ticket)||!await sameOwner(ticket,owner))return;
   const delivery=skill.guidance_resources.filter(resource=>resource.role==='delivery').some(resource=>ids.includes(resource.id));if(delivery&&attachment)onSelect({attachmentId:crypto.randomUUID(),name:attachment.name,path:attachment.path});setNotice((value.duration==='delegation'?t('修复指导已授权给当前委托；同一会话、项目、环境和所选资源内可持续重试，重启后保留，可在共享设置撤销。'):t('所选指导已限时授权至 ')+new Date(value.expires_at!).toLocaleTimeString())+t(delivery?'，交付技能用于下条消息。':'；未附加未授权的交付技能。'));
  });
 }
 function toggleResource(id:string,checked:boolean){setResourceIds(old=>checked?[...new Set([...old,id])]:old.filter(value=>value!==id));}
 const matchingConfigurations=configurations.filter(value=>record&&identity(value)===identity(record));
 const configurationSource=matchingConfigurations.find(value=>value.configuration_id===(configuration?.configuration_id||selectedConfigurationId));
 return {packages,configurations:matchingConfigurations,configurationSource,selectedConfigurationId,context,record,candidate,selected,version,busy,loading,error,notice,configuring,projects:authorizedProjects,environments,projectId,environmentId,projectName,configuration,execution,pollPaused,sharingProvider,purpose,resourceIds,bound,refresh,selectPackage,choose,changePackage,startConfiguration,targetEnvironment,targetProject,setProjectName,createProject,plan,chooseConfiguration,status,execute,activate,readExecution,bind,grant,setSharingProvider,setPurpose,toggleResource};
}
