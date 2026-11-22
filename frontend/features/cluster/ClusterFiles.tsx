import LoadingFeedback from '../../ui/LoadingFeedback';
import {useEffect,useState} from 'react';
import {api} from '../../api/worker';
import {invoke} from '../../api/studio';
import {t} from '../../ui/i18n';
import {useAssetRequest} from '../assets/useAssetRequest';
import type {ClusterDownloadRequest,ClusterDownloadReceipt} from '../../../contracts/dto/assets';
import './cluster.css';

type Selection={relative:string;rootIndex:number;load:boolean;sequence:number};
type Loaded={relative:string;rootIndex:number;projectId:string;clusterId:string;entries:any[];text:string;file:boolean;sha256?:string;exists:boolean;previewBytes:number;size?:number;truncated:boolean};
export default function ClusterFiles({projectId,clusterId,scope,roots,enabled,onError}:{projectId?:string;clusterId?:string;scope:string;roots:string[];enabled:boolean;onError:(error:unknown)=>void}){
 const [selection,setSelection]=useState<Selection>({relative:'',rootIndex:0,load:false,sequence:0});
 const identity=JSON.stringify([scope,projectId,clusterId,roots,enabled,selection.rootIndex,selection.relative,selection.sequence]);
 const browse=useAssetRequest<Loaded>(identity,onError),download=useAssetRequest<ClusterDownloadReceipt|null>(identity,onError);
 const result=browse.value,busy=browse.pending||download.pending,available=enabled&&!!projectId&&!!clusterId&&selection.rootIndex<roots.length;
 function choose(relative:string,rootIndex=selection.rootIndex,load=false){setSelection(old=>({relative,rootIndex,load,sequence:old.sequence+1}));}
 useEffect(()=>{
  if(!selection.load||!available)return;
  const target={project_id:projectId!,cluster_id:clusterId!,relative:selection.relative,root_index:selection.rootIndex};
  void browse.execute(async()=>{const data=await api('POST','/api/cluster/browse',target),file=typeof data.base64==='string';if(file&&!/^[a-f0-9]{64}$/.test(data.sha256))throw Error(t('文件预览缺少校验信息，请重新读取。'));const bytes=file?Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0)):new Uint8Array(),size=Number.isSafeInteger(data.size)&&data.size>=0?data.size:undefined;return {relative:target.relative,rootIndex:target.root_index,projectId:target.project_id,clusterId:target.cluster_id,entries:data.entries||[],text:file?new TextDecoder().decode(bytes):'',file,sha256:data.sha256,exists:!!data.exists,previewBytes:bytes.length,size,truncated:data.truncated===true||size!==undefined&&bytes.length<size};});
 },[selection]);
 async function save(){if(!available||busy||!result?.file)return;const target=result,request:ClusterDownloadRequest={project_id:target.projectId,cluster_id:target.clusterId,relative:target.relative,root_index:target.rootIndex,expected_sha256:target.sha256};await download.execute(()=>invoke<ClusterDownloadReceipt|null>('cluster.download',request));}
 return <section className="card cluster-files" data-testid="cluster-files"><div className="form-row"><label>{t('已授权读取根目录')}<select aria-label={t('已授权读取根目录')} value={selection.rootIndex} onChange={event=>choose('',Number(event.target.value))}>{roots.map((root,index)=><option key={index} value={index}>{root}</option>)}</select></label><label>{t('相对路径')}<input value={selection.relative} onChange={event=>choose(event.target.value)}/></label></div>
  {!enabled&&<p role="status">{t('请连接作业服务并保存当前连接后浏览文件。')}</p>}
  <div className="button-row"><button className="button" disabled={!available||busy} onClick={()=>choose(selection.relative,selection.rootIndex,true)}>{t(browse.pending?'正在读取文件…':'浏览 / 预览')}</button>{selection.relative&&<button className="button" disabled={!available||busy} onClick={()=>choose(selection.relative.split('/').filter(Boolean).slice(0,-1).join('/'),selection.rootIndex,true)}>{t('上一级目录')}</button>}</div>
  <LoadingFeedback busy={busy} label={t(download.pending?'正在准备下载…':'正在读取文件…')}/>
  {(browse.error||download.error)&&<p role="alert">{browse.error||download.error}</p>}
  {(browse.stale||download.stale)&&<p role="status" data-testid="cluster-files-stale">{t(download.stalePending?'文件来源已变化，旧状态已隐藏；已发送的下载仍可能完成，请核对所选保存位置。':download.staleSettled?'先前下载请求已结束，结果未用于当前文件，请核对所选保存位置。':'文件路径或连接已变化，旧预览已隐藏，请重新浏览。')}</p>}
  {result?.entries.map(file=><button className="cluster-run-row" key={file.name} disabled={!available||busy||file.symlink} onClick={()=>choose([result.relative,file.name].filter(Boolean).join('/'),result.rootIndex,true)}><span>{file.name}</span><small>{file.directory?'directory':file.size+' B'}</small></button>)}
  {result&&!result.exists&&<p role="status">{t('目录尚不存在')}</p>}
  {result?.file&&<div className="cluster-file-preview">
   <div className="cluster-file-header">
    <div className="cluster-file-heading">
     <code>{roots[result.rootIndex]} / {result.relative}</code>
     <span role="status" data-testid="cluster-file-preview-size">{t(result.truncated?'部分预览：仅显示文件前部。下载可获取完整文件。':'文件预览')} · {result.previewBytes}{result.size!==undefined?' / '+result.size:''} B</span>
    </div>
    <button className="button" disabled={!available||busy} onClick={()=>void save()}>{t(download.pending?'正在准备下载…':'下载文件')}</button>
   </div>
   <pre className="report">{result.text}</pre>
  </div>}
  {download.value&&<p role="status">{t('文件已下载并通过 SHA256 核对')}</p>}
 </section>;
}
