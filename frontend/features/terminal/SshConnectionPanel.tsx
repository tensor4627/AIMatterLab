import {useEffect,useRef,useState,type FocusEvent,type KeyboardEvent} from 'react';
import {Check,ChevronDown,Ellipsis,RefreshCw,Server,Settings2,TriangleAlert} from 'lucide-react';
import {useManagedResources} from '../compute/useManagedResources';
import {Terminal} from '@xterm/xterm';
import {createHumanInputWriter} from './human-input.mjs';
import {FitAddon} from '@xterm/addon-fit';
import {readTerminalAppearance} from './terminal-appearance';
import {serviceErrorMessage,serviceIdentityUnconfirmed,servicePhaseMessage,serviceTransfer} from './ssh-service-presentation';
import {invoke} from '../../api/studio';
import {managedSshServices} from '../../api/compute-resources';
import {t} from '../../ui/i18n';
import type {PublishedSshResource} from '../../../contracts/dto/managed-compute';
import type {ComputeResourceState,ManagedSshServiceStatus,ResourceWorkspaceReference,SharedTerminalResizeRequest} from '../../../contracts/dto/compute';
import type {AgentProvider,Conversation} from '../../../contracts/dto/agent';
import {verifiedSshConnection,sshConnectionCode,sshConnectionMessage,sshActionLabel,sshStateLabel,type SshConnectionState,type IndependentSshService} from '../compute/ssh-connection-types';
import ResourceWorkspaceReview,{previewResourceWorkspace,sameWorkspaceTarget,type WorkspacePreview} from '../compute/ResourceWorkspaceReview';

type Shell={sessionId:string;serviceGrantPending?:boolean;conversationName?:string;humanInputSequence?:number;outputWait?:boolean;awaitingConversation?:boolean;conversationTerminal?:boolean;currentConversation?:boolean;connectionId?:string;resource?:{kind:string;connectionId?:string;profileId?:string;profileVersion?:number};name:string;owner:'human'|'agent';ownerEpoch:number;alive:boolean|null;expired?:boolean;output?:string;cursor?:number;dropped?:boolean};
export type SshEnvironmentHelpTarget={id:string;version:number;name:string;connectionId?:string};
export type HandoffLessonStage='ssh-login'|'ssh-workspace'|'ssh-service-observe';
type Props={resourceScope?:string;activeResource?:ComputeResourceState|null;visible:boolean;request:{nonce:string;profileId?:string;version?:number;profileName?:string;connectionId?:string;sessionId?:string;exact?:true;reviewWorkspace?:'handoff'|'change'};canShare:boolean;provider?:AgentProvider;onError:(error:unknown)=>void;onConversationPrepared?:(conversation:Conversation)=>void;onResourceChange?:(state:ComputeResourceState,label?:string)=>void;onConfigureSsh?:(ref?:{profileId:string;profileVersion:number;section?:"service"|"environment"},connectionId?:string,sessionId?:string)=>void;onServiceEnvironmentHelp?:(target:SshEnvironmentHelpTarget)=>void;onHandoffLesson?:(stage:HandoffLessonStage,target:SshEnvironmentHelpTarget)=>void;onUseForWorkflow?:(ref:ResourceWorkspaceReference)=>Promise<unknown>;onPlainSsh?:()=>void};
type ChannelInput={pending:Promise<void>;locked:boolean;observationEpoch:number};
type LoginState={status:'waiting_authentication'|'checking'|'complete'|'failed';phase?:'waiting_authentication'|'checking_authentication'|'opening_shell';code?:string};
type LoginResult={connection:SshConnectionState;shell?:Shell;login?:LoginState};
type LoginAttempt={completing:boolean;requiresContinue:boolean;completionResult:number};
type LoginFlow={requestId:string;connectionId:string;awaitingOpen?:boolean;handoffScope?:string;attempt:LoginAttempt;observing:boolean;canCheck:boolean;finished:boolean;restoreShell:boolean;restoredAuthenticated?:boolean;originalShellId?:string;shellChosen?:boolean};
type InventoryRefresh={ticket:number;read:number;id:string;scope:string;pending:boolean;servicePending:boolean};
type Diagnostic={code:string;action:string;message:string;connectionId:string;requestId:string;workflowScope?:string};
const workflowAction='compute.managed.useForWorkflow';
type ShellReadIdentity={connectionId:string;sessionId:string;ownerEpoch:number};
type ShellReadDiagnostic=ShellReadIdentity&{code:string;message:string};
type GeometryDiagnostic={connectionId:string;sessionId?:string;ownerEpoch?:number;code:string};
type ObservedService=IndependentSshService&ManagedSshServiceStatus;
async function sshInvoke<T=unknown>(method:string,data?:unknown):Promise<T>{try{return await invoke<T>(method,data);}catch(error){const code=sshConnectionCode(error)||'terminal_operation_failed';throw Object.assign(new Error(sshConnectionMessage({code})),{code,action:method});}}

function newLoginFlow(requestId:string):LoginFlow{
 return {requestId,connectionId:'',attempt:{completing:false,requiresContinue:false,completionResult:0},observing:false,canCheck:true,finished:false,restoreShell:false};
}

function sameTerminalRequest(a:Props['request'],b:Props['request']){
 return a.nonce===b.nonce&&a.profileId===b.profileId&&a.version===b.version&&a.connectionId===b.connectionId&&a.sessionId===b.sessionId&&a.exact===b.exact;
}

function shellForConnection(shell:Shell,connection:SshConnectionState){
 const {connectionId,profileId,profileVersion}=connection,resource=shell.resource;
 return (shell.connectionId===connectionId||!shell.connectionId&&resource?.kind==='ssh-connection'&&resource.connectionId===connectionId)&&
  (!resource||resource.kind==='ssh-connection'&&resource.connectionId===connectionId&&
   (resource.profileId===undefined||resource.profileId===profileId)&&(resource.profileVersion===undefined||resource.profileVersion===profileVersion));
}

function closeDisclosure(disclosure:HTMLDetailsElement|null,returnFocus=false){
 if(!disclosure?.open)return;
 disclosure.open=false;
 if(returnFocus)disclosure.querySelector('summary')?.focus();
}
function disclosureBlur(event:FocusEvent<HTMLDetailsElement>){
 if(!event.currentTarget.contains(event.relatedTarget))closeDisclosure(event.currentTarget);
}
function disclosureKeyDown(event:KeyboardEvent<HTMLDetailsElement>){
 if(event.key!=='Escape'||!event.currentTarget.open)return;
 event.stopPropagation();
 event.preventDefault();
 closeDisclosure(event.currentTarget,true);
}

