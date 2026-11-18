// Keep only the authorized purpose of the human's message. Service-generated messages never enter this boundary.
import {randomUUID} from 'node:crypto';

const namespace='managed-schedule-delegation';
const keyOf=(provider,threadId)=>JSON.stringify([provider,threadId]);
const timing=/定时|按时|巡检|轮询|监控|监测|每隔|每(?:天|小时|分钟|半小时)|唤醒|到时|跟踪.{0,16}(?:完成|结束)|\b(?:schedul\w*|periodic\w*|poll\w*|monitor\w*|watch|wake|interval|every)\b/iu;
const prohibit=/(?:不要|不再|禁止|不用|无需|do not|never|don't)\s*(?:再|自动|去|启动|开启|创建|run |start )*\s*(?:定时|监控|巡检|唤醒|schedul|monitor|poll|wake)/iu;
export function createScheduleDelegations(catalog) {
  function record({provider,threadId,projectId,taskId,text,turnId}) {
    if(!threadId||!text||!timing.test(text))return;
    const key=keyOf(provider,threadId);
    const permissions=['stop'];
    if(!prohibit.test(text)&&!/(?:停止|取消|撤销|禁用|stop|cancel|disable)\s*(?:这个|此|该|the\s+)?(?:定时|计划|巡检|监控|schedule|polling|monitoring)/iu.test(text)) {
      permissions.push('poll','action');
      if(/脚本|后处理|自定义|\b(?:script|bash|python|postprocess\w*)\b/iu.test(text))permissions.push('script');
      if(/唤醒|提醒|通知|叫醒|继续(?:下一步|处理|工作)|\b(?:wake|remind|notify|continue)\b/iu.test(text))permissions.push('wake_agent');
    }
    catalog.put(namespace,key,{provider,threadId,taskId:taskId||null,projectId:projectId||null,permissions,turnId:turnId||randomUUID()});
  }
  function assert(scope,operation,args) {
    const key=keyOf(scope.provider,scope.threadId),grant=catalog.get(namespace,key);
    const purpose=operation==='stop'?'stop':args.kind;
    if(!scope.taskId||!scope.projectId||!grant||grant.projectId&&grant.projectId!==scope.projectId||
       grant.taskId&&grant.taskId!==scope.taskId||!grant.permissions.includes(purpose))throw Error('managed_schedule_task_delegation_required');
    if(!grant.taskId||!grant.projectId)catalog.put(namespace,key,{...grant,taskId:scope.taskId,projectId:scope.projectId});
    return grant.turnId;
  }
  return {record,assert};
}

/** Validate the current human request again at the private service boundary. */
export function createRunActionIntents() {
  const turns=new Map();
  const actions={
    submit:/提交|投递|启动(?:此|这个|计算|作业)|运行(?:此|这个|作业)|\b(?:submit|launch|start|run)\b/iu,
    cancel:/取消|撤销|停止|终止|\b(?:cancel|stop|abort)\b/iu,
    validate:/核验|核对|验证|检查|\b(?:validate|verify|check)\b/iu,
  };
  const denied=/(?:先别|不要|不准|不需要|禁止|仅(?:仅)?准备|只(?:做)?准备|别再|do not|don't|never|only prepare|draft.only)/iu;
  function record({provider,threadId,projectId,taskId,text,turnId}) {
    if(!threadId)return;
    // Retain the latest real user wording in memory only, for disambiguating exact run ids.
    turns.set(keyOf(provider,threadId),{projectId,taskId,text:text.slice(0,12000),turnId});
  }
  function permits(scope,operation,runId,candidates,targetName) {
    const row=turns.get(keyOf(scope.provider,scope.threadId)),pattern=actions[operation];
    if(!row||!pattern||!scope.threadId||!scope.taskId||!scope.projectId||row.projectId&&row.projectId!==scope.projectId||row.taskId&&row.taskId!==scope.taskId)return false;
    const clauses=row.text.split(/[。；;\n]/u);
    const explicit=clauses.some(part=>pattern.test(part)&&!denied.test(part));
    if(!explicit||clauses.some(part=>pattern.test(part)&&denied.test(part)))return false;
    const matches=candidates.filter(c=>c.runId===runId);
    if(!matches.length)return false;
    if(candidates.length===1)return true;
    if(!row.text.includes(runId))return false;
    return matches.length===1||!!targetName&&row.text.toLowerCase().includes(targetName.toLowerCase());
  }
  return {record,permits,forget:(provider,threadId)=>turns.delete(keyOf(provider,threadId))};
}
