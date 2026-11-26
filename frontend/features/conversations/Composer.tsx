import Notice from '../../ui/Notice';
import Button from '../../ui/Button';
import {ArrowUp,ListPlus,Paperclip} from 'lucide-react';
import {useId,useImperativeHandle,useRef,useState,useSyncExternalStore,type ReactNode,type RefObject} from 'react';
import type {ChatAttachmentRef} from '../../../contracts/dto/chat-attachments';
import {t,tr} from '../../ui/i18n';
import {ChatFiles} from './ChatFiles';
import type {ComposerDraftStore} from './composer-drafts.mjs';

type Props={
 drafts:ComposerDraftStore;
 inputRef:RefObject<HTMLTextAreaElement|null>;
 working:boolean;
 sendDisabled:boolean;
 onEdit:(text:string)=>void;
 onSend:(alternate?:boolean)=>void;
 attachments:{
  pickDisabled:boolean;
  busy:boolean;
  imageMismatch:boolean;
  onImport:(files:File[])=>void;
  onPreview:(file:ChatAttachmentRef)=>void;
  onRemove:(id:string)=>void;
 };
 followUp?:{
  hint:string;
  queueAllowed:boolean;
  steer?:{allowed:boolean;busy:boolean;title:string;onSteer:()=>void};
  onQueue:()=>void;
  stopControl:ReactNode;
 };
 skillName?:string;
 onClearSkill:()=>void;
 newWorkflow:boolean;
 children:ReactNode;
};

export default function Composer({drafts,inputRef,working,sendDisabled,onEdit,onSend,attachments,followUp,skillName,onClearSkill,newWorkflow,children}:Props){
 const text=useSyncExternalStore(drafts.subscribe,drafts.text);
 const filePicker=useRef<HTMLInputElement>(null),shortcuts=useId();
 const files=drafts.files(),hasText=!!text.trim();
 const canSubmit=!attachments.imageMismatch&&!attachments.busy&&(hasText||files.length>0);
 const steer=followUp?.steer;
  const missingDraft=!hasText&&!files.length?t('请输入消息或添加附件。'):undefined;
 return <>
  {skillName!==undefined&&<div className="skill-chip"><span>{t('仅下条消息')} · {skillName}</span><Button variant="icon" size="sm" aria-label={t('移除本条消息技能')} onClick={onClearSkill}>×</Button></div>}
  {newWorkflow&&<Notice compact className="composer-workflow-notice" >{t('下条消息将新建流程；原流程保留。')}</Notice>}
  {attachments.imageMismatch&&<small className="chat-file-capability" role="status">{t('当前模型仅支持文字，请更换模型或移除图片。')}</small>}
  <ChatFiles files={files} preview={attachments.onPreview} remove={attachments.onRemove}/>
  <input ref={filePicker} hidden type="file" multiple data-testid="chat-file-picker" onChange={event=>{
   const files=Array.from(event.target.files||[]);event.target.value='';attachments.onImport(files);
  }}/>
  <textarea ref={inputRef} aria-describedby={shortcuts} data-guide-target="composer" aria-label={t('对话草稿')} aria-busy={working}
   value={text} onChange={event=>onEdit(event.target.value)} placeholder={t('输入消息…')}
   onPaste={event=>{const files=Array.from(event.clipboardData.files);if(files.length){event.preventDefault();attachments.onImport(files);}}}
   onKeyDown={event=>{
    if(event.key==='Enter'&&!event.shiftKey&&!event.altKey&&!event.nativeEvent.isComposing&&event.keyCode!==229){
     event.preventDefault();if(!event.repeat)onSend(event.ctrlKey||event.metaKey);
    }
   }}/>
  {children}
  <div className="composer-bottom">
   <Button variant="icon" size="sm" tooltip={t('添加文本、PDF、Office 文档或图片，也可拖入或粘贴')} type="button" className="chat-file-add" data-testid="chat-file-add"  aria-label={t('添加文件或图片')} disabled={attachments.busy||attachments.pickDisabled} onClick={()=>filePicker.current?.click()}><Paperclip size={17}/></Button>
   {attachments.busy&&<small role="status">{t('正在读取附件…')}</small>}
   <span id={shortcuts} data-testid={followUp?'agent-follow-up-shortcuts':undefined}>{followUp?.hint??t('Enter 发送 · Shift+Enter 换行')}</span>
   {followUp?<div className="agent-follow-up-actions">
    {steer&&<Button tooltip={steer.title} disabledReason={hasText?steer.title:t('请输入消息后引导。')} data-testid="agent-steer" disabled={!steer.allowed||!hasText} loading={steer.busy} onClick={steer.onSteer}>{t('引导')}</Button>}
    <Button variant="primary" tooltip={t('本对话的当前回复完成后发送')} disabledReason={missingDraft||(!followUp.queueAllowed?followUp.hint:undefined)} data-testid="agent-queue" disabled={!followUp.queueAllowed||!canSubmit} onClick={followUp.onQueue}><ListPlus size={15}/>{t('排队')}</Button>
    {followUp.stopControl}
   </div>:<Button variant="primary" className="send" aria-label={tr('发送')} tooltip={tr('发送')} disabledReason={missingDraft}
    onClick={()=>onSend()} disabled={sendDisabled||!canSubmit}><ArrowUp size={17} aria-hidden="true"/></Button>}
  </div>
 </>;
}

export function ComposerNotice({visible,handle}:{visible:boolean;handle:RefObject<((notice:string)=>void)|null>}){
 const [notice,setNotice]=useState('');
 useImperativeHandle(handle,()=>setNotice,[]);
 return visible&&notice?<div className="agent-send-notice" role="status">{notice}</div>:null;
}
