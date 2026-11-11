import {t} from './i18n';
import './pane-divider.css';
import type {PointerEvent} from 'react';
export default function PaneDivider({label,value,min,max,onChange,reverse=false,className='',orientation='vertical'}:{label:string;value:number;min:number;max:number;onChange:(value:number)=>void;reverse?:boolean;className?:string;orientation?:'vertical'|'horizontal'}){
 const hint=t('方向键调整32像素；Shift+方向键精调1像素；Home/End移至边界。');
 const clamp=(v:number)=>Math.max(min,Math.min(max,v));
 const horizontal=orientation==='horizontal',coordinate=(event:{clientX:number;clientY:number})=>horizontal?event.clientY:event.clientX;
 function drag(event:PointerEvent<HTMLDivElement>){event.preventDefault();const node=event.currentTarget,start=coordinate(event),initial=value;node.setPointerCapture(event.pointerId);const move=(e:globalThis.PointerEvent)=>onChange(clamp(initial+(coordinate(e)-start)*(reverse?-1:1)));const end=()=>{node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',end);node.removeEventListener('pointercancel',end);node.removeEventListener('lostpointercapture',end);};node.addEventListener('pointermove',move);node.addEventListener('pointerup',end);node.addEventListener('pointercancel',end);node.addEventListener('lostpointercapture',end);}
 return <div className={'pane-divider '+className} role="separator" aria-label={label} aria-description={hint} title={label+' · '+hint} aria-orientation={orientation} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)} tabIndex={0} onPointerDown={drag} onDoubleClick={()=>onChange((min+max)/2)} onKeyDown={e=>{if([...(horizontal?['ArrowUp','ArrowDown']:['ArrowLeft','ArrowRight']),'Home','End'].includes(e.key)){e.preventDefault();onChange(e.key==='Home'?min:e.key==='End'?max:clamp(value+(['ArrowRight','ArrowDown'].includes(e.key)?1:-1)*(e.shiftKey?1:32)*(reverse?-1:1)));}}}/>;
}
