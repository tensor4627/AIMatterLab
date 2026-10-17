import {useEffect,useRef,useState} from 'react';
import {Download,FileText} from 'lucide-react';import {api} from './types';import {t} from './i18n';
export default function ClusterResults({run,onError}:{run:any;onError:(e:unknown)=>void}){
 const [busy,setBusy]=useState(false),[collection,setCollection]=useState<any>(null),[preview,setPreview]=useState<any>(null);
 const activeRun=useRef(run.id);activeRun.current=run.id;
 useEffect(()=>{setBusy(false);setCollection(null);setPreview(null);},[run.id]);
 async function collect(){if(busy)return;setBusy(true);const id=run.id;try{const result=await api('POST','/api/cluster/collect',{run_id:id});if(activeRun.current===id)setCollection(result);}catch(error){onError(error);}finally{if(activeRun.current===id)setBusy(false);}}
 async function inspect(name:string){const id=run.id;try{const value=await api('POST','/api/cluster/result',{run_id:id,name});if(activeRun.current===id)setPreview(value);}catch(error){onError(error);}}
 return <section className="card cluster-results" data-testid="cluster-results"><h3>{t('结果回收与资产')}</h3><p>{t('按当前作业目录回收产物，校验 SHA256 后登记本机资产。重复回收不会重复提交计算。')}</p><button className="button primary" data-testid="collect-cluster-results" disabled={busy||!['succeeded','failed','cancelled'].includes(run.status)} onClick={()=>void collect()}><Download size={16}/>{t(busy?'回收中…':'回收结果')}</button>{collection&&<><p data-testid="collection-status">{t('回收完成')} · {collection.files.length} {t('个文件')} · {collection.manifest.transfer_status}</p><div className="input-snapshot-list">{collection.files.map((f:any)=><button className="tool-card" key={f.id} onClick={()=>void inspect(f.name)}><FileText size={15}/><strong>{f.name}</strong><small>{f.size.toLocaleString()} B · SHA256 {f.sha256}</small></button>)}</div></>}{preview&&<details open><summary>{preview.name}</summary><pre className="console">{preview.text||t('二进制或大文件，请核对文件哈希与来源。')}</pre></details>}</section>;
}
