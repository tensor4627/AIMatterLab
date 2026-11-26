import Button from '../../ui/Button';
import Notice from '../../ui/Notice';
import Disclosure from '../../ui/Disclosure';
import LoadingFeedback from '../../ui/LoadingFeedback';
import {useState} from 'react';
import {api} from '../../api/worker';
import {type Environment} from '../../../contracts/dto/compute';
import {Structure} from "../../ui/widgets";
import {t} from "../../ui/i18n";
import Tooltip from "../../ui/Tooltip";
import {useAssetRequest} from './useAssetRequest';
import './assets.css';
export default function StructureBuilder({projectId,environments,onSaved,onError,worker=true,workerScope='default'}:{projectId:string;environments:Environment[];onSaved:()=>void;onError:(e:unknown)=>void;worker?:boolean;workerScope?:string}){
 const [environment,setEnvironment]=useState(''),[kind,setKind]=useState('bulk'),[name,setName]=useState('Cu'),[crystal,setCrystal]=useState(''),[a,setA]=useState(''),[repeat,setRepeat]=useState([1,1,1]);
 const request=useAssetRequest<any>(JSON.stringify([workerScope,worker,projectId,environment,kind,name,crystal,a,repeat]),onError),{value:result,pending:busy}=request;
 const ready=worker&&!!projectId&&!!name.trim()&&environments.some(value=>value.id===environment);
 async function build(){if(!ready)return;const recipe:any={kind,name,repeat};if(kind==='bulk'){if(crystal)recipe.crystalstructure=crystal;if(a)recipe.a=Number(a);}await request.execute(()=>api('POST','/api/structures/create',{project_id:projectId,environment_id:environment,recipe}),onSaved);}
 return <section className="asset-section structure-builder">
  <header><h2><Tooltip content={t('生成后保存为真实 extxyz 资产，重新加载检查并预览。参考晶格值会标明来源。')}>{t('ASE 结构工坊')}</Tooltip></h2></header>
  <div className="asset-fields">
   <label>{t('检查环境')}<select aria-label={t('检查环境')} value={environment} onChange={e=>setEnvironment(e.target.value)}><option value="">{t('选择环境')}</option>{environments.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
   <label>{t('结构类型')}<select value={kind} onChange={e=>setKind(e.target.value)}><option value="bulk">Bulk</option><option value="molecule">Molecule</option></select></label>
   <label>{t('元素或分子名称')}<input value={name} onChange={e=>setName(e.target.value)}/></label>
   {kind==='bulk'&&<>
    <label>{t('晶体类型 · 可留空使用 ASE 参考值')}<input value={crystal} placeholder="fcc / bcc / diamond" onChange={e=>setCrystal(e.target.value)}/></label>
    <label>a (Å)<input type="number" min="0.1" step="0.01" value={a} placeholder={t('ASE 参考值')} onChange={e=>setA(e.target.value)}/></label>
   </>}
  </div>
  <div className="asset-actions">
   <div className="asset-repeat">{repeat.map((n,i)=><label key={i}>{'Repeat '+['x','y','z'][i]}<input type="number" min={1} max={100} value={n} onChange={e=>setRepeat(repeat.map((v,j)=>j===i?Number(e.target.value):v))}/></label>)}</div>
   <Button variant="primary"  disabled={busy||!ready} onClick={()=>void build()}>{t(busy?'生成中…':'生成结构并校验')}</Button>
  </div>
  <LoadingFeedback busy={busy} label={t('生成中…')}/>
  {request.stale&&<Notice compact >{t('输入已变化，旧结果已隐藏。已发送的创建请求不会因此撤销。')}</Notice>}
  {request.error&&<Notice compact severity="error" >{request.error}</Notice>}
  {result&&<section className="asset-result">
   <header><p className="structure-result-summary"><Tooltip content={result.path}><code>{result.path.split(/[\\/]/).at(-1)}</code></Tooltip> · {result.formula} · {result.n_atoms} atoms · ASE {result.provenance.version}</p></header>
   <p className="asset-check-scope"><Tooltip content={t('几何检查通过；尚未进行能量松弛或势模型验证。')}><strong>{t('几何检查')} · {t('通过')}</strong></Tooltip><span>{t('能量松弛与势模型验证尚未运行。')}</span></p>
   {!!result.provenance.assumptions.length&&<Disclosure summary={<>{t('假设与来源')} · {result.provenance.assumptions.length}</>}>{result.provenance.assumptions.map((s:any,i:number)=><p key={i}>{s.field}: {s.source}</p>)}</Disclosure>}
   <div className="asset-viewport"><Structure data={result} viewKey={JSON.stringify([workerScope,projectId,result.path])}/></div>
  </section>}
 </section>;
}
