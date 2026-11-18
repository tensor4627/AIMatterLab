/** Desktop index of resource use. Run states and execution receipts belong to their original worker. */
const STYLE = 'compute-resource-style';
const HISTORY = 'conversation-compute-history';
const RUNS = 'conversation-compute-run';
const runKey = (scope,sourceId,runId) => JSON.stringify([scope.provider,scope.threadId,scope.taskId,scope.projectId,sourceId,runId]);
const paletteSize = 12;
const scopeKey = (provider, threadId) => JSON.stringify([provider, threadId]);

export function createConversationActivity({catalog,now=()=>Date.now()/1000}) {
  function style(profile) {
    const profileId = profile.profileId || profile.id;
    const previous = catalog.get(STYLE, profileId);
    const local = profile.kind === 'wsl' || profile.kind === 'local';
    const label = local ? 'local' : profile.name;
    if (previous?.label === label && previous.kind === profile.kind) return previous;
    let color = previous?.color;
    if (color === undefined) {
      const uses = Array(paletteSize).fill(0);
      for (const item of catalog.list(STYLE)) if (Number.isInteger(item.color) && item.color < paletteSize && item.color >= 0) uses[item.color]++;
      // Reserve the first choice of local resources when the palette is otherwise empty.
      const start = local ? 0 : 1;
      color = start;
      for (let offset = 1; offset < paletteSize; offset++) {
        const candidate = (start + offset) % paletteSize;
        if (uses[candidate] < uses[color]) color = candidate;
      }
    }
    const result = {profileId, label, kind:profile.kind, color};
    catalog.put(STYLE, profileId, result);
    return result;
  }
  function acquired(scope, resource) {
    if (!scope?.threadId || !scope.provider || !resource?.profileId) return;
    style(resource);
    const key = scopeKey(scope.provider, scope.threadId);
    const history = catalog.get(HISTORY, key) || {provider:scope.provider,threadId:scope.threadId,profileIds:[]};
    if (!history.profileIds.includes(resource.profileId)) catalog.put(HISTORY, key, {...history,profileIds:[...history.profileIds,resource.profileId]});
  }
  function recordRun({scope,sourceId,kind,runId}) {
    if (!scope?.taskId || !scope.threadId || !scope.projectId || !sourceId || !runId || !['run','cluster-run'].includes(kind)) throw Error('managed_run_identity_invalid');
    const id=runKey(scope,sourceId,runId), previous=catalog.get(RUNS,id);
    if(previous&&previous.kind!==kind)throw Error('managed_run_identity_changed');
    if(!previous)catalog.put(RUNS,id,{provider:scope.provider,threadId:scope.threadId,taskId:scope.taskId,projectId:scope.projectId,sourceId,runId,kind});
  }
  function runsFor(scope){return catalog.list(RUNS).filter(r=>['provider','threadId','projectId','taskId'].every(k=>r[k]===scope[k]));}
  function runKind(scope,sourceId,runId) {
    return catalog.get(RUNS,runKey(scope,sourceId,runId))?.kind;
  }
  function snapshot({resources = [], sources = [], turns = [], tasks = []} = {}) {
    const conversations = new Map();
    const styles = new Map(catalog.list(STYLE).map(item => [item.profileId, item]));
    const online = new Set(resources.map(resource => resource.profileId));
    function row(scope) {
      const key = scopeKey(scope.provider, scope.threadId);
      if (!conversations.has(key)) conversations.set(key, {provider:scope.provider,threadId:scope.threadId,replying:false,nextWakeAt:null,badges:[]});
      return conversations.get(key);
    }
    function badge(owner, profileId) {
      if (!styles.has(profileId)) return null;
      let item = owner.badges.find(b => b.profileId === profileId);
      if (!item) {
        item = {...styles.get(profileId),status:online.has(profileId) ? 'idle' : 'offline',observedAt:null};
        owner.badges.push(item);
      }
      return item;
    }
    for (const history of catalog.list(HISTORY)) {
      const owner = row(history);
      for (const profileId of history.profileIds) badge(owner, profileId);
    }
    for (const turn of turns) if (turn?.provider && turn.threadId && turn.busy !== false) row(turn).replying = true;
    const linkedRuns = catalog.list(RUNS);
    for (const source of sources) {
      const observations = new Map((source.runs || []).map(run => [run.id, run]));
      const intervals=new Map();
      for(const plan of source.schedules||[]){
        if(!['scheduled','running'].includes(plan.status)||!plan.intervalSeconds)continue;
        for(const runId of [plan.scope.runId,plan.active?.childId].filter(Boolean))
          intervals.set(runId,Math.max(intervals.get(runId)||0,plan.intervalSeconds));
      }
      const observe = (owner, run) => {
        const item = badge(owner, source.profileId);
        if (!item || !run) return;
        const timestamp=Number.isFinite(run.observedAt)&&run.observedAt>0?run.observedAt:null;
        item.observedAt = Math.max(item.observedAt || 0, timestamp || 0) || null;
        if (!online.has(source.profileId)) { item.status='offline'; return; }
        if (!source.connected) { if(item.status==='idle')item.status='unknown'; return; }
        if (run.status === 'running' && timestamp && now()-timestamp <= (intervals.get(run.id)||60)+120) item.status='running';
        else if (run.status === 'running' && item.status==='idle') item.status='unknown';
        else if (item.status !== 'running' && run.status === 'queued') item.status='queued';
        else if (item.status === 'idle' && run.status === 'unknown') item.status='unknown';
      };
      for (const link of linkedRuns) if (link.sourceId === source.id) observe(row(link),observations.get(link.runId));
      for (const task of tasks) {
        if (task.workerSourceId !== source.id || !task.provider || !task.threadId) continue;
        for (const artifact of task.artifacts || []) {
          if (artifact.kind === 'cluster-run' || artifact.kind === 'run') observe(row(task), observations.get(artifact.id));
        }
      }
      for (const plan of source.schedules || []) {
        if (!plan.scope?.threadId || !plan.scope.provider) continue;
        const owner = row(plan.scope);
        badge(owner, source.profileId);
        observe(owner, observations.get(plan.scope.runId));
        if (plan.active?.childId) observe(owner,observations.get(plan.active.childId));
        if (source.connected && plan.kind === 'wake_agent' && ['active','scheduled','running'].includes(plan.status) && !plan.stopRequestedAt && plan.nextAt) {
          owner.nextWakeAt = owner.nextWakeAt === null ? plan.nextAt : Math.min(owner.nextWakeAt, plan.nextAt);
        }
      }
    }
    return {resources,conversations:[...conversations.values()],sources:sources.map(source=>({...source,name:styles.get(source.profileId)?.label||source.kind}))};
  }
  return {style,label:profileId=>catalog.get(STYLE,profileId)?.label,acquired,recordRun,runKind,runsFor,snapshot,forget(provider,threadId){catalog.remove(HISTORY,scopeKey(provider,threadId));}};
}
