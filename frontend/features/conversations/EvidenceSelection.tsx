import Disclosure from '../../ui/Disclosure';
import Button from '../../ui/Button';
import Notice from '../../ui/Notice';
import {useToast} from '../../ui/Toast';
import {createContext,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {invoke} from '../../api/studio';
import {t} from '../../ui/i18n';
import type {AgentProvider} from '../../../contracts/dto/agent';
import type {TypedInvoke} from '../../../contracts/dto/ipc';
import type {ChatEvidenceDifference,ChatEvidenceLocator,ChatEvidenceRequest,ChatEvidenceStageRequest} from '../../../contracts/dto/chat-evidence';
import {evidenceLines,evidenceParameter} from '../../../contracts/agent/chat-evidence.mjs';
import {normalizeSteps,parameterValue} from '../../../contracts/workflows/task-fields.mjs';
import type {LocalReviewInspection} from '../../../contracts/dto/local-review';
import './evidence-selection.css';

export const EvidenceConversation=createContext<{provider:AgentProvider;threadId:string;name:string}|null>(null);
export type EvidenceLineRange={firstLine:number;lastLine:number};
const request:TypedInvoke=(method,data)=>invoke(method,data);
const revisionLabel=(revision:string)=>revision.includes('/')?revision.split('/')[0]+' · '+revision.split('/')[1].slice(0,12):revision.slice(0,12);

export function evidencePreSelection(pre:HTMLElement,selection=window.getSelection()):EvidenceLineRange|null{
 if(!selection||selection.isCollapsed||!selection.rangeCount)return null;
 const selected=selection.getRangeAt(0);
 if(!pre.contains(selected.startContainer)||!pre.contains(selected.endContainer))return null;
 const prefix=selected.cloneRange();
 prefix.selectNodeContents(pre);
 prefix.setEnd(selected.startContainer,selected.startOffset);
 const start=prefix.toString();
 prefix.setEnd(selected.endContainer,selected.endOffset);
 const end=prefix.toString();
 const breaks=(value:string)=>value.match(/\r\n|[\r\n]/g)?.length??0;
 const firstLine=breaks(start)+1;
 return {firstLine,lastLine:Math.max(firstLine,breaks(end)+( /[\r\n]$/.test(end)?0:1))};
}

export function EvidenceSelection({source,text,getText,hasContent,range,comparable=false}:{source:ChatEvidenceLocator;text?:string;getText?:()=>string;hasContent?:boolean;range?:EvidenceLineRange|null;comparable?:boolean}){
 const {show}=useToast();
 const conversation=useContext(EvidenceConversation);
 const sourceKey=JSON.stringify([conversation?.provider,conversation?.threadId,source]);
 const revisionKey=useRef(sourceKey);revisionKey.current=sourceKey;
 const [open,setOpen]=useState(false);
 const resolvedText=open?(text??getText?.()??''):(text??'');
 const lines=useMemo(()=>(open&&resolvedText?evidenceLines(resolvedText).length:0),[open,resolvedText]);
 const [selection,setSelection]=useState<EvidenceLineRange>({firstLine:1,lastLine:1});
 const [comment,setComment]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[diff,setDiff]=useState<ChatEvidenceDifference|null>(null);
 useEffect(()=>{setOpen(false);setSelection({firstLine:1,lastLine:1});setComment('');setStatus('');setError('');setDiff(null);setBusy(false);},[sourceKey]);
 useEffect(()=>{if(range)setSelection(range);},[range?.firstLine,range?.lastLine,sourceKey]);
 if(!conversation)return null;
 if(text!==undefined){if(!text.length||text.length>2*1024*1024||text.includes('\0'))return null;}
 else if(hasContent===false)return null;
 else if(open&&(!resolvedText.length||resolvedText.length>2*1024*1024||resolvedText.includes('\0')))return null;
 const owner=conversation;
 const valid=lines>0&&Number.isSafeInteger(selection.firstLine)&&Number.isSafeInteger(selection.lastLine)&&selection.firstLine>0&&selection.lastLine>=selection.firstLine&&selection.lastLine<=lines;
 async function act(action:'stage'|'remember'|'compare',comparison=false){
  if(busy)return;
  const activeText=text??getText?.()??'';
  if(!activeText.length||activeText.length>2*1024*1024||activeText.includes('\0'))return;
  const origin=sourceKey;
  setBusy(true);setStatus('');setError('');
  try{
   const bytes=new TextEncoder().encode(activeText);
   const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
   if(revisionKey.current!==origin)return;
   const value:ChatEvidenceRequest={provider:owner.provider,threadId:owner.threadId,source,sha256,textLength:activeText.length};
   if(action==='stage'){
    const pick:ChatEvidenceStageRequest['selection']=comparison&&diff?{beforeRevision:diff.beforeRevision}:source.kind==='parameter'?{firstLine:1,lastLine:lines}:selection;
    await request('chat.evidence.stage',{...value,selection:pick,...comment.trim()?{comment:comment.trim()}:{}});
    if(revisionKey.current!==origin)return;
    setComment('');show({message:t('已添加到对话草稿')+' · '+owner.name});
   }else if(action==='remember'){
    const result=await request('chat.evidence.remember',value);
    if(revisionKey.current!==origin)return;
    setDiff(null);setStatus(t('已保存比较基线')+' · '+revisionLabel(result.revision));
   }else{
    const result=await request('chat.evidence.compare',value);
    if(revisionKey.current!==origin)return;
    setDiff(result);
    if(!result)setStatus(t('尚无其他已保留版本。'));
   }
  }catch(cause){
   if(revisionKey.current!==origin)return;
   setError(t((cause instanceof Error?cause.message:String(cause)).replace(/^Error invoking remote method '[^']+': Error: /,'')));
  }finally{if(revisionKey.current===origin)setBusy(false);}
 }
 const field=(key:keyof EvidenceLineRange,label:string)=><label>{t(label)}<input aria-label={t(label)} type="number" min={1} max={lines} value={Number.isFinite(selection[key])?selection[key]:''} onChange={event=>setSelection(previous=>({...previous,[key]:event.target.valueAsNumber}))}/></label>;
 const side=(title:string,revision:string,unit:string|undefined,part:ChatEvidenceDifference['before'])=><section>
  <strong>{t(title)} · {revisionLabel(revision)}{unit?' · '+unit:''}</strong>
  {part.lastLine>=part.firstLine?<><small>{t('证据行')} {part.firstLine}–{part.lastLine}</small><pre tabIndex={0}>{part.text}</pre></>:<small>{t('此版本在此处没有文本')}</small>}
 </section>;
 return <Disclosure variant="section" className="chat-evidence" data-testid="chat-evidence" data-source-kind={source.kind} open={open} onToggle={event=>setOpen(event.currentTarget.open)} summary={t('选取证据加入对话')}>
  {open&&<div className="chat-evidence-body" aria-busy={busy}>
   <small>{t('对话')} · {owner.name}</small>
   {source.kind!=='parameter'&&<div className="chat-evidence-lines">{field('firstLine','起始行')}{field('lastLine','结束行')}<small>{t('可选行')} 1–{lines}</small></div>}
   <label>{t('批注（可选）')}<textarea rows={2} maxLength={2000} value={comment} onChange={event=>setComment(event.target.value)} placeholder={t('说明想让 Agent 看哪处修改')}/></label>
   <div className="chat-evidence-actions">
    <Button  type="button" disabled={busy||!valid} onClick={()=>void act('stage')}>{t(source.kind==='parameter'?'把参数值加入草稿':'把所选行加入草稿')}</Button>
    {comparable&&<><Button  type="button" disabled={busy} onClick={()=>void act('remember')}>{t('保留此版本供比较')}</Button><Button  type="button" disabled={busy} onClick={()=>void act('compare')}>{t('与保留版本比较')}</Button></>}
   </div>
   {diff&&<><div className="chat-evidence-diff" data-testid="chat-evidence-diff">
    {side('修改前',diff.beforeRevision,diff.beforeUnit,diff.before)}{side('修改后',diff.afterRevision,diff.afterUnit,diff.after)}
   </div><Button  type="button" disabled={busy} onClick={()=>void act('stage',true)}>{t('把带批注的差异加入草稿')}</Button></>}
   {status&&<Notice compact>{status}</Notice>}{error&&<Notice compact severity="error">{error}</Notice>}
  </div>}
 </Disclosure>;
}

export function EvidenceParameters({inspection}:{inspection:LocalReviewInspection}){
 const owner=useContext(EvidenceConversation);
 const [fieldKey,setFieldKey]=useState('');
 const fields=useMemo(()=>normalizeSteps(inspection.steps||[],inspection.parameters,[]).flatMap(step=>step.fields),[inspection]);
 const field=fields.find(value=>value.key===fieldKey)||fields[0];
 if(!owner||!field)return null;
 return <section className="chat-evidence-parameter">
  <label>{t('比较已保存参数')}<select aria-label={t('比较已保存参数')} value={field.key} onChange={event=>setFieldKey(event.target.value)}>
   {fields.map(value=><option key={value.key} value={value.key}>{t(value.label)}{value.unit?' · '+value.unit:''}</option>)}
  </select></label>
  <EvidenceSelection comparable source={{kind:'parameter',taskId:inspection.taskId,field:field.key,revision:inspection.parameterRevision}} text={evidenceParameter(parameterValue(inspection.parameters,field.key))}/>
 </section>;
}
