import Button from '../../ui/Button';
import Notice from '../../ui/Notice';
import Disclosure from '../../ui/Disclosure';
import LoadingFeedback from '../../ui/LoadingFeedback';
import ClusterFiles from './ClusterFiles';
import ClusterQueueSettings from './ClusterQueueSettings';
import ClusterEnvironmentEditor from './ClusterEnvironmentEditor';
import {editEnvironmentRow,makeEnvironmentDraft,readEnvironmentText,writableEnvironment,type ClusterEnvironmentDraft} from './cluster-environment-draft';
import type {SshAuthenticationRequest} from './SshConnectionGuide';
import QueueChoices from "../compute/QueueChoices";
import {useEffect,useRef,useState} from 'react';
import {Server,Save,Sparkles,RefreshCw,Eye,EyeOff,Terminal} from 'lucide-react';
import {api} from '../../api/worker';
import {ObservedRead,type ReadObservation} from '../../api/observed-read.mjs';
import {invoke} from '../../api/studio';
import {type Project,type ExistingSshReference} from '../../../contracts/dto/compute';
import {type Settings} from '../../../contracts/dto/settings';
import {type ClusterRun} from '../../../contracts/dto/runs';
import {t} from "../../ui/i18n";
import Tooltip from "../../ui/Tooltip";
import {StatusBadge,statusLabel} from "../../ui/StatusBadge";
import ActionBar from '../../ui/ActionBar';
import {ClusterObservationStatus,observationDelay,usePageVisibility} from './cluster-observation';
import {clusterObservationTime,clusterReadiness,latestClusterObservation,type ClusterConnectionCheck,type ClusterProbe,type ClusterSshTest} from './cluster-readiness';
import './cluster.css';

function useClusterMonitor(source:string,generation:number,enabled:boolean){
 const [last,setLast]=useState<{source:string;state:ReadObservation<ClusterRun[]>}|null>(null);
 const monitor=useRef<ObservedRead<ClusterRun[]>|null>(null),target=useRef({source,generation,enabled});
 if(target.current.source!==source||target.current.generation!==generation||target.current.enabled!==enabled)target.current={source,generation,enabled};
 const expected=target.current;
 useEffect(()=>{
  if(!enabled)return;
  const reader=new ObservedRead(async()=>{
   if(target.current!==expected)throw Error('cluster_source_changed');
   const rows=await api<ClusterRun[]>('GET','/api/cluster-runs');
   if(!Array.isArray(rows))throw Error('invalid_cluster_run_list');
   return rows;
  },state=>{
   if(target.current!==expected)return;
   setLast(previous=>{
    const cached=previous?.source===source?previous.state:null;
    return {source,state:{...state,value:state.value??cached?.value??null,observedAt:state.observedAt??cached?.observedAt??null,
     error:state.value||state.error?state.error:cached?.error??null}};
   });
  },{delay:observationDelay});
  monitor.current=reader;
  reader.setConnected(true);
  return()=>{reader.dispose();if(monitor.current===reader)monitor.current=null;};
 },[source,generation,enabled]);
 return {state:last?.source===source?last.state:null,refresh:()=>target.current===expected?monitor.current?.refresh():undefined};
}

