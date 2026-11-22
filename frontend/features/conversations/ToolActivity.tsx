import {CheckCircle2, CircleAlert, CircleHelp, LoaderCircle} from 'lucide-react';
import {t} from "../../ui/i18n";
import {toolLabel} from "./tool-activity.mjs";

export default function ToolActivity({message,onWorkflow,onRun,onExpand}:{message:any;onWorkflow?:(id:string)=>void;onRun?:(id:string)=>void;onExpand?:()=>void}){
 const value=message.activity||{state:'running',summary:'工具正在执行',details:message.text};
 const name=message.toolName||message.text.split('\n')[0],Icon=value.state==='completed'?CheckCircle2:value.state==='running'?LoaderCircle:value.state==='unknown'?CircleHelp:CircleAlert;
 const status=value.state==='completed'?'已完成':value.state==='unknown'?'待核对':value.state==='blocked'?'待补充':value.state==='failed'?'失败':'处理中';
 return <section className={'agent-activity '+value.state} data-testid="tool-activity">
  <div className="activity-heading"><Icon size={16} aria-hidden="true"/><strong>{t(toolLabel(name))}</strong><span>{t(status)}</span></div>
  {value.summary&&value.summary!=='工具调用完成'&&value.summary!=='工具正在执行'&&<p>{t(value.summary)}</p>}
  {value.hint&&<p className="activity-guidance">{t(value.hint)}</p>}
  {value.artifact?.kind==='task-parameters'?<button className="button" onClick={()=>onWorkflow?.(value.artifact.id)}>{t('打开计算流程')}</button>
   :value.artifact?.engine?<button className="button" onClick={()=>onRun?.(value.artifact.id)}>{t('打开模块草稿')}</button>:null}
  <details onToggle={event=>{if(event.currentTarget.open)onExpand?.();}}><summary>{t('查看工具详情')}</summary>{onExpand?<p role="status">{t('正在读取工具详情…')}</p>:<><code>{name}</code><pre>{value.details||message.text}</pre></>}</details>
 </section>;
}
