import ActionBar from '../../ui/ActionBar';
import Field from '../../ui/Field';
import Button from '../../ui/Button';
import Notice from '../../ui/Notice';
import Disclosure from '../../ui/Disclosure';
import {useEffect,useRef,useState} from 'react';
import {clearSessionDraft,readSessionDraft,removeSessionDraftsWithUndo,useSessionDraft,writeSessionDraft} from '../../ui/session-drafts';
import {UNDO_TOAST_DURATION,useToast} from '../../ui/Toast';
import {ArrowUpRight,GitBranch,CheckCircle2,Save,Sparkles,Pin} from 'lucide-react';
import {tools,tasks,createPlan,planPrompt} from "./workflow-catalog.mjs";
import {type Plan} from "../../../contracts/workflows/plan.mjs";

import {invoke} from '../../api/studio';
import {t} from "../../ui/i18n";
import Tooltip from '../../ui/Tooltip';
export function TaskCards({onOpen}:{onOpen:(id:string)=>void}){
 return <div className="task-cards" data-testid="task-cards">{tasks.map(task=><button className="task-card" key={task.id} onClick={()=>onOpen(task.id)}><div><GitBranch size={20}/><ArrowUpRight size={15}/></div><h3>{t(task.title)}</h3><p>{t(task.summary)}</p>{task.steps.some(s=>s.required&&s.planned)&&<small>{t('包含待接入的核心能力')}</small>}</button>)}</div>;
}
export function Relations({onTool,onTask}:{onTool:(id:string)=>void;onTask:(id:string)=>void}){
 return <div className="relations"><div className="relation-flow"><span>{t('任务目标 / 用户提供的输入')}</span><ArrowUpRight/><span>{t('Agent 编排与参数草稿')}</span><ArrowUpRight/><span>{t('用户审阅 → 验证 → 执行')}</span></div><div className="relation-tools">{tools.map(tool=><button key={tool.id} onClick={()=>onTool(tool.id)}><strong>{t(tool.name)}</strong><small>{tool.capabilities.map(value=>t(value)).join(' · ')}</small></button>)}</div><div className="relation-flow"><span>{t('数据资产与来源记录')}</span><ArrowUpRight/><span>{t('分析 / DFT 复核请求 / 复训')}</span><ArrowUpRight/><span>{t('回到下一轮任务')}</span></div><TaskCards onOpen={onTask}/></div>;
}
export function ToolPage({id,onTask,onNavigate,onPrepare,canPrepare,pinned=false,onTogglePin}:{id:string;pinned?:boolean;onTogglePin?:(id:string)=>void;onTask:(id:string)=>void;onNavigate:(id:string)=>void;onPrepare:(id:string)=>void;canPrepare:boolean}){
 const tool=tools.find(v=>v.id===id)!;if(!tool)return null;
 return <div className="page tool-page"><div className="page-heading"><h1><Tooltip content={t(tool.description)}>{t(tool.name)}</Tooltip></h1>
  {onTogglePin&&<Button type="button"  data-testid="pin-tool" aria-pressed={pinned} onClick={()=>onTogglePin(id)}>
   <Pin size={15} aria-hidden="true"/>{t('固定到常用工具')}
  </Button>}</div><Notice compact announce={false} >{t(tool.id==='hamiltonian'?(canPrepare?'在任务草稿中选择输入文件。训练、评估、重构的 prediction 分别为 0、1、2。':'连接作业服务并打开项目后即可准备 HotHam 任务。'):tool.status==='planned'?'尚待接入：可编排计划，当前无法执行此工具。':'部分能力已接入；每次计算仍需在注册环境中验证。')}</Notice><div className="tool-capabilities">{id!=='hamiltonian'&&tool.capabilities.map(v=><span className="tag" key={v}>{t(v)}</span>)}</div><div className="button-row">{tool.page!==tool.id||['training','assets'].includes(id)?<Button  onClick={()=>onNavigate(tool.page)}>{t('打开已接入功能')}</Button>:null}{id==='hamiltonian'&&tool.engines.map((engine,index)=><Button key={engine} disabled={!canPrepare} onClick={()=>onPrepare(engine)}>{t(tool.capabilities[index])}</Button>)}{id!=='hamiltonian'&&tool.engines.length>0&&<Disclosure className="tool-direct" summary={<>{t('直接准备引擎输入（高级）')}</>}><div className="button-row">{tool.engines.map(engine=><Button  key={engine} disabled={!canPrepare} onClick={()=>onPrepare(engine)}>{engine}</Button>)}</div></Disclosure>}</div><div className="section-heading"><h3>{t('这个工具参与的任务')}</h3></div><div className="tool-task-links">{tasks.filter(task=>task.tools.includes(id)).map(task=><button key={task.id} onClick={()=>onTask(task.id)}><GitBranch size={15}/><span>{t(task.title)}</span><ArrowUpRight size={15}/></button>)}</div></div>;
}
export function WorkflowPage({taskId,initial,onSaved,onAgent,onTool,onError}:{taskId:string;initial?:Plan;onSaved:(v:Plan,options:{navigate:boolean})=>void;onAgent:(text:string)=>void;onTool:(id:string)=>void;onError:(e:unknown)=>void}){
 const toast=useToast();
 const [baseline,setBaseline]=useState<Plan>(initial||createPlan(taskId)),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[notice,setNotice]=useState('');
 const seedKey=JSON.stringify(['workflow-plan',taskId,initial?.id||'new']),seed=useSessionDraft<Plan>(seedKey);
 const key=JSON.stringify(['workflow-plan',taskId,initial?.id||seed?.value.id||baseline.id||'new']),draft=useSessionDraft<Plan>(key);
 const plan=draft?.value||baseline,alive=useRef(true),saving=useRef(false),owner=useRef(key);owner.current=key;
 const editorScope=useRef(seedKey);editorScope.current=seedKey;
 const pendingUndo=useRef<{id:number;release:()=>void}|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>()=>dismissUndo(),[seedKey]);
 const task=tasks.find(v=>v.id===taskId)!;
 function dismissUndo(){
  const previous=pendingUndo.current;
  if(!previous)return;
  pendingUndo.current=null;
  previous.release();
  toast.dismiss(previous.id);
 }
 function edit(next:Plan){dismissUndo();writeSessionDraft(key,next);setSaved(false);setNotice('');}
 function patchStep(id:string,patch:Partial<Plan['steps'][number]>){edit({...plan,steps:plan.steps.map(s=>s.id===id?{...s,...patch}:s)});}
 function discard(){
  if(!alive.current||editorScope.current!==seedKey||saving.current||!draft)return;
  const versions=new Map([[key,draft.version]]);
  if(seedKey!==key&&seed&&seed.value.id===plan.id)versions.set(seedKey,seed.version);
  const removed=removeSessionDraftsWithUndo(versions);
  if(!removed)return;
  dismissUndo();
  setSaved(false);setNotice('');
  const id=toast.show({
   testId:'workflow-plan-discarded',message:t('本地修改已丢弃，已恢复上次保存的计划。'),duration:UNDO_TOAST_DURATION,
   onDismiss:()=>{removed.release();if(pendingUndo.current?.id===id)pendingUndo.current=null;},
   action:{label:t('撤销'),onClick:()=>{
    if(pendingUndo.current?.id!==id||!alive.current||editorScope.current!==seedKey||saving.current)return;
    pendingUndo.current=null;
    const restored=removed.restore();
    toast.show({message:t(restored?'已恢复本地草稿':'此草稿未能恢复。'),severity:restored?'success':'info'});
   }},
  });
  pendingUndo.current={id,release:removed.release};
 }
 async function save(handoff=false){
  if(saving.current)return;dismissUndo();saving.current=true;setBusy(true);setNotice('');
  const submitted=structuredClone(plan),version=draft?.version;
  try{
   const result=await invoke<Plan>('workflow.save',submitted),current=readSessionDraft<Plan>(key),newer=current?.version!==version;
   if(typeof result.id!=='string'||!result.id||result.taskId!==taskId)throw Error(t('保存结果身份不匹配，请重新读取核对。'));
   if(newer&&current){
    const savedKey=JSON.stringify(['workflow-plan',taskId,result.id]),next={...current.value,id:result.id};writeSessionDraft(savedKey,next);if(key!==savedKey)writeSessionDraft(key,next);
   }else{clearSessionDraft(key,version);const seed=readSessionDraft<Plan>(seedKey);if(seed&&seed.value.id===result.id)clearSessionDraft(seedKey,seed.version);}
   const active=alive.current&&owner.current===key;
   onSaved(result,{navigate:active&&!newer});
   if(active){
    setBaseline(result);setSaved(!newer);
    if(newer)setNotice(t('已保存点击时的版本；继续输入的修改仍待保存。'));
    else{toast.show({message:t('计划已保存 · 尚未执行')});if(handoff)onAgent(planPrompt(result));}
   }
  }catch(e){if(alive.current&&owner.current===key)onError(e);}finally{saving.current=false;if(alive.current&&owner.current===key)setBusy(false);}
 }
 return <div className="page workflow-page" data-testid="workflow-plan"><div className="page-heading"><h1><Tooltip content={t(task.summary)}>{t(task.title)}</Tooltip></h1><span className="muted">{t('草稿')}</span></div><Field label={t('任务名称')}>{props=><input {...props} value={plan.name} onChange={e=>{edit({...plan,name:e.target.value});}}/>}</Field><div className="workflow-steps">{task.steps.map((step,index)=>{const state=plan.steps.find(s=>s.id===step.id)!;return <section className={'workflow-step '+(!state.enabled?'disabled-step':'')} key={step.id}><div className="step-heading"><span className="step-number">{index+1}</span><input aria-label={step.title} type="checkbox" checked={state.enabled} disabled={step.required} onChange={e=>patchStep(step.id,{enabled:e.target.checked})}/><strong>{t(step.title)}</strong><span className="tag">{t(step.required?'核心':'可选')}</span><button onClick={()=>onTool(step.tool)}>{t(tools.find(v=>v.id===step.tool)!.name)}<ArrowUpRight size={12}/></button></div>{step.description&&<Disclosure className="workflow-planning-notes" summary={<>{t('规划说明')}</>}><p>{t(step.description)}</p></Disclosure>}{step.planned&&<div className="planned-note">{t('待接入 · 启用后会阻止完整流程执行，不能跳过验证。')}</div>}{state.enabled&&<div className="step-input"><select aria-label={step.title+' input source'} value={state.source} onChange={e=>patchStep(step.id,{source:e.target.value as 'agent'|'user'})}><option value="agent">{t('由 Agent 准备')}</option><option value="user">{t('使用我提供的输入')}</option></select><textarea rows={2} value={state.value} onChange={e=>patchStep(step.id,{value:e.target.value})} placeholder={t('填写资产 ID、路径、已有参数或准备要求…')}/></div>}</section>;})}</div><Field label={t('补充目标与约束')}>{props=><textarea {...props} rows={3} value={plan.notes} onChange={e=>{edit({...plan,notes:e.target.value});}}/>}</Field><ActionBar status={<> {notice&&<Notice compact >{notice}</Notice>}{draft&&!busy&&<Notice compact announce={false}>{t('本地修改尚未保存。')}</Notice>}{saved&&<span><CheckCircle2 size={14}/>{t('计划已保存 · 尚未执行')}</span>} </>}><Button  disabled={busy} onClick={()=>void save()}><Save size={15}/>{t('保存任务计划')}</Button><Tooltip asChild content={t('这是一份任务计划。启用的辅助步骤可由 Agent 准备，也可使用你提供的输入；每个计算草稿仍需单独审阅执行。')}><Button variant="primary"  disabled={busy} onClick={()=>void save(true)}><Sparkles size={15}/>{t('交给 Agent 准备')}</Button></Tooltip><Button type="button"  data-testid="plan-discard" disabled={busy||!draft} onClick={discard}>{t('丢弃本地修改')}</Button></ActionBar></div>;
}
