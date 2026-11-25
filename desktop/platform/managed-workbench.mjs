import {createManagedComputeAliases,resourceFingerprint} from '../../backend/main/compute/managed-compute-aliases.mjs';
import {createManagedComputeServices} from '../../backend/main/compute/managed-compute-services.mjs';
import {createManagedComputeResources} from '../../backend/main/compute/managed-compute-resources.mjs';
import {createManagedComputeConsole} from '../../backend/main/compute/managed-compute-console.mjs';
import {createManagedSchedules} from '../../backend/main/compute/managed-schedules.mjs';
import {createMonitorAttention} from '../../backend/main/compute/monitor-attention.mjs';
import {createScheduleDelegations,createRunActionIntents,runActionTarget} from '../../backend/main/compute/schedule-delegation.mjs';
import {taskForRecordIndex} from '../../backend/main/compute/worker-service-version.mjs';
import {taskWorkerSource} from '../../contracts/compute/task-worker-binding.mjs';
import {createManagedComputeTools} from '../../agent/tools/managed-compute-tools.mjs';
import {createAgentWakeDelivery} from '../../agent/sessions/wake-delivery.mjs';
import {randomUUID} from 'node:crypto';
import {scheduleOwnerId} from './schedule-owner.mjs';
import {resourceSessionWorkspaceTool} from '../../backend/main/workspace/resource-workspace.mjs';

