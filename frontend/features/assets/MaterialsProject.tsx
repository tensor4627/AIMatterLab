import Button from '../../ui/Button';
import Notice from '../../ui/Notice';
import Disclosure from '../../ui/Disclosure';
import {EmptyState,ErrorState,LoadingState} from '../../ui/States';
import {useToast} from '../../ui/Toast';
import {useEffect,useRef,useState} from 'react';
import {invoke} from '../../api/studio';
import {type Environment} from '../../../contracts/dto/compute';
import {Structure} from "../../ui/widgets";
import {t} from "../../ui/i18n";
import Tooltip from '../../ui/Tooltip';
import {useAssetRequest} from './useAssetRequest';
import './assets.css';
export function MaterialsProjectSettings({onError}:{onError:(e:unknown)=>void}){
 const [key,setKey]=useState(''),[state,setState]=useState<{configured:boolean}|null>(null),[busy,setBusy]=useState(false);
 const {show}=useToast(),saving=useRef(false),mounted=useRef(false),writeRevision=useRef(0);
 useEffect(()=>{
  let current=true;mounted.current=true;
  const revision=writeRevision.current;
  void invoke<{configured:boolean}>('materials.status').then(value=>{if(current&&revision===writeRevision.current)setState(value);}).catch(error=>{if(current&&revision===writeRevision.current)onError(error);});
  return()=>{current=false;mounted.current=false;};
 },[]);
 async function save(remove=false){
  if(saving.current)return;
  saving.current=true;writeRevision.current++;setBusy(true);
  try{
   const value=await invoke<{configured:boolean}>('materials.key',remove?{remove:true}:{apiKey:key});
   if(mounted.current){setState(value);setKey('');if(value.configured===!remove)show({severity:'success',message:t('设置已保存')});}
  }catch(e){if(mounted.current)onError(e);}
  finally{saving.current=false;if(mounted.current)setBusy(false);}
 }
 return <>
  <p>Materials Project</p><p>{t('密钥使用系统加密保存，仅主进程访问；不会发给 Agent 或写入作业文件。')}</p>
  <label>API key<input type="password" autoComplete="off" value={key} disabled={busy} onChange={e=>setKey(e.target.value)}
   placeholder={state?.configured?t('密钥已配置，留空保留'):t('输入 Materials Project API key')}/></label>
  <div className="button-row">
   <Button variant="primary" disabled={!key||busy} disabledReason={t(busy?'处理中…':'请填写 API Key。')} onClick={()=>void save()}>{t('保存密钥')}</Button>
   <Button disabled={!state?.configured||busy} disabledReason={t(busy?'处理中…':'尚未配置密钥')} onClick={()=>void save(true)}>{t('移除密钥')}</Button>
  </div>
  <Notice compact>{t(state===null?'密钥配置状态待核对':state.configured?'密钥已配置':'尚未配置密钥')}</Notice>
  <p className="muted">https://api.materialsproject.org · {t('配置密钥后，在数据资产中检索结构。未配置时仍可使用 ASE。')}</p>
 </>;
}
export function MaterialsProjectSearch({projectId,environments,onSaved,worker=true,workerScope='default'}:{projectId:string;environments:Environment[];onSaved:()=>void;worker?:boolean;workerScope?:string}){
 const [query,setQuery]=useState(''),[env,setEnv]=useState('');
 const {show}=useToast();
 const searchRequest=useAssetRequest<any>(JSON.stringify([query])),importRequest=useAssetRequest<any>(JSON.stringify([workerScope,worker,projectId,env,query]));
 const results=searchRequest.value,result=importRequest.value,busy=searchRequest.pending||importRequest.pending,canImport=worker&&!!projectId&&environments.some(value=>value.id===env);
 async function search(){if(!query.trim()||busy)return;await searchRequest.execute(()=>invoke('materials.search',{query}));}
 async function load(id:string){
  if(!canImport||busy||!results?.documents?.some((value:any)=>value.material_id===id))return;
  await importRequest.execute(()=>invoke('materials.import',{project_id:projectId,environment_id:env,material_id:id}),value=>{
   if(value?.path)show({severity:'success',message:t('结构已导入。')});
   onSaved();
  });
 }
 return <section className="asset-section materials-project">
  <header><h2>Materials Project</h2></header>
  <div className="asset-fields">
   <label>{t('化学式或 MP-ID')}<input value={query} placeholder="Li3PS4 / mp-149" onChange={e=>setQuery(e.target.value)}/></label>
   <label>{t('检查环境')}<select aria-label={t('检查环境')} value={env} onChange={e=>setEnv(e.target.value)}><option value="">{t('选择环境')}</option>{environments.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
  </div>
  <div className="asset-actions"><Button disabled={!query.trim()||busy} disabledReason={t(busy?'处理中…':'请填写化学式或 MP-ID。')} onClick={()=>void search()}>{t(searchRequest.pending?'搜索中…':'搜索结构')}</Button></div>
  <LoadingState busy={busy} label={t(importRequest.pending?'正在导入并校验结构…':'搜索中…')}/>
  {(searchRequest.stale||importRequest.stale)&&<Notice compact >{t('输入已变化，旧结果已隐藏。已发送的导入请求不会因此撤销。')}</Notice>}
  {searchRequest.error&&<ErrorState title="结构搜索失败" retained={t('搜索条件已保留。')} details={<pre>{searchRequest.error}</pre>}
   action={<Button onClick={()=>void search()}>{t('重新搜索')}</Button>}/>}
  {importRequest.error&&<ErrorState title="未能确认结构导入" retained={t('搜索结果已保留，请核对资产列表。')} details={<pre>{importRequest.error}</pre>}/>}
  {results&&<>
   {!!results.documents.length&&<p className="asset-check-scope">{t('数据库候选不代表势模型兼容或目标相已确认。')}</p>}
   <div className="asset-list">{results.documents.map((d:any)=><div className="asset-row" key={d.material_id}><div><strong>{d.formula} · {d.material_id}</strong><small>{d.symmetry?.symbol} · {d.n_atoms} atoms · Ehull {d.energy_above_hull??'?'} eV/atom</small></div>
    <Button disabled={!canImport||busy} disabledReason={t(busy?'处理中…':!worker?'作业服务未连接':!projectId?'先选择或创建项目':'请选择计算环境。')} onClick={()=>void load(d.material_id)}>{t('导入并校验')}</Button></div>)}</div>
   {!results.documents.length&&<EmptyState title="没有匹配结构" body="可更换化学式或核对 MP-ID。"/>}
  </>}
  {result&&<section className="asset-result">
   <header><Tooltip content={result.path}><code>{result.path.split(/[\\/]/).at(-1)}</code></Tooltip><span> Materials Project · {result.provenance.external.material_id}</span></header>
   <div className="asset-viewport"><Structure data={result} viewKey={JSON.stringify([workerScope,projectId,env,result.path])}/></div>
   <Disclosure summary={<>{t('来源与版本')}</>}><p><code>SHA256 {result.sha256}</code></p><code>{result.path}</code></Disclosure>
  </section>}
 </section>;
}
