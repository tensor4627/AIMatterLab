import LoadingFeedback from '../../ui/LoadingFeedback';
import Tooltip from "../../ui/Tooltip";
import {runContinuation} from "./run-continuation.mjs";

import {tr} from "../../ui/i18n";
import {ObservedRead,type ReadObservation} from "../../api/observed-read.mjs";

import {useEffect,useRef,useState} from 'react';
import {appendLogChunks} from './log-buffer.mjs';
import {Play,Square,ShieldCheck,Download,Files,RotateCw} from 'lucide-react';
import {api} from '../../api/worker';
import {invoke} from '../../api/studio';
import {type Run} from '../../../contracts/dto/runs';
import {Badge,Modal} from "../../ui/Dialogs";
import {Chart,Structure,CodeEditor} from "../../ui/widgets";
import {EvidenceSelection,evidencePreSelection,type EvidenceLineRange} from '../conversations/EvidenceSelection';
const terminal=(status:string)=>['succeeded','failed','cancelled'].includes(status);
export default function RunDetail({run,connected=true,readOnly=false,onRefresh,onError,onOpenRun,onOpenWorkflow}:{run:Run;connected?:boolean;readOnly?:boolean;onRefresh:()=>void|Promise<void>;onError:(e:unknown)=>void;onOpenRun?:(id:string)=>void;onOpenWorkflow?:(runId:string)=>void}){
 const readOnlyRef=useRef(readOnly);readOnlyRef.current=readOnly;
 const workingRef=useRef<symbol|null>(null),auxiliaryRef=useRef(false),mounted=useRef(false),fileFlight=useRef<{key:string;sequence:number}|null>(null),previewFlight=useRef<{key:string;sequence:number}|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;workingRef.current=null;};},[]);
 const [workingLabel,setWorkingLabel]=useState(''),[auxiliary,setAuxiliary]=useState<{identity:string;label:string}|null>(null),[previewLoading,setPreviewLoading]=useState<{identity:string;sequence:number}|null>(null);
 const [tab,setTab]=useState('日志'),[logState,setLogState]=useState({chunks:[] as string[],truncated:false}),[files,setFiles]=useState<any[]>([]),[selected,setSelected]=useState(''),[text,setText]=useState(''),[structure,setStructure]=useState<any>(null),[frame,setFrame]=useState(0);
 const [logObservation,setLogObservation]=useState<ReadObservation<{offset:number;text:string}>|null>(null),logReader=useRef<ObservedRead<{offset:number;text:string}>|null>(null),connectedRef=useRef(connected);connectedRef.current=connected;
 const [image,setImage]=useState(''),[analysis,setAnalysis]=useState<any>(null);
 const [logEvidenceRange,setLogEvidenceRange]=useState<EvidenceLineRange|null>(null),[fileEvidenceRange,setFileEvidenceRange]=useState<EvidenceLineRange|null>(null);
 const [resume,setResume]=useState(false),[resumeParameters,setResumeParameters]=useState('{"checkpoint_files":["restart.xyz"]}'),[resumeKey,setResumeKey]=useState(''),[working,setWorking]=useState(false);
 const [lock,setLock]=useState(''),[loadingFile,setLoadingFile]=useState(false),[fileError,setFileError]=useState(''),[fileRange,setFileRange]=useState<{offset:number;size:number}|null>(null),[actionMessage,setActionMessage]=useState(''),[resumeCache,setResumeCache]=useState<string|null>(null);
 const fileSeq=useRef(0),previewSeq=useRef(0),resumeAttempt=useRef<{key:string;parameters:Record<string,unknown>}|null>(null);
 const workflowBound=run.studio_workflow_binding!==undefined,workflowRunRef=useRef({bound:workflowBound,id:run.id,status:run.status,superseded:!!run.superseded_by});workflowRunRef.current={bound:workflowBound,id:run.id,status:run.status,superseded:!!run.superseded_by};
 const [resumePending,setResumePending]=useState(false),[resumeStorageError,setResumeStorageError]=useState(false);
 const continuation=runContinuation(run.engine,run.parameters?.mode),continuationRef=useRef(continuation);continuationRef.current=continuation;
 const identity=JSON.stringify([run.id,run.project_id,run.environment_id,run.directory]);
 const collection=useRef({identity,connected,epoch:0,sequence:0,loaded:false,pending:false});
 const collectionStatus=useRef({identity,status:run.status}),terminalLogRead=useRef(false);
 const [collectionState,setCollectionState]=useState('idle'),[collectionError,setCollectionError]=useState('');
 if(collection.current.identity!==identity||collection.current.connected!==connected){collection.current={identity,connected,epoch:collection.current.epoch+1,sequence:0,loaded:false,pending:false};}
 function clearArtifactPreview(){fileSeq.current++;previewSeq.current++;setSelected('');setText('');setImage('');setStructure(null);setAnalysis(null);setFrame(0);setLoadingFile(false);setFileError('');setFileRange(null);}
 useEffect(()=>{setFiles([]);clearArtifactPreview();setCollectionState('idle');setCollectionError('');return()=>{collection.current.epoch++;collection.current.pending=false;fileSeq.current++;previewSeq.current++;};},[identity]);
 useEffect(()=>{setCollectionState(previous=>previous==='idle'?'idle':'stale');setCollectionError('');},[connected]);
 useEffect(()=>{const previous=collectionStatus.current;collectionStatus.current={identity,status:run.status};if(previous.identity!==identity||previous.status===run.status)return;collection.current.epoch++;collection.current.pending=false;collection.current.loaded=false;setCollectionState('stale');if(terminal(run.status)&&tab==='产物'&&connectedRef.current)void collect(false);},[identity,run.status]);
 // Existing main-process notification means a verified connection was replaced/restored.
 // It invalidates observations only; it never triggers a collect/hash operation.
 useEffect(()=>window.studio?.onEvent(event=>{if(event.method==='studio/workerConnected'){collection.current.epoch++;collection.current.sequence++;collection.current.loaded=false;collection.current.pending=false;clearArtifactPreview();setFiles([]);setCollectionState('idle');setCollectionError('');}}),[]);

 useEffect(()=>{
  fileSeq.current++;previewSeq.current++;workingRef.current=null;setWorking(false);
  setLogState({chunks:[],truncated:false});setFiles([]);setSelected('');setStructure(null);setText('');setImage('');setAnalysis(null);setLoadingFile(false);setFileError('');setResume(false);setTab('日志');resumeAttempt.current=null;setResumePending(false);setResumeKey('');setResumeStorageError(false);
  setFileRange(null);setActionMessage('');setResumeCache(null);setLogEvidenceRange(null);terminalLogRead.current=false;
  if(!workflowBound)try{const cached=localStorage.getItem('studio.resume.'+run.id);setResumeCache(cached);if(cached){const attempt=JSON.parse(cached);if(!attempt||typeof attempt.key!=='string'||!attempt.key||!attempt.parameters||typeof attempt.parameters!=='object'||Array.isArray(attempt.parameters))throw Error('续算请求记录无效，请先人工核对已有草稿');resumeAttempt.current=attempt;setResumePending(true);setResumeKey(attempt.key);setResumeParameters(JSON.stringify(attempt.parameters,null,2));}}catch(e){setResumeStorageError(true);onError(e);}
  setLogObservation(null);let disposed=false,offset=0,applied:{offset:number;text:string}|null=null;
  const reader=new ObservedRead(async()=>{
   let next=offset,text='',eof=false;
   for(let count=0;count<8;count++){
    const chunk=await api<{offset:number;text:string}>('POST','/api/run/log',{run_id:run.id,offset:next});
    if(disposed||!connectedRef.current||collection.current.identity!==identity)return {offset:next,text,eof:false};
    const bytes=chunk.offset-next;next=chunk.offset;text+=chunk.text;eof=bytes===0&&!chunk.text;
    if(eof||bytes<256*1024&&!terminal(workflowRunRef.current.status))break;
   }
   return {offset:next,text,eof};
  },observation=>{
   setLogObservation(observation);const response=observation.value;
   if(response&&response!==applied){applied=response;offset=response.offset;setLogState(previous=>{const appended=appendLogChunks(previous.chunks,response.text);return {chunks:appended.chunks,truncated:previous.truncated||appended.truncated};});if(response.eof&&terminal(workflowRunRef.current.status)){terminalLogRead.current=true;reader.setConnected(false);}}
  },{delay:2000});
  logReader.current=reader;reader.setConnected(connectedRef.current);
  return()=>{disposed=true;reader.dispose();if(logReader.current===reader)logReader.current=null;};
 },[run.id,workflowBound]);
 useEffect(()=>{if(!connected||!terminal(run.status))terminalLogRead.current=false;logReader.current?.setConnected(connected&&!terminalLogRead.current);},[connected,run.status]);
 useEffect(()=>{if(run.status!=='ready')setLock('');},[run.status]);
 async function action(name:string){
  const current=workflowRunRef.current;if(readOnlyRef.current||!mounted.current||!connected||workingRef.current||collection.current.identity!==identity||current.id!==run.id||current.bound&&(name!=='cancel'||!['queued','running'].includes(current.status))||name==='submit'&&(current.superseded||!['draft','ready'].includes(current.status)))return;
  const flight=Symbol();workingRef.current=flight;setWorkingLabel(tr(({validate:'正在验证输入…',submit:'正在提交计算…',cancel:'正在取消并核对作业…',reconcile:'正在核对运行状态…'} as Record<string,string>)[name]||'处理中…'));setWorking(true);
  try{
   if(name==='submit')setLock(run.id);
   const result=await api<Run>('POST','/api/run/'+name,{run_id:run.id});
   if(!mounted.current||workingRef.current!==flight||collection.current.identity!==identity)return;setActionMessage(result.reconciliation?.message||result.cancellation?.message||'');
   await onRefresh();
  }catch(e){
   if(!mounted.current||workingRef.current!==flight||collection.current.identity!==identity)return;onError(e);
   if(name==='submit'){
    try{const latest=await api<Run>('POST','/api/run/status',{run_id:run.id});if(workingRef.current===flight&&latest.status==='ready')setLock('');}catch{}
    await onRefresh();
   }
  }finally{if(workingRef.current===flight){workingRef.current=null;if(mounted.current&&workflowRunRef.current.id===run.id){setWorking(false);if(name==='submit')setLock(current=>current===run.id?'':current);}}}
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
  if(!connected||!mounted.current)return;const key=JSON.stringify([identity,name]);if(fileFlight.current?.key===key&&fileFlight.current.sequence===fileSeq.current)return;
  const seq=++fileSeq.current,flight={key,sequence:seq};fileFlight.current=flight;previewSeq.current++;
  setSelected(name);setStructure(null);setImage('');setText('');setFileRange(null);setFileEvidenceRange(null);setFileError('');setLoadingFile(true);
  try{const r=await api('POST','/api/run/file',{run_id:run.id,name});if(seq!==fileSeq.current)return;setText(r.text||"");setImage(r.image||"");if(Number.isSafeInteger(r.offset)&&Number.isSafeInteger(r.size))setFileRange({offset:r.offset,size:r.size});}
  catch(e){if(seq!==fileSeq.current)return;setFileError(e instanceof Error?e.message:String(e));onError(e);}
  finally{if(fileFlight.current===flight)fileFlight.current=null;if(seq===fileSeq.current)setLoadingFile(false);}
 }
 async function preview(){
  if(!connected||!mounted.current)return;const key=JSON.stringify([identity,selected,frame]);if(previewFlight.current?.key===key&&previewFlight.current.sequence===previewSeq.current)return;
  const seq=++previewSeq.current,name=selected,flight={key,sequence:seq};previewFlight.current=flight;setPreviewLoading({identity,sequence:seq});
  try{const value=await api('POST','/api/inspect',{project_id:run.project_id,environment_id:run.environment_id,path:run.directory+'/results/'+name,kind:'structure',frame});if(seq!==previewSeq.current)return;setStructure(value);setTab('结构');}catch(e){if(seq===previewSeq.current)onError(e);}finally{if(previewFlight.current===flight)previewFlight.current=null;if(seq===previewSeq.current)setPreviewLoading(null);}
 }
 async function createResume(){
  if(readOnlyRef.current||!mounted.current||workflowRunRef.current.bound||!connectedRef.current||collection.current.identity!==identity||workingRef.current||resumeStorageError)return;
  if(!continuationRef.current.allowed){onError(Error(tr(continuationRef.current.reason!)));return;}
  const flight=Symbol();workingRef.current=flight;setWorkingLabel(tr('正在创建续算草稿…'));setWorking(true);
  try{if(!resumeAttempt.current){const parameters=JSON.parse(resumeParameters);if(!parameters||typeof parameters!=='object'||Array.isArray(parameters))throw Error('续算参数必须是 JSON 对象');resumeAttempt.current={key:resumeKey||crypto.randomUUID(),parameters};}const attempt=resumeAttempt.current;localStorage.setItem('studio.resume.'+run.id,JSON.stringify(attempt));setResumePending(true);const created=await api<Run>('POST','/api/run/resume',{run_id:run.id,parameters:{...attempt.parameters,idempotency_key:attempt.key}});localStorage.removeItem('studio.resume.'+run.id);if(!mounted.current||workingRef.current!==flight||collection.current.identity!==identity)return;resumeAttempt.current=null;setResumePending(false);setResume(false);onOpenRun?.(created.id);await onRefresh();}catch(e){if(mounted.current&&workingRef.current===flight&&collection.current.identity===identity)onError(e);}finally{if(workingRef.current===flight){workingRef.current=null;if(workflowRunRef.current.id===run.id)setWorking(false);}}
 }
 async function auxiliaryAction(label:string,read:()=>Promise<void>){if(!mounted.current||!connectedRef.current||auxiliaryRef.current)return;auxiliaryRef.current=true;setAuxiliary({identity,label});try{await read();}catch(error){if(mounted.current&&collection.current.identity===identity)onError(error);}finally{auxiliaryRef.current=false;if(mounted.current&&collection.current.identity===identity)setAuxiliary(null);}}
 function discardCorruptResume(){
  if(!window.confirm(tr('我已核对现有作业和草稿；清除损坏的本地续算记录后，需要重新填写并人工创建请求。继续？')))return;
  try{localStorage.removeItem('studio.resume.'+run.id);resumeAttempt.current=null;setResumePending(false);setResumeKey('');setResumeStorageError(false);setResumeCache(null);}catch(e){onError(e);}
 }
 const resultTab=['产物','曲线','结构','评估'].includes(tab),primaryTab=resultTab?'结果':tab==='验证'?'概览':tab;
 const partialFile=fileRange&&fileRange.offset<fileRange.size?<p className="notice" role="status" data-testid="artifact-partial-preview">{tr('部分预览：仅显示文件前缀，曲线不代表完整结果。')} {fileRange.offset.toLocaleString()} / {fileRange.size.toLocaleString()} bytes</p>:null;
 return <div className="run-detail">
  <div className="detail-heading"><div><span className="eyebrow">{run.engine}</span><h2>{run.name}</h2><span className="mono muted">{run.id}</span></div><Badge status={run.status}/></div>
  {workflowBound&&<div className="notice" data-testid="tool-workflow-run-readonly"><span>{tr('此运行由工具组步骤管理；审阅与执行请返回所属步骤。')}</span>{onOpenWorkflow&&<button className="button" data-testid="open-tool-workflow-step" onClick={()=>onOpenWorkflow(run.id)}>{tr('返回所属工具组步骤')}</button>}</div>}
  {!workflowBound&&run.superseded_by&&<div className="notice">{tr('此草稿已被审阅版本替换')}<button className="button" onClick={()=>onOpenRun?.(run.superseded_by!)}>{tr('打开审阅版本')}</button></div>}
  {readOnly&&<p className="notice" role="status" data-testid="run-readonly-observation">{tr('运行记录可查看；提交、续算等操作需匹配原服务与权限。')}</p>}
  {resumeStorageError&&<div className="notice" role="alert">{tr('续算请求记录无法读取；先核对已有草稿，禁止自动创建新请求。')}{resumeCache!==null&&<details><summary>{tr('查看本地续算记录')}</summary><pre>{resumeCache}</pre></details>}<button className="button" disabled={working} onClick={discardCorruptResume}>{tr('已核对，清除损坏记录')}</button></div>}
  {actionMessage&&<div className="notice" role="status">{actionMessage}</div>}
  <LoadingFeedback busy={working||collectionState==='loading'||loadingFile||previewLoading?.identity===identity&&previewLoading.sequence===previewSeq.current||auxiliary?.identity===identity} label={working?workingLabel:auxiliary?.identity===identity?auxiliary.label:loadingFile?tr('正在读取文件…'):previewLoading?.identity===identity&&previewLoading.sequence===previewSeq.current?tr('正在读取结构预览…'):tr('正在读取产物列表…')}/>
  <div className="run-actions">
   {!workflowBound&&['draft','ready'].includes(run.status)&&<><button className="button" disabled={readOnly||!connected||working||!['draft','ready'].includes(run.status)} onClick={()=>void action('validate')}><ShieldCheck size={14}/>{tr("验证")}</button>
   <button className="button primary" disabled={readOnly||!connected||working||!['draft','ready'].includes(run.status)||!!run.superseded_by||lock===run.id} onClick={()=>void action('submit')}><Play size={14}/>{tr("提交计算")}</button></>}
   {run.engine.startsWith('nep.')&&<button className="button" disabled={!connected} onClick={()=>void auxiliaryAction(tr('正在读取评估指标…'),async()=>{const r=await api('POST','/api/inspect',{project_id:run.project_id,environment_id:run.environment_id,path:run.directory+'/results',kind:'regression'});if(collection.current.identity===identity){setAnalysis(r);setTab('评估');}})}>{tr("评估指标")}</button>}
   {(workflowBound?['queued','running']:['queued','running','unknown']).includes(run.status)&&<button className="button" disabled={readOnly||!connected||working||!['queued','running','unknown'].includes(run.status)} onClick={()=>void action('cancel')}><Square size={13}/>{tr("取消")}</button>}
   {!workflowBound&&run.status==='unknown'&&<button className="button" disabled={readOnly||!connected||working} onClick={()=>void action('reconcile')}>{tr('核对停止状态')}</button>}
   <button className="button" disabled={!connected||collectionState==='loading'} onClick={()=>void collect()}><Files size={14}/>{tr("收集产物")}</button>
   {!workflowBound&&<button className="button" title={continuation.reason?tr(continuation.reason):undefined} disabled={readOnly||!connected||!continuation.allowed||working||resumeStorageError||!!run.superseded_by||!['succeeded','failed','cancelled'].includes(run.status)} onClick={()=>{if(readOnlyRef.current||workflowRunRef.current.bound)return;if(!resumeAttempt.current)setResumeKey(crypto.randomUUID());setResume(true);}}><RotateCw size={14}/>{tr("续算")}</button>}
   <button className="icon-button" title={tr("导出不可变输入与复现记录 ZIP")} disabled={!connected} aria-label={tr("导出不可变输入与复现记录 ZIP")} onClick={()=>void auxiliaryAction(tr('正在导出运行记录…'),async()=>{await invoke('export',{run});})}><Download size={16}/></button>
  </div>
  <div className="detail-meta"><span>{tr('GPU 编号')} {run.gpu}</span><span>{tr("上限")}{run.max_seconds}s</span><span>{tr("输入已快照")}</span><span>{new Date(run.created_at*1000).toLocaleString()}</span></div>
  <div className="subtabs" role="tablist">{['概览','日志','结果','输入'].map(label=><button key={label} role="tab" aria-selected={primaryTab===label} className={primaryTab===label?'active':''} onClick={()=>{if(label==='结果'){if(!resultTab)setTab('产物');void collect(false);}else setTab(label);}}>{tr(label)}</button>)}</div>
  {tab==='日志'&&<>{(!connected||logObservation?.error)&&<div className="notice" role="status" data-testid="run-log-observation"><div><strong>{tr(!connected?'日志连接暂不可用':logObservation?.paused?'日志连续读取失败，已暂停自动查询。':'日志读取失败；保留最近输出。')}</strong>{logObservation?.observedAt&&<p>{tr('最近观测')} · {new Date(logObservation.observedAt).toLocaleString()}</p>}</div><button className="button" disabled={!connected||logObservation?.pending} onClick={()=>void logReader.current?.refresh()}>{tr('重新查询')}</button></div>}<pre className="console" onMouseUp={e=>setLogEvidenceRange(evidencePreSelection(e.currentTarget))}>{logState.chunks.length===0?tr('尚无进程输出。提交后日志会持续更新。'):<>{logState.truncated&&<span>{tr('…（较早输出已省略）')}{'\n'}</span>}{logState.chunks.map((chunk,index)=><span key={index}>{chunk}</span>)}</>}</pre>{connected&&!logState.truncated&&logState.chunks.length>0&&<EvidenceSelection source={{kind:'log',runId:run.id,target:'run'}} text={logState.chunks.join('')} range={logEvidenceRange}/>}</>}
  {(tab==='概览'||tab==='验证')&&<div className="validation-report run-overview"><dl><div><dt>{tr('状态')}</dt><dd><Badge status={run.status}/></dd></div><div><dt>{tr('计算环境')}</dt><dd>{run.environment_id}</dd></div><div><dt>{tr('计算项目')}</dt><dd>{run.project_id}</dd></div><div><dt>{tr('工作目录')}</dt><dd>{run.directory}</dd></div></dl><h4>{tr('验证范围')}</h4><Badge status={run.validation.status}/><p>{run.validation.scope||run.validation.message}</p><details><summary>{tr('验证详情')}</summary><pre>{JSON.stringify(run.validation,null,2)}</pre></details>{run.error&&<><h4>{tr('错误')}</h4><pre>{run.error}</pre></>}{run.exit&&<><h4>{tr('退出状态')}</h4><pre>{JSON.stringify(run.exit,null,2)}</pre></>}</div>}
  {tab==='输入'&&<div className="input-record"><h4>{tr("实际执行命令")}</h4><pre>{run.command.join(' ')}</pre><h4>{tr("输入来源")}</h4><pre>{JSON.stringify(run.inputs,null,2)}</pre><h4>{tr("科学参数")} {run.continuation_metadata?.parameter_scope==='inherited_unverified'&&<Tooltip content={tr("这些值继承自父作业，需按当前实际输入复核；checkpoint 速度尚未检查。")}><span className="tag">{tr("继承值")}</span></Tooltip>}</h4><pre>{JSON.stringify(run.parameters||{},null,2)}</pre><p className="muted">{tr("完整快照与哈希保存在 reproduction.json；原始输入不会被覆盖。")}</p></div>}
  {resultTab&&<div className="result-subtabs" role="group" aria-label={tr('结果视图')}>{[['产物','文件'],['曲线','曲线'],['结构','结构'],['评估','评估']].filter(([key])=>key!=='评估'||run.engine.startsWith('nep.')).map(([key,label])=><button key={key} aria-pressed={tab===key} disabled={key==='曲线'?!selected:key==='结构'?!structure:key==='评估'?!analysis:false} onClick={()=>setTab(key)}>{tr(label)}</button>)}</div>}
  {(tab==='产物'||tab==='结构')&&<><div role="status" data-testid="artifact-observation">{tr(collectionState==='loading'?'正在读取产物列表…':collectionState==='error'?'产物列表读取失败；可点击收集产物重试。':collectionState==='stale'?'运行或连接已变化；产物列表需重新读取。':collectionState==='passed'&&!files.length?'当前结果目录为空。':'')}{collectionError&&' '+collectionError}</div><div className="artifacts-layout"><div className="file-list">{files.length?files.map(f=><button key={f.name} className={selected===f.name?'active':''} disabled={!connected} onClick={()=>void openFile(f.name)}><Files size={13}/><span>{f.name}</span><small>{(f.size/1024).toFixed(1)} KB</small></button>):<p className="muted">{tr("点击“收集产物”读取实际文件。")}</p>}</div><div className="artifact-preview">
   {selected&&<div className="toolbar"><span>{selected}</span><button className="button" onClick={()=>setTab('曲线')}>{tr("曲线")}</button>{/\.(xyz|traj)$/.test(selected)&&<><input className="frame-input" type="number" min={0} aria-label="frame" value={frame} onChange={e=>setFrame(Number(e.target.value))}/><button className="button" disabled={!connected} onClick={()=>void preview()}>{tr("结构预览")}</button></>}</div>}
   {partialFile}{image?<img className="artifact-image" src={image} alt={selected}/>:structure&&tab==='结构'?<Structure data={structure} viewKey={JSON.stringify([identity,selected])}/>:<><CodeEditor onLineSelection={setFileEvidenceRange} value={loadingFile?tr('读取中…'):fileError||text||tr('选择一个产物查看原始输出')} onChange={()=>{}} readOnly language="plaintext"/>{connected&&!loadingFile&&!fileError&&selected&&text&&<EvidenceSelection source={{kind:'artifact',runId:run.id,name:selected,target:'run'}} text={text} range={fileEvidenceRange}/>}</>}
  </div></div></>}
  {tab==='评估'&&<pre className="report">{JSON.stringify(analysis,null,2)}</pre>}
  {tab==='曲线'&&<><button className="button back" onClick={()=>setTab('产物')}>{tr("返回产物")}</button>{partialFile}<Chart text={text} name={selected} viewKey={JSON.stringify([identity,selected])}/></>}
  {!workflowBound&&resume&&<Modal title={tr("从实际 checkpoint 创建续算")} onClose={()=>setResume(false)}><p className="muted">{tr("GPUMD 填写 checkpoint_files 与 continuation_run_in；HotPP 填写 checkpoint_files、checkpoint 和 continuation_config。PyDyn 填写 continuation_script，采样另填 paired_manifest。续算输入必须保持原物理参数与状态。")}</p><textarea className="json-input" disabled={readOnly||!connected||working||resumePending} value={resumeParameters} onChange={e=>setResumeParameters(e.target.value)}/><button className="button primary" disabled={readOnly||!connected||working||!continuation.allowed} onClick={()=>void createResume()}>{tr(resumePending?'重试同一续算请求':'创建续算草稿')}</button>{resumePending&&<p role="status">{tr('响应未确认；保留原参数与幂等键，重试只核对同一草稿，不提交计算。')}</p>}</Modal>}
 </div>;
}
