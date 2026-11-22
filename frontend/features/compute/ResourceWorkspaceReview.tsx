import {useRef,useState} from 'react';
import {resourceWorkspaces} from '../../api/compute-resources';
import type {ResourceWorkspacePreview,ResourceWorkspaceReference} from '../../../contracts/dto/compute';
import {Modal} from '../../ui/Dialogs';
import {t} from '../../ui/i18n';
import {sshConnectionCode,sshConnectionMessage} from './ssh-connection-types';
import './resource-workspace.css';

type Target=ResourceWorkspaceReference;
export type WorkspacePreview=ResourceWorkspacePreview;
export function sameWorkspaceTarget(a:Target,b:Target){return a.connectionId===b.connectionId&&a.profileId===b.profileId&&a.profileVersion===b.profileVersion;}
export function previewResourceWorkspace(target:Target,directory?:string){return resourceWorkspaces.preview({connectionId:target.connectionId,profileId:target.profileId,profileVersion:target.profileVersion,...directory===undefined?{}:{directory}});}

export default function ResourceWorkspaceReview({target,resourceName,initial,initialError,isCurrent,onClose,onConfirmed,changing=false}:{target:Target;resourceName:string;initial?:WorkspacePreview;initialError?:string;isCurrent:()=>boolean;onClose:()=>void;onConfirmed:(receipt:WorkspacePreview)=>void|Promise<void>;changing?:boolean}){
 const [preview,setPreview]=useState(initial),[directory,setDirectory]=useState(initial?.root??''),[reviewedInput,setReviewedInput]=useState(initialError?null:initial?.root??null);
 const [pending,setPending]=useState(false),[error,setError]=useState(initialError??'');
 const flight=useRef(false);
 const ready=!!preview&&directory===reviewedInput&&!preview.conflict&&(preview.status==='confirmed'||!!preview.confirmationId);
 async function act(confirm:boolean){
  if(flight.current||!isCurrent()||confirm&&(!ready||!preview))return;
  flight.current=true;setPending(true);setError('');
  try{
   if(!confirm||!preview){
    setReviewedInput(null);
    const next=await previewResourceWorkspace(target,directory.trim()||undefined);
    if(!isCurrent())return;
    if(!sameWorkspaceTarget(next,target)||preview&&(next.account!==preview.account||next.hostname!==preview.hostname))throw Error(t('当前资源已变化，请重新核对。'));
    setPreview(next);setReviewedInput(next.root);setDirectory(next.root);
   }else{
    const next=preview.status==='confirmed'?preview:await resourceWorkspaces.confirm({
     connectionId:target.connectionId,profileId:target.profileId,profileVersion:target.profileVersion,confirmationId:preview.confirmationId!
    });
    if(!isCurrent())return;
    if(!sameWorkspaceTarget(next,target)||next.root!==preview.root||next.account!==preview.account||next.hostname!==preview.hostname)throw Error(t('工作区确认回执与当前资源不一致。'));
    if(next.conflict){setPreview(next);return;}
    if(next.status!=='confirmed')throw Error(t('工作区确认回执与当前资源不一致。'));
    setPreview(next);
    await onConfirmed(next);
   }
  }catch(error){if(isCurrent())setError(sshConnectionCode(error)?t(sshConnectionMessage(error)):error instanceof Error?error.message:String(error));}
  finally{flight.current=false;if(isCurrent())setPending(false);}
 }
 function dismiss(){
  if(preview?.confirmationId&&isCurrent())void resourceWorkspaces.cancel({connectionId:target.connectionId,profileId:target.profileId,profileVersion:target.profileVersion,confirmationId:preview.confirmationId}).catch(()=>{});
  onClose();
 }
 return <Modal title={changing?t('更换远端总工作区'):t('交接前确认远端总工作区')} onClose={dismiss} closeDisabled={pending}>
  <section className="resource-workspace-review" data-testid="resource-workspace-review" data-guide-target="ssh-workspace">
   <dl><dt>{t('计算资源')}</dt><dd>{preview?.resourceName??resourceName}</dd>{preview&&<><dt>{t('远端账号')}</dt><dd><code>{preview.account}@{preview.hostname}</code></dd></>}</dl>
   <form onSubmit={event=>{event.preventDefault();void act(false);}}>
    <label>{t('远端总工作区')}<input data-testid="resource-workspace-path" placeholder="~/AIMatterLab" value={directory} onChange={event=>{setDirectory(event.currentTarget.value);setError('');}} disabled={pending}/></label>
    <button type="submit" className="button" data-testid="resource-workspace-preview" disabled={pending}>{t('核对目录')}</button>
   </form>
   {preview&&directory===reviewedInput?<>
    <div className="resource-workspace-tree"><code dir="ltr" data-testid="resource-workspace-resolved">{preview.root}</code>
     <ul><li><code>workfile/</code> · {t('按日期保管会话的计算输入与结果')}</li><li><code>software/</code> · {t('存放从零配置的工具和版本记录')}</li></ul>
    </div>
    <p className="muted">{t(changing?'已绑定的会话继续使用原工作目录。':'可以使用已有目录，原有内容会保留。')}</p>
    {preview.conflict&&<p role="alert">{t('目录项冲突')} · <code>{preview.conflict}</code></p>}
   </>:<p role="status" className="muted">{t('先核对这个路径及远端解析结果。')}</p>}
   {error&&<div role="alert" className="notice"><strong>{t('远端工作区需要核对')}</strong><p>{error}</p></div>}
   <div className="button-row"><button type="button" className="button" disabled={pending} onClick={dismiss}>{t(changing?'取消':'稍后交接')}</button>
    <button type="button" className="button primary" data-testid="resource-workspace-confirm" data-guide-target="ssh-workspace-confirm" disabled={pending||!ready} onClick={()=>void act(true)}>{t(pending?'正在核对…':changing?'确认更换工作区':'确认并交接')}</button></div>
  </section>
 </Modal>;
}
