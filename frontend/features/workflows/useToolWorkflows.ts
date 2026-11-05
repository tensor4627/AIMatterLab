import {useEffect,useRef,useState} from 'react';
import type {ToolConfigurationIndex,ToolExecutionSkill,ToolGroupCompiled,ToolGroupDefinition,ToolGroupRecord} from '../../../contracts/dto/tools';
import type {ToolWorkflowContext,ToolWorkflowRead,ToolWorkflowStep} from '../../../contracts/dto/tool-workflows';
import {toolWorkflows} from '../../api/tool-workflows';
import {toolConfigurations,toolGroups} from '../../api/tools';

export interface ToolWorkflowFocus {execution_id:string;step_id:string;nonce:string}
export interface ToolWorkflowsOptions {task:any;worker:boolean;busy:boolean;toolWorkflowFocus?:ToolWorkflowFocus}
type Draft={definition:ToolGroupDefinition;compiled:ToolGroupCompiled;expectedRevision:number};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
const hex=(value:string)=>/^[a-f0-9]{64}$/.test(value);
export const referenceFunctions=(value:ToolExecutionSkill)=>value.functions.filter(feature=>feature.engine==='installation.check'&&!feature.inputs.length&&!feature.parameters.length&&same(feature.operation.command,['{python}','{entrypoint}'])&&feature.outputs.length===1&&feature.outputs[0].type==='file'&&feature.outputs[0].format==='json');
export const supportedGroup=(value:ToolGroupRecord)=>!value.compiled.inputs.length&&value.compiled.steps.length>0&&value.compiled.steps.every(step=>step.engine==='installation.check'&&!Object.keys(step.inputs).length&&!Object.keys(step.parameters).length&&step.outputs.length===1&&step.outputs[0].type==='file'&&step.outputs[0].format==='json');

