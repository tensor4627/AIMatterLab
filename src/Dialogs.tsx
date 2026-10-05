import {tr} from './i18n';
import type {ReactNode} from 'react';
import {X} from 'lucide-react';
export function Modal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}){
 return <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className={'modal '+(wide?'large':'')}><header><h2>{tr(title)}</h2><button className="icon-button" onClick={onClose}><X size={18}/></button></header><div className="modal-body">{children}</div></section></div>;
}
export function Empty({title,body,action}:{title:string;body:string;action?:ReactNode}){
 return <div className="empty"><div className="empty-mark">◇</div><h3>{tr(title)}</h3><p>{tr(body)}</p>{action}</div>;
}
export function Badge({status}:{status:string}){
 const names:Record<string,string>={draft:'草稿',validating:'验证中',ready:'已验证',queued:'排队中',running:'运行中',succeeded:'已完成',failed:'失败',cancelled:'已取消',unknown:'状态未知',passed:'通过',blocked:'环境阻塞',not_run:'未验证'};
 return <span className={'badge '+status}><i/>{tr(names[status]||status)}</span>;
}
