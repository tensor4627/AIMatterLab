import LoadingFeedback from '../../ui/LoadingFeedback';
import {useEffect,useRef,useState} from 'react';
import {Server,RefreshCw,Sparkles,Plus,ShieldCheck} from 'lucide-react';
import {api} from '../../api/worker';
import {invoke} from '../../api/studio';
import {engines} from '../../ui/presentation/engines';
import {type Environment} from '../../../contracts/dto/compute';
import {t} from "../../ui/i18n";
import './compute-environments.css';
function canonical(value:any):string{return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);}
function configuration(env:Environment){return canonical(env);}

export default function ComputeEnvironments({worker,workerGeneration,environments,onRefresh,onConnect,onManual,onAgent,onCluster,onError}:{worker:boolean;workerGeneration:number;environments:Environment[];onRefresh:()=>void|Promise<void>;onConnect:()=>void;onManual:()=>void;onAgent:(text:string)=>void;onCluster:()=>void;onError:(error:unknown)=>void}){
 const [state,setState]=useState<any>(null),[busy,setBusy]=useState(false),[engine,setEngine]=useState('pydyn.md'),[checks,setChecks]=useState<Record<string,any>>({}),[drafts,setDrafts]=useState<any[]>([]),[editing,setEditing]=useState(false),[draftId,setDraftId]=useState<string|null>(null),[spec,setSpec]=useState<any>({name:'WSL',executables:{python:''},repositories:{},variables:{}});
 const loading=useRef<{epoch:number;promise:Promise<void>}|null>(null),mounted=useRef(false),operation=useRef(false);
 const [reading,setReading]=useState(false),[busyLabel,setBusyLabel]=useState('');
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const [receiptRefresh,setReceiptRefresh]=useState(0);
 const probeOperations=useRef(new Map<string,any>());
 const [probeChecks,setProbeChecks]=useState<Record<string,any>>({});
 const receiptScope=useRef({key:'',serial:0});
 const receiptKey=canonical([worker,workerGeneration,engine,receiptRefresh,environments.map(env=>[env.id,configuration(env)])]);
 if(receiptScope.current.key!==receiptKey)receiptScope.current={key:receiptKey,serial:receiptScope.current.serial+1};
 const receiptSerial=receiptScope.current.serial;
 const registrations=useRef(new Map<string,{configuration:string;revision:number}>()),registrationSequence=useRef(0),requestSequence=useRef(0),readinessRevisions=useRef(new Map<string,number>()),readinessConnection=useRef(-1),connection=useRef({worker,generation:workerGeneration,revision:0});
 if(connection.current.worker!==worker||connection.current.generation!==workerGeneration)connection.current={worker,generation:workerGeneration,revision:connection.current.revision+1};
 for(const env of environments){const value=configuration(env);if(registrations.current.get(env.id)?.configuration!==value)registrations.current.set(env.id,{configuration:value,revision:++registrationSequence.current});}
 for(const id of registrations.current.keys())if(!environments.some(env=>env.id===id))registrations.current.delete(id);
 function load():Promise<void>{
  if(!worker)return Promise.resolve();const epoch=connection.current.revision;if(loading.current?.epoch===epoch)return loading.current.promise;
  const request={epoch,promise:Promise.resolve()};loading.current=request;setReading(true);
  const revisions=new Map([...registrations.current].map(([id,value])=>[id,value.revision]));
  request.promise=(async()=>{try{const [next,proposals]=await Promise.all([api('GET','/api/compute/readiness'),api<any[]>('GET','/api/environments/drafts')]);if(!mounted.current||epoch!==connection.current.revision)return;readinessRevisions.current=revisions;readinessConnection.current=epoch;setState(next);setDrafts(proposals.filter(draft=>draft.status==='draft'));}finally{if(loading.current===request){loading.current=null;if(mounted.current)setReading(false);}}})();return request.promise;
 }

 useEffect(()=>{void load().catch(onError);const timer=worker?setInterval(()=>void load().catch(()=>{}),10000):undefined;const off=window.studio?.onEvent(event=>{if(event.method==='studio/computeSetup'){setBusy(event.params.status==='discovering');if(event.params.status!=='discovering')void load().then(onRefresh).catch(onError);}});return()=>{clearInterval(timer);off?.();};},[worker,workerGeneration]);
 async function scan(){if(operation.current)return;operation.current=true;setBusyLabel(t('正在发现已有环境…'));setBusy(true);try{await invoke('compute.setup',{force:true,register:true});await load();await onRefresh();}catch(error){onError(error);}finally{operation.current=false;if(mounted.current)setBusy(false);}}
 // Persisted guide reads validate current registration/source facts in the worker; they never probe.
 useEffect(()=>{let disposed=false;const serial=receiptSerial,epoch=connection.current.revision,route=engine,queue=environments.map(env=>({id:env.id,env,revision:registrations.current.get(env.id)!.revision}));
  const current=()=>!disposed&&worker&&receiptScope.current.serial===serial&&connection.current.revision===epoch;
  async function read(){await Promise.resolve();while(current()&&queue.length){const {id,env,revision}=queue.shift()!,key=id+':'+route,request=++requestSequence.current;const operation=probeOperations.current.get(key);if(operation?.epoch===epoch&&operation?.revision===revision&&operation.report.status!=='passed')continue;
   setChecks(old=>({...old,[key]:{revision,epoch,serial,request,report:{status:'loading'}}}));
   const publish=(report:any)=>{const operation=probeOperations.current.get(key);if(current()&&revision===registrations.current.get(id)?.revision&&!(operation?.epoch===epoch&&operation?.revision===revision&&(operation.report.status!=='passed'||operation.request>request)))setChecks(old=>old[key]?.request===request?{...old,[key]:{revision,epoch,serial,request,report}}:old);};
   try{const guide=await api('POST','/api/runtime-guide',{environment_id:id,engine:route});
    // The worker read validates its Python fingerprint and current source bytes. Do not recompute it in JS: 1.0/1 and Unicode serialization can differ.
    if(guide?.facts&&!(/^[a-f0-9]{64}$/.test(guide.facts.configuration_sha256)))throw Error(t('保存的检查回执响应无效'));
    if(!guide||!['observed','blocked','stale','not_run'].includes(guide.status)||((guide.facts?.environment_id??guide.environment_id)!==id)||((guide.facts?.engine??guide.engine)!==route)||guide.status==='observed'&&(guide.facts?.state!=='observed'||!(/^[a-f0-9]{64}$/.test(guide.receipt))))throw Error(t('保存的检查回执响应无效'));
    publish({status:guide.status,scope:{engine:route},runtime_guide:guide,saved:true});
   }catch(error){publish({status:'read_error',reason:String(error)});}
  }}
  // Two concurrent saved-read passes share the queue as an intentional pool of 2;
  // keep both (or measure before reducing) so a slow environment does not serialise the rest.
  if(worker){void read();void read();}return()=>{disposed=true;};
 },[receiptSerial]);
 // A probe is an operation on one registered environment/engine, not a saved-read generation.
 async function probe(id:string){const route=engine,key=id+':'+route,revision=registrations.current.get(id)?.revision,epoch=connection.current.revision,request=++requestSequence.current;if(!worker||revision===undefined)return;const prior=probeOperations.current.get(key);if(prior?.epoch===epoch&&prior?.revision===revision&&prior.report.status==='checking')return;
  const operation={revision,epoch,request,report:{status:'checking'}};probeOperations.current.set(key,operation);setProbeChecks(old=>({...old,[key]:operation}));
  const publish=(report:any)=>{if(!mounted.current||!connection.current.worker||epoch!==connection.current.revision||revision!==registrations.current.get(id)?.revision||probeOperations.current.get(key)?.request!==request)return;const next={revision,epoch,request,report};probeOperations.current.set(key,next);setProbeChecks(old=>({...old,[key]:next}));};
  try{publish(await api('POST','/api/probe',{environment_id:id,engine:route}));}catch(error){publish({status:'blocked',reason:String(error)});}
 }
 function path(group:string,key:string,value:string){setSpec((old:any)=>({...old,[group]:{...old[group],[key]:value}}));}
 async function save(){if(operation.current)return;operation.current=true;setBusyLabel(t('正在保存环境…'));setBusy(true);try{const value={...spec,...draftId?{setup_draft_id:draftId}:{},executables:Object.fromEntries(Object.entries(spec.executables||{}).filter(([,value])=>value)),repositories:Object.fromEntries(Object.entries(spec.repositories||{}).filter(([,value])=>value))};await api('POST','/api/environments',value);setEditing(false);setDraftId(null);await load();await onRefresh();}catch(error){onError(error);}finally{operation.current=false;if(mounted.current)setBusy(false);}}
 const observed=new Map<string,any>((state?.environments||[]).filter((env:any)=>readinessConnection.current===connection.current.revision&&readinessRevisions.current.get(env.id)===registrations.current.get(env.id)?.revision).map((env:any)=>[env.id,env]));
 const checkFor=(env:Environment)=>{const key=env.id+':'+engine,probe=probeChecks[key],value=checks[key],validProbe=worker&&probe?.revision===registrations.current.get(env.id)?.revision&&probe?.epoch===connection.current.revision,validRead=worker&&value?.serial===receiptScope.current.serial&&value?.revision===registrations.current.get(env.id)?.revision&&value?.epoch===connection.current.revision;
  if(validProbe&&!(probe.report.status==='passed'&&validRead&&value.request>probe.request))return probe.report;
  return validRead?value.report:undefined;
 };
 const passed=(check:any,env:Environment)=>check?.status!=='failed'&&check?.status!=='blocked'&&check?.runtime_guide?.status==='observed'&&check?.scope?.engine===engine&&check.runtime_guide.facts?.state==='observed'&&check.runtime_guide.facts?.engine===engine&&check.runtime_guide.facts?.environment_id===env.id;
 const cudaFor=(env:Environment)=>{const check=checkFor(env);if(check&&!(check.saved&&check.status==='not_run'&&check.runtime_guide?.status==='not_run')){if(!passed(check,env))return undefined;const available=check.runtime_guide.facts?.cuda?.available??check.cuda_available;return typeof available==='boolean'?available:undefined;}return Object.values(observed.get(env.id)?.cuda||{}).some((item:any)=>item.available===true)?true:undefined;};
 const gpuEnvironments=environments.filter(env=>cudaFor(env)===true);
 const label=(value:string)=>t(({passed:'检查通过',failed:'检查失败',blocked:'待完善',not_run:'未检查',stale:'需要重新检查',checking:'检查中…',loading:'正在读取保存的检查…',read_error:'检查回执读取失败'} as Record<string,string>)[value]||value);
 return <div className="page compute-environments" data-testid="compute-environments"><div className="page-heading"><div><h1>{t('计算环境')}</h1><p>{t('优先使用已安装的软件。连接时自动发现并登记，本地与集群分别检查。')}</p></div><Server size={26}/></div>
 {!worker?<div className="notice"><p>{t('连接作业服务后检查已有环境。')}</p><button className="button primary" data-guide-target="connect-worker" onClick={onConnect}>{t('连接作业服务')}</button></div>:<>
 <LoadingFeedback busy={busy||reading&&!state} label={busy?busyLabel||t('正在发现已有环境…'):t('正在读取计算环境…')}/>
 <div className="compute-summary"><section className="card"><strong>{t('本地环境')}</strong><b>{environments.length}</b><span>{gpuEnvironments.length} {t('个环境已观察到 CUDA')}</span></section><section className="card"><strong>{t('集群连接')}</strong><b>{state?.clusters?.length??'…'}</b><span>{t('连接成功与计算节点验证分别记录')}</span></section></div>
 <div className="button-row"><button className="button primary" data-testid="discover-compute" data-guide-target="discover" disabled={busy} onClick={()=>void scan()}><RefreshCw size={15}/>{t(busy?'正在发现已有环境…':'重新发现并登记')}</button><button className="button" onClick={()=>onAgent('协助完善当前计算环境。先调用 compute_readiness，必要时 discover_local_environments；优先复用已安装的软件和明确登记的源码，不要把缺少注册说成没有安装。区分 CPU/CUDA、依赖探测、引擎短例验证。已有集群先 list_clusters / probe_cluster，只读核验 SSH 和调度器，再与我讨论队列、资源和环境路径；用 draft_cluster_setup 提供可审阅配置，不提交任务，不更改项目授权，不泄露连接信息。')}><Sparkles size={15}/>{t('让 Agent 协助配置')}</button></div>
 {drafts.length>0&&<section className="card"><h2>{t('Agent 环境建议')}</h2>{drafts.map(draft=><div className="compute-cluster-row" key={draft.id}><strong>{draft.proposal.name}</strong><span>{t('待审阅，尚未登记')}</span><button className="button" onClick={()=>{setDraftId(draft.id);setSpec({...draft.proposal,repositories:draft.proposal.repositories||{},variables:draft.proposal.variables||{}});setEditing(true);}}>{t('审阅配置')}</button></div>)}</section>}
 {editing&&<section className="card" data-testid="environment-setup-form"><h2>{t('登记已有计算环境')}</h2><label>{t('环境名称')}<input value={spec.name} onChange={event=>setSpec({...spec,name:event.target.value})}/></label><label>Python<input placeholder="/absolute/venv/bin/python" value={spec.executables.python||''} onChange={event=>path('executables','python',event.target.value)}/></label><details><summary>{t('引擎、源码与加载路径')}</summary>{['gpumd','gpu-sampling','nep'].map(key=><label key={key}>{key}<input value={spec.executables[key]||''} onChange={event=>path('executables',key,event.target.value)}/></label>)}{['pydyn','pygas','hotpp'].map(key=><label key={key}>{key} · {t('源码目录')}<input value={spec.repositories[key]||''} onChange={event=>path('repositories',key,event.target.value)}/></label>)}<label>LD_LIBRARY_PATH<textarea value={spec.variables.LD_LIBRARY_PATH||''} onChange={event=>path('variables','LD_LIBRARY_PATH',event.target.value)}/></label></details><div className="button-row"><button className="button primary" disabled={busy||!spec.name||!spec.executables.python} onClick={()=>void save()}>{t('保存环境')}</button><button className="button" onClick={()=>setEditing(false)}>{t('关闭')}</button></div></section>}
 {!gpuEnvironments.length&&<p className="notice" role="status">{t(busy?'正在检查解释器与 CUDA，请稍候。':'尚未观察到可用的 CUDA 环境。可重新发现、补充已有解释器，或让 Agent 定位依赖问题。')}</p>}
 <button className="button" disabled={!worker} onClick={()=>setReceiptRefresh(value=>value+1)}>{t('刷新保存的检查')}</button>
 <label className="compute-route">{t('检查路线')}<select value={engine} onChange={event=>setEngine(event.target.value)}>{engines.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
 <div className="compute-env-list">{environments.map(env=>{const facts=observed.get(env.id),cuda=cudaFor(env),check=checkFor(env);return <section className="card" key={env.id}><div className="compute-env-heading"><h3>{env.name}</h3><span className="tag">{t(cuda===true?'CUDA 已发现':cuda===false?'未观察到 CUDA':'CPU / CUDA 待检查')}{passed(check,env)?' · '+engine:''}</span></div><p className="mono">{env.executables.python}</p><p>{Object.keys(env.repositories||{}).join(' · ')||t('未绑定科学源码')}</p><div className="button-row"><button className="button" disabled={busy||check?.status==='checking'} onClick={()=>void probe(env.id)}><ShieldCheck size={14}/>{t('检查依赖与 GPU')}</button>{check&&<span role="status">{label(check.status==='checking'?'checking':check.status==='loading'?'loading':check.status==='read_error'?'read_error':passed(check,env)?'passed':check.status)}</span>}</div>{check?.runtime_guide&&<p className="muted">{t('保存的依赖观察不代表科学计算已验证')}{check.runtime_guide.facts?.observed_at?' · '+new Date(check.runtime_guide.facts.observed_at*1000).toLocaleString():''}</p>}{check&&<details><summary>{t('检查详情')}</summary><pre className="report">{JSON.stringify(check,null,2)}</pre></details>}<details><summary>{t('路径与版本详情')}</summary><pre className="report">{JSON.stringify({executables:env.executables,repositories:env.repositories,observed_at:facts?.discovery?.observed_at,scope:t('发现与登记不代表科学短例已通过')},null,2)}</pre></details></section>;})}</div>
 <section className="card"><div className="compute-env-heading"><h2>{t('集群连接')}</h2><button className="button" onClick={onCluster}>{t('管理集群连接')}</button></div>{state?.clusters?.map((cluster:any)=><div className="compute-cluster-row" key={cluster.id}><strong>{cluster.name}</strong><span>{cluster.scheduler?.toUpperCase()}</span><span>{label(cluster.connection_check?.status||'not_run')}</span>{cluster.connection_check?.observed_at&&<small>{new Date(cluster.connection_check.observed_at*1000).toLocaleString()}</small>}</div>)}<p className="muted">{t('SSH 与调度器检查只读执行；计算节点 GPU、环境与模型在独立短例或正式运行时验证。')}</p></section>
 <details className="settings-advanced"><summary>{t('手动登记与诊断')}</summary><div className="button-row"><button className="button" onClick={()=>{setDraftId(null);setEditing(true);}}><Plus size={14}/>{t('手动登记已有环境')}</button><button className="button" onClick={onManual}>{t('高级 JSON 配置')}</button></div>{state?.discovery&&<details><summary>{t('发现记录')}</summary><pre className="report">{JSON.stringify(state.discovery,null,2)}</pre></details>}</details></>}
 </div>;
}
