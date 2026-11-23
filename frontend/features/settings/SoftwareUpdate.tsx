import {useEffect,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import type {UpdateAccess,UpdateSource,UpdateState} from '../../../contracts/dto/update';
import {version} from '../../../package.json';
import {invoke} from '../../api/studio';
import {t} from '../../ui/i18n';
import './software-update.css';

type Action = 'updates.check'|'updates.run';
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
  current:'当前已是最新版本。',unpublished:'发布源暂未提供可访问的更新清单。',available:'有新版本可用。',
  downloading:'正在下载更新…',verifying:'正在校验安装包…',ready:'更新已就绪，可在方便时重启。',
  preparing:'正在准备重启…',installing:'正在退出并安装更新…',error:'检查或安装更新失败。'
};
const issueHints:Partial<Record<number,string>> = {
  401:'认证失败，请核对令牌是否有效。',
  403:'访问被拒绝，请核对项目角色和令牌权限。',
  404:'清单未发布或访问受限。'
};
function issueLabel({status,webPage}:NonNullable<UpdateState['issues']>[number]) {
  const hint=webPage?'发布源返回了网页，可能需要浏览器验证或登录。':issueHints[status];
  const result=status ? 'HTTP '+status : t('连接失败');
  return hint ? result+' · '+t(hint) : result;
}
const mib = (value:number) => (value/(1024*1024)).toFixed(1)+' MiB';
const sourceLabel = (source:UpdateSource) => source==='nju' ? t('南大 GitLab') : 'GitHub';
const canCheck = (phase:UpdateState['phase']) => ['idle','current','unpublished','error'].includes(phase);
const canUpdate = (state:UpdateState) => !state.automatic && (state.phase==='available'||state.phase==='ready');

export function UpdateButton({state,act,open,compact=false}:ReturnType<typeof useWorkspaceUpdate>&{open:()=>void;compact?:boolean}) {
  const available=canUpdate(state);
  const busy=(!canCheck(state.phase) && !available && state.phase!=='disabled');
  const label=t(available?'更新':state.phase==='checking'?'检查中…':busy?'更新中…':'检查更新');
  const hint=available ? [t('下载并重启安装'),state.version].join(' ') : label;
  const Icon=available?Download:RefreshCw;
  function click(){
    open();
    if(available) void act('updates.run');
    else if(canCheck(state.phase)) void act('updates.check');
  }
  return <button type="button" className="update-trigger" data-highlight={available||undefined}
    title={hint} aria-label={label} onClick={click}><Icon size={16}/>{!compact&&<span>{label}</span>}</button>;
}

function ReleaseAccess({recheck}:{recheck:()=>Promise<void>}) {
  const [source,setSource]=useState<UpdateSource>('github'),[token,setToken]=useState('');
  const [saved,setSaved]=useState<UpdateAccess|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    let mounted=true;
    void invoke<UpdateAccess>('updates.accessStatus',{}).then(result=>{if(mounted)setSaved(result);})
      .catch(()=>{if(mounted)setError(t('无法读取更新凭据。'));});
    return ()=>{mounted=false;};
  },[]);
  async function save(value:string|null){
    setBusy(true);setError('');
    try {
      setSaved(await invoke<UpdateAccess>('updates.setAccess',{source,token:value}));
      setToken('');
      await recheck();
    } catch {setError(t('无法保存更新凭据。请检查令牌和系统凭据存储。'));}
    finally {setBusy(false);}
  }
  return <details className="release-access" onToggle={event=>{if(!event.currentTarget.open)setToken('');}}>
    <summary>{t('私有仓库访问')}</summary>
    <label>{t('发布源')}<select value={source} disabled={busy} onChange={event=>{setSource(event.target.value as UpdateSource);setToken('');setError('');}}>
      <option value="github">GitHub</option><option value="nju">{sourceLabel('nju')}</option>
    </select></label>
    <label>{t('只读访问令牌')}<input type="password" value={token} autoComplete="off" spellCheck={false} maxLength={512}
      placeholder={saved?.[source]?t('已保存令牌，可输入新令牌替换'):undefined} disabled={busy} onChange={event=>setToken(event.target.value)}/></label>
    <small>{source==='nju'?t('令牌需要 read_api 权限。'):t('令牌需要此仓库的 Contents 只读权限。')}</small>
    <div className="button-row"><button className="button" disabled={busy||!token.trim()} onClick={()=>void save(token.trim())}>{t('保存并检查')}</button>
      {saved?.[source]&&<button className="button" disabled={busy} onClick={()=>void save(null)}>{t('移除令牌')}</button>}</div>
    {error&&<small role="alert">{error}</small>}
  </details>;
}

export function SoftwareUpdate({state,act}:ReturnType<typeof useWorkspaceUpdate>) {
  const {phase,mode,bytes,received=0,detail} = state;
  const check = canCheck(phase), available=canUpdate(state);
  const ahead=phase==='current' && state.version && state.version!==state.currentVersion;
  const status=phase==='checking' ? (state.step==='cache'?'正在检查本地更新缓存…':state.step==='blocks'?'正在比对新旧版本的数据块…':'正在读取发布清单…') :
    phase==='ready'&&state.automatic?'安装包已校验。':ahead?'本机版本高于发布源的最新版本。':labels[phase];
  const percent=state.fullBytes ? Math.min(100,Math.floor((state.assembled??0)*100/state.fullBytes)) : 0;
  return <section className="software-update" aria-label={t('软件更新')}>
    <dl className="update-versions">
      <div><dt>{t('当前版本')}</dt><dd>{state.currentVersion}</dd></div>
      {state.version&&(phase!=='current'||ahead)&&<div><dt>{t('发布源最新版本')}</dt><dd>{state.version}</dd></div>}
    </dl>
    <p className="update-state" role="status"><strong>{t(status)}</strong>{state.source&&<small>{sourceLabel(state.source)}</small>}</p>
    {phase==='available' && state.reason && <p>{t(state.reason==='base'?'本机没有差分基准，可下载完整安装包。':state.reason==='retry'?'可重新下载完整安装包。':'差分数据不可用，可下载完整安装包。')}</p>}
    {bytes!==undefined && (phase==='available'||phase==='downloading') && <p>{t(mode==='delta'?'增量下载':'完整安装包')} · {phase==='downloading'?mib(received)+' / ':''}{mib(bytes)}</p>}
    {phase==='downloading' && <div className="update-progress"><progress aria-label={t('安装包准备进度')} value={state.assembled??0} max={state.fullBytes||1}/><span>{percent}%</span>
      {mode==='delta'&&<small>{t('已复用本地数据')} {mib(Math.max(0,(state.assembled??0)-received))}</small>}
      {state.reason==='delta'&&<small>{t('差分下载未完成，正在获取完整包。')}</small>}</div>}
    {(phase==='checking'||phase==='verifying'||phase==='preparing'||phase==='installing') && <progress aria-label={t(labels[phase])}/>}
    {detail && <small role="alert">{detail}</small>}
    {state.issues&&<ul>{state.issues.map(issue=><li key={issue.source}>{sourceLabel(issue.source)} · {issueLabel(issue)}</li>)}</ul>}
    {check && <button className="button" onClick={()=>void act('updates.check')}><RefreshCw size={15}/>{t('检查更新')}</button>}
    {available&&<button className="button primary" onClick={()=>void act('updates.run')}><Download size={15}/>{t(phase==='ready'?'重启更新':'下载并重启安装')}</button>}
    {(check||phase==='available')&&!state.automatic&&<ReleaseAccess recheck={()=>act('updates.check')}/>}
  </section>;
}
