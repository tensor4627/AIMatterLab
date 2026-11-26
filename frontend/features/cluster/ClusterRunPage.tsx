import Button from '../../ui/Button';
import ActionBar from '../../ui/ActionBar';
import StatusBadge from '../../ui/StatusBadge';
import Notice from '../../ui/Notice';
import {useConfirm} from '../../ui/ConfirmDialog';
import {useEffect,useRef,useState} from 'react';
import {Play,Sparkles} from 'lucide-react';
import LoadingFeedback from '../../ui/LoadingFeedback';
import {api} from '../../api/worker';
import {ObservedRead} from '../../api/observed-read.mjs';
import type {ClusterRun} from '../../../contracts/dto/runs';
import {t} from '../../ui/i18n';
import {EvidenceSelection,evidencePreSelection,type EvidenceLineRange} from '../conversations/EvidenceSelection';
import ClusterResults from './ClusterResults';
import {ClusterObservationStatus,observationDelay,usePageVisibility} from './cluster-observation';
import './cluster.css';

type ClusterConnectionObservation=ClusterRun&{connection_action?:{kind:'authenticate_original_run';code:'needs_human_auth';runId:string}|null};
const terminalStatuses:readonly ClusterRun['status'][]=['succeeded','failed','cancelled'];
const cancellableStatuses:readonly ClusterRun['status'][]=['queued','running','unknown'];

function clusterReviewSpec(run:ClusterRun){
 const remote_inputs={...Object.fromEntries(run.snapshots.filter(asset=>asset.source_kind==='remote').map(asset=>[asset.name,asset.source])),...run.remote_inputs};
 const inputs=Object.fromEntries(run.snapshots.filter(asset=>!Object.hasOwn(remote_inputs,asset.name)).map(asset=>[asset.name,run.directory+'/simulation/'+asset.name]));
 return {name:run.name,engine:run.engine,project_id:run.project_id,cluster_id:run.cluster_id,max_seconds:run.max_seconds,resources:run.resources,parameters:run.parameters||{},inputs,remote_inputs};
}
type RunConnectionAction='auth'|'update';
type RunObservationTarget={scope:string;workerGeneration:number;connected:boolean};
function runConnectionAction(error:unknown):RunConnectionAction|null{
 const detail=String(error);
 if(detail.includes('needs_worker_update'))return 'update';
 if(detail.includes('needs_human_auth'))return 'auth';
 return null;
}

async function readClusterRun(id:string,current:()=>boolean,inspect=false){
 if(!current())throw Error('cluster_source_changed');
 const result=inspect
  ? await api<ClusterConnectionObservation>('POST','/api/cluster/status',{run_id:id})
  : await api<ClusterConnectionObservation>('POST','/api/cluster/observation',{run_id:id}).catch(async error=>{
   if(!current()||!/unknown route|not found|404|unsupported.*route/i.test(String(error)))throw error;
   const rows=await api<ClusterConnectionObservation[]>('GET','/api/cluster-runs');
   const prior=rows.find(row=>row.id===id);
   if(!prior)throw error;
   return prior;
  });
 if(result?.id!==id)throw Error(t('作业服务返回的记录与所选作业不一致。'));
 return result;
}