function fields(value,expected) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==expected.length||
     expected.some(key=>!Object.hasOwn(value,key)))throw Error('invalid_managed_resource_request');
}
export function createManagedWorkbench({catalog,profiles,registration,terminal,projectSkills,resourceActivity,projectAccess,
 records,workflow,agents,privateAccess,workerSource,sshTransportSource,handle,notify,dispatch,announce=()=>{},
 worker,conversationTerminals,closeSsh,assertConnectionIdle,resourceWorkspace,terminalAuthorization,developerCompute,hostedServiceReplaced,
 onConnectionLost,onConnectionReplaced}) {
  const delegations=createScheduleDelegations(catalog),runIntents=createRunActionIntents();
  let schedules;
  const named=notice=>({...notice,resourceName:resourceActivity.label(notice.profileId)||notice.profileId});
  const attention=createMonitorAttention({catalog,announce:notice=>announce(named(notice))});
  const updated=()=>{if(schedules)attention.reconcile(schedules.snapshot().sources);notify();};
  function authorizeRun(scope,{sourceId,runId,kind}) {
    const task=records.bound(scope.provider,scope.threadId);
    if(!scope.threadId||!scope.projectId||(task?.id??null)!==(scope.taskId??null))return null;
    const recorded=resourceActivity.runKind(scope,sourceId,runId);
    if(recorded)return !kind||recorded===kind?recorded:null;
    if(!task)return null;
    if((task.authoring?.projectId||task.projectId)!==scope.projectId||taskForRecordIndex(task).workerSourceId!==sourceId)return null;
    const artifacts=(task.artifacts||[]).filter(a=>a.id===runId&&['run','cluster-run'].includes(a.kind)&&(!kind||a.kind===kind));
    return artifacts.length===1?artifacts[0].kind:null;
  }
  const liveHumanTurn=scope=>agents.turnOrigin(scope.provider,scope.threadId)==='human'&&agents.isBusy(scope.provider,scope.threadId);
  function permitsRunAction(scope,action,runId,resourceId,sourceId) {
    if(!liveHumanTurn(scope))return false;
    const task=records.bound(scope.provider,scope.threadId),available=new Map();
    for(const run of resourceActivity.runsFor(scope))available.set(JSON.stringify([run.sourceId,run.runId]),run);
    const taskSourceId=task&&taskForRecordIndex(task).workerSourceId;
    if(taskSourceId)for(const item of task.artifacts||[]){
      if(['run','cluster-run'].includes(item.kind))available.set(JSON.stringify([taskSourceId,item.id]),{sourceId:taskSourceId,runId:item.id});
    }
    const candidates=[...available.values()],target=runActionTarget(resources.snapshot(),resourceId);
    return runIntents.permits(scope,action,runId,candidates,target,{sourceId,resourceId})||
      action==='validate'&&runIntents.permits(scope,'submit',runId,candidates,target,{sourceId,resourceId});
  }
  const resources=createManagedComputeResources({terminal,profiles,selectionCatalog:catalog,aliases:createManagedComputeAliases({projectSkills}),
    services:createManagedComputeServices({connections:terminal.connections,registration,source:workerSource,transportSource:sshTransportSource}),
    resourceWorkspace,serviceRegistration:registration,terminalAuthorization,developerCompute,onConnectionLost,onConnectionReplaced,
    restoreOwner:({provider,threadId})=>{
      if(records.deleted(provider,threadId)||!records.conversation(provider,threadId)&&!records.bound(provider,threadId))return null;
      return workflow.currentFor(provider,threadId);
    },
    taskSource:scope=>taskWorkerSource(records.bound(scope.provider,scope.threadId)),
    authorizeTerminal:(scope,resource)=>projectAccess.terminalDecision(scope,resource),
    terminalPolicyRevision:(scope,resource)=>projectAccess.terminalRevision(scope,resource),
    authorizeRun:(scope,args)=>!!authorizeRun(scope,args),
    authorizeRunAction:(scope,{action,runId,resourceId,sourceId})=>permitsRunAction(scope,action,runId,resourceId,sourceId),
    authorizeSchedule:(scope,{sourceId,scheduleId})=>!!schedules?.snapshot().sources.find(s=>s.id===sourceId)?.schedules.some(p=>
       p.id===scheduleId&&p.scope.taskId===scheduleOwnerId(scope)&&['provider','threadId','projectId'].every(k=>p.scope[k]===scope[k])),
    onAcquired:(scope,resource)=>{resourceActivity.acquired(scope,resource);notify();},
    onChange:notify,busy:scope=>agents.isBusy(scope.provider,scope.threadId)});
  function authorizedWake(event) {
    const {scope}=event;
    const checkCurrent=()=>{
      const task=records.bound(scope.provider,scope.threadId);
      const row=schedules.snapshot().sources.find(s=>s.id===event.sourceId)?.schedules.find(p=>p.id===event.scheduleId);
      const conversation=!task&&records.conversation(scope.provider,scope.threadId);
      const projectId=task?.authoring?.projectId||task?.projectId||conversation?.projectId;
      return !!projectId&&projectId===scope.projectId&&scheduleOwnerId({...scope,taskId:task?.id??null})===scope.taskId&&!!row&&
        row.stopRequestedAt==null&&!row.stopNeedsConfirmation;
    };
    return checkCurrent()&&resources.eligibleForWake({...scope,checkCurrent},event.sourceId);
  }
  const wake=createAgentWakeDelivery({catalog,agents,dispatch,canWake:authorizedWake});
  schedules=createManagedSchedules({catalog,listSources:()=>resources.listSources({scheduleReady:true}),wake,onChange:updated});
  const computeTools=createManagedComputeTools({resources,schedules,assertWorkflow:scope=>workflow.assertScope(scope),
    authorizeTask:async(task,scope)=>{if(task.customCv?.id&&(await privateAccess.assertTask(task,scope.provider)).definitionOnly)throw Error('managed_compute_private_task_scope');},
    assertScheduleIntent:(scope,action,args)=>{
      if(action==='upsert'&&agents.turnOrigin(scope.provider,scope.threadId)==='service')throw Error('managed_schedule_user_renewal_required');
      return delegations.assert(scope,action,args);
    },
    assertRunIntent:(scope,action,args,sourceId)=>{if(!permitsRunAction(scope,action,args.run_id,args.resource_id,sourceId))throw Error('managed_run_user_instruction_required');},
    assertRunSource:({scope,sourceId,runId,kind})=>{const actual=authorizeRun(scope,{sourceId,runId,kind});if(!actual)throw Error('managed_compute_original_run_unconfirmed');return actual;},
    captureRunPreparation:scope=>liveHumanTurn(scope)?runIntents.capturePreparation(scope):undefined,
    onRunObserved:entry=>{
      const wasLinked=entry.operation==='prepare'&&!!authorizeRun(entry.scope,{sourceId:entry.sourceId,runId:entry.runId});
      resourceActivity.recordRun(entry);
      notify();void schedules.refresh(entry.sourceId).catch(()=>{});
      return !wasLinked;
    }
  });
  const desktopTools=resourceWorkspace?{
    ...computeTools,
    tools:()=>[...computeTools.tools(),resourceSessionWorkspaceTool],
    owns:name=>name===resourceSessionWorkspaceTool.name||computeTools.owns(name),
    call:(name,args,scope)=>name===resourceSessionWorkspaceTool.name?resourceWorkspace.callSessionTool(args,scope):computeTools.call(name,args,scope),
  }:computeTools;

  function descriptor(resource) {
    const config=profiles.read({id:resource.profileId});
    if(config.version!==resource.profileVersion)throw Error('managed_compute_profile_changed');
    return {...resource,targetFingerprint:resourceFingerprint(config)};
  }
  function snapshot() {
    const published=resources.snapshot().map(row=>{
      const detail=descriptor(row),style=resourceActivity.style(row);
      return {...row,color:style.color,serviceReady:!row.verificationPending&&row.serviceStatus==='ready',terminalReady:!row.verificationPending&&row.kind==='ssh',
        authorizedProjects:projectAccess.projects(detail)};
    });
    return {...resourceActivity.snapshot({resources:published,sources:schedules.snapshot().sources,turns:agents.turnStates(),tasks:records.tasks().map(taskForRecordIndex)}),notices:attention.list().map(named)};
  }
  const consoleView=createManagedComputeConsole({profiles,terminal,resources,conversationTerminals,records,catalog,registration,worker,closeSsh,assertConnectionIdle,notify});
  const consoleSnapshot=()=>consoleView.snapshot({projectAccess:resource=>projectAccess.decisions(descriptor(resource))});
  handle('compute.console.snapshot',value=>{fields(value,[]);return consoleSnapshot();});
  handle('compute.console.refresh',async value=>{fields(value,[]);await consoleView.refresh();return consoleSnapshot();});
  handle('compute.console.release',value=>consoleView.release(value));
  handle('compute.console.disconnectSsh',value=>consoleView.disconnectSsh(value));
  handle('compute.console.attachLocal',value=>consoleView.attachLocal(value));
  handle('compute.console.detachLocal',value=>consoleView.detachLocal(value));
  handle('compute.managed.snapshot',value=>{fields(value,[]);return snapshot();});
  handle('compute.managed.refresh',async value=>{fields(value,[]);await schedules.refresh();return snapshot();});
  handle('compute.managed.publish',value=>resources.publish(value));
  handle('compute.managed.configureService',value=>resources.configureService(value));
  handle('compute.managed.serviceStatus',value=>resources.serviceStatus(value));
  handle('compute.managed.updateService',async value=>{
    assertConnectionIdle?.(value);
    const updated=await resources.updateService(value);
    hostedServiceReplaced?.(value);
    return updated;
  });
  function setProjectAccess(value, ref) {
    fields(value,['resourceId','projectId','allowed']);
    if(!catalog.get('projects',value.projectId)&&!catalog.list('workspace-index').some(p=>p.id===value.projectId)&&
       !records.conversations().some(c=>c.projectId===value.projectId))throw Error('unknown_desktop_project');
    const target=resources.snapshot().find(row=>row.resourceId===value.resourceId);
    if(!target||ref&&['connectionId','profileId','profileVersion'].some(key=>ref[key]!==target[key]))throw Error('managed_compute_resource_unavailable');
    const result=projectAccess.set(value.projectId,descriptor(target),value.allowed);notify();return result;
  }
  handle('compute.managed.projectAccess',value=>setProjectAccess(value));
  handle('compute.console.projectAccess',async value=>{
    fields(value,['connectionId','profileId','profileVersion','projectId','allowed']);
    const {connectionId,profileId,profileVersion,projectId,allowed}=value;
    const state=await terminal.connections.state({connectionId});
    if(state.connectionId!==connectionId||state.profileId!==profileId||state.profileVersion!==profileVersion||
       state.status!=='authenticated'||state.authentication!=='verified'||!state.capabilities.multiplex)throw Error('managed_compute_resource_unavailable');
    return setProjectAccess({resourceId:'ssh:'+profileId,projectId,allowed},value);
  });
  handle('compute.managed.scheduleDetails',value=>{fields(value,['sourceId','scheduleId']);return schedules.status(value);});
  handle('compute.managed.acknowledgeNotice',value=>{fields(value,['id']);const result=attention.acknowledge(value.id);notify();return result;});
  handle('compute.managed.observeOnce',value=>{fields(value,['sourceId','scheduleId','requestId']);return schedules.observeOnce(value);});
  handle('compute.managed.stopSchedule',value=>{fields(value,['sourceId','scheduleId']);return schedules.stop(value);});
  function userMessage({provider,method,params={}}) {
    if(!['turn/start','turn/steer'].includes(method)||typeof params.threadId!=='string'||!Array.isArray(params.input))return;
    const text=params.input[0]?.type==='text'&&typeof params.input[0].text==='string'?params.input[0].text:'';
    const owner=workflow.currentFor(provider,params.threadId);
    const value={...owner,provider,threadId:params.threadId,text,planningMode:params.planningMode===true,turnId:params.studioTurnRequestId||randomUUID()};
    if(text.trim()){resources.recordUserTurn(value);delegations.record(value);}
    runIntents.record(value);
  }
  async function publishLocal(worker,preferredProfileId) {
    if(!worker.connection||worker.identity?.kind==='ssh'||!worker.connectionTarget)return;
    const {distribution,root}=worker.identity,{port,requestedRoot}=worker.connectionTarget;
    if(!distribution||!root||!Number.isInteger(port)||worker.connection.health?.root!==root)return;
    const runtime=worker.connection.health.runtime;
    const matches=profiles.list().filter(p=>p.kind==='wsl'&&(!preferredProfileId||p.id===preferredProfileId)&&p.distribution===distribution&&p.port===port&&[root,requestedRoot].includes(p.root));
    if(matches.length>1||preferredProfileId&&!matches.length)return;
    const profile=matches[0]||profiles.save({kind:'wsl',name:'local',distribution,root,port,intent:'existing',expectedVersion:0});
    resourceActivity.style(profile);
    return resources.publishWsl({profileId:profile.id,profileVersion:profile.version,distribution,root,port,runtime});
  }
  return {resources,schedules,desktopTools,userMessage,publishLocal};
}
