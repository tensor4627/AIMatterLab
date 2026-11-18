import {useEffect,useRef,useState} from 'react';
import {Terminal} from '@xterm/xterm';
import {createHumanInputWriter} from './human-input.mjs';
import {FitAddon} from '@xterm/addon-fit';
import {serviceErrorMessage,serviceIdentityUnconfirmed,servicePhaseMessage,serviceTransfer} from './ssh-service-presentation';
import {invoke} from '../../api/studio';
import {t} from '../../ui/i18n';
import type {ComputeResourceState,SharedTerminalResizeRequest} from '../../../contracts/dto/compute';
import type {AgentProvider,Conversation} from '../../../contracts/dto/agent';
import {verifiedSshConnection,sshConnectionCode,sshConnectionMessage,sshActionLabel,sshStateLabel,type SshConnectionState,type IndependentSshService} from '../compute/ssh-connection-types';

type Shell={sessionId:string;serviceGrantPending?:boolean;conversationName?:string;humanInputSequence?:number;outputWait?:boolean;awaitingConversation?:boolean;conversationTerminal?:boolean;currentConversation?:boolean;connectionId?:string;resource?:{kind:string;connectionId?:string;profileId?:string;profileVersion?:number};name:string;owner:'human'|'agent';ownerEpoch:number;alive:boolean|null;expired?:boolean;output?:string;cursor?:number;dropped?:boolean};
type Props={resourceScope?:string;activeResource?:ComputeResourceState|null;visible:boolean;request:{nonce:string;profileId?:string;version?:number;profileName?:string;connectionId?:string};canShare:boolean;provider?:AgentProvider;onError:(error:unknown)=>void;onConversationPrepared?:(conversation:Conversation)=>void;onResourceChange?:(state:ComputeResourceState,label?:string)=>void;onConfigureSsh?:(ref?:{profileId:string;profileVersion:number;section?:"service"})=>void;onPlainSsh?:()=>void};
type ChannelInput={pending:Promise<void>;locked:boolean;observationEpoch:number};
type LoginState={status:'waiting_authentication'|'checking'|'complete'|'failed';phase?:'checking_authentication'|'opening_shell';code?:string};
type LoginResult={connection:SshConnectionState;shell?:Shell;login?:LoginState};
type Diagnostic={code:string;action:string;message:string;connectionId:string;requestId:string};
type ShellReadIdentity={connectionId:string;sessionId:string;ownerEpoch:number};
type ShellReadDiagnostic=ShellReadIdentity&{code:string;message:string};
type GeometryDiagnostic={connectionId:string;sessionId?:string;ownerEpoch?:number;code:string};
async function sshInvoke<T=unknown>(method:string,data?:unknown):Promise<T>{try{return await invoke<T>(method,data);}catch(error){const code=sshConnectionCode(error)||'terminal_operation_failed';throw Object.assign(new Error(sshConnectionMessage({code})),{code,action:method});}}

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

