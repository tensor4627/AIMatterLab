import {useEffect,useState} from 'react';
import {t} from '../../ui/i18n';

export const observationDelay=10000;

export function usePageVisibility(){
 const visible=()=>typeof document==='undefined'||document.visibilityState!=='hidden';
 const [shown,setShown]=useState(visible);
 useEffect(()=>{
  if(typeof document==='undefined')return;
  const update=()=>setShown(visible());
  document.addEventListener('visibilitychange',update);
  return()=>document.removeEventListener('visibilitychange',update);
 },[]);
 return shown;
}

export function ClusterObservationStatus({connected,observedAt,error,paused=false,awaitingCurrent=false}:{connected:boolean;observedAt?:number|null;error?:boolean;paused?:boolean;awaitingCurrent?:boolean}){
 const retained=observedAt!=null;
 const message=!connected?'作业服务暂不可用。':error?(retained?'记录读取失败 · 保留上次记录':'读取作业记录失败。'):awaitingCurrent?'上次记录':null;
 if(!message&&!retained)return null;
 return <p className={message?'notice':'muted'} role={message?'status':undefined} data-testid="cluster-observation-status" data-stale={!!message&&retained}>
  {message&&t(message)}{message&&retained?' · ':null}
  {retained&&<>{t('最近读取')} <time dateTime={new Date(observedAt).toISOString()}>{new Date(observedAt).toLocaleString()}</time></>}
  {paused&&connected&&<small> · {t('自动同步已暂停')}</small>}
 </p>;
}
