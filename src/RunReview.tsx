import {useEffect,useState} from 'react';
import {Play,FileCode2,ShieldCheck} from 'lucide-react';
import {api,type Run,type Environment} from './types';
import {CodeEditor} from './widgets';
import RunDetail from './RunDetail';
import {t} from './i18n';

export function taskModule(engine:string){
 if(engine.endsWith('.sampling'))return t('增强采样');
 if(engine.startsWith('nep.'))return t('NEP');
 if(engine.startsWith('hotpp.'))return t('HotPP');
 if(engine==='pygas.build'||engine==='bias.validate')return t('Bias 开发');
 if(engine.startsWith('pygas.'))return t('结果分析');
 return t('分子动力学');
}
export default function RunReview({run,environments,onRefresh,onError,onReplace,theme}:{run:Run;environments:Environment[];onRefresh:()=>void;onError:(e:unknown)=>void;onReplace:(r:Run)=>void;theme:string}){
 const [name,setName]=useState(run.name),[environment,setEnvironment]=useState(run.environment_id),[gpu,setGpu]=useState(run.gpu),[seconds,setSeconds]=useState(run.max_seconds);
 const [inputs,setInputs]=useState<Record<string,string>>({}),[parameters,setParameters]=useState('{}'),[selected,setSelected]=useState(''),[source,setSource]=useState(''),[editable,setEditable]=useState(false),[inputInfo,setInputInfo]=useState<any>(null),[edits,setEdits]=useState<Record<string,string>>({}),[working,setWorking]=useState(false);
 const [step,setStep]=useState('');
 useEffect(()=>{
  setName(run.name);setEnvironment(run.environment_id);setGpu(run.gpu);setSeconds(run.max_seconds);
  setInputs(Object.fromEntries(Object.keys(run.inputs).map(key=>[key,run.directory+'/simulation/'+key])));
  setParameters(JSON.stringify(run.parameters||{},null,2));setSelected('');setSource('');setEdits({});setInputInfo(null);
 },[run.id]);
 async function open(name:string){
  setSelected(name);setEditable(false);setSource('');setInputInfo(null);
  try{const value=await api('POST','/api/run/input',{run_id:run.id,name});setInputInfo(value);setEditable(value.editable);setSource(edits[name]??value.text??'');}
  catch(e){onError(e);}
 }
 async function execute(){
  if(working)return;setWorking(true);
  try{
   setStep(t('保存审阅后的输入'));
   const revised=await api<Run>('POST','/api/run/revise',{run_id:run.id,spec:{name,environment_id:environment,gpu,max_seconds:seconds,inputs,parameters:JSON.parse(parameters),idempotency_key:crypto.randomUUID()},edits});
   setStep(t('验证输入与环境'));
   const validated=await api<Run>('POST','/api/run/validate',{run_id:revised.id});
   if(validated.status!=='ready'||validated.validation.status!=='passed'){onReplace(validated);throw Error(validated.validation.message||t('验证未通过，计算没有提交'));}
   setStep(t('提交计算'));
   const submitted=await api<Run>('POST','/api/run/submit',{run_id:validated.id});onReplace(submitted);onRefresh();
  }catch(e){onError(e);onRefresh();}finally{setWorking(false);setStep('');}
 }
 if(!['draft','ready'].includes(run.status))return <RunDetail run={run} onRefresh={onRefresh} onError={onError} onOpenRun={id=>{void api<Run>('POST','/api/run/status',{run_id:id}).then(onReplace).catch(onError);}}/>;
 return <div className="task-review page" data-testid="task-review">
  <div className="page-heading"><div><span className="eyebrow">{t(taskModule(run.engine))} · {run.engine}</span><h1>{t('审阅计算参数')}</h1><p>{t('Agent 已准备任务草稿。检查输入后，点击执行才会开始验证与计算。')}</p></div><span className="tag">{t('待你审阅')}</span></div>
  <ol className="run-flow">{['输入与科学条件','审阅参数','实际环境验证','提交与监控'].map(v=><li key={v}>{t(v)}</li>)}</ol>\n  <section className="card"><h3>{t('任务与资源')}</h3>
   <div className="form-row"><label>{t('计算名称')}<input disabled={working} value={name} onChange={e=>setName(e.target.value)}/></label><label>{t('计算环境')}<select disabled={working} value={environment} onChange={e=>setEnvironment(e.target.value)}>{environments.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label></div>
   <div className="form-row"><label>GPU<input disabled={working} type="number" min={0} value={gpu} onChange={e=>setGpu(Number(e.target.value))}/></label><label>{t('时长上限 · s')}<input disabled={working} type="number" min={1} value={seconds} onChange={e=>setSeconds(Number(e.target.value))}/></label></div>
   <label>{t('科学参数 · JSON')}<textarea disabled={working} className="parameter-json" value={parameters} onChange={e=>setParameters(e.target.value)}/></label>
  </section>
  <section className="card"><h3><FileCode2 size={15}/> {t('实际输入文件')}</h3><p>{t('默认使用草稿的不可变快照。可替换来源路径，或打开文本文件直接修改。')}</p>
   {Object.entries(inputs).map(([file,path])=><div className="review-input" key={file}><button className="button" disabled={working||path!==run.directory+'/simulation/'+file} onClick={()=>void open(file)}>{file}{file in edits?' *':''}</button><input disabled={working} value={path} aria-label={file} onChange={e=>{setInputs({...inputs,[file]:e.target.value});const next={...edits};delete next[file];setEdits(next);if(selected===file){setSelected('');setSource('');}}}/></div>)}
   {selected&&<div className="review-source"><div className="toolbar"><span>{selected}</span><small className="mono">{inputInfo?.sha256?.slice(0,16)}</small></div>
    {editable?<CodeEditor value={source} onChange={value=>{if(!working){setSource(value);setEdits({...edits,[selected]:value});}}} language={/\.py$/.test(selected)?'python':/\.ya?ml$/.test(selected)?'yaml':'plaintext'} theme={theme}/>:<p className="muted">{inputInfo?.reason||t('读取输入中…')}</p>}
   </div>}
  </section>
  <div className="review-execute"><div><ShieldCheck size={17}/><span>{t('修改会生成新的输入快照；验证失败时不会提交计算。')}</span></div><button className="button primary" data-testid="execute-reviewed" disabled={working} onClick={()=>void execute()}><Play size={15}/>{working?step:t('确认并执行')}</button></div>
  {run.validation.status==='failed'&&<pre className="report">{run.validation.message}</pre>}
 </div>;
}
