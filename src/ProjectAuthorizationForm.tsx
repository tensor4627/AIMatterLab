import {useEffect,useRef,useState} from 'react';
import {newProjectDefaults,scopedSuggestedInputRoot,suggestedProjectEnvironment} from './project-setup-defaults.mjs';
import './project-navigation.css';
import {engines,wslPath,type Environment} from './types';
import {t} from './i18n';
import {projectPolicyChanges} from '../shared/project-policy-edit.mjs';
export type ProjectAuthorizationSpec={name:string;policy:{engines:string[];gpus:number[];max_seconds:number;max_concurrent:number;input_roots:string[];environments:string[];clusters?:string[]}};
const list=(value:string)=>value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
export default function ProjectAuthorizationForm({environments,busy=false,suggestedInputRoot,suggestedEnvironmentId,onSubmit,initialSpec,onCancel}:{environments:Environment[];busy?:boolean;suggestedInputRoot?:string;suggestedEnvironmentId?:string;initialSpec?:ProjectAuthorizationSpec;onCancel?:()=>void;onSubmit:(spec:ProjectAuthorizationSpec)=>Promise<void>}){
 const [draft,setDraft]=useState<ProjectAuthorizationSpec>(()=>initialSpec?structuredClone(initialSpec):newProjectDefaults(engines.map(([id])=>id),environments.map(environment=>environment.id),suggestedEnvironmentId,suggestedInputRoot)),[gpuText,setGpuText]=useState(()=>initialSpec?initialSpec.policy.gpus.join(','):'0'),[rootText,setRootText]=useState(()=>initialSpec?initialSpec.policy.input_roots.join('\n'):scopedSuggestedInputRoot(suggestedInputRoot)||''),[clusterText,setClusterText]=useState(initialSpec?.policy.clusters?.join('\n')||''),[issues,setIssues]=useState<Record<string,string>>({}),[json,setJson]=useState(''),[jsonDirty,setJsonDirty]=useState(false),[toolsOpen,setToolsOpen]=useState(false),[resourcesOpen,setResourcesOpen]=useState(false);
 const environmentTouched=useRef(false);
 useEffect(()=>{if(initialSpec||environmentTouched.current||draft.policy.environments.length||draft.policy.clusters?.length)return;const id=suggestedProjectEnvironment(environments.map(environment=>environment.id),suggestedEnvironmentId);if(id)setDraft(old=>({...old,policy:{...old.policy,environments:[id]}}));},[initialSpec,environments,suggestedEnvironmentId]);
 function showIssues(errors:Record<string,string>){setIssues(errors);if(errors.engines)setToolsOpen(true);if(errors.limits)setResourcesOpen(true);}

 function patchPolicy(key:string,value:any){setDraft(old=>({...old,policy:{...old.policy,[key]:value}}));setIssues({});}
 function validate(value:any){
  const errors:Record<string,string>={};
  if(!value||typeof value!=='object'||Object.keys(value).some(key=>!['name','policy'].includes(key)))errors.json=t('仅支持新项目名称和明确的授权策略。');
  if(typeof value?.name!=='string'||!value.name.trim())errors.name=t('请填写项目名称');
  const policy=value?.policy;if(!policy||typeof policy!=='object')errors.json=t('请提供完整授权策略');
  else{
   if(Object.keys(policy).some(key=>!['engines','gpus','max_seconds','max_concurrent','input_roots','environments','clusters'].includes(key)))errors.json=t('存在不支持的授权字段');
   if(!Array.isArray(policy.engines)||!policy.engines.length||policy.engines.some((engine:any)=>!engines.some(([id])=>id===engine)))errors.engines=t('请选择至少一个计算引擎');
   if(!Array.isArray(policy.gpus)||!policy.gpus.length||policy.gpus.some((gpu:any)=>!Number.isSafeInteger(gpu)||gpu<0))errors.gpus=t('请明确填写 GPU 编号，如 0 或 0,1');
   if(!Number.isSafeInteger(policy.max_seconds)||policy.max_seconds<1||!Number.isSafeInteger(policy.max_concurrent)||policy.max_concurrent<1)errors.limits=t('时长和并发数必须为正整数');
   if(!Array.isArray(policy.input_roots)||!policy.input_roots.length||policy.input_roots.some((root:any)=>typeof root!=='string'||!root.startsWith('/')||/[\r\n\0]/.test(root)||root.split('/').includes('..')))errors.roots=t('请填写至少一个明确的 Linux 绝对输入目录');
   if(!Array.isArray(policy.environments)||policy.environments.some((id:any)=>typeof id!=='string'||!id.trim())||policy.clusters!==undefined&&(!Array.isArray(policy.clusters)||policy.clusters.some((id:any)=>typeof id!=='string'||!id.trim())))errors.environments=t('环境与集群必须是明确的登记 ID');
   else if(!policy.environments.length&&!policy.clusters?.length)errors.environments=t('请选择计算环境或明确授权集群');
  }
  return errors;
 }
 function fromForm(){const gpus=/^(?:0|[1-9]\d*)(?:\s*,\s*(?:0|[1-9]\d*))*$/.test(gpuText.trim())?[...new Set(gpuText.split(',').map(value=>Number(value.trim())))]:[],clusters=[...new Set(list(clusterText))],policy={...draft.policy,gpus,input_roots:[...new Set(list(rootText).map(wslPath))]};if(clusters.length||Object.hasOwn(draft.policy,'clusters'))policy.clusters=clusters;return {...draft,name:draft.name.trim(),policy};}
 useEffect(()=>{if(!jsonDirty)setJson(JSON.stringify(fromForm(),null,2));},[draft,gpuText,rootText,clusterText,jsonDirty]);
 function showJson(){setJson(JSON.stringify(fromForm(),null,2));setJsonDirty(false);}
 function applyJson(){try{const next=JSON.parse(json),errors=validate(next);showIssues(errors);if(Object.keys(errors).length)return;environmentTouched.current=true;setDraft(next);setGpuText(next.policy.gpus.join(','));setRootText(next.policy.input_roots.join('\n'));setClusterText((next.policy.clusters||[]).join('\n'));setJsonDirty(false);}catch{setIssues({json:t('JSON 格式无效，请检查后再应用')});}}
 async function submit(){if(busy)return;if(jsonDirty){setIssues({json:t('请先应用或放弃高级 JSON 修改')});return;}const value=fromForm(),errors=validate(value);showIssues(errors);if(Object.keys(errors).length)return;try{await onSubmit(value);}catch(error){setIssues({form:error instanceof Error?error.message:String(error)});}}
 const changes=initialSpec?projectPolicyChanges(initialSpec,fromForm()):[];
 const display=(value:any)=>value===undefined||value===null?t('未设置'):Array.isArray(value)?value.join(', '):String(value);
 const error=(key:string)=>issues[key]&&<p className="field-error" role="alert">{issues[key]}</p>;
 const selectedEnvironment=draft.policy.environments.length===1?draft.policy.environments[0]:'',multipleEnvironments=draft.policy.environments.length>1;
 const changeLabels:Record<string,string>={name:t('项目名称'),'policy.engines':t('工具与引擎'),'policy.gpus':'GPU','policy.max_seconds':t('时长上限 · s'),'policy.max_concurrent':t('最大并发数'),'policy.input_roots':t('输入目录'),'policy.environments':t('计算环境'),'policy.clusters':t('远程集群（可选）')};
 return <div className="project-authorization" data-testid="project-authorization">
  <p className="project-setup-note">{t(initialSpec?'修改项目的计算资源与运行限额。':'工具默认可用；计算仍需复核并点击执行。')}</p>
  {!initialSpec&&<p className="muted">{t('以下为可修改的初始设置，保存项目后生效。')}</p>}
  <fieldset disabled={busy}>
   <h3 className="project-basic-heading">{t('项目基础')}</h3>
   <label>{t('项目名称')}<input aria-label={t('项目名称')} value={draft.name} onChange={e=>{setDraft({...draft,name:e.target.value});setIssues({});}}/>{error('name')}</label>
   <div className="project-basic-resources"><label>{t('计算环境')}<select aria-label={t('计算环境')} value={selectedEnvironment} onChange={e=>{environmentTouched.current=true;patchPolicy('environments',e.target.value?[e.target.value]:[]);}}><option value="" disabled={multipleEnvironments}>{multipleEnvironments?t('多个计算环境')+' · '+draft.policy.environments.length:t(environments.length?'选择环境':'尚无已登记环境')}</option>{selectedEnvironment&&!environments.some(environment=>environment.id===selectedEnvironment)&&<option value={selectedEnvironment}>{t('已保存的计算环境')} · {selectedEnvironment}</option>}{environments.map(environment=><option key={environment.id} value={environment.id}>{environment.name}</option>)}</select>{error('environments')}</label><label>{t('GPU 编号')}<input aria-label={t('GPU 编号')} placeholder="0,1" value={gpuText} onChange={e=>{setGpuText(e.target.value);setIssues({});}}/>{error('gpus')}</label></div>
   <div className="project-input-root"><label>{t('输入目录')}<textarea aria-label={t('输入目录')} rows={2} value={rootText} onChange={e=>{setRootText(e.target.value);setIssues({});}}/>{error('roots')}</label>{scopedSuggestedInputRoot(suggestedInputRoot)&&<div className="authorization-suggestion"><button className="button" onClick={()=>{setRootText([...new Set([...list(rootText),suggestedInputRoot!])].join('\n'));setIssues({});}}>{t('使用当前流程输入目录')}</button></div>}</div>
   <p className="muted">{t('仅使用已登记的计算环境和明确的输入目录。')}</p>
   <div className="project-resource-summary" data-testid="project-resource-summary"><span>GPU {gpuText||t('未设置')}</span><span>{draft.policy.max_seconds??t('未设置')} s</span><span>{draft.policy.max_concurrent??t('未设置')} {t('个并发任务')}</span></div>
   <details className="project-setting-group" data-testid="project-tools-details" open={toolsOpen} onToggle={event=>setToolsOpen(event.currentTarget.open)}><summary>{t('工具与引擎')}<span className="setting-summary">{t('已启用')} {draft.policy.engines.length} / {engines.length}</span></summary><div className="project-setting-content"><p>{t('工具可用性仍取决于所选环境，执行前会检查。')}</p><div className="authorization-options">{engines.map(([id,name])=><label key={id}><input type="checkbox" checked={draft.policy.engines.includes(id)} onChange={e=>patchPolicy('engines',e.target.checked?[...draft.policy.engines,id]:draft.policy.engines.filter(value=>value!==id))}/><span>{t(name)}</span></label>)}</div>{error('engines')}</div></details>
   <details className="project-setting-group" data-testid="project-resource-details" open={resourcesOpen} onToggle={event=>setResourcesOpen(event.currentTarget.open)}><summary>{t('资源与访问范围')}<span className="setting-summary">{t('运行限额')}</span></summary><div className="project-setting-content"><div className="form-row"><label>{t('时长上限 · s')}<input aria-label={t('授权时长上限')} type="number" min={1} value={draft.policy.max_seconds??''} onChange={e=>patchPolicy('max_seconds',e.target.value===''?null:Number(e.target.value))}/></label><label>{t('最大并发数')}<input aria-label={t('最大并发数')} type="number" min={1} value={draft.policy.max_concurrent??''} onChange={e=>patchPolicy('max_concurrent',e.target.value===''?null:Number(e.target.value))}/></label></div>{error('limits')}<h4>{t('更多计算环境')}</h4><div className="authorization-options">{environments.map(environment=><label key={environment.id}><input type="checkbox" checked={draft.policy.environments.includes(environment.id)} onChange={e=>{environmentTouched.current=true;patchPolicy('environments',e.target.checked?[...draft.policy.environments,environment.id]:draft.policy.environments.filter(value=>value!==environment.id));}}/><span>{environment.name}</span></label>)}</div><label>{t('远程集群（可选）')}<textarea aria-label={t('允许的集群 ID · 每行一个')} value={clusterText} onChange={e=>{environmentTouched.current=true;setClusterText(e.target.value);setIssues({});}} rows={2}/></label></div></details>
   <details className="project-setting-group authorization-json" onToggle={e=>{if(e.currentTarget.open&&!json)showJson();}}><summary>{t('高级配置')}</summary><div className="project-setting-content"><label>{t('高级 JSON 授权')}<textarea aria-label={t('高级 JSON 授权')} rows={12} value={json} onChange={e=>{setJson(e.target.value);setJsonDirty(true);}}/></label><div className="button-row"><button className="button" onClick={applyJson}>{t('应用 JSON')}</button><button className="button" onClick={showJson}>{t('从表单重置 JSON')}</button>{jsonDirty&&<span>{t('存在未应用的 JSON 修改')}</span>}</div>{error('json')}</div></details>
   {issues.json&&<p className="field-error" role="alert">{issues.json}</p>}{error('form')}
   {initialSpec&&<section data-testid="project-policy-delta"><h3>{t('本次变更')}</h3>{changes.length?<dl>{changes.map(change=><div key={change.key}><dt>{changeLabels[change.key]||change.key}</dt><dd><span>{display(change.before)}</span> → <strong>{display(change.after)}</strong></dd></div>)}</dl>:<p>{t('尚无变更')}</p>}<p className="muted">{t('未列出的项目元数据和策略字段将原样保留。保存前会重新检查当前记录。')}</p></section>}
   <div className="project-save-actions"><button className="button primary" disabled={!!initialSpec&&!changes.length} data-testid="save-project-authorization" onClick={()=>void submit()}>{t(initialSpec?'保存项目设置':'创建项目')}</button>{onCancel&&<button className="button" onClick={onCancel}>{t('取消')}</button>}</div>
  </fieldset>
 </div>;
}
