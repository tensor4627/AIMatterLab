import {useEffect,useRef,useState} from 'react';
import {Download,FolderOpen,RefreshCw} from 'lucide-react';
import {Modal} from '../../ui/Dialogs';
import Notice from '../../ui/Notice';
import LoadingFeedback from '../../ui/LoadingFeedback';
import {t} from '../../ui/i18n';
import {cliRuntime} from '../../api/cli-runtime';
import type {CliProvider,CliReadiness,CliInstallProgress} from '../../../contracts/dto/cli-runtime';

const phases={downloading:'正在下载 CLI',verifying:'正在校验下载内容',extracting:'正在安装 CLI',checking:'正在检查 CLI 接口',completed:'CLI 已就绪',cancelled:'下载已取消',failed:'CLI 安装未完成'} as const;
function cliError(cause:unknown){
 const message=cause instanceof Error?cause.message:String(cause);
 if(/cli_runtime_(download_failed|download_source_changed)/.test(message))return t('CLI 下载未完成，请检查网络后重试。');
 if(/cli_runtime_(integrity_failed|package_identity_failed|dependency_lock_incomplete)/.test(message))return t('下载内容校验未通过，原有安装已保留，请重新下载。');
 if(message.includes('cli_runtime_platform_unsupported'))return t('当前系统暂不支持自动安装，请选择本地 CLI。');
 if(message.includes('cli_runtime_install_in_progress'))return t('该 CLI 正在安装，请等待完成。');
 if(/CLI.*cancelled/i.test(message))return t('下载已取消。');
 if(/ACP.*timed out/.test(message))return t('CLI 接口检查超时，请重新检测或重试安装。');
 return message;
}
export default function CliRuntimeDialog({provider,readiness,onClose,onReady}:{provider:CliProvider;readiness:CliReadiness;onClose:()=>void;onReady:(value:CliReadiness)=>void}){
 const [result,setResult]=useState(readiness),[pending,setPending]=useState(''),[error,setError]=useState(''),[progress,setProgress]=useState<CliInstallProgress|null>(null),[cancelling,setCancelling]=useState(false);
 const generation=useRef(0),operation=useRef<string|null>(null),request=useRef<{provider:CliProvider;requestId:string}|null>(null),closeFlight=useRef<Promise<void>|null>(null);
 useEffect(()=>{
  const epoch=++generation.current;operation.current=null;request.current=null;closeFlight.current=null;setPending('');setCancelling(false);setResult(readiness);setError('');setProgress(null);
  return()=>{if(generation.current!==epoch)return;const ticket=request.current;if(operation.current==='install'&&ticket&&!closeFlight.current)void cliRuntime.cancel(ticket).catch(()=>{});generation.current++;operation.current=null;request.current=null;};
 },[provider]);
 useEffect(()=>{if(!operation.current){setResult(readiness);setError('');}},[readiness,provider]);
 useEffect(()=>window.studio?.onEvent(event=>{const value=event.params as CliInstallProgress;if(event.method==='studio/cliInstallProgress'&&value?.provider===provider&&request.current?.requestId===value.requestId)setProgress(value);}),[provider]);
 async function perform(kind:'inspect'|'choose'|'install'){
  if(operation.current)return;operation.current=kind;setPending(kind);setError('');const epoch=generation.current;
  try{
   let value:CliReadiness|null;
   if(kind==='install'){const ticket={provider,requestId:crypto.randomUUID()};request.current=ticket;setProgress({ ...ticket,phase:'downloading',receivedBytes:0,packageIndex:0,packageCount:0});value=await cliRuntime.install(ticket);}
   else value=await cliRuntime[kind](provider);
   if(epoch!==generation.current||!value)return;
   setResult(value);if(value.status==='ready')onReady(value);
  }catch(cause){if(epoch===generation.current)setError(cliError(cause));}
  finally{if(epoch===generation.current){operation.current=null;request.current=null;setPending('');}}
 }
 function close():Promise<void>{
  if(closeFlight.current)return closeFlight.current;
  if(operation.current&&operation.current!=='install')return Promise.resolve();
  const epoch=generation.current,ticket=request.current;
  const promise=(async()=>{
   if(ticket){setCancelling(true);try{await cliRuntime.cancel(ticket);}catch(cause){if(epoch===generation.current)setError(cliError(cause));return;}}
   if(epoch!==generation.current)return;
   request.current=null;operation.current=null;generation.current++;onClose();
  })().finally(()=>{if(epoch===generation.current){closeFlight.current=null;setCancelling(false);}});
  closeFlight.current=promise;return promise;
 }
 const label=provider==='kimi'?'Kimi':'Qwen',phase=progress?t(phases[progress.phase]):t(pending==='choose'?'正在选择本地 CLI':'正在检测本地 CLI');
 return <Modal title={label+' CLI'} onClose={()=>void close()}>
  <div data-testid="cli-runtime-dialog" aria-busy={!!pending}>
   <p>{t(result.status==='missing'?'本机未找到对应 CLI。':result.status==='incompatible'?'检测到本机 CLI，但版本不兼容。':result.status==='invalid'?'已配置的 CLI 路径不可用。':'CLI 暂时不可用。')}</p>
   <p className="muted">{t('兼容版本')} · {result.expectedVersion}{result.version?' · '+t('本机版本')+' '+result.version:''}</p>
   {result.status==='failed'&&result.message&&<p className="muted">{result.message}</p>}
   <p>{t('可以选择已有程序，或下载到 AIMatterLab 专用目录。下载不会更改本机已有 CLI。')}</p>
   <LoadingFeedback busy={!!pending} label={phase} progress={progress?.totalBytes?{completed:progress.receivedBytes,total:progress.totalBytes}:undefined}/>
   {progress&&progress.packageCount>0&&<p className="muted">{t('软件包')} {progress.packageIndex} / {progress.packageCount}</p>}
   {error&&<Notice severity="error">{error}</Notice>}
   <div className="button-row">
    <button className="button" data-testid="cli-recheck" disabled={!!pending} onClick={()=>void perform('inspect')}><RefreshCw size={14}/>{t('重新检测')}</button>
    <button className="button" data-testid="cli-choose" disabled={!!pending} onClick={()=>void perform('choose')}><FolderOpen size={14}/>{t('选择本地 CLI')}</button>
    <button className="button primary" data-testid="cli-download" disabled={!!pending} onClick={()=>void perform('install')}><Download size={14}/>{t('下载兼容版本')}</button>
    <button className="button" data-testid="cli-cancel" disabled={cancelling||!!pending&&pending!=='install'} onClick={()=>void close()}>{t(cancelling?'正在停止下载…':pending==='install'?'取消下载':'取消')}</button>
   </div>
  </div>
 </Modal>;
}
