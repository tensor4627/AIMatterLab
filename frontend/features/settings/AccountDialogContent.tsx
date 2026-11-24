import type {ReactNode} from 'react';
import {t} from '../../ui/i18n';

export default function AccountDialogContent({onClose,configured,edited,pending,children}: {
 onClose?:()=>void;configured:boolean;edited:boolean;pending:boolean;children:ReactNode;
}) {
 if(!onClose)return children;
 const done=configured&&!edited&&!pending;
 const label=done?'完成':pending?'关闭':edited?'放弃修改并关闭':'稍后配置';
 return <div className="account-dialog-content">
  <div className="account-dialog-scroll">{children}</div>
  <div className="button-row account-dialog-exit">
   <button type="button" className={done?'button primary':'button'} data-testid="provider-dialog-exit" onClick={onClose}>{t(label)}</button>
  </div>
 </div>;
}
