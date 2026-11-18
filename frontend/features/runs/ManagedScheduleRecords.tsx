import {useEffect,useRef,useState} from 'react';
import {JobFollowUp} from './MonitorAttention';
import type {ManagedSource,ManagedSchedule,ManagedResource,MonitorNotice} from '../../../contracts/dto/managed-compute';
import {invoke} from '../../api/studio';
import {t} from '../../ui/i18n';

const stopStates = new Set(['stopped','cancelled','completed','exhausted','expired','failed']);
const displayTime = (seconds:number|null|undefined) => seconds ? new Date(seconds*1000).toLocaleString() : '—';
const kinds:Record<string,string>={poll:'内置作业巡检',action:'定时控制操作',script:'Agent 创建 · 额外挂载的定时脚本',wake_agent:'定时唤醒 Agent'};
const statuses:Record<string,string>={succeeded:'已完成',failed:'失败',queued:'排队中',cancelled:'已取消',active:'已启用',scheduled:'等待执行',running:'运行中',stopping:'正在停止',stopped:'已停止',completed:'已完成',exhausted:'次数已用完',expired:'已到期',paused:'已暂停',unknown:'状态待核对'};
export default function ManagedScheduleRecords({sources,resources,projectId,notices,focus}:{notices:MonitorNotice[];focus?:{sourceId:string;scheduleId:string;nonce:string}|null;sources:ManagedSource[];resources:ManagedResource[];projectId?:string}) {
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
  const focusedRow=useRef<HTMLElement|null>(null);
  const manual=useRef(new Map<string,string>());
  const [manualStatus,setManualStatus]=useState<Record<string,string>>({});
  const [checking,setChecking]=useState<ReadonlySet<string>>(new Set());
  const plans=sources.flatMap(source=>source.schedules.filter(p=>!projectId||p.scope.projectId===projectId||focus?.sourceId===source.id&&focus.scheduleId===p.id).map(plan=>({source,plan})));
  const showFocus=!!focus&&plans.some(({source,plan})=>source.id===focus.sourceId&&plan.id===focus.scheduleId);
  useEffect(()=>{
    if(!showFocus||!focusedRow.current)return;
    focusedRow.current.focus();
    focusedRow.current.scrollIntoView({block:'nearest'});
    const panel=focusedRow.current.querySelector('details');if(panel)panel.open=true;
  },[showFocus,focus?.nonce]);
  if(!plans.length)return null;
  async function observe(sourceId:string,scheduleId:string) {
    const key=sourceId+'/'+scheduleId;
    if(checking.has(key))return;
    const requestId=manual.current.get(key)||crypto.randomUUID();
    manual.current.set(key,requestId);
    setChecking(old=>new Set(old).add(key));
    try{
      const result=await invoke<{sourceId:string;scheduleId:string;requestId:string;run?:{status?:string}}>('compute.managed.observeOnce',{sourceId,scheduleId,requestId});
      if(result?.sourceId!==sourceId||result.scheduleId!==scheduleId||result.requestId!==requestId)throw Error(t('原服务记录待核对'));
      manual.current.delete(key);setManualStatus(old=>({...old,[key]:t('最近状态')+' · '+t(statuses[result.run?.status||'unknown']||result.run?.status||'待核对')}));
    }catch(e){setManualStatus(old=>({...old,[key]:e instanceof Error?e.message:String(e)}));}
    finally{setChecking(old=>{const next=new Set(old);next.delete(key);return next;});}
  }
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
      const notice=notices.find(n=>n.sourceId===source.id&&n.scheduleId===plan.id);
      const current=focus?.sourceId===source.id&&focus?.scheduleId===plan.id;
      const detail=details[key],script=detail?.script||plan.script;
      const child=source.runs.find(run=>run.id===plan.active?.childId);
      const finished=stopStates.has(plan.status);
      const state=plan.stopRequestedAt&&!finished?t(source.connected?'正在停止':'停止待远端确认'):t(statuses[plan.status]||plan.status);
      return <article key={key} className="job-record" ref={current?focusedRow:undefined} tabIndex={current?-1:undefined} data-testid="managed-schedule-record"><div className="job-record-meta">
        <strong>{plan.name||t(kinds[plan.kind]||plan.kind)}</strong><span>{state}</span>
        {!finished&&<button className="button danger" disabled={pending.has(key)||!!plan.stopRequestedAt} onClick={()=>void stop(source.id,plan)}>{t('终止计划')}</button>}
      </div><div className="job-record-meta"><span>{t(kinds[plan.kind]||plan.kind)}</span><span>{resource?.name||source.name||source.profileId}</span><span>{plan.scope.provider} · {plan.scope.threadId}</span></div>
      <div className="job-record-meta"><span>{t('剩余次数')} {plan.status==='exhausted'?0:Math.max(0,Math.min(plan.maxRuns-plan.count,336-(plan.delegationCount??plan.count)))} / {plan.maxRuns}</span><span>{t('下次执行')} {displayTime(plan.nextAt)}</span>
        {child&&<span>{t('子作业')} {child.jobId||child.id} · {child.status}</span>}</div>
      {notice&&<div className="managed-manual-followup"><JobFollowUp notice={notice}/><button className="button" disabled={!source.connected||checking.has(key)} onClick={()=>void observe(source.id,plan.id)}>{t('手动核对一次')}</button></div>}
      {manualStatus[key]&&<p role="status">{manualStatus[key]}</p>}
      <details onToggle={e=>{if(e.currentTarget.open)void inspect(key,source.id,plan.id);}}><summary>{t('执行记录')}</summary>{detailErrors[key]&&<p role="alert">{detailErrors[key]}</p>}<p>{t('截止时间')} · {displayTime(plan.expiresAt)}</p>
        {plan.scope.runId&&<p>{t('关联作业')} · {plan.scope.runId}</p>}{script&&<p>{t('脚本版本')} · {script.version||plan.revision} {script.sha256}</p>}
        {script?.text&&<pre>{script.text}</pre>}{detail?.history?.map((entry,i)=><pre key={i}>{JSON.stringify(entry,null,2)}</pre>)}{!detail?.history?.length&&plan.lastResult!=null&&<pre>{typeof plan.lastResult==='string'?plan.lastResult:JSON.stringify(plan.lastResult,null,2)}</pre>}
      </details></article>;
    })}
  </section>;
}