function ChannelTerminal({connection,shell,visible,resourceScope='',onGeometry,inputState,onShell,onConnection,onError,onReadError,onReadSuccess}:{connection:SshConnectionState;shell?:Shell;visible:boolean;resourceScope?:string;onGeometry?:(value:GeometryDiagnostic|null)=>void;inputState:ChannelInput;onShell:(shell:Shell)=>void;onConnection:(connection:SshConnectionState)=>void;onError:(error:unknown)=>void;onReadError?:(error:unknown,identity:ShellReadIdentity)=>void;onReadSuccess?:(identity:ShellReadIdentity)=>void}){
 const host=useRef<HTMLDivElement>(null),view=useRef<Terminal|null>(null),syncSize=useRef<(()=>void)|null>(null),syncRead=useRef<(()=>void)|null>(null),displayEpoch=useRef(0),latest=useRef({connection,shell,visible,resourceScope,onGeometry,onConnection});
 if(visible!==latest.current.visible||resourceScope!==latest.current.resourceScope)displayEpoch.current++;
 latest.current={connection,shell,visible,resourceScope,onGeometry,onConnection};
 useEffect(()=>{
  if(!host.current)return;let stopped=false,reading=false,cursor=0,inputs=Promise.resolve();const id=connection.connectionId,sessionId=shell?.sessionId;
  const writeInput=createHumanInputWriter();let followup:ReturnType<typeof setTimeout>|undefined;
  const term=new Terminal({...readTerminalAppearance(),fontFamily:'Cascadia Code, Consolas, monospace',scrollback:2000}),fit=new FitAddon();term.loadAddon(fit);term.open(host.current);view.current=term;
  const current=()=>!stopped&&latest.current.connection.connectionId===id&&latest.current.shell?.sessionId===sessionId;
  const editable=()=>current()&&latest.current.visible&&(sessionId?latest.current.shell?.owner==='human'&&!latest.current.shell.awaitingConversation&&latest.current.shell.alive===true&&!latest.current.shell.expired:latest.current.connection.status==='authenticating');
  const input=term.onData(data=>{
   if(inputState.locked||!editable())return;
   const ownerEpoch=latest.current.shell?.ownerEpoch,display=displayEpoch.current;
   const canSend=()=>editable()&&display===displayEpoch.current&&latest.current.shell?.ownerEpoch===ownerEpoch;
   const send=async()=>{
    for(const part of data.match(/[\s\S]{1,1024}/gu)||[]){
     if(!canSend())return;
     if(sessionId)await writeInput((payload:unknown)=>sshInvoke('sharedTerminal.input',payload),latest.current.shell!,crypto.randomUUID(),part);
     else await sshInvoke('compute.sshConnection.authInput',{connectionId:id,requestId:crypto.randomUUID(),data:part});
    }
   };
   inputs=inputs.then(send,send);inputState.pending=inputs;void inputs.catch(error=>{if(canSend())onError(error);});
  });
  let sizeRequest=0;
  const resize=()=>{
   if(!current()||!latest.current.visible||!host.current?.clientWidth||!host.current.clientHeight)return;
   fit.fit();const displayed=latest.current.shell;
   if(inputState.locked||displayed?.awaitingConversation||!sessionId&&latest.current.connection.status!=='authenticating')return;
   const {cols,rows}=term;if(!Number.isInteger(cols)||cols<10||cols>500||!Number.isInteger(rows)||rows<2||rows>300)return;
   const request=++sizeRequest,ownerEpoch=displayed?.ownerEpoch,scope=latest.current.resourceScope,observation=inputState.observationEpoch;
   const stillDisplayed=()=>current()&&request===sizeRequest&&latest.current.visible&&!inputState.locked&&observation===inputState.observationEpoch&&scope===latest.current.resourceScope&&
    (sessionId?ownerEpoch===latest.current.shell?.ownerEpoch&&!latest.current.shell?.awaitingConversation:latest.current.connection.status==='authenticating');
   const size=displayed?{sessionId:displayed.sessionId,ownerEpoch:displayed.ownerEpoch,cols,rows} satisfies SharedTerminalResizeRequest:{connectionId:id,cols,rows};
   void sshInvoke(displayed?'sharedTerminal.resize':'compute.sshConnection.authResize',size).then(()=>{
    if(stillDisplayed())latest.current.onGeometry?.(null);
   },error=>{
    if(!stillDisplayed())return;
    if(latest.current.onGeometry)latest.current.onGeometry({connectionId:id,sessionId,ownerEpoch,code:sshConnectionCode(error)||'terminal_operation_failed'});
    else onError(error);
   });
  };
  syncSize.current=resize;
  const appearance=()=>{
   if(!current())return;
   const next=readTerminalAppearance(),fontChanged=term.options.fontSize!==next.fontSize;
   term.options.theme=next.theme;
   if(fontChanged){term.options.fontSize=next.fontSize;resize();}
  };
  const observer=new ResizeObserver(resize);observer.observe(host.current);
  window.addEventListener('studio:appearance',appearance);
  const read=async()=>{if(reading||inputState.locked||!current()||!latest.current.visible)return;reading=true;const readEpoch=latest.current.shell?.ownerEpoch,observationEpoch=inputState.observationEpoch,display=displayEpoch.current,waiting=latest.current.shell?.awaitingConversation;
   // Handoff binds a conversation before returning its new owner epoch. Reads
   // started before that transition must not publish a stale result or error.
   const observationCurrent=()=>current()&&latest.current.visible&&display===displayEpoch.current&&waiting===latest.current.shell?.awaitingConversation&&!inputState.locked&&inputState.observationEpoch===observationEpoch&&latest.current.shell?.ownerEpoch===readEpoch;
   const replay=(output:string|undefined,end:number,dropped?:boolean)=>{
    if(dropped)term.write('\r\n['+t('较早输出已超出回放容量')+']\r\n');
    if(output)term.write(output);
    const advanced=end>cursor;cursor=end;
    if(advanced&&(output||dropped)){clearTimeout(followup);followup=setTimeout(()=>void read(),0);}
   };
   try{
    if(sessionId){
     const before=latest.current.shell!;
     const next=await sshInvoke<Shell>('sharedTerminal.read',{sessionId,ownerEpoch:before.ownerEpoch,cursor,maxBytes:65536,...before.outputWait?{waitMs:1000}:{}});
     if(!observationCurrent()||next.sessionId!==sessionId||next.ownerEpoch!==readEpoch||!shellForConnection(next,latest.current.connection))return;
     const end=next.cursor??cursor;
     if(!Number.isSafeInteger(end)||end<cursor)throw Error('terminal_unavailable');
     replay(next.output,end,next.dropped);onShell(next);
     if(next.alive===true&&!next.expired)onReadSuccess?.({connectionId:id,sessionId,ownerEpoch:before.ownerEpoch});
    }else{
     const next=await sshInvoke<{connectionId:string;state:SshConnectionState;output:string;cursor:number;dropped:boolean}>('compute.sshConnection.authRead',{connectionId:id,cursor,maxBytes:65536});
     if(!observationCurrent()||next.connectionId!==id)return;
     const expected=latest.current.connection;
     if(typeof next.output!=='string'||!Number.isSafeInteger(next.cursor)||next.cursor<cursor||!verifiedSshConnection(next.state)||next.state.connectionId!==id||next.state.profileId!==expected.profileId||next.state.profileVersion!==expected.profileVersion||expected.loginRequestId&&next.state.loginRequestId!==expected.loginRequestId)throw Error('terminal_unavailable');
     replay(next.output,next.cursor,next.dropped);latest.current.onConnection(next.state);
    }
   }catch(error){if(observationCurrent()&&!(waiting&&['terminal_owner_changed','terminal_context_changed'].includes(sshConnectionCode(error)))){if(sessionId&&typeof readEpoch==='number'&&onReadError)onReadError(error,{connectionId:id,sessionId,ownerEpoch:readEpoch});else onError(error);}}
   finally{
    reading=false;
    if(current()&&latest.current.visible&&display!==displayEpoch.current){clearTimeout(followup);followup=setTimeout(()=>void read(),0);}
   }
  };
  syncRead.current=()=>void read();const timer=setInterval(()=>void read(),500);return()=>{
   if(stopped)return;stopped=true;syncSize.current=null;syncRead.current=null;clearInterval(timer);clearTimeout(followup);input.dispose();observer.disconnect();window.removeEventListener('studio:appearance',appearance);if(view.current===term)view.current=null;
   // xterm 5 queues viewport initialization during open(). Let it finish before
   // disposing its renderer, after all channel callbacks and visible DOM detach.
   term.element?.remove();setTimeout(()=>term.dispose(),0);
  };
 },[connection.connectionId,shell?.sessionId]);
 useEffect(()=>{syncSize.current?.();syncRead.current?.();},[connection.connectionId,connection.status,shell?.sessionId,shell?.ownerEpoch,shell?.awaitingConversation,resourceScope,visible]);
 useEffect(()=>{if(view.current){view.current.options.disableStdin=!visible||(shell?shell.owner!=='human'||!!shell.awaitingConversation||shell.alive!==true||!!shell.expired:connection.status!=='authenticating');}},[visible,shell?.sessionId,shell?.owner,shell?.awaitingConversation,shell?.ownerEpoch,shell?.alive,shell?.expired,connection.connectionId,connection.status]);
 return <div className="shared-terminal-host" data-guide-target={shell?'ssh-shell':'ssh-terminal'} tabIndex={-1} ref={host} role="region" aria-label={t(shell?'SSH 终端':'SSH 登录终端')} onPointerDown={()=>view.current?.focus()}/>;
}

