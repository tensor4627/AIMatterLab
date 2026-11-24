import {useLayoutEffect,useRef,type PointerEvent} from 'react';
import {t} from './i18n';
import './pane-divider.css';

type Pane = 'conversation'|'agent'|'bottom';
type Props = {
 label:string; value:number; min:number; max:number; onChange:(value:number)=>void;
 pane:Pane; reverse?:boolean; className?:string; orientation?:'vertical'|'horizontal';
};

export default function PaneDivider({label,value,min,max,onChange,pane,reverse=false,className='',orientation='vertical'}:Props){
 const hint=t('方向键调整32像素；Shift+方向键精调1像素；Home/End移至边界。');
 const clamp=(v:number)=>Math.max(min,Math.min(max,v));
 const horizontal=orientation==='horizontal',coordinate=(event:{clientX:number;clientY:number})=>horizontal?event.clientY:event.clientX;
 const cancelDrag=useRef<(()=>void)|null>(null);
 useLayoutEffect(()=>()=>cancelDrag.current?.(),[pane,value,min,max,reverse,onChange]);
 function drag(event:PointerEvent<HTMLDivElement>){
  if(cancelDrag.current||event.button!==0||!event.isPrimary)return;
  const node=event.currentTarget,shell=node.closest<HTMLElement>('.workspace-shell');
  if(!shell)return;
  const start=coordinate(event),id=event.pointerId,property='--drag-'+pane;
  const size=(e:globalThis.PointerEvent)=>clamp(value+(coordinate(e)-start)*(reverse?-1:1));
  function move(e:globalThis.PointerEvent){
   if(e.pointerId!==id)return;
   const next=size(e);
   shell!.style.setProperty(property,next+'px');
   node.dataset.dragging='';
   node.setAttribute('aria-valuenow',String(Math.round(next)));
  }
  function finish(e:globalThis.PointerEvent){
   if(e.pointerId!==id)return;
   stop();
   if(e.type==='pointerup'&&size(e)!==value)onChange(size(e));
  }
  function stop(){
   cancelDrag.current=null;
   node.removeEventListener('pointermove',move);
   for(const name of ['pointerup','pointercancel','lostpointercapture'] as const)node.removeEventListener(name,finish);
   shell!.style.removeProperty(property);
   delete node.dataset.dragging;
   node.setAttribute('aria-valuenow',String(Math.round(value)));
   if(node.hasPointerCapture(id))node.releasePointerCapture(id);
  }
  event.preventDefault();
  node.setPointerCapture(id);
  cancelDrag.current=stop;
  node.addEventListener('pointermove',move);
  for(const name of ['pointerup','pointercancel','lostpointercapture'] as const)node.addEventListener(name,finish);
 }
 return <div className={'pane-divider '+className} role="separator" aria-label={label} aria-description={hint} title={label+' · '+hint} aria-orientation={orientation} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)} tabIndex={0} onPointerDown={drag} onDoubleClick={()=>onChange((min+max)/2)} onKeyDown={e=>{if([...(horizontal?['ArrowUp','ArrowDown']:['ArrowLeft','ArrowRight']),'Home','End'].includes(e.key)){e.preventDefault();onChange(e.key==='Home'?min:e.key==='End'?max:clamp(value+(['ArrowRight','ArrowDown'].includes(e.key)?1:-1)*(e.shiftKey?1:32)*(reverse?-1:1)));}}}/>;
}
