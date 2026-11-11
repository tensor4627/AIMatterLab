import {useState} from 'react';
import {Folder} from 'lucide-react';
import type {Environment} from '../../../contracts/dto/compute';
import {api} from '../../api/worker';
import {invoke} from '../../api/studio';
import {wslPath} from '../../ui/presentation/paths';
import {Structure} from '../../ui/widgets';
import {t} from '../../ui/i18n';
import {useAssetRequest} from './useAssetRequest';

export default function AssetInspector({worker,workerScope,projectId,environments,onSaved,onError}:{worker:boolean;workerScope:string;projectId:string;environments:Environment[];onSaved:()=>void;onError:(error:unknown)=>void}){
 const [path,setPath]=useState(''),[kind,setKind]=useState('dataset'),[environment,setEnvironment]=useState(''),[frame,setFrame]=useState(0);
 const scope=JSON.stringify([workerScope,worker,projectId,environment,path,kind,frame]);
 const preview=useAssetRequest<any>(scope,onError),registration=useAssetRequest<any>(scope,onError),picker=useAssetRequest<string|null>(scope,onError);
 const ready=worker&&!!projectId&&!!path.trim()&&environments.some(value=>value.id===environment),validFrame=Number.isInteger(frame)&&frame>=0;
 function inspect(){if(!ready||!validFrame)return;void preview.execute(()=>api('POST','/api/inspect',{project_id:projectId,environment_id:environment,path,kind:'structure',frame}));}
 function register(){if(!ready)return;void registration.execute(()=>api('POST','/api/assets',{project_id:projectId,environment_id:environment,path,kind}),onSaved);}
 return <section data-testid="asset-inspector">
  <div className="page-heading"><div><h1>{t('数据资产')}</h1><p>{t('检查真实元素与标签库存，保留原始文件和来源哈希。')}</p></div></div>
  <section className="card"><div className="form-row"><label>{t('资产类型')}<select value={kind} onChange={event=>setKind(event.target.value)}><option value="dataset">{t('数据集')}</option><option value="model">{t('势模型')}</option><option value="bias">Bias artifact</option><option value="structure">{t('结构 / 轨迹')}</option></select></label><label>{t('检查环境')}<select data-testid="asset-environment" value={environment} onChange={event=>setEnvironment(event.target.value)}><option value="">{t('选择环境')}</option>{environments.map(value=><option key={value.id} value={value.id}>{value.name}</option>)}</select></label></div>
   <label>{t('文件路径')}<div className="input-with-button"><input data-testid="asset-path" value={path} onChange={event=>setPath(event.target.value)} placeholder={t('/home/... 或 /mnt/d/...')}/><button className="icon-button" aria-label={t('选择')} disabled={picker.pending} onClick={()=>void picker.execute(()=>invoke<string|null>('file.choose',{directory:false}),value=>{if(value)setPath(wslPath(value));})}><Folder size={15}/></button></div></label>
   <div className="button-row"><button className="button primary" data-testid="asset-register" disabled={!ready||registration.pending} onClick={register}>{t(registration.pending?'检查并登记中…':'检查并登记')}</button><input className="frame-input" data-testid="asset-frame" type="number" aria-label={t('结构帧序号')} value={frame} min={0} step={1} onChange={event=>setFrame(Number(event.target.value))}/><button className="button" data-testid="asset-preview" disabled={!ready||!validFrame||preview.pending} onClick={inspect}>{t(preview.pending?'预览读取中…':'预览结构帧')}</button></div>
   {(preview.stale||registration.stale)&&<p role="status" data-testid="asset-stale-status">{t(registration.stalePending?'输入已变化，旧结果已隐藏；已发送的登记请求仍可能完成，请核对资产列表。':registration.staleSettled?'旧登记请求已结束，结果未用于当前输入，请核对资产列表。':'输入已变化，旧结果已隐藏，请重新检查或预览。')}</p>}
   {(preview.error||registration.error||picker.error)&&<p role="alert">{preview.error||registration.error||picker.error}</p>}
  </section>
  {preview.value&&<div className="structure-card" data-testid="asset-preview-result"><p className="mono">{path} · {t('结构帧序号')} {frame}</p><Structure data={preview.value} viewKey={JSON.stringify([workerScope,projectId,environment,path])}/></div>}
  {registration.value&&<pre className="report" data-testid="asset-register-result">{JSON.stringify(registration.value,null,2)}</pre>}
 </section>;
}
