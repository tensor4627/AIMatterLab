import {useEffect,useRef,useState} from 'react';
import type {TypedInvoke} from '../../../contracts/dto/ipc';
import type {RoadmapExecution,RoadmapPreview} from '../../../contracts/dto/roadmap-execution';
import {invoke} from '../../api/studio';
import {t} from '../../ui/i18n';
import type {ToolWorkflowFocus} from './useToolWorkflowNavigation';

const request:TypedInvoke=invoke;
const stateNames:Record<string,string>={pending:'等待输入',running:'运行中',submitted:'已提交',passed:'通过',failed:'失败',unknown:'待核对',blocked:'受阻',needs_review:'待人工验收',unavailable:'尚无产物',cancelled:'已取消'};
const stateText=(key:string)=>t(stateNames[key]||key);

type Props={taskId:string;revision:string;connected:boolean;disabled:boolean;configured:boolean;onRun:(id:string)=>void;focus?:ToolWorkflowFocus;
 nodes:{id:string;label:string}[];environments:{id:string;name:string}[];defaultEnvironment?:string};
function Snapshot({review}:{review:RoadmapPreview}){
 const {snapshot}=review;
 return <div aria-label={t('执行快照')}><p>{snapshot.original_request}</p>
  <p>{snapshot.target.project_id} · {snapshot.target.environment_id} · {snapshot.target.max_seconds} s</p>
  {snapshot.steps.map(node=><details key={node.id}><summary>{node.label} · {node.tool} · {node.version.version.slice(0,12)}</summary>
   <p>{t('工具版本')} · {node.version.version}</p>{node.registered_function&&<p>{node.registered_function.function_id} · {node.registered_function.package_version}</p>}
   <p>{t('计算环境')} · {node.environment.id} · {node.environment_sha256}</p><pre>{JSON.stringify(node.argv)}{'\n'}{JSON.stringify(node.parameters,null,2)}</pre>
   {node.native_controls&&<pre aria-label="run.in">{node.native_controls.join('\n')}</pre>}
   {Object.entries(node.inputs).map(([port,input])=><p key={port}>{port} ← {input.producer?input.producer.step_id+'.'+input.producer.port:snapshot.initial[input.resource]?.path} · {input.name}</p>)}
   {Object.entries(node.outputs).map(([port,output])=><p key={port}>{port} → {output.resource} · {output.name}</p>)}</details>)}
  {Object.values(snapshot.initial).map(input=><p key={input.resource}>{input.resource} · {input.path} · {input.sha256}</p>)}
  {snapshot.goals.map(goal=><div key={goal.id}><strong>{goal.label}</strong>{goal.requirements?.map((line,i)=><p key={i}>{line} · {goal.checks?.filter(c=>c.requirement===line).map(c=>c.fact+' '+c.op+' '+c.value).join(' / ')||t('待人工验收')}</p>)}</div>)}
  <p>SHA-256 · {review.snapshot_sha256}</p>
 </div>;
}
function FrozenSnapshot({taskId,id,connected}:{taskId:string;id:string;connected:boolean}){
 const [open,setOpen]=useState(false),[review,setReview]=useState<RoadmapPreview|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!open||!connected||review)return;
  let current=true;setError('');
  request('task.roadmap.snapshot',{taskId,executionId:id}).then(value=>{if(current)setReview(value);},e=>{if(current)setError(String(e.message||e));});
  return ()=>{current=false;};
 },[open,connected,taskId,id,review]);
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>{t('查看已冻结快照')}</summary>
  {error&&<p role="alert">{error}</p>}{review&&<Snapshot review={review}/>}</details>;
}
export default function RoadmapExecutionPanel({taskId,revision,connected,disabled,configured,onRun,focus,nodes,environments,defaultEnvironment}:Props){
 const [open,setOpen]=useState(false),[review,setReview]=useState<RoadmapPreview|null>(null),[history,setHistory]=useState<RoadmapExecution[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const [selected,setSelected]=useState<Record<string,string>>({});
 const overrides=Object.fromEntries(Object.entries(selected).filter(([key,id])=>id&&nodes.some(node=>node.id===key)));
 const scope=taskId+'|'+revision+'|'+connected+'|'+JSON.stringify(overrides),owner=useRef(scope);owner.current=scope;
 const live=useRef(true),operation=useRef(false),root=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 useEffect(()=>{setReview(null);setError('');},[scope]);
 useEffect(()=>{if(focus){setOpen(true);root.current?.scrollIntoView({block:'center'});}},[focus?.nonce]);
 useEffect(()=>{
  if(!open||!connected)return;
  let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
  async function read(){
   try{
    const rows=await request('task.roadmap.list',{taskId});
    if(disposed)return;setHistory(rows);
    if(rows.some(row=>row.status==='running'||row.status==='unknown'))timer=setTimeout(read,3000);
   }catch(e){if(!disposed)setError(String((e as Error).message||e));}
  }
  void read();return()=>{disposed=true;if(timer)clearTimeout(timer);};
 },[taskId,open,connected,reload]);
 async function act(submit:boolean){
  if(operation.current||disabled||!connected||!configured)return;
  const expected=owner.current;operation.current=true;setBusy(true);setError('');
  try{
   if(submit&&review){
    const row=await request('task.roadmap.confirm',{taskId,snapshotSha256:review.snapshot_sha256,environments:overrides});
    if(live.current&&expected===owner.current&&row){setHistory(previous=>[row,...previous.filter(value=>value.id!==row.id)]);setReview(null);setReload(x=>x+1);}
   }else{
    const value=await request('task.roadmap.preview',{taskId,environments:overrides});if(live.current&&expected===owner.current)setReview(value);
   }
  }catch(e){if(live.current&&expected===owner.current){setReview(null);setError(String((e as Error).message||e));setReload(x=>x+1);}}
  finally{operation.current=false;if(live.current)setBusy(false);}
 }
 return <details className="card roadmap-execution" ref={root} open={open} onToggle={e=>setOpen(e.currentTarget.open)} data-testid="roadmap-execution">
  <summary>{t('按流程图执行')}</summary>
  {!configured&&<p>{t('请先保存本地计算项目、环境与资源。')}</p>}
  {configured&&<details><summary>{t('各步骤的计算环境')}</summary>{nodes.map(node=><label key={node.id}>{node.label} <select disabled={busy||disabled} value={selected[node.id]||''} onChange={event=>setSelected({...selected,[node.id]:event.target.value})}>
   <option value="">{t('部署环境')} · {defaultEnvironment}</option>{environments.map(env=><option key={env.id} value={env.id}>{env.name} · {env.id}</option>)}</select></label>)}</details>}
  <div className="button-row"><button className="button" disabled={busy||disabled||!connected||!configured} onClick={()=>void act(false)}>{t('核对执行快照')}</button>
   {review&&<button className="button primary" disabled={busy||disabled||!connected||!configured} onClick={()=>void act(true)}>{t('确认并执行整张图')}</button>}
   <button className="button" disabled={!connected||busy} onClick={()=>setReload(x=>x+1)}>{t('刷新回执')}</button></div>
  {error&&<p role="alert">{error}</p>}
  {review&&<Snapshot review={review}/>}
  {history.map(row=><section key={row.id} aria-label={t('执行回执')}><h4>{stateText(row.status)} · {row.id.slice(0,12)}</h4>
   <FrozenSnapshot taskId={taskId} id={row.id} connected={connected}/>
   {Object.entries(row.nodes).map(([id,node])=><div key={id}><strong>{id}</strong> · {stateText(node.status)} {node.run_id&&<button className="text-button" onClick={()=>onRun(node.run_id!)}>{node.run_id}</button>}
    {node.reason&&<p>{node.reason}</p>}{node.consumed?.map(item=><p key={item.port}>{t('实际读取')} · {item.producer&&<>{item.producer.run_id} · {item.producer.step_id}.{item.producer.port} → </>}{id}.{item.port} · {item.bytes_read} B · {item.sha256}</p>)}</div>)}
   {row.goals.map(goal=><details key={goal.resource}><summary>{goal.label} · {stateText(goal.status)}</summary>{goal.artifact&&<p>{goal.artifact.path} · {goal.artifact.sha256}</p>}
    {goal.checks.map((check,i)=><p key={i}>{check.requirement} · {stateText(check.status)} {check.observed!==undefined&&JSON.stringify(check.observed)}</p>)}</details>)}
  </section>)}
 </details>;
}
