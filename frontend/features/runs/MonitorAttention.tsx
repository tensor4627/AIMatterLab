import {Bell,ArrowUpRight} from 'lucide-react';
import {t} from '../../ui/i18n';
import type {MonitorNotice} from '../../../contracts/dto/managed-compute';

const states:Record<string,string>={running:'运行中',queued:'排队中',unknown:'待核对',launching:'正在启动'};
export function JobFollowUp({notice}:{notice:MonitorNotice}) {
 const time=notice.observedAt?new Date(notice.observedAt*1000).toLocaleString():null;
 return <p>{notice.resourceName} · {notice.jobId||notice.runId} · {t('最近状态')} {t(states[notice.status]||'待核对')}{time&&' · '+time}
   <br/>{t(notice.delegationExhausted?'本次委托的执行额度已用完。':'自动巡检次数已用完。')} {t('请自行关注原作业的后续状态。')}</p>;
}
export default function MonitorAttention({notices,onOpen,onDismiss}:{notices:MonitorNotice[];onOpen:(notice:MonitorNotice)=>void;onDismiss:(id:string)=>void}) {
 const pending=notices.filter(n=>!n.acknowledgedAt);
 const notice=pending[0];if(!notice)return null;
 return <aside className="monitor-attention" role="status" aria-live="polite" data-testid="monitor-budget-notice">
   <strong><Bell size={16}/>{t('巡检已达上限')}{pending.length>1?' · '+pending.length:''}</strong><JobFollowUp notice={notice}/>
   <div><button className="button" onClick={()=>onOpen(notice)}>{t('查看运行记录')}<ArrowUpRight size={14}/></button>
   <button className="text-button" onClick={()=>onDismiss(notice.id)}>{t('知道了')}</button></div>
 </aside>;
}
