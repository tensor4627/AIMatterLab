import Button from '../../ui/Button';
import Notice from '../../ui/Notice';
import Disclosure from '../../ui/Disclosure';
import Tooltip from "../../ui/Tooltip";
import {useEffect,useRef,useState} from 'react';
import {localReviewErrorMessage} from "./local-build-review-eligibility.mjs";

import {type LocalReviewApi,type LocalReviewInspection,type LocalReviewPreview} from '../../../contracts/dto/local-review';
import {GroupedParameterFields} from "../../ui/ParameterFields";import {normalizeSteps} from "../../../contracts/workflows/task-fields.mjs";
import {t} from "../../ui/i18n";import './local-input-review.css';
import {EvidenceParameters,EvidenceSelection,evidencePreSelection,type EvidenceLineRange} from '../conversations/EvidenceSelection';
export function LocalInputReview({taskId,workerReady,api,onConfirmed,onClose,onShowGraph}:{taskId:string;workerReady:boolean;api:LocalReviewApi;onConfirmed:(taskId:string)=>void|Promise<void>;onClose:()=>void;onShowGraph:()=>void}){
 const [evidenceRange,setEvidenceRange]=useState<EvidenceLineRange|null>(null);
 const [inspection,setInspection]=useState<LocalReviewInspection|null>(null),[preview,setPreview]=useState<LocalReviewPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[canConfirm,setCanConfirm]=useState(false),[viewed,setViewed]=useState<string[]>([]);const seq=useRef(0),owner=useRef('');const scope=JSON.stringify([taskId,workerReady]);if(owner.current!==scope){owner.current=scope;seq.current++;}
 useEffect(()=>{seq.current++;setInspection(null);setPreview(null);setError('');setMessage('');setCanConfirm(false);setViewed([]);setBusy(false);return()=>{seq.current++;};},[taskId,workerReady]);
 async function action<T>(run:()=>Promise<T>,accept:(value:T)=>void|Promise<void>){const ticket=++seq.current;setBusy(true);setError('');try{const value=await run();if(seq.current===ticket)await accept(value);}catch(e){if(seq.current===ticket)setError(t(localReviewErrorMessage(e)));}finally{if(seq.current===ticket)setBusy(false);}}
 function inspect(){return action(()=>api.inspect({taskId}),value=>{setInspection(value);setPreview(null);setCanConfirm(false);setViewed([]);setMessage(t('请逐个打开实际保存的文件，再确认此版本。'));});}
 function read(entryId:string){if(!inspection)return;return action(()=>api.read({taskId,snapshotId:inspection.snapshotId,entryId}),value=>{setEvidenceRange(null);setPreview(value);setCanConfirm(value.canConfirm);setViewed(old=>old.includes(entryId)?old:[...old,entryId]);});}
 function confirm(){if(!inspection)return;return action(()=>api.confirm({taskId,snapshotId:inspection.snapshotId}),async value=>{setCanConfirm(false);if(value.status==='confirmed'){setMessage(t('本地人工输入复核已记录。AI状态未改写；目标验证和人工执行仍分别进行。'));await onConfirmed(taskId);}else{setMessage(t('已取消；没有生成复核收据。请重新检查当前保存版本。'));setInspection(null);}});}
 const steps=inspection?normalizeSteps(inspection.steps||[],inspection.parameters,[]):[];
 return <section className="local-input-review card" data-testid="local-input-review" data-task-id={taskId} aria-label={t('本地人工输入复核')}>
  <header><h3><Tooltip content={t('检查同一流程已保存的实际图、源码、参数和输入。此步骤不运行构建、验证或计算，不改变共享许可。')}>{t('本地人工复核 · 不发送模型')}</Tooltip></h3><Button type="button"  disabled={busy} onClick={onClose}>{t('返回当前流程')}</Button></header>

  <p className="muted">{t('支持已闭合的规范构建和单私有标量 TorchScript 的验证、NEP4/NVE 采样输入；其他依赖保持锁定。')}</p>
  <Button type="button"  data-testid="local-review-inspect" disabled={busy||!workerReady} onClick={inspect}>{t('检查当前已保存输入')}</Button>
  {!workerReady&&<Notice compact >{t('请连接当前作业服务；已有作业不会重新提交。')}</Notice>}
  {error&&<Notice compact severity="error" >{error}</Notice>}{message&&<Notice compact >{message}</Notice>}
  {inspection&&<><p>{t('保存版本')} {inspection.parameterRevision} · {t('AI复核')}：{inspection.aiReview?.status||'not_run'} · {t('科学与目标验证')}：not_run</p>
   <section className="local-review-parameters" aria-label={t('已保存的科学参数')}><h4>{t('已保存的科学参数')}</h4>{steps.length?steps.map((step:any)=><section key={step.id}><h5>{t(step.title)}</h5><GroupedParameterFields fields={step.fields} parameters={inspection.parameters} onChange={()=>{}} onError={value=>setError(String(value))} disabled/></section>):<p>{t('没有声明可视参数字段；请返回当前流程补齐参数表单后再人工复核。')}</p>}</section>
   <EvidenceParameters inspection={inspection}/>
   <Button type="button"  onClick={onShowGraph}>{t('查看同页可视组合图')}</Button>
   <section aria-label={t('完整实际输入清单')}><h4>{t('完整实际输入清单')} · {viewed.length}/{inspection.entries.length}</h4><ul>{inspection.entries.map(entry=><li key={entry.id}><Button type="button"  data-entry={entry.name} disabled={busy} onClick={()=>read(entry.id)}>{entry.name} · {t(viewed.includes(entry.id)?entry.binary?'已核对二进制元数据':'已完整读取':'尚未读取')}</Button><small>{entry.role}</small><Disclosure summary={<>{t('实际文件身份')}</>}><code>{entry.path}</code><p>{entry.size} bytes · SHA256 {entry.sha256}</p></Disclosure></li>)}</ul></section>
   {preview&&<section className="local-review-file" aria-label={t('实际保存文件')+' '+preview.name}><h4>{preview.name}</h4><p>{t(preview.binary?'已核对二进制路径、大小、哈希和当前构建来源；未验证 ABI':'完整读取已核对')} · {preview.size} bytes</p><Disclosure summary={<>{t('源码与文件原文')}</>}><p>SHA256 {preview.sha256}</p>{preview.binary?<p>{t('二进制文件，仅展示实际路径、大小与哈希。')}</p>:<><pre tabIndex={0} onMouseUp={e=>setEvidenceRange(evidencePreSelection(e.currentTarget))}>{preview.text}</pre>{preview.text&&<EvidenceSelection comparable source={{kind:'reviewFile',taskId,snapshotId:inspection.snapshotId,entryId:preview.id}} text={preview.text} range={evidenceRange}/>}</>}</Disclosure></section>}
   {inspection.validationPlan&&<Disclosure data-testid="consumer-validation-plan" summary={<>{t('目标数值检查的源码技术默认')}</>}><p>CUDA · fd_step {inspection.validationPlan.fdStep} · fd_atol {inspection.validationPlan.fdAtol}</p><p>{t('完整 CV 原子组')} {inspection.validationPlan.fullCvAtomSelection.join(', ')}</p><p>{inspection.validationPlan.coverage.indices?.join(', ')||inspection.validationPlan.coverage.rule}</p><p>{inspection.validationPlan.history}</p><p>{t('这是技术默认与实际明确控制，不是物理参数，也不是已执行的验证结果。')}</p>{Object.entries(inspection.validationPlan.sourceFiles).map(([name,sha])=><p key={name}>{name} · SHA256 {sha}</p>)}</Disclosure>}
   <Disclosure summary={<>{t('确认范围与运行时身份')}</>}><p>{inspection.targetConfirmationRequired?t('科学输入与目标确认相互独立；选择目标后仍需单独人工确认。'):t('仅本地输入完整性。运行时收据')+' '+inspection.runtimeReceiptSha}</p><p>{t('构建完成、ABI、力与 virial、实际引擎和物理适用性均未在此证明。')}</p></Disclosure>
   <Button variant="primary" type="button"  data-testid="local-review-confirm" disabled={busy||!workerReady||!canConfirm} onClick={confirm}>{t('确认人工复核此保存版本')}</Button>
  </>}
 </section>;
}
