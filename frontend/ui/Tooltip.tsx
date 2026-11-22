import {createPortal} from 'react-dom';
import {Info} from 'lucide-react';
import {t} from './i18n';
import {cloneElement,isValidElement,useEffect,useLayoutEffect,useId,useRef,useState,type ReactNode,type ReactElement} from 'react';

/** A delayed explanation for short labels; actionable warnings stay in the page. */
export default function Tooltip({content,children,className='',asChild=false,activate=false}:{content:string;children:ReactNode;className?:string;asChild?:boolean;activate?:boolean}){
 const anchor=useRef<HTMLSpanElement>(null),popup=useRef<HTMLSpanElement>(null),focused=useRef(false);
 const [position,setPosition]=useState<{left:number;top:number}|null>(null);
 const id=useId(),[open,setOpen]=useState(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 function cancel(){if(timer.current!==null){clearTimeout(timer.current);timer.current=null;}}
 function hide(){cancel();setOpen(false);setPosition(null);}
 function show(){cancel();if(open)return;timer.current=setTimeout(()=>{timer.current=null;setOpen(true);},400);}
 function leave(){if(focused.current)return;cancel();timer.current=setTimeout(hide,180);}
 useEffect(()=>()=>cancel(),[]);
 useLayoutEffect(()=>{
  if(!open)return;const a=anchor.current?.getBoundingClientRect(),p=popup.current?.getBoundingClientRect();if(!a||!p)return;
  const margin=8,gap=7,w=window.innerWidth,h=window.innerHeight;
  const above=a.top-gap-p.height,preferred=above>=margin?above:a.bottom+gap;
  setPosition({left:Math.max(margin,Math.min(a.left,w-p.width-margin)),top:Math.max(margin,Math.min(preferred,h-p.height-margin))});
 },[open,content]);
 useEffect(()=>{
  if(!open)return;
  function escape(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hide();}}
  function scroll(event:Event){if(event.target instanceof Node&&popup.current?.contains(event.target))return;hide();}
  window.addEventListener('scroll',scroll,true);window.addEventListener('resize',hide);window.addEventListener('keydown',escape,true);
  return()=>{window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',hide);window.removeEventListener('keydown',escape,true);};
 },[open]);
 const explanation=open&&createPortal(<span ref={popup} id={id} role="tooltip" className="explanation-tooltip-content" style={{left:position?.left||0,top:position?.top||0,visibility:position?'visible':'hidden',maxWidth:'min(320px, calc(100vw - 16px))',maxHeight:'calc(100vh - 16px)',overflowY:'auto'}} onMouseEnter={cancel} onMouseLeave={leave}>{content}</span>,document.body);
 const trigger={ref:anchor,'aria-describedby':open?id:undefined,onMouseEnter:show,onMouseLeave:leave,onFocus:()=>{focused.current=true;show();},onBlur:()=>{focused.current=false;hide();}};
 if(asChild&&isValidElement(children)){
  const child=children as ReactElement<any>;
  const merged:Record<string,unknown>={...trigger};
  if(child.props.ref){
   const childRef=child.props.ref;
   merged.ref=(node:HTMLElement|null)=>{
    anchor.current=node;
    if(typeof childRef==='function')return childRef(node);
    childRef.current=node;
   };
  }
  merged['aria-describedby']=[child.props['aria-describedby'],open?id:undefined].filter(Boolean).join(' ')||undefined;
  for(const key of ['onMouseEnter','onMouseLeave','onFocus','onBlur'] as const){
   const own=child.props[key];
   if(own)merged[key]=(event:unknown)=>{own(event);trigger[key]();};
  }
  merged.onClick=(event:unknown)=>{
   if(activate){cancel();setOpen(true);}else{hide();}
   return child.props.onClick?.(event);
  };
  return <>{cloneElement(child,merged)}{explanation}</>;
 }
 return <span {...trigger} className={'explanation-tooltip '+className} tabIndex={0}>{children}{explanation}</span>;
}

/** Use beside a field when the explanation has no suitable labeled control. */
export function HelpTip({label,content}:{label:string;content:string}){
 return <Tooltip asChild activate content={content}>
  <button type="button" className="field-help" aria-label={label+' · '+t('帮助')}><Info size={15} aria-hidden="true"/></button>
 </Tooltip>;
}
