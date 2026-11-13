import {t} from '../../ui/i18n';
import {serviceErrorMessage,servicePhaseMessage,serviceTransfer} from '../terminal/ssh-service-presentation';
import type {IndependentSshService} from './ssh-connection-types';

/** Only acknowledged service observations; the shell has a separate owner and lifetime. */
export default function SshServiceObservation({state}:{state:IndependentSshService|null}){
 if(!state)return null;
 const transfer=state.status==='connecting'?serviceTransfer(state):null;
 const error=state.error?.code==='stop_timeout'?'服务停止尚未确认，请核对原连接；不会自动重试。':state.error?serviceErrorMessage(state.error.code):null;
 const phase=state.status==='connecting'&&state.phase!=='ready'&&state.phase!=='returning_terminal'?servicePhaseMessage(state.phase):null;
 return <div className="ssh-service-observation" data-testid="ssh-service-observation" role="status">
  {error?<p>{t(error)}</p>:phase&&<p>{t(phase)}</p>}
  {transfer&&<div><progress max={transfer.total} value={transfer.completed} aria-label={t('已确认的文件传输')}/><span>{transfer.percent}% · {transfer.completed.toLocaleString()} / {transfer.total.toLocaleString()} B · {t('仅表示已确认的文件传输')}</span></div>}
 </div>;
}
