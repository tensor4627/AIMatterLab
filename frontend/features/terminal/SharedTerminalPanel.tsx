import LoadingFeedback from '../../ui/LoadingFeedback';
import {useEffect,useRef,useState} from 'react';
import {Terminal} from '@xterm/xterm';
import {createHumanInputWriter} from './human-input.mjs';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {invoke} from '../../api/studio';
import {computeResources,sshService} from '../../api/compute-resources';
import type {ComputeResourceState,ResourceWorkspaceReference,SharedTerminalResizeRequest,SharedTerminalSession,SshServiceState} from '../../../contracts/dto/compute';
import type {AgentProvider,Conversation} from '../../../contracts/dto/agent';
import type {TypedInvoke} from '../../../contracts/dto/ipc';
import {t} from "../../ui/i18n";
import './shared-terminal.css';
import {serviceDuration,serviceErrorMessage,servicePhaseMessage,serviceRejectedMessage,serviceTransfer,serviceVersion} from './ssh-service-presentation';
import SshConnectionPanel,{type HandoffLessonStage,type SshEnvironmentHelpTarget} from './SshConnectionPanel';

export type SharedTerminalRequest={nonce:string;kind:'local'|'ssh';mode:'interactive'|'key';clusterId?:string;profileId?:string;version?:number;profileName?:string;connectionId?:string;connectionMode?:'plain'|'managed';sessionId?:string;exact?:true;reviewWorkspace?:'handoff'|'change'};
type OpenTarget=Omit<SharedTerminalRequest,'nonce'|'profileName'|'connectionMode'|'connectionId'|'sessionId'|'exact'>;
type OpenRecovery={target:OpenTarget;scope:string;nonce?:string;provider?:AgentProvider;requestId:string;message:string};
type Session=SharedTerminalSession;
const invokeTyped:TypedInvoke=invoke;
type ReadResult=Session&{output:string;cursor:number;dropped:boolean};
function terminalMessage(error:unknown){
 const code=String(error).slice(0,4096).match(/terminal_[a-z_]+/)?.[0];
 const messages:Record<string,string>={
  terminal_encryption_unavailable:'系统凭据存储暂不可用，无法创建共享终端。',
  terminal_context_changed:'会话或计算资源已切换，请重新附加终端。',
  terminal_scope_denied:'会话或计算资源已切换，请重新附加终端。',
  terminal_saved_connection_changed:'请先保存并重新选择此 SSH 连接。',
  terminal_client_namespace_required:'请核对 SSH 客户端与密钥所在的 Windows 或 WSL 环境。',
  terminal_route_review_required:'请先核对并保存 SSH 路由设置。',
  terminal_recovery_required:'原连接的状态尚未确认，原会话已保留。请先刷新会话列表，或明确另开新连接。',
  terminal_unavailable:'终端暂不可用，请检查会话状态；不会自动重开连接。',
  terminal_runtime_unavailable:'终端运行文件暂不可用，原会话已保留。请重新打开软件后核对会话。',
  terminal_start_failed:'终端启动未完成，原会话已保留。请刷新会话列表后重试。',
  terminal_session_limit:'终端会话数量已达上限。请核对已有会话后再打开。',
  terminal_session_exited:'终端进程已退出，请核对已有输出和退出状态。',
  terminal_owner_changed:'终端操作权已变化，请刷新会话状态后重试。',
  terminal_human_owned:'终端操作权已变化，请刷新会话状态后重试。',
  terminal_operation_failed:'终端操作未完成，连接记录仍保留。请刷新会话状态后重试。',
 };
 return t(messages[code||'']||'终端操作未完成，请刷新会话状态后重试。');
}

