import {createHash} from 'node:crypto';
const kind='managed-monitor-attention';
const terminal = new Set(['succeeded','failed','cancelled','canceled','completed']);
const key=(source,plan)=>createHash('sha256').update(JSON.stringify([source,plan])).digest('hex');
const monitors=plan=>plan.kind==='poll'||plan.kind==='action'&&plan.action?.type==='status';

/** The worker owns the last observation. Persist human attention separately from execution and agent wakes. */
export function createMonitorAttention({catalog,announce=()=>{},now=()=>Date.now()/1000}) {
  function reconcile(sources) {
    for(const source of sources) {
      if(!source.connected)continue;
      for(const plan of source.schedules) {
        if(!monitors(plan)||!plan.scope?.runId)continue;
        const id=key(source.id,plan.id),existing=catalog.get(kind,id);
        if(existing?.resolvedAt)continue;
        const match=run=>run?.id===plan.scope.runId&&run.projectId===plan.scope.projectId;
        const cached=source.runs.find(match);
        const run=cached||(match(plan.lastResult?.run)?plan.lastResult.run:null);
        if(run&&(terminal.has(run.status)||run.schedulerTerminal===true)) {
          if(existing)catalog.put(kind,id,{...existing,status:run.status,observedAt:run.observedAt||existing.observedAt,resolvedAt:now()});
          continue;
        }
        if(plan.status!=='exhausted'||plan.active||plan.stopRequestedAt!=null||run&&['draft','ready','prepared'].includes(run.status))continue;
        const current={id,sourceId:source.id,profileId:source.profileId,scheduleId:plan.id,runId:plan.scope.runId,
          projectId:plan.scope.projectId,provider:plan.scope.provider,threadId:plan.scope.threadId,jobId:run?.jobId||existing?.jobId||null,
          status:run?.status||'unknown',observedAt:run?.observedAt||existing?.observedAt||null,
          count:plan.count,maxRuns:plan.maxRuns,delegationExhausted:plan.count<plan.maxRuns&&plan.delegationCount>=336,
          createdAt:existing?.createdAt||now(),acknowledgedAt:existing?.acknowledgedAt||null,resolvedAt:null};
        if(!existing||JSON.stringify(existing)!==JSON.stringify(current))catalog.put(kind,id,current);
        if(!existing)announce(current);
      }
    }
  }
  function list(){return catalog.list(kind).filter(item=>!item.resolvedAt).sort((a,b)=>a.createdAt-b.createdAt);}
  function acknowledge(id) {
    const row=typeof id==='string'&&/^[a-f0-9]{64}$/.test(id)&&catalog.get(kind,id);
    if(!row)throw Error('managed_monitor_notice_unknown');
    if(!row.acknowledgedAt)catalog.put(kind,id,{...row,acknowledgedAt:now()});
    return {acknowledged:true};
  }
  return {reconcile,list,acknowledge};
}
