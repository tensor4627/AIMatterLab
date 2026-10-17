import {useEffect,useRef,useState} from 'react';
import {GitBranch,Sparkles,ArrowUpRight,ShieldCheck,Play,ChevronDown,RefreshCw} from 'lucide-react';
import {normalizeSteps,missingRequirements,setParameter,fieldMissing,parameterValue,workflowMissing} from '../shared/task-fields.mjs';
import {invoke,api,type Environment,type Run,type ClusterRun} from './types';
import {ParameterFields} from './ParameterFields';
import {DraftOutbox} from '../shared/draft-outbox.mjs';
import {reviewState} from '../shared/review-state.mjs';
import RunDetail from './RunDetail';
import {t} from './i18n';
export default function AgentTaskPage({worker,task,onError,onRun,onCluster,onSetup,onReview,onRefresh}:{worker:boolean;task:any;environments:Environment[];theme:string;onError:(e:unknown)=>void;onRun:(id:string)=>void;onCluster:(id:string)=>void;onSetup:(id:string)=>void;onAgent:(text:string)=>void;onReview:(task:any)=>void;onReplace:(run:Run)=>void;onRefresh:()=>void|Promise<void>}){
 const [outbox]=useState(()=>new DraftOutbox(task.id,localStorage));
 const [query,setQuery]=useState(''),[onlyMissing,setOnlyMissing]=useState(false);
 const [parameters,setParameters]=useState<Record<string,any>>(()=>outbox.apply(task.parameters||{})),[saving,setSaving]=useState(false),[busy,setBusy]=useState(false),[saveError,setSaveError]=useState(()=>outbox.pendingCount>0),[run,setRun]=useState<Run|ClusterRun|null>(null),[open,setOpen]=useState<Record<string,boolean>>({});
 const alive=useRef(true),latest=useRef(task);latest.current=task;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const steps=normalizeSteps(task.steps?.length?task.steps:task.plan?.map((s:any)=>s.step)||[],parameters,task.missingFields||[]);
 const missing=workflowMissing(steps,parameters,task.missingFields||[]);
 const requirements=missingRequirements(task.missingFields||[]);
 const artifact=task.artifacts?.filter((a:any)=>['run','cluster-run'].includes(a.kind)).at(-1);
 useEffect(()=>{setOpen(old=>{let changed=false;const next={...old};for(const step of normalizeSteps(task.steps?.length?task.steps:task.plan?.map((s:any)=>s.step)||[],task.parameters||{},task.missingFields||[])){if(!(step.id in next)){next[step.id]=step.fields.some(field=>fieldMissing(field,task.parameters||{}));changed=true;}}return changed?next:old;});},[task.id,task.updatedAt]);
 useEffect(()=>{setParameters(outbox.apply(task.parameters||{}));},[task.id,task.updatedAt]);
 useEffect(()=>{let active=true,loading=false;setRun(null);async function poll(){if(!worker||!artifact||loading)return;loading=true;try{const value=await api<Run|ClusterRun>('POST',artifact.kind==='cluster-run'?'/api/cluster/status':'/api/run/status',{run_id:artifact.id});if(active)setRun(value);}catch(error){if(active)onError(error);}finally{loading=false;}}void poll();const timer=setInterval(()=>void poll(),2500);return()=>{active=false;clearInterval(timer);};},[task.id,artifact?.id,worker]);
 async function flush(){
  setSaving(outbox.pendingCount>0);try{const saved=await outbox.flush(changes=>invoke('task.edit',{id:task.id,changes}));if(alive.current){setParameters(outbox.apply(saved?.parameters||latest.current.parameters||{}));setSaveError(false);}return saved;
  }catch(error){if(alive.current){setSaveError(true);onError(error);}throw error;}finally{if(alive.current)setSaving(false);}
 }
 function patch(key:string,value:any){try{outbox.stage(key,value);setParameters(old=>setParameter(old,key,value));setSaveError(false);void flush().catch(()=>{});}catch(error){setSaveError(true);onError(error);}}
 async function review(){setBusy(true);try{await flush();if(outbox.pendingCount)throw Error('先保存当前参数再复核');onReview(await invoke('task.read',{id:task.id}));}catch(error){onError(error);}finally{setBusy(false);}}
 async function retrySave(){await flush().catch(()=>{});}
 async function execute(){if(busy||!artifact)return;setBusy(true);try{const result=await invoke<Run|ClusterRun>('task.execute',{taskId:task.id,artifactId:artifact.id});setRun(result);await onRefresh();}catch(e){onError(e);}finally{setBusy(false);}}
 async function reconcile(){if(!artifact)return;try{await invoke('task.linkRun',{taskId:task.id,runId:artifact.id,kind:artifact.kind});await onRefresh();}catch(e){onError(e);}}
 const state=reviewState({worker,saving,saveError,missing,task,artifact,run}),canExecute=state.canExecute;
 const stages=['定义目标','补齐输入','AI 复核','执行验证','运行与结果'];
 const visibleSteps=steps.filter(step=>(!onlyMissing||step.fields.some(field=>fieldMissing(field,parameters)))&&(!query||[step.title,step.tool,...step.fields.flatMap(f=>[f.label,f.key])].join(' ').toLowerCase().includes(query.toLowerCase())));
 function locateMissing(){const step=steps.find(s=>s.fields.some(f=>fieldMissing(f,parameters)));if(!step){document.querySelector('.workflow-requirements')?.scrollIntoView({behavior:'smooth'});return;}setOnlyMissing(false);setQuery('');setOpen(old=>({...old,[step.id]:true}));requestAnimationFrame(()=>{const key=step.fields.find(f=>fieldMissing(f,parameters))!.key;const element=document.querySelector<HTMLElement>('[data-field="'+CSS.escape(key)+'"]');element?.scrollIntoView({block:'center',behavior:'smooth'});element?.querySelector<HTMLElement>('input,textarea,select')?.focus();});}

 return <div className="page agent-task-page" data-testid="agent-task-page"><div className="page-heading"><div><span className="eyebrow">CONVERSATION WORKFLOW · {task.provider}</span><h1>{task.name}</h1><p>{t('在对话中持续调整，或展开步骤直接填写参数与文件。')}</p></div><GitBranch size={24}/></div>
 <section className="workflow-overview" data-testid="workflow-overview"><div className="workflow-stage-title"><span className="eyebrow">{t('当前阶段')}</span><strong>{t(stages[state.stage])}</strong><span className="tag">{t('草稿版本')} {task.parameterRevision||0}</span></div><ol className="workflow-pipeline">{stages.map((name,index)=><li key={name} className={index===state.stage?'current':index<state.stage?'previous':''} aria-current={index===state.stage?'step':undefined}><span>{index+1}</span>{t(name)}</li>)}</ol><p data-testid="execution-reason">{t(state.reason)}</p></section>
 <div className="flow-filters"><input aria-label={t('搜索流程参数')} placeholder={t('搜索步骤、参数或文件…')} value={query} onChange={e=>setQuery(e.target.value)}/><label><input type="checkbox" checked={onlyMissing} onChange={e=>setOnlyMissing(e.target.checked)}/>{t('只看缺项')}</label><button className="button" disabled={!missing.length} onClick={locateMissing}>{t('定位缺项')} · {missing.length}</button></div>
 <div className="flow-legend"><span><i className="flow-dot missing"/>{t('需要参数')}</span><span><i className="flow-dot ready"/>{t('参数齐全')}</span><small>{t('绿色表示参数齐全，实际科学验证在执行时进行。')}</small></div>
 <div className="visual-flow" data-testid="visual-flow">{visibleSteps.map((step,index)=>{
  const absent=step.fields.filter(field=>fieldMissing(field,parameters)),expanded=open[step.id]??absent.length>0;
  return <section key={step.id} className={'visual-flow-step '+(absent.length?'needs-parameters':'parameters-ready')}><button className="visual-step-heading" aria-expanded={expanded} onClick={()=>setOpen(old=>({...old,[step.id]:!expanded}))}><span className="step-number">{index+1}</span><i className={'flow-dot '+(absent.length?'missing':'ready')}/><span className="visual-step-title"><strong>{t(step.title)}</strong><small>{absent.length?t('需要参数')+' · '+absent.map(f=>t(f.label)).join('、'):step.fields.slice(0,3).map(f=>t(f.label)+': '+(Array.isArray(parameterValue(parameters,f.key))?parameterValue(parameters,f.key).join(', '):String(parameterValue(parameters,f.key)??'—'))+(f.unit?' '+f.unit:'')).join(' · ')||t('流程步骤')}</small></span>{step.tool&&<span className="tag">{step.tool}</span>}<ChevronDown size={17} className={expanded?'expanded-chevron':''}/></button>{expanded&&<div className="visual-step-body">{step.description&&<p>{t(step.description)}</p>}<ParameterFields fields={step.fields} parameters={parameters} onChange={patch} onError={onError} disabled={busy||state.locked}/>{!step.fields.length&&<p className="muted">{t('此步骤暂无参数；可在对话中补充。')}</p>}</div>}</section>;
 })}</div>
 {requirements.length>0&&<section className="workflow-requirements" data-testid="workflow-requirements"><h3><i className="flow-dot missing"/>{t('待确认事项')}</h3><p>{t('以下事项需要在当前对话中补充并由 Agent 复核。')}</p><ul>{requirements.map((requirement,index)=><li key={index}>{requirement}</li>)}</ul></section>}
 {!steps.length&&<div className="notice">{t('等待 Agent 填写计算流程。')}</div>}
 {saveError&&<div className="notice" role="alert">{t('参数尚未保存，不能复核或执行。')}{t('修改已保留在本机，切换会话或重开后可重试保存。')}<button className="button" onClick={()=>void retrySave()}>{t('重试保存')}</button></div>}
 <div className="workflow-review-note" role="status"><ShieldCheck size={17}/><div><strong>{t(task.review?.status==='reviewing'?'AI 正在复核':task.review?.status==='ready'?'复核完成':'等待复核')}</strong><span>{t(task.review?.summary||'手动修改后点击复核，Agent 会检查缺项并更新当前流程。')}</span></div></div>
 <div className="flow-actions"><span>{saving?t('保存参数中…'):missing.length?t('待补充')+' · '+missing.length:t('参数已保存')}</span><button className="button" data-testid="review-workflow" disabled={busy||state.locked||saving||saveError||!task.threadId||task.review?.status==='reviewing'} onClick={()=>void review()}><Sparkles size={16}/>{t('复核')}</button><button className="button primary" data-testid="execute-workflow" disabled={busy||!canExecute} onClick={()=>void execute()}><Play size={16}/>{t(busy?'处理中…':'执行')}</button></div>
 {task.execution?.phase==='unknown'&&<div className="notice">{t('提交响应未确认，请核对原作业；不会自动重提。')}<button className="button" onClick={()=>void reconcile()}><RefreshCw size={14}/>{t('核对运行状态')}</button></div>}
 {task.artifacts?.length>0&&<details className="flow-artifacts"><summary>{t('模块草稿与输入记录')} · {task.artifacts.length}</summary>{task.artifacts.map((a:any)=><button className="tool-card" key={a.id} onClick={()=>a.kind==='cluster-run'?onCluster(a.id):a.kind==='cluster-setup'?onSetup(a.id):a.kind==='run'?onRun(a.id):undefined}>{a.name||a.engine||a.kind}<ArrowUpRight size={15}/></button>)}</details>}
 {run&&<section className="flow-run-status"><h3>{t('实际作业状态')} · {run.status}</h3><p>{run.engine} · {run.id}</p>{'kind' in run&&<p>{t('输入契约验证')} · {run.validation?.status||'not_run'}</p>}<p>{t('科学环境验证')} · {('kind' in run?run.scientific_validation?.status:run.validation?.status)||'not_run'}{run.validation?.message&&' · '+run.validation.message}</p>{!('kind' in run)&&!['draft','ready'].includes(run.status)&&<RunDetail run={run as Run} onError={onError} onRefresh={onRefresh} onOpenRun={onRun}/>}</section>}
 </div>;
}
