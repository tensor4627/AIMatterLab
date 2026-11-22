import ManagedScheduleRecords from './ManagedScheduleRecords';
import type {ManagedSnapshot} from '../../../contracts/dto/managed-compute';
import {useState} from 'react';
import {Activity,ArrowUpRight,MessageSquare,RefreshCw,Search,Server} from 'lucide-react';
import {Badge,statusNames} from "../../ui/Dialogs";
import {t} from "../../ui/i18n";
import Tooltip from "../../ui/Tooltip";
import {boundJobConversation,filterJobs,unifiedJobs,type ClusterJob,type Job} from "../../app/workspace-shell.mjs";
import {type Conversation} from '../../../contracts/dto/agent';
import {type Project} from '../../../contracts/dto/compute';
import {type Run} from '../../../contracts/dto/runs';
import './jobs-experience.css';
export type RecordObservation={at:number|null;stale:boolean;loaded:boolean;paused?:boolean;workerEpoch?:number;sourceId?:string;sourceChanged?:boolean};
function time(value:number|undefined|null){return typeof value==='number'&&Number.isFinite(value)&&value>0?new Date(value*1000).toLocaleString():t('尚无记录');}
export default function JobsPage({managed,focusSchedule,local,cluster,observations,projects,projectId,tasks,conversations,worker,busy,canRefresh=worker,canOpen,servicePhase,readOnly=false,onRefresh,onOpen,onConversation}:{managed?:ManagedSnapshot;focusSchedule?:{sourceId:string;scheduleId:string;nonce:string}|null;local:Run[];cluster:ClusterJob[];observations:{local:RecordObservation;cluster:RecordObservation};projects:Project[];projectId:string;tasks:any[];conversations:Conversation[];worker:boolean;busy:boolean;canRefresh?:boolean;canOpen?:(location:Job['location'])=>boolean;servicePhase?:'checking'|'ready'|'unavailable';readOnly?:boolean;onRefresh:()=>void;onOpen:(job:Job)=>void;onConversation:(conversation:Conversation)=>void}){
 const [location,setLocation]=useState('all'),[status,setStatus]=useState('all'),[period,setPeriod]=useState('all'),[query,setQuery]=useState(''),[allProjects,setAllProjects]=useState(true),[planningExpanded,setPlanningExpanded]=useState<boolean|null>(null);
 const observedJobs=unifiedJobs(local,cluster),planning=tasks.filter(task=>!task.execution?.runId&&!task.execution?.artifactId);
 const since=period==='all'?0:Date.now()/1000-Number(period)*86400;
 const projectOnly=!!projectId&&!allProjects;
 const jobs=filterJobs(observedJobs,{location,status,since,query,projectId:projectOnly?projectId:''});
 const activeFilters=[location!=='all'&&t(location==='local'?'本地':'集群'),status!=='all'&&t(status==='active'?'运行中、排队与待核对':statusNames[status]||status),period!=='all'&&t(period==='1'?'最近一天':period==='7'?'最近七天':'最近三十天'),projectOnly&&(projects.find(project=>project.id===projectId)?.name||t('当前项目')),query.trim()&&t('搜索任务')+'：'+query.trim()].filter(Boolean);
 const sources=location==='all'?(['local','cluster'] as const):[location as 'local'|'cluster'],missingSource=sources.some(source=>!observations[source].loaded||observations[source].sourceChanged);
 const sourcesRead=[observations.local,observations.cluster];
 const countsKnown=sourcesRead.every(observed=>observed.loaded&&!observed.sourceChanged);
 const showSourceWarning=!countsKnown||sourcesRead.some(observed=>observed.stale);
 function clearFilters(){setLocation('all');setStatus('all');setPeriod('all');setQuery('');setAllProjects(true);}
 function showPlanning(button:HTMLButtonElement){setPlanningExpanded(true);const panel=button.closest('.jobs-page')?.querySelector<HTMLDetailsElement>('#planning-overview');if(panel){panel.hidden=false;panel.open=true;const summary=panel.querySelector('summary');summary?.scrollIntoView({block:'start'});summary?.focus({preventScroll:true});}}
 return <div className="page jobs-page" data-testid="jobs-page"><div className="page-heading"><h1>{t('运行记录')}</h1><Tooltip asChild content={t('读取的是作业服务已保存的记录；同步时间不代表调度器或计算节点已核验。')}><button className="button" disabled={!canRefresh} onClick={onRefresh}><RefreshCw size={15}/>{t('同步记录')}</button></Tooltip></div>
  {servicePhase==='checking'?<p className="notice" role="status">{t('正在核对当前作业服务并读取记录…')}</p>:servicePhase==='unavailable'?<p className="notice" role="status">{t('当前作业服务尚未核对或不可用；可同步记录重新检查。')}</p>:readOnly&&worker?<p className="notice" role="status">{t('运行记录可查看；提交、续算等操作需匹配原服务与权限。')}</p>:!worker&&<p className="notice" role="status">{t('作业服务未连接；请先恢复原服务，再打开运行记录。')}</p>}
  <div className="jobs-overview" data-testid="jobs-overview">{[{label:'正在规划',value:planning.length,filter:'planning'},{label:'运行中',value:observedJobs.filter(j=>j.run.status==='running').length,filter:'running'},{label:'排队中',value:observedJobs.filter(j=>j.run.status==='queued').length,filter:'queued'},{label:'待核对',value:observedJobs.filter(j=>j.run.status==='unknown').length,filter:'unknown'}].map(card=><button key={card.filter} data-testid={'jobs-overview-'+card.filter} aria-controls={card.filter==='planning'?'planning-overview':'jobs-records'} aria-pressed={card.filter==='planning'?undefined:status===card.filter} onClick={event=>card.filter==='planning'?showPlanning(event.currentTarget):setStatus(card.filter)}><span>{t(card.label)}</span><strong>{card.filter==='planning'?card.value:countsKnown?card.value:'—'}</strong></button>)}</div>
  <details className="jobs-planning" id="planning-overview" hidden={!planning.length&&!planningExpanded} open={planningExpanded??(planning.length>0&&planning.length<=6)} onToggle={event=>setPlanningExpanded(event.currentTarget.open)}><summary>{t('规划中的计算流程')} · {planning.length}</summary><div className="planning-cards">{planning.map(task=>{const conversation=conversations.find(c=>c.taskId===task.id);return <button key={task.id} disabled={busy||!conversation} onClick={()=>conversation&&onConversation(conversation)}><strong>{task.name}</strong><small>{task.parameters?.engine||t('待选择引擎')} · {t(task.review?.status==='ready'?'待部署':'待完善')}</small></button>;})}</div>{!planning.length&&<p className="muted">{t('尚无规划中的计算流程')}</p>}</details>
  <details className="jobs-sources" key={showSourceWarning?'attention':'current'} open={showSourceWarning}><summary>{t('记录来源与读取时间')}</summary><div className="job-observations">{(['local','cluster'] as const).map(source=>{const observed=observations[source];return <div key={source} data-testid={'job-observation-'+source} className={observed.stale?'stale':''}><Server size={15}/><strong>{t(source==='local'?'本地':'集群')}</strong><span>{t(observed.sourceChanged?'其他作业服务的上次记录':observed.paused?'自动同步已暂停 · 点击同步记录重试':observed.stale?servicePhase==='ready'?'记录读取失败 · 保留上次记录':'连接中断 · 状态待核对':observed.loaded?'已读取记录':'尚未读取记录')}</span><small>{t('记录读取时间')} · {time(observed.at)}</small></div>;})}</div></details>
  <div className="jobs-filters">
   <label className="jobs-search"><span><Search size={14}/>{t('搜索任务')}</span><input data-guide-target="run-search" aria-label={t('搜索任务')} value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('名称、引擎或队列作业号')}/></label>
   <label>{t('计算位置')}<select aria-label={t('计算位置筛选')} value={location} onChange={event=>setLocation(event.target.value)}>
    <option value="all">{t('全部位置')}</option><option value="local">{t('本地')}</option><option value="cluster">{t('集群')}</option>
   </select></label>
   <label>{t('状态')}<select aria-label={t('任务状态筛选')} value={status} onChange={event=>setStatus(event.target.value)}>
    <option value="all">{t('全部状态')}</option><option value="active">{t('运行中、排队与待核对')}</option>
    {['draft','validating','ready','queued','running','succeeded','failed','cancelled','unknown'].map(value=><option value={value} key={value}>{t(statusNames[value]||value)}</option>)}
   </select></label>
  </div>
  <details className="jobs-more-filters"><summary>{t('时间与项目筛选')}</summary><div className="jobs-filters">
   <label>{t('创建时间')}<select aria-label={t('任务时间筛选')} value={period} onChange={event=>setPeriod(event.target.value)}>
    <option value="all">{t('全部时间')}</option><option value="1">{t('最近一天')}</option><option value="7">{t('最近七天')}</option><option value="30">{t('最近三十天')}</option>
   </select></label>
   <label>{t('项目')}<select aria-label={t('任务项目筛选')} value={projectOnly?'current':'all'} onChange={event=>setAllProjects(event.target.value==='all')}>
    <option value="all">{t('全部项目')}</option><option value="current" disabled={!projectId}>{projects.find(project=>project.id===projectId)?.name||t('当前项目')}</option>
   </select></label>
  </div></details>
  <div className="jobs-filter-summary" data-testid="jobs-filter-summary"><div role="status"><strong>{t('显示记录')} · {jobs.length} / {observedJobs.length}</strong><span>{activeFilters.length?activeFilters.join(' · '):t('未设置筛选')}</span></div>{!!jobs.length&&!!activeFilters.length&&<button className="button" onClick={clearFilters}>{t('清除筛选')}</button>}</div>
  {managed&&<ManagedScheduleRecords focus={focusSchedule} notices={managed.notices||[]} sources={managed.sources} resources={managed.resources} projectId={projectOnly?projectId:undefined}/>}
  <div className="jobs-list" id="jobs-records">{jobs.map(job=>{
   const run=job.run,observed=observations[job.location];
   const enabled=worker&&!observed.sourceChanged&&(canOpen?.(job.location)??true);
   const conversation=!observed.sourceChanged&&boundJobConversation(job,tasks,conversations,observed.sourceId);
   const staleLabel=observed.sourceChanged?'其他作业服务的上次记录':['queued','running','unknown'].includes(run.status)?'上次记录 · 请核对原作业':'上次记录';
   return <article className="job-record" key={job.key} data-job-key={job.key}>
    <button className="job-record-open" data-guide-target="run-record" disabled={!enabled} onClick={()=>{if(enabled)onOpen(job);}}>
     <Activity size={18}/><span><strong>{run.name}</strong><small>{run.engine} · {t(job.location==='local'?'本地':'集群')}{job.location==='cluster'&&job.run.job_id?' · '+job.run.job_id:''}</small></span>
     <Badge status={run.status}/><ArrowUpRight size={15}/>
    </button>
    <div className="job-record-meta">{observed.stale&&<strong className="job-stale">{t(staleLabel)}</strong>}
     <span>{t('创建时间')} · {time(run.created_at)}</span>
     {conversation?<button className="text-button" disabled={busy} onClick={()=>onConversation(conversation)}><MessageSquare size={14}/>{t('返回会话')} · {conversation.name}</button>:<span>{t('未关联会话')}</span>}
    </div>
   </article>;
  })}{!jobs.length&&<div className="empty" data-testid="jobs-empty" data-guide-target="run-empty" tabIndex={-1}><h3>{t(missingSource?'记录尚未读取完整':activeFilters.length?'没有匹配的运行记录':'尚无运行记录')}</h3><p>{t(missingSource?'所选来源尚未读取成功，可同步原记录后再查看。':activeFilters.length?'可清除筛选，查看全部已读取记录。':'准备计算流程后，可在此查看保存的运行记录。')}</p>{!!activeFilters.length&&<button className="button" onClick={()=>clearFilters()}>{t('清除筛选，查看全部记录')}</button>}</div>}</div>
 </div>;
}
