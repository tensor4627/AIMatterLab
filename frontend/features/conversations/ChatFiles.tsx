import {FileText,Image as ImageIcon,X} from 'lucide-react';
import type {ChatAttachmentPreview,ChatAttachmentRef} from '../../../contracts/dto/chat-attachments';
import {Modal} from '../../ui/Dialogs';
import {t} from '../../ui/i18n';

function revisionLabel(revision:string){
 const [number,digest]=revision.split('/');
 return digest?number+' · '+digest.slice(0,12):number.slice(0,12);
}

export function ChatFiles({files,preview,remove}:{files:readonly ChatAttachmentRef[];preview:(file:ChatAttachmentRef)=>void;remove?:(id:string)=>void}){
 if(!files.length)return null;
 return <ul className="chat-files" aria-label={t('消息附件')}>{files.map(file=>{
  const Icon=file.kind==='image'?ImageIcon:FileText,source=file.source;
  return <li key={file.id} data-testid="chat-file-chip">
   <button type="button" className="chat-file-preview" onClick={()=>preview(file)} title={t('预览附件')+' · '+file.name}>
    <Icon size={15} aria-hidden="true"/><span>{file.name}{source&&<small>
     {source.comparison?revisionLabel(source.comparison.beforeRevision)+' → '+revisionLabel(source.comparison.afterRevision):
      t('证据行')+' '+source.firstLine+'–'+source.lastLine+' · '+revisionLabel(source.revision)}
    </small>}</span>
   </button>
   {remove&&<button className="chat-file-remove" type="button" aria-label={t('移除附件')+' '+file.name} onClick={()=>remove(file.id)}><X size={13}/></button>}
  </li>;
 })}</ul>;
}

export function ChatFilePreview({value,close}:{value:ChatAttachmentPreview;close:()=>void}){
 const file=value.file,source=file.source;
 return <Modal title={file.name} wide onClose={close}><div className="chat-file-view" data-testid="chat-file-preview">
  {source&&<div className="chat-evidence-citation">
   {source.projectId&&<p>{t('项目')} · {source.projectId}</p>}
   {source.runId&&<p>{t('作业')} · {source.runId}</p>}
   {source.field&&<p>{t('参数')} · {source.field}{source.unit?' · '+source.unit:''}</p>}
   {source.comparison?<><p>{t('修改前')} · {source.comparison.beforeRevision}</p><p>{t('修改后')} · {source.comparison.afterRevision}</p></>:
    <p>{t('证据行')} {source.firstLine}–{source.lastLine} · {source.revision}</p>}
  </div>}
  {'url' in value?<img src={value.url} alt={file.name}/>:<pre>{value.text}</pre>}
 </div></Modal>;
}
