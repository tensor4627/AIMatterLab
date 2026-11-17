import {useEffect,useState} from 'react';
import {Download,RefreshCw,RotateCw} from 'lucide-react';
import type {StudioIpcMap} from '../../../contracts/dto/ipc';
import type {UpdateState} from '../../../contracts/dto/update';
import {version} from '../../../package.json';
import {invoke} from '../../api/studio';
import {t} from '../../ui/i18n';
import './software-update.css';

type Action = Extract<keyof StudioIpcMap,`updates.${string}`>;
export function useWorkspaceUpdate() {
  const [state,setState] = useState<UpdateState>({phase:'disabled',currentVersion:version,sequence:-1});
  function accept(next:UpdateState|null) {
    if (next) setState(previous => next.sequence >= previous.sequence ? next : previous);
  }
  useEffect(() => {
    if (!window.studio) return;
    let open = true;
    const off = window.studio.onEvent(event => { if (event.method === 'studio/update') accept(event.params); });
    void invoke<UpdateState>('updates.status',{}).then(next => { if (open) accept(next); }).catch(()=>{});
    return () => { open=false; off(); };
  },[]);
  async function act(action:Action) {
    try { accept(await invoke<UpdateState>(action,{})); }
    catch (error) { setState(previous=>({...previous,phase:'error',detail:String(error)})); }
  }
  return {state,act};
}

const labels:Record<UpdateState['phase'],string> = {
  disabled:'安装到 Windows 工作区后可检查更新。',idle:'可检查是否有新版本。',checking:'正在检查更新…',
  current:'当前已是最新版本。',unpublished:'发布渠道暂未提供更新清单。',available:'有新版本可用。',
  downloading:'正在下载更新…',verifying:'正在校验安装包…',ready:'更新已就绪，可在方便时重启。',
  preparing:'正在准备重启…',installing:'正在退出并安装更新…',error:'检查或安装更新失败。'
};
const mib = (value:number) => (value/(1024*1024)).toFixed(1)+' MiB';

export function SoftwareUpdate({state,act}:ReturnType<typeof useWorkspaceUpdate>) {
  const {phase,mode,bytes,received=0,detail} = state;
  const check = ['idle','current','unpublished','error'].includes(phase);
  return <section className="software-update" aria-label={t('软件更新')}>
    <p>{t('当前版本')} <strong>{state.currentVersion}</strong>{state.version && <> → <strong>{state.version}</strong></>}</p>
    <p role="status">{t(labels[phase])}</p>
    {phase==='available' && state.reason && <p>{t(state.reason==='base'?'本机没有差分基准，可下载完整安装包。':state.reason==='retry'?'可重新下载完整安装包。':'差分数据不可用，可下载完整安装包。')}</p>}
    {bytes!==undefined && (phase==='available'||phase==='downloading') && <p>{t(mode==='delta'?'增量下载':'完整安装包')} · {phase==='downloading'?mib(received)+' / ':''}{mib(bytes)}</p>}
    {phase==='downloading' && <progress aria-label={t('下载进度')} value={received} max={bytes||1}/>}
    {(phase==='checking'||phase==='verifying'||phase==='preparing'||phase==='installing') && <progress aria-label={t(labels[phase])}/>}
    {detail && <small role="alert">{detail}</small>}
    {check && <button className="button" onClick={()=>void act('updates.check')}><RefreshCw size={15}/>{t('检查更新')}</button>}
    {phase==='available' && <button className="button primary" onClick={()=>void act('updates.download')}><Download size={15}/>{t(mode==='delta'?'下载增量更新':'下载完整安装包')}</button>}
    {phase==='ready' && <button className="button primary" onClick={()=>void act('updates.install')}><RotateCw size={15}/>{t('重启更新')}</button>}
  </section>;
}
