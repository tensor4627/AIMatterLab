import {useRef} from 'react';
import {Camera} from 'lucide-react';
import {saveWorkbenchImage,type WorkbenchImageResult} from './types';
import {t} from './i18n';
export function afterWorkbenchPaint():Promise<void>{return new Promise((resolve,reject)=>{let first=0,second=0;const timer=setTimeout(()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);reject(Error('工作台尚未完成绘制，未采集图像'));},2000);first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{clearTimeout(timer);resolve();});});});}
export default function WorkbenchImageCommand({query,busy,onDismiss,onBusy,onSaved,onError}:{query:string;busy:boolean;onDismiss:()=>void;onBusy:(value:boolean)=>void;onSaved:(value:WorkbenchImageResult)=>void;onError:(error:unknown)=>void}){
 const active=useRef(false);if(query&&!['保存当前工作台图像','诊断','图像','PNG','diagnostic','image','save workbench'].some(value=>value.toLowerCase().includes(query.toLowerCase())))return null;
 async function save(){if(active.current||busy)return;active.current=true;onBusy(true);onDismiss();try{await afterWorkbenchPaint();const result=await saveWorkbenchImage();if(result?.status==='saved')onSaved(result);}catch(error){onError(error);}finally{active.current=false;onBusy(false);}}
 return <button data-testid="save-workbench-image" disabled={busy} onClick={()=>void save()} title={t('诊断 PNG · 仅当前可见工作台，不上传')}><Camera size={17}/>{t('保存当前工作台图像…')}</button>;
}
