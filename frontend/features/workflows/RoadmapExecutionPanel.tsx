import {useEffect,useRef,useState} from 'react';
import type {TypedInvoke} from '../../../contracts/dto/ipc';
import type {RoadmapExecution,RoadmapMissingTools,RoadmapPreview} from '../../../contracts/dto/roadmap-execution';
import {invoke} from '../../api/studio';
import {deploymentApi} from '../../api/deployment-client';
import {t} from '../../ui/i18n';
import type {ToolWorkflowFocus} from './useToolWorkflowNavigation';

const request:TypedInvoke=invoke;
const stateNames:Record<string,string>={pending:'等待输入',running:'运行中',submitted:'已提交',passed:'通过',failed:'失败',unknown:'待核对',blocked:'受阻',needs_review:'待人工验收',unavailable:'尚无产物',cancelled:'已取消'};
const stateText=(key:string)=>t(stateNames[key]||key);

type Props={taskId:string;revision:string;connected:boolean;disabled:boolean;configured:boolean;onRun:(id:string)=>void;focus?:ToolWorkflowFocus;
 nodes:{id:string;label:string}[];environments:{id:string;name:string}[];defaultEnvironment?:string;projectId?:string;cluster?:boolean;toolSetupRevision?:string;onMissingTool?:(tool:string)=>void;onMissingToolQuestion?:(tool?:string)=>void};
