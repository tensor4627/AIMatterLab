import {useEffect,useRef,useState} from 'react';
import type {SessionWorkspaceResult} from '../../../contracts/dto/compute';
import {resourceWorkspaces} from '../../api/compute-resources';
import {t} from '../../ui/i18n';
import Button from '../../ui/Button';
import Disclosure from '../../ui/Disclosure';
import Notice from '../../ui/Notice';
import {ErrorState,LoadingState} from '../../ui/States';
import {useToast} from '../../ui/Toast';

export default function SessionWorkspace({profileId,owner,active,busy,isCurrent}:{profileId:string;owner:string;active:boolean;busy:boolean;isCurrent:()=>boolean}){
 const {show}=useToast();
 const [open,setOpen]=useState(false),[receipt,setReceipt]=useState<SessionWorkspaceResult|null>(null),[loading,setLoading]=useState(false);
 const [readError,setReadError]=useState(''),[copyError,setCopyError]=useState('');
 const scope=useRef({owner,active,isCurrent}),ticket=useRef(0);scope.current={owner,active,isCurrent};
 const inScope=()=>scope.current.owner===owner&&scope.current.active&&scope.current.isCurrent();
 async function read(){
  if(!inScope())return;
  const operation=++ticket.current,startedInScope=scope.current.isCurrent,current=()=>operation===ticket.current&&inScope()&&startedInScope();
  setLoading(true);setReadError('');
  try{const value=await resourceWorkspaces.session({profileId});if(current())setReceipt(value);}
  catch(error){if(current())setReadError(error instanceof Error?error.message:String(error));}
  finally{if(current())setLoading(false);}
 }
 async function copy(path:string){
  if(!inScope())return;
  const startedInScope=scope.current.isCurrent;
  try{
   await navigator.clipboard.writeText(path);
   if(inScope()&&startedInScope()){
    setCopyError('');
    show({message:t('已复制工作目录'),severity:'success'});
   }
  }
  catch(error){if(inScope()&&startedInScope())setCopyError(String(error));}
 }
 useEffect(()=>{
  if(!open||!active)return;
  void read();
  const off=window.studio?.onEvent(event=>{if(event.method==='studio/resourceWorkspaceChanged'||event.method==='studio/computeResourceChanged')void read();});
  return()=>{ticket.current++;off?.();};
 },[owner,open,active,busy]);
 const workspaces=receipt?.status==='multiple'?receipt.workspaces:receipt&&receipt.status!=='unassigned'?[receipt]:[];
 const refresh=<Button variant="ghost" size="sm" disabled={loading||!active} disabledReason={t('正在核对…')} onClick={()=>void read()}>{t('刷新状态')}</Button>;
 return <Disclosure className="agent-session-workspace" data-testid="agent-session-workspace" data-guide-target="session-workspace"
  summary={t('本次计算文件在哪？')} onToggle={event=>setOpen(event.currentTarget.open)}>
  {receipt?.status==='unassigned'&&<p>{t('此会话尚未执行计算流程，工作目录待分配。')}</p>}
  {workspaces.map(value=><div key={`${value.resourceId}:${value.workspaceId}`}>
   <code data-testid="session-workspace-path" dir="ltr">{value.path}</code>
   <small>{t(value.status==='verified'?'最近核对':'上次确认路径')} · <time dateTime={new Date(value.checkedAt).toISOString()}>{new Date(value.checkedAt).toLocaleString()}</time></small>
   <Button variant="ghost" size="sm" data-testid="session-workspace-copy" onClick={()=>void copy(value.path)}>{t('复制路径')}</Button>
  </div>)}
  {loading&&<LoadingState label={t('正在核对…')}/>}
  {readError?<ErrorState title={t('工作目录核对失败')} retained={workspaces.length?t('保留上次确认的工作目录。'):undefined}
   details={<pre>{readError}</pre>} action={refresh}/>:refresh}
  {copyError&&<Notice compact severity="error">{copyError}</Notice>}
 </Disclosure>;
}
