import Button from '../../ui/Button';
import Notice from '../../ui/Notice';
import Disclosure from '../../ui/Disclosure';
import LoadingFeedback from '../../ui/LoadingFeedback';
import {useEffect,useState} from 'react';
import {invoke} from '../../api/studio';
import {type Environment} from '../../../contracts/dto/compute';
import {Structure} from "../../ui/widgets";
import {t} from "../../ui/i18n";
import Tooltip from '../../ui/Tooltip';
import {useAssetRequest} from './useAssetRequest';
import './assets.css';
export function MaterialsProjectSettings({onError}:{onError:(e:unknown)=>void}){
 const [key,setKey]=useState(''),[state,setState]=useState<any>(null),[saved,setSaved]=useState(false);
 useEffect(()=>{void invoke('materials.status').then(setState).catch(onError);},[]);
 async function save(remove=false){try{setState(await invoke('materials.key',remove?{remove:true}:{apiKey:key}));setKey('');setSaved(true);}catch(e){onError(e);}}
 return <><p>Materials Project</p><p>{t('密钥使用系统加密保存，仅主进程访问；不会发给 Agent 或写入作业文件。')}</p><label>API key<input type="password" autoComplete="off" value={key} onChange={e=>{setKey(e.target.value);setSaved(false);}} placeholder={state?.configured?t('密钥已配置，留空保留'):t('输入 Materials Project API key')}/></label><div className="button-row"><Button variant="primary"  disabled={!key} onClick={()=>void save()}>{t('保存密钥')}</Button><Button  disabled={!state?.configured} onClick={()=>void save(true)}>{t('移除密钥')}</Button></div><Notice compact >{t(state?.configured?'密钥已配置':'尚未配置密钥')}{saved?' · '+t('设置已保存'):''}</Notice><p className="muted">https://api.materialsproject.org · {t('配置密钥后，在数据资产中检索结构。未配置时仍可使用 ASE。')}</p></>;
}
export function MaterialsProjectSearch({projectId,environments,onSaved,onError,worker=true,workerScope='default'}:{projectId:string;environments:Environment[];onSaved:()=>void;onError:(e:unknown)=>void;worker?:boolean;workerScope?:string}){
 const [query,setQuery]=useState(''),[env,setEnv]=useState('');
 const searchRequest=useAssetRequest<any>(JSON.stringify([query]),onError),importRequest=useAssetRequest<any>(JSON.stringify([workerScope,worker,projectId,env,query]),onError);
 const results=searchRequest.value,result=importRequest.value,busy=searchRequest.pending||importRequest.pending,canImport=worker&&!!projectId&&environments.some(value=>value.id===env);
 async function search(){if(!query.trim()||busy)return;await searchRequest.execute(()=>invoke('materials.search',{query}));}
 async function load(id:string){if(!canImport||busy||!results?.documents?.some((value:any)=>value.material_id===id))return;await importRequest.execute(()=>invoke('materials.import',{project_id:projectId,environment_id:env,material_id:id}),onSaved);}
 return <section className="asset-section materials-project">
  <header><h2>Materials Project</h2></header>
  <div className="asset-fields">
   <label>{t('化学式或 MP-ID')}<input value={query} placeholder="Li3PS4 / mp-149" onChange={e=>setQuery(e.target.value)}/></label>
   <label>{t('检查环境')}<select aria-label={t('检查环境')} value={env} onChange={e=>setEnv(e.target.value)}><option value="">{t('选择环境')}</option>{environments.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
  </div>
  <div className="asset-actions"><Button  disabled={!query||busy} onClick={()=>void search()}>{t(searchRequest.pending?'搜索中…':'搜索结构')}</Button></div>
  <LoadingFeedback busy={busy} label={t(importRequest.pending?'正在导入并校验结构…':'搜索中…')}/>
  {(searchRequest.stale||importRequest.stale)&&<Notice compact >{t('输入已变化，旧结果已隐藏。已发送的导入请求不会因此撤销。')}</Notice>}
  {(searchRequest.error||importRequest.error)&&<Notice compact severity="error" >{searchRequest.error||importRequest.error}</Notice>}
  {results&&<>
   {!!results.documents.length&&<p className="asset-check-scope">{t('数据库候选不代表势模型兼容或目标相已确认。')}</p>}
   <div className="asset-list">{results.documents.map((d:any)=><div className="asset-row" key={d.material_id}><div><strong>{d.formula} · {d.material_id}</strong><small>{d.symmetry?.symbol} · {d.n_atoms} atoms · Ehull {d.energy_above_hull??'?'} eV/atom</small></div><Button  disabled={!canImport||busy} onClick={()=>void load(d.material_id)}>{t('导入并校验')}</Button></div>)}</div>
   {!results.documents.length&&<p>{t('没有匹配结构')}</p>}
  </>}
  {result&&<section className="asset-result">
   <header><Tooltip content={result.path}><code>{result.path.split(/[\\/]/).at(-1)}</code></Tooltip><span> Materials Project · {result.provenance.external.material_id}</span></header>
   <div className="asset-viewport"><Structure data={result} viewKey={JSON.stringify([workerScope,projectId,env,result.path])}/></div>
   <Disclosure summary={<>{t('来源与版本')}</>}><p><code>SHA256 {result.sha256}</code></p><code>{result.path}</code></Disclosure>
  </section>}
 </section>;
}
