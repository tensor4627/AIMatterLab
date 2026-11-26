import {t} from '../../ui/i18n';
import Notice from '../../ui/Notice';
import Button from '../../ui/Button';
import {EmptyState, ErrorState, LoadingState} from '../../ui/States';
import type {CompositionAssetImportResult} from "../pygas/CompositionAssetImport";
import {useEffect,useRef,useState} from 'react';
import {useSessionDraft,writeSessionDraft} from '../../ui/session-drafts';
import {customCvChoiceKey} from './custom-cv-drafts';
import CustomCvWorkbench from './CustomCvWorkbench';
import CustomCvLibrary from './CustomCvLibrary';
import {customCvResult,type CustomCvInvoke,type CustomCvMethod,type CustomCvReadResult,type CustomCvRequest} from './custom-cv-contract';
import type {Expected,Provider,WorkbenchProps} from './custom-cv-types';
/** Main-owned typed IPC is injected by the host. The renderer has no engine/filesystem access. */
export default function CustomCvTaskController(p:{workerReady?:boolean;taskId:string;entryId?:string;provider:Provider;invoke:CustomCvInvoke;importReference?:(request:{taskId:string})=>Promise<CompositionAssetImportResult>;language?:'zh-CN'|'en';onDiscussion:(request:{taskId:string;reason:'formula'|'stable_phase';includePrivate:boolean;entryId?:string})=>void;onChanged?:()=>void|Promise<void>;attachmentBlockedReason?:string;onStateChange?:(state:{loading:boolean;busy:boolean;dirty:boolean;error:boolean})=>void}){
 const locale = {language:p.language??'zh-CN'} as const;
 const [data,setData]=useState<CustomCvReadResult|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[dirty,setDirty]=useState(false),[error,setError]=useState('');const choice=useSessionDraft<string>(customCvChoiceKey(p.taskId)),selected=choice?.value||p.entryId,setSelected=(id:string)=>writeSessionDraft(customCvChoiceKey(p.taskId),id);const seq=useRef(0),owner=useRef(''),mounted=useRef(true),latest=useRef(p);latest.current=p;
 const writePending=useRef<{scope:string;token:number}|null>(null),polls=useRef({key:'',count:0}),[pollPaused,setPollPaused]=useState(false),snapshot=useRef({loading,busy,dirty,error});snapshot.current={loading,busy,dirty,error};
 const workerReady=p.workerReady!==false,logicalScope=JSON.stringify([p.taskId,selected,p.provider]),connection=useRef({scope:logicalScope,ready:workerReady});
 const scope=JSON.stringify([p.taskId,selected,p.provider,workerReady]);if(scope!==owner.current){owner.current=scope;seq.current++;}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;seq.current++;};},[]);
 useEffect(()=>{p.onStateChange?.({loading,busy:!!busy,dirty,error:!!error});},[loading,busy,dirty,error]);
 async function load(method:'customCv.read'|'customCv.status'='customCv.read',preserveDraft=snapshot.current.dirty,reportFailure=false){
  if(p.workerReady===false){setLoading(false);if(reportFailure)throw Error(t("请先连接原作业服务，再核对实际保存记录。", locale));return;}
  if(method==='customCv.status'&&writePending.current?.scope===owner.current)return;
  const token=++seq.current,anchor=owner.current,taskId=p.taskId,id=selected||data?.entry?.id;setLoading(true);setBusy('');setError('');
  try{const result=customCvResult(await p.invoke(method,{taskId,id,provider:p.provider}),taskId,id);
   if(!mounted.current||token!==seq.current||anchor!==owner.current){if(reportFailure)throw Error(t("读取期间所选定义已变化，本地草稿仍保留。", locale));return;}
   setData(result);if(!preserveDraft)setDirty(false);return result.entry||undefined;
  }catch(e){if(mounted.current&&token===seq.current&&anchor===owner.current)setError(e instanceof Error?e.message:String(e));if(reportFailure)throw e;}
  finally{if(mounted.current&&token===seq.current&&anchor===owner.current)setLoading(false);}
 }

 useEffect(()=>{const previous=connection.current,preserveDraft=snapshot.current.dirty||previous.scope===logicalScope&&!previous.ready&&workerReady;connection.current={scope:logicalScope,ready:workerReady};polls.current={key:scope,count:0};setPollPaused(false);if(workerReady)void load('customCv.read',preserveDraft);else{setLoading(false);setBusy('');}},[scope]);
 useEffect(()=>{const active=['queued','running'].includes(data?.entry?.numerical?.status||'');if(!workerReady||!active||loading||busy||dirty||error)return;const key=scope+'|'+data?.entry?.id;if(polls.current.key!==key)polls.current={key,count:0};if(polls.current.count>=40){setPollPaused(true);return;}const anchor=owner.current,timer=setTimeout(()=>{const state=snapshot.current;if(anchor!==owner.current||state.loading||state.busy||state.dirty||state.error||writePending.current?.scope===anchor)return;polls.current.count++;void load('customCv.status');},2000);return()=>clearTimeout(timer);},[scope,workerReady,data?.entry?.id,data?.entry?.numerical?.status,loading,busy,dirty,error]);
 async function mutate(method:CustomCvMethod,fields:Omit<CustomCvRequest,'taskId'|'id'|'provider'>={}){if(!workerReady||!data?.entry||busy||loading)throw Error('Custom CV workspace is not ready');const taskId=p.taskId,id=data.entry.id,token=++seq.current,anchor=owner.current;writePending.current={scope:anchor,token};setBusy(method);setError('');try{const result=customCvResult(await p.invoke(method,{taskId,id,provider:p.provider,...fields}),taskId,id);if(!mounted.current||token!==seq.current||anchor!==owner.current)throw Error(t("保存结果尚待核对；本地修改已保留，请重新读取实际记录。", locale));setData(result);await p.onChanged?.();}catch(e){if(mounted.current&&token===seq.current&&anchor===owner.current)setError(e instanceof Error?e.message:String(e));throw e;}finally{if(writePending.current?.token===token&&writePending.current.scope===anchor)writePending.current=null;if(mounted.current&&token===seq.current&&anchor===owner.current)setBusy('');}}
 async function reuse(id:string,expected:Expected){if(!workerReady||!data||busy||loading||dirty||data.capabilities.reuse!==true)throw Error('Save local changes and refresh the available reuse capability first');const taskId=p.taskId,token=++seq.current,anchor=owner.current;writePending.current={scope:anchor,token};setBusy('customCv.reuse');setError('');try{const result=customCvResult(await p.invoke('customCv.reuse',{taskId,id,provider:p.provider,expected}),taskId);if(!result.entry||result.entry.id===id||Object.values(result.entry.sharing).some(Boolean)||result.entry.numerical&&result.entry.numerical.status!=='not_run'||result.entry.attached)throw Error('Reuse did not create a new private workflow-owned definition with fresh checks');if(mounted.current&&token===seq.current&&anchor===owner.current){setData(result);setDirty(false);setSelected(result.entry.id);await p.onChanged?.();}}catch(e){if(mounted.current&&token===seq.current&&anchor===owner.current)setError(e instanceof Error?e.message:String(e));throw e;}finally{if(writePending.current?.token===token&&writePending.current.scope===anchor)writePending.current=null;if(mounted.current&&token===seq.current&&anchor===owner.current)setBusy('');}}
 async function importReference(){
  if(!workerReady||!p.importReference||!data?.entry||busy||loading||dirty||writePending.current)throw Error('Save local changes and finish the current operation before importing a reference');
  const taskId=p.taskId,id=data.entry.id,provider=p.provider,token=++seq.current,anchor=owner.current;writePending.current={scope:anchor,token};setBusy('import-reference');setError('');
  const current=()=>mounted.current&&token===seq.current&&anchor===owner.current;
  try{
   const receipt=await p.importReference({taskId});if(!current()||receipt.cancelled)return;
   if(receipt.taskId!==taskId||!receipt.asset?.id||receipt.receipt?.kind!=='human_native_dialog'||receipt.asset.sha256!==receipt.receipt.sha256)throw Error('Independent reference import receipt is incomplete or belongs to another workflow');
   const result=customCvResult(await p.invoke('customCv.read',{taskId,id,provider,referenceAssetId:receipt.asset.id}),taskId,id);if(!current())return;
   if(!result.referenceAssets.some(asset=>asset.id===receipt.asset!.id&&asset.sha256===receipt.asset!.sha256))throw Error(t("导入文件尚不是可用的独立 CV 参考。请选择绑定当前定义、参数和结构的 .cv-reference.json 文件。", locale));
   setData(result);await p.onChanged?.();if(current())return receipt.asset.id;
  }catch(e){if(current())setError(e instanceof Error?e.message:String(e));throw e;}finally{if(writePending.current?.token===token&&writePending.current.scope===anchor)writePending.current=null;if(current())setBusy('');}
 }
 const workerNotice=<Notice compact >{t("连接本机作业服务后读取已保存的私有 CV 记录。本地修改会保留，不会安装环境或启动数值检查。", locale)}</Notice>;
 if(!workerReady&&(!data||data.taskId!==p.taskId))return <section className="custom-cv-waiting-worker">{workerNotice}</section>;
 if(loading&&!data)return <LoadingState label={t("读取实际私有 CV 记录…", locale)}/>;
 if(!data||data.taskId!==p.taskId)return <ErrorState title={t('私有 CV 记录暂不可用', locale)}
  retained={t('本地修改仍保留。', locale)} details={error&&<pre>{error}</pre>}
  action={<Button onClick={()=>void load()}>{t("重试", locale)}</Button>}/>;
 if(!data.entry)return <section className="custom-cv-empty">{!workerReady&&workerNotice}
  <EmptyState title={t("先讨论缺少的数学定义", locale)}
   body={t("当前流程尚无自定义定义。优先使用实际 pyGAS 类库；确实不能组合表达时，在当前会话讨论公式、单位、定义域和参数。此时不会生成代码。", locale)}
   action={<Button variant="primary" onClick={()=>p.onDiscussion({taskId:p.taskId,reason:'formula',includePrivate:false})}>{t("在当前会话讨论", locale)}</Button>}/>
  <Button disabled={loading||!workerReady} onClick={()=>void load()}>{t("刷新实际库", locale)}</Button>
  <CustomCvLibrary entries={data.entries} busy={loading||!!busy||!workerReady} reuseSupported={data.capabilities.reuse===true} language={p.language} onReuse={(id,expected)=>reuse(id,expected).catch(()=>{})}/>
 </section>;
 const callbacks:Pick<WorkbenchProps,'onSave'|'onApproveFormula'|'onApproveCode'|'onSharing'|'onValidate'|'onAttach'>={onSave:(spec,parameterValues,expected)=>mutate('customCv.saveSpec',{spec,parameterValues,expected}),onApproveFormula:expected=>mutate('customCv.approveFormula',{expected}),onApproveCode:expected=>mutate('customCv.approveCode',{expected}),onSharing:(enabled,provider,expected)=>{if(provider!==p.provider)throw Error('Provider selection changed');return mutate('customCv.sharing',{enabled,expected});},onValidate:(expected,referenceAssetId)=>mutate('customCv.validate',{expected,referenceAssetId}),onAttach:expected=>{if(p.attachmentBlockedReason)throw Error(p.attachmentBlockedReason);return mutate('customCv.attach',{expected});}};
 return <>{!workerReady&&workerNotice}{pollPaused&&<Notice compact >{t("已完成 40 次自动状态核对。可刷新核对原检查，不会重新提交。", locale)}</Notice>}{p.attachmentBlockedReason&&<Notice compact >{p.attachmentBlockedReason}</Notice>}<fieldset disabled={!workerReady} className="custom-cv-connection-gate" style={{border:0,padding:0,margin:0,minWidth:0}}><CustomCvWorkbench {...data} capabilities={{...data.capabilities,attach:data.capabilities.attach&&!p.attachmentBlockedReason}} entry={data.entry} {...callbacks} taskId={p.taskId} provider={p.provider} busy={loading?'read':busy} error={error} language={p.language} onDraftChange={setDirty} onSelect={setSelected} onDiscuss={request=>p.onDiscussion({taskId:p.taskId,...request})} onReuse={reuse} onReload={options=>{polls.current.count=0;setPollPaused(false);return load(['queued','running','unknown'].includes(data.entry?.numerical?.status||'')?'customCv.status':'customCv.read',options?.preserveDraft??snapshot.current.dirty,true);}} onImportReference={p.importReference?importReference:undefined}/></fieldset></>;
}
