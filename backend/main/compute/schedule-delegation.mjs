// Keep only the authorized purpose of the human's message. Service-generated messages never enter this boundary.
import {randomUUID} from 'node:crypto';

const namespace='managed-schedule-delegation';
const keyOf=(provider,threadId)=>JSON.stringify([provider,threadId]);
const sentences=text=>text.split(/[。；;！？!?\r\n]+|\.(?=\s|$)/u);
const discussion=/\b(?:how|whether|why|what|explain|describe|show me|tell me|check if|see if)\b|^\s*(?:can|could|should|may)\s+(?:i|we|it|this)\b|如何|怎么|怎样|是否|能否|可否|为什么|什么时候|请问|解释|说明(?:一下|下)?(?:何|能|该|定时|取消|提交|验证)/iu;
// Conditional requests require evidence for the condition outside this text-only gate.
const contingent=/\b(?:if|unless|provided that|only after|once it|when it)\b|如果|假如|除非|只有|前提是|等.{1,24}(?:完成|成功|通过|结束).{0,4}再/iu;
const restriction=/^(?:也\s*)?(?:不要(?:再)?|先别|别(?:再)?|不再|不准|不需要|禁止|不用|无需|请勿|勿|不(?=运行|执行|使用|跑脚本|唤醒|通知|监控|巡检|轮询)|do not\b|don['’]t\b|never\b|without\b|avoid\b|no\b)\s*/iu;
const monitor=/监控|监测|巡检|轮询|\b(?:monitor(?:ing)?|poll(?:ing)?|watch|track)\b/iu;
const timing=/定时|定期|到时|每(?:隔|半|天|小时|分钟|[一二两三四五六七八九十百\d])|\b(?:schedule[ds]?|periodic(?:ally)?|every|in\s+\d+\s+(?:seconds?|minutes?|hours?|days?))\b/iu;
const intervalStart=/^(?:定时|定期|按时|每(?:隔\s*)?(?:(?:半|[一二两三四五六七八九十百\d]+)\s*(?:个)?\s*)?(?:秒钟?|分钟|小时|天|日|周)|every\s+(?:(?:[\d.]+|half(?: an?)?|one|two|three|four)\s+)?(?:seconds?|minutes?|hours?|days?|weeks?))\s*/iu;
const log=/日志|\blogs?\b/iu;
const readStatus=/状态|进度|\b(?:status|state|progress|log(?:s)?|finished|completed)\b/iu;
const stopSchedule=/^(?:停止|取消|终止|结束|关闭|禁用|撤销)\s*(?:这个|此|该|当前)?\s*(?:作业的|任务的)?\s*(?:定时|计划|巡检|监控|监测|轮询)|^(?:stop|cancel|disable|end|turn off|cease)\s+(?:(?:the|this|all)\s+)?(?:(?:current|existing|further|future)\s+)?(?:(?:job|run|task)['’]s\s+)?(?:scheduled?\b|schedules?\b|monitor(?:ing)?\b|poll(?:ing)?\b)/iu;
const monitorCommand=/^(?:监控|监测|巡检|轮询|跟踪)|^(?:monitor(?:ing)?|poll(?:ing)?|watch(?:ing)?|track(?:ing)?)\b/iu;
const readCommand=/^(?:读取|查看|查询|检查|观察)|^(?:read|check|observe|watch|report)\b/iu;
const schedulePrefix=/^(?:(?:创建|安排|开启|开始|设置|启用)\s*(?:个|一个)?\s*(?:定时|定期)?|(?:set up|schedule|start|enable)\s+(?:(?:a|an|the|this|scheduled|periodic)\s+)*)/iu;
const scriptCommand=/^(?:用|使用|运行|执行|跑)\s*.{0,32}(?:脚本|后处理)|^(?:run(?:ning)?|execut(?:e|ing)|us(?:e|ing)|launch)\s+(?:\S+\s+){0,3}(?:scripts?|bash|python)\b/iu;
const scriptSubject=/^(?:脚本|后处理)|^(?:scripts?|bash|python|postprocessing)\b/iu;
const wakeCommand=/^(?:(?:唤醒|提醒|通知|叫醒)(?:我|Agent|智能体|当前会话)|(?:wak(?:e|ing)|remind(?:ing)?|notif(?:y|ying))\s+(?:me|the agent|this conversation)\b)/iu;
const wakeSubject=/^(?:唤醒|提醒|通知|叫醒)|^(?:wake(?:ups?)?|reminders?|notifications?)\b/iu;

function commandText(text) {
  return text.trim()
    .replace(/^(?:[-*]\s+)?(?:(?:please|kindly|(?:could|can|would|will) you|i (?:want|need) you to|go ahead and|now|immediately)\s+)*/iu,'')
    .replace(/^(?:(?:请(?:你|您)?|麻烦(?:你|您)?|帮我|请帮忙|请帮我|请你帮我|现在|立即|马上|直接|先)\s*)*/u,'')
    .trim();
}

function sameScope(grant,scope) {
  if(!grant.taskId&&!scope.taskId)return (grant.projectId??null)===(scope.projectId??null);
  return (!grant.projectId||grant.projectId===scope.projectId)&&(!grant.taskId||grant.taskId===scope.taskId);
}

function evidencedTurn(grant,purpose) {
  if(!Array.isArray(grant?.permissions)||!grant.permissions.includes(purpose)
    ||!Object.hasOwn(grant.permissionTurns??{},purpose))return;
  const turn=grant.permissionTurns[purpose];
  if(typeof turn==='string'&&turn.length)return turn;
}

function deniedSchedule(command,marker,allowed,removed) {
  for(const subject of command.split(/\b(?:or|nor|and)\b|或(?:者)?|以及|并且?|也(?=不|别|勿)/iu)) {
    const words=commandText(subject).replace(restriction,'');
    if(stopSchedule.test(words))removed.add('stop');
    else if(scriptCommand.test(words)||scriptSubject.test(words))removed.add('script');
    else if(wakeCommand.test(words)||wakeSubject.test(words))removed.add('wake_agent');
    else {
      const action=words.replace(schedulePrefix,'');
      if(monitorCommand.test(action)) {
        removed.add('poll');removed.add('action');
        if(/不再|不要再|别再/.test(marker)||/\b(?:anymore|any longer)\b/iu.test(action))allowed.add('stop');
      } else if(readCommand.test(action)&&log.test(action)||/^(?:日志|logs?\b)/iu.test(action)) {
        removed.add('action');
      } else if(readCommand.test(action)&&readStatus.test(action))removed.add('poll');
    }
  }
}

function schedulePurposes(text) {
  const allowed=new Set(),removed=new Set();
  for(const sentence of sentences(text)) {
    if(discussion.test(sentence)||contingent.test(sentence))continue;
    const scheduled=timing.test(sentence)||monitor.test(sentence);
    for(const part of sentence.split(/[，,]|\bbut\b|但是|但|(?=\bwithout\b)/iu)) {
      const words=commandText(part);
      const negative=restriction.exec(words);
      const phrases=negative?[words]:words.split(/\band\b|并且|并|同时|而且/iu);
      for(const phrase of phrases) {
        const command=commandText(phrase).replace(intervalStart,'');
        const forbidden=restriction.exec(command);
        if(forbidden) {
          deniedSchedule(command.slice(forbidden[0].length),forbidden[0],allowed,removed);
          continue;
        }
        if(stopSchedule.test(command)) {
          allowed.add('stop');
          if(monitor.test(command)) { removed.add('poll');removed.add('action'); }
          continue;
        }
        const action=command.replace(schedulePrefix,'')
          .replace(/^(?:仅|只)(?=监控|监测|巡检|轮询|跟踪)|^(?:only|just)\s+(?=monitor|poll|watch|track)/iu,'');
        if(monitorCommand.test(action)||scheduled&&readCommand.test(action)&&readStatus.test(action)&&!log.test(action))allowed.add('poll');
        if(scheduled&&readCommand.test(action)&&log.test(action))allowed.add('action');
        if(scheduled&&(scriptCommand.test(action)||action!==command&&scriptSubject.test(action))) {
          allowed.add('script');
          if(monitor.test(action))allowed.add('poll');
        }
        if(scheduled&&wakeCommand.test(action))allowed.add('wake_agent');
      }
    }
  }
  // Explicit restart of monitoring supersedes an earlier instruction to stop it.
  if(allowed.has('poll')&&!allowed.has('stop'))removed.add('stop');
  return {allowed,removed};
}

export function createScheduleDelegations(catalog) {
  function record({provider,threadId,projectId,taskId,text,turnId}) {
    if(!threadId||typeof text!=='string'||!text.trim())return;
    const key=keyOf(provider,threadId);
    const {allowed,removed}=schedulePurposes(text);
    const existing=catalog.get(namespace,key);
    const prior=existing&&sameScope(existing,{projectId,taskId})?existing:null;
    // Old records came from keyword matches and have no evidence for an individual purpose.
    const permissions=new Set((prior?.permissions||[]).filter(purpose=>evidencedTurn(prior,purpose)));
    const added=[...allowed].filter(purpose=>!removed.has(purpose));
    if(!added.length&&![...removed].some(purpose=>permissions.has(purpose)))return;
    const humanTurn=turnId||randomUUID();
    for(const purpose of added)permissions.add(purpose);
    for(const purpose of removed)permissions.delete(purpose);
    const permissionTurns=Object.fromEntries([...permissions].map(purpose=>[
      purpose,allowed.has(purpose)?humanTurn:evidencedTurn(prior,purpose),
    ]));
    const legacyGrant=prior&&!prior.permissionTurns?prior:prior?.legacyGrant;
    catalog.put(namespace,key,{provider,threadId,taskId:taskId||null,projectId:projectId||null,
      permissions:[...permissions],turnId:humanTurn,permissionTurns,...legacyGrant?{legacyGrant}:{}});
  }
  function assert(scope,operation,args) {
    const key=keyOf(scope.provider,scope.threadId),grant=catalog.get(namespace,key);
    const purposes={status:'poll',read_log:'action'};
    const purpose=operation==='stop'?'stop':args.kind==='action'?purposes[args.action?.type]:args.kind;
    const turn=evidencedTurn(grant,purpose);
    if(!scope.threadId||!scope.projectId||!turn||!sameScope(grant,scope))throw Error('managed_schedule_task_delegation_required');
    if(!grant.taskId||!grant.projectId)catalog.put(namespace,key,{...grant,taskId:scope.taskId,projectId:scope.projectId});
    return turn;
  }
  return {record,assert};
}

const runCommands={
  submit:/^(?:submit|enqueue|launch|start|run)\b|^(?:(?:把|将|在|对|用).{1,100}?)?(?:提交|投递|启动|运行|交(?=(?:一?[个份项]|独立|作业|任务)))/iu,
  cancel:/^(?:cancel|stop|abort|terminate)\b|^(?:(?:把|将|在|对).{1,100}?)?(?:取消|撤销|停止|终止)/iu,
  validate:/^(?:validate|verify|check)\b|^(?:(?:把|将|在|对).{1,100}?)?(?:核验|核对|验证|检查)/iu,
};

function runCommand(text,operation) {
  const match=runCommands[operation].exec(text);
  if(!match||stopSchedule.test(text))return false;
  const object=text.slice(match[0].length).trim().replace(/^(?:the|this|a|an)\s+/iu,'');
  if(operation==='cancel'&&(monitorCommand.test(object)||scriptCommand.test(object)||scriptSubject.test(object)))return false;
  if(operation==='submit'&&(
    /^(?:(?:launch|start|run)\b\s*(?:(?:the|this|a|an)\s+)?(?:monitoring|polling|scheduled?|watching)\b|(?:启动|运行)(?:定时|巡检|轮询|监控))/iu.test(text)
    ||scriptCommand.test(text)
  ))return false;
  return operation!=='validate'||!readStatus.test(text);
}

function explicitRunSelectors(text,operation) {
  const labeled=/(?:\b(?:run[ _-]?id|job[ _-]?id)\b\s*[:：=#]?\s*|\bid\s*[:：=#]\s*|(?:作业|任务)\s*(?:ID|编号|标识)\s*[:：=#]?\s*)["'`“]?([A-Za-z0-9][A-Za-z0-9_.:+@~-]*)/giu;
  const verb=runCommands[operation].exec(text);
  const object=text.slice(verb[0].length).trim();
  const labels=[...object.matchAll(labeled)];
  const selectors=labels.map(match=>match[1]);
  if(labels[0]?.index===0)return selectors;
  const subject=object.replace(/^(?:(?:the\s+)?(?:run|job)\b\s+|(?:这个|此|该)?(?:作业|任务)\s*)/iu,'');
  const id=/^["'`“]?([A-Za-z0-9][A-Za-z0-9_.:+@~-]*)/u.exec(subject)?.[1];
  if(id&&(/^(?:(?:run|job)[_-][a-z0-9]|[a-f0-9]{16,}$|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$)/iu.test(id)
    ||object!==subject&&/^\d+$/u.test(id)))selectors.push(id);
  return selectors;
}

function mentionsRun(text,id) {
  const token=/[A-Za-z0-9_.:+@~/-]/u;
  for(let index=text.indexOf(id);index>=0;index=text.indexOf(id,index+1)){
    const prefix=text.slice(0,index),after=text[index+id.length]||'';
    const labeled=/\b(?:run(?:_id)?|id):$/iu.test(prefix);
    if((labeled||!token.test(prefix.at(-1)||''))&&!token.test(after))return true;
  }
  return false;
}

function mentionsTarget(text,displayName) {
  const name=displayName?.trim().toLowerCase();
  if(!name)return false;
  const clause=text.toLowerCase();
  const delimiters=[['"','"'],["'","'"],['`','`'],['“','”'],['「','」'],['(',')'],['（','）']];
  if(delimiters.some(([left,right])=>clause.includes(left+name+right)))return true;
  for(let index=clause.indexOf(name);index>=0;index=clause.indexOf(name,index+1)){
    const prefix=clause.slice(0,index),rest=clause.slice(index+name.length);
    if(/(?:\b(?:at|on|via)|\b(?:target|cluster)\s*[:：])\s*$/iu.test(prefix)
       &&/^\s*(?:$|[,，]|(?:now|please)\s*$)/iu.test(rest))return true;
    if(/[在于到]\s*$/u.test(prefix)&&/^\s*(?:$|[，,]|[上中](?:$|\s|的|提交|取消|验证|检查))/u.test(rest))return true;
  }
  return false;
}

export function runActionTarget(resources,resourceId) {
  const original=resources.find(resource=>resource.resourceId===resourceId);
  if(!original)return null;
  const name=original.name?.trim().toLowerCase();
  const unique=label=>resources.every(resource=>resource===original||
    (resource.name?.trim().toLowerCase()!==label&&resource.resourceId.toLowerCase()!==label));
  if(name&&unique(name))return original.name;
  return unique(resourceId.toLowerCase())?resourceId:null;
}

/** Validate the current human request again at the private service boundary. */
export function createRunActionIntents() {
  const turns=new Map();
  function record({provider,threadId,projectId,taskId,text,turnId}) {
    if(!threadId)return;
    // Retain the latest real user wording in memory only, for disambiguating exact run ids.
    turns.set(keyOf(provider,threadId),{projectId,taskId,text:text.slice(0,12000),turnId});
  }
  function permits(scope,operation,runId,candidates,targetName) {
    const row=turns.get(keyOf(scope.provider,scope.threadId));
    if(!row||!Object.hasOwn(runCommands,operation)||typeof runId!=='string'||!runId
      ||!scope.threadId||!scope.projectId||!sameScope(row,scope))return false;
    const clauses=sentences(row.text).filter(part=>!discussion.test(part)&&!contingent.test(part))
      .flatMap(part=>part.split(/\bbut\b|但是|但|(?:[，,]|\band\b|并且?|同时)(?=\s*(?:不要|先别|不再|do not|don['’]t|never))/iu))
      .map(commandText);
    const explicit=clauses.filter(part=>runCommand(part,operation));
    if(!explicit.length||clauses.some(part=>{
      const negative=restriction.exec(part);
      return negative&&runCommand(part.slice(negative[0].length),operation);
    }))return false;
    const matches=candidates.filter(c=>c.runId===runId);
    if(!matches.length)return false;
    if(candidates.length===1)return explicit.some(part=>explicitRunSelectors(part,operation).every(id=>id===runId));
    return explicit.some(part=>mentionsRun(part,runId)&&(matches.length===1||mentionsTarget(part,targetName)));
  }
  return {record,permits,forget:(provider,threadId)=>turns.delete(keyOf(provider,threadId))};
}
