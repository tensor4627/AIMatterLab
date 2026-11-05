import {tr} from './i18n';
import {useEffect,useId,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
export const statusNames:Record<string,string>={draft:'草稿',validating:'验证中',ready:'已验证',queued:'排队中',running:'运行中',succeeded:'已完成',failed:'失败',cancelled:'已取消',unknown:'状态未知',passed:'通过',blocked:'环境阻塞',not_run:'未验证'};
export function Modal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}){
 const ref=useRef<HTMLElement>(null),titleId=useId(),closeRef=useRef(onClose);closeRef.current=onClose;
 function focusable(){return [...(ref.current?.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')||[])].filter(el=>!el.matches(':disabled,[tabindex="-1"],[type="hidden"]')&&el.getClientRects().length>0);}
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,node=ref.current;
  const top=()=>node===document.querySelectorAll('[role="dialog"]').item(document.querySelectorAll('[role="dialog"]').length-1);
  const focus=()=>{const items=focusable();(items.find(el=>el.closest('.modal-body'))||items[0]||node)?.focus();};
  if(node&&!node.contains(document.activeElement))focus();
  const onKey=(e:KeyboardEvent)=>{if(!top())return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeRef.current();}else if(e.key==='Tab')trap(e);};
  const onFocus=(e:FocusEvent)=>{if(top()&&node&&!node.contains(e.target as Node))focus();};
  document.addEventListener('keydown',onKey,true);document.addEventListener('focusin',onFocus);
  return()=>{document.removeEventListener('keydown',onKey,true);document.removeEventListener('focusin',onFocus);if(previous&&previous.isConnected)previous.focus();};
 },[]);
 function trap(e:KeyboardEvent){
  if(!ref.current)return;
  const items=focusable();
  if(!items.length){e.preventDefault();ref.current.focus();return;}
  const first=items[0],last=items[items.length-1],current=document.activeElement;
  if(!ref.current.contains(current)||current===ref.current){e.preventDefault();(e.shiftKey?last:first).focus();}
  else if(e.shiftKey&&current===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&current===last){e.preventDefault();first.focus();}
 }
 return <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={'modal '+(wide?'large':'')}><header><h2 id={titleId}>{tr(title)}</h2><button className="icon-button" aria-label={tr('关闭')} title={tr('关闭')} onClick={onClose}><X size={18}/></button></header><div className="modal-body">{children}</div></section></div>;
}
export function Empty({title,body,action}:{title:string;body:string;action?:ReactNode}){
 return <div className="empty"><div className="empty-mark" aria-hidden="true">◇</div><h3>{tr(title)}</h3><p>{tr(body)}</p>{action}</div>;
}
export function Badge({status}:{status:string}){
 return <span className={'badge '+status}><i/>{tr(statusNames[status]||status)}</span>;
}
