import {tr} from './i18n';
import {useEffect,useId,useRef,type ReactNode,type RefObject} from 'react';
import {X} from 'lucide-react';
import Button from './Button';
export {EmptyState as Empty} from './States';
export {StatusBadge as Badge} from './StatusBadge';
export function Modal({title,onClose,children,wide=false,closeDisabled=false,initialFocus,describedBy}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean;closeDisabled?:boolean;initialFocus?:RefObject<HTMLElement|null>;describedBy?:string}){
 const ref=useRef<HTMLElement>(null),titleId=useId(),closeRef=useRef(onClose);closeRef.current=()=>{if(!closeDisabled)onClose();};
 const opener=useRef(typeof document==='undefined'?null:document.activeElement as HTMLElement|null);
 function focusable(){
  const candidates=ref.current?.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,details>summary:first-of-type,[tabindex]')||[];
  return [...candidates].filter(element=>{
   if(element.matches(':disabled,[tabindex="-1"],[type="hidden"]')||element.closest('[hidden],[inert]')||!element.getClientRects().length)return false;
   for(let disclosure=element.closest('details:not([open])');disclosure;disclosure=disclosure.parentElement?.closest('details:not([open])')??null){
    if(!disclosure.querySelector(':scope > summary:first-of-type')?.contains(element))return false;
   }
   return true;
  });
 }
 useEffect(()=>{
  const previous=opener.current,node=ref.current;
  const top=()=>node===[...document.querySelectorAll('[role="dialog"]:not(dialog:not([open]))')].filter(dialog=>!dialog.closest('[hidden]')).at(-1);
  const focus=()=>{const items=focusable(),preferred=initialFocus?.current;(preferred&&items.includes(preferred)?preferred:items.find(el=>el.closest('.modal-body'))||items[0]||node)?.focus();};
  if(node&&!node.contains(document.activeElement))focus();
  const onKey=(e:KeyboardEvent)=>{if(!top())return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!e.repeat)closeRef.current();}else if(e.key==='Tab')trap(e);};
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
 return <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)closeRef.current();}}><section ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy} tabIndex={-1} className={'modal '+(wide?'large':'')}><header><h2 id={titleId}>{tr(title)}</h2><Button variant="icon" aria-label={tr('关闭')} disabled={closeDisabled} onClick={()=>closeRef.current()}><X size={18}/></Button></header><div className="modal-body">{children}</div></section></div>;
}
