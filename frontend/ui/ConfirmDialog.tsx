import {createContext,useCallback,useContext,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Modal} from './Dialogs';
import Button from './Button';
import {t} from './i18n';
import './components/confirm-dialog.css';

export interface ConfirmOptions {
 title:string;
 target:ReactNode;
 consequence:ReactNode;
 confirmLabel:string;
 cancelLabel?:string;
 tone?:'default'|'danger';
 testId?:string;
}

interface ConfirmDialogProps extends ConfirmOptions {
 onConfirm:()=>void;
 onCancel:()=>void;
 pending?:boolean;
 disabled?:boolean;
 contentTestId?:string;
}

export function ConfirmDialog({title,target,consequence,confirmLabel,cancelLabel=t('取消'),tone='default',testId,onConfirm,onCancel,pending=false,disabled=false,contentTestId}:ConfirmDialogProps){
 const cancel=useRef<HTMLButtonElement>(null),description=useId();
 return createPortal(<Modal title={title} onClose={onCancel} closeDisabled={pending} initialFocus={cancel} describedBy={description}>
  <div className="confirm-dialog" data-testid={contentTestId}>
   <div id={description} className="confirm-dialog-description">
    <div className="confirm-dialog-target">{target}</div>
    <div>{consequence}</div>
   </div>
   <div className="confirm-dialog-actions">
    <Button ref={cancel} disabled={pending} onClick={onCancel}>{cancelLabel}</Button>
    <Button variant={tone==='danger'?'danger':'primary'} data-testid={testId} disabled={disabled||pending} loading={pending} onClick={onConfirm}>{confirmLabel}</Button>
   </div>
  </div>
 </Modal>,document.body);
}

type Ask=(options:ConfirmOptions)=>Promise<boolean>;
const ConfirmContext=createContext<Ask|null>(null);

export function useConfirm(){
 const confirm=useContext(ConfirmContext);
 if(!confirm)throw Error('Missing ConfirmProvider');
 return confirm;
}

export function ConfirmProvider({children}:{children:ReactNode}){
 const active=useRef<{resolve:(accepted:boolean)=>void}|null>(null);
 const [options,setOptions]=useState<ConfirmOptions|null>(null);
 const finish=(accepted:boolean)=>{
  const request=active.current;
  if(!request)return;
  active.current=null;
  setOptions(null);
  request.resolve(accepted);
 };
 const confirm=useCallback<Ask>(options=>{
  if(active.current)return Promise.resolve(false);
  return new Promise(resolve=>{
   active.current={resolve};
   setOptions(options);
  });
 },[]);
 useEffect(()=>()=>{
  active.current?.resolve(false);
  active.current=null;
 },[]);
 return <ConfirmContext.Provider value={confirm}>
  {children}
  {options&&<ConfirmDialog {...options} onCancel={()=>finish(false)} onConfirm={()=>finish(true)}/>}
 </ConfirmContext.Provider>;
}
