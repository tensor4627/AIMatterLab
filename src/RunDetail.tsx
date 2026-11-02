import Tooltip from './Tooltip';
import {runContinuation} from '../shared/run-continuation.mjs';
import {tr} from './i18n';
import {ObservedRead,type ReadObservation} from '../shared/observed-read.mjs';
import {useEffect,useRef,useState} from 'react';
import {Play,Square,ShieldCheck,Download,Files,RotateCw} from 'lucide-react';
import {api,invoke,type Run} from './types';
import {Badge,Modal} from './Dialogs';
import {Chart,Structure,CodeEditor} from './widgets';
export default function RunDetail({run,connected=true,onRefresh,onError,onOpenRun}:{run:Run;connected?:boolean;onRefresh:()=>void|Promise<void>;onError:(e:unknown)=>void;onOpenRun?:(id:string)=>void}){
 const [tab,setTab]=useState('日志'),[log,setLog]=useState(''),[files,setFiles]=useState<any[]>([]),[selected,setSelected]=useState(''),[text,setText]=useState(''),[structure,setStructure]=useState<any>(null),[frame,setFrame]=useState(0);
 const [logObservation,setLogObservation]=useState<ReadObservation<{offset:number;text:string}>|null>(null),logReader=useRef<ObservedRead<{offset:number;text:string}>|null>(null),connectedRef=useRef(connected);connectedRef.current=connected;
 const [image,setImage]=useState(''),[analysis,setAnalysis]=useState<any>(null);
 const [resume,setResume]=useState(false),[resumeParameters,setResumeParameters]=useState('{"checkpoint_files":["restart.xyz"]}'),[resumeKey,setResumeKey]=useState(''),[working,setWorking]=useState(false);
 const [lock,setLock]=useState(''),[loadingFile,setLoadingFile]=useState(false),[fileError,setFileError]=useState('');
 const fileSeq=useRef(0),previewSeq=useRef(0),resumeAttempt=useRef<{key:string;parameters:Record<string,unknown>}|null>(null);
 const [resumePending,setResumePending]=useState(false),[resumeStorageError,setResumeStorageError]=useState(false);
 const continuation=runContinuation(run.engine,run.parameters?.mode),continuationRef=useRef(continuation);continuationRef.current=continuation;
 const identity=JSON.stringify([run.id,run.project_id,run.environment_id,run.directory]);
 const collection=useRef({identity,connected,epoch:0,sequence:0,loaded:false,pending:false});
 const [collectionState,setCollectionState]=useState('idle'),[collectionError,setCollectionError]=useState('');
 if(collection.current.identity!==identity||collection.current.connected!==connected){collection.current={identity,connected,epoch:collection.current.epoch+1,sequence:0,loaded:false,pending:false};}
 function clearArtifactPreview(){fileSeq.current++;previewSeq.current++;setSelected('');setText('');setImage('');setStructure(null);setAnalysis(null);setFrame(0);setLoadingFile(false);setFileError('');}
 useEffect(()=>{setFiles([]);clearArtifactPreview();setCollectionState('idle');setCollectionError('');return()=>{collection.current.epoch++;collection.current.pending=false;fileSeq.current++;previewSeq.current++;};},[identity]);
 useEffect(()=>{setCollectionState(previous=>previous==='idle'?'idle':'stale');setCollectionError('');},[connected]);
 // Existing main-process notification means a verified connection was replaced/restored.
 // It invalidates observations only; it never triggers a collect/hash operation.
 useEffect(()=>window.studio?.onEvent(event=>{if(event.method==='studio/workerConnected'){collection.current.epoch++;collection.current.sequence++;collection.current.loaded=false;collection.current.pending=false;clearArtifactPreview();setFiles([]);setCollectionState('idle');setCollectionError('');}}),[]);

 useEffect(()=>{
  fileSeq.current++;previewSeq.current++;
  setLog('');setFiles([]);setSelected('');setStructure(null);setText('');setImage('');setAnalysis(null);setLoadingFile(false);setFileError('');setResume(false);setTab('日志');resumeAttempt.current=null;setResumePending(false);setResumeKey('');setResumeStorageError(false);
  try{const cached=localStorage.getItem('studio.resume.'+run.id);if(cached){const attempt=JSON.parse(cached);if(!attempt||typeof attempt.key!=='string'||!attempt.key||!attempt.parameters||typeof attempt.parameters!=='object'||Array.isArray(attempt.parameters))throw Error('续算请求记录无效，请先人工核对已有草稿');resumeAttempt.current=attempt;setResumePending(true);setResumeKey(attempt.key);setResumeParameters(JSON.stringify(attempt.parameters,null,2));}}catch(e){setResumeStorageError(true);onError(e);}
  setLogObservation(null);let offset=0,applied:{offset:number;text:string}|null=null;
  const reader=new ObservedRead(async()=>api<{offset:number;text:string}>('POST','/api/run/log',{run_id:run.id,offset}),observation=>{
   setLogObservation(observation);const response=observation.value;
   if(response&&response!==applied){applied=response;offset=response.offset;setLog(previous=>(previous+response.text).slice(-1048576));}
  },{delay:2000});
  logReader.current=reader;reader.setConnected(connectedRef.current);
  return()=>{reader.dispose();if(logReader.current===reader)logReader.current=null;};
 },[run.id]);
 useEffect(()=>{logReader.current?.setConnected(connected);},[connected]);
 useEffect(()=>{if(run.status!=='ready')setLock('');},[run.status]);
 async function action(name:string){
  if(!connected||working)return;
  setWorking(true);
  try{
   if(name==='submit')setLock(run.id);
   await api('POST','/api/run/'+name,{run_id:run.id});
   await onRefresh();
  }catch(e){
   onError(e);
   if(name==='submit'){
    try{const latest=await api<Run>('POST','/api/run/status',{run_id:run.id});if(latest.status==='ready')setLock('');}catch{}
    await onRefresh();
   }
  }finally{setWorking(false);}
 }
 async function collect(manual=true){
  const observed=collection.current;if(!connectedRef.current||observed.identity!==identity||observed.pending||!manual&&observed.loaded)return;
  observed.pending=true;const epoch=observed.epoch,sequence=++observed.sequence;
  const current=()=>collection.current===observed&&observed.epoch===epoch&&observed.sequence===sequence&&connectedRef.current;
  setCollectionState('loading');setCollectionError('');
  try{const r=await api('POST','/api/run/collect',{run_id:run.id});if(!current())return;if(r.run!==run.id||!Array.isArray(r.artifacts))throw Error('产物列表响应与当前作业不匹配');setFiles(r.artifacts);observed.loaded=true;setCollectionState('passed');if(manual)setTab('产物');}
  catch(e){if(!current())return;setCollectionState('error');setCollectionError(e instanceof Error?e.message:String(e));onError(e);}
  finally{if(current())observed.pending=false;}
 }
 async function openFile(name:string){
  if(!connected)return;
  const seq=++fileSeq.current;previewSeq.current++;
  setSelected(name);setStructure(null);setImage('');setText('');setFileError('');setLoadingFile(true);
  try{const r=await api('POST','/api/run/file',{run_id:run.id,name});if(seq!==fileSeq.current)return;setText(r.text||"");setImage(r.image||"");}
  catch(e){if(seq!==fileSeq.current)return;setFileError(e instanceof Error?e.message:String(e));onError(e);}
  finally{if(seq===fileSeq.current)setLoadingFile(false);}
 }
 async function preview(){
  if(!connected)return;
  const seq=++previewSeq.current,name=selected;
  try{const value=await api('POST','/api/inspect',{project_id:run.project_id,environment_id:run.environment_id,path:run.directory+'/results/'+name,kind:'structure',frame});if(seq!==previewSeq.current)return;setStructure(value);}catch(e){if(seq===previewSeq.current)onError(e);}
 }
 async function createResume(){
  if(!connectedRef.current||collection.current.identity!==identity||working)return;
  if(!continuationRef.current.allowed){onError(Error(tr(continuationRef.current.reason!)));return;}
  setWorking(true);
  try{if(!resumeAttempt.current){const parameters=JSON.parse(resumeParameters);if(!parameters||typeof parameters!=='object'||Array.isArray(parameters))throw Error('续算参数必须是 JSON 对象');resumeAttempt.current={key:resumeKey||crypto.randomUUID(),parameters};}const attempt=resumeAttempt.current;localStorage.setItem('studio.resume.'+run.id,JSON.stringify(attempt));setResumePending(true);const created=await api<Run>('POST','/api/run/resume',{run_id:run.id,parameters:{...attempt.parameters,idempotency_key:attempt.key}});localStorage.removeItem('studio.resume.'+run.id);resumeAttempt.current=null;setResumePending(false);setResume(false);onOpenRun?.(created.id);await onRefresh();}catch(e){onError(e);}finally{setWorking(false);}
 }
 return <div className="run-detail">
  <div className="detail-heading"><div><span className="eyebrow">{run.engine}</span><h2>{run.name}</h2><span className="mono muted">{run.id}</span></div><Badge status={run.status}/></div>
  {run.superseded_by&&<div className="notice">{tr('此草稿已被审阅版本替换')}<button className="button" onClick={()=>onOpenRun?.(run.superseded_by!)}>{tr('打开审阅版本')}</button></div>}
  {resumeStorageError&&<div className="notice" role="alert">{tr('续算请求记录无法读取；先核对已有草稿，禁止自动创建新请求。')}</div>}
  <div className="run-actions">
   {['draft','ready'].includes(run.status)&&<><button className="button" disabled={!connected||working||!['draft','ready'].includes(run.status)} onClick={()=>void action('validate')}><ShieldCheck size={14}/>{tr("验证")}</button>
   <button className="button primary" disabled={!connected||working||run.status!=='ready'||lock===run.id} onClick={()=>void action('submit')}><Play size={14}/>{tr("提交计算")}</button></>}
   {run.engine.startsWith('nep.')&&<button className="button" disabled={!connected} onClick={()=>{if(connected)void api('POST','/api/inspect',{project_id:run.project_id,environment_id:run.environment_id,path:run.directory+'/results',kind:'regression'}).then(r=>{setAnalysis(r);setTab('评估');}).catch(onError);}}>{tr("评估指标")}</button>}
   {['queued','running','unknown'].includes(run.status)&&<button className="button" disabled={!connected||working||!['queued','running','unknown'].includes(run.status)} onClick={()=>void action('cancel')}><Square size={13}/>{tr("取消")}</button>}
   <button className="button" disabled={!connected||collectionState==='loading'} onClick={()=>void collect()}><Files size={14}/>{tr("收集产物")}</button>
   <button className="button" title={continuation.reason?tr(continuation.reason):undefined} disabled={!connected||!continuation.allowed||working||resumeStorageError||!!run.superseded_by||!['succeeded','failed','cancelled'].includes(run.status)} onClick={()=>{if(!resumeAttempt.current)setResumeKey(crypto.randomUUID());setResume(true);}}><RotateCw size={14}/>{tr("续算")}</button>
   <button className="icon-button" title={tr("导出不可变输入与复现记录 ZIP")} disabled={!connected} aria-label={tr("导出不可变输入与复现记录 ZIP")} onClick={()=>{if(connected)void invoke('export',{run}).catch(onError);}}><Download size={16}/></button>
  </div>
  <div className="detail-meta"><span>GPU {run.gpu}</span><span>{tr("上限")}{run.max_seconds}s</span><span>{tr("输入已快照")}</span><span>{new Date(run.created_at*1000).toLocaleString()}</span></div>
  <div className="subtabs" role="tablist">{['日志','产物','验证','输入'].map(t=><button key={t} role="tab" aria-selected={tab===t} className={tab===t?'active':''} onClick={()=>{setTab(t);if(t==='产物')void collect(false);}}>{tr(t)}</button>)}</div>
  {tab==='日志'&&<>{(!connected||logObservation?.error)&&<div className="notice" role="status" data-testid="run-log-observation"><div><strong>{tr(!connected?'日志连接暂不可用':logObservation?.paused?'日志连续读取失败，已暂停自动查询。':'日志读取失败；保留最近输出。')}</strong>{logObservation?.observedAt&&<p>{tr('最近观测')} · {new Date(logObservation.observedAt).toLocaleString()}</p>}</div><button className="button" disabled={!connected||logObservation?.pending} onClick={()=>void logReader.current?.refresh()}>{tr('重新查询')}</button></div>}<pre className="console">{log||tr('尚无进程输出。提交后日志会持续更新。')}</pre></>}
  {tab==='验证'&&<div className="validation-report"><Badge status={run.validation.status}/><p>{run.validation.scope||run.validation.message}</p><h4>{tr('验证')}</h4><pre>{JSON.stringify(run.validation,null,2)}</pre>{run.error&&<><h4>{tr('错误')}</h4><pre>{run.error}</pre></>}{run.exit&&<><h4>{tr('退出状态')}</h4><pre>{JSON.stringify(run.exit,null,2)}</pre></>}</div>}
  {tab==='输入'&&<div className="input-record"><h4>{tr("实际执行命令")}</h4><pre>{run.command.join(' ')}</pre><h4>{tr("输入来源")}</h4><pre>{JSON.stringify(run.inputs,null,2)}</pre><h4>{tr("科学参数")} {run.continuation_metadata?.parameter_scope==='inherited_unverified'&&<Tooltip content={tr("这些值继承自父作业，需按当前实际输入复核；checkpoint 速度尚未检查。")}><span className="tag">{tr("继承值")}</span></Tooltip>}</h4><pre>{JSON.stringify(run.parameters||{},null,2)}</pre><p className="muted">{tr("完整快照与哈希保存在 reproduction.json；原始输入不会被覆盖。")}</p></div>}
  {tab==='产物'&&<><div role="status" data-testid="artifact-observation">{tr(collectionState==='loading'?'正在读取产物列表…':collectionState==='error'?'产物列表读取失败；可点击收集产物重试。':collectionState==='stale'?'连接已变化；产物列表需重新读取。':collectionState==='passed'&&!files.length?'当前结果目录为空。':'')}{collectionError&&' '+collectionError}</div><div className="artifacts-layout"><div className="file-list">{files.length?files.map(f=><button key={f.name} className={selected===f.name?'active':''} disabled={!connected} onClick={()=>void openFile(f.name)}><Files size={13}/><span>{f.name}</span><small>{(f.size/1024).toFixed(1)} KB</small></button>):<p className="muted">{tr("点击“收集产物”读取实际文件。")}</p>}</div><div className="artifact-preview">
   {selected&&<div className="toolbar"><span>{selected}</span><button className="button" onClick={()=>setTab('曲线')}>{tr("曲线")}</button>{/\.(xyz|traj)$/.test(selected)&&<><input className="frame-input" type="number" min={0} aria-label="frame" value={frame} onChange={e=>setFrame(Number(e.target.value))}/><button className="button" disabled={!connected} onClick={()=>void preview()}>{tr("结构预览")}</button></>}</div>}
   {image?<img className="artifact-image" src={image} alt={selected}/>:structure?<Structure data={structure}/>:<CodeEditor value={loadingFile?tr('读取中…'):fileError||text||tr('选择一个产物查看原始输出')} onChange={()=>{}} readOnly language="plaintext"/>}
  </div></div></>}
  {tab==='评估'&&<pre className="report">{JSON.stringify(analysis,null,2)}</pre>}
  {tab==='曲线'&&<><button className="button back" onClick={()=>setTab('产物')}>{tr("返回产物")}</button><Chart text={text} name={selected}/></>}
  {resume&&<Modal title={tr("从实际 checkpoint 创建续算")} onClose={()=>setResume(false)}><p className="muted">{tr("GPUMD 填写 checkpoint_files 与 continuation_run_in；HotPP 填写 checkpoint_files、checkpoint 和 continuation_config。PyDyn 填写 continuation_script，采样另填 paired_manifest。续算输入必须保持原物理参数与状态。")}</p><textarea className="json-input" disabled={!connected||working||resumePending} value={resumeParameters} onChange={e=>setResumeParameters(e.target.value)}/><button className="button primary" disabled={!connected||working||!continuation.allowed} onClick={()=>void createResume()}>{tr(resumePending?'重试同一续算请求':'创建续算草稿')}</button>{resumePending&&<p role="status">{tr('响应未确认；保留原参数与幂等键，重试只核对同一草稿，不提交计算。')}</p>}</Modal>}
 </div>;
}