export default function ClusterRunPage({id,sourceId='',workerGeneration=0,connected=true,visible=true,readOnly=false,onError,onAgent,onOpenConnections}:{
 id:string;sourceId?:string;workerGeneration?:number;connected?:boolean;visible?:boolean;readOnly?:boolean;
 onError:(e:unknown)=>void;onAgent:(text:string)=>void;onOpenConnections?:(source:{runId:string})=>void;
}){
 const confirm=useConfirm(),askingAction=useRef(false);
 const source=sourceId||`generation:${workerGeneration}`;
 const scopeFor=(runId:string)=>JSON.stringify([source,runId]);
 const origin=scopeFor(id);
 const [revision,setRevision]=useState<{origin:string;id:string}|null>(null);
 const activeId=revision?.origin===origin?revision.id:id,scope=scopeFor(activeId);
 const [record,setRecord]=useState<{scope:string;target:RunObservationTarget;value:ClusterRun;at:number}|null>(null);
 const [failedRead,setFailedRead]=useState<{scope:string;paused:boolean}|null>(null);
 const [connection,setConnection]=useState<{scope:string;action:RunConnectionAction|null}|null>(null);
 const [output,setOutput]=useState<{scope:string;text:string}|null>(null);
 const [failedLog,setFailedLog]=useState('');
 const [editor,setEditor]=useState<{scope:string;text:string;editing:boolean}|null>(null);
 const [logEvidenceRange,setLogEvidenceRange]=useState<EvidenceLineRange|null>(null);

 const currentRecord=record?.scope===scope?record:null,run=currentRecord?.value;
 const failure=failedRead?.scope===scope?failedRead:null;
 const connectionAction=connection?.scope===scope?connection.action:null;
 const log=output?.scope===scope?output.text:'';
 const revised=editor?.scope===scope?editor.text:'',edit=editor?.scope===scope&&editor.editing;
 const canWrite=connected&&!readOnly;
 const writable=useRef(canWrite);writable.current=canWrite;
 const owner=useRef<RunObservationTarget>({scope,workerGeneration,connected}),mounted=useRef(false);
 if(owner.current.scope!==scope||owner.current.workerGeneration!==workerGeneration||owner.current.connected!==connected)owner.current={scope,workerGeneration,connected};
 const target=owner.current;
 const actionRevision=run?JSON.stringify([run.id,run.name,run.engine,run.cluster_id,run.status,run.job_id,run.cancellation,run.script,run.queue_target_snapshot,run.resources,run.snapshots,run.inputs,run.remote_inputs,run.parameters]):'';
 const latestAction=useRef({revision:actionRevision,visible,edit});latestAction.current={revision:actionRevision,visible,edit};
 const awaitingCurrent=!!currentRecord&&currentRecord.target!==target;
 const current=()=>mounted.current&&owner.current===target&&connected;
 const shown=usePageVisibility(),watching=visible&&shown,watch=useRef({watching});
 if(watch.current.watching!==watching)watch.current={watching};
 const inspection=useRef<typeof target|null>(null),operation=useRef<typeof target|null>(null);
 const [checking,setChecking]=useState<typeof target|null>(null);
 const [operationLabel,setOperationLabel]=useState<{target:typeof target;text:string}|null>(null);
 const readEpoch=useRef(0),[readCycle,setReadCycle]=useState(0);
 const inspecting=checking===target,busy=operationLabel?.target===target;
 function prioritizeExplicitRead(){setReadCycle(++readEpoch.current);}

 function accept(next:ClusterConnectionObservation,forScope=scope){
  setRecord({scope:forScope,target,value:next,at:Date.now()});
  setFailedRead(null);
  if(next.connection_action?.kind==='authenticate_original_run'&&next.connection_action.code==='needs_human_auth'&&next.connection_action.runId===next.id){
   setConnection({scope:forScope,action:'auth'});
  }else if(next.connection_action===null){
   setConnection({scope:forScope,action:null});
  }
  setEditor(previous=>previous?.scope===forScope?previous:{scope:forScope,text:JSON.stringify(clusterReviewSpec(next),null,2),editing:false});
 }
 function reportReadFailure(error:unknown,paused=false){
  setFailedRead({scope,paused});
  const action=runConnectionAction(error);
  if(action)setConnection({scope,action});
 }
 function reportActionError(error:unknown){
  const action=runConnectionAction(error);
  if(action)setConnection({scope,action});
  else onError(error);
 }

 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;inspection.current=null;operation.current=null;};},[]);
 useEffect(()=>{setLogEvidenceRange(null);},[scope]);
 useEffect(()=>{
  if(!connected||!watching||busy||inspecting||!awaitingCurrent&&run&&terminalStatuses.includes(run.status))return;
  const visibility=watch.current,epoch=readEpoch.current;
  const active=()=>current()&&watch.current===visibility&&readEpoch.current===epoch&&inspection.current!==target&&operation.current!==target;
  let accepted:ClusterConnectionObservation|null=null,seenFailures=0;
  const reader=new ObservedRead(()=>readClusterRun(activeId,active),state=>{
   if(!active())return;
   if(state.value&&state.value!==accepted){
    accepted=state.value;
    seenFailures=0;
    accept(state.value);
    if(terminalStatuses.includes(state.value.status))reader.setConnected(false);
   }
   if(state.error&&state.failures>seenFailures){
    seenFailures=state.failures;
    reportReadFailure(state.error,state.paused);
   }
  },{delay:observationDelay});
  reader.setConnected(true);
  return()=>reader.dispose();
 },[scope,workerGeneration,connected,watching,busy,inspecting,readCycle]);

 async function inspect(withLogs:boolean){
  if(!current()||inspection.current===target||operation.current===target)return;
  prioritizeExplicitRead();
  inspection.current=target;
  setChecking(target);
  const active=()=>current()&&inspection.current===target;
  try{
   const next=await readClusterRun(activeId,active,withLogs);
   if(!active())return;
   accept(next);
   if(withLogs&&next.job_id){
    try{
     const data=await api<{text:string}>('POST','/api/cluster/log',{run_id:activeId});
     if(!active())return;
     if(typeof data?.text!=='string')throw Error('invalid_cluster_log');
     setOutput({scope,text:data.text});
     setFailedLog('');
    }catch(error){
     if(!active())return;
     setFailedLog(scope);
     const action=runConnectionAction(error);
     if(action)setConnection({scope,action});
    }
   }
  }catch(error){if(active())reportReadFailure(error);}
  finally{if(inspection.current===target){inspection.current=null;setChecking(null);}}
 }

 async function perform(label:string,action:()=>Promise<ClusterRun>,revising=false){
  if(!current()||!writable.current||operation.current===target||askingAction.current)return;
  prioritizeExplicitRead();
  inspection.current=null;
  setChecking(null);
  operation.current=target;
  setOperationLabel({target,text:label});
  if(!revising)setConnection({scope,action:null});
  try{
   const next=await action();
   if(!current())return;
   if(!next?.id||!revising&&next.id!==activeId)throw Error(t('作业服务返回的记录与所选作业不一致。'));
   if(revising)setRevision({origin,id:next.id});
   accept(next,scopeFor(next.id));
  }catch(error){if(current())reportActionError(error);}
  finally{if(operation.current===target){operation.current=null;setOperationLabel(null);}}
 }
 async function requestAction(kind:'submit'|'cancel'){
  const submitting=kind==='submit';
  const canContinue=()=>current()&&writable.current&&latestAction.current.visible&&(!submitting||!latestAction.current.edit)&&latestAction.current.revision===actionRevision&&operation.current!==target;
  const statuses=submitting?['draft','ready']:cancellableStatuses;
  if(!run||!statuses.includes(run.status)||askingAction.current||!canContinue())return;
  const queue=run.queue_target_snapshot?.queue||run.resources?.queue;
  const location=[run.name,run.cluster_id,submitting?queue:run.job_id].filter(Boolean).join(' · ');
  askingAction.current=true;
  try{
   if(!await confirm(submitting?{title:t('提交到集群'),target:location,
    consequence:t('作业服务将上传输入快照并把此脚本提交给集群调度器。'),confirmLabel:t('提交作业'),tone:'danger',testId:'confirm-cluster-run-submit'}:{
    title:t('取消集群作业'),target:location,
    consequence:t('作业服务将核对原作业身份，再尝试向集群调度器发送取消请求。已写入的产物保留。'),confirmLabel:t('取消作业'),tone:'danger',testId:'confirm-cluster-run-cancel'}))return;
  }finally{askingAction.current=false;}
  if(!canContinue())return;
  const endpoint=submitting?'/api/cluster/submit':'/api/cluster/cancel';
  await perform(t(submitting?'正在提交到集群…':'正在取消并核对作业…'),()=>api<ClusterRun>('POST',endpoint,{run_id:activeId}));
 }
 function revise(){
  void perform(t('正在保存修订…'),async()=>{
   const value=JSON.parse(revised);
   const changes=Object.fromEntries(['name','engine','max_seconds','resources','inputs','remote_inputs','parameters'].filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
   return api<ClusterRun>('POST','/api/cluster/revise',{run_id:activeId,changes});
  },true);
 }

 const observed=<ClusterObservationStatus connected={connected} observedAt={currentRecord?.at} error={!!failure} paused={failure?.paused} awaitingCurrent={awaitingCurrent}/>;
 const recovery=connectionAction&&<Notice compact severity="warning">
  <p>{t(connectionAction==='update'?'此连接方式需要按原来源更新作业服务；不会自动更新或改用其它连接。':run?'需要人工认证；请打开私有认证界面，现有作业不会重提。':'需要核对原作业连接；作业状态仍未确认，不会重新提交。')}</p>
  {onOpenConnections&&<Button  onClick={()=>onOpenConnections({runId:activeId})}>{t('核对原作业连接')}</Button>}
 </Notice>;
 if(!run)return <div className="page">
  {observed}
  <LoadingFeedback busy={connected&&!failure&&!connectionAction} label={t('读取任务中…')}/>
  {connected&&failure&&<Button  disabled={inspecting} onClick={()=>void inspect(false)}>{t('重试')}</Button>}
  {recovery}
 </div>;
 return <div className="page cluster-review" data-testid="cluster-review"><div className="page-heading"><div><span className="eyebrow">{run.cluster.scheduler} · {run.engine}</span><h1>{run.name}</h1><p>{t('审阅运行参数与完整提交脚本。科学检查结果供参考。适用的执行检查须在计算节点通过，作业才会启动引擎。')}</p></div><span className="tag">{run.status}</span></div>
 {observed}
 {recovery}
 {run.cancellation&&['running','queued','unknown'].includes(run.status)&&<Notice compact   data-testid="cluster-cancellation-receipt">
  {t(run.cancellation.signal_sent===true?'撤销命令已送达，正在等待作业的最终状态。':run.cancellation.status==='requested'?'已记录撤销请求，正在核对原作业。':run.cancellation.signal_sent===false?'原作业身份尚未核实，本次撤销命令未发出。':'撤销命令的送达情况未知，请核对原作业。')}
 </Notice>}
 {readOnly&&<Notice compact   data-testid="run-readonly-observation">{t('运行记录可查看；提交、续算等操作需匹配原服务与权限。')}</Notice>}
 <LoadingFeedback busy={busy} label={operationLabel?.text||''}/>
 <ol className="run-flow">{['输入快照','审阅与资源检查','SSH 上传与提交','执行节点科学验证','计算与结果监控'].map(v=><li key={v}>{t(v)}</li>)}</ol>
 {run.queue_target_snapshot&&<section className="card resolved-queue-target" data-testid="resolved-queue-target"><strong>{run.queue_target_snapshot.queue} · {run.queue_target_snapshot.id}</strong><span>{t(run.queue_target_snapshot.usage_class==='owned'?'自有':run.queue_target_snapshot.usage_class==='paid'?'付费':'未知')} · {run.cluster_id} · v{run.queue_profile_version}</span><small>{t('环境')} · {Object.entries(run.queue_target_snapshot.environment.executables).map(([name,path])=>name+' '+path).join(' · ')}</small></section>}
 <section className="card">
  <h3>{t('运行参数')}</h3>
  {['draft','ready'].includes(run.status)&&<label className="check-label"><input type="checkbox" disabled={!canWrite} checked={edit} onChange={e=>{if(current()&&writable.current)setEditor({scope,text:revised,editing:e.target.checked});}}/>{t('修改参数并创建新快照')}</label>}
  <textarea rows={12} className="parameter-json" aria-label={t('运行参数')} readOnly={!canWrite||!edit||busy} value={revised} onChange={e=>setEditor({scope,text:e.target.value,editing:edit})}/>
 </section>
 <section className="card"><h3>{t('将执行的提交脚本')}</h3><pre className="batch-script">{run.script}</pre></section>
 <section className="card">
  <h3>{t('验证与监控')}</h3>
  <Button  disabled={!connected||inspecting||busy} onClick={()=>void inspect(true)}>{t('核对作业与日志')}</Button>
  <p>{t('输入验证')} · {run.validation.status} · {run.validation.scope}</p><p>{t('科学验证')} · {run.scientific_validation.status}</p><p>Job ID · {run.job_id||t('未提交')}</p>
  {failedLog===scope&&<Notice compact  >{t('日志连接暂不可用')}{log&&' · '+t('上次记录')}</Notice>}
  <pre className="console" onMouseUp={e=>setLogEvidenceRange(evidencePreSelection(e.currentTarget))}>{log||t('暂无运行日志')}</pre>{log&&<EvidenceSelection source={{kind:'log',runId:run.id,target:'cluster'}} text={log} range={logEvidenceRange}/>}
 </section>
 {edit&&<Button variant="primary"  disabled={!canWrite||busy} onClick={revise}>{t('保存修订并预览脚本')}</Button>}
 <ClusterResults key={scope} run={run} connected={connected} workerGeneration={workerGeneration} onError={onError}/>
 <ActionBar status={<StatusBadge status={run.status}/>}>
  <Button  onClick={()=>onAgent(t('检查集群任务 {id} 的已记录参数和日志。只读监控，不重提 unknown 任务。').replace('{id}',run.id))}><Sparkles size={15}/>{t('让 Agent 分析')}</Button>
  {['draft','ready'].includes(run.status)?<Button variant={edit?'secondary':'primary'} disabled={!canWrite||busy||edit} onClick={()=>void requestAction('submit')}><Play size={15}/>{t('审阅完成，提交到集群')}</Button>
   :cancellableStatuses.includes(run.status)?<Button disabled={!canWrite||busy} onClick={()=>void requestAction('cancel')}>{t('取消已核实作业')}</Button>:null}
 </ActionBar>
 </div>;
}
