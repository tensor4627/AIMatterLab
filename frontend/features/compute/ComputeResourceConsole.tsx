import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowUpRight,ChevronRight,PlugZap,Plus,RefreshCw,Server,Terminal} from 'lucide-react';
import type {StudioMethod,StudioRequest,StudioResponse} from '../../../contracts/dto/ipc';
import type {ComputeConsoleChannel,ComputeConsoleResource,ComputeConsoleSnapshot,ComputeConsoleTerminal,ComputeLinkStatus} from '../../../contracts/dto/managed-compute';
import {invoke} from '../../api/studio';
import {resourceWorkspaces} from '../../api/compute-resources';
import type {ResourceWorkspaceReadResult} from '../../../contracts/dto/compute';
import type {ResourceToolSetup} from '../../../contracts/dto/resource-tools';
import {Modal} from '../../ui/Dialogs';
import {t} from '../../ui/i18n';
import {providerNames} from '../conversations/provider-account.mjs';
import './compute-resource-console.css';

interface Props {
  projectId?:string;
  onConnections:()=>void;
  onConnectSsh:(resource:ComputeConsoleResource)=>void;
  onOpenTerminal:(resource:ComputeConsoleResource|null,terminal?:ComputeConsoleTerminal)=>void;
  onOpenConversation:(channel:ComputeConsoleChannel)=>void;
  onConfigure:(resource:ComputeConsoleResource,section?:'service')=>void;
  onWorkspace?:(resource:ComputeConsoleResource,mode:'handoff'|'change')=>void;
  onTools?:(resource:ComputeConsoleResource)=>void;
  onGuide?:(resource:ComputeConsoleResource)=>void;
  onUseForWorkflow?:(resource:ComputeConsoleResource)=>Promise<unknown>;
}
type Confirmation = {title:string; text:string; target:string; label:string; run:()=>Promise<unknown>};
const linkLabels:Record<ComputeLinkStatus,string> = {
  online:'在线', offline:'未连接', preparing:'准备中', unconfigured:'未配置', requires_review:'需要核对',
  channel_ready:'通道可用 · 服务待核对', lost:'失联', unknown:'待核对', closed:'已关闭'
};
const channelLabels:Record<ComputeConsoleChannel['status'],string> = {
  preparing:'准备中', assigned:'已分配', releasing:'释放中', lost:'失联', unknown:'待核对', parked:'已暂停授权'
};
const typed = <M extends StudioMethod>(method:M,request:StudioRequest<M>) => invoke<StudioResponse<M>>(method,request);
const short = (value:string) => value.length > 14 ? value.slice(0,8) + '…' + value.slice(-4) : value;
const time = (value:number) => new Date(value).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const channelName = (channel:ComputeConsoleChannel) => channel.conversationName || t('未命名会话');

function Status({status,label}:{status:string;label:string}) {
  return <span className="compute-console-status" data-status={status}><i aria-hidden="true"/>{t(label)}</span>;
}
function Checked({at,label='最近核对'}:{at?:number|null;label?:string}) {
  return at == null ? null : <small className="compute-console-checked" title={new Date(at).toLocaleString()}>{t(label)} <time dateTime={new Date(at).toISOString()}>{time(at)}</time></small>;
}
function LinkCard({title,observation,children}:{title:string;observation:{status:ComputeLinkStatus;checkedAt?:number|null};children?:ReactNode}) {
  return <div className="compute-console-link">
    <strong>{t(title)}</strong>
    <Status status={observation.status} label={linkLabels[observation.status]}/>
    <Checked at={observation.checkedAt}/>
    {children}
  </div>;
}
function terminalName(terminal:ComputeConsoleTerminal) {
  return t(terminal.owner==='agent' ? 'Agent 持有的终端' : terminal.kind==='ssh' ? 'SSH 终端' : '本地终端');
}
function TerminalList({terminals,onOpen}:{terminals:ComputeConsoleTerminal[];onOpen:(terminal:ComputeConsoleTerminal)=>void}) {
  return <ul className="compute-console-terminals">{terminals.map(terminal => <li key={terminal.sessionId}>
    <Terminal size={16}/><span><strong>{terminalName(terminal)}</strong><small title={terminal.sessionId}>{terminal.profileName?terminal.profileName+' · ':''}{short(terminal.sessionId)}</small></span>
    <Status status={terminal.status} label={linkLabels[terminal.status]}/>
    <button type="button" className="text-button" disabled={terminal.status!=='online'||terminal.owner!=='human'} onClick={()=>onOpen(terminal)}>{t('打开原终端')}<ArrowUpRight size={13}/></button>
  </li>)}</ul>;
}

