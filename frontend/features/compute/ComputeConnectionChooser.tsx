import {useEffect,useRef,useState} from 'react';
import {Server,Terminal,Plus,ChevronLeft,Pencil,RefreshCw,Trash2} from 'lucide-react';
import {Modal} from "../../ui/Dialogs";
import {ConfirmDialog,useConfirm} from '../../ui/ConfirmDialog';
import Button from '../../ui/Button';
import Notice from '../../ui/Notice';
import Tooltip from '../../ui/Tooltip';
import {invoke} from '../../api/studio';
import {type ComputeResourceState,type ComputeProfile,type WslComputeProfile,type SshComputeProfile,type ComputeProfileRemovalRequest,type ComputeProfileRemovalResult,type ExistingSshReference} from '../../../contracts/dto/compute';
import type {ManagedResource} from '../../../contracts/dto/managed-compute';
import {savedSshChoice} from './ssh-connection-types';
import {t} from "../../ui/i18n";
import SshServiceSettings from './SshServiceSettings';
import BaseWorkspaceSettings from './BaseWorkspaceSettings';
import './compute-connections.css';
import LoadingFeedback from '../../ui/LoadingFeedback';
type Listing={profiles:ComputeProfile[];inUseProfileIds?:string[];serviceRegistrations?:{profileId:string;profileVersion:number;status:'configured'|'unconfigured'|'maintenance_required'}[];activeLocal?:{distribution:string;root:string;requestedRoot?:string;port:number};defaults:{distribution:string;root:string;port:number;ssh_client:string}};
type Draft={id?:string;version:number;kind:'wsl'|'ssh';name:string;distribution:string;root:string;port:string;intent:'standard'|'existing';host:string;username:string;ssh_client:string;identity_file:string;proxy_jump:string;via:string;mode:'interactive'|'key';servicePython:string;serviceActivation:string;serviceEnvironmentSaved:boolean};
const linuxClient=(client:string)=>client.startsWith('/')&&!/^\/mnt\//i.test(client)&&!/\.exe$/i.test(client);
const windowsClient=(client:string)=>/[\\/]ssh\.exe$/i.test(client);
const sshClientLabel=(client='')=>windowsClient(client)?'Windows OpenSSH':linuxClient(client)?'WSL/Linux OpenSSH':t(client?'自定义 SSH 客户端':'SSH 集群');
const needsWsl=(draft:Draft)=>draft.kind==='wsl'||linuxClient(draft.ssh_client);
function draftFor(kind:'wsl'|'ssh',defaults?:Listing['defaults'],profile?:ComputeProfile):Draft{
 const value:Draft={version:0,kind,name:'',distribution:defaults?.distribution||'',root:defaults?.root||'~/.local/state/gpu-sampling-studio',port:String(kind==='wsl'?defaults?.port||8767:22),intent:'standard',host:'',username:'',ssh_client:defaults?.ssh_client||'',identity_file:'',proxy_jump:'',via:'',mode:'interactive',servicePython:'python3',serviceActivation:'',serviceEnvironmentSaved:false};
 if(!profile)return value;
 Object.assign(value,profile,{port:String(profile.port)});
 if(profile.kind==='ssh'){value.distribution=profile.distribution||'';value.identity_file=profile.identity_file||'';value.proxy_jump=(profile.proxy_jump||[]).join('\n');value.via=(profile.via||[]).join('\n');value.servicePython=profile.serviceEnvironment?.python||'python3';value.serviceActivation=profile.serviceEnvironment?.activation||'';value.serviceEnvironmentSaved=!!profile.serviceEnvironment;}
 return value;
}
const lines=(value:string)=>value.split('\n').map(v=>v.trim()).filter(Boolean);
function message(error:unknown){const code=String(error);return t(code.includes('compute_profile_environment_in_use')?'当前服务通道仍在使用环境。请先停止对应服务，再只修改 Python 环境。':(code.includes('profile_conflict')||code.includes('profile_changed'))?'连接已被修改，请重新打开后编辑。':code.includes('profile_invalid')?'请核对连接名称、地址和端口。':(code.includes('profile_not_found')||code.includes('profile_unavailable'))?'连接已不存在，请刷新列表。':'无法保存或读取连接，请重试。');}
function removalMessage(error:unknown){const code=String(error);return t(code.includes('compute_profile_in_use')?'请先断开该 SSH 连接，再删除保存项。':(code.includes('profile_conflict')||code.includes('profile_changed')||code.includes('profile_unavailable')||code.includes('profile_not_found'))?'连接已变化或已不存在；请取消删除，刷新列表后重新核对。':'删除结果尚未确认；请刷新列表核对，不会自动重试。');}
export default function ComputeConnectionChooser({preferredKind,onLocal,onSsh,onClose,localConnected=false,onManageSsh,onServiceEnvironmentHelp,onServiceChange,onProfileSaved,suggestedWorkfileRoot,onSchedulerSaved,connectionBusy=false,activeResource,managedResources,managedPending=false,initialEdit,onOpenResourceConsole}:{preferredKind?:'ssh'|'wsl';initialEdit?:{profileId:string;profileVersion:number;nonce:string;section?:"service"|"environment"};activeResource?:ComputeResourceState|null;managedResources?:ManagedResource[];managedPending?:boolean;onLocal:(profile:WslComputeProfile)=>void|Promise<void>;onSsh:(profile:SshComputeProfile,options?:{plain?:boolean})=>void|Promise<void>;onClose:()=>void;localConnected?:boolean;onManageSsh?:()=>void;onServiceEnvironmentHelp?:(profile:SshComputeProfile)=>void;onServiceChange?:()=>void;onProfileSaved?:(profile:ComputeProfile,previousVersion:number)=>void;suggestedWorkfileRoot?:string;onSchedulerSaved?:(item:{id:string;name?:string})=>void;connectionBusy?:boolean;onOpenResourceConsole?:()=>void}){
 const [listing,setListing]=useState<Listing|null>(null),[draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[distributions,setDistributions]=useState<string[]>([]);
 const [references,setReferences]=useState<ExistingSshReference[]|null>(null);
 const [inventoryState,setInventoryState]=useState<'idle'|'loading'|'ready'|'empty'|'failed'>('idle');
 const inventorySequence=useRef(0),distributionEdited=useRef(false);
 const [removal,setRemoval]=useState<ComputeProfile|null>(null),[removalError,setRemovalError]=useState(''),[removalFailed,setRemovalFailed]=useState(false);
 const [serviceProfile,setServiceProfile]=useState<SshComputeProfile|null>(null);
 const confirm=useConfirm(),asking=useRef(false),busyRef=useRef(busy);busyRef.current=busy;
 const mounted=useRef(false),operation=useRef(false),request=useRef(0),dirty=useRef(false),editor=useRef(draft),blocked=useRef(connectionBusy);editor.current=draft;blocked.current=connectionBusy;
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;request.current++;};},[]);
 const openedEdit=useRef('');
 useEffect(()=>{if(!initialEdit||!listing||openedEdit.current===initialEdit.nonce||editor.current||dirty.current)return;openedEdit.current=initialEdit.nonce;const profile=listing.profiles.find(value=>value.id===initialEdit.profileId);if(profile){if(initialEdit.section==="service"&&profile.kind==="ssh"){if(profile.version===initialEdit.profileVersion)openService(profile);else {const own=initialEdit;void invoke<ComputeProfile>("compute.profiles.read",{id:own.profileId,version:own.profileVersion}).then(snapshot=>{if(!mounted.current||openedEdit.current!==own.nonce)return;if(snapshot.kind!=="ssh"||snapshot.id!==own.profileId||snapshot.version!==own.profileVersion)throw Error("compute_profile_changed");openService(snapshot);}).catch(error=>{if(mounted.current&&openedEdit.current===own.nonce)setError(message(error));});}}else edit(profile);if(profile.version!==initialEdit.profileVersion)setNotice(t('正在编辑此连接的最新保存版本；已打开的原版本连接保留。'));}else setError(t('连接已不存在，请刷新列表。'));},[listing,initialEdit?.nonce]);
 async function load(){if(operation.current)return;const ticket=++request.current;setLoading(true);setError('');try{const data=await invoke<Listing>('compute.profiles.list');if(!mounted.current||ticket!==request.current)return;if(!Array.isArray(data?.profiles))throw Error('Invalid connection listing');setListing(data);}catch(e){if(mounted.current&&ticket===request.current)setError(message(e));}finally{if(mounted.current&&ticket===request.current)setLoading(false);}}
 async function inventory(){
  const ticket=++inventorySequence.current;
  const current=()=>mounted.current&&ticket===inventorySequence.current;
  setInventoryState('loading');
  try{
   const {distributions:names}=await invoke<{distributions:string[]}>('compute.profiles.inventory');
   if(!current())return;
   setDistributions(names);setInventoryState(names.length?'ready':'empty');
   if(names.length===1)setDraft(old=>current()&&!distributionEdited.current&&old&&!old.id&&!old.distribution?{...old,distribution:names[0]}:old);
  }catch{if(current())setInventoryState('failed');}
 }
 const inventoryFeedback=inventoryState==='loading'?<LoadingFeedback busy inline label={t('正在查找已安装的 WSL 发行版')}/>:['failed','empty'].includes(inventoryState)?<div className="button-row">
  <span role={inventoryState==='failed'?'alert':'status'}>{t(inventoryState==='failed'?'无法读取 WSL 发行版，可以手动填写。':'未发现已安装的 WSL 发行版，可以手动填写。')}</span>
  <button type="button" className="button" disabled={busy} onClick={()=>void inventory()}>{t('重新检测')}</button>
 </div>:null;
 function updateInventory(next:Draft){
  inventorySequence.current++;setDistributions([]);setInventoryState('idle');
  if(needsWsl(next))void inventory();
 }
 function openDraft(next:Draft){if(operation.current)return;distributionEdited.current=false;setDraft(next);dirty.current=false;setNotice('');setError('');updateInventory(next);}
 function edit(profile:ComputeProfile){openDraft(draftFor(profile.kind,listing?.defaults,profile));}
 function create(kind:'wsl'|'ssh'){openDraft(draftFor(kind,listing?.defaults));}
 async function importSsh(ref?:string){
  if(operation.current||!listing)return;
  operation.current=true;setBusy(true);setError('');
  try{
   if(!ref){
    const values=await invoke<ExistingSshReference[]>('ssh.existing');
    if(mounted.current)setReferences(values);
    return;
   }
   type Imported={cancelled?:boolean;name:string;host:string;username:string;port:number;ssh_client:string;identity_file:string;proxy_jump:string[];via:string[];import_review?:{requires_review:boolean}};
   const value=await invoke<Imported>('ssh.import',{ref});
   if(!mounted.current||value.cancelled)return;
   if(value.import_review?.requires_review){setError(t('导入来源包含尚未支持的路由或认证引用；请手动核对连接，暂不能测试或保存。'));return;}
   const imported:Draft={...draftFor('ssh',listing.defaults),name:value.name,host:value.host,username:value.username,port:String(value.port),mode:'key',ssh_client:value.ssh_client,identity_file:value.identity_file,proxy_jump:value.proxy_jump.join('\n'),via:value.via.join('\n')};
   setDraft(imported);dirty.current=true;setReferences(null);setNotice(t('连接仅填入表单，尚未保存或授权'));updateInventory(imported);
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:String(e));}
  finally{operation.current=false;if(mounted.current)setBusy(false);}
 }
 function patch(value:Partial<Draft>){
  if(value.ssh_client!==undefined&&draft&&linuxClient(value.ssh_client)!==linuxClient(draft.ssh_client))updateInventory({...draft,...value});
  if(value.distribution!==undefined)distributionEdited.current=true;
  dirty.current=true;setDraft(old=>old?{...old,...value}:old);setError('');
 }
 async function leaveDraft(next:()=>void,check=()=>true){
  if(!mounted.current||operation.current||busyRef.current||asking.current||!check())return;
  const own=editor.current;
  if(own&&dirty.current){
   asking.current=true;
   try{
    if(!await confirm({title:t('放弃连接修改'),target:own.name.trim()||t('新连接'),consequence:t('此连接在表单中的未保存修改将丢失。'),confirmLabel:t('放弃修改')}))return;
   }finally{asking.current=false;}
   if(!mounted.current||operation.current||busyRef.current||editor.current!==own||!check())return;
  }
  next();
 }
 function back(){return leaveDraft(()=>{inventorySequence.current++;dirty.current=false;setDraft(null);setError('');});}
 function close(){return leaveDraft(onClose);}
 function openService(profile:SshComputeProfile){return leaveDraft(()=>{inventorySequence.current++;dirty.current=false;setDraft(null);setServiceProfile(profile);setError('');setNotice('');});}
 function closeService(){if(busy)return;setServiceProfile(null);void load();}
 async function save(loginAfter=false){if(!draft||operation.current)return;const port=Number(draft.port);if(!draft.name.trim()||!Number.isInteger(port)||port<1||port>65535||draft.kind==='wsl'&&(!draft.distribution.trim()||!draft.root.trim()||port<1024)||draft.kind==='ssh'&&(!draft.host.trim()||!draft.username.trim()||!draft.ssh_client.trim())){setError(t('请填写连接名称和必填字段，并核对端口。'));return;}
  operation.current=true;setBusy(true);setError('');const own=draft;let reloadServiceSummary=false;
  try{const shared={...own.id?{id:own.id}:{},expectedVersion:own.version,kind:own.kind,name:own.name.trim()},data=own.kind==='wsl'?{...shared,distribution:own.distribution.trim(),root:own.root.trim(),port,intent:own.intent}:{...shared,host:own.host.trim(),username:own.username.trim(),port,ssh_client:own.ssh_client.trim(),identity_file:own.identity_file.trim(),proxy_jump:lines(own.proxy_jump),via:lines(own.via),mode:own.mode,...own.ssh_client.startsWith('/')&&!/^\/mnt\/[a-z]\//i.test(own.ssh_client)&&own.distribution.trim()?{distribution:own.distribution.trim()}:{},...own.serviceEnvironmentSaved||own.servicePython.trim()!=='python3'||own.serviceActivation.trim()?{serviceEnvironment:{python:own.servicePython.trim(),activation:own.serviceActivation}}:{}};const value=await invoke<ComputeProfile>('compute.profiles.save',data);if(!mounted.current||editor.current!==own)return;dirty.current=false;setDraft(null);setListing(old=>old?{...old,profiles:[value,...old.profiles.filter(p=>p.id!==value.id)]}:old);setNotice(t('连接已保存'));onProfileSaved?.(value,own.version);if(loginAfter&&value.kind==='ssh'&&!blocked.current)await onSsh(value);
   reloadServiceSummary=own.kind==='ssh';
  }catch(e){if(mounted.current)setError(message(e));}finally{operation.current=false;if(mounted.current){setBusy(false);if(reloadServiceSummary)void load();}}}
 async function connect(profile:ComputeProfile,plain=false){if(operation.current||connectionBusy)return;operation.current=true;setBusy(true);setError('');try{const current=await invoke<ComputeProfile>('compute.profiles.read',{id:profile.id,version:profile.version});if(!mounted.current)return;if(blocked.current){setError(t('当前操作尚未完成，请稍后连接。'));return;}if(current.kind==='wsl')await onLocal(current);else await onSsh(current,plain?{plain:true}:undefined);}catch(e){if(mounted.current)setError(message(e));}finally{operation.current=false;if(mounted.current)setBusy(false);}}
 const inUse=(profile:ComputeProfile)=>profile.kind==='ssh'&&(Array.isArray(listing?.inUseProfileIds)?listing.inUseProfileIds.includes(profile.id):(activeResource?.kind==='ssh-terminal'||activeResource?.kind==='ssh-connection')&&activeResource.profileId===profile.id);
 function beginRemoval(profile:ComputeProfile){if(operation.current||loading||removal)return;if(inUse(profile)){setError(t('请先断开该 SSH 连接，再删除保存项。'));return;}setRemoval(profile);setRemovalError('');setRemovalFailed(false);setNotice('');setError('');}
 function cancelRemoval(){if(operation.current)return;setRemoval(null);if(removalError)setError(removalError);setRemovalError('');setRemovalFailed(false);}
 async function remove(){if(!removal||operation.current||removalFailed)return;if(inUse(removal)){setRemovalError(t('请先断开该 SSH 连接，再删除保存项。'));return;}if(blocked.current){setRemovalError(t('当前操作尚未完成，请稍后删除。'));return;}const own=removal;operation.current=true;request.current++;setLoading(false);setBusy(true);setRemovalError('');
  try{const data:ComputeProfileRemovalRequest={id:own.id,expectedVersion:own.version},value=await invoke<ComputeProfileRemovalResult>('compute.profiles.remove',data);if(!mounted.current)return;if(value?.removed!==true||value.id!==own.id||value.version!==own.version)throw Error('Invalid removal acknowledgement');setListing(old=>old?{...old,profiles:old.profiles.filter(profile=>profile.id!==own.id),inUseProfileIds:old.inUseProfileIds?.filter(id=>id!==own.id)}:old);setRemoval(null);setNotice(t('已删除保存的连接；现有作业、环境和凭据保留。'));
  }catch(e){if(mounted.current){setRemovalError(removalMessage(e));setRemovalFailed(true);}}finally{operation.current=false;if(mounted.current)setBusy(false);}}
 const current=(p:ComputeProfile)=>p.kind==='ssh'?(activeResource?.kind==='ssh-terminal'||activeResource?.kind==='ssh-connection')&&activeResource.status==='selected'&&activeResource.profileId===p.id&&activeResource.profileVersion===p.version:!activeResource?.selectionId&&p.kind==='wsl'&&localConnected&&listing?.activeLocal&&p.distribution===listing.activeLocal.distribution&&(p.root===listing.activeLocal.root||p.root===listing.activeLocal.requestedRoot)&&p.port===listing.activeLocal.port;
 const visibleProfiles=(listing?.profiles||[]).filter(profile=>!preferredKind||profile.kind===preferredKind);
 const environmentProfile=draft?.kind==='ssh'&&draft.id?listing?.profiles.find((profile):profile is SshComputeProfile=>profile.kind==='ssh'&&profile.id===draft.id):undefined;
 return <><Modal title={t('连接计算资源')} onClose={close} wide closeDisabled={busy}><div className="compute-resource-manager" data-testid="compute-resource-manager">
  {serviceProfile?<SshServiceSettings profile={serviceProfile} suggestedWorkfileRoot={suggestedWorkfileRoot} onSchedulerSaved={onSchedulerSaved} activeResource={activeResource} onLogin={profile=>connect(profile)} onClose={closeService} onChanged={onServiceChange} onBusyChange={setBusy} connectionBusy={connectionBusy}/>:!draft?<>
   <div className="compute-resource-add">
    {preferredKind!=='ssh'&&<button className="button" data-testid="compute-choice-local" data-guide-target="add-wsl" disabled={loading||busy} onClick={()=>create('wsl')}><Plus size={14}/>{t('添加本地 WSL')}</button>}
    {preferredKind!=='wsl'&&<button className="button" data-testid="compute-choice-ssh" data-guide-target="add-ssh" disabled={loading||busy} onClick={()=>create('ssh')}><Plus size={14}/>{t('添加 SSH 集群')}</button>}
    {preferredKind==='ssh'&&<button className="button" data-testid="compute-import-ssh" disabled={loading||busy} onClick={()=>void importSsh()}>{t('导入已有连接')}</button>}
    {onOpenResourceConsole&&<button type="button" className="button" data-testid="open-compute-resource-console" disabled={busy} onClick={onOpenResourceConsole}><Server size={15}/>{t('计算资源总览')}</button>}
    <button className="icon-button compute-resource-refresh" aria-label={t('刷新连接列表')} disabled={loading||busy} onClick={()=>void load()}><RefreshCw size={15}/></button>
   </div>
   {references&&<label>{t('选择连接来源')}<select aria-label={t('选择连接来源')} value="" disabled={busy} onChange={event=>{if(event.target.value)void importSsh(event.target.value);}}><option value="">{t(references.length?'请选择已有连接':'未发现可导入的连接')}</option>{references.map(reference=><option key={reference.ref} value={reference.ref}>{t(reference.label)}</option>)}</select></label>}
   {loading?<Notice compact>{t('正在读取连接…')}</Notice>:!visibleProfiles.length?<div className="compute-resource-empty">{t('还没有保存的连接')}</div>:<ul className="compute-resource-list">{visibleProfiles.map(profile=>{
    const choice=profile.kind==='ssh'?savedSshChoice(profile,activeResource,managedResources,managedPending):null;
    return <li key={profile.id} data-testid="saved-compute-profile" data-profile-id={profile.id} data-profile-version={profile.version} data-current={!!current(profile)}>
    <div className="compute-resource-symbol">{profile.kind==='wsl'?<Server size={20}/>:<Terminal size={20}/>}</div><div className="compute-resource-summary"><strong>{profile.name}</strong><span>{profile.kind==='wsl'?'WSL · '+profile.distribution:sshClientLabel(profile.ssh_client)+' · '+t(profile.mode==='interactive'?'交互式登录':'密钥自动登录')}{current(profile)&&<em>{t('当前连接')}</em>}</span></div>
    <div className="compute-resource-item-actions">
     {profile.kind==='ssh'&&<button className="button" data-testid="compute-profile-service" disabled={busy} onClick={()=>openService(profile)}>{t('作业服务')}</button>}
     <button className="icon-button" aria-label={t('编辑连接')+' '+profile.name} disabled={busy} onClick={()=>edit(profile)}><Pencil size={15}/></button>
     <Button variant="icon" className="icon-button" data-testid="compute-profile-delete" data-profile-id={profile.id} aria-label={t('删除保存的连接')+' '+profile.name} disabledReason={inUse(profile)?t('请先断开该 SSH 连接，再删除保存项。'):undefined} disabled={busy||connectionBusy||!!inUse(profile)} onClick={()=>beginRemoval(profile)}><Trash2 size={15}/></Button>
     <Tooltip asChild content={choice?.connectionId||''}><button className="button primary" data-guide-target={profile.kind==='ssh'?'saved-ssh':'saved-wsl'} disabled={busy||connectionBusy} onClick={()=>void connect(profile)}>{t(choice?.label||'连接')}</button></Tooltip>
    </div>
   </li>;})}</ul>}
   {onManageSsh&&<details className="compute-resource-advanced"><summary>{t('已有集群与高级设置')}</summary><button className="button" disabled={busy} onClick={onManageSsh}>{t('打开已有集群配置')}</button></details>}
  </>:<form data-testid="compute-profile-editor" onSubmit={event=>{event.preventDefault();void save();}}><div className="compute-resource-editor-title"><button type="button" className="icon-button" aria-label={t('返回连接列表')} disabled={busy} onClick={back}><ChevronLeft size={18}/></button><strong>{t(draft.id?'编辑连接':draft.kind==='wsl'?'添加本地 WSL':'添加 SSH 集群')}</strong></div>
   <label>{t('连接名称')}<input data-testid="compute-profile-name" autoComplete="off" value={draft.name} disabled={busy} onChange={e=>patch({name:e.target.value})} placeholder={t('为此连接起个名字')}/></label>
   {draft.kind==='ssh'&&windowsClient(draft.ssh_client)&&<small data-testid="compute-profile-windows-ssh-note">{t('使用 Windows OpenSSH 连接远端集群，无需本机 WSL。')}</small>}
   {draft.kind==='wsl'?<><label>{t('WSL 发行版')}<input data-testid="compute-profile-distribution" list="compute-wsl-distributions" value={draft.distribution} disabled={busy} onChange={e=>patch({distribution:e.target.value})}/><datalist id="compute-wsl-distributions">{distributions.map(v=><option key={v} value={v}/>)}</datalist></label>{inventoryFeedback}<details><summary>{t('高级：作业服务目录与端口')}</summary><label>{t('作业服务目录')}<input value={draft.root} disabled={busy} onChange={e=>patch({root:e.target.value})}/></label><label>{t('作业服务端口')}<input type="number" min={1024} max={65535} value={draft.port} disabled={busy} onChange={e=>patch({port:e.target.value})}/></label><label className="check-label"><input type="checkbox" checked={draft.intent==='existing'} disabled={busy} onChange={e=>patch({intent:e.target.checked?'existing':'standard'})}/>{t('连接已有作业目录，保留环境与源码登记')}</label></details></>:<><div className="form-row"><label>{t('SSH 主机')}<input data-testid="compute-profile-host" autoComplete="off" value={draft.host} disabled={busy} onChange={e=>patch({host:e.target.value})}/></label><label>{t('SSH 用户名')}<input data-testid="compute-profile-username" autoComplete="off" value={draft.username} disabled={busy} onChange={e=>patch({username:e.target.value})}/></label></div><label>{t('登录方式')}<select data-testid="compute-profile-mode" value={draft.mode} disabled={busy} onChange={e=>patch({mode:e.target.value as Draft['mode']})}><option value="interactive">{t('交互式登录')}</option><option value="key">{t('密钥自动登录')}</option></select></label><small>{t(draft.mode==='key'?'密钥登录要求已信任的主机指纹和可用密钥。':'交互登录支持密码、验证码和首次主机指纹确认。')}</small><details className="ssh-client-choice"><summary>{t('登录客户端设置')}</summary><p>{t('选择密钥所在环境的 SSH 客户端。')}</p><label>{t('SSH 客户端')}<input data-testid="compute-profile-client" value={draft.ssh_client} disabled={busy} onChange={e=>patch({ssh_client:e.target.value})}/></label>{!linuxClient(draft.ssh_client)&&<button type="button" className="button" data-testid="compute-profile-use-linux-client" disabled={busy} onClick={()=>patch({ssh_client:'/usr/bin/ssh'})}>{t('明确选用 WSL/Linux 客户端')}</button>}{listing?.defaults.ssh_client&&!linuxClient(listing.defaults.ssh_client)&&draft.ssh_client!==listing.defaults.ssh_client&&<button type="button" className="button" data-testid="compute-profile-use-windows-client" disabled={busy} onClick={()=>patch({ssh_client:listing.defaults.ssh_client})}>{t('使用 Windows OpenSSH')}</button>}{linuxClient(draft.ssh_client)&&<><label>{t('WSL 发行版（使用 WSL 客户端时）')}<input data-testid="compute-profile-ssh-distribution" list="compute-ssh-distributions" value={draft.distribution} disabled={busy} onChange={e=>patch({distribution:e.target.value})}/></label><datalist id="compute-ssh-distributions">{distributions.map(value=><option key={value} value={value}/>)}</datalist>{inventoryFeedback}</>}<p>{t('Windows 与 WSL/Linux 的密钥和 known_hosts 属于不同环境。切换客户端后请核对已有密钥路径；原引用会保留，凭据不会自动迁移。')}</p></details><details><summary>{t('高级连接设置：客户端、密钥、端口与路由')}</summary><label>{t('端口')}<input type="number" min={1} max={65535} value={draft.port} disabled={busy} onChange={e=>patch({port:e.target.value})}/></label><label>{t('密钥文件路径（可选）')}<input data-testid="compute-profile-identity-file" autoComplete="off" value={draft.identity_file} disabled={busy} onChange={e=>patch({identity_file:e.target.value})}/></label><label>ProxyJump<textarea rows={2} autoComplete="off" value={draft.proxy_jump} disabled={busy} onChange={e=>patch({proxy_jump:e.target.value})}/></label><label>{t('登录后逐跳连接 · 每行一个')}<textarea rows={2} value={draft.via} disabled={busy} onChange={e=>patch({via:e.target.value})}/></label></details></>}
   {draft.kind==='ssh'&&<details open={initialEdit?.section==='environment'?true:undefined}><summary>{t('高级：Python 环境')}</summary><section className="compute-service-environment" data-testid="compute-service-environment"><h4>{t('作业服务 Python 环境')}</h4><p className="muted">{t('可使用已有 Conda 或虚拟环境。保存后，下次接入此连接的作业服务时自动使用。')}</p><label>{t('Python 名称或绝对路径')}<input data-testid="compute-service-python" autoComplete="off" value={draft.servicePython} disabled={busy} onChange={e=>patch({servicePython:e.target.value})} placeholder="python3"/></label><label>{t('环境激活命令（可选）')}<textarea data-testid="compute-service-activation" rows={3} autoComplete="off" value={draft.serviceActivation} disabled={busy} onChange={e=>patch({serviceActivation:e.target.value})} placeholder={t('例如：source ~/miniconda3/etc/profile.d/conda.sh，然后 conda activate studio')}/></label><small>{t('需要受支持的 Python 版本及 SQLite。仅填写环境激活命令，不要填写密码或令牌。')}</small>{environmentProfile&&onServiceEnvironmentHelp&&<button type="button" className="button" data-testid="compute-service-agent-help" disabled={busy||connectionBusy} onClick={()=>void leaveDraft(()=>onServiceEnvironmentHelp(environmentProfile),()=>!blocked.current)}>{t('请 Agent 协助配置')}</button>}</section></details>}
   {environmentProfile&&<details data-testid="compute-base-workspace-advanced"><summary>{t('高级：基础工作区')}</summary><BaseWorkspaceSettings profile={environmentProfile} resource={activeResource} busy={busy||connectionBusy||dirty.current}/></details>}
   {environmentProfile&&<details><summary>{t('高级：作业服务维护')}</summary><button type="button" className="button" data-testid="compute-editor-service" disabled={busy} onClick={()=>openService(environmentProfile)}>{t('打开作业服务设置')}</button></details>}
   <div className="button-row compute-resource-footer"><button type="button" className="button" disabled={busy} onClick={back}>{t('取消')}</button><button type="submit" className={draft.kind==='ssh'&&!draft.id?'button':'button primary'} disabled={busy}>{t(busy?'保存中…':'保存连接')}</button>{draft.kind==='ssh'&&!draft.id&&<button type="button" className="button primary" data-testid="compute-save-login" disabled={busy||connectionBusy} onClick={()=>void save(true)}>{t('保存并登录')}</button>}</div>
  </form>}
  {error&&<Notice className="compute-resource-error" severity="error" compact>{error}</Notice>}{notice&&<Notice compact>{notice}</Notice>}
 </div></Modal>{removal&&<ConfirmDialog title={t('删除保存的连接')} tone="danger" target={removal.name}
  contentTestId="compute-profile-delete-confirmation" testId="compute-profile-delete-confirm" onCancel={cancelRemoval} onConfirm={()=>void remove()}
  pending={busy} disabled={connectionBusy||removalFailed||!!inUse(removal)} confirmLabel={t(busy?'删除中…':'删除保存的连接')}
  consequence={<>
   {t('只从此软件的连接列表中移除保存项。现有终端、作业、计算文件、环境和凭据均保留。')}
   {removal.kind==='wsl'&&localConnected&&<p>{t('当前 WSL 作业服务保持连接。')}</p>}
   {inUse(removal)&&<Notice severity="error" compact>{t('请先断开该 SSH 连接，再删除保存项。')}</Notice>}{removalError&&<Notice severity="error" compact>{removalError}</Notice>}
  </>}/>}</>;
}
