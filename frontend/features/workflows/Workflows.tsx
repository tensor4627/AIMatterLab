import {useEffect,useRef,useState} from 'react';
import {clearSessionDraft,readSessionDraft,useSessionDraft,writeSessionDraft} from '../../ui/session-drafts';
import {ArrowUpRight,GitBranch,CheckCircle2,Plus,Save,Sparkles} from 'lucide-react';
import {tools,tasks,createPlan,planPrompt} from "./workflow-catalog.mjs";
import {type Plan} from "../../../contracts/workflows/plan.mjs";

import {invoke} from '../../api/studio';
import {t} from "../../ui/i18n";
export function TaskCards({onOpen}:{onOpen:(id:string)=>void}){
 return <div className="task-cards" data-testid="task-cards">{tasks.map(task=><button className="task-card" key={task.id} onClick={()=>onOpen(task.id)}><div><GitBranch size={20}/><ArrowUpRight size={15}/></div><h3>{t(task.title)}</h3><p>{t(task.summary)}</p>{task.steps.some(s=>s.required&&s.planned)&&<small>{t('包含待接入的核心能力')}</small>}</button>)}</div>;
}
export function Relations({onTool,onTask}:{onTool:(id:string)=>void;onTask:(id:string)=>void}){
 return <div className="relations"><div className="relation-flow"><span>{t('任务目标 / 用户提供的输入')}</span><ArrowUpRight/><span>{t('Agent 编排与参数草稿')}</span><ArrowUpRight/><span>{t('用户审阅 → 验证 → 执行')}</span></div><div className="relation-tools">{tools.map(tool=><button key={tool.id} onClick={()=>onTool(tool.id)}><strong>{t(tool.name)}</strong><small>{tool.capabilities.map(t).join(' · ')}</small></button>)}</div><div className="relation-flow"><span>{t('数据资产与来源记录')}</span><ArrowUpRight/><span>{t('分析 / DFT 复核请求 / 复训')}</span><ArrowUpRight/><span>{t('回到下一轮任务')}</span></div><p className="muted">{t('队列承载计算执行，Viewer 服务所有结构与轨迹任务；资产连接各模块并记录数据处理请求。')}</p><TaskCards onOpen={onTask}/></div>;
}
export function ToolPage({id,onTask,onNavigate,onPrepare,canPrepare}:{id:string;onTask:(id:string)=>void;onNavigate:(id:string)=>void;onPrepare:(id:string)=>void;canPrepare:boolean}){
 const tool=tools.find(v=>v.id===id)!;if(!tool)return null;
 return <div className="page tool-page"><div className="page-heading"><div><span className="eyebrow">TOOLS & CAPABILITIES</span><h1>{t(tool.name)}</h1><p>{t(tool.description)}</p></div></div><div className="notice">{t(tool.status==='planned'?'尚待接入：可编排计划，当前无法执行此工具。':'部分能力已接入；每次计算仍需在注册环境中验证。')}</div><div className="tool-capabilities">{tool.capabilities.map(v=><span className="tag" key={v}>{t(v)}</span>)}</div><div className="button-row">{tool.page!==tool.id||['training','assets'].includes(id)?<button className="button" onClick={()=>onNavigate(tool.page)}>{t('打开已接入功能')}</button>:null}{tool.engines.length>0&&<details className="tool-direct"><summary>{t('直接准备引擎输入（高级）')}</summary><div className="button-row">{tool.engines.map(engine=><button className="button" key={engine} disabled={!canPrepare} onClick={()=>onPrepare(engine)}>{engine}</button>)}</div></details>}</div><div className="section-heading"><h3>{t('这个工具参与的任务')}</h3></div><div className="tool-task-links">{tasks.filter(task=>task.tools.includes(id)).map(task=><button key={task.id} onClick={()=>onTask(task.id)}><GitBranch size={15}/><span>{t(task.title)}</span><ArrowUpRight size={15}/></button>)}</div></div>;
}
export function WorkflowPage({taskId,initial,onSaved,onAgent,onTool,onError}:{taskId:string;initial?:Plan;onSaved:(v:Plan,options:{navigate:boolean})=>void;onAgent:(text:string)=>void;onTool:(id:string)=>void;onError:(e:unknown)=>void}){
 const [baseline,setBaseline]=useState<Plan>(initial||createPlan(taskId)),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[notice,setNotice]=useState('');
 const seedKey=JSON.stringify(['workflow-plan',taskId,initial?.id||'new']),seed=useSessionDraft<Plan>(seedKey);
 const key=JSON.stringify(['workflow-plan',taskId,initial?.id||seed?.value.id||baseline.id||'new']),draft=useSessionDraft<Plan>(key);
 const plan=draft?.value||baseline,alive=useRef(true),saving=useRef(false),owner=useRef(key);owner.current=key;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const task=tasks.find(v=>v.id===taskId)!;
 function edit(next:Plan){writeSessionDraft(key,next);setSaved(false);setNotice('');}
 function patchStep(id:string,patch:Partial<Plan['steps'][number]>){edit({...plan,steps:plan.steps.map(s=>s.id===id?{...s,...patch}:s)});}
 function discard(){if(saving.current||!draft)return;clearSessionDraft(key,draft.version);if(seedKey!==key&&seed&&seed.value.id===plan.id)clearSessionDraft(seedKey,seed.version);setSaved(false);setNotice(t('本地修改已丢弃，已恢复上次保存的计划。'));}
 async function save(handoff=false){
  if(saving.current)return;saving.current=true;setBusy(true);setNotice('');
  const submitted=structuredClone(plan),version=draft?.version;
  try{
   const result=await invoke<Plan>('workflow.save',submitted),current=readSessionDraft<Plan>(key),newer=current?.version!==version;
   if(typeof result.id!=='string'||!result.id||result.taskId!==taskId)throw Error(t('保存结果身份不匹配，请重新读取核对。'));
   if(newer&&current){
    const savedKey=JSON.stringify(['workflow-plan',taskId,result.id]),next={...current.value,id:result.id};writeSessionDraft(savedKey,next);if(key!==savedKey)writeSessionDraft(key,next);
   }else{clearSessionDraft(key,version);const seed=readSessionDraft<Plan>(seedKey);if(seed&&seed.value.id===result.id)clearSessionDraft(seedKey,seed.version);}
   const active=alive.current&&owner.current===key;
   onSaved(result,{navigate:active&&!newer});
   if(active){setBaseline(result);setSaved(!newer);if(newer)setNotice(t('已保存点击时的版本；继续输入的修改仍待保存。'));else if(handoff)onAgent(planPrompt(result));}
  }catch(e){if(alive.current&&owner.current===key)onError(e);}finally{saving.current=false;if(alive.current&&owner.current===key)setBusy(false);}
 }
 return <div className="page workflow-page" data-testid="workflow-plan"><div className="page-heading"><div><span className="eyebrow">TASK WORKFLOW · DRAFT</span><h1>{t(task.title)}</h1><p>{t(task.summary)}</p></div></div><div className="notice">{t('这是一份任务计划。启用的辅助步骤可由 Agent 准备，也可使用你提供的输入；每个计算草稿仍需单独审阅执行。')}</div><label>{t('任务名称')}<input value={plan.name} onChange={e=>{edit({...plan,name:e.target.value});}}/></label><div className="workflow-steps">{task.steps.map((step,index)=>{const state=plan.steps.find(s=>s.id===step.id)!;return <section className={'workflow-step '+(!state.enabled?'disabled-step':'')} key={step.id}><div className="step-heading"><span className="step-number">{index+1}</span><input aria-label={step.title} type="checkbox" checked={state.enabled} disabled={step.required} onChange={e=>patchStep(step.id,{enabled:e.target.checked})}/><strong>{t(step.title)}</strong><span className="tag">{t(step.required?'核心':'可选')}</span><button onClick={()=>onTool(step.tool)}>{t(tools.find(v=>v.id===step.tool)!.name)}<ArrowUpRight size={12}/></button></div>{step.description&&<p>{t(step.description)}</p>}{step.planned&&<div className="planned-note">{t('待接入 · 启用后会阻止完整流程执行，不能跳过验证。')}</div>}{state.enabled&&<div className="step-input"><select aria-label={step.title+' input source'} value={state.source} onChange={e=>patchStep(step.id,{source:e.target.value as 'agent'|'user'})}><option value="agent">{t('由 Agent 准备')}</option><option value="user">{t('使用我提供的输入')}</option></select><textarea rows={2} value={state.value} onChange={e=>patchStep(step.id,{value:e.target.value})} placeholder={t('填写资产 ID、路径、已有参数或准备要求…')}/></div>}</section>;})}</div><label>{t('补充目标与约束')}<textarea rows={3} value={plan.notes} onChange={e=>{edit({...plan,notes:e.target.value});}}/></label><div className="workflow-actions"><button className="button" disabled={busy} onClick={()=>void save()}><Save size={15}/>{t('保存任务计划')}</button><button className="button primary" disabled={busy} onClick={()=>void save(true)}><Sparkles size={15}/>{t('交给 Agent 准备')}</button><button type="button" className="button" data-testid="plan-discard" disabled={busy||!draft} onClick={discard}>{t('丢弃本地修改')}</button>{notice&&<p role="status">{notice}</p>}{draft&&!busy&&<span role="status">{t('本地修改尚未保存。')}</span>}{saved&&<span><CheckCircle2 size={14}/>{t('计划已保存 · 尚未执行')}</span>}</div></div>;
}