/** Explicit fixed-reference workflow UI. Status and navigation never prepare or submit a run. */
export function useToolWorkflows({task,worker,busy:parentBusy,toolWorkflowFocus}:ToolWorkflowsOptions){
 const enabled=!!task.workspace?.id&&worker&&!parentBusy;
 const workspaceIdentity=JSON.stringify([task.id,task.provider,task.threadId,task.workspace?.id,task.authoring?.workerBinding,task.deployment?.workerBinding]),previousWorkspace=useRef(workspaceIdentity);
 const key=JSON.stringify([workspaceIdentity,worker,parentBusy]);
 const lifetime=useRef({key,generation:0});if(lifetime.current.key!==key)lifetime.current={key,generation:lifetime.current.generation+1};
 const alive=useRef(true),lock=useRef<symbol|null>(null),contextSequence=useRef(0),requests=useRef(new Map<string,string>()),focusedRequest=useRef('');
 const [context,setContext]=useState<ToolWorkflowContext|null>(null),[loading,setLoading]=useState(false),[working,setWorking]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const contextRef=useRef(context);contextRef.current=context;
 const [group,setGroup]=useState<ToolGroupRecord|null>(null),[groupId,setGroupId]=useState(''),[historicalVersion,setHistoricalVersion]=useState(''),[selectedConfigurations,setSelectedConfigurations]=useState<Record<string,ToolExecutionSkill>>({});
 const [name,setName]=useState('CPU 工具组流程'),[directory,setDirectory]=useState('cpu-workflow');
 const [builderConfiguration,setBuilderConfiguration]=useState<ToolExecutionSkill|null>(null),[builderConfigurationId,setBuilderConfigurationId]=useState(''),[builderFunction,setBuilderFunction]=useState(''),[builderId,setBuilderId]=useState(''),[builderName,setBuilderName]=useState('CPU 有序参考组'),[stepCount,setStepCount]=useState(2),[draft,setDraft]=useState<Draft|null>(null);
 const [bundle,setBundle]=useState<ToolWorkflowRead|null>(null),[executionId,setExecutionId]=useState(''),[focusedStep,setFocusedStep]=useState(''),[pollPaused,setPollPaused]=useState(false),[stepUnconfirmed,setStepUnconfirmed]=useState(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;lifetime.current.generation++;contextSequence.current++;lock.current=null;};},[]);
 function valid(ticket:number){return alive.current&&lifetime.current.generation===ticket&&lifetime.current.key===key&&enabled;}
 function invalidate(){lifetime.current.generation++;lock.current=null;setWorking('');setError('');setNotice('');}
 function clearSelections(preserveExecution=false){setGroup(null);setGroupId('');setHistoricalVersion('');setSelectedConfigurations({});setBuilderConfiguration(null);setBuilderConfigurationId('');setBuilderFunction('');setDraft(null);if(!preserveExecution){setBundle(null);setExecutionId('');setFocusedStep('');setStepUnconfirmed(false);}setPollPaused(preserveExecution);}
 function acceptContext(value:ToolWorkflowContext){if(value.task_id!==task.id||value.workspace_id!==task.workspace?.id||!value.owner_key)throw Error('流程上下文与当前任务或工作区不符');}
 async function refresh(){
  if(!enabled||!alive.current)return;const sequence=++contextSequence.current,ticket=lifetime.current.generation;setLoading(true);setError('');
  try{const value=await toolWorkflows.context(task.id);if(!valid(ticket)||sequence!==contextSequence.current)return;acceptContext(value);if(contextRef.current&&contextRef.current.owner_key!==value.owner_key){invalidate();clearSelections();}setContext(value);}catch(error){if(valid(ticket)&&sequence===contextSequence.current){setContext(null);setError(errorText(error));}}finally{if(alive.current&&sequence===contextSequence.current)setLoading(false);}
 }
 useEffect(()=>{const preserve=previousWorkspace.current===workspaceIdentity;previousWorkspace.current=workspaceIdentity;invalidate();contextSequence.current++;setContext(null);clearSelections(preserve);focusedRequest.current='';setLoading(false);if(enabled)void refresh();},[key]);
 useEffect(()=>window.studio?.onEvent?.(event=>{if(event.method==='studio/workerConnected'){invalidate();setContext(null);clearSelections();void refresh();}}),[key]);
 async function owner(ticket:number,expected:string){
  const value=await toolWorkflows.context(task.id);if(!valid(ticket))return null;acceptContext(value);
  if(value.owner_key!==expected){invalidate();setContext(null);clearSelections();setError('对话、工作区或作业服务已变化，请刷新后重新选择');return null;}
  setContext(value);return value;
 }
 async function action(label:string,work:(ticket:number,ownerKey:string,facts:ToolWorkflowContext)=>Promise<void>){
  const initial=contextRef.current;if(!enabled||!alive.current||lock.current||!initial)return;const ticket=lifetime.current.generation,operation=Symbol(label);lock.current=operation;setWorking(label);setError('');setNotice('');
  try{const current=await owner(ticket,initial.owner_key);if(current&&valid(ticket))await work(ticket,initial.owner_key,current);}catch(error){if(valid(ticket)){try{if(!await owner(ticket,initial.owner_key))return;}catch{}if(valid(ticket)){setError(errorText(error));setPollPaused(true);}}}finally{if(valid(ticket)&&lock.current===operation){lock.current=null;setWorking('');}}
 }
 async function checked<T>(ticket:number,ownerKey:string,promise:Promise<T>){const value=await promise;if(!valid(ticket)||!await owner(ticket,ownerKey))return null;return value;}
 function requestId(kind:string,value:unknown){const identity=JSON.stringify([task.id,task.workspace.id,contextRef.current?.owner_key,kind,value]);if(!requests.current.has(identity))requests.current.set(identity,crypto.randomUUID());return requests.current.get(identity)!;}
 function configurationIndex(id:string,facts:ToolWorkflowContext){const value=facts.configurations.find(item=>item.configuration_id===id);if(!value)throw Error('所选配置不属于当前作业服务');return value;}
 function checkConfiguration(value:ToolExecutionSkill,index:ToolConfigurationIndex,feature?:{tool_id:string;package_version:string;function_id:string}){
  if(value.configuration_id!==index.configuration_id||value.package_id!==index.package_id||value.package_version!==index.package_version||value.target.project_id!==index.project_id||value.target.environment_id!==index.environment_id)throw Error('配置回执与所选配置身份不符');
  if(value.status!=='active'||!value.execution_skill)throw Error(value.reason||'此配置没有已激活的执行技能');
  if(!referenceFunctions(value).length)throw Error('当前流程仅支持固定串行 CPU installation.check 参考');
  if(feature&&(value.package_id!==feature.tool_id||value.package_version!==feature.package_version||!referenceFunctions(value).some(item=>item.id===feature.function_id)))throw Error('配置与步骤的准确包版本或功能不匹配');
 }
 function selectGroup(id:string,version?:string){
  invalidate();setGroupId(id);setGroup(null);setHistoricalVersion(version||'');setSelectedConfigurations({});setBundle(null);setExecutionId('');setFocusedStep('');if(!id)return;
  const summary=contextRef.current?.groups.find(item=>item.id===id),selectedVersion=version||summary?.version||undefined;
  void action('读取冻结工具组',async(ticket,ownerKey)=>{const value=await checked(ticket,ownerKey,toolGroups.read(id,selectedVersion));if(!value)return;if(value.id!==id||selectedVersion&&value.version!==selectedVersion)throw Error('工具组回执与所选版本不符');setGroup(value);setHistoricalVersion(value.version||'');});
 }
 function readHistorical(){if(!groupId||!hex(historicalVersion)){setError('请输入完整的历史工具组版本 SHA256');return;}selectGroup(groupId,historicalVersion);}
 function selectConfiguration(stepId:string,id:string){
  invalidate();setSelectedConfigurations(old=>{const value={...old};delete value[stepId];return value;});if(!id||!group)return;const feature=group.compiled.steps.find(item=>item.id===stepId);if(!feature)return;
  void action('核对步骤配置',async(ticket,ownerKey,facts)=>{const index=configurationIndex(id,facts),value=await checked(ticket,ownerKey,toolConfigurations.read({configuration_id:id}));if(!value)return;checkConfiguration(value,index,feature);setSelectedConfigurations(old=>({...old,[stepId]:value}));});
 }
 function selectBuilderConfiguration(id:string){
  invalidate();setBuilderConfigurationId(id);setBuilderConfiguration(null);setBuilderFunction('');setDraft(null);if(!id)return;
  void action('读取参考配置',async(ticket,ownerKey,facts)=>{const index=configurationIndex(id,facts),value=await checked(ticket,ownerKey,toolConfigurations.read({configuration_id:id}));if(!value)return;checkConfiguration(value,index);setBuilderConfiguration(value);});
 }
 function builderPatch(value:{id?:string;name?:string;functionId?:string;count?:number}){setDraft(null);if(value.id!==undefined)setBuilderId(value.id);if(value.name!==undefined)setBuilderName(value.name);if(value.functionId!==undefined)setBuilderFunction(value.functionId);if(value.count!==undefined)setStepCount(value.count);}
 function compileReference(){
  if(!builderConfiguration||!builderFunction||! /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(builderId)||builderId.length>63||!builderName.trim()||!Number.isInteger(stepCount)||stepCount<1||stepCount>8)return;
  const feature=referenceFunctions(builderConfiguration).find(item=>item.id===builderFunction);if(!feature)return;
  const definition:ToolGroupDefinition={schema_version:1,id:builderId,name:builderName.trim(),inputs:[],steps:Array.from({length:stepCount},(_,index)=>({id:'step-'+(index+1),tool_id:builderConfiguration.package_id,package_version:builderConfiguration.package_version,function_id:feature.id,inputs:{},parameters:{},depends_on:index?['step-'+index]:[]})),outputs:feature.outputs.map(port=>({id:port.id,step_id:'step-'+stepCount,port_id:port.id,required:port.required}))};
  void action('编译有序 CPU 工具组',async(ticket,ownerKey,facts)=>{const value=await checked(ticket,ownerKey,toolGroups.compile(definition));if(value)setDraft({definition,compiled:value,expectedRevision:facts.groups.find(item=>item.id===definition.id)?.revision||0});});
 }
 function saveDraft(){if(!draft)return;const reviewed=draft;void action('保存并冻结工具组',async(ticket,ownerKey)=>{const value=await checked(ticket,ownerKey,toolGroups.save(reviewed.definition,reviewed.expectedRevision));if(!value)return;if(!value.has_frozen_version||!value.version||!same(value.definition,reviewed.definition))throw Error('服务未返回此定义的冻结版本');setGroupId(value.id);setGroup(value);setHistoricalVersion(value.version);setSelectedConfigurations({});setDraft(null);setNotice('工具组定义已冻结，执行状态仍为 not_run');});}
 const selectedSteps=group?.compiled.execution_order.map(id=>group.compiled.steps.find(step=>step.id===id)!)||[];
 const authorities=selectedSteps.map(step=>selectedConfigurations[step.id]),commonTarget=authorities.length&&authorities.every(Boolean)&&authorities.every(value=>same(value.target,authorities[0].target))?authorities[0].target:null;
 const canCreate=!!group?.has_frozen_version&&!!group.version&&supportedGroup(group)&&!!commonTarget&&!!name.trim()&&name.trim().length<=80&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(directory);
 function acceptBundle(value:ToolWorkflowRead,id?:string){
  if(value.workflow.schema_version!==2||value.execution.schema_version!==1||value.workflow.workspace_id!==task.workspace?.id||value.execution.workspace_id!==task.workspace?.id||value.execution.workflow_id!==value.workflow.id||!value.workflow.execution_ids.includes(value.execution.id)||value.execution.execution_mode!=='manual_step_review'||id&&value.execution.id!==id)throw Error('流程回执与当前工作区或执行快照不符');
  if(bundle?.execution.id===value.execution.id&&value.execution.revision<bundle.execution.revision)throw Error('收到较旧流程状态，请保留当前回执');setBundle(value);setExecutionId(value.execution.id);setPollPaused(false);setStepUnconfirmed(false);
 }
 function create(){if(!canCreate||!group||!commonTarget)return;const chosen=group,configurations=selectedSteps.map(step=>({step_id:step.id,configuration_id:selectedConfigurations[step.id].configuration_id})),body={task_id:task.id,workspace_id:task.workspace.id,name:name.trim(),directory_name:directory,group_id:chosen.id,group_version:chosen.version!,configurations};
  void action('创建工具组流程',async(ticket,ownerKey)=>{const value=await checked(ticket,ownerKey,toolWorkflows.create({...body,request_id:requestId('create',body)}));if(!value)return;if(value.execution.group.id!==chosen.id||value.execution.group.version!==chosen.version||!same(value.execution.target,commonTarget))throw Error('新流程的冻结组或配置目标与审阅选择不符');acceptBundle(value);setNotice('流程目录与快照已创建，尚未准备或提交任何步骤');});
 }
 function retryCreate(request_id:string){void action('核对原创建请求',async(ticket,ownerKey,facts)=>{const original=facts.creations.find(item=>item.request_id===request_id);if(!original)throw Error('原创建请求不属于当前工作区');const value=await checked(ticket,ownerKey,toolWorkflows.retryCreate(task.id,request_id));if(value){acceptBundle(value);setNotice('已核对原元数据创建请求，没有自动准备或提交步骤');}});}
 function readExecution(id:string,stepId=''){
  invalidate();setExecutionId(id);setBundle(null);setFocusedStep(stepId);setPollPaused(false);setStepUnconfirmed(false);if(!id)return;
  void action('读取原流程快照',async(ticket,ownerKey,facts)=>{const reference=facts.workflows.find(item=>item.execution_id===id&&item.workspace_id===task.workspace.id&&item.task_id===task.id);if(!reference)throw Error('所选执行不属于当前工作区，请返回原工作区');const value=await checked(ticket,ownerKey,toolWorkflows.read({task_id:task.id,execution_id:id}));if(!value)return;if(stepId&&!value.execution.steps.some(item=>item.id===stepId))throw Error('原步骤不在此执行快照中');acceptBundle(value,id);});
 }
 useEffect(()=>{if(!toolWorkflowFocus||!context||!enabled||working||loading||focusedRequest.current===toolWorkflowFocus.nonce)return;focusedRequest.current=toolWorkflowFocus.nonce;const indexed=context.workflows.find(item=>item.execution_id===toolWorkflowFocus.execution_id&&item.workspace_id===task.workspace?.id&&item.task_id===task.id);if(!indexed){invalidate();setBundle(null);setExecutionId('');setFocusedStep('');setError('定位的工具组流程不属于当前工作区，未自动切换或执行');return;}readExecution(toolWorkflowFocus.execution_id,toolWorkflowFocus.step_id);},[toolWorkflowFocus?.nonce,context,enabled,working,loading]);
 function status(){if(!bundle)return;const id=bundle.execution.id;void action('核对原流程状态',async(ticket,ownerKey)=>{const value=await checked(ticket,ownerKey,toolWorkflows.status({task_id:task.id,execution_id:id}));if(value)acceptBundle(value,id);});}
 const active=bundle&&!['unknown','stale','failed','cancelled','passed'].includes(bundle.execution.status)&&bundle.execution.steps.some(step=>['preparing','validating','submitting','queued','running'].includes(step.status));
 useEffect(()=>{if(!enabled||!active||working||pollPaused)return;const timer=setTimeout(status,2500);return()=>clearTimeout(timer);},[bundle,enabled,working,pollPaused]);
 function prepare(step:ToolWorkflowStep){if(!bundle||stepUnconfirmed||step.status!=='pending'||!step.eligible)return;const current=bundle.execution;void action('准备此步骤的真实输入',async(ticket,ownerKey)=>{setStepUnconfirmed(true);const value=await checked(ticket,ownerKey,toolWorkflows.prepareStep({task_id:task.id,execution_id:current.id,step_id:step.id,expected_revision:current.revision,request_id:requestId('prepare',[current.id,step.id])}));if(value){acceptBundle(value,current.id);setFocusedStep(step.id);setNotice('已准备原任务输入，尚未执行；请审阅本步骤回执');}});}
 function execute(step:ToolWorkflowStep){if(!bundle||stepUnconfirmed||step.status!=='prepared'||!step.review||step.review.run_id!==step.run_id)return;const current=bundle.execution,review=step.review;void action('等待本步骤原生确认',async(ticket,ownerKey)=>{setStepUnconfirmed(true);const value=await checked(ticket,ownerKey,toolWorkflows.executeStep({task_id:task.id,execution_id:current.id,step_id:step.id,expected_revision:current.revision,review_sha256:review.review_sha256}));if(value){acceptBundle(value,current.id);setFocusedStep(step.id);if(value.cancelled)setNotice('已取消本步骤执行，保留同一已准备任务');}});}
 return {enabled,context,loading,working,error,notice,refresh,group,groupId,historicalVersion,setHistoricalVersion,selectGroup,readHistorical,selectedConfigurations,selectConfiguration,selectedSteps,commonTarget,canCreate,name,setName,directory,setDirectory,create,builderConfiguration,builderConfigurationId,builderFunction,builderId,builderName,stepCount,draft,selectBuilderConfiguration,builderPatch,compileReference,saveDraft,bundle,executionId,focusedStep,readExecution,status,prepare,execute,pollPaused,stepUnconfirmed,retryCreate};
}
