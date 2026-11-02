import {Server,Terminal} from 'lucide-react';
import {Modal} from './Dialogs';
import {t} from './i18n';
export default function ComputeConnectionChooser({onLocal,onSsh,onClose}:{onLocal:()=>void;onSsh:()=>void;onClose:()=>void}){
 return <Modal title={t('连接计算资源')} onClose={onClose}><div className="compute-connection-choices"><button className="button" data-testid="compute-choice-local" onClick={onLocal}><Server size={18}/>{t('本地 WSL')}</button><button className="button" data-testid="compute-choice-ssh" onClick={onSsh}><Terminal size={18}/>{t('SSH 手动配置')}</button></div></Modal>;
}