export default function ComputeResourceConsole({projectId,onConnections,onConnectSsh,onOpenTerminal,onOpenConversation,onConfigure,onWorkspace,onTools,onGuide,onUseForWorkflow}:Props) {
  const [receipt,setReceipt] = useState<{snapshot:ComputeConsoleSnapshot;readAt:number}|null>(null);
  const snapshot=receipt?.snapshot;
  const [selection,setSelection] = useState<Pick<ComputeConsoleResource,'key'|'profileId'|'profileVersion'>|null>(null);
  const [probing,setProbing] = useState(false), [running,setRunning] = useState(false);
  const [error,setError] = useState(''), [feedback,setFeedback] = useState('');
  const [confirm,setConfirm] = useState<Confirmation|null>(null);
  const mounted = useRef(false), probe = useRef<Promise<void>|null>(null), readTicket = useRef(0), operation = useRef(false);

  async function load(refresh=false) {
    if (probe.current) { await probe.current; if (!refresh || !mounted.current) return; }
    const ticket = ++readTicket.current;
    const request = async () => {
      try {
        const next = await typed(refresh ? 'compute.console.refresh' : 'compute.console.snapshot',{});
        if (!Array.isArray(next?.resources)||!Array.isArray(next.standalone)||!Array.isArray(next.projects)) throw Error('invalid_compute_console_snapshot');
        if (mounted.current && ticket === readTicket.current) { setReceipt({snapshot:next,readAt:Date.now()});setError(''); }
      } catch {
        if (mounted.current && ticket === readTicket.current) setError('无法读取计算资源状态。');
      }
    };
    if (!refresh) { await request();return; }
    setProbing(true);
    const pending = request();probe.current=pending;
    try { await pending; }
    finally { if(probe.current===pending){probe.current=null;if(mounted.current)setProbing(false);} }
  }
  useEffect(() => {
    let active=true;
    mounted.current = true;
    void load(false).then(()=>{if(active)void load(true);});
    const focus = () => {if (!probe.current) void load(true);};
    const interval = window.setInterval(focus,18000);
    const unsubscribe = window.studio?.onEvent(event => {
      if (['studio/managedActivity','studio/sshConnectionChanged','studio/computeResourceChanged','studio/sshServiceChanged','studio/resourceWorkspaceChanged',
        'studio/conversationTerminalChanged','studio/workerConnected','studio/agentTurnState'].includes(event.method) && !probe.current) void load(false);
    });
    window.addEventListener('focus',focus);
    return () => { active=false;mounted.current=false;readTicket.current++;window.clearInterval(interval);unsubscribe?.();window.removeEventListener('focus',focus); };
  },[]);

  async function run(work:()=>Promise<unknown>,done:string) {
    if (operation.current) return;
    operation.current=true;setRunning(true);setFeedback('');
    try {
      const receipt = await work();
      if (!receipt) throw Error('compute_console_receipt_missing');
      if (mounted.current) setFeedback(t(receipt && typeof receipt==='object' && 'status' in receipt && receipt.status==='unconfirmed' ? '操作结果待核对，请刷新原连接。' : done));
    } catch (reason) {
      const detail=String(reason);
      const message=detail.includes('managed_compute_channel_busy')||detail.includes('active conversation') ? '该通道正在被会话使用。' :
        detail.includes('managed_compute_channel_changed') || detail.includes('managed_compute_profile_changed') ? '资源或会话已变化，请刷新后重试。' :
        detail.includes('managed_compute_private_service_unavailable') ? '作业服务未能通过核对，请检查对应连接。' : '操作未完成，请核对原资源状态。';
      if (mounted.current) setFeedback(t(message));
    } finally {
      if (mounted.current) { setConfirm(null);await load(true); }
      operation.current=false;if(mounted.current)setRunning(false);
    }
  }

  const rows = snapshot?.resources ?? [];
  const stale = !!snapshot && !!error;
  const foreground = snapshot?.foregroundLocal;
  const selected = rows.find(row=>row.key===selection?.key) ?? rows.find(row=>!row.connectionId&&row.profileId===selection?.profileId&&row.profileVersion===selection.profileVersion) ??
    rows.find(row=>(row.master ?? row.service).status==='online') ?? rows[0];
  useEffect(()=>{
    if(selected&&(selected.key!==selection?.key||selected.profileId!==selection.profileId||selected.profileVersion!==selection.profileVersion))setSelection({key:selected.key,profileId:selected.profileId,profileVersion:selected.profileVersion});
  },[selected?.key,selected?.profileId,selected?.profileVersion]);
  return <main className="page compute-console" data-testid="compute-resource-console" data-observation={stale?'stale':snapshot?.observation}>
    <header className="compute-console-heading">
      <div><h1>{t('计算资源')}</h1><Checked at={snapshot?.checkedAt??receipt?.readAt} label={snapshot?.checkedAt==null?'最近读取':undefined}/></div>
      <div className="compute-console-actions">
        <button type="button" className="button" data-testid="compute-console-refresh" disabled={probing} onClick={()=>void load(true)}><RefreshCw size={15} className={probing?'is-refreshing':undefined}/>{t(probing?'正在核对':'刷新状态')}</button>
        <button type="button" className="button primary" onClick={onConnections}><Plus size={16}/>{t('添加或配置连接')}</button>
      </div>
    </header>
    {error && <p className="notice" role={stale?'status':'alert'} data-testid="compute-console-read-error">
      {t(stale?'暂时无法获取最新状态；保留最近观测。':error)}{' '}
      <button type="button" className="text-button" disabled={probing} onClick={()=>void load(true)}>{t('重试')}</button>
    </p>}
    {!stale && snapshot?.observation==='partial' && <p className="notice" role="status">{t('部分终端状态暂时无法核对。')}</p>}
    {feedback && <p className="notice" role="status">{feedback}</p>}
    {!snapshot && !error && <p className="muted" role="status">{t('正在读取计算资源…')}</p>}
    {foreground && <section className="compute-console-standalone compute-console-foreground">
      <LinkCard title="工作台当前 WSL 服务" observation={foreground.service}>
        <span>{foreground.distribution} · :{foreground.port}</span>
        <button type="button" className="text-button compute-console-danger" disabled={running} onClick={()=>setConfirm({
          title:t('断开本地作业服务'),target:foreground.distribution+' · :'+foreground.port,label:t('断开服务连接'),
          text:t('断开当前工作台连接。服务进程及已提交作业继续运行。'),
          run:()=>typed('compute.console.detachLocal',{profileId:null,profileVersion:null,generation:null,foregroundEpoch:foreground.foregroundEpoch})
        })}>{t('断开服务连接')}</button>
      </LinkCard>
    </section>}
    {snapshot && !rows.length && <div className="compute-console-empty"><Server size={23}/><strong>{t('尚未保存计算连接')}</strong><span>{t('添加 SSH 连接或本地 WSL 作业服务。')}</span></div>}
    {selected && <div className="compute-console-grid">
      <nav className="compute-console-resources" aria-label={t('计算资源')}>
        {rows.map(row => {
          const state = (row.master ?? row.service).status;
          return <button type="button" key={row.key} aria-current={selected.key===row.key?'true':undefined} data-resource-key={row.key}
            onClick={()=>{setSelection({key:row.key,profileId:row.profileId,profileVersion:row.profileVersion});setFeedback('');}}>
            {row.kind==='ssh'?<Terminal size={17}/>:<Server size={17}/>}
            <span><strong>{row.name}</strong><small>{row.kind==='ssh'?'SSH':'WSL'}{row.connectionId?' · '+short(row.connectionId):''}</small></span>
            <Status status={state} label={linkLabels[state]}/><ChevronRight className="compute-console-chevron" size={14}/>
          </button>;
        })}
      </nav>
      <ResourceDetail key={JSON.stringify([selected.key,selected.profileId,selected.profileVersion])} resource={selected} snapshot={snapshot!} initialProjectId={projectId} running={running} stale={stale} run={run} confirm={setConfirm}
        onOpenTerminal={terminal=>onOpenTerminal(selected,terminal)} onConnectSsh={()=>onConnectSsh(selected)} onConfigure={section=>onConfigure(selected,section)}
        onWorkspace={onWorkspace?mode=>onWorkspace(selected,mode):undefined} onTools={onTools?()=>onTools(selected):undefined} onGuide={onGuide?()=>onGuide(selected):undefined}
        onUseForWorkflow={onUseForWorkflow?()=>onUseForWorkflow(selected):undefined}
        onOpenConversation={onOpenConversation}/>
    </div>}
    {!!snapshot?.standalone.length && <section className="compute-console-standalone"><h2>{t('独立终端')}</h2><TerminalList terminals={snapshot.standalone} onOpen={terminal=>onOpenTerminal(null,terminal)}/></section>}
    {confirm && <Modal title={confirm.title} closeDisabled={running} onClose={()=>setConfirm(null)}>
      <p className="compute-console-confirm-target">{confirm.target}</p><p>{confirm.text}</p>
      <div className="button-row"><button type="button" className="button" disabled={running} onClick={()=>setConfirm(null)}>{t('取消')}</button>
        <button type="button" className="button danger" data-testid="compute-console-confirm" disabled={running} onClick={()=>void run(confirm.run,t('操作已确认'))}>{running?t('正在处理…'):confirm.label}</button></div>
    </Modal>}
  </main>;
}

