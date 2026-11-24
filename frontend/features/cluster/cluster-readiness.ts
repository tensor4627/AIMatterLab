import type {ClusterQueueProfile,ClusterSchedulerObservation,Project} from '../../../contracts/dto/compute';

export const readinessAgeMs=15*60*1000; // Same window as the worker's public connection check.

type CheckStatus='passed'|'failed'|'unknown';
type ReadinessState='unknown'|'configured'|'verified'|'stale'|'expired'|'failed';
type Evidence={status:CheckStatus|'stale';observedAt:number;current:boolean};
type Tile={state:ReadinessState;scope:string;observedAt?:number;expiresAt?:number};

export type ClusterProbe=ClusterSchedulerObservation&{
 status?:string;ssh_status?:string;scheduler_status?:string;queue_status?:string;observed_at?:number;
};
export type ClusterSshTest={status:CheckStatus;observedAt:number;owner:string;scope:string};
export type ClusterConnectionCheck=ClusterProbe&{version?:number;username_matches?:boolean};
type Profile=Pick<ClusterQueueProfile,'id'|'version'|'queue'|'queue_targets'>&{
 host?:string;username?:string;port?:number|string;scheduler?:string;
};

export function clusterObservationTime(value:{observed_at?:number}|null|undefined){
 const at=typeof value?.observed_at==='number'?value.observed_at*1000:0;
 return Number.isFinite(at)&&at>0&&at<=8.64e15?at:undefined;
}

export function latestClusterObservation<T extends {observed_at?:number}>(cached:T|null|undefined,listed:T|null|undefined){
 return (clusterObservationTime(listed)??0)>(clusterObservationTime(cached)??0)?listed:cached??listed;
}

function evidence(status:string|undefined,observedAt:number|undefined,current:boolean):Evidence|undefined {
 if(!observedAt||!Number.isFinite(observedAt)||observedAt<0||observedAt>8.64e15)return;
 if(status==='passed'||status==='stale'||status==='unknown')return {status,observedAt,current};
 if(status==='failed'||status==='blocked'||status==='mismatch'||status==='needs_human_auth')return {status:'failed',observedAt,current};
}

function fromCheck(configured:boolean,scope:string,now:number,...readings:(Evidence|undefined)[]):Tile {
 const ordered=readings.filter(reading=>reading!==undefined).sort((a,b)=>b.observedAt-a.observedAt);
 const reading=ordered.find(item=>item.current)||ordered[0];
 if(!reading)return {state:configured?'configured':'unknown',scope};
 const {status,observedAt,current}=reading,expiresAt=observedAt+readinessAgeMs;
 if(!current||observedAt>now+readinessAgeMs)return {state:'stale',scope,observedAt};
 if(status==='stale'||expiresAt<=now)return {state:'expired',scope,observedAt};
 return {state:status==='passed'?'verified':status,scope,observedAt,expiresAt};
}

function queues(profile:Profile,project:Project|undefined,savedCurrent:boolean,formDirty:boolean):Tile {
 const targets=profile.queue_targets;
 const scope=project?.id?'当前项目 · 连接版本':'选择项目以查看授权';
 const configured=targets===undefined?!!profile.queue:targets.length>0;
 const authorized=!!profile.id&&project?.policy?.clusters?.includes(profile.id);
 const policy=profile.id?project?.policy?.cluster_queue_policies?.[profile.id]:undefined;
 if(policy&&(targets===undefined||!savedCurrent||formDirty||policy.profile_version!==profile.version))return {state:'stale',scope};
 if(targets===undefined)return {state:configured?'configured':'unknown',scope:authorized&&savedCurrent?'手动队列 · 项目已授权连接':project?.id?'手动队列 · 项目未授权':'手动队列配置'};
 if(savedCurrent&&authorized&&policy?.allowed_target_ids?.length)return {state:'verified',scope};
 return {state:configured?'configured':'unknown',scope};
}

export function clusterReadiness({profile,project,savedCurrent,formDirty,sshTest,sshTestCurrent,probe,probeCurrent,check,checkCurrent,environmentConfigured,now}:{
 profile:Profile;project?:Project;savedCurrent:boolean;formDirty:boolean;
 sshTest?:ClusterSshTest|null;sshTestCurrent:boolean;probe?:ClusterProbe|null;probeCurrent:boolean;
 check?:ClusterConnectionCheck|null;checkCurrent:boolean;
 environmentConfigured:boolean;now:number;
}):Record<'ssh'|'scheduler'|'queues'|'science',Tile> {
 const checkTime=clusterObservationTime(check),probeTime=clusterObservationTime(probe);
 const checkedSsh=check?.ssh_status??(check?.username_matches?'passed':undefined);
 const checkedScheduler=check?.scheduler_status;
 const schedulerMatches=!probe?.selected_scheduler||probe.selected_scheduler===profile.scheduler;
 const endpointConfigured=!!profile.host&&!!profile.username&&Number.isInteger(Number(profile.port))&&Number(profile.port)>=1&&Number(profile.port)<=65535;
 const sshScope=sshTestCurrent&&formDirty?'当前草稿 · 登录认证与远程用户名':'登录认证与远程用户名';
 const schedulerScope=profile.scheduler==='lsf'?'登录节点 · LSF':profile.scheduler==='slurm'?'登录节点 · Slurm':'登录节点';
 return {
  ssh:fromCheck(endpointConfigured,sshScope,now,
   sshTest?evidence(sshTest.status,sshTest.observedAt,sshTestCurrent):undefined,
   evidence(probe?.ssh_status,probeTime,probeCurrent),
   evidence(check?.status==='stale'&&checkedSsh?'stale':checkedSsh,checkTime,checkCurrent)),
  scheduler:fromCheck(!!profile.scheduler&&(!!profile.id||endpointConfigured),schedulerScope,now,
   evidence(probe?.selected_scheduler_match===false?'mismatch':probe?.scheduler_status,probeTime,probeCurrent&&schedulerMatches),
   evidence(check?.status==='stale'&&checkedScheduler?'stale':checkedScheduler,checkTime,checkCurrent)),
  queues:queues(profile,project,savedCurrent,formDirty),
  science:{state:environmentConfigured?'configured':'unknown',scope:formDirty?'环境草稿 · 计算节点待验证':'连接环境 · 计算节点待验证'}
 };
}
