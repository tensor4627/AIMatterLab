import {useEffect,useRef,useState,type FocusEvent,type KeyboardEvent} from 'react';
import {Check,ChevronDown,Ellipsis,RefreshCw,Server,Settings2,TriangleAlert} from 'lucide-react';
import {useManagedResources} from '../compute/useManagedResources';
import {Terminal} from '@xterm/xterm';
import {createHumanInputWriter} from './human-input.mjs';
import {FitAddon} from '@xterm/addon-fit';
import {serviceErrorMessage,serviceIdentityUnconfirmed,servicePhaseMessage,serviceTransfer} from './ssh-service-presentation';
import {invoke} from '../../api/studio';
import {t} from '../../ui/i18n';
import type {PublishedSshResource} from '../../../contracts/dto/managed-compute';
import type {ComputeResourceState,SharedTerminalResizeRequest} from '../../../contracts/dto/compute';
import type {AgentProvider,Conversation} from '../../../contracts/dto/agent';
import {verifiedSshConnection,sshConnectionCode,sshConnectionMessage,sshActionLabel,sshStateLabel,type SshConnectionState,type IndependentSshService} from '../compute/ssh-connection-types';

type Shell={sessionId:string;serviceGrantPending?:boolean;conversationName?:string;humanInputSequence?:number;outputWait?:boolean;awaitingConversation?:boolean;conversationTerminal?:boolean;currentConversation?:boolean;connectionId?:string;resource?:{kind:string;connectionId?:string;profileId?:string;profileVersion?:number};name:string;owner:'human'|'agent';ownerEpoch:number;alive:boolean|null;expired?:boolean;output?:string;cursor?:number;dropped?:boolean};
type Props={resourceScope?:string;activeResource?:ComputeResourceState|null;visible:boolean;request:{nonce:string;profileId?:string;version?:number;profileName?:string;connectionId?:string;sessionId?:string;exact?:true};canShare:boolean;provider?:AgentProvider;onError:(error:unknown)=>void;onConversationPrepared?:(conversation:Conversation)=>void;onResourceChange?:(state:ComputeResourceState,label?:string)=>void;onConfigureSsh?:(ref?:{profileId:string;profileVersion:number;section?:"service"})=>void;onPlainSsh?:()=>void};
type ChannelInput={pending:Promise<void>;locked:boolean;observationEpoch:number};
type LoginState={status:'waiting_authentication'|'checking'|'complete'|'failed';phase?:'checking_authentication'|'opening_shell';code?:string};
type LoginResult={connection:SshConnectionState;shell?:Shell;login?:LoginState};
type Diagnostic={code:string;action:string;message:string;connectionId:string;requestId:string};
type ShellReadIdentity={connectionId:string;sessionId:string;ownerEpoch:number};
type ShellReadDiagnostic=ShellReadIdentity&{code:string;message:string};
type GeometryDiagnostic={connectionId:string;sessionId?:string;ownerEpoch?:number;code:string};
async function sshInvoke<T=unknown>(method:string,data?:unknown):Promise<T>{try{return await invoke<T>(method,data);}catch(error){const code=sshConnectionCode(error)||'terminal_operation_failed';throw Object.assign(new Error(sshConnectionMessage({code})),{code,action:method});}}

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
 const host=useRef<HTMLDivElement>(null),view=useRef<Terminal|null>(null),syncSize=useRef<(()=>void)|null>(null),latest=useRef({connection,shell,visible,resourceScope,onGeometry});latest.current={connection,shell,visible,resourceScope,onGeometry};
 useEffect(()=>{
  if(!host.current)return;let stopped=false,reading=false,cursor=0,inputs=Promise.resolve();const id=connection.connectionId,sessionId=shell?.sessionId;
  const writeInput=createHumanInputWriter();let followup:ReturnType<typeof setTimeout>|undefined;
  const term=new Terminal({fontSize:13,fontFamily:'Cascadia Code, Consolas, monospace',scrollback:2000,theme:{background:'#121218',foreground:'#d1d5e4'}}),fit=new FitAddon();term.loadAddon(fit);term.open(host.current);view.current=term;
  const current=()=>!stopped&&latest.current.connection.connectionId===id&&latest.current.shell?.sessionId===sessionId;
  const editable=()=>current()&&latest.current.visible&&(sessionId?latest.current.shell?.owner==='human'&&!latest.current.shell.awaitingConversation&&latest.current.shell.alive===true&&!latest.current.shell.expired:latest.current.connection.status==='authenticating');
  const input=term.onData(data=>{if(inputState.locked||!editable())return;const epoch=latest.current.shell?.ownerEpoch;const send=async()=>{if(!editable()||sessionId&&latest.current.shell?.ownerEpoch!==epoch)return;for(const part of data.match(/[\s\S]{1,1024}/gu)||[]){if(!editable()||sessionId&&latest.current.shell?.ownerEpoch!==epoch)return;if(sessionId)await writeInput((payload:unknown)=>sshInvoke('sharedTerminal.input',payload),latest.current.shell!,crypto.randomUUID(),part);else await sshInvoke('compute.sshConnection.authInput',{connectionId:id,requestId:crypto.randomUUID(),data:part});}};inputs=inputs.then(send,send);inputState.pending=inputs;void inputs.catch(error=>{if(current())onError(error);});});
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
  const observer=new ResizeObserver(resize);observer.observe(host.current);
  const read=async()=>{if(reading||inputState.locked||!current()||!latest.current.visible)return;reading=true;const readEpoch=latest.current.shell?.ownerEpoch,observationEpoch=inputState.observationEpoch,scope=latest.current.resourceScope,waiting=latest.current.shell?.awaitingConversation;
   // Handoff binds a conversation before returning its new owner epoch. Reads
   // started before that transition must not publish a stale result or error.
   const observationCurrent=()=>current()&&latest.current.visible&&scope===latest.current.resourceScope&&waiting===latest.current.shell?.awaitingConversation&&!inputState.locked&&inputState.observationEpoch===observationEpoch&&latest.current.shell?.ownerEpoch===readEpoch;
   try{
   if(sessionId){const before=latest.current.shell!;const next=await sshInvoke<Shell>('sharedTerminal.read',{sessionId,ownerEpoch:before.ownerEpoch,cursor,maxBytes:65536,...before.outputWait?{waitMs:1000}:{}});if(!observationCurrent())return;if(next.dropped)term.write('\r\n['+t('较早输出已超出回放容量')+']\r\n');if(next.output)term.write(next.output);cursor=next.cursor??cursor;onShell(next);if(next.outputWait&&next.alive===true){clearTimeout(followup);followup=setTimeout(()=>void read(),0);}if(next.sessionId===sessionId&&(next.connectionId===id||next.resource?.kind==='ssh-connection'&&next.resource.connectionId===id)&&next.ownerEpoch===readEpoch&&next.alive===true&&!next.expired)onReadSuccess?.({connectionId:id,sessionId,ownerEpoch:before.ownerEpoch});}
   else {const next=await sshInvoke<{connectionId:string;state:SshConnectionState;output:string;cursor:number;dropped:boolean}>('compute.sshConnection.authRead',{connectionId:id,cursor,maxBytes:65536});if(!observationCurrent()||next.connectionId!==id)return;if(typeof next.output!=='string'||!verifiedSshConnection(next.state)||next.state.connectionId!==id)throw Error('Invalid authentication observation');if(next.dropped)term.write('\r\n['+t('较早输出已超出回放容量')+']\r\n');term.write(next.output);cursor=next.cursor;onConnection(next.state);}
  }catch(error){if(observationCurrent()&&!(waiting&&['terminal_owner_changed','terminal_context_changed'].includes(sshConnectionCode(error)))){if(sessionId&&typeof readEpoch==='number'&&onReadError)onReadError(error,{connectionId:id,sessionId,ownerEpoch:readEpoch});else onError(error);}}finally{reading=false;}};
  void read();const timer=setInterval(()=>void read(),500);return()=>{
   if(stopped)return;stopped=true;syncSize.current=null;clearInterval(timer);clearTimeout(followup);input.dispose();observer.disconnect();if(view.current===term)view.current=null;
   // xterm 5 queues viewport initialization during open(). Let it finish before
   // disposing its renderer, after all channel callbacks and visible DOM detach.
   term.element?.remove();setTimeout(()=>term.dispose(),0);
  };
 },[connection.connectionId,shell?.sessionId]);
 useEffect(()=>{syncSize.current?.();},[connection.connectionId,connection.status,shell?.sessionId,shell?.ownerEpoch,shell?.awaitingConversation,resourceScope,visible]);
 useEffect(()=>{if(view.current){view.current.options.disableStdin=!visible||(shell?shell.owner!=='human'||!!shell.awaitingConversation||shell.alive!==true||!!shell.expired:connection.status!=='authenticating');}},[visible,shell?.owner,shell?.awaitingConversation,shell?.ownerEpoch,shell?.alive,shell?.expired,connection.status]);
 return <div className="shared-terminal-host" data-guide-target={shell?'ssh-shell':'ssh-terminal'} tabIndex={-1} ref={host} role="region" aria-label={t(shell?'SSH 终端':'SSH 登录终端')} onPointerDown={()=>view.current?.focus()}/>;
}