interface DetailProps {
  resource:ComputeConsoleResource; snapshot:ComputeConsoleSnapshot; initialProjectId?:string; running:boolean; stale:boolean;
  run:(work:()=>Promise<unknown>,done:string)=>Promise<void>;confirm:(value:Confirmation)=>void;
  onOpenTerminal:(terminal?:ComputeConsoleTerminal)=>void;onConnectSsh:()=>void;onConfigure:(section?:'service')=>void;
  onOpenConversation:(channel:ComputeConsoleChannel)=>void;
  onWorkspace?:(mode:'handoff'|'change')=>void;onTools?:()=>void;onGuide?:()=>void;
  onUseForWorkflow?:()=>Promise<unknown>;
}
function ResourceDetail({resource,snapshot,initialProjectId,running,stale,run,confirm,onOpenTerminal,onConnectSsh,onConfigure,onOpenConversation,onWorkspace,onTools,onGuide,onUseForWorkflow}:DetailProps) {
  const [projectId,setProjectId] = useState(initialProjectId || '');
  const [workspace,setWorkspace]=useState<ResourceWorkspaceReadResult|null>(null);
  const [installed,setInstalled]=useState<ResourceToolSetup[]>([]);
  const project = snapshot.projects.find(row=>row.id===projectId);
  const post = resource.projectPolicies.find(value=>value.projectId===project?.id)?.allowed;
  const profile = {profileId:resource.profileId,profileVersion:resource.profileVersion};
  const ssh = resource.connectionId ? {...profile,connectionId:resource.connectionId} : null;
  const active = resource.master?.status==='online';
  const busy = resource.channels.some(channel=>channel.busy);
  const link = resource.localGeneration || resource.foregroundEpoch != null;
  const preparing = resource.service.status==='preparing';
  const target = resource.name + (resource.connectionId ? ' · '+short(resource.connectionId) : '');
  const runningHint = busy ? t('该通道正在被会话使用。') : undefined;
  useEffect(()=>{
    if(resource.kind!=='ssh'||!resource.current)return;
    let current=true;
    void resourceWorkspaces.read(profile).then(value=>{if(current&&value.profileId===profile.profileId&&value.profileVersion===profile.profileVersion)setWorkspace(value);}).catch(()=>{});
    return ()=>{current=false;};
  },[resource.kind,resource.current,resource.profileId,resource.profileVersion,resource.managedId,snapshot.checkedAt]);
  useEffect(()=>{
    if(resource.kind!=='ssh'||!resource.current||resource.service.status!=='online'){setInstalled([]);return;}
    let current=true;
    async function readTools(){
      try{const value=await typed('tools.resource.list',{resource_id:'ssh:'+resource.profileId,profile_version:resource.profileVersion});if(current)setInstalled(value.setups.filter(row=>row.status==='active'));}
      catch{if(current)setInstalled([]);}
    }
    void readTools();
    const off=window.studio?.onEvent(event=>{if(event.method==='studio/resourceToolSetupChanged'&&event.params?.resource_id==='ssh:'+resource.profileId)void readTools();});
    return ()=>{current=false;off?.();};
  },[resource.kind,resource.current,resource.profileId,resource.profileVersion,resource.service.status]);
  function openDisconnect() {
    confirm(ssh ? {
      title:t('断开 SSH 主连接'),target,label:t('断开主连接'),
      text:t('此操作关闭这个主连接上的人工终端、会话 Shell 和作业服务通道。远端已提交作业继续运行。'),
      run:()=>typed('compute.console.disconnectSsh',ssh)
    } : {
      title:t('断开本地作业服务'),target,label:t('断开服务连接'),
      text:t('此操作解除工作台对此 WSL 服务的连接和会话分配。服务进程及已提交作业继续运行。'),
      run:()=>typed('compute.console.detachLocal',{...profile,generation:resource.localGeneration??null,foregroundEpoch:resource.foregroundEpoch??null})
    });
  }
  function release(channel:ComputeConsoleChannel) {
    if (!channel.leaseId) return;
    const lease = {resourceId:resource.kind+':'+resource.profileId,connectionId:resource.connectionId,source:channel.source,
      leaseId:channel.leaseId,provider:channel.provider,threadId:channel.threadId};
    confirm({title:t('释放会话通道'),target:target+' / '+channelName(channel),label:t('释放通道'),
      text:t(channel.commandContext?'此操作解除该会话在该资源上的授权。已提交作业继续运行。':channel.serviceContext&&(!channel.serviceOnly||channel.terminalStatus)?'此操作解除该会话的服务分配并关闭它的专属 Shell。已提交作业继续运行。':
        channel.serviceOnly?'此操作解除该会话的服务分配。已提交作业继续运行。':'此操作关闭该会话的专属 Shell。已提交作业继续运行。'),
      run:()=>typed('compute.console.release',lease)});
  }
  return <section className="compute-console-detail" data-testid="compute-console-detail">
    <header className="compute-console-detail-heading"><div><h2>{resource.name}</h2>
      <span className="muted">{resource.target || (resource.kind==='ssh'?'SSH':'WSL')}{ssh && <> · <span title={ssh.connectionId}>{short(ssh.connectionId)}</span></>}{!resource.current && <> · {t('旧保存版本')} {resource.profileVersion}</>}</span></div>
      <div className="compute-console-actions">
        {resource.kind==='ssh' && resource.current && !active && resource.master?.status!=='preparing' && (!ssh||resource.master?.status==='lost') && <button type="button" className="button primary" onClick={onConnectSsh}><PlugZap size={15}/>{t('连接 SSH')}</button>}
        {resource.kind==='ssh' && ssh && (active || resource.master?.status==='preparing') && <button type="button" className="button" onClick={()=>onOpenTerminal()}><Terminal size={15}/>{t(active?'查看 SSH 连接':'打开认证终端')}</button>}
        {resource.kind==='wsl' && !resource.localGeneration && <button type="button" className="button primary" disabled={running||preparing||stale} onClick={()=>void run(()=>typed('compute.console.attachLocal',profile),'已连接现有作业服务')}><PlugZap size={15}/>{t('连接现有服务')}</button>}
        {resource.current && <button type="button" className="text-button" onClick={()=>onConfigure()}>{t('编辑连接')}</button>}
        {resource.kind==='ssh'&&resource.current&&onGuide&&<button type="button" className="text-button" data-testid="resource-open-guide" onClick={onGuide}>{t('集群实操引导')}</button>}
      </div>
    </header>

    <div className="compute-console-links">
      {resource.master && <LinkCard title="SSH 认证主连接" observation={resource.master}>
        {active && !resource.managedId && resource.current && ssh && <button type="button" className="text-button" disabled={running} onClick={()=>onWorkspace?onWorkspace('handoff'):onOpenTerminal()}>{t('交给工作台管理')}</button>}
        {active && resource.managedId && <small>{t('工作台托管中')}</small>}
        {ssh && resource.canDisconnect && <button type="button" className="text-button compute-console-danger" disabled={running||busy} title={runningHint} onClick={openDisconnect}>{t('断开主连接')}</button>}
      </LinkCard>}
      {resource.kind==='ssh' && <div className="compute-console-link"><strong>{t('人工终端')}</strong>
        {resource.terminals.length ? <TerminalList terminals={resource.terminals} onOpen={onOpenTerminal}/> : <span className="muted">{t(active?'暂无人工终端':'终端待核对')}</span>}
      </div>}
      <LinkCard title={resource.kind==='wsl'?'本地 WSL 作业服务':resource.service.kind==='borrowed'?'借用终端的作业服务':'私有作业服务'} observation={resource.service}>
        {resource.kind==='ssh'&&resource.current&&active&&ssh&&resource.managedId&&resource.service.status==='online'&&onUseForWorkflow&&<button type="button" className="text-button" data-testid="compute-console-use-workflow" disabled={running} onClick={()=>void run(onUseForWorkflow,'当前流程已连接此作业服务')}>{t('用于当前流程')}</button>}
        {resource.kind==='wsl' && resource.localGeneration && resource.foregroundEpoch == null && <small>{t('独立服务连接')}</small>}
        {resource.kind==='wsl' && link && <button type="button" className="text-button compute-console-danger" disabled={running||busy} title={runningHint} onClick={openDisconnect}>{t('断开服务连接')}</button>}
        {resource.kind==='ssh' && resource.current && active && !!ssh && !!resource.managedId && !preparing && resource.service.status!=='online' && <button type="button" className="text-button" disabled={running} onClick={()=>void run(()=>typed('compute.managed.configureService',ssh),'已核对作业服务')}>{t('准备作业服务')}</button>}
        {resource.kind==='ssh' && resource.current && active && resource.service.status!=='online' && <button type="button" className="text-button" onClick={()=>onConfigure('service')}>{t('服务配置')}</button>}
      </LinkCard>
    </div>

    {resource.kind==='ssh'&&resource.current&&<section className="compute-console-link" data-guide-target="resource-workspace-status">
      <strong>{t('远端总工作区')}</strong>
      {workspace?.status==='confirmed'?<><code data-testid="resource-workspace-root">{workspace.root}</code><small>{workspace.account}@{workspace.hostname}</small><Checked at={workspace.checkedAt}/></>:
        <small>{t(workspace?'交接时确认目录':'正在核对工作区')}</small>}
      {active&&resource.managedId&&onWorkspace&&<button type="button" className="text-button" onClick={()=>onWorkspace('change')}>{t('更换远端总工作区')}</button>}
      {installed.length>0&&<small data-testid="resource-activated-tools">{t('已激活功能')} · {installed.slice(0,3).map(row=>row.manifest.name+' '+row.manifest.version).join(' · ')}{installed.length>3?' · '+installed.length:''}</small>}
      {onTools&&<button type="button" className="text-button" data-testid="resource-configure-tools" data-guide-target="resource-configure-tools" onClick={onTools}>{t('配置此资源的科学工具')}</button>}
    </section>}

    <section className="compute-console-channels">
      <div className="compute-console-section-heading"><h3>{t('会话专属通道')}</h3>{resource.capacity && <span className="compute-console-capacity">{t('托管 Shell 容量')} <strong>{resource.capacity.occupied}/{resource.capacity.total}</strong></span>}</div>
      {!resource.channels.length ? <p className="compute-console-channel-empty muted">{t('当前没有分配给会话的通道。')}</p> :
        <ul>{resource.channels.map(channel=><li key={[channel.source,channel.provider,channel.threadId,channel.leaseId ?? 'pending'].join(':')}>
          <div className="compute-console-channel-name"><strong title={channel.threadId}>{channelName(channel)}</strong>
            <small>{t(providerNames[channel.provider]||channel.provider)} · {channel.projectName||channel.projectId||t('未绑定项目')}</small></div>
          <small className="compute-console-channel-type">{t(channel.commandContext&&!channel.sessionId?'命令权限':channel.serviceOnly?'服务上下文':channel.source==='handoff'?'交接 Shell':'托管 Shell')}
            {channel.commandContext&&channel.sessionId&&<span>{t('命令权限')}</span>}
            {channel.serviceContext&&(!channel.serviceOnly||channel.commandContext)&&<span>{t('服务上下文')}</span>}
            {channel.terminalStatus&&<span>{t('托管 Shell')} · {t(channelLabels[channel.terminalStatus])}</span>}
            {channel.sessionId&&<span title={channel.sessionId}>{short(channel.sessionId)}</span>}</small>
          <div className="compute-console-channel-state"><Status status={channel.status} label={channelLabels[channel.status]}/><Checked at={channel.checkedAt}/></div>
          <div className="compute-console-actions">
            {channel.conversationId && <button type="button" className="text-button" onClick={()=>onOpenConversation(channel)}>{t('打开会话')}<ArrowUpRight size={13}/></button>}
            {channel.leaseId && <button type="button" className="text-button compute-console-danger" disabled={running||channel.busy||channel.status==='releasing'} title={channel.busy?t('该通道正在被会话使用。'):undefined} onClick={()=>release(channel)}>{t('释放')}</button>}
          </div>
        </li>)}</ul>}
    </section>

    {ssh && resource.managedId && active && resource.current && <details className="compute-console-project-access">
      <summary>{t('项目的 SSH 终端授权')}</summary>
      <p className="muted">{t('此设置适用于该项目的 SSH 终端。正式作业遵循作业服务的项目策略。')}</p>
      <label>{t('计算项目')} <select value={project?.id??''} onChange={event=>setProjectId(event.target.value)} aria-label={t('计算项目')}>
        <option value="">{t('选择项目')}</option>{snapshot.projects.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      {project && <div className="compute-console-actions"><span className="muted">{t(post===true?'项目已明确允许':post===false?'项目已明确禁止':'项目未设置终端授权')}</span>
        {[true,false].map(allowed=><button type="button" key={String(allowed)} className="button" disabled={running||post===allowed}
          onClick={()=>void run(()=>typed('compute.console.projectAccess',{...ssh,projectId:project.id,allowed}),'项目终端授权已保存')}>{t(allowed?'允许终端':'禁止终端')}</button>)}
      </div>}
    </details>}
  </section>;
}