export default function SshConnectionPanel({visible,request,canShare,activeResource,provider,resourceScope='',onError,onConversationPrepared,onResourceChange,onConfigureSsh,onPlainSsh}:Props){
 const [connections,setConnections]=useState<SshConnectionState[]>([]),[listed,setListed]=useState(false),[selected,setSelected]=useState(''),[shells,setShells]=useState<Shell[]>([]),[shellId,setShellId]=useState(''),[service,setService]=useState<IndependentSshService|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[diagnostic,setDiagnostic]=useState<Diagnostic|null>(null),[loginState,setLoginState]=useState<LoginState|null>(null),[loginBusy,setLoginBusy]=useState(false);
 const [readDiagnostic,setReadDiagnostic]=useState<ShellReadDiagnostic|null>(null);
 const [geometry,setGeometry]=useState<GeometryDiagnostic|null>(null),[activated,setActivated]=useState<ComputeResourceState|null>(null);
 const [activating,setActivating]=useState(false),activationSequence=useRef(0);
 const [inventoryError,setInventoryError]=useState<{id:string;scope:string;code:string}|null>(null);
 const alive=useRef(true),flight=useRef(false),generation=useRef(0),operations=useRef(0),reads=useRef(0),lastError=useRef(''),startedRequest=useRef(''),authInput=useRef<ChannelInput>({pending:Promise.resolve(),locked:false,observationEpoch:0}),shellInput=useRef<ChannelInput>({pending:Promise.resolve(),locked:false,observationEpoch:0}),latest=useRef({selected,request,provider,resourceScope});latest.current={selected,request,provider,resourceScope};
 const login=useRef({nonce:request.nonce,requestId:request.nonce,connectionId:'',finished:false,failed:false,restoreShell:false,serial:0,pending:false,scope:resourceScope,provider});
 const terminalNumbers=useRef(new Map<string,number>());
 function shellLabel(item:Shell){if(!terminalNumbers.current.has(item.sessionId))terminalNumbers.current.set(item.sessionId,terminalNumbers.current.size+1);const n=terminalNumbers.current.get(item.sessionId);return item.owner==='agent'||item.awaitingConversation?'Agent · '+(item.conversationName||t(item.awaitingConversation?'等待会话接管':'终端')+' '+n):t('我的终端')+' '+n;}
 const connection=connections.find(value=>value.connectionId===selected),shell=shells.find(value=>value.sessionId===shellId),ready=connection?.status==='authenticated'&&connection.authentication==='verified'&&connection.capabilities.multiplex;
 const active=activeResource===undefined?activated:activeResource;
 const selectedHere=!!connection&&active?.kind==='ssh-connection'&&active.status==='selected'&&active.connectionId===connection.connectionId&&active.profileId===connection.profileId&&active.profileVersion===connection.profileVersion;
 const observedConnection=useRef(connection);observedConnection.current=connection;
 const observedShell=useRef(shell);observedShell.current=shell;
 const ownService=service?.connectionId===selected?service:null;
 const transfer=ownService?.status==='connecting'?serviceTransfer(ownService):null;
 const servicePending=ownService?.status==='connecting'||ownService?.status==='unknown'||ownService?.status==='connected'&&!ownService.workflowReady;
 const serviceReady=ownService?.status==='connected'&&ownService.workflowReady===true&&(shell?.owner!=='agent'||ownService.operator==='agent');
 function accept(value:SshConnectionState){if(!verifiedSshConnection(value))throw Error('Invalid SSH connection response');setConnections(old=>{const prior=old.find(item=>item.connectionId===value.connectionId);return prior&&prior.revision>value.revision?old:[value,...old.filter(item=>item.connectionId!==value.connectionId)];});}
 const report=(error:unknown,fallbackAction='connection')=>{const code=sshConnectionCode(error)||'terminal_operation_failed',action=error&&typeof error==='object'&&'action' in error&&typeof error.action==='string'?error.action:fallbackAction,message=t(sshConnectionMessage({code})),key=action+':'+code;setNotice(message);setDiagnostic({code,action,message,connectionId:login.current.connectionId,requestId:login.current.requestId});if(lastError.current!==key){lastError.current=key;onError(Object.assign(new Error(message),{code,action,phase:action}));}};
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
    setShellId(previous=>visibleShells.some(item=>item.sessionId===previous)?previous:owned?.sessionId||(restoring&&visibleShells.length===1?visibleShells[0].sessionId:''));
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
 async function action(run:(current:()=>boolean)=>Promise<void>){if(flight.current)return;flight.current=true;const operation=++operations.current;reads.current++;setBusy(true);setNotice('');setDiagnostic(null);lastError.current='';const ticket=generation.current,id=latest.current.selected,nonce=latest.current.request.nonce,profileId=latest.current.request.profileId,profileVersion=latest.current.request.version,p=latest.current.provider,scope=latest.current.resourceScope;const current=()=>alive.current&&ticket===generation.current&&latest.current.selected===id&&latest.current.request.nonce===nonce&&latest.current.request.profileId===profileId&&latest.current.request.version===profileVersion&&latest.current.provider===p&&latest.current.resourceScope===scope;try{await run(current);}catch(error){if(current())report(error);}finally{if(operation===operations.current){flight.current=false;if(alive.current){setBusy(false);void refresh();}}}}
 async function activate(value:SshConnectionState){
  if(value.status!=='authenticated'||value.authentication!=='verified')return;
  const ticket=generation.current,scope=latest.current.resourceScope,nonce=latest.current.request.nonce,selectedProvider=latest.current.provider;
  const operation=++activationSequence.current;
  const current=()=>alive.current&&operation===activationSequence.current&&ticket===generation.current&&scope===latest.current.resourceScope&&nonce===latest.current.request.nonce&&selectedProvider===latest.current.provider;
  setActivating(true);
  try{
   const resource=await sshInvoke<ComputeResourceState>('compute.resource.activate',{kind:'ssh-connection',connectionId:value.connectionId,profileId:value.profileId,profileVersion:value.profileVersion});
   if(!current())return;
   if(resource.kind!=='ssh-connection'||resource.connectionId!==value.connectionId||resource.profileId!==value.profileId||resource.profileVersion!==value.profileVersion||resource.status!=='selected')throw Object.assign(Error('compute_resource_unverified_state'),{action:'compute.resource.activate'});
   setActivated(resource);onResourceChange?.(resource,t('SSH 连接'));
  }catch(error){if(current())throw error;}
  finally{if(alive.current&&operation===activationSequence.current)setActivating(false);}
 }
 async function open(explicit=false){await action(async current=>{if(!request.profileId||!request.version)throw Error('Saved SSH profile required');if(explicit){login.current={nonce:request.nonce,requestId:crypto.randomUUID(),connectionId:'',finished:false,failed:false,restoreShell:false,serial:0,pending:false,scope:resourceScope,provider};setLoginState(null);setLoginBusy(false);}const flow=login.current;const value=await sshInvoke<SshConnectionState>('compute.sshConnection.open',{profileId:request.profileId,profileVersion:request.version,requestId:flow.requestId});if(!current())return;if(!verifiedSshConnection(value)||value.profileId!==request.profileId||value.profileVersion!==request.version)throw Error('compute_profile_changed');flow.connectionId=value.connectionId;accept(value);setSelected(value.connectionId);setShellId('');setShells([]);});}
 useEffect(()=>{alive.current=true;generation.current++;login.current={nonce:request.nonce,requestId:request.nonce,connectionId:'',finished:false,failed:false,restoreShell:false,serial:0,pending:false,scope:resourceScope,provider};setLoginState(null);setDiagnostic(null);setLoginBusy(false);setListed(false);setActivated(null);setGeometry(null);setSelected('');setShellId('');setShells([]);setService(null);void refresh();return()=>{alive.current=false;generation.current++;};},[request.nonce]);
 useEffect(()=>{if(!visible||!listed||selected||flight.current||startedRequest.current===request.nonce)return;startedRequest.current=request.nonce;const candidates=connections.filter(value=>value.profileId===request.profileId&&value.profileVersion===request.version&&['authenticating','authenticated'].includes(value.status));const existing=request.connectionId?candidates.find(value=>value.connectionId===request.connectionId):candidates.length===1?candidates[0]:undefined;if(existing){login.current={nonce:request.nonce,requestId:existing.loginRequestId||request.nonce,connectionId:existing.connectionId,finished:existing.status==='authenticated'||!existing.loginRequestId,failed:existing.status==='authenticating',restoreShell:existing.status==='authenticated',serial:0,pending:false,scope:resourceScope,provider};setSelected(existing.connectionId);if(existing.status==='authenticated')void activate(existing).catch(report);else if(!existing.loginRequestId)setNotice(t('原登录请求无法恢复，请查看原终端并刷新连接；不会另开登录。'));}else if(candidates.length>1){setNotice(t('此连接已有多个打开的终端，请在已打开的终端中选择要继续使用的一项。'));}else void open();},[visible,listed,selected,request.nonce,busy]);
 useEffect(()=>{if(!visible)return;void refresh();const timer=setInterval(()=>void refresh(),2000),off=window.studio?.onEvent(event=>{if(['studio/sshConnectionChanged','studio/sshServiceChanged','studio/conversationTerminalChanged'].includes(event.method))void refresh();});return()=>{clearInterval(timer);off?.();};},[visible,selected,request.nonce,resourceScope,provider]);
 function loginContext(flow:typeof login.current){const ticket=generation.current,id=flow.connectionId,nonce=request.nonce,scope=flow.scope,p=flow.provider,profileId=request.profileId,version=request.version;return()=>alive.current&&ticket===generation.current&&login.current===flow&&latest.current.selected===id&&latest.current.request.nonce===nonce&&latest.current.request.profileId===profileId&&latest.current.request.version===version&&latest.current.resourceScope===scope&&latest.current.provider===p;}
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
  if(next){flow.finished=true;setShells(old=>[next,...old.filter(item=>item.sessionId!==next.sessionId)]);setShellId(next.sessionId);setNotice('');setDiagnostic(null);if(current())await activate(value);}
  else if(state.status==='complete'){flow.finished=true;setNotice(t('原登录已完成；已关闭的终端不会自动重开。'));}
 }
 async function requestLogin(flow:typeof login.current,method:'compute.sshConnection.completeLogin'|'compute.sshConnection.loginStatus',outerCurrent:()=>boolean){
  if(flow.pending||flow.finished||!outerCurrent())return;const serial=++flow.serial,current=()=>outerCurrent()&&serial===flow.serial;flow.pending=true;setLoginBusy(true);if(method==='compute.sshConnection.completeLogin')setLoginState({status:'checking'});
  try{const result=await sshInvoke<LoginResult>(method,{connectionId:flow.connectionId,requestId:flow.requestId});if(current())await receiveLogin(result,flow,current,method);}
  catch(error){if(current()){flow.failed=true;report(error,method);}}
  finally{flow.pending=false;if(alive.current&&login.current===flow)setLoginBusy(false);}
 }
 async function observeOriginalLogin(){const flow=login.current,current=loginContext(flow);if(flow.connectionId&&current())await requestLogin(flow,'compute.sshConnection.loginStatus',current);}
 async function continueLogin(){const flow=login.current;if(flow.pending||!connection||!flow.failed||!loginState||!['waiting_authentication','failed'].includes(loginState.status))return;await action(async current=>{flow.scope=latest.current.resourceScope;flow.provider=latest.current.provider;flow.failed=false;setLoginState({status:'checking',phase:'checking_authentication'});await requestLogin(flow,'compute.sshConnection.completeLogin',()=>current()&&loginContext(flow)());});}
 useEffect(()=>{if(!visible||!selected||login.current.connectionId!==selected||login.current.finished)return;let stopped=false;const flow=login.current,fresh=loginContext(flow),current=()=>!stopped&&fresh();const poll=()=>{const observed=observedConnection.current;if(!observed||['closed','unsupported','requires_review'].includes(observed.status)||!['authenticating','authenticated'].includes(observed.status)&&!flow.failed)return;if(!flight.current&&current())void requestLogin(flow,flow.failed?'compute.sshConnection.loginStatus':'compute.sshConnection.completeLogin',current);};poll();const timer=setInterval(poll,700);return()=>{stopped=true;if(flow.pending)flow.failed=true;clearInterval(timer);};},[visible,selected,request.nonce,request.profileId,request.version,resourceScope,provider]);
 async function openShell(forAgent=false){
  if(!connection||!ready||forAgent&&!selectedHere)return;
  await action(async current=>{
   const existing=forAgent&&shells.find(item=>item.currentConversation||item.awaitingConversation);
   if(existing){setShellId(existing.sessionId);return;}
   let value:Shell|{session:Shell};
   try{value=await sshInvoke('compute.sshConnection.openShell',{connectionId:connection.connectionId,requestId:crypto.randomUUID()});}
   catch(error){if(!forAgent)throw error;if(current()){report(error);setNotice(t('第二个终端未能打开。你可以继续使用当前终端，或把它交给 Agent。'));}return;}
   if(!current())return;const next='session' in value?value.session:value;
   if(!next.sessionId||next.connectionId!==connection.connectionId&&next.resource?.connectionId!==connection.connectionId)throw Error('Shell connection identity differs');
   setShells(old=>[...old.filter(item=>item.sessionId!==next.sessionId),next]);
   if(!forAgent){setShellId(next.sessionId);await activate(connection);return;}
   const granted=await sshInvoke<Shell>('sharedTerminal.owner',{sessionId:next.sessionId,ownerEpoch:next.ownerEpoch,owner:'agent',...provider?{provider}:{}});
   if(!current())return;if(granted.sessionId!==next.sessionId||granted.connectionId!==connection.connectionId&&granted.resource?.connectionId!==connection.connectionId)throw Error('Shell connection changed');
   setShells(old=>old.map(item=>item.sessionId===granted.sessionId?granted:item));await refreshResource(current);
  });
 }
 async function shellOwner(){if(!shell||shell.owner==='human'&&!shell.awaitingConversation&&!selectedHere)return;if(busy&&shell.owner==='agent'){
  const ticket=++generation.current;operations.current++;flight.current=false;setBusy(false);shellInput.current.locked=true;shellInput.current.observationEpoch++;
  try{const next=await sshInvoke<Shell>('sharedTerminal.owner',{sessionId:shell.sessionId,ownerEpoch:shell.ownerEpoch,owner:'human'});if(alive.current&&ticket===generation.current){setShells(old=>old.map(item=>item.sessionId===next.sessionId?next:item));await refresh();}}catch(error){if(alive.current&&ticket===generation.current)report(error);}finally{shellInput.current.locked=false;}return;
 }await action(async current=>{shellInput.current.locked=true;shellInput.current.observationEpoch++;try{await shellInput.current.pending;if(!current())return;const owner=shell.owner==='human'&&!shell.awaitingConversation?'agent':'human',next=await sshInvoke<Shell&{conversation?:Conversation;service?:IndependentSshService}>('sharedTerminal.owner',{sessionId:shell.sessionId,ownerEpoch:shell.ownerEpoch,owner,...owner==='agent'&&provider?{provider}:{}});if(!current())return;if(next.sessionId!==shell.sessionId||next.connectionId!==selected&&next.resource?.connectionId!==selected)throw Error('Shell connection changed');setShells(old=>old.map(item=>item.sessionId===next.sessionId?next:item));if(next.conversation)onConversationPrepared?.(next.conversation);if(next.service){setService(next.service);if(next.service.error)setNotice(t('终端已交给 Agent，作业服务暂不可用：')+t(serviceErrorMessage(next.service.error.code)));}shellInput.current.locked=false;await refreshResource(current);}finally{shellInput.current.locked=false;}});}
 async function closeShell(){if(!shell)return;await action(async current=>{const result=await sshInvoke<{closed:boolean}>('sharedTerminal.close',{sessionId:shell.sessionId});if(!current())return;if(result?.closed!==true)throw Error('Shell close unconfirmed');setShells(old=>old.filter(item=>item.sessionId!==shell.sessionId));setShellId('');setNotice(t('终端已关闭，SSH 连接和作业服务保留。'));await refreshResource(current);});}
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
 return <section className="shared-terminal-panel ssh-connection-panel" data-testid="ssh-connection-panel"><div className="shared-terminal-toolbar"><strong>{request.profileName||t('SSH 终端')}</strong><span data-testid="ssh-connection-status">{t(sshStateLabel(connection?.status||'connecting'))}{connection&&connection.profileVersion!==request.version?' · '+t('原版本连接'):''}</span><button className="button" data-testid="ssh-login-refresh" disabled={busy} onClick={()=>{void refresh();void observeOriginalLogin();}}>{t('刷新')}</button><button className="button" data-testid="ssh-edit-connection" disabled={busy} onClick={()=>configure()}>{t('连接设置')}</button>{connection&&<button className="button danger" data-testid="ssh-connection-close" disabled={busy} onClick={()=>void closeConnection()}>{t('关闭 SSH 连接')}</button>}</div>
  {(sameLogin&&connection?.status==='unsupported'||error)&&<div role="alert" data-testid="ssh-login-error"><p>{visibleDiagnostic?.message||t(sshConnectionMessage(error||'ssh_multiplex_unsupported'))}</p>{visibleDiagnostic&&<span data-testid="ssh-error-action">{t(sshActionLabel(visibleDiagnostic.action))}</span>}{error&&<code data-testid="ssh-error-code">{sshConnectionCode(error)}</code>}<button className="button" data-testid="ssh-error-edit" data-guide-target="ssh-edit" onClick={()=>configure()}>{t('编辑此连接')}</button>{connection?.status==='unsupported'&&onPlainSsh&&<button className="button" data-testid="ssh-use-plain" onClick={onPlainSsh}>{t('打开普通 SSH 终端')}</button>}</div>}
  {visibleReadDiagnostic&&<div className="shared-terminal-notice" role="status" data-testid="ssh-read-observation"><span>{t(sshActionLabel('sharedTerminal.read'))} · {visibleReadDiagnostic.message}</span> <code data-testid="ssh-read-error-code">{visibleReadDiagnostic.code}</code></div>}
  {visibleGeometry&&<div className="shared-terminal-notice" role="status" data-testid="ssh-resize-observation">{t('终端显示尺寸尚未同步。')} <code>{visibleGeometry.code}</code></div>}
  {inventoryError&&inventoryError.id===selected&&inventoryError.scope===resourceScope&&<div className="shared-terminal-notice" role="status" data-testid="ssh-inventory-observation">{t('终端列表暂未刷新。')} <code>{inventoryError.code}</code></div>}
  {loginState&&<div className="shared-terminal-notice" data-testid="ssh-login-progress" role="status">{t(loginState.status==='waiting_authentication'?'请在原终端完成密码或验证码输入。':loginState.status==='checking'?'正在检查原登录，请稍候。':loginState.status==='complete'?'原登录已完成。':'原登录未完成，请核对提示后继续。')}{loginState.phase&&<span> · {t(sshActionLabel(loginState.phase))}</span>}</div>}
  {canContinue&&<button className="button" data-testid="ssh-login-continue" data-guide-target="ssh-continue" disabled={busy||loginBusy} onClick={()=>void continueLogin()}>{t('继续原登录')}</button>}
  {ready&&!selectedHere&&!loginBusy&&!activating&&<button className="button" data-testid="ssh-activate-resource" disabled={busy} onClick={()=>void action(async current=>{if(current()&&connection)await activate(connection);})}>{t('选择此计算资源')}</button>}
  {!selected&&listed&&connections.filter(value=>value.profileId===request.profileId&&value.profileVersion===request.version&&['authenticating','authenticated'].includes(value.status)).length>1&&<details><summary>{t('已打开的终端')}</summary>{connections.filter(value=>value.profileId===request.profileId&&value.profileVersion===request.version&&['authenticating','authenticated'].includes(value.status)).map((value,index)=><button className="button" key={value.connectionId} onClick={()=>{generation.current++;login.current={nonce:request.nonce,requestId:value.loginRequestId||request.nonce,connectionId:value.connectionId,finished:value.status==='authenticated'||!value.loginRequestId,failed:value.status==='authenticating',restoreShell:value.status==='authenticated',serial:0,pending:false,scope:resourceScope,provider};setSelected(value.connectionId);}}>{t('终端')} {index+1} · {t(sshStateLabel(value.status))}</button>)}</details>}
  {connection&&['unavailable','closed','requires_review','unsupported'].includes(connection.status)&&<button className="button" data-testid="ssh-login-retry" disabled={busy} onClick={()=>void open(true)}>{t('重新登录')}</button>}
  {connection?.status==='authenticating'&&<><p className="shared-terminal-notice">{t('请像普通 SSH 终端一样输入密码或验证码。登录成功后会自动进入终端；认证信息不会交给 Agent。')}</p><ChannelTerminal key={'auth:'+selected} connection={connection} visible={visible} resourceScope={resourceScope} onGeometry={setGeometry} inputState={authInput.current} onConnection={accept} onShell={()=>{}} onError={report}/></>}
  {ready&&<><div className="shared-terminal-toolbar" data-testid="ssh-shell-actions">
   {shells.length>1&&<div className="ssh-shell-tabs" role="group" aria-label={t('选择终端')}>{shells.map(item=><button type="button" key={item.sessionId} className="button" aria-pressed={item.sessionId===shellId} disabled={busy} onClick={()=>setShellId(item.sessionId)}>{shellLabel(item)}</button>)}</div>}
   {shell&&<><span>{t(shell.awaitingConversation?'等待会话接管':shell.owner==='agent'?'由 Agent 操作':'由你操作')}</span><button className="button" data-testid="ssh-shell-owner" disabled={(busy||loginBusy)&&shell.owner!=='agent'||shell.alive!==true||shell.owner==='human'&&!shell.awaitingConversation&&(!canShare||!selectedHere)} onClick={()=>void shellOwner()}>{t(shell.awaitingConversation?'取消交接':shell.owner==='agent'?'我来操作':'交给 Agent 当前终端')}</button></>}
   {shell?.owner==='human'&&!shell.awaitingConversation&&<button className="button" data-testid="ssh-agent-separate" disabled={busy||loginBusy||!canShare||!selectedHere} onClick={()=>void openShell(true)}>{t(shells.some(item=>item.currentConversation||item.awaitingConversation)?'查看 Agent 终端':'为 Agent 另开终端')}</button>}
   <details><summary>{t('更多')}</summary><button className="button" data-testid="ssh-open-shell" disabled={busy} onClick={()=>void openShell()}>{t(shell?'另开终端':'打开终端')}</button>{shell&&<button className="button" data-testid="ssh-shell-close" disabled={busy} onClick={()=>void closeShell()}>{t('关闭终端')}</button>}</details>
   {serviceReady&&<span className="muted" data-testid="ssh-worker-ready">{t(ownService?.warnings?.length?'作业服务已连接':'作业服务可用')}</span>}
   {serviceReady&&!!ownService?.warnings?.length&&<span data-testid="ssh-worker-warning" role="status">{t('工具清单待核对，可继续由 Agent 协助配置环境。')}</span>}
   {servicePending&&<div className="ssh-worker-preparing" data-testid="ssh-worker-preparing" role="status"><span>{t(ownService?.status==='unknown'?'作业服务接入结果待确认':ownService?.status==='connected'?'作业服务通道已连接，工具尚未就绪':'正在准备作业服务…')}{ownService?.status==='connecting'&&<> · {t(servicePhaseMessage(ownService.phase))}</>}</span>{ownService?.status==='connecting'&&<progress max={transfer?.total??1} value={transfer?.completed} aria-label={t('正在准备作业服务…')}/>}{transfer&&<span>{transfer.percent}% · {transfer.completed.toLocaleString()}/{transfer.total.toLocaleString()} B</span>}</div>}
   {ownService?.error&&<span data-testid="ssh-worker-error" role="status">{t(serviceErrorMessage(ownService.error.code))}</span>}
   {!serviceReady&&serviceIdentityUnconfirmed(ownService?.error?.code)&&<span data-testid="ssh-service-identity-notice" role="status">{t(shell?.alive===true?'SSH 认证有效；作业服务身份尚未核对，当前终端保留。':'SSH 认证有效；作业服务身份尚未核对。')}{onConfigureSsh&&<button className="button" data-testid="ssh-service-review" onClick={()=>configure('service')}>{t('核对作业服务')}</button>}</span>}
   {shell?.owner==='agent'&&ownService?.workflowReady&&ownService.operator!=='agent'&&<span data-testid="ssh-worker-grant-error" role="status">{t(shell.serviceGrantPending?'作业服务已连接，等待本轮回复结束后交接。':'终端已交接，作业服务尚未交接成功')}</span>}
  </div>{shell&&<ChannelTerminal key={'shell:'+shell.sessionId} connection={connection} shell={shell} visible={visible} resourceScope={resourceScope} onGeometry={setGeometry} inputState={shellInput.current} onConnection={accept} onShell={next=>setShells(old=>old.map(item=>item.sessionId===next.sessionId&&item.ownerEpoch===next.ownerEpoch?{...item,...next}:item))} onError={report} onReadError={reportRead} onReadSuccess={confirmRead}/>}</>}
  {notice&&<p className="shared-terminal-notice" role="status">{failureReplacesDiagnostic&&notice===diagnostic?.message?visibleDiagnostic?.message:notice}</p>}{busy&&<p role="status">{t('正在准备此连接…')}</p>}
 </section>;
}
