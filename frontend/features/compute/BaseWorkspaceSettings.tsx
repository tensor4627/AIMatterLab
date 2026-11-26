import Notice from '../../ui/Notice';
import {LoadingState} from '../../ui/States';
import {useEffect,useRef,useState} from 'react';
import {invoke} from '../../api/studio';
import {t} from '../../ui/i18n';
import type {BaseWorkspaceRequest,BaseWorkspaceResult,ComputeResourceState,SshComputeProfile} from '../../../contracts/dto/compute';

export default function BaseWorkspaceSettings({profile,resource,busy=false}:{profile:SshComputeProfile;resource?:ComputeResourceState|null;busy?:boolean}){
 const [result,setResult]=useState<BaseWorkspaceResult|null>(null),[name,setName]=useState('基础工作区'),[directory,setDirectory]=useState('base');
 const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const sequence=useRef(0),pending=useRef(false);
 const ready=resource?.kind==='ssh-connection'&&resource.status==='selected'&&resource.authentication==='verified'&&resource.workflowReady&&resource.profileId===profile.id&&resource.profileVersion===profile.version;
 const connectionId=ready?resource.connectionId:null;
 function request(action:'inspect'|'ensure'):BaseWorkspaceRequest{
  return {connectionId:connectionId!,profileId:profile.id,profileVersion:profile.version,action,...action==='ensure'?{name:name.trim(),directory:directory.trim()}:{}};
 }
 useEffect(()=>{
  const own=++sequence.current;let alive=true;setResult(null);setError('');setLoading(!!ready&&!busy);
  if(ready&&!busy)void invoke<BaseWorkspaceResult>('compute.workspace.setup',request('inspect')).then(value=>{
   if(!alive||own!==sequence.current)return;
   setResult(value);
   if(value.status==='ready'){setName(value.workspace.name);setDirectory(value.workspace.id.replace(/^workspace-/,''));}
   else{setName(value.suggested.name);setDirectory(value.suggested.directory);}
  }).catch(e=>{if(alive&&own===sequence.current)setError(String(e));}).finally(()=>{if(alive&&own===sequence.current)setLoading(false);});
  return()=>{alive=false;sequence.current++;};
 },[connectionId,profile.id,profile.version,ready,busy,refresh]);
 useEffect(()=>window.studio?.onEvent(event=>{if(event.method==='studio/baseWorkspaceChanged'&&!pending.current)setRefresh(value=>value+1);}),[]);
 async function save(){
  if(!ready||busy||loading||pending.current)return;
  const own=sequence.current;pending.current=true;setSaving(true);setError('');
  try{const value=await invoke<BaseWorkspaceResult>('compute.workspace.setup',request('ensure'));if(own===sequence.current){setResult(value);if(value.status==='ready'){setName(value.workspace.name);setDirectory(value.workspace.id.replace(/^workspace-/,''));}}}
  catch(e){if(own===sequence.current)setError(String(e));}
  finally{pending.current=false;setSaving(false);}
 }
 const disabled=busy||loading||saving||!ready;
 return <section className="base-workspace-settings" data-testid="base-workspace-settings">
  {!ready&&<Notice compact>{t('请选中此配置，核对 SSH 登录和作业服务的就绪状态。')}</Notice>}
  <LoadingState busy={loading} label={t('正在读取基础工作区…')}/>
  {result?.status==='ready'&&<Notice compact severity="success" data-testid="base-workspace-ready">{result.workspace.name} <code>{result.workspace.root}</code></Notice>}
  <div className="form-row">
   <label>{t('工作区名称')}<input aria-label={t('基础工作区名称')} value={name} maxLength={80} disabled={disabled} onChange={e=>setName(e.target.value)}/></label>
   <label>{t('工作区目录名')}<input aria-label={t('基础工作区目录名')} value={directory} maxLength={60} disabled={disabled} onChange={e=>setDirectory(e.target.value)}/></label>
  </div>
  <small>{t('目录由集群作业服务管理，保存后用于新流程。')}</small>
  <div className="button-row">
   <button type="button" className="button" disabled={disabled||!name.trim()||!(/^[A-Za-z0-9_-]{1,60}$/).test(directory.trim())} onClick={()=>void save()}>{t(saving?'设置中…':'设为基础工作区')}</button>
   <button type="button" className="button" disabled={busy||saving||loading||!ready} onClick={()=>setRefresh(value=>value+1)}>{t('重新读取')}</button>
  </div>
  {error&&<Notice severity="error" compact>{error}</Notice>}
 </section>;
}
