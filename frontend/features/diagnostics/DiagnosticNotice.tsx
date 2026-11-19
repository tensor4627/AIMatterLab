import type {ReactNode} from 'react';
import {createDiagnostic,diagnosticContext,diagnosticCurrent,diagnosticPending,diagnosticPhase,diagnosticSeverity,diagnosticSummary,type UiDiagnostic} from "./ui-diagnostics.mjs";
import {diagnosticRepairRequest,type DiagnosticRepairRequest} from './repair-request.mjs';
import {sanitizeTranscript} from '../../../contracts/agent/transcript-sanitizer.mjs';
import Notice from '../../ui/Notice';
import {t} from "../../ui/i18n";
import './diagnostics.css';
export default function DiagnosticNotice({record,historical=false,phase='failed',summary,className='',action,onRepair}:{record:UiDiagnostic;historical?:boolean;phase?:string;summary?:string;className?:string;action?:ReactNode;onRepair?:()=>void}){
 const context=record.context,pending=diagnosticPending(phase);
 return <Notice className={'diagnostic-notice '+className} severity={diagnosticSeverity(record,phase)} announce={!historical||pending} action={action} data-testid="diagnostic-notice" data-historical={historical} data-pending={pending}>
  <strong>{t(pending?'待核对的原尝试':historical?'历史诊断':'操作诊断')}</strong>
  <p data-testid="diagnostic-summary">{t(summary??diagnosticSummary(record,phase))}</p>
  {context&&<p className="diagnostic-context">{context.taskName||t('当前流程')} · {t(({save:'保存部署',prepare:'准备提交草稿',execute:'确认部署并执行'} as Record<string,string>)[context.operation]||context.operation)}<br/>{context.targetName||t('所选目标')} · {t(context.target==='cluster'?'集群':'本机')} · {t('参数版本')} {context.parameterRevision}</p>}
  <details><summary>{t('完整原始诊断')}</summary><pre className="diagnostic-raw">{sanitizeTranscript(record.raw)}</pre>{context&&<pre className="diagnostic-raw">{JSON.stringify(sanitizeTranscript({context,resolution:record.resolution}),null,2)}</pre>}{record.stack&&record.stack!==record.raw&&<pre className="diagnostic-raw">{sanitizeTranscript(record.stack)}</pre>}<small>{record.observedAt?new Date(record.observedAt).toLocaleString():t('来自作业记录')}</small></details>
  {onRepair&&<button className="button" data-testid="diagnostic-repair" onClick={onRepair}>{t('交给 Agent 修复')}</button>}
 </Notice>;
}
export function InlineDiagnostic({error,summary}:{error:unknown;summary?:string}){return <DiagnosticNotice record={createDiagnostic(error)} summary={summary}/>;}
export function DeploymentDiagnostics({records,task,config,run,onRepair}:{records:UiDiagnostic[];task:any;config:any;run?:any;onRepair?:(request:DiagnosticRepairRequest)=>void}){
 const pending=records.filter(record=>diagnosticPending(diagnosticPhase(record,task)));
 const current=records.filter(record=>diagnosticCurrent(record,task,config)&&!pending.includes(record)).at(-1);
 const active=[...pending,...(current?[current]:[])],history=records.filter(record=>!active.includes(record));
 const recordedUnknown=task.execution?.phase==='unknown'&&!pending.some(record=>record.context?.runId===task.execution.artifactId);
 const recorded:UiDiagnostic|null=recordedUnknown?{id:'recorded-unknown',observedAt:0,raw:task.execution.message||t('提交响应未确认，请核对原作业；不会自动重提。'),stack:null,context:diagnosticContext(task,task.deployment?.config||config,'execute',task.execution.artifactId)}:null;
 const repair=(record:UiDiagnostic)=>{const request=onRepair&&diagnosticRepairRequest(record,task,run);return request?()=>onRepair?.(request):undefined;};
 return <div className="deployment-diagnostics" data-testid="deployment-diagnostics">
  {recorded&&<DiagnosticNotice record={recorded} phase="unknown" onRepair={repair(recorded)}/>}
  {active.map(record=><DiagnosticNotice key={record.id} record={record} phase={diagnosticPhase(record,task)} historical={!diagnosticCurrent(record,task,config)} onRepair={repair(record)}/>)}
  {history.length>0&&<details data-testid="historical-diagnostics"><summary>{t('历史诊断')} · {history.length}</summary>{history.map(record=><DiagnosticNotice key={record.id} record={record} phase={diagnosticPhase(record,task)} historical onRepair={repair(record)}/>)}</details>}
 </div>;
}
