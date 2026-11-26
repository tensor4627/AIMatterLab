import {useEffect,useRef,useState} from 'react';
import type {SessionWorkspaceResult} from '../../../contracts/dto/compute';
import {resourceWorkspaces} from '../../api/compute-resources';
import {t} from '../../ui/i18n';
import Button from '../../ui/Button';
import Disclosure from '../../ui/Disclosure';
import Notice from '../../ui/Notice';
import {useToast} from '../../ui/Toast';

export default function SessionWorkspace({profileId,owner,active,busy,isCurrent}:{profileId:string;owner:string;active:boolean;busy:boolean;isCurrent:()=>boolean}){
 const {show}=useToast();
 const [open,setOpen]=useState(false),[receipt,setReceipt]=useState<SessionWorkspaceResult|null>(null),[loading,setLoading]=useState(false),[notice,setNotice]=useState('');
 const scope=useRef({owner,active,isCurrent}),ticket=useRef(0);scope.current={owner,active,isCurrent};
 const inScope=()=>scope.current.owner===owner&&scope.current.active&&scope.current.isCurrent();
 async function read(){
  if(!inScope())return;
  const operation=++ticket.current,startedInScope=scope.current.isCurrent,current=()=>operation===ticket.current&&inScope()&&startedInScope();
  setLoading(true);setNotice('');
  try{const value=await resourceWorkspaces.session({profileId});if(current())setReceipt(value);}
  catch(error){if(current())setNotice(error instanceof Error?error.message:String(error));}
  finally{if(current())setLoading(false);}
 }
 async function copy(path:string){
  if(!inScope())return;
  const startedInScope=scope.current.isCurrent;
  try{
   await navigator.clipboard.writeText(path);
   if(inScope()&&startedInScope()){
    setNotice('');
    show({message:t('已复制工作目录'),severity:'success'});
   }
  }
  catch(error){if(inScope()&&startedInScope())setNotice(String(error));}
 }
 useEffect(()=>{
  if(!open||!active)return;
  void read();
  const off=window.studio?.onEvent(event=>{if(event.method==='studio/resourceWorkspaceChanged'||event.method==='studio/computeResourceChanged')void read();});
  return()=>{ticket.current++;off?.();};
 },[owner,open,active,busy]);
 const workspaces=receipt?.status==='multiple'?receipt.workspaces:receipt&&receipt.status!=='unassigned'?[receipt]:[];
 return <Disclosure className="agent-session-workspace" data-testid="agent-session-workspace" data-guide-target="session-workspace"
  summary={t('本次计算文件在哪？')} onToggle={event=>setOpen(event.currentTarget.open)}>
  {receipt?.status==='unassigned'&&<p>{t('此会话尚未执行计算流程，工作目录待分配。')}</p>}
  {workspaces.map(value=><div key={`${value.resourceId}:${value.workspaceId}`}>
   <code data-testid="session-workspace-path" dir="ltr">{value.path}</code>
   <small>{t(value.status==='verified'?'最近核对':'上次确认路径')} · <time dateTime={new Date(value.checkedAt).toISOString()}>{new Date(value.checkedAt).toLocaleString()}</time></small>
   <Button variant="ghost" size="sm" data-testid="session-workspace-copy" onClick={()=>void copy(value.path)}>{t('复制路径')}</Button>
  </div>)}
  <Button variant="ghost" size="sm" disabled={loading||!active} onClick={()=>void read()}>{t(loading?'正在核对…':'刷新状态')}</Button>
  {notice&&<Notice compact severity="error">{notice}</Notice>}
 </Disclosure>;
}
