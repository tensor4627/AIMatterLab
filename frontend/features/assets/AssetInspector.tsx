import Button from '../../ui/Button';
import Notice from '../../ui/Notice';
import Disclosure from '../../ui/Disclosure';
import LoadingFeedback from '../../ui/LoadingFeedback';
import {useState} from 'react';
import {Folder} from 'lucide-react';
import type {Environment} from '../../../contracts/dto/compute';
import {api} from '../../api/worker';
import {invoke} from '../../api/studio';
import {wslPath} from '../../ui/presentation/paths';
import {Structure} from '../../ui/widgets';
import {t} from '../../ui/i18n';
import Tooltip from '../../ui/Tooltip';
import {useAssetRequest} from './useAssetRequest';
import './assets.css';

function inventory(values:Record<string,number>){
 return Object.entries(values).map(([name,count])=>name+' '+count.toLocaleString()).join(' · ')||t('无');
}

export default function AssetInspector({worker,workerScope,projectId,environments,onSaved,onError}:{worker:boolean;workerScope:string;projectId:string;environments:Environment[];onSaved:()=>void;onError:(error:unknown)=>void}){
 const [path,setPath]=useState(''),[kind,setKind]=useState('dataset'),[environment,setEnvironment]=useState(''),[frame,setFrame]=useState(0);
 const scope=JSON.stringify([workerScope,worker,projectId,environment,path,kind,frame]);
 const preview=useAssetRequest<any>(scope,onError),registration=useAssetRequest<any>(scope,onError),picker=useAssetRequest<string|null>(scope,onError);
 const ready=worker&&!!projectId&&!!path.trim()&&environments.some(value=>value.id===environment),validFrame=Number.isInteger(frame)&&frame>=0;
 function inspect(){if(!ready||!validFrame)return;void preview.execute(()=>api('POST','/api/inspect',{project_id:projectId,environment_id:environment,path,kind:'structure',frame}));}
 function register(){if(!ready)return;void registration.execute(()=>api('POST','/api/assets',{project_id:projectId,environment_id:environment,path,kind}),onSaved);}
 const metadata=registration.value?.metadata;
 return <section className="asset-inspector" data-testid="asset-inspector">
  <div className="page-heading"><h1>{t('数据资产')}</h1></div>
  <section className="asset-section asset-form">
   <div className="asset-fields">
    <label>{t('资产类型')}<select data-guide-target="asset-kind" value={kind} onChange={event=>setKind(event.target.value)}><option value="dataset">{t('数据集')}</option><option value="model">{t('势模型')}</option><option value="bias">Bias artifact</option><option value="structure">{t('结构 / 轨迹')}</option></select></label>
    <label>{t('检查环境')}<select data-testid="asset-environment" value={environment} onChange={event=>setEnvironment(event.target.value)}><option value="">{t('选择环境')}</option>{environments.map(value=><option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
    <div className="asset-path-field"><label htmlFor="asset-path">{t('文件路径')}</label><div className="input-with-button"><input id="asset-path" data-testid="asset-path" value={path} onChange={event=>setPath(event.target.value)} placeholder={t('/home/... 或 /mnt/d/...')}/><Button variant="icon" size="sm"  aria-label={t('选择')} disabled={picker.pending} onClick={()=>void picker.execute(()=>invoke<string|null>('file.choose',{directory:false}),value=>{if(value)setPath(wslPath(value));})}><Folder size={15}/></Button></div></div>
   </div>
   <div className="asset-actions">
    <Tooltip asChild content={t('检查真实元素与标签库存，保留原始文件和来源哈希。')}><Button variant="primary"  data-testid="asset-register" disabled={!ready||registration.pending} onClick={register}>{t(registration.pending?'检查并登记中…':'检查并登记')}</Button></Tooltip>
    <div className="asset-frame-actions"><label>{t('结构帧序号')}<input data-testid="asset-frame" type="number" value={frame} min={0} step={1} onChange={event=>setFrame(Number(event.target.value))}/></label><Button  data-testid="asset-preview" disabled={!ready||!validFrame||preview.pending} onClick={inspect}>{t(preview.pending?'预览读取中…':'预览结构帧')}</Button></div>
   </div>
   <LoadingFeedback busy={preview.pending||registration.pending||picker.pending} label={t(registration.pending?'检查并登记中…':preview.pending?'预览读取中…':'正在选择文件…')}/>
   {(preview.stale||registration.stale)&&<Notice compact  data-testid="asset-stale-status">{t(registration.stalePending?'输入已变化，旧结果已隐藏；已发送的登记请求仍可能完成，请核对资产列表。':registration.staleSettled?'旧登记请求已结束，结果未用于当前输入，请核对资产列表。':'输入已变化，旧结果已隐藏，请重新检查或预览。')}</Notice>}
   {(preview.error||registration.error||picker.error)&&<Notice compact severity="error" >{preview.error||registration.error||picker.error}</Notice>}
  </section>
  {preview.value&&<section className="asset-section asset-result" data-testid="asset-preview-result">
   <header><h2>{t('结构预览')}</h2><Tooltip content={path}><code>{path.split(/[\\/]/).at(-1)}</code></Tooltip><span className="muted">{t('结构帧序号')} {preview.value.frame??frame}</span></header>
   <div className="asset-viewport"><Structure data={preview.value} viewKey={JSON.stringify([workerScope,projectId,environment,path])}/></div>
  </section>}
  {registration.value&&<section className="asset-section asset-result" data-testid="asset-register-result">
   <header><h2>{t('登记结果')}</h2><strong>{registration.value.name||registration.value.id}</strong></header>
   {metadata&&<dl className="asset-facts">
    {typeof metadata.frames==='number'&&<div><dt>{t('帧数')}</dt><dd>{metadata.frames.toLocaleString()}</dd></div>}
    {typeof metadata.n_atoms==='number'&&<div><dt>{t('原子数')}</dt><dd>{metadata.n_atoms.toLocaleString()}</dd></div>}
    {metadata.elements&&<div><dt>{t('元素')}</dt><dd>{inventory(metadata.elements)}</dd></div>}
    {metadata.labels&&<div><dt>{t('标签库存')}</dt><dd>{inventory(metadata.labels)}</dd></div>}
    {registration.value.sha256&&<div className="asset-hash"><dt>SHA256</dt><dd><code>{registration.value.sha256}</code></dd></div>}
   </dl>}
   {metadata?.scope&&<p className="muted">{t(metadata.scope==='label inventory; reference provenance must be supplied'?'标签按帧计数；参考标签来源仍需提供。':metadata.scope)}</p>}
   <Disclosure summary={<>{t('文件详情')}</>}><pre className="report">{JSON.stringify(registration.value,null,2)}</pre></Disclosure>
  </section>}
 </section>;
}
