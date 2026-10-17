import {t} from './i18n';
export default function ToolActivity({message,onWorkflow,onRun}:{message:any;onWorkflow?:(id:string)=>void;onRun?:(id:string)=>void}){
 const value=message.activity||{state:'running',summary:'工具正在执行',details:message.text};
 return <section className={'agent-activity '+value.state} data-testid="tool-activity"><div><i className={'flow-dot '+(value.state==='completed'?'ready':'missing')}/><strong>{message.toolName||message.text.split('\n')[0]}</strong><span>{t(value.state==='completed'?'已完成':value.state==='failed'?'失败':'处理中')}</span></div><p>{t(value.summary)}</p>{value.artifact?.kind==='task-parameters'?<button className="button" onClick={()=>onWorkflow?.(value.artifact.id)}>{t('打开计算流程')}</button>:value.artifact?.engine?<button className="button" onClick={()=>onRun?.(value.artifact.id)}>{t('打开模块草稿')}</button>:null}<details><summary>{t('查看工具详情')}</summary><pre>{value.details||message.text}</pre></details></section>;
}
