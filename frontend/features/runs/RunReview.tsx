import LoadingFeedback from '../../ui/LoadingFeedback';
import Tooltip from "../../ui/Tooltip";
import {useEffect,useRef,useState} from 'react';
import {Play,FileCode2,ShieldCheck} from 'lucide-react';
import {api} from '../../api/worker';
import {type Run} from '../../../contracts/dto/runs';
import {type Environment} from '../../../contracts/dto/compute';
import {CodeEditor} from "../../ui/widgets";
import RunDetail from './RunDetail';
import {flattenParameters,setParameter} from "../../../contracts/workflows/task-fields.mjs";

import {ParameterFields} from "../../ui/ParameterFields";
import {t} from "../../ui/i18n";
import {RunReviewDraft,reviewDraftIdentity,reviewValues,type ReviewValues} from './run-review-draft.mjs';

export function taskModule(engine:string){
 if(engine.endsWith('.sampling'))return t('增强采样');
 if(engine.startsWith('nep.'))return t('NEP');
 if(engine.startsWith('hotpp.'))return t('HotPP');
 if(engine==='pygas.build'||engine==='bias.validate')return t('Bias 开发');
 if(engine.startsWith('pygas.'))return t('结果分析');
 return t('分子动力学');
}
export default function RunReview({run,draftScope,legacyDraftScopes=[],connected=true,environments,onRefresh,onError,onReplace,onOpenWorkflow,theme}:{run:Run;draftScope:string;legacyDraftScopes?:string[];connected?:boolean;environments:Environment[];onRefresh:()=>void|Promise<void>;onError:(e:unknown)=>void;onReplace:(r:Run)=>void;onOpenWorkflow?:(runId:string)=>void;theme:string}){
 const draftRef=useRef<RunReviewDraft|null>(null),[,redraw]=useState(0),identity=reviewDraftIdentity(draftScope,run),baseline=JSON.stringify(reviewValues(run));
 if(!draftRef.current||draftRef.current.identity!==identity||draftRef.current.fingerprint!==baseline||draftRef.current.inputHashes!==JSON.stringify(run.inputs))draftRef.current=new RunReviewDraft(draftScope,run,()=>window.localStorage,legacyDraftScopes);
 const draft=draftRef.current,{name,environment,gpu,seconds,inputs,parameters,edits}=draft.values;
 function patch(changes:Partial<ReviewValues>){draft.stage(changes);redraw(value=>value+1);}
 const [selected,setSelected]=useState(''),[source,setSource]=useState(''),[editable,setEditable]=useState(false),[inputInfo,setInputInfo]=useState<any>(null),[working,setWorking]=useState(false);
 const [opening,setOpening]=useState<{identity:string;sequence:number}|null>(null);
 const [step,setStep]=useState(''),[pendingRun,setPendingRun]=useState<Run|null>(null);
 const keyRef=useRef({sig:'',key:''}),openSeq=useRef(0),executing=useRef<object|null>(null),mounted=useRef(true),connectedRef=useRef(connected);connectedRef.current=connected;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const workflowBound=run.studio_workflow_binding!==undefined,workflowBoundRef=useRef(workflowBound);workflowBoundRef.current=workflowBound;
 useEffect(()=>{
  openSeq.current++;executing.current=null;setWorking(false);setPendingRun(null);setStep('');keyRef.current={sig:'',key:''};
  setSelected('');setSource('');setEditable(false);setInputInfo(null);
  return()=>{openSeq.current++;};
 },[identity,baseline]);
 useEffect(()=>{const beforeUnload=(event:BeforeUnloadEvent)=>{if(draft.error&&(draft.dirty||draft.conflict)){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload);},[draft]);
 async function open(name:string){
  const seq=++openSeq.current;setOpening({identity,sequence:seq});
  setSelected(name);setEditable(false);setSource('');setInputInfo(null);
  try{const value=await api('POST','/api/run/input',{run_id:run.id,name});if(seq!==openSeq.current)return;setInputInfo(value);setEditable(value.editable);setSource(edits[name]??value.text??'');}
  catch(e){if(seq!==openSeq.current)return;setInputInfo({reason:e instanceof Error?e.message:String(e)});onError(e);}finally{if(seq===openSeq.current)setOpening(null);}
 }
 async function execute(){
  if(workflowBoundRef.current||executing.current||draft.conflict||draftRef.current!==draft||!connected)return;const transaction={};executing.current=transaction;setWorking(true);
  const current=()=>mounted.current&&draftRef.current===draft&&!workflowBoundRef.current;
  let revision:Run|null=null;
  try{
   const parsed=JSON.parse(parameters);
   const sig=JSON.stringify([run.id,name,environment,gpu,seconds,inputs,parsed,edits]);
   if(keyRef.current.sig!==sig)keyRef.current={sig,key:crypto.randomUUID()};
   setStep(t('保存审阅后的输入'));
   const revised=await api<Run>('POST','/api/run/revise',{run_id:run.id,spec:{name,environment_id:environment,gpu,max_seconds:seconds,inputs,parameters:parsed,idempotency_key:keyRef.current.key},edits});
   revision=revised;if(!current()||revised.studio_workflow_binding!==undefined)return;if(!connectedRef.current){setPendingRun(revised);return;}
   setStep(t('验证输入与环境'));
   const validated=await api<Run>('POST','/api/run/validate',{run_id:revised.id});
   revision=validated;if(!current()||validated.studio_workflow_binding!==undefined)return;if(!connectedRef.current){setPendingRun(validated);return;}
   if(validated.status!=='ready'||validated.validation.status!=='passed'){onReplace(validated);throw Error(validated.validation.message||t('验证未通过，计算没有提交'));}
   setStep(t('提交计算'));
   let submitted:Run;
   try{submitted=await api<Run>('POST','/api/run/submit',{run_id:validated.id});}
   catch(e){
    revision={...validated,status:'unknown'};if(current())setPendingRun(revision);
    if(current()&&connectedRef.current)try{const observed=await api<Run>('POST','/api/run/status',{run_id:validated.id});revision=observed;if(current())setPendingRun(observed);}catch{}
    throw e;
   }
   if(current()){draft.discard();onReplace(submitted);await onRefresh();}
  }catch(e){if(current()){if(revision)setPendingRun(revision);onError(e);await onRefresh();}}finally{if(executing.current===transaction)executing.current=null;if(current()){setWorking(false);setStep('');}}
 }
 if(workflowBound)return <RunDetail connected={connected} run={run} onRefresh={onRefresh} onError={onError} onOpenWorkflow={onOpenWorkflow} onOpenRun={id=>void api<Run>('POST','/api/run/status',{run_id:id}).then(onReplace).catch(onError)}/>;
 if(pendingRun)return <><div className="notice" role="status">{t('执行反馈中断；保留原修订任务，核对状态后再操作。')}<button className="button" disabled={!connected} onClick={()=>void api<Run>('POST','/api/run/status',{run_id:pendingRun.id}).then(setPendingRun).catch(onError)}>{t('核对状态')}</button></div><RunDetail connected={connected} run={pendingRun} onRefresh={async()=>{setPendingRun(await api<Run>('POST','/api/run/status',{run_id:pendingRun.id}));await onRefresh();}} onError={onError} onOpenWorkflow={onOpenWorkflow} onOpenRun={id=>void api<Run>('POST','/api/run/status',{run_id:id}).then(onReplace).catch(onError)}/></>;
 if(!working&&!['draft','ready'].includes(run.status))return <RunDetail connected={connected} run={run} onRefresh={onRefresh} onError={onError} onOpenWorkflow={onOpenWorkflow} onOpenRun={id=>{void api<Run>('POST','/api/run/status',{run_id:id}).then(onReplace).catch(onError);}}/>;
 return <div className="task-review page" data-testid="task-review">
  <div className="page-heading"><div><span className="eyebrow">{t(taskModule(run.engine))} · {run.engine}</span><h1>{t('审阅计算参数')}</h1></div><span className="tag">{t('待你审阅')}</span></div>
  <LoadingFeedback busy={working||opening?.identity===identity&&opening.sequence===openSeq.current} label={working?step||t('处理中…'):t('读取输入中…')}/>
  {(draft.dirty||draft.conflict||draft.error)&&<div className="notice" role="status" data-testid="run-review-draft"><div>{t(draft.conflict?'原始记录已变化或本地草稿无法读取；旧草稿保留，未自动套用。':draft.error?'本地持久化失败；修改仅保留在当前界面会话，关闭界面前请重试保存。':'本地编辑草稿已保留，尚未提交；切换页面后可继续编辑。')}{draft.conflict&&draft.saved&&<details><summary>{t('查看原草稿')}</summary><pre>{JSON.stringify(draft.saved.values,null,2)}</pre></details>}</div><button className="button" disabled={working} data-testid="discard-run-review-draft" onClick={()=>{if(!window.confirm(t('丢弃本地编辑并恢复当前运行记录？')))return;if(draft.discard()){setSelected('');setSource('');setEditable(false);setInputInfo(null);openSeq.current++;}redraw(value=>value+1);}}>{t('丢弃本地草稿')}</button>{draft.error&&!draft.conflict&&<><button className="button" onClick={()=>patch({})}>{t('重试保存草稿')}</button><button className="button" disabled={working} onClick={()=>{if(window.confirm(t('将丢弃其他运行的本地未提交编辑；此操作不修改运行记录。继续？'))&&draft.clearOtherDrafts())patch({});}}>{t('清理其他本地审阅草稿')}</button></>}</div>}
  <ol className="run-flow">{['输入与科学条件','审阅参数','实际环境验证','提交与监控'].map(v=><li key={v}>{t(v)}</li>)}</ol>
  <section className="card"><h3><Tooltip content={t('任务草稿已准备。检查输入后，点击执行才会开始验证与计算。')}>{t('任务与资源')}</Tooltip></h3>
   <div className="form-row"><label>{t('计算名称')}<input disabled={working||draft.conflict} value={name} onChange={e=>patch({name:e.target.value})}/></label><label>{t('计算环境')}<select disabled={working||draft.conflict} value={environment} onChange={e=>patch({environment:e.target.value})}>{environments.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label></div>
   <div className="form-row"><label>GPU<input disabled={working||draft.conflict} type="number" min={0} value={gpu} onChange={e=>patch({gpu:Number(e.target.value)})}/></label><label>{t('时长上限 · s')}<input disabled={working||draft.conflict} type="number" min={1} value={seconds} onChange={e=>patch({seconds:Number(e.target.value)})}/></label></div>
   <h4>{t('科学参数')} {run.continuation_metadata?.parameter_scope==='inherited_unverified'&&<Tooltip content={t('这些值继承自父作业，需按当前实际输入复核；checkpoint 速度尚未检查。参数仍可编辑。')}><span className="tag">{t('继承值')}</span></Tooltip>}</h4><ParameterFields fields={flattenParameters(JSON.parse(parameters))} parameters={JSON.parse(parameters)} disabled={working||draft.conflict} onError={onError} onChange={(key,value)=>patch({parameters:JSON.stringify(setParameter(JSON.parse(parameters),key,value))})}/>
  </section>
  <section className="card"><h3><FileCode2 size={15}/> {t('实际输入文件')}</h3><p>{t('默认使用草稿的不可变快照。可替换来源路径，或打开文本文件直接修改。')}</p>
   {Object.entries(inputs).map(([file,path])=><div className="review-input" key={file}><button className="button" disabled={working||path!==run.directory+'/simulation/'+file} onClick={()=>void open(file)}>{file}{file in edits?' *':''}</button><input disabled={working||draft.conflict} value={path} aria-label={file} onChange={e=>{if(file in edits&&!window.confirm(t('修改来源路径将丢弃该文件已编辑的内容，是否继续？')))return;const next={...edits};delete next[file];patch({inputs:{...inputs,[file]:e.target.value},edits:next});if(selected===file){openSeq.current++;setSelected('');setSource('');}}}/></div>)}
   {selected&&<div className="review-source"><div className="toolbar"><span>{selected}</span><small className="mono">{inputInfo?.sha256?.slice(0,16)}</small></div>
    {editable?<CodeEditor value={source} readOnly={working||draft.conflict} onChange={value=>{if(!working&&!draft.conflict){setSource(value);patch({edits:{...edits,[selected]:value}});}}} language={/\.py$/.test(selected)?'python':/\.ya?ml$/.test(selected)?'yaml':'plaintext'} theme={theme}/>:<p className="muted">{inputInfo?.reason||t('读取输入中…')}</p>}
   </div>}
  </section>
  <div className="review-execute"><div><ShieldCheck size={17}/><span>{t('修改会生成新的输入快照；验证失败时不会提交计算。')}</span></div><button className="button primary" data-testid="execute-reviewed" disabled={working||draft.conflict||!connected||!environment||!(seconds>=1)||!(gpu>=0)} onClick={()=>void execute()}><Play size={15}/>{working?step:t('确认并执行')}</button></div>
  {run.validation.status==='failed'&&<pre className="report" role="alert">{run.validation.message}</pre>}
 </div>;
}
