import type {HTMLAttributes,ReactNode} from 'react';
import {CircleAlert,Info,TriangleAlert} from 'lucide-react';
import {t} from './i18n';
import './notice.css';

export type NoticeSeverity='info'|'warning'|'error';

const appearance={
 info:{icon:Info,label:'提示'},
 warning:{icon:TriangleAlert,label:'警告'},
 error:{icon:CircleAlert,label:'错误'},
};

export default function Notice({severity='info',className='',children,action,announce=true,...attributes}:HTMLAttributes<HTMLDivElement>&{severity?:NoticeSeverity;action?:ReactNode;announce?:boolean}){
 const {icon:Icon,label}=appearance[severity];
 return <div className={['notice-surface',className].filter(Boolean).join(' ')} data-severity={severity} role={announce?(severity==='error'?'alert':'status'):undefined} {...attributes}>
  <span className="notice-level"><Icon size={16} aria-hidden="true"/>{t(label)}</span>
  <div className="notice-message">{children}</div>
  {action&&<div className="notice-action">{action}</div>}
 </div>;
}