type PanelProps={activeResource?:ComputeResourceState|null;provider?:AgentProvider;draftForHandoff?:(provider:AgentProvider)=>string|undefined;onConversationPrepared?:(conversation:Conversation,adoptedDraftId?:string)=>void;resourceScope?:string;onResourceChange?:(state:ComputeResourceState,label?:string)=>void;visible:boolean;request?:SharedTerminalRequest;canShare:boolean;onError:(error:unknown)=>void;onConfigureSsh?:(ref?:{profileId:string;profileVersion:number;section?:"service"|"environment"},connectionId?:string,sessionId?:string)=>void;onServiceEnvironmentHelp?:(target:SshEnvironmentHelpTarget)=>void;onHandoffLesson?:(stage:HandoffLessonStage,target:SshEnvironmentHelpTarget)=>void;onUseForWorkflow?:(ref:ResourceWorkspaceReference)=>Promise<unknown>;onPlainSsh?:()=>void};
export default function SharedTerminalPanel(props:PanelProps){
 if(props.request?.kind==='ssh'&&props.request.profileId&&props.request.connectionMode!=='plain')return <SshConnectionPanel {...props} request={props.request}/>;
 return <LegacySharedTerminalPanel {...props}/>;
}
export function LegacySharedTerminalPanel({activeResource,visible,request,canShare,onError,resourceScope='',onResourceChange,provider,draftForHandoff,onConversationPrepared}:PanelProps){
 const [busyLabel,setBusyLabel]=useState('');
 const [sessions,setSessions]=useState<Session[]>([]),[active,setActive]=useState<Session|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[recovery,setRecovery]=useState<OpenRecovery|null>(null);
 const [service,setService]=useState<SshServiceState|null>(null),serviceRef=useRef(service),[serviceIssue,setServiceIssue]=useState(''),[serviceChecking,setServiceChecking]=useState(false),[serviceNow,setServiceNow]=useState(Date.now());
 const serviceRevision=useRef(0),sessionRefreshingRef=useRef(false),[sessionRefreshing,setSessionRefreshing]=useState(false),serviceRead=useRef<{key:string;promise:Promise<SshServiceState|null>}|null>(null);
 const activeRef=useRef(active),busyRef=useRef(false),drainingInputRef=useRef(false),lastRequest=useRef(''),host=useRef<HTMLDivElement>(null),terminal=useRef<Terminal|null>(null),fit=useRef<FitAddon|null>(null),cursor=useRef(0),generation=useRef(0),mounted=useRef(false),inputQueue=useRef(Promise.resolve()),menu=useRef<HTMLDetailsElement>(null);
 const requestOwner=useRef(request?.nonce);requestOwner.current=request?.nonce;
 const providerOwner=useRef(provider),visibleOwner=useRef(visible),recoveryRef=useRef(recovery),listSequence=useRef(0),readNotice=useRef('');providerOwner.current=provider;visibleOwner.current=visible;recoveryRef.current=recovery;
 const resourceOwner=useRef(resourceScope),resourceSequence=useRef(0),resourceChange=useRef(onResourceChange);if(resourceOwner.current!==resourceScope){resourceOwner.current=resourceScope;resourceSequence.current++;}resourceChange.current=onResourceChange;
 activeRef.current=active;
 const plainSsh=request?.connectionMode==='plain';
 const visibleService=!plainSsh&&service?.sessionId===active?.sessionId?service:null;
 const laneReserved=(value:Session|null)=>value?.serviceActive===true||!!(value&&serviceRef.current?.sessionId===value.sessionId&&(serviceRef.current.terminalAccess==='reserved'||serviceRef.current.terminalAccess==='unknown'||['connecting','connected','disconnecting','unknown'].includes(serviceRef.current.status)));
 const serviceReady=visibleService?.status==='connected'&&visibleService.workflowReady===true&&visibleService.terminalAccess!=='unknown';
 const effectiveOwner=serviceReady?visibleService.operator||'human':active?.owner;
 const serviceReserved=laneReserved(active);
 const contextCurrent=(value:{scope:string;nonce?:string;provider?:AgentProvider})=>mounted.current&&value.scope===resourceOwner.current&&value.nonce===requestOwner.current&&value.provider===providerOwner.current;
 useEffect(()=>{setRecovery(null);setNotice('');setServiceIssue('');serviceRef.current=null;setService(null);},[resourceScope,request?.nonce,provider]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 async function refreshResource(){const seq=++resourceSequence.current,scope=resourceOwner.current;try{const value=await computeResources.status();if(mounted.current&&seq===resourceSequence.current&&scope===resourceOwner.current)resourceChange.current?.(value,value.sessionId===activeRef.current?.sessionId?activeRef.current?.name:undefined);}catch(error){if(mounted.current&&seq===resourceSequence.current&&scope===resourceOwner.current)report(error);}}
 function acceptService(value:SshServiceState,selected:Session){
  if(!value||!['idle','connecting','connected','disconnecting','disconnected','failed','unknown'].includes(value.status)||activeRef.current?.sessionId!==selected.sessionId)return false;
  if(!value.sessionId){if(!['idle','disconnected'].includes(value.status)||selected.serviceActive)return false;serviceRef.current=null;setService(null);return true;}
  if(value.sessionId!==selected.sessionId||value.profileId!==undefined&&value.profileId!==selected.resource?.profileId||value.profileVersion!==undefined&&value.profileVersion!==selected.resource?.profileVersion)return false;
  if(Number.isSafeInteger(value.revision)){const revision=value.revision!;if(revision<serviceRevision.current)return false;serviceRevision.current=revision;}
  serviceRef.current=value;setService(value);
  if(value.error||value.workflowReady===true||value.status==='disconnected'&&value.terminalAccess==='available')setServiceIssue('');
  return true;
 }
 async function refreshService(){
  const selected=activeRef.current,context={scope:resourceOwner.current,nonce:requestOwner.current,provider:providerOwner.current};if(plainSsh||selected?.kind!=='ssh')return null;
  const key=JSON.stringify([selected.sessionId,context]);if(serviceRead.current?.key===key)return serviceRead.current.promise;
  const current=()=>contextCurrent(context)&&activeRef.current?.sessionId===selected.sessionId;
  const promise=(async()=>{try{
   const value=await sshService.status();if(!current())return null;
   const prior=serviceRef.current,matching=!value.sessionId||value.sessionId===selected.sessionId&&(value.profileId===undefined||value.profileId===selected.resource?.profileId)&&(value.profileVersion===undefined||value.profileVersion===selected.resource?.profileVersion),freshRevision=!Number.isSafeInteger(value.revision)||value.revision!>=serviceRevision.current;
   const available=matching&&freshRevision&&(value.status==='idle'||value.status==='disconnected'||value.status==='failed')&&value.terminalAccess!=='unknown'&&value.terminalAccess!=='reserved';
   if(available&&(selected.serviceActive===true||!!prior&&prior.sessionId===selected.sessionId&&laneReserved(selected))){
    sessionRefreshingRef.current=true;setSessionRefreshing(true);
    try{await list();if(!current())return null;acceptService(value,activeRef.current!);}
    finally{sessionRefreshingRef.current=false;if(mounted.current)setSessionRefreshing(false);}
   }else acceptService(value,activeRef.current!);
   return value;
  }catch(error){if(current())setServiceIssue(serviceRejectedMessage(error));return null;}})();serviceRead.current={key,promise};
  try{return await promise;}finally{if(serviceRead.current?.promise===promise)serviceRead.current=null;}
 }
 useEffect(()=>{
  if(plainSsh||!visible||active?.kind!=='ssh')return;let stopped=false;
  const read=()=>{if(!stopped)void refreshService();};read();
  const unsubscribe=window.studio?.onEvent(event=>{if(event.method==='studio/sshServiceChanged')read();});
  const timer=setInterval(()=>{if(laneReserved(activeRef.current))read();if(!stopped)setServiceNow(Date.now());},1000);
  return()=>{stopped=true;clearInterval(timer);unsubscribe?.();};
 },[visible,active?.sessionId,resourceScope,request?.nonce,provider]);
 async function checkService(){if(serviceChecking)return;const context={scope:resourceOwner.current,nonce:requestOwner.current,provider:providerOwner.current};setServiceChecking(true);try{await list();await refreshService();await refreshResource();}catch(error){if(contextCurrent(context))setServiceIssue(serviceRejectedMessage(error));}finally{if(mounted.current)setServiceChecking(false);}}
 const serviceSwitchNotice=()=>t('请先在连接计算资源中停止当前作业服务，再切换计算资源。');
 async function serviceAllowsSelection(sessionId?:string){
  const active=activeRef.current;if((laneReserved(active))&&sessionId!==active?.sessionId){setNotice(serviceSwitchNotice());return false;}
  if(plainSsh)return true;
  try{const state=await sshService.status();if(state.status!=='disconnected'&&state.status!=='idle'&&state.sessionId!==sessionId){setNotice(serviceSwitchNotice());return false;}return true;}catch{setNotice(t('无法核对作业服务通道，请刷新原连接后再切换。'));return false;}
 }
 async function activateResource(session:Session){if(session.kind!=='ssh'||session.resource?.kind!=='ssh-terminal')return true;const seq=++resourceSequence.current,scope=resourceOwner.current,requestNonce=requestOwner.current,previousId=activeRef.current?.sessionId,reference={kind:'ssh-terminal' as const,profileId:session.resource.profileId,profileVersion:session.resource.profileVersion,sessionId:session.sessionId};const current=()=>mounted.current&&seq===resourceSequence.current&&scope===resourceOwner.current&&requestNonce===requestOwner.current&&activeRef.current?.sessionId===previousId;try{if(!current())return false;const value=await computeResources.activate(reference);if(!current())return false;if(value.kind!=='ssh-terminal'||value.sessionId!==reference.sessionId||value.profileId!==reference.profileId||value.profileVersion!==reference.profileVersion)throw Error(t('计算资源绑定响应与当前终端不匹配。'));resourceChange.current?.(value,session.name);return true;}catch(error){if(current()){setNotice(String(error).includes('返回交互终端')?serviceSwitchNotice():t('计算资源绑定未完成，请重新附加或核对终端。'));report(error);}return false;}}

 function attach(value:Session){if(activeRef.current?.sessionId!==value.sessionId){cursor.current=0;generation.current++;serviceRef.current=null;setService(null);setServiceIssue('');}activeRef.current=value;setNotice('');setActive(value);terminal.current?.focus();}
 async function list(){
  const selectedAtStart=activeRef.current,sequence=++listSequence.current,context={scope:resourceOwner.current,nonce:requestOwner.current,provider:providerOwner.current};let value:{sessions:Session[]};
  try{value=await invoke<{sessions:Session[]}>('sharedTerminal.list');}catch(error){if(!contextCurrent(context)||sequence!==listSequence.current)return [];throw error;}
  if(!contextCurrent(context)||sequence!==listSequence.current)return [];
  if(!value||!Array.isArray(value.sessions))throw Error(t('终端列表响应无效'));
  const compatible=value.sessions.filter(item=>!item.connectionId&&item.resource?.kind!=='ssh-connection');setSessions(compatible);const selected=compatible.find(item=>item.sessionId===activeRef.current?.sessionId);if(selected&&activeRef.current===selectedAtStart){activeRef.current=selected;setActive(selected);}return compatible;
 }
 function report(error:unknown){onError(new Error(terminalMessage(error)));}
 async function action(run:()=>Promise<void>,current=()=>mounted.current,label=t('正在处理终端会话…')){if(busyRef.current)return;busyRef.current=true;setBusyLabel(label);setBusy(true);setNotice('');try{await run();}catch(error){if(current())report(error);}finally{busyRef.current=false;if(mounted.current)setBusy(false);}}
 async function open(value:OpenTarget,explicit?:{newConnection:true;requestId:string}){const context={scope:resourceOwner.current,nonce:requestOwner.current,provider:providerOwner.current},current=()=>contextCurrent(context);await action(async()=>{
  if(!await serviceAllowsSelection()||!current())return;
  let session:Session;
  try{session=await invoke<Session>('sharedTerminal.open',{...value,...explicit});}
  catch(error){if(!current())return;const message=terminalMessage(error);if(/terminal_(?:recovery_required|unavailable)\b/.test(String(error))){setRecovery({...context,target:{...value},requestId:explicit?.requestId||crypto.randomUUID(),message});}else setNotice(message);report(error);return;}
  if(!current())return;if(!await activateResource(session)||!current())return;setRecovery(null);attach(session);setSessions(old=>[session,...old.filter(item=>item.sessionId!==session.sessionId)]);void list().catch(error=>{if(current())report(error);});
 },current,t('正在打开终端…'));}
 async function newConnection(){const value=recoveryRef.current;if(!value||!contextCurrent(value)||!visibleOwner.current||busyRef.current)return;await open(value.target,{newConnection:true,requestId:value.requestId});}
 async function refreshSessions(){const context={scope:resourceOwner.current,nonce:requestOwner.current,provider:providerOwner.current};await action(async()=>{await list();},()=>contextCurrent(context));}
 useEffect(()=>{if(!visible)return;void refreshResource();},[visible,resourceScope]);
 useEffect(()=>{
  if(!visible)return;
  if(!request||lastRequest.current===request.nonce){void list().catch(report);return;}
  if(busyRef.current)return;
  lastRequest.current=request.nonce;
  const {nonce,profileName,connectionMode,connectionId,sessionId,exact,...value}=request;
  if(!exact){void open(value);return;}
  const context={scope:resourceOwner.current,nonce,provider:providerOwner.current},current=()=>contextCurrent(context);
  void action(async()=>{
   const sessions=await list();if(!current())return;
   const original=sessions.find(item=>item.sessionId===sessionId&&item.kind===value.kind&&(!value.profileId||item.resource?.profileId===value.profileId&&item.resource?.profileVersion===value.version));
   if(original?.owner==='human'&&original.alive===true&&!original.expired){attach(original);return;}
   generation.current++;activeRef.current=null;setActive(null);setNotice(t('原终端当前不可用，请核对连接。'));
  },current);
 },[visible,request?.nonce,busy]);

 useEffect(()=>{
  if(!active?.sessionId||!host.current)return;
  const currentId=active.sessionId,writeInput=createHumanInputWriter();let stopped=false;
  const minimum=parseFloat(document.documentElement.style.getPropertyValue('--ui-min-font'))||11;
  const view=new Terminal({fontSize:Math.max(minimum,Number(document.documentElement.style.getPropertyValue('--terminal-font-size'))||13),fontFamily:'Cascadia Code, Consolas, monospace',scrollback:5000,convertEol:false,cursorBlink:true,theme:{background:'#121218',foreground:'#d1d5e4',cursor:'#b8a0f7'}});
  const addon=new FitAddon();view.loadAddon(addon);view.open(host.current);terminal.current=view;fit.current=addon;
  const resize=()=>{if(stopped||activeRef.current?.sessionId!==currentId||!host.current?.clientWidth||!host.current.clientHeight)return;view.options.fontSize=Math.max(parseFloat(document.documentElement.style.getPropertyValue('--ui-min-font'))||11,Number(document.documentElement.style.getPropertyValue('--terminal-font-size'))||13);addon.fit();if(activeRef.current?.alive===true&&!laneReserved(activeRef.current)&&Number.isInteger(view.cols)&&view.cols>=10&&view.cols<=500&&Number.isInteger(view.rows)&&view.rows>=2&&view.rows<=300){const context={scope:resourceOwner.current,nonce:requestOwner.current,provider:providerOwner.current};void invoke('sharedTerminal.resize',{sessionId:currentId,ownerEpoch:activeRef.current.ownerEpoch,cols:view.cols,rows:view.rows} satisfies SharedTerminalResizeRequest).catch(error=>{if(!stopped&&contextCurrent(context)&&activeRef.current?.sessionId===currentId)setNotice(terminalMessage(error));});}};
  const observer=new ResizeObserver(resize);observer.observe(host.current);
  const input=view.onData(data=>{const owner=activeRef.current;if(stopped||busyRef.current||laneReserved(owner)||owner?.sessionId!==currentId||owner.owner!=='human'||owner.alive!==true||owner.expired)return;const ownerEpoch=owner.ownerEpoch,requestId=crypto.randomUUID();inputQueue.current=inputQueue.current.then(async()=>{const latest=activeRef.current;if(stopped||busyRef.current&&!drainingInputRef.current||laneReserved(latest)||latest?.sessionId!==currentId||latest.ownerEpoch!==ownerEpoch||latest.owner!=='human'||latest.expired)return;await writeInput((payload:unknown)=>invoke('sharedTerminal.input',payload),latest,requestId,data);}).catch(error=>{if(!stopped&&mounted.current)report(error);});});
  window.addEventListener('studio:appearance',resize);resize();view.focus();
  return()=>{
   if(stopped)return;stopped=true;input.dispose();observer.disconnect();window.removeEventListener('studio:appearance',resize);if(terminal.current===view){terminal.current=null;fit.current=null;}
   // xterm 5 leaves a viewport initialization timer pending after open().
   // Detach immediately, then release its renderer after that callback drains.
   view.element?.remove();setTimeout(()=>view.dispose(),0);
  };
 },[active?.sessionId]);
 useEffect(()=>{const view=terminal.current;if(view){const editable=visible&&!busy&&!serviceReserved&&active?.owner==='human'&&active?.alive===true&&!active?.expired;view.options.disableStdin=!editable;view.options.cursorBlink=!!editable;if(editable)view.focus();}},[visible,busy,serviceReserved,active?.sessionId,active?.owner,active?.alive,active?.expired]);
 useEffect(()=>{
  if(!visible||!active?.sessionId)return;const id=active.sessionId,epoch=++generation.current;let reading=false,stopped=false,followup:ReturnType<typeof setTimeout>|undefined;
  const read=async()=>{if(reading||stopped)return;const current=activeRef.current;if(current?.sessionId!==id||current.expired||current.alive===null)return;reading=true;
   try{const result=await invoke<ReadResult>('sharedTerminal.read',{sessionId:id,ownerEpoch:current.ownerEpoch,cursor:cursor.current,maxBytes:65536,...current.outputWait?{waitMs:1000}:{}});if(stopped||generation.current!==epoch||activeRef.current?.sessionId!==id||activeRef.current.ownerEpoch!==current.ownerEpoch)return;
    if(result.dropped)terminal.current?.write('\r\n['+t('较早输出已超出回放容量')+']\r\n');
    if(result.output)terminal.current?.write(result.output);if(result.owner!==current.owner||result.ownerEpoch!==current.ownerEpoch||result.alive!==current.alive||result.expired!==current.expired||result.serviceActive!==current.serviceActive||result.serviceStatus!==current.serviceStatus)void refreshResource();cursor.current=result.cursor;if(result.outputWait&&result.alive===true){clearTimeout(followup);followup=setTimeout(()=>void read(),0);}activeRef.current=result;setActive(result);setSessions(old=>old.map(item=>item.sessionId===id?result:item));const priorReadNotice=readNotice.current;readNotice.current='';setNotice(old=>old===priorReadNotice?'':old);
   }catch(error){if(!stopped&&generation.current===epoch){readNotice.current=terminalMessage(error);setNotice(readNotice.current);if(activeRef.current?.status!=='unknown')await list().catch(()=>{});}}
   finally{reading=false;}
  };void read();const timer=setInterval(()=>void read(),500);return()=>{stopped=true;clearInterval(timer);clearTimeout(followup);};
 },[visible,active?.sessionId,resourceScope,request?.nonce,provider]);
 useEffect(()=>{if(visible&&host.current?.clientWidth)try{fit.current?.fit();}catch{}},[visible]);

 async function ownership(){
  const value=activeRef.current,context={scope:resourceOwner.current,nonce:requestOwner.current,provider:providerOwner.current};if(!value||sessionRefreshingRef.current)return;
  const legacyHandoff=activeResource?.kind!=='ssh-connection'&&value.resource?.kind!=='ssh-connection';
  const draftId=context.provider&&value.owner==='human'&&legacyHandoff?draftForHandoff?.(context.provider):undefined;
  const current=()=>contextCurrent(context)&&activeRef.current?.sessionId===value.sessionId;
  await action(async()=>{
   drainingInputRef.current=true;try{await inputQueue.current;}finally{drainingInputRef.current=false;}if(!current())return;
   if(value.kind==='ssh'){await list();if(!current())return;}
   const selected=activeRef.current!,state=serviceRef.current,serviceMode=state?.sessionId===selected.sessionId&&state.status==='connected'&&state.workflowReady===true&&state.terminalAccess!=='unknown';
   if(laneReserved(selected)&&!serviceMode){setNotice(t('作业服务通道尚未就绪，请先核对当前连接。'));return;}
   const owner=serviceMode?state.operator||'human':selected.owner,target=owner==='human'?'agent':'human';
   const identity={sessionId:selected.sessionId,ownerEpoch:selected.ownerEpoch};
   const next=await invokeTyped('sharedTerminal.owner',target==='human'?{...identity,owner:'human'}:{...identity,owner:'agent',
    ...provider?(draftId?{provider,attachmentDraftId:draftId}:{provider}):{}});
   if(!current())return;
   activeRef.current=next;setActive(next);setSessions(old=>old.map(item=>item.sessionId===next.sessionId?next:item));
   if(next.handoffKind==='service'&&next.serviceOwner&&serviceRef.current?.sessionId===next.sessionId){serviceRef.current={...serviceRef.current,operator:next.serviceOwner};setService(serviceRef.current);}
   if(next.conversation)onConversationPrepared?.(next.conversation,next.adoptedDraftId===draftId&&next.conversation.provider===context.provider?draftId:undefined);
   await list();await refreshService();await refreshResource();
  },current,t('正在交接计算资源…'));
 }
 async function end(){const value=activeRef.current;if(!value)return;await action(async()=>{await invoke('sharedTerminal.close',{sessionId:value.sessionId});if(!mounted.current||activeRef.current?.sessionId!==value.sessionId)return;generation.current++;serviceRef.current=null;setService(null);setServiceIssue('');activeRef.current=null;setActive(null);setSessions(old=>old.filter(item=>item.sessionId!==value.sessionId));setNotice(t('会话已结束'));void list().catch(report);await refreshResource();});}
 function detach(){if(laneReserved(activeRef.current)){setNotice(serviceSwitchNotice());return;}resourceSequence.current++;generation.current++;activeRef.current=null;setActive(null);setNotice(t('视图已分离，会话继续运行'));}
 const visibleRecovery=recovery&&recovery.scope===resourceScope&&recovery.nonce===request?.nonce&&recovery.provider===provider?recovery:null;
 const serviceInProgress=visibleService?.status==='connecting'||visibleService?.status==='disconnecting';
 const transfer=serviceTransfer(visibleService),phaseSeconds=serviceInProgress?serviceDuration(visibleService?.phaseStartedAt,serviceNow):null,totalSeconds=serviceDuration(visibleService?.startedAt,serviceInProgress?serviceNow:visibleService?.updatedAt||serviceNow);
 const serviceFailure=visibleService?.error?serviceErrorMessage(visibleService.error.code):serviceIssue||(['failed','unknown'].includes(visibleService?.status||'')?serviceErrorMessage(null):'');
 const serviceUnconfirmed=visibleService?.terminalAccess==='unknown';
 const pythonVersion=serviceVersion(visibleService?.error?.python),sqliteVersion=serviceVersion(visibleService?.error?.sqlite);
 return <section className="shared-terminal-panel" data-testid="shared-terminal-panel">
  <div className="shared-terminal-toolbar">
   <select aria-label={t('共享终端会话')} value={active?.sessionId||''} disabled={busy||serviceReserved} onChange={event=>{const found=sessions.find(item=>item.sessionId===event.target.value);if(found)void action(async()=>{if(!await serviceAllowsSelection(found.sessionId)||!mounted.current)return;if(await activateResource(found))attach(found);});else detach();}}><option value="">{t('选择已有会话')}</option>{sessions.map(item=><option key={item.sessionId} value={item.sessionId}>{item.name} · {t(item.expired?'已过期':item.alive===true?'运行中':item.alive===null?'状态未知':'已结束')}</option>)}</select>
   {active&&<><span className={'shared-terminal-owner '+(effectiveOwner==='agent'?'is-agent':'')}>{t(serviceReady?effectiveOwner==='agent'?'Agent 使用作业服务':'作业服务由你操作':effectiveOwner==='human'?'由你操作':'由 Agent 操作')}</span><button className="button" data-testid="shared-terminal-handoff" disabled={busy||sessionRefreshing||serviceReserved&&!serviceReady||active.alive!==true||active.expired||(effectiveOwner==='human'&&!canShare)} title={t(serviceReady?'交接当前对话的作业服务使用权，终端保持只读。':effectiveOwner==='human'?'确认登录完成后，仅共享交接后的输出。':'立即停止 Agent 读写并由你操作')} onClick={()=>void ownership()}>{t(effectiveOwner==='human'?active.kind==='ssh'&&!serviceReady?'登录完成，交给 Agent':'交给 Agent':'我来操作')}</button></>}
   {active&&<button className="button shared-terminal-disconnect" data-testid="shared-terminal-disconnect" disabled={busy} title={t('关闭当前终端，保留已保存连接和其他会话')} onClick={()=>void end()}>{t(active.kind==='ssh'?serviceFailure&&serviceReserved?'结束此 SSH 会话':'断开连接':'关闭终端')}</button>}
   <details className="shared-terminal-menu" ref={menu}><summary aria-label={t('会话操作')}>⋯</summary><div onClick={()=>{if(menu.current)menu.current.open=false;}}><button className="button" disabled={busy||serviceReserved} onClick={()=>void open({kind:'local',mode:'interactive'})}>{t('打开本地交互终端')}</button><button className="button" disabled={busy} onClick={()=>void list().catch(report)}>{t('刷新会话列表')}</button>{active&&<button className="button" disabled={busy||serviceReserved} onClick={detach}>{t('分离视图')}</button>}</div></details>
  </div>
  <LoadingFeedback busy={busy} label={busyLabel}/>
  <LoadingFeedback busy={serviceInProgress} label={t('正在接入作业服务…')} phase={t(servicePhaseMessage(visibleService?.phase))} startedAt={visibleService?.startedAt}/>
  {visibleRecovery&&<div className="shared-terminal-confirm" role="alert" data-testid="shared-terminal-recovery"><span>{visibleRecovery.message}</span><button className="button" data-testid="shared-terminal-recovery-refresh" disabled={busy} onClick={()=>void refreshSessions()}>{t('刷新会话列表')}</button><button className="button" data-testid="shared-terminal-recovery-new" disabled={busy||!visible} onClick={()=>void newConnection()}>{t(visibleRecovery.target.kind==='ssh'?'保留原会话，另开新连接':'保留原会话，另开新终端')}</button></div>}
  {active?.kind==='ssh'&&(visibleService?.phase||serviceFailure||serviceReserved)&&<div className="ssh-service-status" data-testid="ssh-service-status">
   <div className="ssh-service-status-heading"><strong role="status" data-testid="ssh-service-phase">{t(servicePhaseMessage(visibleService?.phase))}</strong><button className="button" data-testid="ssh-service-refresh" disabled={serviceChecking} onClick={()=>void checkService()}>{t(serviceChecking?'正在核对…':'重新核对状态')}</button></div>
   {(phaseSeconds!==null||totalSeconds!==null)&&<p className="ssh-service-timing" data-testid="ssh-service-timing">{phaseSeconds!==null&&<span>{t('本阶段已用时')} {phaseSeconds} {t('秒')}</span>}{totalSeconds!==null&&<span>{t('本次接入已用时')} {totalSeconds} {t('秒')}</span>}</p>}
   {transfer&&<div data-testid="ssh-service-transfer"><progress aria-label={t('当前阶段已确认传输')} value={transfer.completed} max={transfer.total}/><span>{t('已确认传输')} {transfer.completed.toLocaleString()} / {transfer.total.toLocaleString()} B · {transfer.percent}%</span></div>}
   {serviceFailure&&<p role="alert" data-testid="ssh-service-error">{visibleService?.error?.phase&&<strong>{t('失败阶段')}：{t(servicePhaseMessage(visibleService.error.phase))}。 </strong>}{t(serviceFailure)}</p>}
   {(pythonVersion||sqliteVersion)&&<p data-testid="ssh-service-versions">{pythonVersion&&<span>Python {pythonVersion}</span>}{pythonVersion&&sqliteVersion?' · ':''}{sqliteVersion&&<span>SQLite {sqliteVersion}</span>}</p>}
   {serviceUnconfirmed&&<p role="status" data-testid="ssh-service-unknown">{t('通道恢复尚未确认，终端保持只读。可重新核对状态，或明确结束此 SSH 会话；不会自动重连或重发请求。')}</p>}
  </div>}
  {serviceReserved&&<p className="shared-terminal-notice" role="status" data-testid="ssh-service-reserved">{t(serviceReady?'作业服务使用此通道。Agent 可通过服务工具操作，终端保持只读。':'正在核对作业服务通道，终端暂时只读。')}</p>}
  {active?.kind==='ssh'&&<p className="shared-terminal-notice" data-testid="ssh-resource-scope">{t(plainSsh?'普通 SSH 模式仅提供终端操作。需要作业服务时，请在连接设置中使用受支持的登录方式；不会自动另开连接。':'作业服务设置、检查和更新位于连接计算资源。交接只作用于当前对话。')}</p>}
  {notice&&<p className="shared-terminal-notice" role="status">{notice}</p>}
  {active?.alive===false&&<div className="shared-terminal-notice" role="status">{t(active.kind==='ssh'?'SSH 进程已退出，此会话不可输入。':'终端进程已退出，此会话不可输入。')}{typeof active.exitCode==='number'?' '+t('退出码')+' '+active.exitCode:''}</div>}
  {active?<><div className="shared-terminal-host" data-guide-target={active.kind==='ssh'?'ssh-terminal':undefined} ref={host} tabIndex={-1} role="region" aria-label={t('交互终端')} onPointerDown={()=>{const current=activeRef.current;if(!busyRef.current&&!laneReserved(current)&&current?.owner==='human'&&current.alive===true&&!current.expired)terminal.current?.focus();}}/><div className="shared-terminal-caption"><span>{t(active.kind==='local'?'本地会话':active.mode==='key'?'密钥自动登录':'交互式登录')} · {active.sessionId.slice(0,8)}</span><span>{active.expired?t('访问已过期，请结束此会话后重新打开。'):active.alive===true?t('终端进程运行中'):active.alive===null?t('状态未知'):t('终端进程已结束')}{typeof active.exitCode==='number'?' · '+active.exitCode:''}</span></div></>:<div className="shared-terminal-empty"><p>{t('附加已有会话，或打开本地交互终端。')}</p><button className="button" data-testid="open-local-shared-terminal" disabled={busy||serviceReserved} onClick={()=>void open({kind:'local',mode:'interactive'})}>{t('打开本地交互终端')}</button></div>}
 </section>;
}
