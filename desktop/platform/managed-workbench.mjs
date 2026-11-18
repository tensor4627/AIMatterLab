import {createManagedComputeAliases,resourceFingerprint} from '../../backend/main/compute/managed-compute-aliases.mjs';
import {createManagedComputeServices} from '../../backend/main/compute/managed-compute-services.mjs';
import {createManagedComputeResources} from '../../backend/main/compute/managed-compute-resources.mjs';
import {createManagedSchedules} from '../../backend/main/compute/managed-schedules.mjs';
import {createMonitorAttention} from '../../backend/main/compute/monitor-attention.mjs';
import {createScheduleDelegations,createRunActionIntents} from '../../backend/main/compute/schedule-delegation.mjs';
import {taskForRecordIndex} from '../../backend/main/compute/worker-service-version.mjs';
import {taskWorkerSource} from '../../contracts/compute/task-worker-binding.mjs';
import {createManagedComputeTools} from '../../agent/tools/managed-compute-tools.mjs';
import {createAgentWakeDelivery} from '../../agent/sessions/wake-delivery.mjs';
import {randomUUID} from 'node:crypto';

function fields(value,expected) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==expected.length||
     expected.some(key=>!Object.hasOwn(value,key)))throw Error('invalid_managed_resource_request');
}
export function createManagedWorkbench({catalog,profiles,registration,terminal,projectSkills,resourceActivity,projectAccess,
 records,workflow,agents,privateAccess,workerSource,sshTransportSource,handle,notify,dispatch,announce=()=>{}}) {
  const delegations=createScheduleDelegations(catalog),runIntents=createRunActionIntents();
  let schedules;
  const named=notice=>({...notice,resourceName:resourceActivity.label(notice.profileId)||notice.profileId});
  const attention=createMonitorAttention({catalog,announce:notice=>announce(named(notice))});
  const updated=()=>{if(schedules)attention.reconcile(schedules.snapshot().sources);notify();};
  function authorizeRun(scope,{sourceId,runId,kind}) {
    const task=records.bound(scope.provider,scope.threadId);
    if(!task||!scope.projectId||task.id!==scope.taskId)return null;
    const recorded=resourceActivity.runKind(scope,sourceId,runId);
    if(recorded)return !kind||recorded===kind?recorded:null;
    if((task.authoring?.projectId||task.projectId)!==scope.projectId||taskForRecordIndex(task).workerSourceId!==sourceId)return null;
    const artifacts=(task.artifacts||[]).filter(a=>a.id===runId&&['run','cluster-run'].includes(a.kind)&&(!kind||a.kind===kind));
    return artifacts.length===1?artifacts[0].kind:null;
  }
  function permitsRunAction(scope,action,runId,resourceId) {
    if(agents.turnOrigin(scope.provider,scope.threadId)==='service')return false;
    const task=records.bound(scope.provider,scope.threadId),available=new Map();
    for(const run of resourceActivity.runsFor(scope))available.set(JSON.stringify([run.sourceId,run.runId]),run);
    const sourceId=task&&taskForRecordIndex(task).workerSourceId;
    if(sourceId)for(const item of task.artifacts||[]){
      if(['run','cluster-run'].includes(item.kind))available.set(JSON.stringify([sourceId,item.id]),{sourceId,runId:item.id});
    }
    return runIntents.permits(scope,action,runId,[...available.values()],resources.snapshot().find(r=>r.resourceId===resourceId)?.name);
  }
  const resources=createManagedComputeResources({terminal,profiles,aliases:createManagedComputeAliases({projectSkills}),
    services:createManagedComputeServices({connections:terminal.connections,registration,source:workerSource,transportSource:sshTransportSource}),
    taskSource:scope=>taskWorkerSource(records.bound(scope.provider,scope.threadId)),
    authorizeTerminal:(scope,resource)=>projectAccess.includes(scope.projectId,resource),
    authorizeRun:(scope,args)=>!!authorizeRun(scope,args),
    authorizeRunAction:(scope,{action,runId,resourceId})=>permitsRunAction(scope,action,runId,resourceId),
    authorizeSchedule:(scope,{sourceId,scheduleId})=>!!schedules?.snapshot().sources.find(s=>s.id===sourceId)?.schedules.some(p=>
       p.id===scheduleId&&['provider','threadId','projectId','taskId'].every(k=>p.scope[k]===scope[k])),
    onAcquired:(scope,resource)=>{resourceActivity.acquired(scope,resource);notify();},
    onChange:notify,busy:scope=>agents.isBusy(scope.provider,scope.threadId)});
  function authorizedWake(event) {
    const {scope}=event;
    const checkCurrent=()=>{
      const task=records.bound(scope.provider,scope.threadId);
      const row=schedules.snapshot().sources.find(s=>s.id===event.sourceId)?.schedules.find(p=>p.id===event.scheduleId);
      return !!task&&task.id===scope.taskId&&(task.authoring?.projectId||task.projectId)===scope.projectId&&!!row&&!row.stopRequestedAt;
    };
    return checkCurrent()&&resources.eligibleForWake({...scope,checkCurrent},event.sourceId);
  }
  const wake=createAgentWakeDelivery({catalog,agents,dispatch,canWake:authorizedWake});
  schedules=createManagedSchedules({catalog,listSources:()=>resources.listSources({scheduleReady:true}),wake,onChange:updated});
  const desktopTools=createManagedComputeTools({resources,schedules,assertWorkflow:scope=>workflow.assertScope(scope),
    authorizeTask:async(task,scope)=>{if(task.customCv?.id&&(await privateAccess.assertTask(task,scope.provider)).definitionOnly)throw Error('managed_compute_private_task_scope');},
    assertScheduleIntent:(scope,action,args)=>{
      if(action==='upsert'&&agents.turnOrigin(scope.provider,scope.threadId)==='service')throw Error('managed_schedule_user_renewal_required');
      return delegations.assert(scope,action,args);
    },
    assertRunIntent:(scope,action,args)=>{if(!permitsRunAction(scope,action,args.run_id,args.resource_id))throw Error('managed_run_user_instruction_required');},
    assertRunSource:({scope,sourceId,runId,kind})=>{const actual=authorizeRun(scope,{sourceId,runId,kind});if(!actual)throw Error('managed_compute_original_run_unconfirmed');return actual;},
    onRunObserved:entry=>{resourceActivity.recordRun(entry);notify();void schedules.refresh(entry.sourceId).catch(()=>{});}
  });

  function descriptor(resource) {
    const config=profiles.read({id:resource.profileId});
    if(config.version!==resource.profileVersion)throw Error('managed_compute_profile_changed');
    return {...resource,targetFingerprint:resourceFingerprint(config)};
  }
  function snapshot() {
    const published=resources.snapshot().map(row=>{
      const detail=descriptor(row),style=resourceActivity.style(row);
      return {...row,color:style.color,serviceReady:row.serviceStatus==='ready',terminalReady:row.kind==='ssh',
        authorizedProjects:projectAccess.projects(detail)};
    });
    return {...resourceActivity.snapshot({resources:published,sources:schedules.snapshot().sources,turns:agents.turnStates(),tasks:records.tasks().map(taskForRecordIndex)}),notices:attention.list().map(named)};
  }
  handle('compute.managed.snapshot',value=>{fields(value,[]);return snapshot();});
  handle('compute.managed.refresh',async value=>{fields(value,[]);await schedules.refresh();return snapshot();});
  handle('compute.managed.publish',value=>resources.publish(value));
  handle('compute.managed.configureService',value=>resources.configureService(value));
  handle('compute.managed.projectAccess',value=>{
    fields(value,['resourceId','projectId','allowed']);
    if(!catalog.get('projects',value.projectId)&&!catalog.list('workspace-index').some(p=>p.id===value.projectId)&&
       !records.conversations().some(c=>c.projectId===value.projectId))throw Error('unknown_desktop_project');
    const target=resources.snapshot().find(row=>row.resourceId===value.resourceId);
    if(!target)throw Error('managed_compute_resource_unavailable');
    const result=projectAccess.set(value.projectId,descriptor(target),value.allowed);notify();return result;
  });
  handle('compute.managed.scheduleDetails',value=>{fields(value,['sourceId','scheduleId']);return schedules.status(value);});
  handle('compute.managed.acknowledgeNotice',value=>{fields(value,['id']);const result=attention.acknowledge(value.id);notify();return result;});
  handle('compute.managed.observeOnce',value=>{fields(value,['sourceId','scheduleId','requestId']);return schedules.observeOnce(value);});
  handle('compute.managed.stopSchedule',value=>{fields(value,['sourceId','scheduleId']);return schedules.stop(value);});
  function userMessage({provider,method,params={}}) {
    if(!['turn/start','turn/steer'].includes(method)||typeof params.threadId!=='string'||!Array.isArray(params.input))return;
    const text=params.input[0]?.type==='text'&&typeof params.input[0].text==='string'?params.input[0].text:'';
    if(!text.trim())return;
    const owner=workflow.currentFor(provider,params.threadId);
    const value={...owner,provider,threadId:params.threadId,text,turnId:params.studioTurnRequestId||randomUUID()};
    resources.recordUserTurn(value);delegations.record(value);runIntents.record(value);
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
