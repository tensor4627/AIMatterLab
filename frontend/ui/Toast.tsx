import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {CheckCircle2,CircleAlert,Info,X} from 'lucide-react';
import {t} from './i18n';
import Button from './Button';
import './components/toast.css';

type ToastSeverity='success'|'info'|'error';
interface ToastOptions {
 message:ReactNode;
 severity?:ToastSeverity;
 duration?:number;
 action?:{label:string;onClick:()=>void};
 onDismiss?:()=>void;
 testId?:string;
}
interface ToastEntry extends ToastOptions {id:number;remaining:number}
interface ToastControls {
 show:(options:ToastOptions)=>number;
 dismiss:(id:number)=>void;
 registerHost:(node:HTMLElement)=>()=>void;
}

export const UNDO_TOAST_DURATION=8000;
const ToastContext=createContext<ToastControls|null>(null);
const icons={success:CheckCircle2,info:Info,error:CircleAlert};

export function useToast(){
 const toast=useContext(ToastContext);
 if(!toast)throw Error('Missing ToastProvider');
 return toast;
}

export function useToastHost(ref:RefObject<HTMLElement|null>){
 const register=useContext(ToastContext)?.registerHost;
 useEffect(()=>{if(register&&ref.current)return register(ref.current);},[register,ref]);
}

export function Toast({entry,dismiss}:{entry:ToastEntry;dismiss:()=>void}){
 const {message,severity='success',action,testId}=entry;
 const Icon=icons[severity];
 const [hovered,setHovered]=useState(false),[focused,setFocused]=useState(false);
 const dismissRef=useRef(dismiss);
 dismissRef.current=dismiss;
 useEffect(()=>{
  if(severity==='error'||hovered||focused)return;
  const start=performance.now(),timer=window.setTimeout(()=>dismissRef.current(),entry.remaining);
  return()=>{
   window.clearTimeout(timer);
   entry.remaining=Math.max(0,entry.remaining-(performance.now()-start));
  };
 },[entry,severity,hovered,focused]);
 return <div className="app-toast" data-toast-severity={severity} data-testid={testId} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
  onFocus={()=>setFocused(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false);}}>
  <Icon size={17} className="app-toast-icon" aria-hidden="true"/>
  <div className="app-toast-message" role={severity==='error'?'alert':'status'}>{message}</div>
  {action&&<Button size="sm" onClick={()=>{action.onClick();dismiss();}}>{action.label}</Button>}
  <Button variant="icon" size="sm" className="app-toast-dismiss" aria-label={t('关闭通知')} onClick={dismiss}><X size={16} aria-hidden="true"/></Button>
 </div>;
}

export function ToastProvider({children}:{children:ReactNode}){
 const sequence=useRef(0),active=useRef<ToastEntry[]>([]);
 const [entries,setEntries]=useState<ToastEntry[]>([]);
 const [hosts,setHosts]=useState<HTMLElement[]>([]);
 const registerHost=useCallback((node:HTMLElement)=>{
  setHosts(previous=>[...previous,node]);
  return ()=>setHosts(previous=>previous.filter(host=>host!==node));
 },[]);
 const dismiss=useCallback((id:number)=>{
  if(!active.current.some(item=>item.id===id))return;
  active.current=active.current.filter(item=>item.id!==id);
  setEntries(active.current);
 },[]);
 const show=useCallback((options:ToastOptions)=>{
  const entry={...options,id:++sequence.current,remaining:options.duration??5000};
  active.current=[...active.current,entry];
  setEntries(active.current);
  return entry.id;
 },[]);
 const controls=useMemo(()=>({show,dismiss,registerHost}),[show,dismiss,registerHost]);
 // Choose the last dialog in document order, matching the dialog focus trap.
 const host=hosts.reduce<HTMLElement|null>((last,node)=>
  !last||(last.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING)?node:last,null);
 return <ToastContext.Provider value={controls}>
  {children}
  {!!entries.length&&createPortal(<div className="app-toast-region" data-dialog-toast={Boolean(host)||undefined} data-testid="toast-region">
   {entries.slice(0,3).map(entry=><Toast key={entry.id} entry={entry} dismiss={()=>{dismiss(entry.id);entry.onDismiss?.();}}/>)}
  </div>,host??document.body)}
 </ToastContext.Provider>;
}
