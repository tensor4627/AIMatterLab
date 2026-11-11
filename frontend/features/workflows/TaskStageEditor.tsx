import Tooltip from "../../ui/Tooltip";
import {useEffect,useRef,useState} from 'react';
import {beginSessionDraftSave,clearSessionDraft,endSessionDraftSave,readSessionDraft,useSessionDraft,useSessionDraftSaving,writeSessionDraft} from '../../ui/session-drafts';
import {rebaseStageValues,sourceChanged,stageDraftKey,type StageEditorDraft} from './stage-editor-draft';
import {ParameterFields} from "../../ui/ParameterFields";import StructuredValue from "../pygas/PygasStructuredValue";import {fieldMissing} from "../../../contracts/workflows/task-fields.mjs";
import {partitionFields} from "../../ui/task-fields.mjs";

import type {TaskStageApi,StageInspection} from '../../../contracts/dto/stage';import {t} from "../../ui/i18n";import './task-stage.css';
export default function TaskStageEditor({taskId,revision,workerReady,disabled=false,recoveryOnly=false,api,onSaved}:{taskId:string;revision:number;workerReady:boolean;disabled?:boolean;recoveryOnly?:boolean;api:TaskStageApi;onSaved:()=>void|Promise<void>}){
 const key=stageDraftKey(taskId,'pygas.build'),stored=useSessionDraft<StageEditorDraft<StageInspection>>(key),draft=stored?.value,savePending=useSessionDraftSaving(key);
 const [loaded,setLoaded]=useState<{data:StageInspection;ticket:number}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const seq=useRef(0),scope=useRef(''),scopeKey=JSON.stringify([taskId,revision,workerReady]);if(scope.current!==scopeKey){scope.current=scopeKey;seq.current++;}
 useEffect(()=>{setLoaded(null);setBusy(false);setError('');setMessage('');return()=>{seq.current++;};},[scopeKey]);
 const data=loaded?.data.taskId===taskId?loaded.data:draft?.inspection||null,values=draft?.values||data?.values||{},selected=draft?.selected??(data?.currentEngine==='pygas.build'?'pygas.build':'');
 const fresh=!!loaded&&loaded.ticket===seq.current&&loaded.data.taskId===taskId&&loaded.data.parameterRevision===revision&&workerReady;
 const conflict=!!draft?.dirty&&!!data&&sourceChanged(draft.inspection,data),blocked=disabled||busy||savePending;
 function update(patch:Partial<StageEditorDraft<StageInspection>>){if(recoveryOnly||!data)return;const previous=readSessionDraft<StageEditorDraft<StageInspection>>(key)?.value;writeSessionDraft(key,{inspection:data,values:data.values,selected,...previous,...patch,dirty:true});setMessage('');}
 function changeValue(name:string,value:unknown){update({values:{...values,[name]:value}});}
 async function inspect(){if(blocked||!workerReady)return;const ticket=++seq.current;setBusy(true);setError('');setMessage('');try{
  const next=await api.inspect({taskId});if(ticket!==seq.current)return;if(next.taskId!==taskId||next.parameterRevision!==revision)throw Error(t('阶段参数来源已变化，请重新读取。'));
  setLoaded({data:next,ticket});const previous=readSessionDraft<StageEditorDraft<StageInspection>>(key)?.value;
  writeSessionDraft(key,previous?.dirty?{...previous,uncertain:false}:{inspection:next,values:next.values,selected:previous?.selected??(next.currentEngine==='pygas.build'?'pygas.build':''),dirty:false});
 }catch(e){if(ticket===seq.current)setError(String(e));}finally{if(ticket===seq.current)setBusy(false);}}
 function reconcile(){if(!fresh||!data||!draft)return;update({inspection:data,values:rebaseStageValues(draft,data),uncertain:false});}
 function discard(){if(busy||savePending||!data||!stored)return;writeSessionDraft(key,{inspection:data,values:data.values,selected:data.currentEngine==='pygas.build'?'pygas.build':'',dirty:false,uncertain:!!draft?.uncertain});setError('');setMessage(t(draft?.uncertain?'本地修改已丢弃；已发送的保存请求仍需重新读取核对。':'本地修改已丢弃，已恢复上次读取的保存值。'));}
 async function save(){if(recoveryOnly||blocked||!fresh||conflict||!data||selected!=='pygas.build')return;const token=beginSessionDraftSave(key);if(token===null)return;const ticket=++seq.current;setBusy(true);setError('');
  const pending=writeSessionDraft(key,{inspection:data,values,selected,dirty:true,uncertain:true});
  try{const result=await api.save({taskId,inspectionId:data.inspectionId,engine:'pygas.build',values});if(result.taskId!==taskId||result.status!=='draft')throw Error(t('保存结果身份不匹配，请重新读取核对。'));
   clearSessionDraft(key,pending.version);if(ticket===seq.current){setMessage(t('已保存同一流程草稿；仍需独立复核，尚未构建或运行。'));setLoaded(null);await onSaved();}
  }catch(e){if(ticket===seq.current){setLoaded(null);setError(String(e));}}finally{endSessionDraftSave(key,token);if(ticket===seq.current)setBusy(false);}
 }
 const missing=data?.fields.filter(f=>fieldMissing(f,values))||[];
 const renderFields=(fields:StageInspection['fields'])=>fields.map(field=><div key={field.key}>{field.key==='atom_selection'&&!data?.readOnly.includes(field.key)?<div className="parameter-field" data-field="atom_selection"><label>{field.key} *</label><StructuredValue label="atom_selection" value={values.atom_selection} editor={{type:'array',itemType:'integer',shape:[null],source_sha256:data?.contract.sha256||'',basis:'Native atom_selection integer indices; this initial form edits one flat group'}} language={localStorage.getItem('studio.language')==='en'?'en':'zh-CN'} disabled={recoveryOnly||blocked} onChange={value=>changeValue('atom_selection',value)}/></div>:<ParameterFields fields={[field]} parameters={values} disabled={recoveryOnly||blocked||data?.readOnly.includes(field.key)} onChange={changeValue} onError={e=>setError(String(e))}/ >}{data?.provenance[field.key]&&<details><summary>{t('参数来源')} · {field.key}</summary><p>{data.provenance[field.key].pointer}</p><code>SHA256 {data.provenance[field.key].sha256}</code><p>{t('来源确定值只读；如需更改，请编辑同页组合图或数学定义。')}</p></details>}</div>);
 const groups=data?partitionFields(data.fields):{primary:[],advanced:[]};
 return <section className="task-stage-editor card" data-testid="task-stage-editor" data-task-id={taskId}><header><h3><Tooltip content={t('先明确此流程要进行的阶段。这里只保存同一流程草稿，不调用模型、不共享、不审批或执行。')}>{t('计算阶段与原生参数')}</Tooltip></h3><button type="button" className="button" data-testid="stage-inspect" disabled={blocked||!workerReady} onClick={()=>void inspect()}>{t('读取当前保存图的阶段参数')}</button></header>{!workerReady&&<p role="status">{t('请连接当前作业服务；已有作业不会重新提交。')}</p>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 {recoveryOnly&&<p role="status" data-testid="stage-recovery-only">{t('当前流程暂不满足此阶段的编辑条件。旧草稿仍保留，可重新读取核对或丢弃本地修改。')}</p>}
 {savePending&&<p role="status" data-testid="stage-save-pending">{t('此阶段的保存请求仍在处理中，请等待结果后再读取、丢弃或继续。')}</p>}
 {(draft?.dirty||draft?.uncertain)&&!fresh&&<p role="status" data-testid="stage-draft-retained">{t(draft.uncertain?'保存结果尚待核对；请先重新读取实际记录。':'本地输入已保留；连接或来源已变化，请重新读取后核对。')}</p>}
 {draft&&!draft.dirty&&!draft.uncertain&&!fresh&&<p role="status" data-testid="stage-snapshot-stale">{t('当前显示上次读取的本地快照，请重新读取后继续。')}</p>}
 {draft?.dirty&&<button type="button" className="button" data-testid="stage-discard" disabled={busy||savePending} onClick={discard}>{t('丢弃本地修改')}</button>}
 {conflict&&<section role="alert" data-testid="stage-draft-conflict"><p>{t('保存的阶段来源已有更新。本地输入仍保留，请核对后采用新来源。')}</p><details><summary>{t('核对本地输入与当前来源')}</summary>{data?.fields.map(field=><p key={field.key}>{field.key}: {JSON.stringify(values[field.key])??'—'} → {JSON.stringify(data.values[field.key])??'—'}{data.readOnly.includes(field.key)?' · '+t('只读'):''}</p>)}</details><button type="button" className="button" disabled={recoveryOnly||blocked||!fresh} onClick={reconcile}>{t('已核对，采用新来源并保留可编辑项')}</button></section>}
 {data&&<><label htmlFor="native-stage-engine">{t('计算阶段')} / engine</label><select id="native-stage-engine" aria-label={t('计算阶段')} data-testid="stage-engine" value={selected} disabled={recoveryOnly||blocked} onChange={e=>update({selected:e.target.value})}><option value="">{t('请选择计算阶段')}</option>{data.supportedEngines.map(engine=><option key={engine} value={engine}>{engine}</option>)}</select>
 {selected==='pygas.build'&&<><div className="stage-native-parameters">{renderFields(groups.primary)}{groups.advanced.length>0&&<details><summary>{t('高级参数')} · {groups.advanced.length}</summary>{renderFields(groups.advanced)}</details>}</div><p role="status">{t('待补充')} · {missing.map(f=>f.key).join(', ')||t('无')}</p>
 <details><summary>{t('本阶段实际输入与来源')}</summary><p>{t('保存会把本阶段文件列表设为已保存组合图的已验证依赖；不删除其他磁盘资产。')}</p><ul>{data.files.map(file=><li key={file.name}><strong>{file.name}</strong> · {file.role}<p>{file.path}</p><code>{file.sha256}</code> · {file.size} bytes</li>)}</ul><p>{data.contract.path} {data.contract.pointer}</p><code>SHA256 {data.contract.sha256}</code></details>
 {data.conflicts.length>0&&<details><summary>{t('现有参数与来源值的差异')} · {data.conflicts.length}</summary><ul>{data.conflicts.map((item,index)=><li key={index}><strong>{item.key}</strong><p>{String(item.previous)} → {String(item.proposed)}</p><small>{item.reason}</small></li>)}</ul><p>{t('显式保存将同步已存在的原生参数别名，保留其余 CV 科学字段及历史作业。')}</p></details>}
 <button type="button" className="button primary" data-testid="stage-save" disabled={recoveryOnly||blocked||!fresh||conflict} onClick={()=>void save()}>{t(missing.length?'保存未完成阶段草稿':'保存此阶段草稿')}</button></>}
 </>}
 </section>;
}
