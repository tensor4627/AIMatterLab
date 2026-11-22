import {useEffect,useRef,useState} from 'react';
import {Download,FileText} from 'lucide-react';import {api} from '../../api/worker';import {t} from "../../ui/i18n";
import LoadingFeedback from '../../ui/LoadingFeedback';
import {EvidenceSelection,evidencePreSelection,type EvidenceLineRange} from '../conversations/EvidenceSelection';
import './cluster.css';
export default function ClusterResults({run,onError}:{run:any;onError:(e:unknown)=>void}){
 const [evidenceRange,setEvidenceRange]=useState<EvidenceLineRange|null>(null);
 const [busy,setBusy]=useState(false),[collection,setCollection]=useState<any>(null),[preview,setPreview]=useState<any>(null),[previewing,setPreviewing]=useState('');
 const owner=useRef({id:run.id,epoch:0,sequence:0,collecting:false,previewing:'',mounted:true});
 if(owner.current.id!==run.id)owner.current={id:run.id,epoch:owner.current.epoch+1,sequence:0,collecting:false,previewing:'',mounted:owner.current.mounted};
 useEffect(()=>{setBusy(false);setCollection(null);setPreview(null);setPreviewing('');},[run.id]);
 useEffect(()=>{owner.current.mounted=true;return()=>{owner.current.mounted=false;owner.current.epoch++;};},[]);
 async function collect(){const operation=owner.current;if(operation.collecting)return;operation.collecting=true;setBusy(true);const epoch=operation.epoch,current=()=>owner.current===operation&&operation.epoch===epoch&&operation.mounted;
  try{const result=await api('POST','/api/cluster/collect',{run_id:operation.id});if(current())setCollection(result);}catch(error){if(current())onError(error);}finally{operation.collecting=false;if(current())setBusy(false);}}
 async function inspect(name:string){const operation=owner.current;if(operation.previewing===name)return;operation.previewing=name;const epoch=operation.epoch,sequence=++operation.sequence,current=()=>owner.current===operation&&operation.epoch===epoch&&operation.sequence===sequence&&operation.mounted;setPreview(null);setEvidenceRange(null);setPreviewing(name);
  try{const value=await api('POST','/api/cluster/result',{run_id:operation.id,name});if(current())setPreview(value);}catch(error){if(current())onError(error);}finally{if(current()){operation.previewing='';setPreviewing('');}}}
 return <section className="card cluster-results" data-testid="cluster-results">
  <div className="cluster-result-heading">
   <h3>{t('结果回收与资产')}</h3>
   <button className="button primary" data-testid="collect-cluster-results" disabled={busy||!['succeeded','failed','cancelled'].includes(run.status)} onClick={()=>void collect()}><Download size={16}/>{t(busy?'回收中…':'回收结果')}</button>
  </div>
  <p>{t('按当前作业目录回收产物，校验 SHA256 后登记本机资产。重复回收不会重复提交计算。')}</p>
  <LoadingFeedback busy={busy} label={t('正在回收并校验结果…')}/>
  <LoadingFeedback busy={!!previewing} label={t('正在读取结果预览…')} phase={previewing}/>
  {collection&&<>
   <p role="status" data-testid="collection-status">{t('回收完成')} · {collection.files.length} {t('个文件')} · {collection.manifest.transfer_status}</p>
   <div className="cluster-result-list">{collection.files.map((f:any)=><button className="cluster-run-row" key={f.id} disabled={previewing===f.name} onClick={()=>void inspect(f.name)}>
    <FileText size={15} aria-hidden="true"/><span><strong>{f.name}</strong><small>{f.size.toLocaleString()} B · SHA256 {f.sha256}</small></span>
   </button>)}</div>
  </>}
  {preview&&<details open><summary>{preview.name}</summary><pre className="console" onMouseUp={e=>setEvidenceRange(evidencePreSelection(e.currentTarget))}>{preview.text||t('二进制或大文件，请核对文件哈希与来源。')}</pre>{preview.text&&<EvidenceSelection source={{kind:'artifact',runId:run.id,name:preview.name,target:'cluster'}} text={preview.text} range={evidenceRange}/>}</details>}
 </section>;
}