export default function SshConnectionPanel({visible,request,provider,resourceScope='',onError,onResourceChange,onConfigureSsh,onPlainSsh}:Props){
 const [connections,setConnections]=useState<SshConnectionState[]>([]),[listed,setListed]=useState(false),[selected,setSelected]=useState(''),[shells,setShells]=useState<Shell[]>([]),[shellId,setShellId]=useState(''),[service,setService]=useState<IndependentSshService|null>(null),[pendingAction,setPendingAction]=useState<'publish'|'terminal'|null>(null),[notice,setNotice]=useState(''),[diagnostic,setDiagnostic]=useState<Diagnostic|null>(null),[loginState,setLoginState]=useState<LoginState|null>(null),[loginBusy,setLoginBusy]=useState(false);
 const busy=pendingAction!==null;
 const [readDiagnostic,setReadDiagnostic]=useState<ShellReadDiagnostic|null>(null);
 const [geometry,setGeometry]=useState<GeometryDiagnostic|null>(null);
 const managed=useManagedResources();
 const [publication,setPublication]=useState<PublishedSshResource|null>(null);
 const [inventoryError,setInventoryError]=useState<{id:string;scope:string;code:string}|null>(null);
 const moreDetails=useRef<HTMLDetailsElement>(null),statusDetails=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{closeDisclosure(moreDetails.current);closeDisclosure(statusDetails.current);},[visible,request.nonce]);
 const alive=useRef(true),flight=useRef(false),generation=useRef(0),operations=useRef(0),reads=useRef(0),lastError=useRef(''),startedRequest=useRef(''),authInput=useRef<ChannelInput>({pending:Promise.resolve(),locked:false,observationEpoch:0}),shellInput=useRef<ChannelInput>({pending:Promise.resolve(),locked:false,observationEpoch:0}),latest=useRef({selected,request,provider,resourceScope,visible});latest.current={selected,request,provider,resourceScope,visible};
 const login=useRef({nonce:request.nonce,requestId:request.nonce,connectionId:'',finished:false,failed:false,restoreShell:false,serial:0,pending:false,scope:resourceScope,provider});
 const exactShell=useRef<string|undefined>(undefined);
 const terminalNumbers=useRef(new Map<string,number>());
 function shellLabel(item:Shell){if(!terminalNumbers.current.has(item.sessionId))terminalNumbers.current.set(item.sessionId,terminalNumbers.current.size+1);const n=terminalNumbers.current.get(item.sessionId);return item.owner==='agent'||item.awaitingConversation?'Agent · '+(item.conversationName||t(item.awaitingConversation?'等待会话接管':'终端')+' '+n):t('我的终端')+' '+n;}
 const connection=connections.find(value=>value.connectionId===selected),shell=shells.find(value=>value.sessionId===shellId),ready=!!connection&&connection.profileId===request.profileId&&connection.profileVersion===request.version&&connection.status==='authenticated'&&connection.authentication==='verified'&&connection.capabilities.multiplex;
 const candidates=connections.filter(value=>value.profileId===request.profileId&&value.profileVersion===request.version&&['authenticating','authenticated'].includes(value.status));
 const observedConnection=useRef(connection);observedConnection.current=connection;
 const observedShell=useRef(shell);observedShell.current=shell;
 const ownService=service?.connectionId===selected?service:null;
 const transfer=ownService?.status==='connecting'?serviceTransfer(ownService):null;
 const servicePending=ownService?.status==='connecting'||ownService?.status==='unknown'||ownService?.status==='connected'&&!ownService.workflowReady;
 const confirmed=managed.resources.find(r=>r.connectionId===selected&&r.profileId===connection?.profileId&&r.profileVersion===connection?.profileVersion);
 const hosted=confirmed||(ready&&publication?.connectionId===selected&&publication.profileId===connection.profileId&&publication.profileVersion===connection.profileVersion?publication:null);
 useEffect(()=>{if(confirmed||!ready||publication?.connectionId!==selected)setPublication(null);},[confirmed,ready,selected,publication]);
 const serviceReady=hosted?.serviceReady||ownService?.status==='connected'&&ownService.workflowReady===true;
 function accept(value:SshConnectionState){if(!verifiedSshConnection(value))throw Error('Invalid SSH connection response');setConnections(old=>{const prior=old.find(item=>item.connectionId===value.connectionId);return prior&&prior.revision>value.revision?old:[value,...old.filter(item=>item.connectionId!==value.connectionId)];});}
 function report(error:unknown,fallbackAction='connection'){
  const code=sshConnectionCode(error)||'terminal_operation_failed';
  const action=error&&typeof error==='object'&&'action' in error&&typeof error.action==='string'?error.action:fallbackAction;
  const message=t(action==='compute.managed.publish'&&code==='ssh_connection_changed'?'托管回执与当前 SSH 连接不匹配。请刷新并核对原连接。':sshConnectionMessage({code}));
  setDiagnostic({code,action,message,connectionId:login.current.connectionId,requestId:login.current.requestId});
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
 async function refresh(){
  const ticket=generation.current,read=++reads.current,id=latest.current.selected,scope=latest.current.resourceScope;
  const observingHandoff=shellInput.current.locked;
  const current=()=>alive.current&&ticket===generation.current&&read===reads.current&&id===latest.current.selected&&scope===latest.current.resourceScope;
  try{
   const listing=await sshInvoke<{connections:SshConnectionState[]}>('compute.sshConnection.list',{});
   if(!current())return;
   if(!Array.isArray(listing.connections)||!listing.connections.every(verifiedSshConnection))throw Error('Invalid connection listing');
   setListed(true);
   setConnections(old=>listing.connections.map(value=>{
    const prior=old.find(item=>item.connectionId===value.connectionId);
    return prior&&prior.revision>value.revision?prior:value;
   }));
   if(id){
    const [state,sessions]=await Promise.all([sshInvoke<IndependentSshService>('compute.sshService.status',{connectionId:id}),sshInvoke<{sessions:Shell[]}>('sharedTerminal.list',{})]);
    if(!current())return;
    if(!Array.isArray(sessions.sessions))throw Error('Invalid shell listing');
    setService(old=>old?.connectionId===state.connectionId&&(old?.revision??-1)>(state.revision??-1)?old:state);
    const local=sessions.sessions.filter(item=>item.connectionId===id||item.resource?.kind==='ssh-connection'&&item.resource.connectionId===id);
    const visibleShells=local.filter(item=>!item.conversationTerminal||item.currentConversation);
    const owned=visibleShells.find(item=>item.currentConversation),restoring=login.current.restoreShell;
    login.current.restoreShell=false;
    const requested=exactShell.current;
    if(requested){
     exactShell.current=undefined;
     const original=visibleShells.find(item=>item.sessionId===requested&&item.owner==='human'&&item.alive===true&&!item.expired);
     setShellId(original?.sessionId||'');
     if(!original)setNotice(t('原终端当前不可用，请核对连接。'));
    }else setShellId(previous=>visibleShells.some(item=>item.sessionId===previous)?previous:latest.current.request.exact?'':owned?.sessionId||(restoring&&visibleShells.length===1?visibleShells[0].sessionId:''));
    setShells(old=>visibleShells.map(item=>{
     const prior=old.find(value=>value.sessionId===item.sessionId);
     return prior&&prior.ownerEpoch>item.ownerEpoch?prior:item;
    }));
   }
   setInventoryError(null);
  }catch(error){
   if(current()&&!observingHandoff&&!shellInput.current.locked)setInventoryError({id,scope,code:sshConnectionCode(error)||'terminal_unavailable'});
  }
 }
 async function action(run:(current:()=>boolean)=>Promise<void>,kind:'publish'|'terminal'='terminal'){if(flight.current)return;flight.current=true;const operation=++operations.current;reads.current++;setPendingAction(kind);setNotice('');setDiagnostic(null);lastError.current='';const ticket=generation.current,id=latest.current.selected,nonce=latest.current.request.nonce,profileId=latest.current.request.profileId,profileVersion=latest.current.request.version;const current=()=>alive.current&&ticket===generation.current&&latest.current.selected===id&&latest.current.request.nonce===nonce&&latest.current.request.profileId===profileId&&latest.current.request.version===profileVersion;try{await run(current);}catch(error){if(current())report(error);}finally{if(operation===operations.current){flight.current=false;if(alive.current){setPendingAction(null);void refresh();}}}}
 async function publishConnection(){
  if(!connection||!ready||hosted)return;
  await action(async current=>{
   const result=await sshInvoke<PublishedSshResource>('compute.managed.publish',{connectionId:connection.connectionId,profileId:connection.profileId,profileVersion:connection.profileVersion});
   if(!current())return;
   if(result?.kind!=='ssh'||!result.resourceId||result.connectionId!==connection.connectionId||result.profileId!==connection.profileId||result.profileVersion!==connection.profileVersion)throw Object.assign(Error('ssh_connection_changed'),{action:'compute.managed.publish'});
   setPublication(result);
  },'publish');
 }
 async function open(explicit=false){await action(async current=>{if(!request.profileId||!request.version)throw Error('Saved SSH profile required');if(explicit){login.current={nonce:request.nonce,requestId:crypto.randomUUID(),connectionId:'',finished:false,failed:false,restoreShell:false,serial:0,pending:false,scope:resourceScope,provider};setLoginState(null);setLoginBusy(false);}const flow=login.current;const value=await sshInvoke<SshConnectionState>('compute.sshConnection.open',{profileId:request.profileId,profileVersion:request.version,requestId:flow.requestId});if(!current())return;if(!verifiedSshConnection(value)||value.profileId!==request.profileId||value.profileVersion!==request.version)throw Error('compute_profile_changed');flow.connectionId=value.connectionId;accept(value);setSelected(value.connectionId);setShellId('');setShells([]);});}
 function resumeConnection(value:SshConnectionState){
  login.current={nonce:request.nonce,requestId:value.loginRequestId||request.nonce,connectionId:value.connectionId,finished:value.status==='authenticated'||!value.loginRequestId,failed:value.status==='authenticating',restoreShell:value.status==='authenticated',serial:0,pending:false,scope:resourceScope,provider};
  setSelected(value.connectionId);
  setNotice(value.status!=='authenticated'&&!value.loginRequestId?t('原登录请求无法恢复，请查看原终端并刷新连接；不会另开登录。'):'');
 }
 useEffect(()=>{alive.current=true;generation.current++;exactShell.current=request.exact?request.sessionId:undefined;login.current={nonce:request.nonce,requestId:request.nonce,connectionId:'',finished:false,failed:false,restoreShell:false,serial:0,pending:false,scope:resourceScope,provider};setLoginState(null);setDiagnostic(null);setNotice('');setLoginBusy(false);setListed(false);setGeometry(null);setSelected('');setShellId('');setShells([]);setService(null);void refresh();return()=>{alive.current=false;generation.current++;};},[request.nonce]);
 useEffect(()=>{if(!visible||!listed||selected||flight.current||startedRequest.current===request.nonce)return;startedRequest.current=request.nonce;const existing=request.connectionId?candidates.find(value=>value.connectionId===request.connectionId):candidates.length===1?candidates[0]:undefined;if(existing)resumeConnection(existing);else if(request.exact)setNotice(t('原终端当前不可用，请核对连接。'));else if(candidates.length<=1)void open();},[visible,listed,selected,request.nonce,busy]);
 useEffect(()=>{if(!visible)return;void refresh();const timer=setInterval(()=>void refresh(),2000),off=window.studio?.onEvent(event=>{if(['studio/sshConnectionChanged','studio/sshServiceChanged','studio/conversationTerminalChanged'].includes(event.method))void refresh();});return()=>{clearInterval(timer);off?.();};},[visible,selected,request.nonce,resourceScope,provider]);
 function loginContext(flow:typeof login.current){const ticket=generation.current,id=flow.connectionId,nonce=request.nonce,profileId=request.profileId,version=request.version;return()=>alive.current&&ticket===generation.current&&login.current===flow&&latest.current.selected===id&&latest.current.request.nonce===nonce&&latest.current.request.profileId===profileId&&latest.current.request.version===version;}
 async function receiveLogin(result:LoginResult,flow:typeof login.current,current:()=>boolean,method:string){
  if(!current())return;const value=result?.connection,next=result?.shell;
  if(!verifiedSshConnection(value)||value.connectionId!==flow.connectionId||value.profileId!==request.profileId||value.profileVersion!==request.version||value.loginRequestId!==undefined&&value.loginRequestId!==flow.requestId)throw Error('ssh_connection_changed');
  if(observedConnection.current?.connectionId===value.connectionId&&observedConnection.current.revision>value.revision){flow.failed=true;return;}
  const state=result.login??{status:value.status==='authenticated'?'complete':'waiting_authentication'};
  if(!['waiting_authentication','checking','complete','failed'].includes(state.status)||state.phase!==undefined&&!['checking_authentication','opening_shell'].includes(state.phase)||state.code!==undefined&&(typeof state.code!=='string'||sshConnectionCode(state.code)!==state.code)||method==='compute.sshConnection.loginStatus'&&!result.login)throw Error('terminal_unavailable');
  if(next&&(value.status!=='authenticated'||value.authentication!=='verified'||state.status!=='complete'||!next.sessionId||next.connectionId!==flow.connectionId||next.resource!==undefined&&(next.resource.kind!=='ssh-connection'||next.resource.connectionId!==flow.connectionId||next.resource.profileId!==undefined&&next.resource.profileId!==value.profileId||next.resource.profileVersion!==undefined&&next.resource.profileVersion!==value.profileVersion)||!value.terminalSessionIds.includes(next.sessionId)||!['human','agent'].includes(next.owner)||!Number.isSafeInteger(next.ownerEpoch)||next.ownerEpoch<1))throw Error('ssh_control_identity_changed');
  accept(value);setLoginState(state);
  if(state.status==='checking'||state.status==='failed')flow.failed=true;
  if(state.code)report({code:state.code},method);
  if(next){flow.finished=true;setShells(old=>[next,...old.filter(item=>item.sessionId!==next.sessionId)]);setShellId(next.sessionId);setNotice('');setDiagnostic(null);}
  else if(state.status==='complete')flow.finished=true;
 }
 async function requestLogin(flow:typeof login.current,method:'compute.sshConnection.completeLogin'|'compute.sshConnection.loginStatus',outerCurrent:()=>boolean){
  if(flow.pending||flow.finished||!outerCurrent())return;const serial=++flow.serial,current=()=>outerCurrent()&&serial===flow.serial;flow.pending=true;setLoginBusy(true);if(method==='compute.sshConnection.completeLogin')setLoginState({status:'checking'});
  try{const result=await sshInvoke<LoginResult>(method,{connectionId:flow.connectionId,requestId:flow.requestId});if(current())await receiveLogin(result,flow,current,method);}
  catch(error){if(current()){flow.failed=true;report(error,method);}}
  finally{flow.pending=false;if(alive.current&&login.current===flow)setLoginBusy(false);}
 }
 async function observeOriginalLogin(){const flow=login.current,current=loginContext(flow);if(flow.connectionId&&current())await requestLogin(flow,'compute.sshConnection.loginStatus',current);}
 async function continueLogin(){const flow=login.current;if(flow.pending||!connection||!flow.failed||!loginState||!['waiting_authentication','failed'].includes(loginState.status))return;await action(async current=>{flow.scope=latest.current.resourceScope;flow.provider=latest.current.provider;flow.failed=false;setLoginState({status:'checking',phase:'checking_authentication'});await requestLogin(flow,'compute.sshConnection.completeLogin',()=>current()&&loginContext(flow)());});}
 useEffect(()=>{if(!visible||!selected||login.current.connectionId!==selected||login.current.finished)return;let stopped=false;const flow=login.current,fresh=loginContext(flow),current=()=>!stopped&&fresh();const poll=()=>{const observed=observedConnection.current;if(!observed||['closed','unsupported','requires_review'].includes(observed.status)||!['authenticating','authenticated'].includes(observed.status)&&!flow.failed)return;if(!flight.current&&current())void requestLogin(flow,flow.failed?'compute.sshConnection.loginStatus':'compute.sshConnection.completeLogin',current);};poll();const timer=setInterval(poll,700);return()=>{stopped=true;if(flow.pending)flow.failed=true;clearInterval(timer);};},[visible,selected,request.nonce,request.profileId,request.version]);
 async function openShell(){
  if(!connection||!ready)return;
  await action(async current=>{
   const value=await sshInvoke<Shell|{session:Shell}>('compute.sshConnection.openShell',{connectionId:connection.connectionId,requestId:crypto.randomUUID()});
   if(!current())return;
   const next='session' in value?value.session:value;
   if(!next.sessionId||(next.connectionId||next.resource?.connectionId)!==connection.connectionId)throw Error('Shell connection identity differs');
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
 const visibleDiagnostic=failureReplacesDiagnostic?{...diagnostic,code:failedConnectionCode,message:t(sshConnectionMessage(failedConnectionCode))}:diagnostic;
 const error=visibleDiagnostic?.code||(sameLogin?connection?.error?.code:undefined);
 const canContinue=!!connection&&!login.current.finished&&login.current.failed&&!!loginState&&['waiting_authentication','failed'].includes(loginState.status);
 const configure=(section?:"service")=>{const profileId=connection?.profileId||request.profileId,profileVersion=connection?.profileVersion||request.version;if(profileId&&profileVersion)onConfigureSsh?.({profileId,profileVersion,...section?{section}:{}});};
 const visibleReadDiagnostic=readDiagnostic&&readDiagnostic.connectionId===selected&&readDiagnostic.sessionId===shell?.sessionId&&login.current.connectionId===selected?readDiagnostic:null;
 const visibleGeometry=geometry&&geometry.connectionId===selected&&geometry.sessionId===shell?.sessionId&&geometry.ownerEpoch===shell?.ownerEpoch?geometry:null;
 const visibleInventory=inventoryError?.id===selected&&inventoryError.scope===resourceScope?inventoryError:null;
 const connectionIssue=error||(sameLogin&&connection?.status==='unsupported'?'ssh_multiplex_unsupported':undefined);
 const serviceIssue=ready?ownService?.error?.code:undefined;
 const reviewService=!serviceReady&&serviceIdentityUnconfirmed(serviceIssue);
 const serviceWarning=ready&&serviceReady&&!!ownService?.warnings?.length;
 const issues=[
  connectionIssue?{
   id:'ssh-login-error',
   summary:t(visibleDiagnostic?.action==='compute.managed.publish'?'托管结果待核对':'SSH 连接需要核对'),
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
  visibleReadDiagnostic?{
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
    {serviceIssue&&onConfigureSsh&&<button type="button" className="button" data-testid="ssh-service-review" onClick={()=>configure('service')}>{t('核对作业服务')}</button>}
   </>,
  }:null,
  visibleInventory?{
   id:'ssh-inventory-observation',
   summary:t('终端列表暂未刷新。'),
   content:<code>{visibleInventory.code}</code>,
  }:null,
  visibleGeometry?{
   id:'ssh-resize-observation',
   summary:t('终端显示尺寸尚未同步。'),
   content:<code>{visibleGeometry.code}</code>,
  }:null,
 ].filter(issue=>issue!==null);
 const profileName=request.profileName||t('SSH 终端');
 const connectionStatus=connection?.status||'connecting';
 const statusLabel=t(sshStateLabel(connectionStatus))+(connection&&connection.profileVersion!==request.version?' · '+t('原版本连接'):'');
 const canRelogin=!!connection&&['unavailable','closed','requires_review','unsupported'].includes(connection.status);
 const canClose=!!connection&&connection.status!=='closed';
 const chooseConnection=!selected&&listed&&candidates.length>1;
 const publishing=pendingAction==='publish';
 const publicationLabel=t(publishing?'正在托管…':'登录完成，交由 AIMatterLab 管理');
 const loginTip=loginState?.status==='failed'?t('原登录未完成，请核对提示后继续。'):loginState?.status==='checking'?t('正在检查原登录，请稍候。'):connectionStatus==='authenticating'?t('请在原终端完成密码或验证码输入。'):null;
 const serviceProgress=ready&&servicePending?<div className="ssh-worker-preparing" data-testid="ssh-worker-preparing" role="status">
  <span>{t(ownService?.status==='unknown'?'作业服务接入结果待确认':ownService?.status==='connected'?'作业服务通道已连接，工具尚未就绪':servicePhaseMessage(ownService?.phase))}</span>
  {ownService?.status==='connecting'&&<progress max={transfer?.total??1} value={transfer?.completed} aria-label={t('正在准备作业服务…')}/>}
  {transfer&&<span title={transfer.completed.toLocaleString()+' / '+transfer.total.toLocaleString()+' B'}>{transfer.percent}%</span>}
 </div>:null;
 const statusMessage=notice||(chooseConnection?t('在“更多”中选择已打开的连接。'):null);
 function menuAction(run:()=>void){
  closeDisclosure(moreDetails.current,true);
  run();
 }
 return <section className="shared-terminal-panel ssh-connection-panel" data-testid="ssh-connection-panel" onPointerDown={event=>{
  if(!moreDetails.current?.contains(event.target as Node))closeDisclosure(moreDetails.current);
  if(!statusDetails.current?.contains(event.target as Node))closeDisclosure(statusDetails.current);
 }}>
  <div className="shared-terminal-toolbar ssh-connection-toolbar" role="group" aria-label={t('SSH 连接操作')}>
   <div className="ssh-connection-identity">
    <strong title={profileName}>{profileName}</strong>
    <span className="ssh-connection-state" data-state={connectionStatus} data-testid="ssh-connection-status" role="status" title={statusLabel}>{statusLabel}</span>
   </div>
   {ready&&(hosted?<span className="ssh-managed-status" data-testid="ssh-managed-status" role="status" title={t('已由 AIMatterLab 管理')}><Check size={16} aria-hidden="true"/>{t('已托管')}</span>:
    <button type="button" className="button primary ssh-host-action" data-testid="ssh-publish-resource" disabled={busy||loginBusy} aria-label={publicationLabel} aria-busy={publishing} title={publicationLabel} onClick={()=>void publishConnection()}>
     {publishing?<RefreshCw size={15} aria-hidden="true"/>:<Server size={15} aria-hidden="true"/>}
     <span className="ssh-host-label" aria-hidden="true">{publicationLabel}</span>
     <span className="ssh-host-short-label" aria-hidden="true">{t(publishing?'正在托管…':'托管')}</span>
    </button>)}
   {canContinue&&<button type="button" className="button ssh-recovery-action" data-testid="ssh-login-continue" data-guide-target="ssh-continue" disabled={busy||loginBusy} onClick={()=>void continueLogin()}>{t('继续原登录')}</button>}
   {canRelogin&&<button type="button" className="button ssh-recovery-action" data-testid="ssh-login-retry" disabled={busy} onClick={()=>void open(true)}>{t('重新登录')}</button>}
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
      {ready&&<button type="button" className="button" data-testid="ssh-open-shell" disabled={busy} onClick={()=>menuAction(()=>void openShell())}>{t(shell?'另开终端':'打开终端')}</button>}
      {ready&&shell&&<button type="button" className="button danger" data-testid="ssh-shell-close" disabled={busy} onClick={()=>menuAction(()=>void closeShell())}>{t('关闭终端')}</button>}
      {canClose&&<button type="button" className="button danger" data-testid="ssh-connection-close" disabled={busy} onClick={()=>menuAction(()=>void closeConnection())}>{t('关闭 SSH 连接')}</button>}
      {ready&&serviceReady&&<span className="ssh-menu-service" data-testid="ssh-worker-ready">{t(serviceWarning?'作业服务已连接':'作业服务可用')}</span>}
     </div>
    </details>}
   </div>
  </div>
  {issues.length>0?<div className="ssh-status-strip ssh-diagnostics" data-testid="ssh-diagnostics">
   <TriangleAlert size={15} aria-hidden="true"/>
   <span className="ssh-diagnostic-title" role={connectionIssue?'alert':'status'} title={issues[0].summary}>{issues[0].summary}</span>
   {issues.length>1&&<span className="ssh-diagnostic-count">+{issues.length-1}</span>}
   <details className="ssh-disclosure" ref={statusDetails} onBlur={disclosureBlur} onKeyDown={disclosureKeyDown}>
    <summary className="button ssh-details-toggle" data-testid="ssh-diagnostic-toggle">{t('详情')}<ChevronDown size={14} aria-hidden="true"/></summary>
    <div className="ssh-popover ssh-diagnostic-popover">
     {issues.map(issue=><section key={issue.id} data-testid={issue.id}><strong>{issue.summary}</strong>{issue.content}</section>)}
     {statusMessage&&<p>{statusMessage}</p>}
     {serviceProgress}
    </div>
   </details>
  </div>:loginTip||statusMessage||serviceProgress?<div className="ssh-status-strip">
   {statusMessage?<span role="status">{statusMessage}</span>:loginTip?<span data-testid="ssh-login-progress" role="status">
    <span>{loginTip}</span>
    {loginState?.phase&&<> · {t(sshActionLabel(loginState.phase))}</>}
    {connectionStatus==='authenticating'&&loginState?.status!=='checking'&&<> {t('认证信息不会交给 Agent。')}</>}
   </span>:serviceProgress}
  </div>:null}
  {ready&&shells.length>1&&<div className="ssh-shell-tabs" data-testid="ssh-shell-actions" role="group" aria-label={t('选择终端')}>
   {shells.map(item=><button type="button" key={item.sessionId} className="button" aria-pressed={item.sessionId===shellId} disabled={busy} onClick={()=>setShellId(item.sessionId)}>{shellLabel(item)}</button>)}
  </div>}
  {connection?.status==='authenticating'&&<ChannelTerminal key={'auth:'+selected} connection={connection} visible={visible} resourceScope={resourceScope} onGeometry={setGeometry} inputState={authInput.current} onConnection={accept} onShell={()=>{}} onError={report}/>}
  {ready&&(shell?<ChannelTerminal key={'shell:'+shell.sessionId} connection={connection} shell={shell} visible={visible} resourceScope={resourceScope} onGeometry={setGeometry} inputState={shellInput.current} onConnection={accept} onShell={next=>setShells(old=>old.map(item=>item.sessionId===next.sessionId&&item.ownerEpoch===next.ownerEpoch?{...item,...next}:item))} onError={report} onReadError={reportRead} onReadSuccess={confirmRead}/>:
   <div className="shared-terminal-empty"><p>{t('当前没有打开的终端。')}</p></div>)}
 </section>;
}
