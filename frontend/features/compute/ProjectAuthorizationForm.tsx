import Field from '../../ui/Field';
import Notice from '../../ui/Notice';
import {useEffect,useRef,useState} from 'react';
import {newProjectDefaults,scopedSuggestedInputRoot,suggestedProjectEnvironment} from './project-setup-defaults.mjs';
import {engines} from '../../ui/presentation/engines';
import {wslPath} from '../../ui/presentation/paths';
import {type Environment} from '../../../contracts/dto/compute';
import {validLocalGpuIds} from '../../../contracts/compute/project-policy.mjs';
import {t} from "../../ui/i18n";
import {projectPolicyChanges} from "./project-policy-edit.mjs";
import {invoke} from '../../api/studio';
import type {ResourceToolLibrary,ResourceToolScheduler} from '../../../contracts/dto/resource-tools';

import type {ProjectAuthorizationSpec} from "../../../contracts/dto/compute";
import './project-authorization.css';
export type {ProjectAuthorizationSpec} from "../../../contracts/dto/compute";
const list=(value:string)=>value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
function parseGpuIds(value:string):number[]|null {
 const input=value.trim();
 if(!input)return [];
 if(!/^(?:0|[1-9]\d*)(?:\s*,\s*(?:0|[1-9]\d*))*$/.test(input))return null;
 const ids=[...new Set(input.split(',').map(Number))];
 return validLocalGpuIds(ids)?ids:null;
}
export default function ProjectAuthorizationForm({environments,busy=false,suggestedInputRoot,suggestedEnvironmentId,suggestedSchedulerId,onSubmit,initialSpec,defaults,onCancel,resource}:{environments:Environment[];busy?:boolean;suggestedInputRoot?:string;suggestedEnvironmentId?:string;suggestedSchedulerId?:string;initialSpec?:ProjectAuthorizationSpec;defaults?:ProjectAuthorizationSpec;onCancel?:()=>void;resource?:{profileId:string;profileVersion:number};onSubmit:(spec:ProjectAuthorizationSpec)=>Promise<void>}){
 const seed=initialSpec||defaults;
 const [tools,setTools]=useState<{scope:string;entries:[string,string][];schedulers:ResourceToolScheduler[];workfileRoot?:string}|null>(null);
 const scope=resource?JSON.stringify([resource.profileId,resource.profileVersion]):'';
 useEffect(()=>{
  if(!resource)return;
  let active=true;
  void invoke<ResourceToolLibrary>('tools.resource.list',{resource_id:'ssh:'+resource.profileId,profile_version:resource.profileVersion}).then(value=>{
   if(active)setTools({scope,entries:value.setups.filter(row=>row.status==='active').map(row=>['private.'+row.manifest.id,row.manifest.name]),schedulers:value.schedulers??[],workfileRoot:value.workfile_root});
  }).catch(()=>{});
  return ()=>{active=false;};
 },[scope]);
 const resourceData=tools?.scope===scope?tools:null,schedulers=resourceData?.schedulers??[];
 const workfileRoot=scopedSuggestedInputRoot(resourceData?.workfileRoot);
 const choices=new Map<string,string>(engines.map(([id,label]):[string,string]=>[id,label]));
 if(resource||seed?.policy.engines.includes('installation.check'))choices.set('installation.check','工具安装与最小测试');
 for(const id of seed?.policy.engines||[])if(id.startsWith('private.'))choices.set(id,id);
 for(const [id,label] of resourceData?.entries??[])choices.set(id,label);
 const engineOptions=[...choices];
 const [draft,setDraft]=useState<ProjectAuthorizationSpec>(()=>seed?structuredClone(seed):newProjectDefaults(engines.map(([id])=>id),resource?[]:environments.map(environment=>environment.id),suggestedEnvironmentId,suggestedInputRoot)),[rootText,setRootText]=useState(()=>seed?seed.policy.input_roots.join('\n'):scopedSuggestedInputRoot(suggestedInputRoot)||''),[clusterText,setClusterText]=useState(seed?.policy.clusters?.join('\n')||''),[issues,setIssues]=useState<Record<string,string>>({}),[json,setJson]=useState(''),[jsonDirty,setJsonDirty]=useState(false),[toolsOpen,setToolsOpen]=useState(!!resource),[resourcesOpen,setResourcesOpen]=useState(false);
 const [gpuText,setGpuText]=useState(()=>{
  if(!seed)return '0';
  const saved=seed.policy.gpus;
  return validLocalGpuIds(saved)?saved.join(','):JSON.stringify({gpus:saved});
 });
 const gpuIds=parseGpuIds(gpuText),gpuError=t('GPU 编号须为以逗号分隔的非负整数。');
 const environmentTouched=useRef(false),schedulerTouched=useRef(false);
 useEffect(()=>{if(resource||initialSpec||environmentTouched.current||draft.policy.environments.length||draft.policy.clusters?.length)return;const id=suggestedProjectEnvironment(environments.map(environment=>environment.id),suggestedEnvironmentId);if(id)setDraft(old=>({...old,policy:{...old.policy,environments:[id]}}));},[scope,initialSpec,environments,suggestedEnvironmentId]);
 useEffect(()=>{
  if(initialSpec||schedulerTouched.current||!suggestedSchedulerId||!schedulers.some(item=>item.id===suggestedSchedulerId))return;
  setClusterText(old=>old.trim()?old:suggestedSchedulerId);
 },[initialSpec,resourceData,suggestedSchedulerId]);
 function showIssues(errors:Record<string,string>){setIssues(errors);if(errors.engines)setToolsOpen(true);if(errors.limits)setResourcesOpen(true);}

 function patchPolicy(key:string,value:any){setDraft(old=>({...old,policy:{...old.policy,[key]:value}}));setIssues({});}
 function setScheduler(id:string,selected:boolean){
  schedulerTouched.current=true;
  setClusterText(old=>[...new Set([...list(old).filter(value=>value!==id),...selected?[id]:[]])].join('\n'));
  setIssues({});
 }
 function addInputRoot(root:string){
  setRootText(old=>[...new Set([...list(old),root])].join('\n'));
  setIssues({});
 }
 function validate(value:any){
  const errors:Record<string,string>={};
  if(!value||typeof value!=='object'||Object.keys(value).some(key=>!['name','policy'].includes(key)))errors.json=t('仅支持新项目名称和明确的授权策略。');
  if(typeof value?.name!=='string'||!value.name.trim())errors.name=t('请填写项目名称');
  const policy=value?.policy;if(!policy||typeof policy!=='object')errors.json=t('请提供完整授权策略');
  else{
   if(Object.keys(policy).some(key=>!['engines','gpus','max_seconds','max_concurrent','input_roots','environments','clusters'].includes(key)))errors.json=t('存在不支持的授权字段');
   if(!Array.isArray(policy.engines)||!policy.engines.length||policy.engines.some((engine:any)=>!engineOptions.some(([id])=>id===engine)))errors.engines=t('请选择至少一个计算引擎');
   if(!validLocalGpuIds(policy.gpus))errors.gpus=gpuError;
   if(!Number.isSafeInteger(policy.max_seconds)||policy.max_seconds<1||!Number.isSafeInteger(policy.max_concurrent)||policy.max_concurrent<1)errors.limits=t('时长和并发数必须为正整数');
   if(!Array.isArray(policy.input_roots)||!policy.input_roots.length||policy.input_roots.some((root:any)=>typeof root!=='string'||!root.startsWith('/')||/[\r\n\0]/.test(root)||root.split('/').includes('..')))errors.roots=t('请填写至少一个明确的 Linux 绝对输入目录');
   if(!Array.isArray(policy.environments)||policy.environments.some((id:any)=>typeof id!=='string'||!id.trim())||policy.clusters!==undefined&&(!Array.isArray(policy.clusters)||policy.clusters.some((id:any)=>typeof id!=='string'||!id.trim())))errors.environments=t('环境与集群必须是明确的登记 ID');
   else if(!policy.environments.length&&!policy.clusters?.length)errors.environments=t('请选择计算环境或明确授权集群');
  }
  return errors;
 }
 function fromForm<GpuIds extends number[]|string>(gpus:GpuIds){const clusters=[...new Set(list(clusterText))],policy={...draft.policy,gpus,input_roots:[...new Set(list(rootText).map(wslPath))]};if(clusters.length||Object.hasOwn(draft.policy,'clusters'))policy.clusters=clusters;return {...draft,name:draft.name.trim(),policy};}
 function formJson(){return JSON.stringify(fromForm(gpuIds??gpuText),null,2);}
 useEffect(()=>{if(!jsonDirty)setJson(formJson());},[draft,gpuText,rootText,clusterText,jsonDirty]);
 function showJson(){setJson(formJson());setJsonDirty(false);setIssues(old=>{const {json,...remaining}=old;return remaining;});}
 const jsonDisclosure=useRef<HTMLDetailsElement>(null);
 function applyJson(){try{const next=JSON.parse(json),errors=validate(next);showIssues(errors);if(Object.keys(errors).length)return;environmentTouched.current=true;schedulerTouched.current=true;setDraft(next);setGpuText(next.policy.gpus.join(','));setRootText(next.policy.input_roots.join('\n'));setClusterText((next.policy.clusters||[]).join('\n'));setJsonDirty(false);}catch{setIssues({json:t('JSON 格式无效，请检查后再应用')});}}
 async function submit(){if(busy)return;if(jsonDirty){if(jsonDisclosure.current)jsonDisclosure.current.open=true;setIssues({json:t('请先应用或放弃高级 JSON 修改')});return;}if(gpuIds===null){showIssues({gpus:gpuError});return;}const value=fromForm(gpuIds),errors=validate(value);showIssues(errors);if(Object.keys(errors).length)return;try{await onSubmit(value);}catch(error){setIssues({form:error instanceof Error?error.message:String(error)});}}
 const changes=initialSpec&&gpuIds!==null?projectPolicyChanges(initialSpec,fromForm(gpuIds)):[];
 const display=(value:any)=>value===undefined||value===null?t('未设置'):Array.isArray(value)?value.join(', '):String(value);
 const error=(key:string)=>issues[key]&&<Notice severity="error" compact>{issues[key]}</Notice>;
 const fieldIssue=(value?:string)=>value&&<span role="alert">{value}</span>;
 const selectedEnvironment=draft.policy.environments.length===1?draft.policy.environments[0]:'',multipleEnvironments=draft.policy.environments.length>1;
 const changeLabels:Record<string,string>={name:t('项目名称'),'policy.engines':t('工具与引擎'),'policy.gpus':'GPU','policy.max_seconds':t('时长上限 · s'),'policy.max_concurrent':t('最大并发数'),'policy.input_roots':t('输入目录'),'policy.environments':t('计算环境'),'policy.clusters':t('远程集群（可选）')};
 return <div className="project-authorization" data-testid="project-authorization">
  <fieldset disabled={busy}>
   {!initialSpec&&<p className="project-setup-note">{t('工具默认可用；计算仍需复核并点击执行。')}</p>}
   <Field label={t('项目名称')} error={fieldIssue(issues.name)}>{control=><input {...control} aria-label={t('项目名称')} value={draft.name} onChange={e=>{setDraft({...draft,name:e.target.value});setIssues({});}}/>}</Field>
   <div className="project-basic-resources"><Field label={t('计算环境')} error={fieldIssue(issues.environments)}>{control=><select {...control} aria-label={t('计算环境')} value={selectedEnvironment} onChange={e=>{environmentTouched.current=true;patchPolicy('environments',e.target.value?[e.target.value]:[]);}}><option value="" disabled={multipleEnvironments}>{multipleEnvironments?t('多个计算环境')+' · '+draft.policy.environments.length:t(environments.length?'选择环境':'尚无已登记环境')}</option>{selectedEnvironment&&!environments.some(environment=>environment.id===selectedEnvironment)&&<option value={selectedEnvironment}>{t('已保存的计算环境')} · {selectedEnvironment}</option>}{environments.map(environment=><option key={environment.id} value={environment.id}>{environment.name}</option>)}</select>}</Field><Field label={t('GPU 编号')} description={t('留空表示不授权本地 GPU。多个编号用逗号分隔。')} error={fieldIssue(issues.gpus||(gpuIds===null?gpuError:undefined))}>{control=><input {...control} aria-label={t('GPU 编号')} placeholder="0,1" value={gpuText} onChange={e=>{setGpuText(e.target.value);setIssues({});}}/>}</Field></div>
   <div className="project-input-root"><Field label={t('输入目录')} error={fieldIssue(issues.roots)}>{control=><textarea {...control} aria-label={t('输入目录')} rows={2} value={rootText} onChange={e=>{setRootText(e.target.value);setIssues({});}}/>}</Field>
    {workfileRoot&&<div className="authorization-suggestion"><code>{workfileRoot}</code><button type="button" className="button" data-testid="project-resource-workfile" onClick={()=>addInputRoot(workfileRoot)}>{t('使用此资源的 workfile 目录')}</button></div>}
    {scopedSuggestedInputRoot(suggestedInputRoot)&&suggestedInputRoot!==workfileRoot&&<div className="authorization-suggestion"><button className="button" onClick={()=>addInputRoot(suggestedInputRoot!)}>{t('使用当前流程输入目录')}</button></div>}
   </div>
   {resource&&<section className="project-setting-content" data-testid="project-resource-schedulers">
    <h4>{t('授权此项目使用远端调度器')}</h4>
    <p>{t('保存项目后，所选调度器和工具才会加入授权范围。')}</p>
    {schedulers.length?<div className="authorization-options">{schedulers.map(item=><label key={item.id}>
     <input type="checkbox" data-testid="project-resource-scheduler" value={item.id} checked={list(clusterText).includes(item.id)} onChange={e=>setScheduler(item.id,e.currentTarget.checked)}/>
     <span>{item.name} · {item.scheduler.toUpperCase()}{item.queue&&' · '+item.queue}</span>
    </label>)}</div>:resourceData&&<p className="muted">{t('此资源尚无已登记的调度器。')}</p>}
    {schedulers.some(item=>item.queue_targets&&list(clusterText).includes(item.id))&&<p className="muted">{t('所选调度器按队列授权运行。保存项目后，在队列设置中批准允许使用的目标。')}</p>}
    {choices.has('installation.check')&&<p className="muted">{t('要验证新工具，请在「工具与引擎」中启用「工具安装与最小测试」。')}</p>}
   </section>}
   <dl className="project-resource-summary" data-testid="project-resource-summary">
    <div><dt>GPU</dt><dd>{gpuIds?.length===0?t('未授权本地 GPU'):gpuText}</dd></div>
    <div><dt>{t('时长上限 · s')}</dt><dd>{draft.policy.max_seconds??t('未设置')}</dd></div>
    <div><dt>{t('最大并发数')}</dt><dd>{draft.policy.max_concurrent??t('未设置')}</dd></div>
   </dl>
   <details className="project-setting-group" data-testid="project-tools-details" open={toolsOpen} onToggle={event=>setToolsOpen(event.currentTarget.open)}><summary>{t('工具与引擎')}<span className="setting-summary">{t('已启用')} {draft.policy.engines.length} / {engineOptions.length}</span></summary><div className="project-setting-content"><p>{t('工具可用性仍取决于所选环境，执行前会检查。')}</p><div className="authorization-options">{engineOptions.map(([id,name])=><label key={id}><input type="checkbox" checked={draft.policy.engines.includes(id)} onChange={e=>patchPolicy('engines',e.target.checked?[...draft.policy.engines,id]:draft.policy.engines.filter(value=>value!==id))}/><span>{t(name)}</span></label>)}</div>{error('engines')}</div></details>
   <details className="project-setting-group" data-testid="project-resource-details" open={resourcesOpen} onToggle={event=>setResourcesOpen(event.currentTarget.open)}><summary>{t('资源与访问范围')}<span className="setting-summary">{t('运行限额')}</span></summary><div className="project-setting-content"><div className="form-row"><label>{t('时长上限 · s')}<input aria-label={t('授权时长上限')} type="number" min={1} value={draft.policy.max_seconds??''} onChange={e=>patchPolicy('max_seconds',e.target.value===''?null:Number(e.target.value))}/></label><label>{t('最大并发数')}<input aria-label={t('最大并发数')} type="number" min={1} value={draft.policy.max_concurrent??''} onChange={e=>patchPolicy('max_concurrent',e.target.value===''?null:Number(e.target.value))}/></label></div>{error('limits')}<h4>{t('更多计算环境')}</h4><div className="authorization-options">{environments.map(environment=><label key={environment.id}><input type="checkbox" checked={draft.policy.environments.includes(environment.id)} onChange={e=>{environmentTouched.current=true;patchPolicy('environments',e.target.checked?[...draft.policy.environments,environment.id]:draft.policy.environments.filter(value=>value!==environment.id));}}/><span>{environment.name}</span></label>)}</div><label>{t('远程集群（可选）')}<textarea aria-label={t('允许的集群 ID · 每行一个')} value={clusterText} onChange={e=>{environmentTouched.current=true;setClusterText(e.target.value);setIssues({});}} rows={2}/></label></div></details>
   <details ref={jsonDisclosure} className="project-setting-group authorization-json" onToggle={e=>{if(e.currentTarget.open&&!json)showJson();}}><summary>{t('高级配置')}</summary><div className="project-setting-content"><Field label={t('高级 JSON 授权')} error={fieldIssue(issues.json)}>{control=><textarea {...control} aria-label={t('高级 JSON 授权')} rows={12} value={json} onChange={e=>{setJson(e.target.value);setJsonDirty(true);}}/>}</Field><div className="button-row"><button className="button" onClick={applyJson}>{t('应用 JSON')}</button><button className="button" onClick={showJson}>{t('从表单重置 JSON')}</button>{jsonDirty&&<span>{t('存在未应用的 JSON 修改')}</span>}</div></div></details>
   {error('form')}
   {initialSpec&&<section data-testid="project-policy-delta"><h3>{t('本次变更')}</h3>{changes.length?<dl>{changes.map(change=><div key={change.key}><dt>{changeLabels[change.key]||change.key}</dt><dd><span>{display(change.before)}</span> → <strong>{display(change.after)}</strong></dd></div>)}</dl>:<p>{t('尚无变更')}</p>}<p className="muted">{t('未列出的项目元数据和策略字段将原样保留。保存前会重新检查当前记录。')}</p></section>}
   <div className="project-save-actions"><button className="button primary" disabled={!!initialSpec&&!changes.length} data-testid="save-project-authorization" onClick={()=>void submit()}>{t(initialSpec?'保存项目设置':'创建项目')}</button>{onCancel&&<button className="button" onClick={onCancel}>{t('取消')}</button>}</div>
  </fieldset>
 </div>;
}
