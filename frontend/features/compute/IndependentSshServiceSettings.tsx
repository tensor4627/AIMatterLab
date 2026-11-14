import {useEffect,useRef,useState} from 'react';
import {ChevronLeft,RefreshCw} from 'lucide-react';
import {invoke} from '../../api/studio';
import type {ComputeResourceState,SshComputeProfile,SshServiceRegistrationState} from '../../../contracts/dto/compute';
import {verifiedSshConnection,verifiedSshService,sshConnectionMessage,sshStateLabel,type SshConnectionState,type IndependentSshService} from './ssh-connection-types';
import SshSchedulerSetup from './SshSchedulerSetup';
import SshServiceObservation from './SshServiceObservation';
import {serviceIdentityUnconfirmed} from '../terminal/ssh-service-presentation';
import {t} from '../../ui/i18n';

/** Explicit maintenance uses the authenticated master; active updates retain its verified original shell. */
export default function IndependentSshServiceSettings({profile,activeResource,onLogin,onClose,onChanged,onBusyChange,connectionBusy=false}:{profile:SshComputeProfile;activeResource?:ComputeResourceState|null;onLogin:(profile:SshComputeProfile)=>void|Promise<void>;onClose:()=>void;onChanged?:()=>void;onBusyChange?:(busy:boolean)=>void;connectionBusy?:boolean}){
 const [registration,setRegistration]=useState<SshServiceRegistrationState|null>(null),[connections,setConnections]=useState<SshConnectionState[]>([]),[selected,setSelected]=useState(''),[service,setService]=useState<IndependentSshService|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[notice,setNotice]=useState('');
 const alive=useRef(false),flight=useRef(false),serial=useRef(0),selectedRef=useRef(selected),profileRef=useRef(profile),blocked=useRef(connectionBusy);selectedRef.current=selected;profileRef.current=profile;blocked.current=connectionBusy;
 const candidates=connections.filter(value=>value.profileId===profile.id&&value.profileVersion===profile.version),connection=candidates.find(value=>value.connectionId===selected),authenticated=connection?.status==='authenticated'&&connection.authentication==='verified'&&connection.capabilities.multiplex,ownService=service?.connectionId===selected?service:null,ready=ownService?.status==='connected'&&ownService.workflowReady===true;
 const current=(ticket:number,own=profile)=>alive.current&&ticket===serial.current&&profileRef.current.id===own.id&&profileRef.current.version===own.version;
 async function refresh(){if(flight.current)return;const ticket=++serial.current;setLoading(true);try{const [saved,listing]=await Promise.all([invoke<SshServiceRegistrationState>('compute.sshService.registration',{profileId:profile.id,profileVersion:profile.version}),invoke<{connections:SshConnectionState[]}>('compute.sshConnection.list',{})]);if(!current(ticket))return;if(saved.profileId!==profile.id||saved.profileVersion!==profile.version||!Array.isArray(listing.connections)||!listing.connections.every(verifiedSshConnection))throw Error('Changed connection');setRegistration(saved);setConnections(listing.connections);const available=listing.connections.filter(value=>value.profileId===profile.id&&value.profileVersion===profile.version&&value.status!=='closed');const id=available.some(value=>value.connectionId===selectedRef.current)?selectedRef.current:activeResource?.kind==='ssh-connection'&&available.some(value=>value.connectionId===activeResource.connectionId)?activeResource.connectionId!:available.length===1?available[0].connectionId:'';setSelected(id);const state=id?await invoke<IndependentSshService>('compute.sshService.status',{connectionId:id}):null;if(current(ticket))setService(state);}catch(error){if(current(ticket))setNotice(t(sshConnectionMessage(error)));}finally{if(current(ticket))setLoading(false);}}
 async function observeService(){const ticket=serial.current,id=selectedRef.current;if(!id)return;try{const next=await invoke<IndependentSshService>('compute.sshService.status',{connectionId:id});if(current(ticket)&&selectedRef.current===id)setService(old=>old?.connectionId===next.connectionId&&(old?.revision??-1)>(next.revision??-1)?old:next);}catch{/* Main state supplies safe errors on the next observation. */}}
 useEffect(()=>{if(!selected)return;const timer=setInterval(()=>void observeService(),1000);return()=>clearInterval(timer);},[selected]);
 useEffect(()=>{alive.current=true;void refresh();const off=window.studio?.onEvent(event=>{if(['studio/sshConnectionChanged','studio/sshServiceChanged'].includes(event.method)){if(flight.current)void observeService();else void refresh();}});return()=>{alive.current=false;serial.current++;off?.();onBusyChange?.(false);};},[profile.id,profile.version]);
 async function operate(mode:'setup'|'reuse'|'check'|'update'|'stop'){
  if(flight.current||blocked.current||!connection)return;if(mode==='setup'&&!canStart||mode==='update'&&!canUpdate||mode==='reuse'&&!canStart&&!canAttach||mode==='check'&&!ready&&!canStart&&!canAttach)return;flight.current=true;const ticket=++serial.current,own=profile,id=connection.connectionId;setBusy(true);onBusyChange?.(true);setNotice(mode==='update'?t('正在申请更新作业服务…'):'');
  try{const observed=await invoke<SshConnectionState>('compute.sshConnection.state',{connectionId:id});if(!current(ticket,own)||selectedRef.current!==id||blocked.current)return;if(!verifiedSshConnection(observed)||observed.connectionId!==id||observed.profileId!==own.id||observed.profileVersion!==own.version)throw Error('Connection changed');if(mode!=='stop'&&(observed.status!=='authenticated'||observed.authentication!=='verified'||!observed.capabilities.multiplex))throw Error('Authentication not verified');
   let result:IndependentSshService;
   if(mode==='stop'||mode==='check'&&ready){const state=await invoke<IndependentSshService>('compute.sshService.status',{connectionId:id});if(!current(ticket,own)||state.connectionId!==id||!state.attemptId||state.attemptId!==ownService?.attemptId)throw Error('Service changed');result=await invoke(mode==='stop'?'compute.sshService.disconnect':'compute.sshService.check',{connectionId:id,attemptId:state.attemptId});}
   else {await invoke('compute.resource.activate',{kind:'ssh-connection',connectionId:id,profileId:own.id,profileVersion:own.version});if(!current(ticket,own)||blocked.current)return;result=await invoke('compute.sshService.connect',{connectionId:id,profileId:own.id,profileVersion:own.version,requestId:crypto.randomUUID(),mode,...mode==='update'&&ready?{expectedAttemptId:ownService?.attemptId}:{}});}
   if(!current(ticket,own))return;if(!verifiedSshService(result,id,mode==='stop'?ownService?.attemptId:undefined))throw Error('Service changed');setService(result);setNotice(t(mode==='stop'?result.status==='disconnected'&&result.serviceActive===false?'作业服务已停止，终端仍可使用。':'服务停止尚未确认，请核对原连接；不会自动重试。':result.workflowReady?'作业服务已连接，终端仍可使用。':'作业服务尚未就绪，请核对当前状态。'));
   const [saved,next]=await Promise.all([invoke<SshServiceRegistrationState>('compute.sshService.registration',{profileId:own.id,profileVersion:own.version}),invoke<IndependentSshService>('compute.sshService.status',{connectionId:id})]);
   if(!current(ticket,own)||selectedRef.current!==id)return;if(saved.profileId!==own.id||saved.profileVersion!==own.version||!verifiedSshService(next,id))throw Error('Connection changed');setRegistration(saved);setService(old=>old?.connectionId===next.connectionId&&(old?.revision??-1)>(next.revision??-1)?old:next);onChanged?.();
  }catch(error){if(current(ticket,own))setNotice(t(sshConnectionMessage(error)));}finally{flight.current=false;if(alive.current){setBusy(false);onBusyChange?.(false);}}
 }
 const canAttach=!!authenticated&&!loading&&!busy&&!connectionBusy&&ownService?.status==='connected'&&!ownService.workflowReady;
 const canStart=!!authenticated&&!loading&&!busy&&!connectionBusy&&!['connecting','connected','disconnecting','unknown'].includes(ownService?.status||'');
 const canUpdate=canStart||!!authenticated&&!loading&&!busy&&!connectionBusy&&ready&&!!ownService?.attemptId;
 return <section className="ssh-service-settings" data-testid="ssh-service-settings"><div className="compute-resource-editor-title"><button className="icon-button" aria-label={t('返回连接列表')} disabled={busy} onClick={onClose}><ChevronLeft size={18}/></button><strong>{profile.name} · {t('作业服务设置')}</strong><button className="icon-button" aria-label={t('刷新作业服务设置')} disabled={busy||loading} onClick={()=>void refresh()}><RefreshCw size={15}/></button></div>
  <p>{t('正常使用只需登录并交给 Agent；首次部署和以后复用自动完成。这里用于环境维护和调度器设置。')}</p><div className="ssh-service-registration" data-testid="ssh-service-registration">{t('服务登记')}：{t(registration?.status==='configured'?'已登记':registration?.status==='maintenance_required'?'需要维护':registration?'未登记':'正在读取')}</div>
  {registration?.registration&&<details data-testid="ssh-service-locations">
   <summary>{t('已登记的位置')}</summary>
   <dl>
    <dt>{t('作业服务目录')}</dt><dd><code>{registration.registration.root}</code></dd>
    <dt>{t('作业服务管理包')}</dt><dd><code>{registration.registration.runtime}</code></dd>
    {registration.registration.locations&&<>
     <dt>{t('登录目录')}</dt><dd><code>{registration.registration.locations.loginDirectory}</code></dd>
     <dt>{t('工作区（来自服务已登记项目）')}</dt>
     <dd><ul>{registration.registration.locations.workspaces.map(row=>
      <li key={row.path}><code>{row.path}</code> · {row.projectId} · {t(row.status==='observed'?'最近核对存在':'此前核对，当前未确认')}</li>
     )}</ul></dd>
     <dt>{t('远端集群技能目录')}</dt>
     <dd>{registration.registration.locations.skills.length?<ul>{registration.registration.locations.skills.map(row=>
      <li key={row.path}><code>{row.path}</code> · {t(row.status==='observed'?'最近核对存在':'此前核对，当前未确认')}</li>
     )}</ul>:t('尚未观测到远端集群技能。')}</dd>
    </>}
    {registration.localProjectSkillsRoot&&<>
     <dt>{t('本机项目技能目录')}</dt><dd><code>{registration.localProjectSkillsRoot}</code></dd>
    </>}
   </dl>
  </details>}
  <div className="ssh-service-login"><button className="button" data-testid="ssh-service-login" disabled={busy||connectionBusy} onClick={()=>void onLogin(profile)}>{t('打开登录终端')}</button><label>{t('已登录的连接')}<select data-testid="ssh-service-connection" value={selected} disabled={busy||loading} onChange={event=>{serial.current++;setSelected(event.target.value);setService(null);const id=event.target.value;if(id)void invoke<IndependentSshService>('compute.sshService.status',{connectionId:id}).then(value=>{if(alive.current&&selectedRef.current===id)setService(value);}).catch(error=>setNotice(t(sshConnectionMessage(error))));}}><option value="">{t('请选择已登录的连接')}</option>{candidates.map((value,index)=><option key={value.connectionId} value={value.connectionId}>{t('终端')} {index+1} · v{value.profileVersion} · {t(sshStateLabel(value.status))} · {t(sshStateLabel(value.authentication))}</option>)}</select></label></div>
  {!authenticated&&<p role="status">{t('请先在终端完成此连接的登录。普通 SSH 模式仅提供终端操作。')}</p>}
  {authenticated&&serviceIdentityUnconfirmed(ownService?.error?.code)&&<p role="status" data-testid="ssh-service-identity-status">{t('SSH 认证有效；作业服务身份尚未核对。')}</p>}
  <div className="button-row ssh-service-actions">{registration?.status==='unconfigured'&&<button className="button primary" data-testid="ssh-service-setup" disabled={!canStart} onClick={()=>void operate('setup')}>{t('首次设置并登记服务')}</button>}{registration?.status==='configured'&&<button className="button primary" data-testid="ssh-service-reuse" disabled={!canStart&&!canAttach} onClick={()=>void operate('reuse')}>{t('连接已登记服务')}</button>}{registration?.registration&&<><button className="button" data-testid="ssh-service-check" disabled={busy||connectionBusy||!authenticated||!ready&&!canStart&&!canAttach} onClick={()=>void operate('check')}>{t('检查作业服务')}</button><button className="button" data-testid="ssh-service-update" disabled={!canUpdate} onClick={()=>void operate('update')}>{t('更新作业服务')}</button></>}{ownService?.attemptId&&<button className="button" data-testid="ssh-service-stop" disabled={busy||connectionBusy} onClick={()=>void operate('stop')}>{t('只停止作业服务')}</button>}</div>
  {ownService&&<p role="status">{t('作业服务')}：{t(sshStateLabel(ownService.status))}{ownService.status==='connected'&&ownService.workflowReady&&<> · {t(ownService.operator==='agent'?'Agent 使用服务':'服务未交给 Agent')}</>}</p>}<SshServiceObservation state={ownService}/>{notice&&<p role="status">{notice}</p>}{ready&&<div className="ssh-service-scheduler"><SshSchedulerSetup key={selected+':'+ownService!.attemptId} connectionId={selected} attemptId={ownService!.attemptId!} currentResource={activeResource?.kind==='ssh-connection'&&activeResource.connectionId===selected&&activeResource.status==='selected'&&activeResource.capabilities?.service.workflowReady===true}/></div>}
 </section>;
}
