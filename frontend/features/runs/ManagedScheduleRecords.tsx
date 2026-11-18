import {useState} from 'react';
import type {ManagedSource,ManagedSchedule,ManagedResource} from '../../../contracts/dto/managed-compute';
import {invoke} from '../../api/studio';
import {t} from '../../ui/i18n';

const stopStates = new Set(['stopped','cancelled','completed','exhausted','expired','failed']);
const displayTime = (seconds:number|null|undefined) => seconds ? new Date(seconds*1000).toLocaleString() : '—';
const kinds:Record<string,string>={poll:'内置作业巡检',action:'定时控制操作',script:'Agent 创建 · 额外挂载的定时脚本',wake_agent:'定时唤醒 Agent'};
const statuses:Record<string,string>={active:'已启用',scheduled:'等待执行',running:'运行中',stopping:'正在停止',stopped:'已停止',completed:'已完成',exhausted:'次数已用完',expired:'已到期',paused:'已暂停',unknown:'状态待核对'};
export default function ManagedScheduleRecords({sources,resources,projectId}:{sources:ManagedSource[];resources:ManagedResource[];projectId?:string}) {
  const [error,setError]=useState(''),[pending,setPending]=useState<ReadonlySet<string>>(new Set());
  const [details,setDetails]=useState<Record<string,ManagedSchedule>>({});
  const [detailErrors,setDetailErrors]=useState<Record<string,string>>({});
  async function inspect(key:string,sourceId:string,id:string) {
    try{
      const detail=await invoke<ManagedSchedule>('compute.managed.scheduleDetails',{sourceId,scheduleId:id});
      if(detail?.id!==id||detail.sourceId!==sourceId)throw Error(t('原服务记录待核对'));
      setDetails(old=>({...old,[key]:detail}));setDetailErrors(old=>({...old,[key]:''}));
    }catch(e){setDetailErrors(old=>({...old,[key]:e instanceof Error?e.message:String(e)}));}
  }
  const plans=sources.flatMap(source=>source.schedules.filter(p=>!projectId||p.scope.projectId===projectId).map(plan=>({source,plan})));
  if(!plans.length)return null;
  async function stop(sourceId:string,plan:ManagedSchedule) {
    const key=sourceId+'/'+plan.id;
    if(pending.has(key))return;
    setError('');setPending(old=>new Set(old).add(key));
    try{await invoke('compute.managed.stopSchedule',{sourceId,scheduleId:plan.id});}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setPending(old=>{const next=new Set(old);next.delete(key);return next;});}
  }
  return <section className="jobs-list managed-schedules" aria-label={t('定时任务')}><h3>{t('定时任务')}</h3>
    {error&&<p role="alert" className="error">{error}</p>}
    {plans.map(({source,plan})=>{
      const resource=resources.find(r=>r.profileId===source.profileId);
      const key=source.id+'/'+plan.id;
      const detail=details[key],script=detail?.script||plan.script;
      const child=source.runs.find(run=>run.id===plan.active?.childId);
      const finished=stopStates.has(plan.status);
      const state=plan.stopRequestedAt&&!finished?t(source.connected?'正在停止':'停止待远端确认'):t(statuses[plan.status]||plan.status);
      return <article key={key} className="job-record" data-testid="managed-schedule-record"><div className="job-record-meta">
        <strong>{plan.name||t(kinds[plan.kind]||plan.kind)}</strong><span>{state}</span>
        {!finished&&<button className="button danger" disabled={pending.has(key)||!!plan.stopRequestedAt} onClick={()=>void stop(source.id,plan)}>{t('终止计划')}</button>}
      </div><div className="job-record-meta"><span>{t(kinds[plan.kind]||plan.kind)}</span><span>{resource?.name||source.name||source.profileId}</span><span>{plan.scope.provider} · {plan.scope.threadId}</span></div>
      <div className="job-record-meta"><span>{t('剩余次数')} {Math.max(0,plan.maxRuns-plan.count)} / {plan.maxRuns}</span><span>{t('下次执行')} {displayTime(plan.nextAt)}</span>
        {child&&<span>{t('子作业')} {child.jobId||child.id} · {child.status}</span>}</div>
      <details onToggle={e=>{if(e.currentTarget.open)void inspect(key,source.id,plan.id);}}><summary>{t('执行记录')}</summary>{detailErrors[key]&&<p role="alert">{detailErrors[key]}</p>}<p>{t('截止时间')} · {displayTime(plan.expiresAt)}</p>
        {plan.scope.runId&&<p>{t('关联作业')} · {plan.scope.runId}</p>}{script&&<p>{t('脚本版本')} · {script.version||plan.revision} {script.sha256}</p>}
        {script?.text&&<pre>{script.text}</pre>}{detail?.history?.map((entry,i)=><pre key={i}>{JSON.stringify(entry,null,2)}</pre>)}{!detail?.history?.length&&plan.lastResult!=null&&<pre>{typeof plan.lastResult==='string'?plan.lastResult:JSON.stringify(plan.lastResult,null,2)}</pre>}
      </details></article>;
    })}
  </section>;
}