export default function SshConnectionPanel({visible,request,provider,resourceScope='',activeResource,onError,onResourceChange,onConfigureSsh,onServiceEnvironmentHelp,onHandoffLesson,onUseForWorkflow,onPlainSsh}:Props){
 const [connections,setConnections]=useState<SshConnectionState[]>([]),[listedNonce,setListedNonce]=useState(''),[selected,setSelected]=useState(''),[shells,setShells]=useState<Shell[]>([]),[shellId,setShellId]=useState(''),[service,setService]=useState<ObservedService|null>(null),[pendingAction,setPendingAction]=useState<'publish'|'terminal'|null>(null),[notice,setNotice]=useState(''),[diagnostic,setDiagnostic]=useState<Diagnostic|null>(null),[loginState,setLoginState]=useState<LoginState|null>(null),[loginBusy,setLoginBusy]=useState(false);
 const listed=listedNonce===request.nonce;
 const busy=pendingAction!==null;
 const [readDiagnostic,setReadDiagnostic]=useState<ShellReadDiagnostic|null>(null);
 const [geometry,setGeometry]=useState<GeometryDiagnostic|null>(null);
 const managed=useManagedResources();
 const [publication,setPublication]=useState<PublishedSshResource|null>(null);
 const [workspaceReview,setWorkspaceReview]=useState<{target:ResourceWorkspaceReference;preview?:WorkspacePreview;initialError?:string;scope:string;nonce:string;changing:boolean}|null>(null);
 const workspaceGuideOpened=useRef('');
 const [inventoryError,setInventoryError]=useState<{id:string;scope:string;code:string}|null>(null);
 const moreDetails=useRef<HTMLDetailsElement>(null),statusDetails=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{closeDisclosure(moreDetails.current);closeDisclosure(statusDetails.current);},[visible,request.nonce]);
 const alive=useRef(true),flight=useRef(false),generation=useRef(0),operations=useRef(0),reads=useRef(0),lastError=useRef(''),startedRequest=useRef(''),authInput=useRef<ChannelInput>({pending:Promise.resolve(),locked:false,observationEpoch:0}),shellInput=useRef<ChannelInput>({pending:Promise.resolve(),locked:false,observationEpoch:0}),latest=useRef({selected,request,resourceScope,visible});latest.current={selected,request,resourceScope,visible};
 const login=useRef(newLoginFlow(request.nonce));
 const loginAttempts=useRef(new Map<string,LoginAttempt>());
 const inventory=useRef<InventoryRefresh|null>(null);
 const viewRequest=useRef(request);
 const exactShell=useRef<string|undefined>(undefined);
 const shellCatalogueScope=useRef(resourceScope);
 const terminalNumbers=useRef(new Map<string,number>());
 function shellLabel(item:Shell){if(!terminalNumbers.current.has(item.sessionId))terminalNumbers.current.set(item.sessionId,terminalNumbers.current.size+1);const n=terminalNumbers.current.get(item.sessionId);return item.owner==='agent'||item.awaitingConversation?'Agent · '+(item.conversationName||t(item.awaitingConversation?'等待会话接管':'终端')+' '+n):t('我的终端')+' '+n;}
 const viewCurrent=sameTerminalRequest(viewRequest.current,request);
 const connection=viewCurrent?connections.find(value=>value.connectionId===selected&&value.profileId===request.profileId&&value.profileVersion===request.version):undefined;
 const selectableShells=shells.filter(item=>!item.conversationTerminal||item.currentConversation&&shellCatalogueScope.current===resourceScope);
 const shell=selectableShells.find(value=>value.sessionId===shellId),ready=!!connection&&connection.status==='authenticated'&&connection.authentication==='verified'&&connection.capabilities.multiplex;
 const candidates=connections.filter(value=>value.profileId===request.profileId&&value.profileVersion===request.version&&['authenticating','authenticated'].includes(value.status));
 const observedConnection=useRef(connection);observedConnection.current=connection;
 const observedShell=useRef(shell);observedShell.current=shell;
 const ownService=service?.connectionId===selected?service:null;
 const transfer=ownService?.status==='connecting'?serviceTransfer(ownService):null;
 const confirmed=managed.resources.find(r=>r.connectionId===selected&&r.profileId===connection?.profileId&&r.profileVersion===connection?.profileVersion);
 const hosted=confirmed||(ready&&publication?.connectionId===selected&&publication.profileId===connection.profileId&&publication.profileVersion===connection.profileVersion?publication:null);
 const hostedRef=useRef(hosted);hostedRef.current=hosted;
 const managedServiceRead=useRef(false);
 const servicePending=hosted?.serviceStatus==='preparing'||ownService?.status==='connecting'||ownService?.status==='unknown'||ownService?.status==='connected'&&!ownService.workflowReady;
 useEffect(()=>{if(confirmed||!ready||publication?.connectionId!==selected)setPublication(null);},[confirmed,ready,selected,publication]);
 const serviceReady=hosted?.serviceReady||ownService?.status==='connected'&&ownService.workflowReady===true;
 const workflowBound=!!(connection&&activeResource?.connectionId===connection.connectionId&&activeResource.capabilities?.service.workflowReady);
 const canUseForWorkflow=!!(onUseForWorkflow&&ready&&hosted?.serviceReady&&connection&&!workflowBound);
 useEffect(()=>{
  setDiagnostic(previous=>previous?.action===workflowAction&&(previous.workflowScope!==resourceScope||previous.connectionId!==selected||workflowBound)?null:previous);
 },[resourceScope,selected,workflowBound]);
 const lessonTarget=connection?{id:connection.profileId,version:connection.profileVersion,name:request.profileName||connection.profileId,connectionId:connection.connectionId}:null;
 function accept(value:SshConnectionState){if(!verifiedSshConnection(value))throw Error('Invalid SSH connection response');setConnections(old=>{const prior=old.find(item=>item.connectionId===value.connectionId);return prior&&prior.revision>value.revision?old:[value,...old.filter(item=>item.connectionId!==value.connectionId)];});}
 function report(error:unknown,fallbackAction='connection'){
  const action=error&&typeof error==='object'&&'action' in error&&typeof error.action==='string'?error.action:fallbackAction;
  const code=sshConnectionCode(error)||(action===workflowAction?'ssh_service_workflow_unconfirmed':'terminal_operation_failed');
  const message=t(action==='compute.managed.publish'&&code==='ssh_connection_changed'?'托管回执与当前 SSH 连接不匹配。请刷新并核对原连接。':sshConnectionMessage({code}));
  setDiagnostic({code,action,message,connectionId:login.current.connectionId,requestId:login.current.requestId,...action===workflowAction?{workflowScope:latest.current.resourceScope}:{}});
  const key=action+':'+code;
  if(lastError.current!==key){
   lastError.current=key;
   onError(Object.assign(new Error(message),{code,action,phase:action,...latest.current.visible?{presentation:'inline'}:{}}));
  }
 }
 const currentRead=(identity:ShellReadIdentity)=>alive.current&&latest.current.selected===identity.connectionId&&observedConnection.current?.connectionId===identity.connectionId&&observedShell.current?.sessionId===identity.sessionId&&observedShell.current.ownerEpoch===identity.ownerEpoch;
 function reportRead(error:unknown,identity:ShellReadIdentity){if(!currentRead(identity))return;const code=sshConnectionCode(error)||'terminal_operation_failed';setReadDiagnostic({...identity,code,message:t(sshConnectionMessage({code}))});}
 function confirmRead(identity:ShellReadIdentity){
  if(!currentRead(identity)||observedShell.current?.alive!==true||observedShell.current.expired)return;
  // Refreshing ownership is not evidence that terminal reading recovered. Only a
  // successful read of this exact current channel can retire its old read fault.
  setReadDiagnostic(previous=>previous?.connectionId===identity.connectionId&&previous.sessionId===identity.sessionId&&previous.ownerEpoch<=identity.ownerEpoch?null:previous);
 }
 async function refreshService(view:InventoryRefresh,current:()=>boolean){
  if(view.servicePending)return;
  view.servicePending=true;
  try{
   const exact=hostedRef.current,base=exact?.connectionId===view.id&&typeof exact.profileVersion==='number'?{connectionId:view.id,profileId:exact.profileId,profileVersion:exact.profileVersion}:null;
   const state=base?await managedSshServices.status(base):await sshInvoke<ObservedService>('compute.sshService.status',{connectionId:view.id});
   if(current()&&(state.connectionId===view.id||!state.connectionId&&state.status==='disconnected')){
    const sameRoute=managedServiceRead.current===!!base;managedServiceRead.current=!!base;
    setService(old=>sameRoute&&old?.connectionId===state.connectionId&&(old?.revision??-1)>(state.revision??-1)?old:state);
   }
  }catch{/* Shell discovery retains its own observation and can still succeed. */}
  finally{view.servicePending=false;}
 }
 async function refresh(){
  const ticket=generation.current,read=reads.current,id=latest.current.selected,scope=latest.current.resourceScope,requested=latest.current.request;
  const previous=inventory.current;
  const view=previous&&previous.ticket===ticket&&previous.read===read&&previous.id===id&&previous.scope===scope?previous:{ticket,read,id,scope,pending:false,servicePending:false};
  if(view.pending)return;
  inventory.current=view;view.pending=true;
  const observingHandoff=shellInput.current.locked;
  const current=()=>alive.current&&inventory.current===view&&ticket===generation.current&&read===reads.current&&id===latest.current.selected&&scope===latest.current.resourceScope&&sameTerminalRequest(requested,latest.current.request)&&sameTerminalRequest(requested,viewRequest.current);
  try{
   const listing=await sshInvoke<{connections:SshConnectionState[]}>('compute.sshConnection.list',{});
   if(!current())return;
   if(!Array.isArray(listing.connections)||!listing.connections.every(verifiedSshConnection))throw Error('Invalid connection listing');
   setListedNonce(requested.nonce);
   setConnections(old=>listing.connections.map(value=>{
    const prior=old.find(item=>item.connectionId===value.connectionId);
    return prior&&prior.revision>value.revision?prior:value;
   }));
   const opening=login.current;
   if(opening.awaitingOpen&&!flight.current&&!requested.exact){
    const match=listing.connections.find(value=>value.loginRequestId===opening.requestId&&value.profileId===requested.profileId&&value.profileVersion===requested.version);
    if(match){acceptOpen(opening,match);setInventoryError(null);return;}
   }
   const listedConnection=listing.connections.find(value=>value.connectionId===id&&value.profileId===requested.profileId&&value.profileVersion===requested.version);
   const known=observedConnection.current;
   const target=listedConnection&&known?.connectionId===id&&known.revision>listedConnection.revision?known:listedConnection;
   if(target?.status==='authenticated'&&target.authentication==='verified'){
    void refreshService(view,current);
    const sessions=await sshInvoke<{sessions:Shell[]}>('sharedTerminal.list',{});
    if(!current())return;
    if(!Array.isArray(sessions.sessions))throw Error('Invalid shell listing');
    const visibleShells=sessions.sessions.filter(item=>shellForConnection(item,target)&&(!item.conversationTerminal||item.currentConversation));
    const liveShells=visibleShells.filter(item=>item.alive===true&&!item.expired);
    const catalogueIds=new Set(sessions.sessions.map(item=>item.sessionId));
    const missingFromCatalogue=(sessionId:string)=>target.terminalSessionIds.includes(sessionId)&&!catalogueIds.has(sessionId);
    shellCatalogueScope.current=scope;
    const expected=exactShell.current;
    if(expected){
     const original=visibleShells.find(item=>item.sessionId===expected);
     if(original?.owner==='human'&&original.alive===true&&!original.expired&&!original.awaitingConversation){exactShell.current=undefined;setShellId(original.sessionId);setNotice('');}
     else if(!original&&!missingFromCatalogue(expected)||original&&(original.owner!=='human'||original.alive===false||original.expired||original.awaitingConversation))setNotice(t('原终端当前不可用，请核对连接。'));
     else setNotice('');
    }else{
     const flow=login.current;
     const restored=!flow.restoreShell?undefined:flow.originalShellId?liveShells.find(item=>item.sessionId===flow.originalShellId&&!item.awaitingConversation):liveShells.length===1?liveShells[0]:undefined;
     const preferred=restored?.sessionId===flow.originalShellId&&!flow.shellChosen?restored?.sessionId:undefined;
     if(restored||flow.originalShellId&&catalogueIds.has(flow.originalShellId)&&!visibleShells.some(item=>item.sessionId===flow.originalShellId))flow.restoreShell=false;
     const owned=liveShells.find(item=>item.currentConversation);
     const priorShell=observedShell.current;
     setShellId(prior=>{
      if(!requested.exact&&preferred)return preferred;
      const keepMissing=missingFromCatalogue(prior)&&!priorShell?.conversationTerminal&&(priorShell?.sessionId===prior||flow.originalShellId===prior);
      if(visibleShells.some(item=>item.sessionId===prior)||keepMissing)return prior;
      return requested.exact?'':restored?.sessionId||owned?.sessionId||'';
     });
    }
    setShells(old=>[
     ...visibleShells.map(item=>{
      const prior=old.find(value=>value.sessionId===item.sessionId);
      return prior&&prior.ownerEpoch>item.ownerEpoch?prior:item;
     }),
     // The login receipt can arrive before the separate session catalogue.
     ...old.filter(item=>!item.conversationTerminal&&missingFromCatalogue(item.sessionId)).map(item=>({...item,alive:null})),
    ]);
   }
   setInventoryError(null);
  }catch(error){
   if(current()&&!observingHandoff&&!shellInput.current.locked)setInventoryError({id,scope,code:sshConnectionCode(error)||'terminal_unavailable'});
  }finally{view.pending=false;}
 }
 async function action(run:(current:()=>boolean)=>Promise<void>,kind:'publish'|'terminal'='terminal'){if(flight.current||!sameTerminalRequest(viewRequest.current,latest.current.request))return;flight.current=true;const operation=++operations.current;reads.current++;setPendingAction(kind);setNotice('');setDiagnostic(null);lastError.current='';const ticket=generation.current,id=latest.current.selected,requested=latest.current.request;const current=()=>alive.current&&ticket===generation.current&&latest.current.selected===id&&sameTerminalRequest(requested,latest.current.request);try{await run(current);}catch(error){if(current())report(error);}finally{if(operation===operations.current){flight.current=false;if(alive.current){setPendingAction(null);void refresh();}}}}
 function currentWorkspaceReview(review:NonNullable<typeof workspaceReview>){
  const observed=observedConnection.current,target=latest.current;
  return alive.current&&target.visible&&target.resourceScope===review.scope&&target.request.nonce===review.nonce&&!!observed&&observed.status==='authenticated'&&observed.authentication==='verified'&&sameWorkspaceTarget(observed,review.target);
 }
 async function publish(current:()=>boolean){
   if(!connection||!current())return;
   const result=await sshInvoke<PublishedSshResource>('compute.managed.publish',{connectionId:connection.connectionId,profileId:connection.profileId,profileVersion:connection.profileVersion});
   if(!current())return;
   if(result?.kind!=='ssh'||!result.resourceId||result.connectionId!==connection.connectionId||result.profileId!==connection.profileId||result.profileVersion!==connection.profileVersion)throw Object.assign(Error('ssh_connection_changed'),{action:'compute.managed.publish'});
   setPublication(result);
   if(lessonTarget)onHandoffLesson?.('ssh-service-observe',lessonTarget);
 }
 async function publishConnection(changing=false){
  if(!connection||!ready||!changing&&hosted)return;
  const review={target:connection,scope:resourceScope,nonce:request.nonce,changing};
  await action(async current=>{
   const live=()=>current()&&currentWorkspaceReview(review);
   let preview:WorkspacePreview|undefined;
   try{
    preview=await previewResourceWorkspace(connection);
    if(!live())return;
    if(!sameWorkspaceTarget(preview,connection))throw Error('ssh_workspace_changed');
    if(!changing&&preview.status==='confirmed'&&!preview.conflict){await publish(live);return;}
    setWorkspaceReview({...review,preview});
   }catch(error){
    if(!live())return;
    const code=sshConnectionCode(error);
    if(preview&&!code.startsWith('ssh_workspace_')&&!['ssh_exec_unavailable','ssh_channel_refused','ssh_remote_terminal_unavailable','ssh_control_timeout'].includes(code))throw error;
    const initialError=code==='ssh_control_timeout'?t('工作区核对超时。可在原 SSH 连接上重试目录检查。'):t(sshConnectionMessage(error));
    setWorkspaceReview({...review,...preview&&sameWorkspaceTarget(preview,connection)?{preview}:{},initialError});
   }
   if(!changing&&lessonTarget)onHandoffLesson?.('ssh-workspace',lessonTarget);
  },'publish');
 }
 useEffect(()=>{
  const flow=login.current;
  if(flow.handoffScope!==undefined&&flow.handoffScope!==resourceScope)flow.handoffScope=undefined;
  if(!visible||!ready||busy)return;
  if(flow.connectionId===selected&&flow.handoffScope!==undefined){
   flow.handoffScope=undefined;
   workspaceGuideOpened.current=request.nonce;
   void publishConnection();
   return;
  }
  if(!request.reviewWorkspace||workspaceGuideOpened.current===request.nonce)return;
  workspaceGuideOpened.current=request.nonce;void publishConnection(request.reviewWorkspace==='change');
 },[request.nonce,request.reviewWorkspace,visible,ready,busy,hosted,selected,resourceScope]);
 useEffect(()=>{if(workspaceReview&&!currentWorkspaceReview(workspaceReview))setWorkspaceReview(null);},[visible,request.nonce,resourceScope,connection?.connectionId,connection?.status]);
 function bindLogin(flow:LoginFlow,value:SshConnectionState){
  flow.connectionId=value.connectionId;
  const key=value.connectionId+':'+flow.requestId;
  const attempt=loginAttempts.current.get(key);
  if(attempt)flow.attempt=attempt;
  else loginAttempts.current.set(key,flow.attempt);
 }
 function acceptOpen(flow:LoginFlow,value:SshConnectionState){
  flow.awaitingOpen=false;
  bindLogin(flow,value);accept(value);setSelected(value.connectionId);setShellId('');setShells([]);
  setDiagnostic(previous=>previous?.action==='compute.sshConnection.open'&&previous.requestId===flow.requestId?null:previous);
 }
 async function open(explicit=false){
  await action(async current=>{
   if(!request.profileId||!request.version)throw Error('Saved SSH profile required');
   if(explicit&&!login.current.awaitingOpen){login.current=newLoginFlow(crypto.randomUUID());setLoginState(null);setLoginBusy(false);}
   const flow=login.current;
   flow.awaitingOpen=true;
   const value=await sshInvoke<SshConnectionState>('compute.sshConnection.open',{profileId:request.profileId,profileVersion:request.version,requestId:flow.requestId});
   if(!current())return;
   if(!verifiedSshConnection(value)||value.profileId!==request.profileId||value.profileVersion!==request.version||value.loginRequestId!==undefined&&value.loginRequestId!==flow.requestId)throw Object.assign(Error('compute_profile_changed'),{action:'compute.sshConnection.open'});
   acceptOpen(flow,value);
  });
 }
 function resumeConnection(value:SshConnectionState){
  const flow=newLoginFlow(value.loginRequestId||request.nonce);
  flow.finished=!value.loginRequestId;flow.canCheck=false;flow.restoreShell=true;flow.restoredAuthenticated=value.status==='authenticated';
  bindLogin(flow,value);login.current=flow;
  setSelected(value.connectionId);
  setNotice(value.status!=='authenticated'&&!value.loginRequestId?t('原登录请求无法恢复，请查看原终端并刷新连接；不会另开登录。'):'');
 }
 useEffect(()=>{alive.current=true;generation.current++;viewRequest.current=request;exactShell.current=request.exact?request.sessionId:undefined;login.current=newLoginFlow(request.nonce);setLoginState(null);setDiagnostic(null);setNotice('');setLoginBusy(false);setListedNonce('');setGeometry(null);setSelected('');setShellId('');setShells([]);setService(null);void refresh();return()=>{alive.current=false;generation.current++;};},[request.nonce]);
 useEffect(()=>{
  if(!visible||!viewCurrent||!listed||selected||flight.current||startedRequest.current===request.nonce)return;
  const hinted=request.connectionId?candidates.find(value=>value.connectionId===request.connectionId):undefined;
  const exactCandidate=request.connectionId?hinted:candidates.find(value=>request.sessionId&&value.terminalSessionIds.includes(request.sessionId));
  const existing=request.exact?exactCandidate:hinted||(candidates.length===1?candidates[0]:undefined);
  if(request.exact&&!existing){setNotice(t('原终端当前不可用，请核对连接。'));return;}
  startedRequest.current=request.nonce;
  if(existing)resumeConnection(existing);else if(candidates.length===0)void open();
 },[visible,viewCurrent,listed,selected,request.nonce,busy,connections]);
 useEffect(()=>{if(!visible)return;void refresh();const timer=setInterval(()=>void refresh(),2000),off=window.studio?.onEvent(event=>{if(['studio/sshConnectionChanged','studio/sshServiceChanged','studio/conversationTerminalChanged','studio/managedActivity'].includes(event.method))void refresh();});return()=>{clearInterval(timer);off?.();};},[visible,selected,request.nonce,resourceScope,provider]);
 function loginContext(flow:LoginFlow){const ticket=generation.current,id=flow.connectionId;return()=>alive.current&&ticket===generation.current&&login.current===flow&&latest.current.selected===id&&sameTerminalRequest(request,latest.current.request)&&sameTerminalRequest(request,viewRequest.current);}
 function clearLoginDiagnostic(flow:LoginFlow,actions:string[]){
  setDiagnostic(previous=>previous?.connectionId===flow.connectionId&&previous.requestId===flow.requestId&&actions.includes(previous.action)?null:previous);
 }
 function acceptAuthObservation(value:SshConnectionState){
  accept(value);
  if(login.current.connectionId===value.connectionId)clearLoginDiagnostic(login.current,['compute.sshConnection.authRead']);
 }
 function receiveLogin(result:LoginResult,flow:LoginFlow,method:'compute.sshConnection.completeLogin'|'compute.sshConnection.loginStatus'){
  const value=result?.connection,next=result?.shell;
  if(!verifiedSshConnection(value)||value.connectionId!==flow.connectionId||value.profileId!==request.profileId||value.profileVersion!==request.version||value.loginRequestId!==undefined&&value.loginRequestId!==flow.requestId)throw Error('ssh_connection_changed');
  if(observedConnection.current?.connectionId===value.connectionId&&observedConnection.current.revision>value.revision)return;
  const state=result.login??{status:value.status==='authenticated'?'complete':'waiting_authentication'};
  if(!['waiting_authentication','checking','complete','failed'].includes(state.status)||state.phase!==undefined&&!['waiting_authentication','checking_authentication','opening_shell'].includes(state.phase)||state.code!==undefined&&(typeof state.code!=='string'||sshConnectionCode(state.code)!==state.code)||method==='compute.sshConnection.loginStatus'&&!result.login)throw Error('terminal_unavailable');
  if(state.status==='complete'&&(value.status!=='authenticated'||value.authentication!=='verified'||!value.capabilities.multiplex))throw Error('ssh_connection_changed');
  if(next&&(value.status!=='authenticated'||value.authentication!=='verified'||state.status!=='complete'||!next.sessionId||next.connectionId!==flow.connectionId||!shellForConnection(next,value)||!value.terminalSessionIds.includes(next.sessionId)||!['human','agent'].includes(next.owner)||!Number.isSafeInteger(next.ownerEpoch)||next.ownerEpoch<1))throw Error('ssh_control_identity_changed');
  if(method==='compute.sshConnection.loginStatus'&&flow.attempt.completing&&['waiting_authentication','failed'].includes(state.status))return;
  accept(value);setLoginState(state);flow.canCheck=state.status==='waiting_authentication';
  if(state.status==='failed'||state.code)flow.attempt.requiresContinue=true;
  if(state.code)report({code:state.code},method);
  else if(state.status==='waiting_authentication')clearLoginDiagnostic(flow,['compute.sshConnection.loginStatus']);
  if(state.status==='complete'){
   flow.finished=true;
   setLoginBusy(false);
   clearLoginDiagnostic(flow,['compute.sshConnection.completeLogin','compute.sshConnection.loginStatus','compute.sshConnection.authRead']);
   if(next&&(!request.exact||request.sessionId===next.sessionId)){flow.originalShellId=next.sessionId;flow.restoreShell=true;}
   // A receipt for a reattached authenticated master lacks conversation scope.
   // Its original shell can be selected once the scoped terminal listing admits it.
   if(next?.owner==='human'&&next.alive===true&&!next.expired&&!next.awaitingConversation&&!next.conversationTerminal&&!flow.restoredAuthenticated&&(!request.exact||request.sessionId===next.sessionId)){
    flow.restoreShell=false;
    if(exactShell.current===next.sessionId)exactShell.current=undefined;
    reads.current++;
    setShells(old=>[old.find(item=>item.sessionId===next.sessionId&&item.ownerEpoch>next.ownerEpoch)||next,...old.filter(item=>item.sessionId!==next.sessionId)]);
    if(!flow.shellChosen)setShellId(next.sessionId);
    setNotice('');
   }
   void refresh();
  }
 }
 async function requestLogin(flow:LoginFlow,method:'compute.sshConnection.completeLogin'|'compute.sshConnection.loginStatus',active:()=>boolean,userConfirmed=false){
  const write=method==='compute.sshConnection.completeLogin',attempt=flow.attempt;
  if(flow.observing||flow.finished||!active()||write&&attempt.completing)return;
  const previousCompletion=attempt.completionResult;
  const current=()=>active()&&!flow.finished&&(write||attempt.completionResult===previousCompletion);
  if(write){attempt.completing=true;flow.canCheck=false;setLoginState({status:'checking'});}
  else flow.observing=true;
  setLoginBusy(true);
  try{
   const result=await sshInvoke<LoginResult>(method,{connectionId:flow.connectionId,requestId:flow.requestId,...userConfirmed?{userConfirmed:true}:{}});
   if(current())receiveLogin(result,flow,method);
   if(write){attempt.completionResult++;if(result?.login?.status==='failed'||result?.login?.code)attempt.requiresContinue=true;}
  }catch(error){
   if(write)attempt.requiresContinue=true;
   if(current()&&(write||!attempt.completing)){flow.canCheck=false;report(error,method);}
  }finally{
   if(write)attempt.completing=false;else flow.observing=false;
   if(active())setLoginBusy(!flow.finished&&(attempt.completing||flow.observing));
  }
 }
 async function observeOriginalLogin(){const flow=login.current,current=loginContext(flow);if(flow.connectionId&&current())await requestLogin(flow,'compute.sshConnection.loginStatus',current);}
 async function confirmHandoff(){
  const flow=login.current,active=loginContext(flow),input=authInput.current;
  if(!active()||flight.current||input.locked||flow.observing||flow.attempt.completing)return;
  flow.handoffScope=latest.current.resourceScope;
  flow.attempt.requiresContinue=false;
  input.locked=true;
  try{
   await input.pending.catch(()=>{});
   if(active())await requestLogin(flow,'compute.sshConnection.completeLogin',active,true);
  }finally{
   input.locked=false;
  }
 }
 async function continueLogin(){
  const flow=login.current,current=loginContext(flow);
  if(!current()||flight.current||flow.observing||flow.attempt.completing||!canContinue)return;
  flow.attempt.requiresContinue=false;
  setDiagnostic(null);lastError.current='';
  await requestLogin(flow,'compute.sshConnection.completeLogin',current);
 }
 useEffect(()=>{
  if(!visible||!selected||login.current.connectionId!==selected||login.current.finished)return;
  const flow=login.current,current=loginContext(flow);
  const poll=()=>{
   if(flight.current||!current()||flow.finished)return;
   const value=observedConnection.current,status=value?.status,manual=value?.capabilities.manualHandoff;
   if(status&&['closed','unsupported','requires_review','unavailable'].includes(status))return;
   if(manual&&(flow.handoffScope===undefined||flow.attempt.completing))return;
   const canWrite=!manual&&!request.exact&&(status==='authenticating'||status==='authenticated')&&flow.canCheck&&!flow.attempt.requiresContinue&&!flow.attempt.completing;
   void requestLogin(flow,canWrite?'compute.sshConnection.completeLogin':'compute.sshConnection.loginStatus',current);
  };
  poll();const timer=setInterval(poll,700);return()=>clearInterval(timer);
 },[visible,selected,request.nonce,request.profileId,request.version]);
 async function openShell(){
  if(!connection||!ready)return;
  await action(async current=>{
   const value=await sshInvoke<Shell|{session:Shell}>('compute.sshConnection.openShell',{connectionId:connection.connectionId,requestId:crypto.randomUUID()});
   if(!current())return;
   const next='session' in value?value.session:value;
   if(!next.sessionId||(next.connectionId||next.resource?.connectionId)!==connection.connectionId)throw Error('Shell connection identity differs');
    login.current.shellChosen=true;exactShell.current=undefined;
    setShells(old=>[...old.filter(item=>item.sessionId!==next.sessionId),next]);setShellId(next.sessionId);
  });
 }
 async function closeShell(){if(!shell)return;await action(async current=>{const result=await sshInvoke<{closed:boolean}>('sharedTerminal.close',{sessionId:shell.sessionId});if(!current())return;if(result?.closed!==true)throw Error('Shell close unconfirmed');setShells(old=>old.filter(item=>item.sessionId!==shell.sessionId));setShellId('');await refreshResource(current);});}
 async function refreshResource(current:()=>boolean){const value=await sshInvoke<ComputeResourceState>('compute.resource.status',{});if(current())onResourceChange?.(value,t('SSH 基础连接'));}
 async function closeConnection(){if(!connection||!window.confirm(t('关闭整个 SSH 连接及其 Shell 和服务通道？远端已提交作业保留。')))return;await action(async current=>{const value=await sshInvoke<SshConnectionState&{closed?:boolean}>('compute.sshConnection.close',{connectionId:selected});if(!current())return;if(!verifiedSshConnection(value)||value.connectionId!==selected)throw Error('Connection changed');accept(value);if(value.status!=='closed'||value.closed!==true){setNotice(t('连接关闭尚未确认，请刷新原连接。'));return;}setShells([]);setShellId('');setService(null);await refreshResource(current);});}
 const sameLogin=connection?.connectionId===login.current.connectionId&&(connection.loginRequestId===undefined||connection.loginRequestId===login.current.requestId);
 // A failed original login can first reject completion, then publish its actual
 // startup failure. Keep that bound failure visible instead of its derivative
 // "connection changed" diagnostic; a foreign response still fails identity checks.
 const failedConnectionCode=sameLogin&&connection&&['unavailable','requires_review','unsupported'].includes(connection.status)?connection.error?.code:undefined;
 const failureReplacesDiagnostic=failedConnectionCode&&diagnostic&&diagnostic.connectionId===connection?.connectionId&&diagnostic.requestId===login.current.requestId&&['compute.sshConnection.completeLogin','compute.sshConnection.loginStatus'].includes(diagnostic.action)&&['ssh_connection_changed','ssh_authentication_unconfirmed'].includes(diagnostic.code);
 const workflowIssue=diagnostic?.action===workflowAction&&diagnostic.workflowScope===resourceScope&&diagnostic.connectionId===selected&&!workflowBound?diagnostic:null;
 const visibleDiagnostic=diagnostic?.action===workflowAction?null:failureReplacesDiagnostic?{...diagnostic,code:failedConnectionCode,message:t(sshConnectionMessage(failedConnectionCode))}:diagnostic;
 const openIssue=login.current.awaitingOpen&&visibleDiagnostic?.action==='compute.sshConnection.open'&&visibleDiagnostic.requestId===login.current.requestId?visibleDiagnostic:null;
 const error=visibleDiagnostic?.code||(sameLogin?connection?.error?.code:undefined);
 const manualHandoff=!request.exact&&connection?.status==='authenticating'&&connection.capabilities.manualHandoff===true;
 const canContinue=!manualHandoff&&!request.exact&&!!connection&&['authenticating','authenticated'].includes(connection.status)&&!login.current.finished&&login.current.attempt.requiresContinue&&!!loginState&&['waiting_authentication','failed'].includes(loginState.status);
 const configure=(section?:'service'|'environment')=>{const profileId=connection?.profileId||request.profileId,profileVersion=connection?.profileVersion||request.version;if(profileId&&profileVersion)onConfigureSsh?.({profileId,profileVersion,...section?{section}:{}},connection?.connectionId,shell?.sessionId);};
 const visibleReadDiagnostic=readDiagnostic&&readDiagnostic.connectionId===selected&&readDiagnostic.sessionId===shell?.sessionId&&login.current.connectionId===selected?readDiagnostic:null;
 const visibleGeometry=geometry&&geometry.connectionId===selected&&geometry.sessionId===shell?.sessionId&&geometry.ownerEpoch===shell?.ownerEpoch?geometry:null;
 const visibleInventory=inventoryError?.id===selected&&inventoryError.scope===resourceScope?inventoryError:null;
 const connectionIssue=error||(sameLogin&&connection?.status==='unsupported'?'ssh_multiplex_unsupported':undefined);
 const timeoutInLogin=connectionIssue==='ssh_control_timeout';
 const serviceIssue=ready?ownService?.error?.code:undefined;
 const canRepairEnvironment=!!serviceIssue&&['python_start_failed','python_unsupported','sqlite_unavailable','environment_activation_failed','python_response_timeout'].includes(serviceIssue);
 const runtime=ownService?.runtimeComparison;
 async function maintainService(update=false){
  if(!connection||connection.connectionId!==latest.current.selected||!latest.current.visible||!ready||!hosted||update&&(!runtime?.remoteRuntimeId||runtime.status!=='different'))return;
  await action(async current=>{
   const base={connectionId:connection.connectionId,profileId:connection.profileId,profileVersion:connection.profileVersion};
   const next=update&&runtime?.remoteRuntimeId?await managedSshServices.update({...base,expectedRuntimeId:runtime.remoteRuntimeId,bundledRuntimeId:runtime.bundledRuntimeId}):await sshInvoke<PublishedSshResource>('compute.managed.configureService',base);
   if(current()&&next.connectionId===base.connectionId&&next.profileId===base.profileId&&next.profileVersion===base.profileVersion)setPublication(next);
  });
 }
 const reviewService=!serviceReady&&serviceIdentityUnconfirmed(serviceIssue);
 const serviceWarning=ready&&serviceReady&&!!ownService?.warnings?.length;
 const serviceActionDiagnostic=visibleDiagnostic?.action==='compute.managed.configureService'||visibleDiagnostic?.action==='compute.managed.updateService';
 const canPrepareService=!!(ready&&hosted&&!serviceReady&&!servicePending&&!serviceIssue&&ownService?.status!=='unknown');
 const showConnectionIssue=!!connectionIssue&&!(serviceActionDiagnostic&&serviceIssue&&connectionIssue===serviceIssue);
 const issues=[
  showConnectionIssue?{
   id:'ssh-login-error',
   summary:openIssue?openIssue.message:t(visibleDiagnostic?.action==='compute.managed.publish'?'托管结果待核对':
    visibleDiagnostic?.action==='compute.sshConnection.openShell'?'终端通道需要核对':
    serviceActionDiagnostic?'作业服务需要核对':'SSH 连接需要核对'),
   content:<>
    <p>{visibleDiagnostic?.message||t(sshConnectionMessage(connectionIssue))}</p>
    <div className="ssh-diagnostic-meta">
     {visibleDiagnostic&&<span data-testid="ssh-error-action">{t(sshActionLabel(visibleDiagnostic.action))}</span>}
     <code data-testid="ssh-error-code">{sshConnectionCode(connectionIssue)}</code>
    </div>
    <div className="ssh-diagnostic-actions">
     {onConfigureSsh&&<button type="button" className="button" data-testid="ssh-error-edit" onClick={()=>configure()}>{t('编辑此连接')}</button>}
     {connection?.status==='unsupported'&&onPlainSsh&&<button type="button" className="button" data-testid="ssh-use-plain" onClick={onPlainSsh}>{t('打开普通 SSH 终端')}</button>}
    </div>
   </>,
  }:null,
  workflowIssue?{
   id:'ssh-workflow-error',summary:t('当前流程的作业服务待接入'),
   content:<><p>{workflowIssue.message}</p><div className="ssh-diagnostic-meta"><span>{t('用于当前流程')}</span><code>{workflowIssue.code}</code></div></>,
  }:null,
  visibleReadDiagnostic&&!(timeoutInLogin&&visibleReadDiagnostic.code==='ssh_control_timeout')?{
   id:'ssh-read-observation',
   summary:t('终端输出读取失败'),
   content:<><p>{visibleReadDiagnostic.message}</p><code data-testid="ssh-read-error-code">{visibleReadDiagnostic.code}</code></>,
  }:null,
  (serviceIssue||serviceWarning)?{
   id:serviceIssue?'ssh-worker-error':'ssh-worker-warning',
   summary:t(reviewService?'作业服务身份待核对':serviceIssue?'作业服务需要核对':'工具清单待核对'),
   content:<>
    {reviewService&&<p data-testid="ssh-service-identity-notice">{t(shell?.alive===true?'SSH 认证有效；作业服务身份尚未核对，当前终端保留。':'SSH 认证有效；作业服务身份尚未核对。')}</p>}
    {serviceIssue&&<p>{t(serviceErrorMessage(serviceIssue))}</p>}
    {serviceWarning&&<p>{t('工具清单待核对，可继续由 Agent 协助配置环境。')}</p>}
    {serviceIssue&&!canRepairEnvironment&&onServiceEnvironmentHelp&&lessonTarget&&<button type="button" className="button" data-testid="ssh-service-agent-help" data-guide-target="ssh-service-repair" onClick={()=>onServiceEnvironmentHelp(lessonTarget)}>{t('让 Agent 配置')}</button>}
    {serviceIssue&&onConfigureSsh&&<button type="button" className="button" data-testid="ssh-service-review" onClick={()=>configure('service')}>{t('核对作业服务')}</button>}
    {canRepairEnvironment&&onConfigureSsh&&<button type="button" className="button" data-testid="ssh-service-edit-environment" onClick={()=>configure('environment')}>{t('编辑作业服务 Python 环境')}</button>}
    {serviceIssue&&hosted&&ownService?.status!=='unknown'&&<button type="button" className="button" disabled={busy||servicePending} data-testid="ssh-service-retry" onClick={()=>void maintainService()}>{t('重试作业服务')}</button>}
   </>,
  }:null,
  visibleInventory?{
   id:'ssh-inventory-observation',
   summary:t('终端列表暂未刷新。'),
   content:<code>{visibleInventory.code}</code>,
  }:null,
  visibleGeometry&&!(visibleGeometry.code==='ssh_control_timeout'&&(timeoutInLogin||visibleReadDiagnostic?.code==='ssh_control_timeout'))?{
   id:'ssh-resize-observation',
   summary:t('终端显示尺寸尚未同步。'),
   content:<code>{visibleGeometry.code}</code>,
  }:null,
 ].filter(issue=>issue!==null);
 const profileName=request.profileName||t('SSH 终端');
 const connectionStatus=openIssue?(openIssue.code==='terminal_open_unknown'?'unknown':'failed'):connection?.status||'connecting';
 const statusLabel=(openIssue?.code==='terminal_open_unknown'?t('等待登录回执'):t(sshStateLabel(connectionStatus)))+(connection&&connection.profileVersion!==request.version?' · '+t('原版本连接'):'');
 const canRelogin=!!openIssue&&!request.exact||!!connection&&['unavailable','closed','requires_review','unsupported'].includes(connection.status);
 const canClose=!!connection&&connection.status!=='closed';
 const chooseConnection=!request.exact&&viewCurrent&&!selected&&listed&&candidates.length>1;
 const publishing=pendingAction==='publish';
 const publicationLabel=t(publishing?'正在托管…':manualHandoff?'登录完成，交由 AIMatterLab 管理':'交由 AIMatterLab 管理');
 const loginTip=loginState?.status==='failed'?t('原登录未完成，请核对提示后继续。'):loginState?.status==='checking'?t('正在检查原登录，请稍候。'):
  manualHandoff?t('请在私有终端完成验证，按网关提示选择资产和登录节点。看到节点的命令提示符后再交接。'):
  connectionStatus==='authenticating'?t('请在原终端完成密码或验证码输入。'):null;
 const serviceProgress=ready&&servicePending?<div className="ssh-worker-preparing" data-testid="ssh-worker-preparing" data-guide-target="ssh-service-progress" role="status">
  <span>{t(ownService?.status==='unknown'?'作业服务接入结果待确认':ownService?.status==='connected'?'作业服务通道已连接，工具尚未就绪':servicePhaseMessage(ownService?.phase))}</span>
  {ownService?.status==='connecting'&&<progress max={transfer?.total??1} value={transfer?.completed} aria-label={t('正在准备作业服务…')}/>}
  {transfer&&<span title={transfer.completed.toLocaleString()+' / '+transfer.total.toLocaleString()+' B'}>{transfer.percent}%</span>}
 </div>:null;
 const statusMessage=notice||(chooseConnection?t('在“更多”中选择已打开的连接。'):null);
 function menuAction(run:()=>void){
  closeDisclosure(moreDetails.current,true);
  run();
 }
 const useForWorkflow=()=>{
  if(!canUseForWorkflow||!onUseForWorkflow||!connection)return;
  const scope=resourceScope;
  void action(async current=>{
   if(!current()||latest.current.selected!==connection.connectionId)return;
   try{
    const receipt=await onUseForWorkflow({connectionId:connection.connectionId,profileId:connection.profileId,profileVersion:connection.profileVersion});
    if(receipt&&typeof receipt==='object'&&'status' in receipt&&receipt.status==='unconfirmed')throw Error('ssh_service_workflow_unconfirmed');
   }catch(error){if(current()&&latest.current.resourceScope===scope)report(error,workflowAction);}
  });
 };
 return <section className="shared-terminal-panel ssh-connection-panel" data-testid="ssh-connection-panel" onPointerDown={event=>{
  if(!moreDetails.current?.contains(event.target as Node))closeDisclosure(moreDetails.current);
  if(!statusDetails.current?.contains(event.target as Node))closeDisclosure(statusDetails.current);
 }}>
  <div className="shared-terminal-toolbar ssh-connection-toolbar" role="group" aria-label={t('SSH 连接操作')}>
   <div className="ssh-connection-identity">
    <strong title={profileName}>{profileName}</strong>
    <span className="ssh-connection-state" data-state={connectionStatus} data-testid="ssh-connection-status" role="status" title={statusLabel}>{statusLabel}</span>
   </div>
    {(ready||manualHandoff)&&(hosted?<span className="ssh-managed-status" data-testid="ssh-managed-status" role="status" title={t('已由 AIMatterLab 管理')}><Check size={16} aria-hidden="true"/>{t('已托管')}</span>:
     <button type="button" className="button primary ssh-host-action" data-testid="ssh-publish-resource" data-guide-target={ready?'ssh-handoff':undefined} disabled={busy||loginBusy} aria-label={publicationLabel} aria-busy={publishing} title={publicationLabel} onClick={()=>manualHandoff?void confirmHandoff():void publishConnection()}>
     {publishing?<RefreshCw size={15} aria-hidden="true"/>:<Server size={15} aria-hidden="true"/>}
     <span className="ssh-host-label" aria-hidden="true">{publicationLabel}</span>
      <span className="ssh-host-short-label" aria-hidden="true">{t(publishing?'正在托管…':manualHandoff?'交接':'托管')}</span>
    </button>)}
   {canContinue&&<button type="button" className="button ssh-recovery-action" data-testid="ssh-login-continue" data-guide-target="ssh-continue" disabled={busy||loginBusy} onClick={()=>void continueLogin()}>{t('继续原登录')}</button>}
   {canRelogin&&<button type="button" className="button ssh-recovery-action" data-testid="ssh-login-retry" disabled={busy} onClick={()=>void open(true)}>{t(openIssue?'重试':'重新登录')}</button>}
   <div className="ssh-toolbar-actions">
    <button type="button" className="icon-button ssh-toolbar-icon" data-testid="ssh-login-refresh" disabled={busy} aria-label={t('刷新')} title={t('刷新')} onClick={()=>{void refresh();void observeOriginalLogin();}}><RefreshCw size={16} aria-hidden="true"/></button>
    {onConfigureSsh&&<button type="button" className="icon-button ssh-toolbar-icon" data-testid="ssh-edit-connection" data-guide-target="ssh-edit" disabled={busy} aria-label={t('连接设置')} title={t('连接设置')} onClick={()=>configure()}><Settings2 size={16} aria-hidden="true"/></button>}
    {(ready||canClose||chooseConnection)&&<details className="ssh-disclosure" ref={moreDetails} onBlur={disclosureBlur} onKeyDown={disclosureKeyDown}>
     <summary className="icon-button ssh-toolbar-icon" data-testid="ssh-more" aria-label={t('更多')} title={t('更多')}><Ellipsis size={18} aria-hidden="true"/></summary>
     <div className="ssh-popover ssh-action-popover">
      {chooseConnection&&<>
       <strong>{t('已打开的终端')}</strong>
       {candidates.map((value,index)=><button type="button" className="button" key={value.connectionId} disabled={busy} onClick={()=>menuAction(()=>{generation.current++;resumeConnection(value);})}>{t('终端')} {index+1} · {t(sshStateLabel(value.status))}</button>)}
      </>}
     {ready&&shell&&<button type="button" className="button" data-testid="ssh-open-shell" disabled={busy} onClick={()=>menuAction(()=>void openShell())}>{t('另开终端')}</button>}
      {ready&&shell&&<button type="button" className="button danger" data-testid="ssh-shell-close" disabled={busy} onClick={()=>menuAction(()=>void closeShell())}>{t('关闭终端')}</button>}
      {ready&&hosted&&<button type="button" className="button" data-testid="ssh-workspace-change" disabled={busy} onClick={()=>menuAction(()=>void publishConnection(true))}>{t('更换远端总工作区')}</button>}
      {canClose&&<button type="button" className="button danger" data-testid="ssh-connection-close" disabled={busy} onClick={()=>menuAction(()=>void closeConnection())}>{t('关闭 SSH 连接')}</button>}
     </div>
    </details>}
   </div>
  </div>
  {issues.length>0?<div className="ssh-status-strip ssh-diagnostics" data-testid="ssh-diagnostics">
   <TriangleAlert size={15} aria-hidden="true"/>
   <span className="ssh-diagnostic-title" role={connectionIssue?'alert':'status'} title={issues[0].summary}>{issues[0].summary}</span>
   {issues.length>1&&<span className="ssh-diagnostic-count">+{issues.length-1}</span>}
   {ready&&serviceReady&&<span data-testid="ssh-worker-ready" className="ssh-diagnostic-title" role="status">{t(serviceWarning?'作业服务已连接':'作业服务可用')}</span>}
   {workflowIssue&&canUseForWorkflow&&<button type="button" className="button ssh-details-toggle" data-testid="ssh-use-for-workflow" disabled={busy} onClick={useForWorkflow}>{t('用于当前流程')}</button>}
   {canRepairEnvironment&&onServiceEnvironmentHelp&&lessonTarget&&<button type="button" className="button ssh-details-toggle" data-testid="ssh-service-agent-help" data-guide-target="ssh-service-repair" onClick={()=>onServiceEnvironmentHelp(lessonTarget)}>{t('让 Agent 配置')}</button>}
   <details className="ssh-disclosure" ref={statusDetails} onBlur={disclosureBlur} onKeyDown={disclosureKeyDown}>
    <summary className="button ssh-details-toggle" data-testid="ssh-diagnostic-toggle">{t('详情')}<ChevronDown size={14} aria-hidden="true"/></summary>
    <div className="ssh-popover ssh-diagnostic-popover">
     {issues.map(issue=><section key={issue.id} data-testid={issue.id}><strong>{issue.summary}</strong>{issue.content}</section>)}
     {statusMessage&&<p>{statusMessage}</p>}
     {serviceProgress}
    </div>
   </details>
  </div>:loginTip||statusMessage||serviceProgress||serviceReady||canPrepareService?<div className="ssh-status-strip" data-guide-target={serviceReady?'ssh-service-progress':undefined}>
   {statusMessage?<span role="status">{statusMessage}</span>:loginTip?<span data-testid="ssh-login-progress" role="status">
    <span>{loginTip}</span>
     {loginState?.phase&&loginState.phase!=='waiting_authentication'&&<> · {t(sshActionLabel(loginState.phase))}</>}
    {connectionStatus==='authenticating'&&loginState?.status!=='checking'&&<> {t('认证信息不会交给 Agent。')}</>}
   </span>:null}
   {serviceProgress}
   {ready&&serviceReady&&<span data-testid="ssh-worker-ready" role="status">{t(serviceWarning?'作业服务已连接':'作业服务可用')}</span>}
   {canPrepareService&&<button type="button" className="button ssh-details-toggle" data-testid="ssh-service-prepare" disabled={busy} onClick={()=>void maintainService()}>{t('准备作业服务')}</button>}
   {canUseForWorkflow&&<button type="button" className="button ssh-details-toggle" data-testid="ssh-use-for-workflow" data-guide-target="ssh-use-for-workflow" disabled={busy} onClick={useForWorkflow}>{t('用于当前流程')}</button>}
  </div>:null}
   {ready&&selectableShells.length>1&&<div className="ssh-shell-tabs" data-testid="ssh-shell-actions" role="group" aria-label={t('选择终端')}>
    {selectableShells.map(item=><button type="button" key={item.sessionId} className="button" aria-pressed={item.sessionId===shellId} disabled={busy} onClick={()=>{login.current.shellChosen=true;exactShell.current=undefined;setShellId(item.sessionId);}}>{shellLabel(item)}</button>)}
  </div>}
   {!connection&&!notice&&(!listed||busy)&&<div className="shared-terminal-empty" role="status"><p>{t('正在打开终端…')}</p></div>}
   {connection&&(connection.status==='authenticating'||sameLogin&&connection.retainedAuthOutput)&&<ChannelTerminal key={'auth:'+selected} connection={connection} visible={visible} resourceScope={resourceScope} onGeometry={setGeometry} inputState={authInput.current} onConnection={acceptAuthObservation} onShell={()=>{}} onError={report}/>}
  {ready&&(shell?<ChannelTerminal key={'shell:'+shell.sessionId} connection={connection} shell={shell} visible={visible} resourceScope={resourceScope} onGeometry={setGeometry} inputState={shellInput.current} onConnection={accept} onShell={next=>setShells(old=>old.map(item=>item.sessionId===next.sessionId&&item.ownerEpoch===next.ownerEpoch?{...item,...next}:item))} onError={report} onReadError={reportRead} onReadSuccess={confirmRead}/>:
     <div className="shared-terminal-empty"><p>{t(connection.terminalSessionIds.length>0&&login.current.restoreShell?'正在打开终端…':'SSH 已登录。')}</p>
      <button type="button" className="button" data-testid="ssh-open-shell" disabled={busy||loginBusy} onClick={()=>void openShell()}>{t('打开终端')}</button></div>)}
  {ready&&runtime?.status==='different'&&<details className="ssh-runtime-difference" data-testid="ssh-service-version-difference" data-guide-target="ssh-service-version">
   <summary>{t('作业服务版本不同')}</summary>
   <p>{t('远端版本')} · <code>{runtime.remoteRuntimeId}</code>{runtime.remoteManifestSha256&&<> · <code>{runtime.remoteManifestSha256}</code></>}</p>
   <p>{t('随包版本')} · <code>{runtime.bundledRuntimeId}</code>{runtime.bundledManifestSha256&&<> · <code>{runtime.bundledManifestSha256}</code></>}</p>
   <button type="button" className="button" data-testid="ssh-managed-service-update" disabled={busy||servicePending||!runtime.remoteRuntimeId} onClick={()=>void maintainService(true)}>{t('更新此连接的作业服务')}</button>
  </details>}
   {workspaceReview&&currentWorkspaceReview(workspaceReview)&&<ResourceWorkspaceReview key={workspaceReview.nonce+workspaceReview.target.connectionId} target={workspaceReview.target} resourceName={profileName} initial={workspaceReview.preview} initialError={workspaceReview.initialError} changing={workspaceReview.changing}
   isCurrent={()=>currentWorkspaceReview(workspaceReview)} onClose={()=>{setWorkspaceReview(null);if(!workspaceReview.changing&&lessonTarget)onHandoffLesson?.('ssh-login',lessonTarget);}} onConfirmed={async receipt=>{
    if(!workspaceReview.changing)await publish(()=>currentWorkspaceReview(workspaceReview));
    if(currentWorkspaceReview(workspaceReview)){setWorkspaceReview(null);setNotice(t('远端总工作区')+' · '+receipt.root);void refresh();}
   }}/>}
 </section>;
}
