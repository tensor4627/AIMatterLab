import {useEffect,useRef,useState} from 'react';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {invoke} from './types';
import {t} from './i18n';
import './shared-terminal.css';

export type SharedTerminalRequest={nonce:string;kind:'local'|'ssh';mode:'interactive'|'key';clusterId?:string;version?:number};
type Session={sessionId:string;name:string;kind:string;mode:string;owner:'human'|'agent';ownerEpoch:number;alive:boolean|null;status:string;expired?:boolean;sequence:number;exitCode?:number|null};
type ReadResult=Session&{output:string;cursor:number;dropped:boolean};

export default function SharedTerminalPanel({visible,request,canShare,onError}:{visible:boolean;request?:SharedTerminalRequest;canShare:boolean;onError:(error:unknown)=>void}){
 const [sessions,setSessions]=useState<Session[]>([]),[active,setActive]=useState<Session|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[confirmEnd,setConfirmEnd]=useState(false);
 const activeRef=useRef(active),busyRef=useRef(false),lastRequest=useRef(''),host=useRef<HTMLDivElement>(null),terminal=useRef<Terminal|null>(null),fit=useRef<FitAddon|null>(null),cursor=useRef(0),generation=useRef(0),mounted=useRef(false),inputQueue=useRef(Promise.resolve()),menu=useRef<HTMLDetailsElement>(null);
 activeRef.current=active;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 function attach(value:Session){if(activeRef.current?.sessionId!==value.sessionId){cursor.current=0;generation.current++;}activeRef.current=value;setConfirmEnd(false);setNotice('');setActive(value);terminal.current?.focus();}
 async function list(){const selectedAtStart=activeRef.current;const value=await invoke<{sessions:Session[]}>('sharedTerminal.list');if(!value||!Array.isArray(value.sessions))throw Error(t('终端列表响应无效'));if(mounted.current){setSessions(value.sessions);const selected=value.sessions.find(item=>item.sessionId===activeRef.current?.sessionId);if(selected&&activeRef.current===selectedAtStart){activeRef.current=selected;setActive(selected);}}return value.sessions;}
 function report(error:unknown){const code=String(error);const message=code.includes('terminal_encryption_unavailable')?'系统凭据存储暂不可用，无法创建共享终端。':code.includes('terminal_context_changed')?'会话或计算资源已切换，请重新附加终端。':code.includes('terminal_saved_connection_changed')?'请先保存并重新选择此 SSH 连接。':code.includes('terminal_scope_denied')?'请先选定已保存的对话，再交给 Agent。':code.includes('terminal_client_namespace_required')?'请核对 SSH 客户端与密钥所在的 Windows 或 WSL 环境。':code.includes('terminal_route_review_required')?'请先核对并保存 SSH 路由设置。':code.includes('terminal_unavailable')?'终端暂不可用，请检查会话状态；不会自动重开连接。':null;onError(message?new Error(t(message)):error);}
 async function action(run:()=>Promise<void>){if(busyRef.current)return;busyRef.current=true;setBusy(true);setNotice('');try{await run();}catch(error){if(mounted.current)report(error);}finally{busyRef.current=false;if(mounted.current)setBusy(false);}}
 async function open(value:Omit<SharedTerminalRequest,'nonce'>){await action(async()=>{const session=await invoke<Session>('sharedTerminal.open',value);if(!mounted.current)return;attach(session);await list();});}
 useEffect(()=>{if(!visible)return;if(request&&lastRequest.current!==request.nonce){if(busyRef.current)return;lastRequest.current=request.nonce;const {nonce,...value}=request;void open(value);}else{void list().catch(report);}},[visible,request?.nonce,busy]);

 useEffect(()=>{
  if(!active?.sessionId||!host.current)return;
  const currentId=active.sessionId;
  const minimum=parseFloat(document.documentElement.style.getPropertyValue('--ui-min-font'))||11;
  const view=new Terminal({fontSize:Math.max(minimum,Number(document.documentElement.style.getPropertyValue('--terminal-font-size'))||13),fontFamily:'Cascadia Code, Consolas, monospace',scrollback:5000,convertEol:false,cursorBlink:true,theme:{background:'#121218',foreground:'#d1d5e4',cursor:'#b8a0f7'}});
  const addon=new FitAddon();view.loadAddon(addon);view.open(host.current);terminal.current=view;fit.current=addon;
  const resize=()=>{if(!host.current?.clientWidth||!host.current.clientHeight)return;view.options.fontSize=Math.max(parseFloat(document.documentElement.style.getPropertyValue('--ui-min-font'))||11,Number(document.documentElement.style.getPropertyValue('--terminal-font-size'))||13);addon.fit();if(activeRef.current?.alive===true)void invoke('sharedTerminal.resize',{sessionId:currentId,cols:view.cols,rows:view.rows}).catch(()=>{});};
  const observer=new ResizeObserver(resize);observer.observe(host.current);
  const input=view.onData(data=>{const owner=activeRef.current;if(busyRef.current||owner?.sessionId!==currentId||owner.owner!=='human'||owner.alive!==true||owner.expired)return;const ownerEpoch=owner.ownerEpoch,requestId=crypto.randomUUID();inputQueue.current=inputQueue.current.then(async()=>{const latest=activeRef.current;if(busyRef.current||latest?.sessionId!==currentId||latest.ownerEpoch!==ownerEpoch||latest.owner!=='human'||latest.expired)return;await invoke('sharedTerminal.input',{sessionId:currentId,ownerEpoch,requestId,data});}).catch(error=>{if(mounted.current)report(error);});});
  window.addEventListener('studio:appearance',resize);resize();view.focus();
  return()=>{input.dispose();observer.disconnect();window.removeEventListener('studio:appearance',resize);view.dispose();if(terminal.current===view){terminal.current=null;fit.current=null;}};
 },[active?.sessionId]);
 useEffect(()=>{const view=terminal.current;if(view){view.options.disableStdin=active?.owner!=='human'||active?.alive!==true||!!active?.expired;view.options.cursorBlink=active?.owner==='human'&&active?.alive===true&&!active?.expired;}},[active?.owner,active?.alive,active?.expired]);
 useEffect(()=>{
  if(!visible||!active?.sessionId)return;const id=active.sessionId,epoch=++generation.current;let reading=false,stopped=false;
  const read=async()=>{if(reading||stopped)return;const current=activeRef.current;if(current?.sessionId!==id||current.expired||current.alive===null)return;reading=true;
   try{const result=await invoke<ReadResult>('sharedTerminal.read',{sessionId:id,ownerEpoch:current.ownerEpoch,cursor:cursor.current,maxBytes:65536});if(stopped||generation.current!==epoch||activeRef.current?.sessionId!==id||activeRef.current.ownerEpoch!==current.ownerEpoch)return;
    if(result.dropped)terminal.current?.write('\r\n['+t('较早输出已超出回放容量')+']\r\n');
    if(result.output)terminal.current?.write(result.output);cursor.current=result.cursor;activeRef.current=result;setActive(result);setSessions(old=>old.map(item=>item.sessionId===id?result:item));setNotice(old=>old===t('终端暂不可读，请重新附加或检查会话状态。')?'':old);
   }catch(error){if(!stopped&&generation.current===epoch){setNotice(t('终端暂不可读，请重新附加或检查会话状态。'));if(activeRef.current?.status!=='unknown')await list().catch(()=>{});}}
   finally{reading=false;}
  };void read();const timer=setInterval(()=>void read(),500);return()=>{stopped=true;clearInterval(timer);};
 },[visible,active?.sessionId]);
 useEffect(()=>{if(visible&&host.current?.clientWidth)try{fit.current?.fit();}catch{}},[visible]);

 async function ownership(){const value=activeRef.current;if(!value)return;await action(async()=>{const next=await invoke<Session>('sharedTerminal.owner',{sessionId:value.sessionId,ownerEpoch:value.ownerEpoch,owner:value.owner==='human'?'agent':'human'});if(mounted.current){activeRef.current=next;setActive(next);await list();if(next.owner==='human')terminal.current?.focus();}});}
 async function end(){const value=activeRef.current;if(!value)return;await action(async()=>{await invoke('sharedTerminal.close',{sessionId:value.sessionId});if(!mounted.current)return;generation.current++;activeRef.current=null;setActive(null);setConfirmEnd(false);setNotice(t('会话已结束'));await list();});}
 function detach(){generation.current++;activeRef.current=null;setActive(null);setConfirmEnd(false);setNotice(t('视图已分离，会话继续运行'));}
 return <section className="shared-terminal-panel" data-testid="shared-terminal-panel">
  <div className="shared-terminal-toolbar">
   <select aria-label={t('共享终端会话')} value={active?.sessionId||''} disabled={busy} onChange={event=>{const found=sessions.find(item=>item.sessionId===event.target.value);if(found)attach(found);else detach();}}><option value="">{t('选择已有会话')}</option>{sessions.map(item=><option key={item.sessionId} value={item.sessionId}>{item.name} · {t(item.expired?'已过期':item.alive===true?'运行中':item.alive===null?'状态未知':'已结束')}</option>)}</select>
   {active&&<><span className={'shared-terminal-owner '+(active.owner==='agent'?'is-agent':'')}>{t(active.owner==='human'?'由你操作':'由 Agent 操作')}</span><button className="button" data-testid="shared-terminal-handoff" disabled={busy||active.alive!==true||active.expired||(active.owner==='human'&&!canShare)} title={t(active.owner==='human'?'仅共享交接后的输出；认证时请先接管。':'立即停止 Agent 读写并由你操作')} onClick={()=>void ownership()}>{t(active.owner==='human'?'交给 Agent':'我来操作')}</button></>}
   <details className="shared-terminal-menu" ref={menu}><summary aria-label={t('会话操作')}>⋯</summary><div onClick={()=>{if(menu.current)menu.current.open=false;}}><button className="button" disabled={busy} onClick={()=>void open({kind:'local',mode:'interactive'})}>{t('打开本地交互终端')}</button><button className="button" disabled={busy} onClick={()=>void list().catch(report)}>{t('刷新会话列表')}</button>{active&&<><button className="button" disabled={busy} onClick={detach}>{t('分离视图')}</button><button className="button" disabled={busy} onClick={()=>setConfirmEnd(true)}>{t('结束会话')}</button></>}</div></details>
  </div>
  {notice&&<p className="shared-terminal-notice" role="status">{notice}</p>}
  {confirmEnd&&<div className="shared-terminal-confirm"><span>{t('结束此会话会关闭对应终端进程。')}</span><button className="button" disabled={busy} onClick={()=>setConfirmEnd(false)}>{t('取消')}</button><button className="button" data-testid="confirm-end-shared-terminal" disabled={busy} onClick={()=>void end()}>{t('确认结束')}</button></div>}
  {active?<><div className="shared-terminal-host" ref={host}/><div className="shared-terminal-caption"><span>{t(active.kind==='local'?'本地会话':active.mode==='key'?'密钥自动登录':'交互式登录')} · {active.sessionId.slice(0,8)}</span><span>{active.expired?t('访问已过期，请结束此会话后重新打开。'):active.alive===true?t('终端进程运行中'):active.alive===null?t('状态未知'):t('终端进程已结束')}{typeof active.exitCode==='number'?' · '+active.exitCode:''}</span></div></>:<div className="shared-terminal-empty"><p>{t('附加已有会话，或打开本地交互终端。')}</p><button className="button" data-testid="open-local-shared-terminal" disabled={busy} onClick={()=>void open({kind:'local',mode:'interactive'})}>{t('打开本地交互终端')}</button></div>}
 </section>;
}