function Snapshot({review}:{review:RoadmapPreview}){
 const {snapshot}=review;
 return <div aria-label={t('执行快照')}><p>{snapshot.original_request}</p>
  <p>{t('计算项目')} {snapshot.target.project_id} · {snapshot.target.cluster_id||snapshot.target.environment_id} · {snapshot.target.max_seconds} s</p>
  {snapshot.workspace?.choice==='session'&&<p>{t('工作目录')} · <code dir="ltr">{snapshot.workspace.root}</code></p>}
  {snapshot.steps.map(node=><details key={node.id}><summary>{node.label} · {node.tool} · {node.version.version.slice(0,12)}</summary>
   <p>{t('工具版本')} · {node.version.version}</p>{node.registered_function&&<p>{node.registered_function.function_id} · {node.registered_function.package_version}</p>}
   <p>{t('计算环境')} · {node.environment.id} · {node.environment_sha256}</p>
   {node.target?.resources&&<p>{t('队列 / 分区')} · {node.target.resources.queue||node.target.resources.queue_target_id||t('调度器默认队列')}
    {node.target.resources.cpus!==undefined&&<> · {node.target.resources.cpus} CPU</>}{node.target.resources.gpus!==undefined&&<> · {node.target.resources.gpus} GPU</>}
    {node.target.resources.memory_mb!==undefined&&<> · {node.target.resources.memory_mb} MiB</>}{node.target.resources.qos&&<> · QoS {node.target.resources.qos}</>}{node.target.resources.account&&<> · {t('计费账号')} {node.target.resources.account}</>}</p>}
   <pre>{JSON.stringify(node.argv)}{'\n'}{JSON.stringify(node.parameters,null,2)}</pre>
   {node.native_controls&&<pre aria-label="run.in">{node.native_controls.join('\n')}</pre>}
   {Object.entries(node.inputs).map(([port,input])=><p key={port}>{port} ← {input.producer?input.producer.step_id+'.'+input.producer.port:snapshot.initial[input.resource]?.path} · {input.name}</p>)}
   {Object.entries(node.outputs).map(([port,output])=><p key={port}>{port} → {output.resource} · {output.name}</p>)}</details>)}
  {Object.values(snapshot.initial).map(input=><p key={input.resource}>{input.resource} · {input.path} · {input.sha256}</p>)}
  {snapshot.goals.map(goal=><div key={goal.id}><strong>{goal.label}</strong>{goal.requirements?.map((line,i)=><p key={i}>{line} · {goal.checks?.filter(c=>c.requirement===line).map(c=>c.fact+' '+c.op+' '+c.value).join(' / ')||t('待人工验收')}</p>)}</div>)}
  <p>SHA-256 · {review.snapshot_sha256}</p>
 </div>;
}
function FrozenSnapshot({taskId,id,reload}:{taskId:string;id:string;reload:number}){
 const [open,setOpen]=useState(false),[review,setReview]=useState<RoadmapPreview|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!open||review)return;
  let current=true;setError('');
  request('task.roadmap.snapshot',{taskId,executionId:id}).then(value=>{if(current)setReview(value);},e=>{if(current)setError(String(e.message||e));});
  return ()=>{current=false;};
 },[open,taskId,id,review,reload]);
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>{t('查看已冻结快照')}</summary>
  {error&&<p role="alert">{error}</p>}{review&&<Snapshot review={review}/>}</details>;
}
export default function RoadmapExecutionPanel({taskId,revision,connected,disabled,configured,onRun,focus,nodes,environments,defaultEnvironment,projectId,cluster=false,toolSetupRevision,onMissingTool,onMissingToolQuestion}:Props){
 const [open,setOpen]=useState(false),[review,setReview]=useState<RoadmapPreview|null>(null),[history,setHistory]=useState<RoadmapExecution[]|null>(null),[historyError,setHistoryError]=useState('');
 const [missing,setMissing]=useState<RoadmapMissingTools['missing_tools']>([]),[queueOptions,setQueueOptions]=useState<{id:string;name:string}[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const [selected,setSelected]=useState<Record<string,string>>({});
 const canReadHistory=connected||cluster;
 const overrides=Object.fromEntries(Object.entries(selected).filter(([key,id])=>id&&nodes.some(node=>node.id===key)));
 const scope=JSON.stringify([taskId,revision,connected,overrides,toolSetupRevision]),owner=useRef(scope);owner.current=scope;
 const live=useRef(true),operation=useRef(false),root=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 useEffect(()=>{setReview(null);setMissing([]);setError('');},[scope]);
 useEffect(()=>{
  if(!cluster||!open||!connected||!defaultEnvironment)return;
  let disposed=false;
  setQueueOptions([]);
  void deploymentApi.read(taskId).then(context=>{
   if(disposed||context.taskId!==taskId)return;
   const profile=context.clusters.find(item=>item.id===defaultEnvironment),targets=profile?.queue_targets;
   const policy=context.projects.find(item=>item.id===projectId)?.policy.cluster_queue_policies?.[defaultEnvironment];
   if(Array.isArray(targets)&&policy?.profile_version===profile?.version)setQueueOptions((policy?.new_submission_order||[]).flatMap(id=>{
    const target=targets.find(item=>item?.id===id&&item.enabled&&typeof item.queue==='string');return target?[{id,name:target.queue}]:[];
   }));
  },error=>{if(!disposed)setError(String(error.message||error));});
  return()=>{disposed=true;};
 },[cluster,open,connected,taskId,defaultEnvironment,projectId]);
 useEffect(()=>{if(focus){setOpen(true);root.current?.scrollIntoView({block:'center'});}},[focus?.nonce]);
 useEffect(()=>{
  if(!open||!canReadHistory)return;
  let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
  async function read(){
   setHistoryError('');
   try{
    const rows=await request('task.roadmap.list',{taskId});
    if(disposed)return;setHistory(rows);
    if(rows.some(row=>row.status==='running'||row.status==='unknown'))timer=setTimeout(read,3000);
   }catch(e){if(!disposed)setHistoryError(String((e as Error).message||e));}
  }
  void read();return()=>{disposed=true;if(timer)clearTimeout(timer);};
 },[taskId,open,connected,canReadHistory,reload]);
 async function act(submit:boolean){
  if(operation.current||owner.current!==scope||disabled||!connected||!configured)return;
  const expected=owner.current;operation.current=true;setBusy(true);setError('');
  try{
   if(submit&&review){
    const row=await request('task.roadmap.confirm',{taskId,snapshotSha256:review.snapshot_sha256,environments:overrides});
    if(live.current&&expected===owner.current&&row){setHistory(previous=>[row,...(previous||[]).filter(value=>value.id!==row.id)]);setReview(null);setReload(x=>x+1);}
   }else{
    const value=await request('task.roadmap.preview',{taskId,environments:overrides});if(live.current&&expected===owner.current){
     if('missing_tools' in value){setReview(null);setMissing(value.missing_tools);onMissingToolQuestion?.(value.missing_tools[0]?.tool);}
     else{setMissing([]);setReview(value);onMissingToolQuestion?.();}
    }
   }
  }catch(e){if(live.current&&expected===owner.current){setReview(null);setError(String((e as Error).message||e));setReload(x=>x+1);}}
  finally{operation.current=false;if(live.current)setBusy(false);}
 }
 return <details className="card roadmap-execution" ref={root} open={open} onToggle={e=>setOpen(e.currentTarget.open)} data-testid="roadmap-execution">
  <summary>{t('按流程图执行')}</summary>
  {!configured&&<p>{t('请先保存计算项目与部署目标。')}</p>}
  {configured&&<details><summary>{t(cluster?'各步骤的队列与环境':'各步骤的计算环境')}</summary>{nodes.map(node=><label key={node.id}>{node.label} <select disabled={busy||disabled} value={selected[node.id]||''} onChange={event=>setSelected({...selected,[node.id]:event.target.value})}>
   <option value="">{t(cluster?'部署队列':'部署环境')} · {defaultEnvironment}</option>{(cluster?queueOptions:environments).map(env=><option key={env.id} value={env.id}>{env.name} · {env.id}</option>)}</select></label>)}</details>}
  <div className="button-row"><button className="button" data-testid="roadmap-preview" data-guide-target="roadmap-preview" disabled={busy||disabled||!connected||!configured} onClick={()=>void act(false)}>{t('核对执行快照')}</button>
   {review&&<button className="button primary" data-testid="roadmap-confirm" data-guide-target="roadmap-confirm" disabled={busy||disabled||!connected||!configured} onClick={()=>void act(true)}>{t('确认并执行整张图')}</button>}
   <button className="button" disabled={!canReadHistory||busy} onClick={()=>setReload(x=>x+1)}>{t('刷新回执')}</button></div>
  {error&&<p role="alert">{error}</p>}
  {missing.length>0&&<section className="notice roadmap-missing-tools" data-testid="roadmap-missing-tools"><strong>{t('流程缺少工具')}</strong><ul>{missing.map(item=><li key={item.step_id}>{nodes.find(node=>node.id===item.step_id)?.label||item.step_id} · {item.tool}<p>{item.reason==='tool_not_configured'?t('此工具尚未在当前资源上配置。'):item.reason}</p>{onMissingTool&&<button className="button" type="button" disabled={busy} data-testid="roadmap-missing-tool-setup" onClick={()=>onMissingTool(item.tool)}>{t('让 Agent 配置')}</button>}</li>)}</ul><button className="text-button" type="button" onClick={()=>{setMissing([]);onMissingToolQuestion?.();}}>{t('稍后')}</button></section>}
  {review&&<Snapshot review={review}/>}
  {historyError&&<p role="alert">{historyError}</p>}
  {history?.map(row=><section className="roadmap-receipt" key={row.id} aria-label={t('执行回执')} data-guide-target="roadmap-results"><h4>{stateText(row.status)} · {row.id.slice(0,12)}</h4>
   {row.directory&&<details><summary>{t('本次运行目录')}</summary><code>{row.directory}</code></details>}
   <FrozenSnapshot taskId={taskId} id={row.id} reload={reload}/>
   {Object.entries(row.nodes).map(([id,node])=><div key={id} className="roadmap-step-receipt"><div className="roadmap-receipt-heading"><strong>{id}</strong><span>{stateText(node.status)}</span>{node.run_id&&<button className="text-button" onClick={()=>onRun(node.run_id!)}>{node.job_id||node.run_id}</button>}</div>
    {node.directory&&<details><summary>{t('工作目录')}</summary><code>{node.directory}</code></details>}
    {node.reason&&<p>{node.reason}</p>}{node.consumed?.map(item=><p key={item.port}>{t('实际读取')} · {item.producer&&<>{item.producer.run_id} · {item.producer.step_id}.{item.producer.port} → </>}{id}.{item.port} · {item.bytes_read} B · {item.sha256}</p>)}</div>)}
   {row.goals.map(goal=><details key={goal.resource}><summary>{goal.label} · {stateText(goal.status)}</summary>{goal.artifact&&<p>{goal.artifact.path} · {goal.artifact.sha256}</p>}
    {goal.checks.map((check,i)=><p key={i}>{check.requirement} · {stateText(check.status)} {check.observed!==undefined&&JSON.stringify(check.observed)}</p>)}</details>)}
  </section>)}
  {open&&history?.length===0&&!historyError&&<p className="muted" data-guide-target="roadmap-empty">{t('这张流程图暂无执行回执。')}</p>}
 </details>;
}
