import {useEffect,useRef,useState} from 'react';
import {Shield} from 'lucide-react';
import type {TerminalWorkspaceApproval as Approval} from '../../../contracts/dto/compute';
import type {AgentProvider} from '../../../contracts/dto/agent';
import {terminalWorkspaceApprovals} from '../../api/compute-resources';
import {t} from '../../ui/i18n';

const reasons={outside_workspace:'区外终端操作',destructive:'可能删除或覆盖文件',unverified_effects:'需要核对操作影响',independent_job:'独立作业提交'};

export default function TerminalWorkspaceApproval({provider,threadId,active,selection,isCurrent}:{provider:AgentProvider;threadId:string;active:boolean;selection?:string|null;isCurrent:()=>boolean}){
 const [approval,setApproval]=useState<Approval|null>(null),[pending,setPending]=useState(false),[error,setError]=useState('');
 const scope=JSON.stringify([provider,threadId,active,selection]),latest=useRef(scope),request=useRef(0),busy=useRef(false),currentApproval=useRef(approval);
 latest.current=scope;currentApproval.current=approval;
 useEffect(()=>{
  if(!active)return;
  let disposed=false;
  const load=async()=>{
   const ticket=++request.current;
   try{
    const next=await terminalWorkspaceApprovals.pending();
    if(!disposed&&latest.current===scope&&ticket===request.current){
     const value=next?.threadId===threadId&&next.provider===provider&&next.expiresAt>Date.now()?next:null;
     currentApproval.current=value;setApproval(value);
    }
   }catch(error){if(!disposed&&latest.current===scope&&ticket===request.current){currentApproval.current=null;setApproval(null);}}
  };
  void load();
  const off=window.studio?.onEvent(event=>{if(event.method==='studio/terminalApprovalChanged'||event.method==='studio/computeResourceChanged'){request.current++;currentApproval.current=null;setApproval(null);void load();}});
  return()=>{disposed=true;request.current++;currentApproval.current=null;off?.();};
 },[scope]);
 useEffect(()=>{
  if(!approval)return;
  const timer=setTimeout(()=>{if(currentApproval.current===approval){currentApproval.current=null;setApproval(null);}},Math.max(0,approval.expiresAt-Date.now()));
  return()=>clearTimeout(timer);
 },[approval]);
 async function decide(decision:'approve'|'deny'){
  if(!approval||busy.current||!active||!isCurrent()||latest.current!==scope||currentApproval.current!==approval||approval.expiresAt<=Date.now())return;
  busy.current=true;setPending(true);setError('');
  try{
   const result=await terminalWorkspaceApprovals.decide({approvalId:approval.approvalId,decision});
   if(latest.current===scope&&currentApproval.current===approval&&(result.status==='approved'||result.status==='denied')){currentApproval.current=null;setApproval(null);}
  }catch(reason){if(latest.current===scope&&currentApproval.current===approval)setError(reason instanceof Error?reason.message:String(reason));}
  finally{busy.current=false;if(latest.current===scope)setPending(false);}
 }
 if(!approval||!active)return null;
 return <section className="agent-terminal-approval" data-testid="terminal-workspace-approval" data-terminal-approval-id={approval.approvalId} role="group" aria-label={t('确认终端操作')} aria-busy={pending}>
  <strong><Shield size={15}/>{t(reasons[approval.reason]||'确认终端操作')}</strong>
  <dl><dt>{t('计算资源')}</dt><dd>{approval.resourceName}</dd><dt>{t('远端总工作区')}</dt><dd><code>{approval.workspaceRoot}</code></dd><dt>{t('执行目录')}</dt><dd><code>{approval.cwd}</code></dd></dl>
  {approval.paths.length>0&&<ul aria-label={t('涉及路径')}>{approval.paths.map(path=><li key={path}><code>{path}</code></li>)}</ul>}
  <ol aria-label={t('将执行的命令')}>{approval.commands.map((command,index)=><li key={index}><code>{command}</code></li>)}</ol>
  <div className="button-row"><button type="button" className="button" data-testid="terminal-workspace-deny" disabled={pending} onClick={()=>void decide('deny')}>{t('拒绝')}</button>
   <button type="button" className="button primary" data-testid="terminal-workspace-approve" disabled={pending} onClick={()=>void decide('approve')}>{t('确认执行所列操作')}</button></div>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
