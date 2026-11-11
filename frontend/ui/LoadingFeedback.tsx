import {useEffect,useRef,useState} from 'react';
import {LoaderCircle} from 'lucide-react';
import {t} from './i18n';
import './loading-feedback.css';

export type LoadingFeedbackProps={busy:boolean;label:string;phase?:string;startedAt?:number;progress?:{completed:number;total:number};inline?:boolean};

/** Pending feedback is immediate; percentages are rendered only for measured work. */
export function LoadingFeedback({busy,label,phase,startedAt,progress,inline=false}:LoadingFeedbackProps){
 const start=useRef<number|null>(null),[elapsed,setElapsed]=useState(0);
 if(busy&&start.current===null)start.current=startedAt??Date.now();
 if(!busy)start.current=null;
 useEffect(()=>{if(!busy){setElapsed(0);return;}const update=()=>setElapsed(Math.max(0,Math.floor((Date.now()-(startedAt??start.current??Date.now()))/1000)));update();const timer=setInterval(update,1000);return()=>clearInterval(timer);},[busy,startedAt]);
 if(!busy)return null;
 const measured=progress&&Number.isFinite(progress.completed)&&Number.isFinite(progress.total)&&progress.total>0&&progress.completed>=0&&progress.completed<=progress.total?progress:null;
 return <span className={'loading-feedback'+(inline?' loading-feedback--inline':'')} aria-busy="true" data-testid="loading-feedback">
  <LoaderCircle className="loading-feedback__spinner" size={15} aria-hidden="true"/>
  <span role="status" aria-live="polite">{label}{phase&&phase!==label?' · '+phase:''}</span>
  {elapsed>0&&<span className="loading-feedback__elapsed" aria-live="off">{elapsed} {t('秒')}</span>}
  {measured&&<progress aria-label={label} value={measured.completed} max={measured.total}/>}
 </span>;
}
export default LoadingFeedback;