const connectionFields=(p:any)=>({host:p.host,username:p.username,port:Number(p.port),identity_file:p.identity_file||'',ssh_client:p.ssh_client,auth_mode:p.auth_mode||'key',proxy_jump:p.proxy_jump||[],via:p.via||[]});
function formSnapshot(value:any,environment:any,via:string,readRoots:string){const {probe,connection_check,...rest}=value;return JSON.stringify({...rest,port:Number(value.port),environment,via:via.split('\n').map(v=>v.trim()).filter(Boolean),read_roots:readRoots.split('\n').map(v=>v.trim()).filter(Boolean)});}
const controlledJumpsValid=(p:any)=>p.auth_mode!=='interactive'||Array.isArray(p.proxy_jump)&&p.proxy_jump.length<=8&&p.proxy_jump.every((value:any)=>{if(typeof value!=='string'||!/^([A-Za-z_][A-Za-z0-9_.-]{0,63})@(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9][A-Za-z0-9.-]{0,255}):[0-9]{1,5}$/.test(value))return false;try{const parsed=new URL('ssh://'+value);return Number(parsed.port)>=1&&Number(parsed.port)<=65535;}catch{return false;}});
function connectionScopeKey(value:any,via:string,projectId:string|undefined,worker:boolean,version:unknown){return JSON.stringify([projectId,value.id,value.version,value.scheduler,worker,version,connectionFields({...value,via:via.split('\n').map(v=>v.trim()).filter(Boolean)})]);}
function safeProbeSummary(probe:any){const status=(v:unknown)=>['passed','failed','not_run','blocked','mismatch','unavailable','unknown','needs_human_auth'].includes(String(v))?v:'not_run',scheduler=(v:unknown)=>['lsf','slurm'].includes(String(v))?v:null;return {selected_scheduler:scheduler(probe?.selected_scheduler),detected_schedulers:Array.isArray(probe?.detected_schedulers)?probe.detected_schedulers.filter((v:unknown)=>scheduler(v)):[],ssh_status:status(probe?.ssh_status),scheduler_status:status(probe?.scheduler_status),queue_status:status(probe?.queue_status),visible_queue_count:Array.isArray(probe?.queues)?new Set(probe.queues.filter((v:unknown)=>typeof v==='string')).size:null};}
const needsHumanAuth=(error:unknown)=>String(error).includes('needs_human_auth');
const resourceLimits=['cpus','gpus','memory_mb'] as const;
const readinessLinks=[
 ['ssh','connection','SSH 认证'],['scheduler','environment','调度器探测'],
 ['queues','queues','队列策略'],['science','science','科学环境']
] as const;
const readinessLabels={unknown:'未知',configured:'已配置',verified:'已验证',stale:'需要重新检查',expired:'已过期',failed:'检查失败'} as const;
const blank={auth_mode:'key',proxy_jump:[] as string[],name:'SSH 集群',scheduler:'lsf',host:'',username:'',target:'',port:22,identity_file:'',ssh_client:'/mnt/c/Windows/System32/OpenSSH/ssh.exe',via:[],remote_root:'~/.gpu-sampling-studio/runs',queue:'',activation:'',environment:{executables:{python:'/usr/bin/python3'},repositories:{},variables:{}},limits:{cpus:64,gpus:8,memory_mb:262144}};
export default function ClusterPage({worker,workerGeneration=0,sourceId='',visible=true,project,settings,onError,onRefresh,onAgent,onRun,onTerminal,onConnectCompute,onAuthenticate,serviceVersion,selectedClusterId,draft,onQueueTest}:{onQueueTest?:(text:string)=>void|Promise<void>;selectedClusterId?:string;serviceVersion?:'current'|'different'|'unconfirmed';onAuthenticate:(request:SshAuthenticationRequest)=>void;onConnectCompute:()=>Promise<unknown>;onTerminal:(id:string,mode:'interactive'|'key',version:number)=>void;worker:boolean;workerGeneration?:number;sourceId?:string;visible?:boolean;project?:Project;settings:Settings;onError:(e:unknown)=>void;onRefresh:()=>void;onAgent:(text:string)=>void;onRun:(id:string)=>void;draft?:any}){
 const [readRoots,setReadRoots]=useState('');
 const operation=useRef(false),[busyLabel,setBusyLabel]=useState('');
 function beginOperation(label:string){if(operation.current)return false;operation.current=true;setBusyLabel(label);setBusy(true);return true;}
 function finishOperation(){operation.current=false;if(mounted.current)setBusy(false);}
 const [profiles,setProfiles]=useState<any[]>([]),[existing,setExisting]=useState<ExistingSshReference[]>([]),[value,setValue]=useState<any>(blank),[environment,setEnvironment]=useState(()=>makeEnvironmentDraft(blank.environment)),[via,setVia]=useState(''),[revealed,setRevealed]=useState<string|null>(null),[busy,setBusy]=useState(false),[probe,setProbe]=useState<ClusterProbe|null>(null),[tab,setTab]=useState('connection'),[notice,setNotice]=useState(''),[skillSource,setSkillSource]=useState('');
 const [queuesVisited,setQueuesVisited]=useState(false),[queueValid,setQueueValid]=useState(true),[savedQueueOptIn,setSavedQueueOptIn]=useState(false);
 const environmentEdited=useRef(false);
 const mounted=useRef(false);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;profileRequest.current++;};},[]);
 const [savedForm,setSavedForm]=useState(''),[loadingProfile,setLoadingProfile]=useState(false);const profileRequest=useRef(0),profilePending=useRef(false),savedProfileSource=useRef('');
 const source=sourceId||`generation:${workerGeneration}`;
 const workerContext=useRef({source,worker,workerGeneration});
 if(workerContext.current.source!==source||workerContext.current.worker!==worker||workerContext.current.workerGeneration!==workerGeneration)workerContext.current={source,worker,workerGeneration};
 const listedWorker=useRef<typeof workerContext.current|null>(null);
 const shown=usePageVisibility(),monitor=useClusterMonitor(source,workerGeneration,worker&&visible&&shown&&tab==='monitor');
 const profileListRequest=useRef(0),initialSelection=useRef(false),pendingSelection=useRef(selectedClusterId);
 pendingSelection.current=selectedClusterId;
 const currentScope=useRef({projectId:project?.id,clusterId:value.id,version:value.version});currentScope.current={projectId:project?.id,clusterId:value.id,version:value.version};
 const observationRequest=useRef(0),connectionEpoch=useRef(0),connectionScope=useRef(''),probeScope=useRef('');const currentConnectionScope=(profile:any,route:string)=>JSON.stringify([source,workerGeneration,connectionScopeKey(profile,route,project?.id,worker,serviceVersion)]);const scopeKey=currentConnectionScope(value,via);if(connectionScope.current!==scopeKey){connectionScope.current=scopeKey;connectionEpoch.current++;}
 const receiptOwner=JSON.stringify([source,value.id,value.version]);
 const privateContext=JSON.stringify([receiptOwner,workerGeneration]);
 const show=visible&&tab==='connection'&&revealed===privateContext;
 const [sshTest,setSshTest]=useState<ClusterSshTest|null>(null);
 const [unconfirmedProbe,setUnconfirmedProbe]=useState<{scope:string;startedAt:number;baseline:number}|null>(null);
 const listedProfile=listedWorker.current===workerContext.current?profiles.find(profile=>profile.id===value.id):undefined;
 const savedCurrent=worker&&!loadingProfile&&savedProfileSource.current===source&&!!listedProfile&&listedProfile.version===value.version;
 const listedReceipt=savedCurrent?listedProfile:undefined;
 const environmentValue=writableEnvironment(environment);
 const formScope=useRef('');formScope.current=JSON.stringify([formSnapshot(value,environment.text,via,readRoots),environment.rowIssue?environment.rows:null]);
 const importBlocked=!!value.import_review?.requires_review;
 const needsWorkerUpdate=(value.auth_mode==='interactive'||value.proxy_jump?.length>0||value.queue_targets!==undefined)&&serviceVersion!=='current';
 const formDirty=!value.id||!environmentValue||formSnapshot(value,environmentValue,via,readRoots)!==savedForm;
 const savedCheck=latestClusterObservation<ClusterConnectionCheck>(value.connection_check,listedReceipt?.connection_check);
 const recentProbe=latestClusterObservation<ClusterProbe>(probe,listedReceipt?.probe);
 const checkTime=clusterObservationTime(savedCheck),probeTime=clusterObservationTime(recentProbe);
 const checkMatches=savedCurrent&&!formDirty&&savedCheck?.version===value.version;
 const probeMatches=savedCurrent&&!formDirty&&(recentProbe!==probe||probeScope.current===scopeKey);
 const failedAt=checkMatches&&savedCheck?.status==='failed'&&(!probeMatches||(probeTime??0)<=(checkTime??0))?checkTime:undefined;
 const recordedProbeRemoved=listedReceipt?.probe===null&&(clusterObservationTime(listedReceipt.connection_check)??0)>(probeTime??0);
 const attempt=unconfirmedProbe?.scope===scopeKey&&!formDirty?unconfirmedProbe:null;
 const probeUnconfirmed=!!attempt&&Math.max(failedAt??0,probeMatches?probeTime??0:0)<=attempt.baseline;
 const currentProbe=probeMatches&&!probeUnconfirmed&&!failedAt&&!recordedProbeRemoved?recentProbe:null;
 const testMatches=sshTest?.scope===scopeKey&&!loadingProfile&&sshTest.observedAt>=(failedAt??0)&&
  (!probeUnconfirmed||sshTest.observedAt>attempt.startedAt);
 const now=Date.now();
 const [,setReadinessTime]=useState(0);
 const scienceEditor=useRef<HTMLDivElement>(null);
 const scienceTab=tab==='environment'||tab==='science';
 const configuredPython=(environmentValue?.executables as {python?:unknown}|undefined)?.python;
 const readiness=clusterReadiness({profile:value,project,savedCurrent,formDirty,sshTest:sshTest?.owner===receiptOwner?sshTest:null,
  sshTestCurrent:testMatches,probe:recentProbe,probeCurrent:!!currentProbe,
  check:savedCheck,checkCurrent:checkMatches&&(!probeUnconfirmed||(checkTime??0)>attempt.baseline),
  environmentConfigured:typeof configuredPython==='string'&&!!configuredPython.trim()&&(!!value.id||environmentEdited.current||configuredPython!==blank.environment.executables.python),now});
 const expiry=Math.min(readiness.ssh.expiresAt??Infinity,readiness.scheduler.expiresAt??Infinity);
 useEffect(()=>{
  if(!visible||!Number.isFinite(expiry))return;
  const timer=setTimeout(()=>setReadinessTime(Date.now()),Math.max(0,Math.ceil(expiry-Date.now())));
  return()=>clearTimeout(timer);
 },[expiry,visible]);
 useEffect(()=>{if(tab==='science')scienceEditor.current?.focus();},[tab]);
 function selectTab(next:string){
  if(next==='queues')setQueuesVisited(true);
  if(next!=='connection')setRevealed(null);
  if(next==='science'&&tab===next)scienceEditor.current?.focus();
  setTab(next);
 }
 function authenticate(){if(importBlocked)return;if(!controlledJumpsValid(value)){setNotice(t('受控交互跳板须逐跳填写 用户@主机:端口；IPv6 主机使用方括号。历史密钥别名保持原语义。'));return;}if(needsWorkerUpdate){setNotice(t('此连接方式需要按原来源更新作业服务；不会自动更新或改用其它连接。'));return;}if(profilePending.current||formDirty){setNotice(t('连接有未保存修改；请先保存连接或恢复已保存配置。'));return;}onAuthenticate({owner:null,clusterId:value.id,version:value.version,expected:connectionFields(value)});}
 function connectionError(error:unknown){if(String(error).includes('needs_worker_update')){setNotice(t('此连接方式需要按原来源更新作业服务；不会自动更新或改用其它连接。'));}else if(needsHumanAuth(error)){setNotice(t('需要人工认证；请打开私有认证界面，现有作业不会重提。'));}else onError(error);}
 function newProfile(){profileRequest.current++;profilePending.current=false;environmentEdited.current=false;setRevealed(null);setSshTest(null);setLoadingProfile(false);setQueueValid(true);setSavedQueueOptIn(false);setValue(blank);setEnvironment(makeEnvironmentDraft(blank.environment));setVia('');setReadRoots('');setProbe(null);setNotice('');setSkillSource('');}
 function patch(v:any){setValue((old:any)=>({...old,...v}));setNotice('');}
 function editEnvironment(edit:(previous:ClusterEnvironmentDraft)=>ClusterEnvironmentDraft){
  if(operation.current||profilePending.current)return;
  environmentEdited.current=true;
  setEnvironment(edit);
  setNotice('');
 }
 async function refreshProfiles(selectInitial=false,relevant=()=>true,report=onError){
  const expected=workerContext.current,sequence=++profileListRequest.current,profileTicket=profileRequest.current;
  if(!expected.worker)return;
  const current=()=>mounted.current&&workerContext.current===expected&&profileListRequest.current===sequence&&relevant();
  try{
   const rows=await api<any[]>('GET','/api/clusters');
   if(!current())return;
   if(!Array.isArray(rows))throw Error('invalid_cluster_profile_list');
   listedWorker.current=expected;setProfiles(rows);
   if(!selectInitial||initialSelection.current||profileRequest.current!==profileTicket)return;
   initialSelection.current=true;
   const wanted=pendingSelection.current||rows[0]?.id;
   if(wanted&&!value.host&&!environmentEdited.current){
    if(rows.some(item=>item.id===wanted))void load(wanted);
    else setNotice(t('原集群连接不在当前服务中；不会改选其它连接。'));
   }
  }catch(error){if(current())report(error);}
 }
 useEffect(()=>{let active=true;void invoke<ExistingSshReference[]>('ssh.existing').then(value=>{if(active)setExisting(value);}).catch(error=>{if(active)onError(error);});return()=>{active=false;};},[]);
 useEffect(()=>{
  profileRequest.current++;profilePending.current=false;setLoadingProfile(false);setRevealed(null);
  if(worker)void refreshProfiles(true);
 },[worker,source,workerGeneration]);
 useEffect(()=>{if(!selectedClusterId||!worker||!initialSelection.current)return;void load(selectedClusterId);},[selectedClusterId]);
 useEffect(()=>{if(!draft||!worker)return;const expected=workerContext.current,ticket=++profileRequest.current,current=()=>mounted.current&&workerContext.current===expected&&ticket===profileRequest.current;void api('POST','/api/cluster/profile',{cluster_id:draft.cluster_id}).then(p=>{if(!current())return;if(p?.id!==draft.cluster_id)throw Error('invalid_cluster_profile');const v={...p,...draft.proposal,environment:draft.proposal.environment||p.environment};setValue(fields(v));setEnvironment(makeEnvironmentDraft(v.environment));setVia((v.via||[]).join('\n'));setProbe(null);selectTab('skill');setNotice(t('Agent 已提出配置草稿；保存后才生效'));}).catch(error=>{if(current())onError(error);});},[draft?.id,worker,source,workerGeneration]);
 function fields(p:any){const parts=(p.target||'').split('@');return {...p,auth_mode:p.auth_mode||'key',proxy_jump:p.proxy_jump||[],identity_file:p.identity_file||'',read_roots:p.read_roots||[],host:p.host||parts.at(-1)||'',username:p.username??(parts.length===2?parts[0]:'')};}
 async function load(id:string){
  const expected=workerContext.current;
  if(!expected.worker)return;
  const ticket=++profileRequest.current,current=()=>mounted.current&&expected===workerContext.current&&ticket===profileRequest.current;
  profilePending.current=true;setLoadingProfile(true);setRevealed(null);
  try{
   const p=await api('POST','/api/cluster/profile',{cluster_id:id});
   if(!current())return;
   if(p?.id!==id)throw Error('invalid_cluster_profile');
   const v=fields(p),route=(p.via||[]).join('\n'),roots=(p.read_roots||[]).join('\n');
   savedProfileSource.current=expected.source;
   environmentEdited.current=false;
   setQueueValid(true);setSavedQueueOptIn(Object.hasOwn(p,'queue_targets'));
   setSavedForm(formSnapshot(v,p.environment,route,roots));setValue(v);setEnvironment(makeEnvironmentDraft(p.environment));setVia(route);setReadRoots(roots);
   setProbe(p.probe??null);probeScope.current=currentConnectionScope(v,route);setNotice('');
  }catch(e){if(current())onError(e);}
  finally{if(current()){profilePending.current=false;setLoadingProfile(false);}}
 }
 async function importExisting(ref:string){const ticket=++profileRequest.current;profilePending.current=true;setLoadingProfile(true);try{const p=await invoke('ssh.import',{ref});if(!mounted.current||ticket!==profileRequest.current||p?.cancelled)return;environmentEdited.current=true;setRevealed(null);setSshTest(null);setQueueValid(true);setSavedQueueOptIn(false);setValue(fields(p));setEnvironment(makeEnvironmentDraft(p.environment));setVia((p.via||[]).join('\n'));setReadRoots('');setProbe(null);setSkillSource('');selectTab('connection');setNotice(t('连接仅填入表单，尚未保存或授权'));}catch(e){if(mounted.current&&ticket===profileRequest.current)onError(e);}finally{if(mounted.current&&ticket===profileRequest.current){profilePending.current=false;setLoadingProfile(false);}}}
 async function save(){
  if(operation.current||!queueValid||importBlocked)return;
  const missingLimit=resourceLimits.find(key=>value.limits[key]==null);
  if(missingLimit){selectTab('skill');setNotice(t('请填写资源上限。')+' · '+missingLimit);return;}
  if(!environmentValue){setNotice(t('修正科学环境草稿后再保存。'));return;}
  if(!controlledJumpsValid(value)){setNotice(t('受控交互跳板须逐跳填写 用户@主机:端口；IPv6 主机使用方括号。历史密钥别名保持原语义。'));return;}if(needsWorkerUpdate){setNotice(t('此连接方式需要按原来源更新作业服务；不会自动更新或改用其它连接。'));return;}const expected=workerContext.current,ticket=profileRequest.current,wanted=JSON.stringify(currentScope.current),current=()=>mounted.current&&expected===workerContext.current&&ticket===profileRequest.current&&wanted===JSON.stringify(currentScope.current);if(!beginOperation(t('正在保存连接…')))return;try{const saved=await api('POST','/api/clusters',{...value,port:Number(value.port),environment:environmentValue,read_roots:readRoots.split('\n').map(v=>v.trim()).filter(Boolean),via:via.split('\n').map(v=>v.trim()).filter(Boolean)});if(!current())return;const loadingTicket=profileRequest.current+1;await load(saved.id);if(!mounted.current||expected!==workerContext.current||profileRequest.current!==loadingTicket)return;setNotice(t('连接已保存；项目授权未改变。'));onRefresh();await refreshProfiles();}catch(e){if(current())onError(e);}finally{finishOperation();}}
 async function grant(){if(operation.current||!project||!value.id||formDirty)return;const ticket=profileRequest.current,wanted={projectId:project.id,clusterId:value.id,version:value.version};if(!beginOperation(t('正在保存项目授权…')))return;try{const current=(await api<Project[]>('GET','/api/projects')).find(p=>p.id===wanted.projectId);if(ticket!==profileRequest.current||profilePending.current||!current||currentScope.current.projectId!==wanted.projectId||currentScope.current.clusterId!==wanted.clusterId||currentScope.current.version!==wanted.version||!mounted.current)return;await api('POST','/api/projects',{...current,policy:{...current.policy,clusters:[...new Set([...(current.policy.clusters||[]),wanted.clusterId])]}});setNotice(t('当前项目已获准使用此连接；其它授权保持原样。'));onRefresh();}catch(e){onError(String(e).includes('project_edit_conflict')?new Error(t('项目记录已变化，请关闭后重新打开并检查最新授权。')):e);}finally{finishOperation();}}
 async function testSsh(){
  if(operation.current||loadingProfile||importBlocked||!worker||!value.host||!value.username||!queueValid)return;
  if(needsWorkerUpdate){setNotice(t('此连接方式需要按原来源更新作业服务；不会自动更新或改用其它连接。'));return;}
  if(value.auth_mode==='interactive'&&formDirty){setNotice(t('连接有未保存修改；请先保存连接或恢复已保存配置。'));return;}
  const request=++observationRequest.current,ticket=profileRequest.current,epoch=connectionEpoch.current,wanted=connectionScope.current;
  const current=()=>mounted.current&&request===observationRequest.current&&ticket===profileRequest.current&&epoch===connectionEpoch.current&&wanted===connectionScope.current;
  if(!beginOperation(t('正在测试 SSH 连接…')))return;
  try{
   const result=await api('POST','/api/cluster/test',{connection:{...value,port:Number(value.port),via:via.split('\n').map(v=>v.trim()).filter(Boolean)}});
   if(!current())return;
   const passed=result.status==='passed'&&result.username_matches!==false;
   setSshTest({owner:receiptOwner,scope:wanted,status:passed?'passed':'failed',observedAt:Date.now()});
   setNotice(t(passed?'SSH 连接验证通过，远程用户匹配':'SSH 连接验证未通过'));
  }catch(e){
   if(current()){
    setSshTest({owner:receiptOwner,scope:wanted,status:needsHumanAuth(e)?'failed':'unknown',observedAt:Date.now()});
    connectionError(e);
   }
  }finally{finishOperation();}
 }
 async function detect(){
  if(operation.current||importBlocked)return;
  if(needsWorkerUpdate){setNotice(t('此连接方式需要按原来源更新作业服务；不会自动更新或改用其它连接。'));return;}
  if(loadingProfile||formDirty){setNotice(t('连接有未保存修改；请先保存连接或恢复已保存配置。'));return;}
  const request=++observationRequest.current,ticket=profileRequest.current,epoch=connectionEpoch.current,wanted=connectionScope.current,form=formScope.current;
  const current=()=>mounted.current&&request===observationRequest.current&&ticket===profileRequest.current&&epoch===connectionEpoch.current&&wanted===connectionScope.current&&form===formScope.current;
  const startedAt=Date.now(),baseline=Math.max(checkTime??0,probeTime??0);
  if(!beginOperation(t('正在检查连接与调度器…')))return;
  try{
   const result=await api<ClusterProbe>('POST','/api/cluster/probe',{cluster_id:value.id});
   if(!current())return;
   await refreshProfiles(false,current);
   if(!current())return;
   setProbe(result);probeScope.current=wanted;setUnconfirmedProbe(null);
   setNotice(t('探测来自登录节点；计算节点验证在作业中执行'));
  }catch(e){
   if(!current())return;
   setUnconfirmedProbe({scope:wanted,startedAt,baseline});
   void refreshProfiles(false,current,()=>{});
   connectionError(e);
  }
  finally{finishOperation();}
 }

 const observationLabel=(status='not_run')=>statusLabel(status);
 const environmentEditor=<ClusterEnvironmentEditor draft={environment} disabled={busy||loadingProfile}
  onRow={(section,edit)=>editEnvironment(previous=>editEnvironmentRow(previous,section,edit))}
  onText={text=>editEnvironment(previous=>readEnvironmentText(previous,text))}/>;
 const masked=<span className="cluster-private-mask"><span aria-hidden="true">••••••</span><small>{t('已隐藏')}</small></span>;
 return <div className="page cluster-page" data-testid="cluster-settings">
 <div className="page-heading"><h1>{t('集群连接与托管')}</h1><Server size={23} aria-hidden="true"/></div>
 <LoadingFeedback busy={busy||loadingProfile} label={loadingProfile?t('正在读取连接配置…'):busyLabel}/>
 {!worker&&<Button variant="primary"  data-guide-target="cluster-connect-worker" onClick={()=>void onConnectCompute().catch(onError)}>{t('连接 WSL 作业服务')}</Button>}
 {needsWorkerUpdate&&<Notice compact severity="warning"><p>{t('此连接方式需要按原来源更新作业服务；不会自动更新或改用其它连接。')}</p><Button  disabled={busy||loadingProfile} onClick={()=>void onConnectCompute().catch(onError)}>{t('按原来源更新作业服务')}</Button></Notice>}
 <div className="cluster-selection">
  <div className="cluster-selection-header"><div className="cluster-selection-fields">
   <select data-guide-target={profiles.length?'cluster-profile':undefined} aria-label={t('集群配置')} value={value.id||''} onChange={e=>e.target.value?void load(e.target.value):newProfile()}><option value="">{t('新连接')}</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name} · {p.scheduler} · v{p.version}</option>)}</select>
   <select aria-label={t('导入本机已有连接')} value="" onChange={e=>{if(e.target.value)void importExisting(e.target.value);}}><option value="">{t('导入本机已有连接')}</option>{existing.map(e=><option key={e.ref} value={e.ref}>{e.source?e.source+' · ':''}{e.label}</option>)}</select>
  </div>
  <Button variant="icon" size="sm" tooltip={t('刷新连接列表')} type="button"  aria-label={t('刷新连接列表')}  disabled={!worker||loadingProfile} onClick={()=>void refreshProfiles(true)}><RefreshCw size={16} aria-hidden="true"/></Button>
  </div>
  {value.id&&<div className="cluster-selection-actions">
   <Button  data-testid="shared-ssh-interactive" disabled={loadingProfile||busy||formDirty||importBlocked||!worker} onClick={()=>onTerminal(value.id,'interactive',value.version)}><Terminal size={15}/>{t('交互式登录')}</Button>
   <Button  data-testid="shared-ssh-key" disabled={loadingProfile||busy||formDirty||importBlocked||!worker} onClick={()=>onTerminal(value.id,'key',value.version)}>{t('密钥自动登录')}</Button>
   {project&&<Button  onClick={()=>onAgent(t('为当前项目 {project} 准备集群计算任务，cluster_id={cluster}，scheduler={scheduler}。先 present_task 展示流程和科学参数，询问缺失输入文件和引擎条件；prepare_cluster_run 只准备本机快照与批处理脚本，停下等待我审阅提交。').replace('{project}',project.id).replace('{cluster}',value.id).replace('{scheduler}',value.scheduler))}><Sparkles size={15}/>{t('让 Agent 准备集群任务')}</Button>}
  </div>}
 </div>
 <nav className="cluster-readiness" aria-label={t('集群就绪状态')} data-testid="cluster-connection-health">
  {readinessLinks.map(([key,destination,label])=>{
   const {state,scope,observedAt}=readiness[key],time=observedAt==null?null:new Date(observedAt);
   return <button key={key} type="button" data-testid={'cluster-ready-'+key} data-state={state} aria-current={tab===destination?'location':undefined} onClick={()=>selectTab(destination)}>
    <span className="cluster-readiness-title">{t(label)}</span>
    <strong>{t(key==='queues'&&state==='verified'?'已批准':readinessLabels[state])}</strong>
    <small>{t(scope)}{key==='queues'&&savedCurrent&&project&&value.queue_targets!==undefined&&value.version?' v'+value.version:null}</small>
    {time&&<time dateTime={time.toISOString()}>{time.toLocaleString()}</time>}
   </button>;
  })}
 </nav>
 {failedAt&&<Notice compact   data-testid="cluster-saved-check-failed">{t('最近保存的集群连接检查失败。')}{' '}
  <time dateTime={new Date(failedAt).toISOString()}>{new Date(failedAt).toLocaleString()}</time></Notice>}
 {probeUnconfirmed&&<Notice compact   data-testid="cluster-probe-unconfirmed">{t('本次集群探测结果未确认。上次观测保留供参考。')}</Notice>}
 {importBlocked&&<Notice compact  >{t('导入来源包含尚未支持的路由或认证引用；请手动核对连接，暂不能测试或保存。')}</Notice>}
 <section className="cluster-observation" data-testid="cluster-current-observation">
  {tab==='connection'&&<div>{value.identity_file?t('使用显式密钥引用'):<Tooltip content={t('使用 SSH 客户端已有默认认证；未指定密钥不代表没有密钥。')}>{t('使用默认认证')}</Tooltip>}</div>}
  {scienceTab&&currentProbe&&<div>{t('队列观察')} · {observationLabel(currentProbe.queue_status)} · {Array.isArray(currentProbe.queues)?currentProbe.queues.length:'?'}{currentProbe.observed_at?' · '+new Date(currentProbe.observed_at*1000).toLocaleString():''}</div>}
  {value.id&&!scienceTab&&<Button  disabled={busy||loadingProfile||!worker} onClick={()=>void detect()}><RefreshCw size={15}/>{t('检查连接与调度器')}</Button>}
 </section>
 <div className="subtabs" aria-label={t('集群配置步骤')}>{[['connection','SSH 连接'],['environment','环境探测'],['queues','队列与环境']].map(([id,name])=>{
  const active=tab===id||id==='environment'&&scienceTab;
  return <button key={id} className={active?'active':''} aria-current={active?'step':undefined} onClick={()=>selectTab(id)}>{t(name)}</button>;
 })}</div><Disclosure className="settings-advanced" summary={<>{t('更多')}{['skill','files','monitor'].includes(tab)?' · '+t(({skill:'提交 Skill',files:'远程文件',monitor:'作业监视'} as Record<string,string>)[tab]):''}</>}><div className="button-row">{[['skill','提交 Skill'],['files','远程文件'],['monitor','作业监视']].map(([id,name])=><Button  key={id} aria-pressed={tab===id} onClick={()=>selectTab(id)}>{t(name)}</Button>)}</div></Disclosure>
 {tab==='connection'&&<section className="card cluster-connection-fields"><div className="form-row"><label>{t('连接名称')}<input value={value.name} onChange={e=>patch({name:e.target.value})}/></label><label>{t('调度系统')}<select value={value.scheduler} onChange={e=>patch({scheduler:e.target.value})}><option value="lsf">LSF</option><option value="slurm">Slurm</option></select></label></div>
 <div className="cluster-auth-fields">
  <label>{t('认证方式')}<select value={value.auth_mode||'key'} onChange={e=>patch({auth_mode:e.target.value})}><option value="key">{t('已有密钥 / SSH agent')}</option><option value="interactive">{t('WSL 私有交互认证（含二步验证）')}</option></select></label>
  <Button type="button"  data-guide-target={show?undefined:'cluster-host'} aria-expanded={show}
   onClick={()=>setRevealed(show?null:privateContext)}>{show?<EyeOff size={15}/>:<Eye size={15}/>} {t(show?'隐藏私有连接字段':'显示私有连接字段')}</Button>
 </div>

 <div className="form-row">
  <label>{t('SSH 主机')}{show?<input data-testid="ssh-host" data-guide-target="cluster-host" type="text" autoComplete="off" spellCheck={false}
   value={value.host} onChange={e=>patch({host:e.target.value})}/>:masked}</label>
  <label>{t('SSH 用户名')}{show?<input data-testid="ssh-username" type="text" autoComplete="off" spellCheck={false}
   value={value.username} onChange={e=>patch({username:e.target.value})}/>:masked}</label>
 </div>
 <Disclosure summary={<>{t('高级连接设置：客户端、密钥、端口与路由')}</>}>
 <div className="form-row"><label>{t('端口')}{show?<input data-testid="ssh-port" type="text" inputMode="numeric" autoComplete="off" spellCheck={false}
  value={value.port} onChange={e=>patch({port:e.target.value})}/>:masked}</label></div>
 <div className="cluster-private-key">
  <label>{t('密钥引用路径（不读取密钥内容）')}{show?<input type="text" autoComplete="off" spellCheck={false} value={value.identity_file}
   onChange={e=>patch({identity_file:e.target.value})}/>:masked}</label>
  <Button  onClick={()=>void invoke('file.choose').then(path=>path&&patch({identity_file:path})).catch(onError)}>{t('选择')}</Button>
 </div>
 <p>{t('必须显式填写远程用户名，不使用本机 Windows 用户名。旧连接会拆分 user@host，修改后保存新版本。')}</p>
 <label>{t('SSH 客户端路径')}<input value={value.ssh_client} onChange={e=>patch({ssh_client:e.target.value})}/></label>
 <label>{t('本地 ProxyJump · 每行一个跳板')}<textarea rows={2} value={(value.proxy_jump||[]).join('\n')} onChange={e=>patch({proxy_jump:e.target.value.split('\n').map(v=>v.trim()).filter(Boolean)})}/></label><small>{t('受控交互跳板须逐跳填写 用户@主机:端口；IPv6 主机使用方括号。历史密钥别名保持原语义。')}</small><label>{t('集群内部跳转 · 每行一个 Host')}<textarea rows={2} value={via} onChange={e=>setVia(e.target.value)} placeholder="login2"/></label><small>{t('历史密钥 / via 路由沿用现有客户端配置；AIMatterLab 不额外启用 agent forwarding，也不复制密钥。受控交互模式明确禁用 agent forwarding。')}</small>
 <label>{t('额外只读数据根目录 · 每行一个')}<textarea rows={2} value={readRoots} onChange={e=>setReadRoots(e.target.value)}/></label><label>{t('远程作业根目录')}<input value={value.remote_root} onChange={e=>patch({remote_root:e.target.value})}/></label></Disclosure><Button variant="primary" data-testid="ssh-test"  disabled={busy||loadingProfile||importBlocked||!worker||!value.host||!value.username||!queueValid} onClick={()=>void testSsh()}>{t('测试 SSH 连接')}</Button>{value.auth_mode==='interactive'&&<Disclosure summary={<>{t('私有认证与转发')}</>}><p>{t('二步验证使用已核对的 WSL OpenSSH 和私有终端；不会复制 Windows 私钥，也不会替换已有转发入口。')}</p><Notice compact announce={false} ><p>{t('人工认证需要所选 WSL 内的原生 OpenSSH。当前客户端：')} <code>{value.ssh_client}</code></p><Button  disabled={busy||loadingProfile||value.ssh_client==='/usr/bin/ssh'} onClick={()=>patch({ssh_client:'/usr/bin/ssh'})}>{t('选择 WSL OpenSSH（/usr/bin/ssh）')}</Button><p>{t('仅在你点击后修改表单，保存连接后生效；自定义客户端可在高级设置中填写。密钥引用必须属于所选 WSL，不会转换路径或复制 Windows 私钥。')}</p></Notice><Button  disabled={busy||loadingProfile||!worker||!value.id||formDirty||importBlocked} onClick={authenticate}>{t('打开私有认证')}</Button></Disclosure>}{formDirty&&value.id&&<Notice compact announce={false} >{t('连接有未保存修改；请先保存连接或恢复已保存配置。')} <Button  disabled={busy} onClick={()=>void load(value.id)}>{t('恢复已保存配置')}</Button></Notice>}</section>}
 {scienceTab&&<section className="card"><div className="button-row"><Button variant="primary"  disabled={busy||!value.id} onClick={()=>void detect()}><RefreshCw size={15}/>{t('只读探测')}</Button><Button  disabled={!value.id} onClick={()=>onAgent(t('协助配置集群 {id}。结合用户确认的队列和登记环境准备配置草稿，不提交作业或修改授权。探测能力摘要：{summary}').replace('{id}',value.id).replace('{summary}',JSON.stringify(safeProbeSummary(currentProbe))))}><Sparkles size={15}/>{t('让 Agent 协助配置')}</Button></div><p>{t('登录节点观察不代表计算节点 GPU、模型或 Bias 已通过验证。')}</p>{currentProbe?.selected_scheduler_match===false&&<Notice compact  ><span>{t('所选调度器与探测结果不同')}</span>{(currentProbe.detected_schedulers||[]).filter((scheduler:string)=>['lsf','slurm'].includes(scheduler)&&scheduler!==value.scheduler).map((scheduler:string)=><Button  key={scheduler} data-testid={'scheduler-draft-'+scheduler} disabled={busy||loadingProfile} onClick={()=>patch({scheduler})}>{t('改用探测到的调度器草稿')} · {scheduler}</Button>)}</Notice>}{currentProbe&&<Disclosure summary={<>{t('探测详情')}</>}><pre className="report">{JSON.stringify(currentProbe,null,2)}</pre></Disclosure>}
  <div className="cluster-science-environment" role="region" aria-label={t('科学环境')} ref={scienceEditor} tabIndex={-1}>{environmentEditor}</div>
 </section>}
 {queuesVisited&&<div hidden={tab!=='queues'}>{serviceVersion!=='current'&&!needsWorkerUpdate&&<Notice compact  ><span>{t('此连接方式需要按原来源更新作业服务；不会自动更新或改用其它连接。')}</span><Button  disabled={busy||loadingProfile} onClick={()=>void onConnectCompute().catch(onError)}>{t('按原来源更新作业服务')}</Button></Notice>}<ClusterQueueSettings key={[value.id,value.version,project?.id].join(':')} profile={value} project={project} worker={worker&&serviceVersion==='current'} busy={busy||loadingProfile} profileDirty={formDirty} visible={tab==='queues'} canCancelOptIn={!savedQueueOptIn} environmentText={environmentValue?environment.text:null} probe={currentProbe} onTargets={targets=>{setValue((old:any)=>{const {queue_targets,...rest}=old;return targets===undefined?rest:{...old,queue_targets:targets};});}} onValidity={setQueueValid} onRefresh={onRefresh} onError={onError} onQueueTest={onQueueTest}/></div>}
 {tab==='skill'&&<section className="card"><h3>{t('版本化集群提交 Skill')}</h3>{value.id&&project&&<Button  onClick={()=>void api('POST','/api/cluster/skill',{project_id:project.id,cluster_id:value.id}).then(r=>setSkillSource(r.source)).catch(onError)}>{t('查看注册的 SKILL.md')}</Button>}{skillSource&&<pre className="report">{skillSource}</pre>}<p>{t('Agent 可以提出修改；连接、授权及提交 Skill 必须在此审阅保存。作业绑定保存时的版本。')}</p><div className="form-row"><div className="queue-field"><label>{t('队列 / 分区')}<input aria-label={t('队列 / 分区')} value={value.queue||''} onChange={e=>patch({queue:e.target.value})}/></label><QueueChoices queues={currentProbe?.queues} value={value.queue||''} language={settings.language||'zh-CN'} onChange={queue=>patch({queue})}/></div>{resourceLimits.map(key=><label key={key}>{key}<input type="number" min={key==='gpus'?0:1} value={value.limits[key]??''} onChange={e=>patch({limits:{...value.limits,[key]:e.target.value===''?undefined:e.target.valueAsNumber}})}/></label>)}</div><label>{t('LSF 内存预留语义 · memory_mb 为合计')}<select value={value.lsf_memory_scope||'per_slot'} onChange={e=>patch({lsf_memory_scope:e.target.value})}><option value="per_slot">{t('按 CPU slot 预留（自动均分合计内存）')}</option><option value="per_job">{t('按整个作业预留')}</option></select></label><label>{t('Modules / 虚拟环境初始化 · Bash')}<textarea className="skill-script" rows={9} value={value.activation} onChange={e=>patch({activation:e.target.value})} placeholder="module load …"/></label><label>{t('提交 Skill 补充约定')}<textarea rows={4} value={value.notes||''} onChange={e=>patch({notes:e.target.value})}/></label>{environmentEditor}</section>}
 {tab==='files'&&<ClusterFiles key={[project?.id,value.id,value.version].join(':')} projectId={project?.id} clusterId={value.id} scope={JSON.stringify([project?.id,value.id,value.version,worker,serviceVersion,value.remote_root,readRoots])} roots={[value.remote_root,...readRoots.split('\n').filter(Boolean)]} enabled={worker&&!formDirty&&!loadingProfile&&!importBlocked} onError={onError}/>}
 {tab==='monitor'&&<section className="card" data-testid="cluster-monitor">
  <p>{t('提交后由集群调度器托管；关闭桌面不会停止作业。失联显示 unknown，重新连接核对作业身份，不重复提交。')}</p>
  <Button type="button"  disabled={!worker||monitor.state?.pending===true} onClick={()=>void monitor.refresh()}><RefreshCw size={15}/>{t('同步记录')}</Button>
  <ClusterObservationStatus connected={worker} observedAt={monitor.state?.observedAt} error={!!monitor.state?.error} paused={monitor.state?.paused}/>
  <LoadingFeedback busy={worker&&!monitor.state?.value&&!monitor.state?.error} label={t('正在同步记录…')}/>
  {monitor.state?.value?.filter(run=>!project||run.project_id===project.id).map(run=><button className="cluster-run-row" key={run.id} onClick={()=>{if(mounted.current&&workerContext.current.source===source)onRun(run.id);}}><span>{run.name}<small>{run.engine} · {run.cluster.scheduler}</small></span><StatusBadge status={run.status}/><span>{run.job_id||t('未提交')}</span></button>)}
 </section>}
 <ActionBar status={<span role="status">{notice}</span>}>
  {project&&<Button disabled={busy||loadingProfile||!worker||!value.id||formDirty} onClick={()=>void grant()}>{t('允许当前项目使用此连接')}</Button>}
  <Button variant="primary" disabled={busy||loadingProfile||importBlocked||!worker||!value.host||!value.username} loading={busy}
   disabledReason={!worker?t('请先连接作业服务。'):!value.host||!value.username?t('请填写主机和用户名。'):undefined}
   onClick={()=>void save()}><Save size={15}/>{t('保存连接')}</Button>
 </ActionBar>
 </div>;
}
